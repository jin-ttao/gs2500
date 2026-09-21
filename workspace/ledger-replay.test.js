import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateComparison} from './forecast.js';
import {createLedgerReplay,viewingPoint} from './ledger-replay.js';
import {STORES,PRODUCT_MAP} from './data.js';
import {createNavigation} from '../demo/navigation.js';

const comparisons=STORES.map(store=>({store,comparison:simulateComparison({storeId:store.id,bayId:store.bayId,populationPerDay:80})}));
const rows=comparisons.flatMap(({store,comparison})=>[comparison.baseline,...comparison.candidates].map(result=>({id:store.id+':'+result.candidateId,mapId:store.mapId,result})));

test('replay stays on one shared day and never changes its source accounting',()=>{
  const source=JSON.stringify(rows),replay=createLedgerReplay(rows);
  for(const day of [1,4,10,20,30]){
    replay.setDay(day).setSpeed(2).seek(.35);replay.advance(2);
    for(const row of rows){const data=replay.getRow(row.id);assert.equal(data.day,row.result.daily[day-1]);assert.equal(data.world.day,day);assert.ok(data.sampleCount<=12);}
  }
  assert.equal(JSON.stringify(rows),source);
});

test('card stocks come from the exact hourly ledger and close at the selected day total',()=>{
  const replay=createLedgerReplay(rows);
  for(const day of [1,20,30]){
    replay.setDay(day).seek(.5);
    for(const row of rows)assert.deepEqual(replay.getRow(row.id).world.stock,row.result.replay.timeline.find(bin=>bin.day===day&&bin.hour===11).shelfStock);
    replay.seek(1);
    for(const row of rows){const data=replay.getRow(row.id);assert.deepEqual(data.world.stock,data.day.shelfStock);assert.equal(data.world.agents.length,0);}
  }
});

test('visualized agents follow walkable routes and can only carry recorded purchases',()=>{
  const replay=createLedgerReplay(rows);
  const nav=new Map(STORES.map(store=>[store.mapId,createNavigation(store.mapId)]));
  let observed=0;
  for(const day of [1,10,20]){
    replay.setDay(day);
    for(let frame=0;frame<=100;frame++){
      replay.seek(frame/100);
      for(const row of rows){const data=replay.getRow(row.id),visits=new Map(data.visits.map(visit=>[visit.id,visit]));
        for(const agent of data.world.agents){
          observed++;assert.ok(nav.get(row.mapId).isWalkable(...agent.position));
          const visit=visits.get(agent.id);assert.equal(agent.sourceId,visit.sourceId);
          const purchased=new Set(visit.decisions.filter(item=>item.outcome==='purchased').map(item=>item.productId));
          for(const product of agent.basket)assert.ok(purchased.has(product.id));
          if(agent.state==='paying')assert.ok(visit.paidAmount>0);
        }
      }
    }
  }
  assert.ok(observed>100);
});

test('candidate display targets follow their own recorded SKU columns',()=>{
  const a=rows[0],b=rows[1];let changed=0;
  for(const sku of Object.keys(PRODUCT_MAP)){
    const pointA=viewingPoint(a.mapId,a.result.positions[sku]),pointB=viewingPoint(b.mapId,b.result.positions[sku]);
    if(JSON.stringify(pointA)!==JSON.stringify(pointB))changed++;
  }
  assert.ok(changed>0);
});

test('pause, seek and speed alter presentation only; invalid inputs fail clearly',()=>{
  const replay=createLedgerReplay(rows);replay.running=false;replay.advance(5);assert.equal(replay.elapsed,0);
  replay.seek(.5);const before=replay.elapsed;replay.running=true;replay.setSpeed(.5);replay.advance(2);assert.equal(replay.elapsed,before+1);
  assert.throws(()=>replay.seek(2));assert.throws(()=>replay.setDay(31));assert.throws(()=>replay.setSpeed(100));assert.throws(()=>replay.advance(-1));
  assert.throws(()=>createLedgerReplay([{id:'missing',result:{}}]));
});
