import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STORE_CATALOG } from '../demo/lab.js';
import { PRODUCTS, SCENARIOS } from '../demo/model.js';
import { adaptPersonaRecord } from '../demo/personas.js';
import { recordDayRun } from '../demo/replay-recorder.js';
import { createWorld } from '../demo/world.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DURATION_SECONDS = 86_400;
const POPULATION = 1_000;
const GENERATOR_VERSION = 'gs2500-experiment-fixture/1';
const RESULTS_PATH = 'app/data/experiment-results.json';
const REPLAY_PATH = 'app/data/samsung-owner-replay.json';

const SOURCE_PATHS = [
  'scripts/generate-experiment-fixture.mjs',
  'demo/model.js',
  'demo/day.js',
  'demo/personas.js',
  'demo/behavior.js',
  'demo/context.js',
  'demo/maps.js',
  'demo/navigation.js',
  'demo/merchandising.js',
  'demo/world.js',
  'demo/lab.js',
  'demo/replay-recorder.js',
  'demo/data/nemotron-korea-sample.json',
];

const CANDIDATES = [
  { candidateId: 'A', scenarioId: 'hq', role: 'standard-reference-candidate' },
  { candidateId: 'B', scenarioId: 'owner', role: 'inventory-priority-candidate' },
  { candidateId: 'C', scenarioId: 'balanced', role: 'balanced-candidate' },
  { candidateId: 'D', scenarioId: 'discovery', role: 'new-product-discovery-candidate' },
].map(candidate => ({
  ...candidate,
  title: SCENARIOS[candidate.scenarioId].title,
  note: SCENARIOS[candidate.scenarioId].note,
  isCurrentLayout: false,
}));

const hashBytes = value => createHash('sha256').update(value).digest('hex');
const hashJson = value => hashBytes(JSON.stringify(value));
const clone = value => JSON.parse(JSON.stringify(value));

async function sourceFingerprint() {
  const files = [];
  for (const path of SOURCE_PATHS) {
    const bytes = await readFile(resolve(ROOT, path));
    files.push({ path, sha256: hashBytes(bytes), bytes: bytes.byteLength });
  }
  return {
    algorithm: 'sha256',
    value: hashBytes(files.map(file => `${file.path}\0${file.sha256}`).join('\n')),
    files,
  };
}

async function loadPersonas() {
  const payload = JSON.parse(await readFile(resolve(ROOT, 'demo/data/nemotron-korea-sample.json'), 'utf8'));
  const catalog = payload.records.map((entry, index) => adaptPersonaRecord(
    entry.row,
    index,
    { ...payload.source, rowIndex: entry.rowIndex },
  ));
  return { payload, catalog };
}

function worldConfig(store, scenarioId) {
  return {
    mode: 'day',
    population: POPULATION,
    duration: DURATION_SECONDS,
    scenario: scenarioId,
    mapId: store.mapId,
    storeId: store.id,
    seed: store.seed,
    stockScale: store.stockScale,
    profileWeights: store.profileWeights,
    runId: `fixture:${store.id}:${scenarioId}`,
  };
}

function finishWorld(world) {
  while (!world.isComplete) {
    const step = world.isQuiescent()
      ? Math.max(.05, world.nextBoundary() - world.time)
      : Math.min(.05, DURATION_SECONDS - world.time);
    world.update(step);
  }
  return world;
}

function summarizeCandidate(candidate, world) {
  const snapshot = world.snapshot();
  const bySku = Object.fromEntries(PRODUCTS.map(product => {
    const analytics = snapshot.analytics.sku[product.id];
    return [product.id, {
      productId: product.id,
      initialTotal: snapshot.initialTotalStock[product.id],
      initialShelf: snapshot.initialStock[product.id],
      initialBackroom: snapshot.initialTotalStock[product.id] - snapshot.initialStock[product.id],
      finalShelf: snapshot.stock[product.id],
      finalBackroom: snapshot.backroomStock[product.id],
      paidUnits: snapshot.paidUnitsBySKU[product.id],
      returnedUnits: snapshot.returnedUnitsBySKU[product.id],
      exposures: analytics.exposures,
      notices: analytics.notices,
      picks: analytics.picks,
      stockoutAttempts: analytics.stockouts,
      paidRevenue: analytics.paidRevenue,
      paidGrossProfit: analytics.paidGrossProfit,
    }];
  }));
  return {
    id: `${snapshot.storeId}:${snapshot.scenario}`,
    storeId: snapshot.storeId,
    candidateId: candidate.candidateId,
    scenario: candidate.scenarioId,
    scenarioId: candidate.scenarioId,
    title: candidate.title,
    role: candidate.role,
    isCurrentLayout: false,
    runId: snapshot.runId,
    time: snapshot.time,
    isComplete: snapshot.isComplete,
    paidRevenue: snapshot.paidRevenue,
    paidGrossProfit: snapshot.paidGrossProfit,
    paidUnits: snapshot.paidUnits,
    completed: snapshot.completed,
    day: clone(snapshot.day),
    stock: clone(snapshot.stock),
    backroomStock: clone(snapshot.backroomStock),
    shelfCapacity: clone(snapshot.shelfCapacity),
    initialTotalStock: clone(snapshot.initialTotalStock),
    replenishments: snapshot.replenishments,
    replenishedUnits: snapshot.replenishedUnits,
    personaSource: clone(snapshot.personaSource),
    levels: clone(snapshot.levels),
    conditions: {
      durationSeconds: DURATION_SECONDS,
      population: POPULATION,
      seed: snapshot.seed,
      potentialScheduleSha256: hashJson(world.potentialSchedule),
      initialTotalStockSha256: hashJson(snapshot.initialTotalStock),
    },
    absolute: {
      revenueKrw: snapshot.paidRevenue,
      grossProfitKrw: snapshot.paidGrossProfit,
      paidUnits: snapshot.paidUnits,
    },
    funnel: {
      potential: snapshot.day.potentialTotal,
      considered: snapshot.day.considered,
      entered: snapshot.day.entered,
      skipped: snapshot.day.skipped,
      skippedReasons: clone(snapshot.day.skippedReasons),
      completedVisits: snapshot.day.completed,
      buyers: snapshot.day.buyers,
      closedWithoutPurchase: snapshot.day.closedWithoutPurchase,
      decisions: snapshot.decisions,
      purchaseDemand: snapshot.purchaseDemand,
    },
    stockout: {
      allAttempts: snapshot.stockoutDemand,
      shelfGapAttempts: snapshot.shelfGapDemand,
      totalStockoutAttempts: snapshot.totalStockoutDemand,
    },
    replenishment: {
      completedTasks: snapshot.replenishments,
      movedUnits: snapshot.replenishedUnits,
    },
    inventory: {
      conserved: snapshot.inventory.conserved,
      identity: snapshot.inventory.identity,
      differences: clone(snapshot.inventory.differences),
      initialTotalStock: clone(snapshot.initialTotalStock),
      initialShelfStock: clone(snapshot.initialStock),
      initialBackroomStock: Object.fromEntries(PRODUCTS.map(product => [
        product.id,
        snapshot.initialTotalStock[product.id] - snapshot.initialStock[product.id],
      ])),
      finalShelfStock: clone(snapshot.stock),
      finalBackroomStock: clone(snapshot.backroomStock),
      paidUnitsBySku: clone(snapshot.paidUnitsBySKU),
      returnedUnitsBySku: clone(snapshot.returnedUnitsBySKU),
      bySku,
    },
    engine: clone(snapshot.engine),
  };
}

async function writeJson(path, value) {
  const target = resolve(ROOT, path);
  const temporary = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, target);
}

export async function generateExperimentFixture({ onProgress = () => {} } = {}) {
  const [{ payload, catalog }, inputFingerprint] = await Promise.all([
    loadPersonas(),
    sourceFingerprint(),
  ]);
  const stores = [];
  let completed = 0;

  for (const store of STORE_CATALOG) {
    const candidates = [];
    for (const candidate of CANDIDATES) {
      const world = createWorld({
        ...worldConfig(store, candidate.scenarioId),
        personaCatalog: catalog,
      });
      finishWorld(world);
      candidates.push(summarizeCandidate(candidate, world));
      completed += 1;
      onProgress({ completed, total: STORE_CATALOG.length * CANDIDATES.length, storeId: store.id, candidateId: candidate.candidateId });
    }
    const conditions = candidates.map(candidate => candidate.conditions);
    stores.push({
      id: store.id,
      storeId: store.id,
      name: store.name,
      subtitle: store.subtitle,
      mapId: store.mapId,
      seed: store.seed,
      stockScale: store.stockScale,
      profileWeights: clone(store.profileWeights),
      sharedConditions: {
        durationSeconds: DURATION_SECONDS,
        population: POPULATION,
        seed: store.seed,
        potentialScheduleSha256: conditions[0].potentialScheduleSha256,
        initialTotalStockSha256: conditions[0].initialTotalStockSha256,
        uniquePersonaSourceIds: POPULATION,
        verifiedAcrossCandidates: conditions.every(condition =>
          condition.seed === conditions[0].seed
          && condition.potentialScheduleSha256 === conditions[0].potentialScheduleSha256
          && condition.initialTotalStockSha256 === conditions[0].initialTotalStockSha256),
      },
      candidates,
    });
  }

  const results = {
    schema: 'gs2500-experiment-results/1',
    schemaVersion: 'gs2500-experiment-results/1',
    generatedBy: {
      name: GENERATOR_VERSION,
      script: 'scripts/generate-experiment-fixture.mjs',
      command: 'node scripts/generate-experiment-fixture.mjs',
    },
    inputFingerprint,
    durationSeconds: DURATION_SECONDS,
    engine: clone(stores[0].candidates[0].engine),
    personaSource: clone(stores[0].candidates[0].personaSource),
    sources: {
      engine: {
        path: 'demo/world.js',
        type: 'local-rule',
        version: stores[0].candidates[0].engine.version,
        behaviorVersion: stores[0].candidates[0].engine.behavior,
        modelCall: 'none',
      },
      personas: {
        path: 'demo/data/nemotron-korea-sample.json',
        adapterPath: 'demo/personas.js',
        dataset: payload.source.dataset,
        publisher: payload.source.publisher,
        revision: payload.source.revision,
        license: payload.source.license,
        synthetic: true,
        realCustomers: false,
        populationRepresentative: false,
        count: payload.records.length,
        recordsSha256: payload.integrity.canonicalRecordsSha256,
      },
    },
    experiment: {
      durationSeconds: DURATION_SECONDS,
      durationLabel: '24 hours',
      populationPerStore: POPULATION,
      storeCount: STORE_CATALOG.length,
      candidateCountPerStore: CANDIDATES.length,
      resultMode: 'deterministic-precomputed-local-rule-engine-result',
      comparisonNotice: 'Absolute 24-hour synthetic experiment results. Candidate A is the standard reference candidate, not the current layout. No current-layout uplift is claimed.',
      candidates: clone(CANDIDATES),
    },
    stores,
  };

  const samsung = STORE_CATALOG.find(store => store.id === 'samsung');
  const samsungOwnerReplay = recordDayRun({
    ...worldConfig(samsung, 'owner'),
    personaCatalog: catalog,
  });
  samsungOwnerReplay.fixtureReference = {
    schemaVersion: 'gs2500-replay-reference/1',
    resultsPath: RESULTS_PATH,
    storeId: 'samsung',
    candidateId: 'B',
    inputFingerprint: inputFingerprint.value,
    generatedBy: GENERATOR_VERSION,
  };

  await writeJson(RESULTS_PATH, results);
  await writeJson(REPLAY_PATH, samsungOwnerReplay);
  return {
    results,
    samsungOwnerReplay,
    paths: {
      results: relative(process.cwd(), resolve(ROOT, RESULTS_PATH)),
      replay: relative(process.cwd(), resolve(ROOT, REPLAY_PATH)),
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const generated = await generateExperimentFixture({
    onProgress: ({ completed, total, storeId, candidateId }) => {
      process.stdout.write(`[${completed}/${total}] ${storeId}:${candidateId}\n`);
    },
  });
  process.stdout.write(`wrote ${generated.paths.results}\n`);
  process.stdout.write(`wrote ${generated.paths.replay}\n`);
}
