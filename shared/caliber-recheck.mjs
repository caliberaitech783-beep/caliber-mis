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
import {judgeCaliberId,caliberNumber,EMPLOYEE_LISTS} from './caliber-id-check.mjs';

const text=value=>String(value??'').replace(/\s+/g,' ').trim();
export const RECHECK_REASONS={
 'unknown':'No such number','not-listed':"Not in HR's list",'left':'Has left','other-site':'Another site',
 'not-driver':'Not a driver or operator','several':'Number on two people','a-form-differs':'FORM A names a colleague',
};
// The order a list of reasons is shown in: the surest first.
export const RECHECK_REASON_ORDER=['not-listed','left','unknown','other-site','a-form-differs','not-driver','several'];

const rowsById=new WeakMap();
function employeeRows(masters){
 let rows=rowsById.get(masters);
 if(!rows){rows=new Map();for(const row of masters)if(EMPLOYEE_LISTS.includes(row.master_name))rows.set(String(row.id),row);rowsById.set(masters,rows);}
 return rows;
}
const numberOf=record=>text(record?.caliberId||record?.employeeId||record?.empId);
// The button of a line only HR can settle (see HR_REASONS below), and what the screen says beside it. The hint is
// left out when the FORM A box names somebody else of the site: that card is most likely a misread number.
export const SEND_TO_HR_LABEL='Number is right, send to HR';
export const sendToHrHint=row=>row?.aForm?.id?'':'If the paper card shows this number, press '+SEND_TO_HR_LABEL+': only HR can add or correct a person.';

// The line of a listed card: what Employee Master says about the number the card was saved under.
export function recheckLine(check,kind='vehicle'){
 const who=[check.name,check.designation].filter(Boolean).join(', '),is=who?check.read+' is '+who:'';
 const box=check.aForm?.no&&check.aForm?.id?' The FORM A box says '+check.aForm.no+': at '+check.at+' that is '+check.aForm.id+(check.aForm.name?' ('+check.aForm.name+')':'')+'.':'';
 switch(check.reason){
  case 'unknown':return (check.read?'No employee has number '+check.read+'.':"The saved driver's line is no longer in Employee Master.")+box;
  case 'not-listed':return is+", who is not in HR's list for any site."+box;
  case 'left':return is+'. '+(check.left==='hr'?"HR's list says this person has left.":'Employee Master says this person has resigned.')+box;
  case 'other-site':return is+(check.site?', of '+check.site+' on this date.':', of another site on this date.')+box;
  case 'not-driver':return is+': not a driver or operator.'+box;
  case 'several':return 'More than one employee at '+check.at+' has number '+check.read+'.'+box;
  case 'a-form-differs':return is+'. But the FORM A box says '+(check.aForm?.no||'another number')+': at '+check.at+' that is '+(check.aForm?.id||'another person')+(check.aForm?.name?' ('+check.aForm.name+')':'')+', one digit away.';
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
// "Number is right, send to HR" (owner, 23 Nov 2026). A driver shown Active on Employee Master worked eleven nights
// and was missing from HR's list: the site could neither correct his cards (the number was right) nor finish its
// re-check. Only HR adds or corrects a person, so for these two reasons the site says "the paper card shows this
// number" and the card leaves its list for the Waiting for HR list. Nothing on the card or in Employee Master
// changes. When HR's list carries the person as working the card passes by itself; Undo puts it back on the site's
// list (HR's answer was "not ours").
export const HR_REASONS=['not-listed','left'];
export const canSendToHr=verdict=>Boolean(verdict&&HR_REASONS.includes(verdict.reason));
// How a listed card may be settled without changing it: 'right' (This card is right), 'hr' (sent to HR) or ''.
export const settleKind=reason=>CONFIRMABLE_REASONS.includes(reason)?'right':HR_REASONS.includes(reason)?'hr':'';
// A settlement holds for the card as it was settled: the same driver, the same FORM A number and the same kind of
// doubt. A card that is changed afterwards, or whose driver stops standing for another kind of reason, is judged
// afresh and listed again. (A row written before the reason was kept is a "This card is right".)
export const confirmationHolds=(confirmation,card,verdict)=>Boolean(confirmation&&verdict&&settleKind(verdict.reason)
 &&settleKind(text(confirmation.reason)||CONFIRMABLE_REASONS[0])===settleKind(verdict.reason)
 &&String(confirmation.employee_id??'')===String(card.employeeId??'')&&text(confirmation.a_form)===text(card.aFormNo));

// Counts for the top of the report: every reason, in the fixed order.
export function recheckCounts(listed){
 const counts=Object.fromEntries(RECHECK_REASON_ORDER.map(reason=>[reason,0]));
 for(const row of listed)if(row.reason in counts)counts[row.reason]++;
 return counts;
}
