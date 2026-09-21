import { getMap, fixtureBounds } from './maps.js';
const STEP=.2,RADIUS=.22;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

export function createNavigation(mapOrId='office') {
  const map=typeof mapOrId==='string'?getMap(mapOrId):mapOrId;
  const obstacles=map.fixtures.map(fixtureBounds);
  const minX=Math.ceil((-map.width/2+.6)/STEP)*STEP,minZ=Math.ceil((-map.depth/2+.6)/STEP)*STEP;
  const maxX=map.width/2-.5,maxZ=map.depth/2-.5;
  const cols=Math.floor((maxX-minX)/STEP)+1,rows=Math.floor((maxZ-minZ)/STEP)+1;
  function isWalkable(x,z) {
    return x>=minX-1e-8&&x<=maxX&&z>=minZ-1e-8&&z<=maxZ&&
      !obstacles.some(([x0,x1,z0,z1])=>x>x0-RADIUS&&x<x1+RADIUS&&z>z0-RADIUS&&z<z1+RADIUS);
  }
  const cell=([x,z])=>[Math.max(0,Math.min(cols-1,Math.round((x-minX)/STEP))),Math.max(0,Math.min(rows-1,Math.round((z-minZ)/STEP)))];
  const point=(x,z)=>[minX+x*STEP,minZ+z*STEP];
  const key=(x,z)=>z*cols+x;
  function findPath(start,goal,occupied=[]) {
    if(!isWalkable(...start)||!isWalkable(...goal))return [];
    const free=p=>isWalkable(...p)&&!occupied.some(o=>distance(p,o)<.47&&distance(p,start)>.08&&distance(p,goal)>.15);
    const [sx,sz]=cell(start),[gx,gz]=cell(goal),end=key(gx,gz),first=key(sx,sz);
    const open=[{x:sx,z:sz,id:first,g:0,f:0}],costs=new Map([[first,0]]),parent=new Map(),closed=new Set();
    while(open.length) {
      let best=0;for(let i=1;i<open.length;i++)if(open[i].f<open[best].f)best=i;
      const node=open.splice(best,1)[0];if(closed.has(node.id))continue;closed.add(node.id);
      if(node.id===end){
        const result=[goal];let at=end;
        while(at!==first){result.push(point(at%cols,Math.floor(at/cols)));at=parent.get(at);}
        return result.reverse();
      }
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
        const x=node.x+dx,z=node.z+dz;if(x<0||z<0||x>=cols||z>=rows)continue;
        if(!free(point(x,z)))continue;
        if(dx&&dz&&(!free(point(node.x+dx,node.z))||!free(point(node.x,node.z+dz))))continue;
        const id=key(x,z),g=node.g+Math.hypot(dx,dz);
        if(g>=(costs.get(id)??Infinity))continue;
        costs.set(id,g);parent.set(id,node.id);open.push({x,z,id,g,f:g+Math.hypot(x-gx,z-gz)});
      }
    }
    return [];
  }
  return {isWalkable,findPath,obstacles};
}
