/** One synthetic contract shared by the manager app and the existing 3D engine. */
import { PRODUCTS, PRODUCT_MAP, SCENARIOS } from '../demo/model.js';
import { getMap } from '../demo/maps.js';
import { getFixturePlacements } from '../demo/merchandising.js';
import { splitDayInventory } from '../demo/day.js';

export { PRODUCTS, PRODUCT_MAP, SCENARIOS };
export const DATA_SOURCE = Object.freeze({
  id: 'gs2500-workflow-fixture-v1', synthetic: true, observed: false,
  label: '합성 데모 데이터 · 실제 GS25 판매·재고 자료 아님',
});

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

export const STORES = freeze([
  { id: 'H-0412', name: '삼성역점', engineStoreId: 'samsung', mapId: 'office', seed: 11, stockScale: 1, profileWeights: [3,5,1,2,2], yoy: -2.8, targetAchievement: 94.6, sales: 108400000, bayId: 'B-03', region: '서울 강남 · 오피스 상권', manager: '김민지', observation: '점심 간편식 수요와 행사 매대의 위치를 함께 검토', period: '2026.08 · 전년 동월 비교', source: DATA_SOURCE.id },
  { id: 'H-0521', name: '역삼중앙점', engineStoreId: 'station', mapId: 'express', seed: 29, stockScale: .85, profileWeights: [1,5,1,4,1], yoy: -4.1, targetAchievement: 91.2, sales: 97200000, bayId: 'B-01', region: '서울 강남 · 역세권 상권', manager: '김민지', observation: '빠른 구매 동선에서 입구 매대의 시인성을 확인', period: '2026.08 · 전년 동월 비교', source: DATA_SOURCE.id },
  { id: 'H-0618', name: '대치사거리점', engineStoreId: 'residential', mapId: 'residential', seed: 47, stockScale: 1.2, profileWeights: [5,1,4,1,2], yoy: 1.6, targetAchievement: 102.3, sales: 118600000, bayId: 'B-05', region: '서울 강남 · 주거 상권', manager: '김민지', observation: '가족 간식·식사 구매와 재고 소진을 함께 검토', period: '2026.08 · 전년 동월 비교', source: DATA_SOURCE.id },
  { id: 'H-0730', name: '선릉역점', engineStoreId: 'cafe', mapId: 'cafe', seed: 113, stockScale: 1.1, profileWeights: [2,4,1,6,2], yoy: -.9, targetAchievement: 97.4, sales: 105100000, bayId: 'B-02', region: '서울 강남 · 취식 상권', manager: '김민지', observation: '커피와 함께 고를 상품의 인접 배치를 검토', period: '2026.08 · 전년 동월 비교', source: DATA_SOURCE.id },
]);

const candidateDefinitions = [
  { id: 'A', scenario: 'owner', name: SCENARIOS.owner.title, minutes: 8, orderSkus: [], description: '보유 수량이 많은 상품을 2·3층으로 이동하는 가설. 창고에서 채울 수 있는 수량과 결품을 함께 비교합니다.' },
  { id: 'B', scenario: 'balanced', name: SCENARIOS.balanced.title, minutes: 10, orderSkus: [], description: '간편식과 함께 고르는 상품을 이웃으로 두는 가설. 눈높이뿐 아니라 좌우 위치와 보완 상품을 함께 반영합니다.' },
  { id: 'C', scenario: 'discovery', name: SCENARIOS.discovery.title, minutes: 12, orderSkus: ['proteinbar'], description: '합성 신상품 5종을 2층에 모아 탐색을 유도하는 가설. 트렌드는 데모 가정이며 추가 발주는 검토만 합니다.' },
];

export const BAYS = freeze(STORES.map(store => ({
  id: store.bayId, storeId: store.id, name: '입구 행사 매대', fixtureId: 'promo',
  baselineScenario: 'hq', baselineName: '현재 진열 · 본사 표준안',
  location: { ...getMap(store.mapId).fixtures.find(f => f.id === 'promo') },
  evidence: [
    { id: 'sales', title: '지난달 전년 동기비', text: `${store.yoy > 0 ? '+' : ''}${store.yoy}% · ${store.observation}`, source: DATA_SOURCE.id, status: 'assumed' },
    { id: 'stock', title: '24개 SKU · 매대 + 창고 재고', text: '기존 3D와 동일한 초기 수량을 사용합니다. 창고 재고는 판매가 아니라 매대 보충으로만 이동합니다.', source: 'demo/model.js + demo/day.js', status: 'assumed' },
    { id: 'placement', title: '눈높이·좌우 위치·이웃 상품', text: '2·3층 노출, 중앙 위치, 보완 상품 인접 효과는 실측 계수가 아닌 비교 실험 가정입니다.', source: 'demo/merchandising.js', status: 'assumed' },
    { id: 'trend', title: '신상품 관심 신호', text: '프로틴바·젤리 관심 상승은 데모 가정입니다. 실제 SNS를 수집하거나 실시간 유행을 확인하지 않았습니다.', source: 'authored-trend-assumption', status: 'assumed' },
  ],
  candidates: candidateDefinitions.map(candidate => ({ ...candidate, orderSkus: [...candidate.orderSkus], disabled: false })),
})));

export function getStore(storeId) {
  const store = STORES.find(item => item.id === storeId);
  if (!store) throw new RangeError('알 수 없는 점포입니다: ' + String(storeId));
  return store;
}

export function getBay(storeId, bayId) {
  getStore(storeId);
  const bay = BAYS.find(item => item.storeId === storeId && item.id === bayId);
  if (!bay) throw new RangeError('이 점포에 없는 매대입니다: ' + String(bayId));
  return bay;
}

export function getCandidate(storeId, bayId, candidateId) {
  const candidate = getBay(storeId, bayId).candidates.find(item => item.id === candidateId);
  if (!candidate) throw new RangeError('이 매대에 없는 후보입니다: ' + String(candidateId));
  return candidate;
}

/** Fresh copies prevent one candidate or UI from mutating another's starting stock. */
export function getInventory(storeId) {
  return splitDayInventory({ stockScale: getStore(storeId).stockScale });
}

export function getPlacements(storeId, scenario = 'hq') {
  if (!Object.hasOwn(SCENARIOS, scenario)) throw new RangeError('알 수 없는 진열안입니다.');
  return getMap(getStore(storeId).mapId).fixtures.flatMap(fixture => getFixturePlacements(fixture, scenario));
}

export function getShelfRows(storeId, scenario = 'hq') {
  const inventory = getInventory(storeId);
  const placements = getPlacements(storeId, scenario).filter(item => item.fixtureId === 'promo');
  return [4,3,2,1].map(level => ({ level, eyeLevel: level === 2 || level === 3,
    products: placements.filter(item => item.level === level).sort((a,b) => a.column-b.column).map(item => ({
      ...PRODUCT_MAP[item.productId], ...item, stock: inventory.total[item.productId],
      shelfStock: inventory.shelf[item.productId], backroomStock: inventory.backroom[item.productId],
    })),
  }));
}

export function getWorldConfig({ storeId, bayId, candidateId = 'current' } = {}) {
  const store = getStore(storeId); getBay(storeId, bayId);
  const scenario = candidateId === 'current' || candidateId === null ? 'hq' : getCandidate(storeId, bayId, candidateId).scenario;
  const inventory = getInventory(storeId);
  return { mode: 'day', duration: 86400, population: 1000, limit: 1000,
    storeId: store.engineStoreId, mapId: store.mapId, seed: store.seed, scenario,
    stockScale: store.stockScale, profileWeights: [...store.profileWeights],
    totalStock: inventory.total, shelfStock: inventory.shelf, backroomStock: inventory.backroom, shelfCapacity: inventory.capacity,
    runId: `workflow:${storeId}:${bayId}:${scenario}`,
  };
}

export const RETROSPECTIVE_CASES = freeze([
  { storeId: 'H-0412', bayId: 'B-03', status: 'improved', reply: 'accepted', yoyBefore: -2.8, yoyAfter: 1.2, headline: '좋아진 사례', explanation: '합성 4주 관찰에서 전년 동기비가 개선되었습니다. 인근 사무실 행사와 기온 변화도 가능한 설명입니다.', source: 'authored-four-week-case', synthetic: true },
  { storeId: 'H-0521', bayId: 'B-01', status: 'declined', reply: 'partial', yoyBefore: -4.1, yoyAfter: -4.8, headline: '부진한 사례', explanation: '일부 상품만 옮긴 합성 사례입니다. 점심 결품과 공사로 인한 통행량 감소를 다음 지원 가설로 남깁니다.', source: 'authored-four-week-case', synthetic: true },
  { storeId: 'H-0618', bayId: 'B-05', status: 'rejected', reply: 'rejected', yoyBefore: 1.6, yoyAfter: .8, headline: '거절한 사례', explanation: '행사 매대 계약으로 이동이 어려웠다는 합성 의견입니다. 진열 변경 대신 발주·행사 지원을 검토합니다.', source: 'authored-four-week-case', synthetic: true },
  { storeId: 'H-0730', bayId: 'B-02', status: 'no-reply', reply: null, yoyBefore: -.9, yoyAfter: null, headline: '미회신 사례', explanation: '사진과 회신이 없는 합성 사례입니다. 실행 여부를 추정하지 않고 확인이 필요한 점포로 남깁니다.', source: 'authored-four-week-case', synthetic: true },
]);
