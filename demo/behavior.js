// A deliberately small, inspectable policy vocabulary. This is not a language
// model: unrecognized prose remains in the persona but has no inferred meaning.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const categories=new Set(['meal','drink','snack','health']);
const ids=value=>Array.isArray(value)?[...new Set(value.filter(id=>typeof id==='string'&&id.trim()).map(id=>id.trim()))]:[];
const aliases={water:['생수','맑은샘 생수'],coffee:['콜드브루','커피'],rice:['삼각김밥'],gummy:['과일젤리','젤리'],protein:['프로틴 드링크'],proteinbar:['프로틴바'],chips:['포테이토'],milk:['우유'],tea:['아이스티']};
const sources=profile=>[
  {source:'mission',text:profile?.mission},{source:'story',text:profile?.story},
  ...(Array.isArray(profile?.tags)?profile.tags.map(text=>({source:'tag',text})):[]),
  ...(Array.isArray(profile?.behavior?.explicitGoals)?profile.behavior.explicitGoals.map(text=>({source:'explicit-goal',text})):[]),
  ...(Array.isArray(profile?.behavior?.dietaryConstraints)?profile.behavior.dietaryConstraints.map(text=>({source:'dietary-constraint-candidate',text})):[]),
].filter(row=>typeof row.text==='string');
const avoidNewPattern=/신(?:상품|상)(?:은|을)?\s*(?:기피|회피|제외|싫|사지\s*않|구매하지\s*않|안\s*(?:사|삼|구매))/;
const preferenceRules=[
  ['meal',/식사|한\s*끼|저녁|아침거리|김밥|도시락/],
  ['drink',/음료|커피|생수|우유|아이스티/],
  ['snack',/간식|과자|쿠키|초콜릿|젤리/],
  ['health',/단백질|프로틴|운동\s*후|고단백|보충/],
];

export function deriveBehavior(profile={}) {
  const explicit=profile.behavior&&typeof profile.behavior==='object'?profile.behavior:{};
  const policy={schemaVersion:'behavior-policy/1',allowProductIds:null,avoidProductIds:[],avoidNew:false,
    preferredCategories:[],priceSensitivity:.65,maxBasket:3,evidence:[],
    interpretation:'bounded-authored-rules; not general language understanding'};
  const evidence=(field,source,rule,excerpt)=>policy.evidence.push({field,source,rule,
    excerpt:excerpt.length<=320?excerpt:null,
    ...(excerpt.length>320?{sourceTextReference:source,characterCount:excerpt.length,note:'Full narrative retained in persona; not duplicated per SKU'}:{})});
  for(const {source,text} of sources(profile)) {
    // Only these explicit “X only” phrases become a hard product restriction.
    const only=[];
    for(const [id,names] of Object.entries(aliases))if(names.some(name=>text.includes(name+'만')))only.push(id);
    if(only.length){policy.allowProductIds=policy.allowProductIds===null?only:policy.allowProductIds.filter(id=>only.includes(id));evidence('allowProductIds',source,'known-product-only',text);}
    if(avoidNewPattern.test(text)){policy.avoidNew=true;evidence('avoidNew',source,'explicit-new-product-avoidance',text);}
    for(const [category,pattern] of preferenceRules)if(pattern.test(text)){
      if(!policy.preferredCategories.includes(category))policy.preferredCategories.push(category);
      evidence('preferredCategories',source,'known-category-phrase:'+category,text);
    }
    if(/가격\s*(?:고려|민감|우선)|저렴|가성비|할인\s*선호/.test(text)){
      policy.priceSensitivity=.9;evidence('priceSensitivity',source,'explicit-price-conscious-phrase',text);
    }
  }
  for(const key of ['allowProductIds','avoidProductIds','preferredCategories'])if(Object.hasOwn(explicit,key)){
    policy[key]=key==='allowProductIds'&&explicit[key]===null?null:ids(explicit[key]);
    if(key==='preferredCategories')policy[key]=policy[key].filter(id=>categories.has(id));
    evidence(key,'profile.behavior','typed-override',JSON.stringify(explicit[key]));
  }
  if(typeof explicit.avoidNew==='boolean'){
    policy.avoidNew=explicit.avoidNew;evidence('avoidNew','profile.behavior','typed-override',String(explicit.avoidNew));
  }
  if(Number.isFinite(explicit.priceSensitivity)){
    policy.priceSensitivity=clamp(explicit.priceSensitivity,0,1);evidence('priceSensitivity','profile.behavior','typed-clamped-override',String(explicit.priceSensitivity));
  }
  if(Number.isSafeInteger(explicit.maxBasket)&&explicit.maxBasket>=0){
    policy.maxBasket=Math.min(3,explicit.maxBasket);evidence('maxBasket','profile.behavior','typed-clamped-override',String(explicit.maxBasket));
  }
  return policy;
}

/** Hard constraints and utility inputs, separate from visibility and shelf stock. */
export function productPolicy(profile,product,{basket=[],spent=0,memory=[],behavior=deriveBehavior(profile)}={}) {
  const id=product.productId??product.id,bag=basket.map(item=>typeof item==='string'?item:item.productId??item.id);
  const remainingBudget=Math.max(0,(Number.isFinite(profile?.budget)?profile.budget:0)-(Number.isFinite(spent)?spent:0));
  const reasons=[],evidence=[...behavior.evidence];
  if(behavior.allowProductIds!==null&&!behavior.allowProductIds.includes(id))reasons.push('mission-product-not-allowed');
  if(behavior.avoidProductIds.includes(id))reasons.push('avoided-product');
  if(behavior.avoidNew&&product.isNew)reasons.push('avoids-new-products');
  if(!Number.isFinite(product.price)||product.price<0||product.price>remainingBudget)reasons.push('budget');
  if(bag.includes(id))reasons.push('already-picked');
  if(bag.length>=behavior.maxBasket)reasons.push('basket-limit');
  let memoryAdjustment=0;
  for(const item of Array.isArray(memory)?memory:[]) {
    const message=typeof item==='string'?item:item?.message;
    const knownNames=[...(aliases[id]??[]),product.name].filter(Boolean);
    const explicitAvoid=typeof item==='object'&&item!==null&&(
      ids(item.avoidProductIds).includes(id)||item.productId===id&&(
        ['avoid','avoid-product','disliked'].includes(item.type??item.kind??item.outcome)||item.preference==='avoid'||item.liked===false));
    const phraseAvoid=typeof message==='string'&&knownNames.some(name=>message.includes(name))&&/다시\s*(?:사지|구매하지)|사지\s*않|구매하지\s*않|구매\s*(?:제외|금지)|기피|피하기|안\s*사기/.test(message);
    if(explicitAvoid||phraseAvoid){
      if(!reasons.includes('memory-avoid'))reasons.push('memory-avoid');
      evidence.push({field:'avoidProductIds',source:'memory',rule:explicitAvoid?'typed-product-avoidance':'known-product-avoidance-phrase',excerpt:message??JSON.stringify(item)});
    }
    if(item&&typeof item==='object'&&item.productId===id){
      const change=Number.isFinite(item.preferenceAdjustment)?clamp(item.preferenceAdjustment,-.18,.18)
        :item.liked===true||item.outcome==='liked'?.12:0;
      memoryAdjustment+=change;
      if(change)evidence.push({field:'memoryAdjustment',source:'memory',rule:'typed-product-preference',excerpt:JSON.stringify(item)});
    }
  }
  memoryAdjustment=clamp(memoryAdjustment,-.18,.18);
  const missionFit=behavior.allowProductIds?.includes(id)?.28:behavior.preferredCategories.includes(product.category)?.16:behavior.preferredCategories.length?-.04:0;
  // Uses budget share, not an affordability cliff: a ₩6,900 item is a materially
  // different choice from a ₩1,600 item even if both fit a ₩7,000 budget.
  const budgetShare=remainingBudget>0&&Number.isFinite(product.price)?clamp(product.price/remainingBudget,0,1):1;
  const pricePenalty=-behavior.priceSensitivity*.62*Math.pow(budgetShare,1.15);
  return {allowed:reasons.length===0,reasons,missionFit,pricePenalty,memoryAdjustment,remainingBudget,budgetShare,
    priceSensitivity:behavior.priceSensitivity,behavior,evidence};
}
