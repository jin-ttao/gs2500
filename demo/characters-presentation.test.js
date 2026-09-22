import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {presentationClipTime} from './characters.js';

test('absolute animation is opt-in and invalid values never change the live path',()=>{
  for(const agent of [{},{presentationAnimationTime:1},{presentationOnly:false,presentationAnimationTime:1},{presentationOnly:true,presentationAnimationTime:NaN},{presentationOnly:true,presentationAnimationTime:Infinity}])assert.equal(presentationClipTime(agent,1.1),null);
  for(const duration of [0,-1,NaN,Infinity])assert.equal(presentationClipTime({presentationOnly:true,presentationAnimationTime:1},duration),null);
});

test('explicit presentation time wraps deterministically without double applying speed',()=>{
  const agent={presentationOnly:true,presentationAnimationTime:2.7,speed:1.25};
  assert.ok(Math.abs(presentationClipTime(agent,1.1)-.5)<1e-12);
  assert.equal(presentationClipTime({...agent,speed:5},1.1),presentationClipTime(agent,1.1));
  assert.ok(Math.abs(presentationClipTime({...agent,presentationAnimationTime:-.1},1.1)-1)<1e-12);
});

test('a real mixer samples the same pose after pause, backward seek and rebind',()=>{
  const clip=new THREE.AnimationClip('Walk',1.1,[new THREE.NumberKeyframeTrack('.rotation[x]',[0,.55,1.1],[0,1,0])]);
  const root=new THREE.Object3D(),mixer=new THREE.AnimationMixer(root),action=mixer.clipAction(clip);
  action.play();
  const pose=time=>{action.time=presentationClipTime({presentationOnly:true,presentationAnimationTime:time},clip.duration);mixer.update(0);return root.rotation.x;};
  const first=pose(.33);assert.ok(first>.5&&first<.7);
  assert.equal(pose(.33),first);pose(.9);assert.equal(pose(.33),first);
  mixer.stopAllAction();action.reset().play();assert.equal(pose(.33),first);
});
