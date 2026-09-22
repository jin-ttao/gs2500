import test from 'node:test';
import assert from 'node:assert/strict';
import {cardGradient,cardTexture,GRADIENT_FEEL_FLOOR} from './obolus-surfaces.js';

test('ported Obolus surfaces remain deterministic and visually distinct across store seeds',()=>{
  const seeds=Array.from({length:100},(_,index)=>`H-${index}:water:restock`);
  const gradients=seeds.map(seed=>cardGradient(seed));
  assert.ok(new Set(gradients).size>=GRADIENT_FEEL_FLOOR);
  for(const seed of seeds){
    assert.equal(cardGradient(seed),cardGradient(seed));
    assert.equal(cardTexture(seed),cardTexture(seed));
    assert.notEqual(cardGradient(seed,'deep'),cardGradient(seed,'soft'));
  }
});

test('surface inputs cannot inject a network URL or HTML into generated styles',()=>{
  const seed='<script>alert(1)</script>https://example.invalid/private';
  assert.ok(!cardGradient(seed).includes(seed));
  assert.ok(!cardTexture(seed).includes(seed));
  assert.match(cardGradient(''),/gradient/);
  assert.match(cardTexture(seed),/^url\("data:image\/svg\+xml/);
});
