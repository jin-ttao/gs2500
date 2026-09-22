/**
 * Local, transparent operations evidence loop. No image recognition, ML training,
 * API calls, persistence, causal estimates, or changes to the simulation ledger.
 */
import { STORES, PRODUCT_MAP, getStore, getPlacements, getInventory } from './data.js';

export const ISSUE_TYPES = Object.freeze(['stockout', 'event', 'placement', 'weather', 'trend', 'other']);
export const ISSUE_LABELS = Object.freeze({ stockout: '결품', event: '지역 행사', placement: '진열 변경', weather: '날씨', trend: '관심 변화', other: '운영 메모' });
export const OPERATIONS_SOURCE = Object.freeze({
  id: 'authored-operations-demo-v1', label: '작성된 합성 운영 기록', synthetic: true,
  description: '실제 점포의 POS·사진 분석 결과가 아닌 UI 검증용 예시입니다.',
});
const DAY = 86400000;
const AS_OF = '2026-09-22';
const empty = value => value === undefined || value === null || value === '';
const copy = value => JSON.parse(JSON.stringify(value));

function fail(message) { const error = new Error(message); error.code = 'INVALID_OPERATION'; throw error; }
function text(value, label, max = 1000, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(`${label} 형식을 확인해주세요.`);
  const result = value.trim();
  if (required && !result) fail(`${label}를 입력해주세요.`);
  return result;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) fail('날짜는 YYYY-MM-DD 형식으로 입력해주세요.');
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) fail('존재하는 날짜를 입력해주세요.');
  return value;
}
function number(value, label, { min = 0, max = 1e12, integer = true } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(`${label} 범위를 확인해주세요.`);
  return value;
}
function storeFor(id) { try { return getStore(id); } catch { fail('등록된 점포를 선택해주세요.'); } }
function assertState(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.dailySales) || !Array.isArray(state.seedRecords) || !Array.isArray(state.records)) fail('운영 기록 상태가 올바르지 않습니다.');
  validDate(state.asOf);
}
function dateOffset(date, offset) { return new Date(Date.parse(date + 'T00:00:00Z') + offset * DAY).toISOString().slice(0, 10); }
function promoPlacements(storeId, scenario = 'hq') { return getPlacements(storeId, scenario).filter(item => item.fixtureId === 'promo'); }
function position(storeId, productId, scenario = 'hq') { return promoPlacements(storeId, scenario).find(item => item.productId === productId); }
function targetFor(placement, scenario = 'hq') {
  return { fixtureId: placement.fixtureId, fixtureName: '입구 행사 매대', level: placement.level, column: placement.column,
    locationId: placement.locationId, scenario, label: `입구 행사 매대 ${placement.level}층 · 왼쪽에서 ${placement.column}번째` };
}
function photoMetadata(value) {
  if (empty(value)) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('사진 정보 형식을 확인해주세요.');
  const name = text(value.name, '사진 이름', 200, true);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(value.type)) fail('JPG, PNG, WEBP 사진을 선택해주세요.');
  const size = number(value.size, '사진 용량', { min: 1, max: 5 * 1024 * 1024 });
  // A local reference is metadata only, never fetched or interpreted as evidence.
  const reference = empty(value.reference) ? null : text(value.reference, '사진 참조', 2048, true);
  return { name, type: value.type, size, reference, analysis: 'not-performed', interpretation: 'user-confirmed' };
}

/** Seeded date/value fixtures are stable across machines and independent of Date.now. */
export function createOperationsState() {
  const dailySales = STORES.flatMap((store, storeIndex) => Array.from({ length: 28 }, (_, index) => {
    const date = dateOffset(AS_OF, index - 27);
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const base = [3610000, 3240000, 3950000, 3500000][storeIndex];
    const wave = (((index * 17 + store.seed) % 19) - 9) * 14500;
    const weekend = isWeekend ? (storeIndex < 2 ? -.17 : .09) : 0;
    const authoredChange = index > 17 ? [45000, -60000, 70000, 30000][storeIndex] : 0;
    const revenue = Math.round((base * (1 + weekend) + wave + authoredChange) / 100) * 100;
    return { storeId: store.id, date, revenue, transactions: Math.round(revenue / (6400 + storeIndex * 170)),
      source: OPERATIONS_SOURCE.id, synthetic: true, metric: 'whole-store-daily-sales-KRW' };
  }));
  const definitions = [
    { storeId: 'H-0412', issueType: 'stockout', productId: 'sandwich', date: '2026-09-18', stockoutMinutes: 45, note: '점심 행사 매대에서 샌드위치 빈칸을 발견한 합성 사례. 창고 보유 수량을 먼저 확인합니다.', revenueBefore: 184000, revenueAfter: 157000, comparableDays: 1 },
    { storeId: 'H-0412', issueType: 'placement', productId: 'tea', date: '2026-09-19', level: 3, column: 6, note: '유자티를 간식 옆으로 옮긴 합성 시험. 같은 기간 인근 행사도 있었으므로 원인을 분리할 수 없습니다.', revenueBefore: 88000, revenueAfter: 94600, comparableDays: 2, confounders: ['인근 사무실 행사', '방문객 수 미측정'] },
    { storeId: 'H-0412', issueType: 'event', productId: null, date: '2026-09-19', note: '인근 사무실 행사로 유입이 달라졌다고 설정한 데모입니다. 실제 행사 이력이 아닙니다.' },
    { storeId: 'H-0521', issueType: 'stockout', productId: 'water', date: '2026-09-20', stockoutMinutes: 60, note: '퇴근 시간 생수 매대 공백. 합성 창고 재고와 매대 보충 시간을 확인할 필요가 있습니다.', revenueBefore: 99000, revenueAfter: 77000, comparableDays: 1 },
    { storeId: 'H-0521', issueType: 'weather', productId: null, date: '2026-09-20', note: '비가 온 것으로 설정한 합성 기록. 통행량과 매출 감소의 관계는 검증하지 않았습니다.' },
    { storeId: 'H-0521', issueType: 'placement', productId: 'rice', date: '2026-09-16', level: 2, column: 1, note: '간편식 상품군을 한곳에 모은 합성 비교. 구매 동선을 별도로 측정하지 않았습니다.', revenueBefore: 125000, revenueAfter: 127000, comparableDays: 2 },
    { storeId: 'H-0618', issueType: 'placement', productId: 'gummy', date: '2026-09-16', level: 2, column: 4, note: '젤리 진열 시험의 첫 번째 합성 관찰.', revenueBefore: 64000, revenueAfter: 72000, comparableDays: 2 },
    { storeId: 'H-0618', issueType: 'placement', productId: 'gummy', date: '2026-09-20', level: 2, column: 4, note: '동일 위치의 두 번째 합성 관찰. 반복만으로 인과효과가 입증되지는 않습니다.', revenueBefore: 68000, revenueAfter: 72800, comparableDays: 2 },
    { storeId: 'H-0618', issueType: 'trend', productId: 'gummy', date: '2026-09-20', note: '간식 관심 증가를 가정한 작성 예시. 실제 SNS 트렌드가 아닙니다.' },
    { storeId: 'H-0730', issueType: 'event', productId: null, date: '2026-09-20', note: '지역 행사 방문 증가를 설정한 합성 사례. 실제 개최·유입 자료는 없습니다.', revenueBefore: 3480000, revenueAfter: 3710000, comparableDays: 1 },
    { storeId: 'H-0730', issueType: 'placement', productId: 'proteinbar', date: '2026-09-17', level: 3, column: 5, note: '커피와 함께 고를 상품의 위치를 비교한 합성 사례.', revenueBefore: 72500, revenueAfter: 80000, comparableDays: 2 },
    { storeId: 'H-0730', issueType: 'placement', productId: 'proteinbar', date: '2026-09-21', level: 3, column: 5, note: '후속 합성 관찰에서는 반대 방향으로 변화했습니다.', revenueBefore: 77500, revenueAfter: 72500, comparableDays: 2 },
  ];
  const state = { version: 1, asOf: AS_OF, dailySales, seedRecords: [], records: [] };
  const seedRecords = definitions.map((item, index) => ({
    ...normalizeRecord(item), id: `demo-operation-${index + 1}`, source: OPERATIONS_SOURCE.id,
    synthetic: true, confirmedByUser: false, photo: null,
  }));
  return { ...state, seedRecords };
}

function normalizeRecord(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('운영 기록을 입력해주세요.');
  const store = storeFor(payload.storeId);
  const date = validDate(payload.date);
  if (!ISSUE_TYPES.includes(payload.issueType)) fail('등록된 이슈 유형을 선택해주세요.');
  const productId = empty(payload.productId) ? null : payload.productId;
  if (productId !== null && (typeof productId !== 'string' || !Object.hasOwn(PRODUCT_MAP, productId))) fail('등록된 상품을 선택해주세요.');
  if (['stockout', 'placement'].includes(payload.issueType) && productId === null) fail('결품·진열 기록에는 상품 선택이 필요합니다.');
  const hasLevel = !empty(payload.level), hasColumn = !empty(payload.column);
  if (hasLevel !== hasColumn) fail('진열 층과 열을 함께 입력해주세요.');
  if (hasLevel && !productId) fail('상품을 선택한 뒤 위치를 입력해주세요.');
  let placement = productId ? position(store.id, productId) : null;
  if (hasLevel) {
    const level = number(payload.level, '진열 층', { min: 1, max: 4 });
    const column = number(payload.column, '진열 열', { min: 1, max: 6 });
    placement = promoPlacements(store.id).find(item => item.level === level && item.column === column);
    if (!placement) fail('해당 점포에 없는 진열 위치입니다.');
  }
  const hasBefore = !empty(payload.revenueBefore), hasAfter = !empty(payload.revenueAfter);
  if (hasBefore !== hasAfter) fail('비교 전·후 매출은 함께 입력해주세요.');
  const revenueBefore = hasBefore ? number(payload.revenueBefore, '비교 전 매출') : null;
  const revenueAfter = hasAfter ? number(payload.revenueAfter, '비교 후 매출') : null;
  const comparableDays = empty(payload.comparableDays) ? null : number(payload.comparableDays, '동일 길이 비교 기간', { min: 1, max: 365 });
  if (comparableDays !== null && !hasBefore) fail('비교 기간에는 전·후 매출을 함께 입력해주세요.');
  const stockoutMinutes = empty(payload.stockoutMinutes) ? null : number(payload.stockoutMinutes, '결품 시간', { max: 1440 });
  if (stockoutMinutes !== null && payload.issueType !== 'stockout') fail('결품 시간은 결품 기록에서만 입력할 수 있습니다.');
  const confounders = payload.confounders ?? [];
  if (!Array.isArray(confounders) || confounders.length > 8) fail('함께 달라진 조건은 8개까지 입력해주세요.');
  return { storeId: store.id, date, issueType: payload.issueType, productId,
    productName: productId ? PRODUCT_MAP[productId].name : null,
    level: placement?.level ?? null, column: placement?.column ?? null,
    fixtureId: placement?.fixtureId ?? null, locationId: placement?.locationId ?? null,
    positionConfirmed: hasLevel, note: text(payload.note ?? '', '운영 메모', 1000, true),
    revenueBefore, revenueAfter, comparableDays, stockoutMinutes,
    confounders: [...new Set(confounders.map(item => text(item, '함께 달라진 조건', 120, true)))],
    photo: photoMetadata(payload.photo), salesScope: productId ? 'selected-product' : 'whole-store',
  };
}

/** Caller confirms the observation. Photos are references, never automatic evidence. */
export function recordOperation(state, payload) {
  assertState(state);
  const record = normalizeRecord(payload);
  const id = `user-operation-${state.records.length + 1}`;
  if (state.records.some(item => item.id === id)) fail('운영 기록 ID가 중복되었습니다.');
  return { ...copy(state),
    records: [...copy(state.records), { ...record, id, source: 'user-confirmed-manual', synthetic: false, confirmedByUser: true }] };
}

function effectFor(record) {
  if (record.revenueBefore === null || record.revenueAfter === null) return null;
  const delta = record.revenueAfter - record.revenueBefore;
  return { before: record.revenueBefore, after: record.revenueAfter, delta,
    percent: record.revenueBefore > 0 ? delta / record.revenueBefore * 100 : null,
    comparableDays: record.comparableDays, comparable: record.comparableDays !== null,
    salesScope: record.salesScope, causal: false, kind: 'reported-before-after',
    label: record.comparableDays === null ? '입력 매출 차이 · 비교 기간 미확인' : '동일 길이 기간의 입력 매출 차이 · 인과효과 아님' };
}
function scopedRecords(state, storeId) { return [...state.seedRecords, ...state.records].filter(item => item.storeId === storeId); }
function decorateIssue(record) {
  return { ...copy(record), label: ISSUE_LABELS[record.issueType], effect: effectFor(record),
    sourceLabel: record.synthetic ? '합성 예시' : '사용자 확인 · 미검증 입력',
    photoAnalysis: '미수행', causal: false };
}
function evidenceInfo(records, all) {
  const users = records.filter(item => item.confirmedByUser);
  // Authored examples cannot inflate the confidence of a user's real observation.
  const basis = users.length ? users : records;
  const paired = basis.filter(item => item.revenueBefore !== null && item.comparableDays !== null);
  const signs = new Set(paired.map(item => Math.sign(item.revenueAfter - item.revenueBefore)).filter(Boolean));
  const dates = new Set(basis.map(item => item.date));
  const overlapping = all.filter(item => basis.some(record => record.date === item.date) && ['event', 'weather', 'trend'].includes(item.issueType));
  const confounders = [...new Set([
    ...basis.flatMap(item => item.confounders), ...overlapping.map(item => `${item.date} ${ISSUE_LABELS[item.issueType]} 동시 기록`),
    '요일·방문객 수·가격·프로모션을 통제하지 않음',
    ...(paired.length < basis.length ? ['비교 가능한 전·후 매출이 없는 관찰 포함'] : []),
  ])];
  const mixed = signs.size > 1;
  const confidence = mixed ? '혼재' : dates.size >= 3 && (paired.length >= 3 || basis.every(item => item.issueType === 'stockout')) ? '반복 관찰' : '관찰 부족';
  return { evidenceCount: records.length, userEvidenceCount: users.length, syntheticEvidenceCount: records.length - users.length,
    comparableEvidenceCount: paired.length, independentDates: dates.size, confidence,
    confidenceMeaning: '기록의 반복·방향 일치 정도이며 인과효과의 통계적 신뢰도가 아닙니다.',
    confounders, evidenceIds: records.map(item => item.id), basis, signs, mixed };
}

/** Rule-based hypotheses, ordered by confirmed issues. Never predicts a sales uplift. */
export function recommendForStore(state, storeId) {
  assertState(state); storeFor(storeId);
  const all = scopedRecords(state, storeId);
  const groups = new Map();
  for (const record of all) {
    const key = `${record.issueType}:${record.productId ?? 'store'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const inventory = getInventory(storeId);
  const recommendations = [...groups].map(([key, records]) => {
    const sample = records.at(-1), info = evidenceInfo(records, all);
    const productId = sample.productId;
    const productName = productId ? PRODUCT_MAP[productId].name : null;
    const sourcePlacement = productId ? position(storeId, productId) : null;
    let target = sourcePlacement ? targetFor(sourcePlacement) : null;
    let type = 'collect-evidence', title, description, nextMeasurement;
    let priority = 20 + Math.min(info.evidenceCount, 5) + (info.userEvidenceCount ? 60 : 0);
    const reasons = [`${info.userEvidenceCount}건의 사용자 확인 기록 · ${info.syntheticEvidenceCount}건의 합성 예시`];
    if (sample.issueType === 'stockout') {
      type = 'restock'; priority += 35;
      const latest = [...info.basis].sort((a, b) => b.date.localeCompare(a.date)).find(item => item.positionConfirmed);
      if (latest) target = targetFor(promoPlacements(storeId).find(item => item.level === latest.level && item.column === latest.column), 'observed-location');
      const maxMinutes = Math.max(0, ...info.basis.map(item => item.stockoutMinutes ?? 0));
      priority += Math.min(maxMinutes / 30, 10);
      title = `${productName} 매대 보충을 먼저 확인`;
      description = `${target.label}의 빈칸을 확인하고, 실제 창고 재고를 확인한 뒤 보충하세요. 위치 변경보다 판매 가능 상태를 먼저 확보하는 제안입니다.`;
      reasons.push(maxMinutes ? `기록된 결품 시간 최대 ${maxMinutes}분` : '결품 시간이 미입력되어 현장 확인 필요');
      reasons.push(`데모 초기 창고 재고 ${inventory.backroom[productId]}개는 실시간 재고가 아닙니다.`);
      nextMeasurement = '보충 전·후 사진과 실제 보충 수량, 다음 동일 시간대의 결품 분·상품 판매 수량을 기록하세요.';
    } else if (sample.issueType === 'placement') {
      type = 'placement-trial'; priority += 25;
      const positive = info.basis.filter(item => item.comparableDays !== null && item.revenueAfter > item.revenueBefore && item.positionConfirmed);
      const locationGroups = new Map();
      for (const item of positive) {
        const location = `${item.level}:${item.column}`;
        if (!locationGroups.has(location)) locationGroups.set(location, []);
        locationGroups.get(location).push(item);
      }
      const promising = [...locationGroups.values()].sort((a, b) => b.length - a.length || b.at(-1).date.localeCompare(a.at(-1).date))[0]?.at(-1);
      if (promising && !info.mixed) {
        const placement = promoPlacements(storeId).find(item => item.level === promising.level && item.column === promising.column);
        target = targetFor(placement, 'observed-trial');
        priority += 10;
        reasons.push(`입력 매출이 증가한 ${promising.level}층 ${promising.column}열 기록이 있으나 원인은 확정하지 않았습니다.`);
      } else {
        const alternative = ['balanced', 'discovery', 'owner'].map(scenario => ({ scenario, placement: position(storeId, productId, scenario) }))
          .find(item => item.placement.level !== sourcePlacement.level || item.placement.column !== sourcePlacement.column);
        if (alternative) target = targetFor(alternative.placement, alternative.scenario);
        reasons.push(info.mixed ? '전·후 매출 방향이 엇갈려 한 위치를 우승안으로 확정할 수 없습니다.' : '비교 가능한 반복 관찰이 없어 후보 위치를 검증하는 단계입니다.');
      }
      const occupant = promoPlacements(storeId).find(item => item.locationId === target.locationId);
      title = `${productName} ${target.level}층 ${target.column}열 소규모 진열 시험`;
      const collision = occupant.productId === productId ? '사진으로 실제 배치가 기록과 같은지 확인하세요.' : `${PRODUCT_MAP[occupant.productId].name}의 현재 배치와 충돌 여부를 확인하세요.`;
      description = `${target.label}에 시험 배치하고, ${collision} 관리자 승인 후 한 상품의 위치만 바꿔 비교합니다.`;
      reasons.push(`현재안: ${sourcePlacement.level}층 ${sourcePlacement.column}열 · 후보는 실제 매대 슬롯을 사용합니다.`);
      nextMeasurement = '동일 요일·시간대에 가격·행사·재고 조건을 함께 기록하고, 상품 판매 수량과 매출·결품 시간을 최소 3회 비교하세요.';
    } else {
      title = `${ISSUE_LABELS[sample.issueType]}와 매출을 같은 시간대로 기록`;
      description = `${productName ? productName + '의 ' : ''}관심·유입 변화와 진열 효과를 분리할 수 있도록 먼저 비교 근거를 모으세요. 자동 발주나 매출 개선 확정은 하지 않습니다.`;
      reasons.push('이슈의 발생과 매출의 동시 변화는 원인·결과를 의미하지 않습니다.');
      nextMeasurement = '이슈 시작·종료 시각, 비교 가능한 이전 기간, 방문 수, 할인 여부, 상품 재고를 함께 남겨주세요.';
    }
    const { basis, signs, mixed, ...publicInfo } = info;
    return { id: `recommendation:${storeId}:${key}`, storeId, type, issueType: sample.issueType, title, description,
      productId, productName, target, priority: Math.round(priority), ...publicInfo, reasons, nextMeasurement,
      causal: false, predictedUplift: null, requiresApproval: true, automaticOrder: false,
      method: 'transparent-local-rules', basisSource: info.userEvidenceCount ? 'user-confirmed-manual' : OPERATIONS_SOURCE.id,
    };
  });
  if (!recommendations.length) recommendations.push({
    id: `recommendation:${storeId}:start`, storeId, type: 'collect-evidence', issueType: 'other', title: '최초 운영 기록을 남겨주세요',
    description: '사진에서 직접 확인한 상품·위치와 운영 이슈를 기록하면 다음 비교 가설을 정리합니다.', productId: null, productName: null, target: null,
    priority: 0, evidenceCount: 0, userEvidenceCount: 0, syntheticEvidenceCount: 0, comparableEvidenceCount: 0, independentDates: 0,
    confidence: '관찰 부족', confidenceMeaning: '분석할 운영 기록이 없습니다.', confounders: ['비교 데이터 없음'], evidenceIds: [],
    reasons: ['아직 확인된 기록이 없습니다.'], nextMeasurement: '사진 확인 내용과 날짜, 상품, 위치, 비교 기간의 매출을 기록하세요.',
    causal: false, predictedUplift: null, requiresApproval: true, automaticOrder: false, method: 'transparent-local-rules', basisSource: null,
  });
  return recommendations.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function buildOperationsView(state, storeId, { range = 14, filter = 'all' } = {}) {
  assertState(state); const store = storeFor(storeId);
  number(range, '조회 기간', { min: 1, max: 90 });
  if (filter !== 'all' && !ISSUE_TYPES.includes(filter)) fail('등록된 이슈 필터를 선택해주세요.');
  const all = scopedRecords(state, storeId);
  // A future-dated record must not silently move another store's chart window.
  const end = all.reduce((latest, item) => item.date > latest ? item.date : latest, state.asOf);
  const start = dateOffset(end, 1 - range), previousStart = dateOffset(start, -range);
  const within = all.filter(item => item.date >= start && item.date <= end);
  const daily = state.dailySales.filter(item => item.storeId === storeId);
  const series = Array.from({ length: range }, (_, index) => {
    const date = dateOffset(start, index), record = daily.find(item => item.date === date);
    const previous = daily.find(item => item.date === dateOffset(date, -range));
    return { date, revenue: record?.revenue ?? null, previousRevenue: previous?.revenue ?? null, transactions: record?.transactions ?? null,
      synthetic: record ? true : null, source: record?.source ?? null,
      issueCount: within.filter(item => item.date === date).length,
      issues: within.filter(item => item.date === date).map(item => ({ id: item.id, type: item.issueType, label: ISSUE_LABELS[item.issueType], synthetic: item.synthetic })) };
  });
  const measured = series.filter(item => item.revenue !== null);
  const previous = daily.filter(item => item.date >= previousStart && item.date < start);
  const revenue = measured.reduce((sum, item) => sum + item.revenue, 0);
  const previousRevenue = previous.reduce((sum, item) => sum + item.revenue, 0);
  const completeComparison = measured.length === range && previous.length === range;
  const userRecords = within.filter(item => item.confirmedByUser);
  const paired = userRecords.filter(item => effectFor(item)?.comparable);
  const recommendations = recommendForStore(state, storeId);
  return {
    store: copy(store), period: { start, end, days: range, previousStart },
    summary: { revenue, previousRevenue: previous.length ? previousRevenue : null,
      revenueDeltaPercent: completeComparison && previousRevenue > 0 ? (revenue - previousRevenue) / previousRevenue * 100 : null,
      revenueSource: OPERATIONS_SOURCE.id, revenueSynthetic: true, observedDays: measured.length, expectedDays: range,
      completeComparison, issueCount: within.length, userObservationCount: userRecords.length,
      syntheticObservationCount: within.length - userRecords.length, photoCount: userRecords.filter(item => item.photo).length,
      comparableObservationCount: paired.length, stockoutMinutes: within.filter(item => item.issueType === 'stockout').reduce((sum, item) => sum + (item.stockoutMinutes ?? 0), 0),
      userStockoutMinutes: userRecords.filter(item => item.issueType === 'stockout').reduce((sum, item) => sum + (item.stockoutMinutes ?? 0), 0),
      recommendationCount: recommendations.length, transactions: measured.reduce((sum, item) => sum + item.transactions, 0),
    },
    series, issues: within.filter(item => filter === 'all' || item.issueType === filter)
      .sort((a, b) => b.date.localeCompare(a.date) || Number(b.confirmedByUser) - Number(a.confirmedByUser) || a.id.localeCompare(b.id)).map(decorateIssue),
    recommendations, recommendationPeriod: 'all-recorded-history',
    loop: { method: 'local-evidence-feedback', trainedModel: false, imageAnalysisPerformed: false, automaticSalesAttribution: false,
      stages: [
        { id: 'capture', label: '사진·현장 확인', count: userRecords.filter(item => item.photo).length },
        { id: 'observe', label: '이슈 기록', count: userRecords.length },
        { id: 'compare', label: '전·후 비교', count: paired.length },
        { id: 'recommend', label: '다음 시험 제안', count: recommendations.filter(item => item.userEvidenceCount > 0).length },
      ],
      label: '기록 → 비교 → 가설 갱신 → 다음 시험 · 현재는 학습 모델이 아닌 규칙 기반 추천',
    },
    sources: [copy(OPERATIONS_SOURCE), { id: 'user-confirmed-manual', label: '사용자 확인 · 미검증 입력', synthetic: false,
      description: '사진 내용·매출을 사용자가 직접 확인해 입력합니다. POS 검증·AI 사진 판독은 하지 않았습니다.' }],
    metricDefinitions: { revenue: '선택 기간의 작성된 합성 점포 일매출 합계. 사용자 입력 상품별 전·후 매출과 별도입니다.',
      effect: '사용자가 입력한 전·후 매출의 차이이며 진열 변경의 인과효과나 예상 추가 매출이 아닙니다.',
      confidence: '관찰 부족/반복 관찰/혼재는 기록의 반복과 방향 일치 정도입니다. 통계적 유의성이나 모델 정확도가 아닙니다.',
      learning: '점포별 운영 기록을 추가하면 공개된 규칙으로 추천 우선순위·근거를 갱신합니다. 모델을 훈련하거나 사진을 자동 판독하지 않습니다.',
      stockoutMinutes: '개별 결품 기록의 입력 분 합계입니다. 같은 시간의 여러 상품 결품은 중복될 수 있습니다.' },
    disclaimer: '합성 매출과 사용자 확인 기록을 분리합니다. 관찰된 변화는 인과효과가 아니며, 사진만으로 매출이나 최적 위치를 판단하지 않습니다.',
  };
}
