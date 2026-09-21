import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DATASET='nvidia/Nemotron-Personas-Korea';
const REVISION='ada0f5b53a38bb5a30cce09358adde883c1ab63a';
const SOURCE_URL=`https://huggingface.co/datasets/${DATASET}`;
const COUNT=1000,STRATA=20,BATCH_SIZE=50,SEED=20260921;
const output=new URL('../data/nemotron-korea-sample.json',import.meta.url);
const hash=value=>{let n=2166136261;for(const char of String(value))n=Math.imul(n^char.charCodeAt(0),16777619);return n>>>0;};
const digest=value=>createHash('sha256').update(value).digest('hex');

async function getJson(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Source request failed (${response.status}): ${url}`);
  return {data:await response.json(),revision:response.headers.get('x-revision')};
}

const {data:metadata}=await getJson(`https://huggingface.co/api/datasets/${DATASET}/revision/${REVISION}`);
if(metadata.sha!==REVISION||metadata.cardData?.license!=='cc-by-4.0')throw new Error('Pinned source revision or license could not be verified');
const schema=metadata.cardData.dataset_info.features;
const totalRows=metadata.cardData.dataset_info.splits.find(split=>split.name==='train')?.num_examples;
if(!Number.isSafeInteger(totalRows)||totalRows<COUNT)throw new Error('Unexpected source row count');
const offsets=Array.from({length:STRATA},(_,stratum)=>{
  const start=Math.floor(stratum*totalRows/STRATA),end=Math.floor((stratum+1)*totalRows/STRATA);
  return start+hash(`${SEED}:${stratum}`)%(end-start-BATCH_SIZE+1);
});
const batches=[];
for(let start=0;start<STRATA;start+=4){
  const results=await Promise.all(offsets.slice(start,start+4).map(async offset=>{
    const url=new URL('https://datasets-server.huggingface.co/rows');
    for(const [key,value] of Object.entries({dataset:DATASET,config:'default',split:'train',offset,length:BATCH_SIZE,revision:REVISION}))url.searchParams.set(key,String(value));
    const {data,revision}=await getJson(url);
    if(revision!==REVISION)throw new Error(`Viewer returned unverified revision ${revision}`);
    if(data.num_rows_total!==totalRows||data.rows?.length!==BATCH_SIZE)throw new Error('Unexpected viewer page size');
    const records=data.rows.map((entry,index)=>{
      if(entry.row_idx!==offset+index||entry.truncated_cells?.length)throw new Error('Source rows were reordered or truncated');
      if(!/^[a-f0-9]{32}$/.test(entry.row?.uuid)||schema.some(field=>!(field.name in entry.row)))throw new Error('Source schema or uuid mismatch');
      return {rowIndex:entry.row_idx,row:entry.row};
    });
    return {offset,url:String(url),records};
  }));
  batches.push(...results);console.log(`Verified ${batches.length*BATCH_SIZE}/${COUNT} original synthetic records`);
}
const records=batches.flatMap(batch=>batch.records);
if(records.length!==COUNT||new Set(records.map(entry=>entry.row.uuid)).size!==COUNT)throw new Error('The cohort must contain 1,000 unique original source UUIDs');
const payload={
  schemaVersion:'nemotron-korea-cohort/1',
  source:{dataset:DATASET,publisher:'NVIDIA Corporation',url:SOURCE_URL,revision:REVISION,
    readmeUrl:`${SOURCE_URL}/blob/${REVISION}/README.md`,license:'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',
    synthetic:true,realPeople:false,retrievedAt:new Date().toISOString(),viewerRevisionVerified:true,
    attribution:'NVIDIA Corporation — Nemotron-Personas-Korea, CC BY 4.0; original source rows retained, subset selection by GS2500.',
  },
  sampling:{method:'20 equal row-index strata; one deterministic contiguous 50-row block per stratum',seed:SEED,totalRows,count:COUNT,strata:STRATA,batchSize:BATCH_SIZE,offsets,
    populationRepresentative:false,limitations:'A deterministic engineering subset, not a weighted Korean-population or GS25-customer sample. No actual person or observed purchase is represented.',
    requests:batches.map(batch=>batch.url)},
  schema,integrity:{algorithm:'sha256',canonicalRecordsSha256:digest(JSON.stringify(records))},records,
};
await mkdir(new URL('../data/',import.meta.url),{recursive:true});
await writeFile(output,JSON.stringify(payload,null,2)+'\n','utf8');
console.log(JSON.stringify({output:fileURLToPath(output),count:records.length,revision:REVISION,sha256:payload.integrity.canonicalRecordsSha256}));
