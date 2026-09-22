import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateComparison, evaluateForecastIntent, FORECAST_ENGINE, simulateComparisonWithJev, replayComparisonWithJev, previewJevRequests } from './forecast.js';
import { STORES, PRODUCTS, getInventory, getPlacements } from './data.js';
import { readFile } from 'node:fs/promises';
import { adaptPersonaRecord, PERSONA_DATASET } from '../demo/personas.js';

const sum = list => list.reduce((a,b) => a+b, 0);
const base = { storeId:'H-0412', bayId:'B-03' };

test('30-day outputs are reproducible and candidate comparisons share all non-layout inputs', () => {
  const first = simulateComparison(base), second = simulateComparison(base);
  assert.deepEqual(first, second);
  assert.equal(first.completed, true); assert.equal(first.days, 30);
  assert.equal(first.engine.id, FORECAST_ENGINE.id); assert.equal(first.engine.jevCalled, false);
  assert.equal(first.baseline.scenario, 'hq'); assert.equal(first.baseline.candidateId, 'current');
  for (const result of [first.baseline, ...first.candidates]) {
    assert.equal(result.days, 30); assert.equal(result.daily.length, 30);
    assert.equal(result.cohortKey, first.cohortKey); assert.equal(result.inputFingerprint, first.inputFingerprint);
    assert.equal(result.potential, 30000);
    assert.deepEqual(result.initialInventory, getInventory(base.storeId));
    assert.deepEqual(result.daily.map(day => day.cohortKey), first.baseline.daily.map(day => day.cohortKey));
    assert.deepEqual(result.daily.map(day => day.entered), first.baseline.daily.map(day => day.entered));
    assert.deepEqual(result.daily.map(day => day.events), first.baseline.daily.map(day => day.events));
    assert.deepEqual(result.receivedBySKU, first.baseline.receivedBySKU);
  }
  assert.ok(new Set(first.candidates.map(c => c.revenue)).size > 1);
  for (const candidate of first.candidates) assert.equal(candidate.deltaPercent, (candidate.revenue-first.baseline.revenue)/first.baseline.revenue*100);
});

test('all four stores maintain daily inventory conservation, budget-bounded payments and exact totals', () => {
  for (const store of STORES) {
    const comparison = simulateComparison({ storeId:store.id,bayId:store.bayId });
    for (const result of [comparison.baseline,...comparison.candidates]) {
      for (const key of ['revenue','profit','paidUnits','payments','entered','purchaseDemand','stockoutDemand','replenishedUnits','receivedUnits']) assert.equal(result[key], sum(result.daily.map(day => day[key])));
      assert.equal(result.purchaseDemand, result.paidUnits+result.stockoutDemand);
      assert.equal(result.stockoutDemand, result.shelfGapDemand+result.totalStockoutDemand);
      assert.equal(result.stockoutRate, result.stockoutDemand/result.purchaseDemand);
      for (const product of PRODUCTS) {
        const id = product.id;
        assert.equal(result.initialInventory.total[id]+result.receivedBySKU[id], result.paidUnitsBySKU[id]+result.finalInventory[id]);
        assert.ok(result.finalInventory[id] >= 0);
        assert.ok(result.finalShelf[id] <= result.initialInventory.capacity[id]);
        assert.equal(result.finalShelf[id]+result.finalBackroom[id], result.finalInventory[id]);
      }
      for (const [index,day] of result.daily.entries()) {
        assert.equal(day.day,index+1);
        assert.equal(day.potential,day.entered+day.skipped);
        assert.ok(day.payments <= day.entered);
        assert.ok(day.paidUnits <= 2*day.payments);
        assert.ok(day.revenue <= day.payments*15000);
        assert.equal(day.revenue,sum(PRODUCTS.map(p => day.paidUnitsBySKU[p.id]*p.price)));
        assert.equal(day.profit,sum(PRODUCTS.map(p => day.paidUnitsBySKU[p.id]*(p.price-result.costs[p.id]))));
        for (const p of PRODUCTS) {
          assert.equal(day.openingInventory[p.id]+day.receivedBySKU[p.id],day.paidUnitsBySKU[p.id]+day.closingInventory[p.id]);
          if(index) assert.equal(day.openingInventory[p.id],result.daily[index-1].closingInventory[p.id]);
        }
      }
    }
  }
});

test('candidate placement inputs match the rendered promo coordinates, including columns and neighbours', () => {
  const comparison=simulateComparison({...base,populationPerDay:20});
  for(const result of [comparison.baseline,...comparison.candidates]) {
    const placements=getPlacements(base.storeId,result.scenario).filter(p=>p.fixtureId==='promo');
    for(const placement of placements) {
      const input=result.positions[placement.productId];
      assert.deepEqual(input.position,placement.position); assert.deepEqual(input.neighbors,placement.neighbors);
      assert.equal(input.level,placement.level); assert.equal(input.column,placement.column);
    }
  }
  assert.notDeepEqual(comparison.baseline.positions,comparison.candidates[0].positions);
});

test('zero total stock cannot create purchases or deliveries; empty locations are explicitly warned', () => {
  const comparison=simulateComparison({...base,populationPerDay:50,inventoryOverrides:{totalStock:Object.fromEntries(PRODUCTS.map(p=>[p.id,0]))}});
  for(const result of [comparison.baseline,...comparison.candidates]) {
    assert.equal(result.revenue,0); assert.equal(result.profit,0); assert.equal(result.paidUnits,0); assert.equal(result.receivedUnits,0);
    assert.equal(result.warnings.length,24); assert.equal(result.deltaPercent,0);
    assert.ok(result.stockoutDemand>0); assert.equal(result.stockoutRate,1);
  }
});

test('one zero-stock SKU is never sold even when its position is favourable', () => {
  const comparison=simulateComparison({...base,populationPerDay:100,inventoryOverrides:{totalStock:{coffee:0}}});
  for(const result of [comparison.baseline,...comparison.candidates]) {
    assert.equal(result.paidUnitsBySKU.coffee,0); assert.equal(result.receivedBySKU.coffee,0);
    assert.ok(result.warnings.some(w=>w.productId==='coffee'));
  }
});

test('staff replenishes only held backroom stock and toggling it never manufactures stock', () => {
  const withRestock=simulateComparison({...base,populationPerDay:100,deliveryScale:0});
  const without=simulateComparison({...base,populationPerDay:100,deliveryScale:0,replenishmentEnabled:false});
  assert.ok(withRestock.baseline.replenishedUnits>0); assert.equal(without.baseline.replenishedUnits,0);
  assert.ok(withRestock.baseline.paidUnits>without.baseline.paidUnits);
  assert.deepEqual(without.baseline.finalBackroom,without.baseline.initialInventory.backroom);
  assert.equal(withRestock.baseline.receivedUnits,0);
});

test('invalid periods, counts, stocks and cross-store inputs fail clearly', () => {
  for(const options of [
    {...base,days:29},{...base,populationPerDay:0},{...base,populationPerDay:NaN},{...base,populationPerDay:1.5},
    {...base,deliveryScale:Infinity},{...base,deliveryScale:-1},{...base,replenishmentEnabled:'yes'},
    {...base,inventoryOverrides:{totalStock:{coffee:-1}}},{...base,inventoryOverrides:{totalStock:{unknown:3}}},
    {...base,inventoryOverrides:{unknown:3}},{...base,bayId:'B-01'},
  ]) assert.throws(()=>simulateComparison(options));
});

test('full local NVIDIA cohort uses 1,000 distinct source records, not the five template buckets', async () => {
  const payload=JSON.parse(await readFile(new URL('../demo/data/nemotron-korea-sample.json',import.meta.url),'utf8'));
  const catalog=payload.records.map((entry,index)=>adaptPersonaRecord(entry.row,index,{...payload.source,rowIndex:entry.rowIndex}));
  const result=simulateComparison({...base,personaCatalog:catalog});
  assert.equal(result.engine.personaSource,PERSONA_DATASET);
  assert.equal(result.personaSource.dataset,PERSONA_DATASET);
  assert.equal(result.personaSource.count,1000);
  assert.equal(new Set(result.personaSource.sourceIds).size,1000);
  assert.ok(result.personaSource.sourceIds.every(id=>catalog.some(p=>p.source.id===id)));
  assert.ok(result.assumptions[1].includes('1,000')); assert.ok(!result.assumptions[1].includes('5개'));
  assert.ok(result.baseline.daily.every(row=>row.uniquePersonaCount===1000));
  for(const candidate of result.candidates) {
    assert.equal(candidate.personaSource,PERSONA_DATASET);
    assert.equal(candidate.cohortKey,result.baseline.cohortKey);
    assert.deepEqual(candidate.daily.map(day=>day.entered),result.baseline.daily.map(day=>day.entered));
  }
  // Technical drawing archetypes cannot alter source-person behaviour.
  const relabelled=catalog.map(p=>({...p,archetypeIndex:(p.archetypeIndex+3)%5}));
  const same=simulateComparison({...base,personaCatalog:relabelled});
  assert.equal(result.baseline.revenue,same.baseline.revenue);
  assert.deepEqual(result.candidates.map(c=>c.revenue),same.candidates.map(c=>c.revenue));
});

const constrainedPersona=(id,overrides={})=>({source:{id,dataset:'explicit-constraint-test-fixture',synthetic:true},name:'검사 인물',budget:1600,mission:'생수만 구매',story:'오늘은 생수만 구매합니다.',tags:[],affinity:{meal:.5,drink:.5,snack:.5,health:.5},behavior:{allowProductIds:['water'],priceSensitivity:.8,maxBasket:1},...overrides});

const mockJev=(request,{entered=true,buy=true}={})=>{
  const options=Object.keys(request.questions.purchase.criteria),choice=buy?(options.find(id=>id!=='none')??'none'):'none';
  return {model:'typesafe/jev-test',requestId:'test-request',upstreamRequestId:'test-upstream',latencyMs:10,usage:{cost:.00002},
    answers:{enter:{type:'noul',noul:entered?1:0},purchase:{type:'choice',choice,probabilities:Object.fromEntries(options.map(id=>[id,id===choice?1:0]))}}};
};

test('hybrid JEV overrides are applied to the same 30-day accounts and reproduce offline exactly',async()=>{
  const options={...base,populationPerDay:40};let calls=0;
  const comparison=await simulateComparisonWithJev(options,{decide:async request=>{calls++;return mockJev(request);}});
  assert.equal(calls,4);assert.equal(comparison.engine.jevCalled,true);
  assert.deepEqual(comparison.engine.decisionCoverage,{unit:'potential-person-plan-evaluations',jev:4,local:4796,total:4800,apiCalls:4,questionsPerCall:2,selection:'first-chronological-potential-person-on-day-one-shared-across-four-plans',maxJevItemsPerVisit:1});
  assert.equal(comparison.decisionAudit.length,4);
  for(const result of [comparison.baseline,...comparison.candidates]){
    const audit=comparison.decisionAudit.find(item=>item.candidateId===result.candidateId);
    const visit=result.replay.visits.find(item=>item.decisionSource==='jev');
    assert.equal(visit.sourceId,audit.sourceId);assert.equal(visit.id,audit.personId);assert.equal(visit.entered,true);
    assert.deepEqual(visit.decisions.map(item=>item.productId),audit.productId?[audit.productId]:[]);
    assert.equal(visit.paidAmount,audit.productId?PRODUCTS.find(p=>p.id===audit.productId).price:0);
    assert.equal(result.revenue,sum(result.replay.timeline.map(item=>item.revenue)));
    assert.equal(result.revenue,sum(PRODUCTS.map(p=>p.price*result.paidUnitsBySKU[p.id])));
    assert.equal(result.inputFingerprint,comparison.inputFingerprint);
    for(const product of PRODUCTS)assert.equal(result.initialInventory.total[product.id]+result.receivedBySKU[product.id],result.paidUnitsBySKU[product.id]+result.finalInventory[product.id]);
  }
  assert.deepEqual(replayComparisonWithJev(options,comparison.decisionRecords),comparison);
  const noEntry=await simulateComparisonWithJev(options,{decide:async request=>mockJev(request,{entered:false})});
  for(const [index,result] of [noEntry.baseline,...noEntry.candidates].entries()){
    const visit=result.replay.visits.find(item=>item.decisionSource==='jev');
    assert.equal(visit.entered,false);assert.equal(visit.paidAmount,0);assert.deepEqual(visit.decisions,[]);
    assert.equal([comparison.baseline,...comparison.candidates][index].entered,result.entered+1);
  }
  assert.notEqual(comparison.inputFingerprint,noEntry.inputFingerprint);
});

test('JEV receives full source story and exact plan positions, hard constraints and opening stock',async()=>{
  const catalog=Array.from({length:40},(_,i)=>constrainedPersona(`jev-water-${i}`,{story:'생수만 구매합니다. 원본 서사를 빠뜨리지 마세요.',schedule:{hourlyWeights:Array(24).fill(1)}}));
  const options={...base,populationPerDay:40,personaCatalog:catalog,inventoryOverrides:{shelfStock:{water:0}}};
  const requests=previewJevRequests(options);
  assert.equal(requests.length,4);assert.equal(new Set(requests.map(item=>item.request.state.visit.sourceId)).size,1);
  assert.ok(requests.every(item=>item.request.state.persona.story==='생수만 구매합니다. 원본 서사를 빠뜨리지 마세요.'));
  assert.ok(requests.every(item=>item.request.state.persona.schedule.hourlyWeights.length===24));
  for(const {candidateId,request} of requests){
    const resultScenario=candidateId==='current'?'hq':{A:'owner',B:'balanced',C:'discovery'}[candidateId];
    const positions=getPlacements(base.storeId,resultScenario).filter(p=>p.fixtureId==='promo');
    for(const product of request.state.products){
      const position=positions.find(p=>p.productId===product.id);
      assert.deepEqual(product.placement.position,position.position);assert.deepEqual(product.placement.neighbors,position.neighbors);
      if(product.id!=='water')assert.ok(product.blockedReasons.includes('mission-product-not-allowed'));
    }
    assert.ok(request.state.products.find(p=>p.id==='water').stock.shelf>0);
    assert.ok(Object.keys(request.questions.purchase.criteria).every(id=>id==='none'||id==='water'));
  }
  const empty={...options,inventoryOverrides:{totalStock:Object.fromEntries(PRODUCTS.map(p=>[p.id,0]))}};
  const result=await simulateComparisonWithJev(empty,{decide:async request=>{
    assert.deepEqual(Object.keys(request.questions.purchase.criteria),['none']);return mockJev(request);
  }});
  assert.equal(result.baseline.revenue,0);assert.ok(result.decisionAudit.every(a=>a.productId===null));
});

test('JEV errors, aborts, or tampered replay records fail without a completed local substitute',async()=>{
  const options={...base,populationPerDay:5};let calls=0;
  await assert.rejects(simulateComparisonWithJev(options,{decide:async()=>{calls++;throw new Error('upstream unavailable');}}),/upstream unavailable/);assert.equal(calls,1);
  const controller=new AbortController();controller.abort();
  await assert.rejects(simulateComparisonWithJev(options,{signal:controller.signal,decide:async()=>{calls++;}}));assert.equal(calls,1);
  const mid=new AbortController();
  await assert.rejects(simulateComparisonWithJev(options,{signal:mid.signal,decide:async request=>{mid.abort();return mockJev(request);}}));
  const valid=await simulateComparisonWithJev(options,{decide:async request=>mockJev(request)});
  const records=structuredClone(valid.decisionRecords);records[0].contextFingerprint='tampered';
  assert.throws(()=>replayComparisonWithJev(options,records),/일치/);
  await assert.rejects(simulateComparisonWithJev(options,{decide:async request=>({...mockJev(request),model:'openai/gpt-4o'})}),/JEV가 아닌/);
});

test('source-person budgets and water-only goals are causal, including the former 1,600-won failure', () => {
  const catalog=Array.from({length:100},(_,i)=>constrainedPersona(`water-${i}`));
  const comparison=simulateComparison({...base,populationPerDay:100,personaCatalog:catalog});
  for(const result of [comparison.baseline,...comparison.candidates]) {
    assert.ok(result.paidUnitsBySKU.water>0);
    for(const product of PRODUCTS.filter(p=>p.id!=='water'))assert.equal(result.paidUnitsBySKU[product.id],0);
    assert.equal(result.revenue,result.paidUnitsBySKU.water*1100);
    assert.ok(result.revenue<=result.payments*1600);
  }
  const noBudget=catalog.map(p=>({...p,budget:1000}));
  const blocked=simulateComparison({...base,populationPerDay:100,personaCatalog:noBudget});
  assert.equal(blocked.baseline.revenue,0);
  assert.notEqual(blocked.cohortKey,comparison.cohortKey);
});

test('new-product avoidance, typed memory and continuous price sensitivity affect intent', () => {
  const profile=constrainedPersona('test',{budget:7000,mission:'간식 구매',story:'가격을 고려하며 간식을 비교합니다.',behavior:{allowProductIds:null,priceSensitivity:.9,maxBasket:2}});
  const gummy=PRODUCTS.find(p=>p.id==='gummy');
  const cheap=evaluateForecastIntent(profile,gummy);
  const expensive=evaluateForecastIntent(profile,{...gummy,price:6900});
  assert.equal(cheap.allowed,true); assert.equal(expensive.allowed,true);
  assert.ok(cheap.probability>expensive.probability); assert.ok(cheap.pricePenalty>expensive.pricePenalty);
  const avoidNew=evaluateForecastIntent({...profile,behavior:{...profile.behavior,avoidNew:true}},gummy);
  assert.equal(avoidNew.allowed,false); assert.equal(avoidNew.probability,0);
  const remembered=evaluateForecastIntent({...profile,memory:[{type:'avoid',productId:'gummy'}]},gummy);
  assert.equal(remembered.allowed,false); assert.ok(remembered.reasons.includes('memory-avoid'));
});

test('malformed or duplicate source-person records cannot silently fall back to old templates', () => {
  for(const personaCatalog of [[],[constrainedPersona('same'),constrainedPersona('same')],[constrainedPersona('bad',{budget:-1})],[constrainedPersona('bad',{schedule:{hourlyWeights:[NaN]}})]]) {
    assert.throws(()=>simulateComparison({...base,populationPerDay:2,personaCatalog}),TypeError);
  }
});

test('the replay ledger reconciles every hourly payment and inventory movement to the same 30-day result', () => {
  const comparison=simulateComparison({...base,populationPerDay:75});
  for(const result of [comparison.baseline,...comparison.candidates]) {
    const {replay}=result;
    assert.equal(replay.source,'same-forecast-ledger'); assert.equal(replay.jevCalled,false);
    assert.equal(replay.timeline.length,30*24); assert.ok(replay.visits.length<=30*24);
    assert.equal(replay.cohortKey,result.cohortKey);
    let previousShelf=result.initialInventory.shelf, previousBackroom=result.initialInventory.backroom;
    const cumulative={potential:0,revenue:0,profit:0,paidUnits:0,payments:0,entered:0,purchaseDemand:0,stockoutDemand:0,replenishedUnits:0,receivedUnits:0};
    for(const [index,bin] of replay.timeline.entries()) {
      assert.equal(bin.startSecond,index*3600); assert.equal(bin.endSecond,(index+1)*3600);
      assert.equal(bin.day,Math.floor(index/24)+1); assert.equal(bin.hour,index%24);
      assert.equal(bin.potential,bin.entered+bin.skipped);
      assert.equal(bin.purchaseDemand,bin.paidUnits+bin.stockoutDemand);
      assert.equal(bin.revenue,sum(PRODUCTS.map(p=>p.price*bin.paidUnitsBySKU[p.id])));
      assert.equal(bin.profit,sum(PRODUCTS.map(p=>(p.price-result.costs[p.id])*bin.paidUnitsBySKU[p.id])));
      assert.equal(bin.stockoutDemand,sum(Object.values(bin.stockoutBySKU)));
      assert.equal(bin.receivedUnits,sum(bin.transfers.filter(t=>t.type==='delivery').map(t=>t.quantity)));
      assert.equal(bin.replenishedUnits,sum(bin.transfers.filter(t=>t.type==='replenishment').map(t=>t.quantity)));
      for(const product of PRODUCTS) {
        const id=product.id;
        const received=sum(bin.transfers.filter(t=>t.type==='delivery'&&t.productId===id).map(t=>t.quantity));
        const replenished=sum(bin.transfers.filter(t=>t.type==='replenishment'&&t.productId===id).map(t=>t.quantity));
        assert.equal(bin.shelfStock[id],previousShelf[id]+replenished-bin.paidUnitsBySKU[id]);
        assert.equal(bin.backroomStock[id],previousBackroom[id]+received-replenished);
        assert.ok(bin.shelfStock[id]>=0); assert.ok(bin.backroomStock[id]>=0);
      }
      previousShelf=bin.shelfStock; previousBackroom=bin.backroomStock;
      for(const key of Object.keys(cumulative)) {
        cumulative[key]+=bin[key]; assert.equal(bin.cumulative[key],cumulative[key]);
      }
      if(bin.hour===23) {
        const day=result.daily[bin.day-1], dayBins=replay.timeline.slice(index-23,index+1);
        for(const key of Object.keys(cumulative))assert.equal(day[key],sum(dayBins.map(item=>item[key])));
        assert.deepEqual(bin.shelfStock,day.shelfStock); assert.deepEqual(bin.backroomStock,day.backroomStock);
      }
    }
    for(const key of Object.keys(cumulative)) assert.equal(cumulative[key],result[key]);
    assert.deepEqual(previousShelf,result.finalShelf); assert.deepEqual(previousBackroom,result.finalBackroom);
  }
});

test('replay samples the same cohort people across plans and contains only decisions made by that calculation', () => {
  const comparison=simulateComparison({...base,populationPerDay:150});
  const cohortSamples=comparison.baseline.replay.visits.map(({id,day,hour,sourceId,second,budget})=>({id,day,hour,sourceId,second,budget}));
  for(const result of [comparison.baseline,...comparison.candidates]) {
    assert.deepEqual(result.replay.visits.map(({id,day,hour,sourceId,second,budget})=>({id,day,hour,sourceId,second,budget})),cohortSamples);
    assert.deepEqual(result.replay.timeline.map(bin=>[bin.potential,bin.entered,bin.sampleVisitId]),comparison.baseline.replay.timeline.map(bin=>[bin.potential,bin.entered,bin.sampleVisitId]));
    assert.equal(new Set(result.replay.visits.map(v=>`${v.day}:${v.hour}`)).size,result.replay.visits.length);
    for(const visit of result.replay.visits) {
      const bin=result.replay.timeline[(visit.day-1)*24+visit.hour];
      assert.ok(visit.second>=bin.startSecond&&visit.second<bin.endSecond);
      assert.equal(bin.sampleVisitId,visit.id); assert.ok(bin.entered>0);
      assert.equal(visit.paidAmount,sum(visit.decisions.map(d=>d.paidAmount)));
      assert.equal(visit.paidUnits,visit.decisions.filter(d=>d.outcome==='purchased').length);
      assert.ok(visit.paidAmount<=visit.budget); assert.ok(visit.paidAmount<=bin.revenue);
      for(const decision of visit.decisions) {
        const position=result.positions[decision.productId];
        assert.ok(visit.visibleProductIds.includes(decision.productId));
        assert.equal(decision.fixtureId,'promo'); assert.equal(decision.fixtureId,position.fixtureId);
        assert.equal(decision.locationId,position.locationId); assert.deepEqual(decision.position,position.position);
        assert.equal(decision.level,position.level); assert.equal(decision.column,position.column);
        if(decision.outcome==='purchased')assert.equal(decision.paidAmount,decision.price);
        else {assert.equal(decision.outcome,'shelf-empty');assert.equal(decision.paidAmount,0);}
      }
    }
  }
});

test('zero-stock replay cannot introduce animated purchases or ledger revenue', () => {
  const comparison=simulateComparison({...base,populationPerDay:40,inventoryOverrides:{totalStock:Object.fromEntries(PRODUCTS.map(p=>[p.id,0]))}});
  for(const result of [comparison.baseline,...comparison.candidates]) {
    assert.ok(result.replay.visits.length>0);
    assert.ok(result.replay.visits.some(v=>v.decisions.length>0));
    for(const visit of result.replay.visits) {
      assert.equal(visit.paidAmount,0); assert.equal(visit.paidUnits,0);
      assert.ok(visit.decisions.every(d=>d.outcome==='shelf-empty'));
    }
    for(const bin of result.replay.timeline) {
      assert.equal(bin.revenue,0); assert.equal(bin.cumulative.revenue,0);
      assert.equal(bin.transfers.length,0);
    }
  }
});
