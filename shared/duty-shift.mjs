// Attendance from every trip card, scanned or manual (owner, 24 Nov 2026): "attendance should mark whether any process is
// done through scan or manual entry". A saved VLB, ELB or LMV card with an employee is a duty in the shift it names, and that
// duty is the person's attendance (P) and the trip card side of the biometric punch check.
//
// The shift of a duty, read from the labels a card carries (book shift code, the shift marked on the card, the shift name
// saved from the Shift Master or the manual Shift choice, the Shift Master entry saved as shiftId):
//  - Day or Night (12 hours) chosen or marked on the card wins over the batch's 8-hour label. A manual ELB or LMV entered
//    in a Shift I batch as "Day, 12 Hrs" keeps the batch's book shift code S1 and is saved with the shift name "Day"; it is
//    a Day duty. Before this rule the two labels were taken as a conflict and the card was left out of attendance.
//  - A card naming both Day and Night is a conflict and needs review.
//  - Otherwise the 8-hour labels (Shift I, II, III) must agree, as before.
// Do not remove this rule; test/duty-shift.test.mjs checks it.
import {bookShiftCode} from './trip-card-rules.mjs';

export const TWELVE_HOUR_CODES=['D','N'];
export function cardDutyShift(data={},savedShift=null){
 const labels=[data.manualShift,data.bookShiftCode,data.cardShift,data.shiftName,savedShift?.shiftCode||savedShift?.shiftName].map(bookShiftCode).filter(Boolean);
 const twelve=[...new Set(labels.filter(code=>TWELVE_HOUR_CODES.includes(code)))];
 if(twelve.length===1)return {code:twelve[0],conflict:false};
 if(twelve.length>1)return {code:'',conflict:true};
 const codes=[...new Set(labels)];
 return codes.length>1?{code:'',conflict:true}:{code:codes[0]||'',conflict:false};
}

// Manual entry (owner, 24 Nov 2026): Shift and Shift Hrs are both mandatory on a manual ELB, and Day / Night is a 12-hour
// shift. `choice` is the Shift picked on the ELB Manual machine entry: 'batch' (the batch's own shift), 'day' or 'night'.
export const MANUAL_ENTRY_SHIFT_CHOICES=['batch','day','night'];
// `batchShift`: the batch's shift code; a Day or Night batch is 12 hours too.
export function manualEntryShiftIssue({choice,shiftHours,flexibleHours=false,batchShift=''}={}){
 if(!MANUAL_ENTRY_SHIFT_CHOICES.includes(choice))return 'Select the Shift (batch shift, Day or Night). Shift is mandatory.';
 if(flexibleHours)return '';
 if(shiftHours===undefined||shiftHours===null||shiftHours==='')return 'Select Shift Hrs (8 or 12). Shift Hrs is mandatory.';
 if((['day','night'].includes(choice)||choice==='batch'&&TWELVE_HOUR_CODES.includes(bookShiftCode(batchShift)))&&Number(shiftHours)!==12)return 'Day and Night are 12-hour shifts. Select 12 Hrs.';
 return '';
}
