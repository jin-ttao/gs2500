import { PROFILES, PRODUCTS, PRODUCT_MAP, SCENARIOS, randomAt } from './model.js';

import { getMap, mapStations, checkoutPoint } from './maps.js';
import { createNavigation } from './navigation.js';
import { ENGINE, PROVENANCE, EXOGENOUS_EVENTS, buildDecisionContext, decideLocally, getActiveEvents, eventModifiers, freezeRecord } from './context.js';
import { createDayPlan, createDayStats, dailyEventsFor, splitDayInventory } from './day.js';

const defaultNavigation=createNavigation();
export const OBSTACLES=defaultNavigation.obstacles;
export const STATIONS=mapStations(getMap());
export const {isWalkable,findPath}=defaultNavigation;
export const STATE_NAMES={walking:'이동',browsing:'상품 비교',reaching:'상품 집기',queue:'계산 대기',paying:'결제',exiting:'퇴장',done:'방문 완료'};
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
// Authored demo assumptions: these are not measured shelf effects or supplier costs.
const COST_RATIO={meal:.71,drink:.64,snack:.62,health:.68};
const PROFILE_WEIGHTS={office:[.16,.38,.12,.16,.18],compact:[.25,.13,.30,.22,.10],express:[.10,.43,.10,.24,.13],residential:[.35,.10,.30,.15,.10],cafe:[.16,.24,.12,.36,.12]};
const storeSeed=id=>[...String(id)].reduce((seed,char)=>Math.imul(seed,31)+char.charCodeAt(0)>>>0,42);

export function createWorld({mode='visits',limit=1000,population,duration=86400,maxActive,scenario='hq',mapId='office',storeId=mapId,seed=storeSeed(storeId),runId='run-1',stockScale=1,stock,totalStock,shelfStock,backroomStock,shelfCapacity,entryProbability,openingHours=[[0,24]],replenishment={},profileWeights=PROFILE_WEIGHTS[mapId]??[1,1,1,1,1],eventSchedule}={}) {
  if(!['visits','day'].includes(mode))throw new RangeError('mode must be visits or day');
  if(population!==undefined&&(!Number.isSafeInteger(population)||population<0))throw new RangeError('population must be a nonnegative integer');
  if(mode==='day')limit=population??limit;
  if(!Number.isFinite(duration)||duration<=0)throw new RangeError('duration must be positive finite seconds');
  eventSchedule??=mode==='day'?dailyEventsFor(mapId):EXOGENOUS_EVENTS;
  if(!Number.isSafeInteger(limit)||limit<0)throw new RangeError('limit must be a nonnegative integer');
  if(!Object.hasOwn(SCENARIOS,scenario))throw new Error('Unknown shelf scenario: '+scenario);
  if(typeof storeId!=='string'||!storeId.trim())throw new TypeError('storeId must be a nonempty string');
  if(typeof runId!=='string'||!runId.trim())throw new TypeError('runId must be a nonempty string');
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('seed must be a uint32 integer');
  if(!Number.isFinite(stockScale)||stockScale<0)throw new RangeError('stockScale must be a nonnegative finite number');
  if(!Array.isArray(profileWeights)||profileWeights.length!==PROFILES.length||profileWeights.some(n=>!Number.isFinite(n)||n<0)||!Number.isFinite(profileWeights.reduce((s,n)=>s+n,0))||!profileWeights.some(n=>n>0))throw new TypeError('profileWeights must contain five nonnegative finite weights with a positive total');
  if(stock!==undefined&&(stock===null||typeof stock!=='object'||Array.isArray(stock)||Object.entries(stock).some(([id,n])=>!Object.hasOwn(PRODUCT_MAP,id)||!Number.isSafeInteger(n)||n<0)))throw new TypeError('stock must map known product ids to nonnegative integer quantities');
  if(!Array.isArray(openingHours)||openingHours.some(row=>!Array.isArray(row)||row.length!==2||!row.every(Number.isFinite)||row[0]<0||row[1]>24||row[1]<=row[0]))throw new TypeError('openingHours must contain [startHour,endHour] intervals within 0..24');
  if(!replenishment||typeof replenishment!=='object'||Array.isArray(replenishment))throw new TypeError('replenishment must be a configuration object');
  const workerConfig={enabled:true,speed:1.1,serviceSeconds:6,threshold:.35,...replenishment};
  if(typeof workerConfig.enabled!=='boolean'||!Number.isFinite(workerConfig.speed)||workerConfig.speed<=0||!Number.isFinite(workerConfig.serviceSeconds)||workerConfig.serviceSeconds<=0||!Number.isFinite(workerConfig.threshold)||workerConfig.threshold<0||workerConfig.threshold>1)throw new RangeError('Invalid replenishment speed, serviceSeconds, threshold or enabled');
  if(!Array.isArray(eventSchedule)||new Set(eventSchedule.map(e=>e?.id)).size!==eventSchedule.length||eventSchedule.some(e=>!e||typeof e.id!=='string'||!e.id||!Number.isFinite(e.start)||e.start<0||!Number.isFinite(e.end)||e.end<=e.start||(e.arrivalMultiplier!==undefined&&(!Number.isFinite(e.arrivalMultiplier)||e.arrivalMultiplier<=0))||Object.entries(e.categoryMultipliers??{}).some(([category,value])=>!['meal','drink','snack','health'].includes(category)||!Number.isFinite(value)||value<=0)))throw new TypeError('eventSchedule requires unique event ids, finite increasing start/end and positive multipliers');
  const map=getMap(mapId),STATIONS=mapStations(map);
  const {findPath,isWalkable}=createNavigation(map);
  if(maxActive!==undefined&&(!Number.isSafeInteger(maxActive)||maxActive<1))throw new RangeError('maxActive must be a positive integer');
  maxActive=Math.min(maxActive??map.maxActive,map.maxActive);
  const inventory=mode==='day'?splitDayInventory({stock,totalStock,shelfStock,backroomStock,shelfCapacity,stockScale}):null;
  const initialStock=inventory?.shelf??Object.fromEntries(PRODUCTS.map(p=>[p.id,stock?.[p.id]??Math.floor(p.stock*stockScale)]));
  if(Object.values(initialStock).some(n=>!Number.isSafeInteger(n)))throw new RangeError('Scaled stock must contain safe integer quantities');
  const costs=Object.fromEntries(PRODUCTS.map(p=>[p.id,Math.round(p.price*COST_RATIO[p.category]/10)*10]));
  const weights=[...profileWeights],weightTotal=weights.reduce((s,n)=>s+n,0);
  const random=(id,feature)=>randomAt(id,feature,seed);
  const world={mode,time:0,spawned:0,completed:0,agents:[],history:[],queue:[],scenario,mapId,storeId,seed,runId,stations:STATIONS,totalTravel:0,totalVisitTime:0,
    initialStock,stock:{...initialStock},costs,paidRevenue:0,paidGrossProfit:0,paidUnits:0,buyers:0,decisions:0,purchaseDemand:0,stockoutDemand:0,missedDemand:0,
    levels:Array.from({length:4},(_,i)=>({level:i+1,exposure:0,notice:0,pick:0})),profileCounts:PROFILES.map(()=>0),profileWeights:weights,events:[],nextArrival:0,limit,maxActive,
    engine:ENGINE,lastDecision:null,eventSchedule:freezeRecord(JSON.parse(JSON.stringify(eventSchedule))),activeEvents:[],ledgerCount:0,replenishmentEvents:[],
    day:mode==='day'?createDayStats(duration,limit):null,isComplete:mode==='visits'&&limit===0,
    initialTotalStock:{...(inventory?.total??initialStock)},backroomStock:inventory?.backroom??Object.fromEntries(PRODUCTS.map(p=>[p.id,0])),shelfCapacity:inventory?.capacity??{...initialStock},
    paidUnitsBySKU:Object.fromEntries(PRODUCTS.map(p=>[p.id,0])),returnedUnitsBySKU:Object.fromEntries(PRODUCTS.map(p=>[p.id,0])),shelfGapDemand:0,totalStockoutDemand:0,replenishments:0,replenishedUnits:0,owner:null};
  world.shelfStock=world.stock;
  world.potentialSchedule=mode==='day'?Object.freeze(createDayPlan({population:limit,duration,seed,mapId,profileWeights,eventSchedule:world.eventSchedule,entryProbability})):null;
  let potentialIndex=0,dayRequestedTime=0,dayTimeError=0,dayTick=0;
  if(mode==='day'){
    const desired=[map.width/2-.8,-map.depth/2+2.2];
    let depot=workerConfig.depot;
    if(depot!==undefined&&(!Array.isArray(depot)||depot.length!==2||!depot.every(Number.isFinite)||!isWalkable(...depot)))throw new RangeError('Replenishment depot must be a walkable [x,z] point');
    if(!depot){
      const points=[];
      for(let x=-map.width/2+.6;x<map.width/2-.5;x+=.2)for(let z=-map.depth/2+.6;z<map.depth/2-.5;z+=.2)if(isWalkable(x,z))points.push([x,z]);
      points.sort((a,b)=>distance(a,desired)-distance(b,desired));depot=points.find(p=>findPath(p,STATIONS.promo.slots[0]).length);
    }
    if(!depot)throw new Error('No reachable replenishment depot');
    world.owner={id:'stock-owner',profileIndex:1,role:'stock-worker',state:'idle',position:[...depot],depot:[...depot],heading:0,speed:workerConfig.speed,velocity:0,stateTime:0,stateStartedAt:0,productId:null,quantity:0,completedTasks:0,reachLevel:2,station:null,path:[],pathIndex:0,enabled:workerConfig.enabled,source:'authored-two-role-staffing-assumption'};
  }
  const ledger=[],startedEvents=new Set(),endedEvents=new Set();let nextIssueAt=0;
  const newWindow=()=>({arrivals:0,paidUnits:0,paidRevenue:0,paymentCount:0,skuPaidUnits:{}});
  const analytics={totals:{arrivals:0,exposures:0,notices:0,picks:0,stockouts:0,paidUnits:0,paidRevenue:0,paidGrossProfit:0,payments:0},
    sku:Object.fromEntries(PRODUCTS.map(p=>[p.id,{exposures:0,notices:0,picks:0,stockouts:0,paidUnits:0,paidRevenue:0,paidGrossProfit:0}])),windows:[],
    eventComparisons:world.eventSchedule.map(e=>({eventId:e.id,before:newWindow(),during:newWindow(),after:newWindow()}))};
  let nextEventId=0;
  const dayHour=()=>Math.min(23,Math.floor(world.time/duration*24));
  function bumpDay(key,amount=1){if(world.day){world.day[key]+=amount;world.day.hourly[dayHour()][key]+=amount;}}
  function log(a,message){a.memory.unshift({time:world.time,message});a.memory.length=Math.min(a.memory.length,6);}
  function event(a,type,details={}){
    const record=freezeRecord({id:nextEventId++,type,time:world.time,runId,agentId:a?.id??null,profileIndex:a?.profileIndex??null,station:a?.station??null,productId:null,amount:0,message:'',source:'simulated-action',engine:'local-rule',activeEventIds:world.activeEvents.map(e=>e.id),...details});
    ledger.push(record);world.ledgerCount=ledger.length;world.events.push(record);
    if(world.events.length>60)world.events.shift();
    if(['replenishmentStarted','stockTransferred','replenishmentCompleted','replenishmentInterrupted'].includes(type)){
      world.replenishmentEvents.push(record);if(world.replenishmentEvents.length>16)world.replenishmentEvents.shift();
    }
    const sku=record.productId?analytics.sku[record.productId]:null;
    if(type==='exposure'){analytics.totals.exposures++;if(sku)sku.exposures++;}
    if(type==='decision'){analytics.totals.notices++;if(sku)sku.notices++;}
    if(type==='picked'){analytics.totals.picks++;if(sku)sku.picks++;}
    if(type==='stockout'){analytics.totals.stockouts++;if(sku)sku.stockouts++;}
    if(type!=='enter'&&type!=='payment')return record;
    if(type==='enter'){analytics.totals.arrivals++;bumpDay('entered');}
    if(type==='payment'){
      bumpDay('buyers');bumpDay('paidUnits',record.units);bumpDay('paidRevenue',record.amount);
      analytics.totals.paidUnits+=record.units;analytics.totals.paidRevenue+=record.amount;analytics.totals.paidGrossProfit+=record.grossProfit;analytics.totals.payments++;
      for(const id of record.productIds){world.paidUnitsBySKU[id]++;const row=analytics.sku[id];row.paidUnits++;row.paidRevenue+=PRODUCT_MAP[id].price;row.paidGrossProfit+=PRODUCT_MAP[id].price-costs[id];}
    }
    function accumulate(row){
      if(type==='enter')row.arrivals++;
      else {row.paidUnits+=record.units;row.paidRevenue+=record.amount;row.paymentCount++;for(const id of record.productIds)row.skuPaidUnits[id]=(row.skuPaidUnits[id]??0)+1;}
    }
    const windowIndex=Math.floor(world.time/60);
    if(!analytics.windows[windowIndex])analytics.windows[windowIndex]={start:windowIndex*60,end:(windowIndex+1)*60,...newWindow()};
    accumulate(analytics.windows[windowIndex]);
    world.eventSchedule.forEach((issue,index)=>{
      const duration=issue.end-issue.start,comparison=analytics.eventComparisons[index];
      const phase=world.time>=Math.max(0,issue.start-duration)&&world.time<issue.start?'before':world.time>=issue.start&&world.time<issue.end?'during':world.time>=issue.end&&world.time<issue.end+duration?'after':null;
      if(phase)accumulate(comparison[phase]);
    });
    return record;
  }
  function updateIssues(){
    if(world.time+1e-8<nextIssueAt)return;
    world.activeEvents=getActiveEvents(world);
    for(const issue of world.eventSchedule){
      if(world.time+1e-8>=issue.start&&!startedEvents.has(issue.id)){startedEvents.add(issue.id);event(null,'eventStarted',{issueId:issue.id,source:mode==='day'?'authored-daily-assumption':'authored-compressed-demo',scheduledTime:issue.start,message:(issue.name??issue.id)+' 시작',assumed:true});}
      if(world.time+1e-8>=issue.end&&!endedEvents.has(issue.id)){endedEvents.add(issue.id);event(null,'eventEnded',{issueId:issue.id,source:mode==='day'?'authored-daily-assumption':'authored-compressed-demo',scheduledTime:issue.end,message:(issue.name??issue.id)+' 종료',assumed:true});}
    }
    nextIssueAt=Math.min(...world.eventSchedule.flatMap(issue=>[issue.start,issue.end]).filter(t=>t>world.time+1e-8),Infinity);
  }
  function analyticsSnapshot(){
    const result=JSON.parse(JSON.stringify(analytics));
    function withExposure(row,start,end){
      const exposureSeconds=Math.max(0,Math.min(world.time,end)-start);
      return {...row,start,end,exposureSeconds,arrivalsPerMinute:exposureSeconds?row.arrivals/exposureSeconds*60:0,paidUnitsPerMinute:exposureSeconds?row.paidUnits/exposureSeconds*60:0,revenuePerMinute:exposureSeconds?row.paidRevenue/exposureSeconds*60:0};
    }
    result.windows=result.windows.filter(Boolean).map(row=>withExposure(row,row.start,row.end));
    result.eventComparisons=result.eventComparisons.map((row,index)=>{
      const issue=world.eventSchedule[index],duration=issue.end-issue.start;
      return {eventId:row.eventId,before:withExposure(row.before,Math.max(0,issue.start-duration),issue.start),during:withExposure(row.during,issue.start,issue.end),after:withExposure(row.after,issue.end,issue.end+duration)};
    });
    return {...result,windowSeconds:60,comparisonNote:(mode==='day'?'가정한 일일':'압축된 합성')+' 이벤트의 관찰 구간 비교이며 현실의 인과 효과 추정이 아닙니다.'};
  }
  function miss(a,product,level){
    world.stockoutDemand++;world.missedDemand++;
    const shelfGap=world.backroomStock[product.id]>0,key=shelfGap?'shelfGapDemand':'totalStockoutDemand';world[key]++;bumpDay(key);
    const reason=shelfGap?'shelf-gap':'total-stockout',message=product.name+' 구매 희망 · '+(shelfGap?'창고 재고 있으나 매대 비어 있음':'매장 전체 품절');log(a,message);
    event(a,'stockout',{productId:product.id,level,amount:product.price,picked:false,reason,shelfStock:world.stock[product.id],backroomStock:world.backroomStock[product.id],message});
  }
  function replenishmentCandidate(){
    if(!world.owner?.enabled)return null;
    return PRODUCTS.filter(p=>world.backroomStock[p.id]>0&&world.shelfCapacity[p.id]>0&&world.stock[p.id]<world.shelfCapacity[p.id]&&world.stock[p.id]/world.shelfCapacity[p.id]<=workerConfig.threshold)
      .sort((a,b)=>world.stock[a.id]/world.shelfCapacity[a.id]-world.stock[b.id]/world.shelfCapacity[b.id]||PRODUCTS.indexOf(a)-PRODUCTS.indexOf(b))[0]??null;
  }
  function ownerRoute(target,state){
    const owner=world.owner,path=findPath(owner.position,target);
    if(!path.length)throw new Error('Unreachable replenishment destination');
    owner.path=path;owner.pathIndex=0;owner.target=[...target];owner.state=state;owner.stateTime=0;owner.stateStartedAt=world.time;owner.velocity=0;
  }
  function advanceOwner(dt){
    const owner=world.owner;if(!owner||!owner.enabled)return;
    owner.stateTime=world.time-owner.stateStartedAt;owner.velocity=0;
    if(owner.state==='idle'){
      const product=replenishmentCandidate();if(!product)return;
      owner.productId=product.id;owner.quantity=Math.min(world.shelfCapacity[product.id]-world.stock[product.id],world.backroomStock[product.id]);
      owner.station='promo';owner.reachLevel=SCENARIOS[scenario].levels.findIndex(row=>row.includes(product.id))+1;
      const slots=[...STATIONS.promo.slots].sort((a,b)=>distance(a,owner.position)-distance(b,owner.position));
      ownerRoute(slots[0],'walking');event(owner,'replenishmentStarted',{productId:product.id,quantity:owner.quantity,level:owner.reachLevel,depot:[...owner.depot],target:[...slots[0]],message:product.name+' 보충 직원 이동'});return;
    }
    if(owner.state==='replenishing'){
      if(owner.stateTime+1e-8<workerConfig.serviceSeconds)return;
      const id=owner.productId,shelfBefore=world.stock[id],backroomBefore=world.backroomStock[id];
      const quantity=Math.max(0,Math.min(world.shelfCapacity[id]-shelfBefore,backroomBefore));
      world.stock[id]+=quantity;world.backroomStock[id]-=quantity;owner.quantity=quantity;
      if(quantity>0){world.replenishments++;world.replenishedUnits+=quantity;owner.completedTasks++;}
      event(owner,'stockTransferred',{productId:id,quantity,shelfBefore,shelfAfter:world.stock[id],backroomBefore,backroomAfter:world.backroomStock[id],message:PRODUCT_MAP[id].name+' 창고 → 매대 '+quantity+'개'});
      ownerRoute(owner.depot,'returning');return;
    }
    if(owner.state!=='walking'&&owner.state!=='returning')return;
    while(owner.pathIndex<owner.path.length&&distance(owner.position,owner.path[owner.pathIndex])<.025)owner.pathIndex++;
    if(owner.pathIndex>=owner.path.length){
      if(owner.state==='walking'){owner.state='replenishing';owner.heading=STATIONS[owner.station].facing;owner.stateTime=0;owner.stateStartedAt=world.time;}
      else{event(owner,'replenishmentCompleted',{productId:owner.productId,quantity:owner.quantity,message:'보충 직원 창고 복귀'});owner.state='idle';owner.stateTime=0;owner.stateStartedAt=world.time;owner.station=null;owner.productId=null;owner.quantity=0;}
      return;
    }
    const target=owner.path[owner.pathIndex],dx=target[0]-owner.position[0],dz=target[1]-owner.position[1],length=Math.hypot(dx,dz),step=Math.min(owner.speed*dt,length);
    const next=[owner.position[0]+dx/length*step,owner.position[1]+dz/length*step];
    if(!isWalkable(...next))throw new Error('Replenishment path crossed fixture geometry');
    owner.position=next;owner.heading=Math.atan2(dx,dz);owner.velocity=dt?step/dt:0;
  }
  function go(a,target,kind='station') {
    a.target=target;a.targetKind=kind;
    a.approach=kind==='checkout'&&distance(a.position,target)>.8?checkoutPoint(map,world.queue.indexOf(a.id),true):null;
    a.path=a.approach?[...findPath(a.position,a.approach),...findPath(a.approach,target)]:findPath(a.position,target);
    a.pathIndex=0;a.state=kind==='exit'?'exiting':'walking';a.blocked=0;a.progressAt=world.time;
    if(!a.path.length)throw new Error('Unreachable destination: '+target);
  }
  function finishShopping(a) {
    if(a.basket.length) {
      if(!world.queue.includes(a.id))world.queue.push(a.id);
      a.station=null;log(a,'탐색 완료 · 계산대로 이동');go(a,queuePoint(world.queue.indexOf(a.id)),'checkout');
    } else {log(a,'구매 없이 퇴장');go(a,[...map.exit],'exit');}
  }
  function queuePoint(index) {return checkoutPoint(map,index);}
  function chooseDestination(a) {
    if(a.visited.length>=a.maxStops||a.basket.length>=3||a.spent>a.profile.budget-1700){finishShopping(a);return;}
    const choices=Object.entries(STATIONS).filter(([id])=>!a.visited.includes(id)).map(([id,s])=>{
      const modifiers=eventModifiers(world.activeEvents);
      let interest=id==='promo'?.58:a.profile.affinity[s.category]*modifiers.categoryMultipliers[s.category];
      if(id==='coffee')interest*=a.profileIndex===1?1.6:.44;
      if(a.basket.some(p=>p.category===s.category))interest*=.35;
      const crowd=world.agents.filter(other=>other.id!==a.id&&other.station===id).length;
      return {id,s,score:interest+.35*random(a.id,200+Object.keys(STATIONS).indexOf(id))-distance(a.position,s.slots[0])*.018-crowd*.12};
    }).sort((a,b)=>b.score-a.score);
    const choice=choices[0];if(!choice){finishShopping(a);return;}
    a.station=choice.id;
    const slots=[...choice.s.slots].sort((p,q)=>{
      const pressure=t=>world.agents.reduce((sum,o)=>sum+(o.id!==a.id&&o.target&&distance(o.target,t)<.6?1:0),0);
      return pressure(p)-pressure(q)||distance(a.position,p)-distance(a.position,q);
    });
    a.reason=choice.id==='promo'?'행사 상품 확인':a.profile.mission+'에 맞는 상품 탐색';
    log(a,choice.s.name+' 선택 · '+a.reason);go(a,slots[0]);
  }
  function entryPoint(id){return [map.entry[0]+(random(id,701)-.5)*.8,map.entry[1]];}
  function spawn(potential=null) {
    const id=potential?.id??world.spawned;
    let sample=random(id,1)*weightTotal,profileIndex=weights.length-1;
    for(let i=0;i<weights.length;i++){sample-=weights[i];if(sample<0){profileIndex=i;break;}}
    if(potential)profileIndex=potential.profileIndex;
    const profile=PROFILES[profileIndex];
    const entry=entryPoint(id);
    if(world.agents.some(a=>distance(a.position,entry)<.65))return false;
    const a={id,profileIndex,profile,position:entry,heading:Math.PI,speed:.85+random(id,4)*.5,
      state:'walking',station:null,target:null,path:[],pathIndex:0,visited:[],basket:[],spent:0,
      maxStops:profileIndex===1?2:2+Math.floor(random(id,8)*2),memory:[],blocked:0,paid:false,paidAt:null,
      stateTime:0,timer:0,pending:null,reachLevel:2,travel:0,enteredAt:world.time};
    world.agents.push(a);world.spawned++;world.profileCounts[profileIndex]++;
    log(a,'입장 · '+profile.mission);event(a,'enter',{message:profile.mission});chooseDestination(a);
    if(mode==='visits')world.nextArrival=world.time+(2.8+random(id,702)*2.5)/eventModifiers(world.activeEvents).arrivalMultiplier;
    return true;
  }
  function considerPotentials(){
    while(potentialIndex<world.potentialSchedule.length&&world.potentialSchedule[potentialIndex].time<=world.time+1e-8){
      const potential=world.potentialSchedule[potentialIndex++],hour=world.time/duration*24;
      bumpDay('considered');
      const open=world.time<duration-1e-8&&openingHours.some(([start,end])=>hour>=start&&hour<end);
      let reason=!open?'closed':potential.entryDraw>=potential.needProbability?'not-needed':world.agents.length>=maxActive||world.agents.some(a=>distance(a.position,entryPoint(potential.id))<.65)?'crowded':null;
      event(null,'potentialConsidered',{potentialId:potential.id,profileIndex:potential.profileIndex,scheduledTime:potential.time,entryDraw:potential.entryDraw,needProbability:potential.needProbability,entered:reason===null,reason:reason??'entered',source:'seeded-daily-assumption',message:'잠재 고객 방문 여부 판단'});
      if(!reason&&!spawn(potential))reason='crowded';
      if(reason){bumpDay('skipped');world.day.skippedReasons[reason]++;world.day.hourly[dayHour()].skippedReasons[reason]++;event(null,'entrySkipped',{potentialId:potential.id,profileIndex:potential.profileIndex,reason,message:reason==='closed'?'영업 외 시간 · 미입장':reason==='crowded'?'입구·매장 혼잡 · 미입장':'현재 구매 필요 없음 · 미입장'});}
    }
    world.nextArrival=world.potentialSchedule[potentialIndex]?.time??duration;
  }
  function decide(a) {
    a.pending=null;
    const context=buildDecisionContext(world,a),result=decideLocally(context,seed),atPromo=a.station==='promo';
    const decision=freezeRecord({context,result});a.lastDecision=decision;world.lastDecision=decision;
    // Every fact is observed at this actual fixture and retained in the full ledger.
    for(const observation of result.observations){
      const fact=context.observedProducts.find(p=>p.locationId===observation.locationId),p=PRODUCT_MAP[fact.productId];
      const funnel=atPromo?world.levels[fact.level-1]:null;
      if(fact.canSee){
        if(funnel)funnel.exposure++;
        event(a,'exposure',{productId:p.id,locationId:fact.locationId,fixtureId:fact.fixtureId,level:fact.level,column:fact.column,position:[...fact.position],observerPosition:[...context.observer.position],distance:fact.distance,stock:fact.stock,message:p.name+' 진열 관찰'});
      }
      if(!observation.noticed)continue;
      if(funnel)funnel.notice++;world.decisions++;
      event(a,'decision',{productId:p.id,locationId:fact.locationId,fixtureId:fact.fixtureId,level:fact.level,column:fact.column,position:[...fact.position],neighbors:fact.neighbors.map(n=>({...n})),distance:fact.distance,
        stock:fact.stock,price:fact.price,isNew:fact.isNew,score:observation.score,contributions:{...observation.contributions},noticeProbability:observation.noticeProbability,purchaseProbability:observation.purchaseProbability,reason:observation.reason,picked:false,message:p.name+' 비교 · '+observation.reason});
    }
    const selected=result.action.productId?context.observedProducts.find(p=>p.locationId===result.action.locationId):null;
    const product=selected?PRODUCT_MAP[selected.productId]:null;
    if(product){
      world.purchaseDemand++;
      event(a,'intent',{productId:product.id,locationId:selected.locationId,level:selected.level,column:selected.column,position:[...selected.position],amount:product.price,reason:'purchase-intent',message:product.name+' 구매 선택'});
      if(world.stock[product.id]===0){miss(a,product,selected.level);chooseDestination(a);return;}
      a.pending=product;
      a.pendingLocation=selected.locationId;a.reachLevel=selected.level;
      a.state='reaching';a.timer=2.2;a.stateTime=0;log(a,product.name+' 집기 · '+a.reachLevel+'층');
    } else {log(a,'비교 후 이동 · '+result.action.reason);chooseDestination(a);}
  }
  function arrived(a) {
    a.velocity=0;a.stateTime=0;
    if(a.targetKind==='exit') {
      a.state='done';world.completed++;world.totalTravel+=a.travel;world.totalVisitTime+=world.time-a.enteredAt;log(a,'방문 완료');
      bumpDay('completed');if(!a.paid)bumpDay('closedWithoutPurchase');
      event(a,'exit',{station:'exit',amount:a.paid?a.spent:0,message:'방문 완료'});
      world.history.push({id:a.id,profileIndex:a.profileIndex,visited:[...a.visited],spent:a.spent,paid:a.paid,paidAt:a.paidAt,basket:a.basket.map(p=>p.id),memory:[...a.memory]});
      if(world.history.length>100)world.history.shift();return;
    }
    if(a.targetKind==='checkout'){a.state='queue';a.heading=Math.PI;return;}
    a.state='browsing';a.heading=STATIONS[a.station].facing;
    a.timer=1.9+random(a.id,120+a.visited.length)*3.0;
    a.visited.push(a.station);log(a,STATIONS[a.station].name+'에서 상품 비교');
    event(a,'browse',{message:STATIONS[a.station].name+'에서 상품 비교'});
  }
  function advance(a,dt) {
    a.stateTime+=dt;a.velocity=0;
    if(a.state==='walking'&&a.targetKind==='checkout'){
      const target=queuePoint(world.queue.indexOf(a.id));
      if(distance(a.target,target)>.15)go(a,target,'checkout');
    }
    if(a.state==='queue'){
      const index=world.queue.indexOf(a.id),target=queuePoint(index);
      if(distance(a.position,target)>.14){go(a,target,'checkout');return;}
      if(index===0){a.state='paying';a.timer=2.7;a.stateTime=0;log(a,'결제 · '+a.spent.toLocaleString('ko-KR')+'원');}
      return;
    }
    if(a.state==='paying'){
      a.timer-=dt;if(a.timer<=0){
        const grossProfit=a.basket.reduce((sum,p)=>sum+p.price-costs[p.id],0);
        world.paidRevenue+=a.spent;world.paidGrossProfit+=grossProfit;world.paidUnits+=a.basket.length;world.buyers++;
        a.paid=true;a.paidAt=world.time;
        event(a,'payment',{station:'checkout',amount:a.spent,units:a.basket.length,grossProfit,productIds:a.basket.map(p=>p.id),message:'결제 완료 · '+a.spent.toLocaleString('ko-KR')+'원'});
        world.queue=world.queue.filter(id=>id!==a.id);log(a,'결제 완료 · 출구로 이동');go(a,[...map.exit],'exit');
      }return;
    }
    if(a.state==='browsing'||a.state==='reaching'){
      a.timer-=dt;if(a.timer>0)return;
      if(a.state==='browsing'){decide(a);return;}
      const p=a.pending;
      if(p&&world.stock[p.id]>0&&a.spent+p.price<=a.profile.budget){
        world.stock[p.id]--;a.basket.push(p);a.spent+=p.price;log(a,p.name+'을 장바구니에 담음');
        if(a.station==='promo')world.levels[a.reachLevel-1].pick++;
        event(a,'picked',{productId:p.id,locationId:a.pendingLocation??null,level:a.reachLevel,amount:p.price,picked:true,reason:'picked',message:p.name+'을 장바구니에 담음'});
      }else if(p)miss(a,p,a.reachLevel);
      a.pending=null;chooseDestination(a);return;
    }
    if(a.state!=='walking'&&a.state!=='exiting')return;
    if(a.approach&&distance(a.position,a.approach)<.16)a.approach=null;
    // A waypoint is reached only after walking there: no per-frame teleportation.
    while(a.pathIndex<a.path.length&&distance(a.position,a.path[a.pathIndex])<.10){a.pathIndex++;a.progressAt=world.time;}
    if(a.pathIndex===a.path.length){arrived(a);return;}
    const target=a.path[a.pathIndex],dx=target[0]-a.position[0],dz=target[1]-a.position[1];
    const heading=Math.atan2(dx,dz),step=Math.min(a.speed*dt,Math.hypot(dx,dz));
    let best=null;
    // Local collision avoidance; congestion changes steering, not the character's identity.
    for(const direction of [0,.25,-.25,.45,-.45,.85,-.85,1.3,-1.3,1.8,-1.8].map(o=>heading+o).concat([Math.PI/2,-Math.PI/2,0,Math.PI])){
      const next=[a.position[0]+Math.sin(direction)*step,a.position[1]+Math.cos(direction)*step];
      if(!isWalkable(...next))continue;
      const obstructed=world.agents.some(other=>other!==a&&other.state!=='done'&&distance(next,other.position)<.43&&distance(next,other.position)<distance(a.position,other.position));
      if(!obstructed){best=next;break;}
    }
    if(best){a.heading=Math.atan2(best[0]-a.position[0],best[1]-a.position[1]);a.position=best;a.velocity=a.speed;a.travel+=step;a.blocked=0;}
    else {
      a.blocked+=dt;
      // When another shopper occupies a viewing slot, choose an unoccupied slot at that fixture.
      if(a.blocked>2&&a.targetKind==='station'&&distance(a.position,a.target)<1.2){
        const alternative=STATIONS[a.station].slots.find(p=>!world.agents.some(o=>o!==a&&distance(o.position,p)<.6));
        if(alternative&&distance(alternative,a.target)>.1){log(a,'혼잡을 관찰 · 옆 진열 위치로 이동');go(a,alternative);}
      }
    }
      if((a.blocked>.7||world.time-a.progressAt>2)&&world.time-(a.lastReplan??0)>1){
        const occupied=world.agents.filter(o=>o!==a&&o.state!=='done').map(o=>o.position);
        const alternative=a.approach?[...findPath(a.position,a.approach,occupied),...findPath(a.approach,a.target,occupied)]:findPath(a.position,a.target,occupied);
        if(alternative.length){a.path=alternative;a.pathIndex=0;}
        a.lastReplan=world.time;
      }
  }
  function closeDay(){
    if(world.isComplete)return;
    for(const a of world.agents){
      if(!a.paid&&a.basket.length){
        const productIds=a.basket.map(p=>p.id),amount=a.spent;
        for(const id of productIds){world.backroomStock[id]++;world.returnedUnitsBySKU[id]++;}
        event(a,'basketReturned',{productIds,units:productIds.length,amount,destination:'backroom',reason:'day-cutoff',message:'일일 마감 · 미결제 상품 창고 반납'});
        a.basket=[];a.spent=0;
      }
      world.completed++;world.totalTravel+=a.travel;world.totalVisitTime+=world.time-a.enteredAt;bumpDay('completed');if(!a.paid)bumpDay('closedWithoutPurchase');
      event(a,'dayClosed',{paid:a.paid,reason:'day-cutoff',message:a.paid?'일일 마감 · 결제 고객 퇴장':'일일 마감 · 구매 없이 방문 종료'});
      a.state='done';a.pending=null;a.velocity=0;
      world.history.push({id:a.id,profileIndex:a.profileIndex,visited:[...a.visited],spent:a.spent,paid:a.paid,paidAt:a.paidAt,basket:a.basket.map(p=>p.id),closedAtCutoff:true,memory:[...a.memory]});
    }
    world.history=world.history.slice(-100);world.agents=[];world.queue=[];
    if(world.owner.state!=='idle')event(world.owner,'replenishmentInterrupted',{productId:world.owner.productId,reason:'day-cutoff',message:'일일 마감 · 보충 작업 종료, 미이동 재고는 창고 유지'});
    Object.assign(world.owner,{state:'idle',velocity:0,stateTime:0,stateStartedAt:world.time,productId:null,quantity:0,station:null,path:[],pathIndex:0});
    world.day.inStore=0;world.day.progress=1;world.isComplete=true;
    event(null,'dayEnded',{duration,potentialTotal:limit,considered:world.day.considered,entered:world.day.entered,skipped:world.day.skipped,buyers:world.buyers,paidUnits:world.paidUnits,amount:world.paidRevenue,closedWithoutPurchase:world.day.closedWithoutPurchase,message:'24시간 일일 관찰 종료 · 마감 이후 매출 없음'});
  }
  world.isQuiescent=()=>mode==='day'&&!world.isComplete&&world.agents.length===0&&world.owner.state==='idle'&&!replenishmentCandidate();
  world.nextBoundary=()=>{
    if(mode!=='day')return world.nextArrival;
    if(world.isComplete)return duration;
    if(replenishmentCandidate()&&world.owner.state==='idle')return Math.min(duration,world.time+.05);
    const futureIssues=world.eventSchedule.flatMap(issue=>[issue.start,issue.end]).filter(t=>t>world.time+1e-8).map(t=>Math.ceil(t*20-1e-8)/20);
    return Math.min(duration,world.potentialSchedule[potentialIndex]?.time??duration,...futureIssues);
  };
  world.update=dt=>{
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('dt must be a nonnegative finite number');
    if(world.isComplete||dt===0)return;
    if(mode==='day'){
      // Compensated elapsed-time accumulation avoids losing the final 50ms after
      // hundreds of thousands of physics steps or differently partitioned frames.
      const corrected=dt-dayTimeError,nextRequested=dayRequestedTime+corrected;
      dayTimeError=(nextRequested-dayRequestedTime)-corrected;dayRequestedTime=Math.min(duration,nextRequested);
      while(!world.isComplete){
        const dayPendingSeconds=Math.max(0,dayRequestedTime-world.time);
        const quantum=Math.min(.05,duration-world.time);
        if(dayPendingSeconds+1e-8<quantum)break;
        let target=Math.min(duration,(dayTick+1)/20);
        if(world.isQuiescent()){
          const availableTicks=Math.floor((dayPendingSeconds+1e-8)*20);
          const availableTime=Math.min(duration,(dayTick+availableTicks)/20);
          target=Math.max(target,Math.min(world.nextBoundary(),availableTime));
          if(dayPendingSeconds+1e-8>=duration-world.time&&world.nextBoundary()===duration)target=duration;
        }
        const step=target-world.time;
        world.time=target;dayTick=Math.floor(world.time*20+1e-8);
        updateIssues();world.agents=world.agents.filter(a=>a.state!=='done');considerPotentials();
        if(world.time>=duration){closeDay();break;}
        // Leaps occur only in an empty, idle world. Existing actors always get 50ms physics.
        for(const a of world.agents)advance(a,Math.min(.05,step));
        advanceOwner(Math.min(.05,step));
        world.agents=world.agents.filter(a=>a.state!=='done');world.day.inStore=world.agents.length;world.day.progress=world.time/duration;
      }
      return;
    }
    // Legacy visits mode retains its original fixed small-step behavior.
    let remaining=dt;
    while(remaining>1e-9&&world.completed<limit){
      const step=Math.min(.05,remaining);remaining-=step;world.time+=step;
      updateIssues();world.agents=world.agents.filter(a=>a.state!=='done');
      if(world.spawned<limit&&world.agents.length<maxActive&&world.time>=world.nextArrival)spawn();
      for(const a of world.agents)advance(a,step);
      world.agents=world.agents.filter(a=>a.state!=='done');
    }
    world.isComplete=world.completed>=limit;
  };
  function inventorySnapshot(){
    const unpaid=Object.fromEntries(PRODUCTS.map(p=>[p.id,0]));
    for(const a of world.agents)if(!a.paid)for(const p of a.basket)unpaid[p.id]++;
    const differences=Object.fromEntries(PRODUCTS.map(p=>[p.id,world.initialTotalStock[p.id]-world.stock[p.id]-world.backroomStock[p.id]-unpaid[p.id]-world.paidUnitsBySKU[p.id]]));
    return {unpaidUnitsBySKU:unpaid,differences,conserved:Object.values(differences).every(value=>value===0),identity:'initialTotal = shelf + backroom + unpaidBaskets + paidUnits; returnedUnits is a flow already included in backroom'};
  }
  world.snapshot=({detail=true}={})=>({mode,isComplete:world.isComplete,mapId,storeId,scenario,seed,runId,limit,maxActive,averageTravel:world.completed?world.totalTravel/world.completed:0,averageVisitTime:world.completed?world.totalVisitTime/world.completed:0,time:world.time,spawned:world.spawned,completed:world.completed,active:world.agents.length,
    paidRevenue:world.paidRevenue,paidGrossProfit:world.paidGrossProfit,paidUnits:world.paidUnits,buyers:world.buyers,decisions:world.decisions,purchaseDemand:world.purchaseDemand,stockoutDemand:world.stockoutDemand,missedDemand:world.stockoutDemand,
    shelfGapDemand:world.shelfGapDemand,totalStockoutDemand:world.totalStockoutDemand,replenishments:world.replenishments,replenishedUnits:world.replenishedUnits,
    engine:JSON.parse(JSON.stringify(ENGINE)),ledgerCount:ledger.length,
    day:world.day?JSON.parse(JSON.stringify(world.day)):null,owner:world.owner?JSON.parse(JSON.stringify(world.owner)):null,
    issues:world.eventSchedule.map(e=>({...JSON.parse(JSON.stringify(e)),phase:world.time+1e-8<e.start?'upcoming':world.time<e.end-1e-8?'active':'ended'})),
    initialStock:{...initialStock},initialTotalStock:{...world.initialTotalStock},stock:{...world.stock},backroomStock:{...world.backroomStock},shelfCapacity:{...world.shelfCapacity},paidUnitsBySKU:{...world.paidUnitsBySKU},returnedUnitsBySKU:{...world.returnedUnitsBySKU},inventory:inventorySnapshot(),costs:{...costs},profileCounts:[...world.profileCounts],profileWeights:[...weights],levels:world.levels.map(row=>({...row})),
    ...(detail?{lastDecision:world.lastDecision?JSON.parse(JSON.stringify(world.lastDecision)):null,analytics:analyticsSnapshot(),events:world.events.map(e=>JSON.parse(JSON.stringify(e))),replenishmentEvents:world.replenishmentEvents.map(e=>JSON.parse(JSON.stringify(e))),
      agents:world.agents.map(a=>({id:a.id,profileIndex:a.profileIndex,state:a.state,station:a.station,position:[...a.position],heading:a.heading,speed:a.speed,stateTime:a.stateTime,velocity:a.velocity,visited:[...a.visited],basket:a.basket.map(p=>p.id),spent:a.spent,paid:a.paid,paidAt:a.paidAt,blocked:a.blocked,travel:a.travel,enteredAt:a.enteredAt,pending:a.pending?.id??null,reachLevel:a.reachLevel,memory:a.memory.map(m=>({...m}))}))}:{})});
  world.exportLedger=()=>JSON.parse(JSON.stringify({schemaVersion:'spatial-ledger/1',engine:ENGINE,provenance:{...PROVENANCE,events:mode==='day'?'authored-daily-assumption':PROVENANCE.events},
    run:{mode,runId,storeId,mapId,scenario,seed,time:world.time,limit,isComplete:world.isComplete,spawned:world.spawned,completed:world.completed,initialStock,initialTotalStock:world.initialTotalStock,remainingStock:world.stock,backroomStock:world.backroomStock,shelfCapacity:world.shelfCapacity,paidUnitsBySKU:world.paidUnitsBySKU,returnedUnitsBySKU:world.returnedUnitsBySKU,inventory:inventorySnapshot(),eventSchedule:world.eventSchedule,openingHours,staffingAssumption:mode==='day'?'Separate cashier and replenishment worker; no supplier orders during the day':null},
    day:world.day,owner:world.owner,potentialSchedule:world.potentialSchedule,catalog:PRODUCTS,events:ledger,analytics:analyticsSnapshot(),lastDecision:world.lastDecision}));
  if(mode==='day'){world.nextArrival=world.potentialSchedule[0]?.time??duration;updateIssues();}
  return world;
}
