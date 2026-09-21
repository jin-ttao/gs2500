import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createWorld} from '../world.js';
import {LAB_STORES} from '../lab.js';
import {PRODUCTS,PRODUCT_MAP,SCENARIOS} from '../model.js';
import {loadPersonaCatalog,PERSONA_CATALOG_URL} from '../personas.js';
import {productPolicy} from '../behavior.js';

// Reproducible, API-free counterfactual audit. The original public synthetic
// catalog is loaded through the same provenance-validating adapter as the app.
const sourceBytes=await readFile(PERSONA_CATALOG_URL),payload=JSON.parse(sourceBytes.toString('utf8'));
const sha256=value=>createHash('sha256').update(value).digest('hex');
const dataIntegrity={fileSha256:sha256(sourceBytes),canonicalRecordsSha256:sha256(JSON.stringify(payload.records))};
assert.equal(dataIntegrity.canonicalRecordsSha256,payload.integrity.canonicalRecordsSha256,'canonical records checksum');
const personaCatalog=await loadPersonaCatalog({fetchImpl:async()=>({ok:true,json:async()=>payload})});
const profilesById=new Map(personaCatalog.map(persona=>[persona.source.id,persona]));
const started=performance.now(),results=[],traces=new Map(),schedules=new Map();
const signature=value=>JSON.stringify(value);
let checkedPayments=0,checkedStockIdentities=0,checkedHardPolicies=0;

for(const store of LAB_STORES)for(const scenario of Object.keys(SCENARIOS)){
  const runStarted=performance.now(),id=store.id+':'+scenario;
  const world=createWorld({mode:'day',population:1000,duration:86400,scenario,mapId:store.mapId,
    storeId:store.id,seed:store.seed,stockScale:store.stockScale,profileWeights:store.profileWeights,
    personaCatalog,runId:'behavior-audit-v3:'+id});
  assert.equal(new Set(world.potentialSchedule.map(person=>person.personaSourceId)).size,1000);
  if(schedules.has(store.id))assert.deepEqual(world.potentialSchedule,schedules.get(store.id),'paired source cohort and arrival opportunities');
  else schedules.set(store.id,world.potentialSchedule);
  while(!world.isComplete){
    const step=world.isQuiescent()?Math.min(86400,world.nextBoundary())-world.time:30;
    world.update(step>1e-8?step:.05);
    assert.equal(world.decisionError,null);assert.equal(world.modelCalls,0);
  }
  const ledger=world.exportLedger(),snapshot=world.snapshot({detail:false});
  assert.equal(world.time,86400);assert.equal(world.day.considered,1000);
  assert.equal(world.day.entered+world.day.skipped,1000);assert.equal(world.agents.length,0);
  assert.ok(ledger.events.every(event=>event.time>=0&&event.time<=86400));
  const people=new Map(world.potentialSchedule.map(person=>[person.id,{sourceId:person.personaSourceId,entered:false,basket:[],stations:[],targets:[]}]));
  const payments=ledger.events.filter(event=>event.type==='payment'),paidIds=new Set();
  assert.equal(payments.reduce((sum,event)=>sum+event.amount,0),world.paidRevenue);
  assert.equal(payments.reduce((sum,event)=>sum+event.grossProfit,0),world.paidGrossProfit);
  assert.equal(payments.length,world.day.buyers);
  for(const event of ledger.events){
    if(event.type==='enter')people.get(event.agentId).entered=true;
    if(event.type==='browse')people.get(event.agentId).stations.push(event.station);
    if(event.type==='destinationSelected')people.get(event.agentId).targets.push({station:event.destination,position:event.position});
  }
  for(const payment of payments){
    const person=people.get(payment.agentId),profile=profilesById.get(person.sourceId);
    assert.ok(person.entered);assert.equal(payment.personaSourceId,person.sourceId);
    assert.ok(!paidIds.has(payment.agentId),'only one checkout per visit');paidIds.add(payment.agentId);
    assert.ok(payment.amount<=profile.budget);assert.ok(payment.amount>=0);
    assert.equal(payment.amount,payment.productIds.reduce((sum,id)=>sum+PRODUCT_MAP[id].price,0));
    assert.equal(new Set(payment.productIds).size,payment.productIds.length);assert.ok(payment.productIds.length<=3);
    let spent=0;const basket=[];
    for(const id of payment.productIds){
      const policy=productPolicy(profile,PRODUCT_MAP[id],{basket,spent,memory:profile.memory??[]});
      assert.equal(policy.allowed,true,`${world.runId} ${person.sourceId} ${id}: ${policy.reasons.join(',')}`);
      basket.push(id);spent+=PRODUCT_MAP[id].price;checkedHardPolicies++;
    }
    person.basket=[...payment.productIds].sort();checkedPayments++;
  }
  for(const product of PRODUCTS){
    assert.equal(world.initialTotalStock[product.id],world.stock[product.id]+world.backroomStock[product.id]+world.paidUnitsBySKU[product.id],id+' '+product.id+' conservation');
    assert.ok(world.stock[product.id]>=0&&world.stock[product.id]<=world.shelfCapacity[product.id]);
    assert.ok(world.backroomStock[product.id]>=0);checkedStockIdentities++;
  }
  assert.equal(snapshot.inventory.conserved,true);
  const result={id,entered:world.day.entered,skipped:world.day.skipped,buyers:world.day.buyers,
    revenue:world.paidRevenue,grossProfit:world.paidGrossProfit,stockoutDemand:world.stockoutDemand,
    replenishments:world.replenishments,paidUnits:world.paidUnits,
    ledgerEvents:ledger.events.length,browseEvents:ledger.events.filter(e=>e.type==='browse').length,
    destinationEvents:ledger.events.filter(e=>e.type==='destinationSelected').length,
    wallSeconds:Number(((performance.now()-runStarted)/1000).toFixed(3))};
  results.push(result);traces.set(id,people);
  console.log(JSON.stringify({type:'run-complete',...result}));
}

const comparisons=[];
for(const store of LAB_STORES)for(const scenario of Object.keys(SCENARIOS).filter(key=>key!=='hq')){
  const baseline=traces.get(store.id+':hq'),candidate=traces.get(store.id+':'+scenario);
  const comparison={store:store.id,baseline:'hq',candidate:scenario,cohort:1000,commonEntered:0,entryChanged:0,
    basketChangedAllPotentials:0,basketChangedAmongCommonEntered:0,stationOrderChangedAmongCommonEntered:0,
    approachTargetsChangedAmongCommonEntered:0,approachTargetsChangedWithSameStationOrder:0};
  for(const [id,a] of baseline){
    const b=candidate.get(id);assert.equal(a.sourceId,b.sourceId);
    if(a.entered!==b.entered)comparison.entryChanged++;
    if(signature(a.basket)!==signature(b.basket))comparison.basketChangedAllPotentials++;
    if(!(a.entered&&b.entered))continue;
    comparison.commonEntered++;
    const stationsChanged=signature(a.stations)!==signature(b.stations),targetsChanged=signature(a.targets)!==signature(b.targets);
    if(signature(a.basket)!==signature(b.basket))comparison.basketChangedAmongCommonEntered++;
    if(stationsChanged)comparison.stationOrderChangedAmongCommonEntered++;
    if(targetsChanged)comparison.approachTargetsChangedAmongCommonEntered++;
    if(targetsChanged&&!stationsChanged)comparison.approachTargetsChangedWithSameStationOrder++;
  }
  comparisons.push(comparison);
}
assert.ok(comparisons.some(row=>row.basketChangedAmongCommonEntered>0),'candidate layouts must change at least one paired purchasing outcome');
assert.ok(comparisons.some(row=>row.stationOrderChangedAmongCommonEntered>0),'candidate products must affect station ordering');
assert.ok(comparisons.some(row=>row.approachTargetsChangedWithSameStationOrder>0),'exact product placement must affect approach points beyond station ordering');
console.log(JSON.stringify({type:'audit-result',passed:true,engine:'local-rule/3',externalModelCalls:0,
  personaCount:personaCatalog.length,source:payload.source,dataIntegrity,stores:LAB_STORES.length,scenarios:Object.keys(SCENARIOS).length,
  checkedPayments,checkedStockIdentities,checkedHardPolicies,wallSeconds:Number(((performance.now()-started)/1000).toFixed(3)),results,comparisons},null,2));
