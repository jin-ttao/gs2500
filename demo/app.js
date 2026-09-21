import { PROFILES, PRODUCTS, PRODUCT_MAP, SCENARIOS } from './model.js';
import { createStore } from './store.js';
import { createCardWorlds } from './card-worlds.js';
import { STATE_NAMES } from './world.js';
import { LAB_STORES, createLab } from './lab.js';

const $ = selector => document.querySelector(selector);
const format = value => Math.round(value || 0).toLocaleString('ko-KR');
const money = value => '₩' + format(value);
const elapsed = seconds => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60].map(n => String(n).padStart(2, '0')).join(':');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const letters = {hq:'A', owner:'B', balanced:'C'};
const reasons = {hq:'행사 상품을 3층에 배치한 기준안. 같은 매장의 B·C 후보와 비교합니다.',owner:'보유 재고가 많은 상품을 2·3층에 배치해 실제 선택과 소진을 관찰합니다.',balanced:'방문 미션과 초기 재고를 고려한 배치. 고객의 선택과 품절 시도를 함께 확인합니다.'};
const lab = createLab({limit:1000, speed:32});
let selectedLevel = 3, mobileStoreId = LAB_STORES[0].id, detail = 'shelf', ownerMode = false, inspectorOpen = false;
let stopped = false, lastFrame = null, lastUi = 0, toastTimer;
const cards = new Map();
const approvalKey = 'gs2500-local-approved-v1';
let approvals = {};
try { approvals = JSON.parse(localStorage.getItem(approvalKey) || '{}'); if (!approvals || typeof approvals !== 'object') approvals = {}; } catch { approvals = {}; }

function buildBoard() {
  for (const [index, storeInfo] of LAB_STORES.entries()) {
    const row = document.createElement('section');
    row.className = 'store-row' + (storeInfo.id === mobileStoreId ? ' mobile-active' : '');
    row.dataset.store = storeInfo.id;
    row.innerHTML = `<div class="store-row-heading"><div><span class="store-number">0${index+1}</span><h3>${escape(storeInfo.name)}</h3><small>${escape(storeInfo.subtitle)}</small></div><span data-store-summary>동일 시드 ${storeInfo.seed} · 기준 A</span></div><div class="candidate-grid"></div>`;
    for (const run of lab.runs.filter(run => run.store.id === storeInfo.id)) {
      const card = document.createElement('button');
      card.className = 'candidate-card'; card.dataset.runId = run.id;
      card.setAttribute('aria-label', `${storeInfo.name} ${letters[run.scenario]} ${SCENARIOS[run.scenario].title} 선택`);
      card.innerHTML = `<div class="card-title"><span class="candidate-letter">${letters[run.scenario]}</span><strong>${SCENARIOS[run.scenario].title}</strong><span class="card-status">대기</span></div><div class="card-viewport" role="img" aria-label="${escape(storeInfo.name)} ${letters[run.scenario]} 실제 3D 시뮬레이션"><div class="card-view-hint"><span>3D</span><time data-card-clock>00:00:00</time><span>확대 ↗</span></div></div><div class="card-metrics"><div><span>누적 결제매출</span><b data-revenue>₩0</b></div><div class="profit"><span>매출총이익</span><b data-profit>₩0</b></div></div><div class="card-secondary"><span>품절 구매 실패</span><b data-stockout>0건 · 0.0%</b></div><div class="candidate-progress"><i data-progress></i></div><div class="card-bottom"><span data-completed>0 / 1,000 완료</span><span data-active>매장 내 0</span></div>`;
      card.addEventListener('click', () => chooseRun(run.id));
      row.querySelector('.candidate-grid').append(card);
      cards.set(run.id, {card, viewport:card.querySelector('.card-viewport'), clock:card.querySelector('[data-card-clock]'), status:card.querySelector('.card-status'), revenue:card.querySelector('[data-revenue]'), profit:card.querySelector('[data-profit]'), stockout:card.querySelector('[data-stockout]'), progress:card.querySelector('[data-progress]'), completed:card.querySelector('[data-completed]'), active:card.querySelector('[data-active]')});
    }
    $('#comparisonRows').append(row);
    const tab = document.createElement('button'); tab.textContent = storeInfo.name; tab.dataset.storeTab = storeInfo.id; tab.setAttribute('role','tab');
    tab.addEventListener('click', () => {
      const counterpart = lab.runs.find(run => run.store.id === storeInfo.id && run.scenario === lab.getSelected().scenario);
      chooseRun(counterpart.id, false);
    });
    $('#mobileStoreTabs').append(tab);
    const option = document.createElement('option'); option.value = storeInfo.id; option.textContent = storeInfo.name; $('#ownerStoreSelect').append(option);
  }
  updateStoreTabs();
}
function updateStoreTabs() {
  document.querySelectorAll('[data-store-tab]').forEach(tab => { const active = tab.dataset.storeTab === mobileStoreId; tab.classList.toggle('active',active); tab.setAttribute('aria-selected',String(active)); });
  document.querySelectorAll('.store-row').forEach(row => row.classList.toggle('mobile-active',row.dataset.store === mobileStoreId));
}
buildBoard();
const [store, cardWorlds] = await Promise.all([
  createStore($('#webgl'), renderLiveAgent),
  createCardWorlds([...cards].map(([id,refs]) => ({id,element:refs.viewport,getWorld:()=>lab.runs.find(run=>run.id===id).world}))),
]);
store.syncWorld(lab.getSelected().world);
store.selectLevel(selectedLevel);

function chooseRun(id, open = true) {
  lab.select(id); mobileStoreId = lab.getSelected().store.id; updateStoreTabs();
  if(open) setInspector(true);
  store.setWorld(lab.getSelected().world); store.selectLevel(selectedLevel);
  if(inspectorOpen) store.syncWorld(lab.getSelected().world);
  cardWorlds.render();
  render(true); renderTick(); updateProbe();
}
function setInspector(open) {
  inspectorOpen = open;
  $('#selectedPanel').hidden = !open; $('#inspectorBackdrop').hidden = !open;
  document.body.classList.toggle('inspector-open',open);
  for(const element of document.querySelectorAll('.comparison-board,.topbar,.experiment-bar')) element.inert = open;
  if(open) $('#closeInspector').focus({preventScroll:true});
  else cards.get(lab.selectedId).card.focus({preventScroll:true});
}
function renderLiveAgent(agent, summary) {
  $('#liveCount').textContent = `매장 내 ${summary.active}명 · 퇴장 ${format(summary.completed)}명`;
  $('#selectedDistance').textContent = '평균 이동 ' + (summary.completed ? summary.averageTravel.toFixed(1) + ' m' : '—');
  if (!agent) {
    $('#personaAvatar').textContent = '·'; $('#personaName').textContent = summary.completed >= 1000 ? '모든 고객 방문 완료' : '고객 입장 대기';
    $('#personaMeta').textContent = '고객을 클릭하면 같은 공간의 행동을 확인합니다.'; $('#personaIndex').textContent = '';
    $('#agentState').textContent = '대기'; $('#agentTarget').textContent = '—'; $('#agentBasket').textContent = '관찰 중인 고객 없음'; $('#agentBudget').textContent = ''; $('#agentMemory').replaceChildren(); return;
  }
  const profile = agent.profile || PROFILES[agent.profileIndex];
  $('#personaAvatar').textContent = profile.name[0]; $('#personaName').textContent = `${profile.name} · ${profile.age}세`;
  $('#personaMeta').textContent = `${profile.job} · ${profile.mission}`; $('#personaIndex').textContent = '#' + String(agent.id+1).padStart(3,'0');
  $('#agentState').textContent = STATE_NAMES[agent.state] || agent.state;
  $('#agentTarget').textContent = agent.station ? lab.getSelected().world.stations[agent.station]?.name || agent.station : agent.state === 'exiting' ? '출구' : '계산대';
  $('#agentBasket').textContent = agent.basket.length ? agent.basket.map(p => typeof p === 'string' ? PRODUCT_MAP[p].name : p.name).join(' · ') : '아직 담은 상품 없음';
  $('#agentBudget').textContent = `${money(agent.spent)} / 예산 ${money(profile.budget)}`;
  $('#agentMemory').replaceChildren(...(agent.memory || []).slice(0,3).map(event => { const li = document.createElement('li'); li.textContent = event.message; return li; }));
}
function renderShelf(summary) {
  const run = lab.getSelected();
  $('#candidateReason').textContent = reasons[run.scenario];
  if ($('#shelfEditor').dataset.scenario !== run.scenario) {
    $('#shelfEditor').dataset.scenario = run.scenario;
    $('#shelfEditor').replaceChildren(...[4,3,2,1].map(level => {
      const row = document.createElement('button'); row.className = 'shelf-editor-row'; row.dataset.level = String(level);
      row.innerHTML = `<b>${level}F</b>` + SCENARIOS[run.scenario].levels[level-1].map(id => `<span class="shelf-product" data-product="${id}"><i class="swatch" style="--color:${PRODUCT_MAP[id].color}"></i>${PRODUCT_MAP[id].name}<small></small></span>`).join('');
      row.addEventListener('click', () => { selectedLevel = level; store.selectLevel(level); renderShelf(lab.getSelected().world.snapshot()); }); return row;
    }));
  }
  $('#shelfEditor').querySelectorAll('[data-level]').forEach(row => {const active = Number(row.dataset.level) === selectedLevel; row.classList.toggle('active',active); row.setAttribute('aria-pressed',String(active));});
  $('#shelfEditor').querySelectorAll('[data-product]').forEach(el => { const stock = summary.stock?.[el.dataset.product] ?? 0; el.classList.toggle('out',stock === 0); el.querySelector('small').textContent = stock ? `${stock}개` : '품절'; });
  const empty = PRODUCTS.filter(p => summary.stock?.[p.id] === 0);
  $('#stockWarning').classList.toggle('warning',empty.length > 0);
  $('#stockWarning').textContent = empty.length ? `재고 0 · ${empty.map(p => p.name).join(' · ')} — 추가 구매 불가` : '모든 상품 재고 보유 · 진열 상품의 수량은 같은 공간의 재고입니다.';
}
function renderLog(summary) {
  const events = (summary.events || []).filter(e => ['decision','picked','stockout','payment'].includes(e.type)).slice(-4).reverse();
  $('#trace').innerHTML = events.length ? events.map(event => `<div class="trace-item ${event.type === 'stockout' ? 'warning' : ['picked','payment'].includes(event.type) ? 'pick' : ''}"><i></i><div><b>${escape(event.message || event.reason || (event.type === 'payment' ? '결제 완료 · ' + money(event.amount) : '상품 비교'))}</b><small>${elapsed(event.time)} · 고객 #${String(event.agentId+1).padStart(3,'0')}${event.productId ? ' · ' + escape(PRODUCT_MAP[event.productId]?.name || event.productId) : ''}</small></div></div>`).join('') : '<p class="trace-empty">실험을 시작하면 상품 비교부터 결제까지<br>이 공간에서 발생한 판단이 기록됩니다.</p>';
}
function render() {
  const snapshot = lab.snapshot();
  const completedVisits = snapshot.runs.reduce((sum,run) => sum + run.completed,0);
  const completedRuns = snapshot.runs.filter(run => run.completed >= 1000).length;
  const allComplete = completedRuns === 9;
  for (const run of snapshot.runs) {
    const refs = cards.get(run.id), selected = run.id === snapshot.selectedId, complete = run.completed >= 1000;
    refs.card.classList.toggle('selected',selected); refs.card.setAttribute('aria-pressed',String(selected));
    const failed = run.status === 'failed';
    const status = failed ? 'failed' : complete ? 'complete' : snapshot.running ? 'running' : run.time > 0 ? 'paused' : 'ready';
    refs.status.className = 'card-status ' + status; refs.status.textContent = failed ? '실행 오류' : complete ? '완료' : snapshot.running ? '실행 중' : run.time > 0 ? '정지' : '대기';
    refs.status.title = failed ? run.error || '실행 오류 · 초기화 후 다시 실행하세요.' : '';
    refs.revenue.textContent = money(run.paidRevenue); refs.profit.textContent = money(run.paidGrossProfit);
    const ratio = run.purchaseDemand ? run.stockoutDemand / run.purchaseDemand * 100 : 0;
    refs.stockout.textContent = `${format(run.stockoutDemand)}건 · ${ratio.toFixed(1)}%`; refs.stockout.classList.toggle('warning',run.stockoutDemand > 0);
    refs.stockout.title = '전체 구매 시도 중 재고 부족으로 실패한 시도 비율. 반복 실험의 품절 확률이 아닙니다.';
    refs.progress.style.width = Math.min(100,run.completed/10) + '%'; refs.completed.textContent = `${format(run.completed)} / 1,000 완료`; refs.active.textContent = `매장 내 ${run.active}`;
    refs.card.dataset.time = run.time; refs.card.dataset.completed = run.completed; refs.card.dataset.revenue = run.paidRevenue;
  }
  for (const storeInfo of LAB_STORES) {
    const runs = snapshot.runs.filter(run => run.store.id === storeInfo.id);
    const complete = runs.every(run => run.completed >= 1000);
    const best = [...runs].sort((a,b) => b.paidGrossProfit-a.paidGrossProfit)[0];
    const equal = runs.every(run => run.paidGrossProfit === best.paidGrossProfit);
    document.querySelector(`[data-store="${storeInfo.id}"] [data-store-summary]`).textContent = complete ? equal ? '완료 · 이익 동일' : `완료 · 이익 1위 ${letters[best.scenario]}` : `동일 시드 ${storeInfo.seed} · 기준 A`;
  }
  const selected = snapshot.runs.find(run => run.id === snapshot.selectedId), run = lab.getSelected();
  $('#selectedStore').textContent = run.store.name; $('#selectedTitle').textContent = `${letters[run.scenario]} · ${SCENARIOS[run.scenario].title}`;
  $('#mapTitle').textContent = run.store.subtitle; $('#clock').textContent = elapsed(selected.time);
  $('#selectedRevenue').textContent = money(selected.paidRevenue); $('#selectedProfit').textContent = money(selected.paidGrossProfit); $('#selectedStockout').textContent = format(selected.stockoutDemand) + '건';
  $('#decisionCount').textContent = format(selected.decisions); $('#sceneStatus').textContent = selected.completed >= 1000 ? 'COMPLETE' : snapshot.running ? 'LIVE · '+snapshot.speed+'×' : selected.time > 0 ? 'PAUSED' : 'READY';
  $('#sceneStatus').classList.toggle('running',snapshot.running && selected.completed < 1000); $('#boardStatus').textContent = allComplete ? '전체 완료' : snapshot.running ? `${9-completedRuns}개 공간 실행 중` : snapshot.time > 0 ? '전체 일시 정지' : '시작 대기'; $('#boardStatus').classList.toggle('running',snapshot.running);
  $('#totalProgress').textContent = `${format(completedVisits)} / 9,000 방문 완료`; $('#completedRuns').textContent = `완료 ${completedRuns} / 9`; $('#totalProgressFill').style.width = completedVisits/90 + '%';
  $('#runButton').disabled = snapshot.running; $('#runButton').innerHTML = allComplete ? '<span>↻</span> 동일 조건 다시 실행' : snapshot.time > 0 ? '<span>▶</span> 9개 실험 이어서' : '<span>▶</span> 9개 실험 시작';
  $('#pauseButton').disabled = !snapshot.running; $('#pauseButton').setAttribute('aria-pressed',String(!snapshot.running));
  document.querySelectorAll('[data-speed]').forEach(button => {const active = Number(button.dataset.speed) === snapshot.speed; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));});
  $('#engineStatus').textContent = allComplete ? '전체 9,000 방문 완료' : snapshot.running ? `공유 시계 · ${9-completedRuns}개 공간 실행 중` : '공유 시계 · 전체 일시 정지';
  $('#engineDot').classList.toggle('running',snapshot.running); $('#effectiveSpeed').textContent = `설정 ${snapshot.speed}× · 실제 ${(snapshot.running ? snapshot.effectiveSpeed || 0 : 0).toFixed(1)}×`;
  $('#effectiveSpeed').title = `실제 배속은 최근 벽시계 시간 대비 처리한 시간입니다. 계산 대기 ${snapshot.backlog.toFixed(2)}초(시뮬레이션 시간). 기기 성능에 따라 전체 세계가 함께 느려집니다.`;
  renderShelf(selected); if (detail === 'log') renderLog(selected);
  const approved = approvals[run.store.id];
  $('#approvalState').textContent = approved ? `저장된 승인 · ${letters[approved.scenario] || ''} ${SCENARIOS[approved.scenario]?.title || ''}` : '선택과 승인은 별개입니다';
  $('#approvalHint').textContent = selected.completed >= 1000 ? '완료 결과와 이 진열을 이 기기에 저장합니다.' : '1,000 방문 완료 후 이 기기에 계획을 저장합니다.';
  $('#approveButton').disabled = selected.completed < 1000;
}
// Numerical ledgers refresh in the same frame as all nine actual 3D worlds.
// Detail prose can refresh less often; a completed payment must not wait for it.
function renderTick() {
  const text=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
  let completed=0;
  for(const run of lab.runs){
    const w=run.world,refs=cards.get(run.id);completed+=w.completed;
    text(refs.clock,elapsed(w.time));
    text(refs.revenue,money(w.paidRevenue));text(refs.profit,money(w.paidGrossProfit));
    text(refs.completed,`${format(w.completed)} / 1,000 완료`);text(refs.active,`매장 내 ${w.agents.length}`);
    text(refs.stockout,`${format(w.stockoutDemand)}건 · ${(w.purchaseDemand?w.stockoutDemand/w.purchaseDemand*100:0).toFixed(1)}%`);
    refs.card.dataset.time=w.time;refs.card.dataset.completed=w.completed;refs.card.dataset.revenue=w.paidRevenue;
    refs.progress.style.width=Math.min(100,w.completed/10)+'%';
  }
  const w=lab.getSelected().world;
  renderShelf(w);if(detail==='log')renderLog(w);
  text($('#clock'),elapsed(w.time));text($('#selectedRevenue'),money(w.paidRevenue));text($('#selectedProfit'),money(w.paidGrossProfit));
  text($('#selectedStockout'),format(w.stockoutDemand)+'건');text($('#decisionCount'),format(w.decisions));
  text($('#liveCount'),`매장 내 ${w.agents.length}명 · 퇴장 ${format(w.completed)}명`);
  text($('#totalProgress'),`${format(completed)} / 9,000 방문 완료`);$('#totalProgressFill').style.width=completed/90+'%';
}
function updateProbe() {
  const run = lab.getSelected(), renderer = store.snapshot();
  const probe = {selectedId:run.id,runId:run.world.runId,time:run.world.time,completed:run.world.completed,paidRevenue:run.world.paidRevenue,paidGrossProfit:run.world.paidGrossProfit,inspectorOpen,rendererTime:renderer.renderedTime,rendererRunId:renderer.renderedRunId,renderedAgents:renderer.renderedAgents,worldAgents:run.world.agents.map(a => ({id:a.id,position:[...a.position],state:a.state})),running:lab.running,speed:lab.speed,cardViews:cardWorlds.snapshot(),runs:lab.runs.map(r => ({id:r.id,runId:r.world.runId,time:r.world.time,completed:r.world.completed,paidRevenue:r.world.paidRevenue,agents:r.world.agents.map(a=>({id:a.id,position:[...a.position],state:a.state}))}))};
  const json = JSON.stringify(probe); $('#syncProbe').textContent = json; $('#syncProbe').dataset.sync = json;
}
function showToast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => {$('#toast').hidden = true;},4000); }
function renderOwner() {
  const storeId = $('#ownerStoreSelect').value, approved = approvals[storeId];
  if (!approved || !SCENARIOS[approved.scenario] || !Array.isArray(approved.levels)) { $('#ownerPlan').innerHTML = '<div class="owner-empty">아직 승인된 계획이 없습니다.<br>관리자가 실험을 완료하고 승인하면 이곳에 표시됩니다.</div>'; return; }
  const storeInfo = LAB_STORES.find(s => s.id === storeId);
  $('#ownerPlan').innerHTML = `<article class="owner-plan-card"><div class="owner-plan-heading"><h3>${escape(storeInfo.name)} · ${letters[approved.scenario]}</h3><span class="approval-chip">승인 저장됨</span></div><p>${escape(SCENARIOS[approved.scenario].title)} · ${escape(new Date(approved.approvedAt).toLocaleString('ko-KR'))}<br>완료한 ${format(approved.completed)} 방문의 승인 스냅샷</p><div class="shelf-editor">${[4,3,2,1].map(level => `<div class="shelf-editor-row"><b>${level}F</b>${(approved.levels[level-1] || []).map(id => PRODUCT_MAP[id] ? `<span class="shelf-product"><i class="swatch" style="--color:${PRODUCT_MAP[id].color}"></i>${escape(PRODUCT_MAP[id].name)}</span>` : '').join('')}</div>`).join('')}</div><div class="owner-plan-metrics"><div><span>시뮬레이션 누적 결제매출</span><strong>${money(approved.paidRevenue)}</strong></div><div><span>누적 매출총이익</span><strong>${money(approved.paidGrossProfit)}</strong></div></div><div class="owner-plan-note">실행 ${escape(approved.runId)}<br>합성 데이터 · 실제 매출 예측 아님 · 이 승인은 실제 발주나 매장 변경을 실행하지 않습니다.</div></article>`;
}
function setOwnerMode(value) {
  ownerMode = value;
  // The role preview is local and keeps the simulation paused while its canvas is hidden.
  if (value) {if(inspectorOpen)setInspector(false);lab.pause(); $('#ownerStoreSelect').value = lab.getSelected().store.id; renderOwner();}
  $('#ownerPanel').hidden = !value; $('#managerPanel').hidden = value;
  $('#ownerView').classList.toggle('active',value); $('#managerView').classList.toggle('active',!value);
  $('#ownerView').setAttribute('aria-pressed',String(value)); $('#managerView').setAttribute('aria-pressed',String(!value));
  cardWorlds.render(); render(); updateProbe(); $('#runButton').disabled = value || lab.running;
}
$('#runButton').addEventListener('click', () => { lab.start({reset:lab.runs.every(r => r.world.completed >= 1000)}); if(inspectorOpen)store.syncWorld(lab.getSelected().world); cardWorlds.render(); lastFrame = performance.now(); render(); renderTick(); updateProbe(); });
$('#pauseButton').addEventListener('click', () => {lab.pause(); render(); updateProbe();});
$('#resetRuns').addEventListener('click', () => {lab.reset(); store.setWorld(lab.getSelected().world); if(inspectorOpen)store.syncWorld(lab.getSelected().world); cardWorlds.render(); lastFrame = performance.now(); render(); renderTick(); updateProbe(); showToast('아홉 실험을 초기화했습니다. 저장된 승인 계획은 유지됩니다.');});
$('#closeInspector').addEventListener('click',()=>setInspector(false));
$('#inspectorBackdrop').addEventListener('click',()=>setInspector(false));
document.addEventListener('keydown',event=>{
  if(!inspectorOpen)return;
  if(event.key==='Escape'){event.preventDefault();setInspector(false);return;}
  if(event.key==='Tab'){
    const controls=[...$('#selectedPanel').querySelectorAll('button:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length>0);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});
document.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click', () => {lab.setSpeed(Number(button.dataset.speed)); render();updateProbe();}));
document.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => {
  detail = button.dataset.detail;
  document.querySelectorAll('[data-detail]').forEach(tab => {const active = tab === button; tab.classList.toggle('active',active); tab.setAttribute('aria-selected',String(active));});
  $('#detailShelf').hidden = detail !== 'shelf'; $('#detailAgent').hidden = detail !== 'agent'; $('#detailLog').hidden = detail !== 'log'; render();
}));
$('#resetView').addEventListener('click', () => store.reset()); $('#focusShelf').addEventListener('click', () => store.focus());
$('#zoomIn').addEventListener('click', () => store.zoom(1.2)); $('#zoomOut').addEventListener('click', () => store.zoom(1/1.2));
$('#togglePaths').addEventListener('click', event => event.currentTarget.setAttribute('aria-pressed',String(store.togglePaths())));
$('#focusAgent').addEventListener('click', () => store.followAgent()); $('#nextAgent').addEventListener('click', () => store.nextAgent());
$('#managerView').addEventListener('click', () => setOwnerMode(false)); $('#ownerView').addEventListener('click', () => setOwnerMode(true));
$('#ownerStoreSelect').addEventListener('change',renderOwner);
$('#approveButton').addEventListener('click', () => {
  const run = lab.getSelected(), summary = run.world.snapshot(); if (summary.completed < 1000) return;
  const next = {...approvals,[run.store.id]:{storeId:run.store.id,scenario:run.scenario,runId:run.world.runId || run.id,approvedAt:new Date().toISOString(),levels:SCENARIOS[run.scenario].levels.map(row => [...row]),completed:summary.completed,paidRevenue:summary.paidRevenue,paidGrossProfit:summary.paidGrossProfit}};
  try {localStorage.setItem(approvalKey,JSON.stringify(next)); approvals = next; render(); showToast(`${run.store.name} · ${letters[run.scenario]} 계획을 이 기기에 승인 저장했습니다.`);} catch {showToast('브라우저 저장소를 사용할 수 없어 승인 계획을 저장하지 못했습니다.');}
});

window.shelfville = Object.freeze({snapshot:() => ({...lab.snapshot(),renderer:store.snapshot(),cardViews:cardWorlds.snapshot(),selectedWorld:lab.getSelected().world.snapshot()}),start:() => {lab.start();render();},pause:() => {lab.pause();render();},setSpeed:n => {lab.setSpeed(n);render();},select:chooseRun,reset:() => {lab.reset();if(inspectorOpen)store.syncWorld(lab.getSelected().world);cardWorlds.render();render();}});
cardWorlds.render(); render(); updateProbe();
function frame(now) {
  if (stopped) return;
  const dt = lastFrame === null ? 0 : Math.max(0,(now-lastFrame)/1000); lastFrame = now;
  const result = lab.advance(dt,{budgetMs:10});
  cardWorlds.render();
  if (!ownerMode && inspectorOpen) store.syncWorld(lab.getSelected().world,result.simulatedDelta);
  if (now-lastUi >= 160) {render(); lastUi = now; if (ownerMode) $('#runButton').disabled = true;}
  renderTick();updateProbe();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange',()=>{if(document.hidden){lab.pause();lastFrame=null;render();updateProbe();}});
window.addEventListener('pagehide', () => {stopped = true; clearTimeout(toastTimer); store.dispose();cardWorlds.dispose();}, {once:true});
