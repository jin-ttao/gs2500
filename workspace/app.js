import {STORES,BAYS,PRODUCTS,RETROSPECTIVE_CASES,getStore,getBay,getCandidate,getInventory,getPlacements} from './data.js';
import {simulateComparison} from './forecast.js';
import {createWorkflowState,approveProposal,getOwnerProposal,respondToProposal,acceptPhoto,reviewSummary,validatePhoto} from './state.js';
import {renderApp} from './views.js';

const app=document.querySelector('#app');
let state=createWorkflowState(),route='login',selectedStoreId=STORES[0].id,selectedBayId=STORES[0].bayId,selectedCandidateId='A';
let results={},error='',busy=false,approvalOpen=false,messageDraft='',generation=0,cleanup=()=>{},controller=null,elapsed=0,calculationToken=0,sessionToken=0,photoToken=0;
const catalog={getBay,getCandidate};
const key=(storeId=selectedStoreId,bayId=selectedBayId)=>`${storeId}:${bayId}`;
const nextPaint=()=>new Promise(resolve=>setTimeout(resolve,0));
const allowedRoutes=new Set(['login','home','bays','bay','board','candidate','owner','review']);

function proposalText(){const store=getStore(selectedStoreId),candidate=getCandidate(selectedStoreId,selectedBayId,selectedCandidateId);return `사장님, ${store.name} ${getBay(store.id,selectedBayId).name}의 ${candidate.name}을 제안합니다. 아래 선반 도식대로 보유 상품 위치를 검토해주세요. 예상 작업 시간은 ${candidate.minutes}분(데모 가정)입니다. 매장 사정에 맞춰 일부만 실행하거나 거절하셔도 됩니다. ${candidate.orderSkus.length?'추가 발주 후보는 검토용이며 이번 계산에 입고되지 않았습니다.':'새 발주 없이 기존 재고를 옮기는 안입니다.'}`;}
function navigate(next,{storeId=selectedStoreId,bayId,candidateId=selectedCandidateId}={}){
  if(!allowedRoutes.has(next))throw Error('지원하지 않는 화면입니다.');
  const store=getStore(storeId);getBay(storeId,bayId??store.bayId);getCandidate(storeId,bayId??store.bayId,candidateId);
  selectedStoreId=storeId;selectedBayId=bayId??store.bayId;selectedCandidateId=candidateId;
  route=state.loggedIn?next:'login';approvalOpen=false;error='';
  const hash=`#/${route}/${selectedStoreId}/${selectedBayId}/${selectedCandidateId}`;
  if(location.hash!==hash)history.pushState(null,'',hash);
  render();window.scrollTo(0,0);
}
function reviewData(){
  const summary=reviewSummary(state,BAYS);
  return {...summary,cases:RETROSPECTIVE_CASES,rows:summary.rows.map(row=>({
    ...row,store:getStore(row.storeId),bay:getBay(row.storeId,row.bayId),approval:state.approvals[row.storeId]??null,
    response:state.responses[row.storeId]?{...state.responses[row.storeId],photoName:state.photos[row.storeId]?.fileName,photoUrl:state.photos[row.storeId]?.photoUrl}:null,photo:state.photos[row.storeId]??null,
    observation:(()=>{const c=RETROSPECTIVE_CASES.find(item=>item.storeId===row.storeId);return c?{...c,beforeYoy:c.yoyBefore,afterYoy:c.yoyAfter,reason:c.explanation}:null;})(),
  }))};
}
function render(){
  generation++;const ownGeneration=generation;controller?.abort();cleanup();cleanup=()=>{};controller=new AbortController();
  const store=getStore(selectedStoreId),owner=getOwnerProposal(state,selectedStoreId);
  const bay=route==='owner'&&owner?getBay(owner.storeId,owner.bayId):getBay(store.id,selectedBayId);
  const candidate=route==='owner'&&owner?getCandidate(owner.storeId,owner.bayId,owner.candidateId):getCandidate(store.id,bay.id,selectedCandidateId);
  const photo=state.photos[store.id]??null;
  app.innerHTML=renderApp({route,state,stores:STORES,bays:BAYS,store,bay,candidate,products:PRODUCTS,results,
    approval:route==='owner'?owner:state.approvals[store.id]??null,
    response:state.responses[store.id]?{...state.responses[store.id],photoName:photo?.fileName,photoUrl:photo?.photoUrl}:null,
    photo,review:reviewData(),inventory:getInventory(store.id),placements:getPlacements(store.id,candidate.scenario),baselinePlacements:getPlacements(store.id,'hq'),
    approvalOpen,messageDraft,error,busy,loggedIn:state.loggedIn,selectedStoreId,elapsed,
    progressLabel:elapsed&&!busy?`계산 ${(elapsed/1000).toFixed(2)}초 · 동일 시드·초기 재고·잠재 수요`:undefined});
  const host=app.querySelector(route==='board'?'#world-board':route==='candidate'?'#world-detail':'[data-no-world]');
  if(host&&!approvalOpen){
    host.setAttribute('aria-label','같은 계산 기록의 3D 재생 영역');
    host.innerHTML='<p class="world-disclosure">점포와 진열안에 맞는 계산 기록을 연결하고 있습니다.</p>';
    const options={bays:route==='candidate'?[bay]:BAYS,stores:STORES,results,selection:candidate.id,selectedStoreId,detail:route==='candidate',busy,signal:controller.signal};
    import('./world-view.js').then(({mountWorlds})=>ownGeneration===generation?mountWorlds(host,options):()=>{}).then(dispose=>{if(ownGeneration===generation)cleanup=dispose;else dispose?.();}).catch(()=>{
      if(ownGeneration===generation)host.innerHTML='<div class="world-error" role="alert">3D 연결 실패. WebGL·파일 연결을 확인하고 이 화면을 다시 열어주세요. 계산 결과와 승인 상태는 유지됩니다. <a href="./demo/">원본 3D 실험실 열기</a></div>';
    });
  }
  if(approvalOpen)requestAnimationFrame(()=>app.querySelector('#approval-message')?.focus());
}

async function runAll(){
  if(busy)return;busy=true;error='';route='board';approvalOpen=false;
  history.pushState(null,'',`#/board/${selectedStoreId}/${selectedBayId}/${selectedCandidateId}`);render();
  const started=performance.now(),token=++calculationToken;
  try{
    const {loadPersonaCatalog}=await import('../demo/personas.js');
    const personaCatalog=await loadPersonaCatalog();
    if(token!==calculationToken)return;
    const next={};
    for(const bay of BAYS){await nextPaint();if(token!==calculationToken)return;next[key(bay.storeId,bay.id)]=simulateComparison({storeId:bay.storeId,bayId:bay.id,personaCatalog});}
    if(token!==calculationToken)return;
    results=next;elapsed=performance.now()-started;
  }catch(failure){if(token===calculationToken)error=`계산 실패: ${failure.message}`;}
  finally{if(token===calculationToken){busy=false;render();}}
}
function toast(text){const el=document.createElement('div');el.className='workflow-toast';el.role='status';el.textContent=text;document.body.append(el);setTimeout(()=>el.remove(),3500);}

app.addEventListener('input',event=>{if(event.target.id==='approval-message')messageDraft=event.target.value;});
app.addEventListener('submit',event=>{event.preventDefault();if(route==='login'){state={...state,loggedIn:true};navigate('home');}});
app.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action;error='';
  try{
    if(action==='login'){state={...state,loggedIn:true};navigate('home');}
    else if(action==='navigate')navigate(button.dataset.route);
    else if(action==='select-bay')navigate('bay',{storeId:button.dataset.store,bayId:button.dataset.bay,candidateId:'A'});
    else if(action==='select-candidate')navigate(button.dataset.route??'candidate',{storeId:button.dataset.store??selectedStoreId,bayId:button.dataset.bay??selectedBayId,candidateId:button.dataset.candidate});
    else if(action==='run-all')await runAll();
    else if(action==='open-approval'){
      if(!results[key()]?.completed)throw Error('30일 비교 계산을 먼저 완료해주세요.');
      messageDraft=proposalText();approvalOpen=true;render();
    }
    else if(action==='close-approval'){approvalOpen=false;render();}
    else if(action==='approve'){
      photoToken++;
      const oldPhoto=state.photos[selectedStoreId]?.photoUrl;
      state=approveProposal(state,{storeId:selectedStoreId,bayId:selectedBayId,candidateId:selectedCandidateId,message:messageDraft,comparison:results[key()]},catalog);
      if(oldPhoto)URL.revokeObjectURL(oldPhoto);
      approvalOpen=false;render();toast('승인됐습니다. 같은 브라우저의 점주 화면에서 확인할 수 있어요.');
    }
    else if(action==='role-owner'){state={...state,role:'owner'};navigate('owner');}
    else if(action==='role-manager'){state={...state,role:'manager'};navigate(state.responses[selectedStoreId]?'review':'home');}
    else if(action==='respond'){
      photoToken++;
      const note=app.querySelector('#owner-note')?.value??'';
      const oldPhoto=state.photos[selectedStoreId]?.photoUrl;
      state=respondToProposal(state,{storeId:selectedStoreId,status:button.dataset.status,note});render();toast('회신이 이 브라우저의 데모 상태에 반영됐습니다.');
      if(oldPhoto&&!state.photos[selectedStoreId])URL.revokeObjectURL(oldPhoto);
    }
    else if(action==='upload-photo')app.querySelector('#photo-file')?.click();
    else if(action==='reset-demo'){
      calculationToken++;sessionToken++;photoToken++;busy=false;
      for(const photo of Object.values(state.photos))URL.revokeObjectURL(photo.photoUrl);
      state=createWorkflowState();results={};messageDraft='';elapsed=0;
      // A failed optional 3D import must not prevent resetting the core workflow.
      import('./world-view.js').then(m=>m.resetWorldViews()).catch(()=>{});navigate('login');
    }
  }catch(failure){error=failure.message;render();}
});
app.addEventListener('change',async event=>{
  if(event.target.id!=='photo-file')return;
  const file=event.target.files?.[0];if(!file)return;
  const storeId=selectedStoreId,approval=state.approvals[storeId],session=sessionToken,selection=++photoToken;let url;
  try{
    validatePhoto(file);
    const image=await createImageBitmap(file);if(!image.width||!image.height)throw Error('사진을 읽지 못했습니다.');image.close();
    if(selection!==photoToken||session!==sessionToken||state.approvals[storeId]!==approval)return;
    url=URL.createObjectURL(file);const previous=state.photos[storeId]?.photoUrl;
    state=acceptPhoto(state,{storeId,fileName:file.name,mimeType:file.type,size:file.size,photoUrl:url});
    if(previous)URL.revokeObjectURL(previous);error='';render();toast('사진 접수됨 · 자동 판독하거나 실행을 검증하지 않습니다.');
  }catch(failure){if(url)URL.revokeObjectURL(url);if(selection!==photoToken||session!==sessionToken)return;error=`사진 접수 실패: ${failure.message}`;render();}
});
window.addEventListener('popstate',()=>{
  try{const parts=location.hash.slice(2).split('/');navigate(parts[0]||'home',{storeId:parts[1]||STORES[0].id,bayId:parts[2],candidateId:parts[3]||'A'});}
  catch{error='잘못된 화면 주소입니다. 목록에서 다시 선택해주세요.';route=state.loggedIn?'bays':'login';render();}
});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&approvalOpen){approvalOpen=false;render();}});
render();
