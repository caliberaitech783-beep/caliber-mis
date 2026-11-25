// Attendance Sheet Mismatch › HR sheet vs Biometric (owner, 25 Nov 2026): the attendance Excel HR makes by hand against
// the biometric HR Pulse holds (or a device file). Every ID and name here is made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {parseAttendanceSheet} from '../shared/attendance-sheet-check.mjs';
import {dayKind,hrSheetBiometricCheck,hrSheetBiometricWorkbook,hrSheetRange,hrPersonDays,HR_KINDS,HR_FILLS} from '../shared/hr-sheet-biometric.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {runHrSheetBiometricCheck} from '../src/hr-sheet-biometric-run.mjs';

const day=n=>new Date(Date.UTC(2026,10,n));
const iso=n=>'2026-11-'+String(n).padStart(2,'0');
const SITE='Sasti OC';
const SHEET=parseAttendanceSheet([
 ['HR ATTENDANCE NOV 2026'],
 ['SR NO','EMP. ID','NAME','DESIGNATION',day(1),day(2),day(3),day(4)],
 [1,'CMPL801001','RAM KUMAR','TIPPER DRIVER','P','P','P','A'],
 [2,'CMPL801002','SITA DEVI','CLERK','P','WO','P','L'],
 [3,'CMPL801003','MOHAN','HELPER','P','P','X',null],
 [4,'CMPL809999','NOBODY','HELPER','P','A','A','A'],
 [5,'CMPL801005','OLD NAME','SUPERVISOR','A','A','A','A'],
]);
const bio=(n,date,o={})=>({caliberCode:String(n),date,inTime:'07:00',outTime:'15:00',site:SITE,source:'machine',...o});
const DAYS=[
 bio(801001,iso(1)),bio(801001,iso(2),{outTime:''}),bio(801001,iso(4)),             // 1 same, 2 miss punch, 3 no punch, 4 A with a punch
 bio(801002,iso(1),{inTime:'',outTime:'',presentByHr:true,corrected:{by:'hr1',reason:'machine down'}}), // P by HR's word
 bio(801002,iso(3),{site:'Jayant OCP'}),                                              // P, punched at another site
 bio(801003,iso(1)),bio(801003,iso(2)),bio(801003,iso(3)),                           // X is not compared
 bio(801005,iso(2)),                                                                  // A with a punch
 bio(801099,iso(1)),bio(801099,iso(2)),                                               // punched, not in the sheet
];
const PEOPLE=[
 {number:'801001',found:true,name:'RAM KUMAR',designation:'TIPPER DRIVER',siteLabel:SITE,atSite:true,working:true},
 {number:'801002',found:true,name:'SITA DEVI',designation:'CLERK',siteLabel:SITE,atSite:true,working:true},
 {number:'801003',found:true,name:'MOHAN',designation:'HELPER',siteLabel:SITE,atSite:true,working:true},
 {number:'801005',found:true,name:'ANIL VERMA',designation:'SUPERVISOR',siteLabel:SITE,atSite:true,working:true},
 {number:'801099',found:true,name:'EXTRA MAN',designation:'HELPER',siteLabel:SITE,atSite:true,working:true},
];
const CARDS=[{employeeId:'CMPL801001',date:iso(3),site:SITE,siteKey:SITE,shift:'S2',logBooks:['VLB']}];

test('a day: the HR mark beside the punch, as the owner chose',()=>{
 const full={inTime:'07:00',outTime:'15:00'};
 assert.equal(dayKind('P',{here:full}),'');
 assert.equal(dayKind('P',{here:{inTime:'07:00',outTime:''}}),'missPunch');
 assert.equal(dayKind('P',{here:{inTime:'',outTime:'',presentByHr:true}}),'','a day HR marked present is not a miss punch');
 assert.equal(dayKind('P',{away:full}),'away');
 assert.equal(dayKind('P',{}),'noPunch');
 for(const mark of ['A','WO','L','CO','H','-',''])assert.equal(dayKind(mark,{}),'',mark+' with no punch is the same in both');
 for(const mark of ['A','WO','L',''])assert.equal(dayKind(mark,{here:full}),'punchNotP',mark+' with a punch');
 assert.equal(dayKind('A',{away:full}),'','a punch elsewhere is not a punch at this site');
 assert.equal(dayKind('X',{here:full}),'skip');
});

test('the HR sheet against the biometric: every person, every kind, ID and name, punched not in sheet, trip card shown only',()=>{
 const r=hrSheetBiometricCheck({sheet:SHEET,site:SITE,days:DAYS,people:PEOPLE,lines:CARDS,from:iso(1),to:iso(4)});
 assert.deepEqual(r.dates.compared,[iso(1),iso(2),iso(3),iso(4)]);
 assert.deepEqual(r.counts,{noPunch:2,missPunch:1,away:1,punchNotP:2});
 const ram=r.rows.find(x=>x.number==='801001');
 assert.deepEqual(ram.cells.map(c=>c.kind),['','missPunch','noPunch','punchNotP']);
 assert.equal(ram.cells[2].card,'VLB · Shift B','the trip card is shown beside the day');
 assert.equal(ram.noPunch,1,'a trip card does not turn a missing punch into a match');
 const sita=r.rows.find(x=>x.number==='801002');
 assert.deepEqual(sita.cells.map(c=>c.kind),['','','away','']);
 assert.match(sita.cells[0].hrCorrection,/Corrected in HR by hr1: machine down/);
 assert.deepEqual(r.rows.find(x=>x.number==='801003').cells.map(c=>c.kind),['','','skip','']);
 assert.deepEqual(r.rows.find(x=>x.number==='809999').cells.map(c=>c.kind),['noPunch','','',''],'an ID not in the master is still compared by its number');
 assert.deepEqual(r.issues.map(i=>i.kind).sort(),['id-not-found','name-other']);
 assert.deepEqual(r.notInSheet.map(p=>[p.id,p.days]),[['CMLL801099',2]]);
 const d1=r.byDate.find(d=>d.date===iso(1));
 assert.deepEqual([d1.sheetP,d1.punched,d1.same,d1.total],[4,3,3,1],'P: Ram, Sita, Mohan, Nobody · punched and same: Ram, Sita (HR present), Mohan · Nobody has no punch');
});

test('the dates: marked dates up to today, at most 31',()=>{
 assert.deepEqual(hrSheetRange(SHEET,iso(3)),{from:iso(1),to:iso(3),cut:false});
 assert.equal(hrSheetRange(SHEET,'2026-10-31'),null);
});

test('the Excel: the HR sheet coloured, mismatches, ID and name, punched not in sheet, summary',()=>{
 const r=hrSheetBiometricCheck({sheet:SHEET,site:SITE,days:DAYS,people:PEOPLE,lines:CARDS,from:iso(1),to:iso(4)});
 const book=hrSheetBiometricWorkbook(r,{fileName:'hr.xlsx',bioLabel:'held'});
 assert.deepEqual(book.sheets.map(s=>s.name),['HR sheet checked','Mismatches','ID and name','Punched, not in sheet','Summary']);
 const first=book.sheets[0],ramAt=r.rows.findIndex(x=>x.number==='801001');
 assert.deepEqual(first.cellFills[ramAt],{7:'missPunch',8:'noPunch',9:'punchNotP'});
 assert.equal(book.sheets[1].rows.length,r.lines.length);
 for(const k of HR_KINDS)assert.ok(HR_FILLS[k.key],k.key);
 assert.ok(buildXlsxSheetsWorkbook(book.title,book.sheets),'the workbook builds');
 assert.equal(hrPersonDays(r.rows[0]).at(1).result,'HR sheet P, miss punch (IN or OUT missing)');
});

test('the run: punches held in Pulse-II, or a device file; a trip card read that fails does not stop the check',async()=>{
 const asked=[];
 const read=async(url,session,options={})=>{
  asked.push(url.split('?')[0]);
  if(url.startsWith('/api/reports/manpower/attendance?'))throw Error('slow');
  if(url.endsWith('/biometric')){const body=JSON.parse(options.body);assert.deepEqual([body.from,body.to,body.source],[iso(1),iso(4),'machine']);assert.ok(body.numbers.includes('801001'));
   return {days:DAYS,machine:{asked:true,connected:true,punches:20},imported:{asked:false}};}
  if(url.endsWith('/people')){const body=JSON.parse(options.body);assert.ok(body.ids.includes('801099'),'the people who punched and are not on the sheet are asked about');return {site:SITE,people:PEOPLE};}
  throw Error('unexpected '+url);
 };
 const done=await runHrSheetBiometricCheck({sheet:SHEET,fileName:'hr.xlsx',site:SITE,source:'machine',session:{token:'t'},today:iso(10),read,build:()=>'blob'});
 assert.equal(done.cardsError,'slow');assert.equal(done.result.counts.noPunch,2);
 assert.equal(done.name,'HR-sheet-vs-biometric-Sasti-OC-2026-11-01-to-2026-11-04.xlsx');
 const fileRun=await runHrSheetBiometricCheck({sheet:SHEET,fileName:'hr.xlsx',site:SITE,bio:{days:DAYS.map(d=>({...d,site:''})),punches:30},bioName:'attlog.dat',session:{token:'t'},today:iso(10),
  read:async url=>{assert.ok(!url.endsWith('/biometric'),'a device file needs no punch read');return url.endsWith('/people')?{site:SITE,people:PEOPLE}:{otDuties:[],attendanceEquipment:[]};},build:()=>'blob'});
 assert.equal(fileRun.result.counts.away,0,'a device file has no site: every punch is at the chosen site');
});

test('the screen: two checks on the tab, HR sheet first, the steps in the report step style',()=>{
 const page=fs.readFileSync(new URL('../src/hr-sheet-biometric.jsx',import.meta.url),'utf8');
 assert.match(page,/MODES=\[\{key:'hr',label:'HR sheet vs Biometric'[\s\S]*?\{key:'trip',label:'Trip card vs Biometric'/);
 assert.match(page,/useState\('hr'\)/,'HR sheet vs Biometric opens first');
 assert.match(page,/from '\.\/date-shift-grid\.jsx'/);assert.match(page,/<DateShiftGrid grid=\{grid\}/);
 for(const n of [1,2,3,4])assert.match(page,new RegExp("title=\\{'Step "+n+' · '),'Step '+n);
 assert.match(page,/'Step 2 · '[^\n]* · date by shift · '/);
 assert.match(page,/accept="\.xlsx,\.xlsm"/);assert.match(page,/accept="\.dat,\.txt,\.csv,\.xlsx,\.xlsm"/);
 assert.match(page,/Nothing is changed in Pulse-II/);
});
