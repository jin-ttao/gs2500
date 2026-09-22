import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationsState, recordOperation, recommendForStore, buildOperationsView, ISSUE_TYPES, OPERATIONS_SOURCE } from './operations.js';
import { STORES, PRODUCT_MAP, getPlacements } from './data.js';

const storeId = STORES[0].id;
const observation = (overrides = {}) => ({ storeId, date: '2026-09-22', issueType: 'placement', productId: 'water',
  level: 2, column: 4, note: '생수를 옮긴 위치를 직접 확인했습니다.', ...overrides });
function freezeDeep(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); } return value; }
const withoutSeeds = () => ({ ...createOperationsState(), seedRecords: [] });

test('seed history and sales are deterministic, store-specific and explicitly synthetic', () => {
  const a = createOperationsState(), b = createOperationsState();
  assert.deepEqual(a, b); assert.notEqual(a, b); assert.equal(a.records.length, 0);
  for (const store of STORES) {
    const sales = a.dailySales.filter(item => item.storeId === store.id);
    assert.equal(sales.length, 28); assert.equal(new Set(sales.map(item => item.date)).size, 28);
    assert.ok(sales.every(item => item.synthetic && item.source === OPERATIONS_SOURCE.id && item.revenue > 0));
    assert.ok(a.seedRecords.some(item => item.storeId === store.id));
  }
  assert.equal(new Set(STORES.map(store => a.dailySales.find(row => row.storeId === store.id).revenue)).size, 4);
  assert.ok(a.seedRecords.every(item => item.synthetic && !item.confirmedByUser && item.photo === null));
  a.dailySales[0].revenue = 0;
  assert.notDeepEqual(a, b);
});

test('recording is immutable and captures human-confirmed observations, never AI photo analysis', () => {
  const state = freezeDeep(createOperationsState());
  const photo = { name: 'shelf.webp', type: 'image/webp', size: 1024, reference: 'blob:local-demo-reference' };
  const payload = freezeDeep(observation({ photo, revenueBefore: 10000, revenueAfter: 12000, comparableDays: 2 }));
  const next = recordOperation(state, payload);
  assert.equal(state.records.length, 0); assert.equal(next.records.length, 1);
  assert.equal(next.records[0].confirmedByUser, true); assert.equal(next.records[0].synthetic, false);
  assert.equal(next.records[0].photo.analysis, 'not-performed');
  assert.deepEqual(next.dailySales, state.dailySales);
  assert.notEqual(next.dailySales, state.dailySales);
  next.records[0].confounders.push('나중에 수정');
  assert.equal(state.records.length, 0); assert.ok(!payload.confounders);
});

test('photo-only observation produces no revenue effect and never modifies the daily revenue ledger', () => {
  const state = createOperationsState();
  const next = recordOperation(state, observation({ photo: { name: 'shelf.jpg', type: 'image/jpeg', size: 2000 } }));
  const before = buildOperationsView(state, storeId), after = buildOperationsView(next, storeId);
  const record = after.issues.find(item => item.confirmedByUser);
  assert.equal(record.effect, null); assert.equal(after.summary.revenue, before.summary.revenue);
  assert.equal(after.summary.photoCount, 1); assert.equal(after.summary.comparableObservationCount, 0);
  assert.equal(after.loop.imageAnalysisPerformed, false); assert.equal(after.loop.trainedModel, false);
  assert.equal(after.recommendations[0].predictedUplift, null);
});

test('paired revenue yields a labelled difference, not causal uplift or whole-store sales', () => {
  const state = recordOperation(createOperationsState(), observation({ revenueBefore: 10000, revenueAfter: 12500, comparableDays: 3 }));
  const view = buildOperationsView(state, storeId), effect = view.issues.find(item => item.confirmedByUser).effect;
  assert.equal(effect.delta, 2500); assert.equal(effect.percent, 25); assert.equal(effect.causal, false);
  assert.equal(effect.salesScope, 'selected-product'); assert.equal(effect.comparable, true);
  assert.match(effect.label, /인과효과 아님/); assert.equal(view.summary.comparableObservationCount, 1);
  assert.equal(view.summary.revenue, buildOperationsView(createOperationsState(), storeId).summary.revenue);
});

test('unconfirmed comparison duration and zero baseline are represented honestly', () => {
  const next = recordOperation(createOperationsState(), observation({ revenueBefore: 0, revenueAfter: 1000 }));
  const view = buildOperationsView(next, storeId), effect = view.issues.find(item => item.confirmedByUser).effect;
  assert.equal(effect.percent, null); assert.equal(effect.delta, 1000); assert.equal(effect.comparable, false);
  assert.equal(view.summary.comparableObservationCount, 0); assert.match(effect.label, /기간 미확인/);
});

test('all issue types support valid notes; product-specific issues require products', () => {
  for (const issueType of ISSUE_TYPES) {
    const payload = observation({ issueType });
    assert.doesNotThrow(() => recordOperation(createOperationsState(), payload));
  }
  for (const issueType of ['event', 'weather', 'trend', 'other']) {
    assert.doesNotThrow(() => recordOperation(createOperationsState(), { storeId, date: '2026-09-22', issueType, note: '매장 전체 관찰' }));
  }
});

test('malformed inputs fail without mutating state', () => {
  const state = freezeDeep(createOperationsState());
  const invalid = [
    { storeId: 'unknown' }, { issueType: 'promotion' }, { productId: 'made-up-sku' }, { productId: null },
    { date: '2026-02-30' }, { date: '2026/09/22' }, { date: '1926-09-22' }, { date: '2026-9-22' },
    { level: 0 }, { level: 5 }, { level: 2.5 }, { column: 7 }, { level: undefined },
    { note: '' }, { note: 'x'.repeat(1001) }, { note: 'foo\u0000bar' },
    { revenueBefore: 100 }, { revenueAfter: 100 }, { revenueBefore: -1, revenueAfter: 100 },
    { revenueBefore: NaN, revenueAfter: 100 }, { revenueBefore: '100', revenueAfter: 100 },
    { revenueBefore: 100, revenueAfter: Infinity }, { comparableDays: 1 },
    { revenueBefore: 100, revenueAfter: 101, comparableDays: 0 },
    { revenueBefore: 100, revenueAfter: 101, comparableDays: 1.5 },
    { stockoutMinutes: 1 }, { issueType: 'stockout', stockoutMinutes: 1441 },
    { confounders: 'rain' }, { confounders: Array(9).fill('rain') }, { confounders: [''] },
    { photo: {} }, { photo: { name: 'x', type: 'text/plain', size: 4 } },
    { photo: { name: 'x', type: 'image/png', size: 6 * 1024 * 1024 } },
  ];
  for (const overrides of invalid) assert.throws(() => recordOperation(state, observation(overrides)), { code: 'INVALID_OPERATION' }, JSON.stringify(overrides));
  assert.equal(state.records.length, 0);
});

test('new user stockout evidence takes priority over authored suggestions and gives a valid exact slot', () => {
  const next = recordOperation(createOperationsState(), observation({ issueType: 'stockout', productId: 'water', level: 3, column: 5, stockoutMinutes: 20 }));
  const best = recommendForStore(next, storeId)[0];
  assert.equal(best.type, 'restock'); assert.equal(best.productId, 'water');
  assert.equal(best.target.level, 3); assert.equal(best.target.column, 5);
  assert.equal(best.userEvidenceCount, 1); assert.equal(best.basisSource, 'user-confirmed-manual');
  assert.match(best.description, /실제 창고 재고/);
  assert.ok(getPlacements(storeId).some(item => item.locationId === best.target.locationId));
});

test('positive confirmed placement evidence changes best recommendation to an exact observed trial', () => {
  const before = recommendForStore(createOperationsState(), storeId)[0];
  assert.equal(before.type, 'restock');
  const next = recordOperation(createOperationsState(), observation({ revenueBefore: 10000, revenueAfter: 15000, comparableDays: 2 }));
  const best = recommendForStore(next, storeId)[0];
  assert.equal(best.type, 'placement-trial'); assert.equal(best.productId, 'water');
  assert.equal(best.target.level, 2); assert.equal(best.target.column, 4);
  assert.equal(best.target.scenario, 'observed-trial'); assert.equal(best.confidence, '관찰 부족');
  assert.equal(best.predictedUplift, null); assert.equal(best.causal, false);
});

test('recording a new position changes the recommended position instead of using a canned solution', () => {
  const first = recordOperation(withoutSeeds(), observation({ revenueBefore: 100, revenueAfter: 120, comparableDays: 1 }));
  const second = recordOperation(withoutSeeds(), observation({ level: 3, column: 6, revenueBefore: 100, revenueAfter: 120, comparableDays: 1 }));
  assert.equal(recommendForStore(first, storeId)[0].target.column, 4);
  assert.equal(recommendForStore(second, storeId)[0].target.column, 6);
  assert.equal(recommendForStore(second, storeId)[0].target.level, 3);
});

test('three independent consistent observations can be labelled repeated, never trained or causal', () => {
  let state = withoutSeeds();
  for (let day = 20; day <= 22; day++) state = recordOperation(state, observation({ date: `2026-09-${day}`, revenueBefore: 100, revenueAfter: 120, comparableDays: 1 }));
  const best = recommendForStore(state, storeId)[0];
  assert.equal(best.confidence, '반복 관찰'); assert.equal(best.independentDates, 3);
  assert.equal(best.causal, false); assert.equal(best.method, 'transparent-local-rules');
  assert.match(best.confidenceMeaning, /통계적 신뢰도가 아닙니다/);
});

test('repeated records on one date cannot inflate the independent-observation confidence', () => {
  let state = withoutSeeds();
  for (let i = 0; i < 5; i++) state = recordOperation(state, observation({ revenueBefore: 100, revenueAfter: 120, comparableDays: 1 }));
  assert.equal(recommendForStore(state, storeId)[0].confidence, '관찰 부족');
});

test('opposite-direction observations and overlapping events surface uncertainty and confounders', () => {
  let state = withoutSeeds();
  state = recordOperation(state, observation({ date: '2026-09-21', revenueBefore: 100, revenueAfter: 120, comparableDays: 1 }));
  state = recordOperation(state, observation({ revenueBefore: 100, revenueAfter: 80, comparableDays: 1, confounders: ['할인 행사 종료'] }));
  state = recordOperation(state, { storeId, date: '2026-09-22', issueType: 'event', note: '근처 행사 확인' });
  const recommendation = recommendForStore(state, storeId).find(item => item.type === 'placement-trial');
  assert.equal(recommendation.confidence, '혼재');
  assert.ok(recommendation.confounders.includes('할인 행사 종료'));
  assert.ok(recommendation.confounders.some(item => item.includes('지역 행사 동시 기록')));
  assert.match(recommendation.reasons.join(' '), /우승안으로 확정할 수 없습니다/);
});

test('synthetic examples cannot inflate the confidence of one manually confirmed observation', () => {
  const state = recordOperation(createOperationsState(), observation({ storeId: 'H-0618', productId: 'gummy', revenueBefore: 100, revenueAfter: 120, comparableDays: 1 }));
  const action = recommendForStore(state, 'H-0618').find(item => item.type === 'placement-trial');
  assert.equal(action.evidenceCount, 3); assert.equal(action.userEvidenceCount, 1); assert.equal(action.syntheticEvidenceCount, 2);
  assert.equal(action.confidence, '관찰 부족'); assert.equal(action.independentDates, 1);
});

test('recommendations and views are isolated per store, including future-dated observations', () => {
  const state = createOperationsState(), other = STORES[1].id;
  const before = buildOperationsView(state, other);
  const next = recordOperation(state, observation({ date: '2026-10-15', issueType: 'stockout', stockoutMinutes: 60 }));
  assert.deepEqual(buildOperationsView(next, other), before);
  assert.equal(buildOperationsView(next, storeId).period.end, '2026-10-15');
  assert.equal(buildOperationsView(next, storeId).series.at(-1).revenue, null);
  assert.equal(buildOperationsView(next, storeId).summary.revenueDeltaPercent, null);
});

test('period sales totals and percent compare equal-length complete periods, not issue-level effects', () => {
  const state = createOperationsState(), view = buildOperationsView(state, storeId);
  assert.equal(view.series.length, 14); assert.equal(view.summary.completeComparison, true);
  assert.equal(view.summary.revenue, view.series.reduce((sum, item) => sum + item.revenue, 0));
  assert.equal(view.summary.previousRevenue, view.series.reduce((sum, item) => sum + item.previousRevenue, 0));
  assert.equal(view.summary.revenueDeltaPercent, (view.summary.revenue - view.summary.previousRevenue) / view.summary.previousRevenue * 100);
  const partial = buildOperationsView(state, storeId, { range: 30 });
  assert.equal(partial.summary.observedDays, 28); assert.equal(partial.summary.completeComparison, false);
  assert.equal(partial.summary.revenueDeltaPercent, null); assert.equal(partial.series[0].revenue, null);
});

test('issue filter changes the timeline, not totals, sales history or recommendation evidence', () => {
  const state = createOperationsState(), all = buildOperationsView(state, storeId);
  const only = buildOperationsView(state, storeId, { filter: 'stockout' });
  assert.ok(only.issues.length > 0); assert.ok(only.issues.every(item => item.issueType === 'stockout'));
  assert.deepEqual(only.summary, all.summary); assert.deepEqual(only.series, all.series);
  assert.deepEqual(only.recommendations, all.recommendations);
});

test('every actionable product and target resolves to the real store catalog and fixture geometry', () => {
  for (const store of STORES) for (const recommendation of recommendForStore(createOperationsState(), store.id)) {
    assert.equal(recommendation.causal, false); assert.equal(recommendation.automaticOrder, false);
    if (recommendation.productId) assert.ok(PRODUCT_MAP[recommendation.productId]);
    if (recommendation.target) {
      assert.ok(getPlacements(store.id).some(item => item.locationId === recommendation.target.locationId && item.level === recommendation.target.level && item.column === recommendation.target.column));
    }
  }
});

test('views and recommendations do not mutate state and remain reproducible', () => {
  const state = freezeDeep(createOperationsState());
  assert.deepEqual(buildOperationsView(state, storeId), buildOperationsView(state, storeId));
  assert.deepEqual(recommendForStore(state, storeId), recommendForStore(state, storeId));
  const view = buildOperationsView(state, storeId); view.issues[0].note = 'changed';
  assert.notEqual(buildOperationsView(state, storeId).issues[0].note, 'changed');
});

test('empty evidence has a collect-evidence state and invalid view options fail clearly', () => {
  const state = withoutSeeds(), actions = recommendForStore(state, storeId);
  assert.equal(actions.length, 1); assert.equal(actions[0].type, 'collect-evidence');
  assert.equal(actions[0].evidenceCount, 0); assert.equal(actions[0].target, null);
  for (const options of [{ range: 0 }, { range: 91 }, { range: 1.5 }, { filter: 'invalid' }]) {
    assert.throws(() => buildOperationsView(state, storeId, options), { code: 'INVALID_OPERATION' });
  }
  assert.throws(() => buildOperationsView(state, 'unknown'), { code: 'INVALID_OPERATION' });
  assert.throws(() => recordOperation({}, observation()), { code: 'INVALID_OPERATION' });
});
