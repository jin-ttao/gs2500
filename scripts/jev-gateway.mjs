import {createHash} from 'node:crypto';

export const JEV_MODEL = '~typesafe/jev-latest';
export const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const MAX_BODY_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_CONCURRENT = 2;
const SOURCE_CONTEXT = Object.freeze({synthetic:true, kind:'convenience-store-simulation', observedCustomerData:false});
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const probability = value => finite(value) && value >= 0 && value <= 1;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const sameKeys = (left, right) => left.length === right.length && left.every(key => right.includes(key));
const copy = value => JSON.parse(JSON.stringify(value));

export class JevGatewayError extends Error {
  constructor(code, httpStatus, message, upstreamStatus) {
    super(message);
    this.name = 'JevGatewayError';
    this.code = code;
    this.httpStatus = httpStatus;
    if (Number.isInteger(upstreamStatus)) this.upstreamStatus = upstreamStatus;
  }
}

const fail = (code, status, message, upstreamStatus) => { throw new JevGatewayError(code, status, message, upstreamStatus); };
const invalid = () => fail('JEV_INVALID_REQUEST', 400, 'Invalid JEV decision request.');

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

function validateJson(value, depth = 0, counter = {value:0}) {
  if (++counter.value > 10000 || depth > 16) invalid();
  if (value === null || typeof value === 'boolean' || finite(value)) return;
  if (typeof value === 'string') {
    if (value.length > 32000) invalid();
    return;
  }
  if (!Array.isArray(value) && !record(value)) invalid();
  for (const [key, item] of Object.entries(value)) {
    if (key.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(key)) invalid();
    validateJson(item, depth + 1, counter);
  }
}

function validateRequest(body) {
  if (!record(body) || !sameKeys(Object.keys(body), ['requestId', 'state', 'questions']) || !identifier(body.requestId)) invalid();
  validateJson(body);
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized) > MAX_BODY_BYTES) fail('JEV_REQUEST_TOO_LARGE', 413, 'JEV decision request is too large.');
  if (!(typeof body.state === 'string' && body.state.trim())
    && !(Array.isArray(body.state) && body.state.length)
    && !(record(body.state) && Object.keys(body.state).length)) invalid();
  if (!record(body.questions) || Object.keys(body.questions).length < 1 || Object.keys(body.questions).length > 8) invalid();
  for (const [name, question] of Object.entries(body.questions)) {
    if (!identifier(name) || !record(question) || !sameKeys(Object.keys(question), ['type', 'instructions', 'criteria'])
      || !['noul', 'choice'].includes(question.type)
      || typeof question.instructions !== 'string' || !question.instructions.trim() || question.instructions.length > 8000
      || !record(question.criteria)) invalid();
    const choices = Object.keys(question.criteria);
    if (question.type === 'noul' ? !sameKeys(choices, ['true', 'false']) : choices.length < 2 || choices.length > 25) invalid();
    for (const [key, description] of Object.entries(question.criteria)) {
      if (!identifier(key) || typeof description !== 'string' || !description.trim() || description.length > 4000) invalid();
    }
  }
  return copy(body);
}

function safeLabel(value, apiKey) {
  if (typeof value !== 'string' || value.length > 160 || !/^[a-zA-Z0-9 ~_.:/-]+$/.test(value)
    || /(?:sk-or-|vck_|bearer|api.?key|token|secret)/i.test(value) || (apiKey && value.includes(apiKey))) return null;
  return value;
}

function validateResponse(payload, questions, apiKey) {
  const invalidResponse = () => fail('JEV_INVALID_RESPONSE', 502, 'JEV returned an invalid structured decision.');
  if (!record(payload) || typeof payload.model !== 'string'
    || !/^~?typesafe\/jev-(?:latest|[a-z0-9][a-z0-9._-]{0,79})$/i.test(payload.model)
    || !record(payload.answers) || !sameKeys(Object.keys(payload.answers), Object.keys(questions))) invalidResponse();
  const answers = {};
  for (const [name, question] of Object.entries(questions)) {
    const answer = payload.answers[name];
    if (!record(answer) || answer.type !== question.type) invalidResponse();
    if (answer.confidence !== undefined && !probability(answer.confidence)) invalidResponse();
    if (question.type === 'noul') {
      if (!probability(answer.noul)) invalidResponse();
      answers[name] = {type:'noul', noul:answer.noul};
    } else {
      const expected = Object.keys(question.criteria);
      if (!expected.includes(answer.choice) || !record(answer.probabilities)
        || !sameKeys(Object.keys(answer.probabilities), expected)
        || !Object.values(answer.probabilities).every(probability)
        || Math.abs(Object.values(answer.probabilities).reduce((sum, value) => sum + value, 0) - 1) > 0.001) invalidResponse();
      answers[name] = {type:'choice', choice:answer.choice, probabilities:copy(answer.probabilities)};
    }
    if (answer.confidence !== undefined) answers[name].confidence = answer.confidence;
  }
  const usage = {};
  if (payload.usage !== undefined && payload.usage !== null) {
    if (!record(payload.usage)) invalidResponse();
    for (const field of ['input_tokens', 'output_tokens', 'total_tokens', 'prompt_tokens', 'completion_tokens', 'cost']) {
      if (payload.usage[field] === undefined) continue;
      const value = payload.usage[field];
      if (!finite(value) || value < 0 || (field !== 'cost' && !Number.isSafeInteger(value))) invalidResponse();
      usage[field] = value;
    }
  }
  return {model:payload.model, provider:safeLabel(payload.provider, apiKey), answers,
    usage:Object.keys(usage).length ? usage : null, upstreamRequestId:safeLabel(payload.id, apiKey)};
}

async function readPayload(response) {
  if (Number(response.headers?.get?.('content-length')) > MAX_RESPONSE_BYTES) {
    fail('JEV_INVALID_RESPONSE', 502, 'JEV returned an invalid structured decision.');
  }
  let text;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          fail('JEV_INVALID_RESPONSE', 502, 'JEV returned an invalid structured decision.');
        }
        chunks.push(Buffer.from(next.value));
      }
      text = Buffer.concat(chunks).toString('utf8');
    } finally { reader.releaseLock(); }
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) fail('JEV_INVALID_RESPONSE', 502, 'JEV returned an invalid structured decision.');
  }
  try { return JSON.parse(text); }
  catch { fail('JEV_INVALID_RESPONSE', 502, 'JEV returned an invalid structured decision.'); }
}

/** Server only. A process-lifetime budget includes failed attempts; no retries or fallback. */
export function createJevGateway({apiKey, maxCalls = 20, fetchImpl = globalThis.fetch, timeoutMs = 20000} = {}) {
  if (apiKey !== undefined && (typeof apiKey !== 'string' || /[\r\n]/.test(apiKey))
    || !Number.isSafeInteger(maxCalls) || maxCalls < 0 || maxCalls > 20
    || typeof fetchImpl !== 'function' || !finite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) {
    throw new TypeError('Invalid JEV gateway configuration.');
  }
  const key = apiKey?.trim() || '';
  const requests = new Map();
  let attemptedCalls = 0, successfulCalls = 0, activeCalls = 0;
  const status = () => ({configured:Boolean(key), provider:'openrouter', requestedModel:JEV_MODEL,
    maxCalls, attemptedCalls, successfulCalls, remainingCalls:maxCalls - attemptedCalls, activeCalls,
    maxConcurrent:MAX_CONCURRENT, sourceContext:{...SOURCE_CONTEXT}});

  async function execute(body, signal) {
    const controller = new AbortController();
    let timeout, stop;
    const started = performance.now();
    const cancelled = new Promise((_, reject) => {
      stop = () => {
        controller.abort();
        reject(new JevGatewayError('JEV_CANCELLED', 499, 'JEV decision request was cancelled.'));
      };
      signal?.addEventListener('abort', stop, {once:true});
      timeout = setTimeout(() => {
        controller.abort();
        reject(new JevGatewayError('JEV_TIMEOUT', 504, 'JEV decision request timed out.'));
      }, timeoutMs);
    });
    const task = async () => {
      const state = record(body.state) ? {...body.state, sourceContext:{...SOURCE_CONTEXT}}
        : {context:body.state, sourceContext:{...SOURCE_CONTEXT}};
      const response = await fetchImpl(JEV_ENDPOINT, {method:'POST', signal:controller.signal,
        headers:{Authorization:`Bearer ${key}`, 'Content-Type':'application/json', 'X-Title':'GS2500 local synthetic demo'},
        body:JSON.stringify({model:JEV_MODEL, state, questions:body.questions})});
      if (!response.ok) {
        // Do not read, forward, or log an upstream error body, which may echo credentials or state.
        const upstreamStatus = Number.isInteger(response.status) ? response.status : undefined;
        await response.body?.cancel?.().catch(() => {});
        fail('JEV_UPSTREAM_ERROR', 502, 'OpenRouter rejected the JEV decision request.', upstreamStatus);
      }
      return validateResponse(await readPayload(response), body.questions, key);
    };
    try {
      const checked = await Promise.race([task(), cancelled]);
      successfulCalls++;
      return {requestId:body.requestId, requestedModel:JEV_MODEL, ...checked,
        latencyMs:Math.round((performance.now() - started) * 1000) / 1000,
        sourceContext:{...SOURCE_CONTEXT}, cached:false};
    } catch (error) {
      if (error instanceof JevGatewayError) throw error;
      throw new JevGatewayError('JEV_NETWORK_ERROR', 502, 'Unable to contact OpenRouter for the JEV decision.');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', stop);
      activeCalls--;
    }
  }

  async function decide(input, {signal} = {}) {
    const body = validateRequest(input);
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) invalid();
    if (signal?.aborted) fail('JEV_CANCELLED', 499, 'JEV decision request was cancelled.');
    const fingerprint = createHash('sha256').update(canonical({state:body.state, questions:body.questions})).digest('hex');
    const existing = requests.get(body.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) fail('JEV_REQUEST_ID_CONFLICT', 409, 'This request ID has already been used for a different decision.');
      return {...copy(await existing.promise), cached:true};
    }
    if (!key) fail('JEV_NOT_CONFIGURED', 503, 'The server-side OpenRouter API key is not configured.');
    if (attemptedCalls >= maxCalls) fail('JEV_BUDGET_EXHAUSTED', 429, 'The JEV decision call limit has been reached.');
    if (activeCalls >= MAX_CONCURRENT) fail('JEV_BUSY', 429, 'Two JEV decisions are already in progress.');
    // Reserve before awaiting. Cache is bounded by maxCalls, including failures, preventing unsafe retries.
    attemptedCalls++;
    activeCalls++;
    const promise = execute(body, signal);
    requests.set(body.requestId, {fingerprint, promise});
    return copy(await promise);
  }
  return Object.freeze({status, decide});
}
