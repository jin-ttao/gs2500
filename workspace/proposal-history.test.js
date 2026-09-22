import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_AS_OF, PROPOSAL_HISTORY, buildProposalHistory } from './proposal-history.js';
import { getCandidate } from './data.js';

const DAY = 86400000;
const timestamp = date => Date.parse(`${date}T00:00:00Z`);
const windowDays = window => (timestamp(window.end) - timestamp(window.start)) / DAY + 1;

test('history is explicitly authored synthetic evidence with valid store and candidate identities', () => {
  assert.equal(HISTORY_AS_OF, '2026-09-22');
  assert.equal(PROPOSAL_HISTORY.length, 4);
  assert.equal(new Set(PROPOSAL_HISTORY.map(record => record.id)).size, 4);
  assert.deepEqual(PROPOSAL_HISTORY.map(({ storeId, bayId, candidateId }) => [storeId, bayId, candidateId]), [
    ['H-0412', 'B-03', 'B'], ['H-0521', 'B-01', 'A'], ['H-0618', 'B-05', 'B'], ['H-0730', 'B-02', 'C'],
  ]);
  for (const record of PROPOSAL_HISTORY) {
    assert.ok(getCandidate(record.storeId, record.bayId, record.candidateId));
    assert.equal(record.synthetic, true);
    assert.equal(record.source, 'authored-proposal-history');
    assert.ok(record.ownerNote.includes('합성'));
    assert.ok(record.events.every(event => event.note.includes('합성')));
    assert.ok(record.followUp.length > 0);
  }
});

test('2- and 4-week records compare complete equal-length windows ending before the check date', () => {
  const { records } = buildProposalHistory();
  assert.deepEqual(records.map(record => record.elapsedDays), [28, 14, 28, 14]);
  for (const record of records) {
    assert.equal(record.checkedOn, HISTORY_AS_OF);
    assert.equal(record.observedDays, record.elapsedDays);
    assert.deepEqual(record.measurements.map(item => item.week), Array.from({ length: record.elapsedDays / 7 }, (_, i) => i + 1));
    assert.ok(record.measurements.every(item => item.days === 7));
    assert.equal(windowDays(record.comparisonWindow.before), record.observedDays);
    assert.equal(windowDays(record.comparisonWindow.after), record.observedDays);
    assert.equal(record.comparisonWindow.after.start, record.appliedOn);
    assert.equal(record.comparisonWindow.after.end, '2026-09-21');
    assert.equal(timestamp(record.comparisonWindow.before.end) + DAY, timestamp(record.appliedOn));
    assert.equal(timestamp(record.comparisonWindow.after.end) + DAY, timestamp(record.checkedOn));
    assert.ok(record.events.every(event => timestamp(event.date) >= timestamp(record.appliedOn)
      && timestamp(event.date) < timestamp(record.checkedOn)));
  }
  assert.deepEqual(records[0].comparisonWindow.before, { start: '2026-07-28', end: '2026-08-24' });
  assert.deepEqual(records[1].comparisonWindow.before, { start: '2026-08-25', end: '2026-09-07' });
});

test('revenue totals, daily values and changes derive from matched weekly measurements', () => {
  const { records, summary } = buildProposalHistory();
  for (const record of records) {
    assert.equal(record.beforeRevenue, record.measurements.reduce((total, item) => total + item.beforeRevenue, 0));
    assert.equal(record.afterRevenue, record.measurements.reduce((total, item) => total + item.afterRevenue, 0));
    assert.equal(record.deltaRevenue, record.afterRevenue - record.beforeRevenue);
    assert.equal(record.deltaPercent, record.deltaRevenue / record.beforeRevenue * 100);
    assert.equal(record.dailyBefore, record.beforeRevenue / record.observedDays);
    assert.equal(record.dailyAfter, record.afterRevenue / record.observedDays);
    assert.notEqual(record.deltaPercent, record.expectedDeltaPercent);
  }
  assert.equal(records[0].beforeRevenue, 100000000);
  assert.equal(records[0].afterRevenue, 106700000);
  assert.equal(records[0].deltaPercent, 6.7);
  assert.equal(records[1].execution, 'partial');
  assert.equal(records[1].status, 'attention');
  assert.ok(records[1].deltaRevenue < 0);
  assert.ok(records[1].stockouts.afterMinutes > records[1].stockouts.beforeMinutes);
  assert.equal(records[3].status, 'monitoring');
  assert.ok(records[3].deltaRevenue > 0);
  assert.deepEqual(summary, { tracking: 4, week4: 2, improved: 2, attention: 1 });
});

test('period and attention filters intersect while summary counts retain their full-history meaning', () => {
  const all = buildProposalHistory();
  assert.deepEqual(all.filters, { period: 'all', status: 'all' });
  for (const period of ['all', '14', '28']) for (const status of ['all', 'attention']) {
    const result = buildProposalHistory({ period, status });
    assert.deepEqual(result.filters, { period, status });
    assert.equal(result.totalRecords, 4);
    assert.deepEqual(result.summary, all.summary);
    assert.deepEqual(result.records.map(record => record.id), all.records
      .filter(record => (period === 'all' || record.observedDays === Number(period))
        && (status === 'all' || record.status === status)).map(record => record.id));
  }
  assert.equal(buildProposalHistory({ period: '14' }).records.length, 2);
  assert.equal(buildProposalHistory({ period: '28', status: 'attention' }).records.length, 0);
  assert.equal(buildProposalHistory({ status: 'attention' }).records[0].storeId, 'H-0521');
  assert.throws(() => buildProposalHistory({ period: '7' }), RangeError);
  assert.throws(() => buildProposalHistory({ status: 'improved' }), RangeError);
});

test('history fixtures and repeated builds cannot be altered by a consumer', () => {
  assert.throws(() => { PROPOSAL_HISTORY[0].measurements[0].afterRevenue = 0; }, TypeError);
  assert.throws(() => { PROPOSAL_HISTORY[1].events.push({}); }, TypeError);
  const result = buildProposalHistory();
  result.records[0].afterRevenue = 0;
  result.records[0].comparisonWindow.after.end = '2030-01-01';
  result.summary.tracking = 0;
  const rebuilt = buildProposalHistory();
  assert.equal(rebuilt.records[0].afterRevenue, 106700000);
  assert.equal(rebuilt.records[0].comparisonWindow.after.end, '2026-09-21');
  assert.equal(rebuilt.summary.tracking, 4);
});
