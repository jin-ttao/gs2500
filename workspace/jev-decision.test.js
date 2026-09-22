import test from 'node:test';
import assert from 'node:assert/strict';
import { applyJevDecision } from './jev-decision.js';

const request={questions:{purchase:{criteria:{none:'none',water:'water'}}},state:{visit:{budget:1600},eligibility:{visibleProductIds:['water']},products:[{id:'water',price:1100,eligible:true,visible:true,stock:{shelf:2}}]}};
const response={model:'typesafe/jev-1.13-20260917',answers:{enter:{type:'noul',noul:.75},purchase:{type:'choice',choice:'water',probabilities:{none:.2,water:.8}}}};
const draws={entryDraw:.2,purchaseDraw:.6};

test('typed JEV probability distributions drive seeded entry and conditional product selection',()=>{
  assert.equal(applyJevDecision(request,response,draws).productId,'water');
  const absent=applyJevDecision(request,response,{...draws,entryDraw:.8});
  assert.equal(absent.entered,false);assert.equal(absent.productId,null);
  assert.equal(applyJevDecision(request,response,{...draws,purchaseDraw:.1}).productId,null);
});

test('JEV rejects substitutions, invalid probabilities, and unknown/unavailable choices',()=>{
  const invalids=[
    {...response,model:'openai/gpt-4o'},
    {...response,answers:{...response.answers,enter:{type:'noul',noul:1.2}}},
    {...response,answers:{...response.answers,purchase:{type:'choice',choice:'gummy',probabilities:{none:.2,water:.8}}}},
    {...response,answers:{...response.answers,purchase:{type:'choice',choice:'water',probabilities:{none:.2,water:.7}}}},
    {...response,answers:{...response.answers,purchase:{type:'choice',choice:'water',probabilities:{none:.1,water:.8,gummy:.1}}}},
  ];
  for(const invalid of invalids)assert.throws(()=>applyJevDecision(request,invalid,draws));
  for(const product of [{price:1700},{visible:false},{eligible:false},{stock:{shelf:0}}]){
    const bad=structuredClone(request);Object.assign(bad.state.products[0],product);
    assert.throws(()=>applyJevDecision(bad,response,draws));
  }
});
