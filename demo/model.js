// Demo priors are authored fixtures, not downloaded Nemotron records or GS recommendations.
export const PROFILES = [
  { name: '김서연', age: 38, job: '사무직', mission: '퇴근길 가족 간식', budget: 15000, story: '퇴근하고 집에 가는 길. 가족이 함께 먹을 간식과 간단한 저녁을 고릅니다.', tags: ['3인 가구', '행사 선호'], affinity: { meal: .85, drink: .55, snack: .92, health: .25 } },
  { name: '박준호', age: 27, job: '개발자', mission: '야근 전 빠른 한 끼', budget: 9000, story: '다시 사무실에 들어가기 전에 식사와 커피를 삽니다. 오래 둘러볼 여유는 적습니다.', tags: ['1인 가구', '시간 우선'], affinity: { meal: .98, drink: .88, snack: .3, health: .22 } },
  { name: '이정희', age: 61, job: '자영업', mission: '내일 아침거리', budget: 12000, story: '가게를 닫고 들렀습니다. 익숙한 식품과 내일 아침에 마실 음료를 찾습니다.', tags: ['계획 구매', '가격 고려'], affinity: { meal: .7, drink: .72, snack: .38, health: .64 } },
  { name: '최유진', age: 23, job: '대학생', mission: '수업 사이 간식', budget: 7000, story: '친구를 기다리며 새로운 과자를 구경합니다. 남은 예산으로 음료도 사고 싶습니다.', tags: ['신상품 탐색', '7천 원 예산'], affinity: { meal: .32, drink: .7, snack: .98, health: .2 } },
  { name: '한민수', age: 44, job: '영업직', mission: '운동 후 보충', budget: 10000, story: '운동을 마쳤습니다. 단백질 식품을 고르고 집에 가져갈 음료도 살펴봅니다.', tags: ['고단백', '목적 구매'], affinity: { meal: .54, drink: .73, snack: .2, health: .97 } },
];

export const PRODUCTS = [
  { id: 'coffee', name: '콜드브루', category: 'drink', price: 2400, stock: 120, color: '#985b3e', label: 'COFFEE', shape: 'can', promo: true },
  { id: 'protein', name: '프로틴 드링크', category: 'health', price: 3000, stock: 95, color: '#8c9ce5', label: 'PROTEIN', shape: 'bottle', promo: true },
  { id: 'chips', name: '신상 포테이토', category: 'snack', price: 1900, stock: 165, color: '#ebaa3c', label: 'POTATO', shape: 'bag', promo: true },
  { id: 'rice', name: '삼각김밥', category: 'meal', price: 1700, stock: 140, color: '#28483e', label: 'RICE', shape: 'box' },
  { id: 'nuts', name: '하루 견과', category: 'health', price: 2000, stock: 110, color: '#b28956', label: 'NUTS', shape: 'bag' },
  { id: 'zero', name: '제로 스파클링', category: 'drink', price: 2000, stock: 150, color: '#64b9b7', label: 'ZERO', shape: 'can', promo: true },
  { id: 'noodle', name: '컵라면', category: 'meal', price: 1800, stock: 190, color: '#df6b4b', label: 'NOODLE', shape: 'cup' },
  { id: 'cookie', name: '초코 쿠키', category: 'snack', price: 2200, stock: 170, color: '#e6afbe', label: 'COOKIE', shape: 'box' },
  { id:'water',name:'맑은샘 생수',category:'drink',price:1100,stock:160,color:'#b4ddec',label:'WATER',shape:'bottle' },
  { id:'milk',name:'아침 우유',category:'drink',price:1900,stock:110,color:'#f0e3bd',label:'MILK',shape:'box' },
  { id:'tea',name:'유자 아이스티',category:'drink',price:2300,stock:105,color:'#c6d671',label:'YUJA TEA',shape:'bottle',promo:true },
  { id:'juice',name:'자몽 주스',category:'drink',price:2600,stock:95,color:'#efa18b',label:'JUICE',shape:'bottle' },
  { id:'sandwich',name:'에그 샌드위치',category:'meal',price:3400,stock:100,color:'#dec98a',label:'SANDWICH',shape:'box',promo:true },
  { id:'kimbap',name:'참치 꼬마김밥',category:'meal',price:2900,stock:115,color:'#54866b',label:'KIMBAP',shape:'box' },
  { id:'bento',name:'데일리 도시락',category:'meal',price:4800,stock:85,color:'#b78963',label:'BENTO',shape:'box' },
  { id:'soup',name:'든든 컵수프',category:'meal',price:2100,stock:100,color:'#dca964',label:'SOUP',shape:'cup' },
  { id:'chocolate',name:'다크 초콜릿',category:'snack',price:1800,stock:145,color:'#8b6272',label:'CHOCO',shape:'box' },
  { id:'gummy',name:'톡톡 과일젤리',category:'snack',price:1600,stock:150,color:'#e383aa',label:'GUMMY',shape:'bag',promo:true },
  { id:'popcorn',name:'카라멜 팝콘',category:'snack',price:2000,stock:130,color:'#e5c484',label:'POPCORN',shape:'bag' },
  { id:'cracker',name:'담백 크래커',category:'snack',price:1500,stock:125,color:'#bfac83',label:'CRACKER',shape:'box' },
  { id:'proteinbar',name:'크런치 프로틴바',category:'health',price:2500,stock:100,color:'#aaa1d8',label:'PROTEIN BAR',shape:'box',promo:true },
  { id:'yogurt',name:'플레인 요거트',category:'health',price:2300,stock:95,color:'#cfbfe2',label:'YOGURT',shape:'cup' },
  { id:'eggs',name:'구운 달걀 두알',category:'health',price:2400,stock:95,color:'#cfb894',label:'EGGS',shape:'box' },
  { id:'fruit',name:'한입 과일컵',category:'health',price:3200,stock:80,color:'#c6bc6c',label:'FRUIT',shape:'cup' },
].map(product=>{
  const launchDaysAgo={chips:14,tea:12,sandwich:20,gummy:7,proteinbar:9}[product.id]??180;
  const isNew=launchDaysAgo<=30;
  return {...product,isNew,launchDaysAgo,tags:[product.category,isNew?'신상품 가정':'기존 상품 가정',...(product.promo?['프로모션 가정']:[])],
    trend:{label:isNew?'합성 신상품 관심':'합성 기본 관심',strength:isNew?.75:.20,source:'authored-demo-fixture',status:'assumed',confidence:.35},
    provenance:{source:'authored-demo-fixture',status:'assumed',realProduct:false}};
});
export const SCENARIOS = {
  hq: { title: '본사 표준안', note: '신상품과 행사 상품 중심의 기본 배치', levels: [['nuts','cookie','water','fruit','cracker','eggs'],['rice','zero','milk','kimbap','soup','yogurt'],['protein','chips','tea','gummy','sandwich','proteinbar'],['coffee','noodle','juice','bento','chocolate','popcorn']] },
  owner: { title: '재고 우선안', note: '보유 재고가 많은 상품을 가운데로', levels: [['protein','nuts','tea','yogurt','fruit','eggs'],['noodle','cookie','bento','cracker','popcorn','milk'],['chips','zero','gummy','chocolate','water','soup'],['rice','coffee','sandwich','kimbap','proteinbar','juice']] },
  balanced: { title: '균형 후보안', note: '방문 미션과 보완 상품 이웃을 함께 고려', levels: [['nuts','protein','eggs','fruit','yogurt','water'],['rice','noodle','sandwich','bento','kimbap','soup'],['chips','coffee','gummy','cookie','proteinbar','tea'],['zero','milk','juice','chocolate','popcorn','cracker']] },
  discovery: { title: '신상품 탐색안', note: '합성 신상품 5종을 2층에 모으고 3층에 함께 고를 상품을 배치', levels: [['noodle','bento','soup','rice','kimbap','eggs'],['chips','tea','sandwich','gummy','proteinbar','coffee'],['zero','juice','cookie','chocolate','nuts','yogurt'],['water','milk','protein','fruit','popcorn','cracker']] },
};
export const PRODUCT_MAP = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
export const LEVEL_Y = [.36, .87, 1.38, 1.89];

export function randomAt(person, feature, seed = 42) {
  let t = Math.imul(person + 1, 374761393) ^ Math.imul(feature + seed, 668265263);
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

export function createExperiment(key) {
  const stock = Object.fromEntries(PRODUCTS.map(p => [p.id, p.stock]));
  return { key, count: 0, buyers: 0, revenue: 0, units: 0, decisions: 0, stock, traces: [],
    levels: Array.from({length: 4}, () => ({ exposure: 0, notice: 0, pick: 0 })) };
}

export function visit(result, index) {
  const profile = PROFILES[Math.floor(randomAt(index, 1) * PROFILES.length)];
  let spent = 0, units = 0;
  const events = [];
  const layout = SCENARIOS[result.key].levels;
  // Experimental assumptions, not measured GS shelf effects.
  const noticePrior = [.32, .73, .78, .4];
  PRODUCTS.forEach((product, k) => {
    const level = layout.findIndex(row => row.includes(product.id));
    const funnel = result.levels[level];
    funnel.exposure++;
    const notice = randomAt(index, 20 + k) < noticePrior[level];
    if (!notice) return;
    funnel.notice++;
    result.decisions++;
    const probability = Math.min(.85, .12 + .43 * profile.affinity[product.category] + (product.promo ? .06 : 0));
    const available = result.stock[product.id] > 0 && spent + product.price <= profile.budget && units < 3;
    const picked = available && randomAt(index, 80 + k) < probability;
    if (picked) { result.stock[product.id]--; spent += product.price; units++; funnel.pick++; }
    events.push({ index, profile, product, level: level + 1, picked, probability,
      reason: !available ? '재고·예산 제한' : picked ? `${profile.mission} · 상품 선택` : '상품을 살펴본 뒤 이동' });
  });
  result.count++; result.revenue += spent; result.units += units; result.buyers += units > 0 ? 1 : 0;
  result.traces = [...events.slice(-2).reverse(), ...result.traces].slice(0, 5);
  return events;
}

export function simulate(key, size = 1000) {
  const result = createExperiment(key);
  for (let i = 0; i < size; i++) visit(result, i);
  return result;
}
