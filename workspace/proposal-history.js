/**
 * Authored, synthetic histories of proposals already applied in the demo.
 * Revenue is whole-store KRW over complete, equal-length calendar periods.
 * These are not GS POS records, live observations, or simulation predictions.
 */
export const HISTORY_AS_OF = '2026-09-22';
const DAY = 86400000;
const SOURCE = 'authored-proposal-history';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const PROPOSAL_HISTORY = freeze([
  {
    id: 'history-h0412-20260825', storeId: 'H-0412', bayId: 'B-03', candidateId: 'B',
    appliedOn: '2026-08-25', checkedOn: HISTORY_AS_OF, execution: 'full', status: 'improved',
    title: '점심 간편식과 음료 동반 진열',
    changeSummary: 'B안을 적용해 간편식을 2단에, 커피·간식을 3단에 배치했습니다.',
    expectedDeltaPercent: 8.4, synthetic: true, source: SOURCE,
    measurements: [
      { week: 1, days: 7, beforeRevenue: 24850000, afterRevenue: 26490000 },
      { week: 2, days: 7, beforeRevenue: 25410000, afterRevenue: 27090000 },
      { week: 3, days: 7, beforeRevenue: 24640000, afterRevenue: 26300000 },
      { week: 4, days: 7, beforeRevenue: 25100000, afterRevenue: 26820000 },
    ],
    stockouts: { beforeMinutes: 190, afterMinutes: 95 },
    events: [
      { date: '2026-08-25', title: '진열 적용', note: '합성 이력: B안 배치와 가격표 정리를 완료했습니다.' },
      { date: '2026-09-08', title: '2주 점검', note: '합성 관찰: 점심 시간 음료 보충 간격을 줄였습니다.' },
      { date: '2026-09-21', title: '4주 관찰 종료', note: '합성 관찰: 전후 매출 증가와 결품 시간 감소를 확인했습니다. 주변 행사 영향은 분리하지 않았습니다.' },
    ],
    ownerNote: '합성 점주 메모: 점심 보충은 수월해졌지만 금요일 음료 빈칸은 계속 살펴봐야 합니다.',
    followUp: '현재 배치를 유지하고 금요일 점심 음료 보충 시간과 결품 여부를 다음 점검에 기록합니다.',
  },
  {
    id: 'history-h0521-20260908', storeId: 'H-0521', bayId: 'B-01', candidateId: 'A',
    appliedOn: '2026-09-08', checkedOn: HISTORY_AS_OF, execution: 'partial', status: 'attention',
    title: '퇴근 시간 생수·간편식 전면 진열',
    changeSummary: 'A안 중 간편식 위치를 적용했고 생수 구역은 입고 지연으로 기존 위치에 남아 있습니다.',
    expectedDeltaPercent: 5.8, synthetic: true, source: SOURCE,
    measurements: [
      { week: 1, days: 7, beforeRevenue: 22680000, afterRevenue: 22160000 },
      { week: 2, days: 7, beforeRevenue: 22960000, afterRevenue: 21940000 },
    ],
    stockouts: { beforeMinutes: 80, afterMinutes: 165 },
    events: [
      { date: '2026-09-08', title: '일부 진열 적용', note: '합성 이력: 간편식 위치만 변경했고 생수 위치 변경은 미완료 상태입니다.' },
      { date: '2026-09-16', title: '보충 지연 기록', note: '합성 관찰: 퇴근 시간 생수 입고·보충 지연이 기록됐습니다.' },
      { date: '2026-09-21', title: '2주 점검', note: '합성 관찰: 매출은 감소했고 결품 시간은 늘었습니다. 비 오는 날의 유입 변화도 함께 기록했습니다.' },
    ],
    ownerNote: '합성 점주 메모: 생수 위치 변경이 끝나지 않았고 저녁 보충 인력이 부족했습니다.',
    followUp: '생수 입고와 보충 시간을 먼저 확인하고 미완료 구역 적용 후 다음 2주 매출·결품을 다시 점검합니다.',
  },
  {
    id: 'history-h0618-20260825', storeId: 'H-0618', bayId: 'B-05', candidateId: 'B',
    appliedOn: '2026-08-25', checkedOn: HISTORY_AS_OF, execution: 'full', status: 'improved',
    title: '간식 상품군과 주력 음료 함께 배치',
    changeSummary: 'B안을 적용해 간식·커피를 3단에 모으고 간편식을 2단에 배치했습니다.',
    expectedDeltaPercent: 7.6, synthetic: true, source: SOURCE,
    measurements: [
      { week: 1, days: 7, beforeRevenue: 27160000, afterRevenue: 29430000 },
      { week: 2, days: 7, beforeRevenue: 27860000, afterRevenue: 30430000 },
      { week: 3, days: 7, beforeRevenue: 27300000, afterRevenue: 29850000 },
      { week: 4, days: 7, beforeRevenue: 27680000, afterRevenue: 30290000 },
    ],
    stockouts: { beforeMinutes: 145, afterMinutes: 65 },
    events: [
      { date: '2026-08-25', title: '진열 적용', note: '합성 이력: B안을 적용해 간식·커피를 3단에 모으고 간편식을 2단에 배치했습니다.' },
      { date: '2026-09-08', title: '2주 점검', note: '합성 관찰: 매출 증가와 저녁 간식 보충 필요를 함께 기록했습니다.' },
      { date: '2026-09-21', title: '4주 관찰 종료', note: '합성 관찰: 4개 주차 모두 비교 주차보다 매출이 높았습니다. 지역 행사와 상품 관심 변화가 함께 있었습니다.' },
    ],
    ownerNote: '합성 점주 메모: 간식을 찾기 쉬워졌다는 반응이 있었고 저녁 보충 횟수도 조정했습니다.',
    followUp: '현재 배치와 보충 간격을 유지하며 행사 종료 뒤에도 매출 증가가 이어지는지 다음 점검에 확인합니다.',
  },
  {
    id: 'history-h0730-20260908', storeId: 'H-0730', bayId: 'B-02', candidateId: 'C',
    appliedOn: '2026-09-08', checkedOn: HISTORY_AS_OF, execution: 'full', status: 'monitoring',
    title: '커피 옆 신상품 간식 진열',
    changeSummary: 'C안을 적용해 커피 인접 구역에 신상품 간식을 배치했습니다.',
    expectedDeltaPercent: 6.2, synthetic: true, source: SOURCE,
    measurements: [
      { week: 1, days: 7, beforeRevenue: 24380000, afterRevenue: 25030000 },
      { week: 2, days: 7, beforeRevenue: 24620000, afterRevenue: 25540000 },
    ],
    stockouts: { beforeMinutes: 100, afterMinutes: 85 },
    events: [
      { date: '2026-09-08', title: '진열 적용', note: '합성 이력: C안의 커피 인접 신상품 진열을 완료했습니다.' },
      { date: '2026-09-17', title: '초기 관찰', note: '합성 관찰: 신상품 문의와 주말 행사 유입을 기록했습니다.' },
      { date: '2026-09-21', title: '2주 점검', note: '합성 관찰: 초기 매출이 늘었지만 4주 결과는 아직 없습니다.' },
    ],
    ownerNote: '합성 점주 메모: 신상품을 묻는 고객이 있었지만 주말 행사 영향도 있어 더 지켜보겠습니다.',
    followUp: '10월 6일 4주 점검에서 행사 종료 후 매출과 커피·간식 결품 시간을 함께 확인합니다.',
  },
]);

const timestamp = date => Date.parse(`${date}T00:00:00Z`);
const offsetDate = (date, days) => new Date(timestamp(date) + days * DAY).toISOString().slice(0, 10);

function enrich(record) {
  const elapsedDays = (timestamp(record.checkedOn) - timestamp(record.appliedOn)) / DAY;
  const observedDays = record.measurements.reduce((sum, item) => sum + item.days, 0);
  const beforeRevenue = record.measurements.reduce((sum, item) => sum + item.beforeRevenue, 0);
  const afterRevenue = record.measurements.reduce((sum, item) => sum + item.afterRevenue, 0);
  const deltaRevenue = afterRevenue - beforeRevenue;
  return {
    ...record, elapsedDays, observedDays, beforeRevenue, afterRevenue, deltaRevenue,
    deltaPercent: deltaRevenue / beforeRevenue * 100,
    dailyBefore: beforeRevenue / observedDays, dailyAfter: afterRevenue / observedDays,
    // Inclusive date windows; the as-of/check date is not a completed sales day.
    comparisonWindow: {
      before: { start: offsetDate(record.appliedOn, -observedDays), end: offsetDate(record.appliedOn, -1) },
      after: { start: record.appliedOn, end: offsetDate(record.appliedOn, observedDays - 1) },
    },
  };
}

/** Counts always describe the full authored history, independent of list filters. */
export function buildProposalHistory({ period = 'all', status = 'all' } = {}) {
  if (!['all', '14', '28'].includes(period)) throw new RangeError('지원하지 않는 관찰 기간입니다.');
  if (!['all', 'attention'].includes(status)) throw new RangeError('지원하지 않는 점검 상태입니다.');
  const history = PROPOSAL_HISTORY.map(enrich);
  return {
    asOf: HISTORY_AS_OF,
    records: history.filter(record => (period === 'all' || record.observedDays === Number(period))
      && (status === 'all' || record.status === status)),
    totalRecords: history.length,
    summary: {
      tracking: history.length,
      week4: history.filter(record => record.observedDays === 28).length,
      improved: history.filter(record => record.status === 'improved').length,
      attention: history.filter(record => record.status === 'attention').length,
    },
    filters: { period, status },
  };
}
