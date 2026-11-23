// Trip card attendance, card by card (owner, 24 Nov 2026): log book tabs, batch, From / To, OK cards counted and only the
// cards that need attention listed, against the site sheet and against the bio-punch. Every ID and name is made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {parseAttendanceSheet} from '../shared/attendance-sheet-check.mjs';
import {cardAttendances,selectCards,batchChoices,logBookCounts,judgeCards,cardSummary,punchDays,sheetMarks} from '../shared/trip-card-attendance.mjs';
import {readSiteSheetData,siteSheetView,siteSheetWorkbook,runSiteSheetCheck} from '../src/site-sheet-run.mjs';
import {readBioPunchData,bioPunchView,bioPunchSummary,bioPunchWorkbook,defaultRange,rangeProblem} from '../src/trip-card-biopunch-run.mjs';
import {cardSource} from '../server/rules/manpower-report.mjs';
import {operationReports} from '../src/operations-report-model.mjs';

const day=n=>new Date(Date.UTC(2026,10,n));
const iso=n=>'2026-11-'+String(n).padStart(2,'0');
const SITE='Sasti OC',KEY='sasti ob';
const SHEET=[
 ['SR NO','EMP. ID','NAME','DESIGNATION',day(1),day(2),day(3)],
 [1,'CMPL903001','RAM DRIVER','TIPPER DRIVER','P','P','P'],
 [2,'CMPL903002','SHYAM DRIVER','TIPPER DRIVER','P','A','P'],
 [3,'CMPL903003','GOPAL OPERATOR','DOZER OPERATOR','P','P',null],
];
const master=(number,name)=>({number:String(number),found:true,name,designation:'TIPPER DRIVER',siteLabel:SITE,atSite:true,working:true,left:false});
const PEOPLE=[master(903001,'RAM DRIVER'),master(903002,'SHYAM DRIVER'),master(903003,'GOPAL OPERATOR'),master(903004,'HARI DRIVER')];
const duty=(number,n,shift,o={})=>({date:iso(n),shift,site:SITE,siteKey:KEY,caliberCode:'CMLL'+number,employeeId:'CMLL'+number,employeeName:'N'+number,books:'TC'+number+'-'+n,doors:'V'+number%10,
 logBooks:['VLB'],source:'scanned',batches:'VLB-B'+n,...o});
const LINES=[
 duty(903001,1,'S1'),duty(903001,2,'S1',{source:'manual'}),duty(903001,3,'S1'),
 duty(903002,1,'S2'),duty(903002,2,'S2'),duty(903002,3,'S2'),                  // 2 Nov: A in the sheet
 duty(903003,1,'S1',{logBooks:['ELB'],batches:'ELB-B1'}),duty(903003,2,'S1',{logBooks:['ELB'],batches:'ELB-B2'}),duty(903003,3,'S1',{logBooks:['ELB'],batches:'ELB-B3'}), // 3 Nov blank
 duty(903004,2,'S3',{logBooks:['LMV'],source:'zero-trip',batches:'',books:''}),  // not in the sheet
];
const LOCKED=[1,2,3].map(n=>KEY+'|'+iso(n));
const read=async url=>url.includes('/people')?{site:SITE,people:PEOPLE,sitePeople:[]}:{otDuties:LINES,attendanceEquipment:[],lockedDays:LOCKED};

test('the server says how a duty came in: scanned, manual, both, or a zero-trip entry',()=>{
 assert.equal(cardSource([{data:{scanCardId:'9'}}]),'scanned');
 assert.equal(cardSource([{data:{}}]),'manual');
 assert.equal(cardSource([{data:{scanCardId:'9'}},{data:{}}]),'scanned+manual');
 assert.equal(cardSource([]),'zero-trip');
});

test('one attendance per person, date and shift, with its log book tab and batch',()=>{
 const cards=cardAttendances(LINES,{site:SITE,from:iso(1),to:iso(3)});
 assert.equal(cards.length,10);
 assert.deepEqual(logBookCounts(cards),{'':10,VLB:6,ELB:3,LMV:1});
 assert.equal(selectCards(cards,{logBook:'ELB'}).length,3);
 assert.deepEqual(batchChoices(cards,'VLB').map(b=>[b.value,b.count]),[['VLB-B1',2],['VLB-B2',2],['VLB-B3',2]]);
 assert.equal(selectCards(cards,{logBook:'VLB',batch:'VLB-B2'}).length,2);
 assert.equal(selectCards(cards,{logBook:'LMV',batch:'(no batch)'}).length,1);
 assert.equal(cardAttendances(LINES,{site:SITE,from:iso(2),to:iso(2)}).length,4,'From / To keep the dates between');
});

test('Site Sheet vs Trip Card: OK cards are counted, only the ones that need attention listed with the problem',async()=>{
 const sheet=parseAttendanceSheet(SHEET);
 const data=await readSiteSheetData({sheet,site:SITE,session:{token:'T'},today:iso(23),read});
 const all=siteSheetView({sheet,data,site:SITE,today:iso(23)});
 assert.deepEqual([all.summary.total,all.summary.ok,all.summary.attention],[10,7,3]);
 const bad=all.judged.filter(c=>!c.ok).map(c=>[c.number,c.date,c.issues.join()]);
 assert.deepEqual(bad.sort(),[['903002',iso(2),'sheet-not-p'],['903003',iso(3),'sheet-blank'],['903004',iso(2),'not-in-sheet']].sort());
 const vlb=siteSheetView({sheet,data,site:SITE,logBook:'VLB',today:iso(23)});
 assert.deepEqual([vlb.summary.total,vlb.summary.ok,vlb.summary.attention],[6,5,1]);
 assert.ok(vlb.lines.every(l=>l.kind!=='noCard'),'"Sheet P, no trip card" has no log book');
 const day1=siteSheetView({sheet,data,site:SITE,from:iso(1),to:iso(1),today:iso(23)});
 assert.deepEqual([day1.summary.total,day1.summary.attention],[3,0]);
 assert.deepEqual(day1.result.dates.compared,[iso(1)]);
 const book=siteSheetWorkbook(vlb,{fileName:'site.xlsx',build:(title,sheets)=>({title,sheets}),checkedAt:'x'});
 assert.deepEqual(book.blob.sheets.slice(0,3).map(s=>s.name),['Attendance check','Needs attention','OK cards']);
 assert.equal(book.blob.sheets[1].rows.length,1);assert.equal(book.blob.sheets[2].rows.length,5);
 assert.match(book.name,/^Site-sheet-vs-trip-card-Sasti-OC-VLB-2026-11-01-to-2026-11-03\.xlsx$/);
 const done=await runSiteSheetCheck({sheet,fileName:'site.xlsx',site:SITE,session:{token:'T'},today:iso(23),read,build:(title,sheets)=>({title,sheets})});
 assert.equal(done.view.summary.total,10);
});

test('Trip Card vs Bio-punch: each card beside its punch, the other way, and the summary of how attendance came in',async()=>{
 const punches=[
  {caliberCode:'903001',date:iso(1),inTime:'06:00',outTime:'14:05',site:SITE,source:'machine'},
  {caliberCode:'903001',date:iso(2),inTime:'06:02',outTime:'',site:SITE,source:'machine'},          // miss punch
  {caliberCode:'903002',date:iso(1),inTime:'14:00',outTime:'22:00',site:'Majri OC',source:'machine'}, // punched at another site
  {caliberCode:'903005',date:iso(2),inTime:'06:00',outTime:'14:00',site:SITE,source:'imported'},      // punched, no trip card
 ];
 const calls=[];
 const reader=async(url,session,options)=>{calls.push(url);
  if(url.includes('/biometric'))return {days:punches,machine:{asked:true,connected:true},imported:{asked:true}};
  if(url.includes('/people'))return {site:SITE,people:[...PEOPLE,master(903005,'NEW DRIVER')]};
  return {otDuties:LINES,attendanceEquipment:[],lockedDays:LOCKED};};
 const data=await readBioPunchData({site:SITE,from:iso(1),to:iso(3),session:{token:'T'},read:reader});
 assert.equal(calls.length,3);
 const view=bioPunchView({data,today:iso(23)});
 assert.deepEqual([view.summary.total,view.summary.ok,view.summary.attention],[10,1,9]);
 const of=(n,d)=>view.judged.find(c=>c.number===String(n)&&c.date===iso(d)).issues.join();
 assert.equal(of(903001,1),'');assert.equal(of(903001,2),'miss-punch');assert.equal(of(903002,1),'punch-other-site');assert.equal(of(903001,3),'no-punch');
 assert.equal(view.summary.sources.scanned,8);assert.equal(view.summary.sources.manual,1);assert.equal(view.summary.sources['zero-trip'],1);
 assert.equal(view.punchOnly.length,1);assert.equal(view.punchOnly[0].caliberCode,'903005');
 const rows=Object.fromEntries(bioPunchSummary(view).map(r=>[r.id,r.value]));
 assert.equal(rows.withBio,1);assert.equal(rows['no-punch'],7);assert.equal(rows['no-trip-card'],1);assert.equal(rows.locked,3);
 const vlb=bioPunchView({data,logBook:'VLB',today:iso(23)});
 assert.equal(vlb.summary.total,6);assert.equal(vlb.punchOnly.length,0);
 assert.equal(Object.fromEntries(bioPunchSummary(vlb).map(r=>[r.id,r.value]))['no-trip-card'],'—');
 const book=bioPunchWorkbook(vlb,{build:(title,sheets)=>({title,sheets}),checkedAt:'x'});
 assert.deepEqual(book.blob.sheets.map(s=>s.name),['Summary','Needs attention','OK cards','Every difference','Per employee']);
});

test('the dates first offered and the limits',()=>{
 assert.deepEqual(defaultRange('2026-11-24'),{from:'2026-11-01',to:'2026-11-23'});
 assert.deepEqual(defaultRange('2026-12-01'),{from:'2026-11-01',to:'2026-11-30'});
 assert.equal(rangeProblem('2026-11-01','2026-12-05','2026-12-10'),'Select up to 31 days.');
 assert.equal(rangeProblem('2026-11-05','2026-11-01','2026-12-10'),'To is before From.');
 assert.equal(rangeProblem('2026-11-01','2026-11-20','2026-11-24'),'');
});

test('Trip Card vs Bio-punch is the tab after Site Sheet vs Trip Card, with log book tabs on both',()=>{
 const ids=operationReports.map(r=>r.id);
 assert.equal(ids.indexOf('attendance-trip-bio'),ids.indexOf('attendance-site-sheet')+1);
 const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
 assert.match(read('../src/manpower-reports.jsx'),/tripBio\?<TripCardBioPunch session=\{session\} ReportSection=\{ReportSection\}\/>/);
 for(const page of ['../src/site-sheet-trip-card.jsx','../src/trip-card-biopunch.jsx'])assert.match(read(page),/<TripCardFilters /);
});
