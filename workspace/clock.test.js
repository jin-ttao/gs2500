import test from 'node:test';
import assert from 'node:assert/strict';
import {frameDelta} from './clock.js';
test('first rAF timestamp cannot create a negative world step',()=>{assert.equal(frameDelta(99,100),0);assert.equal(frameDelta(100,100),0);});
test('clock clamps suspended frames and rejects invalid time',()=>{assert.equal(frameDelta(100000,100),.08);assert.equal(frameDelta(NaN,100),0);assert.equal(frameDelta(116,100),.016);});
