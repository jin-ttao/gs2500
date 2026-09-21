// Authored fictional floor plans, not actual GS store plans. Metres, x/z floor plane.
// The renderer, mini-plans, viewing slots and collision bounds all consume this catalog.
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
};

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
  drinks:{name:'냉장 음료',category:'drink',products:['coffee','zero','protein']},
  fresh:{name:'간편식 코너',category:'meal',products:['rice','noodle']},
  snack:{name:'과자 코너',category:'snack',products:['chips','cookie','nuts']},
  health:{name:'단백질 코너',category:'health',products:['protein','nuts']},
  coffee:{name:'커피 아일랜드',category:'drink',products:['coffee']},
  promo:{name:'행사 매대 A',category:'promo',products:['coffee','protein','chips','rice','nuts','zero','noodle','cookie']},
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
