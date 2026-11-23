// Attendance Sheet Mismatch: reading the uploaded Excel and running the check (the screen is src/attendance-sheet-check.jsx,
// the rules shared/attendance-sheet-check.mjs). Kept apart from the screen so it runs in a test without a browser.
import {attendanceSheetWorkbook,checkAttendanceSheet,parseAttendanceSheet,sheetReadRange} from '../shared/attendance-sheet-check.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {formatDisplayDateTime} from '../shared/date-time-format.mjs';

export const todayIst=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);

// Every call carries the login's Bearer token: a call without it signs the user out.
export async function sheetApi(url,session,options={}){
 const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+session.token,...(options.body?{'Content-Type':'application/json'}:{})}});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(payload.error||'Pulse-II could not be read. Please try again.');
 return payload;
}

// The first worksheet of the file that is an attendance sheet; hidden and other worksheets are passed over.
// reader: read-excel-file's {default, readSheetNames}; a test passes its own.
export async function readAttendanceFile(file,reader){
 const {default:readXlsxFile,readSheetNames}=reader||await import('read-excel-file');
 let names;
 try{names=await readSheetNames(file);}catch{throw Error('This file could not be opened as an Excel workbook. Save it as Excel Workbook (.xlsx) and upload again.');}
 const refused=[];
 for(const name of names){
  let rows;try{rows=await readXlsxFile(file,{sheet:name});}catch{continue;}
  try{return {sheetName:name,...parseAttendanceSheet(rows)};}catch(error){refused.push(error.message);}
 }
 // The reason that says most: a sheet that is nearly right (day numbers for dates, headings with no line under them).
 throw Error(refused.find(message=>/day numbers|employee line/.test(message))||refused[0]||'No worksheet of this file could be read.');
}

// Reads Pulse-II for the dates of the sheet, compares, and builds the Excel. Returns {result, range, title, blob, name}.
// read, build: the server read and the workbook builder; a test passes its own.
export async function runSheetCheck({sheet,fileName,site,session,today=todayIst(),read=sheetApi,build=buildXlsxSheetsWorkbook}){
 const range=sheetReadRange(sheet,today);
 if(!range)throw Error('No date of this sheet can be compared: Pulse-II holds attendance from 01-11-2026 up to today.');
 const [attendance,master]=await Promise.all([
  read('/api/reports/manpower/attendance?'+new URLSearchParams({from:range.from,to:range.to,view:'attendance'}),session),
  read('/api/reports/manpower/attendance-sheet/people',session,{method:'POST',body:JSON.stringify({site,ids:sheet.people.map(person=>person.id)})}),
 ]);
 const result=checkAttendanceSheet({sheet,site:master.site||site,lines:[...(attendance.otDuties||[]),...(attendance.attendanceEquipment||[])],lockedDays:attendance.lockedDays||[],
  people:master.people||[],sitePeople:master.sitePeople||[],today});
 const book=attendanceSheetWorkbook(result,{fileName,checkedAt:formatDisplayDateTime(new Date())});
 // The file is named by the dates compared, as its title is (the read may reach one date further: a date the sheet has no column for).
 const siteSlug=result.site.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,''),compared=result.dates.compared;
 return {result,range,title:book.title,blob:build(book.title,book.sheets),name:`Attendance-sheet-mismatch-${siteSlug}-${compared[0]||range.from}-to-${compared.at(-1)||range.to}.xlsx`};
}
