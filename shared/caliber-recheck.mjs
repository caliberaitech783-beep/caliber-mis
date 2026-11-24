// The re-check of saved cards against Employee Master (owner, 22 Nov 2026).
//
// "Once the employee master in Pulse-II is ready we will run this complete report, how many changes are there,
// and solve them at once." Every card saved since 1 Nov 2026 is judged again by the rule a new scan is judged by
// (shared/caliber-id-check.mjs), at the card's own site and date: is the saved driver or operator a working
// driver or operator of that site on that date? The pictures are not read again; this reads what was saved.
//
// A card is listed when the saved number
//   - belongs to nobody, or to a person who is not in HR's list or has left,
//   - belongs to a worker of another site on that date (an approved site move counts from its date),
//   - belongs to a helper, mechanic or supervisor nobody has confirmed as a driver,
//   - is on two people of the site, or
//   - is a working driver of the site, but the card's FORM A box names another one, one digit away
//     (A Form Master): the misread that lands on a colleague.
// Each listed card carries the look-alike IDs of its site and whom the FORM A box names. Nothing here reads the
// name written on the card or the vehicle's other drivers: the owner removed those checks.
import {judgeCaliberId,caliberNumber,EMPLOYEE_LISTS,ID_NOT_FOUND,CONTACT_HR,HR_REFRESH_REASONS} from './caliber-id-check.mjs';
import {matchesSamePerson} from './employee-identity.mjs';
import {cardDutyShift} from './duty-shift.mjs';

const text=value=>String(value??'').replace(/\s+/g,' ').trim();
// 'not-listed' is the number Employee Master still holds from the old list but HR's employee list does not: for the
// person at the card it is simply an ID that was not found (owner, 23 Nov 2026).
export const RECHECK_REASONS={
 'unknown':'No such number','not-listed':'ID not found','left':'Has left','other-site':'Another site',
 'not-driver':'Not a driver or operator','several':'Number on two people','a-form-differs':'FORM A names a colleague',
 // Attendance not counted (owner, 24 Nov 2026): the driver stands, but the card still marks no attendance.
 'no-driver':'No driver on a working card','id-mismatch':'Employee ID and Caliber ID differ','no-shift':'Shift missing or two shifts',
};
// The order a list of reasons is shown in: the surest first.
export const RECHECK_REASON_ORDER=['not-listed','left','unknown','other-site','a-form-differs','not-driver','several','no-driver','id-mismatch','no-shift'];
// The reasons fixed by choosing the shift on the line, not the driver.
export const SHIFT_REASONS=['no-shift'];

const rowsById=new WeakMap();
function employeeRows(masters){
 let rows=rowsById.get(masters);
 if(!rows){rows=new Map();for(const row of masters)if(EMPLOYEE_LISTS.includes(row.master_name))rows.set(String(row.id),row);rowsById.set(masters,rows);}
 return rows;
}
const numberOf=record=>text(record?.caliberId||record?.employeeId||record?.empId);

// The line of a listed card: what Employee Master says about the number the card was saved under.
export function recheckLine(check,kind='vehicle'){
 const who=[check.name,check.designation].filter(Boolean).join(', '),is=who?check.read+' is '+who:'';
 const box=check.aForm?.no&&check.aForm?.id?' The FORM A box says '+check.aForm.no+': at '+check.at+' that is '+check.aForm.id+(check.aForm.name?' ('+check.aForm.name+')':'')+'.':'';
 switch(check.reason){
  case 'unknown':return (check.read?ID_NOT_FOUND:"The saved driver's line is no longer in Employee Master.")+box;
  case 'not-listed':return ID_NOT_FOUND+box;
  case 'left':return is+'. '+(check.left==='hr'?"HR's list says this person has left.":'Employee Master says this person has resigned.')+CONTACT_HR+box;
  case 'other-site':return is+(check.site?', of '+check.site+' on this date.':', of another site on this date.')+box;
  case 'not-driver':return is+': not a driver or operator.'+box;
  case 'several':return 'More than one employee at '+check.at+' has number '+check.read+'.'+box;
  case 'a-form-differs':return is+'. But the FORM A box says '+(check.aForm?.no||'another number')+': at '+check.at+' that is '+(check.aForm?.id||'another person')+(check.aForm?.name?' ('+check.aForm.name+')':'')+', one digit away.';
  case 'no-driver':return 'Nobody is saved on this card, but it shows work, so no attendance is marked.';
  case 'id-mismatch':return 'The Employee ID and the Caliber ID on this card name different people, so no attendance is marked.';
  case 'no-shift':return 'The card names no shift, or two, so no attendance is marked.';
  default:return '';
 }
}

// card: {kind:'vehicle'|'lmv'|'equipment', site, date, employeeId, caliberId, aFormNo}. Returns null when the saved
// driver stands, or why the card is listed: {reason, read, name, designation, site, left, lookAlikes, more, aForm, line}.
export function recheckSavedCard(masters,card){
 const kind=card.kind==='equipment'?'equipment':'vehicle';
 const saved=employeeRows(masters).get(String(card.employeeId??''));
 const read=text(card.caliberId)||numberOf(saved?.record_data);
 // A card saved with nobody on it (a machine that stood idle) has nothing to judge.
 if(!read&&!text(card.employeeId))return null;
 const listed=check=>({...check,read:check.read||caliberNumber(read)||read,line:recheckLine({...check,read:check.read||caliberNumber(read)||read},kind)});
 if(!read)return listed({reason:'unknown',at:text(card.site),read:''});
 const base=judgeCaliberId(masters,{read,location:card.site,date:card.date});
 // The FORM A box is on trip cards (VLB and LMV), not on job cards.
 const form=card.kind!=='equipment'&&text(card.aFormNo)?judgeCaliberId(masters,{read,location:card.site,date:card.date,aForm:card.aFormNo}):null;
 let check=base.check;
 if(!check&&form?.check?.reason==='a-form-differs')check=form.check;
 // A card whose site is not one the judge knows is left alone, as a new scan would be.
 if(!check||!RECHECK_REASONS[check.reason])return null;
 // Whom the box names: on a held verdict it is in the check; when the box alone would have given the driver, in the verdict.
 const named=form?.check?.aForm||(form?.aForm&&form.employee?{no:form.aForm.no,id:form.aForm.id,name:text(form.employee.record_data?.name||form.employee.record_data?.employee)}:null);
 return listed({...check,...(named?{aForm:named}:{})});
}

// "This card is right" (owner, 23 Nov 2026). A listed card a person may confirm from the paper card is one whose saved
// driver stands on every other count: only the FORM A box points at a colleague. Every other reason is about the
// saved person (left, not in HR's list, another site, a helper, two people with the number): those need the right
// driver, the helper's "Yes", an approved move or HR, never a tick.
export const CONFIRMABLE_REASONS=['a-form-differs'];
export const canConfirmSaved=verdict=>Boolean(verdict&&CONFIRMABLE_REASONS.includes(verdict.reason));
// A confirmation holds for the card as it was confirmed: the same driver and the same FORM A number. A card that is
// changed afterwards, or whose driver stops standing for another reason, is judged afresh and listed again.
export const confirmationHolds=(confirmation,card,verdict)=>Boolean(confirmation&&canConfirmSaved(verdict)
 &&String(confirmation.employee_id??'')===String(card.employeeId??'')&&text(confirmation.a_form)===text(card.aFormNo));

// A listed card HR settles (owner, 23 Nov 2026): its number was not found in HR's employee list, or HR's list says the
// person has left. The line has a Refresh button: it asks HR Pulse for that number now, and when HR Pulse has the
// person as working the card passes by itself and leaves the list. Nothing on the card is changed.
export const canRefreshFromHr=verdict=>Boolean(verdict&&HR_REFRESH_REASONS.includes(verdict.reason));

// Counts for the top of the report: every reason, in the fixed order.
export function recheckCounts(listed){
 const counts=Object.fromEntries(RECHECK_REASON_ORDER.map(reason=>[reason,0]));
 for(const row of listed)if(row.reason in counts)counts[row.reason]++;
 return counts;
}

// Attendance from every card, scanned or manual (owner, 24 Nov 2026: "this type of correction for any trip card (VLB,
// ELB & LMV) manually inserted that does not fetch the attendance"). A card whose driver stands by the checks above can
// still mark no attendance; the attendance build (server/rules/manpower-report.mjs) leaves such a card out when
//  - nobody is saved on it although the vehicle or machine worked (trips or working HMR): 'no-driver';
//  - its Employee ID (the master line) and its Caliber ID name different people, or the master line is gone: 'id-mismatch';
//  - it names no shift, or two shifts that disagree (shared/duty-shift.mjs): 'no-shift'.
// The first two are fixed by Submit with the right person from the paper card, the last by choosing the shift on the line.
// card: as recheckSavedCard, plus worked (true when it shows trips or working hours), shift (the card's shift labels:
// bookShiftCode, cardShift, shiftName, manualShift) and savedShift (its Shift Master entry, when it has one).
export function attendanceGap(masters,card){
 const kind=card.kind==='equipment'?'equipment':'vehicle',who=kind==='equipment'?'operator':'driver';
 const line=(reason,text)=>({reason,read:caliberNumber(card.caliberId)||String(card.caliberId??'').trim(),line:text,at:String(card.site??'').trim()});
 const employeeId=String(card.employeeId??'').trim(),caliberId=String(card.caliberId??'').trim();
 if(!employeeId&&!caliberId){
  return card.worked?line('no-driver','Nobody is saved on this card, but the '+(kind==='equipment'?'machine worked':'vehicle ran')+', so no attendance is marked. Type the '+who+' from the paper card and press Submit.'):null;
 }
 const saved=employeeId?employeeRows(masters).get(employeeId):null;
 // CMPL and CMLL of one number are one person, as in the attendance build (matchesSamePerson).
 if(saved&&caliberId&&!matchesSamePerson(saved.record_data,caliberId))return line('id-mismatch','The card is saved under '+caliberId+' but its employee line is '+(numberOf(saved.record_data)||'another person')+' ('+text(saved.record_data?.name||saved.record_data?.employee)+'), so no attendance is marked. Type the '+who+' from the paper card and press Submit.');
 const shift=cardDutyShift(card.shift||{},card.savedShift||null);
 if(!shift.code)return line('no-shift',(shift.conflict?'The card names two different shifts':'The card names no shift')+', so no attendance is marked. Choose the shift from the paper card and press Save shift.');
 return null;
}
// One verdict per card: the driver checks first, then what keeps the card out of attendance.
export const recheckCard=(masters,card)=>recheckSavedCard(masters,card)||attendanceGap(masters,card);
