import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JEV_MODEL, buildJevQuestion, canonicalContext, decodeJevEvaluation, createJevDecisionProvider } from './jev.js';

const entry = () => ({ schemaVersion: 'entry-context/1', runId: 'fixture', time: 100,
  persona: { story: 'Finished work and needs dinner.', sourceFacts: { age: 30 }, sourceNarratives: { food: 'Vegetarian.' } },
  memory: [], observer: { agentId: 1 }, constraints: { open: true, hasCapacity: true },
  allowedActions: [{ type: 'enter' }, { type: 'pass' }], currentNeed: { source: 'authored-assumption', needProbability: .5 } });
const answer = (choice = 'a0', probabilities = { a0: .75, a1: .25 }) => ({ model: JEV_MODEL, answers: { decision: { type: 'choice', choice, probabilities } } });
const responseFor = context => ({ decision: decodeJevEvaluation(context, answer(), { requestId: 'test-request',
  contextHash: createHash('sha256').update(canonicalContext(context)).digest('hex'), latencyMs: 5, usage: { inputTokens: 10 }, cost: null }) });

test('entry and destination decisions preserve exact allowed action semantics and hard exclusions', () => {
  const context = entry(), before = structuredClone(context);
  assert.deepEqual(buildJevQuestion(context).actions, context.allowedActions);
  assert.equal(decodeJevEvaluation(context, answer()).action.type, 'enter');
  context.constraints.open = false;
  assert.deepEqual(buildJevQuestion(context).actions, [{ type: 'pass' }]);
  context.constraints.open = true; context.constraints.hasCapacity = false;
  assert.deepEqual(buildJevQuestion(context).actions, [{ type: 'pass' }]);
  const destination = { ...before, schemaVersion: 'destination-context/1',
    destinations: [{ stationId: 'fresh', reachable: true }, { stationId: 'snack', reachable: false }],
    allowedActions: [{ type: 'visit', stationId: 'fresh' }, { type: 'visit', stationId: 'snack' }, { type: 'leave' }] };
  assert.deepEqual(buildJevQuestion(destination).actions, [{ type: 'visit', stationId: 'fresh' }, { type: 'leave' }]);
  const decoded = decodeJevEvaluation(destination, answer());
  assert.equal(decoded.action.stationId, 'fresh'); assert.equal(decoded.purchaseDraw, null);
  assert.equal(decoded.engine.jev.model, JEV_MODEL);
});

test('stockout is explicit demand rather than a fabricated pick and unknown actions fail', () => {
  const context = { ...entry(), schemaVersion: 'shelf-context/1', basket: [], spent: 0,
    constraints: { budget: 7000, remainingBudget: 7000, maxBasket: 3 },
    observedProducts: [{ productId: 'tea', locationId: 'promo:1:2:2', price: 2300, stock: 0, canSee: true }],
    allowedActions: [{ type: 'record-unmet-demand', productId: 'tea', locationId: 'promo:1:2:2' }, { type: 'skip' }] };
  const decoded = decodeJevEvaluation(context, answer());
  assert.equal(decoded.action.type, 'stockout'); assert.equal(decoded.observations[0].purchaseProbability, .75);
  assert.equal(decoded.observations[0].noticeProbability, null);
  assert.throws(() => buildJevQuestion({ ...context, allowedActions: [{ type: 'teleport' }] }), TypeError);
  assert.throws(() => decodeJevEvaluation(context, answer('invented')), TypeError);
  assert.throws(() => decodeJevEvaluation(context, answer('a0', { a0: -1, a1: 2 })), TypeError);
});

test('browser provider validates context hash and action, transmits no key, and never falls back', async () => {
  const context = entry(), before = structuredClone(context); let calls = 0;
  const provider = createJevDecisionProvider({ fetchImpl: async (url, options) => {
    calls++; assert.equal(url, '/api/decision'); assert.equal('Authorization' in options.headers, false);
    assert.deepEqual(JSON.parse(options.body), { context });
    return new Response(JSON.stringify(responseFor(context)), { status: 200 });
  } });
  assert.equal((await provider(context)).action.type, 'enter'); assert.equal(calls, 1); assert.deepEqual(context, before);
  for (const mutate of [body => { body.decision.action.type = 'pass'; }, body => { body.decision.trace.contextHash = '0'.repeat(64); },
    body => { body.decision.engine.jev.called = false; }]) {
    const body = responseFor(context); mutate(body);
    await assert.rejects(createJevDecisionProvider({ fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }) })(context));
  }
  await assert.rejects(createJevDecisionProvider({ fetchImpl: async () => new Response('{}', { status: 429 }) })(context), /429.*no fallback/);
  assert.throws(() => createJevDecisionProvider({ endpoint: 'https://outside.invalid/api/decision' }), TypeError);
});

test('browser timeout aborts instead of silently substituting a local decision', async () => {
  let signal;
  const provider = createJevDecisionProvider({ timeoutMs: 5, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(provider(entry()), /timed out.*no fallback/); assert.equal(signal.aborted, true);
});
