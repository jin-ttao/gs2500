import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PRODUCTS, PRODUCT_MAP, SCENARIOS, LEVEL_Y, randomAt } from './model.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadCharacters } from './characters.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STATE_NAMES } from './world.js';
import { getMap, localToWorld } from './maps.js';

export async function createStore(root, onAgentSelect) {
  const loader=new GLTFLoader();
  const [makeCharacter,coffeeAsset,terminalAsset]=await Promise.all([
    loadCharacters(),loader.loadAsync('./assets/coffee-machine.glb'),loader.loadAsync('./assets/checkout-terminal.glb')
  ]);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dce0df');
  const camera = new THREE.OrthographicCamera(-12, 12, 10, -10, .1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor('#dce0df');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(environment, .04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = .48;
  environment.dispose(); pmrem.dispose();
  root.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .08;
  controls.enablePan = false;
  controls.minPolarAngle = .35;
  controls.maxPolarAngle = Math.PI / 2.35;
  controls.minZoom = .6;
  controls.maxZoom = 3.4;
  const materials = new Map();
  const material = color => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: color === '#334e55' ? .28 : .64, metalness: ['#334e55','#3b5860','#dce6de','#263d45'].includes(color) ? .52 : .04 }));
    return materials.get(color);
  };
  const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 24);
  function block(parent, size, position, color, rounded = false) {
    const geometry = rounded ? new RoundedBoxGeometry(...size, 2, .045) : cubeGeometry;
    const mesh = new THREE.Mesh(geometry, material(color));
    if (!rounded) mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function cylinder(parent, radius, height, position, color) {
    const mesh = new THREE.Mesh(cylinderGeometry, material(color));
    mesh.scale.set(radius, height, radius); mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  const labelCache = new Map();
  function sign(parent, text, width, height, position, background = '#fcf7e7', color = '#365247', fontSize = 44) {
    const key = [text, background, color, fontSize].join('|');
    if (!labelCache.has(key)) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = color; ctx.font = `700 ${fontSize}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 65, 490);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      labelCache.set(key, new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), labelCache.get(key));
    mesh.position.set(...position); parent.add(mesh); return mesh;
  }

  scene.add(new THREE.HemisphereLight('#f5f8ff', '#c1c8bd', 1.3));
  const sun = new THREE.DirectionalLight('#fff5e5', 2.8); sun.position.set(-6, 16, 9);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18; sun.shadow.normalBias = .035;
  sun.shadow.bias = -.0002; sun.shadow.radius = 3; scene.add(sun);
  const fill = new THREE.DirectionalLight('#deebff', 1.2); fill.position.set(9, 7, -5); scene.add(fill);

  const store = new THREE.Group(); scene.add(store);
  let map=getMap('office'),scenarioKey='hq';
  const fixtures=new Map();
  // Reparent authored meshes into reusable local-space fixtures. Map definitions are
  // the single source of position, rotation and scale for rendering and navigation.
  function collect(id,origin,build) {
    const previous=new Set(store.children);build();
    const group=new THREE.Group();
    for(const child of [...store.children])if(!previous.has(child)){
      child.position.x-=origin[0];child.position.z-=origin[1];group.add(child);
    }
    store.add(group);if(id)fixtures.set(id,group);return group;
  }
  const room=collect(null,[0,0],()=>{
  block(store, [14.5, .45, 11.5], [0, -.27, 0], '#bac8b9', true);
  const floor = block(store, [14.15, .08, 11.15], [0, -.015, 0], '#e1e1db');
  const tileCanvas=document.createElement('canvas');tileCanvas.width=tileCanvas.height=256;
  const tileContext=tileCanvas.getContext('2d');tileContext.fillStyle='#dbdcd7';tileContext.fillRect(0,0,256,256);
  for(let i=0;i<2000;i++){const v=150+Math.floor(randomAt(i,24)*65);tileContext.fillStyle='rgba('+v+','+v+','+v+',.09)';tileContext.fillRect(randomAt(i,25)*256,randomAt(i,26)*256,1,1);}
  tileContext.strokeStyle='#bbbdb7';tileContext.lineWidth=2;tileContext.strokeRect(0,0,256,256);
  const floorMap=new THREE.CanvasTexture(tileCanvas);floorMap.wrapS=floorMap.wrapT=THREE.RepeatWrapping;floorMap.repeat.set(14,11);floorMap.colorSpace=THREE.SRGBColorSpace;
  floor.material=new THREE.MeshStandardMaterial({map:floorMap,color:'#fafaf6',roughness:.39,metalness:.06});
  const tileLines = [];
  for (let x = -7; x <= 7; x += 1) tileLines.push(x,.031,-5.5,x,.031,5.5);
  for (let z = -5.5; z <= 5.5; z += 1) tileLines.push(-7,.031,z,7,.031,z);
  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(tileLines, 3)), new THREE.LineBasicMaterial({color:'#e0daca',transparent:true,opacity:.75}));
  store.add(grid);
  block(store, [14.3, 2.85, .16], [0, 1.425, -5.52], '#e8eae5');
  block(store, [.16, 2.85, 11.15], [-7.05, 1.425, 0], '#d7ddda');
  block(store, [14.3, .18, .2], [0, 2.72, -5.4], '#469fb5');
  block(store, [.18, .18, 11.15], [-6.95, 2.72, 0], '#469fb5');
  block(store, [14.3, .075, .2], [0, 2.56, -5.4], '#aed873');
  block(store, [.18, .075, 11.15], [-6.95, 2.56, 0], '#aed873');
  sign(store, 'GS25  |  FRESH EVERY DAY', 5, .5, [-2.7, 3.09, -5.46], '#f5f8eb', '#27839e', 40);

  });

  const atlas=await new THREE.TextureLoader().loadAsync('./assets/product-atlas.png');
  atlas.colorSpace=THREE.SRGBColorSpace;atlas.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const boundaries=[0,.237,.498,.745,1];
  const packageInstances=new Set();
  const packagingMaterials=PRODUCTS.map((product,index)=>{
    const row=Math.floor(index/2), texture=atlas.clone();texture.needsUpdate=true;
    texture.repeat.set(.498,boundaries[row+1]-boundaries[row]-.004);
    texture.offset.set((index%2)*.5+.001,1-boundaries[row+1]+.002);
    return new THREE.MeshStandardMaterial({map:texture,roughness:product.shape==='can'?.27:.58,metalness:product.shape==='can'?.22:0});
  });
  // Refrigerators, with visible stocked shelves behind open glass.
  for (let f = 0; f < 3; f++) {
    const fridge = new THREE.Group(); fridge.position.set(-5.5 + f * 2.22, 0, -4.92); store.add(fridge);fixtures.set('fridge-'+f,fridge);
    block(fridge,[2.08,2.4,.83],[0,1.22,0],'#334e55',true);
    block(fridge,[1.94,2.12,.07],[0,1.25,.45],'#c0d8d3');
    for (let l=0;l<4;l++) {
      block(fridge,[1.9,.045,.38],[0,.35+l*.48,.57],'#91aba4');
      for (let j=0;j<8;j++) packageModel(fridge,PRODUCTS[[0,1,5][(j+l+f)%3]],-.81+j*.232,.38+l*.48,.61,.68);
    }
    block(fridge,[.055,2.14,.065],[0,1.22,.79],'#3b5860');
    for(const x of [-.94,.94]) {
      const strip=block(fridge,[.018,1.96,.025],[x,1.24,.74],'#effcff');
      strip.material=new THREE.MeshStandardMaterial({color:'#effcff',emissive:'#d7eeff',emissiveIntensity:.7});
    }
    for(let i=0;i<3;i++)block(fridge,[1.8,.014,.03],[0,.10+i*.028,.435],'#1b3037');
    for (const x of [-.88,.88]) block(fridge,[.04,.72,.04],[x,1.18,.83],'#dce6de');
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.91,2.02),new THREE.MeshBasicMaterial({color:'#c5edf0',transparent:true,opacity:.08,depthWrite:false})); glass.position.set(0,1.24,.84);fridge.add(glass);
    sign(fridge,['DRINKS','FRESH','DAILY'][f],1.86,.2,[0,2.32,.46],'#59a1ae','#eefbf7',35);
  }

  function packageModel(parent, product, x, y, z, scale=1) {
    const g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(scale);parent.add(g);
    g.userData.productId=product.id;packageInstances.add(g);
    const labelMat=packagingMaterials[PRODUCTS.indexOf(product)];
    function label(width,height,py,pz){const m=new THREE.Mesh(new THREE.PlaneGeometry(width,height),labelMat);m.position.set(0,py,pz);g.add(m);}
    if(product.shape==='can'||product.shape==='bottle') {
      const body=cylinder(g,.098,.32,[0,.18,0],product.color);body.material=labelMat;
      cylinder(g,product.shape==='can'?.098:.05,.028,[0,.358,0],product.shape==='can'?'#c9d0d0':'#f1f1e8');
      if(product.shape==='bottle')cylinder(g,.07,.05,[0,.327,0],product.color);
      else {
        const rim=new THREE.Mesh(new THREE.TorusGeometry(.088,.006,6,24),material('#c9d0d0'));rim.rotation.x=Math.PI/2;rim.position.y=.372;g.add(rim);
        block(g,[.035,.005,.066],[0,.378,0],'#707c80',true);
      }
      label(.15,.25,.18,.101);
    } else if(product.shape==='cup') {
      const cup=new THREE.Mesh(new THREE.CylinderGeometry(.14,.104,.23,24),labelMat);cup.position.y=.135;cup.castShadow=true;g.add(cup);
      cylinder(g,.145,.017,[0,.258,0],'#e7d6b4');label(.20,.16,.155,.141);
    } else {
      const size=product.shape==='bag'?[.25,.34,.095]:[.235,.31,.11];
      const bag=block(g,size,[0,size[1]/2,0],product.color,true);
      label(size[0]*.95,size[1]*.93,size[1]/2,size[2]/2+.002);
      if(product.shape==='bag')for(const py of [.018,.328])block(g,[.252,.017,.105],[0,py,0],product.color);
    }
    return g;
  }
  function gondola(x,z,rotation=0) {
    const g = new THREE.Group();g.position.set(x,0,z);g.rotation.y=rotation;store.add(g);
    block(g,[3.8,.17,1.08],[0,.14,0],'#d0d7bf',true);
    block(g,[3.63,1.38,.15],[0,.87,0],'#d1d6c5');
    for(const side of [-1,1]) {
      for(let l=0;l<3;l++) {
        const y=.29+l*.46;
        block(g,[3.79,.065,.48],[0,y,side*.31],'#f3efd8');
        block(g,[3.77,.075,.03],[0,y,side*.565],'#659487');
        for(let i=0;i<9;i++) packageModel(g,PRODUCTS[(i+l*3+(x>0?2:0))%8],-1.61+i*.4,y+.045,side*.32,.82);
      }
    }
    return g;
  }
  fixtures.set('fresh',gondola(-3.7,-1.23));
  fixtures.set('snack',gondola(-3.7,1.18));
  fixtures.set('health',gondola(5.15,.25,Math.PI/2));
  fixtures.set('extra',gondola(-4.5,1.3));

  function fixture(asset,position){const g=asset.scene.clone(true);g.position.set(...position);g.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});store.add(g);return g;}
  // Checkout, register, clerk, and the coffee island from the user's store reference.
  collect('checkout',[4.64,-4.39],()=>{
  block(store,[3.4,1.04,1.25],[4.64,.57,-4.39],'#d0dbc6',true);
  block(store,[3.6,.1,1.36],[4.64,1.13,-4.39],'#53796d',true);
  fixture(terminalAsset,[4.20,1.18,-4.35]);
  sign(store,'GS25',1,.3,[4.45,.73,-3.75],'#d0dbc6','#2b8ea9',62);
  sign(store,'CHECKOUT',2.7,.35,[4.35,2.95,-5.42],'#f4f6eb','#375d57',40);
  });
  collect('coffee',[-5.3,3.85],()=>{
  block(store,[2.36,.9,1.32],[-5.3,.52,3.85],'#d3dac4',true);
  block(store,[2.48,.1,1.44],[-5.3,1.02,3.85],'#bad778',true);
  sign(store,'CAFE 25',1.7,.35,[-5.3,.64,4.52],'#d3dac4','#356e6c',52);
  for(const x of [-5.81,-5.05]) {
    fixture(coffeeAsset,[x,1.075,3.85]);
  }
  });
  // Entrance mat and movable basket stack.
  const entrance=collect(null,[4.4,5.01],()=>{
  block(store,[2.65,.025,.88],[4.4,.052,5.01],'#6f9690',true);
  const welcome=sign(store,'WELCOME',1.9,.3,[4.4,.071,5.0],'#6f9690','#e3ebd8',44);welcome.rotation.x=-Math.PI/2;
  });
  collect('baskets',[6.15,3.78],()=>{
  for(let i=0;i<4;i++) block(store,[.64,.13,.46],[6.15,.15+i*.12,3.78],'#4d9ca7',true);
  });
  for(let t=0;t<2;t++){
    const table=new THREE.Group();store.add(table);fixtures.set('table-'+t,table);
    block(table,[2.0,.08,.76],[0,.78,0],'#c2aa85',true);
    for(const x of [-.84,.84])for(const z of [-.25,.25])block(table,[.065,.73,.065],[x,.38,z],'#45605c');
    // Seats are part of the static collision footprint, not simulated seating actions.
    for(const x of [-.6,.6])for(const z of [-.71,.71]){
      cylinder(table,.19,.07,[x,.46,z],'#73918a');
      cylinder(table,.045,.42,[x,.23,z],'#45605c');
      cylinder(table,.16,.035,[x,.04,z],'#45605c');
    }
  }

  const promo = new THREE.Group();promo.position.set(1.2,0,1.05);store.add(promo);fixtures.set('promo',promo);
  block(promo,[2.55,.16,1.15],[0,.13,0],'#63897b',true);
  block(promo,[2.36,2.12,.15],[0,1.19,-.31],'#cad6ba');
  for(const x of [-1.21,1.21]) block(promo,[.075,2.1,.075],[x,1.2,.46],'#63897b');
  LEVEL_Y.forEach((y,l)=>{
    block(promo,[2.54,.07,1.02],[0,y,0],'#f2edce');
    block(promo,[2.52,.105,.04],[0,y-.015,.525],l===1||l===2?'#abc979':'#769b88');
    sign(promo,`${l+1}F`,.23,.1,[-1.09,y-.008,.55],l===1||l===2?'#abc979':'#769b88','#375848',50);
  });
  block(promo,[2.68,.4,.57],[0,2.59,-.02],'#70a78e',true);
  sign(promo,'THIS WEEK  |  2+1',2.48,.28,[0,2.59,.28],'#70a78e','#fff9df',42);
  const highlight = new THREE.Mesh(new THREE.BoxGeometry(2.62,.46,1.04),new THREE.MeshBasicMaterial({color:'#d9efa1',transparent:true,opacity:.16,depthWrite:false}));promo.add(highlight);
  const productGroups=[];
  // Renderer observes a lab-owned world; it never creates or advances a simulation.
  let world=null,lastWorldTime=0,renderedTime=0,renderedRunId=null;
  function applyLayout(key) {
    scenarioKey=key;
    productGroups.forEach(g=>{
      promo.remove(g);packageInstances.delete(g);
      g.traverse(child=>{
        if(child.geometry && child.geometry!==cubeGeometry && child.geometry!==cylinderGeometry) child.geometry.dispose();
      });
    });
    productGroups.length=0;
    SCENARIOS[key].levels.forEach((ids,l)=>ids.forEach((id,j)=>{
      for(let copy=0;copy<3;copy++) productGroups.push(packageModel(promo,PRODUCT_MAP[id],-.87+j*1.18+copy*.24,LEVEL_Y[l]+.05,.2));
      const p=PRODUCT_MAP[id];const price=sign(promo,`${p.price.toLocaleString()}${p.promo?'  2+1':''}`,.66,.09,[-.6+j*1.18,LEVEL_Y[l]-.012,.551],'#f8f1d9','#425f50',37);productGroups.push(price);
    }));
  }
  applyLayout('hq');

  const paths=new THREE.Group();store.add(paths);
  const actors=new Map();let selectedAgent=-1,last=0,disposed=false,uiElapsed=0;
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY]});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const hits=[...actors.values()].map(a=>a.hit);
    const hit=raycaster.intersectObjects(hits)[0];
    if(hit){selectedAgent=hit.object.userData.agentId;uiElapsed=1;}
  });
  function actorFor(agent) {
    const visual=makeCharacter(agent.id),group=new THREE.Group();group.add(visual.root);store.add(group);store.add(visual.carrier);
    group.rotation.y=agent.heading;
    const hit=new THREE.Mesh(new THREE.BoxGeometry(.56,1.8,.50),new THREE.MeshBasicMaterial({visible:false}));
    hit.position.y=.9;hit.userData.agentId=agent.id;group.add(hit);
    const ring=new THREE.Mesh(new THREE.RingGeometry(.29,.315,32),new THREE.MeshBasicMaterial({color:'#528e7d',transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;ring.position.y=.069;group.add(ring);
    const route=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:'#428f92',transparent:true,opacity:.55,dashSize:.12,gapSize:.08}));
    paths.add(route);
    const actor={...visual,group,hit,ring,route,justCreated:true};actors.set(agent.id,actor);return actor;
  }
  // A stationary cashier uses the same skinned asset with its own animation mixer.
  const cashier=makeCharacter(108),cashierGroup=new THREE.Group();cashierGroup.add(cashier.root);cashierGroup.position.set(5.4,.04,-5.1);store.add(cashierGroup);
  const shelfLabel=document.getElementById('shelfLabel'),agentLabel=document.getElementById('agentLabel');
  function projectLabel(el,point){const p=point.clone().project(camera);el.style.left=`${(p.x*.5+.5)*root.clientWidth}px`;el.style.top=`${(-p.y*.5+.5)*root.clientHeight}px`;el.style.visibility=p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1?'hidden':'visible';}
  let baseSpan=9;
  function resize(){const w=root.clientWidth,h=root.clientHeight;if(!w||!h)return;const aspect=w/h;renderer.setSize(w,h,false);baseSpan=Math.max(.22*(map.width+map.depth)+2.2,(.75*map.width/2+.67*map.depth/2+1.5)/aspect);camera.left=-baseSpan*aspect;camera.right=baseSpan*aspect;camera.top=baseSpan;camera.bottom=-baseSpan;camera.updateProjectionMatrix();}
  const observer=new ResizeObserver(resize);observer.observe(root);
  function reset(){camera.position.set(16,14,18);controls.target.set(0,.5,0);camera.zoom=1;camera.updateProjectionMatrix();controls.update();}
  function focus(){controls.target.set(promo.position.x,1,promo.position.z);camera.position.copy(controls.target).add(new THREE.Vector3(12,10,16));camera.zoom=1.9;camera.updateProjectionMatrix();controls.update();}
  function applyMap(id){
    map=getMap(id);
    for(const group of fixtures.values())group.visible=false;
    for(const f of map.fixtures){
      const group=fixtures.get(f.id);
      if(!group)throw new Error('Missing 3D fixture: '+f.id);
      group.visible=true;group.position.set(f.x,0,f.z);
      group.rotation.y=f.rotation;group.scale.set(f.scale,1,1);
    }
    room.scale.set(map.width/14.5,1,map.depth/11.5);
    entrance.position.set(map.entry[0],0,map.entry[1]-.15);
    const counter=map.fixtures.find(f=>f.id==='checkout');
    const clerk=localToWorld(counter,[.76,-.71]);
    cashierGroup.position.set(clerk[0],.04,clerk[1]);cashierGroup.rotation.y=counter.rotation;
    uiElapsed=1;
    resize();reset();
  }
  applyMap('office');
  function removeActor(id,actor){
    store.remove(actor.group,actor.carrier);paths.remove(actor.route);
    actor.dispose();actor.hit.geometry.dispose();actor.hit.material.dispose();actor.ring.geometry.dispose();actor.ring.material.dispose();actor.route.geometry.dispose();actor.route.material.dispose();actors.delete(id);
  }
  function setWorld(nextWorld){
    if(!nextWorld||!nextWorld.agents||!nextWorld.snapshot)throw new TypeError('A lab-owned spatial world is required.');
    if(nextWorld===world)return;
    for(const [id,actor] of actors)removeActor(id,actor);
    if(nextWorld.mapId!==map.id)applyMap(nextWorld.mapId);
    if(nextWorld.scenario!==scenarioKey)applyLayout(nextWorld.scenario);
    world=nextWorld;lastWorldTime=world.time;selectedAgent=-1;uiElapsed=1;
  }
  function draw(t){
    if(disposed||!world)return;
    const realDt=last?Math.max(0,(t-last)/1000):0;last=t;controls.update();
    // Motion, turns and cashier animation use only the elapsed ENGINE time.
    // Pausing produces zero pose delta; every speed multiplier reaches all motions.
    const dt=Math.max(0,world.time-lastWorldTime);lastWorldTime=world.time;
    uiElapsed+=realDt;
    for(const pkg of packageInstances)pkg.visible=(world.stock[pkg.userData.productId]??0)>0;
    const active=new Set(world.agents.map(a=>a.id));
    for(const [id,actor] of actors)if(!active.has(id)){
      removeActor(id,actor);
    }
    if(!active.has(selectedAgent))selectedAgent=world.agents[0]?.id??-1;
    for(const agent of world.agents){
      const actor=actors.get(agent.id)||actorFor(agent);
      actor.group.position.set(agent.position[0],.04,agent.position[1]);
      const difference=Math.atan2(Math.sin(agent.heading-actor.group.rotation.y),Math.cos(agent.heading-actor.group.rotation.y));
      actor.group.rotation.y+=difference*Math.min(1,dt*9);
      actor.group.updateMatrixWorld(true);
      actor.update(dt,agent,actor.justCreated);actor.justCreated=false;
      actor.ring.visible=agent.id===selectedAgent;
      actor.route.visible=agent.id===selectedAgent;
      if(uiElapsed>.25){
        actor.route.geometry.dispose();
        const remaining=[agent.position,...agent.path.slice(agent.pathIndex)];
        actor.route.geometry=new THREE.BufferGeometry().setFromPoints(remaining.map(p=>new THREE.Vector3(p[0],.072,p[1])));
        actor.route.computeLineDistances();
      }
    }
    cashier.update(dt,{state:world.agents.some(a=>a.state==='paying')?'paying':'idle',basket:[],speed:0,velocity:0});
    projectLabel(shelfLabel,new THREE.Vector3(promo.position.x,3.18,promo.position.z));
    const selected=world.agents.find(a=>a.id===selectedAgent);
    if(selected){
      agentLabel.hidden=false;
      projectLabel(agentLabel,new THREE.Vector3(selected.position[0],2.0,selected.position[1]));
      document.getElementById('sceneAgentName').textContent=selected.profile.name+' · #'+String(selected.id+1).padStart(3,'0');
      document.getElementById('sceneAgentState').textContent=STATE_NAMES[selected.state]+(selected.station?' · '+world.stations[selected.station].name:'');
      onAgentSelect(selected,world.snapshot());
    }else {agentLabel.hidden=true;onAgentSelect(null,world.snapshot());}
    if(uiElapsed>.25)uiElapsed=0;
    renderer.render(scene,camera);renderedTime=world.time;renderedRunId=world.runId;
    document.getElementById('loading').hidden=true;
  }
  function selectLevel(level){highlight.position.set(0,LEVEL_Y[level-1]+.26,0);document.getElementById('levelLabel').textContent=`${level}층 선택 · ${level===2||level===3?'눈높이 구간 가정':'위치 효과 비교'}`;}
  selectLevel(3);
  return {
    setWorld,syncWorld:nextWorld=>{setWorld(nextWorld);draw(performance.now());},reset,focus,selectLevel,
    zoom:delta=>{camera.zoom=THREE.MathUtils.clamp(camera.zoom*delta,.6,3.4);camera.updateProjectionMatrix()},
    togglePaths:()=>{paths.visible=!paths.visible;return paths.visible},
    selectAgent:id=>{selectedAgent=id;uiElapsed=1},
    nextAgent:()=>{const ids=(world?.agents??[]).map(a=>a.id);selectedAgent=ids[(ids.indexOf(selectedAgent)+1)%ids.length]??-1;uiElapsed=1;},
    followAgent:()=>{const a=world?.agents.find(a=>a.id===selectedAgent);if(a){controls.target.set(a.position[0],1,a.position[1]);camera.position.copy(controls.target).add(new THREE.Vector3(8,6,11));camera.zoom=2.2;camera.updateProjectionMatrix();}},
    snapshot:()=>({...world?.snapshot(),renderedTime,renderedRunId,renderedAgents:[...actors].map(([id,a])=>({id,position:[a.group.position.x,a.group.position.z],...a.pose()})),renderedFixtures:[...fixtures].filter(([,g])=>g.visible).map(([id,g])=>({id,x:g.position.x,z:g.position.z,rotation:g.rotation.y,scale:g.scale.x})),selectedAgent,zoom:camera.zoom,rig:{bones:19,clips:8},paths:paths.visible,
      screenAgents:[...actors].map(([id,a])=>{const p=a.group.position.clone().add(new THREE.Vector3(0,1,0)).project(camera);const rect=root.getBoundingClientRect();return{id,x:rect.left+(p.x*.5+.5)*rect.width,y:rect.top+(-p.y*.5+.5)*rect.height,...a.pose()};})}),
    dispose:()=>{disposed=true;observer.disconnect();controls.dispose();actors.forEach(a=>a.dispose());cashier.dispose();envTarget.dispose();renderer.dispose();}
  };
}
