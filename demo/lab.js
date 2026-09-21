import { createWorld } from './world.js';
import { SCENARIOS } from './model.js';

// Synthetic cohorts, not observed data from the named neighbourhoods.
export const LAB_STORES = [
  {id:'samsung',name:'삼성역점',subtitle:'합성 오피스형',mapId:'office',seed:11,stockScale:1,profileWeights:[3,5,1,2,2]},
  {id:'station',name:'역세권 데모점',subtitle:'합성 세로형',mapId:'express',seed:29,stockScale:.85,profileWeights:[1,5,1,4,1]},
  {id:'residential',name:'주거지 데모점',subtitle:'합성 주거지형',mapId:'residential',seed:47,stockScale:1.2,profileWeights:[5,1,4,1,2]},
];
export const SPEEDS = [1,4,16,32,64,128];
export const SIMULATION_STEP = .05;

/** One clock owns all nine actual spatial worlds. No independent batch counter. */
export function createLab({limit=1000,speed=32}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>10000)throw new RangeError('방문 수는 1~10,000 사이 정수여야 합니다.');
  if(!SPEEDS.includes(speed))throw new RangeError('지원하지 않는 배속입니다.');
  const sessionId=globalThis.crypto?.randomUUID?.()??String(Date.now());
  let generation=0,ticks=0,backlog=0,measurementReal=0,measurementSim=0;
  const lab={runs:[],selectedId:'samsung:hq',running:false,speed,effectiveSpeed:0,time:0};

  function makeRuns(){
    return LAB_STORES.flatMap(store=>Object.keys(SCENARIOS).map(scenario=>{
      const id=store.id+':'+scenario;
      return {id,store,scenario,status:'ready',error:null,world:createWorld({
        limit,scenario,mapId:store.mapId,storeId:store.id,seed:store.seed,
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
  lab.advance=(realSeconds,{budgetMs=10}={})=>{
    if(!Number.isFinite(realSeconds)||realSeconds<0)throw new RangeError('시간 간격은 유한한 0 이상의 수여야 합니다.');
    if(!(budgetMs>0))throw new RangeError('계산 시간 예산은 양수여야 합니다.');
    if(!lab.running)return {simulatedDelta:0,steps:0};
    backlog+=realSeconds*lab.speed;
    const start=performance.now();let steps=0;
    while(backlog+1e-9>=SIMULATION_STEP){
      // Every unfinished candidate reaches the same tick before yielding to render.
      // A frame budget slows the whole simulation; it never lets counters outrun 3D.
      if(steps>0&&performance.now()-start>=budgetMs)break;
      for(const run of lab.runs){
        if(!unfinished(run))continue;
        try{
          run.world.update(SIMULATION_STEP);
          if(run.world.completed>=limit&&run.world.agents.every(a=>a.state==='done')){
            run.world.agents=run.world.agents.filter(a=>a.state!=='done');
            run.status='complete';
          }
        }catch(error){run.status='failed';run.error=String(error.message||error);}
      }
      ticks++;steps++;backlog=Math.max(0,backlog-SIMULATION_STEP);lab.time=ticks*SIMULATION_STEP;
      if(!lab.runs.some(unfinished)){lab.running=false;backlog=0;break;}
    }
    const simulatedDelta=steps*SIMULATION_STEP;
    measurementReal+=realSeconds;measurementSim+=simulatedDelta;
    if(measurementReal>=.5){lab.effectiveSpeed=measurementSim/measurementReal;measurementReal=measurementSim=0;}
    if(!lab.running)lab.effectiveSpeed=0;
    return {simulatedDelta,steps};
  };
  lab.snapshot=()=>({
    time:lab.time,running:lab.running,speed:lab.speed,effectiveSpeed:lab.effectiveSpeed,
    backlog,completed:lab.runs.filter(r=>r.status==='complete').length,total:lab.runs.length,
    selectedId:lab.selectedId,limit,
    runs:lab.runs.map(run=>({id:run.id,store:run.store,scenario:run.scenario,status:run.status,error:run.error,...run.world.snapshot()})),
  });
  return lab;
}
