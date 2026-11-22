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
import {employeeSiteOn} from './employee-site-moves.mjs';
import {canonicalSiteName} from './site-location.mjs';

export const EMPLOYEE_LISTS=['Employee master','ERP Employee master','C-Dir Employee master'];
export const CALIBER_HOLD_REASONS=['unreadable','readings-differ','unknown','other-site','not-listed','left','not-driver','several'];
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
// A blank designation says nothing either way, so it stops no card.
export function drivesOrOperates(record){
 const designation=employeeDesignation(record).toUpperCase();
 return !designation||DRIVES.test(designation)&&!NOT_A_MACHINE.test(designation);
}
// Set once, by a person, on the Fetch box of a held card (server/routes/erp-employee-source.mjs).
export const confirmedToDrive=record=>Boolean(record?.driverConfirmedAt);
export const needsDriverConfirm=record=>!isDummyEmployeeId(employeeIdOf(record))&&!drivesOrOperates(record)&&!confirmedToDrive(record);

// HR's own mark, or the status the old master still carries for a person HR's import has not placed.
const LEFT_STATUS=/RESIGN|TERMINAT|ABSCOND|^LEFT$/i;
export const employeeLeft=record=>record?.hrLeft===true?'hr':LEFT_STATUS.test(text(record?.status))?'status':'';

const employeeIdOf=record=>text(record?.caliberId||record?.employeeId).toUpperCase();
const nameOf=record=>text(record?.name||record?.employee);
// The worker's site on the card's date: a worker moved by an approved move keeps the old site for earlier cards.
const siteOf=(record,date)=>displaySiteSelection(employeeSiteOn(record,date)).join(' / ');

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
function atSite(owners,location,date){
 const here=owners.filter(row=>employeeAtLocation(row.record_data,location,date));
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
function lookAlikes(index,number,location,date){
 const people=new Map();
 for(const candidate of lookAlikeNumbers(number)){
  const row=atSite(ownersOf(index,candidate),location,date);
  if(!row||row==='several'||employeeLeft(row.record_data)||isDummyEmployeeId(employeeIdOf(row.record_data)))continue;
  people.set(candidate,{id:candidate,name:nameOf(row.record_data),drives:drivesOrOperates(row.record_data)});
 }
 const sorted=[...people.values()].sort((a,b)=>Number(b.drives)-Number(a.drives)||Number(a.id)-Number(b.id));
 return {lookAlikes:sorted.slice(0,LOOK_ALIKE_LIMIT).map(({id,name})=>({id,name})),...(sorted.length>LOOK_ALIKE_LIMIT?{more:sorted.length-LOOK_ALIKE_LIMIT}:{})};
}
const about=(row,date)=>({name:nameOf(row.record_data),designation:employeeDesignation(row.record_data),site:siteOf(row.record_data,date)});

// read: the Caliber ID on the card as the scan gives it now. readings: {first, second} when the card was read
// twice (server/services/scan-first-field-recovery.mjs). Returns the employee row to put on the card, or the
// reason the card waits for a person ({employee:null, check}). A card with no site yet is not judged.
// date: the card's book date, so that a worker moved to another site is judged by the site of that date.
export function judgeCaliberId(masters,{read='',readings=null,location='',date=''}={}){
 if(!canonicalSiteName(location))return {employee:null,check:null};
 const held=(reason,details={})=>({employee:null,check:{version:1,reason,at:text(location),...details}});
 const first=caliberNumber(readings?.first),second=caliberNumber(readings?.second);
 if(first&&second&&first!==second)return held('readings-differ',{read:first,second});
 const code=text(read||readings?.first||readings?.second).toUpperCase();
 if(!code)return held('unreadable');
 const shown=caliberNumber(code)||code.slice(0,40),index=employeeIndex(masters),owners=ownersOf(index,code),chosen=atSite(owners,location,date);
 if(chosen==='several')return held('several',{read:shown});
 const alike=()=>caliberNumber(code)?lookAlikes(index,code,location,date):{};
 if(chosen){
  const record=chosen.record_data;
  if(isDummyEmployeeId(employeeIdOf(record)))return {employee:chosen,check:null};
  if(employeeLeft(record))return held('left',{read:shown,...about(chosen,date),left:employeeLeft(record),...alike()});
  if(needsDriverConfirm(record))return held('not-driver',{read:shown,...about(chosen,date),...alike()});
  return {employee:chosen,check:null};
 }
 if(!owners.length)return held('unknown',{read:shown,...alike()});
 const prefer=rows=>rows.find(row=>row.master_name==='Employee master')||rows[0];
 const elsewhere=owners.filter(row=>employeeOnHrList(row.record_data)&&!employeeLeft(row.record_data)&&siteOf(row.record_data,date));
 if(elsewhere.length)return held('other-site',{read:shown,...about(prefer(elsewhere),date),...alike()});
 const owner=prefer(owners),left=employeeLeft(owner.record_data);
 return held(left?'left':'not-listed',{read:shown,...about(owner,date),...(left?{left}:{}),...alike()});
}

const person=check=>[check.name,check.designation].filter(Boolean).join(', ')||'an employee';
function lookAlikeLine(check){
 if(!Array.isArray(check.lookAlikes))return '';
 if(!check.lookAlikes.length)return ' No look-alike ID at '+check.at+'.';
 return ' Look-alike IDs at '+check.at+': '+check.lookAlikes.map(row=>row.id+(row.name?' ('+row.name+')':'')).join(', ')+(check.more?' and '+check.more+' more':'')+'.';
}
// The line shown on a held card. kind: 'vehicle' (driver) or 'equipment' (operator).
export function caliberCheckMessage(check,kind='vehicle'){
 if(!check||!CALIBER_HOLD_REASONS.includes(check.reason))return '';
 const read='Scan read '+check.read+'. ',did=kind==='vehicle'?'drove this vehicle':'operated this machine';
 switch(check.reason){
  case 'unreadable':return 'Caliber ID could not be read. Type the number from the card.';
  case 'readings-differ':return 'The number was read as '+check.read+' and '+check.second+'. Type the number from the card.';
  case 'unknown':return read+'No employee has this number. Check the card.'+lookAlikeLine(check);
  case 'other-site':return read+'This is '+[person(check),check.site].filter(Boolean).join(', ')+'. The number may be misread.'+lookAlikeLine(check)+' If the number is right, press Fetch to move this person here with OTP.';
  case 'not-listed':return read+'This is '+person(check)+", who is not in HR's list for any site. Check the number on the card."+lookAlikeLine(check);
  case 'left':return read+'This is '+person(check)+'. '+(check.left==='hr'?"HR's list says this person has left.":'Employee Master says this person has resigned.')+' Check the number on the card.'+lookAlikeLine(check);
  case 'not-driver':return read+'This is '+person(check)+'. Confirm '+(check.name||'this person')+' '+did+', or correct the number.'+lookAlikeLine(check);
  default:return read+'More than one employee at '+check.at+' has this number. Choose the '+(kind==='vehicle'?'driver':'operator')+' from the list.';
 }
}
// What the Fetch box says about a number a person typed.
export function fetchRefusal(record,location,date){
 const who=[nameOf(record),employeeDesignation(record)].filter(Boolean).join(', ')||'an employee',site=siteOf(record,date);
 if(!employeeOnHrList(record))return 'This is '+who+(record?.hrLeft===true?". HR's list says this person has left.":", who is not in HR's list for any site.")+' Check the number on the card.';
 return 'This is '+who+(site?', '+site:'')+(text(location)?'. This number is not at '+text(location)+'.':'.')+' Check the number on the card.';
}
export const driverConfirmQuestion=(record,kind='vehicle')=>'This is '+([nameOf(record),employeeDesignation(record)].filter(Boolean).join(', ')||'an employee')+'. Confirm '+(nameOf(record)||'this person')+' '+(kind==='vehicle'?'drove this vehicle':'operated this machine')+', or correct the number.';
