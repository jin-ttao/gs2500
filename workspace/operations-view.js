import {icon,escapeHtml as e,revenueChart} from './ui.js';
import {cardGradient,cardTexture} from './obolus-surfaces.js';

// Ported from the team's Obolus repository: Memory.tsx's store/account hub,
// Dashboard.tsx's editorial marketplace, Archive.tsx's evidence rows, and
// components/ui/{button,primitives}.tsx. Domain data and actions stay in GS2500.

const won=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('ko-KR')+'원':'—';
const count=value=>Number(value??0).toLocaleString('ko-KR');
const labels={stockout:'품절·보충',placement:'진열 변경',event:'지역 행사',weather:'날씨',trend:'상품 트렌드',other:'현장 메모'};
const icons={stockout:'box',placement:'layers',event:'festival',weather:'weather',trend:'sparkles',other:'history'};
const btn=(label,action,data={},className='button')=>`<button type="button" class="${className} ob-button" data-action="${action}" ${Object.entries(data).map(([k,v])=>`data-${k}="${e(v)}"`).join(' ')}>${label}</button>`;
const tag=(text,kind='')=>`<span class="badge ob-badge ${kind}">${e(text)}</span>`;
const source=row=>row.synthetic||row.source==='synthetic'||row.source==='seed'?'합성 관찰 예시':'사용자 확인 기록';
const pair=row=>row.effect?.percent??row.effect?.changePercent??row.effect?.deltaPercent??(row.revenueBefore>0&&row.revenueAfter!=null?(row.revenueAfter/row.revenueBefore-1)*100:null);
const hasRevenuePair=row=>[row.revenueBefore,row.revenueAfter].every(value=>typeof value==='number'&&Number.isFinite(value));
const difference=row=>hasRevenuePair(row)?row.revenueAfter-row.revenueBefore:null;
const comparisonLabel=row=>row.comparableDays!=null?`각 ${count(row.comparableDays)}일 · 인과효과 아님`:'비교 기간 미확인 · 인과효과 아님';
function observationLocation(row){
  if(!row.level)return '';
  const coordinates=`${e(row.level)}단 ${e(row.column??'—')}열`;
  if(row.positionConfirmed)return ` · ${coordinates} · ${row.synthetic?'합성 위치 예시':'직접 확인한 위치'}`;
  return ` · 기준안 ${coordinates} · 현장 위치 미확인`;
}
function recommendationLocation(row){
  if(!row?.target)return {label:'점포 전체 · 위치 미지정',status:'상품·현장 위치 확인 필요'};
  const target=row.target,label=`${target.fixtureName??'행사 매대'} · ${target.level}단 ${target.column}열`;
  const observed=['observed-location','observed-trial'].includes(target.scenario);
  const status=observed?(row.userEvidenceCount?'사용자 위치 기록 기반 · 재검증 필요':'합성 위치 예시 기반 · 현장 미확인'):'기준안·후보 위치 · 현장 미확인';
  return {label,status};
}
const date=value=>String(value??'').slice(5).replace('-','.');
const selectStore=vm=>`<label class="ops-store-select">${icon('store')}<span class="visually-hidden">운영 점포 선택</span><select id="operations-store" aria-label="운영 점포 선택">${vm.stores.map(s=>`<option value="${e(s.id)}" ${s.id===vm.store.id?'selected':''}>${e(s.name)}</option>`).join('')}</select></label>`;

// Memory.tsx:375–441 — a single store hub, not four competing page headers.
function toolbar(vm,subtitle){
  const tabs=[['home','운영 개요'],['operations','운영 이슈'],['recommendations','다음 추천'],['evidence','사진·관찰']];
  return `<header class="ob-page-header"><div class="ob-page-identity"><span class="ob-page-avatar">${icon('store',{size:22})}</span><div class="ob-page-copy"><span class="ob-eyebrow">STORE OPERATIONS / ${e(vm.store.id)}</span><h1>${e(vm.store.name)}</h1><p>${subtitle}</p></div></div><div class="ops-toolbar-actions">${selectStore(vm)}${btn(icon('plus')+' 관찰 기록','open-observation',{},'button primary')}</div></header>
    <nav class="ob-tabs" aria-label="점포 운영 화면">${tabs.map(([route,title])=>`<button type="button" class="ob-tab ${vm.route===route?'active':''}" data-action="navigate" data-route="${route}" ${vm.route===route?'aria-current="page"':''}>${title}</button>`).join('')}</nav>`;
}

// primitives.tsx:239 — quiet rectangular filter chips, with a real pressed state.
function chips(items,selected,action,label){return `<div class="ob-chips" role="group" aria-label="${e(label)}">${items.map(item=>`<button type="button" class="ob-chip ${String(item.value)===String(selected)?'active':''}" data-action="${action}" data-value="${e(item.value)}" aria-pressed="${String(item.value)===String(selected)}">${e(item.label)}</button>`).join('')}</div>`;}
function range(vm){return chips([{value:7,label:'7일'},{value:14,label:'14일'},{value:28,label:'28일'}],vm.opsRange??14,'ops-range','매출 조회 기간');}
function scopeNote(){return `<p class="ops-source-note ob-source-note">${icon('alert',{size:14})} 합성 매출과 사용자 확인 기록을 구분합니다. 사진 자동 판독·JEV·실제 POS는 연결하지 않았습니다.</p>`;}
function banner(title,description,kind='alert'){return `<aside class="ob-banner">${icon(kind)}<div><strong>${title}</strong><p>${description}</p></div></aside>`;}
function sectionHeading(title,description,action=''){return `<div class="ob-section-heading"><div><h2>${title}</h2>${description?`<p>${description}</p>`:''}</div>${action}</div>`;}
function stat(label,value,detail,trend){return `<article class="ob-stat"><h3>${label}</h3><strong>${value}</strong><p>${detail}</p>${trend?`<small>${trend}</small>`:''}</article>`;}

function impactOf(row){
  const delta=pair(row),amount=difference(row);
  if(delta!=null)return `<strong class="${delta>=0?'positive':'negative'}">${delta>0?'+':''}${Number(delta).toFixed(1)}%</strong><small>입력된 전후 변화</small>`;
  if(amount!=null)return `<strong class="${amount>=0?'positive':'negative'}">${amount>0?'+':''}${won(amount)}</strong><small>입력 금액 차이 · 비율 계산 불가</small>`;
  return `<strong>${row.stockoutMinutes!=null?`${count(row.stockoutMinutes)}분`:'관찰 중'}</strong><small>${row.stockoutMinutes!=null?'기록된 품절 시간':'매출 영향 미확정'}</small>`;
}

function revenuePair(row){return hasRevenuePair(row)?`<p class="ops-record-pair">${won(row.revenueBefore)} → ${won(row.revenueAfter)}<small>직접 입력한 전후 금액 · ${e(comparisonLabel(row))}${row.revenueBefore===0?' · 기준 매출 0원으로 비율 계산 불가':''}</small></p>`:'';}

// Archive.tsx:197–278 + Transactions.tsx:418–480. Native details retain
// keyboard/expanded semantics without adding a second controller state machine.
function eventRow(row){
  const title=row.title??labels[row.issueType]??'운영 기록',url=row.photo?.reference?.startsWith('blob:')?row.photo.reference:null;
  return `<article class="ob-record"><details class="ob-record-disclosure" data-ui-key="record-${e(row.id??`${row.date}:${row.productId}:${row.issueType}`)}"><summary class="ob-record-summary">
      <span class="ob-record-date"><time datetime="${e(row.date)}">${e(date(row.date))}</time><small>${e(labels[row.issueType]??'운영 기록')}</small></span>
      <span class="ob-record-heading"><span class="ob-record-title">${icon(icons[row.issueType]??'history',{size:15})}<strong>${e(title)}</strong>${tag(source(row),row.synthetic?'synthetic':'')}</span><span class="ob-record-excerpt">${e(row.note??row.description??'현장에서 확인할 관찰입니다.')}</span><small>${e(row.productName??row.productId??'점포 운영')}${observationLocation(row)}${url?' · 사진 첨부':''}</small></span>
      <span class="ob-record-impact">${impactOf(row)}</span>${icon('chevron-down',{size:16})}
    </summary><div class="ob-record-detail"><div class="ob-detail-grid"><div><span class="ob-eyebrow">확인한 사실</span><p>${e(row.note??row.description??'기록 없음')}</p></div><div><span class="ob-eyebrow">기록 출처</span><p>${source(row)} · ${e(row.date)}</p><p class="micro">${row.synthetic?'실제 매장의 관측 성과가 아닌 합성 사례입니다.':'사용자가 직접 입력한 기록이며 POS로 확인한 수치는 아닙니다.'}</p></div><div><span class="ob-eyebrow">상품과 위치</span><p>${e(row.productName??row.productId??'점포 전체')}${observationLocation(row)||' · 위치 미지정'}</p></div><div><span class="ob-eyebrow">비교 조건</span><p>${hasRevenuePair(row)?e(comparisonLabel(row)):'매출 영향 미확정 · 인과효과 아님'}</p>${row.confounders?.length?`<p class="micro">함께 달라진 조건: ${row.confounders.map(e).join(' · ')}</p>`:''}</div></div>
      ${revenuePair(row)}${url?`<figure class="ob-detail-photo"><img src="${e(url)}" alt="${e(row.photo.name??'현장 사진')}"><figcaption>사용자 사진 · 자동 판독 안 함</figcaption></figure>`:''}
    </div></details></article>`;
}

function shelfDiagram(row){
  if(!row.target)return `<div class="ob-store-symbol" aria-hidden="true">${icon(icons[row.issueType]??'store',{size:58})}</div>`;
  return `<div class="ob-shelf-diagram" aria-label="추천 위치 도식: ${e(row.target.level)}단 ${e(row.target.column)}열">${[4,3,2,1].map(level=>`<div class="ob-shelf-row"><span>${level}</span>${[1,2,3,4,5,6].map(column=>`<i class="ob-shelf-cell ${Number(row.target.level)===level&&Number(row.target.column)===column?'active':''}" aria-hidden="true"></i>`).join('')}</div>`).join('')}</div>`;
}

// Dashboard.tsx:679–825 — 16:10 visual, compact editorial body, factual footer.
function recommendation(row,index=0){
  const location=recommendationLocation(row),seed=`${row.storeId}:${row.productId??row.issueType}:${row.type}`;
  return `<article class="ob-market-card"><div class="ob-market-cover" style="background:${e(cardGradient(seed,'deep'))}"><div class="ob-cover-texture" aria-hidden="true" style="background-image:${e(cardTexture(seed))}"></div><div class="ob-cover-top"><span>${icon(row.type==='restock'?'box':'layers',{size:15})} ${e(labels[row.issueType]??'운영 제안')}</span>${tag(row.confidence??'관찰 부족')}</div>${shelfDiagram(row)}<div class="ob-cover-caption"><strong>${e(row.productName??'점포 운영')}</strong><small>${row.target?'위치 설명 도식 · 실제 배치도 아님':'점포 전체 · 위치 미지정'}</small></div></div>
    <div class="ob-market-body"><div class="ob-market-meta"><span>제안 ${String(index+1).padStart(2,'0')}</span><span>·</span><span>${count(row.evidenceCount)}건의 근거</span></div><h3 class="ob-market-title">${e(row.title)}</h3><p class="ob-market-description">${e(row.description)}</p><div class="ob-market-location">${icon('layers',{size:14})}<span>${e(location.label)}<small>${e(location.status)}</small></span></div>
      <div class="ob-market-footer"><span>직접 기록 ${count(row.userEvidenceCount)}건</span><span>${e(row.confidence??'관찰 부족')}</span></div>
      <details class="ob-rec-details" data-ui-key="recommendation-${e(row.type)}-${e(row.productId??row.issueType)}"><summary>왜 이 제안인가요? ${icon('chevron-down',{size:14})}</summary><div class="ob-rec-detail-content"><ul>${(row.reasons??[]).map(reason=>`<li>${e(reason)}</li>`).join('')}</ul><div class="ops-observation-plan"><strong>다음에 확인할 것</strong><p>${e(row.nextMeasurement)}</p></div>${row.confounders?.length?`<p class="micro">함께 확인: ${row.confounders.map(e).join(' · ')}. 이 변화만으로 진열 효과를 확정하지 않습니다.</p>`:''}</div></details>
      <div class="ob-market-actions">${btn('기존 진열안 참고 '+icon('arrow-up-right',{size:14}),'select-bay',{store:row.storeId??'',bay:row.bayId??''},'text-button')}${btn('실행·결과 기록','open-observation',{product:row.productId??'',type:row.issueType??(row.type==='restock'?'stockout':'placement'),'suggested-level':row.target?.level??'','suggested-column':row.target?.column??'','suggested-title':row.title},'button primary')}</div>
    </div></article>`;
}

function loopStrip(vm){
  const o=vm.operations??{},records=vm.route==='evidence'?(vm.observationRecords??o.issues??[]):o.issues??[],photos=records.filter(r=>!r.synthetic&&r.photo).length;
  const stages=[['camera','현장 기록',`${photos}장 직접 접수`],['chart','변화 확인','매출·이슈 함께 비교'],['sparkles','다음 제안','위치·재고·작업 제안'],['history','다시 관찰','기록에 따라 근거 갱신']];
  return `<section class="ob-loop" aria-label="운영 개선 순환">${stages.map(([symbol,title,detail],index)=>`<div class="ob-loop-step"><span class="ob-loop-number">0${index+1}</span>${icon(symbol,{size:16})}<div><strong>${title}</strong><small>${e(detail)}</small></div></div>`).join('')}</section>`;
}

function storeVisual(vm){
  const records=vm.observationRecords??vm.operations?.issues??[],own=records.find(row=>row.photo?.reference?.startsWith('blob:')),url=own?.photo?.reference;
  return `<figure class="ob-store-visual"><div class="ob-store-image"><img src="${url?e(url):'/workspace/assets/bay-reference.jpg'}" alt="${url?'직접 기록한 현장 사진':'합성 진열 설명용 참고 사진'}"><span class="ob-visual-label">${url?'사용자 사진 · 자동 판독 안 함':'참고 사진 · 현재 점포 촬영 아님'}</span></div><figcaption class="ob-visual-caption"><div><span class="ob-eyebrow">${url?'LATEST OBSERVATION':'STORE REFERENCE'}</span><strong>${e(vm.store.name)} · ${e(vm.bay.name)}</strong><p>${url?'첨부한 사진은 이 페이지가 열려 있는 동안만 보관합니다.':'사진과 사람이 확인한 사실을 연결합니다. 사진만으로 매출이나 배치를 추정하지 않습니다.'}</p></div>${btn(icon('plus',{size:15})+' 사진과 관찰 남기기','open-observation',{},'text-button')}</figcaption></figure>`;
}

function simulationEntry(vm){
  const ready=vm.results?.[`${vm.store.id}:${vm.bay.id}`]?.completed;
  const action=ready||vm.busy?'navigate':'run-all';
  return `<section class="simulation-entry" aria-label="30일 진열 시뮬레이션"><div class="simulation-entry-icon">${icon('layers',{size:24})}</div><div><span class="ob-eyebrow">NEXT · LOCAL SIMULATION</span><h2>${ready?'준비된 30일 비교로 이어가세요.':'이 진열을 30일 운영하면 어떨까요?'}</h2><p>4점포 × 현재안·후보 3개 · 0원부터 누적 예상과 3D를 함께 봅니다.</p><small>24 SKU 합성 모형 · 운영 차트와 별도 · 위 추천 좌표의 자동 반영 아님</small></div>${btn(vm.busy?'계산 진행 보기':ready?'비교 이어보기':'30일 시뮬레이션 시작',action,action==='navigate'?{route:'board'}:{},'button primary')}</section>`;
}

function suggestedObservation(d){
  if(!d.suggestedTitle)return '';
  return `<aside class="ob-banner observation-reference"><div><strong>이번에 확인할 제안: ${e(d.suggestedTitle)}</strong><p>${d.suggestedLevel&&d.suggestedColumn?`제안 위치 ${e(d.suggestedLevel)}단 ${e(d.suggestedColumn)}열 · `:''}아직 현장에서 확인한 위치가 아닙니다. 실제로 확인한 단·열은 아래에서 직접 선택하세요.</p></div></aside>`;
}

export function renderOperationsOverview(vm){
  const o=vm.operations??{},series=o.series??[],issues=o.issues??[],recommendations=o.recommendations??[];
  const total=o.summary?.revenue??series.reduce((n,row)=>n+(row.revenue??0),0),delta=o.summary?.completeComparison?o.summary.revenueDeltaPercent:null;
  const direct=issues.filter(row=>!row.synthetic).length,rec=recommendations[0],location=recommendationLocation(rec);
  return `<div class="ops-page ob-workspace">${toolbar(vm,'사진, 운영 기록, 다음 실행을 한곳에서 관리합니다.')}
    <section class="ob-overview-hero">${storeVisual(vm)}<div class="ob-overview-copy"><span class="ob-eyebrow">THIS WEEK'S FOCUS · 이번에 먼저 확인할 것</span><h2 class="ob-focus-title">${e(rec?.title??'매장의 이야기를 모으고 있어요.')}</h2><p class="ob-lead">${e(rec?.description??'현장 기록을 남기면 다음 제안의 근거가 됩니다.')}</p><div class="ob-focus-location">${icon('layers',{size:16})}<span>${e(location.label)}<small>${e(location.status)}</small></span></div><div class="ob-hero-actions">${btn('추천 근거 자세히 '+icon('arrow-right',{size:15}),'navigate',{route:'recommendations'},'button primary')}${tag(`다음 실행 제안 ${count(recommendations.length)}개`)}${tag(rec?.confidence??'관찰 부족')}</div>
      <section class="ob-inline-stats" aria-label="점포 운영 지표">${stat('기간 결제매출',o.summary?.observedDays===0?'미수집':won(total),`${o.summary?.observedDays??series.length}/${vm.opsRange??14}일 기록 · 합성 점포 전체 매출`,delta!=null?`${delta>=0?'+':''}${delta.toFixed(1)}% · 이전 동기간`:null)}${stat('운영 이슈',count(issues.length)+'건','품절·날씨·행사·진열 기록')}${stat('직접 남긴 관찰',count(direct)+'건','사진·의견 · 사람이 확인한 기록')}</section><p class="ob-micro">전체 누적 기록 기반 · 규칙 기반 검토 제안 · 효과 보장 아님 · 자동 실행 없음</p>
    </div></section>
    ${simulationEntry(vm)}
    <section class="ob-chart-section">${sectionHeading('매출의 흐름, 그날의 맥락','단위 원 · 합성 매출 기록, 진열 효과를 분리한 수치가 아닙니다.',range(vm))}<div class="ops-chart">${revenueChart(series,{id:'operations-revenue',events:issues.map(row=>({date:row.date,title:row.title??labels[row.issueType],type:row.issueType})),label:'합성 점포 매출 추이'})}</div><div class="ops-chart-note">${icon('history',{size:15})} ${issues.length}개의 운영 기록을 매출 흐름과 함께 살펴보세요.${btn('이슈 보기 '+icon('arrow-right',{size:14}),'navigate',{route:'operations'},'text-button')}</div></section>
    <section class="ob-recent-section">${sectionHeading('최근 운영 기록','각 기록을 펼치면 확인한 사실과 비교 조건을 볼 수 있습니다.',btn('전체 보기 '+icon('arrow-up-right',{size:15}),'navigate',{route:'operations'},'text-button'))}<div class="ob-record-list">${issues.slice(0,4).map(eventRow).join('')||'<div class="ops-empty">선택한 기간에 기록이 없습니다.</div>'}</div></section>${loopStrip(vm)}${scopeNote()}
  </div>`;
}

export function renderOperationsHistory(vm){
  const o=vm.operations??{},issues=o.issues??[];
  return `<div class="ops-page ob-workspace">${toolbar(vm,'운영 이슈와 매출 변화의 근거를 같은 기록으로 남깁니다.')}${sectionHeading('운영 타임라인','사진, 상품 위치, 전후 금액을 펼쳐서 확인하세요.',`<span class="ob-eyebrow">${count(issues.length)}건 · ${e(o.period?.start??'')} — ${e(o.period?.end??'')}</span>`)}<div class="ob-filterbar">${chips([{value:'all',label:'전체'},...Object.entries(labels).map(([value,label])=>({value,label}))],vm.opsFilter??'all','ops-filter','운영 이슈 분류')}${range(vm)}</div><section class="ob-record-list" aria-label="운영 기록">${issues.map(eventRow).join('')||'<div class="ops-empty">이 조건의 기록이 없습니다. 다른 분류를 선택하거나 관찰을 남겨주세요.</div>'}</section>${banner('같이 일어났다는 것과 원인이라는 것은 다릅니다.','행사·가격·품절·날씨가 겹쳤다면 진열 효과로 단정하지 않고 다음 비교 조건에 남깁니다.')}${scopeNote()}</div>`;
}

export function renderRecommendations(vm){
  const rows=vm.operations?.recommendations??[];
  return `<div class="ops-page ob-workspace">${toolbar(vm,'관찰에서 출발해, 작은 실행과 다음 검증으로 이어갑니다.')}${sectionHeading('다음 실행 제안','최고 매출을 보장하는 정답이 아니라, 다음에 검증할 가장 구체적인 행동.',`<span class="ob-eyebrow">${count(rows.length)}개 제안 · 근거 우선순위</span>`)}<p class="ob-source-note">이 점포의 전체 누적 기록을 바탕으로 정렬한 추천입니다. 매출 그래프의 7·14·28일 조회 기간과는 범위가 다릅니다.</p><div class="ob-market-grid">${rows.map((row,index)=>recommendation({...row,storeId:vm.store.id,bayId:vm.bay.id},index)).join('')||'<div class="ops-empty">기록을 더 모으면 검토할 제안이 이곳에 나타납니다.</div>'}</div>
    ${simulationEntry(vm)}
    ${banner('추천의 관찰 근거와 시뮬레이션은 구분합니다.','기존 진열안 비교는 별도 계산입니다. 이 추천 좌표를 반영한 계산은 아직 없습니다. 관찰 저장은 추천의 근거를 갱신하며, 시뮬레이션 후보를 바꾸지는 않습니다.','layers')}
    <section class="ob-learning-note">${sectionHeading('이 매장에서 쌓이는 운영 기억','확인된 상품 위치, 품절 경험, 실행 부담과 전후 기록을 점포별로 묶습니다.',tag('학습 준비 · 모델 학습 미실행'))}<p>현재는 설명 가능한 규칙으로 다음 제안을 갱신하며, 사진 자동 인식이나 효과를 학습한 예측 모델은 연결하지 않았습니다.</p>${btn('사진·관찰 기록 보기 '+icon('arrow-right',{size:14}),'navigate',{route:'evidence'},'text-button')}</section>${scopeNote()}</div>`;
}

export function renderEvidence(vm){
  const rows=(vm.observationRecords??vm.operations?.issues??[]).filter(row=>!row.synthetic);
  return `<div class="ops-page ob-workspace">${toolbar(vm,'직접 남긴 사진과 관찰이 이 매장의 운영 기억이 됩니다.')}${sectionHeading('사진·관찰 기록','직접 남긴 관찰만 모았습니다. 참고 사진과 합성 사례는 이 기록에 포함하지 않습니다.',`<span class="ob-eyebrow">${count(rows.length)}건 · 사용자 확인 기록</span>`)}
    <section class="ob-memory-list">${rows.length?rows.map(row=>`<article class="ob-memory-entry"><div class="ob-memory-visual">${row.photo?.reference?.startsWith('blob:')?`<img class="ops-memory-photo" src="${e(row.photo.reference)}" alt="${e(row.photo.name)}">`:`<div class="ob-memory-placeholder">${icon('history',{size:24})}<span>사진 없이 남긴 현장 기록</span></div>`}</div><div class="ob-memory-copy"><div class="ob-market-meta">${tag(labels[row.issueType]??'현장 메모')}<time datetime="${e(row.date)}">${e(row.date)}</time><span>${source(row)}</span></div><h3>${e(row.productName??row.productId??'점포 관찰')}</h3><p>${e(row.note)}</p><small>${observationLocation(row).replace(/^ · /,'')||'점포 전체 · 위치 미지정'}</small>${revenuePair(row)}${row.confounders?.length?`<p class="ob-micro">함께 달라진 조건: ${row.confounders.map(e).join(' · ')}</p>`:''}</div></article>`).join(''):`<div class="ops-empty ob-empty">${icon('camera',{size:32})}<h2>아직 직접 남긴 기록이 없어요.</h2><p>사진과 함께 상품 위치나 운영 이슈를 확인해 주세요.</p>${btn('첫 관찰 남기기','open-observation',{},'button primary')}</div>`}</section>
    ${loopStrip(vm)}<p class="ops-source-note ob-source-note">사진과 관찰은 현재 브라우저 페이지의 메모리에만 보관합니다. 새로고침하면 사라지며 외부로 전송하지 않습니다.</p>${scopeNote()}</div>`;
}

export function renderObservationDialog(vm){const d=vm.observationDraft??{},photo=vm.observationPhoto;return `<div class="dialog-backdrop"><section class="approval-dialog ops-observation-dialog" role="dialog" aria-modal="true" aria-labelledby="observation-title"><div class="dialog-heading"><div><span class="eyebrow">NEW OBSERVATION · ${e(vm.store.name)}</span><h2 id="observation-title">현장의 변화를 남겨주세요.</h2></div>${btn(icon('x')+'<span class="visually-hidden">닫기</span>','close-observation',{},'text-button')}</div><form id="observation-form"><div class="dialog-content">${suggestedObservation(d)}<label class="ops-file-drop" for="observation-file">${photo?`<img src="${e(photo.url)}" alt="선택한 현장 사진 미리보기"><span>${e(photo.name)} · 다른 사진 선택</span>`:`${icon('camera',{size:28})}<strong>사진 선택하기</strong><span>선택 사항 · JPG, PNG, WebP · 최대 5 MB</span>`}<input id="observation-file" type="file" accept="image/jpeg,image/png,image/webp" class="visually-hidden"></label><p class="micro">사진은 자동 판독하지 않습니다. 아래에서 직접 확인한 사실을 입력해 주세요.</p><div class="ops-form-grid"><label class="ops-field">기록 날짜<input name="date" type="date" value="${e(d.date??'2026-09-22')}" required></label><label class="ops-field">운영 이슈<select name="issueType">${Object.entries(labels).map(([key,label])=>`<option value="${key}" ${d.issueType===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="ops-field">대상 상품<select name="productId"><option value="">점포 전체 / 상품 미지정</option>${vm.products.map(p=>`<option value="${e(p.id)}" ${d.productId===p.id?'selected':''}>${e(p.name)}</option>`).join('')}</select></label><label class="ops-field">품절 시간 (분, 선택)<input name="stockoutMinutes" type="number" min="0" max="1440" value="${e(d.stockoutMinutes??'')}" placeholder="예: 45"></label><label class="ops-field">확인한 선반 단<select name="level"><option value="">미확인</option>${[1,2,3,4].map(n=>`<option value="${n}" ${Number(d.level)===n?'selected':''}>${n}단</option>`).join('')}</select></label><label class="ops-field">확인한 열<select name="column"><option value="">미확인</option>${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${Number(d.column)===n?'selected':''}>${n}열</option>`).join('')}</select></label></div><label class="ops-field">확인한 사실<textarea name="note" required maxlength="1000" rows="3" placeholder="예: 점심에 생수가 45분 동안 비어 있었어요. 창고에는 12개가 남아 있었습니다.">${e(d.note??'')}</textarea></label><details class="ops-optional-fields" data-ui-key="observation-comparison" ${d.revenueBefore?'open':''}><summary>전후 매출과 비교 조건 추가 <span>선택 사항</span></summary><div class="ops-form-grid"><label class="ops-field">변경 전 금액 (원)<input name="revenueBefore" type="number" min="0" step="1" value="${e(d.revenueBefore??'')}" placeholder="같은 상품·기간 기준"></label><label class="ops-field">변경 후 금액 (원)<input name="revenueAfter" type="number" min="0" step="1" value="${e(d.revenueAfter??'')}"></label><label class="ops-field">각 비교 기간 (일)<input name="comparableDays" type="number" min="1" max="365" value="${e(d.comparableDays??'')}"></label><label class="ops-field">함께 달라진 조건<input name="confounders" maxlength="250" value="${e(d.confounders??'')}" placeholder="예: 행사, 비, 가격 변경"></label></div><p class="micro">두 금액은 같은 상품 범위·같은 길이의 기간으로 비교하세요. 직접 입력한 변화이며 진열 효과를 입증하지 않습니다.</p></details>${vm.error?`<div class="error-banner" role="alert">${e(vm.error)}</div>`:''}</div><div class="dialog-footer"><button class="button primary" type="submit">관찰 저장 · 추천 근거 갱신 ${icon('arrow-right',{size:15})}</button><span class="micro">현재 페이지에만 보관 · 외부 전송 없음</span></div></form></section></div>`;}

export function renderSearchDialog(vm){return `<div class="dialog-backdrop"><section class="approval-dialog ops-search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-title"><div class="dialog-heading"><h2 id="search-title">점포와 화면 찾기</h2>${btn('닫기','close-search',{},'text-button')}</div><div class="dialog-content"><label class="ops-field">검색<input id="workspace-search" placeholder="점포 이름 또는 화면 이름" autocomplete="off"></label><div class="ops-search-results">${[{name:'운영 개요',route:'home'},{name:'운영 이슈',route:'operations'},{name:'다음 추천',route:'recommendations'},{name:'사진·관찰',route:'evidence'},{name:'담당 점포 실적',route:'portfolio'},{name:'진열 시뮬레이션',route:'board'},{name:'진열 시뮬레이션 결과',route:'review'}].map(item=>`<div data-search-item="${e(item.name)}">${btn(icon('arrow-right')+item.name,'navigate',{route:item.route},'ops-search-result')}</div>`).join('')}${vm.stores.map(s=>`<div data-search-item="${e(s.name)}">${btn(icon('store')+e(s.name),'ops-store',{store:s.id},'ops-search-result')}</div>`).join('')}<p id="search-empty" hidden>일치하는 화면이나 점포가 없습니다.</p></div></div></section></div>`;}
