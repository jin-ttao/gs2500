import { PRODUCTS, PRODUCT_MAP, randomAt } from './model.js';
import { getMap } from './maps.js';
import { getFixturePlacements } from './merchandising.js';
import { deriveBehavior, productPolicy } from './behavior.js';

export const ENGINE=Object.freeze({type:'local-rule',version:'3',behavior:'bounded-explicit-policy/1',jev:Object.freeze({status:'not-connected',called:false})});
export const PROVENANCE=Object.freeze({catalog:'authored-fixture',trend:'assumed',events:'authored-compressed-demo',state:'live-spatial-world',modelCall:'none'});
// Compressed simulation seconds, never claims about a real festival, weather or trend.
export const EXOGENOUS_EVENTS=Object.freeze([
  {id:'fireworks',name:'강변 불꽃 행사 가정',start:40,end:95,arrivalMultiplier:1.18,mapArrivalMultipliers:{riverside:1.55,tourism:1.35,park:1.30},categoryMultipliers:{snack:1.35,drink:1.30},description:'합성 행사 관람객의 음료·간식 관심 증가'},
  {id:'campus-festival',name:'대학 축제 가정',start:110,end:170,arrivalMultiplier:1.15,mapArrivalMultipliers:{university:1.55,express:1.30,cafe:1.25},categoryMultipliers:{snack:1.35,meal:1.18,drink:1.18},description:'합성 축제 방문자의 간편 구매 증가'},
  {id:'rain',name:'소나기 가정',start:185,end:240,arrivalMultiplier:.84,categoryMultipliers:{meal:1.30,drink:.88},description:'합성 우천으로 유입 감소·따뜻한 간편식 관심 증가'},
  {id:'viral-trend',name:'신상품 화제 가정',start:255,end:330,arrivalMultiplier:1.10,categoryMultipliers:{health:1.18,snack:1.14},productBoosts:{proteinbar:.12,gummy:.10,tea:.08},description:'외부 검색 없이 작성한 신상품 관심 변화'},
].map(event=>Object.freeze({...event,source:'authored-demo-fixture',status:'assumed',confidence:.35})));

const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const clone=value=>JSON.parse(JSON.stringify(value));
export function freezeRecord(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freezeRecord(child);Object.freeze(value);}return value;
}
export function getActiveEvents(worldOrSchedule,time){
  const world=Array.isArray(worldOrSchedule)?null:worldOrSchedule;
  const schedule=world?.eventSchedule??worldOrSchedule??EXOGENOUS_EVENTS,t=time??world?.time??0;
  return schedule.filter(e=>t+1e-8>=e.start&&t<e.end-1e-8).map(e=>({...clone(e),effectiveArrivalMultiplier:e.mapArrivalMultipliers?.[world?.mapId]??e.arrivalMultiplier??1}));
}
export function eventModifiers(activeEvents=[]){
  const categories={meal:1,drink:1,snack:1,health:1},productBoosts={};let arrivalMultiplier=1;
  for(const event of activeEvents){
    arrivalMultiplier*=event.effectiveArrivalMultiplier??event.arrivalMultiplier??1;
    for(const category of Object.keys(categories))categories[category]*=event.categoryMultipliers?.[category]??1;
    for(const [id,value] of Object.entries(event.productBoosts??{}))productBoosts[id]=(productBoosts[id]??0)+value;
  }
  return {arrivalMultiplier:clamp(arrivalMultiplier,.5,2),categoryMultipliers:Object.fromEntries(Object.entries(categories).map(([key,value])=>[key,clamp(value,.6,1.8)])),productBoosts};
}

export function buildDecisionContext(world,agent){
  const map=getMap(world.mapId),eyeHeight=agent.profile.age>=60?1.48:1.6;
  const observerPosition=[agent.position[0],eyeHeight,agent.position[1]];
  const fixtures=map.fixtures.filter(f=>f.station===agent.station);
  fixtures.sort((a,b)=>Math.hypot(a.x-agent.position[0],a.z-agent.position[1])-Math.hypot(b.x-agent.position[0],b.z-agent.position[1]));
  const fixture=fixtures[0]??null;
  const capability={eyeHeight,maxDistance:4.5,fieldOfViewDegrees:150,visionFactor:agent.profile.age>=60?.92:1,source:'authored-persona-assumption'};
  const nearest=new Map();
  for(const placement of fixture?getFixturePlacements(fixture,world.scenario):[]){
    if(fixture.type==='gondola'&&placement.side!==(fixture.side??1))continue;
    const p=PRODUCT_MAP[placement.productId],distance=Math.hypot(...placement.position.map((value,i)=>value-observerPosition[i]));
    const dx=placement.position[0]-agent.position[0],dz=placement.position[2]-agent.position[1],planar=Math.hypot(dx,dz);
    const facing=planar>0?(Math.sin(agent.heading)*dx+Math.cos(agent.heading)*dz)/planar:1;
    const shelfStock=world.stock[p.id],backroomStock=world.backroomStock?.[p.id]??0;
    const fact={...clone(placement),name:p.name,category:p.category,price:p.price,stock:shelfStock,shelfStock,backroomStock,totalAvailableStock:shelfStock+backroomStock,shelfCapacity:world.shelfCapacity?.[p.id]??null,availability:shelfStock>0?'on-shelf':backroomStock>0?'shelf-gap':'store-total-shortage',isNew:p.isNew,launchDaysAgo:p.launchDaysAgo,tags:[...p.tags],trend:{...p.trend},
      distance,facing,canSee:distance<=capability.maxDistance&&facing>=Math.cos(capability.fieldOfViewDegrees*Math.PI/360),canReach:distance<=3.2,
      neighbors:placement.neighbors.map(neighbor=>({...neighbor,category:PRODUCT_MAP[neighbor.productId].category,stock:world.stock[neighbor.productId]}))};
    if(!nearest.has(p.id)||distance<nearest.get(p.id).distance)nearest.set(p.id,fact);
  }
  const observedProducts=[...nearest.values()],remainingBudget=agent.profile.budget-agent.spent,basket=agent.basket.map(p=>p.id),behavior=deriveBehavior(agent.profile);
  for(const fact of observedProducts){
    const policy=productPolicy(agent.profile,fact,{basket,spent:agent.spent,memory:agent.memory,behavior});
    const {behavior:sharedBehavior,...inputs}=policy;
    fact.behaviorPolicy=inputs;
  }
  const constraints={budget:agent.profile.budget,remainingBudget,maxBasket:behavior.maxBasket,currentBasketSize:basket.length,basket:[...basket],mustHaveStockToPick:true,oneUnitPerAction:true,behavior};
  const allowedActions=observedProducts.filter(p=>p.canSee&&p.canReach&&p.behaviorPolicy.allowed).map(p=>({type:p.stock>0?'pick':'record-unmet-demand',productId:p.productId,locationId:p.locationId}));
  allowedActions.push({type:'skip'});
  return {
    schemaVersion:'shelf-context/1',engine:clone(ENGINE),runId:world.runId,storeId:world.storeId,mapId:world.mapId,scenario:world.scenario,time:world.time,
    observer:{agentId:agent.id,profileIndex:agent.profileIndex,position:observerPosition,heading:agent.heading,capability},
    persona:clone(agent.profile),memory:clone(agent.memory??[]),behavior,basket,spent:agent.spent,
    fixture:fixture?{id:fixture.id,type:fixture.type,position:[fixture.x,0,fixture.z],rotation:fixture.rotation,scale:fixture.scale}:null,
    neighborhood:{id:map.id,label:map.name,region:map.region??null,source:'authored-map',status:'assumed'},
    observedProducts,activeEvents:getActiveEvents(world),allowedActions,constraints,
    day:world.day?{duration:world.day.duration,elapsedSeconds:world.time,hour:world.time/world.day.duration*24,potentialTotal:world.day.potentialTotal,considered:world.day.considered,entered:world.day.entered,calendarDate:null,source:'authored-daily-assumption'}:null,
    inventoryPolicy:{pickFrom:'shelf-only',replenishment:'finite-backroom-transfer-after-worker-service',supplierOrders:false},
    provenance:{...PROVENANCE,events:world.mode==='day'?'authored-daily-assumption':PROVENANCE.events},
  };
}
export const getShelfContext=buildDecisionContext;
const complementary=(a,b)=>(a==='meal'&&b==='drink')||(a==='drink'&&['meal','snack'].includes(b))||(a==='snack'&&b==='drink')||(a==='health'&&b==='drink');
const neighborhoodBias={office:{meal:.035,drink:.025},express:{meal:.04},residential:{meal:.025,health:.03},university:{snack:.04,drink:.025},riverside:{snack:.04,drink:.03},tourism:{snack:.035,drink:.03},park:{health:.035,drink:.035},cafe:{drink:.04,snack:.03},compact:{meal:.02}};

/** Bounded, inspectable local rules. No JEV/network/model call occurs here. */
export function decideLocally(context,seed=42){
  const modifiers=eventModifiers(context.activeEvents),profile=context.persona,agentId=context.observer.agentId,behavior=deriveBehavior(profile);
  const stationFeature=Math.abs([...context.fixture?.id??''].reduce((s,c)=>s+c.charCodeAt(0),0));
  const observations=context.observedProducts.map(fact=>{
    const index=PRODUCTS.findIndex(p=>p.id===fact.productId),levelBase=context.fixture?.type==='promo'?[.30,.73,.82,.38][fact.level-1]:.87;
    const noticeContributions={level:levelBase,distance:clamp((1.8-fact.distance)*.10,-.18,.08),column:context.fixture?.type==='promo'?-Math.abs(fact.local[0])*.045:0,facing:clamp((fact.facing-.5)*.06,-.04,.03),vision:(context.observer.capability.visionFactor-1)*.3,novelty:fact.isNew?.035:0};
    const noticeProbability=fact.canSee?clamp(Object.values(noticeContributions).reduce((sum,n)=>sum+n,0),.05,.96):0;
    const noticeDraw=randomAt(agentId,1000+stationFeature*31+index,seed),noticed=noticeDraw<noticeProbability;
    const neighborPairs=fact.neighbors.filter(n=>n.stock>0&&complementary(fact.category,n.category)).length;
    const basketComplement=context.basket.some(id=>complementary(fact.category,PRODUCT_MAP[id].category));
    const policy=productPolicy(profile,fact,{basket:context.basket,spent:context.spent,memory:context.memory,behavior});
    const contributions={base:.11,affinity:(profile.affinity?.[fact.category]??0)*.57,novelty:fact.isNew?(profile.source?.dataset==='nvidia/Nemotron-Personas-Korea'?.02+.08*(profile.behavior?.noveltySeeking??.5):context.observer.profileIndex===3?.07:.03):0,trend:clamp(fact.trend.strength,0,1)*.065,
      adjacentComplement:Math.min(.06,neighborPairs*.025),basketComplement:basketComplement?.035:0,neighborhood:neighborhoodBias[context.mapId]?.[fact.category]??0,
      localEvent:clamp((modifiers.categoryMultipliers[fact.category]-1)*.22+(modifiers.productBoosts[fact.productId]??0),-.10,.16),
      exactPosition:clamp((1.5-fact.distance)*.028-Math.abs(fact.local[0])*.008,-.07,.025),individualVariation:(randomAt(agentId,2000+index,seed)-.5)*.08,
      missionFit:policy.missionFit,pricePenalty:policy.pricePenalty,memory:policy.memoryAdjustment};
    const score=clamp(Object.values(contributions).reduce((sum,n)=>sum+n,0),.04,.95);
    const affordable=fact.price<=context.constraints.remainingBudget,alreadyPicked=context.basket.includes(fact.productId),withinLimit=context.basket.length<context.constraints.maxBasket;
    const reachable=fact.canReach!==false,actionAllowed=!context.allowedActions||context.allowedActions.some(action=>['pick','record-unmet-demand'].includes(action.type)&&action.productId===fact.productId&&action.locationId===fact.locationId);
    return {productId:fact.productId,locationId:fact.locationId,noticed,noticeProbability,noticeDraw,noticeContributions,purchaseProbability:score,score,contributions,
      policy:{allowed:policy.allowed,reasons:policy.reasons,evidence:policy.evidence},
      utilityInputs:{price:fact.price,remainingBudget:policy.remainingBudget,budgetShare:policy.budgetShare,priceSensitivity:policy.priceSensitivity,missionFit:policy.missionFit,memoryAdjustment:policy.memoryAdjustment},
      eligible:noticed&&policy.allowed&&reachable&&actionAllowed&&affordable&&!alreadyPicked&&withinLimit,
      reason:!policy.allowed?policy.reasons[0]:!reachable?'not-reachable':!noticed?'not-noticed':!affordable?'budget':alreadyPicked?'already-picked':!withinLimit?'basket-limit':!actionAllowed?'not-allowed-action':fact.stock<=0?'stockout':'considered'};
  });
  const ranked=observations.filter(row=>row.eligible).sort((a,b)=>b.score-a.score||a.productId.localeCompare(b.productId));
  const selected=ranked[0],fact=selected&&context.observedProducts.find(p=>p.locationId===selected.locationId);
  const purchaseDraw=selected?randomAt(agentId,3000+stationFeature*31+PRODUCTS.findIndex(p=>p.id===selected.productId),seed):null;
  const wants=selected&&purchaseDraw<selected.purchaseProbability;
  const action=wants?{type:fact.stock>0?'pick':'stockout',productId:fact.productId,locationId:fact.locationId,reason:fact.stock>0?'local-score-and-seeded-choice':'intended-purchase-unavailable'}:{type:'skip',reason:selected?'seeded-no-purchase':'no-eligible-noticed-product'};
  return {engine:clone(ENGINE),behavior,action,observations,purchaseDraw,selectedScore:selected?.score??null,explanation:'명시적 구매 목표·금기와 제한된 문구 규칙을 적용하고 가격/남은 예산·기억·위치·이웃·행사 계수를 합산합니다. 일반적인 자연어 이해나 JEV 호출이 아닙니다.'};
}

/** Candidate-aware destination interest. The caller still validates an actual
 * walkable approach path before moving; this never fabricates navigation. */
export function rankStationInterest(world,agent,station) {
  const map=getMap(world.mapId),stationId=typeof station==='string'?station:station?.id??Object.keys(world.stations??{}).find(id=>world.stations[id]===station);
  const stationInfo=world.stations?.[stationId]??(typeof station==='object'?station:null);
  const fixtures=map.fixtures.filter(f=>f.station===stationId),behavior=deriveBehavior(agent.profile),modifiers=eventModifiers(world.activeEvents??getActiveEvents(world));
  const nearest=new Map();
  for(const fixture of fixtures)for(const placement of getFixturePlacements(fixture,world.scenario)) {
    if(fixture.type==='gondola'&&placement.side!==(fixture.side??1))continue;
    const product=PRODUCT_MAP[placement.productId],policy=productPolicy(agent.profile,product,{basket:agent.basket,spent:agent.spent,memory:agent.memory,behavior});
    const distance=Math.hypot(placement.position[0]-agent.position[0],placement.position[2]-agent.position[1]);
    const shelfStock=world.stock[product.id]??0,backroomStock=world.backroomStock?.[product.id]??0;
    const eyeFit=clamp(1-Math.abs(placement.position[1]-(agent.profile.age>=60?1.48:1.6))*.28,.4,1);
    const contributions={affinity:(agent.profile.affinity?.[product.category]??0)*.57,missionFit:policy.missionFit,
      pricePenalty:policy.pricePenalty,memory:policy.memoryAdjustment,eyeFit:eyeFit*.07,
      exactPosition:-Math.abs(placement.local[0])*.012-distance*.012,
      localEvent:clamp((modifiers.categoryMultipliers[product.category]-1)*.15+(modifiers.productBoosts[product.id]??0),-.1,.15)};
    const score=Object.values(contributions).reduce((sum,value)=>sum+value,.16);
    // A shopper may discover an empty shelf on arrival. Do not grant advance
    // omniscience of stock and erase the very unmet-demand events being tested.
    const eligible=policy.allowed;
    const row={productId:product.id,locationId:placement.locationId,position:[...placement.position],price:product.price,
      shelfStock,backroomStock,eligible,policy,contributions,score:eligible?score:-Infinity};
    if(!nearest.has(product.id)||row.score>nearest.get(product.id).score)nearest.set(product.id,row);
  }
  const products=[...nearest.values()],ranked=products.filter(row=>row.eligible).sort((a,b)=>b.score-a.score||a.productId.localeCompare(b.productId));
  return {stationId,score:ranked.length?Math.max(.01,ranked[0].score)+Math.min(.06,(ranked.length-1)*.01):-Infinity,
    eligibleProductIds:ranked.map(row=>row.productId),products,behavior,
    approachSlots:(stationInfo?.slots??[]).map(point=>[...point]),requiresPathValidation:true,
    reason:ranked.length?'policy-price-and-current-plan':'no-eligible-product'};
}
