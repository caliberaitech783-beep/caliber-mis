// Site Sheet vs Trip Card, one sheet for the whole site (owner, 24 Nov 2026, "Yes, fix the warning"): Sasti keeps one
// attendance sheet for everyone, so under the ELB tab 409 of its 940 people were VLB people and the screen asked "Is this
// the VLB sheet?" although 143 ELB people were compared. A file that holds this log book's people too is told what was
// compared; only a file with hardly anyone of this log book is asked whether it is the wrong tab. Every ID is made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {parseAttendanceSheet} from '../shared/attendance-sheet-check.mjs';
import {wrongTab,MIXED_SHEET_PEOPLE} from '../shared/site-sheet-days.mjs';
import {readSiteSheetData,siteSheetView} from '../src/site-sheet-run.mjs';

const day=n=>new Date(Date.UTC(2026,10,n));
const iso=n=>'2026-11-'+String(n).padStart(2,'0');
const SITE='Sasti OC',KEY='sasti ob';
const person=(n,designation)=>({number:String(n),found:true,name:'P'+n,designation,siteLabel:SITE,atSite:true,working:true,left:false});
const duty=(n,d,book)=>({date:iso(d),shift:'S1',site:SITE,siteKey:KEY,caliberCode:'CMLL'+n,employeeId:'CMLL'+n,employeeName:'N'+n,books:'TC'+n+'-'+d,doors:'X1',logBooks:[book],source:'manual',batches:book+'-B'+d});
// A whole-site sheet: 12 operators with ELB cards, 30 tipper drivers with VLB cards, 4 LMV drivers with LMV and VLB cards.
const operators=Array.from({length:12},(_,i)=>908001+i),tippers=Array.from({length:30},(_,i)=>908101+i),lmv=Array.from({length:4},(_,i)=>908201+i);
const sheetFor=list=>parseAttendanceSheet([['SR NO','EMP. ID','NAME','DESIGNATION',day(1),day(2)],...list.map(([n,designation],i)=>[i+1,'CMPL'+n,'P'+n,designation,'P','P'])]);
const everyone=[...operators.map(n=>[n,'PC OPERATOR']),...tippers.map(n=>[n,'TIPPER DRIVER']),...lmv.map(n=>[n,'LMV DRIVER'])];
const LINES=[...operators.flatMap(n=>[duty(n,1,'ELB'),duty(n,2,'ELB')]),...tippers.flatMap(n=>[duty(n,1,'VLB'),duty(n,2,'VLB')]),...lmv.flatMap(n=>[duty(n,1,'LMV'),duty(n,2,'VLB')])];
const viewOf=async(list,book)=>{
 const sheet=sheetFor(list);
 const data=await readSiteSheetData({sheet,site:SITE,session:{token:'T'},today:iso(23),
  read:async url=>url.includes('/people')?{site:SITE,people:list.map(([n,d])=>person(n,d)),sitePeople:[]}:{otDuties:LINES,attendanceEquipment:[],lockedDays:[1,2].map(d=>KEY+'|'+iso(d))}});
 return siteSheetView({sheet,data,site:SITE,sheetBook:book,today:iso(23)});
};

test('a whole-site sheet under ELB is told what was compared, not that it is the wrong tab',async()=>{
 const ELB=await viewOf(everyone,'ELB');
 assert.equal(ELB.result.totals.judged,12);
 assert.deepEqual(wrongTab(ELB.result),{book:'VLB',people:34,whole:34,judged:12,mixed:true,books:[{book:'VLB',people:34},{book:'LMV',people:4}],shared:4});
 assert.equal(wrongTab((await viewOf(everyone,'VLB')).result),null,'under VLB most people are compared: nothing to say');
 assert.ok(MIXED_SHEET_PEOPLE===10);
});

test('the ELB sheet uploaded under VLB by mistake is still asked whether it is the wrong tab',async()=>{
 const misplaced=wrongTab((await viewOf(operators.map(n=>[n,'PC OPERATOR']),'VLB')).result);
 assert.deepEqual([misplaced.book,misplaced.whole,misplaced.judged,misplaced.mixed],['ELB',12,0,false]);
});

test('the screen shows a note for a whole-site sheet and the warning only for a wrong tab',()=>{
 const page=fs.readFileSync(new URL('../src/site-sheet-trip-card.jsx',import.meta.url),'utf8');
 assert.match(page,/\{misplaced\?\.mixed&&<p className="ssc-mixed-sheet" role="status">This file holds the people of other log books too, as one sheet for the whole site does\./);
 assert.match(page,/\{misplaced&&!misplaced\.mixed&&<p className="ssc-wrong-tab" role="alert">Is this the \{misplaced\.book\} sheet\?/);
});
