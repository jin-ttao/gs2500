import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createWorld} from '../world.js';
import {loadPersonaCatalog} from '../personas.js';
import {createJevDecisionProvider} from '../jev.js';

if(!process.argv.includes('--live'))throw new Error('This script makes paid JEV calls. Explicit --live is required; at most 10 calls.');
const endpoint=process.env.JEV_LOCAL_ORIGIN??'http://127.0.0.1:4173';
if(!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(endpoint))throw new Error('Only a local API server is supported');
const personas=await loadPersonaCatalog({fetchImpl:async url=>new Response(await readFile(url))});
const provider=createJevDecisionProvider({endpoint:endpoint+'/api/decision'});
let attempted=0;
const world=createWorld({mode:'day',population:1,duration:86400,eventSchedule:[],seed:11,scenario:'hq',storeId:'samsung',runId:'jev-live-one-person',personaCatalog:personas,
  decisionProvider:async context=>{
    if(attempted>=10)throw new Error('Verification script 10-call ceiling reached');
    attempted++;
    return provider(context);
  }});
const started=performance.now();let error=null;
try{
  while(!world.isComplete){
    if(world.hasPendingDecisions())await world.settleDecisions();
    else world.update(world.isQuiescent()?Math.max(.05,world.nextBoundary()-world.time):.05);
  }
}catch(cause){error=cause.message;}
const ledger=world.exportLedger();
const report={generatedAt:new Date().toISOString(),kind:'live-jev-integration-not-human-behaviour-validation',attempted,applied:world.modelCalls,error,elapsedSeconds:(performance.now()-started)/1000,
  completed:world.isComplete,source:world.personaSource,summary:world.snapshot({detail:false}),
  stages:ledger.events.filter(e=>e.type==='modelDecision').map(e=>({stage:e.stage,agentId:e.context.observer.agentId,time:e.time,sourceId:e.personaSourceId,mission:e.context.persona.mission,action:e.action,trace:e.trace})),
  limitation:'One synthetic potential person is an integration smoke test, not a 1000-person realism benchmark or measured revenue forecast.'};
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/jev-live-world.json',import.meta.url),JSON.stringify({report,ledger},null,2));
console.log(JSON.stringify({attempted,applied:report.applied,completed:report.completed,error,elapsedSeconds:report.elapsedSeconds,entered:world.spawned,paidRevenue:world.paidRevenue,inventoryConserved:report.summary.inventory.conserved,stages:report.stages.map(s=>({stage:s.stage,action:s.action,model:s.trace.model,latencyMs:s.trace.latencyMs}))},null,2));
if(error)process.exitCode=1;
