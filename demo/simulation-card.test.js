import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSimulationCard} from './components/ui/simulation-card.js';
import {STORE_CATALOG} from './lab.js';
import {SCENARIOS} from './model.js';

const hooks=['card-clock','revenue','profit','stockout','progress','completed','active','considered','entered','skipped','buyers','inventory','owner'];

test('all thirty-six store candidates share the same card structure and retain every live data hook once',()=>{
  const structures=[];
  for(const store of STORE_CATALOG)for(const [scenario,data] of Object.entries(SCENARIOS)){
    const html=renderSimulationCard({letter:scenario,title:data.title,description:store.subtitle,storeName:store.name});
    for(const hook of hooks)assert.equal((html.match(new RegExp(`\\bdata-${hook}(?=[\\s=>])`,'g'))??[]).length,1,hook);
    assert.equal((html.match(/class="card-viewport"/g)??[]).length,1);
    assert.match(html,/role="img"/);assert.match(html,/role="progressbar"/);
    assert.match(html,/aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"/);
    structures.push([...html.matchAll(/class="([^"]+)"/g)].map(match=>match[1]));
  }
  assert.equal(structures.length,36);
  for(const structure of structures)assert.deepEqual(structure,structures[0]);
});

test('the card body has no nested interactive controls or external placeholder assets',()=>{
  const html=renderSimulationCard({letter:'A',title:'본사 표준안',description:'합성 점포',storeName:'삼성역점'});
  assert.doesNotMatch(html,/<(?:a|button|input|select)\b/i);
  assert.doesNotMatch(html,/https?:|<img\b|Feb|weeks left|Prototyping/i);
  assert.match(html,/시뮬레이션 결제매출/);assert.match(html,/합성 실험/);
  assert.match(html,/모의 고객/);assert.match(html,/보충 담당자/);
});

test('reference text is escaped before rendering into card markup',()=>{
  const malicious='<img src=x onerror="bad()">&';
  const html=renderSimulationCard({letter:malicious,title:malicious,description:malicious,storeName:malicious});
  assert.doesNotMatch(html,/<img\b/);
  assert.equal((html.match(/&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;&amp;/g)??[]).length,5);
});
