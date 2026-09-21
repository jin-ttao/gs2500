import { createWorld } from './world.js';

const MAX_VISITS = 12;
const MAX_FRAMES = 1000;
const SAMPLE_SECONDS = .2;
const ACCOUNTING_SECONDS = 900;
const clone = value => JSON.parse(JSON.stringify(value));

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/** Nominate the same seeded people in every candidate, across the entire day. */
export function selectReplayPotentialIds(schedule, maxVisits = MAX_VISITS) {
  if (!Array.isArray(schedule)) throw new TypeError('A potential-person schedule is required.');
  if (!Number.isSafeInteger(maxVisits) || maxVisits < 0 || maxVisits > MAX_VISITS) {
    throw new RangeError('Replay visits must be between 0 and 12.');
  }
  const likelyEntrants = schedule.filter(person => person.entryDraw < person.needProbability);
  const count = Math.min(maxVisits, likelyEntrants.length);
  return Array.from({ length: count }, (_, index) =>
    likelyEntrants[Math.floor((index + .5) * likelyEntrants.length / count)].id);
}

function frame(agent, time) {
  return {
    time, position: [...agent.position], heading: agent.heading,
    state: agent.state, stateTime: agent.stateTime, velocity: agent.velocity,
    speed: agent.speed, station: agent.station, targetKind: agent.targetKind ?? null,
    target: agent.target ? [...agent.target] : null,
    visited: [...agent.visited], basket: agent.basket.map(product => product.id),
    spent: agent.spent, reachLevel: agent.reachLevel, paid: agent.paid,
    paidAt: agent.paidAt, pending: agent.pending?.id ?? null,
  };
}

function changed(previous, agent) {
  const headingDelta = Math.atan2(Math.sin(agent.heading - previous.heading), Math.cos(agent.heading - previous.heading));
  return previous.state !== agent.state || previous.station !== agent.station
    || previous.paid !== agent.paid || previous.spent !== agent.spent
    || previous.velocity !== agent.velocity
    || previous.reachLevel !== agent.reachLevel || Math.abs(headingDelta) > 1e-6
    || previous.targetKind !== (agent.targetKind ?? null)
    || previous.pending !== (agent.pending?.id ?? null)
    || previous.target?.[0] !== agent.target?.[0] || previous.target?.[1] !== agent.target?.[1];
}

/**
 * Compute one genuine day, then retain bounded observations for summary playback.
 * This is intentionally synchronous: call it inside replay-worker.js in the UI.
 * Presentation duration is independent of the time needed to compute a day.
 */
export function recordDayRun(config = {}, { onProgress, freeze = false } = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('A world configuration is required.');
  if (config.mode !== undefined && config.mode !== 'day') throw new RangeError('Only daily worlds can be recorded.');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function.');
  const options = { ...config, mode: 'day', population: config.population ?? config.limit ?? 1000, duration: config.duration ?? 86400 };
  const world = createWorld(options);
  const duration = options.duration;
  const potentialIds = selectReplayPotentialIds(world.potentialSchedule);
  const nominees = new Set(potentialIds), retained = new Map(), lastObserved = new Map(), accounting = [];
  let nextAccounting = 0;

  function captureAccounting() {
    accounting.push(world.snapshot({ detail: false }));
    onProgress?.({ time: world.time, duration, progress: world.time / duration });
    nextAccounting = Math.min(duration, (Math.floor(world.time / ACCOUNTING_SECONDS) + 1) * ACCOUNTING_SECONDS);
  }

  function captureAgent(agent) {
    if (!nominees.has(agent.id)) return;
    let visit = retained.get(agent.id);
    if (!visit) {
      visit = { id: agent.id, profileIndex: agent.profileIndex, profile: clone(agent.profile),
        enteredAt: agent.enteredAt, endedAt: null, recordedUntil: world.time,
        truncated: false, frames: [], omittedFrames: 0 };
      retained.set(agent.id, visit);
    }
    const previous = visit.frames.at(-1), previousTick = lastObserved.get(agent.id);
    const transition = previousTick && changed(previousTick, agent);
    function retain(observation) {
      if (observation.time <= (visit.frames.at(-1)?.time ?? -Infinity)) return;
      if (visit.frames.length < MAX_FRAMES) {
        visit.frames.push(observation);
        visit.recordedUntil = observation.time;
      } else {
        // Do not connect distant retained points across omitted turns or walls.
        // Playback must stop at recordedUntil, never extrapolate to endedAt.
        visit.truncated = true;
        visit.omittedFrames++;
      }
    }
    // A heading change happened during the last physics tick. Preserve its actual
    // start as well as its end; otherwise a .2s sample could cut across a corner.
    if (transition) retain(previousTick);
    const observation = frame(agent, world.time);
    if (!previous || transition || world.time - previous.time >= SAMPLE_SECONDS - 1e-8) retain(observation);
    lastObserved.set(agent.id, observation);
    if (agent.state === 'done') visit.endedAt = world.time;
  }

  captureAccounting();
  while (!world.isComplete) {
    const prior = world.agents.filter(agent => nominees.has(agent.id));
    const step = world.isQuiescent()
      ? Math.min(world.nextBoundary(), nextAccounting, duration) - world.time
      : Math.min(.05, duration - world.time);
    world.update(step > 1e-9 ? step : Math.min(.05, duration - world.time));
    // Previous references retain the exact terminal pose after world.agents filters it.
    const current = new Map(prior.map(agent => [agent.id, agent]));
    for (const agent of world.agents) if (nominees.has(agent.id)) current.set(agent.id, agent);
    for (const agent of current.values()) captureAgent(agent);
    if (world.time >= nextAccounting - 1e-8 || world.isComplete) captureAccounting();
  }

  const ledger = world.exportLedger();
  const paymentEvents = ledger.events.filter(event => event.type === 'payment').map(event => ({
    id: event.id, type: event.type, time: event.time, agentId: event.agentId,
    profileIndex: event.profileIndex, amount: event.amount, units: event.units,
    grossProfit: event.grossProfit, productIds: [...event.productIds],
  }));
  const visits = [...retained.values()].sort((a, b) => a.enteredAt - b.enteredAt || a.id - b.id);
  const result = {
    schemaVersion: 'day-replay/1', runId: world.runId, mapId: world.mapId,
    scenario: world.scenario, storeId: world.storeId, seed: world.seed, duration,
    config: clone({ ...options, personaCatalog:undefined,
      personaCatalogRef:options.personaCatalog?{...world.personaSource,revision:options.personaCatalog[0].source.revision,sourceIds:world.potentialSchedule.map(p=>p.personaSourceId)}:null,
      runId: world.runId, mapId: world.mapId,
      scenario: world.scenario, storeId: world.storeId, seed: world.seed,
      stockScale: options.stockScale ?? 1, profileWeights: world.profileWeights }),
    potentialIds, visits, accounting, finalSnapshot: world.snapshot(),
    sampling: {
      strategy: 'stratified-seeded-likely-entrants', population: world.potentialSchedule.length,
      nominatedCount: potentialIds.length, recordedCount: visits.length,
      skippedNomineeIds: potentialIds.filter(id => !retained.has(id)),
      maxVisits: MAX_VISITS, maxFramesPerVisit: MAX_FRAMES, intervalSeconds: SAMPLE_SECONDS,
      alsoCapture: ['state', 'heading', 'velocity', 'target', 'station', 'basket', 'payment'],
      truncatedVisitIds: visits.filter(visit => visit.truncated).map(visit => visit.id),
      note: 'Representative actual visits only, not all potential people; replay may overlap them. Positions are recorded, never invented.',
    },
    ledgerSummary: {
      schemaVersion: ledger.schemaVersion, engine: ledger.engine, provenance: ledger.provenance,
      run: ledger.run, day: ledger.day, originalEventCount: ledger.events.length,
      retainedEventCount: paymentEvents.length, truncated: ledger.events.length !== paymentEvents.length,
      omissions: ['All non-payment ledger events', 'Nonessential payment fields'],
      omittedEventTypes: [...new Set(ledger.events.filter(event => event.type !== 'payment').map(event => event.type))].sort(),
      paymentEvents,
    },
  };
  return freeze ? freezeDeep(result) : result;
}
