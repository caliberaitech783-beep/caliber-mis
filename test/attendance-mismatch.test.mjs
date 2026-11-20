import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compareAttendance,parseBiometricSheet,readDate,readTime,shiftOfPunch,mismatchSites,mismatchShifts,MISMATCH_TYPES,employeeCode} from '../shared/attendance-mismatch.mjs';
import {biometricLine} from '../server/routes/biometric-attendance.mjs';
import {misPageAllowed} from '../shared/mis-application-access.mjs';

const duty=(o={})=>({date:'2026-11-18',shift:'S1',site:'Sasti OC',caliberCode:'5311',employeeName:'Ram',equipment:'Tipper',doors:'T-12',books:'CAL/VLB/1',...o});
const punch=(o={})=>({caliberCode:'5311',date:'2026-11-18',inTime:'05:05',outTime:'13:02',site:'Sasti OC',...o});
const locked=['sasti ob|2026-11-18','sasti ob|2026-11-19'];
const types=r=>r.lines.map(l=>l.type).sort();

test('device export dates and times are read in every usual form',()=>{
 assert.equal(readDate('18-11-2026'),'2026-11-18');
 assert.equal(readDate('18/11/26'),'2026-11-18');
 assert.equal(readDate('2026-11-18'),'2026-11-18');
 assert.equal(readDate('18-Nov-2026'),'2026-11-18');
 assert.equal(readDate(new Date(Date.UTC(2026,10,18))),'2026-11-18');
 assert.equal(readDate('31-02-2026'),'');
 assert.equal(readTime('05:07'),'05:07');
 assert.equal(readTime('9:30 PM'),'21:30');
 assert.equal(readTime('12:10 am'),'00:10');
 assert.equal(readTime(0.25),'06:00');
 assert.equal(readTime(new Date(Date.UTC(1899,11,30,21,5))),'21:05');
 assert.equal(readTime('25:00'),'');
 assert.equal(employeeCode(' 005311 '),'5311');
});

test('an In / Out export gives one line per employee and date, title rows above the headings are skipped',()=>{
 const {punches,errors}=parseBiometricSheet([['Daily attendance report'],[],['Emp Code','Employee Name','Date','In Time','Out Time','Site'],
  ['5311','Ram','18-11-2026','05:05','13:02','Sasti OC'],['5312','Shyam','18-11-2026','','',''],['','x','18-11-2026','05:00','13:00',''],['5313','Mohan','bad','05:00','','']]);
 assert.deepEqual(punches,[{caliberCode:'5311',date:'2026-11-18',inTime:'05:05',outTime:'13:02',employeeName:'Ram',site:'Sasti OC'}]);
 assert.equal(errors.length,2);
});

test('a one-line-per-punch export keeps the first punch as In and the last as Out',()=>{
 const {punches}=parseBiometricSheet([['User ID','Punch Time'],['5311','18-11-2026 13:02'],['5311','18-11-2026 05:05'],['5311','18-11-2026 09:00'],['77','18-11-2026 06:00']]);
 assert.deepEqual(punches.map(p=>[p.caliberCode,p.inTime,p.outTime]),[['5311','05:05','13:02'],['77','06:00','']]);
});

test('an export without an employee code column is refused',()=>{
 assert.throws(()=>parseBiometricSheet([['Name','Date','In']]),/Employee code/);
});

test('matching punch and trip card give no finding',()=>{
 assert.deepEqual(compareAttendance({punches:[punch()],duties:[duty()],lockedDays:locked}).lines,[]);
});

test('trip card without punch and punch without trip card on a locked day are mismatches',()=>{
 const r=compareAttendance({punches:[punch({caliberCode:'9'})],duties:[duty()],lockedDays:locked});
 assert.deepEqual(types(r),['no-biometric','no-trip-card']);
 // A punch on a day not locked yet waits: the trip cards of that day may still come.
 assert.deepEqual(compareAttendance({punches:[punch({caliberCode:'9',date:'2026-11-20'})],duties:[],lockedDays:locked}).lines,[]);
});

test('different site and different shift are found',()=>{
 assert.deepEqual(types(compareAttendance({punches:[punch({site:'Majri OC'})],duties:[duty()],lockedDays:locked})),['site-mismatch']);
 assert.deepEqual(types(compareAttendance({punches:[punch({inTime:'21:02',outTime:'05:00'})],duties:[duty()],lockedDays:locked})),['shift-mismatch']);
});

test('late come, early going and miss punch go to Attendance Regularization',()=>{
 const r=compareAttendance({punches:[punch({inTime:'05:40',outTime:'12:20'})],duties:[duty()],lockedDays:locked});
 assert.deepEqual(types(r),['early-going','late-come']);
 assert.equal(r.lines.find(l=>l.type==='late-come').lateMinutes,40);
 assert.equal(r.lines.find(l=>l.type==='early-going').earlyMinutes,40);
 // Night shift crossing midnight: In 21:10, Out 05:00 the next morning is on time.
 assert.deepEqual(compareAttendance({punches:[punch({inTime:'21:10',outTime:'05:00'})],duties:[duty({shift:'S3'})],lockedDays:locked}).lines,[]);
 assert.deepEqual(types(compareAttendance({punches:[punch({outTime:''})],duties:[duty()],lockedDays:locked})),['miss-punch']);
});

test('shift of a punch follows the site Shift Master',()=>{
 assert.equal(shiftOfPunch('04:10','Majri OC'),'S1');
 assert.equal(shiftOfPunch('12:50','Sasti OC'),'S2');
 assert.equal(shiftOfPunch('20:40',''),'S3');
});

test('steps 1 and 2 count each kind by site and by date and shift',()=>{
 const {lines}=compareAttendance({punches:[punch({caliberCode:'9'}),punch({caliberCode:'8',site:'Majri OC'})],duties:[duty(),duty({caliberCode:'7',site:'Majri OC',shift:'S2'})],lockedDays:[...locked,'majri ob|2026-11-18']});
 const sites=mismatchSites(lines,MISMATCH_TYPES);
 assert.deepEqual(sites.map(s=>[s.site,s.total,s['no-biometric'],s['no-trip-card']]),[['Majri OC',2,1,1],['Sasti OC',2,1,1]]);
 assert.equal(mismatchShifts(lines.filter(l=>l.siteKey==='majri ob'),MISMATCH_TYPES).length,2);
});

test('an uploaded line must be readable and inside the login sites',()=>{
 const all={sites:null},sasti={sites:['sasti ob']};
 assert.ok(biometricLine(punch(),all).line);
 assert.match(biometricLine(punch({site:'Majri OC'}),sasti).error,/not assigned/);
 assert.match(biometricLine(punch({site:''}),sasti).error,/site missing/);
 assert.ok(biometricLine(punch({site:''}),all).line);
 assert.match(biometricLine(punch({inTime:'',outTime:''}),all).error,/no In or Out/);
 assert.match(biometricLine(punch({date:'2026-13-01'}),all).error,/date/);
});

test('the attendance pages follow the Reports right and sit in their own main menus',()=>{
 const session=allowed=>({permissions:{separateMisCredentials:true,misDesktopAccess:allowed,misMobileAccess:[]}});
 assert.equal(misPageAllowed(session(['Reports']),'Mismatch attendance','desktop'),true);
 assert.equal(misPageAllowed(session(['Dashboard']),'Miss punch','desktop'),false);
 const main=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/\{name:'Attendance Management',pages:\['Biometric integration','Mismatch attendance'\]/);
 assert.match(main,/\{name:'Attendance Regularization',pages:\['Late come \/ early going','Miss punch'\]/);
});

test('biometric punches are saved, replaced on a second upload and read back inside the login sites',async t=>{
 const [{PGlite},{default:express},{createServer}]=await Promise.all([import('@electric-sql/pglite'),import('express'),import('node:http')]);
 const {registerBiometricAttendance}=await import('../server/routes/biometric-attendance.mjs');
 const db=new PGlite();t.after(()=>db.close());
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 let scope={sites:null};
 const app=express();app.use(express.json());
 registerBiometricAttendance(app,{pool,protect:[(req,_res,next)=>{req.session={login:'tester'};req.logBookScope=scope;next();}]});
 app.use((error,_req,res,_next)=>res.status(500).json({error:error.message}));
 const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,body)=>{const r=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return {status:r.status,body:await r.json()};};
 assert.equal((await call('/api/reports/biometric-punches',{fileName:'a.xlsx',rows:[punch(),punch({caliberCode:'7',site:'Majri OC'}),punch({caliberCode:'8',site:''})]})).body.saved,3);
 assert.equal((await call('/api/reports/biometric-punches',{fileName:'b.xlsx',rows:[punch({inTime:'05:20'})]})).body.saved,1);
 let read=await call('/api/reports/biometric-punches?from=2026-11-18&to=2026-11-18');
 assert.deepEqual(read.body.punches.map(p=>[p.caliberCode,p.inTime,p.site,p.sourceFile]).sort(),[['5311','05:20','Sasti OC','b.xlsx'],['7','05:05','Majri OC','a.xlsx'],['8','05:05','','a.xlsx']]);
 scope={sites:['sasti ob']};
 read=await call('/api/reports/biometric-punches?from=2026-11-18&to=2026-11-18');
 assert.deepEqual(read.body.punches.map(p=>p.caliberCode),['5311']);
 const refused=await call('/api/reports/biometric-punches',{rows:[punch({site:'Majri OC'})]});
 assert.equal(refused.status,400);assert.match(refused.body.refused[0],/not assigned/);
 assert.equal((await call('/api/reports/biometric-punches?from=2026-11-01&to=2026-12-31')).status,400);
});
