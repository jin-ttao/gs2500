import { PROFILES, PRODUCT_MAP } from './model.js';
import { getMap, mapStations } from './maps.js';
import { createNavigation } from './navigation.js';

// This is presentation of recorded visits, not another simulation. In particular,
// overlapping clips do not imply that those people were in the store together.
const clone=value=>value===undefined?undefined:structuredClone(value);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const EPSILON=1e-9;
const PLAYBACK_SPEEDS=Object.freeze([.5,1,2]);
const DETAIL_FIELDS=new Set(['analytics','lastDecision','events','replenishmentEvents','agents']);
const PRESENTATION=Object.freeze({
  mode:'summary-replay',source:'recorded-spatial-visits',originalConcurrency:false,
  label:'실제 기록의 대표 방문을 겹친 요약 재생 · 원래 시간의 동시 방문이 아님',
});

function latestIndex(rows,time){
  let low=0,high=rows.length-1,result=-1;
  while(low<=high){const middle=(low+high)>>1;if(rows[middle].time<=time+EPSILON){result=middle;low=middle+1;}else high=middle-1;}
  return result;
}

function validateRecording(record,index){
  if(!record||record.schemaVersion!=='day-replay/1')throw new TypeError('A day-replay/1 recording is required');
  if(!Number.isFinite(record.duration)||record.duration<=0)throw new RangeError('Recorded duration must be positive');
  if(!record.finalSnapshot||!Array.isArray(record.accounting)||!record.accounting.length||!Array.isArray(record.visits))throw new TypeError('Recording needs finalSnapshot, accounting and visits');
  if(!Number.isFinite(record.finalSnapshot.time)||Math.abs(record.finalSnapshot.time-record.duration)>EPSILON)throw new RangeError('The final recording snapshot must be the completed day endpoint');
  const id=record.id??record.runId;
  if(typeof id!=='string'||!id||typeof record.runId!=='string'||!record.runId)throw new TypeError('Recording needs a run identifier');
  getMap(record.mapId);
  for(let i=0;i<record.accounting.length;i++){
    const row=record.accounting[i];
    if(!Number.isFinite(row.time)||row.time<0||row.time>record.duration+EPSILON||(i&&row.time<record.accounting[i-1].time))throw new RangeError('Accounting checkpoints must be ordered within the recorded day');
  }
  if(record.accounting[0].time!==0)throw new RangeError('Recording must include the actual initial accounting checkpoint');
  const ids=new Set();
  for(const visit of record.visits){
    if(!Number.isSafeInteger(visit.id)||visit.id<0||ids.has(visit.id)||!Array.isArray(visit.frames))throw new TypeError('Recorded visits need unique nonnegative integer ids and frames');
    ids.add(visit.id);
    for(let i=0;i<visit.frames.length;i++){
      const frame=visit.frames[i];
      if(!Number.isFinite(frame.time)||frame.time<0||frame.time>record.duration+EPSILON||(i&&frame.time<=visit.frames[i-1].time))throw new RangeError('Visit frames must have strictly increasing recorded times');
      if(!Array.isArray(frame.position)||frame.position.length!==2||!frame.position.every(Number.isFinite)||typeof frame.state!=='string')throw new TypeError('Every recorded frame needs a finite position and state');
    }
  }
  return {record,id,index};
}

// Preserve every observed state/point and give brief handling states more screen
// time relative to long walks. Only this view-time mapping changes; source times,
// paths, baskets, purchases and accounting remain the original recorded values.
function phaseMap(frames,clipDuration){
  const groups=[];
  for(let i=0;i<frames.length-1;i++){
    const frame=frames[i],end=frames[i+1].time;
    let group=groups.at(-1);
    if(!group||group.state!==frame.state){group={state:frame.state,sourceStart:frame.time,sourceEnd:end};groups.push(group);}
    else group.sourceEnd=end;
  }
  const emphasis=state=>['browsing','reaching','paying'].includes(state)?1.35:state==='queue'?.7:1;
  const weight=group=>Math.sqrt(group.sourceEnd-group.sourceStart)*emphasis(group.state);
  const total=groups.reduce((sum,group)=>sum+weight(group),0);
  let elapsed=0;
  return groups.map((group,index)=>{
    const start=elapsed;elapsed=index===groups.length-1?clipDuration:elapsed+clipDuration*weight(group)/total;
    return {...group,start,end:elapsed,timeScale:(group.sourceEnd-group.sourceStart)/(elapsed-start)};
  });
}

function representativeVisits(record,duration,isWalkable){
  const eligible=record.visits.filter(visit=>visit.frames.length>=2).sort((a,b)=>a.frames[0].time-b.frames[0].time||a.id-b.id);
  const count=Math.min(12,eligible.length);
  const selected=count===eligible.length?eligible:Array.from({length:count},(_,i)=>eligible[Math.floor(i*(eligible.length-1)/(count-1))]);
  return selected.map((visit,index)=>{
    // Deterministic, cohort-id-based clips occupy 60–90% of the replay duration.
    const fraction=((Math.imul(visit.id+1,2654435761)>>>0)%1000)/999;
    const clipDuration=duration*(.6+.3*fraction),start=count===1?0:(duration-clipDuration)*index/(count-1);
    const profile=clone(visit.profile??PROFILES[visit.profileIndex]);
    if(!profile)throw new TypeError('Recorded visit has no supported persona');
    const phases=phaseMap(visit.frames,clipDuration);
    return {visit,start,end:start+clipDuration,duration:clipDuration,phases,profile,isWalkable,
      path:visit.frames.map(frame=>[...frame.position]),
      sourceStart:visit.frames[0].time,sourceEnd:visit.frames.at(-1).time};
  });
}

function visualAgent(track,elapsed){
  if(elapsed+EPSILON<track.start||elapsed>=track.end-EPSILON)return null;
  const local=clamp(elapsed-track.start,0,track.duration);
  const phase=track.phases.find(row=>local<row.end-EPSILON)??track.phases.at(-1);
  const sourceTime=clamp(phase.sourceStart+(local-phase.start)*phase.timeScale,phase.sourceStart,phase.sourceEnd);
  const frames=track.visit.frames,index=Math.max(0,latestIndex(frames,sourceTime)),left=frames[index],right=frames[Math.min(index+1,frames.length-1)];
  const amount=right.time===left.time?0:clamp((sourceTime-left.time)/(right.time-left.time),0,1);
  // Adjacent recorded points only. The recorder preserves bends/state changes;
  // there is no shortcut to the next shelf, computed path, extrapolation or loop.
  const interpolated=left.position.map((value,i)=>value+(right.position[i]-value)*amount);
  // The source engine tests discrete movement endpoints. At a padded fixture
  // corner even two adjacent valid ticks can have an invalid straight midpoint.
  // Hold the real prior pose in that rare case; never invent a detour or render
  // inside the fixture. Both sourceTime and poseSourceTime expose this choice.
  const interpolate=track.isWalkable(...interpolated);
  const position=interpolate?interpolated:[...left.position];
  const heading=left.heading??0,turn=Math.atan2(Math.sin((right.heading??heading)-heading),Math.cos((right.heading??heading)-heading));
  const sourceStateTime=(left.stateTime??0)+(sourceTime-left.time);
  const basket=(left.basket??[]).map(item=>{
    const product=typeof item==='string'?PRODUCT_MAP[item]:item;
    if(!product)throw new TypeError('Recorded basket contains an unknown product');
    return clone(product);
  });
  return {
    ...clone(left),id:track.visit.id,profileIndex:track.visit.profileIndex,profile:track.profile,
    position,heading:heading+turn*amount,basket,visited:[...(left.visited??[])],memory:clone(left.memory??[]),
    speed:left.speed??0,velocity:left.velocity??0,
    stateTime:Math.max(0,local-phase.start),sourceStateTime,sourceTime,poseSourceTime:interpolate?sourceTime:left.time,
    // Rigs use presentation time at a natural rate, independent of the day clock.
    animationTimeScale:1,timeScale:phase.timeScale,sourceSpeed:left.speed??0,
    path:track.path,pathIndex:Math.min(index+1,track.path.length),
    recordedVisit:{enteredAt:track.visit.enteredAt,endedAt:track.visit.endedAt,firstFrame:track.sourceStart,lastFrame:track.sourceEnd,truncated:!!track.visit.truncated},
    presentation:{...PRESENTATION,clipStart:track.start,clipEnd:track.end,interpolation:interpolate?'adjacent-recorded-segment':'recorded-tick-hold'},
  };
}

/**
 * @param {Array<object>} recordings Immutable day-replay/1 records, optionally
 * carrying id (e.g. samsung:hq) in addition to the original world runId.
 * @returns Stable visual-world objects plus separately sampled real accounting.
 */
export function createSummaryReplay(recordings,{duration=30}={}){
  if(!Array.isArray(recordings)||!recordings.length)throw new TypeError('At least one recording is required');
  if(!Number.isFinite(duration)||duration<=0)throw new RangeError('Replay duration must be positive finite seconds');
  const rows=recordings.map(validateRecording),lookup=new Map(),worlds=new Map(),navigation=new Map();
  for(const row of rows){
    for(const key of new Set([row.id,row.record.runId])){
      if(lookup.has(key))throw new TypeError('Recording identifiers must be unique');lookup.set(key,row);
    }
    if(!navigation.has(row.record.mapId))navigation.set(row.record.mapId,createNavigation(row.record.mapId));
    row.tracks=representativeVisits(row.record,duration,navigation.get(row.record.mapId).isWalkable);row.accounting=null;row.source=null;
    const initial=row.record.accounting[0];
    const initialStock=Object.fromEntries(Object.keys(PRODUCT_MAP).map(id=>[id,initial.initialStock?.[id]??initial.stock?.[id]??0]));
    const initialTotalStock=Object.fromEntries(Object.keys(PRODUCT_MAP).map(id=>[id,initial.initialTotalStock?.[id]??initialStock[id]+(initial.backroomStock?.[id]??0)]));
    const world={mode:PRESENTATION.mode,runId:'summary:'+row.record.runId,sourceRunId:row.record.runId,
      storeId:row.record.storeId,mapId:row.record.mapId,scenario:row.record.scenario,seed:row.record.seed,
      time:0,sourceTime:0,accountingTime:0,dayTime:0,agents:[],owner:null,stock:{},backroomStock:{},initialStock,initialTotalStock,
      stations:mapStations(getMap(row.record.mapId)),presentation:{...PRESENTATION,representativeCount:row.tracks.length},
      snapshot:({detail=true}={})=>{
        const accounting=detail?row.accounting:Object.fromEntries(Object.entries(row.accounting).filter(([key])=>!DETAIL_FIELDS.has(key)));
        return {
          ...clone(accounting),mode:PRESENTATION.mode,runId:world.runId,sourceRunId:world.sourceRunId,
          time:world.time,sourceTime:world.sourceTime,accountingTime:world.accountingTime,dayTime:world.dayTime,
          initialStock:clone(world.initialStock),initialTotalStock:clone(world.initialTotalStock),
          active:world.agents.length,owner:null,presentation:clone(world.presentation),
          ...(detail?{agents:world.agents.map(agent=>clone(agent))}:{}),
        };
      },
    };
    row.world=world;worlds.set(row.id,world);
  }
  let requestedTime=0,timeError=0;
  const replay={duration,speed:1,elapsed:0,time:0,progress:0,running:false,isComplete:false,dayTime:0,worlds,
    presentation:{...PRESENTATION},
  };
  const resolve=id=>{const row=lookup.get(id);if(!row)throw new RangeError('Unknown recorded run: '+id);return row;};
  function update(){
    replay.progress=clamp(replay.elapsed/duration,0,1);replay.dayTime=86400*replay.progress;
    replay.isComplete=replay.elapsed>=duration-EPSILON;
    for(const row of rows){
      const target=row.record.duration*replay.progress;
      const source=replay.isComplete?row.record.finalSnapshot:row.record.accounting[latestIndex(row.record.accounting,target)];
      const world=row.world;
      // Checkpoint payloads include 24 hourly rows and inventory maps. They are
      // immutable and stepwise: copying them every render frame adds no fidelity.
      if(row.source!==source){
        row.source=source;row.accounting=clone(source);
        world.stock=clone(source.stock??{});world.backroomStock=clone(source.backroomStock??{});world.shelfCapacity=clone(source.shelfCapacity??{});
        world.day=clone(source.day??null);world.completed=source.completed??0;world.paidRevenue=source.paidRevenue??0;world.paidGrossProfit=source.paidGrossProfit??0;
      }
      world.time=replay.elapsed;world.dayTime=target;world.sourceTime=source.time;world.accountingTime=source.time;
      world.isComplete=replay.isComplete;world.owner=null;
      world.agents=replay.isComplete?[]:row.tracks.map(track=>visualAgent(track,replay.elapsed)).filter(Boolean);
      world.presentation={...PRESENTATION,representativeCount:row.tracks.length,progress:replay.progress,originalDayTime:target,recordedCheckpointTime:source.time};
    }
  }
  replay.getWorld=id=>resolve(id).world;
  replay.getAccounting=id=>clone(resolve(id).accounting);
  replay.getSchedule=id=>resolve(id).tracks.map(track=>({id:track.visit.id,start:track.start,end:track.end,duration:track.duration,sourceStart:track.sourceStart,sourceEnd:track.sourceEnd,truncated:!!track.visit.truncated}));
  replay.start=({reset=false}={})=>{if(reset)replay.reset();if(!replay.isComplete)replay.running=true;return replay;};
  replay.pause=()=>{replay.running=false;return replay;};
  replay.setSpeed=value=>{
    if(!PLAYBACK_SPEEDS.includes(value))throw new RangeError('Playback speed must be 0.5, 1 or 2');
    replay.speed=value;return replay;
  };
  replay.reset=()=>{requestedTime=0;timeError=0;replay.elapsed=replay.time=0;replay.running=false;update();return replay;};
  replay.advance=realSeconds=>{
    if(!Number.isFinite(realSeconds)||realSeconds<0)throw new RangeError('Elapsed replay seconds must be finite and nonnegative');
    if(!replay.running)return {elapsed:replay.elapsed,progress:replay.progress,isComplete:replay.isComplete};
    const corrected=realSeconds*replay.speed-timeError,next=requestedTime+corrected;timeError=(next-requestedTime)-corrected;requestedTime=Math.min(duration,next);
    replay.elapsed=replay.time=requestedTime>=duration-EPSILON?duration:Math.round(requestedTime*1e12)/1e12;
    update();if(replay.isComplete)replay.running=false;
    return {elapsed:replay.elapsed,progress:replay.progress,isComplete:replay.isComplete};
  };
  update();return replay;
}
