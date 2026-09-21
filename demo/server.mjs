import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JEV_MODEL, buildJevQuestion, canonicalContext, decodeJevEvaluation } from './jev.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/evaluate';
const MAX_BODY_BYTES = 128 * 1024;
const RUNTIME_FILES = new Set([
  'index.html', 'styles.css', 'app.js', 'model.js', 'lab.js', 'world.js', 'jev.js',
  'maps.js', 'navigation.js', 'store.js', 'characters.js', 'card-worlds.js',
  'context.js', 'merchandising.js', 'day.js', 'simulation-cards.css', 'store-pages.css',
  'replay-recorder.js', 'replay-worker.js', 'summary-replay.js',
  'personas.js', 'behavior.js', 'data/nemotron-korea-sample.json', 'data/PERSONA-SOURCE.md',
  'components/ui/simulation-card.js', 'components/ui/store-pager.js',
  'assets/shopper.glb', 'assets/coffee-machine.glb', 'assets/checkout-terminal.glb', 'assets/product-atlas.png',
]);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.glb': 'model/gltf-binary' };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const numericCost = value => (typeof value === 'string' && /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)
  && Number.isFinite(Number(value))) || (finite(value) && value >= 0);
const safeString = value => typeof value === 'string' && /^[a-z0-9_.:/-]{1,200}$/i.test(value) ? value : null;

async function upstreamFailureDetails(response, key) {
  const retryHeader = response.headers?.get('retry-after')?.trim();
  const numericRetry = retryHeader && /^\d+(?:\.\d+)?$/.test(retryHeader) ? Number(retryHeader) : null;
  const datedRetry = retryHeader && numericRetry === null ? (Date.parse(retryHeader) - Date.now()) / 1000 : null;
  const retryAfterSeconds = finite(numericRetry) ? numericRetry : finite(datedRetry) ? Math.max(0, Math.ceil(datedRetry)) : null;
  let payload = null;
  try {
    // Parse only a bounded JSON error. Never retain or return the raw body.
    const reader = response.body?.getReader();
    if (reader) {
      const chunks = []; let size = 0, oversized = false;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 32 * 1024) { oversized = true; await reader.cancel(); break; }
        chunks.push(Buffer.from(value));
      }
      if (!oversized) payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
  } catch { /* Status and Retry-After remain useful if the body is non-JSON. */ }
  const error = payload?.error && typeof payload.error === 'object' ? payload.error : payload;
  const enumValue = value => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,79}$/i.test(value)
    && !/^(?:sk-|vck_|bearer)/i.test(value) && !(key && value.includes(key)) ? value : null;
  const upstreamErrorCode = enumValue(error?.code), upstreamErrorType = enumValue(error?.type);
  const phrase = [typeof error?.message === 'string' ? error.message : '', upstreamErrorCode ?? '', upstreamErrorType ?? ''].join(' ');
  const patterns = { token: /\btokens?\b|\btpm\b|token[_ -]limit/i,
    rate: /rate[_ -]?limit|too many requests|requests per|\brpm\b/i,
    credit: /credits?|billing|payment|balance|funds/i,
    capacity: /capacity|overload|temporarily unavailable/i,
    quota: /quota|allowance/i };
  const diagnosticCategories = Object.entries(patterns).filter(([, expression]) => expression.test(phrase)).map(([category]) => category);
  return { upstreamErrorCode, upstreamErrorType, retryAfterSeconds, diagnosticCategories,
    diagnosticReason: diagnosticCategories.join('+') || 'unspecified-upstream-error',
    diagnosticReasonSource: 'error-message-keyword-categories-not-a-confirmed-cause' };
}

function readBody(request) {
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
    request.resume(); return Promise.reject(Object.assign(new Error('large'), { status: 413 }));
  }
  return new Promise((resolve, reject) => {
    let size = 0, rejected = false; const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        if (!rejected) reject(Object.assign(new Error('large'), { status: 413 }));
        rejected = true; chunks.length = 0;
      } else if (!rejected) chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('json'), { status: 400 })); }
    });
    request.on('error', () => reject(Object.assign(new Error('interrupted'), { status: 400 })));
  });
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

function sameOrigin(request, port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  return hosts.has(request.headers.host) && (!request.headers.origin || request.headers.origin === `http://${request.headers.host}`);
}

function gatewayMetadata(payload, key) {
  const gateway = payload?.providerMetadata?.gateway ?? {}, typesafe = payload?.providerMetadata?.typesafe;
  const usage = payload?.usage && typeof payload.usage === 'object' ? Object.fromEntries(
    ['inputTokens', 'outputTokens', 'totalTokens'].filter(name => Number.isSafeInteger(payload.usage[name]) && payload.usage[name] >= 0)
      .map(name => [name, payload.usage[name]])) : null;
  const costs = Object.fromEntries(['cost', 'marketCost', 'surchargeCost', 'gatewayCost'].map(name => [name, numericCost(gateway[name]) ? String(gateway[name]) : null]));
  const routing = gateway.routing && typeof gateway.routing === 'object' ? Object.fromEntries(
    ['originalModelId', 'resolvedProvider', 'canonicalSlug', 'finalProvider'].map(name => [name, safeString(gateway.routing[name])])) : null;
  const confidence = typesafe?.confidence?.decision;
  const result = { usage, cost: costs.cost, costs, generationId: safeString(gateway.generationId), routing,
    confidence: finite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null,
    confidenceMeaning: 'provider-concentration-metadata-not-correctness-probability' };
  if (key && JSON.stringify(result).includes(key)) throw Object.assign(new Error('Unsafe upstream metadata'), { code: 'JEV_UNSAFE_METADATA' });
  return result;
}

/** Local JEV evaluation only. No chat endpoint, other model, retry, or fallback. */
export function createDemoServer({ apiKey = '', model = JEV_MODEL, fetchImpl = globalThis.fetch,
  maxCalls = 20, concurrency = 3, timeoutMs = 15_000, rootDir = MODULE_DIR } = {}) {
  if (model !== JEV_MODEL) throw new RangeError('Only typesafe-ai/jev is supported.');
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 0 || maxCalls > 1_000_000
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 3
    || !finite(timeoutMs) || timeoutMs <= 0 || typeof fetchImpl !== 'function') throw new RangeError('Invalid JEV server limits.');
  const key = typeof apiKey === 'string' ? apiKey.trim() : '', configured = !!key;
  let used = 0, inflight = 0, lastFailure = null; const traces = [];
  const remaining = () => Math.max(0, maxCalls - used);
  const remember = trace => {
    traces.push(trace); if (traces.length > 20) traces.shift();
    if (trace.status === 'failed' || trace.status === 'timeout') lastFailure = trace;
  };
  const server = http.createServer(async (request, response) => {
    try {
      if (!sameOrigin(request, server.address()?.port)) return json(response, 403, { error: 'Local same-origin requests only.' });
      let pathname;
      try { pathname = decodeURIComponent((request.url || '/').split('?')[0]); }
      catch { return json(response, 400, { error: 'Invalid path.' }); }
      if (pathname === '/api/status') {
        if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
        return json(response, 200, { configured, provider: 'vercel-ai-gateway', model: JEV_MODEL,
          transport: 'evaluation', jevReady: configured, used, maxCalls, callsRemaining: remaining(), inflight, concurrency, lastFailure });
      }
      if (pathname === '/api/traces') {
        if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
        return json(response, 200, { traces, retained: traces.length, capacity: 20, used, callsRemaining: remaining() });
      }
      if (pathname === '/api/decision') {
        if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
          request.resume(); return json(response, 415, { error: 'JSON content type required.' });
        }
        if (!configured) { request.resume(); return json(response, 503, { error: 'JEV is not configured. No fallback is available.' }); }
        const body = await readBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'context')) {
          return json(response, 400, { error: 'Only a decision context may be submitted.' });
        }
        let questions;
        try { ({ questions } = buildJevQuestion(body.context)); }
        catch { return json(response, 400, { error: 'Invalid decision context.' }); }
        if (inflight >= concurrency) return json(response, 429, { error: 'JEV concurrency limit reached.', callsRemaining: remaining() });
        if (!remaining()) return json(response, 429, { error: 'JEV process call budget exhausted.', callsRemaining: 0 });
        inflight++; used++;
        const requestId = randomUUID(), contextHash = createHash('sha256').update(canonicalContext(body.context)).digest('hex');
        const baseTrace = { requestId, contextHash, model: JEV_MODEL, provider: 'vercel-ai-gateway',
          runId: safeString(body.context.runId), agentId: Number.isSafeInteger(body.context.observer?.agentId) ? body.context.observer.agentId : null,
          contextType: body.context.schemaVersion, time: finite(body.context.time) ? body.context.time : null };
        const started = performance.now(), controller = new AbortController(); let timer, upstreamStatus = null, receivedMetadata = null, failureDetails = null;
        try {
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('timeout'), { timeout: true })); }, timeoutMs);
          });
          const upstream = (async () => {
            const result = await fetchImpl(GATEWAY_URL, { method: 'POST', signal: controller.signal,
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: JEV_MODEL, state: body.context, questions,
                providerOptions: { gateway: { only: ['typesafe-ai'] } } }),
            });
            upstreamStatus = Number.isSafeInteger(result.status) ? result.status : null;
            if (!result.ok) {
              failureDetails = await upstreamFailureDetails(result, key);
              throw Object.assign(new Error('Gateway rejected evaluation'), { code: 'JEV_UPSTREAM_HTTP' });
            }
            let payload;
            try { payload = await result.json(); }
            catch { throw Object.assign(new Error('Gateway returned malformed JSON'), { code: 'JEV_UPSTREAM_JSON' }); }
            receivedMetadata = gatewayMetadata(payload, key);
            return decodeJevEvaluation(body.context, payload, { ...baseTrace, ...receivedMetadata });
          })();
          const decision = await Promise.race([upstream, timeout]);
          Object.assign(decision.trace, { latencyMs: Math.round(performance.now() - started), callsRemaining: remaining(), status: 'succeeded' });
          if (key && JSON.stringify(decision).includes(key)) throw Object.assign(new Error('Unsafe response'), { code: 'JEV_UNSAFE_RESPONSE' });
          remember({ ...decision.trace, action: decision.action });
          return json(response, 200, { decision });
        } catch (error) {
          const knownCodes = ['JEV_UPSTREAM_HTTP', 'JEV_UPSTREAM_JSON', 'JEV_INVALID_MODEL', 'JEV_INVALID_ANSWER_TYPE',
            'JEV_INVALID_CHOICE', 'JEV_MISSING_PROBABILITIES', 'JEV_PROBABILITY_KEYS', 'JEV_PROBABILITY_VALUES',
            'JEV_PROBABILITY_MASS', 'JEV_UNSAFE_METADATA', 'JEV_UNSAFE_RESPONSE'];
          const trace = { ...baseTrace, ...(receivedMetadata ?? { usage: null, cost: null }), ...failureDetails,
            latencyMs: Math.round(performance.now() - started), callsRemaining: remaining(), upstreamStatus,
            failureCode: error?.timeout ? 'JEV_TIMEOUT' : knownCodes.includes(error?.code) ? error.code : 'JEV_REQUEST_FAILED',
            answerValidation: error?.diagnostics ?? null, status: error?.timeout ? 'timeout' : 'failed' };
          remember(trace);
          return json(response, error?.timeout ? 504 : 502, { error: error?.timeout ? 'JEV evaluation timed out.' : 'JEV evaluation failed or returned an invalid answer.', trace });
        } finally { clearTimeout(timer); inflight--; }
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Method not allowed.' });
      const parts = pathname.split('/');
      if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || parts.some(part => part.startsWith('.'))) return json(response, 404, { error: 'Not found.' });
      const name = pathname === '/' ? 'index.html' : pathname.slice(1);
      const vendor = /^(?:node_modules|vendor)\/three\/(?:build|examples\/jsm)\/[a-z0-9_./-]+\.js$/i.test(name);
      if (!RUNTIME_FILES.has(name) && !vendor) return json(response, 404, { error: 'Not found.' });
      const root = await realpath(rootDir), file = await realpath(path.resolve(root, name));
      if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) return json(response, 404, { error: 'Not found.' });
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Content-Length': data.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const status = error?.status || (['ENOENT', 'ENOTDIR'].includes(error?.code) ? 404 : 500);
      json(response, status, { error: status === 413 ? 'Request body too large.' : status === 400 ? 'Invalid request.' : status === 404 ? 'Not found.' : 'Request failed.' });
    }
  });
  server.requestTimeout = 20_000; server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Native Node parsing; load only on explicit server launch, never on import/tests.
  try { process.loadEnvFile(path.join(MODULE_DIR, '.env.local')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not load local server environment.'); }
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = createDemoServer({ apiKey: process.env.AI_GATEWAY_API_KEY, model: process.env.GATEWAY_MODEL || JEV_MODEL,
    maxCalls: Number(process.env.JEV_MAX_CALLS || 20), concurrency: Number(process.env.JEV_CONCURRENCY || 3) });
  server.listen(port, '127.0.0.1', () => console.log(`GS2500 JEV server: http://127.0.0.1:${port}`));
}
