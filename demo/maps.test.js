import test from 'node:test';
import assert from 'node:assert/strict';
import { STORE_MAPS, getMap, mapStations, checkoutPoint, fixtureBounds, localToWorld } from './maps.js';
import { createNavigation } from './navigation.js';
import { createWorld } from './world.js';
import { PRODUCTS } from './model.js';

test('floor plans have distinct geometry and consistent local-to-world transforms', () => {
  const maps=Object.values(STORE_MAPS);
  assert.equal(maps.length,9);
  assert.equal(new Set(maps.map(m=>JSON.stringify(m.fixtures))).size,9);
  assert.throws(()=>getMap('missing'),/Unknown store map/);
  const rotated=maps.find(m=>m.id==='express').fixtures[0];
  const p=localToWorld(rotated,[0,1.45]);
  assert.ok(Math.abs(p[0]-(rotated.x+1.45))<1e-9);
  assert.ok(Math.abs(p[1]-rotated.z)<1e-9);
  for(const map of maps){
    assert.equal(new Set(map.fixtures.map(f=>f.id)).size,map.fixtures.length);
    for(const fixture of map.fixtures){
      const [x0,x1,z0,z1]=fixtureBounds(fixture);
      assert.ok(x0>=-map.width/2&&x1<=map.width/2,`${map.id}/${fixture.id} width`);
      assert.ok(z0>=-map.depth/2&&z1<=map.depth/2,`${map.id}/${fixture.id} depth`);
    }
    for(let i=0;i<map.fixtures.length;i++)for(let j=i+1;j<map.fixtures.length;j++){
      const a=fixtureBounds(map.fixtures[i]),b=fixtureBounds(map.fixtures[j]);
      const overlapX=Math.min(a[1],b[1])-Math.max(a[0],b[0]);
      const overlapZ=Math.min(a[3],b[3])-Math.max(a[2],b[2]);
      assert.ok(overlapX<=.001||overlapZ<=.001,`${map.id}: ${map.fixtures[i].id} overlaps ${map.fixtures[j].id}`);
    }
  }
});

test('nine regions have distinct themes, real shelf widths and exterior props',()=>{
  const maps=Object.values(STORE_MAPS);
  assert.equal(new Set(maps.map(m=>m.region)).size,9);
  assert.equal(new Set(maps.map(m=>m.theme.floor)).size,9);
  assert.ok(new Set(maps.flatMap(m=>m.fixtures.filter(f=>f.type==='gondola').map(f=>f.scale))).size>=8);
  for(const map of maps){
    assert.ok(map.props.length>=2);
    for(const key of ['floor','wall','accent','shelf','prop'])assert.match(map.theme[key],/^#[0-9a-f]{6}$/i);
    for(const prop of map.props){assert.equal(prop.decorative,true);assert.ok(Math.abs(prop.x)>map.width/2+.5||Math.abs(prop.z)>map.depth/2+.5);}
  }
});

for(const map of Object.values(STORE_MAPS)){
  test(`${map.id}: entrance, exit, all stations and queue slots are connected`,()=>{
    const nav=createNavigation(map),stations=mapStations(map);
    assert.equal(Object.keys(stations).length,6);
    assert.ok(nav.isWalkable(...map.entry));assert.ok(nav.isWalkable(...map.exit));
    const targets=[map.exit,...Object.values(stations).flatMap(s=>s.slots)];
    for(let i=0;i<map.maxActive;i++)targets.push(checkoutPoint(map,i),checkoutPoint(map,i,true));
    for(const target of targets){
      const path=nav.findPath(map.entry,target);
      assert.ok(path.length,`${map.id}: unreachable ${target}`);
      assert.ok(path.every(p=>nav.isWalkable(...p)));
    }
    for(const fixture of map.fixtures){
      assert.equal(nav.isWalkable(fixture.x,fixture.z),false,`${fixture.id} must obstruct movement`);
    }
  });
  test(`${map.id}: 100 diverse visits complete without fixture/agent collisions`,()=>{
    const world=createWorld({limit:100,mapId:map.id}),nav=createNavigation(map);
    let minGap=Infinity;
    for(let i=0;i<24000&&world.completed<100;i++){
      world.update(.05);
      assert.ok(world.agents.length<=map.maxActive);
      for(let j=0;j<world.agents.length;j++){
        const a=world.agents[j];
        assert.ok(nav.isWalkable(...a.position));
        assert.ok(a.spent<=a.profile.budget);
        for(let k=j+1;k<world.agents.length;k++){
          const b=world.agents[k];
          if(a.state!=='done'&&b.state!=='done')minGap=Math.min(minGap,Math.hypot(a.position[0]-b.position[0],a.position[1]-b.position[1]));
        }
      }
    }
    world.update(.05);
    assert.equal(world.completed,100);assert.equal(world.agents.length,0);
    assert.ok(minGap>=.429,`minimum gap ${minGap}`);
    assert.ok(new Set(world.history.map(a=>a.visited.join(','))).size>=10);
    for(const a of world.history)assert.equal(new Set(a.visited).size,a.visited.length);
    assert.equal(world.paidRevenue,world.history.reduce((s,a)=>s+a.spent,0));
    assert.equal(PRODUCTS.reduce((s,p)=>s+p.stock-world.stock[p.id],0),world.paidUnits);
    assert.ok(Object.values(world.stock).every(n=>n>=0));
    assert.equal(world.snapshot().mapId,map.id);
    assert.ok(world.snapshot().averageTravel>10);
    assert.ok(world.snapshot().averageVisitTime>10);
  });
}

test('map instances do not overwrite each other and seeded replay is stable',()=>{
  const a=createWorld({mapId:'compact',limit:12}),b=createWorld({mapId:'express',limit:12});
  const reference=createWorld({mapId:'compact',limit:12});
  for(let i=0;i<120;i++){a.update(.5);b.update(.5);reference.update(.5);}
  assert.deepEqual(a.snapshot(),reference.snapshot());
  assert.notDeepEqual(a.stations,b.stations);
  const before=a.snapshot();a.update(0);assert.deepEqual(a.snapshot(),before);
});
