// Attendance Sheet Mismatch, drivers and operators: the biometric attlog .dat against trip card attendance.
// Every ID and name here is made up.
import assert from 'node:assert/strict';
import test from 'node:test';
import {parseAttlog,attlogDays,biometricDays,biometricRange,tripBiometricCheck,tripBiometricWorkbook,isDriverOrOperator,looksLikeAttlog} from '../shared/trip-biometric-check.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {readBiometricFile,runTripBiometricCheck} from '../src/trip-biometric-run.mjs';

const line=(id,stamp,state)=>`    ${id}\t${stamp}\t1\t${state}\t1\t0`;
const DAT=[
 line(9001,'2026-11-02 05:50:10',0),line(9001,'2026-11-02 05:51:00',0),line(9001,'2026-11-02 14:05:00',1), // repeat IN skipped
 line(9002,'2026-11-02 21:40:00',0),line(9002,'2026-11-03 06:10:00',1),                                   // night duty: stays on 2 Nov
 line(9003,'2026-11-02 06:00:00',0),                                                                       // no OUT
 line(9004,'2026-11-02 06:02:00',0),line(9004,'2026-11-02 14:00:00',1),                                   // helper: not compared
 line(9005,'2026-11-03 06:00:00',0),line(9005,'2026-11-03 14:00:00',1),                                   // driver, no trip card
 line(9006,'2026-11-02 06:00:00',0),line(9006,'2026-11-02 14:00:00',1),                                   // punched here, card elsewhere
].join('\r\n');
const PEOPLE=[
 {number:'9001',found:true,name:'RAM DRIVER',designation:'TIPPER DRIVER'},
 {number:'9002',found:true,name:'SHYAM OPERATOR',designation:'LOADER OPERATOR'},
 {number:'9003',found:true,name:'MOHAN DRIVER',designation:'WATER TANKER DRIVER'},
 {number:'9004',found:true,name:'SOHAN HELPER',designation:'TIPPER HELPER'},
 {number:'9005',found:true,name:'GOPAL DRIVER',designation:'LMV DRIVER'},
 {number:'9006',found:true,name:'HARI OPERATOR',designation:'DRILL OPERATOR'},
 {number:'9007',found:true,name:'KISHAN DRIVER',designation:'TIPPER DRIVER'},
];
const duty=(id,date,shift,site='Sasti OC')=>({date,shift,site,siteKey:site,employeeId:'CMLL'+id,caliberCode:'CMLL'+id,employeeName:'',doors:'T-1',books:'VLB-1'});
const LINES=[duty(9001,'2026-11-02','S1'),duty(9002,'2026-11-02','S3'),duty(9003,'2026-11-02','S1'),duty(9006,'2026-11-02','S1','Dhoptala OB 2nd'),duty(9007,'2026-11-03','S1')];
const LOCKED=['2026-11-02','2026-11-03'].map(d=>canonicalSiteName('Sasti OC')+'|'+d);

test('the attlog .dat is read: 0 is IN, 1 is OUT, repeats skipped, a night duty stays on its IN date',()=>{
 assert.ok(looksLikeAttlog(DAT));
 const {punches,bad}=parseAttlog(DAT+'\r\nnot a punch');
 assert.equal(punches.length,12);assert.deepEqual(bad,[13]);
 assert.deepEqual(punches[0],{code:'9001',date:'2026-11-02',time:'05:50',at:Date.parse('2026-11-02T05:50:10+05:30'),dir:'IN'});
 const {days,repeats}=attlogDays(punches);assert.equal(repeats,1);
 const of=code=>days.filter(d=>d.caliberCode===code);
 assert.deepEqual(of('9001'),[{caliberCode:'9001',date:'2026-11-02',inTime:'05:50',outTime:'14:05'}]);
 assert.deepEqual(of('9002'),[{caliberCode:'9002',date:'2026-11-02',inTime:'21:40',outTime:'06:10'}]);
 assert.deepEqual(of('9003'),[{caliberCode:'9003',date:'2026-11-02',inTime:'06:00',outTime:''}]);
 assert.throws(()=>parseAttlog('hello'),/No punch line could be read/);
});

test('drivers and operators only; each mismatch kind is found',()=>{
 assert.ok(isDriverOrOperator('LOADER OPERATOR'));assert.ok(!isDriverOrOperator('TIPPER HELPER'));assert.ok(!isDriverOrOperator('DATA ENTRY OPERATOR'));
 const bio=biometricDays({content:DAT});
 const r=tripBiometricCheck({days:bio.days,lines:LINES,lockedDays:LOCKED,people:PEOPLE,site:'Sasti OC',from:'2026-11-02',to:'2026-11-03'});
 const kinds=r.findings.map(f=>f.type+':'+f.caliberCode).sort();
 assert.deepEqual(kinds,['miss-punch:9003','no-biometric:9007','no-trip-card:9005','site-mismatch:9006']);
 assert.ok(!r.perPerson.some(p=>p.caliberCode==='9004'),'a helper is not compared');
 assert.equal(r.otherStaff,1);
 assert.equal(r.findings.find(f=>f.type==='no-biometric').employeeId,'CMLL9007');
 assert.deepEqual(r.notInMaster,[]);
 const book=tripBiometricWorkbook(r,{fileName:'x.dat'});
 assert.deepEqual(book.sheets.map(s=>s.name),['Mismatches','Per employee','Summary']);
 assert.equal(book.sheets[0].rows.length,4);
 assert.ok(buildXlsxSheetsWorkbook(book.title,book.sheets),'the Excel builds');
});

test('the run reads the file dates from Pulse-II and asks Employee Master for every number',async()=>{
 const bio=await readBiometricFile({name:'CEXJ_attlog.dat',text:async()=>DAT});
 assert.deepEqual(biometricRange(bio.days,'2026-11-23'),{from:'2026-11-02',to:'2026-11-03',cut:false});
 const asked=[];
 const read=async(url,session,opt)=>{asked.push(url);if(url.includes('/people')){const ids=JSON.parse(opt.body).ids;assert.ok(ids.includes('9004')&&ids.includes('CMLL9007'));return {site:'Sasti OC',people:PEOPLE};}
  return {lockedDays:LOCKED,otDuties:LINES,attendanceEquipment:[]};};
 const done=await runTripBiometricCheck({bio,fileName:'CEXJ_attlog.dat',site:'Sasti OC',session:{token:'T'},today:'2026-11-23',read,build:(title,sheets)=>({title,sheets})});
 assert.match(asked[0],/from=2026-11-02&to=2026-11-03&view=attendance/);
 assert.equal(done.result.totals.findings,4);
 assert.equal(done.name,'Trip-card-vs-biometric-Sasti-OC-2026-11-02-to-2026-11-03.xlsx');
 await assert.rejects(runTripBiometricCheck({bio,site:'Sasti OC',session:{},today:'2026-10-31',read}),/No date of this file can be compared/);
});
