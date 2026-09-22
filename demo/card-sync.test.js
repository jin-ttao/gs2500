import test from 'node:test';
import assert from 'node:assert/strict';
import { clipCardViewport,cardClipBox,createEmbeddedCardSurface,createCardWorlds } from './card-worlds.js';

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

test('a visible card keeps its full projection in CSS pixels', () => {
  assert.deepEqual(clipCardViewport(rect(20, 30, 100, 80), 200, 300), {
    viewport: { x: 20, y: 190, width: 100, height: 80 },
    scissor: { x: 20, y: 190, width: 100, height: 80 },
  });
});

test('partially scrolled cards clip pixels without squeezing the camera viewport', () => {
  assert.deepEqual(clipCardViewport(rect(-20, -10, 100, 80), 200, 300), {
    viewport: { x: -20, y: 230, width: 100, height: 80 },
    scissor: { x: 0, y: 230, width: 80, height: 70 },
  });
  assert.deepEqual(clipCardViewport(rect(170, 270, 100, 80), 200, 300), {
    viewport: { x: 170, y: -50, width: 100, height: 80 },
    scissor: { x: 170, y: 0, width: 30, height: 30 },
  });
});

test('every clipping ancestor contributes to the visible intersection', () => {
  const card = rect(20, 30, 100, 80);
  const outer = rect(40, 20, 70, 90);
  const inner = rect(30, 50, 60, 45);
  const expected = {
    viewport: { x: 20, y: 190, width: 100, height: 80 },
    scissor: { x: 40, y: 205, width: 50, height: 45 },
  };
  assert.deepEqual(clipCardViewport(card, 200, 300, [outer, inner]), expected);
  assert.deepEqual(clipCardViewport(card, 200, 300, [inner, outer]), expected);
  assert.deepEqual(clipCardViewport(card, 200, 300, [outer, inner, outer]), expected);
});

test('an ancestor clips only the CSS overflow axes it owns', () => {
  const card = rect(20, 30, 100, 80);
  const horizontalOnly = { ...rect(40, 150, 50, 20), y: false };
  const verticalOnly = { ...rect(150, 50, 20, 45), x: false };
  assert.deepEqual(clipCardViewport(card, 200, 300, [horizontalOnly, verticalOnly]), {
    viewport: { x: 20, y: 190, width: 100, height: 80 },
    scissor: { x: 40, y: 205, width: 50, height: 45 },
  });
});

test('offscreen, hidden-size and fully ancestor-clipped cards have no drawable area', () => {
  for (const card of [
    rect(-100, 20, 100, 80), rect(200, 20, 100, 80),
    rect(20, -80, 100, 80), rect(20, 300, 100, 80),
    rect(20, 20, 0, 80), rect(20, 20, 100, 0),
  ]) {
    assert.equal(clipCardViewport(card, 200, 300), null, JSON.stringify(card));
  }
  assert.equal(clipCardViewport(rect(20, 30, 100, 80), 200, 300, [rect(150, 20, 40, 120)]), null);
  assert.equal(clipCardViewport(rect(20, 30, 100, 80), 200, 300, [rect(20, 30, 100, 0)]), null);
  assert.equal(clipCardViewport(rect(20, 30, 100, 80), 0, 300), null);
  assert.equal(clipCardViewport(rect(20, 30, 100, 80), 200, 0), null);
});

test('clipping never mutates card or ancestor geometry', () => {
  const card = Object.freeze(rect(-20, 30, 200, 80));
  const ancestor = Object.freeze(rect(40, 20, 70, 90));
  const clips = Object.freeze([ancestor]);
  const before = JSON.stringify({ card, clips });
  const result = clipCardViewport(card, 200, 300, clips);
  assert.equal(JSON.stringify({ card, clips }), before);
  assert.equal(result.viewport.width, card.width);
  assert.equal(result.viewport.height, card.height);
  assert.deepEqual(result.scissor, { x: 40, y: 190, width: 70, height: 80 });
});

test('ancestor client clips preserve CSS zoom, scaling, borders and scrollbars',()=>{
  const metrics={offsetWidth:220,offsetHeight:120,clientLeft:10,clientTop:5,clientWidth:190,clientHeight:105};
  assert.deepEqual(cardClipBox(rect(40,70,440,60),metrics),{left:60,top:72.5,right:440,bottom:125});
  assert.deepEqual(cardClipBox(rect(40,70,220,120),metrics),{left:50,top:75,right:240,bottom:180});
});

function mockSurface(position=''){
  const draws=[],children=[],attributes={};
  const element={style:{position},prepend(canvas){children.unshift(canvas);}};
  const canvas={style:{},width:300,height:150,hidden:false,
    setAttribute(name,value){attributes[name]=value;},
    getContext(kind,options){assert.equal(kind,'2d');assert.deepEqual(options,{alpha:false});return{drawImage(...args){draws.push(args);}};},
    remove(){const index=children.indexOf(canvas);if(index>=0)children.splice(index,1);},
  };
  return {element,canvas,draws,children,attributes};
}

test('embedded presentation is a child of its viewport, never a fixed body overlay',()=>{
  const fixture=mockSurface(),surface=createEmbeddedCardSurface(fixture.element,fixture.canvas);
  assert.deepEqual(fixture.children,[fixture.canvas]);
  assert.equal(fixture.canvas.style.position,'absolute');
  assert.equal(fixture.canvas.style.inset,'0');
  assert.equal(fixture.canvas.style.width,'100%');
  assert.equal(fixture.canvas.style.height,'100%');
  assert.equal(fixture.canvas.style.borderRadius,'inherit');
  assert.equal(fixture.canvas.style.pointerEvents,'none');
  assert.equal(fixture.attributes['aria-hidden'],'true');
  assert.equal(fixture.element.style.position,'relative');
  surface.dispose();surface.dispose();
  assert.deepEqual(fixture.children,[]);
  assert.equal(fixture.element.style.position,'');
});

test('embedded copies immediately at the current pixel ratio and resizes with its card',()=>{
  const fixture=mockSurface('absolute'),surface=createEmbeddedCardSurface(fixture.element,fixture.canvas),source={};
  surface.draw(source,201,113,1.5,1);
  assert.equal(fixture.canvas.width,301);
  assert.equal(fixture.canvas.height,169);
  assert.deepEqual(fixture.draws[0],[source,0,1,301,169,0,0,301,169]);
  surface.draw(source,280,150,1);
  assert.deepEqual(fixture.draws[1],[source,0,0,280,150,0,0,280,150]);
  assert.equal(fixture.canvas.width,280);
  assert.equal(fixture.canvas.height,150);
  surface.dispose();
  assert.equal(fixture.element.style.position,'absolute');
  surface.draw(source,500,500,2);
  assert.equal(fixture.draws.length,2);
});

test('hidden or removed card surfaces cannot leave visible stale overlay pixels',()=>{
  const fixture=mockSurface(),surface=createEmbeddedCardSurface(fixture.element,fixture.canvas);
  surface.draw({},100,80,1);
  surface.hide();
  assert.equal(fixture.canvas.hidden,true);
  assert.equal(fixture.canvas.style.visibility,'hidden');
  surface.draw({},100,80,1);
  assert.equal(fixture.canvas.hidden,false);
  assert.equal(fixture.canvas.style.visibility,'visible');
  surface.dispose();
  assert.equal(fixture.children.length,0);
});

test('embedded sizing rejects invalid dimensions and preserves caller-owned positioning',()=>{
  const fixture=mockSurface(),surface=createEmbeddedCardSurface(fixture.element,fixture.canvas);
  for(const dimensions of [[0,100,1],[100,-1,1],[100,100,NaN],[Infinity,100,1]])assert.throws(()=>surface.draw({},...dimensions),RangeError);
  fixture.element.style.position='sticky';
  surface.dispose();
  assert.equal(fixture.element.style.position,'sticky');
});

test('unknown presentation options fail before loading any browser assets',async()=>{
  await assert.rejects(createCardWorlds([],{presentation:'detached'}),/presentation/);
});
