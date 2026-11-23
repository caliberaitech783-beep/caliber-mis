// Site Sheet vs Trip Card: the reads behind the screen (src/site-sheet-trip-card.jsx). A saved sheet is compared with the
// trip cards of this moment exactly as Attendance Sheet Mismatch compared an upload (shared/attendance-sheet-check.mjs),
// and the date by shift lines of both ways are made (shared/site-sheet-days.mjs). No Excel is made (owner, 23 Nov 2026).
// Kept apart from the screen so it runs in a test without a browser.
import {checkAttendanceSheet,sheetReadRange} from '../shared/attendance-sheet-check.mjs';
import {employeeNumber} from '../shared/hr-employee-master.mjs';
import {sheetDayLines,savedSheetFrom} from '../shared/site-sheet-days.mjs';
import {sheetApi,todayIst} from './attendance-sheet-run.mjs';

export const SITE_SHEETS_API='/api/reports/manpower/site-sheets';

// The sheets this login may open (its own; every sheet for an MIS administrator).
export const listSiteSheets=(session,read=sheetApi)=>read(SITE_SHEETS_API,session);
// Keeps an uploaded sheet for this login; the same site and month again replaces the older one.
export const saveSiteSheet=({sheet,fileName,site,session,read=sheetApi})=>read(SITE_SHEETS_API,session,{method:'POST',body:JSON.stringify({site,fileName,sheet:savedSheetFrom(sheet)})});
export const deleteSiteSheet=({id,session,read=sheetApi})=>read(SITE_SHEETS_API+'/'+encodeURIComponent(id),session,{method:'DELETE'});

// Opens a saved sheet and compares it with Pulse-II now. Returns {saved, result, lines, range}.
export async function openSiteSheet({id,session,today=todayIst(),read=sheetApi}){
 const saved=await read(SITE_SHEETS_API+'/'+encodeURIComponent(id),session);
 const sheet={...saved.sheet,people:(saved.sheet?.people||[]).map(p=>({...p,number:employeeNumber(p.id)}))};
 const range=sheetReadRange(sheet,today);
 if(!range)throw Error('No date of this sheet can be compared: Pulse-II holds attendance from 01-11-2026 up to today.');
 const [attendance,master]=await Promise.all([
  read('/api/reports/manpower/attendance?'+new URLSearchParams({from:range.from,to:range.to,view:'attendance'}),session),
  read('/api/reports/manpower/attendance-sheet/people',session,{method:'POST',body:JSON.stringify({site:saved.site,ids:sheet.people.map(person=>person.id)})}),
 ]);
 const result=checkAttendanceSheet({sheet,site:master.site||saved.site,lines:[...(attendance.otDuties||[]),...(attendance.attendanceEquipment||[])],lockedDays:attendance.lockedDays||[],
  people:master.people||[],sitePeople:master.sitePeople||[],today});
 return {saved,result,lines:sheetDayLines(result),range,readAt:new Date().toISOString()};
}
