// Owner, 25 Nov 2026: a day HR corrected on Attendance roster › Manual Biometric shows in Pulse-II's Biometric vs trip
// card mismatch, and the morning Out of a night duty that began the day before the first date is not a day of its own.
// The people and numbers are made up.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {machineDays,mergeBiometricDays,importedDays,hrCorrections,sourceLabelOf,correctionText} from '../shared/trip-biometric-check.mjs';
import {compareAttendance} from '../shared/attendance-mismatch.mjs';
import {readHrPunchesWithDayBefore,joinPunchAnswers,dayBefore} from '../server/services/hr-machine-punches.mjs';
import {readBiometricDays} from '../server/routes/attendance-sheet-check.mjs';

const SITE='Dhoptala OC (2nd)';
const fix=(date,code,status,inT,outT,reason='Forgot to punch',by='hr.admin')=>[0,date,code,status,inT,outT,reason,by];

test('a corrected night replaces its own day and the next morning\'s lone Out',()=>{
 const answer={sites:[SITE],punches:[['','17462','2026-11-01 04:47',0,'1']],corrections:[fix('2026-10-31','CMLL17462','','20:00','04:47')]};
 const {days}=machineDays(answer);
 assert.equal(days.length,1);
 assert.deepEqual({date:days[0].date,inTime:days[0].inTime,outTime:days[0].outTime,site:days[0].site},{date:'2026-10-31',inTime:'20:00',outTime:'04:47',site:SITE});
 assert.equal(days[0].corrected.by,'hr.admin');
 // Without the correction the Out stood alone on 01-11.
 assert.deepEqual(machineDays({...answer,corrections:[]}).days.map(d=>[d.date,d.inTime,d.outTime]),[['2026-11-01','','04:47']]);
});

test('a next-morning duty well after the corrected Out stays its own day',()=>{
 const answer={sites:[SITE],punches:[['CMLL5','5','2026-11-01 13:58',0,'0'],['CMLL5','5','2026-11-01 22:02',0,'1']],corrections:[fix('2026-10-31','CMLL5','','20:00','04:30')]};
 const days=machineDays(answer).days.sort((a,b)=>a.date.localeCompare(b.date));
 assert.deepEqual(days.map(d=>[d.date,d.inTime,d.outTime,Boolean(d.corrected)]),[['2026-10-31','20:00','04:30',true],['2026-11-01','13:58','22:02',false]]);
});

test('a day corrected to a not-at-work code has no biometric day; P with no time is not a miss punch',()=>{
 const answer={sites:[SITE],punches:[['CMLL7','7','2026-11-03 06:01',0,'0'],['CMLL8','8','2026-11-03 06:03',0,'0']],
  corrections:[fix('2026-11-03','CMLL7','L','',''),fix('2026-11-03','8','P','','')]};
 const days=machineDays(answer).days;
 assert.deepEqual(days.map(d=>d.caliberCode),['8']);
 assert.equal(days[0].presentByHr,true);
 const {lines}=compareAttendance({punches:days,duties:[],from:'2026-11-03',to:'2026-11-03'});
 assert.equal(lines.filter(l=>l.type==='miss-punch').length,0);
 // Without the correction the lone In is a miss punch.
 assert.equal(compareAttendance({punches:machineDays({...answer,corrections:[]}).days,duties:[],from:'2026-11-03',to:'2026-11-03'}).lines.filter(l=>l.type==='miss-punch').length,2);
});

test('bad correction lines are left out',()=>{
 assert.equal(hrCorrections({sites:[SITE],corrections:[[0,'2026-11-03','','P','',''],[0,'03-11-2026','CMLL1','P','',''],[0,'2026-11-03','CMLL1','','25:00',''],'x']}).size,0);
});

test('the imported punches of a corrected day do not undo the correction',()=>{
 const machine=machineDays({sites:[SITE],punches:[],corrections:[fix('2026-11-02','CMLL9','','08:00','20:00')]}).days;
 const imported=importedDays([{caliberCode:'CMLL9',date:'2026-11-02',inTime:'06:10',outTime:'21:30',site:SITE}]);
 for(const order of [[machine,imported],[imported,machine]]){
  const [day]=mergeBiometricDays(...order);
  assert.deepEqual([day.inTime,day.outTime,day.source],['08:00','20:00','machine+imported']);
  assert.equal(sourceLabelOf(day),'Machine + Imported · corrected in HR');
  assert.equal(correctionText(day),'Corrected in HR by hr.admin: Forgot to punch');
 }
});

test('HR Pulse is asked from the day before, so a night Out on the first date is not a day of it',async()=>{
 const asked=[];
 const hrPunches=async range=>{asked.push(range);return {sites:[SITE],punches:[['','17462','2026-10-31 19:56',0,'0'],['','17462','2026-11-01 04:47',0,'1']],corrections:[]};};
 const pool={query:async()=>({rows:[]})};
 const read=await readBiometricDays({pool,hrPunches,site:SITE,from:'2026-11-01',to:'2026-11-20'});
 assert.deepEqual(asked,[{from:'2026-10-31',to:'2026-11-20'}]);
 assert.deepEqual(read.days,[]);
});

test('31 dates asked: the day before is a second read, only what falls before the first date is kept',async()=>{
 const asked=[];
 const hrPunches=async range=>{asked.push(range);
  if(range.from===range.to)return {sites:['Other',SITE],punches:[['','3','2026-10-31 20:00',1,'0'],['','3','2026-11-01 04:40',1,'1']],corrections:[[1,'2026-10-31','3','','20:00','04:40','r','b'],[1,'2026-11-01','3','P','','','r','b']]};
  return {sites:[SITE],punches:[['','3','2026-11-01 04:40',0,'1']],corrections:[]};};
 const answer=await readHrPunchesWithDayBefore(hrPunches,{from:'2026-11-01',to:'2026-12-01'});
 assert.deepEqual(asked,[{from:'2026-11-01',to:'2026-12-01'},{from:'2026-10-31',to:'2026-10-31'}]);
 assert.deepEqual(answer.sites,[SITE]);
 assert.deepEqual(answer.punches,[['','3','2026-11-01 04:40',0,'1'],['','3','2026-10-31 20:00',0,'0']]);
 assert.deepEqual(answer.corrections,[[0,'2026-10-31','3','','20:00','04:40','r','b']]);
 assert.deepEqual(machineDays(answer).days.map(d=>[d.date,d.inTime,d.outTime]),[['2026-10-31','20:00','04:40']]);
 assert.equal(dayBefore('2026-03-01'),'2026-02-28');
 assert.deepEqual(joinPunchAnswers({sites:['A'],punches:[]},{sites:['A'],punches:[['','1','2026-11-01 06:00',0,'0']]}).punches,[['','1','2026-11-01 06:00',0,'0']]);
});
