import {getMap, localToWorld, checkoutPoint, mapStations} from '../demo/maps.js';
import {createNavigation} from '../demo/navigation.js';
import {PRODUCT_MAP} from './data.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const navigationCache=new Map(),pathCache=new Map();
const navigation=mapId=>{if(!navigationCache.has(mapId))navigationCache.set(mapId,createNavigation(mapId));return navigationCache.get(mapId);};
const clone=value=>structuredClone(value);

function pathTo(mapId,start,end){
  const key=JSON.stringify([mapId,start,end]);
  if(!pathCache.has(key)){
    const path=navigation(mapId).findPath(start,end);
    if(!path.length&&distance(start,end)>.05)throw new Error('기록한 진열 위치로 이동할 수 없습니다.');
    pathCache.set(key,[start,...path]);
  }
  return pathCache.get(key);
}

/** A collision-free presentation point in front of the recorded SKU column. */
export function viewingPoint(mapId,decision){
  const map=getMap(mapId),fixture=map.fixtures.find(item=>item.id===decision.fixtureId);
  if(!fixture||!Array.isArray(decision.position))throw new TypeError('기록된 매대·SKU 위치가 필요합니다.');
  const [x,,z]=decision.position,dx=x-fixture.x,dz=z-fixture.z;
  const localX=(dx*Math.cos(fixture.rotation)-dz*Math.sin(fixture.rotation))/fixture.scale;
  const desired=localToWorld(fixture,[localX,1.35]);
  if(navigation(mapId).isWalkable(...desired))return desired;
  const slots=mapStations(map)[fixture.station]?.slots??[];
  const nearest=slots.filter(point=>navigation(mapId).isWalkable(...point)).sort((a,b)=>distance(a,desired)-distance(b,desired))[0];
  if(!nearest)throw new Error('기록된 상품의 안전한 관찰 위치가 없습니다.');
  return [...nearest];
}

function makeTrack(result,visit,mapId){
  const map=getMap(mapId),phases=[],basket=[];let position=[...map.entry];
  const add=(state,path,duration,extra={})=>phases.push({state,path,duration,basket:[...basket],...extra});
  const walk=end=>{
    const path=pathTo(mapId,position,end),length=path.slice(1).reduce((sum,p,index)=>sum+distance(path[index],p),0);
    if(length>.01)add('walking',path,length/1.25);
    position=[...end];
  };
  // No new purchase is inferred here. A visit with no purchase may only browse
  // an SKU that its source record actually perceived, then exit without paying.
  const decisions=visit.decisions.length?visit.decisions:
    visit.visibleProductIds.slice(0,1).map(productId=>({...result.positions[productId],productId,outcome:'browsed'}));
  for(const decision of decisions){
    const point=viewingPoint(mapId,decision);walk(point);
    const facing=Math.atan2(decision.position[0]-point[0],decision.position[2]-point[1]);
    add('browsing',[point],1.1,{productId:decision.productId,heading:facing,reachLevel:decision.level});
    if(decision.outcome==='purchased'){
      add('reaching',[point],.9,{productId:decision.productId,heading:facing,reachLevel:decision.level});
      basket.push(decision.productId);
    }
  }
  if(visit.paidAmount>0){walk(checkoutPoint(map,visit.id%2));add('paying',[position],1.5);}
  walk(map.exit);
  if(!phases.length)add('idle',[position],1);
  let elapsed=0;
  for(const phase of phases){phase.start=elapsed;elapsed+=phase.duration;phase.end=elapsed;
    phase.length=phase.path.slice(1).reduce((sum,p,index)=>sum+distance(phase.path[index],p),0);}
  return {visit,phases,duration:elapsed};
}

function positionOn(path,amount,length){
  if(path.length===1||length===0)return {position:[...path[0]],heading:0};
  let remaining=clamp(amount,0,1)*length;
  for(let index=1;index<path.length;index++){
    const a=path[index-1],b=path[index],segment=distance(a,b);
    if(remaining<=segment||index===path.length-1){const t=segment?clamp(remaining/segment,0,1):0;return {position:a.map((v,i)=>v+(b[i]-v)*t),heading:Math.atan2(b[0]-a[0],b[1]-a[1])};}
    remaining-=segment;
  }
}

function visualAgent(track,time){
  const local=(time-track.start)/track.displayDuration*track.duration;if(local<0||local>=track.duration)return null;
  const phase=track.phases.find(item=>local<item.end)??track.phases.at(-1);
  const pose=positionOn(phase.path,(local-phase.start)/phase.duration,phase.length);
  // Position still follows the fast recorded track. Use a legible absolute
  // gait clock instead of feeding the rig the 28x world clock (which aliased
  // at normal display frame rates). This is deterministic on pause/seek/rebind.
  const gaitPhase=(Math.abs(Number(track.visit.id)||0)%17)/17;
  const presentationAnimationTime=phase.state==='walking'?(time-track.start)*2+gaitPhase:local-phase.start;
  return {id:track.visit.id,position:pose.position,heading:phase.heading??pose.heading,
    state:phase.state,stateTime:local-phase.start,reachLevel:phase.reachLevel??2,
    basket:phase.basket.map(id=>PRODUCT_MAP[id]),speed:1.25,velocity:phase.state==='walking'?1.25:0,
    sourceId:track.visit.sourceId,recordedHour:track.visit.hour,productId:phase.productId??null,
    recordedDay:track.visit.day,presentationOnly:true,presentationAnimationTime};
}

export const PERIOD_REPLAY_SECONDS=45;
const METRICS=['potential','revenue','profit','paidUnits','payments','entered','purchaseDemand','stockoutDemand','shelfGapDemand','totalStockoutDemand','replenishedUnits','receivedUnits','skipped'];
const emptyTotals=()=>Object.fromEntries(METRICS.map(key=>[key,0]));
const stockTotal=stock=>Object.values(stock).reduce((sum,value)=>sum+value,0);

function prepareLedger(result){
  if(result?.replay?.source!=='same-forecast-ledger'||!Array.isArray(result.daily)||!result.daily.length||!Array.isArray(result.replay.timeline)||!result.replay.timeline.length||!Array.isArray(result.replay.visits))throw new TypeError('동일 계산에서 생성한 기록만 재생할 수 있습니다.');
  const timeline=result.replay.timeline;
  let end=0,totals=emptyTotals();const checkpoints=[];
  for(const bin of timeline){
    if(!Number.isFinite(bin.startSecond)||!Number.isFinite(bin.endSecond)||bin.startSecond<end||bin.endSecond<=bin.startSecond||!bin.shelfStock||!bin.backroomStock)throw new TypeError('시간 구간과 재고가 유효한 기록이 필요합니다.');
    end=bin.endSecond;
    for(const key of METRICS){
      const value=key==='skipped'?(bin.skipped??bin.potential-bin.entered):(bin[key]??0);
      if(!Number.isFinite(value)||(key!=='profit'&&value<0))throw new TypeError('계산 기록의 수치는 유효해야 하며 수량·매출은 음수가 될 수 없습니다.');
      totals[key]+=value;
    }
    checkpoints.push({...totals});
  }
  const visits=new Map();
  for(const visit of result.replay.visits){
    if(visit.entered===false)continue;
    if(!Number.isInteger(visit.day)||visit.day<1||visit.day>result.daily.length||!Number.isFinite(visit.hour)||visit.hour<0||visit.hour>=24||!Array.isArray(visit.decisions)||!Array.isArray(visit.visibleProductIds))throw new TypeError('대표 방문의 날짜·상품 기록이 올바르지 않습니다.');
    if(!visits.has(visit.day))visits.set(visit.day,[]);
    visits.get(visit.day).push(visit);
  }
  for(const list of visits.values())list.sort((a,b)=>a.hour-b.hour||a.id-b.id);
  return {timeline,checkpoints,visits,end};
}

function completedIndex(timeline,second){
  let low=0,high=timeline.length;
  while(low<high){const mid=Math.floor((low+high)/2);if(timeline[mid].endSecond<=second+1e-7)low=mid+1;else high=mid;}
  return low-1;
}

/** One read-only clock for the entire period. Hourly records settle atomically;
 * there is no invented within-hour revenue, and 3D never makes new decisions. */
export function createLedgerReplay(entries,{day=1,duration=PERIOD_REPLAY_SECONDS}={}){
  if(!Array.isArray(entries)||!entries.length||!Number.isFinite(duration)||duration<=0)throw new TypeError('계산 기록과 유효한 재생 시간이 필요합니다.');
  const rows=entries.map(entry=>{
    const ledger=prepareLedger(entry.result);
    const world={mapId:entry.mapId,scenario:entry.result.scenario,runId:`ledger:${entry.id}`,time:0,agents:[],owner:null,
      stock:clone(entry.result.initialInventory.shelf),initialStock:clone(entry.result.initialInventory.shelf),backroomStock:clone(entry.result.initialInventory.backroom)};
    return {...entry,ledger,world,tracks:[],days:new Map(),checkpoint:null,checkpointIndex:-2,cumulative:emptyTotals(),dayCumulative:emptyTotals()};
  });
  const totalSeconds=rows[0].ledger.end,dayCount=rows[0].result.daily.length;
  if(rows.some(row=>row.ledger.end!==totalSeconds||row.result.daily.length!==dayCount)||new Set(rows.map(row=>row.id)).size!==rows.length)throw new TypeError('같은 기간의 고유한 비교 기록이 필요합니다.');
  const replay={day:1,dayCount,elapsed:0,duration,totalSeconds,simulatedSecond:0,progress:0,dayProgress:0,hour:0,speed:1,running:true,isComplete:false,worlds:new Map(rows.map(row=>[row.id,row.world]))};
  function tracksForDay(row,value){
    if(!row.days.has(value)){
      const available=row.ledger.visits.get(value)??[];
      const selected=available.length<=12?available:Array.from({length:12},(_,index)=>available[Math.round(index*(available.length-1)/11)]);
      const dayDuration=duration/dayCount;
      row.days.set(value,selected.map(visit=>{
        const track=makeTrack(row.result,visit,row.mapId);
        // A compressed display window is anchored to this recorded hour. It
        // can overlap nearby sampled visits but contributes no accounting.
        track.displayDuration=Math.min(dayDuration*.78,1.15);
        const second=(visit.day-1)*86400+(visit.hour+.5)*3600;
        const anchor=second/totalSeconds*duration;
        track.start=clamp(anchor-track.displayDuration*.45,0,Math.max(0,duration-track.displayDuration));
        return track;
      }));
    }
    return row.days.get(value);
  }
  function update(){
    replay.progress=clamp(replay.elapsed/replay.duration,0,1);replay.simulatedSecond=replay.progress*totalSeconds;
    // The same integer clock must select the day AND the closed ledger bin.
    // 11/30 * 30 days can otherwise land a fraction below day twelve.
    if(Math.abs(replay.simulatedSecond-Math.round(replay.simulatedSecond))<1e-7)replay.simulatedSecond=Math.round(replay.simulatedSecond);
    replay.isComplete=replay.progress===1;
    replay.day=Math.min(dayCount,Math.floor(replay.simulatedSecond/86400)+1);
    replay.dayProgress=replay.isComplete?1:(replay.simulatedSecond%86400)/86400;
    replay.hour=replay.isComplete?24:Math.floor(replay.dayProgress*24);
    for(const row of rows){
      const index=completedIndex(row.ledger.timeline,replay.simulatedSecond),checkpoint=row.ledger.timeline[index]??null;
      if(index!==row.checkpointIndex){
        row.checkpointIndex=index;row.checkpoint=checkpoint;
        row.cumulative={...(row.ledger.checkpoints[index]??emptyTotals())};
        row.world.stock=clone(checkpoint?.shelfStock??row.result.initialInventory.shelf);
        row.world.backroomStock=clone(checkpoint?.backroomStock??row.result.initialInventory.backroom);
      }
      const dayStart=completedIndex(row.ledger.timeline,(replay.day-1)*86400),prior=row.ledger.checkpoints[dayStart]??emptyTotals();
      row.dayCumulative=Object.fromEntries(METRICS.map(key=>[key,row.cumulative[key]-prior[key]]));
      row.world.time=replay.elapsed*28;row.world.day=replay.day;row.world.hour=replay.hour;
      row.world.cumulative={...row.cumulative};
      row.tracks=[replay.day-1,replay.day,replay.day+1].filter(value=>value>=1&&value<=dayCount).flatMap(value=>tracksForDay(row,value));
      row.world.agents=replay.isComplete||replay.elapsed===0?[]:row.tracks.map(track=>visualAgent(track,replay.elapsed)).filter(Boolean);
    }
  }
  replay.seek=progress=>{if(!Number.isFinite(progress)||progress<0||progress>1)throw new RangeError('재생 위치는 0~1입니다.');replay.elapsed=replay.duration*progress;update();return replay;};
  replay.seekDay=(value,progress=0)=>{
    if(!Number.isInteger(value)||value<1||value>dayCount||!Number.isFinite(progress)||progress<0||progress>1)throw new RangeError(`재생일은 1~${dayCount}일, 일자 내 위치는 0~1입니다.`);
    return replay.seek(clamp(((value-1+progress)*86400)/totalSeconds,0,1));
  };
  replay.setDay=value=>replay.seekDay(value);
  replay.setSpeed=value=>{if(![.5,1,2,4].includes(value))throw new RangeError('재생 배속은 0.5, 1, 2, 4입니다.');replay.speed=value;return replay;};
  replay.pause=()=>{replay.running=false;return replay;};
  replay.play=()=>{if(!replay.isComplete)replay.running=true;return replay;};
  // An explicit reset must stay visibly at zero until the user starts again.
  // Otherwise the next hourly bin arrives in ~60ms and looks like no reset.
  replay.restart=()=>{replay.pause();replay.seek(0);return replay;};
  replay.advance=seconds=>{if(!Number.isFinite(seconds)||seconds<0)throw new RangeError('시간 간격을 확인해주세요.');if(replay.running&&!replay.isComplete){const next=replay.elapsed+seconds*replay.speed;replay.elapsed=next>=replay.duration-1e-9?replay.duration:next;update();}return replay;};
  replay.getRow=id=>{const row=rows.find(item=>item.id===id);if(!row)throw new RangeError('없는 기록입니다.');return {
    day:row.result.daily[replay.day-1],sampleCount:tracksForDay(row,replay.day).length,
    checkpoint:row.checkpoint,completedBins:row.checkpointIndex+1,
    cumulative:{...row.cumulative},dayCumulative:{...row.dayCumulative},
    stock:{shelf:stockTotal(row.world.stock),backroom:stockTotal(row.world.backroomStock)},
    visits:row.tracks.map(track=>track.visit),dayVisits:tracksForDay(row,replay.day).map(track=>track.visit),world:row.world,
  };};
  replay.setDay(day);return replay;
}
