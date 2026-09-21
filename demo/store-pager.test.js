import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateStores, swipeDirection, nearestPageIndex, createStorePager } from './components/ui/store-pager.js';

test('nine stores paginate 4 + 4 + 1 without mutating input or store identities',()=>{
  const stores=Object.freeze(Array.from({length:9},(_,id)=>Object.freeze({id})));
  const pages=paginateStores(stores);
  assert.deepEqual(pages.map(page=>page.length),[4,4,1]);
  assert.deepEqual(pages.flat(),stores);assert.equal(pages[0][0],stores[0]);
  pages[0].pop();assert.equal(stores.length,9);
  assert.deepEqual(paginateStores([]),[]);
  assert.deepEqual(paginateStores(stores,20),[[...stores]]);
});

test('pagination rejects invalid arrays and page sizes',()=>{
  for(const stores of [null,{},'stores'])assert.throws(()=>paginateStores(stores),TypeError);
  for(const size of [0,-1,1.5,NaN,Infinity,'4'])assert.throws(()=>paginateStores([],size),RangeError);
});

test('only a dominant horizontal swipe at the threshold changes pages',()=>{
  assert.equal(swipeDirection(-40,0),1);assert.equal(swipeDirection(40,0),-1);
  assert.equal(swipeDirection(-39.9,0),0);assert.equal(swipeDirection(0,100),0);
  assert.equal(swipeDirection(-80,100),0);assert.equal(swipeDirection(-80,80),0);
  assert.equal(swipeDirection(-80,20),1);assert.equal(swipeDirection(80,-20),-1);
  assert.throws(()=>swipeDirection(NaN,0),TypeError);
  assert.throws(()=>swipeDirection(2,3,{threshold:0}),RangeError);
});

test('nearest-page calculation handles gutters, ends and empty lists',()=>{
  const offsets=Object.freeze([0,420,840]);
  assert.equal(nearestPageIndex(0,offsets),0);assert.equal(nearestPageIndex(260,offsets),1);
  assert.equal(nearestPageIndex(900,offsets),2);assert.equal(nearestPageIndex(-10,offsets),0);
  assert.equal(nearestPageIndex(210,offsets),0);assert.equal(nearestPageIndex(0,[]),-1);
  assert.throws(()=>nearestPageIndex(0,[3,2]),TypeError);
});

function mockPager({reduced=false}={}){
  const listeners=new Map(),calls=[],changes=[],captured=new Set();
  const view={matchMedia:()=>({matches:reduced}),getComputedStyle:()=>({scrollPaddingLeft:'0px'}),addEventListener(){},removeEventListener(){}};
  const container={scrollLeft:0,clientLeft:0,style:{scrollSnapType:'',scrollBehavior:'',userSelect:''},ownerDocument:{defaultView:view},
    getBoundingClientRect:()=>({left:0}),
    addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);},
    scrollTo(options){calls.push(options);this.scrollLeft=options.left;},
    setPointerCapture(id){captured.add(id);},hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
  const pages=[0,400,800].map(left=>({parentElement:container,getBoundingClientRect:()=>({left:left-container.scrollLeft})}));
  const pager=createStorePager({container,pages,onChange:index=>changes.push(index)});
  const emit=(name,values={})=>{
    const event={pointerId:1,pointerType:'mouse',button:0,isPrimary:true,clientX:100,clientY:100,target:container,prevented:false,stopped:false,
      preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...values};
    listeners.get(name)?.(event);return event;
  };
  return {pager,container,pages,calls,changes,listeners,emit};
}

test('goTo clamps pages, honors reduced motion and does not replace existing nodes',()=>{
  const m=mockPager({reduced:true});
  try{
    assert.equal(m.pager.getIndex(),0);m.pager.goTo(1);
    assert.equal(m.pager.getIndex(),1);assert.deepEqual(m.calls.at(-1),{left:400,behavior:'auto'});
    m.emit('scrollend');m.pager.goTo(99);assert.equal(m.pager.getIndex(),2);
    assert.deepEqual(m.changes,[1,2]);assert.equal(m.pages.length,3);
    assert.throws(()=>m.pager.goTo(.5),TypeError);
  }finally{m.pager.destroy();}
  assert.equal(m.listeners.size,0);
});

test('mouse drag changes one page and suppresses the resulting click, not the next tap',()=>{
  const m=mockPager();
  try{
    m.emit('pointerdown');const move=m.emit('pointermove',{clientX:40,clientY:105});
    assert.equal(move.prevented,true);assert.equal(m.container.style.scrollSnapType,'none');
    m.emit('pointerup',{clientX:40,clientY:105});assert.equal(m.pager.getIndex(),1);
    assert.equal(m.container.style.scrollSnapType,'');
    const dragClick=m.emit('click');assert.equal(dragClick.prevented,true);assert.equal(dragClick.stopped,true);
    m.emit('pointerdown');m.emit('pointerup');assert.equal(m.emit('click').prevented,false);
  }finally{m.pager.destroy();}
});

test('vertical gestures and native touch never get manually scrolled or prevented',()=>{
  const m=mockPager();
  try{
    m.emit('pointerdown');assert.equal(m.emit('pointermove',{clientX:110,clientY:180}).prevented,false);
    m.emit('pointerup',{clientX:110,clientY:180});assert.equal(m.calls.length,0);assert.equal(m.emit('click').prevented,false);
    m.emit('pointerdown',{pointerType:'touch'});
    assert.equal(m.emit('pointermove',{pointerType:'touch',clientX:20,clientY:110}).prevented,false);
    m.emit('pointerup',{pointerType:'touch',clientX:20,clientY:110});assert.equal(m.calls.length,0);
    m.container.scrollLeft=400;m.emit('scroll');m.emit('scrollend');assert.equal(m.pager.getIndex(),1);
    assert.equal(m.listeners.has('wheel'),false);
  }finally{m.pager.destroy();}
});

test('arrow navigation is scoped to the container, and destroy restores an active drag',()=>{
  const m=mockPager();
  assert.equal(m.emit('keydown',{key:'ArrowRight',target:m.pages[0]}).prevented,false);
  assert.equal(m.pager.getIndex(),0);
  assert.equal(m.emit('keydown',{key:'ArrowRight'}).prevented,true);assert.equal(m.pager.getIndex(),1);
  m.emit('pointerdown');m.emit('pointermove',{clientX:40});assert.equal(m.container.style.userSelect,'none');
  m.pager.destroy();assert.equal(m.container.style.userSelect,'');assert.equal(m.listeners.size,0);
  m.pager.destroy();
});
