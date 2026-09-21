import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoServer } from './server.mjs';

const TEST_KEY = 'unit-test-only-not-a-real-key';
const context = () => ({ schemaVersion: 'shelf-context/1',
  engine: { type: 'local-rule', jev: { status: 'not-connected', called: false } },
  runId: 'test-run', storeId: 'test-store', time: 42,
  observer: { agentId: 7, position: [0, 1.6, 2] }, basket: [], spent: 0,
  observedProducts: [{ productId: 'coffee', locationId: 'promo:1:1', price: 2400,
    stock: 5, canSee: true, position: [1, .4, 2] }],
  allowedActions: [{ type: 'pick', productId: 'coffee', locationId: 'promo:1:1' }, { type: 'skip' }],
  constraints: { budget: 9000, remainingBudget: 9000, maxBasket: 3 },
  provenance: { state: 'live-spatial-world', modelCall: 'none' },
});
const pick = { action: 'pick', productId: 'coffee', reason: 'Visible and within budget.', evidence: ['stock: 5'] };
const upstreamResponse = (review = pick, extra = {}) => new Response(JSON.stringify({
  choices: [{ message: { content: typeof review === 'string' ? review : JSON.stringify(review) } }],
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }, ...extra,
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function fixture(options, run) {
  const server = createDemoServer({ apiKey: TEST_KEY, model: 'example/mock-model',
    fetchImpl: async () => { throw new Error('Unexpected upstream request in test'); }, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body = { context: context() }, headers = {}) => fetch(base + '/api/decision-review', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  try { await run({ server, base, post }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('manual review sends the full context to the fixed gateway and returns only advisory output', async () => {
  const source = context(), before = structuredClone(source);
  let upstreamCalls = 0;
  await fixture({ model: 'example/model', fetchImpl: async (url, options) => {
    upstreamCalls++;
    assert.equal(url, 'https://ai-gateway.vercel.sh/v1/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${TEST_KEY}`);
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'example/model');
    assert.equal(request.temperature, 0);
    assert.equal(request.max_tokens, 500);
    assert.deepEqual(JSON.parse(request.messages[1].content), source);
    return upstreamResponse();
  } }, async ({ base, post }) => {
    const response = await post({ context: source });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.review, pick);
    assert.equal(result.provider, 'vercel-ai-gateway');
    assert.equal(result.model, 'example/model');
    assert.equal(result.advisoryOnly, true);
    assert.equal(result.engineUnchanged, true);
    assert.equal(result.callsRemaining, 11);
    assert.equal(result.usage.total_tokens, 150);
    assert.ok(result.durationMs >= 0);
    assert.equal(JSON.stringify(result).includes(TEST_KEY), false);
    const status = await (await fetch(base + '/api/status')).json();
    assert.equal(status.configured, true);
    assert.equal(status.callsRemaining, 11);
    assert.equal(status.busy, false);
    assert.equal(JSON.stringify(status).includes(TEST_KEY), false);
  });
  assert.equal(upstreamCalls, 1);
  assert.deepEqual(source, before);
});

test('unconfigured, foreign-origin, wrong-type and invalid requests never invoke the gateway', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return upstreamResponse(); };
  await fixture({ apiKey: '', fetchImpl }, async ({ base, post }) => {
    assert.equal((await (await fetch(base + '/api/status')).json()).configured, false);
    assert.equal((await post()).status, 503);
  });
  for (const model of [undefined, '', 'typesafe-ai/jev']) {
    await fixture({ model, fetchImpl }, async ({ base, post }) => {
      const status = await (await fetch(base + '/api/status')).json();
      assert.equal(status.configured, false);
      assert.equal(status.jevReady, false);
      assert.equal((await post()).status, 503);
    });
  }
  await fixture({ fetchImpl }, async ({ base, post }) => {
    assert.equal((await post(undefined, { Origin: 'https://example.invalid' })).status, 403);
    assert.equal((await post(undefined, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await fetch(base + '/api/decision-review')).status, 405);
    assert.equal((await post({ context: context(), model: 'override/model' })).status, 400);
    assert.equal((await post({ context: { ...context(), schemaVersion: 'wrong/1' } })).status, 400);
    const bad = context(); bad.constraints.remainingBudget = 1e9;
    assert.equal((await post({ context: bad })).status, 400);
    assert.equal((await post({ context: context(), padding: 'x'.repeat(130 * 1024) })).status, 413);
    assert.equal((await (await fetch(base + '/api/status')).json()).callsRemaining, 12);
  });
  assert.equal(calls, 0);
});

test('model output cannot fabricate an ineligible purchase or bypass JSON validation', async () => {
  for (const mutate of [
    c => { c.observedProducts[0].stock = 0; },
    c => { c.constraints.remainingBudget = 100; },
    c => { c.observedProducts[0].canSee = false; },
    c => { c.allowedActions = [{ type: 'skip' }]; },
    c => { c.basket = ['coffee']; },
    c => { c.basket = ['rice', 'chips', 'zero']; },
  ]) {
    const source = context(); mutate(source);
    await fixture({ fetchImpl: async () => upstreamResponse() }, async ({ post }) => {
      const response = await post({ context: source });
      assert.equal(response.status, 502);
      assert.equal((await response.json()).engineUnchanged, true);
    });
  }
  for (const review of [
    { ...pick, productId: 'invented' }, { ...pick, evidence: 'unsupported' },
    { action: 'skip', productId: 'coffee', reason: 'skip', evidence: [] },
    '```json\n{"action":"skip"}\n```', 'not JSON',
  ]) {
    await fixture({ fetchImpl: async () => upstreamResponse(review) }, async ({ post }) => {
      assert.equal((await post()).status, 502);
    });
  }
});

test('upstream failures are generic, usage is numeric-only and any reflected key is redacted', async () => {
  await fixture({ fetchImpl: async () => new Response(TEST_KEY, { status: 401 }) }, async ({ post }) => {
    const response = await post();
    assert.equal(response.status, 502);
    assert.equal((await response.text()).includes(TEST_KEY), false);
  });
  await fixture({ fetchImpl: async () => upstreamResponse({ ...pick, reason: TEST_KEY, evidence: [TEST_KEY] },
    { usage: { prompt_tokens: TEST_KEY, completion_tokens: 2, total_tokens: -1, private: TEST_KEY } }) }, async ({ post }) => {
    const result = await (await post()).json();
    assert.equal(JSON.stringify(result).includes(TEST_KEY), false);
    assert.deepEqual(result.usage, { completion_tokens: 2 });
    assert.equal(result.review.reason, '[redacted]');
  });
});

test('review allowance is enforced and includes failed attempts', async () => {
  let calls = 0;
  await fixture({ maxReviews: 1, fetchImpl: async () => { calls++; throw new Error(TEST_KEY); } }, async ({ base, post }) => {
    assert.equal((await post()).status, 502);
    assert.equal((await post()).status, 429);
    assert.equal((await (await fetch(base + '/api/status')).json()).callsRemaining, 0);
  });
  assert.equal(calls, 1);
  await fixture({ maxReviews: 1000 }, async ({ base }) => {
    assert.equal((await (await fetch(base + '/api/status')).json()).maxReviews, 12);
  });
});

test('one concurrent review is allowed and timeout aborts without an unbounded request', async () => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  await fixture({ fetchImpl: async () => { entered(); await waiting; return upstreamResponse(); } }, async ({ base, post }) => {
    const first = post(); await started;
    assert.equal((await (await fetch(base + '/api/status')).json()).busy, true);
    assert.equal((await post()).status, 429);
    release();
    assert.equal((await first).status, 200);
  });
  let signal;
  await fixture({ timeoutMs: 25, fetchImpl: async (_url, options) => {
    signal = options.signal; return new Promise(() => {});
  } }, async ({ base, post }) => {
    const response = await post();
    assert.equal(response.status, 504);
    assert.equal(signal.aborted, true);
    const state = await (await fetch(base + '/api/status')).json();
    assert.equal(state.busy, false);
    assert.equal(state.callsRemaining, 11);
  });
});

function rawGet(server, requestPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: requestPath }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
}

test('static runtime files work while secrets, source scripts, traversal and directories stay private', async () => {
  await fixture({}, async ({ base, server }) => {
    for (const target of ['/', '/app.js', '/day.js', '/simulation-cards.css', '/store-pages.css',
      '/components/ui/simulation-card.js', '/components/ui/store-pager.js',
      '/assets/shopper.glb', '/node_modules/three/build/three.module.js']) {
      const response = await fetch(base + target);
      assert.equal(response.status, 200, target);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      await response.arrayBuffer();
    }
    for (const target of ['/.env', '/.env.local', '/server.mjs', '/server.test.js', '/package.json', '/README.md',
      '/assets/', '/blender/shopper.blend', '/node_modules/', '/node_modules/three/package.json',
      '/%2e%2e/app.js', '/assets/%2e%2e/app.js', '/assets%5c..%5c.env']) {
      assert.equal(await rawGet(server, target), 404, target);
    }
  });
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'gs2500-server-test-'));
  try {
    await symlink(fileURLToPath(new URL('./server.mjs', import.meta.url)), path.join(temporaryRoot, 'app.js'));
    await fixture({ rootDir: temporaryRoot }, async ({ base }) => {
      assert.equal((await fetch(base + '/app.js')).status, 404);
    });
  } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
});
