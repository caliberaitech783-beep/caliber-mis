// The Attendance register read (Batch-wise, Month-wise, Site Sheet vs Trip Card, Trip Card vs Bio-punch, the biometric
// punch check) and the HR feed, built away from the server's main thread (24 Nov 2026).
//
// On 24 Nov the live server stopped answering for up to 8 s at a time while people opened these screens: one read of a
// month took 25 s on average (106 s at worst), and each week's cards were unpacked and built on the main thread, so card
// saves, auto-saves and every page waited behind it. Now the database hands over each week's cards as JSON text, a report
// worker (report-build-pool.mjs) unpacks and builds the week, and the worker also joins the weeks and writes the answer as
// JSON text. The main thread only passes text along. The figures are the same as before; only where the work runs changed.
import {buildManpowerReport,joinAttendanceReports,pendingSiteDays} from './manpower-report.mjs';
import {linkVlbTripHandovers} from '../../shared/vlb-trip-handover.mjs';
import {siteAllowed} from '../../shared/log-book-access.mjs';

// What the register reads of a duty line and of a presence line.
const DUTY_FIELDS=['id','date','shift','site','siteKey','employeeKey','employeeId','caliberCode','employeeName','category','equipment','doors','makeModel','logBook','flag','flagLabel','hours','trips','km','books'];
// The log book, how the duty came in (scanned, manual, zero-trip entry) and its batches: Site Sheet vs Trip Card and
// Trip Card vs Bio-punch filter and count by them. machineBook: the log book of a zero-trip entry's machine (it has no card).
const CARD_FIELDS=['logBooks','source','batches','machineBook'];
const PRESENCE_FIELDS=['date','shift','site','siteKey','employeeKey','employeeId','caliberCode','employeeName','equipment','doors','makeModel','flag','flagLabel','trips','actual'];
const pick=(row,fields)=>Object.fromEntries(fields.map(k=>[k,row[k]]));

// One week: its cards (rows, or cardsJson = JSON texts of card arrays), the batches of each card (links, or linksJson =
// {card id: batches}; the HR feed has none), the masters (or mastersJson), the week's zero-trip entries and the batches.
// scope: the caller's site access ({sites}), so a card of another site is left out as before.
// punched: who punched the biometric machine in the week (server/services/attendance-punches.mjs).
export function buildAttendanceWeek({cards,cardsJson=[],links,linksJson,masters,mastersJson,attendance=[],batches=[],filters,hr=false,scope,punched=[],build=buildManpowerReport}){
 const rows=(cards??cardsJson.flatMap(text=>JSON.parse(text))).filter(r=>siteAllowed(scope,r.site));
 const of=links??(linksJson?JSON.parse(linksJson):null);
 const withBatches=hr||!of?rows:rows.map(r=>Object.hasOwn(of,String(r.id))?{...r,batches:of[String(r.id)]}:r);
 masters??=JSON.parse(mastersJson);
 const vehicles=linkVlbTripHandovers(withBatches.filter(r=>r.book_type==='vehicle'));
 return build({records:[...vehicles,...withBatches.filter(r=>r.book_type!=='vehicle')],attendance,...masters,batches,filters,parts:hr?'hr-attendance':'attendance',lockedOnly:true,punched});
}

// The answer of the register (hr=false) or of the HR feed (hr=true) from the joined weeks.
// locked: the locked site-days ("siteKey|date") of the whole range, as a Set or an array.
export function attendanceAnswer({parts,filters,hr=false,scope,locked,generatedAt=new Date().toISOString()}){
 const lockedSet=locked instanceof Set?locked:new Set(locked||[]);
 const report=joinAttendanceReports(parts,filters);
 if(hr)return {
  attendanceEquipment:report.attendanceEquipment.map(row=>pick(row,[...PRESENCE_FIELDS,'status','reason','remarks','logBooks'])),
  attendanceShifts:report.attendanceShifts.filter(row=>siteAllowed(scope,row.siteKey)),
  otDuties:report.otDuties.map(row=>pick(row,[...DUTY_FIELDS,'logBooks'])),
  performance:report.otDuties.map(row=>pick(row,['date','site','siteKey','shift','employeeId','employeeName','start','end','km'])),
  details:report.otDuties.filter(row=>row.scanned).map(row=>({...pick(row,['date','site','siteKey','shift','employeeId','employeeName']),batchStatus:'Saved scan'})),
  exceptions:report.exceptions.map(row=>pick(row,['date','site','siteKey','shift','employeeId','employeeName','reason'])),
  ot:report.ot.map(row=>pick(row,['site','siteKey','employeeId','schedule'])),
  // Only locked site-days are sent. These are the days left out because a shift is still open, reopened or has no batch;
  // nobody is absent on them, the figures come once the day is locked.
  pendingDays:pendingSiteDays(report.attendanceShifts.filter(row=>siteAllowed(scope,row.siteKey)),lockedSet)
 };
 const dutyKey=d=>[d.employeeKey,d.siteKey,d.date,d.shift].join('|'),held=new Set(report.otDuties.map(dutyKey));
 // The locked site-days of the selected dates, so the register marks a day ? or counts it by the same rule as the server.
 const lockedDays=[...lockedSet].filter(k=>{const date=k.slice(k.lastIndexOf('|')+1);return date>=filters.from&&date<=filters.to&&siteAllowed(scope,k.slice(0,k.lastIndexOf('|')));}).sort();
 return {filters:report.filters,lockedDays,otDuties:report.otDuties.map(d=>pick(d,[...DUTY_FIELDS,...CARD_FIELDS])),
  // Only presence the duty lines do not already hold: a zero-trip entry without a card, or the second operator of a card.
  attendanceEquipment:report.attendanceEquipment.filter(r=>r.actual&&r.employeeKey&&r.shift&&!held.has(dutyKey(r))).map(r=>pick(r,[...PRESENCE_FIELDS,...CARD_FIELDS])),
  attendanceShifts:report.attendanceShifts.filter(s=>siteAllowed(scope,s.siteKey)),
  otSites:report.otSites.filter(s=>siteAllowed(scope,s.site)),attendanceSites:report.attendanceSites.filter(s=>siteAllowed(scope,s.site)),
  exceptions:report.exceptions,notes:report.notes,generatedAt};
}

// A week keeps only what the join and both answers read (24 Nov 2026: 22.7 MB a week of every site before, kept in the
// answer cache). Duty and presence lines keep the fields the answers pick or filter by; the other tables are not used.
const WEEK_DUTY_FIELDS=[...new Set([...DUTY_FIELDS,...CARD_FIELDS,'logBooks','start','end','km','scanned'])];
const WEEK_PRESENCE_FIELDS=[...new Set([...PRESENCE_FIELDS,...CARD_FIELDS,'status','reason','remarks','logBooks','actual'])];
export function trimAttendanceWeek(report){
 return {filters:report.filters,otDuties:report.otDuties.map(row=>pick(row,WEEK_DUTY_FIELDS)),attendanceEquipment:report.attendanceEquipment.map(row=>pick(row,WEEK_PRESENCE_FIELDS)),
  attendanceShifts:report.attendanceShifts,exceptions:report.exceptions,ot:report.ot,otSites:report.otSites,attendanceSites:report.attendanceSites,notes:report.notes};
}

// The two worker builds (report-builds.mjs). Each hands back JSON text: a week the main thread only holds until the join
// (or keeps in the answer cache), and the answer it only sends.
export const attendanceWeekJson=input=>JSON.stringify(trimAttendanceWeek(buildAttendanceWeek(input)));
export const attendanceAnswerJson=({weeks,...rest})=>JSON.stringify(attendanceAnswer({...rest,parts:weeks.map(({window,json})=>({window,report:JSON.parse(json)}))}));
