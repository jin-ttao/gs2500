// Authored fictional floor plans, not actual GS store plans. Metres, x/z floor plane.
// Both 3D renderers, viewing slots and collision bounds consume this catalog.
import { PRODUCTS } from './model.js';
export const FIXTURE_BOUNDS = {
  fridge: [-1.04,1.04,-.42,.85],
  gondola: [-1.90,1.90,-.565,.565],
  promo: [-1.275,1.275,-.575,.575],
  checkout: [-1.8,1.8,-.68,.68],
  coffee: [-1.24,1.24,-.72,.72],
  baskets: [-.34,.34,-.25,.25],
  plant: [-.23,.23,-.23,.23],
  table: [-1.15,1.15,-.95,.95],
};
const fixture=(id,type,x,z,rotation=0,scale=1,station=null,side=1)=>({id,type,x,z,rotation,scale,station,side});
const fridge=(i,x,z,r=0)=>fixture('fridge-'+i,'fridge',x,z,r,1,'drinks');
const shelf=(id,x,z,r=0,scale=1,side=1)=>fixture(id,'gondola',x,z,r,scale,id,side);
const common=(checkout,coffee,promo,baskets)=>[
  fixture('checkout','checkout',...checkout),
  fixture('coffee','coffee',...coffee,1,'coffee'),
  fixture('promo','promo',...promo,1,'promo'),
  fixture('baskets','baskets',...baskets),
];
const pi=Math.PI;
export const STORE_MAPS = {
  office: {
    id:'office',name:'오피스 기본형',subtitle:'중앙 행사 매대 · 코너별 분산 동선',width:14.5,depth:11.5,maxActive:14,color:'#a9cb91',
    description:'중앙 행사 매대와 좌측 평행 진열대. 출근·점심·퇴근 수요를 가정한 기본 배치입니다.',
    question:'중앙 행사 매대가 목적 구매 동선에 얼마나 자주 걸릴까?',
    entry:[4.05,5.15],exit:[5,5.2],
    fixtures:[
      fridge(0,-5.5,-4.92),fridge(1,-3.28,-4.92),fridge(2,-1.06,-4.92),
      shelf('fresh',-3.7,-1.23,0,1,-1),shelf('snack',-3.7,1.18),
      shelf('health',5.15,.25,pi/2,1,-1),
      ...common([4.64,-4.39,0],[-5.3,3.85,pi],[1.2,1.05,0],[6.15,3.78]),
    ],
  },
  compact: {
    id:'compact',name:'골목 소형점',subtitle:'짧은 진열대 · 촘촘한 구매 동선',width:12,depth:10.8,maxActive:8,color:'#d5b989',
    description:'짧은 진열대와 냉장고 2대로 공간을 줄인 매장. 행사 매대 주변의 혼잡을 관찰합니다.',
    question:'작은 매장에서도 행사 매대 앞 대기와 통행이 공존할까?',
    entry:[2.3,4.8],exit:[3.3,4.85],
    fixtures:[
      fridge(0,-4.3,-4.60),fridge(1,-2.08,-4.60),
      shelf('fresh',-3,-1,0,.72,-1),shelf('snack',-3,1.5,0,.72),
      shelf('health',4.5,.25,pi/2,.72,-1),
      ...common([3.5,-4.4,0],[-4.5,4.05,pi],[.6,1.25,0],[4.8,4.2]),
    ],
  },
  express: {
    id:'express',name:'역세권 세로형',subtitle:'긴 통로 · 측면 냉장고 · 입구 행사',width:11.8,depth:18,maxActive:10,color:'#8bbbd2',
    description:'폭은 좁고 깊이는 긴 매장. 냉장고는 측면에 두고 행사 매대는 입구 쪽으로 옮겼습니다.',
    question:'입구 행사 매대가 냉장고까지의 이동에 어떤 영향을 줄까?',
    entry:[3.0,8.4],exit:[4,8.45],
    fixtures:[
      fridge(0,-5.15,-5.2,pi/2),fridge(1,-5.15,-2.97,pi/2),fridge(2,-5.15,-.74,pi/2),
      shelf('fresh',-.7,-3.2,pi/2,1,-1),shelf('snack',-.7,1.6,pi/2,1,-1),
      shelf('health',3.7,1.6,pi/2,1,-1),
      ...common([3.25,-7.8,0],[-3.9,6.65,0],[1.1,5.6,0],[4.6,6.7]),
    ],
  },
  residential: {
    id:'residential',name:'주거지 확장형',subtitle:'넓은 면적 · 4개 진열대 · 가족 장보기',width:18,depth:13.5,maxActive:14,color:'#d8a088',
    description:'넓은 가로 폭과 추가 생활상품 진열대. 코너 간 이동 거리가 길어지는 구조입니다.',
    question:'넓어진 공간과 늘어난 진열대가 탐색 거리와 체류를 바꿀까?',
    entry:[5.8,6.15],exit:[6.8,6.2],
    fixtures:[
      fridge(0,-6.8,-5.92),fridge(1,-4.58,-5.92),fridge(2,-2.36,-5.92),
      shelf('fresh',-4.6,-1.35,0,1,-1),shelf('snack',-.1,-1.35),
      shelf('health',5.6,.4,pi/2,1,-1),fixture('extra','gondola',-4.5,1.3),
      ...common([5.8,-5.6,0],[-6.7,4.4,0],[-.8,2.45,0],[7.6,4.9]),
    ],
  },
  cafe: {
    id:'cafe',name:'카페·취식형',subtitle:'커피 코너 · 테이블 2개 · 분리된 동선',width:18,depth:14.5,maxActive:14,color:'#b6a5d2',
    description:'커피 아일랜드와 취식 테이블을 둔 매장. 테이블과 의자도 길 찾기에서 장애물로 처리합니다.',
    question:'취식 공간이 상품 탐색과 계산대 접근 동선을 어떻게 바꿀까?',
    entry:[5.8,6.65],exit:[6.8,6.7],
    fixtures:[
      fridge(0,-6.8,-6.42),fridge(1,-4.58,-6.42),fridge(2,-2.36,-6.42),
      shelf('fresh',-4.8,-2,0,1,-1),shelf('snack',-.2,-2),
      shelf('health',5.8,-.3,pi/2,1,-1),
      ...common([5.8,-6.0,0],[-5.8,.8,0],[2,2.2,0],[7.6,5.4]),
      fixture('table-0','table',-5.5,4.6),fixture('table-1','table',-1.4,4.6),
    ],
  },
  riverside: {
    id:'riverside',name:'한강 축제형',subtitle:'긴 가족식 진열 · 입구 행사 · 야외 피크닉',width:20,depth:14,maxActive:14,color:'#65b9cc',
    description:'강변 축제 방문객을 가정한 넓은 매장. 긴 간편식 매대와 짧은 건강식 매대, 입구 행사대를 분리했습니다.',
    question:'행사 전 피크닉 수요와 긴 간편식 매대가 동선과 선택에 어떤 차이를 만들까?',
    entry:[7,6.4],exit:[8,6.4],
    fixtures:[fridge(0,-7.4,-6.2),fridge(1,-5.18,-6.2),fridge(2,-2.96,-6.2),
      shelf('fresh',-5,-1.45,0,1.2,-1),shelf('snack',.1,.8,pi/2,.9,-1),shelf('health',7.2,.1,pi/2,.72,-1),
      fixture('extra','gondola',-5,1.3,0,.85),...common([6.5,-5.8,0],[-7.7,4.85,pi],[3.9,3.05,0],[8.65,4.9]),fixture('table-0','table',-2.9,4.9)],
  },
  university: {
    id:'university',name:'대학가 캠퍼스형',subtitle:'측면 음료 · 짧은 공부 간식 매대',width:16,depth:15,maxActive:12,color:'#aa96cf',
    description:'측면 음료 냉장고와 서로 다른 방향의 짧은 진열대를 둔 대학가 합성 매장. 넓은 행사대는 입구 쪽에 있습니다.',
    question:'짧은 수업 사이 방문에서 입구 행사와 측면 냉장고의 접근성은 어떻게 다를까?',
    entry:[5.4,6.9],exit:[6.4,6.95],
    fixtures:[fridge(0,-7.12,-4.95,pi/2),fridge(1,-7.12,-2.72,pi/2),fridge(2,-7.12,-.49,pi/2),
      shelf('fresh',-1.7,-2.2,pi/2,.72,-1),shelf('snack',2.1,1.15,0,.82),shelf('health',5.9,-.55,pi/2,.72,-1),
      fixture('extra','gondola',-3.5,2.5,pi/2,.62),fixture('checkout','checkout',4.95,-6.25),fixture('coffee','coffee',-5.8,5.6,pi,1,'coffee'),
      fixture('promo','promo',.5,4.7,0,1.1,'promo'),fixture('baskets','baskets',6.85,5.6)],
  },
  tourism: {
    id:'tourism',name:'관광지 가로형',subtitle:'넓은 가로 통로 · 측면 행사 · 여행 간식',width:20.5,depth:12,maxActive:14,color:'#d79b76',
    description:'가로로 넓은 매장에 긴 간식 매대와 세로 행사대를 배치했습니다. 여행객의 기념 간식과 빠른 보충 구매를 가정합니다.',
    question:'가로 통로를 따라가는 방문객은 옆으로 놓인 행사 매대를 어떻게 탐색할까?',
    entry:[7.2,5.35],exit:[8.2,5.35],
    fixtures:[fridge(0,-7.9,-5.2),fridge(1,-5.68,-5.2),fridge(2,-3.46,-5.2),
      shelf('fresh',-6.8,-.35,0,.78,-1),shelf('snack',-1.7,-.4,0,1.15),shelf('health',7.85,.35,pi/2,.82,-1),
      fixture('extra','gondola',-3.75,3.3,0,.75),fixture('checkout','checkout',7,-4.85),fixture('coffee','coffee',-8.1,3.9,pi,1,'coffee'),
      fixture('promo','promo',3.5,1.65,pi/2,.92,'promo'),fixture('baskets','baskets',9.3,4.2),fixture('table-0','table',.2,4.2)],
  },
  park: {
    id:'park',name:'공원 산책형',subtitle:'긴 중앙 매대 · 나란한 취식 테이블',width:17,depth:17,maxActive:12,color:'#8cb778',
    description:'중앙의 긴 간식 진열대와 전면 취식 테이블 두 개를 둔 공원형 합성 매장. 산책·운동 후 방문을 가정합니다.',
    question:'운동 후 목적 구매와 취식 공간을 우회하는 동선이 만날 때 어떤 혼잡이 생길까?',
    entry:[5.95,7.9],exit:[6.95,7.9],
    fixtures:[fridge(0,-6.5,-7.68),fridge(1,-4.28,-7.68),fridge(2,-2.06,-7.68),
      shelf('fresh',-4.7,-3.1,0,.85,-1),shelf('snack',-.65,.2,pi/2,1.2,-1),shelf('health',5.65,-.65,pi/2,1,-1),
      fixture('extra','gondola',-4.7,.3,0,.68),fixture('checkout','checkout',5.3,-7.1),fixture('coffee','coffee',-6.3,5.8,pi,1,'coffee'),
      fixture('promo','promo',3.65,4.3,0,.95,'promo'),fixture('baskets','baskets',7.45,6.1),fixture('table-0','table',-3,6),fixture('table-1','table',.3,6.3)],
  },
};

// Decorative neighbourhood props live outside the walkable shop rectangle. They do
// not silently introduce solid obstacles into a path that the engine considers free.
const regionalStyles={
  office:{region:'서울 삼성역 · 업무 지구',floor:'#dde5e5',wall:'#cbdde1',accent:'#4e92a7',shelf:'#d3dedb',prop:'#506d87',types:['banner','bike']},
  compact:{region:'서울 골목 · 생활 상권',floor:'#eadbc9',wall:'#e4cbb5',accent:'#bc835b',shelf:'#dfc8a5',prop:'#a06e49',types:['planter','banner']},
  express:{region:'광역 환승역 · 역세권',floor:'#d5e0e8',wall:'#bdd3df',accent:'#407eac',shelf:'#c2d3e0',prop:'#547f9f',types:['busstop','bike']},
  residential:{region:'주거 단지 · 가족 생활권',floor:'#e7dfd6',wall:'#e4c8b9',accent:'#c28068',shelf:'#dbceba',prop:'#9b7561',types:['planter','bench']},
  cafe:{region:'카페 거리 · 머무는 상권',floor:'#e3ddec',wall:'#d2c8e5',accent:'#9779b2',shelf:'#d5c5dc',prop:'#956f95',types:['parasol','planter']},
  riverside:{region:'서울 한강 · 불꽃축제 구역',floor:'#dbe9e4',wall:'#bddfdf',accent:'#388da7',shelf:'#cce0d0',prop:'#4fabc3',types:['river','banner','bench']},
  university:{region:'대학 캠퍼스 · 수업·시험',floor:'#e5dff0',wall:'#d7c5ea',accent:'#8463b5',shelf:'#d5c6e0',prop:'#a783c8',types:['books','bike','banner']},
  tourism:{region:'관광 거리 · 여행 동선',floor:'#eddfc9',wall:'#eccfae',accent:'#c98d46',shelf:'#e4c99e',prop:'#ba8254',types:['banner','parasol','bench']},
  park:{region:'도심 공원 · 산책·운동',floor:'#deead1',wall:'#c5d9b7',accent:'#6d9f55',shelf:'#c4d5b0',prop:'#729d58',types:['tree','tree','bench']},
};
for(const map of Object.values(STORE_MAPS)){
  const {region,types,...theme}=regionalStyles[map.id];
  map.region=region;map.theme={...theme,base:theme.accent,grout:'#c1c8b9',background:theme.floor};
  map.props=types.map((type,index)=>({type,x:-map.width/2-1.1,z:-map.depth/2+2+index*3.3,rotation:0,decorative:true}));
}

export function localToWorld(f,[x,z]) {
  const c=Math.cos(f.rotation),s=Math.sin(f.rotation);
  return [f.x+x*f.scale*c+z*s,f.z+z*c-x*f.scale*s];
}
export function fixtureBounds(f) {
  const [x0,x1,z0,z1]=FIXTURE_BOUNDS[f.type];
  const corners=[[x0,z0],[x0,z1],[x1,z0],[x1,z1]].map(p=>localToWorld(f,p));
  return [Math.min(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[1]))];
}
export function getMap(id='office') {
  const map=STORE_MAPS[id];if(!map)throw new Error('Unknown store map: '+id);return map;
}
const stationInfo={
  drinks:{name:'냉장 음료',category:'drink',products:PRODUCTS.filter(p=>p.category==='drink').map(p=>p.id)},
  fresh:{name:'간편식 코너',category:'meal',products:PRODUCTS.filter(p=>p.category==='meal').map(p=>p.id)},
  snack:{name:'과자 코너',category:'snack',products:PRODUCTS.filter(p=>p.category==='snack').map(p=>p.id)},
  health:{name:'단백질 코너',category:'health',products:PRODUCTS.filter(p=>p.category==='health').map(p=>p.id)},
  coffee:{name:'커피 아일랜드',category:'drink',products:['coffee']},
  promo:{name:'행사 매대 A',category:'promo',products:PRODUCTS.map(p=>p.id)},
};
export function mapStations(map) {
  const stations={};
  for(const f of map.fixtures) {
    if(!f.station)continue;
    const id=f.station;
    const local=f.type==='fridge'?[[0,1.45]]:f.type==='coffee'?[[0,1.30]]:
      f.type==='promo'?[[-1,1.38],[.1,1.38],[1.2,1.38]]:[[-.85,1.24*f.side],[.85,1.24*f.side]];
    if(!stations[id])stations[id]={...stationInfo[id],slots:[],facing:f.rotation+(f.side===-1?0:Math.PI)};
    stations[id].slots.push(...local.map(p=>localToWorld(f,p)));
  }
  return stations;
}
export function checkoutPoint(map,index=0,approach=false) {
  const counter=map.fixtures.find(f=>f.type==='checkout');
  return localToWorld(counter,[-.34-index*.69,approach?2.14:1.41]);
}

/** Shared original low-poly neighbourhood props. All bases are outside the shop. */
export function getMapDecor(map) {
  const parts=[],theme=map.theme;
  for(const prop of map.props){
    const add=(shape,size,offset,color=theme.prop)=>parts.push({shape,size,position:[prop.x+offset[0],offset[1],prop.z+offset[2]],color});
    const box=(size,offset,color)=>add('box',size,offset,color);
    const cylinder=(radius,height,offset,color)=>add('cylinder',[radius,height,radius],offset,color);
    if(prop.type==='tree'||prop.type==='planter'){
      cylinder(.3,.33,[0,.15,0],theme.shelf);cylinder(.065,.9,[0,.7,0],'#927756');
      cylinder(.46,.56,[0,1.36,0],theme.prop);cylinder(.32,.5,[0,1.75,0],theme.accent);
    }else if(prop.type==='bench'){
      box([.65,.1,1.65],[0,.53,0],theme.shelf);box([.09,.53,1.65],[-.27,.82,0]);
      for(const z of [-.6,.6])box([.5,.48,.085],[0,.24,z],theme.accent);
    }else if(prop.type==='parasol'){
      cylinder(.055,1.8,[0,.9,0],theme.accent);cylinder(.57,.15,[0,1.9,0],theme.prop);
      cylinder(.4,.14,[0,2.04,0],theme.shelf);cylinder(.28,.06,[0,.5,0],theme.shelf);
    }else if(prop.type==='river'){
      box([.9,.045,3.0],[0,-.015,0],'#64bbc9');box([.14,.05,3.0],[-.5,.015,0],'#c8e6d9');
      box([.45,.14,.95],[0,.075,0],'#f1e4bb');box([.25,.21,.35],[0,.24,0],theme.accent);
    }else if(prop.type==='books'){
      box([.64,.6,.7],[0,.3,0],theme.shelf);
      for(let i=0;i<5;i++)box([.54,.075,.48],[0,.65+i*.09,0],i%2?theme.accent:theme.prop);
      box([.6,.4,.07],[0,1.3,-.31],theme.wall);
    }else if(prop.type==='bike'){
      for(const z of [-.48,.48]){box([.08,.48,.42],[0,.26,z],'#466364');box([.1,.31,.27],[.005,.26,z],theme.floor);}
      box([.08,.08,.9],[0,.48,0],theme.accent);box([.08,.5,.08],[0,.71,.45],theme.prop);
      box([.5,.06,.07],[0,.94,.45],theme.accent);box([.2,.06,.24],[0,.7,-.3],theme.prop);
    }else{
      cylinder(.05,1.6,[0,.8,0],theme.accent);box([.62,.82,.08],[0,1.58,0],theme.prop);
      box([.47,.08,.025],[0,1.78,.055],theme.floor);box([.34,.065,.025],[0,1.56,.055],theme.floor);
      if(prop.type==='busstop')box([.75,.1,1.3],[0,2.13,0],theme.accent);
    }
  }
  return parts;
}
