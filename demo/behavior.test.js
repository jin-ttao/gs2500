import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveBehavior,productPolicy} from './behavior.js';
import {ENGINE,buildDecisionContext,decideLocally,rankStationInterest} from './context.js';
import {PRODUCTS,PRODUCT_MAP,PROFILES,SCENARIOS} from './model.js';
import {getMap,mapStations} from './maps.js';
import {getFixturePlacements} from './merchandising.js';

const profile=(patch={})=>({...structuredClone(PROFILES[3]),budget:7000,...patch});
function fixtureContext(persona=profile(),station='promo',scenario='hq') {
  const map=getMap('office'),stations=mapStations(map);
  const world={mapId:map.id,scenario,runId:'behavior-test',storeId:'fixture',time:0,
    stations,stock:Object.fromEntries(PRODUCTS.map(p=>[p.id,8])),backroomStock:{},shelfCapacity:{},eventSchedule:[],activeEvents:[]};
  const agent={id:7,profileIndex:3,profile:persona,station,position:[...stations[station].slots[1]??stations[station].slots[0]],heading:stations[station].facing,spent:0,basket:[],memory:[]};
  return {world,agent,context:buildDecisionContext(world,agent)};
}

test('bounded mission phrases and typed overrides produce auditable hard constraints',()=>{
  const inferred=deriveBehavior(profile({mission:'생수만 구매',tags:['신상품 기피']}));
  assert.deepEqual(inferred.allowProductIds,['water']);assert.equal(inferred.avoidNew,true);
  assert.ok(inferred.evidence.some(row=>row.source==='mission'&&row.excerpt==='생수만 구매'));
  assert.ok(inferred.evidence.some(row=>row.source==='tag'&&row.rule==='explicit-new-product-avoidance'));
  const explicit=deriveBehavior(profile({mission:'생수만 구매',behavior:{allowProductIds:['rice'],avoidProductIds:['coffee'],avoidNew:false,priceSensitivity:2}}));
  assert.deepEqual(explicit.allowProductIds,['rice']);assert.equal(explicit.avoidNew,false);assert.equal(explicit.priceSensitivity,1);
  assert.ok(explicit.evidence.some(row=>row.source==='profile.behavior'));
  const unknown=deriveBehavior({mission:'달빛을 닮은 특별한 느낌',story:'별들이 흐르는 밤',tags:[]});
  assert.equal(unknown.allowProductIds,null);assert.deepEqual(unknown.preferredCategories,[]);assert.deepEqual(unknown.evidence,[]);
});

test('water-only goals forbid every other SKU even with high affinity or positive memory',()=>{
  const persona=profile({mission:'생수만 구매',affinity:{meal:1,drink:1,snack:1,health:1}});
  for(const product of PRODUCTS){
    const policy=productPolicy(persona,product,{memory:[{productId:product.id,liked:true}]});
    assert.equal(policy.allowed,product.id==='water',product.id);
    if(product.id!=='water')assert.ok(policy.reasons.includes('mission-product-not-allowed'));
  }
});

test('new-product avoidance is hard, existing products remain available',()=>{
  const persona=profile({mission:'간식 구매',tags:['신상품기피']});
  assert.equal(productPolicy(persona,PRODUCT_MAP.gummy).allowed,false);
  assert.ok(productPolicy(persona,PRODUCT_MAP.gummy).reasons.includes('avoids-new-products'));
  assert.equal(productPolicy(persona,PRODUCT_MAP.cracker).allowed,true);
});

test('typed and narrowly recognized negative memories alter choice; ordinary logs do not invent taboos',()=>{
  const persona=profile({mission:'간식 구매',story:'',tags:[]});
  assert.equal(productPolicy(persona,PRODUCT_MAP.gummy,{memory:[{type:'avoid',productId:'gummy'}]}).allowed,false);
  const negative=productPolicy(persona,PRODUCT_MAP.coffee,{memory:[{message:'다음에는 콜드브루를 사지 않기로 했다'}]});
  assert.equal(negative.allowed,false);assert.ok(negative.reasons.includes('memory-avoid'));
  assert.ok(negative.evidence.some(row=>row.source==='memory'));
  assert.equal(productPolicy(persona,PRODUCT_MAP.coffee,{memory:[{message:'콜드브루 재고가 없음'}]}).allowed,true);
  assert.equal(productPolicy(persona,PRODUCT_MAP.gummy,{memory:[{productId:'gummy',liked:true}]}).memoryAdjustment,.12);
});

test('affordable price increases incur a substantial utility penalty and exact-budget items remain eligible',()=>{
  const persona=profile(),cheap={...PRODUCT_MAP.gummy,price:1600},expensive={...cheap,price:6900};
  const a=productPolicy(persona,cheap),b=productPolicy(persona,expensive);
  assert.equal(a.allowed,true);assert.equal(b.allowed,true);assert.ok(a.pricePenalty-b.pricePenalty>.25);
  assert.equal(productPolicy({...persona,budget:1600},cheap).allowed,true);
  assert.equal(productPolicy({...persona,budget:1599},cheap).allowed,false);
  assert.equal(productPolicy(persona,cheap,{spent:5500}).allowed,false);
  assert.equal(productPolicy(persona,cheap,{basket:['gummy']}).allowed,false);
});

test('context allowed actions and seeded local choices enforce water-only and reachability',()=>{
  const {world,agent,context}=fixtureContext(profile({mission:'생수만 구매',tags:[]}));
  assert.equal(context.persona.story,agent.profile.story,'full raw story remains in external context');
  assert.ok(context.allowedActions.some(row=>row.productId==='water'&&row.type==='pick'));
  assert.ok(context.allowedActions.filter(row=>row.productId).every(row=>row.productId==='water'));
  assert.ok(context.observedProducts.every(row=>row.behaviorPolicy));
  for(let seed=0;seed<60;seed++){
    const result=decideLocally(context,seed);
    assert.ok(result.action.type==='skip'||result.action.productId==='water');
    assert.equal(result.engine.version,'3');
    assert.ok(result.observations.filter(row=>row.productId!=='water').every(row=>!row.eligible));
  }
  agent.position=[100,100];const distant=buildDecisionContext(world,agent);
  assert.deepEqual(distant.allowedActions,[{type:'skip'}]);
});

test('local decision score consumes actual price and memory, not only price affordability',()=>{
  const {context}=fixtureContext();
  const low=structuredClone(context),high=structuredClone(context);
  const cheap=low.observedProducts.find(row=>row.productId==='gummy'),expensive=high.observedProducts.find(row=>row.productId==='gummy');
  cheap.price=1600;expensive.price=6900;
  const a=decideLocally(low,42).observations.find(row=>row.productId==='gummy');
  const b=decideLocally(high,42).observations.find(row=>row.productId==='gummy');
  assert.ok(a.score-b.score>.25);assert.equal(a.utilityInputs.price,1600);assert.equal(b.utilityInputs.price,6900);
  high.memory=[{productId:'gummy',type:'avoid'}];
  const avoided=decideLocally(high,42).observations.find(row=>row.productId==='gummy');
  assert.equal(avoided.eligible,false);assert.equal(avoided.reason,'memory-avoid');
});

test('zero shelf stock offers unmet demand, never a pick action',()=>{
  const {world,agent}=fixtureContext(profile({mission:'생수만 구매',tags:[]}));
  world.stock.water=0;world.backroomStock.water=4;
  const context=buildDecisionContext(world,agent);
  assert.ok(context.allowedActions.filter(row=>row.productId==='water').every(row=>row.type==='record-unmet-demand'));
  assert.equal(context.allowedActions.some(row=>row.type==='pick'),false);
});

test('non-promotional SKU coordinates depend on candidate plans without changing fixture bases',()=>{
  const map=getMap('office');
  for(const fixture of map.fixtures.filter(row=>['gondola','fridge'].includes(row.type))){
    const a=getFixturePlacements(fixture,'hq'),b=getFixturePlacements(fixture,'owner');
    assert.equal(a.length,b.length);assert.deepEqual(a.map(row=>row.position),b.map(row=>row.position));
    assert.notDeepEqual(a.map(row=>row.productId),b.map(row=>row.productId),fixture.id);
    assert.ok(a.every(row=>row.merchandisingSource==='candidate-plan-projection'));
  }
});

test('station interest uses actual SKU constraints and candidate geometry, not station category alone',()=>{
  const {world,agent}=fixtureContext(profile({mission:'생수만 구매',tags:[]}));
  const water=rankStationInterest(world,agent,'drinks'),snack=rankStationInterest(world,agent,'snack');
  assert.deepEqual(water.eligibleProductIds,['water']);assert.equal(snack.score,-Infinity);
  assert.equal(water.requiresPathValidation,true);assert.ok(water.approachSlots.length);
  const hq=rankStationInterest(world,agent,'drinks');world.scenario='owner';const owner=rankStationInterest(world,agent,'drinks');
  assert.notDeepEqual(hq.products.find(row=>row.productId==='water').position,owner.products.find(row=>row.productId==='water').position);
  assert.equal(ENGINE.jev.called,false);assert.equal(Object.keys(SCENARIOS).length,4);
});
