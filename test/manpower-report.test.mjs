import test from 'node:test';
import assert from 'node:assert/strict';
import {buildManpowerReport,manpowerFilters} from '../manpower-report.mjs';
import {registerManpowerReports} from '../manpower-report-api.mjs';

const site='Sasti OC',date='2026-11-10';
const shifts=[['A','05:00','13:00'],['B','13:00','21:00'],['C','21:00','05:00']].map(([shiftCode,startTime,endTime],i)=>({id:String(31+i),site,shiftCode,shiftName:'Shift '+shiftCode,startTime,endTime,status:'Active'}));
const employees=[{id:'21',caliberId:'101',caliberCode:'CMLL101',name:'Driver One'},{id:'22',caliberId:'102',caliberCode:'CMLL102',name:'Driver One'}];
const assets=Array.from({length:10},(_,i)=>({id:String(i+1),door:'V'+(i+1),site,category:'Vehicle',group:'Tipper',make:'Volvo',model:'FMX'}));
function card(id=1,shift=1,patch={},extra={}){
 const data={bookDate:date,location:site,assetId:1,employeeId:21,caliberId:'101',employeeName:'Driver One',shiftId:30+shift,shiftName:'Shift '+['A','B','C'][shift-1],bookShiftCode:'S'+shift,masterShiftStart:shifts[shift-1].startTime,door:'V1',openingHmr:100,closingHmr:108,openingKmr:1000,closingKmr:1100,totalTrips:5,trips:[],...patch};
 return {id,book_no:'CARD-'+id,book_type:'vehicle',book_date:data.bookDate,site:data.location,asset_id:data.assetId,data,batches:[{id:'b'+shift,name:'BATCH-S'+shift,closed_at:'2026-11-11'}],...extra};
}
const report=(records,extra={})=>buildManpowerReport({records,assets,employees,shifts,filters:{from:date,to:date},...extra});
test('ten Volvo vehicles count once each despite trip rows and repeated records',()=>{
 const records=assets.map((a,i)=>card(i+1,1,{assetId:a.id,door:a.door,employeeId:i%2?22:21,caliberId:i%2?'102':'101'}));
 const r=report([...records,records[0],card(100,1)]);
 assert.equal(r.summary[0].assets,10);assert.equal(r.summary[0].employees,2);assert.equal(r.totals.assets,10);assert.equal(r.totals.duties,2);assert.equal(r.exceptions.filter(e=>/Repeated|repeated/.test(e.reason)).length,2);
});
test('empty created batch supplies a selector, never fabricated assignments',()=>{
 const r=report([],{batches:[{id:'empty',name:'EMPTY BATCH',site,report_date:date}]});assert.equal(r.totals.assets,0);assert.equal(r.summary.length,0);assert.equal(r.options.batches[0].value,'empty');
});
test('performance separates 8 and 7 hours; only OT combines to 15',()=>{
 const r=report([card(1,1),card(2,2,{closingHmr:107})]);assert.deepEqual(r.performance.map(d=>d.hours),[8,7]);assert.ok(r.performance.every(d=>!Object.hasOwn(d,'combinedHours')));assert.equal(r.ot[0].combinedHours,15);assert.equal(r.ot[0].severity,'red');assert.match(r.ot[0].shiftHours,/S1: 8.*S2: 7/);
});
test('S2 + S3 is red, S1 + S3 orange, all three red with priority',()=>{
 assert.equal(report([card(1,2),card(2,3)]).ot[0].severity,'red');assert.equal(report([card(1,1),card(2,3)]).ot[0].severity,'orange');const all=report([card(1,1),card(2,2),card(3,3)]);assert.equal(all.ot.length,1);assert.equal(all.ot[0].severity,'red');assert.match(all.ot[0].reason,/All three/);
});
test('S3 → next day S1 is red with zero scheduled gap',()=>{
 const r=report([card(1,3),card(2,1,{bookDate:'2026-11-11'})]);assert.equal(r.performance.length,1);assert.equal(r.ot.length,1);assert.equal(r.ot[0].severity,'red');assert.equal(r.ot[0].gaps,'0 h');assert.match(r.ot[0].schedule,/2026-11-11 05:00/);
});
test('left boundary includes previous-day S3 for selected-day S1',()=>{
 const r=report([card(1,3,{bookDate:'2026-11-09'}),card(2,1)]);assert.equal(r.ot[0].severity,'red');assert.match(r.ot[0].dates,/2026-11-09/);assert.equal(r.performance.length,1);
});
test('shift and batch filters cannot hide the other OT duty',()=>{
 const r=report([card(1,1),card(2,2)],{filters:{from:date,to:date,shift:'S1',batch:'b1'}});assert.equal(r.details.length,1);assert.equal(r.ot.length,1);assert.match(r.ot[0].shifts,/S1.*S2/);
});
test('same names with different employee IDs do not create OT',()=>{
 const r=report([card(1,1),card(2,2,{employeeId:22,caliberId:'102'})]);assert.equal(r.ot.length,0);assert.equal(r.totals.employees,2);
});
test('Employee ID and mapped Caliber ID resolve the same person',()=>{
 const r=report([card(1,1),card(2,2,{employeeId:21,caliberId:'CMLL101'})]);assert.equal(r.totals.employees,1);assert.equal(r.ot[0].severity,'red');
});
test('unresolved and conflicting identities remain visible and cannot create OT',()=>{
 const r=report([card(1,1),card(2,2,{employeeId:999,caliberId:'999',employeeName:'Driver One'}),card(3,3,{employeeId:21,caliberId:'102'})]);assert.equal(r.details.length,3);assert.equal(r.performance.length,1);assert.equal(r.ot.length,0);assert.equal(r.exceptions.filter(e=>/Employee ID/.test(e.reason)).length,2);
});
test('ambiguous identity mapping is excluded instead of choosing a name',()=>{
 const r=report([card()],{employees:[...employees,{id:'23',caliberId:'101',caliberCode:'OTHER101',name:'Other'}]});assert.equal(r.performance.length,0);assert.match(r.exceptions[0].reason,/ambiguous/);
});
test('multiple vehicles in one shift form one duty and no OT',()=>{
 const r=report([card(1,1,{closingHmr:104}),card(2,1,{assetId:2,door:'V2',closingHmr:103})]);assert.equal(r.performance.length,1);assert.equal(r.performance[0].hours,7);assert.equal(r.ot.length,0);assert.equal(r.totals.assets,2);
});
test('multiple nonoverlapping cards aggregate in the same duty',()=>{
 const r=report([card(1,1,{closingHmr:103}),card(2,1,{openingHmr:103,closingHmr:107,openingKmr:1100,closingKmr:1200})]);assert.equal(r.performance[0].hours,7);assert.equal(r.performance[0].trips,10);assert.equal(r.totals.duties,1);assert.equal(r.summary[0].assets,1);
});
test('overlapping meters do not inflate performance totals',()=>{
 const r=report([card(1,1,{closingHmr:105}),card(2,1,{openingHmr:103,closingHmr:108})]);assert.equal(r.performance[0].hours,null);assert.equal(r.performance[0].trips,null);assert.ok(r.exceptions.some(e=>/Overlapping/.test(e.reason)));
});
test('effective shift revisions override default schedules; real gaps are not red',()=>{
 const revised=[...shifts,{...shifts[1],id:'40',effectiveFrom:'2026-11-01',startTime:'14:00',endTime:'22:00'}];
 const r=report([card(1,1),card(2,2,{masterShiftStart:'14:00'})],{shifts:revised});assert.equal(r.ot[0].severity,'review');assert.equal(r.ot[0].gaps,'1 h');
});
test('missing, ambiguous and inconsistent schedule data stays in review',()=>{
 assert.equal(report([card(1,1),card(2,2)],{shifts:[]}).ot[0].severity,'review');
 const ambiguous=[...shifts,{...shifts[1],id:'40',startTime:'14:00'}];assert.equal(report([card(1,1),card(2,2)],{shifts:ambiguous}).ot[0].severity,'review');
 assert.equal(report([card(1,1),card(2,2,{masterShiftStart:'14:00'})]).ot[0].severity,'review');
});
test('unknown day/night patterns require review rather than inventing approved colours',()=>{
 const day=card(1,1,{shiftName:'Day',bookShiftCode:'D',shiftId:40}),night=card(2,1,{shiftName:'Night',bookShiftCode:'N',shiftId:41});
 assert.equal(report([day,night],{shifts:[]}).ot[0].severity,'review');
});
test('deleted, historical and out-of-context cards are excluded',()=>{
 const r=report([card(1,1,{}, {deleted_at:'2026-11-11'}),card(2,1,{bookDate:'2026-10-31'}),card(3,1,{bookDate:'2026-11-20'})]);assert.equal(r.details.length,0);assert.equal(r.performance.length,0);
});
test('numeric model codes and missing masters are explicit exceptions',()=>{
 const r=report([card()],{assets:[{...assets[0],model:'147'}]});assert.match(r.details[0].model,/Unresolved model code 147/);assert.ok(r.exceptions.some(e=>/no name mapping/.test(e.reason)));assert.equal(report([card()],{assets:[]}).summary.length,0);
});
test('saved site/date and shift conflicts cannot enter official totals',()=>{
 const a=card(1,1,{}, {site:'Jayant OC'}),b=card(2,1,{shiftName:'Shift B'});const r=report([a,b]);assert.equal(r.totals.duties,0);assert.equal(r.summary.length,0);assert.equal(r.details.length,2);
});
test('zero readings remain zero; missing hours remain unavailable',()=>{
 const r=report([card(1,1,{openingHmr:0,closingHmr:0}),card(2,2,{closingHmr:null})]);assert.equal(r.performance[0].hours,0);assert.equal(r.performance[1].hours,null);assert.equal(r.ot[0].combinedHours,null);
});
test('range validation includes calendar dates, cutoff, length and query types',()=>{
 for(const q of [{from:'2026-11-31',to:'2026-11-31'},{from:'2026-10-31',to:date},{from:date,to:'2026-12-11'},{from:date,to:date,site:['Sasti']}])assert.throws(()=>manpowerFilters(q),e=>e.status===400);
 assert.equal(manpowerFilters({from:'2026-11-01',to:'2026-11-30'}).contextFrom,'2026-11-01');
});

function apiHarness(scope={sites:['sasti ob']}){
 let handler;const calls=[];let released=false;const client={async query(sql,args){calls.push({sql,args});if(sql.startsWith('SELECT DISTINCT site'))return {rows:[{site},{site:'Jayant OC'}]};if(sql.includes('SELECT l.id'))return {rows:[card()]};if(sql.startsWith('SELECT id,master_name'))return {rows:[...assets.map(record_data=>({id:record_data.id,master_name:'Equipment master',record_data})),...employees.map(record_data=>({id:record_data.id,master_name:'Employee master',record_data})),...shifts.map(record_data=>({id:record_data.id,master_name:'Shift Master',record_data}))]};return {rows:[]};},release(){released=true;}};
 const protect=[()=>{},()=>{},()=>{}];registerManpowerReports({get(path,...steps){assert.equal(path,'/api/reports/manpower');assert.deepEqual(steps.slice(0,3),protect);handler=steps.at(-1);}},{pool:{connect:async()=>client},protect,ensureBooks:async()=>{},withHandovers:async(_,rows)=>rows});
 return {calls,async run(query={from:date,to:date}){let result,status=200;const headers={};await handler({query,logBookScope:scope},{set(k,v){headers[k]=v;return this;},status(s){status=s;return this;},json(value){result=value;}},e=>{throw e;});return {result,status,headers,released};}};
}
test('API uses scope, excludes deleted cards, and reads one private consistent snapshot',async()=>{
 const h=apiHarness(),r=await h.run();assert.equal(r.status,200);assert.equal(r.result.totals.assets,1);assert.equal(r.headers['Cache-Control'],'private, no-store');assert.equal(r.released,true);assert.match(h.calls[0].sql,/REPEATABLE READ READ ONLY/);const query=h.calls.find(c=>c.sql.includes('SELECT l.id'));assert.deepEqual(query.args[2],[site]);assert.match(query.sql,/l.deleted_at IS NULL/);assert.match(query.sql,/b.deleted_at IS NULL/);assert.equal(h.calls.at(-1).sql,'COMMIT');assert.ok(!JSON.stringify(r.result).includes('record_data'));
});
test('API rejects unassigned sites and malformed dates before reading records',async()=>{
 const h=apiHarness();assert.equal((await h.run({from:date,to:date,site:'Jayant OC'})).status,403);assert.equal((await h.run({from:'bad',to:date})).status,400);assert.equal(h.calls.length,0);
});

test('two employee IDs sharing one Caliber ID are ambiguous, not one person',()=>{
 const r=report([card(1,1),card(2,2,{employeeId:22,caliberId:'102'})],{employees:[employees[0],{...employees[1],caliberCode:'CMLL101'}]});assert.equal(r.totals.duties,0);assert.equal(r.ot.length,0);assert.ok(r.exceptions.every(e=>/ambiguous/.test(e.reason)));
});
test('duplicate equipment master door identities are not arbitrarily counted',()=>{
 const r=report([card()],{assets:[assets[0],{...assets[0],id:'999'}]});assert.equal(r.totals.assets,0);assert.match(r.exceptions[0].reason,/multiple equipment/);
});
