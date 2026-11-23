// Site Sheet vs Trip Card: the run behind the screen (src/site-sheet-trip-card.jsx). The sheet is read and compared exactly
// as Attendance Sheet Mismatch did it (shared/attendance-sheet-check.mjs); the date by shift lines of both ways are
// added (shared/site-sheet-days.mjs), on screen and as three more sheets of the Excel. Kept apart from the screen so it
// runs in a test without a browser.
import {attendanceSheetWorkbook,checkAttendanceSheet,sheetReadRange} from '../shared/attendance-sheet-check.mjs';
import {sheetDayLines,sheetDaySheets} from '../shared/site-sheet-days.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {formatDisplayDateTime} from '../shared/date-time-format.mjs';
import {sheetApi,todayIst} from './attendance-sheet-run.mjs';

// Returns {result, lines, range, title, blob, name}. read, build: the server read and the workbook builder; a test passes its own.
export async function runSiteSheetCheck({sheet,fileName,site,session,today=todayIst(),read=sheetApi,build=buildXlsxSheetsWorkbook}){
 const range=sheetReadRange(sheet,today);
 if(!range)throw Error('No date of this sheet can be compared: Pulse-II holds attendance from 01-11-2026 up to today.');
 const [attendance,master]=await Promise.all([
  read('/api/reports/manpower/attendance?'+new URLSearchParams({from:range.from,to:range.to,view:'attendance'}),session),
  read('/api/reports/manpower/attendance-sheet/people',session,{method:'POST',body:JSON.stringify({site,ids:sheet.people.map(person=>person.id)})}),
 ]);
 const result=checkAttendanceSheet({sheet,site:master.site||site,lines:[...(attendance.otDuties||[]),...(attendance.attendanceEquipment||[])],lockedDays:attendance.lockedDays||[],
  people:master.people||[],sitePeople:master.sitePeople||[],today});
 const lines=sheetDayLines(result);
 const book=attendanceSheetWorkbook(result,{fileName,checkedAt:formatDisplayDateTime(new Date())});
 // The site's own sheet first, then the date by shift sheets, then the corrections, who is not in the sheet and the summary.
 const sheets=[book.sheets[0],...sheetDaySheets(result,lines),...book.sheets.slice(1)];
 const siteSlug=result.site.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,''),compared=result.dates.compared;
 return {result,lines,range,title:book.title,blob:build(book.title,sheets),name:`Site-sheet-vs-trip-card-${siteSlug}-${compared[0]||range.from}-to-${compared.at(-1)||range.to}.xlsx`};
}
