/** Preserve caller-owned store objects and ordering; only page arrays are new. */
export function paginateStores(stores,pageSize=4){
  if(!Array.isArray(stores))throw new TypeError('stores must be an array');
  if(!Number.isSafeInteger(pageSize)||pageSize<1)throw new RangeError('pageSize must be a positive safe integer');
  const pages=[];
  for(let start=0;start<stores.length;start+=pageSize)pages.push(stores.slice(start,start+pageSize));
  return pages;
}

/** Pointer displacement: leftward motion advances, vertical gestures never do. */
export function swipeDirection(deltaX,deltaY,{threshold=40,axisRatio=1.2}={}){
  if(![deltaX,deltaY,threshold,axisRatio].every(Number.isFinite))throw new TypeError('swipe values must be finite');
  if(threshold<=0||axisRatio<1)throw new RangeError('threshold must be positive and axisRatio at least one');
  return Math.abs(deltaX)>=threshold&&Math.abs(deltaX)>Math.abs(deltaY)*axisRatio?(deltaX<0?1:-1):0;
}

export function nearestPageIndex(scrollLeft,offsets){
  if(!Number.isFinite(scrollLeft)||!Array.isArray(offsets)||offsets.some((value,index)=>!Number.isFinite(value)||(index>0&&value<offsets[index-1])))throw new TypeError('page offsets must be a finite ordered array');
  let nearest=-1,distance=Infinity;
  offsets.forEach((offset,index)=>{const next=Math.abs(offset-scrollLeft);if(next<distance){nearest=index;distance=next;}});
  return nearest;
}

/**
 * Observe existing scroll-snap sections; never replace DOM, transform the grid,
 * or own simulation state. Native touch scrolling and vertical wheel scrolling
 * remain entirely browser-controlled. Only mouse drags receive manual scrolling.
 */
export function createStorePager({container,pages,onChange=()=>{}}={}){
  if(!container||typeof container.addEventListener!=='function'||typeof container.scrollTo!=='function'||typeof container.getBoundingClientRect!=='function')throw new TypeError('container must be a scrollable element');
  if(!Array.isArray(pages)||new Set(pages).size!==pages.length||pages.some(page=>!page||page.parentElement!==container||typeof page.getBoundingClientRect!=='function'))throw new TypeError('pages must be distinct existing direct children of container');
  if(typeof onChange!=='function')throw new TypeError('onChange must be a function');
  pages=[...pages];
  const view=container.ownerDocument?.defaultView??globalThis;
  let index=pages.length?0:-1,destroyed=false,gesture=null,settleTimer=null,targetIndex=null,suppressUntil=0,savedStyle=null;
  const listeners=[];
  const listen=(name,listener,options)=>{container.addEventListener(name,listener,options);listeners.push([name,listener,options]);};
  const offsets=()=>{
    const left=container.getBoundingClientRect().left+(container.clientLeft||0);
    const padding=parseFloat(view.getComputedStyle?.(container)?.scrollPaddingLeft)||0;
    return pages.map(page=>Math.max(0,page.getBoundingClientRect().left-left+container.scrollLeft-padding));
  };
  const nearest=()=>nearestPageIndex(container.scrollLeft,offsets());
  const changed=next=>{if(next!==index){index=next;onChange(index);}};
  const reducedMotion=()=>!!view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function scrollToPage(next,instant=false){
    if(destroyed)return index;
    if(!Number.isSafeInteger(next))throw new TypeError('page index must be a safe integer');
    if(!pages.length)return -1;
    next=Math.max(0,Math.min(pages.length-1,next));
    targetIndex=next;changed(next);
    container.scrollTo({left:offsets()[next],behavior:instant||reducedMotion()?'auto':'smooth'});
    scheduleSettle();
    return index;
  }
  function settle(){
    clearTimeout(settleTimer);settleTimer=null;
    if(destroyed||gesture?.dragging)return;
    targetIndex=null;changed(nearest());
  }
  function scheduleSettle(){clearTimeout(settleTimer);settleTimer=setTimeout(settle,180);}
  function restoreStyle(){
    if(!savedStyle)return;
    Object.assign(container.style,savedStyle);savedStyle=null;
  }
  function releasePointer(pointerId){
    if(container.hasPointerCapture?.(pointerId))container.releasePointerCapture(pointerId);
  }
  function beginDrag(event){
    gesture.dragging=true;
    savedStyle={scrollSnapType:container.style.scrollSnapType,scrollBehavior:container.style.scrollBehavior,userSelect:container.style.userSelect};
    Object.assign(container.style,{scrollSnapType:'none',scrollBehavior:'auto',userSelect:'none'});
    container.setPointerCapture?.(event.pointerId);
  }
  function pointerDown(event){
    if(destroyed||event.isPrimary===false||(event.button!==undefined&&event.button!==0))return;
    if(gesture?.dragging){restoreStyle();releasePointer(gesture.id);}
    clearTimeout(settleTimer);targetIndex=null;suppressUntil=0;
    // A tap in a running smooth scroll should operate on the page actually shown.
    changed(nearest());
    gesture={id:event.pointerId,type:event.pointerType||'mouse',x:event.clientX,y:event.clientY,dx:0,dy:0,startScroll:container.scrollLeft,startIndex:index,axis:null,dragging:false};
  }
  function pointerMove(event){
    if(!gesture||event.pointerId!==gesture.id)return;
    gesture.dx=event.clientX-gesture.x;gesture.dy=event.clientY-gesture.y;
    const x=Math.abs(gesture.dx),y=Math.abs(gesture.dy);
    if(!gesture.axis&&Math.max(x,y)>=8){
      if(x>y*1.2)gesture.axis='horizontal';
      else if(y>x*1.2)gesture.axis='vertical';
    }
    if(gesture.axis!=='horizontal'||gesture.type!=='mouse')return;
    if(!gesture.dragging)beginDrag(event);
    event.preventDefault();
    container.scrollLeft=gesture.startScroll-gesture.dx;
  }
  function pointerEnd(event,cancelled=false){
    if(!gesture||event.pointerId!==gesture.id)return;
    const finished=gesture;
    // pointercancel coordinates need not describe the last actual touch position.
    if(!cancelled&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)){
      finished.dx=event.clientX-finished.x;finished.dy=event.clientY-finished.y;
    }
    gesture=null;
    const horizontal=finished.axis==='horizontal'&&Math.abs(finished.dx)>=8;
    if(horizontal)suppressUntil=Date.now()+500;
    restoreStyle();releasePointer(finished.id);
    if(finished.dragging){
      const direction=cancelled?0:swipeDirection(finished.dx,finished.dy);
      scrollToPage(finished.startIndex+direction);
    }else scheduleSettle(); // Touch snap and momentum belong to the browser.
  }
  function click(event){
    if(Date.now()<suppressUntil){suppressUntil=0;event.preventDefault();event.stopImmediatePropagation();}
  }
  function scroll(){
    if(destroyed)return;
    if(targetIndex===null&&!gesture?.dragging)changed(nearest());
    scheduleSettle();
  }
  function keyDown(event){
    if(event.target!==container||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();scrollToPage(index+(event.key==='ArrowRight'?1:-1));
    }
  }
  const resize=()=>{if(!destroyed&&!gesture&&index>=0)scrollToPage(index,true);};
  listen('pointerdown',pointerDown,{passive:true});
  listen('pointermove',pointerMove,{passive:false});
  listen('pointerup',pointerEnd);
  listen('pointercancel',event=>pointerEnd(event,true));
  listen('click',click,true);
  listen('scroll',scroll,{passive:true});
  listen('scrollend',settle,{passive:true});
  listen('keydown',keyDown);
  view.addEventListener?.('resize',resize,{passive:true});
  index=nearest();
  return {
    goTo:next=>scrollToPage(next),getIndex:()=>index,
    destroy(){
      if(destroyed)return;destroyed=true;clearTimeout(settleTimer);
      for(const [name,listener,options] of listeners)container.removeEventListener(name,listener,options);
      view.removeEventListener?.('resize',resize);
      restoreStyle();if(gesture)releasePointer(gesture.id);gesture=null;
    },
  };
}
