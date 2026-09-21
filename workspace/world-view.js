import {createCardWorlds} from '../demo/card-worlds.js';
import {createLedgerReplay} from './ledger-replay.js';
import {PRODUCT_MAP} from './data.js';
import {frameDelta} from './clock.js';

const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const won=value=>Math.round(value).toLocaleString('ko-KR')+'원';
const count=value=>value.toLocaleString('ko-KR');
let session={day:1,progress:0,speed:1,running:true,autoNext:true};
export function resetWorldViews(){session={day:1,progress:0,speed:1,running:true,autoNext:true};}

/** The cards consume only the forecast ledger. No independent purchase engine. */
export async function mountWorlds(host,{bays,stores,results,selection,selectedStoreId,detail=false,busy=false,signal}={}){
  if(busy||bays.some(bay=>!results[`${bay.storeId}:${bay.id}`]?.completed)){
    host.innerHTML='<div class="world-placeholder"><p>같은 조건의 30일 계산 기록을 준비하고 있습니다.</p><small>계산이 끝나면 같은 기록으로 카드와 3D를 표시합니다.</small></div>';return()=>{};
  }
  if(signal?.aborted)return()=>{};
  const rows=bays.flatMap(bay=>{
    const store=stores.find(item=>item.id===bay.storeId),comparison=results[`${store.id}:${bay.id}`];
    const plans=detail?bay.candidates.filter(candidate=>candidate.id===selection):[{id:'current',name:'현재 진열'},...bay.candidates];
    return plans.map(candidate=>({id:`${store.id}:${bay.id}:${candidate.id}`,store,bay,candidate,mapId:store.mapId,
      result:candidate.id==='current'?comparison.baseline:comparison.candidates.find(item=>item.candidateId===candidate.id)}));
  });
  const replay=createLedgerReplay(rows,{day:session.day});replay.seek(session.progress).setSpeed(session.speed);replay.running=session.running;
  const focused=rows.find(row=>row.store.id===selectedStoreId&&row.candidate.id===selection)??rows[0];
  function card(row){
    const baseline=row.candidate.id==='current',selected=row===focused&&!baseline;
    return `<${baseline||detail?'article':'button'} class="world-card${selected?' selected':''}" ${baseline||detail?'':`type="button" data-action="select-candidate" data-route="candidate" data-store="${row.store.id}" data-bay="${row.bay.id}" data-candidate="${row.candidate.id}"`}>
      <header><span>${escape(row.candidate.name)}</span><span>${baseline?'기준선':row.candidate.id}</span></header>
      <div class="world-viewport${detail?' detail':''}" data-world="${row.id}"><div class="world-live-note">같은 계산 기록 · <span data-day-label>${session.day}</span>일차</div></div>
      <div class="world-plan-value"><span>30일 예상 매출</span><strong>${won(row.result.revenue)}</strong><small>${baseline?'동일 조건 기준':`현재안 대비 ${row.result.deltaPercent>=0?'+':''}${row.result.deltaPercent.toFixed(1)}%`}</small></div>
      <div class="world-plan-secondary"><span>총이익 <b>${won(row.result.profit)}</b></span><span>품절 ${(row.result.stockoutRate*100).toFixed(1)}%</span></div>
      <footer data-day-metrics="${row.id}"></footer><small data-world-status="${row.id}"></small>
    </${baseline||detail?'article':'button'}>`;
  }
  host.innerHTML=`<div class="world-controls"><div class="world-transport"><button type="button" data-world-pause>${replay.running?'재생 일시정지':'기록 재생'}</button><button type="button" data-day-step="-1" aria-label="이전 일자">←</button><label>기록 일자 <select data-world-day aria-label="기록 일자">${Array.from({length:30},(_,i)=>`<option value="${i+1}"${session.day===i+1?' selected':''}>${i+1}일차</option>`).join('')}</select></label><button type="button" data-day-step="1" aria-label="다음 일자">→</button><label>재생 배속 <select data-world-speed aria-label="재생 배속">${[.5,1,2].map(speed=>`<option value="${speed}"${session.speed===speed?' selected':''}>${speed}×</option>`).join('')}</select></label><label><input type="checkbox" data-auto-next${session.autoNext?' checked':''}> 다음 날 이어보기</label></div><label class="world-scrubber">대표 방문 재생 <input type="range" data-world-seek aria-label="대표 방문 재생 위치" min="0" max="1000" step="1" value="${Math.round(session.progress*1000)}"><output data-replay-progress></output></label></div>
      <div class="world-event-shortcuts"><span>가정이 있는 날</span><button type="button" data-event-day="4">4일 · 퇴근길 비</button><button type="button" data-event-day="10">10일 · 신상품 관심</button><button type="button" data-event-day="20">20일 · 인근 행사</button></div>
      ${detail?rows.map(card).join(''):`<div class="world-grid">${bays.map(bay=>`<section class="world-store"><h3>${escape(stores.find(store=>store.id===bay.storeId).name)} <small>${escape(bay.id)}</small></h3><div class="world-options">${rows.filter(row=>row.bay===bay).map(card).join('')}</div></section>`).join('')}</div>`}
      <div class="ledger-explainer"><section><h3 data-ledger-title></h3><div data-ledger-events></div><p data-ledger-stock></p></section><section><h3>대표 방문의 판단 기록</h3><ol data-ledger-visits></ol></section></div>
      <p class="world-disclosure">30일 숫자·선택일 결과·구매/품절 기록은 하나의 로컬 계산에서 나옵니다. 3D는 시간대별 대표 입장 기록 중 최대 12명/일을 겹쳐 보여주는 시각화입니다. 모든 고객의 동시 방문이나 실측 이동 시간 재현이 아니며, 걷기·탐색 시간과 재생 배속은 매출을 변경하지 않습니다. JEV 미호출.</p>`;
  const daySelect=host.querySelector('[data-world-day]'),pause=host.querySelector('[data-world-pause]'),seek=host.querySelector('[data-world-seek]');
  function refreshDay(){
    daySelect.value=String(replay.day);
    host.querySelectorAll('[data-day-label]').forEach(element=>element.textContent=replay.day);
    host.querySelectorAll('[data-day-step]').forEach(button=>button.disabled=Number(button.dataset.dayStep)<0?replay.day===1:replay.day===30);
    for(const row of rows){const data=replay.getRow(row.id);host.querySelector(`[data-day-metrics="${row.id}"]`).innerHTML=`<span>${replay.day}일차 계산 결과</span><strong>${won(data.day.revenue)}</strong><span>잠재 ${count(data.day.potential)} · 입장 ${count(data.day.entered)}명</span>`;}
    const data=replay.getRow(focused.id);
    host.querySelector('[data-ledger-title]').textContent=`${focused.store.name} · ${focused.candidate.name} · ${replay.day}일차`;
    host.querySelector('[data-ledger-events]').innerHTML=data.day.events.length?data.day.events.map(event=>`<p><b>${escape(event.title)}</b> ${event.startHour}–${event.endHour}시 · 데모 가정</p>`).join(''):'<p>추가 행사·날씨 가정 없음 · 기본 상권/페르소나 조건</p>';
    host.querySelector('[data-ledger-stock]').textContent=`창고→매대 보충 ${count(data.day.replenishedUnits)}개 · 합성 납품 ${count(data.day.receivedUnits)}개 · 입장하지 않음 ${count(data.day.skipped)}명`;
    host.querySelector('[data-ledger-visits]').innerHTML=data.visits.slice(0,4).map(visit=>`<li><strong>${String(visit.hour).padStart(2,'0')}시 · ${escape(visit.name??'합성 방문자')}</strong><span>${visit.decisions.length?visit.decisions.map(decision=>`${escape(PRODUCT_MAP[decision.productId].name)} ${decision.level}단 ${decision.column}열 · ${decision.outcome==='purchased'?'구매':'매대 품절'}`).join(' / '):'구매하지 않고 퇴장'} · 결제 ${won(visit.paidAmount)}</span></li>`).join('')||'<li>이날 기록된 대표 입장이 없습니다.</li>';
  }
  function refreshProgress(){
    seek.value=String(Math.round(replay.progress*1000));host.querySelector('[data-replay-progress]').textContent=`${Math.round(replay.progress*100)}% · 재고 ${Math.floor(replay.progress*24)}시 기준`;
    pause.textContent=replay.running&&!replay.isComplete?'재생 일시정지':'기록 재생';
    for(const row of rows){const data=replay.getRow(row.id);host.querySelector(`[data-world-status="${row.id}"]`).textContent=`대표 ${data.sampleCount}명 중 화면 ${data.world.agents.length}명 · 시각화, 실제 동시 인원 아님`;}
    Object.assign(session,{day:replay.day,progress:replay.progress,running:replay.running,speed:replay.speed});
  }
  const setDay=day=>{replay.setDay(day);replay.running=true;refreshDay();refreshProgress();};
  daySelect.onchange=()=>setDay(Number(daySelect.value));
  host.querySelectorAll('[data-day-step]').forEach(button=>button.onclick=()=>setDay(replay.day+Number(button.dataset.dayStep)));
  host.querySelectorAll('[data-event-day]').forEach(button=>button.onclick=()=>setDay(Number(button.dataset.eventDay)));
  host.querySelector('[data-world-speed]').onchange=event=>{replay.setSpeed(Number(event.target.value));refreshProgress();};
  host.querySelector('[data-auto-next]').onchange=event=>session.autoNext=event.target.checked;
  pause.onclick=()=>{if(replay.isComplete){replay.seek(0);replay.running=true;}else replay.running=!replay.running;refreshProgress();};
  seek.oninput=()=>{replay.running=false;replay.seek(Number(seek.value)/1000);refreshProgress();};
  refreshDay();refreshProgress();
  let renderer;
  try{renderer=await createCardWorlds(rows.map(row=>({id:row.id,element:host.querySelector(`[data-world="${row.id}"]`),getWorld:()=>replay.worlds.get(row.id)})),{presentation:'embedded'});}
  catch{host.innerHTML='<div class="world-error" role="alert">3D 연결 실패. 계산 기록·예상치와 승인 상태는 유지됩니다. 화면을 다시 열어 재시도해주세요.</div>';return()=>{};}
  if(signal?.aborted){renderer.dispose();return()=>{};}
  let raf,last=performance.now(),disposed=false,acc=0;
  function frame(now){
    if(disposed)return;
    const dt=frameDelta(now,last);last=now;
    if(!document.hidden){replay.advance(dt);if(replay.isComplete&&replay.running&&session.autoNext&&replay.day<30){replay.setDay(replay.day+1);refreshDay();}}
    renderer.render();acc+=dt;if(acc>.2){acc=0;refreshProgress();}
    raf=requestAnimationFrame(frame);
  }
  raf=requestAnimationFrame(frame);
  return()=>{disposed=true;cancelAnimationFrame(raf);refreshProgress();renderer.dispose();};
}
