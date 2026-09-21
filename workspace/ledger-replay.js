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
  const local=time-track.start;if(local<0||local>=track.duration)return null;
  const phase=track.phases.find(item=>local<item.end)??track.phases.at(-1);
  const pose=positionOn(phase.path,(local-phase.start)/phase.duration,phase.length);
  return {id:track.visit.id,position:pose.position,heading:phase.heading??pose.heading,
    state:phase.state,stateTime:local-phase.start,reachLevel:phase.reachLevel??2,
    basket:phase.basket.map(id=>PRODUCT_MAP[id]),speed:1.25,velocity:phase.state==='walking'?1.25:0,
    sourceId:track.visit.sourceId,recordedHour:track.visit.hour,productId:phase.productId??null,
    presentationOnly:true};
}

/** Read-only view of the same forecast ledger; never evaluates a new decision. */
export function createLedgerReplay(entries,{day=1,duration=48}={}){
  if(!Array.isArray(entries)||!entries.length||!Number.isFinite(duration)||duration<=0)throw new TypeError('계산 기록과 유효한 재생 시간이 필요합니다.');
  const rows=entries.map(entry=>{
    if(entry.result?.replay?.source!=='same-forecast-ledger')throw new TypeError('동일 계산에서 생성한 기록만 재생할 수 있습니다.');
    const world={mapId:entry.mapId,scenario:entry.result.scenario,runId:`ledger:${entry.id}`,time:0,agents:[],owner:null,
      stock:clone(entry.result.initialInventory.shelf),initialStock:clone(entry.result.initialInventory.shelf),backroomStock:clone(entry.result.initialInventory.backroom)};
    return {...entry,world,tracks:[],days:new Map(),checkpoint:null};
  });
  const replay={day:1,elapsed:0,duration,progress:0,hour:0,speed:1,running:true,isComplete:false,worlds:new Map(rows.map(row=>[row.id,row.world]))};
  function update(){
    replay.progress=clamp(replay.elapsed/replay.duration,0,1);replay.hour=Math.min(23,Math.floor(replay.progress*24));
    replay.isComplete=replay.progress===1;
    for(const row of rows){
      const bins=row.result.replay.timeline.filter(bin=>bin.day===replay.day);
      const completedHours=Math.floor(replay.progress*24),checkpoint=bins[completedHours-1];
      if(checkpoint!==row.checkpoint){
        row.checkpoint=checkpoint;
        const prior=replay.day===1?null:row.result.daily[replay.day-2];
        row.world.stock=clone(checkpoint?.shelfStock??prior?.shelfStock??row.result.initialInventory.shelf);
        row.world.backroomStock=clone(checkpoint?.backroomStock??prior?.backroomStock??row.result.initialInventory.backroom);
      }
      row.world.time=replay.elapsed;row.world.day=replay.day;
      row.world.agents=replay.isComplete?[]:row.tracks.map(track=>visualAgent(track,replay.elapsed)).filter(Boolean);
    }
  }
  replay.setDay=value=>{
    if(!Number.isInteger(value)||value<1||value>30)throw new RangeError('재생일은 1~30일입니다.');
    replay.day=value;replay.elapsed=0;replay.isComplete=false;
    let longest=duration;
    for(const row of rows){
      if(!row.days.has(value)){
        const available=row.result.replay.visits.filter(visit=>visit.day===value);
        const selected=available.length<=12?available:Array.from({length:12},(_,index)=>available[Math.round(index*(available.length-1)/11)]);
        row.days.set(value,selected.map(visit=>makeTrack(row.result,visit,row.mapId)));
      }
      row.tracks=row.days.get(value);row.checkpoint=null;
      longest=Math.max(longest,...row.tracks.map(track=>track.duration+8));
    }
    replay.duration=longest;
    for(const row of rows)row.tracks.forEach((track,index)=>{track.start=row.tracks.length<=1?0:index/(row.tracks.length-1)*(replay.duration-track.duration);});
    update();return replay;
  };
  replay.seek=progress=>{if(!Number.isFinite(progress)||progress<0||progress>1)throw new RangeError('재생 위치는 0~1입니다.');replay.elapsed=replay.duration*progress;update();return replay;};
  replay.setSpeed=value=>{if(![.5,1,2].includes(value))throw new RangeError('재생 배속은 0.5, 1, 2입니다.');replay.speed=value;return replay;};
  replay.advance=seconds=>{if(!Number.isFinite(seconds)||seconds<0)throw new RangeError('시간 간격을 확인해주세요.');if(replay.running&&!replay.isComplete){replay.elapsed=Math.min(replay.duration,replay.elapsed+seconds*replay.speed);update();}return replay;};
  replay.getRow=id=>{const row=rows.find(item=>item.id===id);if(!row)throw new RangeError('없는 기록입니다.');return {day:row.result.daily[replay.day-1],sampleCount:row.tracks.length,checkpoint:row.checkpoint,visits:row.tracks.map(track=>track.visit),world:row.world};};
  replay.setDay(day);return replay;
}
