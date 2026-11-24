// Site Sheet vs Trip Card, a driver or operator with no trip card in any log book (owner, 24 Nov 2026, "Yes, build it"):
// he goes where the others of the sheet with his designation have their cards; when none of them has a card, the owner's
// VLB / ELB / LMV rule decides. On Sasti's first live run 13 drill operators with no card at all made 228 of the 297
// "sheet P, no trip card" days under VLB; they belong to ELB. Sasti's tanker drivers have their cards in VLB.
// Every ID and name is made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {parseAttendanceSheet,designationLogBook} from '../shared/attendance-sheet-check.mjs';
import {SHEET_BOOKS,personDays,otherBookRows,otherBookSheet,wrongTab,OTHER_BOOK_WAYS} from '../shared/site-sheet-days.mjs';
import {readSiteSheetData,siteSheetView,siteSheetWorkbook} from '../src/site-sheet-run.mjs';

const day=n=>new Date(Date.UTC(2026,10,n));
const iso=n=>'2026-11-'+String(n).padStart(2,'0');
const SITE='Sasti OC',KEY='sasti ob';
const SHEET=[
 ['SR NO','EMP. ID','NAME','DESIGNATION',day(1),day(2),day(3)],
 [1,'CMPL906001','DRILL ONE','DRILL OPERATOR','P','P','P'],          // no card anywhere: ELB by designation
 [2,'CMPL906002','TANKER ONE','WATER TENKAR DRIVER','P','P','P'],    // no card anywhere: VLB, where the other tanker driver's cards are
 [3,'CMPL906003','TIPPER ONE','TIPPER DRIVER','P','P','P'],          // no card anywhere: VLB by designation
 [4,'CMPL906004','EICHER ONE','EICHER DRIVER','P','P','P'],          // no card anywhere, designation names no log book
 [5,'CMPL906005','HELPER ONE','PC HELPER','P','P','P'],              // a helper: never compared
 [6,'CMPL906006','TIPPER TWO','TIPPER DRIVER','P','P','P'],          // VLB cards on 1 and 2 Nov
 [7,'CMPL906007','TANKER TWO','WATER TENKAR DRIVER','P','P','P'],    // VLB cards on every date
 [8,'CMPL906008','BUS ONE','BUS DRIVER','P','P','P'],                // no card anywhere, no other bus driver: LMV by the rule
];
const master=(number,name,designation)=>({number:String(number),found:true,name,designation,siteLabel:SITE,atSite:true,working:true,left:false});
const PEOPLE=SHEET.slice(1).map(r=>master(r[1].slice(4),r[2],r[3]));
const duty=(number,n)=>({date:iso(n),shift:'S1',site:SITE,siteKey:KEY,caliberCode:'CMLL'+number,employeeId:'CMLL'+number,employeeName:'N'+number,books:'TC'+number+'-'+n,doors:'V1',logBooks:['VLB'],source:'scanned',batches:'VLB-B'+n});
const read=async url=>url.includes('/people')?{site:SITE,people:PEOPLE,sitePeople:[]}:{otDuties:[duty(906006,1),duty(906006,2),duty(906007,1),duty(906007,2),duty(906007,3)],attendanceEquipment:[],lockedDays:[1,2,3].map(n=>KEY+'|'+iso(n))};
const views=async()=>{
 const sheet=parseAttendanceSheet(SHEET),data=await readSiteSheetData({sheet,site:SITE,session:{token:'T'},today:iso(23),read});
 return Object.fromEntries(SHEET_BOOKS.map(b=>[b.key,siteSheetView({sheet,data,site:SITE,sheetBook:b.key,today:iso(23)})]));
};
const missing=view=>[...new Set(view.lines.filter(l=>l.kind==='noCard').map(l=>l.id))].sort();
const apart=view=>otherBookRows(view.result).map(p=>[p.id,p.books,p.which]);

test('the owner\'s rule reads the designations sites write, with their spellings',()=>{
 const sasti={
  ELB:['DRILL OPERATOR','PC OPERATOR','DOZER OPERATOR','GRADER OPERATOR','LODER OPERATOR','SURFACE OPT','CAMP LOADER OPERATOR'],
  LMV:['LMV DRIVER','BUS DRIVER','WATER TENKAR DRIVER','SERVICE VAN DRIVER','DIESELTANKER DRIVER','HYDRA OPERATOR'],
  VLB:['TIPPER DRIVER','TIPPER TRAINNER','DUMPER OPT','DRIVER VOLVO SCANIA','VOLVO DRIVER'],
  '':['EICHER DRIVER','EICHER ADBLUE DRIVER','PM SIR DRIVER','ALL ROUNDER','SITE SUPERVISOR',''],
 };
 for(const [book,list] of Object.entries(sasti))for(const designation of list)assert.equal(designationLogBook(designation),book,designation);
 assert.equal(designationLogBook('Excavator Operator'),'ELB');assert.equal(designationLogBook('shift-van driver'),'LMV');
});

test('under VLB: the drill operator (ELB by the rule) and the bus driver (LMV by the rule) are listed apart; the tanker driver goes where his colleague\'s cards are',async()=>{
 const {VLB}=await views();
 assert.deepEqual(apart(VLB),[['CMPL906001','ELB',OTHER_BOOK_WAYS.designation],['CMPL906008','LMV',OTHER_BOOK_WAYS.designation]]);
 assert.deepEqual(missing(VLB),['CMPL906002','CMPL906003','CMPL906004','CMPL906006'],'the tanker driver with no card is a missing VLB card: the other tanker driver\'s cards are VLB');
 const drill=VLB.result.rows.find(r=>r.id==='CMPL906001');
 assert.deepEqual([drill.judge,drill.byDesignation,drill.otherBooks,drill.sheetP],[false,true,'ELB',null]);
 assert.match(drill.remark,/no trip card in any log book, and the designation belongs to ELB\. Check this person under the ELB tab\./);
 assert.deepEqual(personDays(drill).map(d=>[d.pulseSays,d.result]),Array(3).fill(['No trip card in any log book; the designation belongs to ELB','Sheet P, belongs to another log book']));
 assert.equal(VLB.result.corrections.some(c=>['CMPL906001','CMPL906008'].includes(c.id)),false,'not a correction of VLB');
 const helper=VLB.result.rows.find(r=>r.id==='CMPL906005');
 assert.deepEqual([helper.judge,helper.byDesignation,helper.cells.map(c=>c.state).join()],[false,false,',,'],'a helper is never placed or compared');
 assert.equal(wrongTab(VLB.result),null,'two people placed elsewhere is not a wrong tab');
});

test('under ELB the drill operator\'s P days are missing ELB cards, under LMV the bus driver\'s; the Eicher driver stays under every tab',async()=>{
 const {ELB,LMV}=await views();
 assert.deepEqual(missing(ELB),['CMPL906001','CMPL906004']);
 assert.deepEqual(apart(ELB),[['CMPL906002','VLB',OTHER_BOOK_WAYS.designation],['CMPL906003','VLB',OTHER_BOOK_WAYS.designation],['CMPL906006','VLB',OTHER_BOOK_WAYS.every],['CMPL906007','VLB',OTHER_BOOK_WAYS.every],['CMPL906008','LMV',OTHER_BOOK_WAYS.designation]]);
 assert.ok(ELB.result.corrections.some(c=>c.id==='CMPL906001'&&c.kind==='no-duty'),'a missing ELB card is a correction under ELB');
 assert.deepEqual(missing(LMV),['CMPL906004','CMPL906008']);
 assert.deepEqual(apart(LMV).map(p=>p[0]),['CMPL906001','CMPL906002','CMPL906003','CMPL906006','CMPL906007']);
 assert.deepEqual(wrongTab(LMV.result),{book:'VLB',people:4,whole:5},'most of this file is VLB: the LMV tab says so');
});

test('a tie between colleagues\' log books keeps the tab the sheet was uploaded as',async()=>{
 const sheet=parseAttendanceSheet([['SR NO','EMP. ID','NAME','DESIGNATION',day(1)],[1,'CMPL907001','A','LMV DRIVER','P'],[2,'CMPL907002','B','LMV DRIVER','P'],[3,'CMPL907003','C','LMV DRIVER','P']]);
 const lines=[{...duty(907001,1)},{...duty(907002,1),logBooks:['LMV'],batches:''}];
 const data=await readSiteSheetData({sheet,site:SITE,session:{token:'T'},today:iso(23),
  read:async url=>url.includes('/people')?{site:SITE,people:[1,2,3].map(n=>master(907000+n,'X','LMV DRIVER')),sitePeople:[]}:{otDuties:lines,attendanceEquipment:[],lockedDays:[KEY+'|'+iso(1)]}});
 for(const book of ['VLB','LMV'])assert.deepEqual(missing(siteSheetView({sheet,data,site:SITE,sheetBook:book,today:iso(23)})),['CMPL907003'],book+': one VLB and one LMV colleague, so he stays under '+book);
 assert.deepEqual(missing(siteSheetView({sheet,data,site:SITE,sheetBook:'ELB',today:iso(23)})),[],'under ELB he is listed apart');
});

test('the Excel names the way, the summary counts those placed by designation, and the screen says so',async()=>{
 const {VLB}=await views();
 const other=otherBookSheet(VLB.result);
 assert.match(other.title,/In the VLB sheet, belongs to another log book/);
 assert.ok(other.headerRows.some(line=>/^"By designation, no trip card": the person has no trip card in any log book/.test(line)));
 assert.equal(other.columns[5].label,'Belongs to log book');
 assert.deepEqual(other.rows.map(r=>[r[1],r[5],r[6],r[8],r[9]]),[['CMPL906001','ELB','By designation, no trip card','0','3'],['CMPL906008','LMV','By designation, no trip card','0','3']]);
 const book=siteSheetWorkbook(VLB,{fileName:'vlb.xlsx',build:(title,sheets)=>({title,sheets}),checkedAt:'x'});
 assert.ok(book.blob.sheets.at(-1).rows.some(r=>r[0]==='In this sheet, belongs to another log book (people)'&&r[1]==='2'&&/\(2 by designation\)/.test(r[2])));
 const page=fs.readFileSync(new URL('../src/site-sheet-trip-card.jsx',import.meta.url),'utf8');
 assert.match(page,/label:'Sheet P, belongs to another log book'/);
 assert.match(page,/"By designation, no trip card" = no card in any log book/);
});
