// Presentation-only views. All forecasts, identities and approval state come
// from the shared workflow contract; this module never generates performance.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = value => value != null && Number.isFinite(Number(value)) ? Number(value).toLocaleString('ko-KR', {maximumFractionDigits: 1}) : '—';
const percent = value => value != null && Number.isFinite(Number(value)) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(1)}%` : '—';
const money = value => value == null ? '—' : number(Number(value) / 1000);
const tone = value => Number(value) < 0 ? 'negative' : 'positive';
const attrs = object => Object.entries(object).map(([key,value]) => `data-${key}="${escape(value)}"`).join(' ');
const button = (label, action, options = {}) => `<button type="button" class="${options.className ?? 'button'}" ${attrs({action,...(options.data ?? {})})}${options.disabled ? ' disabled' : ''}>${label}</button>`;
const badge = (text, type = '') => `<span class="badge ${type}">${escape(text)}</span>`;
const small = text => `<span class="eyebrow">${escape(text)}</span>`;
const logo = `<span class="brand"><span>GS</span><span>2500</span></span>`;
const SYNTHETIC = '합성 데모 데이터';

function findResult(vm, storeId = vm.store?.id, bayId = vm.bay?.id) {
  const key = `${storeId}:${bayId}`;
  return vm.results instanceof Map ? vm.results.get(key) : vm.results?.[key];
}
function selectedResult(vm) {
  return findResult(vm)?.candidates?.find(row => row.candidateId === vm.candidate?.id);
}
function storeOf(vm, bay) { return vm.stores.find(store => store.id === bay?.storeId); }
function dataFor(bay, candidate, route) {
  return {store:bay?.storeId,bay:bay?.id,...(candidate ? {candidate:candidate.id} : {}),...(route ? {route} : {})};
}
function productMap(vm) {
  return Array.isArray(vm.products) ? Object.fromEntries(vm.products.map(row => [row.id,row])) : vm.products ?? {};
}
function placements(vm, baseline = false) {
  return (baseline ? vm.baselinePlacements : vm.placements)?.filter(row => !row.fixtureId || row.fixtureId === (vm.bay?.fixtureId ?? 'promo')) ?? [];
}
function changes(vm) {
  const current = placements(vm, true);
  return placements(vm).map(row => ({...row, before:current.find(old => old.productId === row.productId)}))
    .filter(row => row.before && (row.level !== row.before.level || row.column !== row.before.column));
}

function shell(vm, content) {
  const owner = vm.route === 'owner';
  const simulation = ['bays','bay','board','candidate'].includes(vm.route);
  const nav = (name,route,active) => button(`<span class="nav-dot"></span>${name}`,'navigate',{className:`nav-item ${active ? 'active' : ''}`,data:{route}});
  return `<div class="app-shell">
    <aside class="sidebar" aria-label="주 메뉴">
      ${button(logo,'navigate',{className:'brand-button',data:{route:owner?'owner':'home'}})}
      <div class="workspace-name">${owner ? 'STORE WORKSPACE' : 'MANAGER WORKSPACE'}</div>
      <nav>${owner ? nav('매니저 제안','owner',true) : `${nav('홈','home',vm.route==='home')}${nav('진열 시뮬레이션','bays',simulation)}${nav('4주 회고','review',vm.route==='review')}`}
        ${['발주 조정','행사 배정','현장 지원'].map(name => `<div class="nav-item unavailable" aria-disabled="true"><span class="nav-dot"></span>${name}<span class="not-built">미구현</span></div>`).join('')}
      </nav>
      ${!owner && simulation ? `<div class="side-proposals">${small('오늘의 제안')}${vm.bays.map(bay => button(`<strong>${escape(storeOf(vm,bay)?.name)}</strong><span>${escape(bay.name)}</span>`,'select-bay',{className:`side-proposal ${vm.bay?.id===bay.id && vm.store?.id===bay.storeId?'active':''}`,data:dataFor(bay)})).join('')}</div>` : ''}
      <div class="side-account">${small(owner?'합성 점주 계정':'담당 매니저')}<strong>${owner ? escape(vm.approval ? vm.store?.name+' 점주' : '점주 데모') : '김 매니저'}</strong><span class="muted mono">${owner ? escape(vm.approval?.storeId ?? '승인 대기') : `${vm.stores.length}개 합성 점포`}</span></div>
      <div class="sidebar-bottom"><span class="demo-dot"></span> HACKATHON DEMO<br><span>실제 GS25 시스템과 미연결</span>${button('데모 초기화','reset-demo',{className:'text-button muted'})}</div>
    </aside>
    <main class="main" id="main-content">
      <header class="topbar"><div class="assistant-note"><span class="assistant-mark" aria-hidden="true">G</span><span>${escape(topline(vm))}</span></div><div class="topbar-actions">${badge(SYNTHETIC,'synthetic')}${button(owner?'데모 · 매니저 화면':'데모 · 점주 화면',owner?'role-manager':'role-owner',{className:'role-button'})}</div></header>
      ${vm.error ? `<div class="error-banner" role="alert"><strong>진행 상태를 확인해 주세요.</strong> ${escape(vm.error)}</div>` : ''}
      ${content}
      <footer class="page-footer"><span>GS2500 · 점포와 함께 결정하는 다음 진열</span><span><a href="/demo/" target="_blank" rel="noopener">원본 3D 실험실 ↗</a> · <a href="/storyboard.html" target="_blank" rel="noopener">콘티 ↗</a></span><span>같은 브라우저 안의 로컬 데모 · 실제 문자·발주 없음</span></footer>
    </main>
    ${vm.approvalOpen ? approvalDialog(vm) : ''}
  </div>`;
}
function topline(vm) {
  if(vm.route==='owner') return vm.approval ? '사장님, 담당 매니저가 승인한 진열 제안입니다.' : '승인된 제안이 도착하면 이곳에서 확인할 수 있어요.';
  if(vm.route==='home') return '점포의 실적에서 출발해, 이번 주의 작은 변화를 결정합니다.';
  if(vm.route==='review') return '좋은 결과와 부진한 결과를 함께 보고, 다음 지원을 고릅니다.';
  if(vm.route==='board') return '여러 점포의 후보를 같은 조건으로 비교합니다.';
  return `${vm.bays.length}개 매대의 합성 진열 가설을 준비했습니다. 실행 전 비교하고 승인하세요.`;
}
function heading(kicker,title,description,actions='') {
  return `<div class="page-heading"><div>${small(kicker)}<h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}
function titleTags(vm) {
  return `<div class="title-tags">${badge(vm.store?.name ?? '점포','solid')}${badge(`${vm.bay?.name ?? '매대'} · ${vm.bay?.id ?? ''}`)}${vm.store?.yoy != null ? badge(`전년비 ${percent(vm.store.yoy)} · 달성률 ${number(vm.store.targetAchievement)}%`,tone(vm.store.yoy)) : ''}</div>`;
}
function metric(label,value,unit,detail='',className='') {
  return `<div class="metric ${className}"><span class="eyebrow">${escape(label)}</span><div class="metric-number">${value}<span>${escape(unit)}</span></div>${detail ? `<p>${detail}</p>` : ''}</div>`;
}
function referencePhoto({compact=false}={}) {
  return `<figure class="reference-photo ${compact?'compact':''}"><div class="photo-frame"><img src="/workspace/assets/bay-reference.jpg" alt="콘티에 제공된 진열 매대 참고 사진" loading="lazy"><span class="photo-label">콘티 참고 사진 · 현재 모습</span></div><figcaption>실제 점포 촬영·업로드 기록이 아닙니다.<br>사진 속 품목과 합성 SKU는 다르며, 정확한 배치는 선반 도식 기준입니다.</figcaption></figure>`;
}
function evidence(vm, compact=false) {
  return `<section class="evidence ${compact?'compact-evidence':''}" aria-label="제안 근거">${small('지금 이 매대를 보는 이유')}${(vm.bay?.evidence ?? []).map((row,i) => `<article class="evidence-item"><span class="evidence-number">${String(i+1).padStart(2,'0')}</span><div><h3>${escape(typeof row==='string'?row:row.title)}</h3><p>${escape(row.text ?? '')}</p><span class="source-label">${escape(row.source ?? '합성 데모 가정')} · 검증할 가설</span></div></article>`).join('')}</section>`;
}
function shelf(vm, baseline=false) {
  const rows = placements(vm,baseline), products = productMap(vm);
  const changed = new Set(changes(vm).map(row=>row.productId));
  if(!rows.length) return `<div class="empty compact-empty">선반 좌표를 불러오지 못했습니다. 3D 연결 상태를 확인해 주세요.</div>`;
  return `<div class="shelf-diagram" aria-label="${baseline?'현재':'후보'} 선반 배치"><div class="shelf-caption">${small(baseline?'AS-IS · 현재 본사 표준':'TO-BE · '+(vm.candidate?.name ?? '선택안'))}<span class="mono">SKU ${new Set(rows.map(row=>row.productId)).size}</span></div>${[4,3,2,1].map(level => `<div class="shelf-level ${level===2||level===3?'eye-level':''}"><div class="level-label"><strong>${level}단</strong>${level===2||level===3?'<span>눈높이 가정</span>':''}</div><div class="shelf-products">${rows.filter(row=>row.level===level).sort((a,b)=>a.column-b.column).map(row=>`<div class="shelf-product ${!baseline&&changed.has(row.productId)?'moved':''}" title="${escape(`${row.productId} · ${level}단 ${row.column}열 · XYZ ${(row.position??[]).map(x=>Number(x).toFixed(2)).join(', ')}`)}"><span>${escape(products[row.productId]?.name ?? row.productId)}</span><small>${row.column}열${!baseline&&changed.has(row.productId)?' · 이동':''}</small></div>`).join('')}</div></div>`).join('')}<p class="micro">아래부터 1단 · 위치·좌우 이웃은 기존 3D와 동일한 SKU 계약을 사용합니다.</p></div>`;
}
function stockWarnings(vm) {
  const inventory = vm.inventory?.total;
  if(!inventory) return '';
  const empty = placements(vm).filter(row=>Number(inventory[row.productId])<=0);
  if(!empty.length) return '';
  const products=productMap(vm);
  return `<div class="error-banner"><strong>재고 0개 · 실행 전 확인 필요</strong><p>${empty.map(row=>escape(products[row.productId]?.name ?? row.productId)).join(', ')} — 진열도는 위치 제안이며, 재고가 없으면 판매할 수 없습니다.</p></div>`;
}
function optionCards(vm, route='bay') {
  const results=findResult(vm);
  return `<div class="option-grid">${(vm.bay?.candidates ?? []).map(candidate => {
    const result=results?.candidates?.find(row=>row.candidateId===candidate.id);
    return button(`<div class="option-top"><span class="option-letter">${escape(candidate.id)}</span>${small(candidate.scenario)}</div><strong>${escape(candidate.name)}</strong><p>${escape(candidate.description)}</p><div class="option-metrics"><span>${result?percent(result.deltaPercent):'계산 전'}</span><small>현재 진열 대비 · 30일 예상</small></div><div class="option-meta"><span>약 ${number(candidate.minutes)}분</span><span>${candidate.orderSkus?.length?`추가 발주 검토 ${candidate.orderSkus.length} SKU`:'추가 발주 없음'}</span></div>`,'select-candidate',{className:`option-card ${vm.candidate?.id===candidate.id?'selected':''}`,data:dataFor(vm.bay,candidate,route)});
  }).join('')}</div>`;
}
function assumptions(vm) {
  const result=findResult(vm);
  const lines=Array.isArray(result?.assumptions)?result.assumptions:result?.assumptions ? Object.values(result.assumptions) : [];
  return `<details class="assumptions"><summary>계산 입력·가정과 한계 보기</summary><div><p>30일 예상과 3D는 같은 계산 기록을 사용합니다. 숫자는 모든 가상 결제를 집계하고, 3D는 선택한 날에 기록된 방문 중 일부를 대표 재생합니다. 이동 경로·체류시간은 상품 위치와 방문 기록을 보여주는 시각화이며, 재생 배속이나 표시 인원으로 구매·매출을 다시 계산하지 않습니다.</p><ul>${lines.map(row=>`<li>${escape(typeof row==='string'?row:JSON.stringify(row))}</li>`).join('')}</ul><p>비·트렌드·지역 행사는 합성 조건입니다. JEV 실호출이나 실측 GS25 성과가 아니며, 실제 혼잡·대기시간이나 인간 행동을 검증한 모형도 아닙니다. 수익 차이를 실제 매출 상승이나 인과효과로 해석하지 마세요.</p></div></details>`;
}

function login(vm) {
  return `<main class="login-page"><section class="login-card"><div class="login-brand">${logo}<h1>AI-Native 점포경영시스템</h1><p>점포의 다음 진열, 근거를 보고 함께 결정합니다.</p></div><div class="demo-credentials"><div><span class="credential-icon">○</span><span>manager.kim</span>${badge('DEMO')}</div><div><span class="credential-icon">◇</span><span class="mono">••••••••</span><span class="muted">인증 없음</span></div></div>${button('데모 로그인','login',{className:'button primary login-submit'})}<p class="login-disclaimer">실제 계정·비밀번호를 입력하지 않습니다.<br>같은 브라우저에서만 이어지는 합성 데모입니다.</p><div class="login-campaign"><div><strong>함께 <span>×</span> 100</strong><p>본사와 가맹점이 함께 만드는 AX</p></div><span class="campaign-mark">GS<br>2500</span></div></section>${badge(SYNTHETIC,'synthetic')}<div class="login-bottom">STORE OPERATIONS · DECISION WORKSPACE</div>${vm.error?`<p role="alert">${escape(vm.error)}</p>`:''}</main>`;
}
function home(vm) {
  const declining=vm.stores.filter(row=>row.yoy<0).length;
  const average=vm.stores.reduce((sum,row)=>sum+row.yoy,0)/Math.max(1,vm.stores.length);
  const achievements=vm.stores.reduce((sum,row)=>sum+row.targetAchievement,0)/Math.max(1,vm.stores.length);
  const sorted=[...vm.stores].sort((a,b)=>a.yoy-b.yoy);
  const risk=sorted[0];
  return heading('PERFORMANCE · '+escape(vm.stores[0]?.period ?? '합성 점포 실적'),'이번 주, 어느 점포를 먼저 도울까요?','전년 동기비 실적에서 출발합니다. 진열은 여러 개선 수단 중 하나입니다.')+
    `<section class="summary-strip">${metric('담당 점포',vm.stores.length,'곳',`상승·유지 ${vm.stores.length-declining}곳 · 하락 ${declining}곳`)}${metric('담당 평균 전년 동기비',percent(average),'','단순 평균 · 합성 월간 실적',tone(average))}${metric('평균 목표 달성률',number(achievements),'%','전년 동기비와 다른 기준')}</section>
    <div class="section-heading"><h2>담당 점포 실적</h2><span class="mono muted">하락 큰 순 · 금액 단위 천원</span></div>
    <section class="store-grid">${sorted.map(store=>{
      const bay=vm.bays.find(row=>row.storeId===store.id);
      return button(`<div class="store-card-title"><div><strong>${escape(store.name)}</strong><span class="mono muted">${escape(store.id)}</span></div><span aria-hidden="true">↗</span></div><div class="eyebrow">전년 동기비 · 합성 실적</div><div class="store-yoy ${tone(store.yoy)}">${percent(store.yoy)}</div><div class="progress-track"><span class="${tone(store.yoy)}" style="width:${Math.max(0,Math.min(100,store.targetAchievement))}%"></span></div><div class="store-card-bottom"><span>${money(store.sales)} 천원</span><span>목표 달성률 ${number(store.targetAchievement)}%</span></div>`,'select-bay',{className:`store-card ${store.id===risk?.id?'priority':''}`,data:dataFor(bay)});
    }).join('')}</section>
    ${risk?`<div class="priority-note"><span class="priority-indicator"></span><p><strong>${escape(risk.name)}</strong> 전년 동기비 <span class="negative mono">${percent(risk.yoy)}</span> · 진열 가설과 재고·현장 여건을 함께 살펴보세요.</p>${badge('우선 검토')}</div>`:''}
    <div class="next-step"><span class="next-step-symbol">↗</span><div><span class="eyebrow">NEXT DECISION</span><h3>어느 점포의 어느 매대를 먼저 도와야 할까?</h3></div>${button('진열 시뮬레이션 열기','navigate',{className:'button primary',data:{route:'bays'}})}</div><p class="micro">실적은 작성된 합성 fixture입니다. 30일 가상 예상과 4주 후 합성 관찰은 별도 화면에서 구분합니다.</p>`;
}
function bays(vm) {
  return heading('MERCHANDISING · 이번 주 제안','진단 대기 매대','매대 = 점포 안의 한 진열 구획 · 제안과 비교의 기본 단위',button(vm.busy?'계산 중…':'전체 시뮬레이션 돌리기','run-all',{className:'button primary',disabled:vm.busy}))+
    `<div class="list-toolbar"><span class="filter-chip active">검토 대상 전체</span><span class="muted">합성 근거와 실행 부담을 확인하세요</span><span class="mono">매대 ${vm.bays.length}곳 · 후보 ${vm.bays.reduce((sum,bay)=>sum+bay.candidates.length,0)}개</span></div><div class="bay-table"><div class="bay-table-head"><span>현재 사진</span><span>점포 · 매대</span><span>비교할 후보</span><span>점포 실적</span><span>근거</span><span></span></div>${vm.bays.map((bay,index)=>{
      const store=storeOf(vm,bay);
      return `<article class="bay-row ${index===0?'priority-row':''}"><div class="bay-thumb">${index===0?'<img src="/workspace/assets/bay-reference.jpg" alt="콘티 참고 매대 사진">':'<span>사진 미등록</span>'}</div><div class="bay-identity">${badge(store?.name,'solid')}<h3>${escape(bay.name)}</h3><span class="mono muted">${escape(store?.id)} · ${escape(bay.id)}</span></div><div class="bay-options">${bay.candidates.map(row=>badge(`${row.id} ${row.name}`)).join('')}</div><div class="bay-sales"><strong>${money(store?.sales)}<small> 천원</small></strong><span class="${tone(store?.yoy)} mono">전년비 ${percent(store?.yoy)}</span><small class="muted">매대 매출 아님</small></div><span class="reason-count"><strong>${bay.evidence.length}</strong>개 가설</span>${button('열기','select-bay',{className:index===0?'button primary':'button',data:dataFor(bay)})}</article>`;
    }).join('')}<div class="table-note">현재 구성된 합성 매대 ${vm.bays.length}곳만 표시합니다. 전국 점포를 분석·선별한 결과가 아닙니다.</div></div><div class="callout neutral"><strong>좋은 제안은 작업 부담까지 작아야 합니다.</strong><p>같은 초기 조건으로 현재 진열과 후보를 비교한 뒤, 매니저가 승인한 안만 점주에게 보여줍니다.</p></div>`;
}
function bay(vm) {
  if(!vm.bay||!vm.candidate)return emptySelection();
  return `<div class="breadcrumb">${button('진단 대기 매대','navigate',{className:'text-button',data:{route:'bays'}})}<span>/</span><span>${escape(vm.store?.name)}</span></div>${titleTags(vm)}
    <div class="transition-title"><div>${small('AS-IS')}<span>현재 본사 표준 진열</span></div><span class="transition-arrow">→</span><div>${small('TO-BE')}<h1>${escape(vm.candidate.name)}</h1></div></div>
    <div class="bay-detail-layout">${referencePhoto()}<div>${evidence(vm)}<div class="section-heading"><h2>작게 바꿔 볼 수 있는 후보</h2><span class="mono muted">${vm.bay.candidates.length} OPTIONS</span></div>${optionCards(vm)}<p class="micro">후보를 고르면 아래 선반 도식이 바뀝니다. 아직 승인되거나 점주에게 전달되지 않습니다.</p>${stockWarnings(vm)}</div></div>
    <div class="section-heading"><h2>같은 상품, 다른 위치</h2><span class="mono muted">${changes(vm).length} SKU 위치 변경 · 4단</span></div><div class="shelf-comparison">${shelf(vm,true)}${shelf(vm)}</div>
    <div class="action-bar"><p>다른 점포와 후보도 함께 비교한 뒤 결정하세요.</p>${button('목록으로 · 전체 비교 실행','navigate',{className:'button primary',data:{route:'bays'}})}</div>`;
}
function board(vm) {
  const ready=vm.bays.filter(bay=>findResult(vm,bay.storeId,bay.id)?.completed).length;
  return heading('SIMULATION BOARD · SAME RECORD','여러 점포, 여러 선택을 한눈에','같은 잠재 고객·재고·행사 조건에서 진열안을 비교합니다. 기록된 구매와 상품 위치를 한 카드에서 확인하세요.',button('매대 목록','navigate',{data:{route:'bays'}}))+
    `<div class="board-status"><span class="status-dot ${vm.busy?'working':''}"></span><strong>${vm.busy?'30일 구매·재고 기록 계산 중':`${ready} / ${vm.bays.length} 매대 비교 준비`}</strong><span class="mono">${escape(vm.progressLabel ?? '동일 시드 · 동일 재고 · 같은 잠재 수요')}</span>${badge('로컬 판단 · JEV 미호출')}</div>
    <div class="model-seam simulation-contract"><strong>하나의 계산, 두 가지 보기</strong><span><b>30일 예상</b>은 전체 가상 결제 합계 · <b>3D</b>는 선택한 날의 대표 방문 재생입니다. 장면의 배속·체류 연출은 구매 결과를 바꾸지 않습니다.</span></div>
    <section id="world-board" class="world-board" aria-label="점포별 3D 시뮬레이션 전광판"><div class="world-placeholder"><span class="loading-ring"></span><p>구매 기록과 3D 진열을 연결하고 있습니다.</p></div></section>
    <details class="forecast-comparisons" open><summary><span><strong>30일 최종 수치 비교표</strong><small>현재 진열 + 후보 ${vm.bays.reduce((sum,bay)=>sum+bay.candidates.length,0)}개 · 대상 24 SKU</small></span><span class="comparison-summary-hint">접기 / 펼치기</span></summary><div class="forecast-tables">${vm.bays.map(bay=>{
      const store=storeOf(vm,bay), result=findResult(vm,bay.storeId,bay.id);
      const metricCells=row=>`<td class="mono">${money(row?.revenue)}</td><td class="mono">${money(row?.profit)}</td><td class="mono">${row?number(row.stockoutRate*100)+'%':'—'}</td>`;
      return `<section class="comparison-group"><div class="section-heading"><div><h2>${escape(store?.name)} <span>${escape(bay.name)}</span></h2><p class="micro mono">${escape(store?.id)} · ${escape(bay.id)} · 금액 단위 천원</p></div>${badge('동일 고객·행사 조건')}</div><table class="forecast-table"><caption class="visually-hidden">${escape(store?.name)} 30일 예상 수치와 작업 부담</caption><thead><tr><th scope="col">진열안</th><th scope="col">결제매출</th><th scope="col">매출총이익</th><th scope="col">품절 수요</th><th scope="col">현재 대비</th><th scope="col">작업·발주</th><th scope="col"><span class="visually-hidden">후보 선택</span></th></tr></thead><tbody><tr class="baseline-row"><th scope="row">현재 진열 <small>본사 표준</small></th>${metricCells(result?.baseline)}<td class="mono">기준선</td><td>변경 없음</td><td></td></tr>${bay.candidates.map(candidate=>{
        const row=result?.candidates?.find(item=>item.candidateId===candidate.id);
        return `<tr><th scope="row"><span class="table-plan-name"><span class="option-letter">${escape(candidate.id)}</span>${escape(candidate.name)}</span></th>${metricCells(row)}<td class="mono ${tone(row?.deltaPercent)}">${row?percent(row.deltaPercent):'—'}</td><td>약 ${number(candidate.minutes)}분<small>${candidate.orderSkus.length?`발주 검토 ${candidate.orderSkus.length} SKU`:'추가 발주 없음'}</small></td><td>${button(`${escape(candidate.id)}안 자세히 보기`,'select-candidate',{className:'button',data:dataFor(bay,candidate,'candidate'),disabled:!row})}</td></tr>`;
      }).join('')}</tbody></table></section>`;
    }).join('')}</div></details><p class="disclaimer">점포 전체가 아닌 대상 24 SKU의 가상 예상입니다. 대표 방문은 전체 고객이나 실제 동시성을 뜻하지 않습니다. 소셜 신호·행사·수요는 합성 가정이며 전국 GS25 데이터를 수집한 결과가 아닙니다.</p>`;
}
function candidate(vm) {
  if(!vm.bay||!vm.candidate)return emptySelection();
  const result=selectedResult(vm), comparison=findResult(vm), moved=changes(vm);
  const approved=vm.approval?.storeId===vm.store?.id&&vm.approval?.bayId===vm.bay.id&&vm.approval?.candidateId===vm.candidate.id;
  return `<div class="breadcrumb">${button('전체 비교 전광판','navigate',{className:'text-button',data:{route:'board'}})}<span>/</span><span>옵션 ${escape(vm.candidate.id)}</span></div>${titleTags(vm)}${heading('CANDIDATE '+vm.candidate.id,escape(vm.candidate.name),escape(vm.candidate.description),approved?badge('매니저 승인됨','positive'):badge('승인 전 · 점주에게 비공개'))}
    <div class="candidate-main"><section class="world-detail-panel"><div class="panel-heading"><h2>같은 기록으로 보는 진열과 구매</h2><span class="mono">RECORDED VISITS · 대표 재생</span></div><div id="world-detail" class="world-detail" aria-label="선택 후보 3D 시뮬레이션"><div class="world-placeholder"><span class="loading-ring"></span><p>계산된 방문 기록을 연결하고 있습니다.</p></div></div><div class="model-seam">30일 예상과 같은 계산 기록에서 대표 방문을 재생합니다. 동선·체류시간은 시각화이며 구매 결과나 재고를 다시 계산하지 않습니다.</div></section><aside class="candidate-impact"><span class="eyebrow">30일 최종 예상 · 현재 진열 대비</span><div class="impact-number ${tone(result?.deltaPercent)}">${result?percent(result.deltaPercent):'계산 전'}</div><p class="micro">대상 24 SKU · 실제 관측 매출·보장치가 아닙니다.</p><dl><div><dt>현재 진열 예상</dt><dd>${money(comparison?.baseline?.revenue)} <small>천원</small></dd></div><div><dt>선택안 예상</dt><dd>${money(result?.revenue)} <small>천원</small></dd></div><div><dt>예상 매출총이익</dt><dd>${money(result?.profit)} <small>천원</small></dd></div><div><dt>품절 수요 비율</dt><dd>${result?number(result.stockoutRate*100)+'%':'—'}</dd></div></dl><div class="workload"><span>점주 작업 부담</span><strong>약 ${number(vm.candidate.minutes)}분</strong><p>${vm.candidate.orderSkus?.length?`추가 발주 검토 ${vm.candidate.orderSkus.length} SKU · 자동 발주 없음`:'기존 보유 재고 재배치 · 추가 발주 없음'}</p></div>${button(approved?'안내 문구 확인·다시 승인':'이 옵션으로 간다','open-approval',{className:'button primary wide',disabled:!result||vm.busy})}</aside></div>${stockWarnings(vm)}${assumptions(vm)}
    <div class="section-heading"><h2>정확히 어디를 바꾸나요?</h2><span class="mono muted">${moved.length} SKU · 단·열·이웃 반영</span></div><div class="shelf-comparison">${shelf(vm,true)}${shelf(vm)}</div>${evidence(vm,true)}`;
}
function approvalDialog(vm) {
  const result=selectedResult(vm);
  return `<div class="dialog-backdrop"><section class="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title"><div class="dialog-heading"><div>${small('MANAGER APPROVAL')}<h2 id="approval-title">점주에게 제안하기 전에, 한 번 더</h2></div>${button('닫기','close-approval',{className:'text-button'})}</div><div class="dialog-content">${titleTags(vm)}<h3>옵션 ${escape(vm.candidate?.id)} · ${escape(vm.candidate?.name)}</h3><div class="approval-facts"><div>${small('30일 현재 진열 대비')}<strong class="${tone(result?.deltaPercent)}">${result?percent(result.deltaPercent):'계산 전'}</strong></div><div>${small('작업 부담')}<strong>약 ${number(vm.candidate?.minutes)}분</strong></div><div>${small('발주 조건')}<strong>${vm.candidate?.orderSkus?.length?`${vm.candidate.orderSkus.length} SKU 검토`:'추가 발주 없음'}</strong></div></div><label class="field-label" for="approval-message">점주 안내 문자 초안 <span>수정 가능 · 실제 발송하지 않음</span></label><textarea id="approval-message" rows="7" maxlength="2000" required>${escape(vm.messageDraft)}</textarea><p class="micro">승인된 이 점포·매대·후보와 안내 문구만 점주 데모 화면에 표시됩니다. 실제 문자 발송이나 계정 간 전송은 하지 않습니다.</p>${vm.error?`<div class="error-banner" role="alert">${escape(vm.error)}</div>`:''}</div><div class="dialog-footer">${button('승인하고 점주 화면에 올리기','approve',{className:'button primary',disabled:!result})}${button('보류','close-approval')}<span class="micro">예상치는 확인된 인과효과가 아닙니다.</span></div></section></div>`;
}
function owner(vm) {
  if(!vm.approval)return heading('STORE · MANAGER PROPOSAL','아직 승인된 제안이 없습니다','매니저가 승인하기 전 후보와 예상치는 점주 화면에 나타나지 않습니다.')+`<div class="empty owner-empty"><span class="empty-icon">▤</span><h2>매니저의 검토를 기다리고 있어요</h2><p>여러 후보 중 승인한 한 가지 안만 이곳에 전달됩니다.</p>${button('데모 · 매니저에게 돌아가기','role-manager',{className:'button primary'})}</div>`;
  if(!vm.candidate||vm.approval.candidateId!==vm.candidate.id||vm.approval.bayId!==vm.bay?.id||vm.approval.storeId!==vm.store?.id) return `<div class="error-banner" role="alert">승인한 점포·매대·후보를 불러오지 못했습니다. 다른 후보는 표시하지 않습니다.</div>`;
  const result=vm.approval.result ?? selectedResult(vm), response={...vm.response,photoName:vm.photo?.fileName ?? vm.response?.photoName,photoUrl:vm.photo?.photoUrl ?? vm.response?.photoUrl};
  const statuses={accepted:'수용',partial:'부분 실행',declined:'실행 어려움'};
  const safePhoto=typeof response?.photoUrl==='string'&&response.photoUrl.startsWith('blob:')?response.photoUrl:'';
  return `${titleTags(vm)}${heading('APPROVED PROPOSAL',escape(vm.candidate.name),'사장님이 가능한 범위에서 선택해 주세요. 일부만 실행하거나 어렵다고 알려주셔도 괜찮습니다.',badge('매니저 승인됨','positive'))}<div class="owner-burden">${badge('약 '+vm.candidate.minutes+'분')}${badge(vm.candidate.orderSkus.length?'추가 발주 검토 '+vm.candidate.orderSkus.length+' SKU':'새로 시킬 물건 없음')}${badge('자동 발주 없음')}</div><div class="owner-instructions"><div class="owner-photo">${referencePhoto({compact:true})}</div><div class="owner-diagrams">${shelf(vm)}<details class="current-shelf"><summary>현재 진열과 비교하기</summary>${shelf(vm,true)}</details><div class="approved-message"><h3>매니저의 안내</h3><p>${escape(vm.approval.message)}</p></div></div></div>${stockWarnings(vm)}${evidence(vm,true)}<div class="callout forecast-callout"><strong>승인 당시 · 대상 24 SKU의 30일 가상 매출</strong><p>현재 진열 대비 <span class="mono ${tone(result?.deltaPercent)}">${result?percent(result.deltaPercent):'—'}</span>로 계산됐습니다. 실제 관측 실적이나 점포 전체 매출이 아니며, 매출 증가를 보장하지 않습니다.</p></div><section class="response-panel"><div class="section-heading"><div><h2>어떻게 진행하셨나요?</h2><p>회신과 사진은 접수만 합니다. 실행 여부를 자동으로 판독하지 않습니다.</p></div>${response?.status?badge(statuses[response.status]??'회신됨','positive'):badge('회신 대기')}</div><label class="field-label" for="owner-note">사장님 의견 <span>선택 사항</span></label><textarea id="owner-note" rows="3" maxlength="1000" placeholder="예: 공간이 부족해서 2단만 옮겼어요. 나머지는 주말에 검토할게요.">${escape(response?.note ?? '')}</textarea><div class="response-actions">${button('제안대로 했어요','respond',{className:`button ${response?.status==='accepted'?'primary':''}`,data:{status:'accepted'}})}${button('일부만 했어요','respond',{className:`button ${response?.status==='partial'?'primary':''}`,data:{status:'partial'}})}${button('이건 어려워요','respond',{className:`button ${response?.status==='declined'?'primary':''}`,data:{status:'declined'}})}</div><div class="photo-upload"><div><h3>${response?.photoName?'사진 접수됨':'사진 한 장을 남겨 주세요'}</h3><p>${response?.photoName?escape(response.photoName):'수용 또는 부분 실행으로 회신한 뒤 사진을 선택해 주세요. JPEG · PNG · WebP, 최대 5 MB.'}</p></div><input class="visually-hidden" id="photo-file" type="file" accept="image/jpeg,image/png,image/webp" aria-label="점주 사진 파일 선택">${button(response?.photoName?'다른 사진 선택':'사진 선택·접수','upload-photo',{className:'button primary',disabled:!['accepted','partial'].includes(response.status)})}</div><div id="photo-preview">${safePhoto?`<img class="upload-preview" src="${escape(safePhoto)}" alt="점주가 접수한 사진 미리보기">`:''}</div><p class="micro">사진은 이 페이지의 메모리에만 보관됩니다. 새로고침하면 사진과 미리보기가 사라집니다. 실제 서버에 업로드하거나 진열 실행을 검증하지 않습니다.</p><div class="observation-plan"><strong>다음 4주, 이렇게 같이 살펴봐요.</strong><span>회전·품절·작업 부담과 주변 행사를 함께 기록하고, 진열 외 다른 설명도 확인합니다.</span></div></section><div class="action-bar"><p>사진 접수는 진열 변경 완료의 증거가 아닙니다.</p>${button('매니저 화면에서 회신 보기','role-manager',{className:'button primary'})}</div>`;
}
function review(vm) {
  const review=vm.review??{}, counters=review.counters??review;
  const proposed=counters.proposed??counters.proposals??vm.bays.length;
  const approved=counters.approved??(vm.approval?1:0);
  const responded=counters.responded??counters.responses??(vm.response?.status?1:0);
  const photos=counters.photos??counters.photosReceived??(vm.response?.photoName?1:0);
  const rows=review.rows??vm.bays.map(bay=>({bay,store:storeOf(vm,bay),approval:vm.approval?.storeId===bay.storeId&&vm.approval?.bayId===bay.id?vm.approval:null,response:vm.approval?.storeId===bay.storeId&&vm.approval?.bayId===bay.id?vm.response:null}));
  return heading('FOLLOW-UP · 4 WEEKS','제안의 끝은 실행이 아니라, 다음 판단','현재 데모의 승인·회신 집계와 별도로, 4주 후 합성 관찰 사례를 구분합니다.')+
    `<section class="review-funnel">${metric('제안한 매대',proposed,` / ${proposed}`,`분모 ${proposed}개 매대 고정`)}<span class="funnel-arrow">→</span>${metric('매니저 승인',approved,` / ${proposed}`,`${number(proposed?approved/proposed*100:0)}% · 실제 데모 선택`)}<span class="funnel-arrow">→</span>${metric('점주 회신',responded,` / ${proposed}`,`사진 접수 ${photos}건 · 실행 검증 아님`)}</section>
    <div class="section-heading"><h2>승인과 회신이 어디까지 이어졌나요?</h2><span class="mono muted">같은 브라우저의 데모 기록</span></div><div class="review-list">${rows.map(row=>{
      const bay=row.bay??vm.bays.find(b=>b.id===row.bayId&&b.storeId===row.storeId), store=row.store??storeOf(vm,bay), approval=row.approval, response=row.response;
      const result=approval?.result;
      return `<article class="review-card"><div class="review-card-head"><div>${badge(store?.name??row.storeName??'점포','solid')}<h3>${escape(bay?.name??row.bayName??'매대')}</h3><span class="mono muted">${escape(bay?.id??row.bayId)}</span></div>${badge(!approval?'승인 대기':!response?.status?'회신 없음':response.status==='declined'?'실행 어려움':response.status==='partial'?'부분 실행 회신':'수용 회신',approval&&!response?.status?'negative':'')}</div><div class="review-card-body"><div>${small('승인 당시 · 30일 가상 예상')}<strong class="review-value">${result?percent(result.deltaPercent):'—'}</strong><p>${approval?`옵션 ${escape(approval.candidateId)} · 현재 진열 대비`:'승인한 후보 없음'}</p></div><div>${small('현재 데모의 실제 상태')}<strong class="review-value">${row.photo?.fileName||response?.photoName?'사진 접수됨':response?.status?'회신 접수됨':approval?'회신 대기':'검토 대기'}</strong><p>4주 관찰치 없음 · 실행 여부 자동 검증 안 함</p></div><div class="review-comment"><strong>${row.photo?.fileName||response?.photoName?'사진 접수됨 · 실행 검증 아님':response?.status?'점주 회신':'다음 지원을 결정하기 전'}</strong><p>${escape(response?.note||(!approval?'담당 매니저의 검토를 기다립니다.':'회신을 먼저 확인하고 작업 시간·인력·발주 여건을 살펴보세요.'))}</p></div></div></article>`;
    }).join('')}</div>${syntheticCases(vm)}<div class="section-heading"><h2>본사에 올라가는 다음 판단</h2><span class="micro">작은 표본으로 전국 확대를 확정하지 않습니다</span></div><div class="next-decisions"><article>${small('지침 후보')}<h3>좋은 사례는 지침의 검토 안건으로</h3><p>관찰된 변화만으로 진열 효과를 단정하지 않고, 다음 주기에 같은 조건의 매대를 더 비교합니다.</p></article><article>${small('현장 지원')}<h3>어려웠던 제안에는 사람과 시간을</h3><p>부분 실행·거절·미회신의 이유를 먼저 듣고, 인력과 작업 부담을 줄일 방법을 찾습니다.</p></article><article>${small('수단 재검토')}<h3>품절이 원인이면 발주 가설을 함께</h3><p>진열만으로 설명되지 않는 부진은 재고·행사·상권 변화 등 다른 원인과 구분합니다.</p></article></div><div class="disclaimer"><strong>세 수치는 기준과 시점이 다릅니다.</strong> 전년 동기비는 작성된 점포 실적, 30일 예상은 가상 집계 계산, 4주 후 관찰은 별도의 합성 사례입니다. 사진 접수는 실제 실행 검증이 아니며 어느 수치도 제품의 인과적 효과를 뜻하지 않습니다.</div>`;
}
function syntheticCases(vm) {
  const cases=vm.review?.cases??[];
  if(!cases.length)return '';
  return `<section class="synthetic-cases"><div class="section-heading"><div>${small('HYPOTHETICAL FOLLOW-UP · 별도 작성 사례')}<h2>4주 후라면, 어떤 지원이 필요할까요?</h2><p>아래는 현재 승인·회신과 관계없는 합성 시나리오입니다. 위 퍼널이나 현재 성과에 포함하지 않습니다.</p></div>${badge('관찰 예시 · 실제 발생 아님','synthetic')}</div><div class="synthetic-case-grid">${cases.map(row=>{
    const store=vm.stores.find(item=>item.id===row.storeId),before=row.yoyBefore??row.beforeYoy,after=row.yoyAfter??row.afterYoy;
    return `<article class="synthetic-case"><div>${badge(row.headline??'합성 사례',row.status==='improved'?'positive':row.status==='no-reply'?'negative':'')}<span>${escape(store?.name)}</span></div><span class="eyebrow">4주 후 합성 관찰 · 전년 동기비</span><strong class="review-value ${after!=null?tone(after):''}">${after!=null?`${percent(before)} → ${percent(after)}`:'관찰치 없음'}</strong><p>${escape(row.explanation??row.reason)}</p></article>`;
  }).join('')}</div></section>`;
}
function emptySelection() {return `<div class="empty"><h1>선택한 매대를 찾지 못했습니다.</h1><p>목록에서 점포와 매대를 다시 선택해 주세요.</p>${button('매대 목록으로','navigate',{className:'button primary',data:{route:'bays'}})}</div>`;}

export function renderApp(vm) {
  const safe={stores:[],bays:[],results:{},...vm};
  if(safe.route==='login')return login(safe);
  const views={home,bays,bay,board,candidate,owner,review};
  return shell(safe,(views[safe.route]??home)(safe));
}
