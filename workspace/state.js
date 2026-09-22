/** Memory-only demo transitions. Nothing in this module persists or sends data. */
export const PHOTO_LIMIT_BYTES = 5 * 1024 * 1024;
export const PHOTO_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const RESPONSE_STATUSES = Object.freeze(['accepted', 'partial', 'declined']);

export function createWorkflowState() {
  return { loggedIn: false, role: 'manager', approvals: {}, responses: {}, photos: {} };
}

function fail(message, code = 'INVALID_INPUT') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !/^[\p{L}\p{N}_-]{1,80}$/u.test(value)) fail(`${label}를 확인해주세요.`);
  return value;
}

function plainText(value, label, limit, { required = false } = {}) {
  if (typeof value !== 'string') fail(`${label}는 텍스트여야 합니다.`);
  if (value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    fail(`${label}는 ${limit}자 이하의 일반 텍스트로 입력해주세요.`);
  }
  const text = value.trim();
  if (required && !text) fail(`${label}를 입력해주세요.`);
  return text;
}

function timestamp(value) {
  const date = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('유효하지 않은 시각입니다.');
  return date.toISOString();
}

function own(object, key) {
  return Object.hasOwn(object ?? {}, key) ? object[key] : null;
}

function assertState(state) {
  if (!state || typeof state !== 'object' || !state.approvals || !state.responses || !state.photos) {
    fail('데모 상태가 올바르지 않습니다.', 'INVALID_STATE');
  }
}

function copyJson(value) {
  const seen = new Set();
  const visit = (item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) fail('계산 결과에 유효하지 않은 숫자가 있습니다.', 'INVALID_COMPARISON');
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) return;
    if (!item || typeof item !== 'object' || seen.has(item)) fail('계산 결과 형식이 올바르지 않습니다.', 'INVALID_COMPARISON');
    seen.add(item);
    for (const child of Object.values(item)) visit(child);
    seen.delete(item);
  };
  visit(value);
  return JSON.parse(JSON.stringify(value));
}

function finite(value, label, { nonnegative = false, rate = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonnegative && value < 0) || (rate && (value < 0 || value > 1))) {
    fail(`${label} 계산 결과가 올바르지 않습니다.`, 'INVALID_COMPARISON');
  }
}

function validateResult(result, { candidate = false } = {}) {
  if (!result || typeof result !== 'object') fail('완료된 계산 결과가 없습니다.', 'INVALID_COMPARISON');
  finite(result.revenue, '예상 매출', { nonnegative: true });
  finite(result.profit, '예상 매출총이익');
  finite(result.stockoutRate, '결품 위험', { rate: true });
  if (candidate) finite(result.deltaPercent, '현재 진열 대비 예상 변화');
  if (!Array.isArray(result.daily) || result.daily.length !== 30) fail('동일 조건의 30일 계산이 완료되어야 승인할 수 있습니다.', 'INVALID_COMPARISON');
  let revenue = 0;
  let profit = 0;
  result.daily.forEach((day, index) => {
    if (!day || day.day !== index + 1) fail('일별 계산 순서가 올바르지 않습니다.', 'INVALID_COMPARISON');
    finite(day.revenue, '일별 예상 매출', { nonnegative: true });
    finite(day.profit, '일별 예상 매출총이익');
    revenue += day.revenue;
    profit += day.profit;
  });
  if (Math.abs(revenue - result.revenue) > 0.000001 || Math.abs(profit - result.profit) > 0.000001) {
    fail('일별 합계와 30일 계산 결과가 일치하지 않습니다.', 'INVALID_COMPARISON');
  }
}

function validateComparison(comparison, { storeId, bayId, candidateId }, candidate) {
  if (!comparison || comparison.completed !== true || comparison.days !== 30) {
    fail('30일 비교 계산을 먼저 완료해주세요.', 'COMPARISON_NOT_COMPLETE');
  }
  if (comparison.storeId !== storeId || comparison.bayId !== bayId) fail('다른 점포 또는 매대의 계산 결과입니다.', 'COMPARISON_MISMATCH');
  const matches = comparison.candidates?.filter((result) => result.candidateId === candidateId);
  if (!matches || matches.length !== 1) fail('선택한 후보의 계산 결과가 없습니다.', 'CANDIDATE_RESULT_MISSING');
  const result = matches[0];
  if (candidate.scenario && result.scenario !== candidate.scenario) fail('후보와 계산 시나리오가 일치하지 않습니다.', 'COMPARISON_MISMATCH');
  validateResult(comparison.baseline);
  validateResult(result, { candidate: true });
  for (const key of ['cohortKey', 'inputFingerprint']) {
    if (typeof comparison[key] !== 'string' || !comparison[key] || comparison.baseline[key] !== comparison[key] || result[key] !== comparison[key]) {
      fail('현재안과 후보의 비교 입력이 일치하지 않습니다.', 'COMPARISON_MISMATCH');
    }
  }
  return copyJson(comparison);
}

/** Returns a new state; a replacement approval invalidates the old response/photo. */
export function approveProposal(state, { storeId, bayId, candidateId, message, comparison, timestamp: at } = {}, catalog = {}) {
  assertState(state);
  identifier(storeId, '점포 ID');
  identifier(bayId, '매대 ID');
  identifier(candidateId, '후보 ID');
  if (typeof catalog.getBay !== 'function' || typeof catalog.getCandidate !== 'function') fail('점포·매대·후보 목록이 필요합니다.', 'CATALOG_REQUIRED');
  let bay;
  let candidate;
  try {
    bay = catalog.getBay(storeId, bayId);
    candidate = catalog.getCandidate(storeId, bayId, candidateId);
  } catch {
    fail('존재하지 않는 점포·매대·후보입니다.', 'UNKNOWN_SELECTION');
  }
  if (!bay || !candidate) fail('존재하지 않는 점포·매대·후보입니다.', 'UNKNOWN_SELECTION');
  if (candidate.disabled || candidate.isCurrent || candidateId === 'current') fail('이 후보는 승인할 수 없습니다.', 'CANDIDATE_DISABLED');
  const approvedComparison = validateComparison(comparison, { storeId, bayId, candidateId }, candidate);
  const previous = own(state.approvals, storeId);
  const approval = {
    storeId, bayId, candidateId,
    message: plainText(message, '점주 안내 초안', 2000, { required: true }),
    comparison: approvedComparison,
    result: approvedComparison.candidates.find((result) => result.candidateId === candidateId),
    approvedAt: timestamp(at),
    revision: (previous?.revision ?? 0) + 1,
    status: 'approved',
    delivery: 'same-browser-demo-only',
    actuallySent: false,
  };
  const responses = { ...state.responses };
  const photos = { ...state.photos };
  delete responses[storeId];
  delete photos[storeId];
  return { ...state, approvals: { ...state.approvals, [storeId]: approval }, responses, photos };
}

function requireApproval(state, storeId) {
  assertState(state);
  identifier(storeId, '점포 ID');
  const approval = own(state.approvals, storeId);
  if (!approval || approval.status !== 'approved') fail('매니저가 승인한 제안이 없습니다.', 'APPROVAL_REQUIRED');
  return approval;
}

/** Owner access is scoped to a single approved selection, never a draft. */
export function getOwnerProposal(state, storeId) {
  assertState(state);
  identifier(storeId, '점포 ID');
  const approval = own(state.approvals, storeId);
  if (!approval || approval.status !== 'approved') return null;
  const response = own(state.responses, storeId);
  const photo = own(state.photos, storeId);
  // Do not expose the unapproved candidate comparison through the owner view.
  const { comparison, ...selection } = approval;
  return copyJson({
    ...selection,
    baseline: comparison.baseline,
    days: comparison.days,
    assumptions: comparison.assumptions ?? [],
    engine: comparison.engine ?? 'synthetic-demo',
    response: response?.approvalRevision === approval.revision ? response : null,
    photo: photo?.approvalRevision === approval.revision ? photo : null,
    executionVerified: false,
  });
}

export function respondToProposal(state, { storeId, status, note = '', timestamp: at } = {}) {
  const approval = requireApproval(state, storeId);
  if (!RESPONSE_STATUSES.includes(status)) fail('수용·부분 실행·거절 중 하나를 선택해주세요.', 'INVALID_RESPONSE');
  const response = {
    storeId, bayId: approval.bayId, candidateId: approval.candidateId,
    approvalRevision: approval.revision,
    status,
    note: plainText(note, '의견', 1000),
    respondedAt: timestamp(at),
    executionVerified: false,
  };
  const photos = { ...state.photos };
  // A later refusal cannot keep a photo implying accepted execution.
  if (status === 'declined') delete photos[storeId];
  return { ...state, responses: { ...state.responses, [storeId]: response }, photos };
}

/** Metadata check only. The browser must separately decode the selected image. */
export function validatePhoto({ name, type, size } = {}) {
  const fileName = plainText(name, '파일 이름', 255, { required: true });
  if (!PHOTO_MIME_TYPES.includes(type)) fail('JPG·PNG·WebP 이미지 파일만 접수할 수 있습니다.', 'PHOTO_TYPE');
  if (!Number.isSafeInteger(size) || size <= 0) fail('비어 있거나 올바르지 않은 파일입니다.', 'PHOTO_EMPTY');
  if (size > PHOTO_LIMIT_BYTES) fail('사진은 5MB 이하로 선택해주세요.', 'PHOTO_TOO_LARGE');
  return { name: fileName, type, size };
}

export function acceptPhoto(state, { storeId, fileName, mimeType, size, photoUrl, timestamp: at } = {}) {
  const approval = requireApproval(state, storeId);
  const response = own(state.responses, storeId);
  if (!response || response.approvalRevision !== approval.revision || !['accepted', 'partial'].includes(response.status)) {
    fail('수용 또는 부분 실행으로 회신한 뒤 사진을 접수해주세요.', 'RESPONSE_REQUIRED');
  }
  const file = validatePhoto({ name: fileName, type: mimeType, size });
  if (typeof photoUrl !== 'string' || !(photoUrl.startsWith('blob:') && photoUrl.length > 5 || new RegExp(`^data:${mimeType};base64,[A-Za-z0-9+/]+={0,2}$`).test(photoUrl))) {
    fail('이 브라우저에서 선택한 이미지의 미리보기가 필요합니다.', 'PHOTO_URL');
  }
  const photo = {
    storeId, bayId: approval.bayId, candidateId: approval.candidateId,
    approvalRevision: approval.revision,
    fileName: file.name, mimeType: file.type, size: file.size, photoUrl,
    acceptedAt: timestamp(at),
    status: 'received',
    executionVerified: false,
    persistence: 'memory-until-reload',
  };
  return { ...state, photos: { ...state.photos, [storeId]: photo } };
}

/** All funnel rates use the same supplied-bay denominator, not fixed demo counts. */
export function reviewSummary(state, bays) {
  assertState(state);
  if (!Array.isArray(bays)) fail('회고할 매대 목록이 필요합니다.');
  const seen = new Set();
  const rows = bays.map((bay) => {
    const storeId = identifier(bay.storeId, '점포 ID');
    const bayId = identifier(bay.id ?? bay.bayId, '매대 ID');
    const key = `${storeId}:${bayId}`;
    if (seen.has(key)) fail('회고 매대가 중복되었습니다.');
    seen.add(key);
    const approval = own(state.approvals, storeId);
    const approved = approval?.status === 'approved' && approval.bayId === bayId;
    const response = approved ? own(state.responses, storeId) : null;
    const responded = Boolean(response && response.approvalRevision === approval.revision && RESPONSE_STATUSES.includes(response.status));
    const photo = approved ? own(state.photos, storeId) : null;
    const hasPhoto = Boolean(responded && response.status !== 'declined' && photo?.approvalRevision === approval.revision && photo.status === 'received');
    return { storeId, bayId, proposed: bay.proposed !== false, approved: Boolean(approved), responded, hasPhoto, status: responded ? response.status : approved ? 'unanswered' : 'unapproved' };
  });
  const count = (predicate) => rows.filter(predicate).length;
  const total = rows.length;
  const proposed = count((row) => row.proposed);
  const approved = count((row) => row.approved);
  const responded = count((row) => row.responded);
  const photos = count((row) => row.hasPhoto);
  return {
    total, denominator: total, proposed, approved, responded, photos,
    accepted: count((row) => row.status === 'accepted'),
    partial: count((row) => row.status === 'partial'),
    declined: count((row) => row.status === 'declined'),
    unanswered: count((row) => row.status === 'unanswered'),
    unapproved: count((row) => row.status === 'unapproved'),
    approvalRate: total ? approved / total : 0,
    responseRate: total ? responded / total : 0,
    photoRate: total ? photos / total : 0,
    executionVerified: 0,
    rows,
  };
}
