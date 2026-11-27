// Trip card attendance has one master: Pulse-II (owner, 27 Nov 2026).
//   "MIS will be the primary master for HR to fetch in the roster. And if MIS gives the data to HR, and if HR makes any
//    changes, it has to be through OTP. If HR makes absent as present or present as absent, then the same has to be
//    re-updated in MIS also."
// HR Pulse shows what Pulse-II sends and keeps no attendance of its own. A change HR wants is asked for here, approved
// with an OTP, kept here, and counted by every attendance read of Pulse-II, so both sides always say the same.
//   present: a Present entry is made in mis_shift_attendance (kind HR_PRESENT_KIND, reason HR_PRESENT_REASON). No card.
//   absent:  the card stays with its trips, hours and production ("Yes, keep the card"); only its attendance is not
//            counted. The change is a line in mis_hr_attendance_changes and a review item on the card.
//   card:    an earlier HR change is taken back; attendance is again what the cards say.
// One person, site, date and shift has one live change. Server: server/routes/hr-attendance-change.mjs.
import {createHash} from 'node:crypto';
import {canonicalSiteName} from './site-location.mjs';
import {employeeNumber} from './hr-employee-master.mjs';
import {OTP_TTL_MINUTES} from './otp-approval.mjs';

export const HR_MARKS=['present','absent','card'];
export const HR_PRESENT_REASON='Marked present in HR Pulse';
export const HR_PRESENT_KIND='hr';
export const HR_CHANGE_REASON_MIN=10;
export const HR_CHANGE_FROM='2026-11-01';
export const HR_DUTY_SHIFTS=['S1','S2','S3','D','N'];

const text=value=>String(value??'').trim();
const clean=(value,max)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,max);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const realDate=d=>ISO.test(String(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const fmtDate=d=>`${d.slice(8,10)}-${d.slice(5,7)}-${d.slice(0,4)}`;
export const indiaToday=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));

export const isHrPresentEntry=entry=>text(entry?.reason)===HR_PRESENT_REASON;
// One person whatever the prefix: CMPL8812, CMLL8812 and 8812 are the number 8812. An ID with no number is itself.
export const personToken=value=>employeeNumber(value)||text(value).toUpperCase().replace(/[\s/-]/g,'');
export const dutyToken=({employeeKey,site,siteKey,date,shift})=>[personToken(employeeKey),siteKey||canonicalSiteName(site),date,shift].join('|');

// What HR Pulse sends: {site,date,shift,employeeId,mark,reason}. Returns the cleaned change or throws (status 400).
export function hrChangeInput(body,{today=indiaToday()}={}){
 const mark=text(body?.mark).toLowerCase(),date=text(body?.date),shift=text(body?.shift).toUpperCase(),site=clean(body?.site,120),employee=clean(body?.employeeId??body?.employeeKey,60),reason=clean(body?.reason,500);
 if(!HR_MARKS.includes(mark))throw fail(400,'Choose Present, Absent or "as the trip card says".');
 if(!realDate(date))throw fail(400,'Choose the date.');
 if(date<HR_CHANGE_FROM)throw fail(400,'Trip card attendance starts on 1 November 2026.');
 if(date>today)throw fail(400,'Attendance of a later date cannot be changed.');
 if(!canonicalSiteName(site))throw fail(400,'Choose the site.');
 if(!HR_DUTY_SHIFTS.includes(shift))throw fail(400,'Choose the shift: S1, S2, S3, D or N.');
 if(!personToken(employee))throw fail(400,'Choose the employee.');
 if(reason.length<HR_CHANGE_REASON_MIN)throw fail(400,'Write why this attendance is changed (at least '+HR_CHANGE_REASON_MIN+' letters).');
 return {mark,date,shift,site,siteKey:canonicalSiteName(site),employee,person:personToken(employee),reason};
}

// The live "absent" changes as a lookup by duty. Each: {id,siteKey,date,shift,person,by,reason,at}.
export function hrAbsences(changes){
 const out=new Map();
 for(const c of Array.isArray(changes)?changes:[]){const person=text(c?.person)||personToken(c?.employeeKey);if(person&&c?.siteKey&&c?.date&&c?.shift)out.set([person,c.siteKey,c.date,c.shift].join('|'),c);}
 return out;
}
// The review item written on a card whose attendance HR Pulse switched off.
export const absentNote=change=>'Attendance not counted: marked absent in HR Pulse with OTP'+(change?.by?' by '+change.by:'')+(change?.reason?' ('+change.reason+')':'')+'. The card and its trips are kept.';
// The remarks of a Present entry HR Pulse made.
export const presentRemarks=({by,reason,approvedBy=[]})=>clean('HR Pulse'+(by?' · '+by:'')+(approvedBy.length?' · OTP from '+approvedBy.join(', '):'')+' · '+reason,2000);

const MARK_LINE={
 present:'A Present entry is made in Pulse-II for this shift. No trip card is made.',
 absent:'The trip card stays with its trips and hours; only the attendance of this shift is not counted.',
 card:'The earlier HR change is taken back; attendance is again what the trip cards say.'};
const MARK_WORD={present:'PRESENT',absent:'ABSENT',card:'as the trip card says'};
export function hrChangeOtpMessage({site,region,date,shift,employeeId,employeeName,mark,requestedBy,reason,otp,minutes=OTP_TTL_MINUTES}){
 return ['🧾 PULSE-II · ATTENDANCE CHANGE FROM HR PULSE',
  `${requestedBy} (HR Pulse) asks to mark ${employeeName||employeeId}${employeeName?` (${employeeId})`:''} ${MARK_WORD[mark]} · ${site}${region?` (${region})`:''} · ${fmtDate(date)} · ${shift}.`,
  `Reason: ${reason}`,'',
  `OTP ${otp}, valid ${minutes} minutes. Share it only if this change is right. ${MARK_LINE[mark]}`].join('\n');
}
export function hrChangeDoneMessage({site,date,shift,employeeId,employeeName,mark,requestedBy,reason,approvedBy=[]}){
 return ['🧾 PULSE-II · ATTENDANCE CHANGED FROM HR PULSE',
  `${employeeName||employeeId}${employeeName?` (${employeeId})`:''} is now ${MARK_WORD[mark]} · ${site} · ${fmtDate(date)} · ${shift}.`,
  `Asked by ${requestedBy} (HR Pulse)${approvedBy.length?', OTP from '+approvedBy.join(', '):''}.`,`Reason: ${reason}`,MARK_LINE[mark]].join('\n');
}

// One signature per site and day of what Pulse-II sends HR Pulse (duty and presence lines). HR Pulse keeps a saved day
// only while its signature is the one Pulse-II gives now, so a card saved, corrected or re-attributed later, a master
// change that moves a card to another person, or an HR change can never leave an old copy on HR's screen.
// days: the "siteKey|date" keys to sign (a day with no line is signed too, so "nobody" is also a checked answer).
export function hrDaySignatures(lines,days){
 const by=new Map([...days].map(k=>[k,[]]));
 for(const line of lines){const k=line.siteKey+'|'+line.date;if(by.has(k))by.get(k).push(JSON.stringify(line));}
 return [...by].sort(([a],[b])=>a.localeCompare(b)).map(([k,list])=>{
  const cut=k.lastIndexOf('|'),hash=createHash('sha256');
  for(const one of list.sort())hash.update(one).update('\u0000');
  return {siteKey:k.slice(0,cut),date:k.slice(cut+1),lines:list.length,signature:hash.digest('hex').slice(0,32)};
 });
}
