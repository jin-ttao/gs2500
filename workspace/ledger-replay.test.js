import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateComparison} from './forecast.js';
import {createLedgerReplay,viewingPoint,PERIOD_REPLAY_SECONDS} from './ledger-replay.js';
import {STORES,PRODUCT_MAP} from './data.js';
import {createNavigation} from '../demo/navigation.js';

const comparisons=STORES.map(store=>({store,comparison:simulateComparison({storeId:store.id,bayId:store.bayId,populationPerDay:80})}));
const rows=comparisons.flatMap(({store,comparison})=>[comparison.baseline,...comparison.candidates].map(result=>({id:store.id+':'+result.candidateId,mapId:store.mapId,result})));

test('period replay starts at zero and advances all rows on one shared clock',()=>{
  const replay=createLedgerReplay(rows);
  assert.equal(replay.duration,PERIOD_REPLAY_SECONDS);assert.equal(replay.day,1);assert.equal(replay.progress,0);
  for(const row of rows){const data=replay.getRow(row.id);assert.equal(data.cumulative.revenue,0);assert.equal(data.cumulative.entered,0);assert.equal(data.cumulative.profit,0);assert.equal(data.cumulative.replenishedUnits,0);assert.equal(data.checkpoint,null);assert.deepEqual(data.world.stock,row.result.initialInventory.shelf);}
  replay.advance(1.5);
  assert.equal(replay.day,2);assert.equal(replay.progress,1/30);
  for(const row of rows){const data=replay.getRow(row.id);assert.equal(data.cumulative.revenue,row.result.daily[0].revenue);assert.equal(data.dayCumulative.revenue,0);}
});

test('day jumps inspect a position within the whole period without changing source accounting',()=>{
  const source=JSON.stringify(rows),replay=createLedgerReplay(rows);
  for(const day of [1,4,10,20,30]){
    replay.seekDay(day,.35).setSpeed(2);
    for(const row of rows){const data=replay.getRow(row.id);assert.equal(data.day,row.result.daily[day-1]);assert.equal(data.world.day,day);assert.ok(data.sampleCount<=12);}
  }
  assert.equal(JSON.stringify(rows),source);
});

test('card stocks come from the exact hourly ledger and close at the selected day total',()=>{
  const replay=createLedgerReplay(rows);
  for(const day of [1,20,30]){
    replay.seekDay(day,.5);
    for(const row of rows)assert.deepEqual(replay.getRow(row.id).world.stock,row.result.replay.timeline.find(bin=>bin.day===day&&bin.hour===11).shelfStock);
    replay.seekDay(day,1);
    for(const row of rows){const data=replay.getRow(row.id);assert.deepEqual(data.world.stock,row.result.daily[day-1].shelfStock);}
  }
});

test('visualized agents follow walkable routes and can only carry recorded purchases',()=>{
  const replay=createLedgerReplay(rows);
  const nav=new Map(STORES.map(store=>[store.mapId,createNavigation(store.mapId)]));
  let observed=0;
  for(const day of [1,10,20]){
    for(let frame=0;frame<=100;frame++){
      replay.seekDay(day,frame/100);
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

test('day 30 completes once and every cumulative metric equals the source final',()=>{
  const replay=createLedgerReplay(rows);
  replay.advance(45);
  assert.equal(replay.progress,1);assert.equal(replay.day,30);assert.equal(replay.hour,24);assert.equal(replay.isComplete,true);
  const keys=['revenue','profit','paidUnits','payments','entered','potential','purchaseDemand','stockoutDemand','replenishedUnits','receivedUnits'];
  for(const row of rows){const data=replay.getRow(row.id);
    for(const key of keys)assert.equal(data.cumulative[key],row.result[key],`${row.id} ${key}`);
    assert.equal(data.cumulative.skipped,row.result.potential-row.result.entered);
    assert.equal(data.dayCumulative.revenue,row.result.daily[29].revenue);
    assert.deepEqual(data.world.stock,row.result.finalShelf);assert.deepEqual(data.world.backroomStock,row.result.finalBackroom);assert.equal(data.world.agents.length,0);
  }
  replay.advance(90).play().advance(45);assert.equal(replay.progress,1);
  replay.restart();assert.equal(replay.progress,0);assert.equal(replay.isComplete,false);assert.equal(replay.getRow(rows[0].id).cumulative.revenue,0);
  assert.equal(replay.running,false);replay.advance(100);
  for(const row of rows){const data=replay.getRow(row.id);assert.equal(data.cumulative.revenue,0);assert.equal(data.cumulative.entered,0);assert.equal(data.world.agents.length,0);assert.deepEqual(data.world.stock,row.result.initialInventory.shelf);assert.deepEqual(data.world.backroomStock,row.result.initialInventory.backroom);}
  replay.play().advance(1.5);assert.equal(replay.day,2);
});

test('seeking backward restores exact cumulative totals and inventories',()=>{
  const replay=createLedgerReplay(rows);
  for(const p of [.73,.12,.9,.001,0,.5,1,0]){
    replay.seek(p);
    for(const row of rows){const data=replay.getRow(row.id),bins=row.result.replay.timeline.filter(bin=>bin.endSecond<=p*30*86400+1e-7);
      assert.equal(data.cumulative.revenue,bins.reduce((sum,bin)=>sum+bin.revenue,0));
      assert.equal(data.cumulative.replenishedUnits,bins.reduce((sum,bin)=>sum+bin.replenishedUnits,0));
      assert.deepEqual(data.world.backroomStock,bins.at(-1)?.backroomStock??row.result.initialInventory.backroom);
    }
  }
});

test('duration and frame partitioning do not change accounting and four times speed is bounded',()=>{
  const a=createLedgerReplay([rows[0]],{duration:12}),b=createLedgerReplay([rows[0]],{duration:12});
  a.advance(9);for(let i=0;i<90;i++)b.advance(.1);
  assert.ok(Math.abs(a.progress-b.progress)<1e-12);assert.deepEqual(a.getRow(rows[0].id).cumulative,b.getRow(rows[0].id).cumulative);
  b.pause().advance(100);assert.ok(b.progress<1);b.play().setSpeed(4).advance(1);
  assert.equal(b.progress,1);assert.equal(b.getRow(rows[0].id).cumulative.revenue,rows[0].result.revenue);
  assert.throws(()=>createLedgerReplay(rows,{duration:NaN}));assert.throws(()=>createLedgerReplay(rows,{duration:Infinity}));assert.throws(()=>createLedgerReplay(rows,{duration:0}));
  for(const value of [NaN,Infinity,-Infinity]){assert.throws(()=>a.seek(value));assert.throws(()=>a.advance(value));assert.throws(()=>a.seekDay(1,value));}
});

test('nonuniform time partitions settle only completed bins, never prorated invented revenue',()=>{
  const result=structuredClone(rows[0].result),bins=result.replay.timeline;
  bins[0].endSecond=1800;bins[1].startSecond=1800;bins[1].endSecond=7200;
  const replay=createLedgerReplay([{...rows[0],result}]);
  replay.seek(1799/replay.totalSeconds);assert.equal(replay.getRow(rows[0].id).cumulative.revenue,0);
  replay.seek(1800/replay.totalSeconds);assert.equal(replay.getRow(rows[0].id).completedBins,1);assert.equal(replay.getRow(rows[0].id).cumulative.revenue,bins[0].revenue);
  replay.seek(7199/replay.totalSeconds);assert.equal(replay.getRow(rows[0].id).completedBins,1);
  replay.seek(7200/replay.totalSeconds);assert.equal(replay.getRow(rows[0].id).completedBins,2);
});

test('every day and hour boundary uses the same clock for labels and cumulative bins',()=>{
  const replay=createLedgerReplay([rows[0]]);
  for(let day=1;day<=30;day++){
    replay.setDay(day);const data=replay.getRow(rows[0].id);
    assert.equal(replay.day,day);assert.equal(replay.hour,0);assert.equal(data.dayCumulative.revenue,0);assert.equal(data.completedBins,(day-1)*24);
  }
  for(let hour=0;hour<=720;hour++){
    replay.seek(hour/720);const data=replay.getRow(rows[0].id);
    assert.equal(replay.day,Math.min(30,Math.floor(hour/24)+1));assert.equal(replay.hour,hour===720?24:hour%24);assert.equal(data.completedBins,hour);
    assert.equal(data.cumulative.revenue,hour?rows[0].result.replay.timeline[hour-1].cumulative.revenue:0);
  }
});

test('four-times playback advances positions, phase time and renderer clock four times as fast',()=>{
  const single=[rows[0]],normal=createLedgerReplay(single).seek(.015).setSpeed(1),fast=createLedgerReplay(single).seek(.015).setSpeed(4);
  const before=structuredClone(normal.getRow(rows[0].id).world.agents),startTime=normal.getRow(rows[0].id).world.time;
  normal.advance(.001);fast.advance(.001);
  const one=normal.getRow(rows[0].id).world,four=fast.getRow(rows[0].id).world;
  assert.ok(Math.abs((four.time-startTime)/(one.time-startTime)-4)<1e-9,'The renderer animation delta must scale with playback.');
  let checked=0;
  for(const original of before){
    const a=one.agents.find(row=>row.id===original.id),b=four.agents.find(row=>row.id===original.id);
    // Compare one straight walking segment, not a turn or an action boundary.
    if(!a||!b||original.state!=='walking'||a.state!==original.state||b.state!==original.state||Math.abs(a.heading-original.heading)>1e-9||Math.abs(b.heading-original.heading)>1e-9)continue;
    const d1=Math.hypot(a.position[0]-original.position[0],a.position[1]-original.position[1]);
    const d4=Math.hypot(b.position[0]-original.position[0],b.position[1]-original.position[1]);
    if(d1<1e-8)continue;
    checked++;assert.ok(Math.abs(d4/d1-4)<1e-8);assert.ok(Math.abs((b.stateTime-original.stateTime)/(a.stateTime-original.stateTime)-4)<1e-8);
    assert.ok(Math.abs((b.presentationAnimationTime-original.presentationAnimationTime)/(a.presentationAnimationTime-original.presentationAnimationTime)-4)<1e-8);
    assert.ok(Math.abs(a.presentationAnimationTime-original.presentationAnimationTime-.002)<1e-9,'Walking pose advances two animation seconds per presentation second, not 28x.');
    assert.equal(a.speed,b.speed,'Do not multiply the rig speed a second time: its clock already scales.');
  }
  assert.ok(checked>=3,'Several recorded agents must visibly move on their own paths.');
});

test('equal elapsed presentation time yields identical agents, stock and accounting at every speed',()=>{
  const reference=createLedgerReplay([rows[0]]).setSpeed(1).advance(7.25),expected=reference.getRow(rows[0].id);
  for(const speed of [.5,2,4]){
    const replay=createLedgerReplay([rows[0]]).setSpeed(speed).advance(7.25/speed),actual=replay.getRow(rows[0].id);
    assert.equal(replay.progress,reference.progress);assert.equal(actual.world.time,expected.world.time);
    assert.deepEqual(actual.world.agents,expected.world.agents);assert.deepEqual(actual.cumulative,expected.cumulative);
    assert.deepEqual(actual.world.stock,expected.world.stock);assert.deepEqual(actual.world.backroomStock,expected.world.backroomStock);
    replay.advance(100);assert.equal(replay.getRow(rows[0].id).cumulative.revenue,rows[0].result.revenue);
  }
});

test('presentation gait and nonwalking action poses are deterministic on seek and pause',()=>{
  const replay=createLedgerReplay([rows[0]]).seek(.015),first=structuredClone(replay.getRow(rows[0].id).world.agents);
  replay.pause().advance(20);assert.deepEqual(replay.getRow(rows[0].id).world.agents,first);
  replay.seek(.4).seek(.015);assert.deepEqual(replay.getRow(rows[0].id).world.agents,first);
  let inspected=0;
  for(let frame=1;frame<60;frame++){
    replay.seekDay(1,frame/60);
    for(const agent of replay.getRow(rows[0].id).world.agents){
      assert.ok(Number.isFinite(agent.presentationAnimationTime));
      if(agent.state!=='walking'){inspected++;assert.equal(agent.presentationAnimationTime,agent.stateTime);}
    }
  }
  assert.ok(inspected>10);
});
