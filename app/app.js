import { SCENARIOS } from '../demo/model.js';
import {
  CURRENT_BASELINE, DEFAULT_MESSAGE, EVIDENCE, PROPOSAL, REPRESENTATIVE_CANDIDATE,
  REPRESENTATIVE_STORE_ID, REVIEW_CASES, STORES, getStore, product,
} from './scenario.js';
import {
  clearDemoState, createApprovalReceipt, initialFlow, loadApprovals, loadFlow,
  saveApproval, saveFlow, validatePhotoFile, validateProductApproval,
} from './state.js';

const app = document.querySelector('#app');
const storage = window.localStorage;
const candidateLetters = { hq: 'A', owner: 'B', balanced: 'C', discovery: 'D' };
const routeOrder = ['manager', 'store', 'board', 'experiment', 'approval', 'owner', 'review'];
const routeLabels = { manager: '성과', store: '매대', board: '24시간 비교', experiment: '3D 행동', approval: '승인', owner: '점주', review: '4주 회고' };
const money = value => `${Math.round(value || 0).toLocaleString('ko-KR')}원`;
const count = value => Math.round(value || 0).toLocaleString('ko-KR');
const signed = value => `${value > 0 ? '+' : ''}${Number(value).toFixed(1)}%`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const imageSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;

let flow = loadFlow(storage);
let experiments = null;
let loadError = null;
let photoPreviewUrl = null;
let photoError = '';
let labOpen = false;
let labStatus = 'idle';
let toastTimer = null;

function parseRoute() {
  const [name, query = ''] = (location.hash.replace(/^#\/?/, '') || flow.lastRoute || 'manager').split('?');
  return { name: routeOrder.includes(name) ? name : 'manager', params: new URLSearchParams(query) };
}

function navigate(route) {
  flow.lastRoute = route;
  saveFlow(storage, flow);
  if (location.hash === `#/${route}`) render();
  else location.hash = `#/${route}`;
}

function getApprovals() {
  return loadApprovals(storage);
}

function approvedProposal() {
  const receipt = getApprovals()[REPRESENTATIVE_STORE_ID];
  return validateProductApproval(receipt, {
    storeId: REPRESENTATIVE_STORE_ID,
    scenario: REPRESENTATIVE_CANDIDATE,
    bayId: PROPOSAL.bayId,
  }) ? receipt : null;
}

function storeResults(storeId) {
  const store = experiments?.stores?.find(item => item.id === storeId);
  return store?.candidates || [];
}

function resultFor(storeId = flow.selectedStoreId, scenario = flow.selectedScenario) {
  return storeResults(storeId).find(result => result.scenario === scenario) || null;
}

function candidateRank(results, result) {
  const higher = results.filter(item => item.paidRevenue > result.paidRevenue).length;
  const ties = results.filter(item => item.paidRevenue === result.paidRevenue).length;
  return ties > 1 ? `공동 ${higher + 1}위` : `${higher + 1}위`;
}

function sourcePill() {
  return `<span class="source-pill"><i></i>합성 데모 데이터</span>`;
}

function provenanceBar() {
  return `<div class="provenance-bar" role="note">
    <span><b>실적</b> 작성된 합성 전년 동기비</span>
    <span><b>실험</b> 24시간 로컬 규칙 엔진</span>
    <span><b>3D</b> 실제 계산 기록 사전 재생</span>
    <span><b>회고</b> 별도 4주 합성 관찰</span>
  </div>`;
}

function shell(content, route) {
  const managerActive = ['manager', 'store', 'board', 'experiment', 'approval'].includes(route);
  return `<div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#/manager" aria-label="GS2500 매니저 홈">
        <span class="brand-mark">25</span><span><b>GS2500</b><small>점포 실행 실험실</small></span>
      </a>
      <nav class="role-nav" aria-label="역할별 화면">
        <p>MANAGER</p>
        <a href="#/manager" class="${managerActive ? 'active' : ''}"><span>01</span>성과와 개입</a>
        <a href="#/board" class="${['board', 'experiment'].includes(route) ? 'active-sub' : ''}"><span>02</span>24시간 실험</a>
        <a href="#/approval" class="${route === 'approval' ? 'active-sub' : ''}"><span>03</span>제안 승인</a>
        <p>STORE</p>
        <a href="#/owner" class="${route === 'owner' ? 'active' : ''}"><span>04</span>점주 실행</a>
        <p>HEADQUARTERS</p>
        <a href="#/review" class="${route === 'review' ? 'active' : ''}"><span>05</span>4주 회고</a>
      </nav>
      <div class="side-status">
        <span>DEMO MODE</span>
        <b>API 키 없이 작동</b>
        <small>실제 GS25 계정·POS·문자·발주와 연결되지 않습니다.</small>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div class="breadcrumbs" aria-label="발표 경로">
          ${routeOrder.map((item, index) => `<a href="#/${item}" class="${item === route ? 'current' : ''} ${index < routeOrder.indexOf(route) ? 'passed' : ''}">${String(index + 1).padStart(2, '0')} ${routeLabels[item]}</a>`).join('<i>›</i>')}
        </div>
        <div class="top-actions">${sourcePill()}<button class="quiet-button" data-action="reset">데모 초기화</button></div>
      </header>
      <main id="main-content" class="page">${content}</main>
      <footer class="app-footer"><span>GS2500 HACKATHON DEMO</span><span>NVIDIA Nemotron-Personas-Korea 합성 부분표본 · CC BY 4.0</span></footer>
    </div>
    <output id="toast" class="toast" aria-live="polite" hidden></output>
    <div class="desktop-note">이 데모는 1280px 이상 데스크톱 화면에 맞춰져 있습니다.</div>
  </div>`;
}

function loadingState() {
  if (loadError) return `<section class="state-panel error-state"><span>DATA LOAD ERROR</span><h1>사전 계산 결과를 읽지 못했습니다.</h1><p>${escapeHtml(loadError)}</p><button class="primary-button" data-action="reload">다시 읽기</button></section>`;
  return `<section class="state-panel"><span class="loading-dot"></span><h1>24시간 실험 계약을 확인하고 있습니다.</h1><p>브라우저에서 계산을 꾸미지 않고, 저장소에 포함된 재현 가능한 엔진 결과를 읽습니다.</p></section>`;
}

function renderManager() {
  const declining = STORES.filter(store => store.yoy < -3).length;
  const average = STORES.reduce((sum, store) => sum + store.yoy, 0) / STORES.length;
  return `<section class="page-heading heading-with-action">
      <div><span class="eyebrow">MANAGER · PERFORMANCE</span><h1>어느 점포부터 도울까요?</h1><p>전년 동기비는 개입 우선순위를 찾는 합성 실적입니다. 원인이나 진열 효과를 뜻하지 않습니다.</p></div>
      <button class="primary-button" data-action="open-store">삼성역점 매대 확인 <span>→</span></button>
    </section>
    ${provenanceBar()}
    <section class="metric-grid manager-metrics">
      <article><span>담당 합성 점포</span><strong>${STORES.length}</strong><small>현재 데모 설정 · 제품 한계 아님</small></article>
      <article class="negative"><span>-3% 이하 점포</span><strong>${declining}</strong><small>개입 후보, 원인 확인 필요</small></article>
      <article><span>9개 점포 전년 동기비 평균</span><strong>${signed(average)}</strong><small>점포별 합성 매출의 단순 평균</small></article>
      <article><span>이미 승인된 제안</span><strong>${approvedProposal() ? '1건' : '0건'}</strong><small>이 브라우저 localStorage</small></article>
    </section>
    <section class="content-grid manager-grid">
      <article class="panel store-table-panel">
        <div class="panel-heading"><div><span class="section-number">01</span><h2>담당 점포 전년 동기비</h2></div><span class="period-tag">합성 관찰 · 최근 4주</span></div>
        <div class="store-table" role="table" aria-label="담당 점포 합성 성과">
          <div class="store-row store-table-head" role="row"><span>점포</span><span>4주 매출</span><span>전년 동기비</span><span>확인할 가설</span><span>판단</span></div>
          ${STORES.map(store => `<button class="store-row ${store.id === 'samsung' ? 'featured' : ''}" role="row" data-action="choose-store" data-store="${store.id}">
            <span class="store-identity"><i>${store.code}</i><b>${store.name}</b><small>${store.format}</small></span>
            <span class="mono">${money(store.sales)}</span>
            <span class="yoy ${store.yoy < 0 ? 'down' : 'up'}">${signed(store.yoy)}</span>
            <span>${store.reason}</span>
            <span class="priority ${store.priority === '다른 가설' ? 'muted' : ''}">${store.priority} →</span>
          </button>`).join('')}
        </div>
      </article>
      <aside class="panel manager-note">
        <span class="eyebrow">NEXT BEST ACTION</span>
        <h2>삼성역점은 재고보다<br />노출 가설을 먼저 봅니다.</h2>
        <div class="note-stat"><span>점포 전년 동기비</span><b>-8.4%</b></div>
        <div class="note-stat"><span>음료 판매량 전년 동기비</span><b>-11.0%</b></div>
        <p>진열이 원인이라고 확정하지 않습니다. 재고·위치가 준비된 B-03에서 작게 시험할 수 있는지 확인합니다.</p>
        <button class="text-button" data-action="open-store">현재 매대와 근거 보기 →</button>
        <div class="alt-path"><b>골목 데모점은 다른 가설</b><span>진열보다 발주·행사 조건을 먼저 남겼습니다.</span></div>
      </aside>
    </section>`;
}

function productChip(id) {
  const item = product(id);
  return `<span class="product-chip" style="--chip:${item.color}"><i></i>${escapeHtml(item.name)}</span>`;
}

function shelfDiagram(levels, { compact = false, highlight = [] } = {}) {
  return `<div class="shelf-diagram ${compact ? 'compact' : ''}">${[4, 3, 2, 1].map(level => `<div class="shelf-level"><b>${level}단</b><div>${levels[level - 1].map(id => `<span class="shelf-item ${highlight.includes(id) ? 'highlight' : ''}" style="--item:${product(id).color}" title="${escapeHtml(product(id).name)}">${escapeHtml(product(id).name)}</span>`).join('')}</div></div>`).join('')}</div>`;
}

function candidateCards(storeId = 'samsung') {
  const results = storeResults(storeId);
  if (!results.length) return `<div class="inline-empty">사전 계산 결과를 읽는 중입니다.</div>`;
  const max = Math.max(...results.map(result => result.paidRevenue));
  return `<div class="candidate-cards">${results.map(result => {
    const isTop = result.paidRevenue === max;
    const reference = result.scenario === 'hq';
    return `<button class="candidate-card ${result.scenario === flow.selectedScenario ? 'selected' : ''}" data-action="select-candidate" data-scenario="${result.scenario}">
      <span class="candidate-letter candidate-${result.scenario}">${candidateLetters[result.scenario]}</span>
      <span class="candidate-copy"><b>${escapeHtml(SCENARIOS[result.scenario].title)}</b><small>${escapeHtml(SCENARIOS[result.scenario].note)}</small></span>
      <span class="candidate-result"><b>${money(result.paidRevenue)}</b><small>24시간 모의 결제매출 · ${candidateRank(results, result)}</small></span>
      <span class="candidate-label">${reference ? '비교 기준 A' : isTop ? '절대 매출 최상위' : '후보'}</span>
    </button>`;
  }).join('')}</div>`;
}

function renderStore() {
  const store = getStore(flow.selectedStoreId);
  if (store.id !== 'samsung') {
    return `<section class="state-panel"><span class="eyebrow">${store.code} · ${escapeHtml(store.name)}</span><h1>이 점포는 ${escapeHtml(store.reason)}을 먼저 봅니다.</h1><p>3분 대표 경로는 현재 진열과 실행 근거가 준비된 삼성역점 B-03으로 이어집니다.</p><button class="primary-button" data-action="choose-store" data-store="samsung">삼성역점 대표 경로 열기</button></section>`;
  }
  return `<section class="page-heading heading-with-action">
      <div><span class="eyebrow">${store.code} · ${store.name} · ${PROPOSAL.bayId}</span><h1>현재 매대와 후보 근거</h1><p>현재 진열은 별도 합성 기준선입니다. 네 후보의 24시간 실험 결과와 섞지 않습니다.</p></div>
      <button class="primary-button" data-action="open-board">9개 점포 × 4개 후보 비교 <span>→</span></button>
    </section>
    <section class="store-detail-grid">
      <article class="panel current-photo-panel">
        <div class="panel-heading"><div><span class="section-number">01</span><h2>현재 B-03 행사 매대</h2></div><span class="period-tag">합성 현재 이미지</span></div>
        <figure class="shelf-photo"><img src="${CURRENT_BASELINE.image}" alt="${CURRENT_BASELINE.imageLabel}" /><span class="photo-marker from-marker">현재 제로 음료 · 1단</span><span class="photo-marker target-marker">관찰 위치 · 3단</span><figcaption>위치 표시는 현재 이미지 위에 겹친 안내입니다. 변경 후 사진이나 자동 판독 결과가 아닙니다.</figcaption></figure>
        ${shelfDiagram(CURRENT_BASELINE.levels, { compact: true, highlight: ['zero', 'cracker'] })}
      </article>
      <aside class="panel intervention-panel">
        <div class="panel-heading"><div><span class="section-number">02</span><h2>왜 이 매대인가</h2></div></div>
        <div class="intervention-summary"><span class="status-dot warning"></span><div><b>재고는 있고, 판매 회전은 낮습니다.</b><p>진열로 풀 수 있는지 확인할 조건이 갖춰진 합성 사례입니다.</p></div></div>
        <dl class="evidence-list">${EVIDENCE.map(item => `<div><dt>${escapeHtml(item.label)}</dt><dd><b>${escapeHtml(item.value)}</b><small>${escapeHtml(item.source)}</small></dd></div>`).join('')}</dl>
        <div class="hypothesis"><span>작은 가설</span><b>제로 스파클링을 1단에서 3단으로 옮기면 눈높이 구간의 실제 선택이 달라지는가?</b><small>측정: 24시간 모의 결제매출, 매출총이익, 구매자, 품절 수요</small></div>
      </aside>
    </section>
    <section class="panel candidate-section">
      <div class="panel-heading"><div><span class="section-number">03</span><h2>같은 조건의 24시간 후보</h2></div><div class="heading-notes"><span>동일 시드 11</span><span>초기 총재고 동일</span><span>잠재 고객 일정 동일</span></div></div>
      ${candidateCards('samsung')}
      <p class="truth-note">A는 본사 표준안 후보이며 현재 진열이 아닙니다. 후보 수치는 모두 절대 결과이고, 현재 대비 상승률을 만들지 않습니다.</p>
    </section>`;
}

function renderBoard() {
  return `<section class="page-heading heading-with-action">
      <div><span class="eyebrow">3D LAB · PRECOMPUTED RESULT BOARD</span><h1>9개 점포 × A/B/C/D</h1><p>36개 세계의 실제 24시간 계산 결과입니다. 아래 수치는 사전 계산했고, 3D 전광판은 기존 엔진 화면을 그대로 엽니다.</p></div>
      <button class="primary-button" data-action="open-experiment">삼성역점 B 행동 보기 <span>→</span></button>
    </section>
    ${provenanceBar()}
    <section class="panel result-board-panel">
      <div class="panel-heading"><div><span class="section-number">02</span><h2>24시간 결과 전광판</h2></div><button class="secondary-button" data-action="toggle-lab">${labOpen ? '3D 전광판 닫기' : '실제 3D 전광판 열기'}</button></div>
      <div class="result-board">
        ${STORES.map(store => {
          const results = storeResults(store.id);
          const max = results.length ? Math.max(...results.map(result => result.paidRevenue)) : 0;
          return `<article class="result-store ${store.id === 'samsung' ? 'featured' : ''}">
            <header><span>${store.code}</span><b>${store.name}</b><small>시드 ${experiments?.stores?.find(item => item.id === store.id)?.seed ?? '·'}</small></header>
            <div>${results.map(result => `<button data-action="board-candidate" data-store="${store.id}" data-scenario="${result.scenario}" class="result-cell ${result.paidRevenue === max ? 'top' : ''}"><i class="candidate-${result.scenario}">${candidateLetters[result.scenario]}</i><b>${money(result.paidRevenue).replace('원', '')}</b><small>구매 ${count(result.day?.buyers)} · 결품수요 ${count(result.day?.totalStockoutDemand)}</small></button>`).join('')}</div>
          </article>`;
        }).join('')}
      </div>
      <p class="truth-note">각 점포 안에서만 같은 조건을 공유합니다. 점포 간 절대 매출은 상권·재고 배율·시드가 달라 직접 순위로 쓰지 않습니다. 동률과 역효과는 그대로 표시됩니다.</p>
    </section>
    ${labOpen ? `<section class="panel lab-frame-panel"><div class="lab-frame-heading"><div><span class="live-badge">LIVE MODULE</span><b>기존 36개 3D 세계</b><small>빠른 비교를 누르면 브라우저에서 24시간을 실제 계산합니다. 발표 경로는 아래 단일 후보 사전 재생을 사용합니다.</small></div><a href="./demo/index.html" target="_blank" rel="noreferrer">새 창으로 열기 ↗</a></div><iframe src="./demo/index.html" title="GS2500 기존 3D 실험 전광판" loading="eager"></iframe></section>` : ''}`;
}

function renderExperiment() {
  const selected = resultFor('samsung', 'owner');
  const standard = resultFor('samsung', 'hq');
  if (!selected) return loadingState();
  const delta = selected.paidRevenue - (standard?.paidRevenue || 0);
  const forceFailure = parseRoute().params.get('fail3d') === '1';
  const replayUrl = forceFailure ? './demo/embed.html?record=/data/missing-replay.json' : './demo/embed.html?record=/data/samsung-owner-replay.json';
  return `<section class="page-heading heading-with-action">
      <div><span class="eyebrow">삼성역점 · B-03 · 후보 B</span><h1>재고 우선안의 24시간 기록</h1><p>완료된 엔진 기록에서 실제 고객 경로를 최대 12명 골라 24초에 겹쳐 재생합니다.</p></div>
      <button class="primary-button" data-action="open-approval">작은 변경안 검토 <span>→</span></button>
    </section>
    <section class="experiment-layout">
      <article class="panel replay-panel">
        <div class="replay-labels"><span class="live-badge recorded">RECORDED 24H</span><span id="lab-connection">3D 연결 준비</span></div>
        <div id="replay-host" class="replay-host"><iframe id="replay-frame" src="${replayUrl}" title="삼성역점 후보 B 실제 24시간 기록 3D 재생" allow="fullscreen"></iframe><div id="replay-fallback" class="replay-fallback" hidden><b>3D 연결을 열지 못했습니다.</b><p>사전 계산 결과와 승인 흐름은 계속 사용할 수 있습니다.</p><button class="secondary-button" data-action="retry-3d">다시 연결</button></div></div>
      </article>
      <aside class="panel experiment-summary">
        <span class="eyebrow">LOCAL RULE ENGINE · COMPLETE</span>
        <h2>B · ${SCENARIOS.owner.title}</h2>
        <p>${SCENARIOS.owner.note}</p>
        <div class="rank-badge">삼성역점 4개 후보 중 ${candidateRank(storeResults('samsung'), selected)}</div>
        <dl class="result-metrics">
          <div><dt>24시간 모의 결제매출</dt><dd>${money(selected.paidRevenue)}</dd></div>
          <div><dt>누적 매출총이익</dt><dd>${money(selected.paidGrossProfit)}</dd></div>
          <div><dt>입장 / 잠재 고객</dt><dd>${count(selected.day.entered)} / ${count(selected.day.potentialTotal)}</dd></div>
          <div><dt>구매자</dt><dd>${count(selected.day.buyers)}명</dd></div>
          <div><dt>총재고 품절 수요</dt><dd>${count(selected.day.totalStockoutDemand)}건</dd></div>
          <div><dt>A 대비 절대 매출 차이</dt><dd class="${delta >= 0 ? 'positive' : 'negative-text'}">${delta >= 0 ? '+' : ''}${money(delta)}</dd></div>
        </dl>
        <p class="truth-note">A 대비 차이이며 현재 진열 대비 상승이 아닙니다. 대표 방문의 화면상 동시성은 원래 24시간의 동시 방문을 뜻하지 않습니다.</p>
      </aside>
    </section>
    <section class="panel assumption-strip"><div><span>공유 조건</span><b>시드 11 · 잠재 고객 1,000명 · 초기 총재고 동일</b></div><div><span>판단 방식</span><b>로컬 규칙 엔진 v3 · JEV 호출 없음</b></div><div><span>인물 출처</span><b>Nemotron 한국어 합성 1,000개</b></div><div><span>표시 방식</span><b>실제 계산 기록의 사전 재생</b></div></section>`;
}

function movementDiagram(moves = PROPOSAL.moves) {
  return `<div class="movement-list">${moves.map((move, index) => `<article><span class="move-index">${index + 1}</span><div class="move-product">${productChip(move.productId)}<small>${escapeHtml(move.action)}</small></div><div class="move-place from"><span>지금</span><b>${move.from.level}단 ${move.from.column}열</b></div><span class="move-arrow">→</span><div class="move-place to"><span>이동</span><b>${move.to.level}단 ${move.to.column}열</b></div></article>`).join('')}</div>`;
}

function renderApproval() {
  const selected = resultFor('samsung', 'owner');
  if (!selected) return loadingState();
  const existing = approvedProposal();
  const message = flow.messageDraft || DEFAULT_MESSAGE;
  return `<section class="page-heading heading-with-action">
      <div><span class="eyebrow">MANAGER APPROVAL · ${PROPOSAL.id}</span><h1>점주에게 보낼 작은 변경안</h1><p>24시간 후보 B의 결과를 근거로, 되돌릴 수 있는 두 상품 이동만 승인합니다.</p></div>
      ${existing ? `<button class="primary-button success" data-action="open-owner">승인된 점주 화면 보기 <span>→</span></button>` : ''}
    </section>
    <section class="approval-layout">
      <article class="panel approval-sheet">
        <div class="approval-title"><div><span class="candidate-letter candidate-owner">B</span><span><small>삼성역점 ${PROPOSAL.bayId}</small><h2>${PROPOSAL.reason}</h2></span></div><span class="status-chip ${existing ? 'approved' : ''}">${existing ? '승인 저장됨' : '승인 대기'}</span></div>
        <div class="burden-row"><span><i>◷</i><b>약 ${PROPOSAL.workloadMinutes}분</b> 예상</span><span><i>□</i><b>신규 발주 없음</b></span><span><i>↺</i><b>원위치 가능</b></span></div>
        <h3>점주에게 보이는 이동</h3>
        ${movementDiagram()}
        <div class="scope-note"><b>승인 범위</b><span>${PROPOSAL.caveat}</span></div>
        <div class="approval-evidence">${EVIDENCE.map(item => `<div><span>${item.label}</span><b>${item.value}</b><small>${item.source}</small></div>`).join('')}</div>
      </article>
      <aside class="panel message-panel">
        <div class="panel-heading"><div><span class="section-number">SMS</span><h2>점주 안내 초안</h2></div><span class="period-tag">수정 가능</span></div>
        <label for="message-draft">안내 문구</label>
        <textarea id="message-draft" rows="10">${escapeHtml(message)}</textarea>
        <p>문자·알림톡을 실제 발송하지 않습니다. 승인 결과는 같은 브라우저의 점주 화면에만 나타납니다.</p>
        <button class="primary-button full" data-action="approve">${existing ? '승인 스냅샷 업데이트' : '승인하고 점주 화면에 올리기'} <span>→</span></button>
        <small class="storage-note">localStorage는 접근 제어나 기기 간 전달이 아닙니다.</small>
      </aside>
    </section>`;
}

function ownerEmpty() {
  return `<section class="owner-empty state-panel"><span class="eyebrow">STORE OWNER · 삼성역점</span><div class="empty-icon">✓</div><h1>도착한 제안이 없습니다.</h1><p>24시간 결과와 이동 범위를 매니저가 승인한 뒤에만 이 화면에 나타납니다.</p><button class="secondary-button" data-action="open-approval">매니저 승인 화면으로 돌아가기</button><small>같은 브라우저 데모 상태이며 실제 계정 접근 제어가 아닙니다.</small></section>`;
}

function renderOwner() {
  const receipt = approvedProposal();
  if (!receipt) return ownerEmpty();
  const response = flow.response;
  const photo = flow.photoReceipt;
  return `<section class="page-heading owner-heading">
      <div><span class="eyebrow">STORE OWNER · 삼성역점 ${receipt.productApproval.bayId}</span><h1>담당 매니저가 승인한 제안 1건</h1><p>실제 매장에서 가능한 만큼 바꾸고, 선택과 사진만 남길 수 있습니다.</p></div>
      <span class="approved-banner"><i>✓</i>${new Date(receipt.approvedAt).toLocaleString('ko-KR')} 승인</span>
    </section>
    <section class="owner-layout">
      <article class="panel owner-guide">
        <div class="owner-guide-title"><span><small>이번 주 작은 변경</small><h2>제로 음료를 눈높이 3단으로</h2></span><div class="burden-mini"><b>${receipt.productApproval.workloadMinutes}분</b><span>발주 없음</span></div></div>
        <div class="photo-and-shelf">
          <figure class="shelf-photo owner-photo"><img src="${CURRENT_BASELINE.image}" alt="${CURRENT_BASELINE.imageLabel}" /><span class="photo-marker from-marker">① 지금 · 1단</span><span class="photo-marker target-marker">② 이동 · 3단</span><figcaption>합성 현재 이미지 위 위치 안내입니다. 변경 후 예상 사진이 아닙니다.</figcaption></figure>
          <div><h3>무엇을 어디로 옮기나요?</h3>${movementDiagram(receipt.productApproval.moves)}</div>
        </div>
        <section class="why-section"><h3>왜 이 제안인가요?</h3><div>${EVIDENCE.map(item => `<article><span>${item.label}</span><b>${item.value}</b><small>${item.source}</small></article>`).join('')}</div><p>${receipt.productApproval.caveat}</p></section>
      </article>
      <aside class="panel response-panel">
        <span class="eyebrow">YOUR CHOICE</span><h2>현장에서 어떻게 했나요?</h2><p>계획대로 할 필요는 없습니다. 실제로 한 만큼만 선택해주세요.</p>
        <div class="choice-buttons" role="group" aria-label="실행 선택">
          ${[['accepted', '수용', '두 상품을 제안대로 이동'], ['partial', '부분 실행', '가능한 것만 이동'], ['rejected', '거절', '이번에는 실행하지 않음']].map(([value, label, note]) => `<button data-action="owner-choice" data-choice="${value}" class="${response?.choice === value ? 'selected' : ''}"><b>${label}</b><span>${note}</span></button>`).join('')}
        </div>
        <label class="photo-upload ${photoError ? 'has-error' : ''}" for="owner-photo-input"><input id="owner-photo-input" type="file" accept="image/png,image/jpeg,image/webp" /><span class="upload-icon">＋</span><span><b>변경 사진 선택</b><small>JPG, PNG, WebP · 최대 10MB · 선택 사항</small></span></label>
        <button class="demo-photo-button" data-action="demo-photo">발표용 합성 변경 사진 불러오기</button>
        ${photoError ? `<p class="field-error">${escapeHtml(photoError)}</p>` : ''}
        ${photo ? `<div class="photo-receipt"><div class="preview-box">${photoPreviewUrl ? `<img src="${photoPreviewUrl}" alt="선택한 변경 사진의 로컬 미리보기" />` : '<span>미리보기는 새로고침 뒤 유지되지 않습니다.</span>'}</div><span><b>사진 선택됨</b><small>${escapeHtml(photo.name)} · ${imageSize(photo.size)}</small><em>내용 자동 판독 안 함</em></span></div>` : ''}
        <label for="owner-note">선택적 의견</label><textarea id="owner-note" rows="4" placeholder="예: 콜드브루는 3단에 둘 자리가 부족했어요.">${escapeHtml(response?.note || '')}</textarea>
        <button class="primary-button full" data-action="owner-submit" ${response?.choice ? '' : 'disabled'}>${response?.submittedAt ? '회신 업데이트' : '선택과 사진 접수'} <span>→</span></button>
        ${response?.submittedAt ? `<div class="receipt-success"><i>✓</i><span><b>회신 접수됨</b><small>${new Date(response.submittedAt).toLocaleString('ko-KR')} · ${response.photoReceived ? '사진 접수' : '사진 없음'}</small></span></div>` : ''}
        <p class="storage-note">사진 파일은 서버에 업로드하거나 영구 저장하지 않습니다. 이 탭을 새로고침하면 미리보기 파일은 사라지고, 같은 브라우저에는 파일명·크기와 접수 상태만 남습니다.</p>
      </aside>
    </section>`;
}

function dynamicSamsungCase() {
  const submitted = !!flow.response?.submittedAt;
  const rejected = flow.response?.choice === 'rejected';
  return {
    id: 'samsung', store: '삼성역점', approved: true,
    status: !submitted ? '미회신' : rejected ? '거절' : '좋은 관찰',
    responded: submitted, photo: !!flow.response?.photoReceived,
    response: submitted ? ({ accepted: '수용', partial: '부분 실행', rejected: '거절' }[flow.response.choice]) : '미회신',
    beforeYoy: -8.4, afterYoy: submitted && !rejected ? 1.6 : null,
    note: !submitted ? '아직 점주 회신이 접수되지 않았습니다.' : rejected ? '점주가 실행하지 않기로 선택해 성과 해석에서 제외합니다.' : '4주 뒤 비교 가능한 합성 전년 동기비가 개선 방향으로 움직였습니다.',
    alternative: !submitted || rejected ? '실행 여부를 알 수 없거나 실행하지 않아 진열 효과를 해석하지 않습니다.' : '인근 행사, 날씨, 프로모션, 자연 변동이 함께 설명할 수 있습니다.',
    next: !submitted ? '회신 대기' : rejected ? '거절 이유 확인' : '추가 점포에서 재검증',
  };
}

function renderReview() {
  const cases = [dynamicSamsungCase(), ...REVIEW_CASES];
  const proposed = cases.length;
  const approved = cases.filter(item => item.approved).length;
  const responded = cases.filter(item => item.responded).length;
  const photos = cases.filter(item => item.photo).length;
  return `<section class="page-heading heading-with-action">
      <div><span class="eyebrow">MANAGER + HEADQUARTERS · 4 WEEKS LATER</span><h1>좋은 사례와 막힌 사례를 함께 봅니다.</h1><p>4주 관찰은 24시간 실험과 다른 합성 시점입니다. 인과적으로 입증된 매출 상승이 아닙니다.</p></div>
      <button class="secondary-button" data-action="open-manager">처음부터 다시 보기</button>
    </section>
    ${provenanceBar()}
    <section class="metric-grid review-metrics">
      <article><span>제안한 매대</span><strong>${proposed}</strong><small>분모: 검토 대상</small></article>
      <article><span>매니저 승인</span><strong>${approved}</strong><small>분모: 제안 ${proposed}</small></article>
      <article><span>점주 회신</span><strong>${responded}</strong><small>분모: 승인 ${approved}</small></article>
      <article><span>사진 접수</span><strong>${photos}</strong><small>분모: 회신 ${responded || 0} · 실행 검증 아님</small></article>
    </section>
    <section class="case-grid">${cases.map(item => `<article class="panel case-card case-${item.status}">
      <header><div><span>${item.status}</span><h2>${item.store}</h2></div><b>${item.next}</b></header>
      <div class="case-observation"><span>전년 동기비</span><b>${signed(item.beforeYoy)}</b><i>→</i><b class="${item.afterYoy == null ? 'muted-number' : item.afterYoy >= 0 ? 'positive' : 'negative-text'}">${item.afterYoy == null ? '관찰 제외' : signed(item.afterYoy)}</b></div>
      <dl><div><dt>승인</dt><dd>${item.approved ? '승인' : '미승인'}</dd></div><div><dt>점주 회신</dt><dd>${item.response}</dd></div><div><dt>사진</dt><dd>${item.photo ? '접수' : '없음'}</dd></div></dl>
      <p>${item.note}</p><aside><b>다른 설명 가능성</b><span>${item.alternative}</span></aside>
    </article>`).join('')}</section>
    <section class="panel hq-decision"><div><span class="eyebrow">HEADQUARTERS · NEXT SUPPORT</span><h2>다음 지원을 고릅니다.</h2><p>네 건으로 전국 확대를 확정하지 않습니다.</p></div><div class="decision-options"><article><span>01</span><b>재검증 후보</b><p>삼성역점과 조건이 비슷한 점포에서 같은 작은 이동을 다시 관찰합니다.</p></article><article><span>02</span><b>현장 지원</b><p>부분 실행·미회신 점포에는 작업 인력과 매대 여유부터 확인합니다.</p></article><article><span>03</span><b>다른 가설</b><p>결품이 이어진 점포는 진열을 멈추고 발주·행사 조건을 검토합니다.</p></article></div></section>`;
}

function render() {
  const route = parseRoute().name;
  if (!experiments && route !== 'owner') {
    app.innerHTML = shell(loadingState(), route);
    bindEvents();
    return;
  }
  const views = { manager: renderManager, store: renderStore, board: renderBoard, experiment: renderExperiment, approval: renderApproval, owner: renderOwner, review: renderReview };
  app.innerHTML = shell(views[route](), route);
  bindEvents();
  if (route === 'experiment') watchReplay();
}

function showToast(message) {
  const output = document.querySelector('#toast');
  if (!output) return;
  clearTimeout(toastTimer);
  output.textContent = message;
  output.hidden = false;
  toastTimer = setTimeout(() => { output.hidden = true; }, 4200);
}

function selectStore(storeId) {
  flow.selectedStoreId = storeId;
  flow.selectedScenario = storeId === 'samsung' ? 'owner' : 'hq';
  saveFlow(storage, flow);
  navigate('store');
}

function approve() {
  const result = resultFor('samsung', 'owner');
  const messageDraft = document.querySelector('#message-draft')?.value.trim() || DEFAULT_MESSAGE;
  try {
    const receipt = createApprovalReceipt({ result, proposal: PROPOSAL, levels: SCENARIOS.owner.levels, messageDraft });
    saveApproval(storage, receipt);
    flow.messageDraft = messageDraft;
    saveFlow(storage, flow);
    render();
    showToast('승인 스냅샷을 이 브라우저에 저장했습니다. 실제 문자는 발송하지 않았습니다.');
  } catch (error) {
    showToast(error.message || '승인 스냅샷을 저장하지 못했습니다.');
  }
}

function chooseOwnerResponse(choice) {
  flow.response = { ...(flow.response || {}), choice, submittedAt: null, photoReceived: !!flow.photoReceipt };
  saveFlow(storage, flow);
  render();
}

function submitOwnerResponse() {
  if (!flow.response?.choice) return;
  const note = document.querySelector('#owner-note')?.value.trim() || '';
  flow.response = { ...flow.response, note, photoReceived: !!flow.photoReceipt, submittedAt: new Date().toISOString() };
  saveFlow(storage, flow);
  render();
  showToast('선택과 의견을 같은 브라우저에 접수했습니다. 사진 내용은 판독하지 않았습니다.');
}

function handlePhoto(file) {
  photoError = '';
  if (!file) return;
  const validation = validatePhotoFile(file);
  if (!validation.ok) {
    photoError = validation.error;
    render();
    return;
  }
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = URL.createObjectURL(file);
  flow.photoReceipt = { status: 'selected-local', name: file.name, type: file.type, size: file.size, selectedAt: new Date().toISOString(), persisted: 'metadata-only' };
  if (flow.response) {
    flow.response = { ...flow.response, photoReceived: true, submittedAt: null };
  }
  saveFlow(storage, flow);
  render();
}

async function loadDemoPhoto() {
  try {
    const response = await fetch('./app/assets/samsung-b03-after-synthetic.png');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    handlePhoto(new File([blob], 'samsung-b03-after-demo.png', { type:'image/png' }));
    showToast('발표용 합성 변경 사진을 로컬 미리보기에 불러왔습니다.');
  } catch {
    photoError = '발표용 합성 변경 사진을 읽지 못했습니다.';
    render();
  }
}

function watchReplay() {
  labStatus = 'loading';
  const label = document.querySelector('#lab-connection');
  if (label) label.textContent = '3D 기록 연결 중';
  window.setTimeout(() => {
    if (labStatus === 'loading') setReplayFailure('응답 시간 초과');
  }, 10000);
}

function setReplayFailure(message = '연결 실패') {
  labStatus = 'failed';
  const label = document.querySelector('#lab-connection');
  const frame = document.querySelector('#replay-frame');
  const fallback = document.querySelector('#replay-fallback');
  if (label) label.textContent = `3D ${message}`;
  if (frame) frame.hidden = true;
  if (fallback) fallback.hidden = false;
}

function bindEvents() {
  document.querySelectorAll('[data-action]').forEach(element => element.addEventListener('click', event => {
    const button = event.currentTarget;
    const action = button.dataset.action;
    if (action === 'open-store') navigate('store');
    if (action === 'open-board') navigate('board');
    if (action === 'open-experiment') { flow.selectedStoreId = 'samsung'; flow.selectedScenario = 'owner'; saveFlow(storage, flow); navigate('experiment'); }
    if (action === 'open-approval') navigate('approval');
    if (action === 'open-owner') navigate('owner');
    if (action === 'open-manager') navigate('manager');
    if (action === 'choose-store') selectStore(button.dataset.store);
    if (action === 'select-candidate') { flow.selectedScenario = button.dataset.scenario; saveFlow(storage, flow); render(); }
    if (action === 'board-candidate') { flow.selectedStoreId = button.dataset.store; flow.selectedScenario = button.dataset.scenario; saveFlow(storage, flow); if (button.dataset.store === 'samsung' && button.dataset.scenario === 'owner') navigate('experiment'); else { render(); showToast('절대 결과를 선택했습니다. 대표 3D 재생은 삼성역점 B에 준비되어 있습니다.'); } }
    if (action === 'toggle-lab') { labOpen = !labOpen; render(); }
    if (action === 'approve') approve();
    if (action === 'owner-choice') chooseOwnerResponse(button.dataset.choice);
    if (action === 'owner-submit') submitOwnerResponse();
    if (action === 'retry-3d') { labStatus = 'idle'; navigate('experiment'); }
    if (action === 'demo-photo') void loadDemoPhoto();
    if (action === 'reload') loadExperiments();
    if (action === 'reset') {
      clearDemoState(storage);
      flow = initialFlow();
      photoError = '';
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      photoPreviewUrl = null;
      navigate('manager');
      showToast('이 브라우저의 합성 데모 승인과 회신을 초기화했습니다.');
    }
  }));
  const draft = document.querySelector('#message-draft');
  draft?.addEventListener('input', () => { flow.messageDraft = draft.value; saveFlow(storage, flow); });
  document.querySelector('#owner-photo-input')?.addEventListener('change', event => handlePhoto(event.target.files?.[0]));
}

async function loadExperiments() {
  loadError = null;
  render();
  try {
    const response = await fetch(new URL('./data/experiment-results.json', import.meta.url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.stores) || payload.stores.length !== 9) throw new TypeError('9개 점포 결과 계약이 아닙니다.');
    experiments = payload;
  } catch (error) {
    experiments = null;
    loadError = `experiment-results.json: ${error.message || error}`;
  }
  render();
}

window.addEventListener('hashchange', render);
window.addEventListener('storage', event => {
  if (['gs2500-local-approved-day-v2', 'gs2500-product-flow-v1'].includes(event.key)) {
    flow = loadFlow(storage);
    render();
  }
});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || !event.data) return;
  if (event.data.type === 'gs2500-embed-ready') {
    labStatus = 'ready';
    const label = document.querySelector('#lab-connection');
    if (label) label.textContent = '3D 기록 연결됨';
  }
  if (event.data.type === 'gs2500-embed-error') setReplayFailure('연결 실패');
});

window.gs2500 = Object.freeze({
  snapshot: () => ({ route: parseRoute().name, flow: JSON.parse(JSON.stringify(flow)), approval: approvedProposal(), experiments }),
  navigate,
  force3dFailure: () => setReplayFailure('테스트 실패'),
  reset: () => { clearDemoState(storage); flow = initialFlow(); render(); },
});

loadExperiments();
