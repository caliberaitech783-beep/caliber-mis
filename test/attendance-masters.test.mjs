// VTC Master and OD Master (owner, 28 Nov 2026): every driver or operator on VTC or OD in the month, and every day of
// it that has arrived present in the attendance muster (VTC purple P, OD teal).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {registerAttendanceMasters} from '../server/routes/attendance-masters.mjs';
import {buildManpowerReport} from '../server/rules/manpower-report.mjs';
import {buildAttendanceRegister} from '../src/attendance-register-model.mjs';
import {cardAttendances} from '../shared/trip-card-attendance.mjs';
import {vlbZeroTripEntries} from '../shared/vlb-zero-trip-entries.mjs';
import {misPageAllowed,misRequestAllowed} from '../shared/mis-application-access.mjs';
import {checkMasterEntry,arrivedDays,monthView,masterStatus,siteSummary,masterRemarks} from '../shared/attendance-masters.mjs';
import {OD_REASON,OD_STATUS,OD_FLAG,OD_FLAG_LABEL,VTC_TRAINING_REASON,TRAINING_FLAG,TRAINING_SHIFT} from '../shared/vtc-training.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const vtcBody={fromDate:'2026-11-24',toDate:'2026-12-05',course:'Refresher',institute:'WCL VTC Majri',status:'Ongoing'};
const odBody={fromDate:'2026-11-20',toDate:'2026-11-21',odType:'Medical exam (PME)',place:'Nagpur',reason:'Periodic medical exam'};

test('a record is checked: dates, course or OD type, place, and what can be Completed',()=>{
 const today='2026-11-28';
 assert.equal(checkMasterEntry('vtc',vtcBody,{today}).from,'2026-11-24');
 assert.match(checkMasterEntry('vtc',{...vtcBody,course:''},{today}).error,/course/);
 assert.match(checkMasterEntry('vtc',{...vtcBody,institute:' '},{today}).error,/institute/);
 assert.match(checkMasterEntry('vtc',{...vtcBody,status:'Completed'},{today}).error,/Ongoing/,'a course still running is not Completed');
 assert.match(checkMasterEntry('vtc',{...vtcBody,fromDate:'2026-10-31'},{today}).error,/1 November/);
 assert.match(checkMasterEntry('vtc',{...vtcBody,toDate:'2027-02-01'},{today}).error,/60 days ahead/);
 assert.match(checkMasterEntry('od',{...odBody,reason:''},{today}).error,/reason/);
 assert.match(checkMasterEntry('od',{...odBody,dayPart:'Half day (first half)'},{today}).error,/one day/);
 assert.match(checkMasterEntry('od',{...odBody,fromDate:'2026-11-01',toDate:'2026-12-05'},{today}).error,/31 days/);
 assert.match(checkMasterEntry('xx',{},{today}).error,/VTC or OD/);
 // Days that count: From to the earlier of To and today.
 assert.deepEqual(arrivedDays({from:'2026-11-26',to:'2026-12-05'},'2026-11-28'),['2026-11-26','2026-11-27','2026-11-28']);
 assert.deepEqual(arrivedDays({from:'2026-12-01',to:'2026-12-05'},'2026-11-28'),[]);
 assert.deepEqual(monthView({from:'2026-11-24',to:'2026-12-05'},'2026-11','2026-11-28'),{days:['2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-28','2026-11-29','2026-11-30'],present:5,coming:2});
 assert.equal(monthView({from:'2026-11-24',to:'2026-12-05'},'2026-12','2026-11-28').present,0);
 assert.equal(masterStatus({kind:'vtc',from:'2026-11-01',to:'2026-11-05',details:{status:'Ongoing'}},'2026-11-28'),'Completed');
 assert.equal(masterStatus({kind:'od',from:'2026-12-01',to:'2026-12-01',details:{}},'2026-11-28'),'Planned');
 const summary=siteSummary([{kind:'vtc',siteKey:'majri',site:'Majri OC',employeeId:'1',from:'2026-11-24',to:'2026-12-05',details:{status:'Ongoing'},role:'Driver'},
  {kind:'vtc',siteKey:'majri',site:'Majri OC',employeeId:'2',from:'2026-11-03',to:'2026-11-07',details:{status:'Completed'},role:'Operator'}],'2026-11',{today:'2026-11-28',isDriver:r=>r.role==='Driver'});
 assert.deepEqual([summary.sites[0].people,summary.sites[0].ongoing,summary.sites[0].completed,summary.sites[0].drivers,summary.sites[0].operators,summary.sites[0].present,summary.sites[0].coming],[2,1,1,1,1,10,2]);
 assert.equal(summary.total.people,2);
 assert.match(masterRemarks('vtc',{course:'Refresher',institute:'WCL VTC Majri',status:'Ongoing'}),/^VTC Master · Refresher · WCL VTC Majri/);
});

const setup=async t=>{
 const pool=new PGlite();
 t.after(()=>pool.close());
 await pool.exec(`CREATE TABLE master_records (id BIGINT PRIMARY KEY, master_name TEXT, record_data JSONB);
  INSERT INTO master_records VALUES
   (1,'Employee master','{"name":"Ram Kumar","caliberId":"8812","designation":"Dumper Driver","site":"Sasti OC"}'),
   (2,'Employee master','{"name":"Anil Pawar","caliberId":"9021","designation":"Shovel Operator","site":"Sasti OC"}'),
   (3,'Employee master','{"name":"Helper One","caliberId":"7001","designation":"Helper","site":"Sasti OC"}'),
   (4,'Employee master','{"name":"Elsewhere","caliberId":"7002","designation":"Dumper Driver","site":"Jayant OC"}');`);
 const handlers={};
 const route=method=>(path,...steps)=>{handlers[method+' '+path]=steps.at(-1);};
 let today='2026-11-28';
 // node-postgres runs several statements in one query without parameters; PGlite needs exec for that.
 const run=(sql,params)=>params?pool.query(sql,params):pool.exec(sql).then(r=>r.at(-1));
 const api=registerAttendanceMasters({get:route('GET'),post:route('POST'),put:route('PUT'),delete:route('DELETE')},
  {pool:{query:run,connect:async()=>({query:run,release(){}})},requireSession:(q,s,n)=>n(),requireAdministrator:(q,s,n)=>n(),getSiteScope:async()=>({sites:['sasti ob']}),today:()=>today,timerMs:0});
 const call=async(key,{body={},query={},params={}}={})=>{
  let status=200,payload;
  await handlers[key]({session:{login:'sasti.hr',name:'Sasti HR'},body,query,params},{set(){return this;},status(v){status=v;return this;},json(v){payload=v;}},error=>{throw error;});
  return {status,payload};
 };
 const days=async()=>(await pool.query("SELECT book_date::text AS date,site,shift,employee_id::text AS id,kind,reason,master_id::text AS master FROM mis_shift_attendance ORDER BY employee_id,book_date")).rows;
 await call('GET /api/attendance-masters',{query:{kind:'vtc'}});
 return {pool,call,days,api,setToday:value=>{today=value;}};
};

test('VTC Master saves one record per ticked person and writes the days that have arrived into attendance',async t=>{
 const {pool,call,days,api,setToday}=await setup(t);
 const people=(await call('GET /api/attendance-masters/people',{query:{site:'Sasti OC'}})).payload.people;
 assert.deepEqual(people.map(p=>[p.name,p.role]),[['Anil Pawar','Operator'],['Ram Kumar','Driver']],'drivers and operators of the site only');
 assert.equal((await call('GET /api/attendance-masters/people',{query:{site:'Jayant OC'}})).status,403);
 assert.equal((await call('POST /api/attendance-masters',{body:{kind:'vtc',site:'Sasti OC',employeeIds:['1','3'],...vtcBody}})).status,400,'a helper is refused, nothing saved');
 assert.equal((await days()).length,0);
 const saved=await call('POST /api/attendance-masters',{body:{kind:'vtc',site:'Sasti OC',employeeIds:['1','2'],...vtcBody}});
 assert.equal(saved.status,200);assert.equal(saved.payload.saved,2);assert.equal(saved.payload.presentDays,10,'24 to 28 Nov for two people');
 const written=await days();
 assert.equal(written.length,10);
 assert.ok(written.every(d=>d.reason===VTC_TRAINING_REASON&&d.shift===TRAINING_SHIFT&&d.site==='sasti ob'&&d.master));
 assert.deepEqual([...new Set(written.map(d=>d.id+':'+d.kind))],['1:vehicle','2:equipment'],'a driver is a VLB presence, an operator an ELB one');
 // The same person cannot have VTC and OD on one day.
 const clash=await call('POST /api/attendance-masters',{body:{kind:'od',site:'Sasti OC',employeeIds:['1'],...odBody,fromDate:'2026-11-26',toDate:'2026-11-26'}});
 assert.equal(clash.status,409);assert.match(clash.payload.error,/already has VTC/);
 // A later day is written on its own date; the timer is idempotent.
 setToday('2026-11-30');await api.fill();await api.fill();
 assert.equal((await days()).length,14);
 // The month list.
 const month=(await call('GET /api/attendance-masters',{query:{kind:'vtc',month:'2026-11'}})).payload;
 assert.deepEqual([month.total.people,month.total.present,month.total.coming],[2,14,0]);
 assert.deepEqual(month.records.map(r=>[r.name,r.status,r.month.present]),[['Anil Pawar','Ongoing',7],['Ram Kumar','Ongoing',7]]);
 assert.deepEqual(month.siteOptions,['Sasti OC']);
 // Change: the To date moves earlier, the later days leave attendance.
 const id=month.records.find(r=>r.name==='Ram Kumar').id;
 assert.equal((await call('PUT /api/attendance-masters/:id',{params:{id},body:{...vtcBody,toDate:'2026-11-25',status:'Completed'}})).status,200);
 assert.deepEqual((await days()).filter(d=>d.id==='1').map(d=>d.date),['2026-11-24','2026-11-25']);
 // Remove: needs a reason; its days leave attendance.
 assert.equal((await call('DELETE /api/attendance-masters/:id',{params:{id},body:{}})).status,400);
 assert.equal((await call('DELETE /api/attendance-masters/:id',{params:{id},body:{reason:'Entered by mistake'}})).status,200);
 assert.equal((await days()).filter(d=>d.id==='1').length,0);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM mis_attendance_masters WHERE deleted_at IS NOT NULL')).rows[0].n,1,'kept, marked removed');
});

test('OD Master writes OD days, and a record replaces a Present — 0 trips of Shift A but never a day of another record',async t=>{
 const {pool,call,days}=await setup(t);
 await pool.query("INSERT INTO mis_shift_attendance VALUES ('2026-11-20','sasti ob','S1',1,NULL,'vehicle','Rain','','site')");
 assert.equal((await call('POST /api/attendance-masters',{body:{kind:'od',site:'Sasti OC',employeeIds:['1'],...odBody}})).status,200);
 assert.deepEqual((await days()).map(d=>[d.date,d.reason]),[['2026-11-20',OD_REASON],['2026-11-21',OD_REASON]]);
 const month=(await call('GET /api/attendance-masters',{query:{kind:'od',month:'2026-11'}})).payload;
 assert.deepEqual(month.records.map(r=>[r.name,r.status,r.details.odType]),[['Ram Kumar','Done','Medical exam (PME)']]);
 assert.equal((await call('GET /api/attendance-masters',{query:{kind:'vtc',month:'2026-11'}})).payload.records.length,0,'each master lists its own kind');
});

const site='Sasti OC',date='2026-11-10';
const shifts=[['A','05:00','13:00'],['B','13:00','21:00'],['C','21:00','05:00']].map(([shiftCode,startTime,endTime],i)=>({id:String(31+i),site,shiftCode,shiftName:'Shift '+shiftCode,startTime,endTime,status:'Active'}));
const employees=[{id:'21',caliberId:'101',caliberCode:'CMLL101',name:'Driver One'},{id:'22',caliberId:'102',caliberCode:'CMLL102',name:'Driver Two'}];
const od={date,site:'sasti ob',shift:'S1',employee_id:21,asset_id:null,reason:OD_REASON,remarks:'OD Master · Court / police'};
const vtc={date,site:'sasti ob',shift:'S1',employee_id:22,asset_id:null,reason:VTC_TRAINING_REASON,remarks:'VTC Master'};

test('an OD day is present in teal, its own source, never a zero-trip entry',()=>{
 const r=buildManpowerReport({records:[],assets:[],employees,shifts,filters:{from:date,to:date},attendance:[od,vtc]});
 const shift=Object.fromEntries(r.shiftAttendance.map(l=>[l.employeeName,l]));
 assert.deepEqual([shift['Driver One'].status,shift['Driver One'].reason,shift['Driver One'].trips],[OD_STATUS,OD_REASON,null]);
 const equipment=Object.fromEntries(r.attendanceEquipment.map(l=>[l.employeeName,l]));
 assert.deepEqual([equipment['Driver One'].flag,equipment['Driver One'].flagLabel,equipment['Driver One'].equipment,equipment['Driver One'].source],[OD_FLAG,OD_FLAG_LABEL,OD_REASON,'od']);
 assert.equal(equipment['Driver Two'].flag,TRAINING_FLAG,'VTC stays purple');
 const model=buildAttendanceRegister({duties:[],presence:r.attendanceEquipment,shifts:[{siteKey:'sasti ob',date,shift:'S1',state:'closed'}],sites:[],from:date,to:date,today:'2026-11-20'});
 const person=model.register('sasti ob').find(p=>p.employeeName==='Driver One');
 assert.deepEqual([person.cells[0].kind,person.cells[0].flag,person.lines[0].logBook,person.present],['present',OD_FLAG,'OD',1]);
 assert.deepEqual(Object.fromEntries(cardAttendances(r.attendanceEquipment,{site}).map(c=>[c.name,c.source])),{'Driver One':'od','Driver Two':'training'});
 assert.deepEqual(vlbZeroTripEntries([{...od,employee_id:'21',employee:{name:'Driver One'}}],{site,report_date:date,shift:'S1'}),[]);
});

test('an OD day on which the person also worked counts once, as the duty',()=>{
 const assets=[{id:'1',door:'V1',site,category:'Vehicle',group:'Tipper',make:'Volvo',model:'FMX'}];
 const data={bookDate:date,location:site,assetId:1,employeeId:21,caliberId:'101',employeeName:'Driver One',shiftId:32,shiftName:'Shift B',bookShiftCode:'S2',masterShiftStart:'13:00',door:'V1',openingHmr:100,closingHmr:108,openingKmr:1000,closingKmr:1100,totalTrips:5,trips:[]};
 const card={id:1,book_no:'CARD-1',book_type:'vehicle',book_date:date,site,asset_id:1,data,batches:[{id:'b2',name:'BATCH-S2',closed_at:'2026-11-11'}]};
 const r=buildManpowerReport({records:[card],assets,employees,shifts,filters:{from:date,to:date},attendance:[od]});
 assert.deepEqual(r.attendanceEquipment.filter(l=>l.employeeName==='Driver One').map(l=>[l.shift,l.flag]),[['S2','normal']]);
});

test('Masters › VTC Master and OD Master: the people of Caliber ID Re-check, the routes listed, the colours drawn',()=>{
 const login=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages}});
 assert.equal(misPageAllowed(login(['Employee master']),'VTC Master','desktop'),true);
 assert.equal(misPageAllowed(login(['Vehicle Log Book']),'OD Master','desktop'),true);
 assert.equal(misPageAllowed(login(['Reports']),'VTC Master','desktop'),false);
 const allowed=(method,path,pages=['Employee master'])=>misRequestAllowed({...login(pages),permissions:{...login(pages).permissions,misAccess:pages}},{method,path});
 assert.equal(allowed('GET','/api/attendance-masters'),true);
 assert.equal(allowed('POST','/api/attendance-masters'),true);
 assert.equal(allowed('GET','/api/attendance-masters/people'),true);
 assert.equal(allowed('PUT','/api/attendance-masters/12'),true);
 assert.equal(allowed('DELETE','/api/attendance-masters/12'),true);
 assert.equal(allowed('POST','/api/attendance-masters/12'),false);
 assert.equal(allowed('GET','/api/attendance-masters',['Reports']),false);
 const main=read('../src/main.jsx');
 assert.match(main,/'Attendance approval','VTC Master','OD Master','Capacity master'/);
 assert.match(main,/renderedActive==='VTC Master'\|\|renderedActive==='OD Master' \? \(<AttendanceMasters /);
 assert.ok(read('../server.mjs').includes('registerAttendanceMasters(app,{pool,requireSession,requireAdministrator,getSiteScope:logBookScope,timerMs:scheduledJobsEnabled?5*60_000:0});'));
 assert.match(read('../src/attendance-register.jsx'),/\['od','Teal','On Duty, OD \(present\)'\]/);
 assert.match(read('../src/manpower-reports.jsx'),/\['od','Teal','On Duty, OD \(present\)'\]/);
 assert.match(read('../src/attendance-register.css'),/\.ar-flag-od\{/);
 assert.match(read('../src/manpower-reports.css'),/\.mp-flag-od\{[\s\S]*tr\.mp-duty-od>td\{/);
 const screen=read('../src/attendance-masters.jsx');
 for(const step of ['Step 1 · ${info.title}','Step 2 · ${info.title}','Step 3 · ${record.caliberCode}'])assert.ok(screen.includes(step),step);
});
