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
import {VTC_TRAINING_REASON,TRAINING_STATUS,TRAINING_FLAG,TRAINING_FLAG_LABEL} from '../shared/vtc-training.mjs';
import {ZERO_TRIP_REASONS} from '../shared/zero-trip-reasons.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('VTC Training is saved by its own route, without a machine, and needs where it was held',async t=>{
 const pool=new PGlite();
 t.after(()=>pool.close());
 await pool.exec(`CREATE TABLE master_records (id BIGINT PRIMARY KEY, master_name TEXT, record_data JSONB);
  INSERT INTO master_records VALUES
   (1,'Employee master','{"name":"Driver","site":"Sasti OC"}'),
   (2,'Shift Master','{"shiftCode":"A","site":"Sasti OC"}');`+SHIFT_ATTENDANCE_SCHEMA);
 const handlers={};
 registerShiftAttendance({post(path,...steps){handlers[path]=steps.at(-1);}},{pool,protect:[],ensureBooks:async()=>{}});
 assert.deepEqual(Object.keys(handlers).sort(),['/api/shift-attendance','/api/training-attendance']);
 const save=async(path,overrides={})=>{
  let status=200,payload;
  await handlers[path]({session:{login:'supervisor'},logBookScope:{sites:['sasti ob']},
   body:{kind:'vehicle',bookDate:'2026-11-10',location:'Sasti OC',shiftId:'2',employeeId:'1',remarks:'VTC Nagpur',...overrides}},
   {status(value){status=value;return this;},json(value){payload=value;}},error=>{throw error;});
  return {status,payload};
 };
 assert.equal((await save('/api/training-attendance',{remarks:'  '})).status,400,'where the training was held is required');
 assert.equal((await save('/api/training-attendance',{assetId:'3'})).status,400,'a training entry names no machine');
 assert.equal((await save('/api/training-attendance',{location:'Jayant OC'})).status,403);
 assert.deepEqual((await save('/api/training-attendance',{reason:'Rain'})).payload,{present:true,training:true});
 const {rows}=await pool.query('SELECT site,shift,asset_id,kind,reason,remarks FROM mis_shift_attendance');
 assert.deepEqual(rows,[{site:'sasti ob',shift:'S1',asset_id:null,kind:'vehicle',reason:VTC_TRAINING_REASON,remarks:'VTC Nagpur'}],'the reason is always VTC Training');
 assert.equal((await save('/api/shift-attendance',{reason:VTC_TRAINING_REASON})).status,400,'Present — 0 trips cannot be saved as VTC Training');
 assert.ok(!ZERO_TRIP_REASONS.includes(VTC_TRAINING_REASON));
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
 assert.match(ZERO_TRIP_ENTRY_SQL,/a\.reason<>'VTC Training'/);
});

test('VLB / ELB Manual has its own VTC Training button and form, and the colour is drawn',()=>{
 const workspace=read('../src/vlb-entry-workspace.jsx');
 assert.match(workspace,/>Present — 0 trips<\/button>/);
 assert.match(workspace,/setAttendanceOpen\('training'\)\}>VTC Training<\/button>/);
 const form=read('../src/shift-attendance.jsx');
 assert.match(form,/training\?'\/api\/training-attendance':'\/api\/shift-attendance'/);
 assert.match(read('../src/attendance-register.jsx'),/\['training','Purple','VTC Training \(present\)'\]/);
 assert.match(read('../src/manpower-reports.jsx'),/\['training','Purple','VTC Training \(present\)'\]/);
 assert.match(read('../src/attendance-register.css'),/\.ar-flag-training\{/);
 assert.match(read('../src/manpower-reports.css'),/\.mp-flag-training\{[\s\S]*tr\.mp-duty-training>td\{/);
});
