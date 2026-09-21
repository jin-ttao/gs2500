import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('comparison UI avoids a fixed-duration promise and distinguishes recorded visits',()=>{
  const html=read('./index.html'),app=read('./app.js');
  assert.doesNotMatch(html+app,/10초|10s SUMMARY|TEN-SECOND/);
  assert.match(html,/빠른 비교/);assert.match(html,/실제 동시 방문이 아니며/);
  assert.match(html,/최초 계산 시간은 별도/);
  for(const speed of ['0.5','1','2'])assert.match(html,new RegExp(`data-replay-speed="${speed.replace('.','\\.')}"`));
  assert.match(app,/replay\?\.setSpeed\(replaySpeed\)/);
});
test('static builds retain the recorder, worker and presentation modules',()=>{
  const build=read('./scripts/build.mjs');
  for(const file of ['summary-replay.js','replay-recorder.js','replay-worker.js'])assert.ok(build.includes(`'${file}'`));
});
