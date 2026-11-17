import test from 'node:test';
import assert from 'node:assert/strict';
import {buildManpowerReport,manpowerFilters,lockedSiteDays,pendingSiteDays,attendanceWindows,otHistoryWindows,otHistorySummary,otYearWindows,otDriverTally} from '../server/rules/manpower-report.mjs';
import {registerManpowerReports} from '../server/routes/manpower-report-api.mjs';
import {linkVlbTripHandovers} from '../shared/vlb-trip-handover.mjs';

const site='Sasti OC',date='2026-11-10';
const shifts=[['A','05:00','13:00'],['B','13:00','21:00'],['C','21:00','05:00']].map(([shiftCode,startTime,endTime],i)=>({id:String(31+i),site,shiftCode,shiftName:'Shift '+shiftCode,startTime,endTime,status:'Active'}));
const employees=[{id:'21',caliberId:'101',caliberCode:'CMLL101',name:'Driver One'},{id:'22',caliberId:'102',caliberCode:'CMLL102',name:'Driver One'}];
const assets=Array.from({length:10},(_,i)=>({id:String(i+1),door:'V'+(i+1),site,category:'Vehicle',group:'Tipper',make:'Volvo',model:'FMX'}));
function card(id=1,shift=1,patch={},extra={}){
 const data={bookDate:date,location:site,assetId:1,employeeId:21,caliberId:'101',employeeName:'Driver One',shiftId:30+shift,shiftName:'Shift '+['A','B','C'][shift-1],bookShiftCode:'S'+shift,masterShiftStart:shifts[shift-1].startTime,door:'V1',openingHmr:100,closingHmr:108,openingKmr:1000,closingKmr:1100,totalTrips:5,trips:[],...patch};
 return {id,book_no:'CARD-'+id,book_type:'vehicle',book_date:data.bookDate,site:data.location,asset_id:data.assetId,data,batches:[{id:'b'+shift,name:'BATCH-S'+shift,closed_at:'2026-11-11'}],...extra};
}
const report=(records,extra={})=>buildManpowerReport({records,assets,employees,shifts,filters:{from:date,to:date},...extra});
test('unassigned zero-trip attendance counts once after VLB or ELB cards arrive',()=>{
 const entry={date,site:'sasti ob',shift:'S1',employee_id:21,asset_id:null,reason:'Rain',remarks:''};
 const attendance=[entry,{...entry,reason:'No work'}];
 const zero=report([],{attendance});
 assert.equal(zero.shiftAttendance.length,1);
 assert.equal(zero.shiftAttendance[0].status,'Present — 0 trips');
 assert.equal(zero.shiftAttendance[0].trips,0);
 assert.equal(zero.totals.savedRecords,0);
 const elb=card(3,1,{fleetTrips:5},{book_type:'equipment'});
 const both=report([card(),card(2,2),elb],{attendance});
 assert.equal(both.shiftAttendance.length,2);
 assert.equal(both.shiftAttendance[0].status,'Present — with trips');
 assert.equal(both.shiftAttendance[0].trips,5);
 assert.match(both.shiftAttendance[0].reason,/Rain/);
 assert.equal(report([elb],{attendance}).shiftAttendance[0].status,'Present — with trips');
});
test('ten Volvo vehicles count once each despite trip rows and repeated records',()=>{
 const records=assets.map((a,i)=>card(i+1,1,{assetId:a.id,door:a.door,employeeId:i%2?22:21,caliberId:i%2?'102':'101'}));
 const r=report([...records,records[0],card(100,1)]);
 assert.equal(r.summary[0].assets,10);assert.equal(r.summary[0].employees,2);assert.equal(r.totals.assets,10);assert.equal(r.totals.duties,2);assert.equal(r.exceptions.filter(e=>/Repeated|repeated/.test(e.reason)).length,2);
});
test('empty created batch supplies a selector, never fabricated assignments',()=>{
 const r=report([],{batches:[{id:'empty',name:'EMPTY BATCH',site,report_date:date}]});assert.equal(r.totals.assets,0);assert.equal(r.summary.length,0);assert.equal(r.options.batches[0].value,'empty');
});
test('Shift Performance steps (owner, 16 Nov 2026): each duty carries its site key and its machines\' equipment categories',()=>{
 const r=report([card(1,1),card(2,1,{assetId:2,door:'V2'})],{assets:[assets[0],{...assets[1],group:'WATER TANKER'}]});
 assert.equal(r.performance.length,1,'two vehicles in one shift stay one duty');
 assert.deepEqual([r.performance[0].siteKey,r.performance[0].categories],['sasti ob',['Tipper','Water Tanker']]);
 assert.ok(r.performance[0].employeeKey);
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
test('a case is placed once, on the date and shift of its first duty',()=>{
 const start=cards=>{const [e]=report(cards).ot;return [e.startDate,e.startShift];};
 assert.deepEqual(start([card(1,1),card(2,2)]),[date,'S1']);assert.deepEqual(start([card(1,2),card(2,3)]),[date,'S2']);
 assert.deepEqual(start([card(1,1),card(2,3)]),[date,'S1'],'Shift 1 and Shift 3 sit under Shift 1');
 assert.deepEqual(start([card(1,3),card(2,2),card(3,1)]),[date,'S1'],'all three shifts sit under Shift 1');
 assert.deepEqual(start([card(1,3),card(2,1,{bookDate:'2026-11-11'})]),[date,'S3'],'an overnight pair sits under Shift 3 of the first day');
 assert.deepEqual(start([card(1,3,{bookDate:'2026-11-09'}),card(2,1)]),['2026-11-09','S3'],'also when the first day is the day before the selected dates');
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
test('a card saved with only an Employee ID finds its master by the written forms of that ID, as the one-by-one check did',()=>{
 const only=(caliberId,list=employees)=>report([card(1,1,{employeeId:undefined,caliberId})],{employees:list});
 for(const written of ['101','CMLL101','CMLL-101','cmll 101'])assert.equal(only(written).details[0].employeeName,'Driver One',written);
 // CMPL101 is not a written form of 101 or CMLL101, so it stays unresolved.
 assert.match(only('CMPL101').exceptions[0].reason,/cannot be resolved/);
 // The same person in two masters: the first master record in order is used.
 assert.equal(only('101',[{id:'41',caliberId:'101',caliberCode:'CMLL101',name:'Driver One (ERP)'},...employees]).details[0].employeeName,'Driver One (ERP)');
 // Two different people answering to the same written ID: nobody is picked.
 const two=only('101',[...employees,{id:'42',caliberId:'7',idNo:'101',name:'Someone Else'}]);
 assert.match(two.exceptions[0].reason,/cannot be resolved/);assert.equal(two.performance.length,0);
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

// Every shift of both sites locked from 1 to 17 Nov; a test may reopen some (`open`: "site|date|S3" keys).
const lockedBatches=(open=[])=>Array.from({length:17},(_,i)=>'2026-11-'+String(i+1).padStart(2,'0')).flatMap(day=>[site,'Jayant OC'].flatMap(name=>['S1','S2','S3'].map(shift=>{
 const k=[name,day,shift].join('|');return {id:k,name:'BATCH '+k,site:name,report_date:day,shift,stage:open.includes(k)?'vlb_open':'closed',closed_at:open.includes(k)?null:day+'T23:00:00Z'};})));
// The card signature read of the stored locked days: count, id sum and revision sum per card site and date.
const signatureRows=(cards,[from,to,sites])=>{const out=new Map();for(const c of cards){if(c.book_date<from||c.book_date>to||sites&&!sites.includes(c.site))continue;const k=c.site+'|'+c.book_date,row=out.get(k)||{site:c.site,date:c.book_date,n:0,ids:0,revs:0};row.n++;row.ids+=Number(c.id);row.revs+=Number(c.revision||1);out.set(k,row);}return [...out.values()].map(r=>({...r,ids:String(r.ids),revs:String(r.revs)}));};
function apiHarness(scope={sites:['sasti ob']},cards=[card()],{batches=[]}={}){
 const handlers={};const calls=[];let released=false;const client={async query(sql,args){calls.push({sql,args});if(sql.startsWith('SELECT DISTINCT site'))return {rows:[{site},{site:'Jayant OC'}]};if(sql.includes('GROUP BY site,book_date'))return {rows:signatureRows(cards,args)};if(sql.includes('SELECT l.id')&&sql.includes('unnest('))return {rows:cards.filter(c=>args[0].some((name,i)=>name===c.site&&args[1][i]===c.book_date))};if(sql.includes('SELECT l.id'))return {rows:Array.isArray(args?.[3])?cards.map(c=>({...c,data:Object.fromEntries(Object.entries(c.data).filter(([k])=>args[3].includes(k)))})):cards};if(sql.includes('FROM mis_vlb_batches'))return {rows:typeof batches==='function'?batches():batches};if(sql.startsWith('SELECT id,master_name'))return {rows:[...assets.map(record_data=>({id:record_data.id,master_name:'Equipment master',record_data})),...employees.map(record_data=>({id:record_data.id,master_name:'Employee master',record_data})),...shifts.map(record_data=>({id:record_data.id,master_name:'Shift Master',record_data}))]};return {rows:[]};},release(){released=true;}};
 const protect=[()=>{},()=>{},()=>{}];registerManpowerReports({get(path,...steps){if(path==='/api/integrations/hr/attendance')assert.equal(steps.length,2);else assert.deepEqual(steps.slice(0,3),protect);handlers[path]=steps.at(-1);}},{pool:{connect:async()=>client},protect,ensureBooks:async()=>{},withHandovers:async(_,rows)=>rows,today:()=>'2026-11-12'});
 return {calls,async run(query={from:date,to:date},path='/api/reports/manpower'){let result,status=200;const headers={};await handlers[path]({query,logBookScope:scope},{set(k,v){headers[k]=v;return this;},status(s){status=s;return this;},json(value){result=value;}},e=>{throw e;});return {result,status,headers,released};}};
}
test('API uses scope, excludes deleted cards, and reads one private consistent snapshot',async()=>{
 const h=apiHarness(),r=await h.run();assert.equal(r.status,200);assert.equal(r.result.totals.assets,1);assert.equal(r.headers['Cache-Control'],'private, no-store');assert.equal(r.released,true);assert.match(h.calls[0].sql,/REPEATABLE READ READ ONLY/);const query=h.calls.find(c=>c.sql.includes('SELECT l.id'));assert.deepEqual(query.args[2],[site]);assert.match(query.sql,/l.deleted_at IS NULL/);assert.match(query.sql,/b.deleted_at IS NULL/);assert.ok(query.sql.includes("l.book_type IN ('vehicle','equipment','lmv')"),'LMV books are read for the OT view');assert.equal(h.calls.at(-1).sql,'COMMIT');assert.ok(!JSON.stringify(r.result).includes('record_data'));
});
test('attendance API reads slim card fields and returns the register duties of the full report',async()=>{
 const split=card(2,2,{operatorSplit:{secondOperatorId:22,secondOperatorCaliberId:'102'},trips:[{tripCount:3,loadingTime:'06:10',unloadingTime:'06:40'}]});
 const cards=[card(1,1),split],h=apiHarness({sites:null},cards,{batches:lockedBatches()}),r=await h.run({from:date,to:date,view:'attendance'},'/api/reports/manpower/attendance');
 assert.equal(r.status,200);assert.equal(r.released,true);assert.equal(r.headers['Cache-Control'],'private, no-store');
 const read=h.calls.find(c=>c.sql.includes('SELECT l.id'));
 assert.ok(read.sql.includes('FROM jsonb_each(l.data) AS field WHERE field.key=ANY($5::text[])'),'only the listed card fields are read');assert.doesNotMatch(read.sql,/mis_vlb_batch_entries/,'no batch list per card');
 for(const field of ['trips','operatorSplit','fleetTrips','employeeId','closingHmr'])assert.ok(read.args[4].includes(field),field);
 assert.equal(h.calls.find(c=>c.sql.includes('GROUP BY site,book_date')).args[2],null,'an all-sites login reads every site');assert.equal(h.calls.at(-1).sql,'COMMIT');
 const full=report(linkVlbTripHandovers(cards)),fields=Object.keys(r.result.otDuties[0]);
 assert.deepEqual(r.result.otDuties,full.otDuties.map(d=>Object.fromEntries(fields.map(k=>[k,d[k]]))));
 assert.equal(r.result.otDuties[1].trips,3,'trip count from the card rows');
 assert.ok(!('details' in r.result)&&!('performance' in r.result)&&!('fleetWork' in r.result),'tables of other views are not sent');
 assert.deepEqual(r.result.attendanceEquipment.map(p=>[p.employeeId,p.shift,p.actual]),[['102','S2',true]],'only the second operator, whom no duty line holds');
 assert.ok(Array.isArray(r.result.attendanceShifts)&&Array.isArray(r.result.otSites)&&Array.isArray(r.result.notes));
 assert.equal((await h.run({from:'bad',to:date},'/api/reports/manpower/attendance')).status,400);
});
test('attendance over a month is read a week at a time and joins to the same register as one build',async()=>{
 // 16 Nov 2026: Attendance Month-wise for every site from 1 to 16 Nov passed 50,000 cards in one read and stopped.
 const on=(id,day,shift,patch={})=>card(id,shift,{bookDate:day,...patch});
 const cards=[on(1,'2026-11-02',1),on(2,'2026-11-07',3),on(3,'2026-11-08',1),on(4,'2026-11-10',2),on(5,'2026-11-16',1,{employeeId:22,caliberId:'102'})];
 const range={from:'2026-11-01',to:'2026-11-16'},one=buildManpowerReport({records:linkVlbTripHandovers(cards),assets,employees,shifts,filters:manpowerFilters(range),parts:'attendance',batches:lockedBatches(),lockedOnly:true});
 assert.ok(one.ot.some(e=>e.dutyDates.includes('2026-11-07')&&e.dutyDates.includes('2026-11-08')),'the fixture has an OT case across the week edge');
 const h=apiHarness({sites:null},cards,{batches:lockedBatches()}),r=await h.run({...range,view:'attendance'},'/api/reports/manpower/attendance');
 assert.equal(r.status,200);assert.equal(r.released,true);
 // Only saved, locked days are read: each week's cards with its adjoining days (2, 7, 8 · 7, 8, 10 · 16).
 assert.deepEqual(h.calls.filter(c=>c.sql.includes('SELECT l.id')).map(c=>[c.args[2],c.args[3]]),[['2026-11-02','2026-11-08'],['2026-11-07','2026-11-10'],['2026-11-16','2026-11-16']],'three weeks, each with its adjoining days');
 assert.equal(h.calls.at(-1).sql,'COMMIT');
 const fields=Object.keys(r.result.otDuties[0]);
 assert.deepEqual(r.result.otDuties,one.otDuties.map(d=>Object.fromEntries(fields.map(k=>[k,d[k]]))));
 assert.deepEqual(r.result.attendanceShifts,one.attendanceShifts);assert.deepEqual(r.result.otSites,one.otSites);assert.deepEqual(r.result.attendanceSites,one.attendanceSites);
 assert.deepEqual(r.result.filters,manpowerFilters(range));
 const hr=await h.run(range,'/api/integrations/hr/attendance');
 assert.deepEqual(hr.result.ot,one.ot.map(e=>({site:e.site,siteKey:e.siteKey,employeeId:e.employeeId,schedule:e.schedule})),'an OT case across the week edge is sent once');
});
test('OT & Multiple Duties over a month is read a week at a time and matches one build of every saved card',async()=>{
 // 17 Nov 2026: dashboard Sr 5 OT & Multiple Duties for every site from 1 to 16 Nov passed 50,000 cards in one read and stopped.
 const on=(id,day,shift,patch={})=>card(id,shift,{bookDate:day,...patch});
 const cards=[on(1,'2026-11-02',1),on(2,'2026-11-07',3),on(3,'2026-11-08',1),on(4,'2026-11-10',2),on(5,'2026-11-16',1,{employeeId:22,caliberId:'102'})];
 // 8 Nov Shift 1 is still open: the OT view counts every saved card, as it did before.
 const range={from:'2026-11-01',to:'2026-11-16'},batches=lockedBatches([site+'|2026-11-08|S1']);
 const one=buildManpowerReport({records:linkVlbTripHandovers(cards),assets,employees,shifts,filters:manpowerFilters(range),batches});
 assert.ok(one.ot.some(e=>e.dutyDates.includes('2026-11-07')&&e.dutyDates.includes('2026-11-08')),'the fixture has an OT case across the week edge, into an open shift');
 const h=apiHarness({sites:null},cards,{batches}),r=await h.run({...range,site:'',shift:'',batch:'',employee:'',asset:'',view:'ot'});
 assert.equal(r.status,200);assert.equal(r.released,true);assert.equal(h.calls.at(-1).sql,'COMMIT');
 const reads=h.calls.filter(c=>c.sql.includes('SELECT l.id'));
 assert.deepEqual(reads.map(c=>[c.args[0],c.args[1]]),[['2026-11-01','2026-11-08'],['2026-11-07','2026-11-15'],['2026-11-14','2026-11-17']],'three weeks, each with its adjoining days');
 for(const c of reads){assert.match(c.sql,/mis_vlb_batch_entries/,'each card comes with its batches');assert.ok(!c.sql.includes("l.data-'manualAttachments'"),'only the duty fields are read');}
 assert.deepEqual(r.result.ot,one.ot,'an OT case across the week edge is listed once');
 assert.deepEqual(r.result.otDuties,one.otDuties);assert.deepEqual(r.result.otSites,one.otSites);assert.deepEqual(r.result.exceptions,one.exceptions);
 assert.deepEqual(r.result.options.employees,one.options.employees);assert.deepEqual(r.result.options.assets,one.options.assets);assert.deepEqual(r.result.options.sites,one.options.sites);
 assert.deepEqual(r.result.filters,manpowerFilters(range));
 const tooMany=apiHarness({sites:null},Array.from({length:50001},(_,i)=>on(i+1,'2026-11-02',1)),{batches});
 const stop=await tooMany.run({...range,view:'ot'});assert.equal(stop.status,400);assert.match(stop.result.error,/One week of saved cards is too large/);
});
test('Manpower by Category, Reconciliation, Shift Performance and Equipment Wise over a month are read a week at a time and match one build',async()=>{
 // 17 Nov 2026: the four other Manpower tabs read a month of every site in one go and stopped at 50,000 cards, as OT did.
 const on=(id,day,shift,patch={})=>card(id,shift,{bookDate:day,...patch});
 const cards=[on(1,'2026-11-02',1,{remark:'Tyre change'}),on(2,'2026-11-07',3),on(3,'2026-11-08',1),on(4,'2026-11-10',2),on(6,'2026-11-14',2,{trips:[]}),on(5,'2026-11-16',1,{employeeId:22,caliberId:'102'})];
 const range={from:'2026-11-01',to:'2026-11-16'},batches=lockedBatches([site+'|2026-11-08|S1']);
 const one=buildManpowerReport({records:linkVlbTripHandovers(cards),assets,employees,shifts,filters:manpowerFilters(range),batches});
 const byId=list=>[...list].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const views={category:['details','summary'],reconciliation:['fleet','fleetWork'],performance:['performance'],equipment:['attendanceEquipment','attendanceShifts']};
 for(const [view,tables] of Object.entries(views)){
  const h=apiHarness({sites:null},cards,{batches}),r=await h.run({...range,site:'',shift:'',batch:'',employee:'',asset:'',view});
  assert.equal(r.status,200,view+' '+JSON.stringify(r.result));assert.equal(r.released,true);assert.equal(h.calls.at(-1).sql,'COMMIT');
  const reads=h.calls.filter(c=>c.sql.includes('SELECT l.id'));
  assert.deepEqual(reads.map(c=>[c.args[0],c.args[1]]),[['2026-11-01','2026-11-08'],['2026-11-07','2026-11-15'],['2026-11-14','2026-11-17']],view+': three weeks, each with its adjoining days');
  for(const c of reads){assert.match(c.sql,/mis_vlb_batch_entries/);assert.ok(!c.sql.includes("l.data-'manualAttachments'"),view+': only the fields the report uses are read');}
  for(const table of tables)assert.deepEqual(r.result[table],one[table],view+' '+table+' as one build of every card');
  for(const table of ['details','summary','performance','fleet','fleetWork','attendanceEquipment','otDuties','ot','shiftAttendance'].filter(t=>!tables.includes(t)))assert.equal(r.result[table],undefined,view+' sends no '+table);
  assert.deepEqual(r.result.totals,one.totals,view+' totals');assert.deepEqual(byId(r.result.exceptions),byId(one.exceptions));assert.deepEqual(r.result.otSites,one.otSites);
  assert.deepEqual(r.result.options.employees,one.options.employees);assert.deepEqual(r.result.options.sites,one.options.sites);assert.deepEqual(r.result.notes,one.notes);
 }
 assert.ok(one.details.some(r=>/Tyre change/.test(r.remarks)),'a card remark still reaches Manpower by Category');
 assert.ok(one.details.length>=5&&one.performance.length>=5&&one.fleetWork.length>=5&&one.attendanceEquipment.length>=5,'the fixture fills every table');
 const tooMany=apiHarness({sites:null},Array.from({length:50001},(_,i)=>on(i+1,'2026-11-02',1)),{batches});
 const stop=await tooMany.run({...range,view:'category'});assert.equal(stop.status,400);assert.match(stop.result.error,/One week of saved cards is too large/);
});
test('locked days only (owner, 16 Nov 2026): an open, reopened or missing shift keeps the whole site-day out until it is locked again',async()=>{
 let open=['Sasti OC|2026-11-10|S3'],drop='';
 const h=apiHarness({sites:null},[card(1,1),card(2,2)],{batches:()=>lockedBatches(open).filter(b=>b.id!==drop)});
 const read=async()=>(await h.run({from:date,to:date,view:'attendance'},'/api/reports/manpower/attendance')).result;
 let r=await read();
 assert.deepEqual([r.otDuties.length,r.attendanceEquipment.length],[0,0],'Shift 3 open: nothing of the 10th counts, not even the locked Shift 1 and 2');
 assert.notEqual(r.attendanceShifts.find(s=>s.siteKey==='sasti ob'&&s.shift==='S3').state,'closed');
 const hr=(await h.run({from:date,to:date},'/api/integrations/hr/attendance')).result;
 assert.deepEqual(hr.otDuties,[],'HR gets no figure of an unlocked day');
 assert.deepEqual(hr.pendingDays.filter(d=>d.siteKey==='sasti ob').map(d=>[d.date,d.shifts.map(s=>s.shift)]),[[date,['S3']]],'and is told which day and shift are still open');
 open=[];r=await read();
 assert.equal(r.otDuties.length,2,'every shift locked: both duties count');
 open=['Sasti OC|2026-11-10|S1'];r=await read();
 assert.equal(r.otDuties.length,0,'Shift 1 reopened: the day is out again');
 open=[];r=await read();
 assert.equal(r.otDuties.length,2,'locked again: read again from the cards as they are now');
 drop='Sasti OC|2026-11-10|S2';r=await read();
 assert.equal(r.otDuties.length,0,'a shift the Shift Master runs that day but without any batch keeps the day out');
});
test('a locked day is a whole day: Shift 1-3 even where the Shift Master also lists Day and Night shift (live, 16 Nov 2026)',()=>{
 // Jayant and Dudhichua East list Day and Night shift beside Shift 1 to 3 but run only Shift 1 to 3; their days never locked.
 const both=[...shifts,{id:'40',site,shiftCode:'D',shiftName:'Day shift',startTime:'06:00',endTime:'18:00',status:'Active'},{id:'41',site,shiftCode:'N',shiftName:'Night shift',startTime:'18:00',endTime:'06:00',status:'Active'}];
 const b=(shift,closed=true)=>({id:shift,site,report_date:date,shift,closed_at:closed?date+'T23:00:00Z':null});
 const locked=list=>lockedSiteDays(both,list).has('sasti ob|'+date);
 assert.equal(locked([b('S1'),b('S2'),b('S3')]),true,'Shift 1, 2 and 3 locked: the whole day, Day and Night shift unused');
 assert.equal(locked([b('D'),b('N')]),true,'Day and Night shift locked: the whole day');
 assert.equal(locked([b('S1'),b('S2')]),false,'Shift 3 never created');
 assert.equal(locked([b('S1'),b('S2'),b('S3'),b('D',false)]),false,'any batch of the day still open');
 assert.equal(locked([b('S1'),b('S2'),b('S3',false)]),false);
 // A site whose Shift Master runs only two shifts that day: both locked is its whole day.
 const two=[{id:'50',site,shiftCode:'A',shiftName:'Shift A',startTime:'06:00',endTime:'14:00',status:'Active'},{id:'51',site,shiftCode:'B',shiftName:'Shift B',startTime:'14:00',endTime:'22:00',status:'Active'}];
 assert.equal(lockedSiteDays(two,[b('S1'),b('S2')]).has('sasti ob|'+date),true);
 // The report counts the day, and the HR pending list leaves it out although Day and Night shift have no batch.
 const r=buildManpowerReport({records:[card(1,1),card(2,2)],assets,employees,shifts:both,batches:[b('S1'),b('S2'),b('S3')].map(x=>({...x,name:x.id})),filters:manpowerFilters({from:date,to:date}),parts:'attendance',lockedOnly:true});
 assert.equal(r.otDuties.length,2);
 assert.ok(r.attendanceShifts.some(s=>s.shift==='D'&&s.state!=='closed'),'the unused Day shift still shows as a box without a batch');
 assert.deepEqual(pendingSiteDays(r.attendanceShifts,lockedSiteDays(both,[b('S1'),b('S2'),b('S3')])),[]);
});
test('the attendance API sends the locked site-days of the selected dates',async()=>{
 const h=apiHarness({sites:null},[card(1,1)],{batches:lockedBatches(['Sasti OC|2026-11-11|S2'])});
 const r=(await h.run({from:'2026-11-10',to:'2026-11-11',view:'attendance'},'/api/reports/manpower/attendance')).result;
 assert.deepEqual(r.lockedDays,['jayant ob|2026-11-10','jayant ob|2026-11-11','sasti ob|2026-11-10']);
});
test('attendance weeks cover the range without gaps',()=>{
 assert.deepEqual(attendanceWindows('2026-11-01','2026-11-30'),[{from:'2026-11-01',to:'2026-11-07'},{from:'2026-11-08',to:'2026-11-14'},{from:'2026-11-15',to:'2026-11-21'},{from:'2026-11-22',to:'2026-11-28'},{from:'2026-11-29',to:'2026-11-30'}]);
 assert.deepEqual(attendanceWindows(date,date),[{from:date,to:date}]);
});
test('attendance-only build skips the other tables and keeps the same duty lines',()=>{
 const cards=[card(1,1),card(2,2)],all=report(cards),slim=report(cards,{parts:'attendance'});
 assert.deepEqual(slim.otDuties,all.otDuties);assert.deepEqual(slim.attendanceEquipment,all.attendanceEquipment);assert.deepEqual(slim.attendanceShifts,all.attendanceShifts);assert.deepEqual(slim.otSites,all.otSites);
 assert.deepEqual([slim.details,slim.summary,slim.performance,slim.shiftAttendance,slim.fleet,slim.fleetWork,slim.options.employees],[[],[],[],[],[],[],[]]);
 assert.ok(all.details.length&&all.performance.length&&all.options.employees.length);
});
test('HR attendance receives saved sources and effective schedules without exposing card data',async()=>{
 const h=apiHarness(undefined,[card(1,1,{scanCardId:'scan-one'}),card(2,2,{}, {site:'Jayant OC'})],{batches:lockedBatches()});
 const {result,status}=await h.run({from:date,to:date},'/api/integrations/hr/attendance');
 assert.equal(status,200);
 assert.equal(result.otDuties.length,1);
 assert.deepEqual(result.otDuties[0].logBooks,['VLB']);
 assert.equal(result.details[0].batchStatus,'Saved scan');
 assert.ok(result.performance[0].start);
 assert.ok(result.attendanceShifts.find(shift=>shift.shift==='S1').end);
 assert.ok(!('fleet' in result));
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
test('flagged duties carry the driver category and every known site gets a count',()=>{
 const staff=[{...employees[0],currentDesignationName:'Volvo Driver'},employees[1]];
 const r=report([card(1,1),card(2,2),card(3,1,{employeeId:22,caliberId:'102',assetId:2,door:'V2'}),card(4,3,{employeeId:22,caliberId:'102',assetId:2,door:'V2'})],{employees:staff,shifts:[...shifts,{id:'50',site:'Jayant OC',shiftCode:'A',startTime:'05:00',endTime:'13:00'}]});
 assert.deepEqual(r.ot.map(e=>[e.severity,e.category]),[['red','Volvo Driver'],['orange','Category not in Employee master']]);
 assert.equal(r.ot[0].equipment,'Tipper / Volvo');assert.equal(r.ot[0].siteKey,'sasti ob');assert.deepEqual(r.ot[0].dutyDates,[date]);
 const none={red:0,orange:0,review:0};
 assert.deepEqual(r.otSites,[{site:'Jayant OC',siteKey:'jayant ob',...none,books:{VLB:none,ELB:none,LMV:none}},{site,siteKey:'sasti ob',red:1,orange:1,review:0,books:{VLB:{red:1,orange:1,review:0},ELB:none,LMV:none}}]);
 assert.deepEqual(r.ot.map(e=>[e.logBook,e.logBooks]),[['VLB',['VLB']],['VLB',['VLB']]]);
});
test('LMV log books count in OT, under each log book the duty was saved in, and nowhere else',()=>{
 const lmv=card(2,2,{assetId:2,door:'V2'},{book_type:'lmv'}),elb=card(3,3,{assetId:3,door:'V3'},{book_type:'equipment'});
 assert.equal(report([card(1,1)]).ot.length,0,'one VLB shift alone is not OT');
 const r=report([card(1,1),lmv]);
 assert.deepEqual(r.ot.map(e=>[e.severity,e.logBook,e.logBooks]),[['red','VLB + LMV',['VLB','LMV']]],'an LMV shift after a VLB shift is back-to-back OT');
 const none={red:0,orange:0,review:0},one={red:1,orange:0,review:0};
 assert.deepEqual(r.otSites,[{site,siteKey:'sasti ob',...one,books:{VLB:one,ELB:none,LMV:one}}],'the duty is listed under both log books and once in the site total');
 assert.deepEqual([r.details.length,r.summary.length,r.performance.length,r.shiftAttendance.length,r.totals.savedRecords,r.totals.duties],[1,1,1,1,1,1],'the other manpower tables stay VLB and ELB only');
 assert.ok(r.details.every(d=>d.book==='CARD-1'));
 const all=report([card(1,1),lmv,elb]);
 assert.deepEqual(all.ot.map(e=>e.logBook),['VLB + ELB + LMV']);assert.deepEqual(all.otSites[0].books,{VLB:one,ELB:one,LMV:one});
 const review=report([card(1,1),{...lmv,asset_id:999,data:{...lmv.data,assetId:999}}]);
 assert.deepEqual(review.exceptions.map(e=>[e.logBook,e.reason]),[['LMV','Equipment master match is missing.']]);assert.equal(review.totals.exceptions,0,'LMV review items are not counted on the VLB and ELB views');
 const blank=report([card(1,1),{...lmv,data:{...lmv.data,openingHmr:null,closingHmr:null}}]);
 assert.deepEqual([blank.ot.map(e=>e.severity),blank.exceptions.length,blank.ot[0].combinedHours],[['red'],0,null],'an LMV card saved without HMR still counts as a duty and is not a review item');
 assert.match(report([card(1,1),{...lmv,data:{...lmv.data,openingHmr:200,closingHmr:150}}]).exceptions[0].reason,/Invalid or excessive HMR/);
});
test('earlier repeats look back at most 90 days, never before the first day of records',()=>{
 assert.deepEqual(otHistoryWindows('2026-11-01'),[]);
 assert.deepEqual(otHistoryWindows('2026-11-10'),[{from:'2026-11-01',to:'2026-11-07'},{from:'2026-11-08',to:'2026-11-09'}]);
 const far=otHistoryWindows('2027-06-01');assert.equal(far[0].from,'2027-03-03');assert.equal(far.at(-1).to,'2027-05-31');assert.equal(far.length,13);
});
test('earlier repeats count each event once and leave out events inside the selected dates',()=>{
 const event=(id,severity,...dutyDates)=>({id,severity,employeeKey:'E1',siteKey:'sasti ob',dutyDates});
 const drivers=otHistorySummary([event('a','red','2026-11-03'),event('a','red','2026-11-03'),event('b','orange','2026-11-05'),event('c','red','2026-11-09','2026-11-10'),{...event('d','red','2026-11-04'),employeeKey:'E2'}],'2026-11-10');
 assert.deepEqual(drivers,[{employeeKey:'E1',siteKey:'sasti ob',red:1,orange:1,review:0,redDates:['2026-11-03'],orangeDates:['2026-11-05']},{employeeKey:'E2',siteKey:'sasti ob',red:1,orange:0,review:0,redDates:['2026-11-04'],orangeDates:[]}]);
});
test('month and year OT counts cover the calendar month and year of the To date, never before records or after today',()=>{
 assert.deepEqual(otYearWindows('2026-11-09','2026-11-09'),{year:'2026',month:'2026-11',yearFrom:'2026-11-01',yearTo:'2026-11-09',monthFrom:'2026-11-01',monthTo:'2026-11-09',windows:[{from:'2026-11-01',to:'2026-11-09'}]});
 const mid=otYearWindows('2027-03-15','2027-06-20');assert.deepEqual([mid.yearFrom,mid.yearTo,mid.monthFrom,mid.monthTo],['2027-01-01','2027-06-20','2027-03-01','2027-03-31']);
 assert.deepEqual(mid.windows.map(w=>w.from+'/'+w.to),['2027-01-01/2027-01-31','2027-02-01/2027-02-28','2027-03-01/2027-03-31','2027-04-01/2027-04-30','2027-05-01/2027-05-31','2027-06-01/2027-06-20']);
 assert.equal(otYearWindows('2027-12-31','2027-12-31').windows.length,12);assert.ok(otYearWindows('2028-02-29','2028-12-31').windows.some(w=>w.to==='2028-02-29'));
 assert.equal(otYearWindows('bad','2026-11-09'),null);assert.deepEqual(otYearWindows('2028-01-10','2027-12-20').windows,[],'a year that has not started has nothing to read');
 for(const w of mid.windows)assert.doesNotThrow(()=>manpowerFilters(w),'every month fits one report read');
});
test('driver OT counts take each event once, by the day of its first duty',()=>{
 const event=(id,severity,...dutyDates)=>({id,severity,reason:severity,employeeKey:'E1',siteKey:'sasti ob',dutyDates,dates:dutyDates.join('; '),shifts:'',logBook:'VLB',equipment:'',combinedHours:null,books:''});
 const range={yearFrom:'2026-11-01',yearTo:'2026-12-31',monthFrom:'2026-12-01',monthTo:'2026-12-31'};
 const drivers=otDriverTally([event('a','red','2026-11-03'),event('a','red','2026-11-03'),event('b','orange','2026-11-30','2026-12-01'),event('c','red','2026-12-05'),event('d','review','2026-12-09'),event('e','red','2027-01-01'),{...event('f','red','2026-12-02'),employeeKey:'E2'}],range);
 assert.deepEqual(drivers.map(d=>[d.employeeKey,d.month,d.year]),[['E1',{red:1,orange:0,review:1,total:2},{red:2,orange:1,review:1,total:4}],['E2',{red:1,orange:0,review:0,total:1},{red:1,orange:0,review:0,total:1}]]);
 assert.deepEqual(drivers[0].events.map(e=>e.date),['2026-12-09','2026-12-05','2026-11-30','2026-11-03'],'newest first; the overnight pair stays in the month it started; next year is left out');
});
test('driver OT API reads one site a month at a time within scope and without a long transaction',async()=>{
 const h=apiHarness({sites:['sasti ob']},[card(1,1),card(2,2),card(3,1,{bookDate:'2026-11-04'}),card(4,2,{bookDate:'2026-11-04'})]),path='/api/reports/manpower/ot-drivers';
 const r=await h.run({site,to:'2026-11-06'},path);assert.equal(r.status,200);assert.equal(r.released,true);assert.equal(r.headers['Cache-Control'],'private, no-store');
 assert.deepEqual([r.result.year,r.result.month,r.result.yearFrom,r.result.yearTo,r.result.monthFrom,r.result.monthTo],['2026','2026-11','2026-11-01','2026-11-12','2026-11-01','2026-11-12'],'the fixture clock says 12 November');
 const reads=h.calls.filter(c=>c.sql.includes('SELECT l.id'));assert.equal(reads.length,1,'November is the only month of records so far');assert.deepEqual(reads[0].args[2],[site]);assert.ok(reads[0].sql.includes("l.book_type IN ('vehicle','equipment','lmv')"));
 assert.ok(!h.calls.some(c=>/BEGIN|COMMIT/.test(c.sql)),'counts are read without holding a transaction open');
 assert.equal(r.result.drivers.length,1);const [driver]=r.result.drivers;assert.deepEqual([driver.month,driver.year],[{red:2,orange:0,review:0,total:2},{red:2,orange:0,review:0,total:2}]);
 assert.deepEqual(driver.events.map(e=>[e.date,e.severity,e.logBook]),[[date,'red','VLB'],['2026-11-04','red','VLB']]);assert.ok(!JSON.stringify(r.result).includes('record_data'));
 assert.equal((await h.run({site:'Jayant OC',to:date},path)).status,403);assert.equal((await h.run({to:date},path)).status,400,'a site is required');assert.equal((await h.run({site,to:'bad'},path)).status,400);
});
test('history API reads only earlier dates within scope and returns one repeat per event',async()=>{
 const h=apiHarness({sites:['sasti ob']},[card(1,1),card(2,2)]),path='/api/reports/manpower/ot-history';
 const r=await h.run({from:'2026-11-12',to:'2026-11-12'},path);assert.equal(r.status,200);assert.equal(r.released,true);
 assert.equal(r.result.historyFrom,'2026-11-01');assert.equal(r.result.historyTo,'2026-11-11');
 assert.deepEqual(r.result.drivers.map(d=>[d.red,d.orange,d.redDates]),[[1,0,[date]]]);
 const reads=h.calls.filter(c=>c.sql.includes('SELECT l.id'));assert.equal(reads.length,2);assert.deepEqual(reads[0].args.slice(0,3),['2026-11-01','2026-11-08',[site]]);assert.ok(reads.every(c=>c.args[3].includes('employeeId')&&!c.args[3].includes('trips')));
 assert.ok(reads.every(c=>c.sql.includes("l.book_type IN ('vehicle','equipment','lmv')")&&c.sql.includes('l.deleted_at IS NULL')),'earlier duties read the same three log books as the OT list');
 const first=await h.run({from:'2026-11-01',to:'2026-11-01'},path);assert.equal(first.result.historyFrom,null);assert.deepEqual(first.result.drivers,[]);
 assert.equal((await h.run({from:date,to:date,site:'Jayant OC'},path)).status,403);
});

// Shift Attendance Equipment Wise
const crew=[...employees,...[23,24,25,26,27].map(n=>({id:String(n),caliberId:String(80+n),caliberCode:'CMLL'+(80+n),name:'Driver '+n}))];
const fleet=[...assets,{id:'50',door:'G13',site,category:'Equipment',group:'GRADERS',make:'CASE',model:'865C'},{id:'51',door:'WT1',site,category:'Vehicle',group:'Water Tanker',make:'EICHER',model:'PRO'},{id:'52',door:'WT2',site,category:'Vehicle',group:'WATER  TANKER',make:'61',model:'PRO'},{id:'53',door:'X9',site,category:'Vehicle',make:'TATA',model:'LPK'}];
const by=(n,patch={})=>({employeeId:n,caliberId:String(80+n),employeeName:'Driver '+n,...patch});
const equipmentWise=(records,extra={})=>buildManpowerReport({records,assets:fleet,employees:crew,shifts,filters:{from:date,to:date},...extra});
test('equipment-wise duties count a driver on each equipment group, actual duties once',()=>{
 const tipper=card(1,1,{closingHmr:102}),grader=card(2,1,{assetId:50,door:'G13',openingHmr:200,closingHmr:205},{book_type:'equipment'});
 const r=equipmentWise([tipper,grader]),rows=r.attendanceEquipment;
 assert.deepEqual(rows.map(x=>[x.equipment,x.doors,x.actual,x.actualLabel]),[['Graders','G13',true,'Yes'],['Tipper','V1',false,'No — second machine']],'the machine with more HMR hours carries the actual duty');
 assert.equal(rows.filter(x=>x.actual).length,r.shiftAttendance.length,'actual duties equal one per driver, date and shift');
 assert.match(rows[0].note,/Also worked on V1 \(Tipper\)/);assert.match(rows[1].note,/Second machine in this shift; actual duty counted on G13 \(Graders\)/);
 assert.equal(rows[0].makeModel,'CASE 865C');assert.equal(rows[1].trips,5);assert.equal(rows[0].trips,null);
 const tie=equipmentWise([card(1,1,{closingHmr:105}),card(2,1,{assetId:50,door:'G13',openingHmr:200,closingHmr:205},{book_type:'equipment'})]).attendanceEquipment;
 assert.deepEqual(tie.filter(x=>x.actual).map(x=>x.equipment),['Tipper'],'equal hours: the card saved first carries the actual duty');
 const same=equipmentWise([card(1,1,{closingHmr:103}),card(2,1,{assetId:2,door:'V2',openingHmr:300,closingHmr:304})]).attendanceEquipment;
 assert.equal(same.length,1,'two machines of one group in a shift are one equipment-wise duty');assert.equal(same[0].doors,'V1; V2');
});
test('equipment names follow the master group, merge spelling differences and report a missing group',()=>{
 const rows=equipmentWise([card(1,1,{assetId:51,door:'WT1'}),card(2,2,{assetId:52,door:'WT2',...by(23)}),card(3,3,{assetId:53,door:'X9',...by(24)})]).attendanceEquipment;
 assert.deepEqual(rows.map(x=>x.equipment).sort(),['Group missing in master','Water Tanker','Water Tanker']);
 assert.equal(rows.find(x=>x.doors==='WT2').makeModel,'Make not named PRO');
});
test('rows are red, orange, brown for review, blue for zero trips, in that order of priority',()=>{
 const attendance=[{date,site:'sasti ob',shift:'S1',employee_id:25,asset_id:3,reason:'Rain',remarks:'Road closed'},{date,site:'sasti ob',shift:'S2',employee_id:26,asset_id:null,reason:'No work',remarks:''}];
 const records=[card(1,1),card(2,2),
  card(3,1,{assetId:2,door:'V2',...by(22,{caliberId:'102',employeeName:'Driver One'})}),card(4,3,{assetId:2,door:'V2',...by(22,{caliberId:'102',employeeName:'Driver One'})}),
  card(5,1,{assetId:4,door:'V4',masterShiftStart:'06:00',...by(23)}),card(6,2,{assetId:4,door:'V4',...by(23)}),
  card(7,1,{assetId:5,door:'V5',totalTrips:0,...by(24)}),
  card(8,3,{assetId:50,door:'G13',openingHmr:200,closingHmr:205,...by(27)},{book_type:'equipment'}),
  card(9,2,{assetId:6,door:'V6',totalTrips:0,...by(27)})];
 const r=equipmentWise(records,{attendance}),rows=r.attendanceEquipment,of=(name,shift)=>rows.find(x=>x.employeeName===name&&x.shift===shift&&(x.caliberCode!=='CMLL102'));
 const one=rows.filter(x=>x.caliberCode==='CMLL101'),two=rows.filter(x=>x.caliberCode==='CMLL102');
 assert.deepEqual(one.map(x=>[x.shift,x.flag,x.note]),[['S1','red','Also worked S2'],['S2','red','Also worked S1']]);assert.match(one[0].flagLabel,/^RED — Back-to-back/);
 assert.deepEqual(two.map(x=>[x.shift,x.flag]),[['S1','orange'],['S3','orange']]);assert.match(two[0].flagLabel,/^ORANGE/);
 assert.deepEqual([of('Driver 23','S1').flag,of('Driver 23','S2').flag],['review','review']);assert.match(of('Driver 23','S1').flagLabel,/^REVIEW/);
 const zeroCard=of('Driver 24','S1');assert.deepEqual([zeroCard.flag,zeroCard.status,zeroCard.flagLabel],['zero','Present — 0 trips','BLUE — Present with 0 trips']);
 const marked=of('Driver 25','S1');assert.deepEqual([marked.flag,marked.equipment,marked.doors,marked.reason,marked.remarks,marked.trips,marked.actual],['zero','Tipper','V3','Rain','Road closed',0,true]);
 const unassigned=of('Driver 26','S2');assert.deepEqual([unassigned.flag,unassigned.equipment,unassigned.makeModel],['zero','No equipment assigned','']);
 const operator=of('Driver 27','S3'),zeroThenWork=of('Driver 27','S2');
 assert.equal(operator.status,'Present','an equipment operator with a saved card is measured in hours');
 assert.deepEqual([zeroThenWork.flag,zeroThenWork.status],['red','Present — 0 trips'],'red wins over blue; the attendance column still says 0 trips');assert.equal(operator.flag,'red');
 assert.equal(rows.filter(x=>x.flag==='normal').length,0);
});
test('a zero-trip entry beside a saved card adds its reason, not a second machine; every assigned site is listed',()=>{
 const attendance=[{date,site:'sasti ob',shift:'S1',employee_id:21,asset_id:50,reason:'Breakdown',remarks:''}];
 const r=equipmentWise([card()],{attendance,shifts:[...shifts,{id:'40',site:'Jayant OC',shiftCode:'A',shiftName:'Shift A',startTime:'05:00',endTime:'13:00',status:'Active'}]}),rows=r.attendanceEquipment;
 assert.deepEqual(rows.map(x=>[x.equipment,x.actual,x.reason,x.flag,x.note,x.site,x.siteKey]),[['Tipper',true,'Breakdown','normal','','Sasti OC','sasti ob']]);
 assert.deepEqual(r.attendanceSites,[{siteKey:'jayant ob',site:'Jayant OC'},{siteKey:'sasti ob',site:'Sasti OC'}]);
 assert.ok(r.notes.some(note=>/^Shift Attendance Equipment Wise:/.test(note)));
});

// Batches behind each shift, site names and the driver history (10 Nov 2026)
test('each site, date and shift reports its batch: missing once the shift has ended, open, or closed',()=>{
 const at=clock=>Date.parse(clock+'+05:30'),batch=(shift,patch={})=>({id:'b'+shift,name:'BATCH-'+shift,site:'sasti ob',report_date:date,shift,closed_at:null,stage:'vlb_open',...patch});
 const states=(batches,now,filters={from:date,to:date})=>buildManpowerReport({records:[],assets,employees,shifts,batches,filters,now}).attendanceShifts.map(b=>[b.date,b.shift,b.state,b.batch]);
 // 10 Nov, 14:00: Shift 1 (05:00 to 13:00) has ended, Shift 2 is running, Shift 3 has not started.
 assert.deepEqual(states([],at('2026-11-10T14:00:00')),[[date,'S1','none',''],[date,'S2','not_due',''],[date,'S3','not_due','']],'the running shift is not reported as missing');
 assert.deepEqual(states([],at('2026-11-11T05:00:00')).map(b=>b[2]),['none','none','none'],'Shift 3 is due when it ends at 05:00 the next morning');
 assert.deepEqual(states([batch('S1',{closed_at:'2026-11-10T15:00:00Z',stage:'closed'}),batch('S2',{stage:'elb_open'}),batch('S3')],at('2026-11-11T09:00:00')),
  [[date,'S1','closed','BATCH-S1'],[date,'S2','elb_open','BATCH-S2'],[date,'S3','vlb_open','BATCH-S3']]);
 assert.deepEqual(states([batch('S1',{stage:'lmv_open'})],at('2026-11-10T14:00:00'))[0],[date,'S1','lmv_open','BATCH-S1'],'the LMV stage between VLB and ELB is reported as it is');
 assert.deepEqual(states([batch('S2',{closed_at:'2026-11-10T22:00:00Z'}),batch('S2',{id:'again',name:'BATCH-S2-2'})],at('2026-11-10T14:00:00'))[1],[date,'S2','vlb_open','BATCH-S2-2'],'a reopened or second batch keeps the shift open');
 assert.deepEqual(states([],at('2026-11-12T09:00:00'),{from:date,to:'2026-11-11',shift:'S2'}).map(b=>b.slice(0,3)),[[date,'S2','none'],['2026-11-11','S2','none']],'one row per day; the Shift selection narrows the shifts');
 // A site lists the shifts its Shift Master holds; a site without any is expected to run Shift 1 to 3, due after the day ends.
 const twoShift=shifts.slice(0,2),bare=buildManpowerReport({records:[],assets,employees,shifts:twoShift,batches:[{id:'x',name:'OTHER',site:'Majri OC',report_date:date,shift:'S1',closed_at:null,stage:'vlb_open'}],filters:{from:date,to:date},now:at('2026-11-10T23:00:00')});
 assert.deepEqual(bare.attendanceShifts.map(b=>[b.siteKey,b.shift,b.state]),[['majri ob','S1','vlb_open'],['majri ob','S2','not_due'],['majri ob','S3','not_due'],['sasti ob','S1','none'],['sasti ob','S2','none']]);
});
test('a site is shown under one properly written name, never its stored lower-case key',()=>{
 const attendance=[{date,site:'sasti ob',shift:'S3',employee_id:22,asset_id:2,reason:'Rain',remarks:''}];
 const lower=card(1,1,{},{site:'sasti ob'}),second=card(2,2,{location:'sasti ob'},{site:'sasti ob'});
 const r=buildManpowerReport({records:[lower,second,card(3,1,{location:'gauri pauni ob 2nd',assetId:99},{site:'gauri pauni ob 2nd'})],attendance,assets,employees,shifts,batches:[{id:'b',name:'B',site:'sasti ob',report_date:date,shift:'S1',closed_at:null,stage:'vlb_open'}],filters:{from:date,to:date}});
 assert.deepEqual(r.attendanceSites,[{siteKey:'gauri pauni ob 2nd',site:'gauri pauni ob 2nd'},{siteKey:'sasti ob',site:'Sasti OC'}],'the Shift Master spelling wins; a site known only by its key keeps it');
 assert.deepEqual(r.otSites.map(s=>s.site),['gauri pauni ob 2nd','Sasti OC']);
 assert.deepEqual(r.options.sites,['Sasti OC','gauri pauni ob 2nd'],'the Site selector lists each site once');
 assert.deepEqual([...new Set(r.details.map(d=>d.site))].sort(),['Sasti OC','gauri pauni ob 2nd']);assert.deepEqual(r.ot.map(e=>[e.severity,e.site]),[['red','Sasti OC']]);
 assert.deepEqual([...new Set(r.exceptions.map(e=>e.site))],['gauri pauni ob 2nd']);
 assert.deepEqual([...new Set(r.attendanceEquipment.map(x=>x.site))].sort(),['Sasti OC','gauri pauni ob 2nd']);
});
test('driver history counts actual duties month by month for every driver, beside the OT counts',()=>{
 const range={yearFrom:'2026-11-01',yearTo:'2026-12-31',monthFrom:'2026-12-01',monthTo:'2026-12-31'};
 const event=(id,dutyDate,severity)=>({id,employeeKey:'A',siteKey:'sasti ob',dutyDates:[dutyDate],dates:dutyDate,severity,reason:severity,shifts:'',logBook:'VLB',equipment:'',combinedHours:15,books:''});
 const duty=(employeeKey,day)=>({employeeKey,siteKey:'sasti ob',date:day});
 const tally=otDriverTally([event('1','2026-11-05','red'),event('2','2026-12-02','orange')],range,[duty('A','2026-11-05'),duty('A','2026-11-06'),duty('A','2026-12-02'),duty('B','2026-12-03'),duty('B','2026-10-30')]);
 assert.deepEqual(tally.map(d=>[d.employeeKey,d.duties,d.year.total,d.month.total,d.events.length]),[['A',{'2026-11':2,'2026-12':1},2,1,2],['B',{'2026-12':1},0,0,0]],'a driver with duties and no OT is listed; duties outside the year are left out');
 assert.deepEqual(otDriverTally([event('1','2026-11-05','red')],range).map(d=>d.duties),[{}]);
 // The attendance rows carry the driver key that joins them to this history.
 const rows=report([card(1,1),card(2,2)]).attendanceEquipment;assert.deepEqual(rows.map(x=>x.employeeKey),[rows[0].employeeKey,rows[0].employeeKey]);assert.ok(rows[0].employeeKey);
});
test('OT duty lines list every duty with the colour of its case, its equipment category and the other shift worked',()=>{
 const other={...assets[1],group:'water tanker'};
 const r=buildManpowerReport({records:[card(1,1),card(2,2),card(3,1,{assetId:2,door:'V2',employeeId:22,caliberId:'102'})],assets:[assets[0],other],employees:[employees[0],{...employees[1],name:'Driver Two',designation:'Tanker Driver'}],shifts,filters:{from:date,to:date}});
 assert.deepEqual(r.otDuties.map(d=>[d.employeeName,d.shift,d.flag,d.equipment,d.others,d.category,d.logBook,d.doors]),[
  ['Driver One','S1','red','Tipper','Also worked S2','Category not in Employee master','VLB','V1'],
  ['Driver Two','S1','normal','Water Tanker','','Tanker Driver','VLB','V2'],
  ['Driver One','S2','red','Tipper','Also worked S1','Category not in Employee master','VLB','V1']]);
 assert.match(r.otDuties[0].flagLabel,/^RED/);assert.equal(r.otDuties[1].flagLabel,'Normal duty');
 assert.equal(r.ot.length,1,'two red duties are one case');
 assert.deepEqual(report([card(1,1),card(2,2)],{filters:{from:date,to:date,shift:'S2'}}).otDuties.map(d=>d.shift),['S2'],'the Shift selection keeps only matching duties');
 const lmv=card(4,3,{employeeId:22,caliberId:'102',assetId:2,door:'V2'},{book_type:'lmv'});
 assert.deepEqual(buildManpowerReport({records:[lmv],assets,employees,shifts,filters:{from:date,to:date}}).otDuties.map(d=>[d.logBook,d.flag]),[['LMV','normal']],'LMV duties are part of the OT duty count');
});
test('assignment and summary rows carry the keys the Manpower by Category steps count with',()=>{
 const flawed=card(3,3,{},{site:'Jayant OC'});
 const r=report([card(1,1),card(2,2,{assetId:2,door:'V2'}),flawed]);
 assert.deepEqual(r.details.map(d=>[d.siteKey,d.equipment,d.assetKey,d.employeeKey,Boolean(d.dutyKey)]),[['sasti ob','Tipper','sasti ob|V1','CMLL101',true],['sasti ob','Tipper','sasti ob|V2','CMLL101',true],['jayant ob','Tipper','','',false]],'a card left out of totals carries no key');
 assert.equal(new Set(r.details.map(d=>d.assetKey).filter(Boolean)).size,r.totals.assets);
 assert.equal(new Set(r.details.map(d=>d.employeeKey).filter(Boolean)).size,r.totals.employees);
 assert.equal(new Set(r.details.map(d=>d.dutyKey).filter(Boolean)).size,r.totals.duties);
 assert.deepEqual(r.summary.map(s=>[s.siteKey,s.equipment]),[['sasti ob','Tipper'],['sasti ob','Tipper']]);
});
test('reconciliation lists the site fleet from the Equipment master and what each machine did per shift',()=>{
 const fleetAssets=[...assets.slice(0,4).map((a,i)=>({...a,currentLocation:site,chassisNo:'CH'+i})),{...assets[4],currentLocation:'Jayant OC',chassisNo:'CH9'}];
 const records=[card(1,1),card(2,1,{assetId:2,door:'V2',totalTrips:0,closingKmr:1000}),card(3,2,{assetId:5,door:'V5'}),card(4,1,{assetId:3,door:'V3',totalTrips:0})];
 const r=buildManpowerReport({records,assets:fleetAssets,employees,shifts,filters:{from:date,to:date}});
 assert.deepEqual(r.fleet.map(m=>[m.siteKey,m.door,m.equipment]),[['sasti ob','V1','Tipper'],['sasti ob','V2','Tipper'],['sasti ob','V3','Tipper'],['sasti ob','V4','Tipper']],'machines the master places at another site are not in this site’s fleet');
 const work=Object.fromEntries(r.fleetWork.map(w=>[w.door+w.shift,[w.inFleet,w.active,w.zeroKm,w.trips,w.km]]));
 assert.deepEqual(work,{V1S1:[true,true,false,5,100],V2S1:[true,false,true,0,0],V3S1:[true,false,false,0,100],V5S2:[false,true,false,5,100]},'a zero-trip card is not active; zero km is marked apart; a card of a machine now at another site is outside the fleet list');
 assert.ok(r.fleetWork.every(w=>w.siteKey==='sasti ob'&&w.logBook==='VLB'));
});
