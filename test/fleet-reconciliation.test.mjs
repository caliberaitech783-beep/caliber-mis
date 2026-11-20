import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileFleet,shiftForDate,fleetShift,validFleetDate} from '../server/rules/fleet-reconciliation.mjs';
const site='Sasti OC',date='2026-11-02',shift='S1';
const window={start:Date.parse(date+'T05:00:00+05:30'),end:Date.parse(date+'T13:00:00+05:30')};
const now=Date.parse('2026-11-03T13:00:00+05:30');
const asset=(id,kind='vehicle')=>({id:String(id),door:'V'+id,chassis:'CH'+id,category:kind,currentLocation:site,equipmentName:kind==='vehicle'?'Dumper':'Loader',model:'M1'});
const book=(id,extra={})=>({id:String(id),book_no:'VLB-'+id,book_type:'vehicle',asset_id:String(id),site,data:{cardShift:'I',...extra}});
const bd=(id,extra={})=>({ref:'BD-'+id,site,chassis:'CH'+id,start:date+' 08:00:00',closedAt:date+' 10:00:00',...extra});
const run=extra=>reconcileFleet({assets:[],books:[],breakdowns:[],date,site,shift,window,now,...extra});

test('later transfers preserve old VLB and ELB cards at the source, not the destination',()=>{
 for(const kind of ['vehicle','equipment','lmv']){
  const moved={...asset(52,kind),currentLocation:'Dudhichua',transferHistory:[{equipmentMasterId:'52',status:'Completed',source:site,destination:'Dudhichua',transferDate:'2026-11-12',transferTime:'10:00:00'}]};
  const cards=[{...book(52,{totalWorkingHmr:4}),book_type:kind}];
  const old=run({assets:[moved],books:cards});
  assert.equal(old.summary[kind].total,1);assert.equal(old.rows[0].cards.length,1);assert.deepEqual(old.unmatched,[]);
  assert.equal(run({assets:[moved],site:'Dudhichua'}).rows.length,0);
  const after={start:Date.parse('2026-11-13T05:00:00+05:30'),end:Date.parse('2026-11-13T13:00:00+05:30')};
  assert.equal(run({assets:[moved],date:'2026-11-13',window:after}).rows.length,0);
  assert.equal(run({assets:[moved],site:'Dudhichua',date:'2026-11-13',window:after}).rows.length,1);
 }
});

test('exact transfer boundaries use shift overlap and pending transfers do not move the roster',()=>{
 const moved={...asset(52),currentLocation:'Dudhichua',transferHistory:[{equipmentMasterId:'52',status:'Completed',source:site,destination:'Dudhichua',transferDate:date,transferTime:'13:00:00'}]};
 assert.equal(run({assets:[moved]}).rows.length,1);
 assert.equal(run({assets:[moved],site:'Dudhichua'}).rows.length,0);
 const next={start:window.end,end:window.end+8*3600000};
 assert.equal(run({assets:[moved],window:next}).rows.length,0);
 assert.equal(run({assets:[moved],window:next,site:'Dudhichua'}).rows.length,1);
 const pending={...moved,currentLocation:site,transferHistory:[{...moved.transferHistory[0],status:'Awaiting destination PM acceptance'}]};
 assert.equal(run({assets:[pending]}).rows.length,1);
 assert.equal(run({assets:[pending],site:'Dudhichua'}).rows.length,0);
});

test('date-only history supports pre-transfer dates and broken chains cannot invent assignments',()=>{
 const moved={...asset(52),currentLocation:'Dudhichua',transferHistory:[{equipmentMasterId:'52',status:'Completed',source:site,destination:'Dudhichua',transferDate:'2026-11-12'}]};
 assert.equal(run({assets:[moved]}).rows.length,1);
 assert.equal(run({assets:[moved],site:'Dudhichua'}).rows.length,0);
 const broken={...moved,transferHistory:[{...moved.transferHistory[0],destination:'Jayant OC'}]};
 assert.equal(run({assets:[broken]}).rows.length,0);
});

test('overnight transfer includes only sites whose assignment overlaps the shift',()=>{
 const moved={...asset(52),currentLocation:'Dudhichua',transferHistory:[{equipmentMasterId:'52',status:'Completed',source:site,destination:'Dudhichua',transferDate:'2026-11-03',transferTime:'02:00:00'}]};
 const night={start:Date.parse(date+'T21:00:00+05:30'),end:Date.parse('2026-11-03T05:00:00+05:30')};
 assert.equal(run({assets:[moved],window:night}).rows.length,1);
 assert.equal(run({assets:[moved],window:night,site:'Dudhichua'}).rows.length,1);
 const before={start:night.start,end:Date.parse('2026-11-03T02:00:00+05:30')};
 assert.equal(run({assets:[moved],window:before,site:'Dudhichua'}).rows.length,0);
});
test('100 vehicles reconcile with overlapping work/breakdown and multiple cards counted once',()=>{
 const assets=Array.from({length:100},(_,i)=>asset(i+1));
 const books=Array.from({length:80},(_,i)=>book(i+1));books.push({...book(1),id:'duplicate',book_no:'VLB-second'});
 const breakdowns=Array.from({length:20},(_,i)=>bd(i+71));
 const reasons=Array.from({length:8},(_,i)=>({asset_key:'chassis:CH'+(i+91),reason:'Driver unavailable'}));
 const result=run({assets,books,breakdowns,reasons});
 assert.deepEqual(result.summary.vehicle,{total:100,operatedOnly:70,operatedBreakdown:10,breakdownOnly:10,idle:8,pending:2,operated:80,breakdown:20});
 assert.equal(result.rows.find(r=>r.assetId==='71').cards.length,1);assert.equal(result.rows.find(r=>r.assetId==='71').breakdowns.length,1);
 assert.equal(result.rows.find(r=>r.assetId==='1').cards.length,2);
});

test('100 assets of each type reconcile as 80 working + 10 breakdown + 10 unused',()=>{
 for(const kind of ['vehicle','equipment']){
  const assets=Array.from({length:100},(_,i)=>asset(i+1,kind));
  const books=Array.from({length:80},(_,i)=>({...book(i+1,{totalWorkingHmr:4}),book_type:kind}));
  const breakdowns=Array.from({length:10},(_,i)=>bd(i+81));
  const reasons=Array.from({length:10},(_,i)=>({asset_key:'chassis:CH'+(i+91),reason:kind==='vehicle'?'Driver unavailable':'Operator unavailable',remarks:'Absent'}));
  const result=run({assets,books,breakdowns,reasons}),s=result.summary[kind];
  assert.equal(result.rows.length,100);assert.equal(s.operated,80);assert.equal(s.breakdownOnly,10);assert.equal(s.idle+s.pending,10);
  assert.equal(s.total,s.operated+s.breakdownOnly+s.idle+s.pending);
  assert.ok(result.rows.filter(r=>!r.operated&&!r.breakdown).every(r=>r.reason&&r.remarks==='Absent'));
 }
});

test('ELB breakdown statuses and Pulse idle reasons remain visible without inventing work',()=>{
 const assets=[asset(1,'equipment'),asset(2,'equipment'),asset(3,'equipment'),{...asset(4,'equipment'),sourceMissing:true}];
 const books=[{...book(1,{shiftStatus:'breakdown',statusReason:'Engine failure'}),book_type:'equipment'},{...book(2,{shiftStatus:'working_partial_breakdown',totalWorkingHmr:3,statusReason:'Hydraulics'}),book_type:'equipment'}];
 const result=run({assets,books,breakdowns:[bd(3,{vehicleIdle:true,idleReason:'Operator unavailable',description:'Absent'})]});
 assert.equal(result.summary.equipment.total,3);assert.equal(result.summary.equipment.breakdownOnly,1);assert.equal(result.summary.equipment.operatedBreakdown,1);assert.equal(result.summary.equipment.idle,1);
 assert.equal(result.rows.find(r=>r.assetId==='1').breakdowns[0].reason,'Engine failure');
 assert.equal(result.rows.find(r=>r.assetId==='3').reason,'Operator unavailable');
 assert.equal(result.rows.find(r=>r.assetId==='3').remarks,'Absent');
});
test('complete equipment population includes zero-work equipment and explicit idle reasons',()=>{
 const assets=[asset(1,'equipment'),asset(2,'equipment'),asset(3,'equipment'),asset(4,'equipment')];
 const books=[{...book(1,{totalWorkingHmr:3}),book_type:'equipment'},{...book(2,{shiftStatus:'no_operator',statusReason:'Absent'}),book_type:'equipment'},{...book(3,{totalWorkingHmr:0}),book_type:'equipment'}];
 const r=run({assets,books});assert.equal(r.summary.equipment.total,4);assert.equal(r.summary.equipment.operatedOnly,1);assert.equal(r.summary.equipment.idle,1);assert.equal(r.summary.equipment.pending,2);assert.equal(r.rows[1].reason,'Operator unavailable');
});
test('night shift uses next-day breakdowns and half-open boundaries',()=>{
 const w=shiftForDate([{site,shiftName:'Shift C',startTime:'21:00:00',endTime:'05:00:00'}],site,date,'S3');
 const r=run({assets:[asset(1)],shift:'S3',window:w,breakdowns:[bd(1,{start:'2026-11-03 01:00:00',closedAt:'2026-11-03 02:00:00'}),bd(1,{ref:'Boundary',start:'2026-11-03 05:00:00',closedAt:'2026-11-03 06:00:00'})]});
 assert.equal(w.end-w.start,8*3600000);assert.equal(r.rows[0].breakdowns.length,1);
});
test('open, archived and idle Pulse requests are handled separately',()=>{
 const r=run({assets:[asset(1)],breakdowns:[bd(1,{ref:'Open',closedAt:null}),bd(1,{ref:'Archived',archivedAt:now}),bd(1,{ref:'Idle',vehicleIdle:true})]});
 assert.deepEqual(r.rows[0].breakdowns.map(b=>b.reference),['Open']);
});
test('wrong site, wrong shift, chassis collision and outside-roster cards cannot inflate totals',()=>{
 const r=run({assets:[asset(1),{...asset(2),currentLocation:'Jayant OC'}],books:[book(1,{cardShift:'II'}),book(99)],breakdowns:[bd(1,{chassis:'WRONG',door:'V1'}),bd(1,{site:'Jayant OC'})]});assert.equal(r.summary.vehicle.total,1);assert.equal(r.summary.vehicle.pending,1);assert.equal(r.unmatched.length,1);
});
test('duplicate master chassis is one asset and all source IDs resolve',()=>{
 const r=run({assets:[asset(1),{...asset(1),id:'2'}],books:[book(2)]});assert.equal(r.summary.vehicle.total,1);assert.equal(r.summary.vehicle.operated,1);assert.equal(r.warnings.length,1);
});
test('placeholder chassis values never merge unrelated assets',()=>{
 const r=run({assets:[{...asset(1),chassis:'N/A'},{...asset(2),chassis:'NA'},{...asset(3),chassis:'0'}]});assert.equal(r.summary.vehicle.total,3);assert.equal(r.warnings.length,0);
});
test('bad matching breakdown dates stop classification instead of inventing idle',()=>assert.throws(()=>run({assets:[asset(1)],breakdowns:[bd(1,{start:'bad'})]}),/Invalid dates/));
test('effective shift master, invalid dates and aliases are checked',()=>{
 assert.equal(fleetShift('Shift A'),'S1');assert.equal(fleetShift('III'),'S3');assert.equal(validFleetDate('2026-02-30'),false);assert.equal(validFleetDate(date),true);
 assert.throws(()=>shiftForDate([],site,date,shift),/No active/);
 const rows=[{site,shiftName:'A',startTime:'05:00:00',endTime:'13:00:00',effectiveFrom:'2026-11-01'},{site,shiftName:'A',startTime:'06:00:00',endTime:'14:00:00',effectiveFrom:'2026-11-03'}];assert.equal(shiftForDate(rows,site,date,shift).start,window.start);
 assert.throws(()=>shiftForDate([rows[0],{...rows[0],startTime:'06:00:00'}],site,date,shift),/Conflicting/);
});
test('every combination of operation, breakdown and reason remains an additive partition',()=>{
 for(let mask=0;mask<256;mask++){const assets=Array.from({length:8},(_,i)=>asset(i+1)),books=assets.filter((_,i)=>mask&(1<<i)).map(a=>book(a.id)),breakdowns=assets.filter((_,i)=>(mask+i)%3===0).map(a=>bd(a.id)),reasons=assets.filter((_,i)=>(mask+i)%5===0).map(a=>({asset_key:'chassis:CH'+a.id,reason:'Standby'}));const s=run({assets,books,breakdowns,reasons}).summary.vehicle;assert.equal(s.total,s.operatedOnly+s.operatedBreakdown+s.breakdownOnly+s.idle+s.pending);assert.equal(s.operated,s.operatedOnly+s.operatedBreakdown);assert.equal(s.breakdown,s.breakdownOnly+s.operatedBreakdown);}
});
