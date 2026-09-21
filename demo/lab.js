import { createWorld } from './world.js';
import { SCENARIOS } from './model.js';

// Synthetic cohorts, not observed data from the named neighbourhoods.
export const LAB_STORES = [
  {id:'samsung',name:'삼성역점',subtitle:'합성 오피스형',mapId:'office',seed:11,stockScale:1,profileWeights:[3,5,1,2,2]},
  {id:'station',name:'역세권 데모점',subtitle:'합성 세로형',mapId:'express',seed:29,stockScale:.85,profileWeights:[1,5,1,4,1]},
  {id:'residential',name:'주거지 데모점',subtitle:'합성 주거지형',mapId:'residential',seed:47,stockScale:1.2,profileWeights:[5,1,4,1,2]},
];
const REGIONAL_STORE_GROUPS = [
  {id:'everyday',name:'일상 상권 · 오피스 / 역세권 / 주거지',stores:LAB_STORES},
  {id:'destination',name:'목적 상권 · 한강 / 대학가 / 관광지',stores:[
    {id:'riverside',name:'한강변 데모점',subtitle:'합성 수변형',mapId:'riverside',seed:61,stockScale:1.3,profileWeights:[4,2,1,5,2]},
    {id:'university',name:'대학가 데모점',subtitle:'합성 캠퍼스형',mapId:'university',seed:73,stockScale:1.1,profileWeights:[1,2,1,8,2]},
    {id:'tourism',name:'관광지 데모점',subtitle:'합성 관광형',mapId:'tourism',seed:89,stockScale:1.25,profileWeights:[4,2,2,4,2]},
  ]},
  {id:'neighborhood',name:'생활 상권 · 골목 / 카페 / 공원',stores:[
    {id:'compact',name:'골목 데모점',subtitle:'합성 소형점',mapId:'compact',seed:101,stockScale:.75,profileWeights:[4,2,5,2,1]},
    {id:'cafe',name:'카페 데모점',subtitle:'합성 취식형',mapId:'cafe',seed:113,stockScale:1.1,profileWeights:[2,4,1,6,2]},
    {id:'park',name:'공원 데모점',subtitle:'합성 산책형',mapId:'park',seed:127,stockScale:1,profileWeights:[4,1,4,2,6]},
  ]},
];
export const STORE_CATALOG=REGIONAL_STORE_GROUPS.flatMap(group=>group.stores);
export const STORE_GROUPS=[
  {id:'all',name:'전체 합성 점포 · 9개 상권',stores:STORE_CATALOG},
  ...REGIONAL_STORE_GROUPS,
];
export const SPEEDS = [1,4,16,32,64,128,300,900,1800];
export const SIMULATION_STEP = .05;

/** One clock owns every spatial world, including stores outside the visible page. */
export function createLab({limit=1000,speed=4,storeGroup='all',mode='day',duration=86400}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>10000)throw new RangeError('잠재 고객 수는 1~10,000 사이 정수여야 합니다.');
  if(!['day','visits'].includes(mode))throw new RangeError('지원하지 않는 실험 방식입니다.');
  if(!Number.isFinite(duration)||duration<=0||duration>86400)throw new RangeError('실험 기간은 0초 초과, 24시간 이하여야 합니다.');
  if(!SPEEDS.includes(speed))throw new RangeError('지원하지 않는 배속입니다.');
  if(!STORE_GROUPS.some(group=>group.id===storeGroup))throw new RangeError('알 수 없는 매장 조합입니다.');
  const sessionId=globalThis.crypto?.randomUUID?.()??String(Date.now());
  let generation=0,ticks=0,backlog=0,measurementReal=0,measurementSim=0;
  const lab={runs:[],storeGroup,stores:STORE_GROUPS.find(group=>group.id===storeGroup).stores,selectedId:null,running:false,speed,effectiveSpeed:0,time:0,mode,duration,limit};
  lab.selectedId=lab.stores[0].id+':hq';

  function makeRuns(){
    return lab.stores.flatMap(store=>Object.keys(SCENARIOS).map(scenario=>{
      const id=store.id+':'+scenario;
      return {id,store,scenario,status:'ready',error:null,world:createWorld({
        limit,mode,duration,population:limit,scenario,mapId:store.mapId,storeId:store.id,seed:store.seed,
        stockScale:store.stockScale,profileWeights:store.profileWeights,
        runId:sessionId+':'+generation+':'+id,
      })};
    }));
  }
  lab.runs=makeRuns();
  const unfinished=run=>!['complete','failed'].includes(run.status);
  function setRunStates(state){for(const run of lab.runs)if(unfinished(run))run.status=state;}
  lab.getSelected=()=>lab.runs.find(run=>run.id===lab.selectedId);
  lab.select=id=>{
    if(!lab.runs.some(run=>run.id===id))throw new RangeError('알 수 없는 점포·후보입니다.');
    lab.selectedId=id;return lab.getSelected();
  };
  lab.start=({reset=false}={})=>{
    if(reset)lab.reset();
    if(!lab.runs.some(unfinished))return;
    lab.running=true;setRunStates('running');
  };
  lab.resume=()=>lab.start();
  lab.pause=()=>{
    lab.running=false;backlog=0;lab.effectiveSpeed=0;measurementReal=measurementSim=0;
    setRunStates('paused');
  };
  lab.setSpeed=value=>{
    if(!SPEEDS.includes(value))throw new RangeError('지원하지 않는 배속입니다.');
    lab.speed=value;backlog=0;measurementReal=measurementSim=0;lab.effectiveSpeed=0;
  };
  lab.reset=()=>{
    generation++;ticks=0;backlog=0;measurementReal=measurementSim=0;
    lab.time=0;lab.running=false;lab.effectiveSpeed=0;lab.runs=makeRuns();
  };
  lab.setStoreGroup=id=>{
    const group=STORE_GROUPS.find(group=>group.id===id);
    if(!group)throw new RangeError('알 수 없는 매장 조합입니다.');
    lab.storeGroup=id;lab.stores=group.stores;lab.selectedId=group.stores[0].id+':hq';
    lab.reset();return lab.stores;
  };
  lab.advance=(realSeconds,{budgetMs=10}={})=>{
    if(!Number.isFinite(realSeconds)||realSeconds<0)throw new RangeError('시간 간격은 유한한 0 이상의 수여야 합니다.');
    if(!(budgetMs>0))throw new RangeError('계산 시간 예산은 양수여야 합니다.');
    if(!lab.running)return {simulatedDelta:0,steps:0};
    backlog+=realSeconds*lab.speed;
    const start=performance.now();let steps=0,simulatedDelta=0;
    while(backlog+1e-9>=Math.min(SIMULATION_STEP,mode==='day'?duration-lab.time:SIMULATION_STEP)){
      // Every unfinished candidate reaches the same tick before yielding to render.
      // A frame budget slows the whole simulation; it never lets counters outrun 3D.
      if(steps>0&&performance.now()-start>=budgetMs)break;
      let step=mode==='day'?Math.min(SIMULATION_STEP,duration-lab.time):SIMULATION_STEP;
      if(step<=1e-9)break;
      const activeRuns=lab.runs.filter(unfinished);
      // Empty stores may jump together only to their next actual scheduled event.
      // No actor motion, stock transfer or payment is skipped by this optimization.
      if(mode==='day'&&activeRuns.length&&activeRuns.every(run=>run.world.isQuiescent?.())){
        const next=Math.min(...activeRuns.map(run=>Math.max(0,run.world.nextBoundary()-run.world.time)));
        const available=Math.min(backlog,next,duration-lab.time);
        step=Math.max(step,Math.floor((available+1e-9)/SIMULATION_STEP)*SIMULATION_STEP);
      }
      for(const run of activeRuns){
        if(!unfinished(run))continue;
        try{
          run.world.update(step);
          const complete=mode==='day'?run.world.isComplete:run.world.completed>=limit&&run.world.agents.every(a=>a.state==='done');
          if(complete){
            run.world.agents=run.world.agents.filter(a=>a.state!=='done');
            run.status='complete';
          }
        }catch(error){run.status='failed';run.error=String(error.message||error);}
      }
      ticks+=Math.round(step/SIMULATION_STEP);steps++;simulatedDelta+=step;backlog=Math.max(0,backlog-step);
      lab.time=mode==='day'&&lab.time+step>=duration-1e-9?duration:ticks*SIMULATION_STEP;
      if(!lab.runs.some(unfinished)){lab.running=false;backlog=0;break;}
    }
    measurementReal+=realSeconds;measurementSim+=simulatedDelta;
    if(measurementReal>=.5){lab.effectiveSpeed=measurementSim/measurementReal;measurementReal=measurementSim=0;}
    if(!lab.running)lab.effectiveSpeed=0;
    return {simulatedDelta,steps};
  };
  lab.snapshot=()=>({
    storeGroup:lab.storeGroup,mode,duration,
    time:lab.time,running:lab.running,speed:lab.speed,effectiveSpeed:lab.effectiveSpeed,
    backlog,completed:lab.runs.filter(r=>r.status==='complete').length,total:lab.runs.length,
    selectedId:lab.selectedId,limit,
    runs:lab.runs.map(run=>({id:run.id,store:run.store,scenario:run.scenario,status:run.status,error:run.error,...run.world.snapshot({detail:false})})),
  });
  return lab;
}
