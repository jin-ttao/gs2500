import {createCardWorlds} from '../demo/card-worlds.js';
import {createLedgerReplay} from './ledger-replay.js';
import {PRODUCT_MAP} from './data.js';

const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const won=value=>Math.round(value).toLocaleString('ko-KR')+'원';
const count=value=>Number(value).toLocaleString('ko-KR');
const fresh=()=>({key:null,progress:0,speed:1,running:true});
let session=fresh(),sessionGeneration=0;
export function resetWorldViews(){sessionGeneration++;session=fresh();}

/** Cards accumulate the original hourly ledger; 3D is its compressed visual
 * accompaniment, not a second shopping engine or an estimate of concurrency. */
export async function mountWorlds(host,{bays,stores,results,selection,selectedStoreId,detail=false,busy=false,signal}={}){
  if(busy||bays.some(bay=>!results[`${bay.storeId}:${bay.id}`]?.completed)){
    host.innerHTML=busy?'<div class="world-placeholder"><p>같은 조건의 30일 계산 기록을 준비하고 있습니다.</p><small>계산 시간은 재생과 별도입니다. 완료 후 누적 매출 0원부터 시작합니다.</small></div>':'<div class="world-placeholder"><p>아직 계산 전 · 누적 매출 0원</p><small>위의 30일 시뮬레이션 시작 버튼으로 전체 점포·진열안을 계산하고 빠르게 재생하세요.</small></div>';return()=>{};
  }
  if(signal?.aborted)return()=>{};
  const key=Object.keys(results).sort().map(id=>`${id}:${results[id].inputFingerprint}`).join('|');
  if(session.key!==null&&session.key!==key)resetWorldViews();
  session.key=key;
  const ownGeneration=sessionGeneration;
  const rows=bays.flatMap(bay=>{
    const store=stores.find(item=>item.id===bay.storeId),comparison=results[`${store.id}:${bay.id}`];
    const plans=detail?bay.candidates.filter(candidate=>candidate.id===selection):[{id:'current',name:'현재 진열'},...bay.candidates];
    return plans.map(candidate=>({id:`${store.id}:${bay.id}:${candidate.id}`,store,bay,candidate,mapId:store.mapId,
      result:candidate.id==='current'?comparison.baseline:comparison.candidates.find(item=>item.candidateId===candidate.id)}));
  });
  const replay=createLedgerReplay(rows);replay.seek(session.progress).setSpeed(session.speed);replay.running=session.running;
  const focused=rows.find(row=>row.store.id===selectedStoreId&&row.candidate.id===selection)??rows[0];
  function card(row){
    const baseline=row.candidate.id==='current',selected=row===focused&&!baseline;
    return `<${baseline||detail?'article':'button'} class="world-card${selected?' selected':''}" ${baseline||detail?'':`type="button" data-action="select-candidate" data-route="candidate" data-store="${row.store.id}" data-bay="${row.bay.id}" data-candidate="${row.candidate.id}"`}>
      <header><span>${escape(row.candidate.name)}</span><span>${baseline?'기준선':row.candidate.id}</span></header>
      <div class="world-viewport${detail?' detail':''}" data-world="${row.id}"><div class="world-live-note">전체 기간 빠른 재생 · <span data-day-label>1</span>일차</div></div>
      <div class="world-plan-value"><span>지금까지 누적 매출</span><strong data-cumulative-revenue="${row.id}">0원</strong><small data-cumulative-entries="${row.id}">누적 입장 0명 · 0건 결제</small></div>
      <div class="world-plan-secondary"><span>누적 총이익 <b data-cumulative-profit="${row.id}">0원</b></span><span data-cumulative-stockout="${row.id}">품절 0.0%</span></div>
      <footer data-day-metrics="${row.id}"></footer><small data-world-status="${row.id}"></small>
      <small class="world-final-forecast">별도 최종 계산 · ${replay.dayCount}일 매출 ${won(row.result.revenue)}${baseline?'':` · 기준안 대비 ${row.result.deltaPercent>=0?'+':''}${row.result.deltaPercent.toFixed(1)}%`}</small>
    </${baseline||detail?'article':'button'}>`;
  }
  host.innerHTML=`<div class="world-controls compact" role="group" aria-label="시뮬레이션 재생"><strong data-period-status>1일차 00:00</strong><div class="world-transport"><button type="button" data-world-pause>${replay.running?'일시정지':'재생 시작'}</button><button type="button" data-world-restart title="매출·재고·캐릭터를 시작 상태로 초기화">처음부터</button><select data-world-speed aria-label="재생 배속">${[.5,1,2,4].map(speed=>`<option value="${speed}"${session.speed===speed?' selected':''}>${speed}×</option>`).join('')}</select></div><label class="world-scrubber"><input type="range" data-world-seek aria-label="전체 기간 재생 위치" min="0" max="1000" step="1" value="${Math.round(session.progress*1000)}"><output data-replay-progress></output></label></div>
      ${detail?rows.map(card).join(''):`<div class="world-grid">${bays.map(bay=>`<section class="world-store"><h3>${escape(stores.find(store=>store.id===bay.storeId).name)} <small>${escape(bay.id)}</small></h3><div class="world-options">${rows.filter(row=>row.bay===bay).map(card).join('')}</div></section>`).join('')}</div>`}
      <div class="ledger-explainer"><section><h3 data-ledger-title></h3><div data-ledger-events></div><p data-ledger-stock></p></section><section><h3>선택일의 대표 방문 기록</h3><ol data-ledger-visits></ol></section></div>
      <p class="world-disclosure">누적 매출·입장·보충·재고는 같은 ${replay.dayCount}일 계산의 시간별 기록이 끝날 때 합산됩니다. 3D는 그 기간의 대표 입장 기록을 최대 12명/일씩 빠르게 압축한 동선 설명입니다. 인접 시간대의 표본이 겹칠 수 있고 모든 방문·정확한 결제 순간·실제 동시 인원을 재현하지 않습니다. 위치와 구매는 해당 진열안의 기록을 따르며 재생·배속·이동으로 새 매출을 만들지 않습니다. 합성 로컬 모형 · JEV 미호출.</p>`;
  const pause=host.querySelector('[data-world-pause]'),seek=host.querySelector('[data-world-seek]');
  const elements=rows.map(row=>({row,revenue:host.querySelector(`[data-cumulative-revenue="${row.id}"]`),profit:host.querySelector(`[data-cumulative-profit="${row.id}"]`),entered:host.querySelector(`[data-cumulative-entries="${row.id}"]`),stockout:host.querySelector(`[data-cumulative-stockout="${row.id}"]`),metrics:host.querySelector(`[data-day-metrics="${row.id}"]`),status:host.querySelector(`[data-world-status="${row.id}"]`)}));
  let shownDay=null;
  function refreshDay(){
    shownDay=replay.day;
    host.querySelectorAll('[data-day-label]').forEach(element=>element.textContent=replay.day);
    const data=replay.getRow(focused.id);
    host.querySelector('[data-ledger-title]').textContent=`${focused.store.name} · ${focused.candidate.name} · ${replay.day}일차`;
    host.querySelector('[data-ledger-events]').innerHTML=data.day.events.length?data.day.events.map(event=>`<p><b>${escape(event.title)}</b> ${event.startHour}–${event.endHour}시 · 데모 가정</p>`).join(''):'<p>추가 행사·날씨 가정 없음 · 기본 상권/페르소나 조건</p>';
    host.querySelector('[data-ledger-visits]').innerHTML=data.dayVisits.slice(0,4).map(visit=>`<li><strong>${String(visit.hour).padStart(2,'0')}시 · ${escape(visit.name??'합성 방문자')}</strong><span>${visit.decisions.length?visit.decisions.map(decision=>`${escape(PRODUCT_MAP[decision.productId]?.name??decision.productId)} ${decision.level}단 ${decision.column}열 · ${decision.outcome==='purchased'?'구매':'매대 품절'}`).join(' / '):'구매하지 않고 퇴장'} · 기록된 결제 ${won(visit.paidAmount)}</span></li>`).join('')||'<li>이날 기록된 대표 입장이 없습니다.</li>';
  }
  function refreshProgress(){
    if(shownDay!==replay.day)refreshDay();
    seek.value=String(Math.round(replay.progress*1000));
    const hour=String(replay.hour).padStart(2,'0');
    host.querySelector('[data-replay-progress]').textContent=`${Math.round(replay.progress*100)}%`;
    const ready=replay.progress===0&&!replay.running;
    host.querySelector('[data-period-status]').textContent=replay.isComplete?`${replay.dayCount}일 완료`:`${replay.day}일차 ${hour}:00`;
    host.dataset.periodProgress=String(replay.progress);host.dataset.periodDay=String(replay.day);host.dataset.periodComplete=String(replay.isComplete);
    pause.textContent=replay.isComplete?'재생 완료':replay.running?'일시정지':ready?'재생 시작':'계속 재생';pause.disabled=replay.isComplete;
    for(const item of elements){const data=replay.getRow(item.row.id),c=data.cumulative;
      item.revenue.textContent=won(c.revenue);item.profit.textContent=won(c.profit);
      item.entered.textContent=`누적 입장 ${count(c.entered)}명 · ${count(c.payments)}건 결제`;
      item.stockout.textContent=`누적 품절 ${(c.purchaseDemand?c.stockoutDemand/c.purchaseDemand*100:0).toFixed(1)}%`;
      item.metrics.innerHTML=`<span>${replay.day}일차 현재 누적</span><strong>${won(data.dayCumulative.revenue)}</strong><span>기간 누적 보충 ${count(c.replenishedUnits)}개 · 매대 ${count(data.stock.shelf)} / 창고 ${count(data.stock.backroom)}개</span>`;
      item.status.textContent=`대표 기록 ${data.sampleCount}명/일 · 화면 ${data.world.agents.length}명 · 실제 동시 인원 아님`;
    }
    const focusedData=replay.getRow(focused.id),c=focusedData.cumulative;
    host.querySelector('[data-ledger-stock]').textContent=`기간 누적 보충 ${count(c.replenishedUnits)}개 · 납품 ${count(c.receivedUnits)}개 · 잠재 방문 ${count(c.potential)}명 중 미입장 ${count(c.skipped)}명 · 시간 구간 ${count(focusedData.completedBins)}개 반영`;
    if(ownGeneration===sessionGeneration&&!signal?.aborted)Object.assign(session,{progress:replay.progress,running:replay.running,speed:replay.speed});
  }
  host.querySelector('[data-world-speed]').onchange=event=>{replay.setSpeed(Number(event.target.value));refreshProgress();};
  host.querySelector('[data-world-restart]').onclick=()=>{replay.restart();refreshProgress();};
  pause.onclick=()=>{replay.running?replay.pause():replay.play();refreshProgress();};
  seek.oninput=()=>{replay.pause().seek(Number(seek.value)/1000);refreshProgress();};
  refreshProgress();
  let renderer;
  try{renderer=await createCardWorlds(rows.map(row=>({id:row.id,element:host.querySelector(`[data-world="${row.id}"]`),getWorld:()=>replay.worlds.get(row.id)})),{presentation:'embedded'});}
  catch{host.innerHTML='<div class="world-error" role="alert">3D 연결 실패. 계산 기록·예상치와 승인 상태는 유지됩니다. 화면을 다시 열어 재시도해주세요.</div>';return()=>{};}
  if(signal?.aborted){renderer.dispose();return()=>{};}
  let raf,last=performance.now(),disposed=false,acc=0;
  const visibilityChanged=()=>{last=performance.now();};
  document.addEventListener('visibilitychange',visibilityChanged);
  function frame(now){
    if(disposed)return;
    // Period progress uses actual visible elapsed time, not a per-frame cap;
    // a slow GPU must not turn 45 seconds into several minutes.
    const dt=Number.isFinite(now)&&Number.isFinite(last)?Math.max(0,(now-last)/1000):0;last=now;
    const previousProgress=replay.progress;
    if(!document.hidden)replay.advance(dt);
    renderer.render();acc+=dt;
    if(replay.progress!==previousProgress&&(acc>=.1||replay.isComplete||shownDay!==replay.day)){acc=0;refreshProgress();}
    raf=requestAnimationFrame(frame);
  }
  renderer.render();raf=requestAnimationFrame(frame);
  return()=>{disposed=true;cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',visibilityChanged);refreshProgress();renderer.dispose();};
}
