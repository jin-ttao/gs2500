import test from 'node:test';
import assert from 'node:assert/strict';
import { createSummaryReplay } from './summary-replay.js';
import { PROFILES, PRODUCTS } from './model.js';
import { recordDayRun } from './replay-recorder.js';
import { createNavigation } from './navigation.js';
import { getMap } from './maps.js';

const clone=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
function recording(overrides={}){
  const row=(time,revenue,stock)=>({time,stock:{water:stock},backroomStock:{water:10},shelfCapacity:{water:8},paidRevenue:revenue,paidGrossProfit:revenue*.3,paidUnits:revenue/1100,completed:revenue?1:0,averageTravel:1,averageVisitTime:10,day:{duration:86400,considered:time===86400?1000:20,entered:20,skipped:0,buyers:revenue?1:0},owner:{state:'idle',position:[1,1]}});
  const frames=[
    {time:100,position:[4.05,5.15],state:'walking',stateTime:0,basket:[]},
    {time:110,position:[4.05,4.7],state:'walking',stateTime:10,basket:[]},
    {time:120,position:[5,4.7],state:'browsing',stateTime:0,basket:[]},
    {time:125,position:[5,4.7],state:'reaching',stateTime:0,basket:[]},
    {time:128,position:[5,4.7],state:'walking',stateTime:0,basket:['water'],spent:1100},
    {time:132,position:[5,5.0],state:'paying',stateTime:0,basket:['water'],spent:1100},
    {time:135,position:[5,5.0],state:'exiting',stateTime:0,basket:['water'],spent:1100,paid:true,paidAt:135},
    {time:140,position:[5,5.2],state:'done',stateTime:0,basket:['water'],spent:1100,paid:true,paidAt:135},
  ].map(frame=>({heading:0,velocity:frame.state==='walking'||frame.state==='exiting'?1:0,speed:1,station:null,visited:[],spent:0,paid:false,reachLevel:2,...frame}));
  return {schemaVersion:'day-replay/1',id:'samsung:hq',runId:'recorded-1',mapId:'office',scenario:'hq',storeId:'samsung',seed:11,duration:86400,
    accounting:[row(0,0,8),row(43200,1100,7),row(80000,2200,6)],finalSnapshot:row(86400,3300,5),
    visits:[{id:2,profileIndex:0,profile:clone(PROFILES[0]),enteredAt:100,endedAt:140,frames}],ledgerSummary:{payments:3},...overrides};
}

test('default playback spans thirty presentation seconds at normal playback speed',()=>{
  const source=recording(),replay=createSummaryReplay([source]);
  assert.equal(replay.duration,30);assert.equal(replay.speed,1);
  assert.ok(replay.getSchedule(source.id).every(row=>row.duration>=18&&row.duration<=27));
  replay.start();replay.advance(15);
  assert.equal(replay.elapsed,15);assert.equal(replay.progress,.5);assert.equal(replay.dayTime,43200);
  assert.equal(replay.getAccounting(source.id).paidRevenue,1100);
  replay.advance(15);assert.equal(replay.isComplete,true);assert.equal(replay.elapsed,30);
  assert.deepEqual(replay.getAccounting(source.id),source.finalSnapshot);
});

test('playback speed changes never change the observed path or economic result at equal progress',()=>{
  const source=freeze(recording()),before=JSON.stringify(source),halfway=[],final=[];
  for(const speed of [.5,1,2]){
    const replay=createSummaryReplay([source]);replay.setSpeed(speed);replay.start();
    const frames=Math.round(15/speed*60);
    for(let frame=0;frame<frames;frame++)replay.advance(1/60);
    close(replay.elapsed,15);close(replay.progress,.5);
    halfway.push(replay.getWorld(source.id).snapshot());
    for(let frame=0;frame<frames;frame++)replay.advance(1/60);
    assert.equal(replay.isComplete,true);assert.equal(replay.running,false);
    final.push(replay.getAccounting(source.id));
    assert.deepEqual(replay.getWorld(source.id).agents,[]);
  }
  for(const snapshot of halfway)assert.deepEqual(snapshot,halfway[0]);
  for(const snapshot of final)assert.deepEqual(snapshot,source.finalSnapshot);
  assert.equal(JSON.stringify(source),before);
});

test('mid-play speed changes are continuous, pause and reset preserve speed, and finish never loops',()=>{
  const source=recording(),replay=createSummaryReplay([source]),world=replay.getWorld(source.id);
  replay.start();replay.advance(5);
  const atFive=world.snapshot();replay.setSpeed(.5);assert.deepEqual(world.snapshot(),atFive);
  replay.advance(4);assert.equal(replay.elapsed,7);
  const atSeven=world.snapshot();replay.setSpeed(2);assert.deepEqual(world.snapshot(),atSeven);
  replay.advance(4);assert.equal(replay.elapsed,15);assert.equal(replay.getAccounting(source.id).paidRevenue,1100);
  replay.pause();const paused=world.snapshot();replay.advance(100);
  assert.equal(replay.speed,2);assert.deepEqual(world.snapshot(),paused);
  replay.reset();assert.equal(replay.speed,2);assert.equal(replay.elapsed,0);assert.equal(replay.getWorld(source.id),world);
  replay.start();replay.advance(15);assert.equal(replay.isComplete,true);assert.equal(replay.elapsed,30);
  const completed=world.snapshot();replay.setSpeed(.5);replay.start();replay.advance(100);
  assert.equal(replay.running,false);assert.deepEqual(world.snapshot(),completed);
  for(const speed of [0,-1,.25,3,NaN,Infinity,'1'])assert.throws(()=>replay.setSpeed(speed),RangeError);
  assert.equal(replay.speed,.5);assert.equal(replay.elapsed,30);
});

test('stable visual worlds expose recorded visits separately from stepwise accounting',()=>{
  const replay=createSummaryReplay([recording()],{duration:10}),world=replay.getWorld('samsung:hq');
  assert.equal(replay.getWorld('recorded-1'),world);assert.equal(replay.duration,10);
  assert.equal(world.runId,'summary:recorded-1');assert.equal(world.sourceRunId,'recorded-1');
  assert.deepEqual(Object.keys(world.initialStock).sort(),PRODUCTS.map(product=>product.id).sort());
  assert.equal(world.initialStock.water,8);assert.equal(world.initialTotalStock.water,18);
  assert.equal(world.presentation.originalConcurrency,false);assert.equal(world.owner,null);
  assert.equal(replay.getAccounting('samsung:hq').paidRevenue,0);
  replay.start();replay.advance(4.9);assert.equal(replay.getWorld('samsung:hq'),world);
  assert.equal(replay.getAccounting('samsung:hq').paidRevenue,0,'no interpolated sales between checkpoints');
  replay.advance(.1);assert.equal(replay.getAccounting('samsung:hq').paidRevenue,1100);
  assert.equal(world.time,5);assert.equal(world.accountingTime,43200);assert.equal(replay.dayTime,43200);
  replay.advance(5);assert.equal(replay.isComplete,true);assert.equal(replay.running,false);
  assert.deepEqual(replay.getAccounting('samsung:hq'),recording().finalSnapshot);
  assert.deepEqual(world.agents,[]);assert.equal(world.time,10);assert.equal(world.owner,null);
  assert.equal(world.snapshot().paidRevenue,3300);assert.equal(world.snapshot().sourceTime,86400);
  assert.equal(world.initialStock.water,8,'initial renderer quantities do not become the final stock');
});

test('duration, frame rate and elapsed-time partitions cannot alter recorded economic outcomes',()=>{
  const source=recording(),ten=createSummaryReplay([source],{duration:10}),twenty=createSummaryReplay([source],{duration:20});
  ten.start();twenty.start();ten.advance(5);for(let i=0;i<600;i++)twenty.advance(1/60);
  close(ten.progress,twenty.progress);assert.deepEqual(ten.getAccounting(source.id),twenty.getAccounting(source.id));
  const a=ten.getWorld(source.id).agents[0],b=twenty.getWorld(source.id).agents[0];
  close(a.sourceTime,b.sourceTime);a.position.forEach((value,i)=>close(value,b.position[i]));
  ten.advance(5);for(let i=0;i<600;i++)twenty.advance(1/60);
  assert.equal(ten.isComplete,true);assert.equal(twenty.isComplete,true);
  assert.deepEqual(ten.getAccounting(source.id),twenty.getAccounting(source.id));
  assert.deepEqual(twenty.getAccounting(source.id),source.finalSnapshot);
});

test('pause freezes poses and totals, reset is deterministic, and completion never loops',()=>{
  const replay=createSummaryReplay([recording()],{duration:10}),world=replay.getWorld('samsung:hq');
  const initial=world.snapshot();replay.start();replay.advance(3);replay.pause();
  const paused=world.snapshot(),accounting=replay.getAccounting('samsung:hq');
  replay.advance(100);assert.deepEqual(world.snapshot(),paused);assert.equal(replay.time,3);
  assert.deepEqual(replay.getAccounting('samsung:hq'),accounting);
  replay.reset();assert.equal(replay.getWorld('samsung:hq'),world);assert.deepEqual(world.snapshot(),initial);
  replay.start();replay.advance(3);assert.deepEqual(world.snapshot(),paused);
  replay.advance(100);const final=world.snapshot();replay.start();replay.advance(100);assert.deepEqual(world.snapshot(),final);
  replay.start({reset:true});assert.equal(replay.running,true);assert.deepEqual(world.snapshot(),initial);
});

test('interpolation stays on adjacent recorded segments and preserves purchases as discrete observations',()=>{
  const source=recording(),replay=createSummaryReplay([source],{duration:10}),world=replay.getWorld(source.id),frames=source.visits[0].frames;
  replay.start();
  for(let step=0;step<1000;step++){
    replay.advance(.01);
    for(const agent of world.agents){
      const i=frames.findLastIndex(frame=>frame.time<=agent.sourceTime+1e-8),left=frames[i],right=frames[Math.min(i+1,frames.length-1)];
      const amount=right.time===left.time?0:(agent.sourceTime-left.time)/(right.time-left.time);
      left.position.forEach((value,j)=>close(agent.position[j],value+(right.position[j]-value)*amount));
      assert.equal(agent.state,left.state);assert.equal(agent.spent,left.spent);assert.equal(agent.paid,left.paid);
      assert.deepEqual(agent.basket.map(product=>product.id),left.basket);
      assert.ok(agent.sourceTime>=100&&agent.sourceTime<=140);
      assert.equal(agent.animationTimeScale,1);assert.ok(agent.timeScale>0);
      assert.equal(agent.profile.name,source.visits[0].profile.name);
    }
  }
  assert.equal(replay.isComplete,true);assert.deepEqual(world.agents,[]);
});

test('at most twelve real recorded visits overlap, each occupying 6–9 seconds in a ten-second summary',()=>{
  const source=recording(),original=source.visits[0];
  source.visits=Array.from({length:20},(_,id)=>({...clone(original),id,enteredAt:100+id*200,endedAt:140+id*200,frames:original.frames.map(frame=>({...clone(frame),time:frame.time+id*200}))}));
  const replay=createSummaryReplay([source],{duration:10}),schedule=replay.getSchedule(source.id);
  assert.equal(schedule.length,12);assert.equal(new Set(schedule.map(row=>row.id)).size,12);
  assert.ok(schedule.every(row=>row.duration>=6&&row.duration<=9&&row.start>=0&&row.end<=10+1e-8));
  const ids=new Set(source.visits.map(visit=>visit.id));replay.start();
  replay.advance(4);assert.ok(replay.getWorld(source.id).agents.length>1);
  assert.ok(replay.getWorld(source.id).agents.every(agent=>ids.has(agent.id)));
  assert.equal(replay.getWorld(source.id).presentation.originalConcurrency,false);
});

test('truncated visits end at their last actual recorded point without extrapolation',()=>{
  const source=recording(),visit=source.visits[0];visit.frames=visit.frames.slice(0,4);visit.truncated=true;visit.recordedUntil=125;visit.endedAt=1000;
  const replay=createSummaryReplay([source],{duration:10});replay.start();
  for(let i=0;i<100;i++){
    replay.advance(.1);
    for(const agent of replay.getWorld(source.id).agents){assert.ok(agent.sourceTime<=125);assert.equal(agent.recordedVisit.truncated,true);assert.equal(agent.paid,false);}
  }
  assert.equal(replay.getSchedule(source.id)[0].sourceEnd,125);assert.equal(replay.isComplete,true);
});

test('a recorded corner interval holds the prior real tick instead of cutting through collision padding',()=>{
  // Adjacent actual engine ticks observed in the express-map recorder smoke test.
  const source=recording({mapId:'express'}),visit=source.visits[0];
  visit.frames=visit.frames.slice(0,2).map((frame,index)=>({...frame,time:100+index*.05,
    position:index?[-2.429044311689883,7.554093074513943]:[-2.455467726744989,7.600214351634161]}));
  visit.enteredAt=100;visit.endedAt=100.05;
  const nav=createNavigation('express');assert.ok(visit.frames.every(frame=>nav.isWalkable(...frame.position)));
  const replay=createSummaryReplay([source],{duration:10});let held=0;replay.start();
  for(let i=0;i<1000;i++){
    replay.advance(.01);
    for(const agent of replay.getWorld(source.id).agents){
      assert.ok(nav.isWalkable(...agent.position));
      if(agent.presentation.interpolation==='recorded-tick-hold'){
        held++;assert.deepEqual(agent.position,visit.frames[0].position);assert.equal(agent.poseSourceTime,100);
      }
    }
  }
  assert.ok(held>0,'the fixture-boundary counterexample must exercise the safety fallback');
});

test('frozen source data is not mutated and callers receive detached accounting snapshots',()=>{
  const source=freeze(recording()),before=JSON.stringify(source),replay=createSummaryReplay([source],{duration:10});
  replay.start();replay.advance(5);
  const accounting=replay.getAccounting(source.id);accounting.stock.water=-10;accounting.day.entered=-10;
  assert.equal(replay.getAccounting(source.id).stock.water,7);assert.equal(replay.getAccounting(source.id).day.entered,20);
  const snapshot=replay.getWorld(source.id).snapshot();snapshot.stock.water=-20;
  assert.equal(replay.getWorld(source.id).stock.water,7);
  replay.advance(5);replay.reset();assert.equal(JSON.stringify(source),before);
});

test('invalid recording/controls are rejected, zero-sample recordings keep accounting without invented people',()=>{
  for(const duration of [0,-1,NaN,Infinity])assert.throws(()=>createSummaryReplay([recording()],{duration}),RangeError);
  assert.throws(()=>createSummaryReplay([]),TypeError);
  assert.throws(()=>createSummaryReplay([recording(),recording()]),TypeError);
  const source=recording({visits:[]}),replay=createSummaryReplay([source],{duration:10});
  assert.equal(replay.getWorld(source.id).agents.length,0);
  for(const delta of [-1,NaN,Infinity])assert.throws(()=>replay.advance(delta),RangeError);
  assert.throws(()=>replay.getWorld('missing'),RangeError);
  replay.start();replay.advance(10);assert.deepEqual(replay.getAccounting(source.id),source.finalSnapshot);
  const bad=recording();bad.accounting[0].time=1;assert.throws(()=>createSummaryReplay([bad]),RangeError);
  const reordered=recording();reordered.visits[0].frames[1].time=99;assert.throws(()=>createSummaryReplay([reordered]),RangeError);
});

test('actual frozen recorder output replays walkable observed paths and exact final accounting',()=>{
  const source=recordDayRun({population:30,duration:1800,scenario:'discovery',mapId:'office',storeId:'smoke',seed:11,runId:'smoke'},{freeze:true});
  const before=JSON.stringify(source),replay=createSummaryReplay([source],{duration:10}),nav=createNavigation(getMap(source.mapId));
  let observations=0;replay.start();
  for(let i=0;i<1000;i++){
    replay.advance(.01);
    for(const agent of replay.getWorld(source.runId).agents){
      assert.ok(nav.isWalkable(...agent.position),`${agent.id}: recorded route interpolation crossed a fixture`);
      assert.ok(source.visits.some(visit=>visit.id===agent.id));observations++;
    }
  }
  assert.ok(observations>1000);assert.equal(replay.isComplete,true);
  assert.deepEqual(replay.getAccounting(source.runId),source.finalSnapshot);
  const light=replay.getWorld(source.runId).snapshot({detail:false});
  for(const key of ['analytics','lastDecision','events','replenishmentEvents','agents'])assert.equal(key in light,false);
  assert.equal(light.paidRevenue,source.finalSnapshot.paidRevenue);assert.equal(light.sourceRunId,source.runId);
  assert.deepEqual(light.day,source.finalSnapshot.day);
  assert.ok('analytics' in replay.getWorld(source.runId).snapshot());
  assert.equal(JSON.stringify(source),before);
});
