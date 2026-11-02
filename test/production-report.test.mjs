import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProductionReport,validateCapacity,applicableCapacity,productionFilters,assetCapacityPair} from '../production-report.mjs';
import {linkVlbTripHandovers} from '../vlb-trip-handover.mjs';
const date='2026-11-01',site='Sasti';
function fixture(){
 const assets=[{id:'1',door:'T1',site,category:'Vehicle',make:'Volvo',model:'FM'},{id:'2',door:'T2',site,category:'Vehicle',make:'Scania',model:'G500'},{id:'3',door:'PC1',site,category:'Equipment'}];
 const shifts=['A','B','C'].map((s,i)=>({id:String(i+10),site,shiftCode:s,startTime:['05:00','13:00','21:00'][i],endTime:['13:00','21:00','05:00'][i]}));
 const batches=['S1','S2','S3'].map((shift,i)=>({id:'b'+i,name:'Batch '+shift,site,report_date:date,shift,closed_at:'2026-11-02T06:00:00Z',closure_revision:1}));
 const records=[];let n=0;
 for(const [i,b] of batches.entries())for(const a of assets){const type=a.category==='Equipment'?'equipment':'vehicle';records.push({id:String(++n),book_no:'Card '+n,book_type:type,book_date:date,site,asset_id:a.id,revision:1,batches:type==='vehicle'?[{...b,snapshotRevision:1}]:[],data:{bookDate:date,location:site,assetId:a.id,door:a.door,employeeId:'E'+a.id,employeeName:'Driver '+a.id,cardShift:b.shift,timeMode:'without',shiftHours:8,openingHmr:10,closingHmr:16+i/10,trips:type==='vehicle'?[{equipmentId:'3',equipmentName:'PC1',tripCount:i+1,completedTrips:i+1}]:[]}});}
 const capacities=[{id:'c1',make:'Volvo',model:'FM',capacity:20,effectiveFrom:date},{id:'c2',make:'Scania',model:'G500',capacity:30,effectiveFrom:date}];
 return {assets,shifts,batches,records,capacities,filters:{site,date,mode:'day'}};
}
test('capacity validation rejects zero, unresolved make codes, invalid dates and excess precision',()=>{
 const v={location:'Sasti',jobType:'Coal haulage',make:' Volvo ',model:'FM',capacity:'20',effectiveFrom:date,reason:'Approved fleet reference'};assert.equal(validateCapacity(v).capacity,20);
 for(const change of [{location:''},{jobType:''},{capacity:0},{capacity:-1},{capacity:' '},{capacity:20.0001},{make:'64'},{effectiveFrom:'2026-11-31'},{reason:''}])assert.throws(()=>validateCapacity({...v,...change}));
 const versions=[{...v,id:1,effectiveFrom:date},{...v,id:2,capacity:25,effectiveFrom:'2026-12-01'}];assert.equal(applicableCapacity(versions,v,date).id,1);assert.equal(applicableCapacity(versions,v,'2026-12-05').id,2);
 const scoped=[{...v,id:3,location:'DCH',capacity:30},{...v,id:4,location:'Sasti',jobType:'Coal haulage',capacity:22}];assert.equal(applicableCapacity(scoped,v,date,{location:'Sasti',jobType:'Coal haulage'}).id,4);assert.equal(applicableCapacity(scoped,v,date,{location:'DCH',jobType:'Coal haulage'}).id,3);
 assert.throws(()=>productionFilters({site,date:'2026-02-31',mode:'day'}));
});
test('day and shift volumes reconcile mixed tipper capacities; machine HMR counts once',()=>{
 const f=fixture(),r=buildProductionReport(f);assert.equal(r.ready,true,JSON.stringify(r.issues));assert.equal(r.totalTrips,12);assert.equal(r.totalQuantity,300);assert.equal(r.machineRows[0].totalQuantity,300);assert.equal(r.machineRows[0].totalHours,18.3);assert.equal(r.doorRows[0].S1Trips,1);assert.equal(r.doorRows[0].S3Trips,3);
 const shift=buildProductionReport({...f,filters:{site,date,mode:'shift',shift:'S2'}});assert.equal(shift.totalTrips,4);assert.equal(shift.totalQuantity,100);assert.equal(shift.machineRows[0].totalHours,6.1);
});
test('open, missing, empty, reopened, stale and ambiguous batches never expose report rows',()=>{
 for(const mutate of [f=>f.batches[1].closed_at=null,f=>f.batches.pop(),f=>f.records=f.records.filter(r=>r.data.cardShift!=='S2'),f=>f.records[0].batches[0].closed_at=null,f=>f.records[0].revision=2,f=>f.batches.push({...f.batches[0],id:'extra'})]){const f=fixture();mutate(f);const r=buildProductionReport(f);assert.equal(r.ready,false);assert.deepEqual(r.doorRows,[]);assert.deepEqual(r.machineRows,[]);assert.ok(r.issues.length);}
});
test('missing capacity, duplicate cards, unmatched machines and missing ELB block totals',()=>{
 for(const mutate of [f=>f.capacities.pop(),f=>f.records.push({...f.records[0],id:'duplicate'}),f=>f.records[0].data.trips[0].equipmentId='999',f=>f.records=f.records.filter(r=>!(r.book_type==='equipment'&&r.data.cardShift==='S1')),f=>f.records[0].data.trips[0].unmatchedTrips=1]){const f=fixture();mutate(f);const r=buildProductionReport(f);assert.equal(r.ready,false);assert.equal(r.totalQuantity,undefined);}
});
test('mixed schedules require a choice; missing fleet cards are not claimed as recorded zeroes',()=>{
 const f=fixture();f.shifts.push({site,shiftCode:'D',startTime:'08:00',endTime:'20:00'},{site,shiftCode:'N',startTime:'21:00',endTime:'05:00'});assert.equal(buildProductionReport(f).ready,false);
 f.filters.schedule='three';f.assets.push({id:'99',door:'T99',site,category:'Vehicle',make:'Volvo',model:'FM'});const r=buildProductionReport(f);assert.equal(r.ready,true);const missing=r.doorRows.find(r=>r.id==='99');assert.equal(missing.S1Trips,null);assert.match(missing.coverage,/no saved VLB/);
});
test('a cross-shift completion uses the loading machine and requires its source batch to be processed',()=>{
 const f=fixture(),loading=f.records[0],unloading=f.records[3];loading.data.timeMode='with';unloading.data.timeMode='with';loading.data.trips=[{equipmentId:'3',equipmentName:'PC1',tripCount:1,loadingTime:'12:50',unloadingTime:''}];unloading.data.trips=[{equipmentName:'',tripCount:1,loadingTime:'',unloadingTime:'13:10'}];
 f.records=[...linkVlbTripHandovers(f.records.filter(r=>r.book_type==='vehicle')),...f.records.filter(r=>r.book_type==='equipment')];f.filters={site,date,mode:'shift',shift:'S2'};const r=buildProductionReport(f);assert.equal(r.ready,true,JSON.stringify(r.issues));assert.equal(r.totalQuantity,80);assert.equal(r.machineRows[0].totalQuantity,80);
 f.records.find(r=>r.id===loading.id).batches[0].closed_at=null;assert.equal(buildProductionReport(f).ready,false);
});
test('ELB inconsistency is visible without changing HMR or combining employee hours',()=>{
 const f=fixture();f.records.find(r=>r.book_type==='equipment').data.breakdownHours=8;f.records.find(r=>r.book_type==='equipment').data.idleHours=2;const r=buildProductionReport(f);assert.equal(r.ready,true);assert.equal(r.warnings.length,1);assert.equal(r.machineRows[0].S1Hours,6);assert.ok(!('combinedHours' in r.machineRows[0]));
});
