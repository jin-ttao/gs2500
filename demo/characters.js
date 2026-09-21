import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export async function loadCharacters() {
  const gltf = await new GLTFLoader().loadAsync('./assets/shopper.glb');
  const colors = ['#496077','#954f51','#657851','#806488','#337477','#9d873e','#6a6b79'];
  const skins = ['#cfa281','#b88668','#d8ae8a','#b78a70'];
  return function character(id) {
    const root = clone(gltf.scene);
    const scale = .91 + (id % 5) * .025;
    root.scale.set(scale * (id % 3 === 0 ? .94 : 1), scale, scale);
    const privateMaterials = [];
    root.traverse(node => {
      if(!node.isMesh)return;
      node.castShadow=true;node.receiveShadow=true;
      const customize=source=>{
        const m=source.clone();privateMaterials.push(m);
        if(m.name==='Outerwear')m.color.set(colors[id%colors.length]);
        if(m.name==='Skin')m.color.set(skins[id%skins.length]);
        if(m.name==='Trousers')m.color.set(id%3===0?'#b9ae97':'#323d4d');
        return m;
      };
      node.material=Array.isArray(node.material)?node.material.map(customize):customize(node.material);
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions = Object.fromEntries(gltf.animations.map(clip=>[clip.name,mixer.clipAction(clip)]));
    let current = null;
    function play(name,speed=1){
      if(current!==name){
        const previous=actions[current],next=actions[name];
        if(!next)return;
        next.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1).play();
        if(previous)previous.crossFadeTo(next,.28,false);
        current=name;
      } else actions[name].setEffectiveTimeScale(speed);
    }
    const leftHand=root.getObjectByName('handL')||root.getObjectByName('hand.L');
    const bag=new THREE.Group();
    const bagMaterial=new THREE.MeshStandardMaterial({color:'#c3a978',roughness:.95});
    const paper=new THREE.Mesh(new THREE.BoxGeometry(.22,.25,.10),bagMaterial);
    paper.position.set(0,-.05,0);paper.castShadow=true;bag.add(paper);
    const handle=new THREE.Mesh(new THREE.TorusGeometry(.06,.009,6,12,Math.PI),bagMaterial);
    handle.position.y=.075;bag.add(handle);
    // Bone orientation differs from world orientation; place the carry prop at hand world position.
    const carrier=new THREE.Group();carrier.add(bag);carrier.visible=false;
    play('Idle');
    return {root,carrier,play,pose:()=>({clip:current,hand:leftHand?leftHand.getWorldPosition(new THREE.Vector3()).toArray():null}),update(dt,agent,snap=false){
      const moving=(agent.state==='walking'||agent.state==='exiting')&&agent.velocity>.05;
      let action=moving?(agent.basket.length?'Carry':'Walk'):agent.state==='browsing'?'Browse':agent.state==='paying'?'Pay':'Idle';
      if(agent.state==='reaching')action=agent.reachLevel===1?'ReachLow':agent.reachLevel===4?'ReachHigh':'ReachMiddle';
      const actionSpeed=moving?agent.speed/1.05:1;
      // Rebinding a paused world must show its current pose, not an unadvanced idle rig.
      if(snap){mixer.stopAllAction();current=null;}
      play(action,actionSpeed);
      if(snap){actions[action].time=((agent.stateTime||0)*actionSpeed)%actions[action].getClip().duration;mixer.update(0);}
      else mixer.update(dt);
      carrier.visible=agent.basket.length>0;
      if(leftHand){leftHand.getWorldPosition(carrier.position);carrier.position.y-=.14;carrier.rotation.y=root.parent?.rotation.y||0;}
    },dispose(){mixer.stopAllAction();mixer.uncacheRoot(root);privateMaterials.forEach(m=>m.dispose());paper.geometry.dispose();handle.geometry.dispose();bagMaterial.dispose();}};
  };
}
