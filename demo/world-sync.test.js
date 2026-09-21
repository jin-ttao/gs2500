import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world.js';
import { PRODUCTS, SCENARIOS } from './model.js';

function finish(world, seconds=1800) {
  for(let i=0;i<seconds&&world.completed<world.limit;i++)world.update(1);
  assert.equal(world.completed,world.limit,'all actual shoppers must leave');
  assert.equal(world.agents.length,0);
  return world;
}
const removedStock=world=>PRODUCTS.reduce((sum,p)=>sum+world.initialStock[p.id]-world.stock[p.id],0);

test('inventory, revenue, margin and buyers change at actual pick/payment transitions',()=>{
  const world=createWorld({limit:12,maxActive:1,seed:73,runId:'payment-audit'});
  let lastId=-1,revenue=0,profit=0,units=0,picks=0;
  const paidAgents=new Set();
  for(let tick=0;tick<30000&&world.completed<world.limit;tick++){
    const before=new Map(world.agents.map(a=>[a.id,{state:a.state,spent:a.spent,basket:[...a.basket]}]));
    const beforeRevenue=world.paidRevenue,beforeStock=removedStock(world);
    world.update(.05);
    const events=world.events.filter(e=>e.id>lastId);
    if(events.length)lastId=events.at(-1).id;
    const payments=events.filter(e=>e.type==='payment'),picked=events.filter(e=>e.type==='picked');
    assert.equal(world.paidRevenue-beforeRevenue,payments.reduce((sum,e)=>sum+e.amount,0));
    assert.equal(removedStock(world)-beforeStock,picked.length);
    for(const event of payments){
      const shopper=before.get(event.agentId),after=world.agents.find(a=>a.id===event.agentId);
      assert.equal(shopper.state,'paying');
      assert.equal(after.state,'exiting');
      assert.equal(after.paid,true);
      assert.equal(event.station,'checkout');
      assert.equal(event.time,world.time);
      assert.equal(event.amount,shopper.spent);
      assert.equal(event.units,shopper.basket.length);
      assert.equal(event.grossProfit,shopper.basket.reduce((sum,p)=>sum+p.price-world.costs[p.id],0));
      assert.ok(!paidAgents.has(event.agentId),'one payment per buyer');
      paidAgents.add(event.agentId);revenue+=event.amount;profit+=event.grossProfit;units+=event.units;
    }
    picks+=picked.length;
    assert.equal(world.paidRevenue,revenue);
    assert.equal(world.paidGrossProfit,profit);
    assert.equal(world.paidUnits,units);
    assert.equal(world.buyers,paidAgents.size);
    assert.equal(world.purchaseDemand,removedStock(world)+world.stockoutDemand+world.agents.filter(a=>a.pending).length);
  }
  assert.equal(world.completed,12);
  assert.ok(revenue>0&&profit>0&&units>0);
  assert.equal(picks,units,'every removed unit has been paid once all visits finish');
  assert.equal(world.history.reduce((sum,a)=>sum+a.spent,0),revenue);
});

test('shelf scenarios change real perception, selected baskets and paid results for the same cohort',()=>{
  const worlds=Object.keys(SCENARIOS).map(scenario=>finish(createWorld({limit:24,maxActive:4,seed:73,storeId:'shared-store',stockScale:2,scenario})));
  for(const world of worlds){
    assert.deepEqual(world.profileCounts,worlds[0].profileCounts);
    assert.ok(world.levels.every(row=>row.exposure>0&&row.notice<=row.exposure&&row.pick<=row.notice));
    assert.equal(removedStock(world),world.paidUnits);
    assert.ok(world.levels.reduce((sum,row)=>sum+row.pick,0)>0);
  }
  assert.ok(new Set(worlds.map(w=>w.paidRevenue)).size>1,'layout must affect completed payments');
  assert.ok(new Set(worlds.map(w=>JSON.stringify(w.stock))).size>1,'layout must affect actual stock');
  assert.ok(new Set(worlds.map(w=>JSON.stringify(w.levels))).size>1,'layout must affect the observed shelf funnel');
});

test('same seed replays exactly, independent stores vary, snapshots are detached JSON',()=>{
  const config={limit:20,maxActive:4,seed:1234,storeId:'seoul-a',scenario:'owner',runId:'repeatable'};
  const a=createWorld(config),b=createWorld(config),other=createWorld({...config,seed:1235,storeId:'seoul-b'});
  for(let i=0;i<120;i++){a.update(.5);b.update(.5);other.update(.5);}
  assert.deepEqual(a.snapshot(),b.snapshot());
  assert.notDeepEqual(a.snapshot().agents.map(p=>[p.profileIndex,p.speed]),other.snapshot().agents.map(p=>[p.profileIndex,p.speed]));
  const snap=a.snapshot();assert.deepEqual(JSON.parse(JSON.stringify(snap)),snap);
  assert.equal(snap.runId,'repeatable');assert.equal(snap.scenario,'owner');
  assert.ok(snap.events.length<=60);
  assert.ok(snap.events.every((e,i)=>i===0||(e.time>=snap.events[i-1].time&&e.id>snap.events[i-1].id)));
  const original=a.snapshot();a.update(0);assert.deepEqual(a.snapshot(),original);
  snap.stock.coffee=-100;snap.levels[0].pick=-100;snap.profileCounts[0]=-100;
  if(snap.agents.length){snap.agents[0].position[0]=-100;snap.agents[0].memory[0].message='changed';}
  if(snap.events.length)snap.events[0].message='changed';
  assert.deepEqual(a.snapshot(),original,'the UI must not be able to mutate simulation state through a snapshot');
  const seededA=createWorld({storeId:'store-a'}),seededB=createWorld({storeId:'store-b'});
  assert.notEqual(seededA.seed,seededB.seed);
});

test('empty shelves record unmet intended demand but never fabricate picks or payments',()=>{
  const world=finish(createWorld({limit:30,maxActive:4,seed:73,stockScale:0}));
  assert.ok(world.decisions>0);assert.ok(world.purchaseDemand>0);
  assert.equal(world.stockoutDemand,world.purchaseDemand);
  assert.equal(world.missedDemand,world.stockoutDemand);
  assert.equal(world.paidRevenue,0);assert.equal(world.paidGrossProfit,0);
  assert.equal(world.paidUnits,0);assert.equal(world.buyers,0);
  assert.equal(removedStock(world),0);
  assert.ok(Object.values(world.stock).every(n=>n===0));
  assert.ok(world.history.every(a=>a.spent===0&&a.paid===false&&a.basket.length===0));
  assert.ok(world.levels.every(row=>row.pick===0));
});

test('configuration and elapsed-time validation rejects invalid inputs',()=>{
  for(const config of [{limit:-1},{limit:1.2},{scenario:'missing'},{seed:NaN},{seed:-1},{seed:1.1},{maxActive:0},{stockScale:Infinity},{stockScale:-1},{stock:{coffee:-1}},{stock:{missing:1}},{stock:null},{profileWeights:[0,0,0,0,0]},{profileWeights:[1,2]},{runId:''},{storeId:''}]){
    assert.throws(()=>createWorld(config),undefined,JSON.stringify(config));
  }
  const world=createWorld({stockScale:.5,stock:{coffee:0}});
  assert.equal(world.stock.coffee,0);assert.equal(world.stock.chips,Math.floor(165*.5));
  for(const dt of [Infinity,NaN,-1,'1'])assert.throws(()=>world.update(dt),/dt must/);
  const empty=createWorld({limit:0});empty.update(100);assert.equal(empty.time,0);assert.equal(empty.spawned,0);
});
