import { PRODUCT_MAP, SCENARIOS } from '../demo/model.js';

export const APP_SCHEMA = 'gs2500-product-scenario/1';
export const REPRESENTATIVE_STORE_ID = 'samsung';
export const REPRESENTATIVE_CANDIDATE = 'owner';
export const REPRESENTATIVE_BAY_ID = 'B-03';

export const STORES = Object.freeze([
  { id: 'samsung', code: 'H-0412', name: '삼성역점', format: '합성 오피스형', yoy: -8.4, sales: 42840000, priority: '우선 확인', reason: '음료 매대 회전 둔화', bayId: 'B-03' },
  { id: 'station', code: 'H-0188', name: '역세권 데모점', format: '합성 세로형', yoy: -6.2, sales: 37620000, priority: '확인 필요', reason: '저녁 결품과 동선 혼잡', bayId: 'B-02' },
  { id: 'residential', code: 'H-0527', name: '주거지 데모점', format: '합성 주거지형', yoy: -4.9, sales: 34180000, priority: '확인 필요', reason: '간편식 노출 저하', bayId: 'B-04' },
  { id: 'riverside', code: 'H-0714', name: '한강변 데모점', format: '합성 수변형', yoy: -1.7, sales: 29510000, priority: '관찰', reason: '주말 수요 변동', bayId: 'B-01' },
  { id: 'university', code: 'H-0321', name: '대학가 데모점', format: '합성 캠퍼스형', yoy: 1.1, sales: 38960000, priority: '유지', reason: '신상품 반응 관찰', bayId: 'B-06' },
  { id: 'tourism', code: 'H-0630', name: '관광지 데모점', format: '합성 관광형', yoy: 2.8, sales: 31240000, priority: '유지', reason: '계절 행사 영향', bayId: 'B-05' },
  { id: 'compact', code: 'H-0094', name: '골목 데모점', format: '합성 소형점', yoy: -3.3, sales: 21880000, priority: '다른 가설', reason: '발주·행사 조건 우선', bayId: 'B-02' },
  { id: 'cafe', code: 'H-0841', name: '카페 데모점', format: '합성 취식형', yoy: 4.6, sales: 40610000, priority: '유지', reason: '취식대 연계 양호', bayId: 'B-03' },
  { id: 'park', code: 'H-0907', name: '공원 데모점', format: '합성 산책형', yoy: 0.4, sales: 26490000, priority: '관찰', reason: '날씨 변동 큼', bayId: 'B-01' },
]);

export const CURRENT_BASELINE = Object.freeze({
  id: 'samsung-b03-current-v1',
  storeId: REPRESENTATIVE_STORE_ID,
  bayId: REPRESENTATIVE_BAY_ID,
  label: '현재 진열 기준선',
  simulated: false,
  image: './app/assets/samsung-b03-current-synthetic.png',
  imageLabel: '삼성역점 B-03 합성 현재 매대 이미지',
  levels: [
    ['water', 'zero', 'milk', 'juice', 'tea', 'coffee'],
    ['rice', 'noodle', 'sandwich', 'bento', 'kimbap', 'soup'],
    ['chips', 'cracker', 'gummy', 'cookie', 'chocolate', 'popcorn'],
    ['protein', 'nuts', 'eggs', 'fruit', 'yogurt', 'proteinbar'],
  ],
  note: '현재 진열은 제품 흐름 설명을 위해 별도로 작성한 합성 fixture입니다. A/B/C/D 24시간 실험에는 현재 진열 기준선이 포함되지 않습니다.',
});

export const EVIDENCE = Object.freeze([
  { id: 'stock-zero', label: '초기 총재고', value: '제로 스파클링 150개', source: '3D 엔진 합성 fixture', kind: 'inventory' },
  { id: 'turnover-zero', label: '최근 4주 판매량', value: '전년 동기 대비 -11%', source: '작성된 합성 POS 관찰', kind: 'performance' },
  { id: 'peer-zero', label: '비교 점포', value: '같은 합성 상권 9곳 중 7곳이 3단 배치', source: '작성된 합성 현장 조사', kind: 'peer' },
  { id: 'promo-zero', label: '상품 조건', value: '프로모션 대상 가정', source: 'demo/model.js 상품 fixture', kind: 'promotion' },
]);

export const PROPOSAL = Object.freeze({
  id: 'P-SAM-B03-B-01',
  storeId: REPRESENTATIVE_STORE_ID,
  storeCode: 'H-0412',
  bayId: REPRESENTATIVE_BAY_ID,
  candidateScenario: REPRESENTATIVE_CANDIDATE,
  candidateId: 'B',
  candidateTitle: SCENARIOS[REPRESENTATIVE_CANDIDATE].title,
  sourceBaselineId: CURRENT_BASELINE.id,
  scope: 'pilot-subset',
  workloadMinutes: 12,
  newOrder: false,
  reversible: true,
  moves: [
    { productId: 'zero', productName: PRODUCT_MAP.zero.name, from: { level: 1, column: 2 }, to: { level: 3, column: 2 }, action: '위로 이동' },
    { productId: 'cracker', productName: PRODUCT_MAP.cracker.name, from: { level: 3, column: 2 }, to: { level: 2, column: 4 }, action: '빈 자리로 이동' },
  ],
  reason: '재고가 충분한 프로모션 음료를 눈높이 구간에서 먼저 관찰합니다.',
  caveat: 'B 전체 배치의 24시간 결과를 참고해 고른 작은 실행안입니다. 이 두 상품만 옮긴 효과를 별도로 시뮬레이션한 값은 아닙니다.',
});

export const DEFAULT_MESSAGE = `[GS2500 합성 데모] 삼성역점 사장님, B-03 매대에서 제로 스파클링을 1단에서 3단으로, 담백 크래커를 3단에서 2단으로 옮겨보는 제안입니다. 새 발주는 없고 약 12분이 예상됩니다. 가능한 범위만 실행하거나 어려운 이유를 남겨주세요. 이 문자는 발송되지 않는 수정용 초안입니다.`;

export const REVIEW_CASES = Object.freeze([
  { id: 'station', store: '역세권 데모점', status: '부진', approved: true, responded: true, photo: true, response: '부분 실행', beforeYoy: -6.2, afterYoy: -7.1, note: '작업을 두 번에 나눴고 저녁 결품이 이어졌습니다.', alternative: '진열보다 발주 주기와 퇴근 시간 수요가 더 큰 설명일 수 있습니다.', next: '발주 조정 검토' },
  { id: 'residential', store: '주거지 데모점', status: '미회신', approved: true, responded: false, photo: false, response: '미회신', beforeYoy: -4.9, afterYoy: null, note: '승인 뒤 회신이 없습니다.', alternative: '주말 인력 부족 메모가 있어 실행 여부를 알 수 없습니다.', next: '현장 지원 확인' },
  { id: 'compact', store: '골목 데모점', status: '미승인', approved: false, responded: false, photo: false, response: '제안 보류', beforeYoy: -3.3, afterYoy: -2.8, note: '진열 제안보다 발주·행사 조건을 먼저 보기로 했습니다.', alternative: '4주 관찰치는 진열 제안과 무관한 합성 점포 실적입니다.', next: '행사·발주 가설' },
]);

export const getStore = id => STORES.find(store => store.id === id) || STORES[0];
export const getCandidate = scenario => ({ scenario, ...SCENARIOS[scenario] });
export const product = id => PRODUCT_MAP[id];
