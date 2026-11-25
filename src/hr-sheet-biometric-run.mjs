// Attendance Sheet Mismatch › HR sheet vs Biometric: the reads and the run (the screen is src/hr-sheet-biometric.jsx, the
// rules shared/hr-sheet-biometric.mjs). Kept apart from the screen so it runs in a test without a browser.
// Reads: the punches Pulse-II holds (/attendance-sheet/biometric) unless a device file was uploaded, Employee Master for
// the numbers (/attendance-sheet/people) and the trip cards of the dates (/attendance, only shown beside a day; a read
// that fails is said and the check goes on).
import {hrSheetBiometricCheck,hrSheetBiometricWorkbook,hrSheetRange} from '../shared/hr-sheet-biometric.mjs';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {formatDisplayDateTime} from '../shared/date-time-format.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {SHEET_MAX_PEOPLE} from '../shared/attendance-sheet-check.mjs';
import {sheetApi,todayIst} from './attendance-sheet-run.mjs';
import {SOURCE_CHOICES} from './trip-biometric-run.mjs';

const slug=value=>String(value).replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'');

// sheet: readAttendanceFile's result. bio: readBiometricFile's result when a device file was uploaded, else null.
// Returns {result, range, biometric, cardsError, title, blob, name}.
export async function runHrSheetBiometricCheck({sheet,fileName,site,bio=null,bioName='',source='both',session,today=todayIst(),read=sheetApi,build=buildXlsxSheetsWorkbook}){
 const range=hrSheetRange(sheet,today);
 if(!range)throw Error('No date of this HR sheet can be compared: every marked date is after today.');
 const numbers=[...new Set(sheet.people.map(p=>p.number).filter(Boolean))].slice(0,SHEET_MAX_PEOPLE);
 const cardsRead=read('/api/reports/manpower/attendance?'+new URLSearchParams({from:range.from,to:range.to,view:'attendance'}),session)
  .then(a=>({lines:[...(a.otDuties||[]),...(a.attendanceEquipment||[])],error:''}),e=>({lines:[],error:e.message}));
 let biometric,days;
 if(bio){days=bio.days;biometric={file:true,name:bioName,punches:bio.punches,days:bio.days.length};}
 else{
  biometric=await read('/api/reports/manpower/attendance-sheet/biometric',session,{method:'POST',body:JSON.stringify({site,from:range.from,to:range.to,source,numbers})});
  if(!biometric.machine?.connected&&biometric.machine?.asked&&!biometric.imported?.asked)throw Error(biometric.machine.error||'The machine punches could not be read.');
  days=biometric.days||[];
 }
 const siteKey=canonicalSiteName(site),onSheet=new Set(numbers);
 const punchedHere=[...new Set(days.filter(d=>d.date>=range.from&&d.date<=range.to&&(!d.site||canonicalSiteName(d.site)===siteKey)).map(d=>d.caliberCode))].filter(n=>!onSheet.has(n));
 const ids=[...numbers,...punchedHere].slice(0,SHEET_MAX_PEOPLE);
 const [master,cards]=await Promise.all([
  read('/api/reports/manpower/attendance-sheet/people',session,{method:'POST',body:JSON.stringify({site,ids:ids.length?ids:sheet.people.map(p=>p.id).slice(0,SHEET_MAX_PEOPLE)})}),
  cardsRead,
 ]);
 const result=hrSheetBiometricCheck({sheet,site:master.site||site,days,people:master.people||[],lines:cards.lines,from:range.from,to:range.to});
 const bioLabel=bio?'device file '+bioName:'held in Pulse-II, '+(SOURCE_CHOICES.find(c=>c.value===source)?.label||source);
 const book=hrSheetBiometricWorkbook(result,{fileName,bioLabel,checkedAt:formatDisplayDateTime(new Date())});
 return {result,range,biometric,cardsError:cards.error,bioLabel,title:book.title,blob:build(book.title,book.sheets),
  name:`HR-sheet-vs-biometric-${slug(result.site)}-${result.dates.compared[0]||range.from}-to-${result.dates.compared.at(-1)||range.to}.xlsx`};
}
