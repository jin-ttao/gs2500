import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world.js';
import { PRODUCTS, SCENARIOS } from './model.js';
import { createDayPlan, splitDayInventory, dailyEventsFor } from './day.js';
import { createNavigation } from './navigation.js';

const zero=()=>Object.fromEntries(PRODUCTS.map(p=>[p.id,0]));
const total=value=>Object.values(value).reduce((sum,n)=>sum+n,0);
function conserved(world){
  const snap=world.snapshot({detail:false});assert.equal(snap.inventory.conserved,true);
  for(const p of PRODUCTS){
    assert.equal(world.initialTotalStock[p.id],world.stock[p.id]+world.backroomStock[p.id]+snap.inventory.unpaidUnitsBySKU[p.id]+world.paidUnitsBySKU[p.id]);
    assert.ok(world.stock[p.id]>=0&&world.stock[p.id]<=world.shelfCapacity[p.id]);assert.ok(world.backroomStock[p.id]>=0);
  }
}

test('a full 24-hour run considers exactly 1000 potential people, not 1000 forced visits',()=>{
  const world=createWorld({mode:'day',seed:73});world.update(86400);
  assert.equal(world.time,86400);assert.equal(world.isComplete,true);assert.equal(world.day.considered,1000);
  assert.equal(world.day.entered+world.day.skipped,1000);assert.ok(world.day.skipped>0);assert.ok(world.day.entered<1000);
  assert.equal(world.day.entered,world.spawned);assert.equal(world.day.completed,world.day.entered);assert.equal(world.day.inStore,0);
  assert.equal(world.day.buyers,world.buyers);assert.equal(world.day.completed,world.day.buyers+world.day.closedWithoutPurchase);
  assert.equal(world.day.hourly.length,24);
  for(const key of ['considered','entered','skipped','buyers','completed','paidUnits','paidRevenue'])assert.equal(world.day.hourly.reduce((sum,row)=>sum+row[key],0),world.day[key]);
  const ledger=world.exportLedger();assert.equal(ledger.events.filter(e=>e.type==='potentialConsidered').length,1000);
  assert.equal(ledger.events.at(-1).type,'dayEnded');assert.equal(ledger.events.at(-1).time,86400);
  assert.ok(ledger.events.every((e,i)=>e.time<=86400&&(!i||e.time>=ledger.events[i-1].time)));
  assert.equal(world.paidRevenue,ledger.events.filter(e=>e.type==='payment').reduce((sum,e)=>sum+e.amount,0));
  assert.ok(world.replenishments>0);conserved(world);
  const before=world.snapshot();world.update(99999);assert.deepEqual(world.snapshot(),before);
});

test('closed, not-needed and crowded potential arrivals are final refusals, never deferred',()=>{
  const closed=createWorld({mode:'day',population:40,duration:30,openingHours:[]});closed.update(30);
  assert.equal(closed.day.skippedReasons.closed,40);assert.equal(closed.spawned,0);
  const unneeded=createWorld({mode:'day',population:40,duration:30,entryProbability:0});unneeded.update(30);
  assert.equal(unneeded.day.skipped,40);assert.equal(unneeded.day.skippedReasons['not-needed']+unneeded.day.skippedReasons.closed,40);assert.equal(unneeded.spawned,0);
  const crowded=createWorld({mode:'day',population:1000,duration:30,entryProbability:1,maxActive:1});crowded.update(30);
  assert.equal(crowded.day.considered,1000);assert.ok(crowded.day.skippedReasons.crowded>900);assert.equal(crowded.day.entered+crowded.day.skipped,1000);
  const ids=crowded.exportLedger().events.filter(e=>e.type==='potentialConsidered').map(e=>e.potentialId);
  assert.equal(new Set(ids).size,1000);
});

test('cutoff returns actual unpaid baskets and never forces late checkout revenue',()=>{
  const world=createWorld({mode:'day',population:60,duration:90,entryProbability:1,seed:73,shelfCapacity:2,replenishment:{serviceSeconds:.2}});
  while(world.time<89.95){world.update(.05);conserved(world);}
  const beforeRevenue=world.paidRevenue,unpaid=world.agents.filter(a=>!a.paid).reduce((sum,a)=>sum+a.basket.length,0);
  assert.ok(unpaid>0,'fixture must exercise an unpaid basket at cutoff');
  world.update(10);assert.equal(world.time,90);assert.equal(world.paidRevenue,beforeRevenue);assert.equal(world.agents.length,0);
  assert.equal(total(world.returnedUnitsBySKU),unpaid);assert.equal(world.day.completed,world.day.entered);conserved(world);
  const ledger=world.exportLedger();assert.ok(ledger.events.some(e=>e.type==='basketReturned'));
  assert.ok(ledger.events.filter(e=>e.type==='payment').every(e=>e.time<90));
});

test('replenishment physically travels, services, and transfers only finite remaining backroom units',()=>{
  const world=createWorld({mode:'day',population:0,duration:200,totalStock:{...zero(),coffee:3},shelfStock:zero(),backroomStock:{...zero(),coffee:3},shelfCapacity:10,replenishment:{serviceSeconds:2}});
  const {isWalkable}=createNavigation(world.mapId),initialPosition=[...world.owner.position];
  assert.equal(world.isQuiescent(),false,'an idle worker with a job is not safe to skip');
  world.update(.05);assert.equal(world.owner.state,'walking');assert.equal(world.stock.coffee,0);assert.equal(world.backroomStock.coffee,3);
  let moved=false,sawService=false;
  while(world.replenishments===0&&world.time<150){
    const before=[...world.owner.position];world.update(.05);conserved(world);
    assert.ok(isWalkable(...world.owner.position));assert.ok(Math.hypot(world.owner.position[0]-before[0],world.owner.position[1]-before[1])<=world.owner.speed*.05+1e-8);
    moved||=Math.hypot(world.owner.position[0]-initialPosition[0],world.owner.position[1]-initialPosition[1])>.1;
    if(world.owner.state==='replenishing'){sawService=true;assert.equal(world.stock.coffee,0);}
  }
  assert.ok(moved&&sawService);assert.equal(world.replenishments,1);assert.equal(world.replenishedUnits,3);assert.equal(world.stock.coffee,3);assert.equal(world.backroomStock.coffee,0);
  assert.equal(world.owner.completedTasks,1);assert.equal(world.paidRevenue,0);
  const transfer=world.events.find(e=>e.type==='stockTransferred');assert.equal(transfer.quantity,3);assert.equal(transfer.shelfAfter-transfer.shelfBefore,3);assert.equal(transfer.backroomBefore-transfer.backroomAfter,3);
  assert.ok(world.replenishmentEvents.some(e=>e.type==='stockTransferred'));assert.ok(world.replenishmentEvents.every(Object.isFrozen));
  world.update(200);assert.equal(world.stock.coffee,3);assert.equal(world.replenishments,1,'no automatic supplier order');conserved(world);
  const snapshot=world.snapshot();snapshot.replenishmentEvents[0].message='changed';assert.notEqual(world.replenishmentEvents[0].message,'changed');
});

test('same-store candidates share potential times, personas and entry draws while stockouts distinguish shelf and store',()=>{
  const config={mode:'day',population:30,duration:120,seed:123,stockScale:0};
  const worlds=Object.keys(SCENARIOS).map(scenario=>createWorld({...config,scenario}));
  assert.deepEqual(worlds[0].potentialSchedule,worlds[1].potentialSchedule);assert.deepEqual(worlds[1].potentialSchedule,worlds[2].potentialSchedule);
  const empty=createWorld({...config,entryProbability:1});empty.update(120);
  assert.ok(empty.totalStockoutDemand>0);assert.equal(empty.shelfGapDemand,0);assert.equal(empty.paidUnits,0);conserved(empty);
  const gap=createWorld({...config,entryProbability:1,shelfStock:zero(),backroomStock:Object.fromEntries(PRODUCTS.map(p=>[p.id,4])),replenishment:{enabled:false}});gap.update(120);
  assert.ok(gap.shelfGapDemand>0);assert.equal(gap.totalStockoutDemand,0);assert.equal(gap.paidUnits,0);conserved(gap);
});

test('pause and arbitrary elapsed-time partitions preserve exact daily state including idle owner clocks',()=>{
  const config={mode:'day',population:14,duration:600,seed:42,runId:'daily-replay'};
  const a=createWorld(config),b=createWorld(config);a.update(300);
  for(let i=0;i<1000;i++){b.update(.11);b.update(.19);}
  assert.deepEqual(a.snapshot(),b.snapshot());
  const paused=b.snapshot();b.update(0);assert.deepEqual(b.snapshot(),paused);
  const light=b.snapshot({detail:false});assert.equal('analytics' in light,false);assert.equal('lastDecision' in light,false);assert.equal('events' in light,false);
  a.update(300);b.update(300);assert.deepEqual(a.snapshot(),b.snapshot());
});

test('daily assumptions, event boundaries, zero population, exact short cutoffs, and inputs remain explicit',()=>{
  const plan=createDayPlan({population:1000,seed:7,eventSchedule:dailyEventsFor('riverside')});
  assert.equal(plan.length,1000);assert.ok(plan.every((p,i)=>p.time>0&&p.time<=86400&&(!i||p.time>=plan[i-1].time)));
  assert.deepEqual(plan,createDayPlan({population:1000,seed:7,eventSchedule:dailyEventsFor('riverside')}));
  assert.ok(dailyEventsFor('riverside').every(e=>e.status==='assumed'&&e.start>=3600));
  const world=createWorld({mode:'day',population:0,duration:1.01,eventSchedule:[{id:'test',start:0,end:.5}]});world.update(999);
  assert.equal(world.time,1.01);assert.equal(world.isComplete,true);assert.equal(world.day.considered,0);
  const events=world.exportLedger().events;assert.equal(events.find(e=>e.type==='eventStarted').time,0);assert.equal(events.find(e=>e.type==='eventEnded').time,.5);
  assert.equal(world.engine.jev.called,false);assert.equal(world.exportLedger().provenance.events,'authored-daily-assumption');
  for(const config of [{mode:'bad'},{mode:'day',population:-1},{mode:'day',duration:0},{mode:'day',entryProbability:2},{mode:'day',openingHours:[[24,25]]},{mode:'day',shelfCapacity:-1},{mode:'day',replenishment:{speed:0}},{mode:'day',replenishment:{depot:[0,NaN]}}])assert.throws(()=>createWorld(config));
  assert.throws(()=>splitDayInventory({totalStock:{coffee:3},shelfStock:{coffee:2},backroomStock:{coffee:2}}));
  assert.throws(()=>splitDayInventory({shelfCapacity:1,shelfStock:{coffee:2}}));
});
