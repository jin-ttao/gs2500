import { recordDayRun } from './replay-recorder.js';

/** Exported for mocked protocol tests; no worker/global side effects in Node. */
export async function prepareRuns(message, { postMessage, record = recordDayRun } = {}) {
  if (typeof postMessage !== 'function') throw new TypeError('A message sink is required.');
  const requestId = message?.requestId;
  if (message?.type !== 'prepare' || !Array.isArray(message.runs) || !message.runs.length
    || message.runs.length > 36 || new Set(message.runs.map(run => run?.id)).size !== message.runs.length
    || message.runs.some(run => !run || typeof run.id !== 'string' || !run.id.trim()
      || !run.config || typeof run.config !== 'object' || Array.isArray(run.config))) {
    postMessage({ type: 'error', requestId, runId: null, error: 'Invalid replay preparation request.' });
    return;
  }
  let succeeded = 0, failed = 0;
  for (const [index, run] of message.runs.entries()) {
    try {
      const result = record(run.config, { onProgress: progress =>
        postMessage({ type: 'progress', requestId, runId: run.id, index, total: message.runs.length, ...progress }) });
      postMessage({ type: 'result', requestId, runId: run.id, index, total: message.runs.length, result });
      succeeded++;
    } catch {
      // Never forward configuration, credentials, or raw exceptions to the page.
      postMessage({ type: 'error', requestId, runId: run.id, index, error: 'Daily replay recording failed.' });
      failed++;
    }
    // Allow worker control messages between runs; the UI can terminate the worker immediately.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  postMessage({ type: 'complete', requestId, total: message.runs.length, succeeded, failed });
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof document === 'undefined') {
  let busy = false;
  self.addEventListener('message', async ({ data }) => {
    if (busy) {
      self.postMessage({ type: 'error', requestId: data?.requestId, runId: null, error: 'Replay preparation is already running.' });
      return;
    }
    busy = true;
    try { await prepareRuns(data, { postMessage: message => self.postMessage(message) }); }
    finally { busy = false; }
  });
}
