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
import * as operations from './operations.js';
import { simulateComparison } from './forecast.js';
import { buildProposalHistory } from './proposal-history.js';

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

function createHarness({ failWorldImport = false, personaLoad, calculationJob, worldDOM=false, worldMount } = {}) {
  const listeners = new Map(), windowListeners = new Map(), decodes = new Map();
  const calls = { objectURLs: [], revokedURLs: [], closedBitmaps: [], imports: [], calculations: [], resets: 0, toasts: [], renders:0, shellAttributes:{}, pushStates:[],replaceStates:[],scrolls:[],focusOptions:[],mounts:0,jobSignals:[] };
  const location = { hash: '' };
  const controls = { note: { value: '' }, message: { id:'approval-message',focus(options) {calls.focusOptions.push(options);} }, photo: { click() {} }, observationFields: {},details:[],detailBlueprint:[],focusables:[],dialogDetails:[],dialogDetailBlueprint:[] };
  let lastView;
  const makeScrollHost=()=>({
    _top:0,scrollHeight:worldDOM&&['board','candidate'].includes(lastView?.route)?450:2400,clientHeight:400,style:{scrollBehavior:'smooth'},
    get scrollTop(){return this._top;},set scrollTop(value){this._top=Math.max(0,Math.min(Number(value),this.scrollHeight-this.clientHeight));},
    scrollTo(options){calls.scrolls.push({...options});this.scrollTop=options.top;},
    querySelectorAll(selector){return selector==='details'?controls.details:[];},
    focus(options){calls.focusOptions.push(options);document.activeElement=this;},
  });
  function replaceMockDOM(){
    controls.scrollHost=makeScrollHost();
    controls.details=controls.detailBlueprint.map(item=>({id:item.id??'',dataset:{uiKey:item.key},className:'mock-details',open:item.open??false,querySelector(){return {textContent:item.key};}}));
    controls.dialogDetails=controls.dialogDetailBlueprint.map(item=>({id:item.id??'',dataset:{uiKey:item.key},className:'mock-details',open:item.open??false,querySelector(){return {textContent:item.key};}}));
    controls.dialog=makeScrollHost();controls.dialog.scrollHeight=2000;
    controls.dialog.querySelectorAll=selector=>selector==='details'?controls.dialogDetails:[];
    controls.world={style:{},innerHTML:'',setAttribute(){},getBoundingClientRect(){return {height:controls.scrollHost.scrollHeight-400};}};
  }
  const app = {
    _html:'',get innerHTML(){return this._html;},set innerHTML(value){this._html=value;replaceMockDOM();},
    contains(node){return Boolean(node);},
    addEventListener(name, handler) { listeners.set(name, handler); },
    querySelectorAll(selector){
      if(selector==='button,input,select,textarea,summary,[tabindex]')return controls.focusables;
      return [];
    },
    querySelector(selector) {
      if(selector==='.ob-page-scroll')return lastView?.route==='login'?null:controls.scrollHost;
      if(selector==='[role="dialog"]')return lastView?.approvalOpen||lastView?.observationOpen||lastView?.searchOpen?controls.dialog:null;
      if(worldDOM&&selector===(lastView?.route==='board'?'#world-board':lastView?.route==='candidate'?'#world-detail':null))return controls.world;
      if(selector==='.app-shell')return {setAttribute(name,value){calls.shellAttributes[name]=value;}};
      if (selector === '#owner-note') return controls.note;
      if (selector === '#approval-message') return controls.message;
      if (selector === '#photo-file') return controls.photo;
      if (selector === '#observation-form') return lastView?.observationOpen ? { fields: { ...lastView.observationDraft, ...controls.observationFields } } : null;
      // Rendering/WebGL is deliberately outside this controller unit test.
      return null;
    },
  };
  const document = {
    activeElement:null,
    querySelector(selector) { return selector === '#app' ? app : null; },
    createElement() { return { className: '', role: '', textContent: '', remove() {} }; },
    body: { append(node) { calls.toasts.push(node.textContent); } },
  };
  const context = vm.createContext({
    ...data, ...workflow, ...operations, buildProposalHistory,
    document, location, AbortController,
    window: { scrollTo() {}, addEventListener(name, handler) { windowListeners.set(name, handler); } },
    history: { scrollRestoration:'auto',pushState(_state, _title, hash) { calls.pushStates.push(hash);location.hash = hash; },replaceState(_state,_title,hash){calls.replaceStates.push(hash);location.hash=hash;} },
    performance: { now: () => 100 },
    setTimeout(callback, delay) { if (delay === 0) queueMicrotask(callback); return 1; },
    requestAnimationFrame(callback) { queueMicrotask(callback); return 1; },
    URL: {
      createObjectURL(selected) {
        const url = `blob:http://localhost/${calls.objectURLs.length + 1}-${selected.name}`;
        calls.objectURLs.push({ fileName: selected.name, url, file: selected });
        return url;
      },
      revokeObjectURL(url) { calls.revokedURLs.push(url); },
    },
    createImageBitmap(selected) {
      const decode = decodes.get(selected);
      if (!decode) throw new Error('The test must explicitly control image decoding.');
      return decode.promise;
    },
    FormData: class {
      constructor(form) { this.fields = form.fields; }
      [Symbol.iterator]() { return Object.entries(this.fields)[Symbol.iterator](); }
    },
    Image: class {
      decode() {
        const selected = calls.objectURLs.find(item => item.url === this.src)?.file;
        const decode = decodes.get(selected);
        if (!decode) throw new Error('The test must explicitly control observation photo decoding.');
        return decode.promise;
      }
    },
    simulateComparison(options) {
      calls.calculations.push(options.storeId);
      return calculations.get(options.storeId);
    },
    async calculateComparisons({bays,signal,onProgress}){
      calls.jobSignals.push(signal);
      if(calculationJob)await calculationJob;
      if(signal.aborted){const failure=new Error('Aborted');failure.name='AbortError';throw failure;}
      const result={};
      for(const [index,bay] of bays.entries()){
        calls.calculations.push(bay.storeId);result[`${bay.storeId}:${bay.id}`]=calculations.get(bay.storeId);
        onProgress?.({completed:index+1,total:bays.length});
      }
      return result;
    },
    renderApp(view) {
      calls.renders++;
      lastView = view;
      return `<mock-view route="${view.route}"></mock-view>`;
    },
    __importModule(path) {
      calls.imports.push(path);
      if (path === '../demo/personas.js') return Promise.resolve({ loadPersonaCatalog: () => personaLoad ?? Promise.resolve([]) });
      if (path === './world-view.js') {
        if (failWorldImport) return Promise.reject(new Error('Optional 3D module intentionally unavailable'));
        return Promise.resolve({ resetWorldViews() { calls.resets++; },async mountWorlds(){
          calls.mounts++;if(worldMount)await worldMount(calls.mounts);
          controls.scrollHost.scrollHeight=2400;return ()=>{};
        } });
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
  const submitObservation = fields => {
    controls.observationFields = fields;
    return listeners.get('submit')({ target: { id: 'observation-form' }, preventDefault() {} });
  };
  const selectStore = value => listeners.get('change')({ target: { id: 'operations-store', value } });
  const keydown = (key, modifiers = {}) => windowListeners.get('keydown')({ key, ...modifiers, preventDefault() {} });
  const popstate=hash=>{location.hash=hash;windowListeners.get('popstate')();};
  const scroll=(top,{user=false}={})=>{if(user)listeners.get('wheel')?.({});controls.scrollHost.scrollTop=top;};
  const detail=(key,open)=>{const node=controls.details.find(item=>item.dataset.uiKey===key);if(node)node.open=open;};
  const focus=(node)=>{controls.focusables=[node];document.activeElement=node;};
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
  function selectObservationPhoto(selected) {
    const decode = deferred();
    decodes.set(selected, decode);
    const completion = listeners.get('change')({ target: { id: 'observation-file', files: [selected] } });
    return { completion, resolve: () => decode.resolve(), reject: () => decode.reject(new Error('Observation image cannot be decoded')) };
  }
  const snapshot = () => ({
    route: lastView.route, error: lastView.error, busy: lastView.busy,
    loggedIn: lastView.state.loggedIn,role:lastView.state.role,
    approvals: JSON.parse(JSON.stringify(lastView.state.approvals)),
    responses: JSON.parse(JSON.stringify(lastView.state.responses)),
    photos: JSON.parse(JSON.stringify(lastView.state.photos)),
    resultCount: Object.keys(lastView.results).length,
    operations: JSON.parse(JSON.stringify(lastView.operations)),
    proposalHistory: JSON.parse(JSON.stringify(lastView.proposalHistory)),
    opsRange: lastView.opsRange, opsFilter: lastView.opsFilter, selectedStoreId: lastView.selectedStoreId,
    observationOpen: lastView.observationOpen, observationDraft: JSON.parse(JSON.stringify(lastView.observationDraft)),
    observationPhoto: lastView.observationPhoto ? { ...lastView.observationPhoto } : null,
    searchOpen: lastView.searchOpen,
    sidebarCollapsed:lastView.sidebarCollapsed,mobileSidebarOpen:lastView.mobileSidebarOpen,
    scrollTop:controls.scrollHost?.scrollTop,expandedDetails:controls.details.filter(item=>item.open).map(item=>item.dataset.uiKey),
    dialogScrollTop:controls.dialog?.scrollTop,dialogExpandedDetails:controls.dialogDetails.filter(item=>item.open).map(item=>item.dataset.uiKey),
    responseNote:lastView.response?.note,calculationProgress:{...lastView.calculationProgress},
  });
  return { click, input, selectPhoto, selectObservationPhoto, submitObservation, selectStore, keydown, popstate,scroll,detail,focus,snapshot, calls, controls };
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

const observationFields = (overrides = {}) => ({
  date: '2026-09-22', issueType: 'stockout', productId: 'water', note: '생수 매대 빈칸을 확인했습니다.',
  level: '2', column: '4', stockoutMinutes: '30', revenueBefore: '', revenueAfter: '', comparableDays: '', confounders: '', ...overrides,
});

test('operations navigation preserves selected store and applies exact range and issue filters', async () => {
  const harness = createHarness();
  await harness.click('login');
  assert.equal(harness.snapshot().route, 'home');
  assert.equal(harness.snapshot().opsRange, 14);
  await harness.click('ops-range', { value: '7' });
  assert.equal(harness.snapshot().operations.series.length, 7);
  await harness.click('navigate', { route: 'operations' });
  const allCount = harness.snapshot().operations.summary.issueCount;
  await harness.click('ops-filter', { value: 'stockout' });
  assert.ok(harness.snapshot().operations.issues.every(item => item.issueType === 'stockout'));
  assert.equal(harness.snapshot().operations.summary.issueCount, allCount);
  await harness.click('ops-store', { store: 'H-0521' });
  assert.equal(harness.snapshot().route, 'operations');
  assert.equal(harness.snapshot().selectedStoreId, 'H-0521');
  assert.ok(harness.snapshot().operations.issues.every(item => item.storeId === 'H-0521'));
  await harness.click('navigate', { route: 'home' });
  assert.equal(harness.snapshot().operations.issues.length, harness.snapshot().operations.summary.issueCount);
  await harness.selectStore('H-0618');
  assert.equal(harness.snapshot().operations.store.id, 'H-0618');
});

test('unsupported range is reported without corrupting the prior valid selection', async () => {
  const harness = createHarness(); await harness.click('login');
  await harness.click('ops-range', { value: '1000' });
  assert.equal(harness.snapshot().opsRange, 14);
  assert.match(harness.snapshot().error, /지원하지 않는 조회 기간/);
});

test('proposal history period and attention filters change records and intersect without altering totals', async () => {
  const h = createHarness();
  await h.click('login');
  await h.click('navigate', { route: 'review' });
  const initial = h.snapshot().proposalHistory;
  assert.deepEqual(initial.filters, { period: 'all', status: 'all' });
  assert.equal(initial.records.length, 4);
  assert.equal(initial.records.filter(record => record.elapsedDays === 14).length, 2);
  assert.equal(initial.records.filter(record => record.elapsedDays === 28).length, 2);

  await h.click('history-period', { value: '14' });
  assert.equal(h.snapshot().proposalHistory.records.length, 2);
  assert.ok(h.snapshot().proposalHistory.records.every(record => record.elapsedDays === 14));
  await h.click('history-period', { value: '28' });
  assert.equal(h.snapshot().proposalHistory.records.length, 2);
  assert.ok(h.snapshot().proposalHistory.records.every(record => record.elapsedDays === 28));
  await h.click('history-status', { value: 'attention' });
  assert.deepEqual(h.snapshot().proposalHistory.records, []);
  await h.click('history-period', { value: 'all' });
  const attention = h.snapshot().proposalHistory;
  assert.deepEqual(attention.filters, { period: 'all', status: 'attention' });
  assert.equal(attention.records.length, 1);
  assert.equal(attention.records[0].status, 'attention');
  assert.deepEqual(attention.summary, initial.summary);
  await h.click('history-status', { value: 'all' });
  assert.deepEqual(h.snapshot().proposalHistory.records, initial.records);
});

test('invalid proposal history filters preserve the last valid period, status and records', async () => {
  const h = createHarness();
  await h.click('login');
  await h.click('navigate', { route: 'review' });
  await h.click('history-period', { value: '14' });
  await h.click('history-status', { value: 'attention' });
  const prior = h.snapshot().proposalHistory;
  await h.click('history-period', { value: '7' });
  assert.match(h.snapshot().error, /지원하지 않는 경과 기간/);
  assert.deepEqual(h.snapshot().proposalHistory, prior);
  await h.click('history-status', { value: 'completed' });
  assert.match(h.snapshot().error, /지원하지 않는 추적 상태/);
  assert.deepEqual(h.snapshot().proposalHistory, prior);
});

test('proposal history filters retain scroll and expanded details, and reset restores both filters', async () => {
  const h = createHarness();
  h.controls.detailBlueprint = [{ key: 'history-session' }];
  await h.click('login');
  await h.click('navigate', { route: 'review' });
  h.scroll(740);
  h.detail('history-session', true);
  const pushed = h.calls.pushStates.length;
  await h.click('history-period', { value: '14' });
  assert.equal(h.snapshot().scrollTop, 740);
  assert.deepEqual(h.snapshot().expandedDetails, ['history-session']);
  await h.click('history-status', { value: 'attention' });
  assert.equal(h.snapshot().scrollTop, 740);
  assert.deepEqual(h.snapshot().expandedDetails, ['history-session']);
  assert.equal(h.calls.pushStates.length, pushed);
  assert.equal(h.snapshot().route, 'review');
  assert.ok(h.calls.scrolls.every(call => call.behavior === 'instant'));
  await h.click('reset-demo');
  assert.equal(h.snapshot().route, 'login');
  assert.deepEqual(h.snapshot().proposalHistory.filters, { period: 'all', status: 'all' });
  assert.equal(h.snapshot().proposalHistory.records.length, 4);
  await h.click('login');
  await h.click('navigate', { route: 'review' });
  assert.equal(h.snapshot().scrollTop, 0);
  assert.deepEqual(h.snapshot().expandedDetails, []);
});

test('manual observation form changes recommendations and direct counts without changing synthetic sales', async () => {
  const harness = createHarness(); await harness.click('login');
  const revenue = harness.snapshot().operations.summary.revenue;
  await harness.click('open-observation', { type: 'placement', product: 'water' });
  assert.equal(harness.snapshot().observationOpen, true);
  assert.equal(harness.snapshot().observationDraft.productId, 'water');
  await harness.submitObservation(observationFields({ issueType: 'placement', stockoutMinutes: '', revenueBefore: '10000', revenueAfter: '12000', comparableDays: '2', confounders: '비, 할인 종료' }));
  const current = harness.snapshot();
  assert.equal(current.observationOpen, false); assert.equal(current.error, '');
  assert.equal(current.operations.summary.userObservationCount, 1);
  assert.equal(current.operations.summary.revenue, revenue);
  assert.equal(current.operations.recommendations[0].type, 'placement-trial');
  assert.equal(current.operations.recommendations[0].productId, 'water');
  const record = current.operations.issues.find(item => item.confirmedByUser);
  assert.deepEqual(record.confounders, ['비', '할인 종료']);
  assert.equal(record.effect.delta, 2000); assert.equal(record.effect.causal, false);
  assert.ok(harness.calls.toasts.some(item => item.includes('자동 판독·인과효과 검증은 아닙니다')));
  assert.deepEqual(harness.calls.calculations, []);
});

test('invalid observation stays open with preserved values and no added record', async () => {
  const harness = createHarness(); await harness.click('login'); await harness.click('open-observation');
  await harness.submitObservation(observationFields({ revenueBefore: '10000', revenueAfter: '' }));
  assert.equal(harness.snapshot().observationOpen, true);
  assert.match(harness.snapshot().error, /전·후 매출은 함께/);
  assert.equal(harness.snapshot().observationDraft.revenueBefore, '10000');
  assert.equal(harness.snapshot().operations.summary.userObservationCount, 0);
});

test('photo observation submit retains its local URL until reset, with no automatic revenue effect', async () => {
  const harness = createHarness(); await harness.click('login'); await harness.click('open-observation');
  const photo = harness.selectObservationPhoto(file('water-shelf.png'));
  photo.resolve(); await photo.completion;
  assert.equal(harness.snapshot().observationPhoto.name, 'water-shelf.png');
  await harness.submitObservation(observationFields());
  const url = harness.calls.objectURLs[0].url;
  const record = harness.snapshot().operations.issues.find(item => item.confirmedByUser);
  assert.equal(record.photo.reference, url); assert.equal(record.effect, null);
  assert.equal(harness.snapshot().operations.summary.photoCount, 1);
  assert.ok(!harness.calls.revokedURLs.includes(url));
  await harness.click('reset-demo');
  assert.ok(harness.calls.revokedURLs.includes(url));
  assert.equal(harness.snapshot().operations.summary.userObservationCount, 0);
});

test('latest observation image wins and stale decodes are safely revoked', async () => {
  const harness = createHarness(); await harness.click('login'); await harness.click('open-observation');
  const first = harness.selectObservationPhoto(file('observation-old.png'));
  const latest = harness.selectObservationPhoto(file('observation-new.png'));
  latest.resolve(); await latest.completion;
  first.resolve(); await first.completion;
  assert.equal(harness.snapshot().observationPhoto.name, 'observation-new.png');
  assert.equal(harness.snapshot().error, '');
  assert.ok(harness.calls.revokedURLs.includes(harness.calls.objectURLs[0].url));
  assert.ok(!harness.calls.revokedURLs.includes(harness.calls.objectURLs[1].url));
});

test('closing or navigating during observation image decode never resurrects a dialog or leaked photo', async () => {
  for (const finish of ['close-observation', 'navigate', 'reset-demo']) {
    const harness = createHarness(); await harness.click('login'); await harness.click('open-observation');
    const pending = harness.selectObservationPhoto(file('pending.png'));
    await harness.click(finish, finish === 'navigate' ? { route: 'recommendations' } : {});
    pending.resolve(); await pending.completion;
    assert.equal(harness.snapshot().observationOpen, false);
    assert.equal(harness.snapshot().observationPhoto, null);
    assert.equal(harness.snapshot().operations.summary.userObservationCount, 0);
    assert.ok(harness.calls.revokedURLs.includes(harness.calls.objectURLs[0].url));
  }
});

test('reset restores operations range/filter and removes manually confirmed records', async () => {
  const harness = createHarness(); await harness.click('login');
  await harness.click('ops-range', { value: '7' });
  await harness.click('navigate', { route: 'operations' }); await harness.click('ops-filter', { value: 'stockout' });
  await harness.click('open-observation'); await harness.submitObservation(observationFields());
  assert.equal(harness.snapshot().operations.summary.userObservationCount, 1);
  await harness.click('reset-demo');
  assert.equal(harness.snapshot().route, 'login'); assert.equal(harness.snapshot().opsRange, 14);
  assert.equal(harness.snapshot().opsFilter, 'all'); assert.equal(harness.snapshot().observationOpen, false);
  assert.equal(harness.snapshot().operations.summary.userObservationCount, 0);
  await harness.click('login');
  assert.equal(harness.snapshot().route, 'home');
});

test('search, navigation, and escape close overlays without discarding saved observations', async () => {
  const harness = createHarness(); await harness.click('login');
  await harness.click('open-observation'); await harness.submitObservation(observationFields());
  await harness.click('open-search'); assert.equal(harness.snapshot().searchOpen, true);
  harness.keydown('Escape'); assert.equal(harness.snapshot().searchOpen, false);
  await harness.click('open-observation'); harness.keydown('Escape');
  assert.equal(harness.snapshot().observationOpen, false);
  await harness.click('navigate', { route: 'evidence' });
  assert.equal(harness.snapshot().operations.summary.userObservationCount, 1);
});

test('manager search is not exposed through a shortcut in the owner demo', async () => {
  const harness = createHarness(); await harness.click('login');
  harness.keydown('k', { metaKey: true });
  assert.equal(harness.snapshot().searchOpen, true);
  await harness.click('role-owner');
  assert.equal(harness.snapshot().searchOpen, false);
  harness.keydown('k', { metaKey: true });
  await harness.click('open-search');
  assert.equal(harness.snapshot().searchOpen, false);
  assert.equal(harness.snapshot().route, 'owner');
  await harness.click('role-manager');
  harness.keydown('k', { ctrlKey: true });
  assert.equal(harness.snapshot().searchOpen, true);
});

test('Obolus sidebar controls do not rerender, discard drafts or restart the world', async()=>{
  const h=createHarness();await h.click('login');
  await h.click('open-observation');
  const renders=h.calls.renders,imports=h.calls.imports.length;
  await h.click('toggle-sidebar');
  assert.equal(h.calls.shellAttributes['data-sidebar-collapsed'],'true');
  await h.click('toggle-sidebar');
  assert.equal(h.calls.shellAttributes['data-sidebar-collapsed'],'false');
  await h.click('open-sidebar');
  assert.equal(h.calls.shellAttributes['data-mobile-sidebar-open'],'true');
  h.keydown('Escape');
  assert.equal(h.calls.shellAttributes['data-mobile-sidebar-open'],'false');
  // Escape also intentionally closes the existing observation modal.
  assert.equal(h.calls.renders,renders+1);
  assert.equal(h.calls.imports.length,imports);
});

test('mobile menu closes on navigation and reset restores the expanded desktop rail',async()=>{
  const h=createHarness();await h.click('login');await h.click('toggle-sidebar');await h.click('open-sidebar');
  await h.click('navigate',{route:'operations'});
  await h.click('toggle-sidebar');
  assert.equal(h.calls.shellAttributes['data-mobile-sidebar-open'],'false');
  assert.equal(h.calls.shellAttributes['data-sidebar-collapsed'],'false');
  await h.click('toggle-sidebar');await h.click('reset-demo');await h.click('login');await h.click('open-sidebar');
  assert.equal(h.calls.shellAttributes['data-sidebar-collapsed'],'false');
});

test('opening search from the mobile menu leaves exactly one overlay',async()=>{
  const h=createHarness();await h.click('login');await h.click('open-sidebar');await h.click('open-search');
  assert.equal(h.snapshot().searchOpen,true);
  assert.equal(h.snapshot().mobileSidebarOpen,false);
});

test('owner role cannot reach manager candidates through a stale navigation action',async()=>{
  const h=createHarness();await h.click('login');await h.click('navigate',{route:'candidate'});await h.click('role-owner');
  await h.click('navigate',{route:'candidate'});
  assert.equal(h.snapshot().route,'owner');
  assert.deepEqual(h.snapshot().approvals,{});
  await h.click('role-manager');await h.click('navigate',{route:'candidate'});
  assert.equal(h.snapshot().route,'candidate');
});

test('same-page filters and dialogs preserve scroll and expanded records without smooth restoration',async()=>{
  const h=createHarness();h.controls.detailBlueprint=[{key:'record:water'}];
  await h.click('login');h.scroll(740);h.detail('record:water',true);
  await h.click('ops-range',{value:'7'});
  assert.equal(h.snapshot().scrollTop,740);assert.deepEqual(h.snapshot().expandedDetails,['record:water']);
  await h.click('open-observation');assert.equal(h.snapshot().scrollTop,740);
  await h.click('close-observation');assert.equal(h.snapshot().scrollTop,740);
  assert.deepEqual(h.snapshot().expandedDetails,['record:water']);
  assert.ok(h.calls.scrolls.every(call=>call.behavior==='instant'));
  assert.equal(h.controls.scrollHost.style.overflowAnchor,'none');
});

test('first section visits start at the top and later returns restore that store section position',async()=>{
  const h=createHarness();await h.click('login');h.scroll(830);
  await h.click('navigate',{route:'operations'});assert.equal(h.snapshot().scrollTop,0);h.scroll(390);
  await h.click('navigate',{route:'home'});assert.equal(h.snapshot().scrollTop,830);
  await h.selectStore('H-0521');assert.equal(h.snapshot().scrollTop,0);h.scroll(250);
  await h.selectStore('H-0412');assert.equal(h.snapshot().scrollTop,830);
  await h.click('navigate',{route:'operations'});assert.equal(h.snapshot().scrollTop,390);
});

test('candidate switches keep the current viewport while history restores each candidate without pushing',async()=>{
  const h=createHarness();await h.click('login');await h.click('navigate',{route:'candidate'});h.scroll(670);
  await h.click('select-candidate',{route:'candidate',candidate:'B'});
  assert.equal(h.snapshot().scrollTop,670);h.scroll(960);
  const count=h.calls.pushStates.length;
  h.popstate('#/candidate/H-0412/B-03/A');await flushTasks();
  assert.equal(h.snapshot().scrollTop,670);assert.equal(h.calls.pushStates.length,count);
  h.popstate('#/candidate/H-0412/B-03/B');await flushTasks();
  assert.equal(h.snapshot().scrollTop,960);assert.equal(h.calls.pushStates.length,count);
});

test('returning to the shared board keeps its viewport after inspecting different candidates and stores',async()=>{
  const h=createHarness();await h.click('login');await h.click('navigate',{route:'board'});h.scroll(1180);
  await h.click('select-candidate',{route:'candidate',candidate:'B'});
  await h.click('select-candidate',{route:'candidate',candidate:'C'});
  await h.click('navigate',{route:'board'});assert.equal(h.snapshot().scrollTop,1180);
  const other=data.BAYS.find(bay=>bay.storeId!=='H-0412');
  await h.click('select-candidate',{route:'candidate',store:other.storeId,bay:other.id,candidate:'D'});
  await h.click('navigate',{route:'board'});assert.equal(h.snapshot().scrollTop,1180);
  const pushed=h.calls.pushStates.length;
  h.popstate('#/board/H-0412/B-03/A');await flushTasks();
  assert.equal(h.snapshot().scrollTop,1180);assert.equal(h.calls.pushStates.length,pushed);
});

test('store overview and operations scroll memory is independent of the last candidate selection',async()=>{
  const h=createHarness();await h.click('login');h.scroll(760);
  await h.click('navigate',{route:'operations'});h.scroll(480);
  await h.click('select-candidate',{route:'candidate',candidate:'B'});
  await h.click('select-candidate',{route:'candidate',candidate:'C'});
  await h.click('navigate',{route:'home'});assert.equal(h.snapshot().scrollTop,760);
  await h.click('navigate',{route:'operations'});assert.equal(h.snapshot().scrollTop,480);
});

test('async world mount restores a temporarily clamped saved position after real content is ready',async()=>{
  const gate=deferred();const h=createHarness({worldDOM:true,worldMount:index=>index===2?gate.promise:Promise.resolve()});
  await h.click('login');await h.click('navigate',{route:'board'});await flushTasks();h.scroll(990);
  await h.click('navigate',{route:'home'});await h.click('navigate',{route:'board'});
  assert.equal(h.snapshot().scrollTop,50,'mock placeholder is too short before mount');
  gate.resolve();await flushTasks();await flushTasks();
  assert.equal(h.snapshot().scrollTop,990);
});

test('user scrolling during a delayed world mount cancels the late restoration',async()=>{
  const gate=deferred();const h=createHarness({worldDOM:true,worldMount:index=>index===2?gate.promise:Promise.resolve()});
  await h.click('login');await h.click('navigate',{route:'board'});await flushTasks();h.scroll(910);
  await h.click('navigate',{route:'home'});await h.click('navigate',{route:'board'});h.scroll(20,{user:true});
  gate.resolve();await flushTasks();await flushTasks();
  assert.equal(h.snapshot().scrollTop,20);
});

test('focus and cursor are restored without scrolling after a same-page render',async()=>{
  const h=createHarness();await h.click('login');h.scroll(640);
  const node={id:'mock-note',tagName:'TEXTAREA',value:'draft',selectionStart:2,selectionEnd:4,
    focus(options){h.calls.focusOptions.push(options);},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};
  h.focus(node);await h.click('ops-range',{value:'7'});
  assert.equal(h.snapshot().scrollTop,640);
  assert.equal(h.calls.focusOptions.at(-1).preventScroll,true);
  assert.equal(node.selectionStart,2);assert.equal(node.selectionEnd,4);
});

test('owner history protection replaces an unsafe entry instead of adding another history entry',async()=>{
  const h=createHarness();await h.click('login');await h.click('navigate',{route:'candidate'});await h.click('role-owner');
  const pushed=h.calls.pushStates.length;h.popstate('#/candidate/H-0412/B-03/B');await flushTasks();
  assert.equal(h.snapshot().route,'owner');assert.equal(h.snapshot().role,'owner');
  assert.equal(h.calls.pushStates.length,pushed);assert.match(h.calls.replaceStates.at(-1),/^#\/owner\//);
  h.popstate('#/not-a-route/H-0412/B-03/B');await flushTasks();
  assert.equal(h.snapshot().route,'owner');assert.equal(h.calls.pushStates.length,pushed);
});

test('unsent owner notes survive same-page updates without being submitted as a response',async()=>{
  const h=createHarness();await approvedOwner(h);
  h.controls.note.value='아직 제출하지 않은 의견';h.input('owner-note',h.controls.note.value);
  await h.click('navigate',{route:'owner'});
  assert.equal(h.snapshot().responseNote,'아직 제출하지 않은 의견');
  assert.notEqual(h.snapshot().responses['H-0412'].note,'아직 제출하지 않은 의견');
});

test('suggested shelf coordinates remain unconfirmed metadata while editing an observation',async()=>{
  const h=createHarness();await h.click('login');
  await h.click('open-observation',{suggestedLevel:'3',suggestedColumn:'5',suggestedTitle:'샌드위치 보충',product:'sandwich',type:'stockout'});
  assert.equal(h.snapshot().observationDraft.suggestedLevel,'3');assert.equal(h.snapshot().observationDraft.level,undefined);
  await h.submitObservation(observationFields({note:'',level:'',column:''}));
  assert.equal(h.snapshot().observationDraft.suggestedTitle,'샌드위치 보충');
  assert.equal(h.snapshot().observationDraft.level,'');
});

test('fresh comparison resets replay once and calculation completion respects later navigation',async()=>{
  const job=deferred(),h=createHarness({calculationJob:job.promise});await h.click('login');
  const pending=h.click('run-all');await flushTasks();
  assert.equal(h.snapshot().route,'board');assert.equal(h.snapshot().busy,true);
  await h.click('navigate',{route:'evidence'});h.scroll(180);
  job.resolve();await pending;
  assert.equal(h.snapshot().route,'evidence');assert.equal(h.snapshot().scrollTop,180);
  assert.equal(h.snapshot().busy,false);assert.equal(h.calls.resets,1);
  assert.deepEqual(h.snapshot().calculationProgress,{completed:4,total:4});
  await h.click('run-all');assert.equal(h.calls.resets,2);assert.equal(h.snapshot().route,'board');
});

test('reset aborts the computation job without publishing its late results',async()=>{
  const job=deferred(),h=createHarness({calculationJob:job.promise});await h.click('login');
  const pending=h.click('run-all');await flushTasks();await h.click('reset-demo');
  assert.equal(h.calls.jobSignals[0].aborted,true);job.resolve();await pending;
  assert.equal(h.snapshot().route,'login');assert.equal(h.snapshot().resultCount,0);
  assert.deepEqual(h.calls.calculations,[]);
});

test('observation validation and photo rerenders preserve the modal scroll and its expanded details',async()=>{
  const h=createHarness();h.controls.dialogDetailBlueprint=[{key:'observation-comparison'}];
  await h.click('login');h.scroll(700);await h.click('open-observation');
  h.controls.dialog.scrollTop=480;h.controls.dialogDetails[0].open=true;
  await h.submitObservation(observationFields({note:''}));
  assert.equal(h.snapshot().observationOpen,true);assert.equal(h.snapshot().dialogScrollTop,480);
  assert.deepEqual(h.snapshot().dialogExpandedDetails,['observation-comparison']);assert.equal(h.snapshot().scrollTop,700);
  const selected=h.selectObservationPhoto(file('modal-context.png'));selected.resolve();await selected.completion;await flushTasks();
  assert.equal(h.snapshot().dialogScrollTop,480);assert.deepEqual(h.snapshot().dialogExpandedDetails,['observation-comparison']);
  assert.equal(h.controls.dialog.style.overflowAnchor,'none');
});

test('closing or explicitly opening a fresh modal resets its private scroll and disclosure state',async()=>{
  const h=createHarness();h.controls.dialogDetailBlueprint=[{key:'observation-comparison'}];
  await h.click('login');await h.click('open-observation');h.controls.dialog.scrollTop=360;h.controls.dialogDetails[0].open=true;
  await h.click('close-observation');await h.click('open-observation');
  assert.equal(h.snapshot().dialogScrollTop,0);assert.deepEqual(h.snapshot().dialogExpandedDetails,[]);
  h.controls.dialog.scrollTop=290;h.controls.dialogDetails[0].open=true;
  await h.click('open-observation',{product:'water',suggestedTitle:'새 관찰'});
  assert.equal(h.snapshot().dialogScrollTop,0);assert.deepEqual(h.snapshot().dialogExpandedDetails,[]);
  await h.click('open-search');assert.equal(h.snapshot().dialogScrollTop,0);
});

test('approval validation preserves its modal position while a newly opened approval starts at zero',async()=>{
  const h=createHarness();h.controls.dialogDetailBlueprint=[{key:'approval-evidence'}];
  await h.click('login');await h.click('run-all');await h.click('select-candidate',{route:'candidate',candidate:'A'});await h.click('open-approval');
  h.controls.dialog.scrollTop=420;h.controls.dialogDetails[0].open=true;h.input('approval-message','');await h.click('approve');
  assert.equal(h.snapshot().dialogScrollTop,420);assert.deepEqual(h.snapshot().dialogExpandedDetails,['approval-evidence']);
  assert.deepEqual(h.snapshot().approvals,{});
  await h.click('close-approval');await h.click('open-approval');
  assert.equal(h.snapshot().dialogScrollTop,0);assert.deepEqual(h.snapshot().dialogExpandedDetails,[]);
});
