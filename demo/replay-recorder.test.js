import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world.js';
import { LAB_STORES } from './lab.js';
import { recordDayRun, selectReplayPotentialIds } from './replay-recorder.js';
import { prepareRuns } from './replay-worker.js';

test('selection is deterministic, stratified, bounded and does not alter the cohort', () => {
  const schedule = Array.from({ length: 100 }, (_, id) => ({ id, entryDraw: id % 2 ? .9 : .1, needProbability: .5 }));
  const before = structuredClone(schedule), ids = selectReplayPotentialIds(schedule);
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12);
  assert.ok(ids.every(id => id % 2 === 0));
  assert.ok(ids[0] < 10 && ids.at(-1) > 90);
  assert.deepEqual(ids, selectReplayPotentialIds(schedule));
  assert.deepEqual(schedule, before);
  assert.deepEqual(selectReplayPotentialIds([]), []);
  assert.throws(() => selectReplayPotentialIds(schedule, 13), RangeError);
});

test('small-day snapshots and payments match an unmodified engine run exactly', () => {
  const config = { mode: 'day', population: 20, duration: 1800, scenario: 'discovery', mapId: 'office', storeId: 'test', seed: 11, runId: 'test-recording' };
  const progress = [], result = recordDayRun(config, { onProgress: value => progress.push(value), freeze: true });
  const reference = createWorld(config); reference.update(config.duration);
  assert.deepEqual(result.finalSnapshot, reference.snapshot());
  assert.deepEqual(result.accounting.map(row => row.time), [0, 900, 1800]);
  assert.deepEqual(result.ledgerSummary.paymentEvents.map(event => event.amount), reference.exportLedger().events.filter(event => event.type === 'payment').map(event => event.amount));
  assert.equal(result.ledgerSummary.originalEventCount, reference.ledgerCount);
  assert.equal(result.ledgerSummary.truncated, true);
  assert.ok(result.ledgerSummary.omittedEventTypes.includes('exposure'));
  assert.equal(progress[0].progress, 0); assert.equal(progress.at(-1).progress, 1);
  assert.ok(progress.every((value, i) => !i || value.time >= progress[i - 1].time));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.accounting[0].stock));
  assert.ok(result.visits.length <= 12);
  for (const visit of result.visits) {
    assert.ok(result.potentialIds.includes(visit.id));
    assert.ok(visit.frames.length > 0 && visit.frames.length <= 1000);
    assert.equal(visit.recordedUntil, visit.frames.at(-1).time);
    assert.ok(visit.frames.every((frame, i) => !i || frame.time > visit.frames[i - 1].time));
    assert.ok(visit.frames.every(frame => frame.position.length === 2 && frame.spent <= visit.profile.budget));
    assert.ok(visit.endedAt >= visit.recordedUntil);
  }
});

test('recorded poses and state transitions are sampled from real per-tick agents', () => {
  const config = { population: 12, duration: 120, seed: 11, scenario: 'hq', runId: 'pose-equality', entryProbability: 1 };
  const recording = recordDayRun(config), reference = createWorld({ ...config, mode: 'day' });
  const observations = new Map(recording.visits.map(visit => [visit.id, new Map(visit.frames.map(frame => [frame.time, frame]))]));
  const visits = new Map(recording.visits.map(visit => [visit.id, visit]));
  let checked = 0;
  while (!reference.isComplete) {
    const prior = reference.agents.slice(); reference.update(.05);
    const agents = new Map([...prior, ...reference.agents].map(agent => [agent.id, agent]));
    for (const [id, agent] of agents) {
      const frames = visits.get(id)?.frames;
      if (frames && reference.time >= frames[0].time && reference.time <= frames.at(-1).time) {
        const right = frames.findIndex(saved => saved.time >= reference.time);
        if (right > 0) {
          const from = frames[right - 1], to = frames[right], fraction = (reference.time - from.time) / (to.time - from.time);
          // No omitted bend, start, or stop may turn replay interpolation into an
          // invented shortcut or move an actor while it was actually stationary.
          for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(from.position[axis] + (to.position[axis] - from.position[axis]) * fraction - agent.position[axis]) < 1e-7);
        }
      }
      const saved = observations.get(id)?.get(reference.time); if (!saved) continue;
      assert.deepEqual(saved.position, agent.position);
      assert.equal(saved.heading, agent.heading); assert.equal(saved.state, agent.state);
      assert.equal(saved.stateTime, agent.stateTime); assert.equal(saved.velocity, agent.velocity);
      assert.deepEqual(saved.basket, agent.basket.map(product => product.id)); checked++;
    }
  }
  assert.equal(checked, recording.visits.reduce((sum, visit) => sum + visit.frames.length, 0));
  assert.ok(checked > 100);
});

test('empty and fractional days finish with exact final accounting and no invented visits', () => {
  for (const duration of [.03, .13, 1.03]) {
    const result = recordDayRun({ population: 0, duration, eventSchedule: [], seed: 11 });
    assert.equal(result.finalSnapshot.time, duration);
    assert.equal(result.accounting.at(-1).time, duration);
    assert.deepEqual(result.visits, []); assert.deepEqual(result.ledgerSummary.paymentEvents, []);
  }
  assert.throws(() => recordDayRun({ mode: 'visits' }), RangeError);
});

test('worker computes runs sequentially, forwards progress and isolates failures', async () => {
  const messages = [], order = [];
  await prepareRuns({ type: 'prepare', requestId: 'request', runs: [{ id: 'a', config: { id: 'a' } }, { id: 'b', config: { id: 'b' } }] }, {
    postMessage: message => messages.push(message),
    record: (config, { onProgress }) => { order.push(config.id); onProgress({ time: 0, duration: 1, progress: 0 }); if (config.id === 'b') throw new Error('private detail'); return { runId: 'a' }; },
  });
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(messages.filter(message => message.type === 'result').length, 1);
  assert.ok(messages.every(message => message.requestId === 'request'));
  assert.deepEqual(messages.at(-1), { type: 'complete', requestId: 'request', total: 2, succeeded: 1, failed: 1 });
  assert.equal(JSON.stringify(messages).includes('private detail'), false);
  const invalid = []; await prepareRuns({ type: 'prepare', runs: [] }, { postMessage: message => invalid.push(message) });
  assert.equal(invalid[0].type, 'error');
});

test('production Samsung A preserves the current policy engine result and bounded real recordings', { timeout: 60_000 }, () => {
  const store = LAB_STORES[0];
  const result = recordDayRun({ mode: 'day', population: 1000, duration: 86400, scenario: 'hq',
    mapId: store.mapId, storeId: store.id, seed: store.seed, stockScale: store.stockScale,
    profileWeights: store.profileWeights, runId: 'samsung-baseline' });
  assert.equal(result.finalSnapshot.time, 86400);
  assert.equal(result.finalSnapshot.day.considered, 1000);
  // Policy v3 deliberately changes the old five-template behavioural baseline.
  // The invariant here is replay = source engine, not the obsolete v2 revenue.
  const direct=createWorld(result.config);
  while(!direct.isComplete)direct.update(direct.isQuiescent()?Math.max(.05,direct.nextBoundary()-direct.time):.05);
  assert.equal(result.finalSnapshot.spawned, direct.spawned);
  assert.equal(result.finalSnapshot.buyers, direct.buyers);
  assert.equal(result.finalSnapshot.paidUnits, direct.paidUnits);
  assert.equal(result.finalSnapshot.paidRevenue, direct.paidRevenue);
  assert.equal(result.finalSnapshot.inventory.conserved, true);
  assert.equal(result.visits.length, 12);
  assert.ok(result.visits.every(visit => !visit.truncated && visit.frames.length <= 1000));
  assert.equal(result.accounting.length, 97);
  assert.equal(result.ledgerSummary.paymentEvents.reduce((sum, event) => sum + event.amount, 0), direct.paidRevenue);
  assert.equal(result.finalSnapshot.engine.jev.called, false);
});
