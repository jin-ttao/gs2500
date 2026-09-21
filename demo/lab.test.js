import test from 'node:test';
import assert from 'node:assert/strict';
import { createLab as createDailyLab, LAB_STORES } from './lab.js';
import { PRODUCT_MAP, SCENARIOS } from './model.js';

const unlimited = { budgetMs: Infinity };
// Keep the original finite-visit engine's regressions explicit. The browser now
// uses day mode; its horizon/admission/replenishment contracts have separate tests.
const createLab = options => createDailyLab({storeGroup:'everyday', ...options, mode:'visits'});
const candidateCount = LAB_STORES.length * Object.keys(SCENARIOS).length;
const nearlyEqual = (actual, expected, message) => assert.ok(
  Math.abs(actual - expected) < 1e-8,
  message ?? `${actual} should equal ${expected}`,
);

function actualRuns(lab) {
  const selectedId = lab.snapshot().selectedId;
  const runs = lab.snapshot().runs.map(({ id }) => {
    lab.select(id);
    return lab.getSelected();
  });
  lab.select(selectedId);
  return runs;
}

function worldStates(lab) {
  return actualRuns(lab).map(run => {
    // A fresh execution has a fresh identity throughout its decision/ledger records.
    // Compare every simulation value, excluding only those execution identities.
    return JSON.parse(JSON.stringify(run.world.snapshot(), (key, value) => key === 'runId' ? undefined : value));
  });
}

test('the explicit everyday group owns twelve independent worlds in three stores and four scenarios', () => {
  const lab = createLab({ limit: 20 });
  const runs = actualRuns(lab);
  assert.equal(LAB_STORES.length, 3);
  assert.equal(candidateCount, 12);
  assert.equal(runs.length, candidateCount);
  assert.equal(new Set(runs.map(run => run.id)).size, candidateCount);
  assert.equal(new Set(runs.map(run => run.world)).size, candidateCount);
  assert.equal(new Set(runs.map(run => run.world.stock)).size, candidateCount);
  assert.equal(new Set(runs.map(run => run.world.runId)).size, candidateCount);
  for (const scenario of Object.keys(SCENARIOS)) {
    assert.equal(runs.filter(run => run.world.scenario === scenario).length, 3);
  }
  assert.equal(lab.snapshot().completed, 0);
  assert.equal(lab.snapshot().total, candidateCount);
  assert.equal(lab.snapshot().time, 0);
  assert.equal(lab.snapshot().running, false);
});

test('a shared fixed-step clock advances all unfinished worlds together', () => {
  const lab = createLab({ limit: 20, speed: 16 });
  lab.start();
  const advance = lab.advance(.25, unlimited);
  nearlyEqual(advance.simulatedDelta, 4);
  assert.equal(advance.steps, 80);
  nearlyEqual(lab.snapshot().time, 4);
  for (const run of actualRuns(lab)) {
    nearlyEqual(run.world.time, lab.snapshot().time);
    assert.ok(run.world.spawned > 0);
    assert.ok(run.world.agents.length > 0);
  }
});

test('pause freezes poses and metrics even if further frame time arrives', () => {
  const lab = createLab({ limit: 20, speed: 16 });
  lab.start();
  lab.advance(1, unlimited);
  lab.pause();
  const before = worldStates(lab);
  const time = lab.snapshot().time;
  for (const delta of [.016, .1, 1, 2]) {
    const result = lab.advance(delta, unlimited);
    assert.equal(result.steps, 0);
    assert.equal(result.simulatedDelta, 0);
  }
  assert.deepEqual(worldStates(lab), before);
  assert.equal(lab.snapshot().time, time);
  lab.resume();
  lab.advance(.1, unlimited);
  assert.ok(lab.snapshot().time > time);
});

test('selection changes the observed world without resetting any run', () => {
  const lab = createLab({ limit: 20, speed: 16 });
  lab.start();
  lab.advance(.5, unlimited);
  const runs = actualRuns(lab);
  const before = worldStates(lab);
  for (const run of runs) {
    lab.select(run.id);
    assert.equal(lab.getSelected(), run);
    assert.equal(lab.snapshot().selectedId, run.id);
  }
  assert.deepEqual(worldStates(lab), before);
  assert.equal(lab.snapshot().running, true);
});

test('requested speed scales actual simulated time and motion', () => {
  const slow = createLab({ limit: 20, speed: 1 });
  const fast = createLab({ limit: 20, speed: 16 });
  slow.start();
  fast.start();
  slow.advance(1, unlimited);
  fast.advance(1, unlimited);
  nearlyEqual(fast.snapshot().time, 16 * slow.snapshot().time);
  assert.notDeepEqual(worldStates(slow), worldStates(fast));
  for (const speed of [1, 4, 16, 32, 64, 128]) {
    slow.setSpeed(speed);
    assert.equal(slow.snapshot().speed, speed);
  }
});

test('different frame partitions reproduce identical seeded world states', () => {
  const singleFrame = createLab({ limit: 20, speed: 16 });
  const manyFrames = createLab({ limit: 20, speed: 16 });
  singleFrame.start();
  manyFrames.start();
  singleFrame.advance(2, unlimited);
  for (let i = 0; i < 200; i++) manyFrames.advance(.01, unlimited);
  nearlyEqual(singleFrame.snapshot().time, manyFrames.snapshot().time);
  assert.deepEqual(worldStates(singleFrame), worldStates(manyFrames));
});

test('reset creates fresh worlds while preserving selection and playback speed', () => {
  const lab = createLab({ limit: 20, speed: 64 });
  const originalRuns = actualRuns(lab);
  const selectedId = originalRuns.at(-1).id;
  lab.select(selectedId);
  lab.start();
  lab.advance(.25, unlimited);
  lab.reset();
  assert.equal(lab.snapshot().time, 0);
  assert.equal(lab.snapshot().completed, 0);
  assert.equal(lab.snapshot().selectedId, selectedId);
  assert.equal(lab.snapshot().speed, 64);
  assert.equal(lab.snapshot().running, false);
  const resetRuns = actualRuns(lab);
  for (let i = 0; i < resetRuns.length; i++) {
    assert.notEqual(resetRuns[i].world, originalRuns[i].world);
    assert.notEqual(resetRuns[i].world.runId, originalRuns[i].world.runId);
    assert.equal(resetRuns[i].world.spawned, 0);
    assert.equal(resetRuns[i].world.paidRevenue, 0);
  }
  lab.start({ reset: true });
  assert.equal(lab.snapshot().running, true);
  assert.notEqual(lab.getSelected().world, resetRuns.at(-1).world);
});

test('invalid configuration and controls fail before changing the simulation', () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity, 10001]) {
    assert.throws(() => createLab({ limit }), RangeError);
  }
  assert.throws(() => createLab({ speed: 3 }), RangeError);
  const lab = createLab({ limit: 20 });
  const before = lab.snapshot();
  for (const speed of [0, -1, 2, NaN, Infinity, '16']) {
    assert.throws(() => lab.setSpeed(speed), RangeError);
  }
  for (const delta of [-1, NaN, Infinity]) {
    assert.throws(() => lab.advance(delta, unlimited), RangeError);
  }
  for (const budgetMs of [0, -1, NaN]) {
    assert.throws(() => lab.advance(.1, { budgetMs }), RangeError);
  }
  assert.throws(() => lab.select('missing:unknown'), RangeError);
  assert.deepEqual(lab.snapshot(), before);
});

test('an exhausted frame budget slows every world together and retains backlog', () => {
  const lab = createLab({ limit: 20, speed: 128 });
  lab.start();
  const result = lab.advance(1, { budgetMs: Number.MIN_VALUE });
  assert.equal(result.steps, 1);
  nearlyEqual(result.simulatedDelta, .05);
  assert.ok(lab.snapshot().backlog > 127);
  assert.ok(lab.snapshot().effectiveSpeed < lab.snapshot().speed);
  for (const run of actualRuns(lab)) nearlyEqual(run.world.time, .05);
  lab.pause();
  assert.equal(lab.snapshot().backlog, 0);
  const before = worldStates(lab);
  lab.resume();
  lab.advance(0, unlimited);
  assert.deepEqual(worldStates(lab), before);
});

test('all twelve everyday candidates finish bounded visits and preserve their final metrics', () => {
  const lab = createLab({ limit: 20, speed: 128 });
  lab.start();
  for (let i = 0; i < 10 && lab.snapshot().running; i++) {
    lab.advance(1, unlimited);
  }
  const result = lab.snapshot();
  assert.equal(result.completed, candidateCount,
    JSON.stringify(result.runs.map(run => ({ id: run.id, status: run.status, error: run.error, completed: run.completed }))));
  assert.equal(result.running, false);
  assert.equal(result.effectiveSpeed, 0);
  assert.equal(result.total, candidateCount);
  assert.ok(result.time <= 1280);
  for (const run of actualRuns(lab)) {
    assert.equal(run.status, 'complete');
    assert.equal(run.world.completed, 20);
    assert.equal(run.world.spawned, 20);
    assert.equal(run.world.agents.length, 0);
    assert.ok(run.world.paidRevenue > 0);
    assert.equal(run.world.paidRevenue, run.world.history.reduce((sum, agent) => sum + agent.spent, 0));
  }
  assert.ok(LAB_STORES.some(store => new Set(actualRuns(lab)
    .filter(run => run.store.id === store.id)
    .map(run => run.world.paidRevenue)).size > 1),
  'at least one store should produce different revenue across shelf candidates');
  const before = worldStates(lab);
  lab.start();
  lab.advance(1, unlimited);
  assert.deepEqual(worldStates(lab), before);
  assert.equal(lab.snapshot().running, false);
});

test('every displayed sale and profit is accounted for by actual payment events', () => {
  const lab = createLab({ limit: 12, speed: 1 });
  const runs = actualRuns(lab);
  const records = new Map(runs.map(run => [run.id, {
    lastEventId: -1, revenue: 0, units: 0, profit: 0, payments: 0, agents: new Set(),
  }]));
  let observedUnpaidBasket = false;
  lab.start();
  for (let tick = 0; tick < 20000 && lab.running; tick++) {
    lab.advance(.05, unlimited);
    for (const run of runs) {
      const record = records.get(run.id);
      const fresh = run.world.events.filter(event => event.id > record.lastEventId);
      for (const event of fresh) {
        assert.equal(event.id, record.lastEventId + 1, `${run.id}: event retention skipped an event`);
        record.lastEventId = event.id;
        if (event.type !== 'payment') continue;
        assert.equal(record.agents.has(event.agentId), false, 'a shopper cannot pay twice');
        record.agents.add(event.agentId);
        assert.equal(event.amount, event.productIds.reduce((sum, id) => sum + PRODUCT_MAP[id].price, 0));
        assert.equal(event.units, event.productIds.length);
        assert.equal(event.grossProfit, event.productIds.reduce((sum, id) => sum + PRODUCT_MAP[id].price - run.world.costs[id], 0));
        const shopper = run.world.agents.find(agent => agent.id === event.agentId);
        assert.ok(shopper?.paid);
        assert.equal(shopper.state, 'exiting');
        record.revenue += event.amount;
        record.units += event.units;
        record.profit += event.grossProfit;
        record.payments++;
      }
      if (run.world.paidRevenue === 0 && run.world.agents.some(agent => agent.basket.length && !agent.paid)) {
        observedUnpaidBasket = true;
      }
      assert.equal(run.world.paidRevenue, record.revenue);
      assert.equal(run.world.paidUnits, record.units);
      assert.equal(run.world.paidGrossProfit, record.profit);
      assert.equal(run.world.buyers, record.payments);
      const summary = run.world.snapshot();
      assert.equal(summary.paidRevenue, record.revenue);
      assert.equal(summary.paidGrossProfit, record.profit);
    }
  }
  assert.equal(lab.snapshot().completed, candidateCount);
  assert.ok(observedUnpaidBasket, 'putting an item into a basket must not book revenue');
  assert.ok([...records.values()].every(record => record.payments > 0));
});
