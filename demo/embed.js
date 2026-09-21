import { createSummaryReplay } from './summary-replay.js';
import { createStore } from './store.js';
import { SCENARIOS } from './model.js';

export const DEFAULT_RECORD_URL = '/data/samsung-owner-replay.json';
export const REPLAY_DURATION = 24;

const $ = selector => document.querySelector(selector);
const won = new Intl.NumberFormat('ko-KR', { style:'currency', currency:'KRW', maximumFractionDigits:0 });
const integer = new Intl.NumberFormat('ko-KR', { maximumFractionDigits:0 });

export function resolveRecordUrl(search = '') {
  const value = new URLSearchParams(search).get('record')?.trim();
  return value || DEFAULT_RECORD_URL;
}

export function unwrapRecord(payload) {
  const record = payload?.record ?? payload;
  if (!record || record.schemaVersion !== 'day-replay/1') throw new TypeError('day-replay/1 기록이 아닙니다.');
  return record;
}

export function resultMetrics(record) {
  const final = record?.finalSnapshot;
  if (!final || !Number.isFinite(final.paidRevenue) || !Number.isFinite(final.paidGrossProfit)) {
    throw new TypeError('24시간 최종 결제 결과가 없습니다.');
  }
  const entered = final.day?.entered ?? final.spawned;
  const buyers = final.day?.buyers ?? final.buyers;
  if (!Number.isFinite(entered) || !Number.isFinite(buyers)) throw new TypeError('24시간 입장 또는 구매 결과가 없습니다.');
  return { revenue:final.paidRevenue, profit:final.paidGrossProfit, entered, buyers };
}

function clock(seconds) {
  const bounded = Math.max(0, Math.min(86400, seconds));
  if (bounded >= 86400) return '24:00:00';
  return [Math.floor(bounded / 3600), Math.floor(bounded / 60) % 60, Math.floor(bounded) % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

function replayClock(seconds) {
  const bounded = Math.max(0, Math.min(REPLAY_DURATION, seconds));
  return `00:${String(Math.floor(bounded)).padStart(2, '0')} / 00:${REPLAY_DURATION}`;
}

function setFailure(error, recordUrl) {
  const loading = $('#loading');
  loading.classList.add('is-error');
  loading.querySelector('b').textContent = '사전 계산 기록을 열지 못했습니다.';
  $('#loadingDetail').textContent = `${error?.message || '알 수 없는 오류'} 기록 URL과 정적 배포 파일을 확인해주세요.`;
  $('#replayState').textContent = '로딩 실패';
  $('#recordId').textContent = '기록 오류';
  $('#recordSource').textContent = `record: ${recordUrl}`;
  for (const button of document.querySelectorAll('.controls button')) button.disabled = true;
  window.parent.postMessage({ type:'gs2500-embed-error', message:'3D 사전 계산 기록을 불러오지 못했습니다.' }, location.origin);
}

function setFinalMetrics(record) {
  const values = resultMetrics(record);
  $('#revenueValue').textContent = won.format(values.revenue);
  $('#profitValue').textContent = won.format(values.profit);
  $('#enteredValue').textContent = `${integer.format(values.entered)}명`;
  $('#buyersValue').textContent = `${integer.format(values.buyers)}명`;
  const engine = record.finalSnapshot.engine?.type ?? record.ledgerSummary?.engine?.type ?? 'local';
  $('#engineLabel').textContent = ['local', 'local-rule'].includes(engine) ? '로컬 규칙 · API 미호출' : `기록된 ${engine} 판단`;
}

async function loadRecord(recordUrl) {
  const response = await fetch(recordUrl, { headers:{ accept:'application/json' }, cache:'no-store' });
  if (!response.ok) throw new Error(`기록 요청 실패 (${response.status})`);
  return unwrapRecord(await response.json());
}

async function boot() {
  const recordUrl = resolveRecordUrl(location.search);
  $('#recordSource').textContent = `record: ${recordUrl}`;
  let record;
  try {
    record = await loadRecord(recordUrl);
    resultMetrics(record);
  } catch (error) {
    setFailure(error, recordUrl);
    return;
  }

  const replay = createSummaryReplay([record], { duration:REPLAY_DURATION });
  const recordId = record.id ?? record.runId;
  const world = replay.getWorld(recordId);
  const store = await createStore($('#webgl'), agent => {
    $('#visitCount').textContent = agent ? `화면에 겹친 대표 방문 ${world.agents.length}명 · ${agent.profile.name}` : '화면에 겹친 대표 방문 0명';
  });
  store.setWorld(world);
  store.selectLevel(3);
  setFinalMetrics(record);

  const scenario = SCENARIOS[record.scenario];
  $('#candidateName').textContent = `${record.storeId} · ${scenario?.title ?? record.scenario}`;
  $('#recordId').textContent = recordId;
  $('#loading').hidden = true;
  for (const button of document.querySelectorAll('.controls button')) button.disabled = false;
  window.parent.postMessage({ type:'gs2500-embed-ready' }, location.origin);

  function renderState() {
    const percent = replay.progress * 100;
    $('#progressBar').style.width = `${percent}%`;
    $('#dayClock').textContent = clock(replay.dayTime);
    $('#replayTime').textContent = replayClock(replay.elapsed);
    $('#replayState').textContent = replay.isComplete ? '재생 완료' : replay.running ? '재생 중' : '일시정지';
    $('#playButton').disabled = replay.running;
    $('#pauseButton').disabled = !replay.running;
    $('#visitCount').textContent ||= `화면에 겹친 대표 방문 ${world.agents.length}명`;
  }

  $('#playButton').addEventListener('click', () => {
    replay.start({ reset:replay.isComplete });
    renderState();
  });
  $('#pauseButton').addEventListener('click', () => {
    replay.pause();
    renderState();
  });
  $('#restartButton').addEventListener('click', () => {
    replay.start({ reset:true });
    renderState();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      replay.pause();
      renderState();
    }
  });

  let prior = performance.now();
  function frame(now) {
    const seconds = Math.min(.1, Math.max(0, (now - prior) / 1000));
    prior = now;
    replay.advance(seconds);
    store.syncWorld(world);
    renderState();
    requestAnimationFrame(frame);
  }
  replay.start();
  renderState();
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  boot().catch(error => setFailure(error, resolveRecordUrl(location.search)));
}
