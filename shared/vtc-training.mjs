// VTC Training attendance (owner, 25 Nov 2026: "TRAING VTC KA OPTION ALAG COLOUR ME DO AUR USE PRESENT DIKHAO",
// "ISE 0 TRIP KE SATH MAT JODO"). A driver or operator sent for VTC training is present for that date and shift.
// It is its own entry ("VTC Training" beside "Present — 0 trips" on VLB / ELB Manual), never a zero-trip entry:
//  - kept in mis_shift_attendance with the reason VTC_TRAINING_REASON and no machine, so every attendance read
//    (Attendance Batch-wise / Month-wise, the HR feed, the sheet checks) counts it as present;
//  - drawn in its own colour (purple, flag 'training'), listed as "VTC Training", never as "Present — 0 trips" or
//    in a batch's zero-trip list, and never as a zero-trip source.
export const VTC_TRAINING_REASON='VTC Training';
export const TRAINING_FLAG='training';
export const TRAINING_STATUS='Present — VTC Training';
export const TRAINING_FLAG_LABEL='PURPLE — VTC Training';
export const TRAINING_SOURCE='training';
export const isTrainingEntry=entry=>String(entry?.reason??'').trim()===VTC_TRAINING_REASON;

// Owner, 25 Nov 2026 (second order): "here i need from date to date ... and remove shift". One save covers every day
// From to To. A training day has no shift of its own: each day is kept once, in the first shift (TRAINING_SHIFT), so
// attendance counts the person present once that day. At most TRAINING_MAX_DAYS days, none after today (India).
export const TRAINING_SHIFT='S1';
export const TRAINING_MAX_DAYS=31;
// One save may take several people (owner, 25 Nov 2026: bulk), up to TRAINING_MAX_PEOPLE.
export const TRAINING_MAX_PEOPLE=100;
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const realDate=d=>ISO.test(String(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
export const indiaToday=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
// The days of a training range, or {error}.
export function trainingDays(from,to,{today=indiaToday(),start='2026-11-01'}={}){
 if(!realDate(from)||!realDate(to))return {error:'Select the From and To dates of the training.'};
 if(to<from)return {error:'To date cannot be before From date.'};
 if(from<start)return {error:'Operations start on 1 November 2026. Earlier dates and testing data are locked for all users.'};
 if(to>today)return {error:'VTC Training can be saved up to today, not for a later date.'};
 const days=[];
 for(let d=from;d<=to;d=new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
  days.push(d);if(days.length>TRAINING_MAX_DAYS)return {error:`Select up to ${TRAINING_MAX_DAYS} days at a time.`};
 }
 return {days};
}
