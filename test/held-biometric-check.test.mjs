// Attendance Sheet Mismatch on the punches Pulse-II already holds (owner, 23 Nov 2026): machine direct from HR Pulse and
// imported on Attendance Management, drivers and operators only. Every ID and name here is made up.
import assert from 'node:assert/strict';
import test from 'node:test';
import {machineDays,importedDays,mergeBiometricDays} from '../shared/trip-biometric-check.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {readBiometricDays} from '../server/routes/attendance-sheet-check.mjs';
import {runHeldBiometricCheck} from '../src/trip-biometric-run.mjs';

const PEOPLE=[
 {number:'9001',found:true,name:'RAM DRIVER',designation:'TIPPER DRIVER'},
 {number:'9002',found:true,name:'SHYAM OPERATOR',designation:'LOADER OPERATOR'},
 {number:'9003',found:true,name:'MOHAN DRIVER',designation:'WATER TANKER DRIVER'},
 {number:'9004',found:true,name:'SOHAN HELPER',designation:'TIPPER HELPER'},
 {number:'9005',found:true,name:'GOPAL DRIVER',designation:'LMV DRIVER'},
 {number:'9006',found:true,name:'HARI OPERATOR',designation:'DRILL OPERATOR'},
 {number:'9007',found:true,name:'KISHAN DRIVER',designation:'TIPPER DRIVER'},
 {number:'9008',found:true,name:'BALU DRIVER',designation:'TIPPER DRIVER'},
];
const duty=(id,date,shift,site='Sasti OC')=>({date,shift,site,siteKey:site,employeeId:'CMLL'+id,caliberCode:'CMLL'+id,employeeName:'',doors:'T-1',books:'VLB-1'});
const LINES=[duty(9001,'2026-11-02','S1'),duty(9002,'2026-11-02','S3'),duty(9003,'2026-11-02','S1'),duty(9006,'2026-11-02','S1','Dhoptala OB 2nd'),duty(9007,'2026-11-03','S1')];
const LOCKED=['2026-11-02','2026-11-03'].map(d=>canonicalSiteName('Sasti OC')+'|'+d);

// As HR Pulse sends them: [employee code, machine user ID, time, site index, punch type].
const HR={sites:['Sasti OC','Dhoptala OB 2nd'],punches:[
 ['CMLL9001','55','2026-11-02 05:50',0,'255'],['CMLL9001','55','2026-11-02 05:51',0,'255'],['CMLL9001','55','2026-11-02 14:05',0,'255'],
 ['','9002','2026-11-02 21:40',0,'0'],['','9002','2026-11-03 06:10',0,'1'],
 ['CMLL9003','3','2026-11-02 06:00',0,''],
 ['CMLL9004','4','2026-11-02 06:02',0,'0'],['CMLL9004','4','2026-11-02 14:00',0,'1'],
 ['CMLL9006','6','2026-11-02 06:00',0,'0'],['CMLL9006','6','2026-11-02 14:00',0,'1'],
 ['CMLL9008','8','2026-11-02 06:00',1,'0'],['CMLL9008','8','2026-11-02 14:00',1,'1'],
 ['','TRAINEE','2026-11-02 06:00',0,'0'],
]};
const IMPORTED_ROWS=[{caliber_code:'CMLL9005',date:'2026-11-03',in_time:'06:00',out_time:'14:00',site:'Sasti OC'}];
const importedPool={query:async()=>({rows:IMPORTED_ROWS})};
const RANGE={site:'Sasti OC',from:'2026-11-02',to:'2026-11-03'};

test('machine punches become one line per employee and date, read from the times',()=>{
 const {days,unread}=machineDays(HR);
 const of=code=>days.filter(d=>d.caliberCode===code).map(d=>[d.date,d.inTime,d.outTime,d.site]);
 assert.equal(unread,1,'a machine ID that is not a number and not linked');
 assert.deepEqual(of('9001'),[['2026-11-02','05:50','14:05','Sasti OC']],'a repeat is skipped; first punch IN, last OUT');
 assert.deepEqual(of('9002'),[['2026-11-02','21:40','06:10','Sasti OC']],'not linked: the machine ID is the number; a night duty stays on its date');
 assert.deepEqual(of('9003'),[['2026-11-02','06:00','','Sasti OC']],'a lone punch is an IN');
 assert.ok(days.every(d=>d.source==='machine'));
 const two=machineDays({sites:['Sasti OC'],punches:[['CMLL1','1','2026-11-02 06:00',0,'0'],['CMLL1','1','2026-11-02 14:00',0,'1'],['CMLL1','1','2026-11-02 22:00',0,'0'],['CMLL1','1','2026-11-03 06:00',0,'1']]}).days;
 assert.deepEqual(two.map(d=>[d.date,d.inTime,d.outTime]),[['2026-11-02','06:00','14:00']],'a marked IN after a marked OUT is the next duty; the same date keeps the earliest IN and latest OUT');
 const lone=machineDays({sites:['Sasti OC'],punches:[['CMLL1','1','2026-11-02 14:00',0,'1']]}).days[0];
 assert.deepEqual([lone.inTime,lone.outTime],['','14:00'],'a lone punch marked OUT');
 assert.equal(machineDays({sites:['Dudhichua OB East'],punches:[['CMLL1','1','2026-11-02 06:00',0,'0']]},{siteName:()=>'Dudhichua East OC'}).days[0].site,'Dudhichua East OC');
});

test('imported and machine punches of a day are one line: earliest IN, latest OUT, both sources named',()=>{
 const merged=mergeBiometricDays(machineDays(HR).days,importedDays([{caliberCode:'CMLL9001',date:'2026-11-02',inTime:'05:45',outTime:'13:58',site:'Sasti OC'},{caliberCode:'cmll 9005',date:'2026-11-03',inTime:'06:00',outTime:'14:00',site:'Sasti OC'}]));
 const d=merged.find(x=>x.caliberCode==='9001');
 assert.deepEqual([d.inTime,d.outTime,d.source],['05:45','14:05','machine+imported']);
 assert.equal(merged.find(x=>x.caliberCode==='9005').source,'imported');
});

test('the server sends the days of the site and the days elsewhere of people on a card here; HR Pulse away is said',async()=>{
 const both=await readBiometricDays({pool:importedPool,hrPunches:async()=>HR,...RANGE,numbers:['CMLL9006']});
 assert.deepEqual(both.days.map(d=>d.caliberCode).sort(),['9001','9002','9003','9004','9005','9006']);
 assert.deepEqual([both.machine.connected,both.machine.punches,both.imported.lines],[true,13,1]);
 const away=await readBiometricDays({pool:importedPool,hrPunches:async()=>HR,...RANGE,numbers:['9008']});
 assert.ok(away.days.some(d=>d.caliberCode==='9008'));
 const down=await readBiometricDays({pool:importedPool,hrPunches:async()=>{throw Object.assign(Error('HR connection is not set up'),{status:503});},...RANGE});
 assert.deepEqual([down.machine.connected,down.days.length],[false,1]);
 assert.match(down.machine.error,/not connected to HR Pulse/);
 const machineOnly=await readBiometricDays({pool:{query:async()=>{throw Error('not asked');}},hrPunches:async()=>HR,...RANGE,source:'machine'});
 assert.equal(machineOnly.imported.asked,false);
 const noTable=await readBiometricDays({pool:{query:async()=>{throw Object.assign(Error('no table'),{code:'42P01'});}},hrPunches:async()=>{throw Error('not asked');},...RANGE,source:'imported'});
 assert.deepEqual([noTable.days,noTable.machine.asked],[[],false]);
});

test('the check on held punches: drivers and operators only, each mismatch with its source',async()=>{
 const read=async(url,session,opt)=>{
  if(url.includes('/biometric')){const body=JSON.parse(opt.body);assert.deepEqual(body.numbers.sort(),['9001','9002','9003','9007']);return {site:'Sasti OC',...await readBiometricDays({pool:importedPool,hrPunches:async()=>HR,...body})};}
  if(url.includes('/people'))return {site:'Sasti OC',people:PEOPLE};
  assert.match(url,/from=2026-11-02&to=2026-11-03&view=attendance/);
  return {lockedDays:LOCKED,otDuties:LINES,attendanceEquipment:[]};
 };
 const done=await runHeldBiometricCheck({...RANGE,session:{token:'T'},read,build:(title,sheets)=>({title,sheets})});
 const r=done.result;
 assert.deepEqual(r.findings.map(f=>f.type+':'+f.caliberCode+':'+f.source).sort(),['miss-punch:9003:machine','no-biometric:9007:','no-trip-card:9005:imported','site-mismatch:9006:machine']);
 assert.ok(!r.perPerson.some(p=>['9004','9008'].includes(p.caliberCode)),'a helper, and a person of another site, are not compared here');
 assert.equal(r.otherStaff,1);
 assert.equal(done.name,'Trip-card-vs-biometric-Sasti-OC-2026-11-02-to-2026-11-03.xlsx');
 assert.deepEqual(done.blob.sheets[0].columns.slice(5,7).map(c=>c.label),['Biometric source','Punch site']);
});
