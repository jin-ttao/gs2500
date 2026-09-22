import {STORES,BAYS,PRODUCTS,getStore,getBay,getCandidate,getInventory,getPlacements} from './data.js';
import {calculateComparisons} from './forecast-job.js';
import {createWorkflowState,approveProposal,getOwnerProposal,respondToProposal,acceptPhoto,reviewSummary,validatePhoto} from './state.js';
import {renderApp} from './views.js';
import {createOperationsState,recordOperation,buildOperationsView} from './operations.js';
import {buildProposalHistory} from './proposal-history.js';

const app=document.querySelector('#app');
let state=createWorkflowState(),route='login',selectedStoreId=STORES[0].id,selectedBayId=STORES[0].bayId,selectedCandidateId='A';
let results={},error='',busy=false,approvalOpen=false,messageDraft='',generation=0,cleanup=()=>{},controller=null,elapsed=0,calculationToken=0,sessionToken=0,photoToken=0;
let operationsState=createOperationsState(),opsRange=14,opsFilter='all',observationOpen=false,observationDraft={},observationPhoto=null,observationToken=0,searchOpen=false;
let sidebarCollapsed=false,mobileSidebarOpen=false;
let historyPeriod='all',historyStatus='all';
let calculationController=null,calculationProgress={completed:0,total:BAYS.length};
// Presentation memory is separate from simulation/economic state. Re-rendering
// a filter, opening a dialog, or returning from a detail must not lose place.
const pageMemory=new Map(),ownerNoteDrafts=new Map();
let renderedPageKey=null,renderedRoute=null,renderedOverlay=null,overlayReturnFocus=null,pendingRestore=null;
let overlayRevision=0,renderedOverlayRevision=-1;
const catalog={getBay,getCandidate};
const key=(storeId=selectedStoreId,bayId=selectedBayId)=>`${storeId}:${bayId}`;
const allowedRoutes=new Set(['login','home','portfolio','operations','recommendations','evidence','bays','bay','board','candidate','owner','review']);
if('scrollRestoration' in history)history.scrollRestoration='manual';

function pageKey(){
  // A list/board is one surface, regardless of which card was last inspected.
  // Store tabs likewise do not become a new page when a candidate changes.
  if(['login','board','portfolio','bays','review'].includes(route))return route;
  if(route==='candidate')return `${route}:${selectedStoreId}:${selectedBayId}:${selectedCandidateId}`;
  if(route==='bay')return `${route}:${selectedStoreId}:${selectedBayId}`;
  return `${route}:${selectedStoreId}`;
}
const activeOverlay=()=>approvalOpen?'approval':observationOpen?'observation':searchOpen?'search':null;
function focusedControl(){
  const node=document.activeElement;
  if(!node||!app.contains?.(node))return null;
  return {id:node.id??'',name:node.name??'',formId:node.form?.id??'',tag:node.tagName,
    action:node.dataset?.action,dataset:{...node.dataset},text:node.textContent?.trim(),
    selectionStart:node.selectionStart,selectionEnd:node.selectionEnd};
}
function findControl(saved){
  if(!saved)return null;
  const nodes=[...(app.querySelectorAll?.('button,input,select,textarea,summary,[tabindex]')??[])];
  return nodes.find(node=>saved.id?node.id===saved.id:saved.name?node.name===saved.name&&node.form?.id===saved.formId:
    saved.action?node.dataset?.action===saved.action&&Object.entries(saved.dataset).every(([key,value])=>node.dataset?.[key]===value)&&node.textContent?.trim()===saved.text:
      node.tagName===saved.tag&&node.textContent?.trim()===saved.text)??null;
}
function detailKey(node,index){
  const summary=node.querySelector?.('summary')?.textContent?.replace(/\s+/g,' ').trim()??'';
  const heading=node.closest?.('article')?.querySelector?.('h2,h3')?.textContent?.trim()??'';
  return node.id||node.dataset?.uiKey||node.dataset?.viewKey||`${node.className??''}|${heading}|${summary||index}`;
}
function rememberPage(){
  const host=app.querySelector('.ob-page-scroll');
  if(renderedRoute==='owner'){
    const field=app.querySelector('#owner-note');
    if(field)ownerNoteDrafts.set(renderedPageKey?.split(':')[1],field.value);
  }
  const details=[...(host?.querySelectorAll?.('details')??[])].map((node,index)=>[detailKey(node,index),Boolean(node.open)]);
  const world=app.querySelector(renderedRoute==='board'?'#world-board':renderedRoute==='candidate'?'#world-detail':'[data-no-world]');
  const remembered={scroll:pendingRestore?.key===renderedPageKey&&!pendingRestore.interrupted?pendingRestore.scroll:host?.scrollTop??0,
    details,focus:focusedControl(),worldHeight:world?.getBoundingClientRect?.().height??0};
  if(renderedPageKey)pageMemory.set(renderedPageKey,remembered);
  return remembered;
}
function rememberDialog(){
  const dialog=app.querySelector('[role="dialog"]');
  return dialog?{scroll:dialog.scrollTop??0,details:[...(dialog.querySelectorAll?.('details')??[])].map((node,index)=>[detailKey(node,index),Boolean(node.open)])}:null;
}
function restoreDetails(saved,host=app.querySelector('.ob-page-scroll')){
  const entries=new Map(saved?.details??[]);
  for(const [index,node] of [...(host?.querySelectorAll?.('details')??[])].entries()){
    const key=detailKey(node,index);if(entries.has(key))node.open=entries.get(key);
  }
}
function restoreFocus(saved,fallback){
  const node=findControl(saved)??(fallback?app.querySelector(fallback):null);
  node?.focus?.({preventScroll:true});
  if(node&&Number.isInteger(saved?.selectionStart)&&typeof node.setSelectionRange==='function'){
    try{node.setSelectionRange(saved.selectionStart,saved.selectionEnd??saved.selectionStart);}catch{/* Non-text input. */}
  }
}
function instantScroll(host,top){
  if(!host)return;
  // The previous CSS smooth rule must never animate a state restoration.
  const previous=host.style?.scrollBehavior;
  if(host.style){
    host.style.scrollBehavior='auto';
    // This scroll host has explicit application restoration. Browser anchoring
    // must not apply a second adjustment after its children are replaced.
    host.style.overflowAnchor='none';
  }
  if(typeof host.scrollTo==='function')host.scrollTo({top,left:0,behavior:'instant'});
  else host.scrollTop=top;
  if(host.style)host.style.scrollBehavior=previous??'';
}
function restoreScroll(token){
  if(token!==pendingRestore||token.generation!==generation||token.interrupted)return;
  instantScroll(app.querySelector('.ob-page-scroll'),token.scroll);
}
function finishRestore(token){
  requestAnimationFrame(()=>{
    if(token!==pendingRestore||token.generation!==generation)return;
    restoreScroll(token);pendingRestore=null;
  });
}
function interruptRestore(){if(pendingRestore)pendingRestore.interrupted=true;}
// A slow 3D import must not drag the user back after they have begun scrolling.
app.addEventListener('wheel',interruptRestore,{passive:true,capture:true});
app.addEventListener('touchmove',interruptRestore,{passive:true,capture:true});
app.addEventListener('pointerdown',interruptRestore,{passive:true,capture:true});

function closeObservation(){observationToken++;if(observationPhoto)URL.revokeObjectURL(observationPhoto.url);observationPhoto=null;observationOpen=false;observationDraft={};}
function captureObservation(){const form=app.querySelector('#observation-form');if(form)observationDraft={...observationDraft,...Object.fromEntries(new FormData(form))};}
// Sidebar controls never re-render the page or restart an active 3D replay.
function syncSidebar(){
  const shell=app.querySelector('.app-shell');
  shell?.setAttribute('data-sidebar-collapsed',String(sidebarCollapsed));
  shell?.setAttribute('data-mobile-sidebar-open',String(mobileSidebarOpen));
  for(const selector of ['.main','.ob-mobile-nav']){const node=app.querySelector(selector);if(node)node.inert=mobileSidebarOpen;}
  for(const node of app.querySelectorAll?.('[data-action="toggle-sidebar"]')??[])node.setAttribute('aria-expanded',String(!sidebarCollapsed));
  app.querySelector('[data-action="open-sidebar"]')?.setAttribute('aria-expanded',String(mobileSidebarOpen));
  // Wait for the visibility rule to apply before focusing the opened sheet.
  if(mobileSidebarOpen)requestAnimationFrame(()=>{if(mobileSidebarOpen)app.querySelector('.sidebar .brand-button')?.focus();});
}

function proposalText(){const store=getStore(selectedStoreId),candidate=getCandidate(selectedStoreId,selectedBayId,selectedCandidateId);return `사장님, ${store.name} ${getBay(store.id,selectedBayId).name}의 ${candidate.name}을 제안합니다. 아래 선반 도식대로 보유 상품 위치를 검토해주세요. 예상 작업 시간은 ${candidate.minutes}분(데모 가정)입니다. 매장 사정에 맞춰 일부만 실행하거나 거절하셔도 됩니다. ${candidate.orderSkus.length?'추가 발주 후보는 검토용이며 이번 계산에 입고되지 않았습니다.':'새 발주 없이 기존 재고를 옮기는 안입니다.'}`;}
function navigate(next,{storeId=selectedStoreId,bayId,candidateId=selectedCandidateId,historyMode='push',fresh=false}={}){
  if(!allowedRoutes.has(next))throw Error('지원하지 않는 화면입니다.');
  // Browser history is navigation, not permission to leave the owner view.
  if(state.loggedIn&&state.role==='owner'&&!['owner','login'].includes(next))next='owner';
  const store=getStore(storeId);getBay(storeId,bayId??store.bayId);getCandidate(storeId,bayId??store.bayId,candidateId);
  const previous=rememberPage(),sameSurface=route===next&&selectedStoreId===storeId&&selectedBayId===(bayId??store.bayId);
  selectedStoreId=storeId;selectedBayId=bayId??store.bayId;selectedCandidateId=candidateId;
  route=state.loggedIn?next:'login';approvalOpen=false;searchOpen=false;mobileSidebarOpen=false;closeObservation();error='';
  const hash=`#/${route}/${selectedStoreId}/${selectedBayId}/${selectedCandidateId}`;
  if(location.hash!==hash){
    if(historyMode==='pop')history.replaceState?.(null,'',hash);
    else history.pushState(null,'',hash);
  }
  const saved=pageMemory.get(pageKey());
  const viewState=fresh?{scroll:0,details:[],focus:null}:sameSurface&&historyMode!=='pop'
    ?{...(saved??previous),scroll:previous.scroll,focus:previous.focus}:saved??{scroll:0,details:[],focus:null};
  render({viewState,navigation:true});
}
function reviewData(){
  const summary=reviewSummary(state,BAYS);
  return {...summary,rows:summary.rows.map(row=>({
    ...row,store:getStore(row.storeId),bay:getBay(row.storeId,row.bayId),approval:state.approvals[row.storeId]??null,
    response:state.responses[row.storeId]?{...state.responses[row.storeId],photoName:state.photos[row.storeId]?.fileName,photoUrl:state.photos[row.storeId]?.photoUrl}:null,photo:state.photos[row.storeId]??null,
  }))};
}
function render({resetScroll=false,viewState=null,navigation=false}={}){
  const previous=rememberPage(),nextKey=pageKey(),nextOverlay=activeOverlay(),samePage=renderedPageKey===nextKey;
  const saved=viewState??(resetScroll?{scroll:0,details:[]}:samePage?previous:pageMemory.get(nextKey)??{scroll:0,details:[]});
  const previousOverlay=renderedOverlay;
  const dialogState=nextOverlay&&nextOverlay===previousOverlay&&samePage&&overlayRevision===renderedOverlayRevision?rememberDialog():null;
  if(nextOverlay&&!previousOverlay)overlayReturnFocus=previous.focus;
  const focus=nextOverlay===previousOverlay&&!navigation?previous.focus:!nextOverlay&&previousOverlay?overlayReturnFocus:null;
  generation++;const ownGeneration=generation;controller?.abort();cleanup();cleanup=()=>{};controller=new AbortController();
  const store=getStore(selectedStoreId),owner=getOwnerProposal(state,selectedStoreId);
  const bay=route==='owner'&&owner?getBay(owner.storeId,owner.bayId):getBay(store.id,selectedBayId);
  const candidate=route==='owner'&&owner?getCandidate(owner.storeId,owner.bayId,owner.candidateId):getCandidate(store.id,bay.id,selectedCandidateId);
  const photo=state.photos[store.id]??null;
  app.innerHTML=renderApp({route,state,stores:STORES,bays:BAYS,store,bay,candidate,products:PRODUCTS,results,
    approval:route==='owner'?owner:state.approvals[store.id]??null,
    response:state.responses[store.id]?{...state.responses[store.id],note:ownerNoteDrafts.get(store.id)??state.responses[store.id].note,photoName:photo?.fileName,photoUrl:photo?.photoUrl}:ownerNoteDrafts.has(store.id)?{note:ownerNoteDrafts.get(store.id)}:null,
    photo,review:reviewData(),inventory:getInventory(store.id),placements:getPlacements(store.id,candidate.scenario),baselinePlacements:getPlacements(store.id,'hq'),
    proposalHistory:buildProposalHistory({period:historyPeriod,status:historyStatus}),
    approvalOpen,messageDraft,error,busy,loggedIn:state.loggedIn,selectedStoreId,elapsed,calculationProgress,
    operations:buildOperationsView(operationsState,store.id,{range:opsRange,filter:route==='operations'?opsFilter:'all'}),
    opsRange,opsFilter,observationOpen,observationDraft,observationPhoto,searchOpen,sidebarCollapsed,mobileSidebarOpen,
    observationRecords:operationsState.records.filter(row=>row.storeId===store.id).sort((a,b)=>b.date.localeCompare(a.date)),
    progressLabel:elapsed&&!busy?`계산 ${(elapsed/1000).toFixed(2)}초 · 동일 시드·초기 재고·잠재 수요`:undefined});
  renderedPageKey=nextKey;renderedRoute=route;renderedOverlay=nextOverlay;renderedOverlayRevision=overlayRevision;
  restoreDetails(saved);
  const dialog=app.querySelector('[role="dialog"]');
  if(dialogState){restoreDetails(dialogState,dialog);instantScroll(dialog,dialogState.scroll);}
  const token={key:nextKey,generation:ownGeneration,scroll:Math.max(0,saved.scroll??0),interrupted:false};pendingRestore=token;
  const host=app.querySelector(route==='board'?'#world-board':route==='candidate'?'#world-detail':'[data-no-world]');
  if(host&&saved.worldHeight&&host.style)host.style.minHeight=`${saved.worldHeight}px`;
  if(host&&!approvalOpen){
    host.setAttribute('aria-label','같은 계산 기록의 3D 재생 영역');
    host.innerHTML='<p class="world-disclosure">점포와 진열안에 맞는 계산 기록을 연결하고 있습니다.</p>';
    const options={bays:route==='candidate'?[bay]:BAYS,stores:STORES,results,selection:candidate.id,selectedStoreId,detail:route==='candidate',busy,signal:controller.signal};
    import('./world-view.js').then(({mountWorlds})=>ownGeneration===generation?mountWorlds(host,options):()=>{}).then(dispose=>{if(ownGeneration===generation)cleanup=dispose;else dispose?.();}).catch(()=>{
      if(ownGeneration===generation)host.innerHTML='<div class="world-error" role="alert">3D 연결 실패. WebGL·파일 연결을 확인하고 이 화면을 다시 열어주세요. 계산 결과와 승인 상태는 유지됩니다. <a href="./demo/">원본 3D 실험실 열기</a></div>';
    }).finally(()=>{if(ownGeneration===generation){if(host.style)host.style.minHeight='';finishRestore(token);}});
  }
  restoreScroll(token);
  if(!host||approvalOpen)finishRestore(token);
  requestAnimationFrame(()=>{
    if(ownGeneration!==generation||token.interrupted)return;
    const fallback=nextOverlay==='approval'?'#approval-message':nextOverlay==='observation'?'#observation-form input[name="date"]':nextOverlay==='search'?'#workspace-search':navigation?'.ob-page-scroll':null;
    restoreFocus(focus,fallback);
    // Upload/error rerenders retain the modal's own scroll, not just the page
    // behind it. Restore after details and focus have affected layout.
    if(dialogState)instantScroll(dialog,dialogState.scroll);
    if(!nextOverlay)overlayReturnFocus=null;
  });
}

async function runAll(){
  if(busy||state.role==='owner')return;busy=true;error='';
  calculationController?.abort();calculationController=new AbortController();
  const jobController=calculationController;
  calculationProgress={completed:0,total:BAYS.length};
  navigate('board',{fresh:true});
  const started=performance.now(),token=++calculationToken;
  try{
    const {loadPersonaCatalog}=await import('../demo/personas.js');
    const personaCatalog=await loadPersonaCatalog();
    if(token!==calculationToken)return;
    const next=await calculateComparisons({bays:BAYS,personaCatalog,signal:jobController.signal,onProgress:progress=>{
      if(token!==calculationToken)return;
      calculationProgress={completed:progress.completed,total:progress.total};
      for(const node of app.querySelectorAll?.('[data-calculation-progress]')??[])node.textContent=`점포 ${progress.completed}/${progress.total} 계산 중`;
    }});
    if(token!==calculationToken)return;
    // A fresh calculation is the explicit replay reset boundary; navigation is not.
    const worlds=await import('./world-view.js').catch(()=>null);
    if(token!==calculationToken)return;
    worlds?.resetWorldViews?.();
    results=next;elapsed=performance.now()-started;
  }catch(failure){if(token===calculationToken&&failure.name!=='AbortError')error=`계산 실패: ${failure.message}`;}
  finally{if(token===calculationToken){busy=false;render();}}
}
function toast(text){const el=document.createElement('div');el.className='workflow-toast';el.role='status';el.textContent=text;document.body.append(el);setTimeout(()=>el.remove(),3500);}

app.addEventListener('input',event=>{
  if(event.target.id==='approval-message')messageDraft=event.target.value;
  if(event.target.id==='owner-note')ownerNoteDrafts.set(selectedStoreId,event.target.value);
  if(event.target.closest?.('#observation-form'))captureObservation();
  if(event.target.id==='workspace-search'){
    const query=event.target.value.toLocaleLowerCase().trim();let matches=0;
    for(const row of app.querySelectorAll('[data-search-item]')){row.hidden=!row.dataset.searchItem.toLocaleLowerCase().includes(query);if(!row.hidden)matches++;}
    const empty=app.querySelector('#search-empty');if(empty)empty.hidden=matches>0;
  }
});
app.addEventListener('submit',event=>{
  event.preventDefault();
  if(event.target.id==='observation-form'){
    captureObservation();
    try{
      const input={storeId:selectedStoreId,date:observationDraft.date,issueType:observationDraft.issueType,note:observationDraft.note};
      if(observationDraft.productId)input.productId=observationDraft.productId;
      for(const name of ['level','column','stockoutMinutes','revenueBefore','revenueAfter','comparableDays'])if(observationDraft[name]!==''&&observationDraft[name]!=null)input[name]=Number(observationDraft[name]);
      if(observationDraft.confounders?.trim())input.confounders=observationDraft.confounders.split(',').map(x=>x.trim()).filter(Boolean);
      if(observationPhoto)input.photo={name:observationPhoto.name,type:observationPhoto.type,size:observationPhoto.size,reference:observationPhoto.url};
      operationsState=recordOperation(operationsState,input);observationPhoto=null;closeObservation();error='';render();toast('관찰을 저장하고 다음 추천의 근거를 갱신했어요. 자동 판독·인과효과 검증은 아닙니다.');
    }catch(failure){error=failure.message;render();}
    return;
  }
  if(route==='login'){state={...state,loggedIn:true};navigate('home');}
});
app.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action;error='';
  try{
    if(action==='login'){state={...state,loggedIn:true};navigate('home');}
    else if(action==='toggle-sidebar'){
      const wasMobile=mobileSidebarOpen;
      if(wasMobile)mobileSidebarOpen=false;else sidebarCollapsed=!sidebarCollapsed;
      syncSidebar();requestAnimationFrame(()=>app.querySelector(wasMobile?'[data-action="open-sidebar"]':sidebarCollapsed?'.ob-sidebar-reopen':'.ob-collapse-button')?.focus());
    }
    else if(action==='open-sidebar'){mobileSidebarOpen=true;syncSidebar();}
    else if(action==='close-sidebar'){mobileSidebarOpen=false;syncSidebar();app.querySelector('[data-action="open-sidebar"]')?.focus();}
    else if(action==='open-search'&&state.role!=='owner'){overlayRevision++;searchOpen=true;mobileSidebarOpen=false;closeObservation();approvalOpen=false;render();}
    else if(action==='close-search'){searchOpen=false;render();}
    else if(action==='ops-store')navigate(['home','operations','recommendations','evidence'].includes(route)?route:'home',{storeId:button.dataset.store,candidateId:'A'});
    else if(action==='ops-range'){const value=Number(button.dataset.value);if(![7,14,28].includes(value))throw Error('지원하지 않는 조회 기간입니다.');opsRange=value;render();}
    else if(action==='ops-filter'){opsFilter=button.dataset.value;render();}
    else if(action==='history-period'){
      const value=button.dataset.value;if(!['all','14','28'].includes(value))throw Error('지원하지 않는 경과 기간입니다.');
      historyPeriod=value;render();
    }
    else if(action==='history-status'){
      const value=button.dataset.value;if(!['all','attention'].includes(value))throw Error('지원하지 않는 추적 상태입니다.');
      historyStatus=value;render();
    }
    else if(action==='open-observation'){
      overlayRevision++;
      closeObservation();observationOpen=true;searchOpen=false;mobileSidebarOpen=false;
      observationDraft={date:operationsState.asOf,issueType:button.dataset.type??'stockout',productId:button.dataset.product??'',
        suggestedLevel:button.dataset.suggestedLevel??'',suggestedColumn:button.dataset.suggestedColumn??'',suggestedTitle:button.dataset.suggestedTitle??''};render();
    }
    else if(action==='close-observation'){closeObservation();render();}
    else if(action==='navigate')navigate(button.dataset.route);
    else if(action==='select-bay')navigate('bay',{storeId:button.dataset.store,bayId:button.dataset.bay,candidateId:'A'});
    else if(action==='select-candidate')navigate(button.dataset.route??'candidate',{storeId:button.dataset.store??selectedStoreId,bayId:button.dataset.bay??selectedBayId,candidateId:button.dataset.candidate});
    else if(action==='run-all')await runAll();
    else if(action==='open-approval'){
      if(!results[key()]?.completed)throw Error('30일 비교 계산을 먼저 완료해주세요.');
      overlayRevision++;messageDraft=proposalText();approvalOpen=true;render();
    }
    else if(action==='close-approval'){approvalOpen=false;render();}
    else if(action==='approve'){
      photoToken++;
      const oldPhoto=state.photos[selectedStoreId]?.photoUrl;
      state=approveProposal(state,{storeId:selectedStoreId,bayId:selectedBayId,candidateId:selectedCandidateId,message:messageDraft,comparison:results[key()]},catalog);
      ownerNoteDrafts.delete(selectedStoreId);
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
      calculationToken++;calculationController?.abort();calculationController=null;calculationProgress={completed:0,total:BAYS.length};sessionToken++;photoToken++;busy=false;
      for(const photo of Object.values(state.photos))URL.revokeObjectURL(photo.photoUrl);
      for(const row of operationsState.records)if(row.photo?.reference?.startsWith('blob:'))URL.revokeObjectURL(row.photo.reference);
      closeObservation();operationsState=createOperationsState();opsRange=14;opsFilter='all';searchOpen=false;sidebarCollapsed=false;mobileSidebarOpen=false;
      historyPeriod='all';historyStatus='all';
      state=createWorkflowState();results={};messageDraft='';elapsed=0;
      pageMemory.clear();ownerNoteDrafts.clear();renderedPageKey=null;renderedRoute=null;renderedOverlay=null;overlayReturnFocus=null;pendingRestore=null;overlayRevision=0;renderedOverlayRevision=-1;
      // A failed optional 3D import must not prevent resetting the core workflow.
      import('./world-view.js').then(m=>m.resetWorldViews()).catch(()=>{});navigate('login');
    }
  }catch(failure){error=failure.message;render();}
});
app.addEventListener('change',async event=>{
  if(event.target.id==='operations-store'){navigate(['home','operations','recommendations','evidence'].includes(route)?route:'home',{storeId:event.target.value,candidateId:'A'});return;}
  if(event.target.closest?.('#observation-form'))captureObservation();
  if(event.target.id==='observation-file'){
    const file=event.target.files?.[0];if(!file)return;
    const token=++observationToken;let url;
    try{
      validatePhoto(file);url=URL.createObjectURL(file);const preview=new Image();preview.src=url;await preview.decode();
      if(token!==observationToken||!observationOpen){URL.revokeObjectURL(url);return;}
      if(observationPhoto)URL.revokeObjectURL(observationPhoto.url);
      observationPhoto={name:file.name,type:file.type,size:file.size,url};error='';render();
    }catch(failure){if(url)URL.revokeObjectURL(url);if(token!==observationToken)return;error=`사진 접수 실패: ${failure.message}`;render();}
    return;
  }
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
  try{const parts=location.hash.slice(2).split('/');navigate(parts[0]||'home',{storeId:parts[1]||STORES[0].id,bayId:parts[2],candidateId:parts[3]||'A',historyMode:'pop'});}
  catch{const fallback=state.loggedIn?(state.role==='owner'?'owner':'bays'):'login';navigate(fallback,{historyMode:'pop'});error='잘못된 화면 주소입니다. 목록에서 다시 선택해주세요.';render();}
});
window.addEventListener('resize',()=>{if(mobileSidebarOpen&&window.innerWidth>=768){mobileSidebarOpen=false;syncSidebar();}});
window.addEventListener('keydown',event=>{
  if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))interruptRestore();
  if(event.key==='Escape'&&mobileSidebarOpen){mobileSidebarOpen=false;syncSidebar();app.querySelector('[data-action="open-sidebar"]')?.focus();}
  if(event.key==='Tab'&&mobileSidebarOpen){
    const sidebar=app.querySelector('.sidebar'),nodes=sidebar?[...sidebar.querySelectorAll('button:not(:disabled)')].filter(node=>node.getClientRects().length):[];
    if(nodes.length&&event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}
    else if(nodes.length&&!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}
  }
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&state.loggedIn&&state.role!=='owner'){event.preventDefault();if(!searchOpen)overlayRevision++;searchOpen=!searchOpen;mobileSidebarOpen=false;closeObservation();approvalOpen=false;render();}
  if(event.key==='Escape'&&(approvalOpen||observationOpen||searchOpen)){approvalOpen=false;searchOpen=false;closeObservation();render();}
  if(event.key==='Tab'&&(approvalOpen||observationOpen||searchOpen)){
    const dialog=app.querySelector('[role="dialog"]'),nodes=dialog?[...dialog.querySelectorAll('button:not(:disabled),input:not([type=file]),select,textarea,summary,[tabindex="0"]')].filter(node=>node.getClientRects().length):[];
    if(nodes.length&&event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus();}
    else if(nodes.length&&!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus();}
  }
});
render();
