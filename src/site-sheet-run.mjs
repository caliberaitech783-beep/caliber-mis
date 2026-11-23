// Site Sheet vs Trip Card: the run behind the screen (src/site-sheet-trip-card.jsx). The sheet is read and compared exactly
// as Attendance Sheet Mismatch did it (shared/attendance-sheet-check.mjs); the date by shift lines of both ways are
// added (shared/site-sheet-days.mjs), on screen and as three more sheets of the Excel. Kept apart from the screen so it
// runs in a test without a browser.
//
// Owner, 24 Nov 2026: Pulse-II is read once for the sheet's dates; the log book tab (VLB / ELB / LMV), the batch and From /
// To then work on what was read, at once, with no second read. Every trip card attendance of the selection is judged
// against the sheet (shared/trip-card-attendance.mjs): the OK ones are counted, only the ones that need attention listed.
import {attendanceSheetWorkbook,checkAttendanceSheet,sheetReadRange} from '../shared/attendance-sheet-check.mjs';
import {otherBookSheet,sheetDayLines,sheetDaySheets,selectDayLines} from '../shared/site-sheet-days.mjs';
import {batchChoices,cardAttendances,cardSheets,cardSummary,judgeCards,logBookCounts,selectCards,sheetMarks} from '../shared/trip-card-attendance.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {formatDisplayDateTime} from '../shared/date-time-format.mjs';
import {sheetApi,todayIst} from './attendance-sheet-run.mjs';

// The sheet with only the dates from..to compared (the other dates stay in the sheet, not compared).
export function limitSheet(sheet,from,to){
 if(!from&&!to)return sheet;
 const keep=date=>(!from||date>=from)&&(!to||date<=to);
 return {...sheet,filledDates:sheet.filledDates.filter(keep),missingDates:sheet.missingDates.filter(keep)};
}

// Reads Pulse-II once for the dates of the sheet. Returns {range, attendance, master}.
export async function readSiteSheetData({sheet,site,session,today=todayIst(),read=sheetApi}){
 const range=sheetReadRange(sheet,today);
 if(!range)throw Error('No date of this sheet can be compared: Pulse-II holds attendance from 01-11-2026 up to today.');
 const [attendance,master]=await Promise.all([
  read('/api/reports/manpower/attendance?'+new URLSearchParams({from:range.from,to:range.to,view:'attendance'}),session),
  read('/api/reports/manpower/attendance-sheet/people',session,{method:'POST',body:JSON.stringify({site,ids:sheet.people.map(person=>person.id)})}),
 ]);
 return {range,attendance,master};
}

// The log books of a Pulse-II duty line. A zero-trip entry has no card: it takes the log book of its machine (machineBook).
const split=value=>String(value??'').split(/\s*[;+]\s*/).map(part=>part.trim()).filter(Boolean);
export const lineBooks=line=>Array.isArray(line.logBooks)&&line.logBooks.length?line.logBooks:split(line.logBook).length?split(line.logBook):split(line.machineBook);
// The duties of one log book, and the duties of the other two (owner, 24 Nov 2026: the sheet of each log book is uploaded
// and checked apart). A duty on two log books in one shift ("VLB + ELB") counts for both. A duty with no log book at all
// (a zero-trip entry that names no machine) cannot be placed, so it counts as presence under every log book.
export function linesOfBook(lines,book){
 const own=[],other=[];
 for(const line of lines){
  const books=lineBooks(line);
  if(!books.length||books.includes(book))own.push(books.length&&!line.logBooks?.length?{...line,logBooks:books}:line);
  else other.push(line.logBooks?.length?line:{...line,logBooks:books});
 }
 return {own,other};
}

// What the screen shows for a selection. from/to: '' = the whole range read; batch: '' = all.
// sheetBook: VLB | ELB | LMV = the sheet was uploaded as the sheet of that log book and is compared with its trip cards only.
// logBook:   '' | VLB | ELB | LMV, only without sheetBook: one sheet for every log book, seen through one log book.
export function siteSheetView({sheet,data,site,from='',to='',logBook='',batch='',sheetBook='',today=todayIst()}){
 const {range,attendance,master}=data;
 const lo=from&&from>range.from?from:range.from,hi=to&&to<range.to?to:range.to;
 const everyLine=[...(attendance.otDuties||[]),...(attendance.attendanceEquipment||[])];
 const {own:pulseLines,other:otherLines}=sheetBook?linesOfBook(everyLine,sheetBook):{own:everyLine,other:[]};
 const seen=sheetBook?'':logBook;
 const result=checkAttendanceSheet({sheet:limitSheet(sheet,lo,hi),site:master.site||site,lines:pulseLines,otherLines,logBook:sheetBook,lockedDays:attendance.lockedDays||[],
  people:master.people||[],sitePeople:master.sitePeople||[],today});
 const allLines=sheetDayLines(result),lines=selectDayLines(allLines,{logBook:seen,batch});
 // The trip cards of the compared (locked) dates at this site, judged against the sheet.
 const judgedDates=new Set(result.dates.judged);
 const cards=cardAttendances(pulseLines,{site:result.site,from:lo,to:hi}).filter(c=>judgedDates.has(c.date));
 const judged=judgeCards(selectCards(cards,{logBook:seen,batch}),{sheet:sheetMarks(result)});
 return {result,range,from:lo,to:hi,logBook:sheetBook||logBook,sheetBook,batch,allLines,lines,cards,judged,summary:cardSummary(judged),
  logBooks:logBookCounts(cards),batches:batchChoices(cards,seen)};
}

// The Excel of a selection: the site's own sheet coloured, the trip cards that need attention and the OK ones, the date by
// shift sheets, then the corrections, who is not in the sheet and the summary.
export function siteSheetWorkbook(view,{fileName='',build=buildXlsxSheetsWorkbook,checkedAt=formatDisplayDateTime(new Date())}={}){
 const {result}=view,book=attendanceSheetWorkbook(result,{fileName,checkedAt});
 const choice=[view.logBook||'All log books',view.batch?'batch '+view.batch:''].filter(Boolean).join(' · ');
 const sheets=[book.sheets[0],...cardSheets(view.judged,{title:result.site+' · '+choice,withSheet:true}),...sheetDaySheets(result,view.lines),...(view.sheetBook?[otherBookSheet(result)]:[]),...book.sheets.slice(1)];
 const siteSlug=result.site.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,''),compared=result.dates.compared;
 const tag=[view.logBook,view.batch].filter(Boolean).join('-').replace(/[^A-Za-z0-9]+/g,'-');
 return {title:book.title,blob:build(book.title,sheets),
  name:`Site-sheet-vs-trip-card-${siteSlug}${tag?'-'+tag:''}-${compared[0]||view.from}-to-${compared.at(-1)||view.to}.xlsx`};
}

// Read, compare the whole sheet and build the Excel. Returns {result, lines, range, title, blob, name, data, view}.
// read, build: the server read and the workbook builder; a test passes its own.
export async function runSiteSheetCheck({sheet,fileName,site,session,sheetBook='',today=todayIst(),read=sheetApi,build=buildXlsxSheetsWorkbook}){
 const data=await readSiteSheetData({sheet,site,session,today,read});
 const view=siteSheetView({sheet,data,site,sheetBook,today});
 const book=siteSheetWorkbook(view,{fileName,build});
 return {...book,result:view.result,lines:view.lines,range:data.range,data,view};
}
