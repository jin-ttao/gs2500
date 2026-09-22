/** One local calculation job per Worker. No network, retries, or model calls. */
function abortError() {
  return new DOMException('로컬 시뮬레이션 계산을 취소했습니다.', 'AbortError');
}

function normalizeJob(bays, personaCatalog) {
  if (!Array.isArray(bays) || !bays.length || bays.some(bay => !bay || typeof bay.storeId !== 'string' || typeof bay.id !== 'string')) {
    throw new TypeError('계산할 점포·매대 목록이 필요합니다.');
  }
  const targets = bays.map(({ storeId, id }) => ({ storeId, id }));
  if (new Set(targets.map(bay => `${bay.storeId}:${bay.id}`)).size !== targets.length) throw new TypeError('중복된 점포·매대 계산입니다.');
  if (personaCatalog !== undefined && !Array.isArray(personaCatalog)) throw new TypeError('페르소나 목록 형식을 확인해주세요.');
  return {
    bays: targets,
    personaCatalog,
    // loadPersonaCatalog() uses a non-enumerable property. Structured cloning
    // arrays drops that property; carry it explicitly to preserve provenance.
    personaMetadata: personaCatalog?.metadata,
  };
}

function validateResults(results, bays) {
  if (!results || typeof results !== 'object' || Array.isArray(results) || Object.keys(results).length !== bays.length || bays.some(bay => {
    const result = results[`${bay.storeId}:${bay.id}`];
    return !result?.completed || result.storeId !== bay.storeId || result.bayId !== bay.id;
  })) throw new Error('계산 결과의 점포·매대 연결을 확인할 수 없습니다.');
  return results;
}

/**
 * Calculates the existing 30-day comparisons sequentially off the UI thread.
 * WorkerImpl is injectable for tests. Only absent Worker support permits the
 * yielded in-thread fallback; startup/runtime/message errors are never retried.
 */
export async function calculateComparisons({ bays, personaCatalog, onProgress, signal, WorkerImpl = globalThis.Worker } = {}) {
  if (signal?.aborted) throw abortError();
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('진행 콜백이 올바르지 않습니다.');
  const job = normalizeJob(bays, personaCatalog);
  const report = message => onProgress?.({ completed: message.completed, total: message.total });

  if (WorkerImpl === undefined || WorkerImpl === null) {
    // Older browsers / Node only. Do not substitute persona data or formulas.
    const { runForecastJob } = await import('./forecast-worker.js');
    if (signal?.aborted) throw abortError();
    const results = await runForecastJob(job, {
      postMessage: message => { if (message.type === 'progress') report(message); },
      beforeStore: async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (signal?.aborted) throw abortError();
      },
    });
    if (signal?.aborted) throw abortError();
    return validateResults(results, job.bays);
  }
  if (typeof WorkerImpl !== 'function') throw new TypeError('Worker 구현이 올바르지 않습니다.');

  return new Promise((resolve, reject) => {
    let worker, settled = false, completed = 0;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      if (worker) {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onMessageError);
        worker.terminate();
      }
    };
    const finish = (error, results) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve(results);
    };
    const onAbort = () => finish(abortError());
    const onError = event => {
      event.preventDefault?.();
      finish(new Error(event.message || '로컬 계산 Worker를 실행하지 못했습니다.'));
    };
    const onMessageError = () => finish(new Error('로컬 계산 결과를 전달하지 못했습니다.'));
    const onMessage = event => {
      if (settled) return;
      const message = event.data;
      try {
        if (message?.type === 'progress') {
          if (message.total !== job.bays.length || message.completed !== completed + 1) throw new Error('로컬 계산 진행 정보가 올바르지 않습니다.');
          completed = message.completed;
          report(message);
        } else if (message?.type === 'result') {
          if (completed !== job.bays.length) throw new Error('완료되지 않은 계산 결과입니다.');
          finish(null, validateResults(message.results, job.bays));
        } else if (message?.type === 'error') {
          const error = new Error(message.message || '로컬 계산 중 오류가 발생했습니다.');
          error.name = message.name || 'Error';
          if (message.code) error.code = message.code;
          finish(error);
        } else throw new Error('알 수 없는 로컬 계산 응답입니다.');
      } catch (error) { finish(error); }
    };
    try {
      worker = new WorkerImpl(new URL('./forecast-worker.js', import.meta.url), { type: 'module' });
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.addEventListener('messageerror', onMessageError);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      worker.postMessage({ type: 'calculate', ...job });
    } catch (error) { finish(error); }
  });
}
