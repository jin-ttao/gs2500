import test from 'node:test';
import assert from 'node:assert/strict';
import {renderApp} from './views.js';
import {BAYS, STORES, PRODUCTS, getInventory, getPlacements} from './data.js';

const results = Object.fromEntries(BAYS.map(bay => [`${bay.storeId}:${bay.id}`, {
  completed: true, days: 30,
  baseline: {revenue: 1000000, profit: 300000, stockoutRate: .1},
  candidates: bay.candidates.map((candidate, index) => ({
    candidateId: candidate.id, revenue: 1000000 + 100000 * index,
    profit: 300000 + 30000 * index, stockoutRate: .1, deltaPercent: index * 10,
  })),
  assumptions: ['현재안과 후보는 같은 고객·행사 조건을 사용합니다.'],
}]));
const vm = {
  route: 'board', stores: STORES, bays: BAYS, results,
  store: STORES[0], bay: BAYS[0], candidate: BAYS[0].candidates[1],
  products: PRODUCTS, inventory: getInventory(STORES[0].id),
  placements: getPlacements(STORES[0].id, 'balanced'),
  baselinePlacements: getPlacements(STORES[0].id, 'hq'),
};

test('Obolus shell keeps one scroll host, a collapsible rail and accessible mobile menu', () => {
  const html=renderApp({...vm,sidebarCollapsed:true,mobileSidebarOpen:false});
  assert.equal((html.match(/class="ob-page-scroll"/g)??[]).length,1);
  assert.match(html,/data-sidebar-collapsed="true" data-mobile-sidebar-open="false"/);
  assert.match(html,/id="workspace-sidebar" aria-label="주 메뉴"/);
  assert.match(html,/aria-label="사이드바 펼치기" aria-controls="workspace-sidebar" aria-expanded="false"/);
  assert.match(html,/class="ob-mobile-nav" aria-label="모바일 빠른 메뉴"/);
  assert.match(html,/aria-label="데모 초기화"/);
});

test('board leads with the live replay, explicit start and an optional final comparison table', () => {
  const html = renderApp(vm);
  assert.equal((html.match(/id="world-board"/g) ?? []).length, 1);
  assert.ok(html.includes('<details class="forecast-comparisons" data-ui-key="final-comparisons">'));
  assert.match(html,/점포별 진열안의 30일 예상 매출을 비교합니다\./);
  assert.match(html,/data-action="run-all"/);
  assert.equal((html.match(/<table class="forecast-table">/g) ?? []).length, BAYS.length);
  assert.equal((html.match(/class="baseline-row"/g) ?? []).length, BAYS.length);
  assert.equal((html.match(/안 자세히 보기/g) ?? []).length, BAYS.length * 3);
  assert.equal((html.match(/data-action="select-candidate"/g) ?? []).length, BAYS.length * 3);
  assert.ok(!html.includes('class="forecast-card"'));
  assert.ok(!html.includes('class="board-status"'));
  assert.ok(!html.includes('model-seam simulation-contract'));
  assert.ok(!html.includes('하나의 계산, 두 가지 보기'));
  assert.ok(!html.includes('매대 비교 준비'));
  assert.ok(!html.includes('data-calculation-progress'));
  assert.ok(html.includes('JEV 보류'));
  assert.ok(html.includes('실제 동시성을 뜻하지 않습니다'));
  assert.ok(!/별도 24시간|두 가지 실험|기존 3D 엔진/.test(html));
});

test('board only shows a compact live status during calculation and retains the synthetic-data limits',()=>{
  const html=renderApp({...vm,busy:true,calculationProgress:{completed:2,total:BAYS.length}});
  assert.match(html,new RegExp(`<p class="micro simulation-progress" role="status" data-calculation-progress>점포 2/${BAYS.length} 계산 중</p>`));
  assert.ok(!html.includes('class="board-status"'));
  assert.ok(!html.includes('model-seam simulation-contract'));
  assert.match(html,/대상 24 SKU의 가상 예상입니다/);
  assert.match(html,/소셜 신호·행사·수요는 합성 가정이며/);
  assert.match(html,/전국 GS25 데이터를 수집한 결과가 아닙니다/);
  assert.match(html,/data-action="run-all" disabled/);
});

test('bay and uncalculated detail offer a real calculation action rather than a list roundtrip',()=>{
  const bayHtml=renderApp({...vm,route:'bay',results:{}});
  assert.match(bayHtml,/로컬 규칙으로 30일 비교 시작/);
  assert.ok(!bayHtml.includes('목록으로 · 전체 비교 실행'));
  const detailHtml=renderApp({...vm,route:'candidate',results:{}});
  assert.match(detailHtml,/class="candidate-switcher"/);
  assert.match(detailHtml,/30일 시뮬레이션 시작/);
  assert.match(detailHtml,/data-action="run-all"/);
});

test('candidate ties motion to the same ledger without claiming physical or JEV predictions', () => {
  const html = renderApp({...vm, route: 'candidate'});
  assert.ok(html.includes('30일 예상과 같은 계산 기록'));
  assert.ok(html.includes('이동 경로·체류시간은'));
  assert.ok(html.includes('재생 배속이나 표시 인원으로 구매·매출을 다시 계산하지 않습니다'));
  assert.ok(html.includes('JEV 실호출이나 실측 GS25 성과가 아니며'));
  assert.ok(html.includes('30일 최종 예상'));
  assert.ok(html.includes('1,100'));
  assert.ok(html.includes('data-action="open-approval"'));
  assert.ok(!/별도 24시간|같은 실행 기록은 아닙니다|재생 화면이 아닙니다/.test(html));
});

test('comparison rows escape names and keep uncalculated candidate links disabled', () => {
  const poison = '<img src=x onerror=alert(1)>';
  const html = renderApp({...vm, results: {}, stores: [{...STORES[0], name: poison}],
    bays: [{...BAYS[0], candidates: [{...BAYS[0].candidates[0], name: poison}]}]});
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes(poison));
  assert.match(html, /data-candidate="A" data-route="candidate" disabled/);
  assert.ok(!html.includes('NaN'));
  assert.ok(!html.includes('undefined'));
});
