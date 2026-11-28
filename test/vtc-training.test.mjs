// VTC Training attendance (owner, 25 Nov 2026): its own entry and colour, present, never a zero-trip entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {registerShiftAttendance,SHIFT_ATTENDANCE_SCHEMA} from '../server/routes/shift-attendance.mjs';
import {buildManpowerReport} from '../server/rules/manpower-report.mjs';
import {vlbZeroTripEntries,ZERO_TRIP_ENTRY_SQL} from '../shared/vlb-zero-trip-entries.mjs';
import {buildAttendanceRegister} from '../src/attendance-register-model.mjs';
import {cardAttendances} from '../shared/trip-card-attendance.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';
import {VTC_TRAINING_REASON,TRAINING_STATUS,TRAINING_FLAG,TRAINING_FLAG_LABEL,TRAINING_SHIFT,trainingDays} from '../shared/vtc-training.mjs';
import {ZERO_TRIP_REASONS} from '../shared/zero-trip-reasons.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('VTC Training saves every day From to To, with no shift and no machine, and needs where it was held',async t=>{
 const pool=new PGlite();
 t.after(()=>pool.close());
 await pool.exec(`CREATE TABLE master_records (id BIGINT PRIMARY KEY, master_name TEXT, record_data JSONB);
  INSERT INTO master_records VALUES
   (1,'Employee master','{"name":"Driver","site":"Sasti OC"}'),
   (3,'Employee master','{"name":"Second","site":"Sasti OC"}'),
   (4,'Employee master','{"name":"Elsewhere","site":"Jayant OC"}'),
   (2,'Shift Master','{"shiftCode":"A","site":"Sasti OC"}');`+SHIFT_ATTENDANCE_SCHEMA);
 const handlers={};
 registerShiftAttendance({post(path,...steps){handlers[path]=steps.at(-1);}},{pool,protect:[],ensureBooks:async()=>{},today:()=>'2026-11-25'});
 assert.deepEqual(Object.keys(handlers).sort(),['/api/shift-attendance','/api/training-attendance']);
 const save=async(path,overrides={})=>{
  let status=200,payload;
  await handlers[path]({session:{login:'supervisor'},logBookScope:{sites:['sasti ob']},
   body:{kind:'vehicle',...(path==='/api/training-attendance'?{fromDate:'2026-11-02',toDate:'2026-11-04'}:{bookDate:'2026-11-10',shiftId:'2'}),location:'Sasti OC',employeeId:'1',remarks:'VTC Nagpur',...overrides}},
   {status(value){status=value;return this;},json(value){payload=value;}},error=>{throw error;});
  return {status,payload};
 };
 assert.equal((await save('/api/training-attendance',{remarks:'  '})).status,400,'where the training was held is required');
 assert.equal((await save('/api/training-attendance',{assetId:'3'})).status,400,'a training entry names no machine');
 assert.equal((await save('/api/training-attendance',{location:'Jayant OC'})).status,403);
 assert.equal((await save('/api/training-attendance',{toDate:'2026-11-01'})).status,400,'To before From');
 assert.equal((await save('/api/training-attendance',{toDate:'2026-11-26'})).status,400,'not after today');
 assert.equal((await save('/api/training-attendance',{fromDate:'2026-10-31'})).status,400,'not before 1 Nov 2026');
 assert.equal((await save('/api/training-attendance',{employeeId:'9'})).status,400,'an employee of this site');
 const {rows:none}=await pool.query('SELECT count(*)::int AS n FROM mis_shift_attendance');assert.equal(none[0].n,0,'a refused range saves nothing');
 assert.deepEqual((await save('/api/training-attendance',{reason:'Rain',shiftId:'2'})).payload,{present:true,training:true,people:1,days:3,from:'2026-11-02',to:'2026-11-04'});
 const {rows}=await pool.query('SELECT book_date::text AS date,site,shift,asset_id,kind,reason,remarks FROM mis_shift_attendance ORDER BY book_date');
 assert.deepEqual(rows,['2026-11-02','2026-11-03','2026-11-04'].map(date=>({date,site:'sasti ob',shift:TRAINING_SHIFT,asset_id:null,kind:'vehicle',reason:VTC_TRAINING_REASON,remarks:'VTC Nagpur'})),
  'one line a day, in the first shift, always VTC Training whatever shift or reason is sent');
 await pool.query('DELETE FROM mis_shift_attendance');
 // Several people in one save (owner, 25 Nov 2026: bulk): every person every day, or nothing when one is refused.
 const refused=await save('/api/training-attendance',{employeeId:undefined,employeeIds:['1','3','4']});
 assert.equal(refused.status,400);assert.deepEqual(refused.payload.refused,['4']);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM mis_shift_attendance')).rows[0].n,0,'one refused person saves nobody');
 assert.equal((await save('/api/training-attendance',{employeeId:undefined,employeeIds:[]})).status,400);
 assert.equal((await save('/api/training-attendance',{employeeId:undefined,employeeIds:Array.from({length:101},(_,i)=>String(i+1))})).status,400,'up to 100 people');
 assert.deepEqual((await save('/api/training-attendance',{employeeId:undefined,employeeIds:['1','3','3']})).payload,{present:true,training:true,people:2,days:3,from:'2026-11-02',to:'2026-11-04'});
 const {rows:many}=await pool.query('SELECT employee_id::text AS id,count(*)::int AS days FROM mis_shift_attendance GROUP BY employee_id ORDER BY employee_id');
 assert.deepEqual(many,[{id:'1',days:3},{id:'3',days:3}]);
 await pool.query('DELETE FROM mis_shift_attendance WHERE employee_id=3');
 assert.equal((await save('/api/training-attendance',{fromDate:'2026-11-04',toDate:'2026-11-05',remarks:'VTC Chandrapur'})).payload.days,2);
 const {rows:again}=await pool.query('SELECT count(*)::int AS n, count(*) FILTER (WHERE remarks=$1)::int AS updated FROM mis_shift_attendance',['VTC Chandrapur']);
 assert.deepEqual(again[0],{n:4,updated:2},'saving a day again replaces it, never doubles it');
 assert.equal((await save('/api/shift-attendance',{reason:VTC_TRAINING_REASON})).status,400,'Present — 0 trips cannot be saved as VTC Training');
 assert.ok(!ZERO_TRIP_REASONS.includes(VTC_TRAINING_REASON));
});

test('a training range is 1 to 31 real days, from 1 Nov 2026 up to today',()=>{
 assert.deepEqual(trainingDays('2026-11-02','2026-11-04',{today:'2026-11-25'}).days,['2026-11-02','2026-11-03','2026-11-04']);
 assert.equal(trainingDays('2026-11-30','2026-11-30',{today:'2026-11-30'}).days.length,1);
 assert.match(trainingDays('2026-11-01','2026-12-02',{today:'2026-12-31'}).error,/up to 31 days/);
 assert.match(trainingDays('2026-11-31','2026-12-01',{today:'2026-12-31'}).error,/From and To/);
});

test('the same people who save Present — 0 trips may save VTC Training, for their log book',()=>{
 const session={permissions:{separateMisCredentials:true,misDesktopAccess:['Vehicle Log Book'],misMobileAccess:[]}};
 const allowed=(method,body)=>misRequestAllowed(session,{path:'/api/training-attendance',method,body,query:{}});
 assert.equal(allowed('POST',{kind:'vehicle'}),true);
 assert.equal(allowed('POST',{kind:'equipment'}),false);
 assert.equal(allowed('GET',{kind:'vehicle'}),false);
});

const site='Sasti OC',date='2026-11-10';
const shifts=[['A','05:00','13:00'],['B','13:00','21:00'],['C','21:00','05:00']].map(([shiftCode,startTime,endTime],i)=>({id:String(31+i),site,shiftCode,shiftName:'Shift '+shiftCode,startTime,endTime,status:'Active'}));
const employees=[{id:'21',caliberId:'101',caliberCode:'CMLL101',name:'Driver One'},{id:'22',caliberId:'102',caliberCode:'CMLL102',name:'Driver Two'}];
const training={date,site:'sasti ob',shift:'S1',employee_id:21,asset_id:null,reason:VTC_TRAINING_REASON,remarks:'VTC Nagpur'};
const zero={date,site:'sasti ob',shift:'S1',employee_id:22,asset_id:null,reason:'Rain',remarks:''};
const report=attendance=>buildManpowerReport({records:[],assets:[],employees,shifts,filters:{from:date,to:date},attendance});

test('a VTC Training day is present in purple, apart from Present — 0 trips',()=>{
 const r=report([training,zero]);
 const shift=Object.fromEntries(r.shiftAttendance.map(l=>[l.employeeName,l]));
 assert.equal(shift['Driver One'].status,TRAINING_STATUS);
 assert.equal(shift['Driver One'].trips,null,'a training day has no trips, not 0 trips');
 assert.equal(shift['Driver One'].reason,VTC_TRAINING_REASON);
 assert.equal(shift['Driver Two'].status,'Present — 0 trips');
 const equipment=Object.fromEntries(r.attendanceEquipment.map(l=>[l.employeeName,l]));
 assert.deepEqual([equipment['Driver One'].flag,equipment['Driver One'].flagLabel,equipment['Driver One'].equipment,equipment['Driver One'].source,equipment['Driver One'].actual],
  [TRAINING_FLAG,TRAINING_FLAG_LABEL,VTC_TRAINING_REASON,'training',true]);
 assert.deepEqual([equipment['Driver Two'].flag,equipment['Driver Two'].source],['zero','zero-trip']);
 // Attendance Batch-wise / Month-wise: present (P1) in purple, its own count.
 const model=buildAttendanceRegister({duties:[],presence:r.attendanceEquipment,shifts:[{siteKey:'sasti ob',date,shift:'S1',state:'closed'}],sites:[],from:date,to:date,today:'2026-11-20'});
 const person=model.register('sasti ob').find(p=>p.employeeName==='Driver One');
 assert.deepEqual([person.cells[0].kind,person.cells[0].code,person.cells[0].flag,person.lines[0].logBook,person.present],['present','P1',TRAINING_FLAG,'VTC Training',1]);
 // Site Sheet vs Trip Card / Trip Card vs Bio-punch: a training day is its own source, never a zero-trip entry.
 const sources=Object.fromEntries(cardAttendances(r.attendanceEquipment,{site}).map(c=>[c.name,c.source]));
 assert.deepEqual(sources,{'Driver One':'training','Driver Two':'zero-trip'});
});

test('a VTC Training entry is not listed among a batch\'s Present — 0 trips entries',()=>{
 const batch={site:'Sasti OC',report_date:date,shift:'S1'};
 const rows=[{...training,employee_id:'21',employee:{name:'Driver One'}},{...zero,employee_id:'22',employee:{name:'Driver Two'}}];
 assert.deepEqual(vlbZeroTripEntries(rows,batch).map(e=>e.employeeName),['Driver Two']);
 assert.match(ZERO_TRIP_ENTRY_SQL,/a\.reason NOT IN \('VTC Training','On Duty \(OD\)'\)/);
});

test('VLB / ELB Manual has its own VTC Training button and form, and the colour is drawn',()=>{
 const workspace=read('../src/vlb-entry-workspace.jsx');
 assert.match(workspace,/>Present — 0 trips<\/button>/);
 assert.match(workspace,/setAttendanceOpen\('training'\)\}>VTC Training<\/button>/);
 const form=read('../src/shift-attendance.jsx');
 assert.match(form,/training\?'\/api\/training-attendance':'\/api\/shift-attendance'/);
 assert.match(form,/\{kind,location:site,fromDate:date,toDate,employeeIds:trainees,remarks\}/,'From and To date, no shift, every ticked person');
 assert.match(form,/training\?<VtcTrainingPeople /,'VTC Training picks several people');
 const people=read('../src/vtc-training-people.jsx');
 assert.match(people,/type="checkbox"/);assert.match(people,/Select all shown/);assert.match(people,/TRAINING_MAX_PEOPLE/);
 assert.match(form,/training\?<>\s*<label className="logbook-field">From date[\s\S]*To date[\s\S]*<\/>:<>\s*<label className="logbook-field">Book date[\s\S]*Shift<select/,'the shift box is only on Present — 0 trips');
 assert.match(read('../src/attendance-register.jsx'),/\['training','Purple','VTC Training \(present\)'\]/);
 assert.match(read('../src/manpower-reports.jsx'),/\['training','Purple','VTC Training \(present\)'\]/);
 assert.match(read('../src/attendance-register.css'),/\.ar-flag-training\{/);
 assert.match(read('../src/manpower-reports.css'),/\.mp-flag-training\{[\s\S]*tr\.mp-duty-training>td\{/);
});

test('a VTC Training day on which the person also worked any shift counts as one present, the duty',()=>{
 const assets=[{id:'1',door:'V1',site,category:'Vehicle',group:'Tipper',make:'Volvo',model:'FMX'}];
 const data={bookDate:date,location:site,assetId:1,employeeId:21,caliberId:'101',employeeName:'Driver One',shiftId:32,shiftName:'Shift B',bookShiftCode:'S2',masterShiftStart:'13:00',door:'V1',openingHmr:100,closingHmr:108,openingKmr:1000,closingKmr:1100,totalTrips:5,trips:[]};
 const card={id:1,book_no:'CARD-1',book_type:'vehicle',book_date:date,site,asset_id:1,data,batches:[{id:'b2',name:'BATCH-S2',closed_at:'2026-11-11'}]};
 const other={...training,date:'2026-11-11'};
 const r=buildManpowerReport({records:[card],assets,employees,shifts,filters:{from:date,to:'2026-11-11'},attendance:[training,other]});
 const lines=r.attendanceEquipment.filter(l=>l.employeeName==='Driver One');
 assert.deepEqual(lines.map(l=>[l.date,l.shift,l.flag]),[[date,'S2','normal'],['2026-11-11','S1',TRAINING_FLAG]],'the card day keeps only the card; a training day with no duty stays purple');
 const model=buildAttendanceRegister({duties:r.otDuties,presence:r.attendanceEquipment,shifts:[date,'2026-11-11'].flatMap(d=>['S1','S2','S3'].map(shift=>({siteKey:'sasti ob',date:d,shift,state:'closed'}))),sites:[],from:date,to:'2026-11-11',today:'2026-11-20'});
 const person=model.register('sasti ob').find(p=>p.employeeName==='Driver One');
 assert.deepEqual(person.cells.map(c=>[c.code,c.flag]),[['P2','normal'],['P1',TRAINING_FLAG]]);
 assert.equal(person.present,2);assert.equal(person.duties,2,'one present a day, never P1+2');
});
