import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, symlink, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoServer } from './server.mjs';
import { JEV_MODEL, createJevDecisionProvider } from './jev.js';
import { adaptPersonaRecord, createVisitPersona } from './personas.js';

const TEST_KEY = 'unit-test-only-not-a-real-key';
const context = () => ({ schemaVersion: 'shelf-context/1', runId: 'test-run', time: 42,
  persona: { name: 'Synthetic shopper', story: 'A fast lunch before work.', sourceNarratives: { food: 'Prefers a simple lunch.' } },
  memory: [{ time: 40, message: 'Entered for lunch.' }], observer: { agentId: 7, position: [0, 1.6, 2] }, basket: [], spent: 0,
  observedProducts: [{ productId: 'coffee', locationId: 'promo:1:1', name: 'Coffee', price: 2400,
    stock: 5, canSee: true, position: [1, .4, 2], level: 1, column: 1, neighbors: [] }],
  allowedActions: [{ type: 'pick', productId: 'coffee', locationId: 'promo:1:1' }, { type: 'skip' }],
  constraints: { budget: 9000, remainingBudget: 9000, maxBasket: 3 }, activeEvents: [],
});
const upstream = (extra = {}) => new Response(JSON.stringify({ model: JEV_MODEL,
  answers: { decision: { type: 'choice', choice: 'a0', probabilities: { a0: .8, a1: .2 } } },
  usage: { inputTokens: 120, outputTokens: 30 }, providerMetadata: { gateway: {
    cost: '0.00001155', generationId: 'gen_test', routing: { originalModelId: JEV_MODEL, resolvedProvider: 'typesafe-ai' },
  } }, ...extra,
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function fixture(options, run) {
  const server = createDemoServer({ apiKey: TEST_KEY,
    fetchImpl: async () => { throw new Error('Unexpected upstream request in test'); }, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body = { context: context() }, headers = {}) => fetch(base + '/api/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  try { await run({ server, base, post }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('only the official JEV evaluation endpoint receives complete persona and spatial state', async () => {
  const source = context(), before = structuredClone(source); let calls = 0;
  await fixture({ fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://ai-gateway.vercel.sh/v1/evaluate');
    assert.equal(options.headers.Authorization, `Bearer ${TEST_KEY}`);
    const request = JSON.parse(options.body);
    assert.equal(request.model, JEV_MODEL); assert.deepEqual(request.state, source);
    assert.deepEqual(request.providerOptions, { gateway: { only: ['typesafe-ai'] } });
    assert.equal(request.questions.decision.type, 'choice');
    assert.ok(request.questions.decision.instructions.includes('sourceNarratives'));
    assert.ok(request.questions.decision.criteria.a0.includes('story'));
    assert.equal('messages' in request, false); return upstream();
  } }, async ({ base }) => {
    const traces = [], provide = createJevDecisionProvider({ endpoint: base + '/api/decision', onTrace: trace => traces.push(trace) });
    const result = await provide(source);
    assert.equal(result.action.type, 'pick'); assert.equal(result.action.productId, 'coffee');
    assert.equal(result.engine.jev.called, true); assert.equal(result.trace.model, JEV_MODEL);
    assert.equal(result.trace.cost, '0.00001155'); assert.equal(result.trace.usage.inputTokens, 120);
    assert.equal(result.trace.callsRemaining, 19); assert.equal(result.purchaseDraw, null);
    assert.equal(result.observations[0].noticeProbability, null);
    assert.match(result.trace.contextHash, /^[a-f0-9]{64}$/); assert.equal(traces.length, 1);
    const status = await (await fetch(base + '/api/status')).json();
    assert.equal(status.used, 1); assert.equal(status.inflight, 0); assert.equal(status.transport, 'evaluation');
    const saved = await (await fetch(base + '/api/traces')).json();
    assert.equal(saved.traces[0].requestId, result.trace.requestId);
    assert.equal(JSON.stringify({ result, status, saved }).includes(TEST_KEY), false);
    assert.equal('persona' in saved.traces[0], false);
  });
  assert.equal(calls, 1); assert.deepEqual(source, before);
  assert.throws(() => createDemoServer({ model: 'other/model' }), RangeError);
});

test('invalid, unconfigured, oversized and cross-origin requests never invoke upstream', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; return upstream(); };
  await fixture({ apiKey: '', fetchImpl }, async ({ base, post }) => {
    assert.equal((await (await fetch(base + '/api/status')).json()).configured, false);
    assert.equal((await post()).status, 503);
  });
  await fixture({ fetchImpl }, async ({ base, post }) => {
    assert.equal((await post(undefined, { Origin: 'https://example.invalid' })).status, 403);
    assert.equal((await post(undefined, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await fetch(base + '/api/decision')).status, 405);
    assert.equal((await post({ context: context(), model: JEV_MODEL })).status, 400);
    assert.equal((await post({ context: { ...context(), schemaVersion: 'wrong/1' } })).status, 400);
    const bad = context(); bad.constraints.remainingBudget = 1e9;
    assert.equal((await post({ context: bad })).status, 400);
    assert.equal((await post({ context: context(), padding: 'x'.repeat(130 * 1024) })).status, 413);
    assert.equal((await (await fetch(base + '/api/status')).json()).used, 0);
    assert.equal((await fetch(base + '/api/decision-review', { method: 'POST' })).status, 405);
  });
  assert.equal(calls, 0);
});

test('official synthetic source persona narratives and provenance reach JEV intact', async () => {
  const catalog = JSON.parse(await readFile(new URL('./data/nemotron-korea-sample.json', import.meta.url), 'utf8'));
  const entry = catalog.records[0], persona = createVisitPersona(adaptPersonaRecord(entry.row, 0, { ...catalog.source, rowIndex: entry.rowIndex }), 12);
  const source = { ...context(), schemaVersion: 'entry-context/1', persona, constraints: { open: true, hasCapacity: true },
    allowedActions: [{ type: 'enter' }, { type: 'pass' }] };
  await fixture({ fetchImpl: async (_url, options) => {
    const sent = JSON.parse(options.body).state.persona;
    assert.equal(sent.source.dataset, 'nvidia/Nemotron-Personas-Korea');
    assert.equal(sent.source.id, entry.row.uuid); assert.equal(sent.source.synthetic, true);
    assert.equal(sent.sourceNarratives.culinary_persona, entry.row.culinary_persona);
    assert.equal(sent.sourceNarratives.professional_persona, entry.row.professional_persona);
    assert.equal(sent.sourceFacts.age, entry.row.age); assert.equal(sent.derived.budget.status, 'assumed');
    assert.deepEqual(sent, persona); return upstream();
  } }, async ({ base }) => {
    assert.equal((await createJevDecisionProvider({ endpoint: base + '/api/decision' })(source)).action.type, 'enter');
  });
});

test('wrong model, invalid choice or malformed probability distributions fail without fallback', async () => {
  for (const extra of [
    { model: 'other/model' },
    { answers: { decision: { type: 'choice', choice: 'invented', probabilities: { a0: 1, a1: 0 } } } },
    { answers: { decision: { type: 'choice', choice: 'a0' } } },
    { answers: { decision: { type: 'choice', choice: 'a0', probabilities: { a0: 1, a1: 1 } } } },
  ]) {
    let calls = 0;
    await fixture({ fetchImpl: async () => { calls++; return upstream(extra); } }, async ({ post }) => {
      const response = await post(); assert.equal(response.status, 502);
      const result = await response.json(); assert.equal(result.trace.status, 'failed');
      assert.equal(result.trace.upstreamStatus, 200);
      assert.match(result.trace.failureCode, /^JEV_/);
      assert.equal(result.trace.answerValidation.expectedKeyCount, 2);
      assert.equal(result.trace.cost, '0.00001155');
      if (extra.answers?.decision?.probabilities?.a1 === 1) {
        assert.equal(result.trace.failureCode, 'JEV_PROBABILITY_MASS');
        assert.equal(result.trace.answerValidation.probabilitySum, 2);
      }
    }); assert.equal(calls, 1);
  }
});

test('illegal picks are removed from criteria and no fabricated purchase can return', async () => {
  for (const mutate of [c => { c.observedProducts[0].stock = 0; }, c => { c.observedProducts[0].canSee = false; },
    c => { c.constraints.remainingBudget = 1; }, c => { c.basket = ['coffee']; }, c => { c.basket = ['rice', 'chips', 'zero']; }]) {
    const source = context(); mutate(source);
    await fixture({ fetchImpl: async (_url, options) => {
      const criteria = JSON.parse(options.body).questions.decision.criteria;
      assert.deepEqual(Object.keys(criteria), ['a0']); assert.ok(criteria.a0.startsWith('skip:'));
      return upstream({ answers: { decision: { type: 'choice', choice: 'a0', probabilities: { a0: 1 } } } });
    } }, async ({ post }) => {
      const response = await post({ context: source }); assert.equal(response.status, 200);
      assert.equal((await response.json()).decision.action.type, 'skip');
    });
  }
});

test('failures are generic, metadata is allowlisted and reflected credentials never return', async () => {
  await fixture({ fetchImpl: async () => new Response(TEST_KEY, { status: 401 }) }, async ({ post }) => {
    const response = await post(); assert.equal(response.status, 502);
    const result = await response.json(); assert.equal(JSON.stringify(result).includes(TEST_KEY), false);
    assert.equal(result.trace.failureCode, 'JEV_UPSTREAM_HTTP'); assert.equal(result.trace.upstreamStatus, 401);
  });
  await fixture({ fetchImpl: async () => upstream({ usage: { inputTokens: TEST_KEY, outputTokens: 2 },
    providerMetadata: { gateway: { cost: TEST_KEY, secret: TEST_KEY }, arbitrary: TEST_KEY } }) }, async ({ post }) => {
    const result = await (await post()).json(); assert.equal(JSON.stringify(result).includes(TEST_KEY), false);
    assert.equal(result.decision.trace.cost, null); assert.deepEqual(result.decision.trace.usage, { outputTokens: 2 });
  });
  await fixture({ fetchImpl: async () => upstream({ providerMetadata: { gateway: { generationId: TEST_KEY } } }) }, async ({ post }) => {
    const response = await post(); assert.equal(response.status, 502); assert.equal((await response.text()).includes(TEST_KEY), false);
  });
});

test('process budget counts failures, trace retention is bounded, and timeout aborts', async () => {
  let calls = 0;
  await fixture({ maxCalls: 1, fetchImpl: async () => { calls++; throw new Error(TEST_KEY); } }, async ({ base, post }) => {
    assert.equal((await post()).status, 502); assert.equal((await post()).status, 429);
    assert.equal((await (await fetch(base + '/api/status')).json()).callsRemaining, 0);
  }); assert.equal(calls, 1);
  await fixture({ maxCalls: 21, fetchImpl: async () => upstream() }, async ({ base, post }) => {
    for (let index = 0; index < 21; index++) assert.equal((await post()).status, 200);
    const saved = await (await fetch(base + '/api/traces')).json(); assert.equal(saved.traces.length, 20); assert.equal(saved.used, 21);
  });
  let signal;
  await fixture({ timeoutMs: 15, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } }, async ({ post }) => {
    assert.equal((await post()).status, 504); assert.equal(signal.aborted, true);
  });
});

test('upstream 429 diagnostics preserve Retry-After and safe categories through browser errors and status', async () => {
  let calls = 0;
  await fixture({ fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ error: { code: 'token_rate_limit_exceeded', type: 'rate_limit_error',
      message: `Token rate limit and credit quota exceeded. Private diagnostic: ${TEST_KEY}`, private: TEST_KEY } }),
    { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } });
  } }, async ({ base }) => {
    const notified = [], provider = createJevDecisionProvider({ endpoint: base + '/api/decision', onTrace: value => notified.push(value) });
    await assert.rejects(provider(context()), error => {
      assert.equal(error.status, 502); assert.equal(error.upstreamStatus, 429);
      assert.equal(error.retryAfterSeconds, 60); assert.equal(error.code, 'JEV_UPSTREAM_HTTP');
      assert.equal(error.trace.upstreamErrorCode, 'token_rate_limit_exceeded');
      assert.equal(error.trace.upstreamErrorType, 'rate_limit_error');
      assert.deepEqual(error.trace.diagnosticCategories, ['token', 'rate', 'credit', 'quota']);
      assert.equal(error.trace.diagnosticReason, 'token+rate+credit+quota');
      assert.equal(JSON.stringify(error.trace).includes(TEST_KEY), false);
      assert.equal('message' in error.trace, false); return true;
    });
    assert.equal(notified.length, 1);
    const status = await (await fetch(base + '/api/status')).json();
    assert.equal(status.used, 1); assert.equal(status.lastFailure.upstreamStatus, 429);
    assert.equal(status.lastFailure.retryAfterSeconds, 60);
    const traces = await (await fetch(base + '/api/traces')).json();
    assert.deepEqual(traces.traces[0], status.lastFailure);
  });
  assert.equal(calls, 1, 'a rate limit must not trigger an automatic retry');
});

test('HTTP-date retry headers, malformed bodies and sensitive enum values stay bounded and redacted', async () => {
  const future = new Date(Date.now() + 120_000).toUTCString();
  await fixture({ fetchImpl: async () => new Response(JSON.stringify({ error: {
    code: TEST_KEY, type: 'not an enum ' + TEST_KEY, message: 'Temporary capacity overload.' } }),
  { status: 429, headers: { 'Retry-After': future } }) }, async ({ post }) => {
    const result = await (await post()).json();
    assert.equal(result.trace.upstreamErrorCode, null); assert.equal(result.trace.upstreamErrorType, null);
    assert.equal(result.trace.diagnosticReason, 'capacity');
    assert.ok(result.trace.retryAfterSeconds >= 115 && result.trace.retryAfterSeconds <= 120);
    assert.equal(JSON.stringify(result).includes(TEST_KEY), false);
  });
  for (const body of [TEST_KEY, JSON.stringify({ error: { code: TEST_KEY, message: 'x'.repeat(33 * 1024) } })]) {
    await fixture({ fetchImpl: async () => new Response(body, { status: 429, headers: { 'Retry-After': TEST_KEY } }) }, async ({ post }) => {
      const result = await (await post()).json();
      assert.equal(result.trace.retryAfterSeconds, null); assert.equal(result.trace.upstreamErrorCode, null);
      assert.equal(result.trace.diagnosticReason, 'unspecified-upstream-error');
      assert.equal(JSON.stringify(result).includes(TEST_KEY), false);
    });
  }
});

test('three concurrent upstream calls are allowed; the fourth is rejected', async () => {
  let release, entered = 0, ready;
  const held = new Promise(resolve => { release = resolve; }), three = new Promise(resolve => { ready = resolve; });
  await fixture({ fetchImpl: async () => { if (++entered === 3) ready(); await held; return upstream(); } }, async ({ base, post }) => {
    const pending = [post(), post(), post()]; await three;
    assert.equal((await (await fetch(base + '/api/status')).json()).inflight, 3);
    assert.equal((await post()).status, 429); release();
    assert.ok((await Promise.all(pending)).every(response => response.status === 200));
  }); assert.equal(entered, 3);
});

function rawGet(server, requestPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: requestPath }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
}

test('strict static allowlist serves runtime/replay files but not secrets, code tools or traversal', async () => {
  await fixture({}, async ({ base, server }) => {
    for (const target of ['/', '/app.js', '/jev.js', '/day.js', '/behavior.js', '/personas.js', '/data/nemotron-korea-sample.json', '/data/PERSONA-SOURCE.md', '/replay-recorder.js', '/replay-worker.js', '/summary-replay.js',
      '/components/ui/store-pager.js', '/assets/shopper.glb', '/node_modules/three/build/three.module.js']) {
      const response = await fetch(base + target); assert.equal(response.status, 200, target); await response.arrayBuffer();
    }
    for (const target of ['/.env', '/.env.local', '/server.mjs', '/server.test.js', '/package.json', '/README.md',
      '/assets/', '/scripts/verify-jev.mjs', '/data/private.json', '/node_modules/', '/node_modules/three/package.json',
      '/%2e%2e/app.js', '/assets/%2e%2e/app.js', '/assets%5c..%5c.env']) assert.equal(await rawGet(server, target), 404, target);
  });
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'gs2500-server-test-'));
  try {
    await symlink(fileURLToPath(new URL('./server.mjs', import.meta.url)), path.join(temporaryRoot, 'app.js'));
    await fixture({ rootDir: temporaryRoot }, async ({ base }) => { assert.equal((await fetch(base + '/app.js')).status, 404); });
  } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
});
