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

test('board keeps one replay surface and a compact, initially open comparison table', () => {
  const html = renderApp(vm);
  assert.equal((html.match(/id="world-board"/g) ?? []).length, 1);
  assert.ok(html.includes('<details class="forecast-comparisons" open>'));
  assert.equal((html.match(/<table class="forecast-table">/g) ?? []).length, BAYS.length);
  assert.equal((html.match(/class="baseline-row"/g) ?? []).length, BAYS.length);
  assert.equal((html.match(/안 자세히 보기/g) ?? []).length, BAYS.length * 3);
  assert.equal((html.match(/data-action="select-candidate"/g) ?? []).length, BAYS.length * 3);
  assert.ok(!html.includes('class="forecast-card"'));
  assert.ok(html.includes('하나의 계산, 두 가지 보기'));
  assert.ok(html.includes('JEV 미호출'));
  assert.ok(html.includes('실제 동시성을 뜻하지 않습니다'));
  assert.ok(!/별도 24시간|두 가지 실험|기존 3D 엔진/.test(html));
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
