import test from 'node:test';
import assert from 'node:assert/strict';
import {createLab, SPEEDS, STORE_CATALOG, STORE_GROUPS} from './lab.js';
import {SCENARIOS} from './model.js';

const unlimited={budgetMs:Infinity};
const normalized=lab=>JSON.parse(JSON.stringify(lab.runs.map(run=>run.world.snapshot()),(key,value)=>key==='runId'?undefined:value));

test('the default experiment has nine stores, four alternatives and a slow shared 24-hour clock',()=>{
  const lab=createLab();
  assert.equal(lab.mode,'day');assert.equal(lab.duration,86400);assert.equal(lab.limit,1000);
  assert.equal(lab.speed,4);assert.ok(SPEEDS.includes(1800));
  assert.equal(lab.storeGroup,'all');assert.equal(lab.stores.length,9);
  assert.equal(STORE_CATALOG.length,9);assert.equal(new Set(STORE_CATALOG.map(store=>store.id)).size,9);
  assert.equal(lab.runs.length,36);assert.equal(new Set(lab.runs.map(run=>run.world)).size,36);
  assert.equal(Object.keys(SCENARIOS).length,4);
  for(const run of lab.runs){
    assert.equal(run.world.day.duration,86400);
    assert.equal(run.world.day.potentialTotal,1000);
    assert.equal(run.world.day.considered,0);
    assert.equal(run.world.isComplete,false);
  }
});

test('all four alternatives use the same potential cohort in each of the nine stores',()=>{
  const lab=createLab({limit:40});
  for(const store of STORE_CATALOG){
    const runs=lab.runs.filter(run=>run.store.id===store.id);
    assert.equal(runs.length,4);
    for(const run of runs.slice(1))assert.deepEqual(run.world.potentialSchedule,runs[0].world.potentialSchedule);
  }
});

test('selecting across all pages changes only selection and preserves every running world',()=>{
  const lab=createLab({limit:12,duration:600,speed:4});
  lab.start();lab.advance(1,unlimited);
  const worlds=lab.runs.map(run=>run.world),before=normalized(lab);
  for(const id of ['riverside:discovery','tourism:owner','park:balanced','samsung:hq']){
    lab.select(id);assert.equal(lab.getSelected().id,id);
    assert.equal(lab.running,true);assert.equal(lab.time,4);
    assert.deepEqual(lab.runs.map(run=>run.world),worlds);
  }
  assert.deepEqual(normalized(lab),before);
  lab.advance(1,unlimited);assert.equal(lab.time,8);
  assert.ok(lab.runs.every(run=>Math.abs(run.world.time-8)<1e-7));
});

test('explicit regional groups remain available without duplicating the all-store catalog',()=>{
  assert.deepEqual(STORE_GROUPS.map(group=>group.id),['all','everyday','destination','neighborhood']);
  for(const storeGroup of ['everyday','destination','neighborhood']){
    const lab=createLab({storeGroup,limit:1});
    assert.equal(lab.stores.length,3);assert.equal(lab.runs.length,12);
    assert.equal(new Set(lab.runs.map(run=>run.id)).size,12);
  }
});

test('a daily lab does not stop when no customers are inside and keeps all worlds on one clock',()=>{
  const lab=createLab({storeGroup:'everyday',limit:12,duration:600,speed:300});
  lab.start();lab.advance(.2,unlimited);
  assert.equal(lab.time,60);assert.equal(lab.running,true);
  for(const {world} of lab.runs)assert.ok(Math.abs(world.time-lab.time)<1e-7);
  lab.pause();const before=normalized(lab);
  lab.advance(100,unlimited);assert.deepEqual(normalized(lab),before);
});

test('day boundaries and shared seeds remain reproducible across frame partitions',()=>{
  const a=createLab({storeGroup:'everyday',limit:12,duration:600,speed:300});
  const b=createLab({storeGroup:'everyday',limit:12,duration:600,speed:300});
  a.start();b.start();a.advance(1,unlimited);
  for(let i=0;i<100;i++)b.advance(.01,unlimited);
  assert.equal(a.time,b.time);assert.deepEqual(normalized(a),normalized(b));
});

test('all twelve daily runs in an explicit regional group close at the horizon and account for every person',()=>{
  const lab=createLab({storeGroup:'everyday',limit:40,duration:600,speed:900});lab.start();lab.advance(1,unlimited);
  assert.equal(lab.time,600);assert.equal(lab.running,false);
  assert.equal(lab.snapshot().completed,12);
  for(const run of lab.runs){
    const {world}=run;assert.equal(run.status,'complete');assert.equal(world.time,600);assert.equal(world.isComplete,true);
    assert.equal(world.day.considered,40);assert.equal(world.day.entered+world.day.skipped,40);
    assert.ok(world.day.entered<40);assert.equal(world.agents.length,0);
    assert.ok(world.day.buyers<=world.day.entered);
    const ledger=world.exportLedger();
    assert.ok(ledger.events.every(event=>event.time<=600));
    assert.equal(ledger.events.filter(e=>e.type==='payment').reduce((sum,e)=>sum+e.amount,0),world.paidRevenue);
  }
  const before=normalized(lab);lab.start();lab.advance(10,unlimited);assert.deepEqual(normalized(lab),before);
});

test('all thirty-six worlds finish a bounded day across all nine map formats',()=>{
  const lab=createLab({limit:12,duration:180,speed:300});
  lab.start();lab.advance(1,unlimited);
  assert.equal(lab.time,180);assert.equal(lab.running,false);
  assert.equal(lab.snapshot().completed,36);
  for(const run of lab.runs){
    assert.equal(run.status,'complete',`${run.id}: ${run.error??'did not finish'}`);
    assert.equal(run.world.time,180);assert.equal(run.world.day.considered,12);
    assert.equal(run.world.day.entered+run.world.day.skipped,12);
    assert.equal(run.world.agents.length,0);
    assert.equal(run.world.paidRevenue,run.world.exportLedger().events.filter(event=>event.type==='payment').reduce((sum,event)=>sum+event.amount,0));
  }
});

test('invalid day configuration is rejected without changing an existing lab',()=>{
  for(const duration of [0,-1,NaN,Infinity,86401])assert.throws(()=>createLab({duration}),RangeError);
  assert.throws(()=>createLab({mode:'unknown'}),RangeError);
  const lab=createLab();const before=lab.snapshot();assert.throws(()=>lab.setStoreGroup('missing'),RangeError);assert.deepEqual(lab.snapshot(),before);
});

test('a final fractional tick closes exactly at a valid non-grid horizon',()=>{
  for(const duration of [.01,.03,.13,1.03]){
    const lab=createLab({limit:1,duration,speed:1});lab.start();lab.advance(duration,unlimited);
    assert.equal(lab.time,duration);assert.equal(lab.running,false);
    assert.ok(lab.runs.every(run=>run.status==='complete'&&run.world.time===duration));
  }
});
