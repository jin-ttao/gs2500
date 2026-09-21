import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from './world.js';
import {createLab} from './lab.js';
import {decodeJevEvaluation,buildJevQuestion,JEV_MODEL} from './jev.js';

function provider({slow=false,events=[]}={}){
  return async context=>{
    if(slow)await new Promise(resolve=>setTimeout(resolve,1));
    const {actions}=buildJevQuestion(context);
    const preferred=context.schemaVersion==='entry-context/1'?'enter':context.schemaVersion==='destination-context/1'?'visit':'pick';
    const index=Math.max(0,actions.findIndex(a=>a.type===preferred));
    events.push(context.schemaVersion);
    const probabilities=Object.fromEntries(actions.map((_,i)=>['a'+i,i===index?1:0]));
    return decodeJevEvaluation(context,{model:JEV_MODEL,answers:{decision:{type:'choice',choice:'a'+index,probabilities}}},{requestId:'mock-'+events.length,contextHash:'mock-only'});
  };
}
async function finish(world){
  let iterations=0;
  while(!world.isComplete&&iterations++<100000){
    if(world.hasPendingDecisions()){
      const time=world.time,revenue=world.paidRevenue;
      world.update(50);assert.equal(world.time,time);assert.equal(world.paidRevenue,revenue);
      await world.settleDecisions();assert.equal(world.time,time,'network cannot advance the simulation clock');
    }else world.update(world.isQuiescent()?Math.max(.05,world.nextBoundary()-world.time):.05);
  }
  assert.equal(world.isComplete,true);
  return world.snapshot();
}
test('actual provider decisions control entry, destinations and picks with no simulated network delay',async()=>{
  const stages=[];
  const world=createWorld({mode:'day',population:3,duration:600,eventSchedule:[],seed:21,runId:'jev-test',decisionProvider:provider({events:stages})});
  const result=await finish(world);
  for(const stage of ['entry-context/1','destination-context/1','shelf-context/1'])assert.ok(stages.includes(stage));
  assert.equal(result.engine.type,'jev');assert.equal(result.modelCalls,stages.length);
  assert.ok(result.paidRevenue>0);assert.equal(result.inventory.conserved,true);
  const trace=world.exportLedger().events.filter(e=>e.type==='modelDecision');
  assert.equal(trace.length,stages.length);assert.ok(trace.every(e=>e.context.persona.story&&e.result.trace.requestId));
  assert.equal(world.exportLedger().events.filter(e=>e.type==='payment').reduce((s,e)=>s+e.amount,0),result.paidRevenue);
});
test('different provider response delays yield identical positions, decisions, inventory and sales',async()=>{
  const config={mode:'day',population:2,duration:500,eventSchedule:[],seed:83,runId:'same'};
  const fast=await finish(createWorld({...config,decisionProvider:provider()}));
  const slow=await finish(createWorld({...config,decisionProvider:provider({slow:true})}));
  assert.deepEqual(slow,fast);
});
test('provider failure freezes the world and never silently calls local policy',async()=>{
  const world=createWorld({mode:'day',population:1,duration:600,eventSchedule:[],decisionProvider:async()=>{throw new Error('budget-exhausted');}});
  world.update(world.nextBoundary());assert.equal(world.hasPendingDecisions(),true);
  const time=world.time;
  await assert.rejects(world.settleDecisions(),/budget-exhausted/);
  assert.throws(()=>world.update(20),/budget-exhausted/);
  assert.equal(world.time,time);assert.equal(world.paidRevenue,0);assert.equal(world.modelCalls,0);
  assert.equal(world.engine.jev.status,'failed');
});
test('illegal model action fails closed before changing inventory or motion',async()=>{
  const world=createWorld({mode:'day',population:1,duration:600,eventSchedule:[],decisionProvider:async()=>({engine:{type:'jev',jev:{called:true}},action:{type:'pick',productId:'water'}})});
  world.update(world.nextBoundary());
  await assert.rejects(world.settleDecisions(),/outside/);assert.equal(world.spawned,0);assert.equal(world.paidRevenue,0);
});
test('a shared laboratory clock waits for every asynchronous decision at a tick',async()=>{
  const lab=createLab({mode:'day',limit:2,duration:500,storeGroup:'everyday',speed:900,decisionProvider:provider()});
  lab.start();
  for(let i=0;i<100&&!lab.runs.some(r=>r.world.hasPendingDecisions());i++)lab.advance(1,{budgetMs:100});
  const time=lab.time,positions=lab.runs.map(r=>r.world.agents.map(a=>[...a.position]));
  lab.advance(9,{budgetMs:100});assert.equal(lab.time,time);assert.deepEqual(lab.runs.map(r=>r.world.agents.map(a=>[...a.position])),positions);
  await lab.settleDecisions();assert.ok(lab.runs.every(r=>r.world.time===time));
});
test('pause holds an in-flight result and prevents further paid calls until resume',async()=>{
  let release,attempts=0;
  const hold=new Promise(resolve=>{release=resolve;});
  const decide=provider();
  const lab=createLab({mode:'day',limit:1,duration:500,storeGroup:'everyday',speed:900,
    decisionProvider:async context=>{attempts++;await hold;return decide(context);}});
  lab.start();
  while(!lab.runs.some(r=>r.world.hasPendingDecisions()))lab.advance(1,{budgetMs:100});
  const pending=lab.settleDecisions();assert.equal(attempts,1);
  lab.pause();const time=lab.time;release();await pending;
  assert.equal(attempts,1);assert.equal(lab.time,time);assert.equal(lab.runs.reduce((s,r)=>s+r.world.spawned,0),0);
  lab.resume();await lab.settleDecisions();assert.ok(lab.runs.some(r=>r.world.spawned>0));
});
