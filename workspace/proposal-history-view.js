import {escapeHtml as e, icon, segmentedControl} from './ui.js';
import {buildProposalHistory} from './proposal-history.js';

// Presentation of authored, historical examples. Current session approvals are
// deliberately kept outside this history: clicking approve does not create
// elapsed weeks, measured revenue, or proof of execution.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const number = value => finite(value) ? value.toLocaleString('ko-KR', {maximumFractionDigits: 1}) : '—';
const won = value => finite(value) ? `${Math.round(value).toLocaleString('ko-KR')}원` : '—';
const percent = value => finite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}%` : '—';
const signedWon = value => finite(value) ? `${value > 0 ? '+' : ''}${won(value)}` : '—';
const shortDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value).slice(5).replace('-', '.') : String(value ?? '');
const fullDate = value => String(value ?? '').replaceAll('-', '.');
const statusLabel = status => ({improved: '개선 흐름', attention: '재점검 필요', monitoring: '추적 중'}[status] ?? '추적 중');
const statusClass = status => ['improved', 'attention', 'monitoring'].includes(status) ? status : 'monitoring';
const action = (label, name, data = {}, className = 'button') => `<button type="button" class="${className}" data-action="${e(name)}" ${Object.entries(data).map(([key, value]) => `data-${key}="${e(value)}"`).join(' ')}>${label}</button>`;
const windowLabel = window => window?.start && window?.end ? `${shortDate(window.start)}–${shortDate(window.end)}` : '';

function weeklyChart(record) {
  const rows = (record.measurements ?? []).filter(row => finite(row.beforeRevenue) && finite(row.afterRevenue));
  if (!rows.length) return '<div class="history-chart-empty">주차별 기록이 없습니다.</div>';
  const maximum = Math.max(1, ...rows.flatMap(row => [row.beforeRevenue, row.afterRevenue]));
  const width = 272, height = 108, top = 10, baseline = 80, left = 18, right = 12;
  const groupWidth = (width - left - right) / rows.length;
  const barWidth = Math.min(19, groupWidth / 4);
  const y = value => Number((baseline - Math.max(0, value) / maximum * (baseline - top)).toFixed(2));
  return `<div class="history-chart-heading"><span>주차별 점포 매출</span><span class="history-chart-legend"><i class="history-chart-key before"></i>적용 전 <i class="history-chart-key after"></i>적용 후</span></div>
    <svg class="history-week-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(`${record.title} · 각 주의 동일 ${rows[0].days}일 매출 비교`)}">
      <title>주차별 적용 전후 매출 · 합성 이력</title>
      <line class="history-chart-baseline" x1="${left}" y1="${baseline}" x2="${width - right}" y2="${baseline}" stroke="currentColor" stroke-opacity=".12"/>
      ${rows.map((row, index) => {
        const center = left + groupWidth * (index + .5), beforeY = y(row.beforeRevenue), afterY = y(row.afterRevenue);
        return `<g><title>${e(`${row.week}주차 · 각각 ${row.days}일: 적용 전 ${won(row.beforeRevenue)}, 적용 후 ${won(row.afterRevenue)}`)}</title><rect class="history-bar-before" x="${Number((center - barWidth - 2).toFixed(2))}" y="${beforeY}" width="${barWidth}" height="${baseline - beforeY}" rx="2" fill="#d8dddf"/><rect class="history-bar-after" x="${Number((center + 2).toFixed(2))}" y="${afterY}" width="${barWidth}" height="${baseline - afterY}" rx="2" fill="${record.status === 'attention' ? '#b8754f' : '#0f766e'}"/><text class="history-chart-label" x="${Number(center.toFixed(2))}" y="100" text-anchor="middle" fill="currentColor" font-size="10">${e(row.week)}주</text></g>`;
      }).join('')}
    </svg><p class="history-chart-caption">각 막대 ${e(rows[0].days)}일 · 0원 기준</p>`;
}

function historyCard(vm, record) {
  const store = (vm.stores ?? []).find(item => item.id === record.storeId);
  const bay = (vm.bays ?? []).find(item => item.id === record.bayId && item.storeId === record.storeId);
  const candidate = bay?.candidates?.find(item => item.id === record.candidateId);
  const status = statusClass(record.status), days = record.observedDays;
  const stockouts = record.stockouts ?? {};
  const stockoutChange = finite(stockouts.beforeMinutes) && finite(stockouts.afterMinutes) ? stockouts.afterMinutes - stockouts.beforeMinutes : null;
  const stockoutText = stockoutChange === null ? '비교 기록 없음' : stockoutChange === 0 ? '변동 없음' : `${number(Math.abs(stockoutChange))}분 ${stockoutChange < 0 ? '감소' : '증가'}`;
  const beforeWindow = windowLabel(record.comparisonWindow?.before), afterWindow = windowLabel(record.comparisonWindow?.after);
  const planData = {store: record.storeId, bay: record.bayId, candidate: record.candidateId, route: 'bay'};
  return `<article class="history-card" data-history-id="${e(record.id)}" data-status="${status}" data-period="${e(days)}">
    <div class="history-card-top"><div class="history-store"><span class="history-store-icon">${icon('store', {size: 19})}</span><div><strong>${e(store?.name ?? record.storeId)}</strong><span>${e(bay?.name ?? record.bayId)} · ${e(record.candidateId)}안</span></div></div><div class="history-badges"><span class="history-stage">적용 후 ${number(days / 7)}주</span><span class="history-status ${status}">${icon(status === 'attention' ? 'alert' : status === 'improved' ? 'check' : 'clock', {size: 12})}${statusLabel(status)}</span></div></div>
    <div class="history-proposal"><h2>${e(record.title)}</h2><p>${e(record.changeSummary)}</p><div class="history-meta"><span><time datetime="${e(record.appliedOn)}">${e(shortDate(record.appliedOn))}</time> 적용</span><span>${record.execution === 'partial' ? '부분 적용' : '전체 적용'}</span><span>${e(shortDate(record.checkedOn))} 확인</span></div></div>
    <div class="history-card-main"><div class="history-outcome"><span class="history-metric-label">점포 전체 매출 변화</span><strong class="history-delta ${finite(record.deltaPercent) && record.deltaPercent < 0 ? 'negative' : 'positive'}">${percent(record.deltaPercent)}</strong><span class="history-delta-amount">${signedWon(record.deltaRevenue)} <small>· 각 ${number(days)}일 비교</small></span><div class="history-revenue-pair"><div><span>적용 전 ${number(days)}일</span><strong>${won(record.beforeRevenue)}</strong>${beforeWindow ? `<small>${e(beforeWindow)}</small>` : ''}</div><span class="history-pair-arrow" aria-hidden="true">${icon('arrow-right', {size: 15})}</span><div><span>적용 후 ${number(days)}일</span><strong>${won(record.afterRevenue)}</strong>${afterWindow ? `<small>${e(afterWindow)}</small>` : ''}</div></div></div><div class="history-chart">${weeklyChart(record)}</div></div>
    <div class="history-stockout"><span>${icon('box', {size: 15})} 품절 시간 <span class="history-stockout-pair">${number(stockouts.beforeMinutes)}분 → ${number(stockouts.afterMinutes)}분</span></span><strong class="${stockoutChange > 0 ? 'negative' : 'positive'}">${stockoutText}</strong></div>
    <details class="history-details" data-ui-key="history-${e(record.id)}"><summary>적용 기록과 매니저 메모 ${icon('chevron-down', {size: 15})}</summary><div class="history-detail-content"><div class="history-detail-grid"><section class="history-timeline"><h3>적용 이후의 기록</h3><ol>${(record.events ?? []).map(event => `<li><time datetime="${e(event.date)}">${e(shortDate(event.date))}</time><div><strong>${e(event.title)}</strong><p>${e(event.note)}</p></div></li>`).join('')}</ol></section><div class="history-notes"><section class="history-note"><h3>점주 메모</h3><p>${e(record.ownerNote ?? '남긴 메모가 없습니다.')}</p></section><section class="history-note history-follow-up"><h3>매니저 후속 조치</h3><p>${e(record.followUp ?? '추가 기록을 확인합니다.')}</p></section></div></div>
      <div class="history-measurements"><table><caption>주차별 매출 기록 · 각 ${e(record.measurements?.[0]?.days ?? 7)}일 · 합성 이력</caption><thead><tr><th scope="col">관찰 주차</th><th scope="col">적용 전</th><th scope="col">적용 후</th><th scope="col">변화</th></tr></thead><tbody>${(record.measurements ?? []).map(row => `<tr><th scope="row">${e(row.week)}주차</th><td>${won(row.beforeRevenue)}</td><td>${won(row.afterRevenue)}</td><td>${finite(row.beforeRevenue) && row.beforeRevenue > 0 && finite(row.afterRevenue) ? percent((row.afterRevenue / row.beforeRevenue - 1) * 100) : '—'}</td></tr>`).join('')}</tbody></table></div>
      <div class="history-forecast"><span>${icon('sparkles', {size: 14})} 승인 당시 30일 예상</span><strong>${percent(record.expectedDeltaPercent)}</strong><p>합성 보관값 · ${e(candidate?.name ?? `${record.candidateId}안`)} · 대상 24 SKU의 당시 30일 모형 예상입니다. 위 점포 전체 ${number(days)}일 전후 매출과는 기간·집계 범위가 다른 수치입니다.</p></div>
    </div></details>
    <div class="history-card-actions">${action('적용한 진열안 보기 ' + icon('arrow-up-right', {size: 14}), 'select-candidate', planData, 'text-button')}${action('점포 운영 기록 ' + icon('arrow-right', {size: 14}), 'ops-store', {store: record.storeId}, 'text-button')}</div>
  </article>`;
}

function currentSession(vm) {
  const rows = (vm.review?.rows ?? []).filter(row => row.approval != null);
  if (!rows.length) return '';
  return `<details class="history-session" data-ui-key="history-current-session"><summary><span>이번 세션에서 보낸 제안 <b>${rows.length}</b></span>${icon('chevron-down', {size: 16})}</summary><div class="history-session-content"><p class="history-session-note">이번 세션의 승인·회신 기록입니다. 아직 2주·4주 관찰치가 없습니다.</p><div class="review-list">${rows.map(row => {
    const approval = row.approval, response = row.response;
    const bay = row.bay ?? (vm.bays ?? []).find(item => item.id === approval.bayId && item.storeId === approval.storeId);
    const store = row.store ?? (vm.stores ?? []).find(item => item.id === approval.storeId);
    const responseText = {accepted: '수용 회신', partial: '부분 실행 회신', declined: '실행 어려움'}[response?.status] ?? '회신 대기';
    const photo = row.photo?.fileName ?? response?.photoName;
    return `<article class="review-card"><div class="review-card-head"><div><strong>${e(store?.name ?? approval.storeId)}</strong><h3>${e(bay?.name ?? approval.bayId)} · ${e(approval.candidateId)}안</h3></div><span class="badge">${responseText}</span></div><div class="history-session-status"><span>${photo ? '사진 접수됨 · 실행 검증 아님' : '사진 미접수'}</span><span>관찰 기간 시작 전</span></div>${response?.note ? `<p class="history-session-owner-note">${e(response.note)}</p>` : ''}</article>`;
  }).join('')}</div></div></details>`;
}

export function renderProposalHistory(vm = {}) {
  const history = vm.proposalHistory ?? buildProposalHistory();
  const records = history.records ?? [], summary = history.summary ?? {}, filters = history.filters ?? {};
  const stats = [
    {label: '적용 후 추적', value: summary.tracking, detail: '2주·4주 경과 제안', symbol: 'history'},
    {label: '4주 경과', value: summary.week4, detail: '4주 기록 확인', symbol: 'clock'},
    {label: '개선 흐름', value: summary.improved, detail: '4주 매출 증가 확인', symbol: 'chart'},
    {label: '재점검 필요', value: summary.attention, detail: '매출·품절 함께 확인', symbol: 'alert', attention: true},
  ];
  return `<div class="history-page"><header class="history-heading"><div class="history-heading-copy"><span class="history-eyebrow">APPLIED PROPOSALS</span><h1>진열 시뮬레이션 결과</h1><p>적용한 제안이 2주, 4주 뒤 어떻게 달라졌는지 확인합니다.</p></div><div class="history-asof">${icon('clock', {size: 15})}<span><strong>${e(fullDate(history.asOf))}</strong> 확인 기준</span></div></header>
    <div class="history-demo-note">${icon('layers', {size: 15})}<strong>합성 이력 데모</strong><span>적용·매출·품절 기록은 작성된 예시입니다. 실제 관측 성과나 진열의 인과효과를 뜻하지 않습니다.</span></div>
    <section class="history-stats" aria-label="적용 제안 추적 현황">${stats.map(stat => `<article class="history-stat${stat.attention ? ' history-stat-attention' : ''}"><div><span>${stat.label}</span>${icon(stat.symbol, {size: 16})}</div><strong>${number(stat.value)}<small>건</small></strong><p>${stat.detail}</p></article>`).join('')}</section>
    <div class="history-toolbar"><div><h2>적용한 제안</h2><p>${number(records.length)}건 표시 <span>· 전체 ${number(history.totalRecords)}건</span></p></div><div class="history-filters">${segmentedControl([{value: 'all', label: '전체'}, {value: 14, label: '적용 후 2주'}, {value: 28, label: '적용 후 4주'}], filters.period ?? 'all', {action: 'history-period', label: '적용 후 경과 기간'})}${segmentedControl([{value: 'all', label: '모든 상태'}, {value: 'attention', label: '재점검 필요'}], filters.status ?? 'all', {action: 'history-status', label: '제안 추적 상태'})}</div></div>
    <div class="history-list">${records.length ? records.map(record => historyCard(vm, record)).join('') : `<div class="history-empty">${icon('history', {size: 28})}<h3>조건에 맞는 적용 이력이 없습니다.</h3><p>다른 기간이나 상태를 선택해 주세요.</p></div>`}</div>${currentSession(vm)}
  </div>`;
}
