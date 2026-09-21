import * as THREE from 'three';
import { loadCharacters } from './characters.js';
import { getMap, getMapDecor } from './maps.js';
import { PRODUCTS, PRODUCT_MAP, SCENARIOS, LEVEL_Y } from './model.js';
import { getFixturePlacements } from './merchandising.js';

/** The stock worker is a view of world.owner, never a second movement model. */
export function ownerAnimationState(owner) {
  if(!owner||!Array.isArray(owner.position)||owner.position.length!==2||!owner.position.every(Number.isFinite))return null;
  return {
    state:owner.state==='walking'||owner.state==='returning'?'walking':owner.state==='replenishing'?'reaching':'idle',
    basket:[],speed:owner.speed??0,velocity:owner.velocity??0,
    stateTime:owner.stateTime??0,reachLevel:owner.reachLevel??2,
  };
}

/** Reuse the skinned shopper asset, but give the dedicated stock worker a cyan uniform. */
export function createOwnerVisual(makeCharacter) {
  const visual=makeCharacter(100008),group=new THREE.Group();group.name='replenishment-owner';group.add(visual.root);
  visual.root.traverse(node=>{
    if(!node.isMesh)return;
    for(const material of Array.isArray(node.material)?node.material:[node.material])if(material?.name==='Outerwear')material.color.set('#19c8d7');
  });
  const marker=new THREE.Mesh(new THREE.RingGeometry(.32,.40,24),new THREE.MeshBasicMaterial({color:'#19d7e4',side:THREE.DoubleSide,depthWrite:false}));
  marker.rotation.x=-Math.PI/2;marker.position.y=.025;marker.name='stock-worker-marker';group.add(marker);
  return {...visual,group,lastTime:null,lastState:null,lastStateTime:0,
    dispose(){visual.dispose();marker.geometry.dispose();marker.material.dispose();}};
}

/** Used by both renderers: no wall-clock delta, interpolation or source mutation. */
export function syncOwnerVisual(actor,owner,worldTime,{snap=false,runId=null}={}) {
  const motion=ownerAnimationState(owner);
  if(!motion){actor.group.visible=false;actor.carrier.visible=false;actor.lastTime=worldTime;actor.lastState=null;return null;}
  const seek=snap||actor.lastTime===null||!actor.group.visible||actor.lastState!==owner.state||motion.stateTime<actor.lastStateTime||worldTime<actor.lastTime;
  const dt=seek?0:Math.max(0,worldTime-actor.lastTime);
  actor.group.visible=true;actor.group.position.set(owner.position[0],.04,owner.position[1]);actor.group.rotation.y=owner.heading??0;
  actor.group.updateMatrixWorld(true);actor.update(dt,motion,seek);
  actor.lastTime=worldTime;actor.lastState=owner.state;actor.lastStateTime=motion.stateTime;
  return {id:owner.id??'stock-owner',position:[actor.group.position.x,actor.group.position.z],heading:actor.group.rotation.y,
    state:owner.state,animationState:motion.state,clip:actor.pose().clip,stateTime:motion.stateTime,
    renderedTime:worldTime,renderedRunId:runId,productId:owner.productId??null,quantity:owner.quantity??0,
    completedTasks:owner.completedTasks??0,reachLevel:motion.reachLevel};
}

/** CSS-pixel viewport stays full-size when scrolling; only its scissor is clipped. */
export function clipCardViewport(rect, width, height, clips=[]) {
  if(!(rect.width>0&&rect.height>0&&width>0&&height>0))return null;
  let left=Math.max(0,rect.left),right=Math.min(width,rect.right??rect.left+rect.width);
  let top=Math.max(0,rect.top),bottom=Math.min(height,rect.bottom??rect.top+rect.height);
  for(const clip of clips){
    if(clip.x!==false){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}
    if(clip.y!==false){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}
  }
  if(right<=left||bottom<=top)return null;
  return {
    viewport:{x:rect.left,y:height-(rect.bottom??rect.top+rect.height),width:rect.width,height:rect.height},
    scissor:{x:left,y:height-bottom,width:right-left,height:bottom-top},
  };
}

/** Nine read-only views, one WebGL context. The caller owns the frame loop and clock. */
export async function createCardWorlds(entries) {
  if(!Array.isArray(entries)||entries.some(e=>!e?.id||!e.element||typeof e.getWorld!=='function')||new Set(entries.map(e=>e.id)).size!==entries.length)throw new TypeError('Cards require unique ids, viewport elements and getWorld functions.');
  const [makeCharacter,atlas]=await Promise.all([
    loadCharacters(),new THREE.TextureLoader().loadAsync('./assets/product-atlas.png'),
  ]);
  atlas.colorSpace=THREE.SRGBColorSpace;
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,1.5));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.12;
  renderer.autoClear=false;
  renderer.info.autoReset=false;
  const canvas=renderer.domElement;
  canvas.className='card-worlds-canvas';canvas.setAttribute('aria-hidden','true');
  Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',pointerEvents:'none',zIndex:'2'});
  document.body.append(canvas);

  const geometries={box:new THREE.BoxGeometry(1,1,1),cylinder:new THREE.CylinderGeometry(1,1,1,10),cup:new THREE.CylinderGeometry(1,.73,1,10),plane:new THREE.PlaneGeometry(1,1)};
  const paint=new THREE.MeshLambertMaterial({color:'#ffffff'});
  const textures=[atlas],materials=[paint],signMaterials=new Map(),productMaterials=new Map();
  const boundaries=[0,.237,.498,.745,1];
  for(const [index,product] of PRODUCTS.entries()){
    if(index>=8){productMaterials.set(product.id,signMaterial(product.label||product.name,'#203c37',product.color));continue;}
    const row=Math.floor(index/2),texture=atlas.clone();
    texture.repeat.set(.498,boundaries[row+1]-boundaries[row]-.004);
    texture.offset.set((index%2)*.5+.001,1-boundaries[row+1]+.002);texture.needsUpdate=true;
    const material=new THREE.MeshLambertMaterial({map:texture});
    textures.push(texture);materials.push(material);productMaterials.set(product.id,material);
  }
  function signMaterial(text,color='#275e64',background='#eef5de'){
    const key=text+'|'+color+'|'+background;
    if(!signMaterials.has(key)){
      const image=document.createElement('canvas');image.width=512;image.height=96;
      const ctx=image.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,512,96);
      ctx.fillStyle=color;ctx.font='bold 56px Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,51,484);
      const texture=new THREE.CanvasTexture(image);texture.colorSpace=THREE.SRGBColorSpace;
      const material=new THREE.MeshLambertMaterial({map:texture});
      textures.push(texture);materials.push(material);signMaterials.set(key,material);
    }
    return signMaterials.get(key);
  }

  function buildScene(world){
    const map=getMap(world.mapId),theme=map.theme,scene=new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff','#bcc6ba',2.3));
    const sun=new THREE.DirectionalLight('#fff4dd',2.1);sun.position.set(-8,15,10);scene.add(sun);
    const fill=new THREE.DirectionalLight('#e7f1ff',.65);fill.position.set(8,6,-4);scene.add(fill);
    const camera=new THREE.OrthographicCamera(-10,10,10,-10,.1,100);
    camera.position.set(18,19,23);camera.lookAt(0,.5,0);camera.updateMatrixWorld(true);
    const batches=new Map(),packageGroups=new Map(),placements=[];
    const matrix=new THREE.Matrix4(),local=new THREE.Matrix4(),rotation=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0),position=new THREE.Vector3(),scale=new THREE.Vector3();
    let fixtureMatrix=new THREE.Matrix4(),fixtureKey='room';
    function add(shape,color,size,pos,productId=null,unit=-1,material=paint,angle=0,packageGroup=null){
      rotation.setFromAxisAngle(axis,angle);position.set(...pos);scale.set(...size);
      local.compose(position,rotation,scale);matrix.multiplyMatrices(fixtureMatrix,local);
      const key=shape+':'+material.uuid+':'+(productId??'fixture');
      if(!batches.has(key))batches.set(key,{shape,material,productId,rows:[]});
      batches.get(key).rows.push({matrix:matrix.clone(),color:new THREE.Color(color),unit,packageGroup});
    }
    const box=(size,pos,color)=>add('box',color,size,pos);
    function label(text,size,pos,color,background){add('plane','#ffffff',[...size,1],pos,null,-1,signMaterial(text,color,background));}
    function packageModel(id,x,y,z,side=1){
      const p=PRODUCT_MAP[id],packageGroup=fixtureKey+':'+id,unit=packageGroups.get(packageGroup)??0;
      packageGroups.set(packageGroup,unit+1);
      const colored=(shape,size,pos)=>add(shape,p.color,size,pos,id,unit,paint,0,packageGroup);
      if(p.shape==='can'||p.shape==='bottle'){
        colored('cylinder',[.095,.29,.095],[x,y+.15,z]);
        add('cylinder',p.shape==='can'?'#d1dada':'#f7f1df',[p.shape==='can'?.096:.049,.03,p.shape==='can'?.096:.049],[x,y+.315,z],id,unit,paint,0,packageGroup);
      }else if(p.shape==='cup'){
        colored('cup',[.125,.24,.125],[x,y+.125,z]);
        add('cylinder','#f1e3c7',[.13,.024,.13],[x,y+.258,z],id,unit,paint,0,packageGroup);
      }else colored('box',[.22,.3,.105],[x,y+.15,z]);
      add('plane','#ffffff',[.18,.23,1],[x,y+.155,z+side*(p.shape==='cup'?.13:p.shape==='can'||p.shape==='bottle'?.098:.054)],id,unit,productMaterials.get(id),side===-1?Math.PI:0,packageGroup);
    }

    box([map.width+.3,.3,map.depth+.3],[0,-.22,0],theme.base);
    box([map.width,.06,map.depth],[0,-.035,0],theme.floor);
    for(let x=-map.width/2+1;x<map.width/2;x+=1)box([.014,.005,map.depth],[x,.002,0],theme.grout);
    for(let z=-map.depth/2+1;z<map.depth/2;z+=1)box([map.width,.005,.014],[0,.002,z],theme.grout);
    box([map.width,.95,.14],[0,.475,-map.depth/2],theme.wall);
    box([.14,1.5,map.depth],[-map.width/2,.75,0],theme.wall);
    box([map.width,.17,.17],[0,1.04,-map.depth/2],theme.accent);
    box([.17,.17,map.depth],[-map.width/2,1.57,0],theme.accent);
    box([2.25,.035,.8],[map.entry[0],.015,map.entry[1]-.1],theme.accent);
    // A single rear sign remains readable at the small overview scale.
    box([4.2,.47,.13],[-map.width*.19,2.85,-map.depth/2],'#eaf4dd');
    label(map.name,[3.9,.4],[-map.width*.19,2.85,-map.depth/2+.075],theme.accent,theme.wall);
    for(const part of getMapDecor(map))add(part.shape,part.color,part.size,part.position);

    for(const fixture of map.fixtures){
      fixtureKey=fixture.id;
      fixtureMatrix=new THREE.Matrix4().compose(new THREE.Vector3(fixture.x,0,fixture.z),new THREE.Quaternion().setFromAxisAngle(axis,fixture.rotation),new THREE.Vector3(fixture.scale,1,1));
      if(fixture.type==='fridge'){
        box([2.08,2.4,.84],[0,1.2,.15],theme.accent);
        box([1.9,2.08,.04],[0,1.16,.59],'#b7d9d1');
        for(let level=0;level<4;level++){
          const y=.27+level*.49;box([1.94,.06,.37],[0,y,.65],'#e0e8d7');
        }
        for(const x of [-.98,.98])box([.035,2.15,.055],[x,1.2,.84],'#edf6da');
        box([.05,2.04,.05],[0,1.2,.84],'#45646a');
        label('DRINKS',[1.88,.23],[0,2.24,.61],'#f4f9e8','#5199a7');
      }else if(fixture.type==='gondola'){
        box([3.8,.2,1.08],[0,.12,0],theme.accent);
        box([3.64,1.43,.12],[0,.92,0],theme.shelf);
        for(const side of [-1,1])for(let level=0;level<3;level++){
          const y=.29+level*.46;
          box([3.78,.06,.49],[0,y,side*.31],'#eae7ca');
          box([3.78,.07,.035],[0,y+.015,side*.57],theme.accent);
        }
        const name={fresh:'FRESH MEALS',snack:'SNACKS',health:'PROTEIN',extra:'DAILY'}[fixture.id]??'DAILY';
        label(name,[2.35,.22],[0,1.77,.075],'#37615d','#e1eecb');
      }else if(fixture.type==='promo'){
        box([2.55,.18,1.15],[0,.12,0],theme.accent);
        box([2.36,2.15,.12],[0,1.21,-.34],theme.shelf);
        for(const x of [-1.22,1.22])box([.075,2.12,.075],[x,1.2,.45],theme.accent);
        SCENARIOS[world.scenario].levels.forEach((ids,level)=>{
          const y=LEVEL_Y[level];box([2.54,.065,1.02],[0,y,0],'#efe8c7');
          box([2.54,.10,.035],[0,y,.53],level===1||level===2?'#acd66d':'#78a992');
        });
        box([2.64,.35,.35],[0,2.54,-.02],theme.accent);
        label('THIS WEEK · 2+1',[2.5,.26],[0,2.54,.16],'#fff8de',theme.accent);
      }else if(fixture.type==='checkout'){
        box([3.4,1.03,1.23],[0,.535,0],theme.shelf);
        box([3.6,.12,1.36],[0,1.11,0],theme.accent);
        box([.48,.05,.35],[-.46,1.2,0],'#23454a');
        box([.08,.27,.08],[-.46,1.34,-.08],'#45606a');
        box([.54,.37,.075],[-.46,1.59,-.08],'#243e4b');
        box([.47,.29,.012],[-.46,1.59,-.036],'#82c8ce');
        box([.37,.065,.25],[.15,1.22,.09],'#e7e6d2');
        label('GS25',[1.22,.33],[.36,.65,.624],'#268c9a','#b7cbb6');
      }else if(fixture.type==='coffee'){
        box([2.36,.92,1.32],[0,.49,0],theme.shelf);
        box([2.48,.1,1.44],[0,1,0],theme.accent);
        for(const x of [-.52,.45]){
          box([.66,.67,.52],[x,1.4,0],'#33494c');
          box([.50,.27,.035],[x,1.55,.28],'#84bac0');
          box([.46,.035,.36],[x,1.08,.18],'#a3b4af');
          box([.05,.17,.12],[x,1.26,.27],'#253b3c');
          add('cup','#f0e1bd',[.085,.15,.085],[x,1.17,.28]);
        }
        label('CAFE 25',[1.8,.28],[0,.59,.675],'#38766e','#d4dfb9');
      }else if(fixture.type==='baskets'){
        for(let i=0;i<4;i++){
          box([.64,.09,.46],[0,.1+i*.13,0],'#478f9c');
          box([.55,.04,.36],[0,.153+i*.13,0],'#284e60');
        }
      }else if(fixture.type==='table'){
        box([2.05,.09,.78],[0,.81,0],'#c9ae81');
        for(const x of [-.82,.82])for(const z of [-.25,.25])box([.055,.77,.055],[x,.38,z],'#547370');
        for(const x of [-.6,.6])for(const z of [-.71,.71]){
          add('cylinder','#76a38c',[.19,.08,.19],[x,.47,z]);
          add('cylinder','#4c7066',[.045,.44,.045],[x,.23,z]);
        }
      }else if(fixture.type==='plant'){
        add('cup','#b0bb9f',[.2,.3,.2],[0,.15,0]);
        box([.3,.7,.3],[0,.66,0],'#608b67');
      }
      for(const placement of getFixturePlacements(fixture,world.scenario)){
        packageModel(placement.productId,...placement.local,placement.side);
        placements.push({...placement,position:new THREE.Vector3(...placement.local).applyMatrix4(fixtureMatrix).toArray()});
      }
    }
    const productBatches=[];
    for(const batch of batches.values()){
      const mesh=new THREE.InstancedMesh(geometries[batch.shape],batch.material,batch.rows.length);
      batch.rows.forEach((row,index)=>{mesh.setMatrixAt(index,row.matrix);mesh.setColorAt(index,row.color);});
      mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;
      mesh.computeBoundingSphere();scene.add(mesh);
      if(batch.productId)productBatches.push({...batch,mesh});
    }
    const min=new THREE.Vector3(-map.width/2-1.85,-.45,-map.depth/2-.3),max=new THREE.Vector3(map.width/2+.3,3.25,map.depth/2+.3);
    // Fit the complete floor and fixtures in camera space for every card aspect.
    const bounds=[];
    for(const x of [min.x,max.x])for(const y of [min.y,max.y])for(const z of [min.z,max.z])bounds.push(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));
    const left=Math.min(...bounds.map(p=>p.x)),right=Math.max(...bounds.map(p=>p.x)),bottom=Math.min(...bounds.map(p=>p.y)),top=Math.max(...bounds.map(p=>p.y));
    function frame(aspect){
      const cx=(left+right)/2,cy=(bottom+top)/2,halfHeight=Math.max((top-bottom)/2,(right-left)/2/aspect)*1.055;
      camera.left=cx-halfHeight*aspect;camera.right=cx+halfHeight*aspect;camera.bottom=cy-halfHeight;camera.top=cy+halfHeight;camera.updateProjectionMatrix();
    }
    let stockKey='';
    function updateStock(current){
      const key=PRODUCTS.map(p=>current.stock[p.id]).join(',')+'|'+PRODUCTS.map(p=>current.initialStock[p.id]).join(',');
      if(key===stockKey)return;stockKey=key;
      for(const batch of productBatches){
        const quantity=current.stock[batch.productId]??0;
        // One visual facing per shared placement while that SKU is in stock. A
        // package represents a display position, not a unit of warehouse inventory.
        const visibleRows=quantity>0?batch.rows:[];
        visibleRows.forEach((row,index)=>{batch.mesh.setMatrixAt(index,row.matrix);batch.mesh.setColorAt(index,row.color);});
        batch.mesh.instanceMatrix.needsUpdate=true;batch.mesh.instanceColor.needsUpdate=true;
        batch.mesh.count=visibleRows.length;
        batch.mesh.visible=batch.mesh.count>0;
      }
    }
    return {scene,camera,map,frame,updateStock,placements,dispose(){scene.traverse(node=>{if(node.isInstancedMesh)node.dispose();});scene.clear();}};
  }

  const cards=entries.map(entry=>({...entry,built:null,world:null,actors:new Map(),ownerActor:null,visible:false,wasVisible:false,lastTime:0,renderedTime:null,renderedRunId:null,renderedAgents:[],renderedOwner:null}));
  let disposed=false,width=0,height=0,lastDrawCalls=0;
  function removeActor(card,id,actor){card.built.scene.remove(actor.group,actor.carrier);actor.dispose();card.actors.delete(id);}
  function clearActors(card){
    for(const [id,actor] of card.actors)removeActor(card,id,actor);
    if(card.ownerActor){card.built.scene.remove(card.ownerActor.group,card.ownerActor.carrier);card.ownerActor.dispose();card.ownerActor=null;}
  }
  function visibility(entry,w,h,cache){
    const element=entry.element;
    if(!element.isConnected||element.hidden||!element.getClientRects().length)return null;
    const rect=element.getBoundingClientRect(),clips=[];
    if(!clipCardViewport(rect,w,h))return null;
    for(let node=element;node&&node!==document;node=node.parentElement){
      let info=cache.get(node);
      if(!info){
        const style=getComputedStyle(node),box=node.getBoundingClientRect();
        info={hidden:node.hidden||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0,
          x:/(hidden|clip|scroll|auto)/.test(style.overflowX),y:/(hidden|clip|scroll|auto)/.test(style.overflowY),
          left:box.left+node.clientLeft,top:box.top+node.clientTop,right:box.left+node.clientLeft+node.clientWidth,bottom:box.top+node.clientTop+node.clientHeight};
        cache.set(node,info);
      }
      if(info.hidden)return null;
      if(info.x||info.y)clips.push(info);
    }
    return {rect,...clipCardViewport(rect,w,h,clips)};
  }
  function render(){
    if(disposed)return;
    const w=window.innerWidth,h=window.innerHeight;
    if(w!==width||h!==height){width=w;height=h;renderer.setSize(width,height,false);}
    renderer.info.reset();renderer.setScissorTest(false);renderer.setClearColor('#000000',0);renderer.clear(true,true,true);
    const cache=new Map();
    for(const card of cards){
      const view=visibility(card,width,height,cache);card.visible=!!view?.scissor;
      if(!card.visible){card.wasVisible=false;continue;}
      const world=card.getWorld();
      if(!world?.agents||!world.stock){card.visible=false;card.wasVisible=false;continue;}
      const rebound=card.world!==world,needsScene=!card.built||card.built.map.id!==world.mapId||card.scenario!==world.scenario;
      if(needsScene){if(card.built){clearActors(card);card.built.dispose();}card.built=buildScene(world);card.scenario=world.scenario;}
      else if(rebound)clearActors(card);
      const snap=rebound||!card.wasVisible,dt=snap?0:Math.max(0,world.time-card.lastTime);
      card.world=world;card.lastTime=world.time;
      const active=new Set(world.agents.map(a=>a.id));
      for(const [id,actor] of card.actors)if(!active.has(id))removeActor(card,id,actor);
      for(const agent of world.agents){
        let actor=card.actors.get(agent.id),created=false;
        if(!actor){
          const visual=makeCharacter(agent.id),group=new THREE.Group();group.add(visual.root);
          actor={...visual,group,lastState:null,lastStateTime:0};card.actors.set(agent.id,actor);card.built.scene.add(group,visual.carrier);created=true;
        }
        actor.group.position.set(agent.position[0],.04,agent.position[1]);actor.group.rotation.y=agent.heading;actor.group.updateMatrixWorld(true);
        actor.update(dt,agent,snap||created||actor.lastState!==agent.state||agent.stateTime<actor.lastStateTime);
        actor.lastState=agent.state;actor.lastStateTime=agent.stateTime;
      }
      if(world.owner&&!card.ownerActor){card.ownerActor=createOwnerVisual(makeCharacter);card.built.scene.add(card.ownerActor.group,card.ownerActor.carrier);}
      const renderedOwner=card.ownerActor?syncOwnerVisual(card.ownerActor,world.owner,world.time,{snap,runId:world.runId}):null;
      card.built.updateStock(world);card.built.frame(view.rect.width/view.rect.height);
      const viewport=view.viewport,scissor=view.scissor;
      renderer.setViewport(viewport.x,viewport.y,viewport.width,viewport.height);renderer.setScissor(scissor.x,scissor.y,scissor.width,scissor.height);renderer.setScissorTest(true);
      renderer.setClearColor(card.built.map.theme.background,1);renderer.clear(true,true,true);renderer.render(card.built.scene,card.built.camera);
      // Record what was actually drawn, not a fresh source-world snapshot later on.
      card.renderedTime=world.time;card.renderedRunId=world.runId;
      card.renderedOwner=renderedOwner;
      card.renderedAgents=[...card.actors].map(([id,actor])=>({id,position:[actor.group.position.x,actor.group.position.z],heading:actor.group.rotation.y,state:actor.lastState,clip:actor.pose().clip}));
      card.wasVisible=true;
    }
    lastDrawCalls=renderer.info.render.calls;
  }
  return {
    render,
    snapshot:({detail=true}={})=>({cards:cards.map(card=>({
      id:card.id,visible:card.visible,renderedTime:card.renderedTime,renderedRunId:card.renderedRunId,mapId:card.built?.map.id,
      renderedAgents:card.renderedAgents.map(a=>({...a,position:[...a.position]})),
      renderedOwner:card.renderedOwner?{...card.renderedOwner,position:[...card.renderedOwner.position]}:null,
      ...(detail?{
        renderedTheme:card.built?{...card.built.map.theme}:null,renderedProps:card.built?.map.props.map(p=>({...p}))??[],
        renderedPlacements:card.built?.placements.map(p=>({...p,position:[...p.position],visible:(card.world?.stock[p.productId]??0)>0}))??[],
      }:{}),
    })),renderer:{contexts:1,drawCalls:lastDrawCalls,width,height,pixelRatio:renderer.getPixelRatio()}}),
    dispose(){
      if(disposed)return;disposed=true;
      for(const card of cards){if(card.built){clearActors(card);card.built.dispose();}card.visible=false;}
      for(const geometry of Object.values(geometries))geometry.dispose();
      for(const material of materials)material.dispose();for(const texture of textures)texture.dispose();
      renderer.dispose();canvas.remove();
    },
  };
}
