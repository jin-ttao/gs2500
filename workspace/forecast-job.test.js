import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { calculateComparisons } from './forecast-job.js';
import { runForecastJob } from './forecast-worker.js';
import { simulateComparison } from './forecast.js';
import { PROFILES } from '../demo/model.js';

const bays = [{ storeId: 'H-0412', id: 'B-03' }, { storeId: 'H-0521', id: 'B-01' }];
const resultFor = bay => ({ completed: true, storeId: bay.storeId, bayId: bay.id });

class FakeWorker {
  static instances = [];
  constructor(url, options) { this.url = url; this.options = options; this.listeners = new Map(); this.terminated = false; FakeWorker.instances.push(this); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type, handler) { if (this.listeners.get(type) === handler) this.listeners.delete(type); }
  postMessage(data) { this.data = structuredClone(data); }
  terminate() { this.terminated = true; }
  emit(type, data) { this.listeners.get(type)?.(type === 'message' ? { data } : data); }
}

test('module Worker gets only requested bay identities and provenance; progress then keyed results', async () => {
  const catalog = [{ name: 'test-persona' }];
  Object.defineProperty(catalog, 'metadata', { value: { source: { dataset: 'provenance-test' } }, enumerable: false });
  const progress = [];
  const promise = calculateComparisons({ bays, personaCatalog: catalog, onProgress: value => progress.push(value), WorkerImpl: FakeWorker });
  const worker = FakeWorker.instances.at(-1);
  assert.ok(worker.url.href.endsWith('/workspace/forecast-worker.js'));
  assert.deepEqual(worker.options, { type: 'module' });
  assert.deepEqual(worker.data.personaMetadata, catalog.metadata);
  assert.equal(worker.data.personaCatalog.metadata, undefined);
  const results = Object.fromEntries(bays.map(bay => [`${bay.storeId}:${bay.id}`, resultFor(bay)]));
  worker.emit('message', { type: 'progress', completed: 1, total: 2 });
  worker.emit('message', { type: 'progress', completed: 2, total: 2 });
  worker.emit('message', { type: 'result', results });
  assert.deepEqual(await promise, results);
  assert.deepEqual(progress, [{ completed: 1, total: 2 }, { completed: 2, total: 2 }]);
  assert.equal(worker.terminated, true);
  assert.equal(worker.listeners.size, 0);
});

test('abort terminates active work and ignores already queued stale completion/progress', async () => {
  const controller = new AbortController(), progress = [];
  const promise = calculateComparisons({ bays, signal: controller.signal, onProgress: value => progress.push(value), WorkerImpl: FakeWorker });
  const worker = FakeWorker.instances.at(-1), queuedListener = worker.listeners.get('message');
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  queuedListener({ data: { type: 'progress', completed: 1, total: 2 } });
  queuedListener({ data: { type: 'result', results: {} } });
  assert.deepEqual(progress, []);
  assert.equal(worker.terminated, true);
});

test('pre-aborted job never constructs a Worker', async () => {
  const before = FakeWorker.instances.length, controller = new AbortController(); controller.abort();
  await assert.rejects(calculateComparisons({ bays, signal: controller.signal, WorkerImpl: FakeWorker }), { name: 'AbortError' });
  assert.equal(FakeWorker.instances.length, before);
});

test('worker startup, runtime and serialization errors reject once without fallback/retry', async () => {
  let constructed = 0;
  class Broken { constructor() { constructed++; throw new Error('module-load-failed'); } }
  await assert.rejects(calculateComparisons({ bays, WorkerImpl: Broken }), /module-load-failed/);
  assert.equal(constructed, 1);
  for (const type of ['error', 'messageerror']) {
    const promise = calculateComparisons({ bays, WorkerImpl: FakeWorker });
    const worker = FakeWorker.instances.at(-1);
    worker.emit(type, { message: 'worker-runtime-failed' });
    await assert.rejects(promise);
    assert.equal(worker.terminated, true);
  }
  const promise = calculateComparisons({ bays, WorkerImpl: FakeWorker });
  FakeWorker.instances.at(-1).emit('message', { type: 'error', name: 'RangeError', message: 'invalid-input' });
  await assert.rejects(promise, { name: 'RangeError', message: 'invalid-input' });
});

test('malformed responses and progress callback failures terminate instead of leaving a pending job', async () => {
  for (const message of [{ type: 'progress', completed: 2, total: 2 }, { type: 'result', results: {} }, { type: 'unknown' }]) {
    const promise = calculateComparisons({ bays, WorkerImpl: FakeWorker });
    const worker = FakeWorker.instances.at(-1); worker.emit('message', message);
    await assert.rejects(promise); assert.equal(worker.terminated, true);
  }
  const promise = calculateComparisons({ bays, WorkerImpl: FakeWorker, onProgress() { throw new Error('callback-failed'); } });
  const worker = FakeWorker.instances.at(-1); worker.emit('message', { type: 'progress', completed: 1, total: 2 });
  await assert.rejects(promise, /callback-failed/); assert.equal(worker.terminated, true);
});

test('duplicate targets and invalid catalogs are rejected before worker launch', async () => {
  const before = FakeWorker.instances.length;
  await assert.rejects(calculateComparisons({ bays: [bays[0], bays[0]], WorkerImpl: FakeWorker }), /중복/);
  await assert.rejects(calculateComparisons({ bays, personaCatalog: {}, WorkerImpl: FakeWorker }), /페르소나/);
  assert.equal(FakeWorker.instances.length, before);
});

test('absent Worker fallback retains exact local defaults and supports cancellation between stores', async () => {
  const controller = new AbortController(), progress = [];
  const promise = calculateComparisons({ bays, WorkerImpl: null, signal: controller.signal, onProgress(value) { progress.push(value); controller.abort(); } });
  await assert.rejects(promise, { name: 'AbortError' });
  assert.deepEqual(progress, [{ completed: 1, total: 2 }]);
  const results = await calculateComparisons({ bays: [bays[0]], WorkerImpl: null });
  assert.deepEqual(results['H-0412:B-03'], simulateComparison({ storeId: 'H-0412', bayId: 'B-03' }));
});

test('worker handler preserves non-enumerable catalog source metadata and exact forecast ledger', async () => {
  const catalog = Array.from({ length: 1000 }, (_, index) => ({ ...PROFILES[index % PROFILES.length], source: { id: `test-${index}`, dataset: 'record-dataset' } }));
  Object.defineProperty(catalog, 'metadata', { value: { source: { dataset: 'catalog-dataset', revision: 'pinned-test-revision' } }, enumerable: false });
  const job = { bays: [bays[0]], personaCatalog: structuredClone(catalog), personaMetadata: structuredClone(catalog.metadata) };
  const result = await runForecastJob(job);
  const direct = simulateComparison({ storeId: bays[0].storeId, bayId: bays[0].id, personaCatalog: catalog });
  assert.deepEqual(result['H-0412:B-03'], direct);
  assert.equal(result['H-0412:B-03'].personaSource.dataset, 'catalog-dataset');
  assert.equal(result['H-0412:B-03'].personaSource.revision, 'pinned-test-revision');
  assert.equal(result['H-0412:B-03'].engine.jevCalled, false);
  assert.equal(job.personaCatalog.metadata, undefined, 'handler does not mutate the input array');
});

test('real background thread computes the existing result while main-thread timers remain responsive', async () => {
  class ThreadAdapter {
    constructor(url) {
      this.handlers = new Map();
      this.thread = new NodeWorker(`const { parentPort } = require('node:worker_threads'); import(${JSON.stringify(url.href)}).then(({ runForecastJob }) => parentPort.once('message', async data => { try { const results = await runForecastJob(data, { postMessage: message => parentPort.postMessage(message) }); parentPort.postMessage({ type: 'result', results }); } catch(error) { parentPort.postMessage({type:'error',name:error.name,message:error.message}); } }));`, { eval: true });
      this.thread.on('message', data => this.handlers.get('message')?.({ data }));
      this.thread.on('error', error => this.handlers.get('error')?.({ message: error.message }));
    }
    addEventListener(type, callback) { this.handlers.set(type, callback); }
    removeEventListener(type) { this.handlers.delete(type); }
    postMessage(data) { this.thread.postMessage(data); }
    terminate() { this.thread.terminate(); }
  }
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    const results = await calculateComparisons({ bays: [bays[0]], WorkerImpl: ThreadAdapter });
    assert.ok(ticks > 0, 'main thread timers advanced during calculation');
    assert.deepEqual(results['H-0412:B-03'], simulateComparison({ storeId: 'H-0412', bayId: 'B-03' }));
  } finally { clearInterval(timer); }
});
