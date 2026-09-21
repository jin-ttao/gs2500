import { PRODUCTS, PRODUCT_MAP, SCENARIOS, LEVEL_Y } from './model.js';
import { localToWorld } from './maps.js';

const fixtureCategory={fresh:'meal',snack:'snack',health:'health',drinks:'drink'};
/** Shared product package bases, in metres. Both renderers and decisions use this. */
export function getFixturePlacements(fixture,scenario='hq') {
  if(!fixture||!Number.isFinite(fixture.x)||!Number.isFinite(fixture.z))throw new TypeError('A concrete fixture is required');
  const layout=typeof scenario==='string'?SCENARIOS[scenario]:scenario;
  if(!layout?.levels)throw new RangeError('Unknown shelf scenario: '+scenario);
  if(!['promo','gondola','fridge','coffee'].includes(fixture.type))return [];
  const category=fixtureCategory[fixture.station]??fixtureCategory[fixture.id];
  const catalog=PRODUCTS.filter(p=>p.category===(fixture.type==='fridge'?'drink':category));
  const rows=fixture.type==='promo'?layout.levels:fixture.type==='coffee'?[['coffee']]:Array.from({length:fixture.type==='fridge'?4:3},()=>catalog.length?catalog.map(p=>p.id):PRODUCTS.filter(p=>p.category==='snack').map(p=>p.id));
  const sides=fixture.type==='gondola'?[-1,1]:[1],placements=[];
  for(const side of sides)rows.forEach((ids,row)=>ids.forEach((productId,column)=>{
    if(!PRODUCT_MAP[productId])throw new RangeError('Unknown product: '+productId);
    const halfWidth=fixture.type==='promo'?1.03:fixture.type==='fridge'?.82:fixture.type==='coffee'?0:1.55;
    const x=ids.length===1?0:-halfWidth+column*halfWidth*2/(ids.length-1);
    const y=fixture.type==='promo'?LEVEL_Y[row]+.05:fixture.type==='fridge'?.305+row*.49:fixture.type==='coffee'?1.055:.325+row*.46;
    const z=fixture.type==='promo'?.22:fixture.type==='fridge'?.65:fixture.type==='coffee'?.38:side*.34;
    const [worldX,worldZ]=localToWorld(fixture,[x,z]);
    const id=`${fixture.id}:${side}:${row+1}:${column+1}`;
    placements.push({id,locationId:id,productId,fixtureId:fixture.id,station:fixture.station??null,level:row+1,column:column+1,facings:1,side,local:[x,y,z],position:[worldX,y,worldZ],neighbors:[]});
  }));
  for(const item of placements){
    for(const [relation,level,column] of [['left',item.level,item.column-1],['right',item.level,item.column+1],['above',item.level+1,item.column],['below',item.level-1,item.column]]){
      const neighbor=placements.find(other=>other.side===item.side&&other.level===level&&other.column===column);
      if(neighbor)item.neighbors.push({productId:neighbor.productId,locationId:neighbor.locationId,relation,distance:Math.hypot(...item.position.map((value,i)=>value-neighbor.position[i]))});
    }
  }
  return placements;
}
