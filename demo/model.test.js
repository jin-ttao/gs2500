import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS, PROFILES, SCENARIOS, randomAt, createExperiment, visit, simulate } from './model.js';

test('scenarios contain the same complete catalog exactly once', () => {
  assert.deepEqual(Object.keys(SCENARIOS), ['hq', 'owner', 'balanced', 'discovery']);
  assert.equal(new Set(Object.values(SCENARIOS).map(scenario => JSON.stringify(scenario.levels))).size, 4);
  for (const scenario of Object.values(SCENARIOS)) {
    assert.equal(scenario.levels.length, 4);
    assert.deepEqual(scenario.levels.flat().sort(), PRODUCTS.map(p => p.id).sort());
    assert.ok(scenario.levels.every(level => level.length === 6));
  }
});

test('the discovery candidate exposes every authored new product together without changing the catalog', () => {
  assert.equal(SCENARIOS.discovery.title, '신상품 탐색안');
  const newProducts = PRODUCTS.filter(product => product.isNew);
  assert.equal(newProducts.length, 5);
  assert.ok(newProducts.every(product => SCENARIOS.discovery.levels[1].includes(product.id)));
  assert.notDeepEqual(simulate('discovery').stock, simulate('hq').stock,
    'the different positions should change actual choices, not just the candidate label');
});

test('seeded visitors and full experiments are reproducible', () => {
  assert.deepEqual(simulate('hq'), simulate('hq'));
  for (let i = 0; i < 1000; i++) {
    const value = randomAt(i, 20);
    assert.ok(value >= 0 && value < 1);
  }
});

test('all scenarios account for inventory, prices, visits and shelf events', () => {
  for (const key of Object.keys(SCENARIOS)) {
    const result = simulate(key);
    assert.equal(result.count, 1000);
    let revenue = 0, units = 0;
    for (const product of PRODUCTS) {
      assert.ok(result.stock[product.id] >= 0);
      const sold = product.stock - result.stock[product.id];
      units += sold; revenue += sold * product.price;
    }
    assert.equal(result.revenue, revenue);
    assert.equal(result.units, units);
    assert.ok(result.buyers > 0 && result.buyers <= 1000);
    assert.equal(result.levels.reduce((sum, level) => sum + level.pick, 0), units);
    assert.equal(result.levels.reduce((sum, level) => sum + level.notice, 0), result.decisions);
    result.levels.forEach(level => {
      assert.equal(level.exposure, 6000);
      assert.ok(level.pick <= level.notice && level.notice <= level.exposure);
    });
  }
});

test('every visit obeys its persona budget and three-item basket limit', () => {
  for (const key of Object.keys(SCENARIOS)) {
    const result = createExperiment(key);
    for (let i = 0; i < 1000; i++) {
      const events = visit(result, i);
      const picked = events.filter(event => event.picked);
      assert.ok(picked.length <= 3);
      const profile = PROFILES[Math.floor(randomAt(i, 1) * PROFILES.length)];
      assert.ok(picked.reduce((sum, event) => sum + event.product.price, 0) <= profile.budget);
    }
  }
});

test('empty inventory does not produce phantom sales', () => {
  const result = createExperiment('hq');
  for (const id of Object.keys(result.stock)) result.stock[id] = 0;
  for (let i = 0; i < 100; i++) visit(result, i);
  assert.equal(result.revenue, 0);
  assert.equal(result.units, 0);
  assert.equal(result.buyers, 0);
});

test('layout changes decisions without a prescribed winning scenario', () => {
  const hq = simulate('hq'), owner = simulate('owner'), balanced = simulate('balanced');
  assert.notEqual(hq.revenue, owner.revenue);
  assert.ok(owner.revenue > balanced.revenue, 'the balanced candidate has no hard-coded uplift');
});
