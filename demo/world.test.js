import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld, findPath, STATIONS, isWalkable } from './world.js';
import { PRODUCTS } from './model.js';

test('all viewing slots have obstacle-free routes from the entrance',()=>{
  for(const station of Object.values(STATIONS))for(const target of station.slots){
    const route=findPath([4,5.15],target);
    assert.ok(route.length>0);
    assert.ok(route.every(point=>isWalkable(...point)));
  }
  assert.deepEqual(findPath([4,5.15],[1,1]),[]);
});
test('40 autonomous visits choose diverse goals and all leave without loops',()=>{
  const world=createWorld({limit:40});
  const states=new Set();let maxConcurrent=0,minGap=Infinity;
  for(let i=0;i<12000;i++){
    world.update(.05);maxConcurrent=Math.max(maxConcurrent,world.agents.length);
    for(const a of world.agents){
      states.add(a.state);assert.ok(isWalkable(...a.position));
      assert.ok(a.spent<=a.profile.budget);assert.ok(a.basket.length<=3);
      for(const b of world.agents)if(a!==b&&a.state!=='done'&&b.state!=='done')minGap=Math.min(minGap,Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1]));
    }
  }
  assert.equal(world.completed,40);assert.equal(world.agents.length,0);
  assert.ok(maxConcurrent<=14);assert.ok(minGap>=.429);
  for(const state of ['walking','browsing','reaching','queue','paying','exiting'])assert.ok(states.has(state),state);
  const routes=new Set(world.history.map(a=>a.visited.join(',')));
  assert.ok(routes.size>=10);
  for(const a of world.history)assert.equal(new Set(a.visited).size,a.visited.length);
  const expectedRevenue=world.history.reduce((sum,a)=>sum+a.spent,0);
  assert.equal(world.paidRevenue,expectedRevenue);
  const removed=PRODUCTS.reduce((sum,p)=>sum+(p.stock-world.stock[p.id]),0);
  assert.equal(removed,world.paidUnits);
});
test('simulation is seeded, respects pause (no update), and remains stable at fast-forward',()=>{
  const a=createWorld({limit:8}),b=createWorld({limit:8});
  for(let i=0;i<120;i++){a.update(.5);b.update(.5);}
  assert.deepEqual(a.snapshot(),b.snapshot());
  const before=a.snapshot();a.update(0);assert.deepEqual(a.snapshot(),before);
});
test('Blender GLB contains a real skin and every required motion',()=>{
  const buffer=fs.readFileSync(new URL('./assets/shopper.glb',import.meta.url));
  const json=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString());
  assert.equal(json.asset.version,'2.0');
  assert.equal(json.skins[0].joints.length,19);
  assert.deepEqual(json.animations.map(a=>a.name).sort(),['Idle','Walk','Carry','Browse','ReachMiddle','ReachLow','ReachHigh','Pay'].sort());
});
