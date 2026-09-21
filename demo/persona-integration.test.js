import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adaptPersonaRecord, PERSONA_CATALOG_URL} from './personas.js';
import {createDayPlan} from './day.js';
import {createWorld} from './world.js';
import {buildDecisionContext, decideLocally} from './context.js';

const payload=JSON.parse(await readFile(PERSONA_CATALOG_URL,'utf8'));
const catalog=payload.records.map((entry,index)=>adaptPersonaRecord(entry.row,index,{...payload.source,rowIndex:entry.rowIndex}));
const withoutBucket=plan=>plan.map(({profileIndex,...person})=>person);

test('changing a technical UUID bucket does not change source-person entry times or probabilities',()=>{
  const changed=catalog.map(profile=>({...profile,archetypeIndex:(profile.archetypeIndex+1)%5}));
  const config={population:1000,seed:11,mapId:'office'};
  const original=createDayPlan({...config,personaCatalog:catalog});
  const counterfactual=createDayPlan({...config,personaCatalog:changed});
  assert.deepEqual(withoutBucket(original),withoutBucket(counterfactual));
  assert.ok(original.some((person,i)=>person.profileIndex!==counterfactual[i].profileIndex));
});

test('technical buckets cannot add legacy-student novelty utility to an unchanged source persona',()=>{
  const world=createWorld({mode:'day',population:1,personaCatalog:catalog});
  const agent={id:0,profileIndex:0,profile:catalog[0],position:[...world.stations.promo.slots[0]],heading:Math.PI,
    station:'promo',basket:[],spent:0,memory:[]};
  const context=buildDecisionContext(world,agent);
  assert.ok(context.observedProducts.some(product=>product.isNew));
  const original=decideLocally(context,31);
  for(const bucket of [1,2,3,4]){
    const changed=structuredClone(context);
    changed.observer.profileIndex=bucket;changed.persona.archetypeIndex=bucket;
    assert.deepEqual(decideLocally(changed,31),original);
  }
  const novelty=original.observations.find(observation=>context.observedProducts.find(product=>product.productId===observation.productId)?.isNew);
  assert.equal(novelty.contributions.novelty,.02+.08*catalog[0].behavior.noveltySeeking);
});

test('authored persona time weights affect opportunities without replacing UUIDs or entry draws',()=>{
  const night=catalog.map(profile=>({...profile,schedule:{...profile.schedule,hourlyWeights:Array.from({length:24},(_,hour)=>hour<5?3:.05)}}));
  const config={population:1000,seed:11,mapId:'office'};
  const original=createDayPlan({...config,personaCatalog:catalog});
  const changed=createDayPlan({...config,personaCatalog:night});
  assert.notDeepEqual(changed.map(person=>person.time),original.map(person=>person.time));
  assert.ok(changed.filter(person=>person.hour<5).length>original.filter(person=>person.hour<5).length);
  const baselineById=new Map(original.map(person=>[person.id,person]));
  for(const person of changed){
    const before=baselineById.get(person.id);
    assert.equal(person.personaIndex,before.personaIndex);
    assert.equal(person.personaSourceId,before.personaSourceId);
    assert.equal(person.entryDraw,before.entryDraw);
  }
  assert.ok(changed.every((person,index)=>index===0||person.time>=changed[index-1].time));
});

test('all four candidates retain the same 1,000 unique UUID-to-person-to-time pairing after schedule sorting',()=>{
  const profiles=catalog.map((profile,index)=>({...profile,schedule:{...profile.schedule,
    hourlyWeights:Array.from({length:24},(_,hour)=>index%2?(hour<6?3:.05):(hour>=18?3:.05))}}));
  const worlds=['hq','owner','balanced','discovery'].map(scenario=>createWorld({mode:'day',population:1000,scenario,seed:11,personaCatalog:profiles}));
  const plan=worlds[0].potentialSchedule;
  assert.equal(new Set(plan.map(person=>person.personaSourceId)).size,1000);
  assert.ok(plan.some((person,index)=>person.id!==index),'different personal schedules should actually reorder arrivals');
  for(const world of worlds)assert.deepEqual(world.potentialSchedule,plan);
  for(const person of plan){
    assert.equal(person.personaSourceId,profiles[person.personaIndex].source.id);
    assert.equal(person.profileIndex,profiles[person.personaIndex].archetypeIndex);
  }
});

test('entry and destination contexts keep the scheduled UUID and exact visit hour even when arrival order changes',async()=>{
  const profiles=catalog.slice(0,8).map((profile,index)=>({...profile,schedule:{...profile.schedule,
    hourlyWeights:Array.from({length:24},(_,hour)=>index%2?(hour<6?3:.05):(hour>=18?3:.05))}}));
  const contexts=[];
  const world=createWorld({mode:'day',population:8,duration:600,seed:29,personaCatalog:profiles,eventSchedule:[],decisionProvider:async context=>{
    contexts.push(context);
    return {engine:{type:'jev',jev:{called:true}},action:{type:context.schemaVersion==='entry-context/1'?'enter':'leave'},observations:[]};
  }});
  const byId=new Map(world.potentialSchedule.map(person=>[person.id,person]));
  let steps=0;
  while(!world.isComplete&&steps++<15000){
    if(world.hasPendingDecisions())await world.settleDecisions();
    else world.update(world.isQuiescent()?Math.max(.05,world.nextBoundary()-world.time):.05);
  }
  assert.equal(world.isComplete,true);
  const entries=contexts.filter(context=>context.schemaVersion==='entry-context/1');
  assert.ok(entries.length>0);
  assert.ok(contexts.some(context=>context.schemaVersion==='destination-context/1'));
  for(const context of contexts){
    const expected=byId.get(context.observer.agentId);
    assert.equal(context.persona.source.id,expected.personaSourceId);
    assert.equal(context.persona.sourceNarratives.persona,profiles[expected.personaIndex].sourceNarratives.persona);
    assert.ok(Math.abs(context.persona.visitContext.hour-expected.time/600*24)<1e-8);
    if(context.schemaVersion==='entry-context/1')assert.ok(Math.abs(context.time-expected.time)<1e-8);
  }
  assert.equal(world.day.considered,8);
  assert.equal(world.day.entered+world.day.skipped,8);
  assert.equal(world.snapshot().inventory.conserved,true);
});
