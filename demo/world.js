import { PROFILES, PRODUCTS, PRODUCT_MAP, SCENARIOS, randomAt } from './model.js';

import { getMap, mapStations, checkoutPoint } from './maps.js';
import { createNavigation } from './navigation.js';

const defaultNavigation=createNavigation();
export const OBSTACLES=defaultNavigation.obstacles;
export const STATIONS=mapStations(getMap());
export const {isWalkable,findPath}=defaultNavigation;
export const STATE_NAMES={walking:'이동',browsing:'상품 비교',reaching:'상품 집기',queue:'계산 대기',paying:'결제',exiting:'퇴장',done:'방문 완료'};
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
// Authored demo assumptions: these are not measured shelf effects or supplier costs.
const NOTICE_BY_LEVEL=[.30,.75,.84,.38];
const COST_RATIO={meal:.71,drink:.64,snack:.62,health:.68};
const PROFILE_WEIGHTS={office:[.16,.38,.12,.16,.18],compact:[.25,.13,.30,.22,.10],express:[.10,.43,.10,.24,.13],residential:[.35,.10,.30,.15,.10],cafe:[.16,.24,.12,.36,.12]};
const storeSeed=id=>[...String(id)].reduce((seed,char)=>Math.imul(seed,31)+char.charCodeAt(0)>>>0,42);

export function createWorld({limit=1000,maxActive,scenario='hq',mapId='office',storeId=mapId,seed=storeSeed(storeId),runId='run-1',stockScale=1,stock,profileWeights=PROFILE_WEIGHTS[mapId]??[1,1,1,1,1]}={}) {
  if(!Number.isSafeInteger(limit)||limit<0)throw new RangeError('limit must be a nonnegative integer');
  if(!Object.hasOwn(SCENARIOS,scenario))throw new Error('Unknown shelf scenario: '+scenario);
  if(typeof storeId!=='string'||!storeId.trim())throw new TypeError('storeId must be a nonempty string');
  if(typeof runId!=='string'||!runId.trim())throw new TypeError('runId must be a nonempty string');
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('seed must be a uint32 integer');
  if(!Number.isFinite(stockScale)||stockScale<0)throw new RangeError('stockScale must be a nonnegative finite number');
  if(!Array.isArray(profileWeights)||profileWeights.length!==PROFILES.length||profileWeights.some(n=>!Number.isFinite(n)||n<0)||!Number.isFinite(profileWeights.reduce((s,n)=>s+n,0))||!profileWeights.some(n=>n>0))throw new TypeError('profileWeights must contain five nonnegative finite weights with a positive total');
  if(stock!==undefined&&(stock===null||typeof stock!=='object'||Array.isArray(stock)||Object.entries(stock).some(([id,n])=>!Object.hasOwn(PRODUCT_MAP,id)||!Number.isSafeInteger(n)||n<0)))throw new TypeError('stock must map known product ids to nonnegative integer quantities');
  const map=getMap(mapId),STATIONS=mapStations(map);
  const {findPath,isWalkable}=createNavigation(map);
  if(maxActive!==undefined&&(!Number.isSafeInteger(maxActive)||maxActive<1))throw new RangeError('maxActive must be a positive integer');
  maxActive=Math.min(maxActive??map.maxActive,map.maxActive);
  const initialStock=Object.fromEntries(PRODUCTS.map(p=>[p.id,stock?.[p.id]??Math.floor(p.stock*stockScale)]));
  if(Object.values(initialStock).some(n=>!Number.isSafeInteger(n)))throw new RangeError('Scaled stock must contain safe integer quantities');
  const costs=Object.fromEntries(PRODUCTS.map(p=>[p.id,Math.round(p.price*COST_RATIO[p.category]/10)*10]));
  const weights=[...profileWeights],weightTotal=weights.reduce((s,n)=>s+n,0);
  const random=(id,feature)=>randomAt(id,feature,seed);
  const world={time:0,spawned:0,completed:0,agents:[],history:[],queue:[],scenario,mapId,storeId,seed,runId,stations:STATIONS,totalTravel:0,totalVisitTime:0,
    initialStock,stock:{...initialStock},costs,paidRevenue:0,paidGrossProfit:0,paidUnits:0,buyers:0,decisions:0,purchaseDemand:0,stockoutDemand:0,missedDemand:0,
    levels:Array.from({length:4},(_,i)=>({level:i+1,exposure:0,notice:0,pick:0})),profileCounts:PROFILES.map(()=>0),profileWeights:weights,events:[],nextArrival:0,limit,maxActive};
  let nextEventId=0;
  function log(a,message){a.memory.unshift({time:world.time,message});a.memory.length=Math.min(a.memory.length,6);}
  function event(a,type,details={}){
    world.events.push({id:nextEventId++,type,time:world.time,agentId:a.id,profileIndex:a.profileIndex,station:a.station,productId:null,amount:0,message:'',...details});
    if(world.events.length>15)world.events.shift();
  }
  function miss(a,product,level){
    world.stockoutDemand++;world.missedDemand++;
    const message=product.name+' 구매 희망 · 품절로 담지 못함';log(a,message);
    event(a,'stockout',{productId:product.id,level,amount:product.price,picked:false,reason:'stockout',message});
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
      let interest=id==='promo'?.58:a.profile.affinity[s.category];
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
  function spawn() {
    const id=world.spawned;
    let sample=random(id,1)*weightTotal,profileIndex=weights.length-1;
    for(let i=0;i<weights.length;i++){sample-=weights[i];if(sample<0){profileIndex=i;break;}}
    const profile=PROFILES[profileIndex];
    const entry=[map.entry[0]+(random(id,701)-.5)*.8,map.entry[1]];
    if(world.agents.some(a=>distance(a.position,entry)<.65))return;
    const a={id,profileIndex,profile,position:entry,heading:Math.PI,speed:.85+random(id,4)*.5,
      state:'walking',station:null,target:null,path:[],pathIndex:0,visited:[],basket:[],spent:0,
      maxStops:profileIndex===1?2:2+Math.floor(random(id,8)*2),memory:[],blocked:0,paid:false,paidAt:null,
      stateTime:0,timer:0,pending:null,reachLevel:2,travel:0,enteredAt:world.time};
    world.agents.push(a);world.spawned++;world.profileCounts[profileIndex]++;
    log(a,'입장 · '+profile.mission);event(a,'enter',{message:profile.mission});chooseDestination(a);
    world.nextArrival=world.time+2.8+random(id,702)*2.5;
  }
  function decide(a) {
    const station=STATIONS[a.station];a.pending=null;
    const atPromo=a.station==='promo',noticed=[];
    // Shelf exposure happens only when this actual shopper reaches this actual fixture.
    for(const id of station.products){
      const p=PRODUCT_MAP[id],k=PRODUCTS.indexOf(p),level=atPromo?SCENARIOS[scenario].levels.findIndex(row=>row.includes(id))+1:2+Math.floor(random(a.id,402)*2);
      const funnel=atPromo?world.levels[level-1]:null;if(funnel)funnel.exposure++;
      const visible=random(a.id,1000+Object.keys(STATIONS).indexOf(a.station)*30+k)<(atPromo?NOTICE_BY_LEVEL[level-1]:.9);
      if(!visible)continue;
      if(funnel)funnel.notice++;world.decisions++;
      const affordable=a.spent+p.price<=a.profile.budget,alreadyPicked=a.basket.some(b=>b.id===id);
      const reason=!affordable?'budget':alreadyPicked?'already-picked':'noticed';
      event(a,'decision',{productId:id,level,reason,picked:false,message:p.name+' 비교'+(!affordable?' · 예산 제약':alreadyPicked?' · 이미 담은 상품':'')});
      if(affordable&&!alreadyPicked)noticed.push({product:p,level,score:a.profile.affinity[p.category]+random(a.id,50+k)*.18});
    }
    noticed.sort((p,q)=>q.score-p.score);
    const choice=noticed[0],product=choice?.product;
    const pick=product&&random(a.id,300+a.visited.length)<.24+a.profile.affinity[product.category]*.69;
    if(pick){
      world.purchaseDemand++;
      event(a,'intent',{productId:product.id,level:choice.level,amount:product.price,reason:'purchase-intent',message:product.name+' 구매 선택'});
      if(world.stock[product.id]===0){miss(a,product,choice.level);chooseDestination(a);return;}
      a.pending=product;
      a.reachLevel=choice.level;
      a.state='reaching';a.timer=2.2;a.stateTime=0;log(a,product.name+' 집기 · '+a.reachLevel+'층');
    } else {log(a,'비교 후 이동 · '+(product?'현재 선호와 맞지 않음':'상품 미인지 또는 예산 제약'));chooseDestination(a);}
  }
  function arrived(a) {
    a.velocity=0;a.stateTime=0;
    if(a.targetKind==='exit') {
      a.state='done';world.completed++;world.totalTravel+=a.travel;world.totalVisitTime+=world.time-a.enteredAt;log(a,'방문 완료');
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
        event(a,'picked',{productId:p.id,level:a.reachLevel,amount:p.price,picked:true,reason:'picked',message:p.name+'을 장바구니에 담음'});
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
  world.update=dt=>{
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('dt must be a nonnegative finite number');
    // Fixed small steps keep collision checking valid even when the UI uses fast-forward.
    let remaining=dt;
    while(remaining>1e-9&&world.completed<limit){
      const step=Math.min(.05,remaining);remaining-=step;world.time+=step;
      world.agents=world.agents.filter(a=>a.state!=='done');
      if(world.spawned<limit&&world.agents.length<maxActive&&world.time>=world.nextArrival)spawn();
      for(const a of world.agents)advance(a,step);
      world.agents=world.agents.filter(a=>a.state!=='done');
    }
  };
  world.snapshot=()=>({mapId,storeId,scenario,seed,runId,limit,maxActive,averageTravel:world.completed?world.totalTravel/world.completed:0,averageVisitTime:world.completed?world.totalVisitTime/world.completed:0,time:world.time,spawned:world.spawned,completed:world.completed,active:world.agents.length,
    paidRevenue:world.paidRevenue,paidGrossProfit:world.paidGrossProfit,paidUnits:world.paidUnits,buyers:world.buyers,decisions:world.decisions,purchaseDemand:world.purchaseDemand,stockoutDemand:world.stockoutDemand,missedDemand:world.stockoutDemand,
    initialStock:{...initialStock},stock:{...world.stock},costs:{...costs},profileCounts:[...world.profileCounts],profileWeights:[...weights],levels:world.levels.map(row=>({...row})),events:world.events.map(e=>({...e,...(e.productIds?{productIds:[...e.productIds]}:{})})),
    agents:world.agents.map(a=>({id:a.id,profileIndex:a.profileIndex,state:a.state,station:a.station,position:[...a.position],heading:a.heading,speed:a.speed,visited:[...a.visited],basket:a.basket.map(p=>p.id),spent:a.spent,paid:a.paid,paidAt:a.paidAt,blocked:a.blocked,travel:a.travel,enteredAt:a.enteredAt,pending:a.pending?.id??null,reachLevel:a.reachLevel,memory:a.memory.map(m=>({...m}))}))});
  return world;
}
