// Zero-trip attendance (owner, 24 Nov 2026): a card entered by hand with 0 trips shows the driver's biometric punch
// for the card's date, so the entry is checked against attendance before it is saved. Nothing is blocked: the card
// form only colours the line (green: punched, red: no punch).
// days: one line per employee and date (shared/trip-biometric-check.mjs: machine punches and imported ones together).
// A Shift III or Night card ends the next morning, so a punch on the next date counts for it as well.
import {employeeNumber} from './hr-employee-master.mjs';

export const OVERNIGHT_SHIFTS=Object.freeze(['III','Night']);
const ISO=/^\d{4}-\d{2}-\d{2}$/;
export const validCardDate=d=>ISO.test(String(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
export const nextDate=d=>new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);

// The dates to read punches for: the card's date, and the next one for an overnight shift.
export function attendanceRange(bookDate,cardShift){
 return {from:bookDate,to:OVERNIGHT_SHIFTS.includes(cardShift)?nextDate(bookDate):bookDate};
}

// A duty's line carries the date of its In punch. A lone Out on the next morning (before 10:00) is the end of an
// overnight duty whose In was not read; the next day's own duty starts with an In and is not counted.
const OVERNIGHT_OUT_BEFORE='10:00';

export function zeroTripAttendance({days=[],code,bookDate,cardShift,machine={}}){
 const number=employeeNumber(code);
 if(!number)return {status:'no-code',code:'',punches:[],message:'This employee has no CMLL number in the master, so the biometric punch cannot be read.'};
 const overnight=OVERNIGHT_SHIFTS.includes(cardShift),next=nextDate(bookDate);
 const punches=days.filter(d=>employeeNumber(d.caliberCode)===number&&(d.date===bookDate||overnight&&d.date===next&&!d.inTime&&d.outTime&&d.outTime<OVERNIGHT_OUT_BEFORE))
  .map(d=>({date:d.date,inTime:d.inTime||'',outTime:d.outTime||'',site:d.site||'',source:d.source||''}))
  .sort((a,b)=>a.date.localeCompare(b.date));
 const machineNote=machine.asked&&!machine.connected&&machine.error?machine.error:'';
 if(punches.length)return {status:'present',code:number,punches,message:'',machineNote};
 return {status:'absent',code:number,punches:[],machineNote,
  message:`No biometric punch for CMLL ${number} on ${bookDate}${overnight?' or the next morning':''}. Check the driver's attendance before saving a 0-trip card.`};
}
