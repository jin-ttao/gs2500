import { simulateComparison } from './forecast.js';

/** Shared worker handler; export allows exact ledger parity tests in Node. */
export async function runForecastJob({ bays, personaCatalog, personaMetadata }, { postMessage, beforeStore } = {}) {
  if (!Array.isArray(bays) || !bays.length) throw new TypeError('계산할 매대가 없습니다.');
  if (personaMetadata !== undefined && personaCatalog) {
    // Do not mutate the caller's array in the no-Worker fallback either.
    personaCatalog = [...personaCatalog];
    Object.defineProperty(personaCatalog, 'metadata', { value: personaMetadata, enumerable: false });
  }
  const results = {};
  for (let index = 0; index < bays.length; index++) {
    if (beforeStore) await beforeStore();
    const bay = bays[index];
    results[`${bay.storeId}:${bay.id}`] = simulateComparison({ storeId: bay.storeId, bayId: bay.id, personaCatalog });
    postMessage?.({ type: 'progress', completed: index + 1, total: bays.length });
  }
  return results;
}

// The module can be imported by Node tests or the explicitly absent-Worker
// fallback without registering a window/global message listener.
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  let started = false;
  globalThis.addEventListener('message', async event => {
    if (started) return;
    started = true;
    try {
      if (event.data?.type !== 'calculate') throw new TypeError('지원하지 않는 계산 요청입니다.');
      const results = await runForecastJob(event.data, { postMessage: message => globalThis.postMessage(message) });
      globalThis.postMessage({ type: 'result', results });
    } catch (error) {
      globalThis.postMessage({ type: 'error', name: error.name || 'Error', message: String(error.message || '로컬 계산 실패').slice(0, 1000), ...(error.code ? { code: error.code } : {}) });
    }
  });
}
