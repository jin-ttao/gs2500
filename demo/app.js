import { PROFILES, PRODUCTS, PRODUCT_MAP, SCENARIOS } from './model.js';
import { createStore } from './store.js';
import { createCardWorlds } from './card-worlds.js';
import { STATE_NAMES } from './world.js';
import { createLab } from './lab.js';
import { renderSimulationCard } from './components/ui/simulation-card.js';
import { paginateStores, createStorePager } from './components/ui/store-pager.js';
import { createSummaryReplay } from './summary-replay.js';
import { loadPersonaCatalog } from './personas.js';
import { createJevDecisionProvider } from './jev.js';

const $ = selector => document.querySelector(selector);
const format = value => Math.round(value || 0).toLocaleString('ko-KR');
const money = value => '₩' + format(value);
const elapsed = seconds => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60].map(n => String(n).padStart(2, '0')).join(':');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const letters = {hq:'A', owner:'B', balanced:'C', discovery:'D'};
const reasons = {hq:'행사 상품을 3층에 배치한 기준안. 같은 매장의 B·C·D 후보와 비교합니다.',owner:'보유 재고가 많은 상품을 2·3층에 배치해 실제 선택과 소진을 관찰합니다.',balanced:'방문 미션과 초기 재고를 고려한 배치. 고객의 선택과 품절 시도를 함께 확인합니다.',discovery:'신상품 탐색을 위한 별도 배치 가정. 같은 상품·재고·고객 조건에서 위치 변화의 영향을 비교하며 성과를 보장하지 않습니다.'};
const personaCatalog = await loadPersonaCatalog();
const lab = createLab({mode:'day',limit:1000,speed:32,storeGroup:'all',personaCatalog});
let decisionMode='local',gatewayStatus=null,gatewayTraces=[],decisionSettlement=null;
const jevProvider=createJevDecisionProvider();
// Presentation is a separate, read-only view of recorded simulation outcomes.
let viewMode = 'summary', replay = null, preparation = null, preparationWorker = null;
let replaySpeed = 1;
const REPLAY_DURATION = 30;
let preparationGeneration = 0;
const recordings = new Map();
const accountingCache = new Map();
const initialSnapshots = new Map(lab.runs.map(run=>[run.id,run.world.snapshot()]));
const previewWorlds = new Map(lab.runs.map(run=>[run.id,{...initialSnapshots.get(run.id),runId:'summary-preview:'+run.id,agents:[],owner:null,stations:run.world.stations,snapshot:()=>({...initialSnapshots.get(run.id),agents:[],owner:null,active:0})}]));
const inSummary = () => viewMode === 'summary';
const visualWorld = run => inSummary() ? replay ? replay.getWorld(run.id) : previewWorlds.get(run.id) : run.world;
function accountingWorld(run) {
  if(!inSummary())return run.world;
  if(!replay)return initialSnapshots.get(run.id);
  const visual=replay.getWorld(run.id),key=visual.sourceRunId+':'+visual.accountingTime,cached=accountingCache.get(run.id);
  if(cached?.key===key)return cached.value;
  const value=replay.getAccounting(run.id);accountingCache.set(run.id,{key,value});return value;
}
const viewRunning = () => inSummary() ? !!replay?.running : lab.running;
const viewTime = () => inSummary() ? (replay?.progress || 0)*86400 : lab.time;
function viewSnapshot() {
  if (!inSummary()) return lab.snapshot();
  return {total:lab.runs.length,selectedId:lab.selectedId,time:viewTime(),running:!!replay?.running,speed:86400/REPLAY_DURATION*replaySpeed,effectiveSpeed:0,backlog:0,
    runs:lab.runs.map(run=>({...run,world:undefined,...accountingWorld(run),status:replay?.isComplete?'complete':replay?.running?'running':'ready'}))};
}
function pauseView() {lab.pause(); replay?.pause();}
const storePages = paginateStores(lab.stores,4);
let pageIndex = 0, pager;
const DAY_SECONDS = 86400;
const ownerStates = {idle:'보충 대기',walking:'매대로 이동',replenishing:'진열 보충 중',returning:'창고로 복귀'};
const sumStock = stock => Object.values(stock || {}).reduce((sum,value) => sum + value,0);
const isComplete = run => run.world?.isComplete === true || run.isComplete === true || run.status === 'complete';
const dayOf = world => world.day || {duration:DAY_SECONDS,potentialTotal:1000,considered:0,entered:0,skipped:0,buyers:0,completed:0,inStore:0,closedWithoutPurchase:0,progress:0,hourly:[]};
const ownerText = owner => ownerStates[owner?.state] || '보충 대기';
let selectedLevel = 3, detail = 'day', ownerMode = false, inspectorOpen = false;
let stopped = false, lastFrame = null, lastUi = 0, toastTimer;
const cards = new Map();
const approvalKey = 'gs2500-local-approved-day-v2';
let approvals = {};
try { approvals = JSON.parse(localStorage.getItem(approvalKey) || '{}'); if (!approvals || typeof approvals !== 'object') approvals = {}; } catch { approvals = {}; }

function buildBoard() {
  for (const [index] of storePages.entries()) {
    const page = document.createElement('section');
    page.className = 'store-page'; page.dataset.page = index; page.id = `store-page-${index}`;
    page.setAttribute('aria-label', `점포 페이지 ${index+1} / ${storePages.length}`);
    $('#comparisonRows').append(page);
    const dot = document.createElement('button');
    dot.type = 'button'; dot.textContent = String(index+1); dot.dataset.pageDot = index;
    dot.setAttribute('aria-label', `${index+1}페이지 · ${storePages[index].map(s=>s.name).join(', ')}`);
    dot.setAttribute('aria-controls',page.id);
    dot.addEventListener('click',()=>pager.goTo(index));
    $('#storePageDots').append(dot);
  }
  for (const [index, storeInfo] of lab.stores.entries()) {
    const row = document.createElement('section');
    row.className = 'store-row';
    row.dataset.store = storeInfo.id;
    row.innerHTML = `<div class="store-row-heading"><div><span class="store-number">0${index+1}</span><h3>${escape(storeInfo.name)}</h3><small>${escape(storeInfo.subtitle)}</small></div><span data-store-summary>동일 시드 ${storeInfo.seed} · 기준 A</span></div><div class="candidate-grid"></div>`;
    for (const run of lab.runs.filter(run => run.store.id === storeInfo.id)) {
      const card = document.createElement('button');
      card.className = 'candidate-card course-card'; card.dataset.runId = run.id; card.dataset.scenario = run.scenario;
      card.setAttribute('aria-label', `${storeInfo.name} ${letters[run.scenario]} ${SCENARIOS[run.scenario].title} 선택`);
      card.innerHTML = renderSimulationCard({letter:letters[run.scenario],title:SCENARIOS[run.scenario].title,description:storeInfo.subtitle,storeName:storeInfo.name});
      card.addEventListener('click', () => chooseRun(run.id));
      row.querySelector('.candidate-grid').append(card);
      cards.set(run.id, {card, viewport:card.querySelector('.card-viewport'), clock:card.querySelector('[data-card-clock]'), status:card.querySelector('.card-status'), ...Object.fromEntries(['revenue','profit','stockout','progress','completed','active','considered','entered','skipped','buyers','inventory','owner'].map(key => [key,card.querySelector(`[data-${key}]`)]))});
    }
    $(`#store-page-${Math.floor(index/4)}`).append(row);
    const option = document.createElement('option'); option.value = storeInfo.id; option.textContent = storeInfo.name; $('#ownerStoreSelect').append(option);
  }
  updatePageControls(0);
}
function updatePageControls(index) {
  pageIndex = index;
  const count = storePages[index].length, start = index*4+1;
  $('#storePageLabel').textContent = `점포 ${start}–${start+count-1} / ${lab.stores.length} · ${count*4}개 후보`;
  $('#previousStorePage').disabled = index === 0;
  $('#nextStorePage').disabled = index === storePages.length-1;
  document.querySelectorAll('[data-page-dot]').forEach(dot=>{
    const active = Number(dot.dataset.pageDot) === index;
    dot.classList.toggle('active',active);
    if(active) dot.setAttribute('aria-current','page'); else dot.removeAttribute('aria-current');
  });
  document.querySelectorAll('.store-page').forEach(page=>{page.inert=Number(page.dataset.page)!==index;});
}
buildBoard();
pager = createStorePager({container:$('#comparisonRows'),pages:[...document.querySelectorAll('.store-page')],onChange:updatePageControls});
$('#previousStorePage').addEventListener('click',()=>pager.goTo(pageIndex-1));
$('#nextStorePage').addEventListener('click',()=>pager.goTo(pageIndex+1));
const [store, cardWorlds] = await Promise.all([
  createStore($('#webgl'), renderLiveAgent),
  createCardWorlds([...cards].map(([id,refs]) => ({id,element:refs.viewport,getWorld:()=>visualWorld(lab.runs.find(run=>run.id===id))}))),
]);
store.syncWorld(visualWorld(lab.getSelected()));
store.selectLevel(selectedLevel);

function chooseRun(id, open = true) {
  lab.select(id);
  if(open) setInspector(true);
  store.setWorld(visualWorld(lab.getSelected())); store.selectLevel(selectedLevel);
  if(inspectorOpen) store.syncWorld(visualWorld(lab.getSelected()));
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
  $('#liveCount').textContent = inSummary() ? `대표 방문 ${summary.active || 0}명 · 서로 다른 시각 겹쳐 보기` : `매장 내 ${summary.active}명 · 퇴장 ${format(summary.completed)}명`;
  $('#selectedDistance').textContent = '평균 이동 ' + (summary.completed ? summary.averageTravel.toFixed(1) + ' m' : '—');
  if (!agent) {
    const previousSource=$('#personaNarrative');if(previousSource)previousSource.parentElement.hidden=true;
    $('#personaAvatar').textContent = '·'; $('#personaName').textContent = summary.isComplete ? '24시간 운영 완료' : '고객 입장 대기';
    $('#personaMeta').textContent = '고객을 클릭하면 같은 공간의 행동을 확인합니다.'; $('#personaIndex').textContent = '';
    $('#agentState').textContent = '대기'; $('#agentTarget').textContent = '—'; $('#agentBasket').textContent = '관찰 중인 고객 없음'; $('#agentBudget').textContent = ''; $('#agentMemory').replaceChildren(); return;
  }
  const profile = agent.profile || PROFILES[agent.profileIndex];
  let sourcePane=$('#personaNarrative');
  if(!sourcePane){const details=document.createElement('details');details.className='persona-source-note';const title=document.createElement('summary');title.textContent='합성 페르소나 원문 · 행동 가정 보기';sourcePane=document.createElement('pre');sourcePane.id='personaNarrative';details.append(title,sourcePane);$('#detailAgent').append(details);}
  sourcePane.parentElement.hidden=false;
  if(sourcePane.dataset.persona!==profile.source?.id+':'+profile.mission){sourcePane.dataset.persona=profile.source?.id+':'+profile.mission;sourcePane.textContent=`출처: ${profile.source?.dataset??'직접 작성한 검증용 페르소나'}\nUUID: ${profile.source?.id??'없음'}\n실존 인물이 아닌 합성 기록입니다. 예산·선호 수치·방문 시간은 별도의 작성 가정입니다.\n\n${profile.story}\n\n현재 방문 목적: ${profile.mission}`;}
  $('#personaAvatar').textContent = profile.name[0]; $('#personaName').textContent = `${profile.name} · ${profile.age}세`;
  $('#personaMeta').textContent = `${profile.job} · ${profile.mission}${inSummary() ? ' · 원본 방문 '+elapsed(agent.sourceTime??0) : ''}`; $('#personaIndex').textContent = '#' + String(agent.id+1).padStart(3,'0');
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
      row.innerHTML = `<b>${level}F</b><span class="shelf-products">` + SCENARIOS[run.scenario].levels[level-1].map((id,column) => `<span class="shelf-product" data-product="${id}" title="${level}층 ${column+1}열 · ${escape(PRODUCT_MAP[id].name)}"><span class="shelf-product-name"><i class="swatch" style="--color:${PRODUCT_MAP[id].color}"></i>${PRODUCT_MAP[id].name}</span><small></small></span>`).join('') + '</span>';
      row.addEventListener('click', () => { selectedLevel = level; store.selectLevel(level); renderShelf(accountingWorld(lab.getSelected())); }); return row;
    }));
  }
  $('#shelfEditor').querySelectorAll('[data-level]').forEach(row => {const active = Number(row.dataset.level) === selectedLevel; row.classList.toggle('active',active); row.setAttribute('aria-pressed',String(active));});
  $('#shelfEditor').querySelectorAll('[data-product]').forEach(el => { const stock = summary.stock?.[el.dataset.product] ?? 0, backroom = summary.backroomStock?.[el.dataset.product] ?? 0; el.classList.toggle('out',stock === 0); el.querySelector('small').textContent = `진열 ${stock} / 창고 ${backroom}`; });
  const empty = PRODUCTS.filter(p => summary.stock?.[p.id] === 0);
  $('#stockWarning').classList.toggle('warning',empty.length > 0);
  $('#stockWarning').textContent = empty.length ? `진열 0 · ${empty.map(p => p.name).join(' · ')} — 창고 재고가 있으면 점주 보충 후 구매할 수 있습니다.` : '진열 재고와 유한 창고 재고를 분리 집계합니다. 점주가 이동·보충을 마치면 진열 수량이 늘어납니다.';
}
function renderLog(summary) {
  const events = (summary.events || []).slice(-12).reverse();
  $('#replenishmentLedger').textContent = `점주 보충 ${format(summary.replenishments ?? summary.owner?.completedTasks)}회 · 진열로 이동 ${format(summary.replenishedUnits)}개`;
  const names = {replenishmentStarted:'점주 보충 시작',stockTransferred:'창고 → 진열 재고 이동',replenishmentCompleted:'점주 보충 완료',dayEnded:'24시간 운영 마감',basketReturned:'미결제 상품 창고 반환',enter:'고객 입장',skipped:'입장하지 않음',payment:'결제 완료'};
  $('#trace').innerHTML = events.length ? events.map(event => {
    const worker = ['replenishmentStarted','stockTransferred','replenishmentCompleted'].includes(event.type);
    const transfer = event.type === 'stockTransferred' ? ` · ${format(event.quantity)}개 · 진열 ${event.shelfBefore}→${event.shelfAfter} / 창고 ${event.backroomBefore}→${event.backroomAfter}` : '';
    return `<div class="trace-item ${event.type === 'stockout' ? 'warning' : ['picked','payment','stockTransferred'].includes(event.type) ? 'pick' : ''}"><i></i><div><b>${escape(event.message || names[event.type] || event.reason || event.type)}${escape(transfer)}</b><small>${elapsed(event.time)} · ${worker ? '점주' : Number.isInteger(event.agentId) ? '고객 #'+String(event.agentId+1).padStart(3,'0') : '운영 시스템'}${event.productId ? ' · ' + escape(PRODUCT_MAP[event.productId]?.name || event.productId) : ''}${event.type === 'payment' ? ' · '+money(event.amount) : ''}</small></div></div>`;
  }).join('') : inSummary()?'<p class="trace-empty">요약 중에는 원본 통계 체크포인트를 표시합니다.<br>완료 후 최근 원본 사건을 확인할 수 있습니다.</p>':'<p class="trace-empty">하루 운영을 시작하면 입장·결제와<br>점주의 창고→진열 보충 과정이 기록됩니다.</p>';
}
function renderDayTotals(world) {
  const day = dayOf(world);
  if (!$('#dayFunnel').children.length) $('#dayFunnel').innerHTML = [['considered','잠재 고객 검토'],['entered','입장'],['skipped','지나침'],['buyers','결제 구매자']].map(([key,label]) => `<div><span>${label}</span><strong data-day-${key}>0</strong></div>`).join('');
  for (const key of ['considered','entered','skipped','buyers']) $(`[data-day-${key}]`).textContent = format(day[key]) + (key === 'considered' ? ` / ${format(day.potentialTotal)}` : '명');
  const owner = world.owner;
  $('#ownerStatus').textContent = `점주 · ${ownerText(owner)}${owner?.productId ? ' · '+PRODUCT_MAP[owner.productId]?.name : ''} · 완료 ${format(owner?.completedTasks)}회`;
  $('#inventoryTotals').textContent = `진열 ${format(sumStock(world.stock))} / 창고 ${format(sumStock(world.backroomStock))}개`;
  const skipped = day.skippedReasons || {};
  $('#dayOutcome').textContent = `퇴장 ${format(day.completed)}명 · 구매 없이 퇴장 ${format(day.closedWithoutPurchase)}명 · 진열 부족 ${format(day.shelfGapDemand)}건 / 창고도 없음 ${format(day.totalStockoutDemand)}건. 지나침: 필요 없음 ${format(skipped['not-needed'])}, 혼잡 ${format(skipped.crowded)}, 마감 ${format(skipped.closed)}.`;
}
function renderDay(world) {
  renderDayTotals(world);
  const transfers = (world.replenishmentEvents ?? world.events ?? []).filter(event => event.type === 'stockTransferred').slice(-4).reverse();
  $('#dayRestockCount').textContent = `${format(world.replenishments ?? world.owner?.completedTasks)}회 · ${format(world.replenishedUnits)}개 이동`;
  const signature = `${world.runId}:${transfers.map(event => event.id).join(',')}`;
  if ($('#dayRestockRows').dataset.signature !== signature) {
    $('#dayRestockRows').dataset.signature = signature;
    $('#dayRestockRows').innerHTML = transfers.length ? transfers.map(event => `<li><time>${elapsed(event.time)}</time><div><b>${escape(PRODUCT_MAP[event.productId]?.name || event.productId)} · ${format(event.quantity)}개 보충</b><small>진열 ${format(event.shelfBefore)} → ${format(event.shelfAfter)} · 창고 ${format(event.backroomBefore)} → ${format(event.backroomAfter)}</small></div></li>`).join('') : inSummary()?'<li class="restock-empty">요약 중에는 보충 집계만 표시합니다. 완료 후 최근 원본 기록을 확인할 수 있습니다.</li>':'<li class="restock-empty">보충 완료 기록이 아직 없습니다.</li>';
  }
  const day = dayOf(world), currentHour = Math.min(23,Math.floor(world.time/3600));
  if (!$('#hourlyRows').children.length) $('#hourlyRows').innerHTML = Array.from({length:24},(_,hour) => `<tr data-hour="${hour}"><th scope="row">${String(hour).padStart(2,'0')}:00–${String(hour+1).padStart(2,'0')}:00</th>${['considered','entered','skipped','buyers','paidRevenue'].map(key => `<td data-hour-${key}>—</td>`).join('')}</tr>`).join('');
  for (let hour=0;hour<24;hour++) {
    const row = $(`[data-hour="${hour}"]`), values = day.hourly?.[hour] || {};
    row.classList.toggle('current-hour',hour === currentHour && !world.isComplete);
    row.classList.toggle('future-hour',hour > currentHour);
    for (const key of ['considered','entered','skipped','buyers','paidRevenue']) row.querySelector(`[data-hour-${key}]`).textContent = key === 'paidRevenue' ? money(values[key]) : format(values[key]);
  }
}
function render() {
  const snapshot = viewSnapshot();
  const completedRuns = snapshot.runs.filter(isComplete).length;
  const allComplete = completedRuns === snapshot.runs.length;
  for (const run of snapshot.runs) {
    const refs = cards.get(run.id), selected = run.id === snapshot.selectedId, complete = isComplete(run);
    refs.card.classList.toggle('selected',selected); refs.card.setAttribute('aria-pressed',String(selected));
    const failed = run.status === 'failed';
    const status = failed ? 'failed' : complete ? 'complete' : snapshot.running ? 'running' : run.time > 0 ? 'paused' : 'ready';
    refs.status.className = 'card-status ' + status; refs.status.textContent = preparation ? '계산 중' : failed ? '실행 오류' : complete ? (inSummary()?'요약 완료':'하루 완료') : snapshot.running ? (inSummary()?'요약 재생':'운영 중') : run.time > 0 ? '정지' : '대기';
    refs.status.title = failed ? run.error || '실행 오류 · 초기화 후 다시 실행하세요.' : '';
    refs.stockout.title = '전체 구매 시도 중 진열 재고 부족으로 실패한 시도 비율. 창고 재고가 남아 있어도 보충 전에는 구매할 수 없습니다.';
  }
  for (const storeInfo of lab.stores) {
    const runs = snapshot.runs.filter(run => run.store.id === storeInfo.id);
    const complete = runs.every(isComplete);
    const best = [...runs].sort((a,b) => b.paidGrossProfit-a.paidGrossProfit)[0];
    const equal = runs.every(run => run.paidGrossProfit === best.paidGrossProfit);
    document.querySelector(`[data-store="${storeInfo.id}"] [data-store-summary]`).textContent = complete ? equal ? '하루 완료 · 이익 동일' : `하루 완료 · 이익 1위 ${letters[best.scenario]}` : '동일 고객 1,000명 · A/B/C/D';
  }
  const selected = snapshot.runs.find(run => run.id === snapshot.selectedId), run = lab.getSelected();
  $('#selectedStore').textContent = run.store.name; $('#selectedTitle').textContent = `${letters[run.scenario]} · ${SCENARIOS[run.scenario].title}`;
  $('#mapTitle').textContent = run.store.subtitle;
  $('#sceneStatus').textContent = inSummary() ? 'RECORDED VISITS' : isComplete(selected) ? '24H COMPLETE' : snapshot.running ? 'LIVE · '+snapshot.speed+'×' : selected.time > 0 ? 'PAUSED' : 'READY';
  $('#sceneStatus').classList.toggle('running',snapshot.running && !isComplete(selected)); $('#boardStatus').textContent = allComplete ? '24시간 전체 완료' : snapshot.running ? `${snapshot.total-completedRuns}개 공간 운영 중` : snapshot.time > 0 ? '전체 일시 정지' : '시작 대기'; $('#boardStatus').classList.toggle('running',snapshot.running);
  $('#completedRuns').textContent = `하루 완료 ${completedRuns} / ${snapshot.total}`;
  $('#runButton').disabled = snapshot.running || ownerMode; $('#runButton').innerHTML = allComplete ? '<span>↻</span> 같은 하루 다시 실행' : snapshot.time > 0 ? '<span>▶</span> 하루 운영 이어서' : `<span>▶</span> 전체 ${lab.stores.length}점포 시작`;
  $('#pauseButton').disabled = !snapshot.running; $('#pauseButton').setAttribute('aria-pressed',String(!snapshot.running));
  document.querySelectorAll('[data-speed]').forEach(button => {const active = Number(button.dataset.speed) === snapshot.speed; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));});
  $('#engineStatus').textContent = allComplete ? `24시간 · ${snapshot.total}개 후보 마감` : snapshot.running ? `공유 시계 · ${snapshot.total-completedRuns}개 공간 운영 중` : `공유 시계 · ${snapshot.total}개 공간 정지`;
  $('#engineDot').classList.toggle('running',snapshot.running); $('#effectiveSpeed').textContent = `설정 ${snapshot.speed}× · 실제 ${(snapshot.running ? snapshot.effectiveSpeed || 0 : 0).toFixed(1)}×`;
  $('#effectiveSpeed').title = `실제 배속은 벽시계 시간 대비 처리한 시간입니다. 계산 대기 ${(snapshot.backlog || 0).toFixed(2)}초. 페이지 밖을 포함한 ${snapshot.total}개 세계가 함께 진행하며 고배속 화면은 동작 일부를 샘플링합니다.`;
  if (inspectorOpen) {
    const world = accountingWorld(run);
    if (detail === 'shelf') renderShelf(world);
    if (detail === 'day') renderDay(world);
    if (detail === 'log') renderLog(world.snapshot ? world.snapshot() : world);
  }
  const approved = approvals[run.store.id];
  $('#approvalState').textContent = approved ? `저장된 승인 · ${letters[approved.scenario] || ''} ${SCENARIOS[approved.scenario]?.title || ''}` : '선택과 승인은 별개입니다';
  $('#approvalHint').textContent = isComplete(selected) ? '24시간 결과·진열·남은 재고를 이 기기에 저장합니다.' : '방문 수나 품절 여부와 관계없이 24시간 완료 후 승인합니다.';
  $('#approveButton').disabled = !isComplete(selected);
  renderPresentationControls(snapshot);
  renderDecisionStatus();
}
// Live mode follows the world clock. Summary metrics follow recorded accounting
// checkpoints, not the overlapping representative actors' presentation clocks.
function renderTick() {
  const text=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
  let considered=0, potential=0;
  for(const run of lab.runs){
    const w=accountingWorld(run),day=dayOf(w),refs=cards.get(run.id);considered+=day.considered;potential+=day.potentialTotal;
    const progress=Math.min(1,Math.max(0,w.time/day.duration));
    text(refs.clock,elapsed(w.time));
    text(refs.revenue,money(w.paidRevenue));text(refs.profit,money(w.paidGrossProfit));
    text(refs.completed,`${(progress*100).toFixed(1)}%`);text(refs.active,inSummary()?`대표 방문 ${visualWorld(run).agents.length}`:`매장 내 ${day.inStore ?? w.agents.length}`);
    for(const key of ['considered','entered','skipped','buyers'])text(refs[key],format(day[key]));
    text(refs.inventory,`진열 ${format(sumStock(w.stock))} · 창고 ${format(sumStock(w.backroomStock))}`);
    text(refs.owner,inSummary()?`보충 집계 ${format(w.replenishments || w.owner?.completedTasks)}회`:`점주 ${ownerText(w.owner)}`);refs.owner.classList.toggle('working',!inSummary()&&w.owner?.state!=='idle');
    text(refs.stockout,`${format(w.stockoutDemand)}건 · ${(w.purchaseDemand?w.stockoutDemand/w.purchaseDemand*100:0).toFixed(1)}%`);
    refs.stockout.classList.toggle('warning',w.stockoutDemand>0);
    refs.card.dataset.time=w.time;refs.card.dataset.completed=w.completed;refs.card.dataset.revenue=w.paidRevenue;refs.card.dataset.dayComplete=String(w.isComplete===true);
    refs.progress.style.width=progress*100+'%';
    refs.progress.parentElement.setAttribute('aria-valuenow',(progress*100).toFixed(1));
    refs.card.setAttribute('aria-description',`${elapsed(w.time)} / 24시간, 하루 진행 ${(progress*100).toFixed(1)}%, 입장 ${format(day.entered)}명, 구매 ${format(day.buyers)}명, 시뮬레이션 결제매출 ${money(w.paidRevenue)}. 선택하면 상세 관찰 화면이 열립니다.`);
  }
  const w=accountingWorld(lab.getSelected());
  if(inspectorOpen){
    text($('#clock'),elapsed(w.time));text($('#selectedRevenue'),money(w.paidRevenue));text($('#selectedProfit'),money(w.paidGrossProfit));
    text($('#selectedStockout'),format(w.stockoutDemand)+'건');text($('#decisionCount'),format(w.decisions));
    text($('#liveCount'),inSummary()?`대표 방문 ${visualWorld(lab.getSelected()).agents.length}명 · 서로 다른 시각 겹쳐 보기`:`매장 내 ${w.agents.length}명 · 입장 ${format(dayOf(w).entered)}명`);
    if(detail==='shelf')renderShelf(w);
    if(detail==='day')renderDayTotals(w);
  }
  text($('#globalClock'),`${inSummary()?'통계 ':''}${elapsed(Math.min(DAY_SECONDS,w.time))} / 24:00:00`);
  text($('#totalProgress'),`잠재 고객 검토 ${format(considered)} / ${format(potential)} · 후보 합계`);$('#totalProgressFill').style.width=Math.min(100,viewTime()/DAY_SECONDS*100)+'%';
}
function updateProbe() {
  if(inSummary()) {
    const run=lab.getSelected(),w=accountingWorld(run),visual=visualWorld(run),renderer=store.snapshot({detail:false});
    $('#syncProbe').textContent=JSON.stringify({viewMode,preparing:!!preparation,preparation,replay:replay?{elapsed:replay.elapsed,duration:replay.duration,speed:replay.speed,progress:replay.progress,isComplete:replay.isComplete}:null,
      selectedId:run.id,time:w.time,paidRevenue:w.paidRevenue,isComplete:w.isComplete,running:!!replay?.running,inspectorOpen,
      rendererTime:renderer.renderedTime,rendererRunId:renderer.renderedRunId,renderedAgents:renderer.renderedAgents,
      visualTime:visual.time,worldAgents:visual.agents.map(a=>({id:a.id,position:[...a.position],state:a.state,sourceTime:a.sourceTime})),
      cardViews:cardWorlds.snapshot({detail:false}),pageIndex,pageCount:storePages.length,pageStoreIds:storePages[pageIndex].map(s=>s.id),totalStores:lab.stores.length,
      runs:lab.runs.map(r=>{const a=accountingWorld(r),v=visualWorld(r);return {id:r.id,time:a.time,isComplete:a.isComplete,paidRevenue:a.paidRevenue,paidUnits:a.paidUnits,stock:a.stock,backroomStock:a.backroomStock,visualTime:v.time,agents:v.agents.map(p=>({id:p.id,position:[...p.position],state:p.state}))};})});
    $('#syncProbe').dataset.sync=$('#syncProbe').textContent;
    return;
  }
  const run = lab.getSelected(), renderer = store.snapshot({detail:false});
  const ownerSnapshot = owner => owner ? {state:owner.state,position:[...owner.position],productId:owner.productId,quantity:owner.quantity,completedTasks:owner.completedTasks,stateTime:owner.stateTime} : null;
  const compactDay = world => {const {hourly,...day}=dayOf(world);return day;};
  const probe = {selectedId:run.id,runId:run.world.runId,time:run.world.time,completed:run.world.completed,isComplete:run.world.isComplete,day:dayOf(run.world),owner:ownerSnapshot(run.world.owner),shelf:run.world.stock,backroom:run.world.backroomStock,shelfCapacity:run.world.shelfCapacity,paidRevenue:run.world.paidRevenue,paidGrossProfit:run.world.paidGrossProfit,inspectorOpen,rendererTime:renderer.renderedTime,rendererRunId:renderer.renderedRunId,renderedOwner:renderer.renderedOwner,renderedAgents:renderer.renderedAgents,worldAgents:run.world.agents.map(a => ({id:a.id,position:[...a.position],state:a.state})),running:lab.running,speed:lab.speed,cardViews:cardWorlds.snapshot({detail:false}),runs:lab.runs.map(r => ({id:r.id,runId:r.world.runId,time:r.world.time,completed:r.world.completed,isComplete:r.world.isComplete,day:compactDay(r.world),owner:ownerSnapshot(r.world.owner),shelf:r.world.stock,backroom:r.world.backroomStock,paidRevenue:r.world.paidRevenue,agents:r.world.agents.map(a=>({id:a.id,position:[...a.position],state:a.state}))}))};
  Object.assign(probe,{pageIndex,pageCount:storePages.length,pageStoreIds:storePages[pageIndex].map(s=>s.id),totalStores:lab.stores.length});
  const json = JSON.stringify(probe); $('#syncProbe').textContent = json; $('#syncProbe').dataset.sync = json;
}
function renderPresentationControls(snapshot) {
  document.body.dataset.presentation=viewMode;
  document.querySelectorAll('[data-presentation]').forEach(button=>{
    const active=button.dataset.presentation===viewMode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    button.disabled=decisionMode==='jev'&&button.dataset.presentation==='summary';
  });
  $('#speedControls').hidden=inSummary();
  $('#replaySpeedControls').hidden=!inSummary();
  document.querySelectorAll('[data-replay-speed]').forEach(button=>{const active=Number(button.dataset.replaySpeed)===replaySpeed;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  $('#summaryNotice').hidden=!inSummary();
  $('#experimentModeText').textContent=inSummary()?'하루의 결과와 읽기 쉬운 방문 장면을 함께':'3D 움직임과 매출이 같은 시계로';
  $('#boardModeText').textContent=inSummary()?'대표 방문을 겹쳐 보는 요약 · 실제 동시 방문 아님':'좌우로 넘겨 더 보기 · 화면 밖 점포도 같은 시계로 운영';
  $('#detailModeNote').textContent=inSummary()?'서로 다른 시각의 대표 고객 방문을 겹쳐 재생합니다. 통계는 원래 24시간 계산 기록이며, 화면 속 인원·체류시간·동시성은 집계에 영향을 주지 않습니다. 방문 코너나 구매 행동을 추가하지 않습니다.':'00:00부터 24:00까지 실행합니다. 재고가 비어도 하루는 계속되며 창고 재고는 자동 생성되지 않습니다. 계산 담당·보충 담당 분리 가정. 고배속에서는 화면에 동작 일부가 샘플링됩니다.';
  for(const refs of cards.values()){
    refs.viewport.querySelector('.card-view-hint > span').textContent=inSummary()?'REPLAY · 대표 방문':'LIVE WORLD';
    refs.viewport.setAttribute('aria-label',inSummary()?'기록된 대표 방문 3D 요약 · 서로 다른 시각의 경로를 겹쳐 표시':'실제 시각에 동기화된 3D 시뮬레이션');
    refs.clock.parentElement.title=inSummary()?'원본 통계 집계 시각 · 대표 캐릭터의 재생 시각과 별도':'동기화된 시뮬레이션 시각 / 하루 24시간';
  }
  if(!inSummary())return;
  const prepSeconds=preparation?Math.max(0,(performance.now()-preparation.startedAt)/1000):0;
  $('#runButton').disabled=!!preparation||!!replay?.running||ownerMode;
  $('#runButton').innerHTML=preparation?'<span class="spinner"></span> 하루 계산 중':replay?.isComplete?'<span>↻</span> 같은 결과 다시 보기':replay?.elapsed>0?'<span>▶</span> 비교 재생 이어서':replay?'<span>▶</span> 비교 재생 시작':'<span>▶</span> 하루 계산 후 비교';
  $('#pauseButton').disabled=!replay?.running;$('#pauseButton').setAttribute('aria-pressed',String(!replay?.running));
  const prepLabel=preparation?`준비 계산 ${preparation.completed} / ${lab.runs.length} · ${prepSeconds.toFixed(1)}초` : '';
  $('#boardStatus').textContent=preparation?prepLabel:replay?.isComplete?'비교 재생 완료':replay?.running?'대표 방문 재생 중':replay?.elapsed>0?'비교 재생 일시 정지':'빠른 비교 준비';
  $('#engineStatus').textContent=preparation?prepLabel:replay?`비교 진행 ${Math.round(replay.progress*100)}% · 재생 ${replaySpeed}× · 결과 변경 없음`:'원본 엔진으로 먼저 계산 · 이후 대표 방문 재생';
  $('#effectiveSpeed').textContent=preparation?`${preparation.storeName || ''} ${Math.round((preparation.progress||0)*100)}%`:'통계 시계와 대표 방문 재생 시계 분리';
  $('#effectiveSpeed').title='최초 계산 시간은 별도입니다. 재생 속도는 방문 장면과 통계 표시 속도만 바꾸며 원본 결과를 바꾸지 않습니다.';
  $('#summaryPreparation').textContent=preparation?prepLabel:replay?`준비 계산 ${Number(replay.preparationSeconds||0).toFixed(1)}초 · 이 페이지에서 다시 보기 즉시 가능`:'최초 계산 시간은 별도 · 같은 결과는 다시 계산하지 않고 재생';
  $('#approveButton').disabled=!replay?.isComplete;
  $('#approvalHint').textContent='요약 완료 후 원본 24시간 결과를 승인합니다. 재생 속도는 결과를 바꾸지 않습니다.';
}
function cancelPreparation() {
  preparationGeneration++;preparationWorker?.terminate();preparationWorker=null;preparation=null;
}
function beginSummary() {
  if(preparation)return;
  lab.pause();
  if(replay){replay.start({reset:replay.isComplete});lastFrame=performance.now();render();return;}
  const requestId=++preparationGeneration;
  const startedAt=performance.now();recordings.clear();
  preparation={startedAt,completed:0,progress:0,storeName:''};render();updateProbe();
  const workers=[];let finishedWorkers=0;
  preparationWorker={terminate:()=>workers.forEach(worker=>worker.terminate())};
  try{for(let i=0;i<3;i++)workers.push(new Worker(new URL('./replay-worker.js',import.meta.url),{type:'module'}));}
  catch(error){cancelPreparation();showToast('요약 계산을 시작하지 못했습니다. 실시간 모드를 사용할 수 있습니다.');render();return;}
  const fail=message=>{cancelPreparation();recordings.clear();showToast('요약 계산 실패: '+message+' · 실시간 모드를 사용할 수 있습니다.');render();updateProbe();};
  const onMessage=({data})=>{
    if(data.requestId!==requestId||requestId!==preparationGeneration)return;
    if(data.type==='error'){fail(data.error||'알 수 없는 오류');return;}
    if(data.type==='progress'){
      preparation.progress=data.progress;preparation.storeName=lab.runs.find(run=>run.id===data.runId)?.store.name||'';
      return; // The animation frame paints progress; don't redraw 36 cards per worker event.
    }
    if(data.type==='result'){recordings.set(data.runId,{id:data.runId,...data.result});preparation.completed=recordings.size;}
    if(data.type==='complete'){
      finishedWorkers++;if(finishedWorkers<workers.length)return;
      if(recordings.size!==lab.runs.length){fail('일부 후보 기록 누락');return;}
      try{replay=createSummaryReplay(lab.runs.map(run=>recordings.get(run.id)),{duration:REPLAY_DURATION});replay.setSpeed(replaySpeed);}
      catch(error){fail(error.message);return;}
      replay.preparationSeconds=(performance.now()-startedAt)/1000;
      preparationWorker.terminate();preparationWorker=null;preparation=null;
      if(!document.hidden&&!ownerMode&&inSummary())replay.start();
      store.setWorld(visualWorld(lab.getSelected()));lastFrame=performance.now();
      showToast('계산 완료 · 대표 방문을 겹쳐 재생합니다. 화면 속 동시 인원은 통계가 아닙니다.');
    }
    render();updateProbe();
  };
  workers.forEach((worker,index)=>{
    worker.onerror=()=>{if(requestId===preparationGeneration)fail('기록 작업 오류');};worker.onmessage=onMessage;
    worker.postMessage({type:'prepare',requestId,runs:lab.runs.filter((_,i)=>i%workers.length===index).map(run=>({id:run.id,config:{mode:'day',population:1000,duration:DAY_SECONDS,scenario:run.scenario,mapId:run.store.mapId,storeId:run.store.id,seed:run.store.seed,stockScale:run.store.stockScale,profileWeights:run.store.profileWeights,personaCatalog,runId:`summary-source:${requestId}:${run.id}`}}))});
  });
}
function startView(){
  if(inSummary())beginSummary();else lab.start({reset:lab.runs.every(isComplete)});
  if(inspectorOpen)store.syncWorld(visualWorld(lab.getSelected()));cardWorlds.render();lastFrame=performance.now();render();renderTick();updateProbe();
}
function resetViewRun(){
  pauseView();cancelPreparation();
  if(inSummary())replay?.reset();else lab.reset();
  store.setWorld(visualWorld(lab.getSelected()));if(inspectorOpen)store.syncWorld(visualWorld(lab.getSelected()));
  cardWorlds.render();lastFrame=performance.now();render();renderTick();updateProbe();
  showToast(inSummary()?'요약 재생을 처음으로 되돌렸습니다. 원본 결과와 저장된 승인은 유지됩니다.':'전체 실험을 초기화했습니다. 저장된 승인은 유지됩니다.');
}
function showToast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => {$('#toast').hidden = true;},4000); }
function renderDecisionStatus(){
  const worlds=lab.runs.map(r=>r.world),calls=worlds.reduce((n,w)=>n+w.modelCalls,0),pending=worlds.some(w=>w.hasPendingDecisions()),failure=worlds.find(w=>w.decisionError);
  $('#decisionStatus').textContent=decisionMode==='local'?'로컬 기준선 · JEV 호출 없음':failure?'JEV 실행 중단 · '+failure.decisionError:pending?'JEV 응답 대기 · 모든 시뮬레이션 시계 정지':`JEV 실험 · 실제 응답 ${calls}회 적용`;
  $('#gatewayBudget').textContent=gatewayStatus?.configured?`typesafe-ai/jev · 평가 API · 이 서버 호출 ${gatewayStatus.used??0} / ${gatewayStatus.maxCalls??20}회 · 잔여 ${gatewayStatus.callsRemaining??0}회. 한도 소진·오류 시 중단하며 GPT/로컬로 대체하지 않습니다. 1,000명 전체 JEV 실험에는 별도 호출 예산이 필요합니다.`:'서버 JEV 연결 사용 불가 · npm start 및 서버 환경변수를 확인하세요. 로컬 결과는 JEV 평가가 아닙니다.';
  $('#dataDisclaimer').textContent=`NVIDIA 합성 1,000개 · 실고객/POS 아님 · ${decisionMode==='jev'?'JEV 평가 API':'로컬 판단'}`;
  if(decisionMode==='jev'&&!calls&&!pending&&!failure&&gatewayStatus?.lastFailure)$('#decisionStatus').textContent=`최근 JEV 요청 실패 · Gateway ${gatewayStatus.lastFailure.upstreamStatus??gatewayStatus.lastFailure.failureCode} · 자동 재시도 없음`;
  const decision=accountingWorld(lab.getSelected()).lastDecision;
  const record=decision?{engine:decision.result.engine,sourceId:decision.context.persona.source?.id??'authored',mission:decision.context.persona.mission,stage:decision.context.schemaVersion,action:decision.result.action,trace:decision.result.trace??null,policy:decision.context.constraints?.behavior??null}:null;
  const output=JSON.stringify({selectedCandidate:record??{status:'아직 이 후보의 판단 기록이 표시되지 않음',note:'합성 기록 출처와 행동 수치 가정은 구분됩니다. 인간 행동 정확도는 아직 미검증입니다.'},recentServerCalls:gatewayTraces.slice(-3)},null,2);
  if($('#decisionEvidence').dataset.value!==output){$('#decisionEvidence').dataset.value=output;const pre=document.createElement('pre');pre.textContent=output;$('#decisionEvidence').replaceChildren(pre);}
  if(decisionMode==='jev'&&(failure||!gatewayStatus?.configured||gatewayStatus.callsRemaining===0))$('#runButton').disabled=true;
}
async function refreshGateway(){
  try{const [response,traces]=await Promise.all([fetch('/api/status'),fetch('/api/traces')]);gatewayStatus=response.ok?await response.json():null;gatewayTraces=traces.ok?(await traces.json()).traces:[];}catch{gatewayStatus=null;}
  renderDecisionStatus();
}
$('#refreshGateway').addEventListener('click',refreshGateway);
$('#decisionMode').addEventListener('change',()=>{
  pauseView();cancelPreparation();decisionMode=$('#decisionMode').value;
  lab.setDecisionProvider(decisionMode==='jev'?jevProvider:undefined);
  if(decisionMode==='jev')viewMode='live';
  store.setWorld(visualWorld(lab.getSelected()));lastFrame=performance.now();render();updateProbe();
  showToast(decisionMode==='jev'?'JEV 호출 한도 내 검증입니다. 한도 소진 시 중단하며 기존 로컬 결과와 섞지 않습니다.':'로컬 기준선으로 초기화했습니다. JEV 결과로 표시하지 않습니다.');
});
refreshGateway();
function renderOwner() {
  const storeId = $('#ownerStoreSelect').value, approved = approvals[storeId];
  if (!approved || !['gs2500-day-approval-v2','gs2500-day-approval-v3'].includes(approved.schema) || !approved.isComplete || !approved.day || approved.time < DAY_SECONDS || !SCENARIOS[approved.scenario] || !Array.isArray(approved.levels)) { $('#ownerPlan').innerHTML = '<div class="owner-empty">아직 승인된 하루 계획이 없습니다.<br>관리자가 24시간 운영을 완료하고 승인하면 이곳에 표시됩니다.<br><small>이전 버전의 방문 횟수 기준 승인은 하루 완료 결과로 사용하지 않습니다.</small></div>'; return; }
  const storeInfo = lab.stores.find(s => s.id === storeId);
  $('#ownerPlan').innerHTML = `<article class="owner-plan-card"><div class="owner-plan-heading"><h3>${escape(storeInfo.name)} · ${letters[approved.scenario]}</h3><span class="approval-chip">24시간 승인 저장됨</span></div><p>${escape(SCENARIOS[approved.scenario].title)} · ${escape(new Date(approved.approvedAt).toLocaleString('ko-KR'))}<br>00:00–24:00 · 잠재 고객 ${format(approved.day.potentialTotal)}명 / 입장 ${format(approved.day.entered)}명 / 지나침 ${format(approved.day.skipped)}명 / 구매 ${format(approved.day.buyers)}명</p><div class="shelf-legend"><span>층별 왼쪽 → 오른쪽</span><span>하루 마감 시 진열 / 창고 재고</span></div><div class="shelf-editor">${[4,3,2,1].map(level => `<div class="shelf-editor-row"><b>${level}F</b><span class="shelf-products">${(approved.levels[level-1] || []).map(id => PRODUCT_MAP[id] ? `<span class="shelf-product"><span class="shelf-product-name"><i class="swatch" style="--color:${PRODUCT_MAP[id].color}"></i>${escape(PRODUCT_MAP[id].name)}</span><small>진열 ${approved.stock?.[id] ?? 0} / 창고 ${approved.backroomStock?.[id] ?? 0}</small></span>` : '').join('')}</span></div>`).join('')}</div><div class="owner-plan-metrics"><div><span>시뮬레이션 결제매출</span><strong>${money(approved.paidRevenue)}</strong></div><div><span>누적 매출총이익</span><strong>${money(approved.paidGrossProfit)}</strong></div></div><div class="owner-plan-note">점주 보충 ${format(approved.replenishments)}회 · ${format(approved.replenishedUnits)}개 이동<br>실행 ${escape(approved.runId)}<br>합성 데이터 · 실제 매출 예측 아님 · 이 승인은 실제 발주나 매장 변경을 실행하지 않습니다.</div></article>`;
  const sourceNote=document.createElement('p');sourceNote.className='detail-note';
  sourceNote.textContent=approved.schema==='gs2500-day-approval-v3'?`승인 원본 엔진: ${approved.engine?.type??'unknown'} · 페르소나: ${approved.personaSource?.dataset??'unknown'} · ${approved.personaSource?.count??0}개 합성 기록`:'이전 버전 승인 보존본 · 당시 5종 로컬 페르소나 기준이며 새 Nemotron/JEV 결과가 아닙니다.';
  $('#ownerPlan').prepend(sourceNote);
}
function setOwnerMode(value) {
  ownerMode = value;
  // The role preview is local and keeps the simulation paused while its canvas is hidden.
  if (value) {if(inspectorOpen)setInspector(false);pauseView(); $('#ownerStoreSelect').value = lab.getSelected().store.id; renderOwner();}
  $('#ownerPanel').hidden = !value; $('#managerPanel').hidden = value;
  $('#ownerView').classList.toggle('active',value); $('#managerView').classList.toggle('active',!value);
  $('#ownerView').setAttribute('aria-pressed',String(value)); $('#managerView').setAttribute('aria-pressed',String(!value));
  cardWorlds.render(); render(); updateProbe(); $('#runButton').disabled = value || viewRunning() || !!preparation;
}
$('#runButton').addEventListener('click', startView);
$('#pauseButton').addEventListener('click', () => {pauseView(); render(); updateProbe();});
$('#resetRuns').addEventListener('click', resetViewRun);
document.querySelectorAll('[data-presentation]').forEach(button=>button.addEventListener('click',()=>{
  if(viewMode===button.dataset.presentation)return;
  pauseView();cancelPreparation();viewMode=button.dataset.presentation;
  store.setWorld(visualWorld(lab.getSelected()));if(inspectorOpen)store.syncWorld(visualWorld(lab.getSelected()));
  cardWorlds.render();lastFrame=performance.now();render();renderTick();updateProbe();
}));
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
document.querySelectorAll('[data-replay-speed]').forEach(button=>button.addEventListener('click',()=>{replaySpeed=Number(button.dataset.replaySpeed);replay?.setSpeed(replaySpeed);lastFrame=performance.now();render();updateProbe();}));
document.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => {
  detail = button.dataset.detail;
  document.querySelectorAll('[data-detail]').forEach(tab => {const active = tab === button; tab.classList.toggle('active',active); tab.setAttribute('aria-selected',String(active));});
  for (const name of ['day','shelf','agent','log']) $(`#detail${name[0].toUpperCase()+name.slice(1)}`).hidden = detail !== name;
  render(); renderTick();
}));
$('#resetView').addEventListener('click', () => store.reset()); $('#focusShelf').addEventListener('click', () => store.focus());
$('#zoomIn').addEventListener('click', () => store.zoom(1.2)); $('#zoomOut').addEventListener('click', () => store.zoom(1/1.2));
$('#togglePaths').addEventListener('click', event => event.currentTarget.setAttribute('aria-pressed',String(store.togglePaths())));
$('#focusAgent').addEventListener('click', () => store.followAgent()); $('#nextAgent').addEventListener('click', () => store.nextAgent());
$('#managerView').addEventListener('click', () => setOwnerMode(false)); $('#ownerView').addEventListener('click', () => setOwnerMode(true));
$('#ownerStoreSelect').addEventListener('change',renderOwner);
$('#approveButton').addEventListener('click', () => {
  const run = lab.getSelected(), summary = inSummary()?accountingWorld(run):run.world.snapshot(); if (inSummary()?!replay?.isComplete:!run.world.isComplete) return;
  if(summary.time < DAY_SECONDS || !summary.day)return;
  const receipt = {schema:'gs2500-day-approval-v2',mode:'day',isComplete:true,storeId:run.store.id,scenario:run.scenario,runId:summary.runId || run.id,approvedAt:new Date().toISOString(),levels:SCENARIOS[run.scenario].levels.map(row => [...row]),day:summary.day,time:summary.time,completed:summary.completed,paidRevenue:summary.paidRevenue,paidGrossProfit:summary.paidGrossProfit,stock:summary.stock,backroomStock:summary.backroomStock,shelfCapacity:summary.shelfCapacity,initialTotalStock:summary.initialTotalStock,replenishments:summary.replenishments ?? summary.owner?.completedTasks,replenishedUnits:summary.replenishedUnits};
  Object.assign(receipt,{schema:'gs2500-day-approval-v3',engine:summary.engine,personaSource:summary.personaSource});
  const next = {...approvals,[run.store.id]:receipt};
  try {localStorage.setItem(approvalKey,JSON.stringify(next)); approvals = next; render(); showToast(`${run.store.name} · ${letters[run.scenario]} 계획을 이 기기에 승인 저장했습니다.`);} catch {showToast('브라우저 저장소를 사용할 수 없어 승인 계획을 저장하지 못했습니다.');}
});
$('#exportDay').addEventListener('click', () => {
  const run = lab.getSelected();
  if(inSummary()){
    const record=recordings.get(run.id);if(!record){showToast('먼저 하루 계산을 완료해주세요.');return;}
    const payload={schema:'gs2500-summary-export-v1',presentation:'overlapped-recorded-visits',disclaimer:'대표 방문 요약 · 실제 동시 방문 아님 · 합성 데이터 · 원본 전체 노출 원장이 아닌 요약',store:run.store,scenario:run.scenario,finalSnapshot:record.finalSnapshot,ledgerSummary:record.ledgerSummary};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`gs2500-summary-${run.id.replace(':','-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('재생 영상과 구분된 원본 하루 결과·요약 원장을 내보냈습니다.');return;
  }
  const payload = {schema:'gs2500-day-export-v2',exportedAt:new Date().toISOString(),source:'synthetic-persona-demo',disclaimer:'NVIDIA 공개 합성 페르소나 · 실제 매출 예측 아님 · 모델 호출 여부는 engine/trace 참조',store:run.store,scenario:run.scenario,levels:SCENARIOS[run.scenario].levels,complete:run.world.isComplete,snapshot:run.world.snapshot(),ledger:run.world.exportLedger()};
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  const link = document.createElement('a');link.href=url;link.download=`gs2500-day-${run.id.replace(':','-')}-${Math.floor(run.world.time)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  showToast(run.world.isComplete ? '완료한 하루 운영 데이터를 내보냈습니다.' : '현재까지의 중간 결과를 내보냈습니다. 완료 결과가 아닙니다.');
});

window.shelfville = Object.freeze({snapshot:() => ({...viewSnapshot(),viewMode,renderer:store.snapshot(),cardViews:cardWorlds.snapshot(),selectedWorld:accountingWorld(lab.getSelected())}),start:startView,pause:() => {pauseView();render();},setSpeed:n => {lab.setSpeed(n);render();},select:chooseRun,reset:resetViewRun});
cardWorlds.render(); render(); renderTick(); updateProbe();
function frame(now) {
  if (stopped) return;
  const dt = lastFrame === null ? 0 : Math.max(0,(now-lastFrame)/1000); lastFrame = now;
  if(inSummary())replay?.advance(dt);else{lab.advance(dt,{budgetMs:10});if(!decisionSettlement&&lab.running&&lab.runs.some(r=>r.world.hasPendingDecisions()))decisionSettlement=lab.settleDecisions().finally(()=>{decisionSettlement=null;void refreshGateway();});}
  cardWorlds.render();
  if (!ownerMode && inspectorOpen) store.syncWorld(visualWorld(lab.getSelected()));
  if (now-lastUi >= 160) {render(); lastUi = now; if (ownerMode) $('#runButton').disabled = true;}
  renderTick();updateProbe();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseView();lastFrame=null;render();updateProbe();}});
window.addEventListener('pagehide', () => {stopped = true; cancelPreparation();clearTimeout(toastTimer); pager.destroy();store.dispose();cardWorlds.dispose();}, {once:true});
