import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createDemoServer } from '../server.mjs';
import { createJevDecisionProvider, JEV_MODEL } from '../jev.js';
import { adaptPersonaRecord, createVisitPersona } from '../personas.js';

// Default is fully mocked and never reads an environment key. Only an explicit
// --live flag calls an already-running loopback server, which owns its key/budget.
const live = process.argv.includes('--live');
const unknown = process.argv.slice(2).filter(arg => arg !== '--live' && !arg.startsWith('--base='));
if (unknown.length) throw new Error('Usage: node scripts/verify-jev.mjs [--live --base=http://127.0.0.1:4173]');
let server;
let base = process.argv.find(arg => arg.startsWith('--base='))?.slice(7) ?? 'http://127.0.0.1:4173';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(base)) throw new Error('Only a loopback server is allowed.');
if (!live) {
  server = createDemoServer({ apiKey: 'mock-only-not-a-real-key', maxCalls: 1,
    fetchImpl: async () => new Response(JSON.stringify({ model: JEV_MODEL,
      answers: { decision: { type: 'choice', choice: 'a0', probabilities: { a0: .8, a1: .2 } } },
      usage: { inputTokens: 100, outputTokens: 10 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
}
try {
  const catalog = JSON.parse(await readFile(new URL('../data/nemotron-korea-sample.json', import.meta.url), 'utf8'));
  const sourceRecord = catalog.records[0];
  const persona = createVisitPersona(adaptPersonaRecord(sourceRecord.row, 0, { ...catalog.source, rowIndex: sourceRecord.rowIndex }), 12);
  const context = { schemaVersion: 'entry-context/1', runId: 'explicit-jev-verification', storeId: 'synthetic-office', time: 12 * 3600,
    observer: { agentId: 0, profileIndex: 0, position: [0, 1.6, 0] },
    persona,
    memory: [], constraints: { open: true, hasCapacity: true }, day: { hour: 12 }, activeEvents: [],
    currentNeed: { source: 'authored-assumption', needProbability: .6 }, inventorySummary: { availableCategories: ['meal', 'drink'] },
    allowedActions: [{ type: 'enter' }, { type: 'pass' }],
  };
  const decision = await createJevDecisionProvider({ endpoint: base + '/api/decision' })(context);
  assert.equal(decision.engine.jev.called, true); assert.equal(decision.trace.model, JEV_MODEL);
  assert.ok(['enter', 'pass'].includes(decision.action.type));
  console.log(JSON.stringify({ passed: true, mode: live ? 'explicit-live-single-call' : 'mock-no-cost', action: decision.action,
    personaSource: persona.source, trace: decision.trace, warning: 'This verifies transport and legal action handling, not behavioral accuracy.' }, null, 2));
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
