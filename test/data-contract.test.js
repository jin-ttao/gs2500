import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = path => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
const hashBytes = value => createHash('sha256').update(value).digest('hex');
const hashJson = value => hashBytes(JSON.stringify(value));
const results = readJson('app/data/experiment-results.json');
const replay = readJson('app/data/samsung-owner-replay.json');

let modules;
async function loadModules() {
  if (!modules) {
    const [lab, model, personas, world] = await Promise.all([
      import('../demo/lab.js'),
      import('../demo/model.js'),
      import('../demo/personas.js'),
      import('../demo/world.js'),
    ]);
    const payload = readJson('demo/data/nemotron-korea-sample.json');
    const catalog = payload.records.map((entry, index) => personas.adaptPersonaRecord(
      entry.row,
      index,
      { ...payload.source, rowIndex: entry.rowIndex },
    ));
    modules = { ...lab, ...model, ...world, catalog };
  }
  return modules;
}

test('fixture provenance and source fingerprint match the checked-in inputs', () => {
  assert.equal(results.schemaVersion, 'gs2500-experiment-results/1');
  assert.equal(results.schema, results.schemaVersion);
  assert.equal(results.generatedBy.script, 'scripts/generate-experiment-fixture.mjs');
  assert.equal(results.experiment.durationSeconds, 86_400);
  assert.equal(results.durationSeconds, 86_400);
  assert.equal(results.experiment.durationLabel, '24 hours');
  assert.equal(results.experiment.storeCount, 9);
  assert.equal(results.experiment.candidateCountPerStore, 4);
  assert.equal(results.sources.engine.type, 'local-rule');
  assert.equal(results.engine.type, 'local-rule');
  assert.equal(results.sources.engine.modelCall, 'none');
  assert.equal(results.sources.personas.synthetic, true);
  assert.equal(results.sources.personas.realCustomers, false);
  assert.equal(results.sources.personas.count, 1_000);
  assert.equal(results.personaSource.count, 1_000);

  const actual = results.inputFingerprint.files.map(file => {
    const bytes = readFileSync(resolve(ROOT, file.path));
    assert.equal(bytes.byteLength, file.bytes, file.path);
    assert.equal(hashBytes(bytes), file.sha256, file.path);
    return `${file.path}\0${file.sha256}`;
  });
  assert.equal(hashBytes(actual.join('\n')), results.inputFingerprint.value);
});

test('nine stores have A/B/C/D results and A is only a standard reference candidate', () => {
  assert.equal(results.stores.length, 9);
  assert.equal(new Set(results.stores.map(store => store.storeId)).size, 9);
  assert.deepEqual(results.experiment.candidates.map(candidate => candidate.candidateId), ['A', 'B', 'C', 'D']);
  assert.deepEqual(results.experiment.candidates.map(candidate => candidate.scenarioId), ['hq', 'owner', 'balanced', 'discovery']);
  const candidateA = results.experiment.candidates[0];
  assert.equal(candidateA.role, 'standard-reference-candidate');
  assert.equal(candidateA.isCurrentLayout, false);
  assert.match(results.experiment.comparisonNotice, /not the current layout/);

  for (const store of results.stores) {
    assert.equal(store.id, store.storeId);
    assert.deepEqual(store.candidates.map(candidate => candidate.candidateId), ['A', 'B', 'C', 'D']);
    assert.equal(store.sharedConditions.verifiedAcrossCandidates, true);
    assert.equal(store.sharedConditions.uniquePersonaSourceIds, 1_000);
    assert.ok(store.candidates.every(candidate => candidate.isCurrentLayout === false));
  }
});

test('stored condition hashes are produced by equal seed, stock and schedules in the real engine', async () => {
  const { STORE_CATALOG, createWorld, catalog } = await loadModules();
  const scenarioByCandidate = { A: 'hq', B: 'owner', C: 'balanced', D: 'discovery' };

  for (const stored of results.stores) {
    const store = STORE_CATALOG.find(item => item.id === stored.storeId);
    assert.ok(store, stored.storeId);
    const schedules = [];
    const stocks = [];
    for (const candidate of stored.candidates) {
      const world = createWorld({
        mode: 'day',
        population: 1_000,
        duration: 86_400,
        scenario: scenarioByCandidate[candidate.candidateId],
        mapId: store.mapId,
        storeId: store.id,
        seed: store.seed,
        stockScale: store.stockScale,
        profileWeights: store.profileWeights,
        personaCatalog: catalog,
        runId: candidate.runId,
      });
      const scheduleHash = hashJson(world.potentialSchedule);
      const stockHash = hashJson(world.initialTotalStock);
      schedules.push(scheduleHash);
      stocks.push(stockHash);
      assert.equal(candidate.conditions.seed, store.seed);
      assert.equal(candidate.conditions.durationSeconds, 86_400);
      assert.equal(candidate.conditions.population, 1_000);
      assert.equal(candidate.conditions.potentialScheduleSha256, scheduleHash);
      assert.equal(candidate.conditions.initialTotalStockSha256, stockHash);
      assert.equal(new Set(world.potentialSchedule.map(person => person.personaSourceId)).size, 1_000);
    }
    assert.equal(new Set(schedules).size, 1, `${store.id} schedule`);
    assert.equal(new Set(stocks).size, 1, `${store.id} initial total stock`);
    assert.equal(stored.sharedConditions.potentialScheduleSha256, schedules[0]);
    assert.equal(stored.sharedConditions.initialTotalStockSha256, stocks[0]);
  }
});

test('all final results contain absolute money, funnel, stockout and conserved inventory', async () => {
  const { PRODUCTS } = await loadModules();
  const productIds = PRODUCTS.map(product => product.id);
  for (const store of results.stores) for (const candidate of store.candidates) {
    assert.equal(candidate.id, `${store.id}:${candidate.scenario}`);
    assert.equal(candidate.storeId, store.id);
    assert.equal(candidate.time, 86_400);
    assert.equal(candidate.isComplete, true);
    assert.equal(candidate.paidRevenue, candidate.absolute.revenueKrw);
    assert.equal(candidate.paidGrossProfit, candidate.absolute.grossProfitKrw);
    assert.equal(candidate.completed, candidate.day.completed);
    assert.deepEqual(candidate.stock, candidate.inventory.finalShelfStock);
    assert.deepEqual(candidate.backroomStock, candidate.inventory.finalBackroomStock);
    assert.deepEqual(candidate.initialTotalStock, candidate.inventory.initialTotalStock);
    assert.ok(Number.isSafeInteger(candidate.absolute.revenueKrw));
    assert.ok(Number.isSafeInteger(candidate.absolute.grossProfitKrw));
    assert.ok(candidate.absolute.revenueKrw >= candidate.absolute.grossProfitKrw);
    assert.equal(candidate.funnel.potential, 1_000);
    assert.equal(candidate.funnel.considered, 1_000);
    assert.equal(candidate.funnel.entered + candidate.funnel.skipped, 1_000);
    assert.ok(candidate.funnel.buyers <= candidate.funnel.entered);
    assert.equal(candidate.inventory.conserved, true);
    assert.deepEqual(Object.keys(candidate.inventory.bySku), productIds);
    assert.ok(Object.values(candidate.inventory.differences).every(value => value === 0));

    let paidUnits = 0;
    for (const productId of productIds) {
      const row = candidate.inventory.bySku[productId];
      paidUnits += row.paidUnits;
      assert.equal(row.initialTotal, row.finalShelf + row.finalBackroom + row.paidUnits);
      assert.equal(row.initialShelf + row.initialBackroom, row.initialTotal);
    }
    assert.equal(paidUnits, candidate.absolute.paidUnits);
    assert.equal(candidate.stockout.allAttempts, candidate.stockout.shelfGapAttempts + candidate.stockout.totalStockoutAttempts);
  }
});

test('Samsung store candidate B replay is a genuine recordDayRun artifact linked to its final result', () => {
  assert.equal(replay.schemaVersion, 'day-replay/1');
  assert.equal(replay.storeId, 'samsung');
  assert.equal(replay.scenario, 'owner');
  assert.equal(replay.seed, 11);
  assert.equal(replay.duration, 86_400);
  assert.equal(replay.finalSnapshot.time, 86_400);
  assert.equal(replay.finalSnapshot.isComplete, true);
  assert.equal(replay.finalSnapshot.day.considered, 1_000);
  assert.equal(replay.finalSnapshot.inventory.conserved, true);
  assert.equal(replay.sampling.population, 1_000);
  assert.ok(replay.visits.length > 0);
  assert.ok(replay.visits.every(visit => visit.frames.length > 0));
  assert.equal(replay.fixtureReference.storeId, 'samsung');
  assert.equal(replay.fixtureReference.candidateId, 'B');
  assert.equal(replay.fixtureReference.inputFingerprint, results.inputFingerprint.value);

  const candidate = results.stores.find(store => store.storeId === 'samsung')
    .candidates.find(item => item.candidateId === 'B');
  assert.equal(replay.finalSnapshot.paidRevenue, candidate.absolute.revenueKrw);
  assert.equal(replay.finalSnapshot.paidGrossProfit, candidate.absolute.grossProfitKrw);
  assert.equal(replay.finalSnapshot.paidUnits, candidate.absolute.paidUnits);
  assert.deepEqual(replay.finalSnapshot.initialTotalStock, candidate.inventory.initialTotalStock);
  assert.deepEqual(replay.finalSnapshot.stock, candidate.inventory.finalShelfStock);
  assert.deepEqual(replay.finalSnapshot.backroomStock, candidate.inventory.finalBackroomStock);
});
