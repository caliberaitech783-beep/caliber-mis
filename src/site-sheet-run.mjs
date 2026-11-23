// Site Sheet vs Trip Card: the run behind the screen (src/site-sheet-trip-card.jsx). The sheet is read and compared exactly
// as Attendance Sheet Mismatch did it (shared/attendance-sheet-check.mjs); the date by shift lines of both ways are
// added (shared/site-sheet-days.mjs), on screen and as three more sheets of the Excel. Kept apart from the screen so it
// runs in a test without a browser.
//
// Owner, 24 Nov 2026: Pulse-II is read once for the sheet's dates; the log book tab (VLB / ELB / LMV), the batch and From /
// To then work on what was read, at once, with no second read. Every trip card attendance of the selection is judged
// against the sheet (shared/trip-card-attendance.mjs): the OK ones are counted, only the ones that need attention listed.
import {attendanceSheetWorkbook,checkAttendanceSheet,sheetReadRange} from '../shared/attendance-sheet-check.mjs';
import {sheetDayLines,sheetDaySheets,selectDayLines} from '../shared/site-sheet-days.mjs';
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

// What the screen shows for a selection. from/to: '' = the whole range read; logBook: '' | VLB | ELB | LMV; batch: '' = all.
export function siteSheetView({sheet,data,site,from='',to='',logBook='',batch='',today=todayIst()}){
 const {range,attendance,master}=data;
 const lo=from&&from>range.from?from:range.from,hi=to&&to<range.to?to:range.to;
 const pulseLines=[...(attendance.otDuties||[]),...(attendance.attendanceEquipment||[])];
 const result=checkAttendanceSheet({sheet:limitSheet(sheet,lo,hi),site:master.site||site,lines:pulseLines,lockedDays:attendance.lockedDays||[],
  people:master.people||[],sitePeople:master.sitePeople||[],today});
 const allLines=sheetDayLines(result),lines=selectDayLines(allLines,{logBook,batch});
 // The trip cards of the compared (locked) dates at this site, judged against the sheet.
 const judgedDates=new Set(result.dates.judged);
 const cards=cardAttendances(pulseLines,{site:result.site,from:lo,to:hi}).filter(c=>judgedDates.has(c.date));
 const judged=judgeCards(selectCards(cards,{logBook,batch}),{sheet:sheetMarks(result)});
 return {result,range,from:lo,to:hi,logBook,batch,allLines,lines,cards,judged,summary:cardSummary(judged),
  logBooks:logBookCounts(cards),batches:batchChoices(cards,logBook)};
}

// The Excel of a selection: the site's own sheet coloured, the trip cards that need attention and the OK ones, the date by
// shift sheets, then the corrections, who is not in the sheet and the summary.
export function siteSheetWorkbook(view,{fileName='',build=buildXlsxSheetsWorkbook,checkedAt=formatDisplayDateTime(new Date())}={}){
 const {result}=view,book=attendanceSheetWorkbook(result,{fileName,checkedAt});
 const choice=[view.logBook||'All log books',view.batch?'batch '+view.batch:''].filter(Boolean).join(' · ');
 const sheets=[book.sheets[0],...cardSheets(view.judged,{title:result.site+' · '+choice,withSheet:true}),...sheetDaySheets(result,view.lines),...book.sheets.slice(1)];
 const siteSlug=result.site.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,''),compared=result.dates.compared;
 const tag=[view.logBook,view.batch].filter(Boolean).join('-').replace(/[^A-Za-z0-9]+/g,'-');
 return {title:book.title,blob:build(book.title,sheets),
  name:`Site-sheet-vs-trip-card-${siteSlug}${tag?'-'+tag:''}-${compared[0]||view.from}-to-${compared.at(-1)||view.to}.xlsx`};
}

// Read, compare the whole sheet and build the Excel. Returns {result, lines, range, title, blob, name, data, view}.
// read, build: the server read and the workbook builder; a test passes its own.
export async function runSiteSheetCheck({sheet,fileName,site,session,today=todayIst(),read=sheetApi,build=buildXlsxSheetsWorkbook}){
 const data=await readSiteSheetData({sheet,site,session,today,read});
 const view=siteSheetView({sheet,data,site,today});
 const book=siteSheetWorkbook(view,{fileName,build});
 return {...book,result:view.result,lines:view.lines,range:data.range,data,view};
}
