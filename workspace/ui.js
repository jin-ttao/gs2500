/** Original, dependency-free UI primitives. Values come from the caller's ledger. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

const ICONS = {
  'panel-left': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  chart: '<path d="M4 3v17h17M8 15l4-5 4 3 5-7"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  camera: '<path d="M8 6 9.5 3h5L16 6h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"/><circle cx="12" cy="12" r="4"/>',
  sparkles: '<path d="m14 3 2.2 6.8L23 12l-6.8 2.2L14 21l-2.2-6.8L5 12l6.8-2.2ZM4 2v6M1 5h6M4 17v5M1.5 19.5h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  store: '<path d="M3 9h18l-2-6H5Zm1 4v8h16v-8M9 21v-7h6v7M3 9v2a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="m12 3 10 18H2Z M12 9v5M12 17h.01"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8Zm-9 5 9 5 9-5M12 13v9M7.5 5.5l9 5v4"/>',
  weather: '<path d="M7 15a5 5 0 1 1 9-4 3 3 0 0 1 1 6H7a3 3 0 0 1 0-6M8 20l-1 2m6-2-1 2m6-2-1 2"/>',
  festival: '<path d="M12 10v12M9 11l-7 7M15 11l7 7M12 3V1M5 5 3 3m16 2 2-2M5 11H2m17 0h3M8 8 6 6m10 2 2-2"/>',
  history: '<path d="M3 5v5h5M3.7 9a9 9 0 1 1 .4 7M12 7v5l4 2"/>',
  settings: '<path d="m9 3-.6 3-2 .9-2.8-1-2 3.4L4 11v2l-2.4 1.7 2 3.4 2.8-1 2 .9.6 3h4l.6-3 2-.9 2.8 1 2-3.4L18 13v-2l2.4-1.7-2-3.4-2.8 1-2-.9-.6-3Z"/><circle cx="11" cy="12" r="3"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
};

export function icon(name, {size = 18} = {}) {
  const safeSize = Number.isFinite(Number(size)) ? Math.min(64, Math.max(8, Number(size))) : 18;
  return `<svg class="ui-icon" width="${safeSize}" height="${safeSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${Object.hasOwn(ICONS, name) ? ICONS[name] : ICONS.layers}</svg>`;
}

let instance = 0;
const uniqueId = value => `ui-${String(value ?? 'chart').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50) || 'chart'}-${++instance}`;
const number = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
const money = value => number(value) === null ? '—' : `${Math.round(value).toLocaleString('ko-KR')}원`;
const coordinate = value => Number(value.toFixed(2));
const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value).slice(5).replace('-', '.') : String(value ?? '');
const axisLabel = value => {
  if (Math.abs(value) >= 100000000) return `${Number((value / 100000000).toFixed(1))}억`;
  if (Math.abs(value) >= 10000) return `${Number((value / 10000).toFixed(1))}만`;
  return Math.round(value).toLocaleString('ko-KR');
};

function scaleBounds(values, zero = true) {
  if (!values.length) return {min: 0, max: 1};
  let min = Math.min(...values, ...(zero ? [0] : []));
  let max = Math.max(...values, ...(zero ? [0] : []));
  if (min === max) {
    if (zero) return {min: 0, max: 1000};
    return {min: min - 1, max: max + 1};
  }
  if (zero) {
    const magnitude = 10 ** Math.floor(Math.log10(max - min));
    const unit = Math.max(Number.MIN_VALUE, magnitude / 2);
    min = Math.floor(min / unit) * unit;
    max = Math.ceil(max / unit) * unit;
  }
  return {min, max};
}

function lineSegments(points) {
  const segments = [];
  for (const point of points) {
    if (!point) {
      if (segments.at(-1)?.length) segments.push([]);
    } else {
      if (!segments.length) segments.push([]);
      segments.at(-1).push(point);
    }
  }
  return segments.filter(segment => segment.length);
}

const linePath = points => points.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ');

/** A zero-baseline area chart with honest gaps, keyboard points, and source table. */
export function revenueChart(series, {id = 'revenue', events = [], label = '기간 매출', previous = true} = {}) {
  const rows = (Array.isArray(series) ? series : []).map(row => ({
    date: String(row?.date ?? ''), revenue: number(row?.revenue), previousRevenue: previous ? number(row?.previousRevenue) : null,
  }));
  const chartId = uniqueId(id);
  const values = rows.flatMap(row => [row.revenue, row.previousRevenue]).filter(value => value !== null);
  if (!values.length) {
    return `<div class="ui-chart ui-chart-empty" role="status" aria-label="${escapeHtml(label)}"><span class="ui-chart-empty-icon">${icon('chart', {size: 30})}</span><p>표시할 매출 기록이 없습니다</p><span>운영 기록이 쌓이면 같은 기준으로 비교할 수 있어요.</span></div>`;
  }
  const width = 680, height = 260;
  const left = 64, right = 18, top = 22, bottom = 38;
  const {min, max} = scaleBounds(values);
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const xFor = index => coordinate(left + (rows.length === 1 ? .5 : index / (rows.length - 1)) * plotWidth);
  const yFor = value => coordinate(top + (max - value) / (max - min) * plotHeight);
  const points = rows.map((row, index) => row.revenue === null ? null : [xFor(index), yFor(row.revenue)]);
  const oldPoints = rows.map((row, index) => row.previousRevenue === null ? null : [xFor(index), yFor(row.previousRevenue)]);
  const segments = lineSegments(points), oldSegments = lineSegments(oldPoints);
  const actualLabel = '선택 기간', previousLabel = '비교 기간';
  const hasPrevious = rows.some(row => row.previousRevenue !== null);
  const eventRows = (Array.isArray(events) ? events : []).map(event => ({...event, index: rows.findIndex(row => row.date === String(event?.date))})).filter(event => event.index >= 0);
  const yTicks = Array.from({length: 5}, (_, index) => min + (max - min) * index / 4);
  const tickCount = Math.min(6, rows.length);
  const tickIndices = [...new Set(Array.from({length: tickCount}, (_, index) => Math.round(index * (rows.length - 1) / Math.max(1, tickCount - 1))))];
  const title = `${label}. ${rows.length}개 날짜${hasPrevious ? ', 비교 기간 포함' : ''}. 그래프 아래에서 정확한 수치를 확인할 수 있습니다.`;
  return `<div class="ui-chart">
    <div class="ui-chart-legend"><span><i class="ui-chart-key"></i>${actualLabel}</span>${hasPrevious ? `<span><i class="ui-chart-key ui-chart-key-previous"></i>${previousLabel}</span>` : ''}<span class="ui-chart-unit">단위: 원</span></div>
    <svg class="ui-revenue-svg" viewBox="0 0 ${width} ${height}" role="group" aria-labelledby="${chartId}-title ${chartId}-description">
      <title id="${chartId}-title">${escapeHtml(label)}</title><desc id="${chartId}-description">${escapeHtml(title)}</desc>
      <defs><linearGradient id="${chartId}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="currentColor" stop-opacity=".21"/><stop offset="100%" stop-color="currentColor" stop-opacity=".01"/></linearGradient></defs>
      ${yTicks.map(value => `<g class="ui-chart-axis"><line x1="${left}" y1="${yFor(value)}" x2="${width - right}" y2="${yFor(value)}"/><text x="${left - 12}" y="${yFor(value) + 4}" text-anchor="end">${axisLabel(value)}</text></g>`).join('')}
      ${eventRows.map(event => `<g class="ui-chart-event" role="img" aria-label="${escapeHtml(`${event.date}: ${event.title ?? '운영 이슈'}`)}"><title>${escapeHtml(`${event.date}: ${event.title ?? '운영 이슈'}`)}</title><line x1="${xFor(event.index)}" y1="${top}" x2="${xFor(event.index)}" y2="${height - bottom}"/><circle cx="${xFor(event.index)}" cy="${top - 7}" r="3"/></g>`).join('')}
      ${segments.map(segment => `<path class="ui-chart-area" fill="url(#${chartId}-fill)" d="${linePath(segment)} L${segment.at(-1)[0]},${yFor(0)} L${segment[0][0]},${yFor(0)} Z"/>`).join('')}
      ${oldSegments.map(segment => segment.length === 1 ? `<circle class="ui-chart-comparison-dot" cx="${segment[0][0]}" cy="${segment[0][1]}" r="2.5"/>` : `<path class="ui-chart-previous" d="${linePath(segment)}"/>`).join('')}
      ${segments.map(segment => `<path class="ui-chart-line" d="${linePath(segment)}"/>`).join('')}
      ${rows.map((row, index) => row.revenue === null ? '' : `<g class="ui-chart-point${!points[index - 1] && !points[index + 1] ? ' ui-chart-point-isolated' : ''}" tabindex="0" role="img" aria-label="${escapeHtml(`${row.date}, ${actualLabel} ${money(row.revenue)}${row.previousRevenue === null ? '' : `, ${previousLabel} ${money(row.previousRevenue)}`}`)}"><title>${escapeHtml(`${row.date} · ${money(row.revenue)}`)}</title><circle class="ui-chart-point-target" cx="${xFor(index)}" cy="${yFor(row.revenue)}" r="10"/><circle class="ui-chart-point-dot" cx="${xFor(index)}" cy="${yFor(row.revenue)}" r="3"/></g>`).join('')}
      ${tickIndices.map(index => `<text class="ui-chart-date" x="${xFor(index)}" y="${height - 11}" text-anchor="${index === 0 && rows.length > 1 ? 'start' : index === rows.length - 1 && rows.length > 1 ? 'end' : 'middle'}">${escapeHtml(dateLabel(rows[index].date))}</text>`).join('')}
    </svg>
    ${eventRows.length ? `<div class="ui-chart-events" aria-label="기록된 운영 이슈">${eventRows.map(event => `<span>${icon(event.type === 'weather' ? 'weather' : event.type === 'festival' ? 'festival' : 'alert', {size: 13})}<span>${escapeHtml(dateLabel(event.date))} · ${escapeHtml(event.title ?? '운영 이슈')}</span></span>`).join('')}</div>` : ''}
    <details class="ui-chart-data"><summary>일자별 수치 보기 ${icon('chevron-down', {size: 13})}</summary><div class="ui-chart-table-wrap"><table><caption>${escapeHtml(label)} · 전달된 원본 수치</caption><thead><tr><th scope="col">일자</th><th scope="col">${actualLabel}</th>${hasPrevious ? `<th scope="col">${previousLabel}</th>` : ''}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${escapeHtml(row.date)}</th><td>${money(row.revenue)}</td>${hasPrevious ? `<td>${money(row.previousRevenue)}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>
  </div>`;
}

export function sparkline(values, {id = 'sparkline', color = '#d5fb5a'} = {}) {
  const safeColor = typeof color === 'string' && /^(?:#[a-f\d]{3,8}|currentColor|var\(--[a-zA-Z0-9-]+\))$/.test(color) ? color : '#d5fb5a';
  const data = (Array.isArray(values) ? values : []).map(number);
  const valid = data.filter(value => value !== null);
  const {min, max} = scaleBounds(valid, false);
  const points = data.map((value, index) => value === null ? null : [coordinate(2 + (data.length === 1 ? .5 : index / (data.length - 1)) * 116), coordinate(3 + (max - value) / (max - min) * 28)]);
  return `<svg class="ui-sparkline" data-chart-id="${uniqueId(id)}" viewBox="0 0 120 34" fill="none" stroke="${escapeHtml(safeColor)}" aria-hidden="true" focusable="false">${lineSegments(points).map(segment => `<path d="${linePath(segment)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join('')}</svg>`;
}

export function segmentedControl(items, selected, {action = 'ops-range', label = '기간 선택'} = {}) {
  return `<div class="ui-segmented" role="group" aria-label="${escapeHtml(label)}">${(Array.isArray(items) ? items : []).map(item => {
    const value = typeof item === 'object' && item !== null ? item.value ?? item.id : item;
    const title = typeof item === 'object' && item !== null ? item.label ?? value : item;
    return `<button type="button" data-action="${escapeHtml(action)}" data-value="${escapeHtml(value)}" aria-pressed="${String(value) === String(selected)}">${escapeHtml(title)}</button>`;
  }).join('')}</div>`;
}

export function statCard({label, value, detail = '', trend, icon: iconName} = {}) {
  // A trend is explicit display text, not a computed delta or an inferred outcome.
  const trendText = typeof trend === 'object' && trend !== null ? trend.label ?? trend.value ?? '' : trend;
  const direction = typeof trend === 'object' && ['up', 'down', 'neutral'].includes(trend?.direction) ? trend.direction : 'neutral';
  return `<article class="ops-kpi ui-stat-card"><div class="ui-stat-header"><span>${escapeHtml(label)}</span>${iconName ? icon(iconName, {size: 17}) : ''}</div><div class="ui-stat-value">${escapeHtml(value)}</div><div class="ui-stat-footer">${trendText !== undefined && trendText !== null && trendText !== '' ? `<span class="ui-stat-trend ui-stat-trend-${direction}">${escapeHtml(trendText)}</span>` : ''}${detail ? `<span class="ui-stat-detail">${escapeHtml(detail)}</span>` : ''}</div></article>`;
}
