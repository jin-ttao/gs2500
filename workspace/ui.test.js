import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeHtml, icon, revenueChart, sparkline, segmentedControl, statCard} from './ui.js';

const rows = [
  {date: '2026-09-01', revenue: 1200000, previousRevenue: 900000},
  {date: '2026-09-02', revenue: 1600000, previousRevenue: 1100000},
  {date: '2026-09-03', revenue: 1400000, previousRevenue: 1500000},
];

test('escapeHtml and all original icons return safe, decorative markup', () => {
  assert.equal(escapeHtml('<img a="&">\''), '&lt;img a=&quot;&amp;&quot;&gt;&#39;');
  for (const name of ['home', 'chart', 'layers', 'camera', 'sparkles', 'clock', 'arrow-up-right', 'arrow-right', 'plus', 'search', 'store', 'chevron-down', 'check', 'alert', 'box', 'weather', 'festival', 'history', 'settings', 'x']) {
    assert.match(icon(name), /<svg/);
    assert.match(icon(name), /aria-hidden="true"/);
  }
  assert.match(icon('<script>', {size: '" onload="alert(1)'}), /width="18"/);
  assert.ok(!icon('<script>').includes('<script>'));
});

test('revenue chart uses supplied values and dates in accessible source table', () => {
  const html = revenueChart(rows);
  for (const row of rows) {
    assert.ok(html.includes(row.date));
    assert.ok(html.includes(row.revenue.toLocaleString('ko-KR')));
    assert.ok(html.includes(row.previousRevenue.toLocaleString('ko-KR')));
  }
  assert.equal((html.match(/class="ui-chart-point" tabindex="0"/g) ?? []).length, 3);
  assert.ok(html.includes('<caption>기간 매출 · 전달된 원본 수치</caption>'));
  assert.ok(html.includes('ui-chart-previous'));
  assert.ok(!/NaN|undefined|Infinity/.test(html));
});

test('chart empty, missing, negative, single and zero inputs remain finite', () => {
  for (const data of [[], null, [{date: 'missing', revenue: NaN}], [{date: 'infinite', revenue: Infinity}]]) {
    assert.match(revenueChart(data), /표시할 매출 기록이 없습니다/);
  }
  for (const data of [[{date: 'zero', revenue: 0}], [{date: 'refund', revenue: -100}], [{date: 'one', revenue: 500}], [{revenue: 500}, {revenue: null}, {revenue: 900}]]) {
    const html = revenueChart(data);
    assert.ok(!/NaN|undefined|Infinity/.test(html));
    assert.match(html, /ui-revenue-svg/);
  }
  const gaps = revenueChart([{revenue: 100}, {revenue: null}, {revenue: 300}]);
  assert.equal((gaps.match(/class="ui-chart-line"/g) ?? []).length, 2, 'missing revenue must not become zero or bridge a gap');
  assert.match(gaps, /<td>—<\/td>/);
  assert.match(revenueChart([{date: 'single', revenue: 300}]), /ui-chart-point-isolated/);
});

test('comparison is absent unless supplied and can be explicitly disabled', () => {
  assert.ok(!revenueChart(rows.map(({date, revenue}) => ({date, revenue}))).includes('class="ui-chart-previous"'));
  const html = revenueChart(rows, {previous: false});
  assert.ok(!html.includes('비교 기간'));
  assert.ok(!html.includes('900,000'));
});

test('events are located only on supplied dates and strings are escaped', () => {
  const html = revenueChart(rows, {label: '<b>매출</b>', id: '"><script>', events: [
    {date: '2026-09-02', title: '<img src=x onerror=alert(1)>', type: 'weather'},
    {date: '2099-01-01', title: 'outside range'},
  ]});
  assert.ok(html.includes('&lt;b&gt;매출&lt;/b&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('outside range'));
  assert.ok(!html.includes('<script>'));
  assert.equal((html.match(/class="ui-chart-event"/g) ?? []).length, 1);
});

test('repeated charts receive noncolliding gradient and accessibility ids', () => {
  const first = revenueChart(rows, {id: 'same'}), second = revenueChart(rows, {id: 'same'});
  const getId = html => html.match(/linearGradient id="([^"]+)"/)[1];
  assert.notEqual(getId(first), getId(second));
  assert.ok(first.includes(`fill="url(#${getId(first)})"`));
});

test('sparkline sanitizes color, handles degenerate inputs and preserves gaps', () => {
  for (const data of [[], [0, 0], [100], [NaN, Infinity], [2, null, 5]]) {
    const html = sparkline(data);
    assert.ok(!/NaN|undefined|Infinity/.test(html));
    assert.match(html, /aria-hidden="true"/);
  }
  assert.ok(!sparkline([1, 2], {color: '" onload="alert(1)'}).includes('onload'));
  assert.equal((sparkline([1, null, 3]).match(/<path/g) ?? []).length, 2);
});

test('segmented buttons expose action, value and selection without injected markup', () => {
  const html = segmentedControl([{value: 7, label: '7일'}, {value: 30, label: '30일'}], 7);
  assert.match(html, /data-value="7" aria-pressed="true"/);
  assert.match(html, /data-value="30" aria-pressed="false"/);
  assert.match(html, /data-action="ops-range"/);
  assert.ok(!segmentedControl(['<b>x</b>'], 1, {action: '" onclick="x'}).includes('<b>'));
});

test('stat cards preserve explicit caller copy without fabricating trends', () => {
  const html = statCard({label: '매출', value: '1,200,000원', detail: '합성 운영 기록', trend: {label: '+8.2%', direction: 'up'}, icon: 'chart'});
  assert.ok(html.includes('1,200,000원'));
  assert.ok(html.includes('합성 운영 기록'));
  assert.ok(html.includes('ui-stat-trend-up'));
  assert.ok(!statCard({label: '<script>', value: '<img>'}).includes('<script>'));
  assert.ok(!statCard({label: '기록', value: '0'}).includes('ui-stat-trend'));
});
