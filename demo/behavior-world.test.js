import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from './world.js';
import {PRODUCT_MAP,PROFILES} from './model.js';
import {adaptPersonaRecord,createVisitPersona} from './personas.js';
import {deriveBehavior} from './behavior.js';
import {createDayPlan} from './day.js';

test('a ₩1,600 water-only mission reaches an actual fixture and can buy rather than exiting under a ₩1,700 cutoff',()=>{
  const personaCatalog=Array.from({length:12},(_,index)=>({...structuredClone(PROFILES[0]),
    name:'물 구매 검증 '+index,mission:'생수만 구매',story:'이번 방문에서는 생수만 구매합니다.',budget:1600,
    tags:[],source:{id:'hard-water-'+index},behavior:{allowProductIds:['water'],maxStops:3,priceSensitivity:.1},
    affinity:{meal:1,drink:1,snack:1,health:1}}));
  const world=createWorld({mode:'visits',limit:12,maxActive:3,personaCatalog,scenario:'balanced',mapId:'office',seed:11,runId:'hard-water'});
  for(let i=0;i<2400&&!world.isComplete;i++)world.update(1);
  assert.equal(world.isComplete,true);
  const ledger=world.exportLedger(),payments=ledger.events.filter(event=>event.type==='payment');
  assert.ok(ledger.events.some(event=>event.type==='destinationSelected'));
  assert.ok(ledger.events.some(event=>event.type==='browse'));
  assert.ok(payments.length>0,'an affordable water purchase must be possible');
  for(const payment of payments){assert.deepEqual(payment.productIds,['water']);assert.equal(payment.amount,PRODUCT_MAP.water.price);assert.ok(payment.amount<=1600);}
  assert.equal(world.paidRevenue,payments.reduce((sum,p)=>sum+p.amount,0));assert.equal(world.modelCalls,0);
});

test('a 00:49 visit keeps source school history without inventing a current between-class mission',()=>{
  const source={uuid:'time-compatible-student',age:21,occupation:'대학생',persona:'이 인물은 대학생으로 낮에는 수업을 듣습니다.',
    professional_persona:'오전과 오후에는 학교에서 수업을 듣고 공부합니다.',culinary_persona:'간식과 음료를 즐깁니다.'};
  const profile=adaptPersonaRecord(source,0),night=createVisitPersona(profile,49/60);
  assert.match(night.mission,/심야/);assert.doesNotMatch(night.mission,/수업\s*사이/);
  assert.equal(night.sourceNarratives.professional_persona,source.professional_persona);
  assert.equal(night.story,profile.story);assert.equal(night.visitContext.source,'authored-time-compatible-opportunity');
  const explicit=adaptPersonaRecord({...source,uuid:'explicit-water',shopping_mission:'생수만 구매'},1);
  const explicitNight=createVisitPersona(explicit,49/60);
  assert.match(explicitNight.mission,/생수만 구매/);assert.deepEqual(deriveBehavior(explicitNight).allowProductIds,['water']);
});

test('negative product memory prevents a payment for that SKU in an actual world',()=>{
  const personaCatalog=Array.from({length:12},(_,index)=>({...structuredClone(PROFILES[0]),
    mission:'생수만 구매',budget:1600,tags:[],source:{id:'avoid-water-'+index},
    memory:[{productId:'water',type:'avoid',message:'생수 구매 금지'}],behavior:{allowProductIds:['water'],maxStops:3}}));
  const world=createWorld({mode:'visits',limit:12,maxActive:3,personaCatalog,scenario:'hq',mapId:'office',seed:11,runId:'avoid-water'});
  for(let i=0;i<2400&&!world.isComplete;i++)world.update(1);
  assert.equal(world.isComplete,true);assert.equal(world.paidRevenue,0);
  assert.equal(world.exportLedger().events.filter(event=>event.type==='payment').length,0);
});

test('technical persona buckets do not change entry probability or purchasing behavior',()=>{
  const catalog=Array.from({length:12},(_,index)=>adaptPersonaRecord({uuid:'bucket-test-'+index,age:29,
    persona:'필요한 먹거리를 살펴보는 합성 인물입니다.',culinary_persona:'간식과 음료를 즐깁니다.'},index));
  const variants=[catalog,catalog.map(profile=>({...structuredClone(profile),archetypeIndex:(profile.archetypeIndex+2)%5}))];
  const schedules=variants.map(personaCatalog=>createDayPlan({population:12,duration:3600,seed:42,personaCatalog}));
  const relevant=rows=>rows.map(({profileIndex,...row})=>row);
  assert.deepEqual(relevant(schedules[0]),relevant(schedules[1]));
  const outcomes=variants.map((personaCatalog,index)=>{
    const world=createWorld({mode:'day',population:12,duration:3600,seed:42,personaCatalog,scenario:'discovery',mapId:'office',runId:'bucket-'+index});
    while(!world.isComplete)world.update(30);
    return world.exportLedger().events.filter(event=>['destinationSelected','payment','entrySkipped'].includes(event.type))
      .map(event=>({type:event.type,time:event.time,agentId:event.agentId,personaSourceId:event.personaSourceId,
        productIds:event.productIds,amount:event.amount,destination:event.destination,position:event.position,reason:event.reason}));
  });
  assert.deepEqual(outcomes[0],outcomes[1]);
});

test('individual assumed hourly weights actually change opportunities without changing identities',()=>{
  const make=weights=>Array.from({length:64},(_,index)=>({source:{id:'hourly-'+index},archetypeIndex:index%5,schedule:{hourlyWeights:weights}}));
  const common={population:64,duration:86400,seed:42,mapId:'office'};
  const neutral=createDayPlan({...common,personaCatalog:make(Array(24).fill(1))});
  const night=createDayPlan({...common,personaCatalog:make(Array.from({length:24},(_,hour)=>hour<6?3:.05))});
  assert.deepEqual(new Set(neutral.map(row=>row.personaSourceId)),new Set(night.map(row=>row.personaSourceId)));
  assert.ok(night.filter(row=>row.hour<6).length>neutral.filter(row=>row.hour<6).length);
  assert.notDeepEqual(night.map(row=>row.time),neutral.map(row=>row.time));
  assert.ok(night.every((row,index)=>index===0||night[index-1].time<=row.time));
});
