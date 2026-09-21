import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_RECORD_URL, REPLAY_DURATION, resolveRecordUrl, unwrapRecord, resultMetrics } from './embed.js';

const source = name => readFile(new URL(name, import.meta.url), 'utf8');

test('embed uses the query record URL and a 24-second summary replay', () => {
  assert.equal(DEFAULT_RECORD_URL, '/data/samsung-owner-replay.json');
  assert.equal(REPLAY_DURATION, 24);
  assert.equal(resolveRecordUrl(''), DEFAULT_RECORD_URL);
  assert.equal(resolveRecordUrl('?record=%2Fdata%2Fcandidate-b.json'), '/data/candidate-b.json');
  assert.equal(resolveRecordUrl('?record=%20%20'), DEFAULT_RECORD_URL);
});

test('embed reads absolute outcomes from a day-replay/1 final snapshot', () => {
  const record = unwrapRecord({ record:{ schemaVersion:'day-replay/1', finalSnapshot:{
    paidRevenue:123400, paidGrossProfit:45600, day:{ entered:88, buyers:43 },
  } } });
  assert.deepEqual(resultMetrics(record), { revenue:123400, profit:45600, entered:88, buyers:43 });
  assert.throws(() => unwrapRecord({ schemaVersion:'other' }), /day-replay\/1/);
  assert.throws(() => resultMetrics({ finalSnapshot:{ paidRevenue:1 } }), /최종 결제/);
});

test('static embed keeps replay truth labels and the existing 3D renderer contract', async () => {
  const [html, script, build] = await Promise.all([source('embed.html'), source('embed.js'), source('scripts/build.mjs')]);
  for (const text of ['24시간 엔진 결과의', '사전 계산·재생', '실제 동시 방문', '결제매출', '매출총이익', '입장', '구매', '로컬 규칙', 'Nemotron Korea 합성']) {
    assert.match(html, new RegExp(text));
  }
  for (const id of ['webgl', 'shelfLabel', 'levelLabel', 'agentLabel', 'sceneAgentName', 'sceneAgentState', 'loading']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /createSummaryReplay/);
  assert.match(script, /createStore/);
  assert.doesNotMatch(script, /createWorld/);
  assert.match(script, /gs2500-embed-ready/);
  assert.match(script, /gs2500-embed-error/);
  assert.match(script, /location\.origin/);
  assert.match(build, /embed\.html/);
  assert.match(build, /embed\.js/);
  assert.match(build, /embed\.css/);
});
