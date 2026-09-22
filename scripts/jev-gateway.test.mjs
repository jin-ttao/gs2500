import test from 'node:test';
import assert from 'node:assert/strict';
import {createJevGateway, JEV_ENDPOINT, JEV_MODEL} from './jev-gateway.mjs';

const key = 'fixture-credential-never-real';
const request = (requestId = 'sample-1') => ({requestId, state:{persona:{story:'생수만 구매하는 합성 인물'}, budget:1500}, questions:{
  enter:{type:'noul', instructions:'Would this synthetic person enter?', criteria:{true:'Enters', false:'Passes'}},
  purchase:{type:'choice', instructions:'Choose within the synthetic persona budget.', criteria:{water:'Water, KRW1100', none:'No purchase'}},
}});
const payload = () => ({model:'typesafe/jev-1.13-20260917', provider:'Typesafe', id:'gen-fixture-1', answers:{
  enter:{type:'noul', noul:0.98}, purchase:{type:'choice', choice:'water', probabilities:{water:1, none:0}, confidence:1},
}, usage:{input_tokens:100, output_tokens:4, cost:0.000022008}});
const response = (body = payload(), status = 200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json'}});
const errorCode = (code, status) => error => error.code === code && error.httpStatus === status;

test('uses Decisions API, fixed JEV model, server key and synthetic provenance', async () => {
  let captured;
  const gateway = createJevGateway({apiKey:key, fetchImpl:async (...args) => {captured=args; return response();}});
  const input = request(), result = await gateway.decide(input);
  assert.equal(captured[0], JEV_ENDPOINT);
  assert.equal(captured[1].headers.Authorization, `Bearer ${key}`);
  assert.equal(captured[1].method, 'POST');
  const sent = JSON.parse(captured[1].body);
  assert.equal(sent.model, JEV_MODEL);
  assert.deepEqual(sent.questions, input.questions);
  assert.equal(sent.state.persona.story, input.state.persona.story);
  assert.equal(sent.state.sourceContext.synthetic, true);
  assert.equal(input.state.sourceContext, undefined);
  assert.equal(result.model, payload().model);
  assert.deepEqual(result.answers, payload().answers);
  assert.deepEqual(result.usage, payload().usage);
  assert.equal(result.provider, 'Typesafe');
  assert.equal(result.upstreamRequestId, 'gen-fixture-1');
  assert.ok(result.latencyMs >= 0);
  assert.equal(result.cached, false);
  assert.ok(!JSON.stringify(result).includes(key));
  assert.deepEqual({...gateway.status(), sourceContext:undefined}, {configured:true, provider:'openrouter', requestedModel:JEV_MODEL,
    maxCalls:20, attemptedCalls:1, successfulCalls:1, remainingCalls:19, activeCalls:0, maxConcurrent:2, sourceContext:undefined});
});

test('missing key fails locally without spending budget or exposing configuration', async () => {
  let count=0;
  const gateway=createJevGateway({fetchImpl:async()=>{count++; return response();}});
  await assert.rejects(gateway.decide(request()), errorCode('JEV_NOT_CONFIGURED',503));
  assert.equal(count,0); assert.equal(gateway.status().attemptedCalls,0); assert.equal(gateway.status().configured,false);
});

test('duplicate pending and completed requests spend one call and return independent data',async()=>{
  let release, count=0;
  const gateway=createJevGateway({apiKey:key,fetchImpl:()=>{count++; return new Promise(resolve=>{release=resolve;});}});
  const first=gateway.decide(request()), second=gateway.decide(request());
  release(response());
  const [a,b]=await Promise.all([first,second]);
  assert.equal(count,1); assert.equal(a.cached,false); assert.equal(b.cached,true);
  a.answers.purchase.choice='none';
  assert.equal((await gateway.decide(request())).answers.purchase.choice,'water');
  assert.equal(gateway.status().attemptedCalls,1);
});

test('canonical idempotency ignores key order; conflicting reuse is rejected',async()=>{
  const gateway=createJevGateway({fetchImpl:async()=>response()});
  await assert.rejects(gateway.decide(request()),errorCode('JEV_NOT_CONFIGURED',503));
  const configured=createJevGateway({apiKey:key,fetchImpl:async()=>response()});
  await configured.decide(request());
  const reordered=request(); reordered.state={budget:1500,persona:{story:'생수만 구매하는 합성 인물'}};
  assert.equal((await configured.decide(reordered)).cached,true);
  reordered.state.budget=2000;
  await assert.rejects(configured.decide(reordered),errorCode('JEV_REQUEST_ID_CONFLICT',409));
});

test('budget is reserved before await and cannot be exceeded by concurrency',async()=>{
  let release, count=0;
  const gateway=createJevGateway({apiKey:key,maxCalls:1,fetchImpl:()=>{count++; return new Promise(resolve=>{release=resolve;});}});
  const first=gateway.decide(request());
  await assert.rejects(gateway.decide(request('second')),errorCode('JEV_BUDGET_EXHAUSTED',429));
  release(response()); await first;
  assert.equal(count,1); assert.equal(gateway.status().remainingCalls,0);
});

test('only two concurrent calls are permitted and busy rejection does not spend budget',async()=>{
  const pending=[];
  const gateway=createJevGateway({apiKey:key,fetchImpl:()=>new Promise(resolve=>pending.push(resolve))});
  const first=gateway.decide(request('first')),second=gateway.decide(request('second'));
  await assert.rejects(gateway.decide(request('third')),errorCode('JEV_BUSY',429));
  assert.equal(gateway.status().activeCalls,2);assert.equal(gateway.status().attemptedCalls,2);
  pending.forEach(resolve=>resolve(response())); await Promise.all([first,second]);
  assert.equal(gateway.status().activeCalls,0);
});

test('upstream failures are cached, counted, sanitized, and never retried',async()=>{
  let count=0;
  const gateway=createJevGateway({apiKey:key,fetchImpl:async()=>{count++;return response({error:key,state:request().state},401);}});
  for(let i=0;i<2;i++) await assert.rejects(gateway.decide(request()),error=>{
    assert.equal(error.upstreamStatus,401);assert.ok(!error.message.includes(key));assert.ok(!error.message.includes('persona'));
    return errorCode('JEV_UPSTREAM_ERROR',502)(error);
  });
  assert.equal(count,1);assert.equal(gateway.status().attemptedCalls,1);assert.equal(gateway.status().successfulCalls,0);
});

test('network errors never leak provider exception content',async()=>{
  const gateway=createJevGateway({apiKey:key,fetchImpl:async()=>{throw Error(`Bearer ${key} ${JSON.stringify(request())}`);}});
  await assert.rejects(gateway.decide(request()),error=>!JSON.stringify(error).includes(key)&&errorCode('JEV_NETWORK_ERROR',502)(error));
});

test('timeout is enforced even when fetch ignores AbortSignal',async()=>{
  const gateway=createJevGateway({apiKey:key,timeoutMs:5,fetchImpl:()=>new Promise(()=>{})});
  await assert.rejects(gateway.decide(request()),errorCode('JEV_TIMEOUT',504));
  assert.equal(gateway.status().activeCalls,0);assert.equal(gateway.status().attemptedCalls,1);
});

test('cancellation aborts in-flight request and pre-aborted request is not charged',async()=>{
  const controller=new AbortController(); let suppliedSignal;
  const gateway=createJevGateway({apiKey:key,fetchImpl:async(_url,options)=>{suppliedSignal=options.signal;return new Promise(()=>{});}});
  const first=gateway.decide(request(),{signal:controller.signal});controller.abort();
  await assert.rejects(first,errorCode('JEV_CANCELLED',499));assert.equal(suppliedSignal.aborted,true);
  await assert.rejects(gateway.decide(request('second'),{signal:controller.signal}),errorCode('JEV_CANCELLED',499));
  assert.equal(gateway.status().attemptedCalls,1);
});

for (const [name,change] of [
  ['a GPT substitution',p=>{p.model='openai/gpt-4o';}],
  ['missing answers',p=>{delete p.answers.enter;}],
  ['extra answers',p=>{p.answers.other={type:'noul',noul:1};}],
  ['wrong answer type',p=>{p.answers.enter.type='choice';}],
  ['out of range noul',p=>{p.answers.enter.noul=1.1;}],
  ['unknown selected option',p=>{p.answers.purchase.choice='jelly';}],
  ['missing probability',p=>{delete p.answers.purchase.probabilities.none;}],
  ['extra probability',p=>{p.answers.purchase.probabilities.jelly=0;}],
  ['negative probability',p=>{p.answers.purchase.probabilities.none=-0.1;}],
  ['incorrect probability mass',p=>{p.answers.purchase.probabilities.water=0.2;}],
  ['a numeric string',p=>{p.answers.purchase.probabilities.water='1';}],
  ['invalid confidence',p=>{p.answers.purchase.confidence=-1;}],
  ['invalid usage',p=>{p.usage.cost=-1;}],
]) test(`rejects ${name} without fallback`,async()=>{
  const p=payload();change(p);
  const gateway=createJevGateway({apiKey:key,fetchImpl:async()=>response(p)});
  await assert.rejects(gateway.decide(request()),errorCode('JEV_INVALID_RESPONSE',502));
  assert.equal(gateway.status().successfulCalls,0);
});

test('allowlist strips unexpected response fields and credential-like metadata',async()=>{
  const p=payload();p.extra=key;p.provider=`Bearer ${key}`;p.id=key;p.usage.state=key;p.answers.purchase.rationale=key;
  const gateway=createJevGateway({apiKey:key,fetchImpl:async()=>response(p)});
  const result=await gateway.decide(request());
  assert.ok(!JSON.stringify(result).includes(key));assert.equal(result.provider,null);assert.equal(result.upstreamRequestId,null);
  assert.equal(result.answers.purchase.rationale,undefined);
});

test('oversized and malformed response bodies are rejected',async()=>{
  for(const supplied of [new Response('not JSON'),new Response('x'.repeat(130*1024))]) {
    const gateway=createJevGateway({apiKey:key,fetchImpl:async()=>supplied});
    await assert.rejects(gateway.decide(request()),errorCode('JEV_INVALID_RESPONSE',502));
  }
});

for (const [name,change] of [
  ['caller model override',r=>{r.model='openai/gpt-4o';}],
  ['empty request ID',r=>{r.requestId='';}],
  ['empty state',r=>{r.state={};}],
  ['non-JSON input',r=>{r.state.budget=Infinity;}],
  ['empty question set',r=>{r.questions={};}],
  ['missing noul criteria',r=>{delete r.questions.enter.criteria.false;}],
  ['unsupported question type',r=>{r.questions.enter.type='score';}],
  ['too many options',r=>{r.questions.purchase.criteria=Object.fromEntries(Array.from({length:26},(_,i)=>['p'+i,'Product']));}],
  ['blank instruction',r=>{r.questions.purchase.instructions=' ';}],
]) test(`rejects ${name} before network`,async()=>{
  let count=0;const gateway=createJevGateway({apiKey:key,fetchImpl:async()=>{count++;return response();}});
  const r=request();change(r);
  await assert.rejects(gateway.decide(r),errorCode('JEV_INVALID_REQUEST',400));assert.equal(count,0);
});

test('request depth and byte limits protect server body handling',async()=>{
  const gateway=createJevGateway({apiKey:key,fetchImpl:async()=>response()});
  const deep=request();for(let i=0;i<17;i++)deep.state={nested:deep.state};
  await assert.rejects(gateway.decide(deep),errorCode('JEV_INVALID_REQUEST',400));
  const large=request();large.state=Array.from({length:8},()=> '가'.repeat(10000));
  await assert.rejects(gateway.decide(large),errorCode('JEV_REQUEST_TOO_LARGE',413));
});

test('caller synthetic metadata cannot override gateway provenance',async()=>{
  let sent;const gateway=createJevGateway({apiKey:key,fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return response();}});
  const input=request();input.state.sourceContext={synthetic:false,observedCustomerData:true};
  await gateway.decide(input);
  assert.deepEqual(sent.state.sourceContext,{synthetic:true,kind:'convenience-store-simulation',observedCustomerData:false});
});

test('invalid configuration is rejected and a zero budget disables paid calls',async()=>{
  for(const options of [{maxCalls:21},{maxCalls:-1},{maxCalls:1.5},{timeoutMs:0},{apiKey:'header\ninjection'}]) {
    assert.throws(()=>createJevGateway(options),/Invalid JEV gateway configuration/);
  }
  const gateway=createJevGateway({apiKey:key,maxCalls:0});
  await assert.rejects(gateway.decide(request()),errorCode('JEV_BUDGET_EXHAUSTED',429));
});
