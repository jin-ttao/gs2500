import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PRODUCT_MAP, SCENARIOS } from '../demo/model.js';
import { CURRENT_BASELINE, PROPOSAL } from '../app/scenario.js';
import {
  APPROVAL_KEY, FLOW_KEY, createApprovalReceipt, loadApprovals, loadFlow,
  saveApproval, saveFlow, validatePhotoFile, validateProductApproval,
} from '../app/state.js';

const results = JSON.parse(await readFile(new URL('../app/data/experiment-results.json', import.meta.url), 'utf8'));
const samsungOwner = results.stores.find(store => store.id === 'samsung').candidates.find(candidate => candidate.scenario === 'owner');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('current baseline is separate from all engine candidates and proposal moves resolve to exact SKUs', () => {
  assert.equal(CURRENT_BASELINE.simulated, false);
  assert.notEqual(CURRENT_BASELINE.id, 'hq');
  assert.equal(new Set(CURRENT_BASELINE.levels.flat()).size, 24);
  assert.deepEqual(new Set(CURRENT_BASELINE.levels.flat()), new Set(Object.keys(PRODUCT_MAP)));
  for (const move of PROPOSAL.moves) {
    assert.ok(PRODUCT_MAP[move.productId]);
    assert.equal(CURRENT_BASELINE.levels[move.from.level - 1][move.from.column - 1], move.productId);
    assert.equal(SCENARIOS.owner.levels[move.to.level - 1][move.to.column - 1], move.productId);
  }
});

test('product approval is an exact 24-hour engine snapshot plus an explicit small-scope extension', () => {
  const receipt = createApprovalReceipt({
    result: samsungOwner,
    proposal: PROPOSAL,
    levels: SCENARIOS.owner.levels,
    messageDraft: '수정 가능한 초안',
    approvedAt: '2026-09-22T01:30:00.000Z',
  });
  assert.equal(validateProductApproval(receipt, { storeId:'samsung', scenario:'owner', bayId:'B-03' }), true);
  assert.equal(receipt.time, 86400);
  assert.equal(receipt.paidRevenue, 1857300);
  assert.equal(receipt.day.potentialTotal, 1000);
  assert.equal(receipt.day.considered, 1000);
  assert.equal(receipt.productApproval.scope, 'pilot-subset');
  assert.deepEqual(receipt.productApproval.moves, PROPOSAL.moves);
  assert.deepEqual(receipt.levels, SCENARIOS.owner.levels);
});

test('unapproved, legacy-only, incomplete and mismatched receipts stay hidden from product owner view', () => {
  const valid = createApprovalReceipt({ result:samsungOwner, proposal:PROPOSAL, levels:SCENARIOS.owner.levels, messageDraft:'초안' });
  assert.equal(validateProductApproval(null), false);
  assert.equal(validateProductApproval({ ...valid, productApproval:undefined }), false);
  assert.equal(validateProductApproval({ ...valid, time:86399 }), false);
  assert.equal(validateProductApproval({ ...valid, storeId:'station' }), false);
  assert.equal(validateProductApproval(valid, { scenario:'balanced' }), false);
});

test('approval and owner response metadata survive refresh without persisting image bytes', () => {
  const storage = memoryStorage();
  const receipt = createApprovalReceipt({ result:samsungOwner, proposal:PROPOSAL, levels:SCENARIOS.owner.levels, messageDraft:'초안' });
  saveApproval(storage, receipt);
  saveFlow(storage, {
    ...loadFlow(storage),
    response:{ choice:'partial', note:'한 상품만 이동', photoReceived:true, submittedAt:'2026-09-22T01:31:00.000Z' },
    photoReceipt:{ status:'selected-local', name:'after.jpg', type:'image/jpeg', size:2048, persisted:'metadata-only' },
  });
  const restored = loadFlow(storage);
  assert.equal(loadApprovals(storage).samsung.productApproval.candidateId, 'B');
  assert.equal(restored.response.choice, 'partial');
  assert.equal(restored.photoReceipt.name, 'after.jpg');
  assert.equal(restored.photoReceipt.persisted, 'metadata-only');
  assert.equal(JSON.stringify(restored).includes('data:image'), false);
  assert.ok(storage.getItem(APPROVAL_KEY));
  assert.ok(storage.getItem(FLOW_KEY));
});

test('candidate A is a standard reference candidate and no result claims it is current layout', () => {
  for (const store of results.stores) {
    const candidateA = store.candidates.find(candidate => candidate.scenario === 'hq');
    assert.equal(candidateA.role, 'standard-reference-candidate');
    for (const candidate of store.candidates) assert.equal(candidate.isCurrentLayout, false);
  }
});

test('photo selection accepts only supported images up to 10MB', () => {
  assert.deepEqual(validatePhotoFile({ type:'image/png', size:1024 }), { ok:true, error:'' });
  assert.match(validatePhotoFile({ type:'text/plain', size:1024 }).error, /JPG/);
  assert.match(validatePhotoFile({ type:'image/jpeg', size:10 * 1024 * 1024 + 1 }).error, /10MB/);
  assert.equal(validatePhotoFile(null).ok, false);
});
