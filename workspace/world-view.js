import {createWorld} from '../demo/world.js';
import {createCardWorlds} from '../demo/card-worlds.js';
import {loadPersonaCatalog} from '../demo/personas.js';
import {getWorldConfig} from './data.js';
import {frameDelta} from './clock.js';
let personas;
const catalog=()=>personas??=(loadPersonaCatalog().catch(error=>{personas=null;throw error;}));
const cache=new Map();
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const won=value=>Math.round(value).toLocaleString('ko-KR')+'원';
export function resetWorldViews(){cache.clear();}
/** Separate behavioral lens: never writes 30-day forecast or approved results. */
export async function mountWorlds(host,{bays,stores,results,selection,detail=false,signal}={}){
  const people=await catalog();if(signal?.aborted)return()=>{};
  const rows=bays.flatMap(bay=>{
    const store=stores.find(s=>s.id===bay.storeId);
    const plans=detail?bay.candidates.filter(c=>c.id===selection):[{id:'baseline',scenario:'hq',name:'현재 진열'},...bay.candidates];
    return plans.map(candidate=>{
      const key=`${store.id}:${bay.id}:${candidate.id}`;
      if(!cache.has(key))cache.set(key,createWorld({...getWorldConfig({storeId:store.id,bayId:bay.id,candidateId:candidate.id==='baseline'?null:candidate.id}),mode:'day',population:1000,limit:1000,duration:86400,personaCatalog:people,runId:`workflow-lens:${key}`}));
      return {id:key,store,bay,candidate,world:cache.get(key)};
    });
  });
  const card=row=>{
    const comparison=results[`${row.store.id}:${row.bay.id}`];
    const forecast=row.candidate.id==='baseline'?comparison?.baseline:comparison?.candidates.find(c=>c.candidateId===row.candidate.id);
    return `<${detail?'div':'button'} class="world-card${row.candidate.id===selection?' selected':''}" ${row.candidate.id==='baseline'?'disabled aria-label="현재 진열 기준선"':`data-action="select-candidate" data-route="candidate" data-store="${row.store.id}" data-bay="${row.bay.id}" data-candidate="${row.candidate.id}"`}><header><span>${escape(row.candidate.name)}</span><span>${row.candidate.id==='baseline'?'기준선':row.candidate.id}</span></header><div class="world-viewport${detail?' detail':''}" data-world="${row.id}"><div class="world-live-note">로컬 행동 관찰 · 원본 엔진</div></div><footer><span>30일 모형 매출</span><strong>${forecast?won(forecast.revenue):'미계산'}</strong></footer><small data-world-status="${row.id}">공간과 상품 위치를 불러오는 중</small></${detail?'div':'button'}>`;
  };
  host.innerHTML=`<div class="world-controls"><button type="button" data-world-pause>관찰 일시정지</button><span>동작 4× · 사람이 없는 시간만 건너뜀 · 하루 종료 시 정지</span></div>${detail?rows.map(card).join(''):`<div class="world-grid">${bays.map(bay=>`<section class="world-store"><h3>${escape(stores.find(s=>s.id===bay.storeId).name)} <small>${escape(bay.id)}</small></h3><div class="world-options">${rows.filter(r=>r.bay===bay).map(card).join('')}</div></section>`).join('')}</div>`}<p class="world-disclosure">3D는 Nemotron 합성 페르소나 1,000명의 기존 하루 엔진을 관찰하는 별도 창입니다. 위 30일 숫자는 동일 SKU·진열·초기 재고를 사용한 수요 모형 결과이며, 이 화면의 방문 결제를 30일로 환산한 값이 아닙니다. JEV 미호출.</p>`;
  let renderer;
  try{renderer=await createCardWorlds(rows.map(row=>({id:row.id,element:host.querySelector(`[data-world="${row.id}"]`),getWorld:()=>row.world})));}
  catch{host.innerHTML='<div class="world-error" role="alert">3D 연결 실패: WebGL 또는 에셋을 불러오지 못했습니다. 30일 계산 결과는 유지됩니다. 화면을 다시 열어 재시도해주세요. <a href="./demo/">원본 3D 실험실</a></div>';return()=>{};}
  if(signal?.aborted){renderer.dispose();return()=>{};}
  let raf,last=performance.now(),paused=false,disposed=false,acc=0;
  const pause=host.querySelector('[data-world-pause]');pause.onclick=()=>{paused=!paused;pause.textContent=paused?'관찰 재개':'관찰 일시정지';};
  function frame(now){
    if(disposed)return;
    const dt=frameDelta(now,last);last=now;
    if(!paused&&!document.hidden){
      // Every world advances together. Rendering speed is not forecast revenue.
      for(const row of rows){
        if(row.world.isComplete)continue;
        if(row.world.isQuiescent())row.world.update(Math.max(0,row.world.nextBoundary()-row.world.time));
        row.world.update(dt*4);
      }
    }
    renderer.render();acc+=dt;
    if(acc>.5){acc=0;for(const row of rows){const el=host.querySelector(`[data-world-status="${row.id}"]`);if(el)el.textContent=`하루 관찰 ${Math.floor(row.world.time/3600)}:${String(Math.floor(row.world.time%3600/60)).padStart(2,'0')} · 매장 내 ${row.world.agents.length}명 · 별도 관찰 결제 ${won(row.world.paidRevenue)}`;}}
    raf=requestAnimationFrame(frame);
  }
  raf=requestAnimationFrame(frame);
  return()=>{disposed=true;cancelAnimationFrame(raf);renderer.dispose();};
}
