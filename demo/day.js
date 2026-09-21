import { PROFILES, PRODUCTS, PRODUCT_MAP, randomAt } from './model.js';

// Authored daily shapes, not measured GS25 footfall or fitted demand coefficients.
const office=[.14,.08,.05,.04,.07,.24,.65,1.7,2.0,1.05,.85,1.55,2.2,1.3,1,.95,1.2,1.9,1.65,1.1,.85,.6,.4,.25];
const residential=[.3,.2,.12,.08,.1,.22,.6,1.05,1.1,.85,.9,1.2,1.4,1.1,1.05,1.15,1.4,1.65,1.8,1.65,1.5,1.1,.7,.45];
const leisure=[.18,.1,.06,.04,.05,.12,.25,.45,.7,1.05,1.25,1.5,1.7,1.65,1.6,1.6,1.55,1.6,1.65,1.55,1.2,.8,.5,.3];
export const HOURLY_PROFILES=Object.freeze(Object.fromEntries(['office','compact','express','residential','cafe','riverside','university','tourism','park'].map(id=>[id,Object.freeze([...(id==='office'||id==='express'?office:id==='residential'||id==='compact'?residential:leisure)])])));
export const DAILY_EVENTS=Object.freeze([
  {id:'day-rain',name:'퇴근 시간 비 가정',start:17*3600,end:18*3600,arrivalMultiplier:.84,categoryMultipliers:{meal:1.3,drink:.88}},
  {id:'day-fireworks',name:'저녁 불꽃 행사 가정',start:19*3600,end:21*3600,maps:['riverside','tourism','park'],arrivalMultiplier:1.35,categoryMultipliers:{snack:1.35,drink:1.30}},
  {id:'day-campus-festival',name:'오후 대학 축제 가정',start:14*3600,end:18*3600,maps:['university'],arrivalMultiplier:1.35,categoryMultipliers:{snack:1.35,meal:1.18,drink:1.18}},
  {id:'day-viral-trend',name:'신상품 관심 가정',start:10*3600,end:20*3600,arrivalMultiplier:1.05,categoryMultipliers:{health:1.12,snack:1.1},productBoosts:{proteinbar:.10,gummy:.08}},
].map(e=>Object.freeze({...e,source:'authored-daily-assumption',status:'assumed',confidence:.25,description:'실측·일기예보·실제 행사 일정이 아닌 하루 시나리오 가정'})));
export const dailyEventsFor=mapId=>DAILY_EVENTS.filter(e=>!e.maps||e.maps.includes(mapId));

export function createDayPlan({population=1000,duration=86400,seed=42,mapId='office',profileWeights=PROFILES.map(()=>1),eventSchedule=[],entryProbability,personaCatalog}={}){
  if(!Number.isSafeInteger(population)||population<0)throw new RangeError('population must be a nonnegative integer');
  if(!Number.isFinite(duration)||duration<=0)throw new RangeError('duration must be positive finite seconds');
  if(entryProbability!==undefined&&(!Number.isFinite(entryProbability)||entryProbability<0||entryProbability>1))throw new RangeError('entryProbability must be between 0 and 1');
  const hourly=HOURLY_PROFILES[mapId]??HOURLY_PROFILES.office;
  const bounds=[...new Set([0,duration,...Array.from({length:23},(_,i)=>(i+1)*duration/24),...eventSchedule.flatMap(e=>[e.start,e.end]).filter(t=>t>0&&t<duration)])].sort((a,b)=>a-b);
  let total=0;
  const segments=bounds.slice(0,-1).map((start,i)=>{
    const end=bounds[i+1],middle=(start+end)/2,hour=Math.min(23,Math.floor(middle/duration*24));
    const multiplier=eventSchedule.filter(e=>middle>=e.start&&middle<e.end).reduce((v,e)=>v*(e.mapArrivalMultipliers?.[mapId]??e.arrivalMultiplier??1),1);
    const weight=(end-start)*hourly[hour]*Math.max(.5,Math.min(2,multiplier));total+=weight;
    return {start,end,weight,cumulative:total};
  });
  const weightTotal=profileWeights.reduce((sum,value)=>sum+value,0);
  if(personaCatalog&&(!Array.isArray(personaCatalog)||personaCatalog.length<population))throw new RangeError('Unique persona catalog must cover the entire potential cohort');
  // A seeded permutation, not sampling the same five templates with replacement.
  // This is a convenience sample of synthetic records, not fitted local demographics.
  const personaOrder=personaCatalog?.map((_,index)=>index).sort((a,b)=>randomAt(a,8010,seed)-randomAt(b,8010,seed)||a-b);
  return Array.from({length:population},(_,id)=>{
    const personaIndex=personaOrder?.[id],persona=personaIndex===undefined?null:personaCatalog[personaIndex];
    let personTotal=0;
    const personSegments=persona?segments.map(segment=>{
      const hour=Math.min(23,Math.floor((segment.start+segment.end)/2/duration*24));
      const factor=Math.max(.05,Math.min(3,persona.schedule?.hourlyWeights?.[hour]??1));
      const weight=segment.weight*factor;personTotal+=weight;
      return {...segment,weight,cumulative:personTotal};
    }):segments;
    // Stratification keeps exactly population potential people while seeded jitter
    // and all exogenous random values remain independent of the candidate layout.
    const quantile=(id+randomAt(id,8000,seed))/Math.max(1,population),target=quantile*(persona?personTotal:total);
    const segment=personSegments.find(s=>target<s.cumulative)??personSegments.at(-1);
    const rawTime=segment.start+(target-(segment.cumulative-segment.weight))/segment.weight*(segment.end-segment.start);
    const time=Math.min(duration,Math.max(Math.min(.05,duration),Math.ceil(rawTime*20-1e-8)/20));
    let sample=randomAt(id,1,seed)*weightTotal,profileIndex=profileWeights.length-1;
    for(let i=0;i<profileWeights.length;i++){sample-=profileWeights[i];if(sample<0){profileIndex=i;break;}}
    if(personaIndex!==undefined)profileIndex=personaCatalog[personaIndex].archetypeIndex??0;
    const hour=Math.min(23,Math.floor(time/duration*24));
    const needProbability=entryProbability??Math.max(.3,Math.min(.84,.54+(hourly[hour]-1)*.08+(persona?0:profileIndex===1?.07:profileIndex===4?-.06:0)));
    return Object.freeze({id,time,profileIndex,personaIndex,personaSourceId:personaIndex===undefined?null:personaCatalog[personaIndex].source.id,entryDraw:randomAt(id,8001,seed),needProbability,hour,source:'seeded-daily-assumption'});
  }).sort((a,b)=>a.time-b.time||a.id-b.id);
}

const quantityMap=(value,label)=>{
  if(value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([id,n])=>!Object.hasOwn(PRODUCT_MAP,id)||!Number.isSafeInteger(n)||n<0))throw new TypeError(label+' must map known product ids to nonnegative integer quantities');
};
export function splitDayInventory({stock,totalStock,shelfStock,backroomStock,shelfCapacity,stockScale=1}={}){
  for(const [name,value] of Object.entries({stock,totalStock,shelfStock,backroomStock}))quantityMap(value,name);
  if(shelfCapacity!==undefined&&typeof shelfCapacity!=='number')quantityMap(shelfCapacity,'shelfCapacity');
  if(typeof shelfCapacity==='number'&&(!Number.isSafeInteger(shelfCapacity)||shelfCapacity<0))throw new RangeError('shelfCapacity must be a nonnegative integer or SKU map');
  const result={shelf:{},backroom:{},capacity:{},total:{}};
  PRODUCTS.forEach((p,index)=>{
    const cap=typeof shelfCapacity==='number'?shelfCapacity:shelfCapacity?.[p.id]??8+index%11;
    const explicitTotal=totalStock?.[p.id]??stock?.[p.id];
    let total=explicitTotal??Math.floor(p.stock*stockScale),shelf=shelfStock?.[p.id],backroom=backroomStock?.[p.id];
    if(shelf!==undefined&&backroom!==undefined){
      if(explicitTotal!==undefined&&shelf+backroom!==explicitTotal)throw new RangeError('Initial shelf + backroom must equal total for '+p.id);
      total=shelf+backroom;
    }else if(shelf!==undefined){backroom=total-shelf;}
    else if(backroom!==undefined){shelf=Math.min(cap,Math.max(0,total-backroom));if(explicitTotal===undefined)total=shelf+backroom;}
    else {shelf=Math.min(cap,total);backroom=total-shelf;}
    if(!Number.isSafeInteger(total)||shelf<0||backroom<0||shelf>cap||shelf+backroom!==total)throw new RangeError('Invalid initial inventory split for '+p.id);
    result.shelf[p.id]=shelf;result.backroom[p.id]=backroom;result.capacity[p.id]=cap;result.total[p.id]=total;
  });
  return result;
}

export function createDayStats(duration,potentialTotal){
  const counters=()=>({considered:0,entered:0,skipped:0,skippedReasons:{'not-needed':0,closed:0,crowded:0},buyers:0,completed:0,closedWithoutPurchase:0,paidUnits:0,paidRevenue:0,shelfGapDemand:0,totalStockoutDemand:0});
  return {duration,potentialTotal,...counters(),inStore:0,progress:0,hourly:Array.from({length:24},(_,hour)=>({hour,start:hour*duration/24,end:(hour+1)*duration/24,...counters()})),source:'authored-daily-assumption',calendarDate:null};
}
