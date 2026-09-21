/**
 * Actual app.js controller under a tiny mocked DOM, not a browser/E2E test.
 * Only module loading and host APIs are substituted. Event handlers, tokens,
 * transitions and error handling are the source controller's unchanged code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as data from './data.js';
import * as workflow from './state.js';
import { simulateComparison } from './forecast.js';

const originalController = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const controllerSource = originalController
  .replace(/^import\s+\{[^\n]+\}\s+from\s+'[^']+';\s*$/gm, '')
  .replace(/\bimport\(/g, '__importModule(');
assert.ok(!/^import\s/m.test(controllerSource), 'The fixture must substitute every static import explicitly.');
const calculations = new Map(data.BAYS.map(bay => [bay.storeId,
  simulateComparison({ storeId: bay.storeId, bayId: bay.id, populationPerDay: 8 }),
]));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flushTasks = () => new Promise(resolve => setImmediate(resolve));
const file = name => ({ name, type: 'image/png', size: 128 });

function createHarness({ failWorldImport = false, personaLoad } = {}) {
  const listeners = new Map(), windowListeners = new Map(), decodes = new Map();
  const calls = { objectURLs: [], revokedURLs: [], closedBitmaps: [], imports: [], calculations: [], resets: 0, toasts: [] };
  const location = { hash: '' };
  const controls = { note: { value: '' }, message: { focus() {} }, photo: { click() {} } };
  let lastView;
  const app = {
    innerHTML: '',
    addEventListener(name, handler) { listeners.set(name, handler); },
    querySelector(selector) {
      if (selector === '#owner-note') return controls.note;
      if (selector === '#approval-message') return controls.message;
      if (selector === '#photo-file') return controls.photo;
      // Rendering/WebGL is deliberately outside this controller unit test.
      return null;
    },
  };
  const document = {
    querySelector(selector) { return selector === '#app' ? app : null; },
    createElement() { return { className: '', role: '', textContent: '', remove() {} }; },
    body: { append(node) { calls.toasts.push(node.textContent); } },
  };
  const context = vm.createContext({
    ...data, ...workflow,
    document, location, AbortController,
    window: { scrollTo() {}, addEventListener(name, handler) { windowListeners.set(name, handler); } },
    history: { pushState(_state, _title, hash) { location.hash = hash; } },
    performance: { now: () => 100 },
    setTimeout(callback, delay) { if (delay === 0) queueMicrotask(callback); return 1; },
    requestAnimationFrame(callback) { queueMicrotask(callback); return 1; },
    URL: {
      createObjectURL(selected) {
        const url = `blob:http://localhost/${calls.objectURLs.length + 1}-${selected.name}`;
        calls.objectURLs.push({ fileName: selected.name, url });
        return url;
      },
      revokeObjectURL(url) { calls.revokedURLs.push(url); },
    },
    createImageBitmap(selected) {
      const decode = decodes.get(selected);
      if (!decode) throw new Error('The test must explicitly control image decoding.');
      return decode.promise;
    },
    simulateComparison(options) {
      calls.calculations.push(options.storeId);
      return calculations.get(options.storeId);
    },
    renderApp(view) {
      lastView = view;
      return `<mock-view route="${view.route}"></mock-view>`;
    },
    __importModule(path) {
      calls.imports.push(path);
      if (path === '../demo/personas.js') return Promise.resolve({ loadPersonaCatalog: () => personaLoad ?? Promise.resolve([]) });
      if (path === './world-view.js') {
        if (failWorldImport) return Promise.reject(new Error('Optional 3D module intentionally unavailable'));
        return Promise.resolve({ resetWorldViews() { calls.resets++; } });
      }
      throw new Error(`Unexpected dependency import: ${path}`);
    },
  });
  vm.runInContext(controllerSource, context, { filename: 'workspace/app.js' });

  const click = async (name, dataset = {}) => {
    const button = { disabled: false, dataset: { action: name, ...dataset } };
    await listeners.get('click')({ target: { closest: () => button } });
  };
  const input = (id, value) => listeners.get('input')({ target: { id, value } });
  function selectPhoto(selected) {
    const decode = deferred();
    decodes.set(selected, decode);
    const completion = listeners.get('change')({ target: { id: 'photo-file', files: [selected] } });
    return {
      completion,
      resolve() {
        decode.resolve({ width: 100, height: 100, close() { calls.closedBitmaps.push(selected.name); } });
      },
      reject(message = 'Image cannot be decoded') { decode.reject(new Error(message)); },
    };
  }
  const snapshot = () => ({
    route: lastView.route, error: lastView.error, busy: lastView.busy,
    loggedIn: lastView.state.loggedIn,
    approvals: JSON.parse(JSON.stringify(lastView.state.approvals)),
    responses: JSON.parse(JSON.stringify(lastView.state.responses)),
    photos: JSON.parse(JSON.stringify(lastView.state.photos)),
    resultCount: Object.keys(lastView.results).length,
  });
  return { click, input, selectPhoto, snapshot, calls, controls };
}

async function approvedOwner(harness) {
  await harness.click('login');
  await harness.click('run-all');
  assert.equal(harness.snapshot().resultCount, data.BAYS.length);
  await harness.click('select-candidate', { candidate: 'A', route: 'candidate' });
  await harness.click('open-approval');
  harness.input('approval-message', '담당 매니저가 검토한 합성 제안입니다.');
  await harness.click('approve');
  await harness.click('role-owner');
  await harness.click('respond', { status: 'accepted' });
  assert.equal(harness.snapshot().route, 'owner');
  assert.equal(harness.snapshot().responses['H-0412'].status, 'accepted');
  assert.equal(harness.snapshot().error, '');
}

test('actual controller keeps the latest selected photo when the first decode finishes last', async () => {
  const harness = createHarness();
  await approvedOwner(harness);
  const first = harness.selectPhoto(file('first-slow.png'));
  const latest = harness.selectPhoto(file('latest-fast.png'));
  latest.resolve();
  await latest.completion;
  assert.equal(harness.snapshot().photos['H-0412'].fileName, 'latest-fast.png');
  first.resolve();
  await first.completion;
  assert.equal(harness.snapshot().photos['H-0412'].fileName, 'latest-fast.png');
  assert.equal(harness.snapshot().error, '');
  assert.deepEqual(harness.calls.objectURLs.map(call => call.fileName), ['latest-fast.png']);
  assert.deepEqual(harness.calls.closedBitmaps, ['latest-fast.png', 'first-slow.png']);
});

test('a stale decode rejection cannot overwrite a later successful photo with an error', async () => {
  const harness = createHarness();
  await approvedOwner(harness);
  const first = harness.selectPhoto(file('old-corrupted.png'));
  const latest = harness.selectPhoto(file('new-valid.png'));
  latest.resolve();
  await latest.completion;
  first.reject('Old file decoder failed late');
  await first.completion;
  assert.equal(harness.snapshot().photos['H-0412'].fileName, 'new-valid.png');
  assert.equal(harness.snapshot().error, '');
});

test('reset invalidates pending successful decode without restoring photos or showing stale errors', async () => {
  const harness = createHarness();
  await approvedOwner(harness);
  const pending = harness.selectPhoto(file('before-reset.png'));
  await harness.click('reset-demo');
  pending.resolve();
  await pending.completion;
  await flushTasks();
  const state = harness.snapshot();
  assert.equal(state.route, 'login');
  assert.equal(state.loggedIn, false);
  assert.deepEqual(state.approvals, {});
  assert.deepEqual(state.photos, {});
  assert.equal(state.error, '');
  assert.equal(harness.calls.objectURLs.length, 0);
  assert.deepEqual(harness.calls.closedBitmaps, ['before-reset.png']);
});

test('reset invalidates pending failed decode without rendering a photo error on the new login', async () => {
  const harness = createHarness();
  await approvedOwner(harness);
  const pending = harness.selectPhoto(file('before-reset-corrupt.png'));
  await harness.click('reset-demo');
  pending.reject('Decoder rejected the previous session file');
  await pending.completion;
  assert.equal(harness.snapshot().route, 'login');
  assert.equal(harness.snapshot().error, '');
  assert.deepEqual(harness.snapshot().photos, {});
});

test('reset remains usable when its optional 3D import rejects and does not emit unhandledRejection', async () => {
  const harness = createHarness({ failWorldImport: true });
  await approvedOwner(harness);
  const unhandled = [];
  const record = reason => unhandled.push(String(reason));
  process.on('unhandledRejection', record);
  try {
    await harness.click('reset-demo');
    await flushTasks();
    await flushTasks();
    assert.ok(harness.calls.imports.includes('./world-view.js'));
    assert.deepEqual(unhandled, []);
    assert.equal(harness.snapshot().route, 'login');
    assert.equal(harness.snapshot().error, '');
    assert.deepEqual(harness.snapshot().approvals, {});
    await harness.click('login');
    assert.equal(harness.snapshot().route, 'home');
  } finally {
    process.off('unhandledRejection', record);
  }
});

test('approving another candidate invalidates an in-flight photo for the previous proposal', async () => {
  const harness = createHarness();
  await approvedOwner(harness);
  const pending = harness.selectPhoto(file('candidate-a.png'));
  await harness.click('role-manager');
  await harness.click('select-candidate', { candidate: 'B', route: 'candidate' });
  await harness.click('open-approval');
  await harness.click('approve');
  pending.resolve();
  await pending.completion;
  const state = harness.snapshot();
  assert.equal(state.approvals['H-0412'].candidateId, 'B');
  assert.deepEqual(state.responses, {});
  assert.deepEqual(state.photos, {});
  assert.equal(state.error, '');
});

test('changing the response invalidates a pending upload rather than showing a receipt after refusal', async () => {
  const harness = createHarness();
  await approvedOwner(harness);
  const pending = harness.selectPhoto(file('before-refusal.png'));
  await harness.click('respond', { status: 'declined' });
  pending.resolve();
  await pending.completion;
  assert.equal(harness.snapshot().responses['H-0412'].status, 'declined');
  assert.deepEqual(harness.snapshot().photos, {});
  assert.equal(harness.snapshot().error, '');
});

test('a current corrupt file still reports its error without erasing an earlier received photo', async () => {
  const harness = createHarness();
  await approvedOwner(harness);
  const valid = harness.selectPhoto(file('received.png'));
  valid.resolve();
  await valid.completion;
  const corrupt = harness.selectPhoto(file('broken.png'));
  corrupt.reject('Could not decode image');
  await corrupt.completion;
  assert.match(harness.snapshot().error, /사진 접수 실패/);
  assert.equal(harness.snapshot().photos['H-0412'].fileName, 'received.png');
  assert.equal(harness.calls.objectURLs.length, 1);
});

test('reset during asynchronous persona loading prevents obsolete calculation results from returning', async () => {
  const load = deferred();
  const harness = createHarness({ personaLoad: load.promise });
  await harness.click('login');
  const calculation = harness.click('run-all');
  await flushTasks();
  assert.equal(harness.snapshot().busy, true);
  await harness.click('reset-demo');
  load.resolve([]);
  await calculation;
  await flushTasks();
  const state = harness.snapshot();
  assert.equal(state.route, 'login');
  assert.equal(state.busy, false);
  assert.equal(state.resultCount, 0);
  assert.equal(state.error, '');
  assert.deepEqual(harness.calls.calculations, []);
});
