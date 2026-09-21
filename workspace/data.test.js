import test from 'node:test';
import assert from 'node:assert/strict';
import { STORES, BAYS, PRODUCTS, SCENARIOS, getStore, getBay, getCandidate, getInventory, getPlacements, getShelfRows, getWorldConfig } from './data.js';
import { STORE_CATALOG } from '../demo/lab.js';
import { getMap } from '../demo/maps.js';
import { getFixturePlacements } from '../demo/merchandising.js';
import { createWorld } from '../demo/world.js';

test('four workflow stores map to existing 3D identities, scales, maps and seeds', () => {
  assert.equal(STORES.length, 4); assert.equal(PRODUCTS.length, 24);
  assert.equal(new Set(STORES.map(s => s.id)).size, STORES.length);
  assert.equal(new Set(BAYS.map(b => `${b.storeId}:${b.id}`)).size, BAYS.length);
  for (const store of STORES) {
    const original = STORE_CATALOG.find(s => s.id === store.engineStoreId);
    assert.ok(original);
    for (const key of ['mapId','seed','stockScale','profileWeights']) assert.deepEqual(store[key], original[key]);
    const bay = getBay(store.id, store.bayId);
    assert.equal(bay.fixtureId, 'promo');
    assert.equal(bay.baselineScenario, 'hq');
    assert.deepEqual(bay.candidates.map(c => c.id), ['A','B','C']);
    assert.deepEqual(bay.candidates.map(c => c.scenario), ['owner','balanced','discovery']);
    for (const candidate of bay.candidates) assert.deepEqual(getCandidate(store.id, bay.id, candidate.id), candidate);
  }
});

test('every shelf position and neighbour is taken directly from the existing 3D placement contract', () => {
  for (const store of STORES) for (const scenario of Object.keys(SCENARIOS)) {
    const expected = getMap(store.mapId).fixtures.flatMap(f => getFixturePlacements(f, scenario));
    assert.deepEqual(getPlacements(store.id, scenario), expected);
    const rows = getShelfRows(store.id, scenario);
    assert.deepEqual(rows.map(row => row.level), [4,3,2,1]);
    assert.ok(rows.every(row => row.products.length === 6));
    assert.equal(new Set(rows.flatMap(row => row.products.map(p => p.productId))).size, 24);
    for (const row of rows) for (const p of row.products) {
      assert.ok(PRODUCTS.some(product => product.id === p.productId));
      assert.equal(p.stock, p.shelfStock+p.backroomStock);
      assert.ok(p.position.every(Number.isFinite));
    }
  }
});

test('world adapter uses the same per-SKU total, shelf, backroom and capacity', () => {
  for (const store of STORES) {
    const inventory = getInventory(store.id);
    const config = getWorldConfig({ storeId: store.id, bayId: store.bayId, candidateId: 'B' });
    const world = createWorld(config);
    assert.equal(config.scenario, 'balanced'); assert.equal(config.population, 1000);
    assert.deepEqual(world.initialTotalStock, inventory.total);
    assert.deepEqual(world.initialStock, inventory.shelf);
    assert.deepEqual(world.backroomStock, inventory.backroom);
    assert.deepEqual(world.shelfCapacity, inventory.capacity);
    for (const p of PRODUCTS) assert.equal(inventory.total[p.id], Math.floor(p.stock*store.stockScale));
  }
});

test('unknown and cross-store identifiers are rejected instead of selecting another store', () => {
  assert.throws(() => getStore('missing'), RangeError);
  assert.throws(() => getBay('H-0412','B-01'), RangeError);
  assert.throws(() => getCandidate('H-0412','B-03','D'), RangeError);
  assert.throws(() => getPlacements('H-0412','nonexistent'), RangeError);
  assert.throws(() => getWorldConfig({storeId:'H-0412',bayId:'B-01',candidateId:'A'}), RangeError);
});

test('one candidate cannot mutate another initial inventory or store definition', () => {
  const inventory = getInventory('H-0412'); inventory.total.coffee = 0;
  assert.equal(getInventory('H-0412').total.coffee, PRODUCTS.find(p => p.id === 'coffee').stock);
  assert.throws(() => { STORES[0].seed = 99; }, TypeError);
  assert.throws(() => { BAYS[0].candidates[0].scenario = 'hq'; }, TypeError);
});
