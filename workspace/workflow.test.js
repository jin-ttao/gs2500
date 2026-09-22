/** Contract-level end-to-end tests. Browser clicks/rendering are checked separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BAYS, STORES, PRODUCTS, getBay, getCandidate, getStore, getInventory, getPlacements } from './data.js';
import { simulateComparison } from './forecast.js';
import {
  createWorkflowState, approveProposal, getOwnerProposal,
  respondToProposal, acceptPhoto, reviewSummary,
} from './state.js';
import { renderApp } from './views.js';

const AT = '2026-09-22T03:00:00.000Z';
const catalog = { getBay, getCandidate };
const forecasts = new Map(BAYS.map(bay => [bay.storeId,
  simulateComparison({ storeId: bay.storeId, bayId: bay.id, populationPerDay: 64 }),
]));

function approve(state, bay, candidateId = 'A', extra = {}) {
  return approveProposal(state, {
    storeId: bay.storeId, bayId: bay.id, candidateId,
    message: `${bay.id}의 ${candidateId}안을 제안합니다. 사정에 맞춰 부분 실행이나 거절이 가능합니다.`,
    comparison: forecasts.get(bay.storeId), timestamp: AT, ...extra,
  }, catalog);
}
function respond(state, bay, status) {
  return respondToProposal(state, {
    storeId: bay.storeId, status, note: `${status} 회신 · 합성 데모`, timestamp: AT,
  });
}
function photo(state, bay) {
  return acceptPhoto(state, {
    storeId: bay.storeId, fileName: `${bay.id}.webp`, mimeType: 'image/webp', size: 128,
    photoUrl: `blob:http://localhost/${bay.storeId}`, timestamp: AT,
  });
}

test('full four-store lifecycle preserves exact selection, edited message, responses, and common denominators', () => {
  let state = createWorkflowState();
  for (const bay of BAYS) assert.equal(getOwnerProposal(state, bay.storeId), null);
  assert.equal(reviewSummary(state, BAYS).approved, 0);

  state = approve(state, BAYS[0], 'B', { message: '콜드브루는 기존 위치를 유지해도 됩니다. 합성 30일 예상이며 발송되지 않습니다.' });
  const first = getOwnerProposal(state, BAYS[0].storeId);
  assert.equal(first.candidateId, 'B');
  assert.equal(first.bayId, BAYS[0].id);
  assert.equal(first.message, '콜드브루는 기존 위치를 유지해도 됩니다. 합성 30일 예상이며 발송되지 않습니다.');
  assert.equal(first.result.revenue, forecasts.get(BAYS[0].storeId).candidates[1].revenue);
  assert.equal(first.baseline.revenue, forecasts.get(BAYS[0].storeId).baseline.revenue);
  assert.equal(first.days, 30);
  assert.equal(first.comparison, undefined);
  assert.equal(first.candidates, undefined);
  for (const bay of BAYS.slice(1)) assert.equal(getOwnerProposal(state, bay.storeId), null);

  state = photo(respond(state, BAYS[0], 'partial'), BAYS[0]);
  state = photo(respond(approve(state, BAYS[1], 'A'), BAYS[1], 'accepted'), BAYS[1]);
  state = respond(approve(state, BAYS[2], 'C'), BAYS[2], 'declined');
  state = approve(state, BAYS[3], 'A');

  const review = reviewSummary(state, BAYS);
  assert.equal(review.denominator, BAYS.length);
  assert.equal(review.proposed, 4);
  assert.equal(review.approved, 4);
  assert.equal(review.responded, 3);
  assert.equal(review.photos, 2);
  assert.equal(review.accepted, 1);
  assert.equal(review.partial, 1);
  assert.equal(review.declined, 1);
  assert.equal(review.unanswered, 1);
  assert.equal(review.approvalRate, 1);
  assert.equal(review.responseRate, 0.75);
  assert.equal(review.photoRate, 0.5);
  assert.equal(review.executionVerified, 0);
  assert.equal(getOwnerProposal(state, BAYS[2].storeId).photo, null);
  assert.equal(getOwnerProposal(state, BAYS[3].storeId).response, null);
  assert.equal(getOwnerProposal(state, BAYS[0].storeId).photo.persistence, 'memory-until-reload');

  // Changed manager approval must not inherit the previous candidate's execution claims.
  state = approve(state, BAYS[0], 'C');
  const replaced = getOwnerProposal(state, BAYS[0].storeId);
  assert.equal(replaced.candidateId, 'C');
  assert.equal(replaced.response, null);
  assert.equal(replaced.photo, null);
  assert.equal(reviewSummary(state, BAYS).responded, 2);
  assert.equal(reviewSummary(state, BAYS).photos, 1);
  assert.equal(reviewSummary(state, BAYS).unanswered, 2);
});

test('incorrect store/candidate calculation cannot alter an existing approved workflow', () => {
  const state = photo(respond(approve(createWorkflowState(), BAYS[0]), BAYS[0], 'accepted'), BAYS[0]);
  const before = JSON.stringify(state);
  assert.throws(() => approve(state, BAYS[0], 'B', { comparison: forecasts.get(BAYS[1].storeId) }), { code: 'COMPARISON_MISMATCH' });
  assert.throws(() => approve(state, BAYS[0], 'missing'), { code: 'UNKNOWN_SELECTION' });
  assert.throws(() => respondToProposal(state, { storeId: BAYS[1].storeId, status: 'accepted' }), { code: 'APPROVAL_REQUIRED' });
  assert.equal(JSON.stringify(state), before);
  assert.equal(getOwnerProposal(state, BAYS[0].storeId).candidateId, 'A');
});

test('zero-stock forecast produces no sales and retains explicit per-SKU warnings in the approved view', () => {
  const bay = BAYS[0];
  const zero = Object.fromEntries(PRODUCTS.map(product => [product.id, 0]));
  const comparison = simulateComparison({
    storeId: bay.storeId, bayId: bay.id, populationPerDay: 64,
    deliveryScale: 0, inventoryOverrides: { totalStock: zero },
  });
  assert.equal(comparison.baseline.revenue, 0);
  for (const candidate of comparison.candidates) {
    assert.equal(candidate.revenue, 0);
    assert.equal(candidate.profit, 0);
    assert.equal(candidate.paidUnits, 0);
    assert.equal(candidate.warnings.length, PRODUCTS.length);
    assert.ok(candidate.warnings.every(warning => warning.type === 'zero-stock'));
  }
  const state = approve(createWorkflowState(), bay, 'A', { comparison });
  const owner = getOwnerProposal(state, bay.storeId);
  assert.equal(owner.result.revenue, 0);
  assert.equal(owner.result.warnings.length, PRODUCTS.length);
  assert.ok(owner.result.warnings.every(warning => /초기 재고 0개/.test(warning.message)));
});

test('rejecting an invalid upload does not erase an earlier accepted image or response', () => {
  const bay = BAYS[0];
  const state = photo(respond(approve(createWorkflowState(), bay), bay, 'partial'), bay);
  const before = JSON.stringify(state);
  assert.throws(() => acceptPhoto(state, {
    storeId: bay.storeId, fileName: 'bad.svg', mimeType: 'image/svg+xml', size: 100,
    photoUrl: 'blob:http://localhost/bad', timestamp: AT,
  }), { code: 'PHOTO_TYPE' });
  assert.equal(JSON.stringify(state), before);
  assert.equal(getOwnerProposal(state, bay.storeId).photo.fileName, `${bay.id}.webp`);
  assert.equal(getOwnerProposal(state, bay.storeId).response.status, 'partial');
});

test('explicit timestamps make workflow transitions deterministic and a fresh state loses all demo records', () => {
  const execute = () => photo(respond(approve(createWorkflowState(), BAYS[0]), BAYS[0], 'accepted'), BAYS[0]);
  assert.deepEqual(execute(), execute());
  const fresh = createWorkflowState();
  assert.equal(getOwnerProposal(fresh, BAYS[0].storeId), null);
  assert.equal(reviewSummary(fresh, BAYS).responded, 0);
  assert.equal(reviewSummary(fresh, BAYS).photos, 0);
});

test('owner rendering escapes edited messages, reply notes, and file names instead of creating markup', () => {
  const bay = BAYS[0];
  const poison = '<img src=x onerror="alert(1)">';
  let state = approve(createWorkflowState(), bay, 'B', { message: poison });
  state = respondToProposal(state, { storeId: bay.storeId, status: 'partial', note: poison, timestamp: AT });
  state = acceptPhoto(state, {
    storeId: bay.storeId, fileName: `${poison}.png`, mimeType: 'image/png', size: 100,
    photoUrl: 'blob:http://localhost/safe-preview', timestamp: AT,
  });
  const photo = state.photos[bay.storeId];
  const html = renderApp({
    route: 'owner', state, stores: STORES, bays: BAYS,
    store: getStore(bay.storeId), bay, candidate: getCandidate(bay.storeId, bay.id, 'B'),
    products: PRODUCTS, results: { [`${bay.storeId}:${bay.id}`]: forecasts.get(bay.storeId) },
    approval: getOwnerProposal(state, bay.storeId),
    response: { ...state.responses[bay.storeId], photoName: photo.fileName, photoUrl: photo.photoUrl },
    photo, inventory: getInventory(bay.storeId), placements: getPlacements(bay.storeId, 'balanced'),
    baselinePlacements: getPlacements(bay.storeId, 'hq'),
  });
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(!html.includes(poison));
  assert.ok(!html.includes('class="forecast-card"'));
  assert.ok(!html.includes('class="option-card"'));
});
