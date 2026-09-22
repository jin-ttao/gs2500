import { PRODUCTS, PRODUCT_MAP, PROFILES, randomAt } from '../demo/model.js';
import { HOURLY_PROFILES, splitDayInventory } from '../demo/day.js';
import { deriveBehavior, productPolicy } from '../demo/behavior.js';
import { getBay, getStore, getInventory, getPlacements } from './data.js';
import { JEV_HYBRID_ENGINE, buildJevDecisionRequest, applyJevDecision, decisionFingerprint } from './jev-decision.js';

export const FORECAST_ENGINE = Object.freeze({
  id: 'local-analytic-30day-v2', type: 'local-analytic', version: 2,
  label: '로컬 30일 수요·재고 계산', synthetic: true, jevCalled: false,
  personaSource: 'authored-five-category-preference-profiles',
  relationTo3D: '3D는 이 30일 계산에서 기록한 방문·상품 판단을 재생합니다. 별도 구매 판단이나 매출 계산을 실행하지 않습니다.',
});
export const COST_RATIOS = Object.freeze({ meal: .71, drink: .64, snack: .62, health: .68 });
export const FORECAST_ASSUMPTIONS = Object.freeze([
  '실측 판매 예측이 아닌 합성 30일 비교입니다. 전년 동기비 실적 및 4주 후 합성 관찰과 다른 수치입니다.',
  '매일 잠재 고객 1,000회 기회를 기본으로 하며 5개 합성 선호 유형·예산을 사용합니다. Nemotron 개인별 행동/JEV 판단을 실행하지 않습니다.',
  '현재안과 모든 후보는 같은 날짜·시간·방문·선호·예산·난수·배송 계획으로 비교합니다. 후보별 SKU 위치만 바뀝니다.',
  '노출 가정: 1~4층 0.32/0.73/0.78/0.40. 중앙 위치와 보완 상품 이웃 효과는 추정 계수입니다.',
  '초기 매대·창고 수량은 기존 3D와 동일합니다. 매시간 보충 점검 시 매대가 용량의 35% 이하면 창고에서 채웁니다.',
  '2일차부터 매일 06시에 초기 총재고의 26%(내림)를 SKU별로 받는 고정 합성 납품 계획입니다. 실제 발주를 실행하거나 자동 추천하지 않습니다.',
  '합성 방문에서 선택·예산·재고 검사를 통과한 상품만 당일 결제 처리합니다. 결품률은 미충족 구매 수량 / 구매 시도 수량입니다.',
  '매출총이익은 결제액에서 합성 상품 원가만 뺀 값입니다. 인건비·임대료·폐기·유통기한·세금은 반영하지 않습니다.',
  '3D는 같은 30일 계산에서 시간당 최대 1명씩 뽑은 실제 계산 방문·상품 판단의 발췌 재생입니다. 이동·체류 시간은 시각화용 보간이며 동선·혼잡·직원 이동 시간·재방문 기억의 예측이 아닙니다.',
  '대상 24개 SKU와 행사 매대 위치를 계산합니다. 점포의 모든 상품을 포함한 전체 매출이 아니며, 다른 매대 위치 효과는 30일 공식에 넣지 않습니다.',
]);

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const zeroSKU = () => Object.fromEntries(PRODUCTS.map(product => [product.id, 0]));
const sum = object => Object.values(object).reduce((a,b) => a+b, 0);
const LEDGER_METRICS = Object.freeze(['revenue','profit','paidUnits','payments','entered','purchaseDemand','stockoutDemand','shelfGapDemand','totalStockoutDemand','replenishedUnits','receivedUnits']);
const zeroMetrics = () => Object.fromEntries(LEDGER_METRICS.map(key => [key,0]));
const fingerprint = value => {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
};
const complements = (a,b) => (a === 'meal' && b === 'drink') || (a === 'drink' && ['meal','snack'].includes(b)) || (a === 'snack' && b === 'drink') || (a === 'health' && b === 'drink');
const personaCache = new WeakMap();

/** Bounded narrative rules and a price-sensitive numeric prior, not an LLM. */
export function evaluateForecastIntent(profile, product, { behavior = deriveBehavior(profile), policy, spent = 0, basket = [], eventFactor = 1 } = {}) {
  policy ??= productPolicy(profile, product, { behavior, spent, basket, memory: profile.memory ?? [] });
  const affinity = clamp(profile.affinity?.[product.category] ?? .5, 0, 1);
  const novelty = product.isNew ? ((profile.behavior?.noveltySeeking ?? .5) - .5) * .1 : 0;
  const motivation = (.17 + .40 * affinity + (product.promo ? .045 : 0) + policy.missionFit*.6 + novelty) * eventFactor;
  return { allowed: policy.allowed, reasons: policy.reasons,
    probability: policy.allowed ? clamp(motivation + policy.pricePenalty*.8 + policy.memoryAdjustment, 0, .9) : 0,
    priority: affinity + policy.missionFit + policy.memoryAdjustment + policy.pricePenalty + novelty,
    pricePenalty: policy.pricePenalty, missionFit: policy.missionFit };
}

function prepareCatalog(catalog) {
  if (personaCache.has(catalog)) return personaCache.get(catalog);
  const compiled = catalog.map(profile => {
    const behavior = deriveBehavior(profile);
    const policies = Object.fromEntries(PRODUCTS.map(product => {
      const policy = productPolicy(profile, product, { behavior, memory: profile.memory ?? [] });
      // Do not duplicate full narrative/evidence for every SKU or every day.
      return [product.id, { allowed: policy.allowed, reasons: policy.reasons, missionFit: policy.missionFit, pricePenalty: policy.pricePenalty, memoryAdjustment: policy.memoryAdjustment }];
    }));
    return { profile, behavior, policies };
  });
  personaCache.set(catalog, compiled); return compiled;
}

export function eventsForDay(day, mapId) {
  const events = [];
  if ([4,11,18,25].includes(day)) events.push({ id: 'rain-' + day, title: '퇴근 시간 비 가정', startHour: 17, endHour: 20, arrivalMultiplier: .82, categoryMultipliers: { meal: 1.15, drink: .85 }, source: 'authored-30day-event', status: 'assumed' });
  if (day >= 8 && day <= 14) events.push({ id: 'trend-' + day, title: '신상품 관심 상승 가정', startHour: 10, endHour: 21, arrivalMultiplier: 1.03, productMultipliers: { proteinbar: 1.28, gummy: 1.22 }, source: 'authored-30day-event', status: 'assumed' });
  if (day === 20) events.push({ id: 'festival-' + day, title: '인근 주말 행사 가정', startHour: 14, endHour: 21, arrivalMultiplier: mapId === 'cafe' ? 1.3 : 1.12, categoryMultipliers: { snack: 1.22, drink: 1.18 }, source: 'authored-30day-event', status: 'assumed' });
  return events;
}

function configFor({ storeId, bayId, days = 30, populationPerDay = 1000, inventoryOverrides, deliveryScale = .26, replenishmentEnabled = true, personaCatalog } = {}) {
  const store = getStore(storeId), bay = getBay(storeId, bayId);
  if (days !== 30) throw new RangeError('비교 기간은 현재안과 후보 모두 30일이어야 합니다.');
  if (!Number.isSafeInteger(populationPerDay) || populationPerDay < 1 || populationPerDay > 10000) throw new RangeError('하루 잠재 고객 수는 1~10,000 정수여야 합니다.');
  if (!Number.isFinite(deliveryScale) || deliveryScale < 0 || deliveryScale > 10) throw new RangeError('납품 비율은 0~10이어야 합니다.');
  if (typeof replenishmentEnabled !== 'boolean') throw new TypeError('보충 설정이 올바르지 않습니다.');
  if (personaCatalog !== undefined && (!Array.isArray(personaCatalog) || personaCatalog.length < populationPerDay || personaCatalog.some(p => !p?.source?.id || !Number.isSafeInteger(p.budget) || p.budget < 0 || !p.affinity || Object.values(p.affinity).some(n => !Number.isFinite(n) || n < 0 || n > 1) || (p.schedule?.hourlyWeights !== undefined && (!Array.isArray(p.schedule.hourlyWeights) || p.schedule.hourlyWeights.length !== 24 || p.schedule.hourlyWeights.some(n => !Number.isFinite(n) || n < 0)))) || new Set(personaCatalog.map(p => p.source.id)).size !== personaCatalog.length)) throw new TypeError('서로 다른 원본 ID·유효 예산을 가진 페르소나가 잠재 고객 수만큼 필요합니다.');
  if (inventoryOverrides !== undefined && (!inventoryOverrides || typeof inventoryOverrides !== 'object' || Array.isArray(inventoryOverrides) || Object.keys(inventoryOverrides).some(key => !['totalStock','shelfStock','backroomStock','shelfCapacity'].includes(key)))) throw new TypeError('알 수 없는 재고 입력입니다.');
  const inventory = inventoryOverrides ? splitDayInventory({ stockScale: store.stockScale, ...inventoryOverrides }) : getInventory(storeId);
  const delivery = Object.fromEntries(PRODUCTS.map(p => [p.id, Math.floor(inventory.total[p.id] * deliveryScale)]));
  if (PRODUCTS.some(p => !Number.isSafeInteger(inventory.total[p.id] + delivery[p.id] * (days-1)))) throw new RangeError('재고·납품 수량이 안전한 정수 범위를 넘습니다.');
  const compiled = prepareCatalog(personaCatalog ?? PROFILES);
  const selected = personaCatalog ? compiled.map((value,index) => ({value,index})).sort((a,b) => randomAt(a.index,14990,store.seed)-randomAt(b.index,14990,store.seed) || a.index-b.index).slice(0,populationPerDay).map(item=>item.value) : null;
  const personaSource = personaCatalog ? {
    dataset: personaCatalog.metadata?.source?.dataset ?? personaCatalog[0].source.dataset ?? 'caller-provided-source-personas',
    revision: personaCatalog.metadata?.source?.revision ?? personaCatalog[0].source.revision ?? null,
    count: selected.length, synthetic: true, representative: false,
    sourceIds: selected.map(p => p.profile.source.id),
    behaviorInputFingerprint: fingerprint(selected.map(p => ({id:p.profile.source.id,budget:p.profile.budget,affinity:p.profile.affinity,behavior:p.behavior,schedule:p.profile.schedule,memory:p.profile.memory??[]}))),
  } : { dataset:'authored-five-profile-fixture', count:5, synthetic:true, representative:false, sourceIds:[], behaviorInputFingerprint:fingerprint(PROFILES) };
  const cohortKey = fingerprint({ storeId, seed: store.seed, days, populationPerDay, profileWeights: store.profileWeights, eventVersion: 1, personaSource });
  const input = { storeId, bayId, days, populationPerDay, inventory, delivery, replenishmentEnabled, cohortKey };
  return { ...input, store, bay, selected, compiled, personaSource, inputFingerprint: fingerprint(input) };
}

function buildCohort(config) {
  const hourly = HOURLY_PROFILES[config.store.mapId];
  const weightSum = sum(config.store.profileWeights);
  return Array.from({ length: config.days }, (_, dayIndex) => {
    const day = dayIndex + 1, events = eventsForDay(day, config.store.mapId);
    const people = Array.from({ length: config.populationPerDay }, (_, index) => {
      const id = dayIndex * config.populationPerDay + index, random = feature => randomAt(id, feature, config.store.seed);
      let profileDraw = random(14001) * weightSum, profileIndex = 4;
      for (let i = 0; i < 5; i++) { profileDraw -= config.store.profileWeights[i]; if (profileDraw < 0) { profileIndex = i; break; } }
      const compiled = config.selected?.[index] ?? config.compiled[profileIndex];
      const { profile, behavior } = compiled;
      const personalHours = hourly.map((weight,hour) => weight * clamp(profile.schedule?.hourlyWeights?.[hour] ?? 1,.05,3));
      let hourDraw = random(14000) * sum(personalHours), hour = 23;
      for (let i = 0; i < 24; i++) { hourDraw -= personalHours[i]; if (hourDraw < 0) { hour = i; break; } }
      const activeEvents = events.filter(e => hour >= e.startHour && hour < e.endHour);
      const arrivalFactor = activeEvents.reduce((n,e) => n * e.arrivalMultiplier, 1);
      const isWeekend = day % 7 === 0 || day % 7 === 6;
      const calendarFactor = isWeekend ? (['office','express'].includes(config.store.mapId) ? .82 : 1.08) : 1;
      const entered = random(14002) < clamp((.50 + .055 * hourly[hour]) * arrivalFactor * calendarFactor, .15, .9);
      return { id, hour, profileIndex, compiled, sourceId:profile.source?.id??`legacy-profile-${profileIndex}`, entered, activeEvents, maxUnits: Math.min(behavior.maxBasket,random(14003) < .3 ? 1 : 2), budget: profile.budget, random };
    }).sort((a,b) => a.hour-b.hour || a.id-b.id);
    return { day, people, events };
  });
}

function placementScores(config, scenario) {
  const placements = getPlacements(config.storeId, scenario).filter(item => item.fixtureId === config.bay.fixtureId);
  const levels = [.32,.73,.78,.4];
  return Object.fromEntries(placements.map(item => {
    const product = PRODUCT_MAP[item.productId];
    const horizontalNeighbors = item.neighbors.filter(n => n.relation === 'left' || n.relation === 'right');
    const adjacency = horizontalNeighbors.some(n => complements(product.category, PRODUCT_MAP[n.productId].category)) ? .055 : 0;
    const center = 1 - Math.abs(item.column - 3.5) / 2.5;
    return [item.productId, { fixtureId: item.fixtureId, visibility: clamp(levels[item.level - 1] + center * .06 + adjacency, .05, .95), level: item.level, column: item.column, position: [...item.position], locationId: item.locationId, neighbors: item.neighbors.map(n => ({ ...n })) }];
  }));
}

function runScenario(config, cohort, scenario, candidateId, name) {
  const shelf = { ...config.inventory.shelf }, backroom = { ...config.inventory.backroom };
  const capacity = config.inventory.capacity, positions = placementScores(config, scenario);
  const costs = Object.fromEntries(PRODUCTS.map(p => [p.id, Math.round(p.price * COST_RATIOS[p.category] / 10) * 10]));
  const totals = zeroMetrics();
  const paidUnitsBySKU = zeroSKU(), receivedBySKU = zeroSKU(), stockoutBySKU = zeroSKU();
  const daily = [];
  const timeline = [], visits = [], cumulative = { potential: 0, ...zeroMetrics() };
  for (const { day, people, events } of cohort) {
    const row = { day, potential: config.populationPerDay, uniquePersonaCount:config.selected?config.selected.length:5, cohortKey: `${config.cohortKey}:${day}`, ...Object.fromEntries(Object.keys(totals).map(key => [key,0])), paidUnitsBySKU: zeroSKU(), receivedBySKU: zeroSKU(), stockoutBySKU: zeroSKU(), openingInventory: Object.fromEntries(PRODUCTS.map(p => [p.id,shelf[p.id]+backroom[p.id]])), eventIds: events.map(e => e.id), events };
    for (let hour = 0; hour < 24; hour++) {
      const hourPeople = people.filter(person => person.hour === hour);
      const override = config.decisionOverrides?.[candidateId];
      const entrants = hourPeople.filter(person => override?.personId===person.id ? override.applied.entered : person.entered);
      // Sample by the shared cohort, never by purchase outcome or candidate.
      const sampledPersonId = entrants[0]?.id;
      const before = Object.fromEntries(LEDGER_METRICS.map(key => [key,row[key]]));
      const hourlyPaidBySKU = zeroSKU(), hourlyStockoutBySKU = zeroSKU(), transfers = [];
      if (day > 1 && hour === 6) for (const product of PRODUCTS) {
        const qty = config.delivery[product.id]; backroom[product.id] += qty;
        row.receivedUnits += qty; row.receivedBySKU[product.id] += qty; receivedBySKU[product.id] += qty;
        if (qty) transfers.push({ type:'delivery', productId:product.id, quantity:qty });
      }
      if (config.replenishmentEnabled) for (const product of PRODUCTS) {
        const id = product.id;
        if (shelf[id] > capacity[id] * .35) continue;
        const qty = Math.min(capacity[id] - shelf[id], backroom[id]);
        shelf[id] += qty; backroom[id] -= qty; row.replenishedUnits += qty;
        if (qty) transfers.push({ type:'replenishment', productId:id, quantity:qty });
      }
      for (const person of entrants) {
        row.entered++;
        const {profile,behavior,policies} = person.compiled;
        const jev = override?.personId===person.id ? override.applied : null;
        const sampled = person.id === sampledPersonId || Boolean(jev);
        const visibleProductIds = sampled ? [] : null, decisions = sampled ? [] : null;
        const desired = PRODUCTS.map((product,index) => {
          const position = positions[product.id];
          const eventFactor = person.activeEvents.reduce((n,e) => n * (e.productMultipliers?.[product.id] ?? 1) * (e.categoryMultipliers?.[product.category] ?? 1), 1);
          const intent = evaluateForecastIntent(profile,product,{behavior,policy:policies[product.id],eventFactor});
          const visible = person.random(14100 + index) < position.visibility;
          if (sampled && visible) visibleProductIds.push(product.id);
          const wants = person.random(14200 + index) < intent.probability;
          return { product, index, eventFactor, wants: jev ? product.id===jev.productId : visible && wants && intent.allowed, priority: intent.priority + person.random(14300 + index) * .55 };
        }).filter(item => item.wants).sort((a,b) => b.priority-a.priority || a.product.id.localeCompare(b.product.id));
        let spent = 0, paidUnits = 0, attempts = 0; const basket=[];
        for (const { product, index, eventFactor } of desired) {
          if (attempts >= person.maxUnits) break;
          if (spent + product.price > person.budget) continue;
          const intent=evaluateForecastIntent(profile,product,{behavior,spent,basket,eventFactor});
          if(!intent.allowed||(jev?false:person.random(14200+index)>=intent.probability))continue;
          attempts++; row.purchaseDemand++;
          const id = product.id;
          const recordedDecision = sampled ? { productId:id, price:product.price, quantity:1,
            fixtureId:positions[id].fixtureId, locationId:positions[id].locationId,
            position:[...positions[id].position], level:positions[id].level, column:positions[id].column,
            missionFit:intent.missionFit, pricePenalty:intent.pricePenalty,
          } : null;
          if (shelf[id] <= 0) {
            row.stockoutDemand++; row.stockoutBySKU[id]++; stockoutBySKU[id]++;
            hourlyStockoutBySKU[id]++;
            if (backroom[id] > 0) row.shelfGapDemand++; else row.totalStockoutDemand++;
            if (sampled) decisions.push({ ...recordedDecision, outcome:'shelf-empty', backroomAvailable:backroom[id]>0, paidAmount:0 });
            continue;
          }
          shelf[id]--; spent += product.price; paidUnits++; basket.push(id);
          row.paidUnitsBySKU[id]++; paidUnitsBySKU[id]++;
          hourlyPaidBySKU[id]++;
          row.revenue += product.price; row.profit += product.price - costs[id];
          if (sampled) decisions.push({ ...recordedDecision, outcome:'purchased', paidAmount:product.price });
        }
        if (paidUnits) row.payments++;
        row.paidUnits += paidUnits;
        if (sampled) visits.push({ id:person.id, day, hour, sourceId:person.sourceId,
          profileIndex:person.profileIndex, name:profile.name??'합성 방문자',
          // The model resolves time to an hour. The center is only a display anchor.
          second:(day-1)*86400+hour*3600+1800, budget:person.budget,
          paidAmount:spent, paidUnits, visibleProductIds, decisions,
          eventIds:person.activeEvents.map(event=>event.id),
          ...(jev?{decisionSource:'jev',entered:true,decisionAuditId:override.auditId}:{}),
        });
      }
      const skippedJevPerson=override&&!override.applied.entered?hourPeople.find(person=>person.id===override.personId):null;
      if(skippedJevPerson)visits.push({id:skippedJevPerson.id,day,hour,sourceId:skippedJevPerson.sourceId,
        profileIndex:skippedJevPerson.profileIndex,name:skippedJevPerson.compiled.profile.name??'합성 방문자',
        second:(day-1)*86400+hour*3600+1800,budget:skippedJevPerson.budget,paidAmount:0,paidUnits:0,
        visibleProductIds:[...override.applied.visibleProductIds],decisions:[],eventIds:skippedJevPerson.activeEvents.map(event=>event.id),
        entered:false,decisionSource:'jev',decisionAuditId:override.auditId});
      const hourTotals = Object.fromEntries(LEDGER_METRICS.map(key => [key,row[key]-before[key]]));
      cumulative.potential += hourPeople.length;
      for (const key of LEDGER_METRICS) cumulative[key] += hourTotals[key];
      timeline.push({ day, hour, startSecond:(day-1)*86400+hour*3600, endSecond:(day-1)*86400+(hour+1)*3600,
        potential:hourPeople.length, skipped:hourPeople.length-entrants.length, ...hourTotals,
        paidUnitsBySKU:hourlyPaidBySKU, stockoutBySKU:hourlyStockoutBySKU,
        cumulative:{...cumulative}, transfers, shelfStock:{...shelf}, backroomStock:{...backroom},
        eventIds:events.filter(event=>hour>=event.startHour&&hour<event.endHour).map(event=>event.id),
        sampleVisitId:sampledPersonId??null,
      });
    }
    row.skipped = row.potential-row.entered;
    row.closingInventory = Object.fromEntries(PRODUCTS.map(p => [p.id,shelf[p.id]+backroom[p.id]]));
    row.shelfStock = { ...shelf }; row.backroomStock = { ...backroom };
    row.stockoutRate = row.purchaseDemand ? row.stockoutDemand / row.purchaseDemand : 0;
    for (const key of Object.keys(totals)) totals[key] += row[key];
    daily.push(row);
  }
  const warnings = PRODUCTS.filter(p => config.inventory.total[p.id] === 0).map(p => ({ type: 'zero-stock', productId: p.id, message: `${p.name}: 초기 재고 0개 · 구매 불가, 진열 도식에는 빈 위치로 경고` }));
  return { candidateId, scenario, name, ...totals, stockoutRate: totals.purchaseDemand ? totals.stockoutDemand/totals.purchaseDemand : 0,
    potential: config.populationPerDay*config.days, days: config.days, cohortKey: config.cohortKey,
    paidUnitsBySKU, receivedBySKU, stockoutBySKU, daily, positions, costs,
    initialInventory: structuredClone(config.inventory), finalShelf: shelf, finalBackroom: backroom,
    finalInventory: Object.fromEntries(PRODUCTS.map(p => [p.id,shelf[p.id]+backroom[p.id]])), warnings,
    inputFingerprint: config.inputFingerprint, engine: config.decisionOverrides?JEV_HYBRID_ENGINE.id:FORECAST_ENGINE.id, personaSource:config.personaSource.dataset,
    replay:{version:1,source:'same-forecast-ledger',days:config.days,binSeconds:3600,
      cohortKey:config.cohortKey,representation:config.decisionOverrides?'one-recorded-entrant-per-hour-plus-JEV-subject':'one-recorded-entrant-per-hour',
      timing:'hour-resolved; center-second is a display anchor, travel is interpolation',
      accounting:'all visits in hourly bins; detailed sample visits are not the accounting total',
      synthetic:true,jevCalled:Boolean(config.decisionOverrides),timeline,visits},
  };
}

/** Deterministic local computation. No network, model calls, order, or state mutation. */
export function simulateComparison(options = {}) {
  const config = configFor(options), cohort = buildCohort(config);
  return compareScenarios(config,cohort);
}

function compareScenarios(config,cohort) {
  const baseline = runScenario(config, cohort, 'hq', 'current', '현재 진열 · 본사 표준안');
  baseline.deltaPercent = 0; baseline.profitDelta = 0;
  const candidates = config.bay.candidates.map(candidate => {
    const result = runScenario(config, cohort, candidate.scenario, candidate.id, candidate.name);
    return { ...result, deltaPercent: baseline.revenue ? (result.revenue-baseline.revenue)/baseline.revenue*100 : 0,
      profitDelta: result.profit-baseline.profit, revenueDelta: result.revenue-baseline.revenue,
      stockoutRateDelta: result.stockoutRate-baseline.stockoutRate };
  });
  const engine = { ...(config.decisionOverrides?JEV_HYBRID_ENGINE:FORECAST_ENGINE), personaSource: config.personaSource.dataset };
  const assumptions = [...FORECAST_ASSUMPTIONS];
  if(config.selected)assumptions[1]=`매일 동일한 원본 합성 페르소나 ${config.selected.length.toLocaleString('ko-KR')}명의 방문 기회를 다시 샘플링합니다. 원본 ID·서사 기반의 기존 어댑터 예산·선호·목적·기피·기억·가격 민감도를 사용하되, 제한된 로컬 규칙이며 JEV나 일반 언어 이해를 실행하지 않습니다.`;
  assumptions.push('방문 시간은 페르소나의 합성 시간대 가중치를 사용합니다. 수업·출퇴근 등 실제 활동을 추정하지 않으며, 날이 바뀌면 예산·방문 필요를 새로 가정합니다. 과거 방문 결과를 다음 날 기억에 누적하지 않습니다.');
  if(config.decisionOverrides){
    const total=config.populationPerDay*config.days*4;
    engine.decisionCoverage={unit:'potential-person-plan-evaluations',jev:4,local:total-4,total,apiCalls:4,questionsPerCall:2,
      selection:'first-chronological-potential-person-on-day-one-shared-across-four-plans',maxJevItemsPerVisit:1};
    assumptions[1]=`각 안의 첫날 첫 잠재 고객 1명씩 총 4건만 JEV가 입장 여부와 조건부 상품 1개 선택을 판단합니다. 전체 ${total.toLocaleString('ko-KR')}건 중 나머지 ${(total-4).toLocaleString('ko-KR')}건은 기존 로컬 규칙입니다. 전 고객 JEV 시뮬레이션이 아닙니다.`;
    assumptions.push('JEV가 반환한 입장 확률과 상품 분포를 같은 시드 난수로 샘플링합니다. 원본 응답·실제 모델·적용 선택을 기록하며 오류 시 로컬 판단으로 숨겨 대체하지 않습니다.');
  }
  return { storeId: config.storeId, bayId: config.bayId, completed: true, days: 30,
    baseline, candidates, engine, assumptions, personaSource:config.personaSource,
    cohortKey: config.cohortKey, inputFingerprint: config.inputFingerprint,
    inputs: { populationPerDay: config.populationPerDay, seed: config.store.seed, delivery: { ...config.delivery }, replenishmentEnabled: config.replenishmentEnabled, initialInventory: structuredClone(config.inventory), mapId: config.store.mapId, fixtureId: config.bay.fixtureId },
    metricDefinitions: { revenue: '대상 24 SKU · 30일 가상 결제매출(원)', profit: '대상 24 SKU · 30일 가상 매출총이익(원)', stockoutRate: '미충족 구매 수량 / 구매 시도 수량(0~1)', deltaPercent: '현재안 대비 가상 결제매출 변화율(%)' },
    ...(config.decisionOverrides?{decisionAudit:config.decisionAudit,decisionRecords:config.decisionRecords}:{}),
  };
}

function jevRequests(config,cohort) {
  const person=cohort[0].people[0],inventory=structuredClone(config.inventory);
  // No customer precedes this subject. Only opening replenishment can happen;
  // repeated checks in empty hours cannot change it after this first transfer.
  if(config.replenishmentEnabled)for(const product of PRODUCTS){
    const id=product.id;
    if(inventory.shelf[id]<=inventory.capacity[id]*.35){const qty=Math.min(inventory.capacity[id]-inventory.shelf[id],inventory.backroom[id]);inventory.shelf[id]+=qty;inventory.backroom[id]-=qty;}
  }
  return [{scenario:'hq',id:'current'},...config.bay.candidates].map(({scenario,id})=>({
    candidateId:id,person,
    request:buildJevDecisionRequest({config,person,positions:placementScores(config,scenario),inventory,scenario,candidateId:id}),
  }));
}

/** Read-only preview for cost estimates; no API or forecast execution. */
export function previewJevRequests(options={}) {
  const config=configFor(options),cohort=buildCohort(config);
  return jevRequests(config,cohort).map(({candidateId,request})=>({candidateId,request,contextFingerprint:decisionFingerprint(request)}));
}

function applyJevRecords(config,cohort,records) {
  const targets=jevRequests(config,cohort);
  if(!Array.isArray(records)||records.length!==targets.length)throw new TypeError('4개 안의 JEV 원본 판단 기록이 필요합니다.');
  config.decisionOverrides={};config.decisionAudit=[];config.decisionRecords=structuredClone(records);
  for(const [index,{candidateId,person,request}] of targets.entries()){
    const record=records[index],contextFingerprint=decisionFingerprint(request);
    if(record.candidateId!==candidateId||record.contextFingerprint!==contextFingerprint)throw new TypeError('JEV 기록의 점포·페르소나·재고·진열 입력이 일치하지 않습니다.');
    const applied=applyJevDecision(request,record.response,{entryDraw:person.random(14600),purchaseDraw:person.random(14601)});
    const auditId=`${config.storeId}:${candidateId}:${person.id}:${contextFingerprint}`;
    config.decisionOverrides[candidateId]={personId:person.id,applied,auditId};
    const response=record.response;
    config.decisionAudit.push({id:auditId,candidateId,sourceId:person.sourceId,personId:person.id,day:1,hour:person.hour,
      ...applied,model:response.model,requestId:response.requestId??null,upstreamRequestId:response.upstreamRequestId??null,
      latencyMs:response.latencyMs??null,usage:response.usage??null,provider:response.provider??null,cached:response.cached===true,
      applied:true,contextFingerprint,contextSummary:{budget:person.budget,eligibleProductIds:[...request.state.eligibility.eligibleProductIds],
        visibleProductIds:[...request.state.eligibility.visibleProductIds],mission:request.state.persona.mission,
        sourceDataset:request.state.persona.source?.dataset??'authored-five-profile-fixture',eventIds:person.activeEvents.map(event=>event.id)}});
  }
  config.inputFingerprint=decisionFingerprint({localInput:config.inputFingerprint,decisionRecords:records});
  return compareScenarios(config,cohort);
}

/** Offline reproduction consumes recorded, validated JEV answers; no API. */
export function replayComparisonWithJev(options={},decisionRecords) {
  const config=configFor(options),cohort=buildCohort(config);
  return applyJevRecords(config,cohort,decisionRecords);
}

/** Deliberately bounded hybrid: 4 calls/store, never an undisclosed local fallback. */
export async function simulateComparisonWithJev(options={}, {decide,onProgress,signal}={}) {
  if(typeof decide!=='function')throw new TypeError('JEV Decisions 호출 함수가 필요합니다.');
  const checkAbort=()=>{if(signal?.aborted)throw signal.reason??new DOMException('JEV 계산을 취소했습니다.','AbortError');};
  checkAbort();
  const config=configFor(options),cohort=buildCohort(config),records=[];
  const targets=jevRequests(config,cohort);
  for(const {candidateId,person,request} of targets){
    checkAbort();
    onProgress?.({storeId:config.storeId,candidateId,completed:records.length,total:targets.length,status:'requesting'});
    const response=await decide(request,{signal});checkAbort();
    // Validate immediately before making the next paid request.
    applyJevDecision(request,response,{entryDraw:person.random(14600),purchaseDraw:person.random(14601)});
    records.push({candidateId,contextFingerprint:decisionFingerprint(request),response:structuredClone(response)});
    onProgress?.({storeId:config.storeId,candidateId,completed:records.length,total:targets.length,status:'received'});
  }
  checkAbort();return applyJevRecords(config,cohort,records);
}
