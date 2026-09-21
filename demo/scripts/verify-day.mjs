import assert from 'node:assert/strict';
import {createLab} from '../lab.js';
import {PRODUCTS} from '../model.js';

// Full 24-hour regression for the explicit everyday group (3 stores x 4 plans).
// The production board defaults to all 9 stores at 4x. Keep this bounded checker
// at 900x: it is not a browser speed benchmark or a calibrated sales forecast.
const started=performance.now();
const lab=createLab({storeGroup:'everyday',speed:900});
assert.equal(lab.runs.length,12);
for(const store of lab.stores){
  const runs=lab.runs.filter(run=>run.store.id===store.id);
  for(const run of runs.slice(1))assert.deepEqual(run.world.potentialSchedule,runs[0].world.potentialSchedule);
}
lab.start();
let lastQuarter=0;
while(lab.running){
  lab.advance(1,{budgetMs:Infinity});
  for(const run of lab.runs){
    assert.notEqual(run.status,'failed',run.error??run.id);
    assert.ok(Math.abs(run.world.time-lab.time)<1e-7,run.id+' shared clock');
    const w=run.world;
    for(const product of PRODUCTS){
      const basket=w.agents.filter(a=>!a.paid).reduce((sum,a)=>sum+a.basket.filter(item=>item.id===product.id).length,0);
      assert.equal(w.stock[product.id]+w.backroomStock[product.id]+basket+w.paidUnitsBySKU[product.id],w.initialTotalStock[product.id],run.id+' '+product.id+' conservation');
      assert.ok(w.stock[product.id]>=0&&w.stock[product.id]<=w.shelfCapacity[product.id]);
      assert.ok(w.backroomStock[product.id]>=0);
    }
  }
  const quarter=Math.floor(lab.time/21600);
  if(quarter>lastQuarter){lastQuarter=quarter;console.log(JSON.stringify({progressHours:lab.time/3600,wallSeconds:(performance.now()-started)/1000}));}
}
assert.equal(lab.time,86400);
const results=lab.runs.map(run=>{
  const w=run.world,ledger=w.exportLedger();
  assert.equal(run.status,'complete');assert.equal(w.agents.length,0);
  assert.equal(w.day.considered,1000);assert.equal(w.day.entered+w.day.skipped,1000);
  assert.ok(w.day.skipped>0&&w.day.buyers<=w.day.entered);
  assert.ok(ledger.events.every(event=>event.time<=86400));
  assert.equal(ledger.events.filter(e=>e.type==='payment').reduce((sum,e)=>sum+e.amount,0),w.paidRevenue);
  assert.equal(w.day.hourly.reduce((sum,h)=>sum+h.considered,0),1000);
  assert.equal(w.day.hourly.reduce((sum,h)=>sum+h.paidRevenue,0),w.paidRevenue);
  return {id:run.id,considered:w.day.considered,entered:w.day.entered,skipped:w.day.skipped,buyers:w.day.buyers,revenue:w.paidRevenue,grossProfit:w.paidGrossProfit,shelf:Object.values(w.stock).reduce((a,b)=>a+b,0),backroom:Object.values(w.backroomStock).reduce((a,b)=>a+b,0),replenishments:w.replenishments,stockoutDemand:w.stockoutDemand,closedWithoutPurchase:w.day.closedWithoutPurchase};
});
const before=lab.snapshot();lab.start();lab.advance(10,{budgetMs:Infinity});assert.deepEqual(lab.snapshot(),before);
console.log(JSON.stringify({passed:true,wallSeconds:(performance.now()-started)/1000,time:lab.time,results},null,2));
