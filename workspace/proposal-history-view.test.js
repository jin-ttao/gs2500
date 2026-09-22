import test from 'node:test';
import assert from 'node:assert/strict';
import {renderProposalHistory} from './proposal-history-view.js';
import {buildProposalHistory} from './proposal-history.js';
import {STORES, BAYS} from './data.js';

const vm = {stores: STORES, bays: BAYS};

test('a new approval is shown separately without manufacturing elapsed outcomes', () => {
  const approval = {storeId: STORES[0].id, bayId: BAYS[0].id, candidateId: 'B', result: {deltaPercent: 98.7}};
  const rows = BAYS.map((bay, index) => ({bay, store: STORES[index], approval: index === 0 ? approval : null,
    response: index === 0 ? {status: 'partial', note: '오늘 2단만 옮겼습니다.', photoName: 'today.jpg'} : null}));
  const html = renderProposalHistory({...vm, review: {rows}});
  const session = html.slice(html.indexOf('<details class="history-session"'));
  assert.equal((html.match(/class="history-card"/g) ?? []).length, 4);
  assert.equal((session.match(/class="review-card"/g) ?? []).length, 1);
  assert.match(session, /아직 2주·4주 관찰치가 없습니다/);
  assert.match(session, /오늘 2단만 옮겼습니다/);
  assert.match(session, /사진 접수됨 · 실행 검증 아님/);
  assert.doesNotMatch(session, /98\.7|history-delta|점포 전체 매출 변화|승인 대기/);
  assert.doesNotMatch(renderProposalHistory({...vm, review: {rows: rows.map(row => ({...row, approval: null}))}}), /history-session/);
});

test('authored record fields, identities, and session comments cannot inject markup', () => {
  const poison = '"><img src=x onerror=alert(1)>';
  const history = buildProposalHistory();
  history.records = [{...history.records[0], id: poison, title: poison, changeSummary: poison,
    ownerNote: poison, followUp: poison, events: [{date: poison, title: poison, note: poison}]}];
  const html = renderProposalHistory({...vm, stores: [{...STORES[0], name: poison}], proposalHistory: history,
    review: {rows: [{approval: {storeId: poison, bayId: poison, candidateId: poison}, response: {note: poison}}]}});
  assert.doesNotMatch(html, /<img|onerror="/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('filtered empty history retains truthful counts and does not fall back to all records', () => {
  const html = renderProposalHistory({...vm, proposalHistory: buildProposalHistory({period: '28', status: 'attention'})});
  assert.equal((html.match(/class="history-card"/g) ?? []).length, 0);
  assert.match(html, /조건에 맞는 적용 이력이 없습니다/);
  assert.match(html, /0건 표시/);
  assert.match(html, /전체 4건/);
  assert.match(html, /data-action="history-period" data-value="28" aria-pressed="true"/);
  assert.match(html, /data-action="history-status" data-value="attention" aria-pressed="true"/);
});
