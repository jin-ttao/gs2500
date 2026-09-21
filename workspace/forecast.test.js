import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateComparison, evaluateForecastIntent, FORECAST_ENGINE } from './forecast.js';
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
