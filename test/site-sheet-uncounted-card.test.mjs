// A P whose trip card is saved but not counted as attendance (owner, 24 Nov 2026: at Majri OC, CMPL9040 had an ELB card on
// every date from 1 to 9 Nov, yet the ELB sheet check coloured every P orange, "no trip card"). The attendance register
// leaves out a card whose driver matches no single Employee Master person, or whose shift or date conflicts, and lists it
// as a review item. The sheet check now says so (pink, "card not counted") instead of calling it a missing card.
// Every ID and name is made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {parseAttendanceSheet,attendanceSheetWorkbook,uncountedCards,SHEET_FILLS,SHEET_LEGEND} from '../shared/attendance-sheet-check.mjs';
import {DAY_KINDS,personDays,sheetDaySheets} from '../shared/site-sheet-days.mjs';
import {readSiteSheetData,siteSheetView} from '../src/site-sheet-run.mjs';

const day=n=>new Date(Date.UTC(2026,10,n));
const iso=n=>'2026-11-'+String(n).padStart(2,'0');
const SITE='Majri OC',KEY='majri oc';
const SHEET=[
 ['SR NO','EMP. ID','NAME','DESIGNATION',day(1),day(2),day(3)],
 [1,'CMPL907001','AABID','DOZER/OP','P','P','P'],   // ELB cards on 1 and 2 Nov that attendance leaves out; 3 Nov: no card at all
 [2,'CMPL907002','RAJU','GRADER/OP','P','P','P'],   // ELB cards counted on every date
];
const master=(number,name)=>({number:String(number),found:true,name,designation:'',siteLabel:SITE,atSite:true,working:true,left:false});
const PEOPLE=[master(907001,'AABID'),master(907002,'RAJU')];
const duty=(number,n)=>({date:iso(n),shift:'S2',site:SITE,siteKey:KEY,caliberCode:'CMPL'+number,employeeId:'CMPL'+number,employeeName:'N'+number,books:'CAL/ELB/'+n,doors:'D12',
 logBooks:['ELB'],source:'scanned',batches:'ELB-B'+n});
// The register's review items: the card's Caliber ID stands in for the Employee ID it could not resolve.
const issue=(n,reason,o={})=>({id:'c'+n+':1',date:iso(n),site:SITE,siteKey:KEY,shift:'S2',door:'D12 - 07190',employeeId:'CMPL907001',employeeName:'AABID',book:'CAL/ELB/0'+n+'-11-26/1',
 batches:'ELB-B'+n,reason,logBook:'ELB',...o});
const EXCEPTIONS=[
 issue(1,'Employee / Caliber ID mapping is ambiguous.'),
 issue(2,'Saved Employee ID conflicts with the linked employee master.'),
 issue(2,'Equipment master match is missing.',{book:'CAL/ELB/other'}),   // a review item that does not drop the card
 issue(3,'Opening HMR missing.'),                                          // not a reason that drops the card either
];
const LOCKED=[1,2,3].map(n=>KEY+'|'+iso(n));
const read=async url=>url.includes('/people')?{site:SITE,people:PEOPLE,sitePeople:[]}
 :{otDuties:[1,2,3].map(n=>duty(907002,n)),attendanceEquipment:[],lockedDays:LOCKED,exceptions:EXCEPTIONS};
const viewOf=async(sheetBook='ELB')=>{
 const sheet=parseAttendanceSheet(SHEET),data=await readSiteSheetData({sheet,site:SITE,session:{token:'T'},today:iso(23),read});
 return siteSheetView({sheet,data,site:SITE,sheetBook,today:iso(23)});
};

test('only the review reasons that keep a card out of attendance count as "card not counted"',()=>{
 assert.deepEqual(uncountedCards(EXCEPTIONS).map(e=>e.date),[iso(1),iso(2)]);
 assert.equal(uncountedCards([{date:iso(1),employeeId:'',reason:'Employee / Caliber ID mapping is ambiguous.'}]).length,0,'no ID: nobody to put it on');
 assert.equal(uncountedCards(undefined).length,0);
 // The reasons are written by the register; the check reads them by their words, so they must not drift apart.
 const register=fs.readFileSync(new URL('../server/rules/manpower-report.mjs',import.meta.url),'utf8');
 for(const words of ['cannot be resolved to an employee master','conflicts with the linked employee master','mapping is ambiguous','metadata conflicts with the logbook','shift labels conflict'])
  assert.ok(register.includes(words),words);
});

test('a P with a saved card that is not counted is pink, not a missing card',async()=>{
 for(const book of ['ELB','']){
  const {result,lines}=await viewOf(book);
  const row=result.rows.find(r=>r.id==='CMPL907001');
  assert.deepEqual(row.cells.map(c=>c.state),['uncounted','uncounted','noDuty'],book||'All sheets');
  assert.equal(row.cells[0].pulse,'Card not counted');
  assert.match(row.cells[1].uncounted[0].reason,/conflicts with the linked employee master/);
  assert.deepEqual(result.rows.find(r=>r.id==='CMPL907002').cells.map(c=>c.state),['','',''],'the counted cards still match');
  const kinds=result.corrections.filter(c=>c.id==='CMPL907001').map(c=>c.kind);
  assert.deepEqual(kinds,['card-not-counted','card-not-counted','no-duty']);
  assert.equal(result.counts['card-not-counted'],2);
  const mine=lines.filter(l=>l.id==='CMPL907001');
  assert.deepEqual(mine.map(l=>[l.kind,l.date,l.shift]),[['uncounted',iso(1),'B'],['uncounted',iso(2),'B'],['noCard',iso(3),'zz-not-in-sheet']]);
  assert.match(mine[0].pulseSays,/Card saved, not counted: Employee \/ Caliber ID mapping is ambiguous/);
  assert.deepEqual(mine[0].logBooks,['ELB']);
  assert.equal(personDays(row)[0].result,'Sheet P, trip card saved but not counted');
 }
});

test('the Excel colours it pink with its own key line and lists it on its own sheet',async()=>{
 const {result,lines}=await viewOf('ELB');
 assert.ok(SHEET_FILLS.uncounted);
 assert.ok(SHEET_LEGEND.some(([key])=>key==='uncounted'));
 const book=attendanceSheetWorkbook(result);
 const index=result.rows.findIndex(r=>r.id==='CMPL907001');
 assert.equal(book.sheets[0].cellFills[index][7],'uncounted');
 assert.equal(book.sheets[0].cellFills[index][9],'noDuty');
 assert.ok(DAY_KINDS.some(k=>k.key==='uncounted'));
 const sheets=sheetDaySheets(result,lines),notCounted=sheets.find(s=>s.name==='Card not counted');
 assert.equal(notCounted.rows.length,2);
 assert.ok(sheets[0].columns.some(c=>/card not counted/.test(c.label)));
});
