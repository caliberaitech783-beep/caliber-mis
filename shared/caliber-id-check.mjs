// The Caliber ID read from a scanned card, judged against the employee lists.
//
// Owner, 22 Nov 2026: the Caliber ID decides a person's salary, so a number in doubt is never put on a card by
// the scan. The card waits for a person, with one plain line that says what the scan read, what Employee Master
// says about that number and what to do. The scan puts a driver or operator on a card only when the number
//   - was read, and the two readings of the card (where there are two) agree,
//   - belongs to exactly one employee at the card's site who is on HR's list (shared/log-book-access.mjs),
//   - that employee has not left, and
//   - that employee is a driver or operator, or a person has already confirmed once that he or she drives.
// Every other card is held for one of the reasons below. Nothing here reads the name written on the card or the
// vehicle's earlier drivers: the owner removed those checks on 22 Nov 2026.
import {employeeReferenceKeys,employeeReferenceVariants} from './employee-identity.mjs';
import {employeeAtLocation,employeeOnHrList} from './log-book-access.mjs';
import {isDummyEmployeeId} from './dummy-employee-ids.mjs';
import {displaySiteSelection} from './region-scope.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {aFormLinks,aFormNumbersAt,cardAFormKeys} from './a-form-master.mjs';

export const EMPLOYEE_LISTS=['Employee master','ERP Employee master','C-Dir Employee master'];
export const CALIBER_HOLD_REASONS=['unreadable','readings-differ','unknown','other-site','not-listed','left','not-driver','several','a-form-differs'];
// How many look-alike IDs a held card names; the rest are counted ("and 3 more").
export const LOOK_ALIKE_LIMIT=8;

const text=value=>String(value??'').replace(/\s+/g,' ').trim();
// The number inside an Employee ID or Caliber ID: CMPL1726, CMLL1726 and 1726 are one number.
export function caliberNumber(value){
 const match=String(value??'').toUpperCase().replace(/[\s/-]/g,'').match(/^(?:CMPL|CMLL)?0*(\d{1,10})$/);
 return match&&match[1]!=='0'?match[1]:'';
}

// Designations as HR and the old ERP write them: "VOLVO DRIVER", "PC- OPRATOR", "EXCAVATOR/OP", "DUMPER OPT",
// "DOZER OPRETOR", "SERVICE VEN", "SHIFT BUS", "ALL ROUNDER". On 79,926 card days of 1 to 21 Nov 2026 this rule
// left 146 (0.18%) to 80 people of other designations (helpers, mechanics, supervisors), most of them one card
// day each, which is what a misread number looks like.
const DRIVES=/DRIV|\bDRV\b|\bDVR\b|OP[AE]?R[AEI]?T|\bOPRT?\b|\bOPT\b|\bOP\b|ALL\s*ROUNDER|\b(?:SERVICE|SHIFT)\s+(?:VAN|VEN|BUS)\b/;
// "Operator" of something that is not a vehicle or a machine in the log books.
const NOT_A_MACHINE=/DAT[AE]\s*ENTRY|COMPUTER|\bEDP\b|WEIGH|\bCCTV\b|LATHE|LEATH|\bLETH\b/;
export const employeeDesignation=record=>text(record?.currentDesignationName||record?.designationName||record?.designation);
export const employeeDepartment=record=>text(record?.currentDepartmentName||record?.departmentName||record?.department);
// Departments that hold drivers under a name with no "driver" or "operator" in it (HR's file, 23 Nov 2026:
// 1,012 of the 1,018 people of VEHICLE and 34 of the 36 of LMV are drivers).
const DRIVER_DEPARTMENT=/^(?:VEHICLE|LMV)$/;
// Owner, 23 Nov 2026: the department and the designation must be a driver's or an operator's.
// The designation decides, because HR's departments mix people (585 drivers and operators sit in MINING, 492 in
// PRODUCTION, beside their helpers). A person with no designation is judged by the department. When Employee
// Master gives neither, there is nothing to judge, so that stops no card.
export function drivesOrOperates(record){
 const designation=employeeDesignation(record).toUpperCase();
 if(designation)return DRIVES.test(designation)&&!NOT_A_MACHINE.test(designation);
 const department=employeeDepartment(record).toUpperCase();
 return !department||DRIVER_DEPARTMENT.test(department)||DRIVES.test(department)&&!NOT_A_MACHINE.test(department);
}
// Set once, by a person, on the Fetch box of a held card (server/routes/erp-employee-source.mjs).
export const confirmedToDrive=record=>Boolean(record?.driverConfirmedAt);
export const needsDriverConfirm=record=>!isDummyEmployeeId(employeeIdOf(record))&&!drivesOrOperates(record)&&!confirmedToDrive(record);

// HR's own mark, or the status the old master still carries for a person HR's import has not placed.
const LEFT_STATUS=/RESIGN|TERMINAT|ABSCOND|^LEFT$/i;
export const employeeLeft=record=>record?.hrLeft===true?'hr':LEFT_STATUS.test(text(record?.status))?'status':'';

const employeeIdOf=record=>text(record?.caliberId||record?.employeeId).toUpperCase();
const nameOf=record=>text(record?.name||record?.employee);
const siteOf=record=>displaySiteSelection(record?.site||record?.location||record?.currentLocation).join(' / ');

// Master rows are copied for every caller, but each record object stays the same until the lists are read
// again, so what is worked out from a record is kept with it.
const recordKeys=new WeakMap(),indexes=new WeakMap();
const keysOf=record=>{let keys=recordKeys.get(record);if(!keys){keys=[...new Set(employeeReferenceKeys(record))];recordKeys.set(record,keys);}return keys;};
function employeeIndex(masters){
 let index=indexes.get(masters);
 if(!index){
  index=new Map();
  for(const row of masters){
   if(!EMPLOYEE_LISTS.includes(row.master_name)||!row.record_data)continue;
   for(const key of keysOf(row.record_data)){const rows=index.get(key);if(rows)rows.push(row);else index.set(key,[row]);}
  }
  indexes.set(masters,index);
 }
 return index;
}
// Everyone, at any site, whose Employee ID or Caliber ID is this number.
function ownersOf(index,value){
 const found=new Set();
 for(const variant of employeeReferenceVariants(value))for(const row of index.get(variant)||[])found.add(row);
 return [...found];
}
// One employee at the site: Employee Master first, the other lists only when it has nobody.
function atSite(owners,location){
 const here=owners.filter(row=>employeeAtLocation(row.record_data,location));
 const imported=here.filter(row=>row.master_name==='Employee master');
 const pool=imported.length?imported:here;
 return pool.length===1?pool[0]:pool.length?'several':null;
}

// Numbers one digit away from the number read: one digit read wrongly (163 of 296 wrong numbers measured on
// 22 Nov 2026), one digit dropped by the scan (73, of which 61 a thin "1", so a five-digit number is read as four digits) or one added (9).
export function lookAlikeNumbers(number){
 const n=caliberNumber(number),found=new Set();
 if(!n)return [];
 for(let i=0;i<n.length;i++){
  for(let digit=0;digit<=9;digit++)found.add(n.slice(0,i)+digit+n.slice(i+1));
  found.add(n.slice(0,i)+n.slice(i+1));
 }
 for(let i=0;i<=n.length;i++)for(let digit=0;digit<=9;digit++)found.add(n.slice(0,i)+digit+n.slice(i));
 found.delete(n);
 return [...found].filter(value=>/^[1-9]\d*$/.test(value));
}
// The people at this site whose number is one digit away: drivers and operators first, then by number.
function lookAlikes(index,number,location){
 const people=new Map();
 for(const candidate of lookAlikeNumbers(number)){
  const row=atSite(ownersOf(index,candidate),location);
  if(!row||row==='several'||employeeLeft(row.record_data)||isDummyEmployeeId(employeeIdOf(row.record_data)))continue;
  people.set(candidate,{id:candidate,name:nameOf(row.record_data),drives:drivesOrOperates(row.record_data)});
 }
 const sorted=[...people.values()].sort((a,b)=>Number(b.drives)-Number(a.drives)||Number(a.id)-Number(b.id));
 return {lookAlikes:sorted.slice(0,LOOK_ALIKE_LIMIT).map(({id,name})=>({id,name})),...(sorted.length>LOOK_ALIKE_LIMIT?{more:sorted.length-LOOK_ALIKE_LIMIT}:{})};
}
// A person with no designation is described by the department he was judged on.
const about=row=>({name:nameOf(row.record_data),designation:employeeDesignation(row.record_data)||(employeeDepartment(row.record_data)?employeeDepartment(row.record_data)+' department':''),site:siteOf(row.record_data)});

// The FORM A box of a trip card (owner, 23 Nov 2026). A Form Master links an A Form no., a CMLL id and a site
// (shared/a-form-master.mjs), so the box is a second proof of who drove, written by the driver in another box of
// the same card. Returns the one working driver or operator of this site the box names, or null: an A Form no.
// written against two people of the site, or against someone who is not at this site, names nobody.
// Measured on live cards before this was built: the box is filled on 76% to 100% of saved trip cards and agrees
// with HR's A Form no. of the saved driver on 97% of 461 cards.
function namedByAForm(masters,index,aForm,location){
 const keys=cardAFormKeys(aForm);
 if(!keys.length)return null;
 const numbers=aFormNumbersAt(aFormLinks(masters),location,keys);
 if(numbers.length!==1)return null;
 const row=atSite(ownersOf(index,numbers[0]),location);
 if(!row||row==='several')return null;
 const record=row.record_data;
 if(isDummyEmployeeId(employeeIdOf(record))||employeeLeft(record)||needsDriverConfirm(record))return null;
 return {row,number:numbers[0],name:nameOf(record),no:text(aForm).slice(0,20)};
}

// read: the Caliber ID on the card as the scan gives it now. readings: {first, second} when the card was read
// twice (server/services/scan-first-field-recovery.mjs). aForm: what is written in the FORM A box of a trip card
// ('' for a job card, which has none). Returns the employee row to put on the card, or the reason the card waits
// for a person ({employee:null, check}). A card with no site yet is not judged.
//
// What the FORM A box changes:
//  - The number read belongs to nobody the scan may take at this site (another site, nobody, left, a helper, two
//    readings that differ), and the box names one working driver or operator here whose number is one digit away
//    from the number read (or is one of the two readings): he is taken. Two boxes of the card agree on him.
//    The verdict then carries aForm:{read, no, id}, kept on the card as raw.caliberAForm.
//  - The number read is a working driver of this site, but the box names another one whose number is one digit
//    away: the card waits ('a-form-differs'). This is the misread that lands on a colleague (4400 for 4401).
//  - A box that merely differs stops no card: it is misread about as often as the Caliber ID itself.
//  - A held card says whom the box names, so the person checking has it in front of him.
export function judgeCaliberId(masters,{read='',readings=null,location='',aForm=''}={}){
 if(!canonicalSiteName(location))return {employee:null,check:null};
 const index=employeeIndex(masters),named=namedByAForm(masters,index,aForm,location);
 const says=()=>named?{aForm:{no:named.no,id:named.number,name:named.name}}:{};
 const held=(reason,details={})=>({employee:null,check:{version:1,reason,at:text(location),...details,...says()}});
 const taken=readAs=>({employee:named.row,check:null,aForm:{read:readAs,no:named.no,id:named.number}});
 const first=caliberNumber(readings?.first),second=caliberNumber(readings?.second);
 if(first&&second&&first!==second)return named&&(named.number===first||named.number===second)?taken(first+' and '+second):held('readings-differ',{read:first,second});
 const code=text(read||readings?.first||readings?.second).toUpperCase();
 if(!code)return held('unreadable');
 const number=caliberNumber(code),shown=number||code.slice(0,40),owners=ownersOf(index,code),chosen=atSite(owners,location);
 if(chosen==='several')return held('several',{read:shown});
 const alike=()=>number?lookAlikes(index,code,location):{};
 // The box names a driver here one digit away from the number read.
 const oneDigitAway=Boolean(named&&number&&named.number!==number&&lookAlikeNumbers(number).includes(named.number));
 const stop=(reason,details)=>oneDigitAway?taken(shown):held(reason,details);
 if(chosen){
  const record=chosen.record_data;
  if(isDummyEmployeeId(employeeIdOf(record)))return {employee:chosen,check:null};
  if(employeeLeft(record))return stop('left',{read:shown,...about(chosen),left:employeeLeft(record),...alike()});
  if(needsDriverConfirm(record))return stop('not-driver',{read:shown,...about(chosen),...alike()});
  if(oneDigitAway)return held('a-form-differs',{read:shown,...about(chosen)});
  return {employee:chosen,check:null};
 }
 if(!owners.length)return stop('unknown',{read:shown,...alike()});
 const prefer=rows=>rows.find(row=>row.master_name==='Employee master')||rows[0];
 const elsewhere=owners.filter(row=>employeeOnHrList(row.record_data)&&!employeeLeft(row.record_data)&&siteOf(row.record_data));
 if(elsewhere.length)return stop('other-site',{read:shown,...about(prefer(elsewhere)),...alike()});
 const owner=prefer(owners),left=employeeLeft(owner.record_data);
 return stop(left?'left':'not-listed',{read:shown,...about(owner),...(left?{left}:{}),...alike()});
}

const person=check=>[check.name,check.designation].filter(Boolean).join(', ')||'an employee';
function lookAlikeLine(check){
 if(!Array.isArray(check.lookAlikes))return '';
 if(!check.lookAlikes.length)return ' No look-alike ID at '+check.at+'.';
 return ' Look-alike IDs at '+check.at+': '+check.lookAlikes.map(row=>row.id+(row.name?' ('+row.name+')':'')).join(', ')+(check.more?' and '+check.more+' more':'')+'.';
}
// Whom the FORM A box of the card names at this site (A Form Master), added to the line of a held card.
function aFormLine(check){
 const box=check.aForm;
 return box?.no&&box?.id?' The FORM A box says '+box.no+': at '+check.at+' that is '+box.id+(box.name?' ('+box.name+')':'')+'.':'';
}
// The line shown on a held card. kind: 'vehicle' (driver) or 'equipment' (operator).
export function caliberCheckMessage(check,kind='vehicle'){
 if(!check||!CALIBER_HOLD_REASONS.includes(check.reason))return '';
 const read='Scan read '+check.read+'. ',did=kind==='vehicle'?'drove this vehicle':'operated this machine',box=aFormLine(check);
 switch(check.reason){
  case 'unreadable':return 'Caliber ID could not be read. Type the number from the card.'+box;
  case 'readings-differ':return 'The number was read as '+check.read+' and '+check.second+'. Type the number from the card.'+box;
  case 'unknown':return read+'No employee has this number. Check the card.'+box+lookAlikeLine(check);
  case 'other-site':return read+'This is '+[person(check),check.site].filter(Boolean).join(', ')+'. The number may be misread.'+box+lookAlikeLine(check);
  case 'not-listed':return read+'This is '+person(check)+", who is not in HR's list for any site. Check the number on the card."+box+lookAlikeLine(check);
  case 'left':return read+'This is '+person(check)+'. '+(check.left==='hr'?"HR's list says this person has left.":'Employee Master says this person has resigned.')+' Check the number on the card.'+box+lookAlikeLine(check);
  case 'not-driver':return read+'This is '+person(check)+'. Confirm '+(check.name||'this person')+' '+did+', or correct the number.'+box+lookAlikeLine(check);
  // The two boxes of the card name two working people of this site, one digit apart: only the card can say which.
  case 'a-form-differs':return read+'This is '+person(check)+'. But the FORM A box says '+(check.aForm?.no||'another number')+': at '+check.at+' that is '+(check.aForm?.id||'another person')+(check.aForm?.name?' ('+check.aForm.name+')':'')+', one digit away. Check the card and choose the '+(kind==='vehicle'?'driver':'operator')+' from the list.';
  default:return read+'More than one employee at '+check.at+' has this number. Choose the '+(kind==='vehicle'?'driver':'operator')+' from the list.';
 }
}
// What the Fetch box says about a number a person typed.
export function fetchRefusal(record,location){
 const who=[nameOf(record),employeeDesignation(record)].filter(Boolean).join(', ')||'an employee',site=siteOf(record);
 if(!employeeOnHrList(record))return 'This is '+who+(record?.hrLeft===true?". HR's list says this person has left.":", who is not in HR's list for any site.")+' Check the number on the card.';
 return 'This is '+who+(site?', '+site:'')+(text(location)?'. This number is not at '+text(location)+'.':'.')+' Check the number on the card.';
}
export const driverConfirmQuestion=(record,kind='vehicle')=>'This is '+([nameOf(record),employeeDesignation(record)].filter(Boolean).join(', ')||'an employee')+'. Confirm '+(nameOf(record)||'this person')+' '+(kind==='vehicle'?'drove this vehicle':'operated this machine')+', or correct the number.';
