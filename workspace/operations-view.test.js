import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApp } from './views.js';
import { createWorkflowState } from './state.js';
import { createOperationsState, recordOperation, buildOperationsView } from './operations.js';
import { STORES, BAYS, PRODUCTS, getInventory, getPlacements } from './data.js';

const storeId = STORES[0].id;
const observation = (overrides = {}) => ({ storeId, date: '2026-09-22', issueType: 'stockout', productId: 'water',
  level: 2, column: 4, stockoutMinutes: 30, note: '생수 매대의 빈칸을 직접 확인했습니다.', ...overrides });
const view = (route = 'home', state = createOperationsState(), extra = {}) => ({
  route, state: createWorkflowState(), loggedIn: true, stores: STORES, bays: BAYS,
  store: STORES[0], bay: BAYS[0], candidate: BAYS[0].candidates[0], products: PRODUCTS,
  inventory: getInventory(storeId), placements: getPlacements(storeId, 'owner'), baselinePlacements: getPlacements(storeId),
  results: {}, operations: buildOperationsView(state, storeId), opsRange: 14, opsFilter: 'all',
  observationRecords: state.records.filter(row => row.storeId === storeId),
  observationOpen: false, observationDraft: {}, observationPhoto: null, searchOpen: false, ...extra,
});
const render = (route, state, extra) => renderApp(view(route, state, extra));
const articleFor = (html, label) => [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)].find(match => match[1].includes(label))?.[1] ?? '';

test('four operations routes render real shared data, explicit synthetic context and valid navigation', () => {
  for (const route of ['home', 'operations', 'recommendations', 'evidence']) {
    const html = render(route);
    assert.match(html, /GS2500|<span>GS<\/span><span>2500<\/span>/);
    assert.match(html, /삼성역점/); assert.match(html, /합성 데모 데이터/); assert.match(html, /JEV (?:연결 )?보류/);
    assert.ok(!/NaN|undefined|\[object Object\]/.test(html), route);
    assert.match(html, /data-action="open-observation"/);
    const routes = [...html.matchAll(/data-action="navigate" data-route="([^"]+)"/g)].map(match => match[1]);
    assert.ok(routes.includes('home')); assert.ok(routes.includes('operations')); assert.ok(routes.includes('evidence'));
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1]);
    assert.ok(hrefs.every(href => ['/demo/', '/storyboard.html'].includes(href)));
    assert.ok(!/href="(?:#|javascript:)/i.test(html));
  }
});

test('overview counts distinguish synthetic issues from manually confirmed observations', () => {
  const state = recordOperation(createOperationsState(), observation());
  const html = render('home', state), o = buildOperationsView(state, storeId);
  assert.match(articleFor(html, '직접 남긴 관찰'), /1건/);
  assert.ok(articleFor(html, '운영 이슈').includes(`${o.summary.issueCount}건`));
  assert.ok(articleFor(html, '기간 결제매출').includes(o.summary.revenue.toLocaleString('ko-KR') + '원'));
  assert.match(html, /합성 점포 전체 매출/); assert.match(html, /사용자 확인 기록/); assert.match(html, /합성 관찰 예시/);
});

test('recommendations expose exact target, provenance, confounders and a measurable next test', () => {
  const state = recordOperation(createOperationsState(), observation({ issueType: 'placement', stockoutMinutes: null,
    revenueBefore: 10000, revenueAfter: 12500, comparableDays: 2, confounders: ['가격 행사 변경'] }));
  const html = render('recommendations', state), o = buildOperationsView(state, storeId);
  assert.ok(html.includes(o.recommendations[0].title)); assert.match(html, /2단 4열/);
  assert.match(html, /직접 기록 1건/); assert.match(html, /왜 이 제안인가요/);
  assert.match(html, /다음에 확인할 것/); assert.match(html, /가격 행사 변경/);
  assert.match(html, /모델 학습 미실행/); assert.match(html, /자동 실행|자동 발주|자동 실행 없음|검증할 가장 구체적인 행동/);
  assert.match(html, /data-action="select-bay" data-store="H-0412" data-bay="B-03"/);
  assert.match(html, /data-action="open-observation" data-product="water" data-type="placement"/);
});

test('collect-evidence recommendations preserve the original issue type for the next record', () => {
  const state = recordOperation(createOperationsState(), observation({ issueType: 'event', productId: null,
    level: null, column: null, stockoutMinutes: null, note: '매장 앞 행사 시간 확인' }));
  const html = render('recommendations', state);
  assert.match(html, /data-action="open-observation" data-product="" data-type="event"/);
});

test('evidence screen excludes seeded examples and clearly states page-only photo storage', () => {
  const seed = createOperationsState();
  const empty = render('evidence', seed);
  assert.match(empty, /아직 직접 남긴 기록이 없어요/);
  for (const row of seed.seedRecords) assert.ok(!empty.includes(row.note));
  const state = recordOperation(seed, observation({ photo: { name: 'water.png', size: 123, type: 'image/png', reference: 'blob:http://localhost/photo-1' } }));
  const html = render('evidence', state);
  assert.match(html, /src="blob:http:\/\/localhost\/photo-1"/);
  assert.match(html, /생수 매대의 빈칸을 직접 확인했습니다/);
  assert.match(html, /메모리에만 보관/); assert.match(html, /새로고침하면 사라지며 외부로 전송하지 않습니다/);
  assert.ok(!html.includes('전후 금액'));
});

test('photo references cannot create remote image fetches or script URL targets', () => {
  for (const reference of ['javascript:alert(1)', 'https://tracking.example/pixel']) {
    const state = recordOperation(createOperationsState(), observation({ photo: { name: 'water.png', size: 100, type: 'image/png', reference } }));
    for (const route of ['home', 'evidence']) {
      const html = render(route, state);
      assert.ok(!html.includes(reference));
    }
  }
});

test('notes, image names, recommendation text, store names and dialog values are HTML-escaped', () => {
  const poison = '<img src=x onerror="alert(1)">';
  const state = recordOperation(createOperationsState(), observation({ note: poison,
    photo: { name: poison, size: 100, type: 'image/png', reference: 'blob:local-photo' } }));
  for (const route of ['home', 'operations', 'recommendations', 'evidence']) {
    const model = view(route, state);
    model.store = { ...model.store, name: poison }; model.stores = [model.store, ...model.stores.slice(1)];
    model.operations.recommendations[0].title = poison;
    const html = renderApp(model);
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
    assert.ok(!html.includes(poison)); assert.ok(!html.includes('<img src=x'));
  }
  const dialog = render('home', state, { observationOpen: true, observationDraft: { note: poison, date: '2026-09-22', confounders: poison } });
  assert.ok(!dialog.includes(poison)); assert.match(dialog, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test('observation dialog provides labelled constrained fields, privacy notice and error recovery values', () => {
  const html = render('home', createOperationsState(), { observationOpen: true,
    observationDraft: { date: '2026-09-22', issueType: 'placement', productId: 'water', level: '2', column: '4', note: '확인한 위치', revenueBefore: '10000', revenueAfter: '12000' }, error: '비교 기간을 확인해주세요.' });
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="observation-title"/);
  assert.match(html, /id="observation-form"/); assert.match(html, /type="submit"/);
  assert.match(html, /name="note" required maxlength="1000"/);
  assert.match(html, /name="stockoutMinutes" type="number" min="0" max="1440"/);
  assert.match(html, /<option value="water" selected>/); assert.match(html, /value="10000"/);
  assert.match(html, /사진은 자동 판독하지 않습니다/); assert.match(html, /현재 페이지에만 보관 · 외부 전송 없음/);
  assert.match(html, /비교 기간을 확인해주세요/);
});

test('incomplete current or previous chart periods do not imply a comparable percentage trend', () => {
  const state = recordOperation(createOperationsState(), observation({ date: '2026-09-23' }));
  const o = buildOperationsView(state, storeId);
  assert.equal(o.summary.completeComparison, false); assert.equal(o.summary.revenueDeltaPercent, null);
  const html = render('home', state);
  assert.ok(!articleFor(html, '기간 결제매출').includes('이전 동기간'));
  assert.ok(!/NaN|undefined/.test(html));
});

test('history filters retain an accessible selected state and hide other issue rows', () => {
  const state = createOperationsState();
  const html = render('operations', state, { operations: buildOperationsView(state, storeId, { filter: 'stockout' }), opsFilter: 'stockout' });
  assert.match(html, /data-value="stockout" aria-pressed="true"/);
  assert.match(html, /data-value="all" aria-pressed="false"/);
  assert.match(html, /샌드위치 빈칸/); assert.ok(!html.includes('유자티를 간식 옆으로 옮긴 합성 시험'));
});

test('empty future period reports no sales chart data and does not show non-finite numbers', () => {
  const state = recordOperation(createOperationsState(), observation({ date: '2026-12-31' }));
  const html = render('home', state);
  assert.match(html, /표시할 매출 기록이 없습니다/); assert.ok(!/NaN|undefined|Infinity/.test(html));
  assert.match(articleFor(html, '기간 결제매출'), /미수집/);
});

test('evidence screen retains older user photos outside the current sales chart window', () => {
  const state = recordOperation(createOperationsState(), observation({ date: '2026-08-01', note: '이전 주기에 남긴 관찰',
    photo: { name: 'older-photo.png', type: 'image/png', size: 100, reference: 'blob:older-photo' } }));
  assert.equal(buildOperationsView(state, storeId).summary.userObservationCount, 0);
  const html = render('evidence', state);
  assert.match(html, /이전 주기에 남긴 관찰/); assert.match(html, /src="blob:older-photo"/);
  assert.match(html, /1장 직접 접수/);
  assert.ok(!html.includes('아직 직접 남긴 기록이 없어요'));
});

test('search dialog lists only supported routes and current store identities', () => {
  const html = render('home', createOperationsState(), { searchOpen: true });
  assert.match(html, /aria-labelledby="search-title"/); assert.match(html, /id="workspace-search"/);
  for (const store of STORES) assert.ok(html.includes(`data-search-item="${store.name}"`));
  assert.match(html, /id="search-empty" hidden/);
  assert.ok(!/NaN|undefined/.test(html));
});

test('unconfirmed shelf location is identified as a reference position, not a confirmed observation', () => {
  const state = recordOperation(createOperationsState(), observation({ level: null, column: null, note: '위치를 확인하지 않은 생수 결품 기록' }));
  const record = state.records[0];
  assert.equal(record.positionConfirmed, false);
  for (const route of ['operations', 'evidence']) {
    const html = render(route, state), article = articleFor(html, record.note);
    assert.ok(article.includes(`기준안 ${record.level}단 ${record.column}열 · 현장 위치 미확인`));
    assert.ok(!article.includes('직접 확인한 위치'));
  }
});

test('confirmed shelf locations remain visibly distinct from the default plan position', () => {
  const state = recordOperation(createOperationsState(), observation());
  const html = render('operations', state), article = articleFor(html, state.records[0].note);
  assert.match(article, /2단 4열 · 직접 확인한 위치/);
  assert.ok(!article.includes('현장 위치 미확인'));
  const recommendations = render('recommendations', state);
  assert.match(recommendations, /사용자 위치 기록 기반 · 재검증 필요/);
});

test('zero-before revenue keeps the paired amounts and absolute difference without a fabricated percent', () => {
  const state = recordOperation(createOperationsState(), observation({ issueType: 'placement', stockoutMinutes: null,
    revenueBefore: 0, revenueAfter: 12500, comparableDays: 2, note: '처음 판매한 상품의 금액 기록' }));
  const evidence = render('evidence', state), history = render('operations', state);
  assert.match(evidence, /0원 → 12,500원/); assert.match(evidence, /기준 매출 0원으로 비율 계산 불가/);
  const article = articleFor(history, state.records[0].note);
  assert.match(article, /\+12,500원/); assert.match(article, /비율 계산 불가/); assert.match(article, /인과효과 아님/);
  assert.ok(!article.includes('매출 영향 미확정')); assert.ok(!/Infinity|NaN|undefined/.test(article));
});

test('zero-to-zero paired revenue is shown instead of being discarded as no observation', () => {
  const state = recordOperation(createOperationsState(), observation({ revenueBefore: 0, revenueAfter: 0, comparableDays: 1 }));
  assert.match(render('evidence', state), /0원 → 0원/);
  assert.match(articleFor(render('operations', state), state.records[0].note), />0원<\/strong>/);
});

test('a store-wide recommendation has no invented fixture or dashed shelf coordinates', () => {
  const state = recordOperation({ ...createOperationsState(), seedRecords: [] }, observation({ issueType: 'event', productId: null,
    level: null, column: null, stockoutMinutes: null, note: '점포 전체 행사 관찰' }));
  for (const route of ['home', 'recommendations']) {
    const html = render(route, state);
    assert.match(html, /점포 전체 · 위치 미지정/);
    assert.ok(!html.includes('—단 —열'));
  }
});

test('recommendation history scope and unrelated simulation scope are explicit at the action', () => {
  const state = recordOperation(createOperationsState(), observation({ issueType: 'placement', stockoutMinutes: null,
    revenueBefore: 100, revenueAfter: 130, comparableDays: 2 }));
  const html = render('recommendations', state);
  assert.match(html, /전체 누적 기록/); assert.match(html, /조회 기간과는 범위가 다릅니다/);
  assert.match(html, /기존 진열안 참고/); assert.ok(!html.includes('진열 후보 비교'));
  assert.match(html, /이 추천 좌표를 반영한 계산은 아직 없습니다/);
  assert.match(html, /시뮬레이션 후보를 바꾸지는 않습니다/);
  assert.match(html, /data-action="select-bay" data-store="H-0412" data-bay="B-03"/);
});

test('Obolus store hub uses four shared page tabs with one current route', () => {
  for (const route of ['home', 'operations', 'recommendations', 'evidence']) {
    const html = render(route);
    const tabs = html.match(/<nav class="ob-tabs"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
    assert.equal((tabs.match(/data-action="navigate"/g) ?? []).length, 4);
    assert.equal((tabs.match(/aria-current="page"/g) ?? []).length, 1);
    assert.match(tabs, new RegExp(`data-route="${route}" aria-current="page"`));
    assert.match(html, /class="ob-page-header"/);
    assert.match(html, /class="ops-page ob-workspace"/);
  }
});

test('overview separates a photographic visual from three unboxed ledger statistics', () => {
  const html = render('home');
  assert.match(html, /class="ob-overview-hero"/);
  assert.match(html, /class="ob-store-visual"/);
  assert.match(html, /class="ob-overview-copy"/);
  assert.equal((html.match(/class="ob-stat"/g) ?? []).length, 3);
  assert.ok(!html.includes('class="ops-kpis"'));
  assert.match(html, /참고 사진 · 현재 점포 촬영 아님/);
});

test('marketplace recommendation visuals show one exact target in a four by six explanatory shelf', () => {
  const state = recordOperation(createOperationsState(), observation({ issueType: 'placement', stockoutMinutes: null,
    revenueBefore: 100, revenueAfter: 130, comparableDays: 2 }));
  const html = render('recommendations', state);
  const cards = [...html.matchAll(/<article class="ob-market-card">([\s\S]*?)<\/article>/g)].map(match => match[1]);
  const targeted = cards.filter(card => card.includes('class="ob-shelf-diagram"'));
  assert.ok(targeted.length > 0);
  for (const card of targeted) {
    assert.equal((card.match(/class="ob-shelf-row"/g) ?? []).length, 4);
    assert.equal((card.match(/class="ob-shelf-cell /g) ?? []).length, 24);
    assert.equal((card.match(/class="ob-shelf-cell active"/g) ?? []).length, 1);
    assert.match(card, /위치 설명 도식 · 실제 배치도 아님/);
    assert.match(card, /<details class="ob-rec-details" data-ui-key="recommendation-[^"]+">/);
    assert.match(card, /다음에 확인할 것/);
  }
});

test('operations ledger expands with native details and preserves source and comparison facts', () => {
  const state = recordOperation(createOperationsState(), observation({ revenueBefore: 10000, revenueAfter: 12000,
    comparableDays: 2, confounders: ['비', '행사'] }));
  const html = render('operations', state);
  const article = articleFor(html, state.records[0].note);
  assert.match(article, /<details class="ob-record-disclosure" data-ui-key="record-[^"]+"><summary class="ob-record-summary">/);
  assert.match(article, /class="ob-record-detail"/);
  assert.match(article, /10,000원 → 12,000원/);
  assert.match(article, /비 · 행사/);
  assert.match(article, /사용자 확인 기록/);
  assert.match(article, /인과효과 아님/);
  assert.match(article, /POS로 확인한 수치는 아닙니다/);
});

test('photo-free memory entries retain a clear placeholder instead of the reference photo', () => {
  const state = recordOperation(createOperationsState(), observation());
  const html = render('evidence', state);
  assert.match(html, /class="ob-memory-entry"/);
  assert.match(html, /사진 없이 남긴 현장 기록/);
  const entry = articleFor(html, state.records[0].note);
  assert.ok(!entry.includes('<img'));
  assert.ok(!entry.includes('bay-reference.jpg'));
});

test('operations overview links directly to local calculation or the existing comparison',()=>{
  assert.match(render('home'),/30일 시뮬레이션 시작/);
  assert.match(render('home'),/data-action="run-all"/);
  const html=render('home',undefined,{results:{[`${storeId}:${BAYS[0].id}`]:{completed:true}}});
  assert.match(html,/비교 이어보기/);
  assert.match(html,/data-action="navigate" data-route="board"/);
});

test('suggested observation location is context, never preconfirmed physical evidence',()=>{
  const html=render('recommendations',undefined,{observationOpen:true,observationDraft:{suggestedTitle:'생수 위치 시험',suggestedLevel:'2',suggestedColumn:'4'}});
  assert.match(html,/제안 위치 2단 4열/);
  assert.match(html,/아직 현장에서 확인한 위치가 아닙니다/);
  assert.match(html,/name="level"><option value="">미확인<\/option>/);
  assert.ok(!/value="2" selected/.test(html));
});
