/** Controller tests with a small DOM/renderer double; browser rendering is
 * verified separately. The real period replay and original controller run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createLedgerReplay,PERIOD_REPLAY_SECONDS} from './ledger-replay.js';
import {simulateComparison} from './forecast.js';
import {STORES,BAYS,PRODUCT_MAP} from './data.js';

const source=(await readFile(new URL('./world-view.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const store=STORES[0],bay=BAYS.find(row=>row.storeId===store.id);
const comparison=simulateComparison({storeId:store.id,bayId:bay.id,populationPerDay:10});
const results={[`${store.id}:${bay.id}`]:comparison};
function harness(){
  let now=0,nextFrame=0;const frames=new Map(),renderers=[],events=new Map();
  const doc={hidden:false,addEventListener(name,callback){events.set(name,callback);},removeEventListener(name){events.delete(name);}};
  const context=vm.createContext({createLedgerReplay,PERIOD_REPLAY_SECONDS,PRODUCT_MAP,document:doc,
    performance:{now:()=>now},requestAnimationFrame(callback){frames.set(++nextFrame,callback);return nextFrame;},cancelAnimationFrame(id){frames.delete(id);},
    async createCardWorlds(entries){const renderer={entries,renders:0,disposed:false,render(){this.renders++;},dispose(){this.disposed=true;}};renderers.push(renderer);return renderer;},
  });
  vm.runInContext(source,context);
  function host(){
    const nodes=new Map(),lists=new Map();
    const get=selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'',innerHTML:'',value:'0',disabled:false,dataset:{}});return nodes.get(selector);};
    const surface={innerHTML:'',dataset:{},querySelector:get,querySelectorAll(selector){
      if(!lists.has(selector))lists.set(selector,selector==='[data-day-step]'?[-1,1].map(dayStep=>({disabled:false,dataset:{dayStep:String(dayStep)}})):selector==='[data-event-day]'?[4,10,20].map((eventDay,index)=>({dataset:{eventDay:String(eventDay),eventHour:String([17,10,14][index])}})):Array.from({length:4},()=>({textContent:''})));
      return lists.get(selector);
    }};
    return surface;
  }
  return {context,host,renderers,events,doc,async mount(surface,detail=false,signal){return context.mountWorlds(surface,{bays:[bay],stores:[store],results,selection:bay.candidates[0].id,selectedStoreId:store.id,detail,signal});},
    frame(seconds){now+=seconds*1000;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(now);},
  };
}
const revenue=(surface,candidate='current')=>surface.querySelector(`[data-cumulative-revenue="${store.id}:${bay.id}:${candidate}"]`).textContent;

test('fresh board starts at zero, uses a full-period slider and stops at exact final',async()=>{
  const h=harness(),surface=h.host(),dispose=await h.mount(surface);
  assert.equal(revenue(surface),'0원');assert.equal(surface.dataset.periodProgress,'0');assert.match(surface.innerHTML,/전체 기간 재생 위치/);assert.match(surface.innerHTML,/value="4"/);assert.doesNotMatch(surface.innerHTML,/다음 날 이어보기/);
  h.frame(15);assert.equal(surface.dataset.periodDay,'11');assert.notEqual(revenue(surface),'0원');
  h.frame(30);assert.equal(surface.dataset.periodComplete,'true');assert.equal(revenue(surface),comparison.baseline.revenue.toLocaleString('ko-KR')+'원');
  const final=revenue(surface);h.frame(90);assert.equal(revenue(surface),final);assert.equal(surface.querySelector('[data-world-pause]').disabled,true);
  surface.querySelector('[data-world-restart]').onclick();assert.equal(revenue(surface),'0원');assert.equal(surface.dataset.periodProgress,'0');
  assert.equal(surface.querySelector('[data-world-pause]').textContent,'재생 시작');h.frame(10);assert.equal(revenue(surface),'0원');assert.equal(surface.dataset.periodProgress,'0');
  surface.querySelector('[data-world-pause]').onclick();h.frame(1.5);assert.equal(surface.dataset.periodDay,'2');dispose();
});

test('detail/board re-entry retains period progress and stale disposal cannot undo a reset',async()=>{
  const h=harness(),board=h.host(),dispose=await h.mount(board);h.frame(12);const progress=board.dataset.periodProgress;dispose();
  const detail=h.host(),disposeDetail=await h.mount(detail,true);assert.equal(detail.dataset.periodProgress,progress);assert.equal(revenue(detail,bay.candidates[0].id),comparison.candidates[0].replay.timeline[191].cumulative.revenue.toLocaleString('ko-KR')+'원');
  h.context.resetWorldViews();disposeDetail();
  const fresh=h.host(),disposeFresh=await h.mount(fresh);assert.equal(fresh.dataset.periodProgress,'0');assert.equal(revenue(fresh),'0원');disposeFresh();
});

test('compact transport preserves pause, speed and seeking without explanatory controls',async()=>{
  const h=harness(),surface=h.host(),dispose=await h.mount(surface);
  surface.querySelector('[data-world-pause]').onclick();h.frame(10);assert.equal(revenue(surface),'0원');
  surface.querySelector('[data-world-speed]').onchange({target:{value:'4'}});surface.querySelector('[data-world-pause]').onclick();h.frame(1.5);assert.equal(surface.dataset.periodDay,'5');
  assert.match(surface.innerHTML,/world-controls compact/);assert.doesNotMatch(surface.innerHTML,/data-event-day|data-day-step|data-world-day|world-period-heading|world-event-shortcuts/);
  const slider=surface.querySelector('[data-world-seek]');slider.value='650';slider.oninput();assert.equal(surface.dataset.periodDay,'20');assert.equal(surface.querySelector('[data-world-pause]').textContent,'계속 재생');
  slider.value='0';slider.oninput();assert.equal(revenue(surface),'0원');dispose();
});

test('idle and busy placeholders differ and visibility changes do not count hidden time',async()=>{
  const h=harness(),idle=h.host();await h.context.mountWorlds(idle,{bays:[bay],stores:[store],results:{}});assert.match(idle.innerHTML,/아직 계산 전/);assert.doesNotMatch(idle.innerHTML,/준비하고/);
  const busy=h.host();await h.context.mountWorlds(busy,{bays:[bay],stores:[store],results:{},busy:true});assert.match(busy.innerHTML,/준비하고/);
  const surface=h.host(),dispose=await h.mount(surface);h.doc.hidden=true;h.events.get('visibilitychange')();h.frame(30);assert.equal(surface.dataset.periodProgress,'0');h.doc.hidden=false;h.events.get('visibilitychange')();h.frame(1.5);assert.equal(surface.dataset.periodDay,'2');dispose();assert.equal(h.events.has('visibilitychange'),false);
});

test('paused and completed frames do not repeatedly rewrite unchanged metrics',async()=>{
  const h=harness(),surface=h.host(),dispose=await h.mount(surface);
  const metric=surface.querySelector(`[data-cumulative-revenue="${store.id}:${bay.id}:current"]`);
  let writes=0,value=metric.textContent;
  Object.defineProperty(metric,'textContent',{get:()=>value,set(next){writes++;value=next;}});
  surface.querySelector('[data-world-pause]').onclick();writes=0;
  h.frame(10);h.frame(10);assert.equal(writes,0);
  surface.querySelector('[data-world-pause]').onclick();h.frame(45);writes=0;
  h.frame(10);h.frame(10);assert.equal(writes,0);dispose();
});
