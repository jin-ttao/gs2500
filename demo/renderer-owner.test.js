import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOwnerVisual, ownerAnimationState, syncOwnerVisual } from './card-worlds.js';

const owner=(changes={})=>({id:'stock-owner',state:'idle',position:[2,-3],heading:1.25,speed:.8,velocity:0,stateTime:0,productId:null,quantity:0,completedTasks:0,reachLevel:2,...changes});
function fixture(){
  const calls=[];let clip='Idle',disposed=0,characterId;
  const actor=createOwnerVisual(id=>{
    characterId=id;
    const root=new THREE.Group(),material=new THREE.MeshBasicMaterial({color:'white'});material.name='Outerwear';
    root.add(new THREE.Mesh(new THREE.BoxGeometry(),material));
    return {root,carrier:new THREE.Group(),pose:()=>({clip}),update:(dt,state,snap)=>{calls.push({dt,state,snap});clip=state.state;},dispose:()=>{disposed++;}};
  });
  return {actor,calls,get disposed(){return disposed;},get characterId(){return characterId;}};
}

test('stock-worker states map to existing rig clips without changing source facts',()=>{
  for(const [state,mapped] of [['idle','idle'],['walking','walking'],['returning','walking'],['replenishing','reaching']]){
    const source=Object.freeze(owner({state,position:Object.freeze([3,4]),reachLevel:4}));
    const result=ownerAnimationState(source);
    assert.equal(result.state,mapped);assert.equal(result.reachLevel,4);assert.deepEqual(result.basket,[]);
    assert.equal(source.state,state);
  }
  assert.equal(ownerAnimationState(null),null);
  assert.equal(ownerAnimationState(owner({position:[NaN,2]})),null);
});

test('owner position and heading are exact, engine elapsed time is the only pose delta',()=>{
  const {actor,calls}=fixture();
  const source=owner({state:'walking',velocity:.8,stateTime:4});
  const first=syncOwnerVisual(actor,source,10,{runId:'run-a'});
  assert.deepEqual(first.position,source.position);assert.equal(first.heading,source.heading);
  assert.equal(first.renderedTime,10);assert.equal(first.renderedRunId,'run-a');
  assert.equal(calls[0].dt,0);assert.equal(calls[0].snap,true);
  source.position=[2.5,-2.9];source.stateTime=4.5;
  const second=syncOwnerVisual(actor,source,10.5,{runId:'run-a'});
  assert.equal(calls[1].dt,.5);assert.equal(calls[1].snap,false);
  assert.deepEqual(second.position,[2.5,-2.9]);
  assert.deepEqual(first.position,[2,-3],'prior drawn snapshot is detached');
  const paused=syncOwnerVisual(actor,source,10.5,{runId:'run-a'});
  assert.equal(calls[2].dt,0);assert.deepEqual(paused,second);
});

test('replenishment state changes, reset and offscreen return seek the engine phase',()=>{
  const {actor,calls}=fixture();
  syncOwnerVisual(actor,owner({state:'walking',velocity:.8,stateTime:3}),3);
  const source=owner({state:'replenishing',stateTime:1.7,reachLevel:4,productId:'example',quantity:8});
  const result=syncOwnerVisual(actor,source,8);
  assert.equal(calls.at(-1).snap,true);assert.equal(calls.at(-1).dt,0);
  assert.equal(calls.at(-1).state.stateTime,1.7);assert.equal(result.animationState,'reaching');
  assert.equal(result.state,'replenishing');assert.equal(result.quantity,8);
  syncOwnerVisual(actor,source,14,{snap:true});
  assert.equal(calls.at(-1).snap,true);assert.equal(calls.at(-1).dt,0);
  syncOwnerVisual(actor,owner({state:'replenishing',stateTime:.1}),.1);
  assert.equal(calls.at(-1).snap,true);
});

test('legacy worlds hide the worker and reappearance does not animate hidden elapsed time',()=>{
  const {actor,calls}=fixture();
  syncOwnerVisual(actor,owner(),1);
  assert.equal(syncOwnerVisual(actor,null,8),null);
  assert.equal(actor.group.visible,false);assert.equal(actor.carrier.visible,false);assert.equal(calls.length,1);
  syncOwnerVisual(actor,owner({stateTime:3}),11);
  assert.equal(actor.group.visible,true);assert.equal(calls.at(-1).snap,true);assert.equal(calls.at(-1).dt,0);
});

test('detail and card consumers produce identical owner snapshots for the same world',()=>{
  const detail=fixture(),card=fixture();
  for(const [time,source] of [[0,owner()],[.5,owner({state:'walking',stateTime:.5,position:[1,2],velocity:.8})],[2,owner({state:'replenishing',stateTime:.7,reachLevel:1})],[2,owner({state:'replenishing',stateTime:.7,reachLevel:1})]]){
    assert.deepEqual(syncOwnerVisual(detail.actor,source,time,{runId:'same'}),syncOwnerVisual(card.actor,source,time,{runId:'same'}));
  }
  assert.deepEqual(detail.calls,card.calls);
});

test('the worker has a separate cyan rig and its marker is disposed',()=>{
  const value=fixture(),marker=value.actor.group.getObjectByName('stock-worker-marker');
  assert.equal(value.characterId,100008);
  assert.equal(value.actor.root.children[0].material.color.getHexString(),'19c8d7');
  let geometryDisposed=false,materialDisposed=false;
  marker.geometry.addEventListener('dispose',()=>geometryDisposed=true);
  marker.material.addEventListener('dispose',()=>materialDisposed=true);
  value.actor.dispose();
  assert.equal(value.disposed,1);assert.equal(geometryDisposed,true);assert.equal(materialDisposed,true);
});
