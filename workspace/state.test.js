import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkflowState, approveProposal, getOwnerProposal, respondToProposal,
  acceptPhoto, validatePhoto, reviewSummary, PHOTO_LIMIT_BYTES,
} from './state.js';

const AT = '2026-09-22T02:00:00.000Z';
const BAYS = [
  { storeId: 'H-0412', id: 'B-03' },
  { storeId: 'H-0521', id: 'B-01' },
  { storeId: 'H-0618', id: 'B-05' },
  { storeId: 'H-0730', id: 'B-02' },
];
const CANDIDATES = [
  { id: 'A', scenario: 'owner' },
  { id: 'B', scenario: 'balanced' },
  { id: 'C', scenario: 'discovery', disabled: true },
];
const catalog = {
  getBay(storeId, bayId) { return BAYS.find((bay) => bay.storeId === storeId && bay.id === bayId); },
  getCandidate(storeId, bayId, candidateId) {
    if (!this.getBay(storeId, bayId)) throw new RangeError('Unknown bay');
    return CANDIDATES.find((candidate) => candidate.id === candidateId);
  },
};

function result(candidateId, scenario) {
  return {
    candidateId, scenario, revenue: 300000, profit: 90000,
    stockoutRate: 0.01, deltaPercent: 3.9, paidUnits: 150, payments: 100,
    cohortKey: 'fixture-1', inputFingerprint: 'fixture-hash',
    daily: Array.from({ length: 30 }, (_, i) => ({ day: i + 1, revenue: 10000, profit: 3000 })),
  };
}

function comparison(storeId = 'H-0412', bayId = 'B-03') {
  return {
    storeId, bayId, completed: true, days: 30,
    baseline: result('current', 'hq'),
    candidates: CANDIDATES.map((candidate) => result(candidate.id, candidate.scenario)),
    engine: 'local-rule', assumptions: ['합성 데이터', '동일 시드'], cohortKey: 'fixture-1', inputFingerprint: 'fixture-hash',
  };
}

function approve(state = createWorkflowState(), input = {}) {
  const { storeId = 'H-0412', bayId = 'B-03' } = input;
  return approveProposal(state, { storeId, bayId, candidateId: 'A', message: '  이번 주는 커피를 2단으로 이동해주세요.  ', comparison: comparison(storeId, bayId), timestamp: AT, ...input }, catalog);
}

function response(state, status = 'accepted', input = {}) {
  return respondToProposal(state, { storeId: 'H-0412', status, note: '', timestamp: AT, ...input });
}

function photo(state, input = {}) {
  return acceptPhoto(state, { storeId: 'H-0412', fileName: '매대.png', mimeType: 'image/png', size: 50, photoUrl: 'blob:http://localhost/demo-image', timestamp: AT, ...input });
}

test('fresh state is empty, independent, memory-only, and does not expose drafts to owners', () => {
  const first = createWorkflowState();
  assert.deepEqual(first, { loggedIn: false, role: 'manager', approvals: {}, responses: {}, photos: {} });
  assert.equal(getOwnerProposal(first, 'H-0412'), null);
  first.approvals.changed = true;
  assert.deepEqual(createWorkflowState().approvals, {});
});

test('approval retains the exact selection and edited message without sending anything', () => {
  const before = createWorkflowState();
  const state = approve(before);
  assert.deepEqual(before.approvals, {});
  const selected = getOwnerProposal(state, 'H-0412');
  assert.equal(selected.storeId, 'H-0412');
  assert.equal(selected.bayId, 'B-03');
  assert.equal(selected.candidateId, 'A');
  assert.equal(selected.message, '이번 주는 커피를 2단으로 이동해주세요.');
  assert.equal(selected.approvedAt, AT);
  assert.equal(selected.actuallySent, false);
  assert.equal(selected.executionVerified, false);
  assert.equal(selected.days, 30);
  assert.equal(selected.result.candidateId, 'A');
  assert.equal(selected.comparison, undefined);
  assert.equal(selected.candidates, undefined);
  assert.equal(selected.response, null);
  assert.equal(selected.photo, null);
  assert.equal(getOwnerProposal(state, 'H-0521'), null);
});

test('approval snapshots and owner return values cannot mutate input calculations or stored state', () => {
  const source = comparison();
  const state = approve(undefined, { comparison: source });
  source.candidates[0].revenue = 1;
  assert.equal(state.approvals['H-0412'].result.revenue, 300000);
  const visible = getOwnerProposal(state, 'H-0412');
  visible.result.revenue = 2;
  visible.baseline.revenue = 3;
  assert.equal(getOwnerProposal(state, 'H-0412').result.revenue, 300000);
  assert.equal(getOwnerProposal(state, 'H-0412').baseline.revenue, 300000);
});

for (const selection of [
  { storeId: 'no-store' }, { bayId: 'no-bay' }, { candidateId: 'no-candidate' },
]) {
  test(`unknown selection is rejected: ${JSON.stringify(selection)}`, () => {
    assert.throws(() => approve(undefined, selection), { code: 'UNKNOWN_SELECTION' });
  });
}

test('disabled candidates and current arrangement cannot be approved', () => {
  assert.throws(() => approve(undefined, { candidateId: 'C' }), { code: 'CANDIDATE_DISABLED' });
  const currentCatalog = { ...catalog, getCandidate: () => ({ id: 'current', isCurrent: true }) };
  assert.throws(() => approveProposal(createWorkflowState(), { storeId: 'H-0412', bayId: 'B-03', candidateId: 'current' }, currentCatalog), { code: 'CANDIDATE_DISABLED' });
});

test('lookup functions and valid state are required', () => {
  assert.throws(() => approveProposal(createWorkflowState(), { storeId: 'H-0412', bayId: 'B-03', candidateId: 'A' }), { code: 'CATALOG_REQUIRED' });
  assert.throws(() => getOwnerProposal({}, 'H-0412'), { code: 'INVALID_STATE' });
  assert.throws(() => getOwnerProposal(createWorkflowState(), '<script>'), { code: 'INVALID_INPUT' });
});

for (const patch of [{ completed: false }, { completed: undefined }, { days: 1 }, { days: 31 }]) {
  test(`unfinished or non-30-day results cannot be approved: ${JSON.stringify(patch)}`, () => {
    assert.throws(() => approve(undefined, { comparison: { ...comparison(), ...patch } }), { code: 'COMPARISON_NOT_COMPLETE' });
  });
}

test('mismatched store/bay/scenario and missing/duplicate candidate results are rejected', () => {
  assert.throws(() => approve(undefined, { comparison: comparison('H-0521', 'B-01') }), { code: 'COMPARISON_MISMATCH' });
  const wrongScenario = comparison();
  wrongScenario.candidates[0].scenario = 'discovery';
  assert.throws(() => approve(undefined, { comparison: wrongScenario }), { code: 'COMPARISON_MISMATCH' });
  const missing = comparison();
  missing.candidates = missing.candidates.slice(1);
  assert.throws(() => approve(undefined, { comparison: missing }), { code: 'CANDIDATE_RESULT_MISSING' });
  const duplicate = comparison();
  duplicate.candidates.push(duplicate.candidates[0]);
  assert.throws(() => approve(undefined, { comparison: duplicate }), { code: 'CANDIDATE_RESULT_MISSING' });
});

for (const [metric, value] of [['revenue', NaN], ['revenue', -1], ['profit', Infinity], ['stockoutRate', 1.5], ['deltaPercent', '3.9']]) {
  test(`invalid calculation metric is rejected: ${metric}=${value}`, () => {
    const invalid = comparison();
    invalid.candidates[0][metric] = value;
    assert.throws(() => approve(undefined, { comparison: invalid }), { code: 'INVALID_COMPARISON' });
  });
}

test('baseline and daily results are validated, not merely the selected headline', () => {
  const baseline = comparison();
  baseline.baseline.revenue = NaN;
  assert.throws(() => approve(undefined, { comparison: baseline }), { code: 'INVALID_COMPARISON' });
  const short = comparison();
  short.candidates[0].daily.pop();
  assert.throws(() => approve(undefined, { comparison: short }), { code: 'INVALID_COMPARISON' });
  const invalidDaily = comparison();
  invalidDaily.candidates[0].daily[3].profit = Infinity;
  assert.throws(() => approve(undefined, { comparison: invalidDaily }), { code: 'INVALID_COMPARISON' });
  const wrongSum = comparison();
  wrongSum.candidates[0].daily[0].revenue = 100;
  assert.throws(() => approve(undefined, { comparison: wrongSum }), { code: 'INVALID_COMPARISON' });
  const wrongDays = comparison();
  wrongDays.candidates[0].daily[0].day = 2;
  assert.throws(() => approve(undefined, { comparison: wrongDays }), { code: 'INVALID_COMPARISON' });
});

test('baseline and candidate must use the same cohort and calculation inputs', () => {
  const wrongCohort = comparison();
  wrongCohort.candidates[0].cohortKey = 'different-people';
  assert.throws(() => approve(undefined, { comparison: wrongCohort }), { code: 'COMPARISON_MISMATCH' });
  const wrongInventory = comparison();
  wrongInventory.baseline.inputFingerprint = 'different-stock';
  assert.throws(() => approve(undefined, { comparison: wrongInventory }), { code: 'COMPARISON_MISMATCH' });
});

test('cyclic or executable comparison payloads are not retained', () => {
  const cyclic = comparison();
  cyclic.self = cyclic;
  assert.throws(() => approve(undefined, { comparison: cyclic }), { code: 'INVALID_COMPARISON' });
  const executable = comparison();
  executable.evaluate = () => 1;
  assert.throws(() => approve(undefined, { comparison: executable }), { code: 'INVALID_COMPARISON' });
});

test('message/note fields are bounded plain text; HTML-looking text is not executed or modified', () => {
  assert.throws(() => approve(undefined, { message: ' ' }), { code: 'INVALID_INPUT' });
  assert.throws(() => approve(undefined, { message: 'a'.repeat(2001) }), { code: 'INVALID_INPUT' });
  assert.throws(() => approve(undefined, { message: 'a\u0000b' }), { code: 'INVALID_INPUT' });
  const state = approve(undefined, { message: '<b>점주 의견</b>' });
  assert.equal(getOwnerProposal(state, 'H-0412').message, '<b>점주 의견</b>');
  assert.throws(() => response(state, 'accepted', { note: 'a'.repeat(1001) }), { code: 'INVALID_INPUT' });
  assert.throws(() => approve(undefined, { timestamp: 'not-a-date' }), { code: 'INVALID_INPUT' });
});

test('owner cannot respond or attach a photo before approval', () => {
  assert.throws(() => response(createWorkflowState()), { code: 'APPROVAL_REQUIRED' });
  assert.throws(() => photo(createWorkflowState()), { code: 'APPROVAL_REQUIRED' });
});

for (const status of ['accepted', 'partial', 'declined']) {
  test(`owner can choose ${status} without execution being inferred`, () => {
    const approved = approve();
    const state = response(approved, status, { note: '  냉장고 위치는 유지했어요. ' });
    assert.deepEqual(approved.responses, {});
    const visible = getOwnerProposal(state, 'H-0412');
    assert.equal(visible.response.status, status);
    assert.equal(visible.response.note, '냉장고 위치는 유지했어요.');
    assert.equal(visible.response.respondedAt, AT);
    assert.equal(visible.response.executionVerified, false);
    assert.equal(visible.executionVerified, false);
  });
}

test('invalid response status cannot be silently interpreted as accepted', () => {
  assert.throws(() => response(approve(), 'done'), { code: 'INVALID_RESPONSE' });
});

test('photo requires acceptance or partial execution response', () => {
  assert.throws(() => photo(approve()), { code: 'RESPONSE_REQUIRED' });
  assert.throws(() => photo(response(approve(), 'declined')), { code: 'RESPONSE_REQUIRED' });
  assert.equal(photo(response(approve(), 'partial')).photos['H-0412'].status, 'received');
});

test('photo receipt is explicitly memory-only, not execution verification', () => {
  const before = response(approve());
  const state = photo(before);
  assert.deepEqual(before.photos, {});
  const visible = getOwnerProposal(state, 'H-0412');
  assert.equal(visible.photo.fileName, '매대.png');
  assert.equal(visible.photo.acceptedAt, AT);
  assert.equal(visible.photo.status, 'received');
  assert.equal(visible.photo.executionVerified, false);
  assert.equal(visible.photo.persistence, 'memory-until-reload');
  assert.equal(getOwnerProposal(createWorkflowState(), 'H-0412'), null);
});

for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
  test(`photo metadata accepts ${type}`, () => {
    assert.equal(validatePhoto({ name: 'photo', type, size: PHOTO_LIMIT_BYTES }).type, type);
  });
}

for (const [input, code] of [
  [{ name: 'x.txt', type: 'text/plain', size: 1 }, 'PHOTO_TYPE'],
  [{ name: 'x.svg', type: 'image/svg+xml', size: 1 }, 'PHOTO_TYPE'],
  [{ name: 'x.gif', type: 'image/gif', size: 1 }, 'PHOTO_TYPE'],
  [{ name: 'x.png', type: '', size: 1 }, 'PHOTO_TYPE'],
  [{ name: 'x.png', type: 'image/png', size: 0 }, 'PHOTO_EMPTY'],
  [{ name: 'x.png', type: 'image/png', size: -1 }, 'PHOTO_EMPTY'],
  [{ name: 'x.png', type: 'image/png', size: NaN }, 'PHOTO_EMPTY'],
  [{ name: 'x.png', type: 'image/png', size: PHOTO_LIMIT_BYTES + 1 }, 'PHOTO_TOO_LARGE'],
  [{ name: '', type: 'image/png', size: 1 }, 'INVALID_INPUT'],
]) {
  test(`invalid photo metadata is rejected: ${JSON.stringify(input)}`, () => {
    assert.throws(() => validatePhoto(input), { code });
  });
}

test('photo URL accepts local previews, rejects external and executable links', () => {
  const accepted = response(approve());
  assert.equal(photo(accepted, { photoUrl: 'data:image/png;base64,aGVsbG8=' }).photos['H-0412'].status, 'received');
  for (const photoUrl of ['https://example.com/image.png', 'javascript:alert(1)', 'data:text/html;base64,aGVsbG8=', 'data:image/jpeg;base64,aGVsbG8=', 'blob:', 'data:image/png;base64,']) {
    assert.throws(() => photo(accepted, { photoUrl }), { code: 'PHOTO_URL' });
  }
});

test('declining later clears an earlier photo', () => {
  const uploaded = photo(response(approve()));
  const declined = response(uploaded, 'declined');
  assert.ok(uploaded.photos['H-0412']);
  assert.equal(getOwnerProposal(declined, 'H-0412').photo, null);
});

test('replacement approval invalidates old response/photo and keeps other stores untouched', () => {
  let state = photo(response(approve()));
  state = approve(state, { storeId: 'H-0521', bayId: 'B-01' });
  state = response(state, 'partial', { storeId: 'H-0521' });
  const replaced = approve(state, { candidateId: 'B', message: '새 안내 초안' });
  const owner = getOwnerProposal(replaced, 'H-0412');
  assert.equal(owner.candidateId, 'B');
  assert.equal(owner.revision, 2);
  assert.equal(owner.response, null);
  assert.equal(owner.photo, null);
  assert.equal(getOwnerProposal(replaced, 'H-0521').response.status, 'partial');
  assert.ok(state.photos['H-0412']);
});

test('stale response/photo revisions are not shown or counted', () => {
  const state = photo(response(approve()));
  state.responses['H-0412'].approvalRevision = 0;
  state.photos['H-0412'].approvalRevision = 0;
  assert.equal(getOwnerProposal(state, 'H-0412').response, null);
  assert.equal(getOwnerProposal(state, 'H-0412').photo, null);
  const review = reviewSummary(state, BAYS);
  assert.equal(review.responded, 0);
  assert.equal(review.photos, 0);
  assert.equal(review.unanswered, 1);
});

test('review funnel uses the same four-bay denominator and distinguishes nonresponse', () => {
  let state = photo(response(approve()));
  state = approve(state, { storeId: 'H-0521', bayId: 'B-01' });
  state = response(state, 'partial', { storeId: 'H-0521' });
  state = photo(state, { storeId: 'H-0521' });
  state = approve(state, { storeId: 'H-0618', bayId: 'B-05' });
  const summary = reviewSummary(state, BAYS);
  assert.deepEqual({
    total: summary.total, proposed: summary.proposed, approved: summary.approved,
    responded: summary.responded, photos: summary.photos, accepted: summary.accepted,
    partial: summary.partial, declined: summary.declined, unanswered: summary.unanswered,
    unapproved: summary.unapproved, approvalRate: summary.approvalRate, responseRate: summary.responseRate,
  }, { total: 4, proposed: 4, approved: 3, responded: 2, photos: 2, accepted: 1, partial: 1, declined: 0, unanswered: 1, unapproved: 1, approvalRate: 0.75, responseRate: 0.5 });
  assert.equal(summary.executionVerified, 0);
  const refusal = reviewSummary(response(state, 'declined', { storeId: 'H-0618' }), BAYS);
  assert.equal(refusal.declined, 1);
  assert.equal(refusal.responded, 3);
  assert.equal(refusal.unanswered, 0);
  assert.equal(refusal.responseRate, 0.75);
});

test('review scope is dynamic and does not count approvals for another bay or store', () => {
  const state = photo(response(approve()));
  const single = reviewSummary(state, BAYS.slice(0, 1));
  assert.equal(single.approvalRate, 1);
  assert.equal(single.total, 1);
  const different = reviewSummary(state, [{ storeId: 'H-0412', id: 'B-99' }]);
  assert.equal(different.approved, 0);
  assert.equal(different.responded, 0);
  const empty = reviewSummary(state, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.approvalRate, 0);
  assert.equal(empty.responseRate, 0);
  assert.throws(() => reviewSummary(state, [BAYS[0], BAYS[0]]));
});

test('actual forecast/data contract passes approval and remains scoped to the chosen candidate', async () => {
  const { simulateComparison } = await import('./forecast.js');
  const actualCatalog = await import('./data.js');
  const computed = simulateComparison({ storeId: 'H-0412', bayId: 'B-03', populationPerDay: 100 });
  const state = approveProposal(createWorkflowState(), {
    storeId: 'H-0412', bayId: 'B-03', candidateId: 'B', message: '이번 주 제안입니다.',
    comparison: computed, timestamp: AT,
  }, actualCatalog);
  const owner = getOwnerProposal(state, 'H-0412');
  assert.equal(owner.result.revenue, computed.candidates.find((candidate) => candidate.candidateId === 'B').revenue);
  assert.equal(owner.engine.id, computed.engine.id);
  assert.equal(owner.comparison, undefined);
  assert.equal(reviewSummary(state, actualCatalog.BAYS).approvalRate, 0.25);
});
