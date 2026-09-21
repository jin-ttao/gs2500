export const PERSONA_DATASET='nvidia/Nemotron-Personas-Korea';
export const PERSONA_REVISION='ada0f5b53a38bb5a30cce09358adde883c1ab63a';
export const PERSONA_CATALOG_URL=new URL('./data/nemotron-korea-sample.json',import.meta.url);
const SOURCE_URL=`https://huggingface.co/datasets/${PERSONA_DATASET}`;
const NARRATIVE_FIELDS=['persona','professional_persona','sports_persona','arts_persona','travel_persona','culinary_persona','family_persona','cultural_background','skills_and_expertise','skills_and_expertise_list','hobbies_and_interests','hobbies_and_interests_list','career_goals_and_ambitions'];
const FACT_FIELDS=['sex','age','marital_status','military_status','family_type','housing_type','education_level','bachelors_field','occupation','district','province','country'];
const COLORS=['#496077','#954f51','#657851','#806488','#337477','#9d873e','#6a6b79'];
const CATEGORIES={meal:/한식|김밥|도시락|간편식|한 끼|밥|면|샌드위치/,drink:/커피|차를|차를 마|음료|생수|주스|우유|물 마/,snack:/간식|과자|디저트|빵|쿠키|초콜릿|젤리/,health:/단백질|견과|요거트|과일|샐러드|건강식/};
const POSITIVE=/좋아|즐기|즐겨|선호|찾|먹|마시/;
const NEGATIVE=/피하|싫어|먹지|마시지|못\s*먹|알레르기|금지|끊|기피/;
const EXPLICIT_CONSTRAINT=/알레르기|절대|금지|반드시|(?:만|만을)\s*(?:먹|마시|구매|사야)|(?:먹|마시)지\s*않|피하|기피|비건|채식/;
const clone=value=>structuredClone(value);
const text=value=>typeof value==='string'?value:'';
const hash=value=>{let n=2166136261;for(const char of String(value))n=Math.imul(n^char.charCodeAt(0),16777619);return n>>>0;};
const sentences=value=>text(value).split(/(?<=[.!?。])\s+|\n+/).map(part=>part.trim()).filter(Boolean);

function sourceGoals(row){
  const evidence=[];
  // Optional caller-supplied explicit missions remain hard constraints. They are
  // not fields we claim to have found in NVIDIA's official 26-field schema.
  for(const field of ['shopping_mission','mission','shopping_goals','explicit_goals']){
    const values=Array.isArray(row[field])?row[field]:[row[field]];
    for(const value of values)if(text(value).trim())evidence.push({field,text:value,kind:'provided-explicit-goal'});
  }
  for(const field of ['culinary_persona','persona'])for(const sentence of sentences(row[field])){
    if(EXPLICIT_CONSTRAINT.test(sentence))evidence.push({field,text:sentence,kind:'source-text-constraint-candidate'});
  }
  return [...new Map(evidence.map(item=>[item.text,item])).values()];
}

/** Preserve original synthetic source facts; all store-behaviour numbers below
 * are explicitly authored priors, not NVIDIA labels or observed GS behaviour. */
export function adaptPersonaRecord(row,index=0,sourceMetadata={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.uuid!=='string'||!row.uuid.trim())throw new TypeError('An original persona row with uuid is required');
  if(!Number.isSafeInteger(index)||index<0)throw new RangeError('Persona index must be nonnegative');
  const sourceNarratives=Object.fromEntries(NARRATIVE_FIELDS.map(field=>[field,text(row[field])]));
  const sourceFacts=Object.fromEntries(FACT_FIELDS.map(field=>[field,row[field]??null]));
  const narrativeEntries=NARRATIVE_FIELDS.filter(field=>sourceNarratives[field]);
  const story=narrativeEntries.map(field=>`[${field}]\n${sourceNarratives[field]}`).join('\n\n');
  const nameMatch=[row.persona,row.professional_persona,row.family_persona].map(value=>text(value).match(/([가-힣]{2,5})\s*씨/)).find(Boolean);
  const name=nameMatch?.[1]??`합성 인물 ${String(index+1).padStart(4,'0')}`;
  const number=hash(row.uuid),budget=[6000,8000,10000,12000,15000][number%5];
  const affinity={},affinityEvidence=[];
  for(const [category,pattern] of Object.entries(CATEGORIES)){
    const evidence=sentences(row.culinary_persona).find(sentence=>pattern.test(sentence)&&POSITIVE.test(sentence)&&!NEGATIVE.test(sentence));
    affinity[category]=evidence ? .62 : .5;
    if(evidence)affinityEvidence.push({category,field:'culinary_persona',text:evidence,interpretation:'Mild authored category prior from a positive food mention, not a measured preference'});
  }
  const food=text(row.culinary_persona),hasNewTaste=/새로운|신상|유행|트렌드/.test(food)&&!NEGATIVE.test(food),hasRoutine=/단골|익숙|늘 먹|전통/.test(food);
  const noveltySeeking=hasNewTaste ? .65 : hasRoutine ? .4 : .5;
  const goalEvidence=sourceGoals(row),explicitGoals=goalEvidence.map(item=>item.text);
  const originalMission=text(row.shopping_mission)||text(row.mission)||null;
  const hourlyWeights=[.12,.08,.05,.04,.08,.3,.7,1.1,1.2,1,1,1.3,1.6,1.2,1.1,1.1,1.2,1.5,1.7,1.5,1.2,.9,.6,.3];
  const nightEvidence=sentences(row.professional_persona).find(sentence=>/야간|밤샘|밤새|교대 근무|심야/.test(sentence));
  if(nightEvidence)for(const hour of [0,1,2,3,4,22,23])hourlyWeights[hour]=Math.max(hourlyWeights[hour],.6);
  const source={dataset:PERSONA_DATASET,publisher:'NVIDIA Corporation',id:row.uuid,uuid:row.uuid,
    revision:sourceMetadata.revision??PERSONA_REVISION,url:sourceMetadata.url??SOURCE_URL,
    rowIndex:sourceMetadata.rowIndex??index,license:sourceMetadata.license??'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',
    synthetic:true,realPerson:false,observedCustomer:false,populationRepresentative:false,
  };
  return {
    id:row.uuid,name,age:Number.isFinite(row.age)?row.age:null,role:text(row.occupation)||'직업 정보 없음',job:text(row.occupation)||'직업 정보 없음',
    budget,affinity,tags:['NVIDIA 공개 합성 페르소나',text(row.province),text(row.occupation)].filter(Boolean),
    story,mission:originalMission??'필요한 먹거리·음료를 비교하는 방문 기회',originalMission,color:COLORS[number%COLORS.length],
    archetypeIndex:number%5,source,sourceFacts,sourceNarratives,
    behavior:{explicitGoals,goalEvidence,strictGoalPreservation:true,dietaryConstraints:goalEvidence.filter(item=>item.kind==='source-text-constraint-candidate').map(item=>item.text),
      noveltySeeking,priceSensitivity:.5,timePressure:.5,maxBasket:3,maxStops:3,timeBudgetSeconds:180,
      status:'authored-assumption',evidence:affinityEvidence,
    },
    schedule:{timezone:'Asia/Seoul',hourlyWeights,status:'authored-assumption',evidence:nightEvidence?[{field:'professional_persona',text:nightEvidence}]:[],
      limitation:'Visit hours are scenario assumptions, not observed routines; no school/work/gym event is inferred from age or sex.'},
    derived:{version:'gs2500-persona-adapter/1',status:'authored-assumption',
      name:{method:nameMatch?'extract-name-before-씨-from-source-prose':'authored-display-label'},
      budget:{status:'assumed',unit:'KRW',method:'UUID hash selects one of 6000/8000/10000/12000/15000; income is unknown'},
      affinity:{status:'assumed',method:'Neutral .5, or .62 for an explicit positive culinary category mention without detected negation',evidence:affinityEvidence},
      noveltySeeking:{status:'assumed',method:'Food-narrative keywords only; .65 exploration, .4 routine, .5 unknown'},
      archetypeIndex:{status:'technical-bucket',method:'UUID hash modulo 5; not a demographic or psychological classification'},
      assumptions:['No numeric shopping budget, category utility, visit schedule or purchasing outcome is supplied by the source dataset.',
        'Age, sex, education, housing and occupation do not determine the adapter budget or affinity values.',
        'Keyword evidence can be ambiguous; preserve the full narrative and explicit restrictions for model review.'],
    },
  };
}

/** A time-compatible opportunity, not an asserted activity or compulsory visit. */
export function createVisitPersona(profile,hour){
  if(!profile||typeof profile!=='object')throw new TypeError('A persona is required');
  if(!Number.isFinite(hour)||hour<0||hour>=24)throw new RangeError('Visit hour must be within 0..<24');
  const band=hour<6?['심야','늦은 시간 필요한 먹거리·음료 확인']:hour<11?['오전','아침 시간의 식사·음료 필요 여부 확인']:hour<14?['점심','점심 시간의 한 끼·음료 비교']:hour<17?['오후','오후의 간단한 먹거리·음료 비교']:hour<21?['저녁','저녁 시간의 식사·간식 필요 여부 확인']:['늦은 저녁','하루를 마무리하며 필요한 먹거리·음료 확인'];
  const result=clone(profile),originalMission=profile.originalMission??(profile.source?.dataset===PERSONA_DATASET?null:profile.mission)??null;
  // Old five-person demo profiles describe one authored occasion, not a claim
  // that a class/commute/workout happens at every newly sampled visit hour.
  // Caller-supplied shopping missions and explicit restrictions stay hard goals.
  const providedHardMission=profile.visitContext?.missionConstraint??(Boolean(profile.originalMission)||EXPLICIT_CONSTRAINT.test(originalMission??'')||profile.behavior?.goalEvidence?.some(item=>item.kind==='provided-explicit-goal'&&item.text===originalMission))??false;
  const legacyContext=originalMission??'';
  const incompatibleLegacyContext=!providedHardMission&&(
    (/수업|등교|하교/.test(legacyContext)&&(hour<7||hour>=21))||
    (/출근/.test(legacyContext)&&(hour<5||hour>=13))||
    (/퇴근/.test(legacyContext)&&(hour<15||hour>=23))||
    (/야근 전/.test(legacyContext)&&(hour<15||hour>=23))||
    (/운동 후/.test(legacyContext)&&(hour<5||hour>=23))||
    (/내일 아침/.test(legacyContext)&&hour<16)
  );
  const currentMission=incompatibleLegacyContext?null:originalMission;
  result.mission=currentMission?`${band[0]} 방문 · ${currentMission}`:`${band[0]} 방문 기회 · ${band[1]}`;
  result.originalMission=originalMission;
  result.visitContext={hour,timeBand:band[0],opportunity:band[1],source:'authored-time-compatible-opportunity',
    requiredGoals:clone(profile.behavior?.explicitGoals??[]),
    constraint:'Do not override source dietary restrictions or explicit shopping goals; the person may decline entry or purchase.',
    originalMission:result.originalMission,missionConstraint:providedHardMission,legacyContextSuppressed:incompatibleLegacyContext};
  return result;
}

export async function loadPersonaCatalog({fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('A fetch implementation is required');
  const response=await fetchImpl(PERSONA_CATALOG_URL);
  if(!response.ok)throw new Error(`Persona catalog could not be loaded (${response.status})`);
  const payload=await response.json();
  if(payload.schemaVersion!=='nemotron-korea-cohort/1'||payload.source?.dataset!==PERSONA_DATASET||payload.source.revision!==PERSONA_REVISION||payload.source.license!=='CC-BY-4.0'||!payload.source.synthetic)throw new TypeError('Persona catalog provenance is not the verified NVIDIA synthetic source');
  if(!Array.isArray(payload.records)||payload.records.length!==1000||new Set(payload.records.map(entry=>entry.row?.uuid)).size!==1000)throw new RangeError('Persona catalog must contain 1,000 unique original source UUIDs');
  const catalog=payload.records.map((entry,index)=>adaptPersonaRecord(entry.row,index,{...payload.source,rowIndex:entry.rowIndex}));
  Object.defineProperty(catalog,'metadata',{value:clone({source:payload.source,sampling:payload.sampling,integrity:payload.integrity}),enumerable:false});
  return catalog;
}
