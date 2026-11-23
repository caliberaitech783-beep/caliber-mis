// Attendance Sheet Mismatch (drivers and operators): reading the biometric file and running the check against trip card
// attendance. The screen is src/attendance-sheet-check.jsx, the rules shared/trip-biometric-check.mjs.
// Kept apart from the screen so it runs in a test without a browser.
import {biometricDays,biometricRange,tripBiometricCheck,tripBiometricWorkbook} from '../shared/trip-biometric-check.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {formatDisplayDateTime} from '../shared/date-time-format.mjs';
import {sheetApi,todayIst} from './attendance-sheet-run.mjs';

export {sheetApi,todayIst};

// The attlog .dat / .txt is read as text; an Excel or CSV export through read-excel-file or as comma lines.
// reader: read-excel-file's default export; a test passes its own.
export async function readBiometricFile(file,reader){
 const name=String(file?.name||'').toLowerCase();
 if(/\.(xlsx|xlsm)$/.test(name)){
  const read=reader||(await import('read-excel-file')).default;
  let rows;try{rows=await read(file);}catch{throw Error('This Excel file could not be opened. Save it as Excel Workbook (.xlsx) and upload again.');}
  return biometricDays({rows});
 }
 const content=await file.text();
 if(/\.csv$/.test(name)&&!/\t/.test(content.slice(0,2000)))return biometricDays({rows:content.split(/\r?\n/).map(line=>line.split(',').map(cell=>cell.replace(/^"|"$/g,'').trim()))});
 return biometricDays({content});
}

// Reads Pulse-II for the dates of the file and compares. Returns {result, range, title, blob, name}.
// read, build: the server read and the workbook builder; a test passes its own.
export async function runTripBiometricCheck({bio,fileName,site,session,today=todayIst(),read=sheetApi,build=buildXlsxSheetsWorkbook}){
 const range=biometricRange(bio.days,today);
 if(!range)throw Error('No date of this file can be compared: Pulse-II holds attendance from 01-11-2026 up to today.');
 const attendance=await read('/api/reports/manpower/attendance?'+new URLSearchParams({from:range.from,to:range.to,view:'attendance'}),session);
 const lines=[...(attendance.otDuties||[]),...(attendance.attendanceEquipment||[])];
 const numbers=[...new Set([...bio.days.map(d=>d.caliberCode),...lines.map(l=>String(l.employeeId||l.caliberCode||'').trim()).filter(Boolean)])];
 const master=await read('/api/reports/manpower/attendance-sheet/people',session,{method:'POST',body:JSON.stringify({site,ids:numbers.slice(0,5000)})});
 const result=tripBiometricCheck({days:bio.days,lines,lockedDays:attendance.lockedDays||[],people:master.people||[],site:master.site||site,from:range.from,to:range.to});
 const book=tripBiometricWorkbook(result,{fileName,checkedAt:formatDisplayDateTime(new Date())});
 const siteSlug=result.site.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'');
 return {result,range,title:book.title,blob:build(book.title,book.sheets),name:`Trip-card-vs-biometric-${siteSlug}-${range.from}-to-${range.to}.xlsx`};
}
