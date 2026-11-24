// Site Sheet vs Trip Card, one log book at a time (owner, 24 Nov 2026): "3 tabs to select the VLB, ELB and LMV sheets,
// process and upload differently; the user selects the category of file to upload and the same way it fetches the result".
// A sheet uploaded as VLB is compared with VLB trip cards only; a P whose trip card is in another log book is listed
// apart, neither a match nor a missing card. Every ID and name is made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {parseAttendanceSheet,BOOK_FILL,SHEET_FILLS,SHEET_LEGEND} from '../shared/attendance-sheet-check.mjs';
import {SHEET_BOOKS,UNKNOWN_SHIFT,personDays,otherBookRows,wrongTab} from '../shared/site-sheet-days.mjs';
import {lineBooks,linesOfBook,readSiteSheetData,siteSheetView,siteSheetWorkbook,runSiteSheetCheck} from '../src/site-sheet-run.mjs';
import {operationReports} from '../src/operations-report-model.mjs';

const day=n=>new Date(Date.UTC(2026,10,n));
const iso=n=>'2026-11-'+String(n).padStart(2,'0');
const SITE='Sasti OC',KEY='sasti ob';
const SHEET=[
 ['SR NO','EMP. ID','NAME','DESIGNATION',day(1),day(2),day(3)],
 [1,'CMPL904001','RAM DRIVER','TIPPER DRIVER','P','P','P'],     // VLB cards on 1 and 2 Nov; 3 Nov: P, no card anywhere
 [2,'CMPL904002','SHYAM DRIVER','TIPPER DRIVER','P','A','P'],   // VLB cards on 1 and 2 Nov (2 Nov: A in the sheet); 3 Nov on an ELB card
 [3,'CMPL904003','GOPAL OPERATOR','DOZER OPERATOR','P','P','P'],// ELB cards on 1 and 2 Nov; 3 Nov: P, no card anywhere
 [4,'CMPL904004','MOHAN DRIVER','LMV DRIVER','P','-','P'],      // 1 Nov: zero-trip entry on an LMV machine; 3 Nov: zero-trip entry, no machine
];
const master=(number,name)=>({number:String(number),found:true,name,designation:'',siteLabel:SITE,atSite:true,working:true,left:false});
const PEOPLE=[master(904001,'RAM DRIVER'),master(904002,'SHYAM DRIVER'),master(904003,'GOPAL OPERATOR'),master(904004,'MOHAN DRIVER'),master(904005,'HARI DRIVER')];
const duty=(number,n,shift,o={})=>({date:iso(n),shift,site:SITE,siteKey:KEY,caliberCode:'CMLL'+number,employeeId:'CMLL'+number,employeeName:'N'+number,books:'TC'+number+'-'+n,doors:'V'+number%10,
 logBooks:['VLB'],source:'scanned',batches:'VLB-B'+n,...o});
const elb=n=>({logBooks:['ELB'],batches:'ELB-B'+n});
const DUTIES=[
 duty(904001,1,'S1'),duty(904001,2,'S1'),
 duty(904002,1,'S2'),duty(904002,2,'S2'),duty(904002,3,'S1',elb(3)),
 duty(904003,1,'S1',elb(1)),duty(904003,2,'S1',elb(2)),
 duty(904005,2,'S3'),                                            // a VLB card of a person who is not in the sheet
];
// What the server sends for a zero-trip entry: no card, so no log book; machineBook is the log book of its machine.
const zero=(number,n,machineBook)=>({date:iso(n),shift:'S1',site:SITE,siteKey:KEY,caliberCode:'CMLL'+number,employeeId:'CMLL'+number,employeeName:'N'+number,equipment:'CAMPER',doors:'L1',logBooks:[],source:'zero-trip',batches:'',machineBook});
const ZERO=[zero(904004,1,'LMV'),zero(904004,3,'')];
const LOCKED=[1,2,3].map(n=>KEY+'|'+iso(n));
const SITE_PEOPLE=[{number:'904099',name:'OFFICE STAFF',designation:'CLERK'}];
const read=async url=>url.includes('/people')?{site:SITE,people:PEOPLE,sitePeople:SITE_PEOPLE}:{otDuties:DUTIES,attendanceEquipment:ZERO,lockedDays:LOCKED};
const views=async()=>{
 const sheet=parseAttendanceSheet(SHEET),data=await readSiteSheetData({sheet,site:SITE,session:{token:'T'},today:iso(23),read});
 return Object.fromEntries(SHEET_BOOKS.map(b=>[b.key,siteSheetView({sheet,data,site:SITE,sheetBook:b.key,today:iso(23)})]));
};
const rowOf=(view,id)=>view.result.rows.find(r=>r.id===id);

test('the three tabs are VLB, ELB and LMV, and a duty line is placed in the log book of its card or of its machine',()=>{
 assert.deepEqual(SHEET_BOOKS.map(b=>[b.key,b.label]),[['VLB','VLB sheet'],['ELB','ELB sheet'],['LMV','LMV sheet']]);
 assert.deepEqual(lineBooks({logBooks:['VLB','ELB']}),['VLB','ELB']);
 assert.deepEqual(lineBooks({logBook:'VLB + ELB'}),['VLB','ELB']);
 assert.deepEqual(lineBooks({logBooks:[],machineBook:'LMV'}),['LMV'],'a zero-trip entry takes the log book of its machine');
 assert.deepEqual(lineBooks({logBooks:[],machineBook:''}),[]);
 const {own,other}=linesOfBook([...DUTIES,...ZERO,duty(904009,1,'S1',{logBooks:['VLB','ELB']})],'ELB');
 assert.deepEqual(own.map(l=>[l.caliberCode,l.date]),[['CMLL904002',iso(3)],['CMLL904003',iso(1)],['CMLL904003',iso(2)],['CMLL904004',iso(3)],['CMLL904009',iso(1)]],
  'ELB cards, a card on two log books, and an entry with no log book at all (it counts under every log book)');
 assert.equal(other.length,6);
 assert.deepEqual(other.find(l=>l.source==='zero-trip').logBooks,['LMV']);
});

test('the VLB sheet is compared with VLB trip cards only, both ways',async()=>{
 const {VLB}=await views();
 assert.equal(VLB.result.logBook,'VLB');assert.equal(VLB.logBook,'VLB');
 // Trip cards against the sheet: only VLB cards (and the entry no log book can be given to) are judged.
 assert.deepEqual([VLB.summary.total,VLB.summary.ok,VLB.summary.attention],[6,4,2]);
 assert.deepEqual(VLB.judged.filter(c=>!c.ok).map(c=>[c.number,c.date,c.issues.join()]).sort(),[['904002',iso(2),'sheet-not-p'],['904005',iso(2),'not-in-sheet']]);
 assert.ok(VLB.cards.every(c=>!c.logBooks.length||c.logBooks.includes('VLB')));
 // The sheet against trip cards: "sheet P, no trip card" now belongs to this log book and is listed under it.
 assert.deepEqual(VLB.lines.map(l=>[l.id,l.date,l.kind,l.shift]),[['CMPL904002',iso(2),'card','B'],['CMPL904001',iso(3),'noCard',UNKNOWN_SHIFT]]);
 assert.deepEqual(VLB.batches.map(b=>b.value),['(no batch)','VLB-B1','VLB-B2'],'only the batches of this log book are offered');
 assert.equal(VLB.result.listedOnly.length,0,'a sheet of one log book is not meant to hold everyone of the site');
 assert.deepEqual(VLB.result.notInSheet.map(p=>p.number),['904005']);
});

test('a P whose trip card is in another log book is listed apart: not a match, not a missing card',async()=>{
 const {VLB}=await views();
 assert.deepEqual(otherBookRows(VLB.result).map(p=>[p.id,p.books,p.which,p.days,p.cardDays,p.noCardDays]),[
  ['CMPL904002','ELB','Some days',1,1,0],
  ['CMPL904003','ELB','Every trip card',3,2,1],
  ['CMPL904004','LMV','Some days',1,1,0]]);
 const operator=rowOf(VLB,'CMPL904003');
 assert.deepEqual([operator.elsewhere,operator.judge,operator.sheetP,operator.difference],[true,false,null,null],'every card of his is ELB: he is not compared under VLB');
 assert.match(operator.remark,/Days not compared under VLB: every trip card of this person is ELB\./);
 assert.deepEqual(operator.cells.map(c=>c.state),['book','book','book']);
 assert.deepEqual(personDays(operator).map(d=>[d.pulseSays,d.result]),[
  ['ELB card in Shift A','Sheet P, belongs to another log book'],['ELB card in Shift A','Sheet P, belongs to another log book'],['No trip card; his trip cards are ELB','Sheet P, belongs to another log book']]);
 const driver=rowOf(VLB,'CMPL904002');
 assert.deepEqual(driver.cells.map(c=>c.state),['','duty','book']);
 assert.deepEqual([driver.sheetP,driver.pulseP,driver.difference],[1,2,-1],'1 P day counted under VLB, 2 VLB card days; the ELB day is neither');
 assert.match(driver.remark,/P on 1 date with the trip card in ELB: not counted here\./);
 assert.equal(VLB.result.counts['no-duty'],1);assert.equal(VLB.result.corrections.some(c=>c.id==='CMPL904003'),false,'another log book is not a correction');
});

test('the same file under the ELB tab gives the ELB result: the operator is compared, the tipper drivers are listed apart',async()=>{
 const {ELB,LMV}=await views();
 assert.deepEqual([ELB.summary.total,ELB.summary.ok,ELB.summary.attention],[4,4,0]);
 assert.deepEqual(ELB.lines.map(l=>[l.id,l.date,l.kind]),[['CMPL904003',iso(3),'noCard']]);
 assert.deepEqual(otherBookRows(ELB.result).map(p=>[p.id,p.books,p.which,p.days]),[['CMPL904001','VLB','Every trip card',3],['CMPL904002','VLB','Some days',1],['CMPL904004','LMV','Some days',1]]);
 assert.deepEqual(ELB.batches.map(b=>b.value),['(no batch)','ELB-B1','ELB-B2','ELB-B3']);
 // LMV: the zero-trip entry on an LMV machine is an LMV attendance; the entry with no machine counts too.
 assert.deepEqual([LMV.summary.total,LMV.summary.ok],[2,2]);
 assert.deepEqual(LMV.judged.map(c=>[c.number,c.date,c.logBook,c.sourceLabel]),[['904004',iso(1),'LMV','Zero-trip entry (no card)'],['904004',iso(3),'Zero-trip','Zero-trip entry (no card)']]);
 assert.equal(LMV.lines.length,0);
});

test('the Excel of a log book names it, colours the other-log-book days and lists those people on their own sheet',async()=>{
 const {VLB}=await views();
 const book=siteSheetWorkbook(VLB,{fileName:'vlb.xlsx',build:(title,sheets)=>({title,sheets}),checkedAt:'x'});
 assert.equal(book.name,'Site-sheet-vs-trip-card-Sasti-OC-VLB-2026-11-01-to-2026-11-03.xlsx');
 assert.deepEqual(book.blob.sheets.map(s=>s.name),['Attendance check','Needs attention','OK cards','Date x shift','Trip card, sheet not P','Sheet P, no trip card','Another log book','Corrections','Not in sheet','Summary']);
 const [grid]=book.blob.sheets,other=book.blob.sheets[6],summary=book.blob.sheets.at(-1);
 assert.match(grid.headerRows[0],/^Sasti OC · VLB sheet · Attendance sheet mismatch · 01-11-2026 to 03-11-2026 · compared with VLB trip cards only · file: vlb\.xlsx/);
 assert.equal(grid.headerRows.length,SHEET_LEGEND.length+2);assert.match(grid.headerRows.at(-1),/^TEAL on a date = the sheet says P and Pulse-II has no VLB trip card/);
 assert.equal(grid.headerFills[SHEET_LEGEND.length+1],'book');assert.deepEqual(grid.fills,{...SHEET_FILLS,book:BOOK_FILL});
 assert.deepEqual(grid.cellFills[2],{7:'book',8:'book',9:'book'},'the operator: three teal days');
 assert.deepEqual(grid.cellFills[1],{8:'duty',9:'book'});
 assert.deepEqual(other.rows.map(r=>[r[1],r[5],r[6],r[7],r[10]]),[['CMPL904002','ELB','Some days','1','03-11'],['CMPL904003','ELB','Every trip card','3','01-11, 02-11, 03-11'],['CMPL904004','LMV','Some days','1','01-11']]);
 assert.ok(summary.rows.some(r=>r[0]==='In this sheet, belongs to another log book (people)'&&r[1]==='3'));
 assert.ok(summary.rows.some(r=>r[0]==='Compared with'&&r[1]==='VLB trip cards only'));
 assert.ok(!summary.rows.some(r=>/Employee Master at this site, not in the sheet/.test(r[0])));
 const done=await runSiteSheetCheck({sheet:parseAttendanceSheet(SHEET),fileName:'elb.xlsx',site:SITE,sheetBook:'ELB',session:{token:'T'},today:iso(23),read,build:(title,sheets)=>({title,sheets})});
 assert.match(done.name,/-ELB-/);assert.equal(done.view.sheetBook,'ELB');
});

test('a file uploaded under the wrong tab is said so: most of its people have every trip card in another log book',async()=>{
 const OPERATORS=[['SR NO','EMP. ID','NAME','DESIGNATION',day(1),day(2)],...[1,2,3].map(n=>[n,'CMPL90500'+n,'OPERATOR '+n,'DOZER OPERATOR','P','P'])];
 const duties=[1,2,3].flatMap(n=>[1,2].map(d=>duty(905000+n,d,'S1',elb(d))));
 const sheet=parseAttendanceSheet(OPERATORS);
 const data=await readSiteSheetData({sheet,site:SITE,session:{token:'T'},today:iso(23),
  read:async url=>url.includes('/people')?{site:SITE,people:[1,2,3].map(n=>master(905000+n,'OPERATOR '+n)),sitePeople:[]}:{otDuties:duties,attendanceEquipment:[],lockedDays:LOCKED}});
 const underVlb=siteSheetView({sheet,data,site:SITE,sheetBook:'VLB',today:iso(23)});
 assert.deepEqual(wrongTab(underVlb.result),{book:'ELB',people:3,whole:3});
 assert.equal(underVlb.lines.length,0,'no operator is listed as a missing VLB card');
 assert.equal(wrongTab(siteSheetView({sheet,data,site:SITE,sheetBook:'ELB',today:iso(23)}).result),null);
 const {VLB,ELB}=await views();
 assert.equal(wrongTab(VLB.result),null,'a sheet for everyone under VLB: the tipper drivers are compared, no warning');assert.equal(wrongTab(ELB.result),null);
 assert.match(fs.readFileSync(new URL('../src/site-sheet-trip-card.jsx',import.meta.url),'utf8'),/\{misplaced&&<p className="ssc-wrong-tab" role="alert">Is this the \{misplaced\.book\} sheet\?/);
});

test('one sheet for every log book still works as before (no log book chosen)',async()=>{
 const sheet=parseAttendanceSheet(SHEET),data=await readSiteSheetData({sheet,site:SITE,session:{token:'T'},today:iso(23),read});
 const all=siteSheetView({sheet,data,site:SITE,today:iso(23)});
 assert.equal(all.result.logBook,'');assert.equal(all.result.otherBook.length,0);assert.equal(all.result.listedOnly.length,1);
 assert.deepEqual(all.result.rows.map(r=>r.cells.map(c=>c.state).join()),[',,noDuty',',duty,',',,noDuty',',,']);
 const book=siteSheetWorkbook(all,{fileName:'site.xlsx',build:(title,sheets)=>({title,sheets}),checkedAt:'x'});
 assert.ok(!book.blob.sheets.some(s=>s.name==='Another log book'));assert.deepEqual(book.blob.sheets[0].fills,SHEET_FILLS);
});

test('the screen chooses the log book before the upload, keeps a file and a result per log book, and sits beside Attendance Month-wise',()=>{
 const source=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
 const page=source('../src/site-sheet-trip-card.jsx');
 assert.match(page,/Which sheet are you uploading\?/);
 assert.match(page,/<div className="ssc-book-tabs" role="tablist" aria-label="Log book of the sheet">\s*\{SHEET_BOOKS\.map\(/);
 assert.match(page,/useState\(\(\)=>Object\.fromEntries\(SHEET_BOOKS\.map\(b=>\[b\.key,blankTab\(\)\]\)\)\)/,'one file, check and result per log book');
 assert.match(page,/siteSheetView\(\{sheet:held\.file\.sheet,data,site:at,\.\.\.selectionOf\(\{\.\.\.held\.filter,from,to,batch:''\}\),sheetBook:key\}\)/,'the check is of the log book of its tab');
 assert.match(page,/<TripCardFilters tabs=\{false\} /,'the log book is not chosen again after the upload');
 assert.match(source('../src/trip-card-verdict.jsx'),/\{tabs&&<div className="tcv-tabs" role="tablist" aria-label="Log book">/);
 const ids=operationReports.map(r=>r.id);
 assert.equal(ids.indexOf('attendance-site-sheet'),ids.indexOf('attendance-month')+1);
 // The server gives a zero-trip entry the log book of its machine.
 assert.match(source('../server/rules/manpower-report.mjs'),/machineBook:asset\?logBookCode\(fleetAssetKind\(asset\)\):''/);
 assert.match(source('../server/rules/attendance-read.mjs'),/const CARD_FIELDS=\['logBooks','source','batches','machineBook'\];/);
});
