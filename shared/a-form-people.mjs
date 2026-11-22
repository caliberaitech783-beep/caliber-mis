// The people an A Form no. names (owner, 23 Nov 2026).
// A line of A Form Master links an A Form no., a CMLL id and a site (shared/a-form-master.mjs); Employee Master
// says who that CMLL id is and where he works. This puts the two together once, for the A Form Master page, the
// biometric upload and the scan:
//   byNumber  CMLL number -> the people with that number, in every employee list
//   links     site + A Form no. -> CMLL numbers, and site + CMLL number -> A Form numbers (aFormLinks)
// A line counts only at the site Employee Master holds for the person, and only for someone on HR's list.
import {canonicalSiteName} from './site-location.mjs';
import {displaySiteSelection} from './region-scope.mjs';
import {employeeOnHrList} from './log-book-access.mjs';
import {employeeNumber,recordNumber} from './hr-employee-master.mjs';
import {aFormLinks} from './a-form-master.mjs';

export const EMPLOYEE_LISTS=['Employee master','ERP Employee master','C-Dir Employee master'];
const text=value=>value===null||value===undefined?'':String(value).trim();
const personNumber=(record={})=>recordNumber(record)||employeeNumber(record.empId)||employeeNumber(record.idNo);

// rows: the employee lists and A Form Master ({id, master_name, record_data}).
export function buildAFormPeople(rows=[]){
 const byNumber=new Map();
 for(const row of rows){
  if(!EMPLOYEE_LISTS.includes(row.master_name))continue;
  const record=row.record_data||{},number=personNumber(record);
  if(!number)continue;
  const sites=displaySiteSelection(record.site||record.location||record.currentLocation);
  const person={id:String(row.id),master:row.master_name,number,name:text(record.name||record.employee),designation:text(record.currentDesignationName||record.designationName||record.designation),
   siteLabel:sites.join(', '),siteKeys:sites.map(site=>canonicalSiteName(site)).filter(Boolean),listed:employeeOnHrList(record),left:record.hrLeft===true};
  const held=byNumber.get(number);if(held)held.push(person);else byNumber.set(number,[person]);
 }
 return {byNumber,links:aFormLinks(rows)};
}
// Employee Master's line for a number when it has one, the other lists only when it has none.
export const preferredPeople=people=>{const main=people.filter(person=>person.master==='Employee master');return main.length?main:people;};
// What Employee Master says about a CMLL number: `working` is the person on HR's list; `known` is that person or,
// failing that, whoever holds the number although HR marks him LEFT or does not list him. A person HR marks LEFT
// is in Employee Master, so a line for him must say "HR marks LEFT" and not "Not in Employee Master".
export function aFormPerson(people,number){
 const everyone=people.byNumber.get(number)||[],working=preferredPeople(everyone.filter(person=>person.listed))[0]||null;
 return {working,known:working||preferredPeople(everyone)[0]||null};
}
// The state of one A Form Master line (siteKey of the line, keys of its A Form no.).
export const A_FORM_SETTLED_STATES=['Linked','No A Form no.','HR marks LEFT'];
export function aFormLineState(people,number,siteKey,keys){
 const {working,known}=aFormPerson(people,number);
 if(!known)return 'Not in Employee Master';
 if(!working)return known.left?'HR marks LEFT':"Not on HR's list";
 if(!working.siteKeys.includes(siteKey))return 'Employee Master holds '+(working.siteLabel||'another site');
 if(!keys.length)return 'No A Form no.';
 return aFormSharedAt(people,siteKey,keys)?'A Form no. is on two people':'Linked';
}
// The people of this site whom these A Form numbers name. siteKey: canonicalSiteName of the site.
export function aFormOwners(people,siteKey,keys){
 const numbers=new Set();
 for(const key of keys)for(const number of people.links.owners.get(siteKey+'|'+key)||[])numbers.add(number);
 return [...numbers].flatMap(number=>preferredPeople((people.byNumber.get(number)||[]).filter(person=>person.listed&&person.siteKeys.includes(siteKey))));
}
// How many people of this site one A Form no. is written against (two or more: it names nobody).
export const aFormSharedAt=(people,siteKey,keys)=>keys.some(key=>(people.links.owners.get(siteKey+'|'+key)?.size||0)>1);
