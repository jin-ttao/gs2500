import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PROFILES } from './model.js';
import { PERSONA_DATASET, PERSONA_REVISION, PERSONA_CATALOG_URL, adaptPersonaRecord, createVisitPersona, loadPersonaCatalog } from './personas.js';

const payload=JSON.parse(await readFile(PERSONA_CATALOG_URL,'utf8'));
const sample=payload.records[0].row;
const load=async value=>loadPersonaCatalog({fetchImpl:async url=>{
  assert.equal(String(url),String(PERSONA_CATALOG_URL));
  return {ok:true,json:async()=>structuredClone(value)};
}});

test('the bundled cohort is exactly 1,000 unique original synthetic source rows at the verified revision',()=>{
  assert.equal(payload.source.dataset,PERSONA_DATASET);
  assert.equal(payload.source.revision,PERSONA_REVISION);
  assert.equal(payload.source.license,'CC-BY-4.0');
  assert.equal(payload.source.synthetic,true);
  assert.equal(payload.source.realPeople,false);
  assert.equal(payload.source.viewerRevisionVerified,true);
  assert.equal(payload.records.length,1000);
  assert.equal(new Set(payload.records.map(entry=>entry.row.uuid)).size,1000);
  assert.equal(new Set(payload.records.map(entry=>entry.rowIndex)).size,1000);
  assert.equal(payload.schema.length,26);
  for(const entry of payload.records){
    assert.match(entry.row.uuid,/^[0-9a-f]{32}$/);
    assert.deepEqual(Object.keys(entry.row).sort(),payload.schema.map(field=>field.name).sort());
    assert.ok(entry.row.age>=19);
  }
  assert.equal(createHash('sha256').update(JSON.stringify(payload.records)).digest('hex'),payload.integrity.canonicalRecordsSha256);
});

test('sampling is reproducible row-index stratification and does not claim population representativeness',()=>{
  const hash=value=>{let n=2166136261;for(const char of String(value))n=Math.imul(n^char.charCodeAt(0),16777619);return n>>>0;};
  assert.equal(payload.sampling.populationRepresentative,false);
  assert.equal(payload.sampling.strata,20);
  assert.equal(payload.sampling.batchSize,50);
  for(let stratum=0;stratum<20;stratum++){
    const start=stratum*50000,offset=start+hash(`${payload.sampling.seed}:${stratum}`)%(50000-50+1);
    assert.equal(payload.sampling.offsets[stratum],offset);
    assert.deepEqual(payload.records.slice(stratum*50,(stratum+1)*50).map(entry=>entry.rowIndex),Array.from({length:50},(_,i)=>offset+i));
    assert.equal(new URL(payload.sampling.requests[stratum]).searchParams.get('revision'),PERSONA_REVISION);
  }
});

test('all original narratives and facts survive adaptation without claiming observed store behaviour',()=>{
  for(const [index,entry] of payload.records.entries()){
    const profile=adaptPersonaRecord(entry.row,index,{...payload.source,rowIndex:entry.rowIndex});
    assert.equal(profile.id,entry.row.uuid);
    assert.equal(profile.source.id,entry.row.uuid);
    assert.equal(profile.source.rowIndex,entry.rowIndex);
    assert.equal(profile.source.synthetic,true);
    assert.equal(profile.source.realPerson,false);
    assert.equal(profile.source.observedCustomer,false);
    assert.equal(profile.source.populationRepresentative,false);
    assert.equal(profile.derived.status,'authored-assumption');
    for(const [field,value] of Object.entries(profile.sourceNarratives)){
      assert.equal(value,entry.row[field]);
      if(value)assert.ok(profile.story.includes(value),field);
    }
    for(const [field,value] of Object.entries(profile.sourceFacts))assert.equal(value,entry.row[field]);
    assert.ok(profile.archetypeIndex>=0&&profile.archetypeIndex<5);
    assert.equal(profile.derived.archetypeIndex.status,'technical-bucket');
    assert.ok(profile.budget>=6000&&profile.budget<=15000);
    assert.ok(Object.values(profile.affinity).every(value=>value>=0&&value<=1));
    assert.equal(profile.schedule.hourlyWeights.length,24);
    assert.equal(profile.schedule.status,'authored-assumption');
    for(const evidence of profile.behavior.evidence)assert.ok(entry.row[evidence.field].includes(evidence.text));
  }
});

test('demographic edits do not invent a budget, category preference, or visit time difference',()=>{
  const original=adaptPersonaRecord(sample,0);
  const changed=adaptPersonaRecord({...sample,sex:'변경',age:90,occupation:'변경',education_level:'변경',housing_type:'변경'},999);
  for(const field of ['budget','affinity','archetypeIndex','schedule'])assert.deepEqual(changed[field],original[field]);
  assert.equal(original.derived.budget.status,'assumed');
});

test('food affinity uses mild cited narrative priors and detected negation is not a positive preference',()=>{
  const profile=adaptPersonaRecord({...sample,culinary_persona:'커피를 즐겨 마십니다. 새로운 과자를 좋아합니다. 견과류는 알레르기 때문에 피합니다.'});
  assert.equal(profile.affinity.drink,.62);
  assert.equal(profile.affinity.snack,.62);
  assert.equal(profile.affinity.health,.5);
  assert.ok(profile.behavior.explicitGoals.some(goal=>goal.includes('알레르기')));
  for(const evidence of profile.derived.affinity.evidence)assert.ok(profile.sourceNarratives.culinary_persona.includes(evidence.text));
});

test('hour-specific opportunities preserve full stories and explicit shopping and dietary goals',()=>{
  const base=adaptPersonaRecord({...sample,shopping_mission:'생수만 구매',culinary_persona:'견과류 알레르기가 있습니다. 생수만 마십니다.'});
  const before=structuredClone(base);
  for(const hour of [0,.82,12,18,23.9]){
    const visit=createVisitPersona(base,hour);
    assert.equal(visit.story,base.story);
    assert.deepEqual(visit.sourceNarratives,base.sourceNarratives);
    assert.deepEqual(visit.behavior.explicitGoals,base.behavior.explicitGoals);
    assert.deepEqual(visit.visitContext.requiredGoals,base.behavior.explicitGoals);
    assert.ok(visit.mission.includes('생수만 구매'));
    assert.equal(visit.originalMission,'생수만 구매');
    assert.equal(visit.visitContext.hour,hour);
  }
  assert.notEqual(createVisitPersona(base,2).visitContext.timeBand,createVisitPersona(base,12).visitContext.timeBand);
  assert.deepEqual(base,before);
});

test('legacy student template does not assert a class between midnight and dawn',()=>{
  const student=createVisitPersona(PROFILES[3],.82);
  assert.ok(!student.mission.includes('수업'));
  assert.equal(student.originalMission,'수업 사이 간식');
  assert.equal(student.story,PROFILES[3].story);
  assert.equal(student.visitContext.legacyContextSuppressed,true);
  assert.doesNotMatch(createVisitPersona(student,1).mission,/수업/);
  assert.ok(createVisitPersona(PROFILES[3],12).mission.includes('수업'));
  for(const profile of PROFILES){
    const visit=createVisitPersona(profile,.82);
    assert.doesNotMatch(visit.mission,/수업|퇴근길|야근 전|운동 후|내일 아침/);
  }
  assert.match(createVisitPersona({...PROFILES[3],mission:'생수만 구매'},.82).mission,/생수만 구매/);
});

test('the local catalog loads 1,000 distinct personas with detached metadata and validates provenance',async()=>{
  const catalog=await load(payload);
  assert.equal(catalog.length,1000);
  assert.equal(new Set(catalog.map(profile=>profile.id)).size,1000);
  assert.equal(catalog.metadata.source.revision,PERSONA_REVISION);
  assert.ok(Object.values(Object.groupBy(catalog,profile=>profile.archetypeIndex)).every(group=>group.length>100));
  catalog.metadata.source.synthetic=false;
  assert.equal(payload.source.synthetic,true);
  const badRevision=structuredClone(payload);badRevision.source.revision='unverified';
  await assert.rejects(load(badRevision),/provenance/);
  const duplicate=structuredClone(payload);duplicate.records[1]=duplicate.records[0];
  await assert.rejects(load(duplicate),/unique/);
  await assert.rejects(loadPersonaCatalog({fetchImpl:async()=>({ok:false,status:404})}),/404/);
});

test('invalid inputs are rejected and a frozen source can produce a detached visit',()=>{
  assert.throws(()=>adaptPersonaRecord({}),/uuid/);
  assert.throws(()=>adaptPersonaRecord(sample,-1),/index/);
  const profile=adaptPersonaRecord(sample);
  Object.freeze(profile);Object.freeze(profile.behavior);
  const visit=createVisitPersona(profile,13);
  visit.behavior.explicitGoals.push('local test');
  assert.ok(!profile.behavior.explicitGoals.includes('local test'));
  for(const hour of [-1,24,NaN,Infinity,'12'])assert.throws(()=>createVisitPersona(profile,hour),/hour/);
});
