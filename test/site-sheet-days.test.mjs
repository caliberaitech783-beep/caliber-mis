// Site Sheet vs Trip Card (owner, 23 Nov 2026): the site's hand-kept attendance Excel against Pulse-II trip cards,
// date by shift, both ways, with a drill-down to the people and to one person day by day. Every ID and name is made up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {parseAttendanceSheet,checkAttendanceSheet} from '../shared/attendance-sheet-check.mjs';
import {UNKNOWN_SHIFT,DAY_KINDS,sheetDayLines,dayShiftRows,kindTotals,personDays,sheetDaySheets,shiftName,nearestShift} from '../shared/site-sheet-days.mjs';
import {runSiteSheetCheck} from '../src/site-sheet-run.mjs';
import {operationReports} from '../src/operations-report-model.mjs';

const day=n=>new Date(Date.UTC(2026,10,n));
const iso=n=>'2026-11-'+String(n).padStart(2,'0');
const SHEET=[
 ['SITE ATTENDANCE NOV 2026'],
 ['SR NO','EMP. ID','NAME','DESIGNATION',day(1),day(2),day(3),'Present Total'],
 [1,'CMPL902001','RAM DRIVER','TIPPER DRIVER','P','A','P',2],
 [2,'CMPL902002','SHYAM DRIVER','TIPPER DRIVER','P','P','P',3],
 [3,'CMPL902003','HARI HELPER','TIPPER HELPER','P','P','P',3],
 [4,'CMPL902004','GOPAL DRIVER','DOZER OPERATOR',null,'PL','-',0],
];
const SITE='Sasti OC',KEY='sasti ob';
const master=(number,name)=>({number:String(number),found:true,name,designation:'',siteLabel:SITE,atSite:true,working:true,left:false});
const PEOPLE=[master(902001,'RAM DRIVER'),master(902002,'SHYAM DRIVER'),master(902003,'HARI HELPER'),master(902004,'GOPAL DRIVER')];
const duty=(number,n,shift,o={})=>({date:iso(n),shift,site:SITE,siteKey:KEY,caliberCode:'CMLL'+number,employeeId:'E'+number,employeeName:'N'+number,books:'TC'+number+'-'+n,doors:'V'+number%10,...o});
const LINES=[
 duty(902001,1,'S1'),duty(902001,2,'S2'),                                   // 2 Nov: A in the sheet, a card in Shift B; 3 Nov: P, no card
 duty(902002,1,'S3'),duty(902002,2,'S1',{site:'Majri OC',siteKey:'majri ob'}),duty(902002,3,'S3'), // 2 Nov: the card is at Majri
 duty(902004,1,'S1'),duty(902004,2,'S3'),                                   // blank and PL in the sheet, cards in Shift A and C
];
const LOCKED=[1,2,3].map(n=>KEY+'|'+iso(n)).concat('majri ob|'+iso(2));
const result=()=>checkAttendanceSheet({sheet:parseAttendanceSheet(SHEET),site:SITE,lines:LINES,lockedDays:LOCKED,people:PEOPLE,sitePeople:[],today:iso(23)});

test('each person-day is a line of one way, on the shift of its card; the sheet has no shift for a P without a card',()=>{
 const lines=sheetDayLines(result());
 assert.deepEqual(lines.map(l=>[l.id,l.date,l.kind,l.shift,l.sheetSays]),[
  ['CMPL902004',iso(1),'card','A','(blank)'],
  ['CMPL902002',iso(2),'away','A','P'],
  ['CMPL902001',iso(2),'card','B','A'],
  ['CMPL902004',iso(2),'card','C','PL'],
  ['CMPL902001',iso(3),'noCard',UNKNOWN_SHIFT,'P'],
 ],'date, then shift; the helper with no card is not judged');
 const missing=lines.find(l=>l.kind==='noCard');
 assert.equal(missing.nearest,'Shift B on 02-11','the nearest worked shift is a hint, not a shift');
 assert.equal(nearestShift([{date:iso(1),shifts:['A']},{date:iso(2),shifts:['B','C']},{date:iso(9),shifts:['C']}],iso(5)),'Shift B + Shift C on 02-11 · Shift C on 09-11','the date before and the date after');
 assert.match(missing.correction,/Save the missing card or zero-trip entry, or correct the sheet to A/);
 const blue=lines.find(l=>l.id==='CMPL902001'&&l.kind==='card');
 assert.deepEqual([blue.books,blue.equipment,blue.pulseSays],['TC902001-2','V1','Duty in Shift B on V1']);
 const away=lines.find(l=>l.kind==='away');
 assert.deepEqual([away.site,away.pulseSays],['Majri OC','Duty at Majri OC in Shift A']);
 assert.equal(shiftName(UNKNOWN_SHIFT),'Shift not in sheet');
 assert.equal(nearestShift([],iso(3)),'No duty at this site on any compared date');
});

test('the date by shift boxes count each way, and the totals count people-days and people',()=>{
 const lines=sheetDayLines(result());
 assert.deepEqual(dayShiftRows(lines).map(r=>[r.date,r.shift,r.total,r.card,r.noCard,r.away]),[
  [iso(1),'A',1,1,0,0],[iso(2),'A',1,0,0,1],[iso(2),'B',1,1,0,0],[iso(2),'C',1,1,0,0],[iso(3),UNKNOWN_SHIFT,1,0,1,0]]);
 assert.deepEqual(kindTotals(lines),{card:{lines:3,people:2},noCard:{lines:1,people:1},away:{lines:1,people:1}});
 assert.deepEqual(DAY_KINDS.map(k=>k.label),['Trip card present, sheet not P','Sheet P, no trip card','Sheet P, trip card at another site']);
});

test('one person day by day: the mark beside Pulse-II for every date of the sheet',()=>{
 const r=result(),of=id=>r.rows.find(x=>x.id===id);
 assert.deepEqual(personDays(of('CMPL902001')).map(d=>[d.date,d.sheetSays,d.pulseSays,d.result]),[
  [iso(1),'P','Duty in Shift A','Same in both'],[iso(2),'A','Duty in Shift B','Trip card present, sheet not P'],[iso(3),'P','No duty','Sheet P, no trip card']]);
 assert.deepEqual(personDays(of('CMPL902003')).map(d=>d.result),['Not judged: not a driver or operator','Not judged: not a driver or operator','Not judged: not a driver or operator']);
 assert.deepEqual(personDays(of('CMPL902002')).map(d=>d.pulseSays),['Duty in Shift C','Duty at Majri OC','Duty in Shift C']);
});

test('the Excel gets the date by shift counts and the lines of each way',()=>{
 const r=result(),[grid,cards,sheetP]=sheetDaySheets(r);
 assert.deepEqual([grid.name,cards.name,sheetP.name],['Date x shift','Trip card, sheet not P','Sheet P, no trip card']);
 assert.deepEqual(grid.columns.map(c=>c.label),['Date','Shift A · Trip card, sheet not P','Shift A · Sheet P, card at another site','Shift B · Trip card, sheet not P','Shift C · Trip card, sheet not P',
  'Shift not in sheet · Sheet P, no trip card','Day · Trip card, sheet not P','Day · Sheet P, no trip card','Day · Sheet P, card at another site','Day · all']);
 assert.deepEqual(grid.rows.map(row=>row.join('|')),['01-11-2026|1|0|0|0|0|1|0|0|1','02-11-2026|0|1|1|1|0|2|0|1|3','03-11-2026|0|0|0|0|1|0|1|0|1','All dates|1|1|1|1|1|3|1|1|5']);
 assert.ok(grid.highlightedRows.has(3),'the All dates line stands out');
 assert.deepEqual(cards.rows.map(row=>row.slice(0,4).concat(row[7])),[['01-11-2026','Shift A','6','CMPL902004','(blank)'],['02-11-2026','Shift B','3','CMPL902001','A'],['02-11-2026','Shift C','6','CMPL902004','PL']]);
 assert.ok(sheetP.columns.some(c=>c.label==='Nearest shift worked here'));
 assert.deepEqual(sheetP.rows.map(row=>[row[0],row[1],row[3]]),[['02-11-2026','Shift A','CMPL902002'],['03-11-2026','Shift not in sheet','CMPL902001']]);
});

test('the run reads Pulse-II once and puts the new sheets after the site sheet',async()=>{
 const calls=[];
 const read=async(url,session,options)=>{calls.push([url,session.token,options?.method||'GET']);
  return url.includes('/people')?{site:SITE,people:PEOPLE,sitePeople:[]}:{otDuties:LINES,attendanceEquipment:[],lockedDays:LOCKED};};
 const done=await runSiteSheetCheck({sheet:parseAttendanceSheet(SHEET),fileName:'site.xlsx',site:SITE,session:{token:'T'},today:iso(23),read,build:(title,sheets)=>({title,sheets})});
 assert.deepEqual(calls,[['/api/reports/manpower/attendance?from=2026-11-01&to=2026-11-03&view=attendance','T','GET'],['/api/reports/manpower/attendance-sheet/people','T','POST']]);
 assert.deepEqual(done.blob.sheets.map(s=>s.name),['Attendance check','Date x shift','Trip card, sheet not P','Sheet P, no trip card','Corrections','Not in sheet','Summary']);
 assert.equal(done.name,'Site-sheet-vs-trip-card-Sasti-OC-2026-11-01-to-2026-11-03.xlsx');
 assert.equal(done.lines.length,5);
});

test('the tab sits beside Attendance Sheet Mismatch, which stays as it is',()=>{
 const ids=operationReports.map(r=>r.id);
 assert.deepEqual(operationReports.find(r=>r.id==='attendance-site-sheet'),{id:'attendance-site-sheet',title:'Site Sheet vs Trip Card',group:'Manpower & OT'});
 assert.equal(ids.indexOf('attendance-site-sheet'),ids.indexOf('attendance-sheet')+1);
 const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
 const screen=read('../src/manpower-reports.jsx');
 assert.match(screen,/siteSheet\?<SiteSheetTripCard session=\{session\} ReportSection=\{ReportSection\}\/>:<AttendanceSheetCheck session=\{session\}\/>/);
 assert.match(screen,/sheetCheck=reportId==='attendance-sheet'\|\|siteSheet/,'neither upload tab starts the Manpower read');
 const page=read('../src/site-sheet-trip-card.jsx');
 assert.match(page,/accept="\.xlsx,\.xlsm,\.xlk"/);assert.match(page,/Nothing is changed in Pulse-II/);
 for(const step of ["'Step 1 · '","'Step 2 · '","'Step 3 · '","'Step 4 · '"])assert.ok(page.includes(step),step);
 assert.match(page,/<DateShiftGrid /);
});
