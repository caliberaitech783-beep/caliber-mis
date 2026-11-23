// HR Pulse is the final authority for Employee Master (owner, 23 Nov 2026): an employee is created, edited and
// removed only there, and Pulse-II copies every change within a minute. HR Pulse says which employee numbers
// changed and gives every line each of those people has now (server/services/hr-employee-minute-copy.mjs).
// This file works out, without writing, what that means for Pulse-II's Employee Master:
//  - one line in HR Pulse: the person takes HR's name, department, designation, category, status, reporting to,
//    contact and leaving date; a person Pulse-II does not have is added. The record keeps its id, so every saved
//    card keeps its driver;
//  - HR marks LEFT: the person stays in the list but is never matched on a new card;
//  - no line left in HR Pulse: the person was removed there. Here the person is switched off (not on HR's list),
//    never deleted, because saved cards hold the line;
//  - another site in HR Pulse: the worker moves from today, as a dated move, so earlier cards still find the old site;
//  - what could put a wrong person on a number is held for a person to look at, and nothing changes for that
//    number: the number on two lines in HR Pulse, or a completely different name on a number Pulse-II holds.
import {canonicalSiteName} from './site-location.mjs';
import {employeeNumber,recordNumber,hrSiteName,isDummyNumber,HR_MASTER_EXISTING_FIELDS} from './hr-employee-master.mjs';

// One minute's changes that would switch off more people than this are not applied by themselves.
export const HR_COPY_STOP_LIMIT=50;
export const HR_COPY_SOURCE='HR Pulse';
// The fields of an Employee master line the plan reads; the server reads only these, never the whole record.
export const HR_CHANGE_EXISTING_FIELDS=[...new Set([...HR_MASTER_EXISTING_FIELDS,'siteLockedBy','hrReportingTo','hrContact','hrLeavingDate'])];

const text=value=>value===null||value===undefined?'':String(value).trim();
const same=(a,b)=>String(a??'')===String(b??'');
const siteOf=record=>text(record.site||record.currentLocation||record.location);
const words=name=>text(name).toUpperCase().split(/[^A-Z]+/).filter(Boolean);
export const nameKey=name=>words(name).join(' ');
// Two names of one person: the same words, or the same first name with at least one more word in common (a short
// form such as "DADULAL" for "DADULAL YADAV" also counts). The same rule HR Pulse uses for its numbers.
export function samePerson(a,b){
 const one=words(a),two=words(b);
 if(!one.length||!two.length)return false;
 if(one.join(' ')===two.join(' '))return true;
 if(one[0]!==two[0]||one[0].length<3)return false;
 if(one.length===1||two.length===1)return true;
 return one.slice(1).some(word=>word.length>=3&&two.slice(1).includes(word));
}
// A site set by an OTP on a card in Pulse-II (not by HR) waits for HR Pulse to take that move; HR's older site
// must not pull the worker back.
// "CMLL6665/1" is not an employee number, although a reader that drops the slash takes it for 66651.
export const slashedId=value=>/\d\s*\/\s*\d/.test(text(value));
const lockedByPulseII=record=>Boolean(record.siteLockedAt)&&!/^hr-/i.test(text(record.siteLockedBy));

// existing: Employee master lines ({id, master_name, record_data}) of the numbers asked. numbers: the employee
// numbers HR Pulse says changed. lines: every line those people have in HR Pulse now.
// accepted: {number: nameKey} for a different name an administrator has looked at and accepted.
export function planHrChanges(existing,numbers,lines,{now=new Date().toISOString(),accepted={}}={}){
 const byNumber=new Map(),hrByNumber=new Map();
 for(const row of existing){const number=recordNumber(row.record_data);if(number)(byNumber.get(number)||byNumber.set(number,[]).get(number)).push(row);}
 for(const line of Array.isArray(lines)?lines:[]){const number=employeeNumber(line.employeeId);if(number)(hrByNumber.get(number)||hrByNumber.set(number,[]).get(number)).push(line);}
 // Two old lines can hold one number (CMPL21327 and 21327): the line written as CMPL is the person, the other steps aside.
 const primary=rows=>rows.find(row=>/^CMPL\d+$/i.test(text(row.record_data.caliberId)))||[...rows].sort((a,b)=>Number(a.id)-Number(b.id))[0];
 const updates=[],inserts=[],offIds=[],moves=[],held=[],clear=[];
 const summary={people:0,added:0,updated:0,unchanged:0,removed:0,left:0,moved:0,held:0};
 const hold=(number,line,reason,detail)=>{held.push({number,employeeId:text(line?.employeeId)||'CMLL'+number,name:text(line?.name),reason,detail});};
 for(const number of [...new Set((Array.isArray(numbers)?numbers:[]).map(value=>employeeNumber(value)).filter(Boolean))]){
  summary.people++;
  const rows=byNumber.get(number)||[],hr=hrByNumber.get(number)||[];
  if(isDummyNumber(number))continue;
  const slashed=hr.find(line=>slashedId(line.employeeId));
  if(slashed){hold(number,slashed,'bad-id',`${text(slashed.employeeId)} is not an Employee ID Pulse-II can use (a number with a slash). Nobody was added or changed.`);continue;}
  if(hr.length>1){hold(number,hr[0],'two-lines',`CMLL${number} is on ${hr.length} lines in HR Pulse (${[...new Set(hr.map(line=>`${text(line.name)}, ${text(line.site)}`))].join(' / ')}). Nobody was changed.`);continue;}
  if(!hr.length){
   // Removed in HR Pulse: switched off here, never deleted.
   const listed=rows.filter(row=>row.record_data.hrListed!==false);
   for(const row of listed)offIds.push(String(row.id));
   if(listed.length)summary.removed++;else summary.unchanged++;
   clear.push(number);
   continue;
  }
  const line=hr[0],left=text(line.status).toUpperCase()==='LEFT',ourSite=hrSiteName(line.site),hrSite=ourSite||text(line.site);
  const details={name:text(line.name),hrCategory:text(line.category),hrRegion:text(line.region),hrSite:text(line.site),hrStatus:text(line.status).toUpperCase(),status:left?'Left':'Active',hrListed:true,hrLeft:left,
   hrReportingTo:text(line.reportingTo),hrContact:text(line.contact),hrLeavingDate:text(line.leavingDate).slice(0,10)};
  if(text(line.department))details.currentDepartmentName=text(line.department);
  if(text(line.designation))details.currentDesignationName=text(line.designation);
  if(!details.name){hold(number,line,'no-name','HR Pulse gives no name for this number. Nobody was changed.');continue;}
  if(!rows.length){
   const id='CMPL'+number;
   inserts.push({caliberId:id,employeeId:id,caliberCode:'CMLL'+number,currentDepartmentName:'',currentDesignationName:'',...details,currentLocation:hrSite,site:hrSite,source:HR_COPY_SOURCE,hrImportedAt:now,hrCopiedAt:now,employeeMasterRevision:1});
   summary.added++;if(left)summary.left++;
   clear.push(number);
   continue;
  }
  const prev=primary(rows),saved=prev.record_data,was=text(saved.name||saved.employee);
  if(was&&!samePerson(was,details.name)&&accepted[number]!==nameKey(details.name)){
   hold(number,line,saved.hrListed===false?'old-person':'other-name',saved.hrListed===false
    ?`In Pulse-II this number belongs to ${was}, who is not on HR's list. HR Pulse gives it to ${details.name}. Nobody was changed.`
    :`The name changes completely: ${was} in Pulse-II, ${details.name} in HR Pulse. Nobody was changed until a person accepts it.`);
   continue;
  }
  clear.push(number);
  // The other old lines of this number step aside.
  for(const row of rows)if(row!==prev&&row.record_data.hrListed!==false)offIds.push(String(row.id));
  const patch=Object.fromEntries(Object.entries(details).filter(([key,value])=>!same(value,saved[key])));
  const current=siteOf(saved);
  if(!current){if(hrSite){patch.currentLocation=hrSite;patch.site=hrSite;}}
  else if(ourSite&&canonicalSiteName(current)!==canonicalSiteName(ourSite)){
   if(lockedByPulseII(saved))hold(number,line,'site-by-otp',`Pulse-II moved this worker to ${current} with an OTP; HR Pulse still shows ${text(line.site)}. The site was not changed.`);
   else{moves.push({id:String(prev.id),number,employeeId:text(saved.caliberId||saved.employeeId)||'CMPL'+number,name:details.name,from:current,to:ourSite});summary.moved++;}
  }
  else if(!ourSite&&text(line.site)&&canonicalSiteName(current)&&hrSiteName(current))hold(number,line,'site-not-ours',`HR Pulse places this worker at ${text(line.site)}, which is not a Pulse-II site. The site ${current} was kept.`);
  if(left&&saved.hrLeft!==true)summary.left++;
  if(Object.keys(patch).length||prev.master_name!=='Employee master'){updates.push({id:String(prev.id),patch:{...patch,hrCopiedAt:now}});summary.updated++;}
  else summary.unchanged++;
 }
 summary.held=held.length;
 // What the stop counts: people switched off in this batch, by removal or by a LEFT mark.
 summary.switchedOff=summary.removed+summary.left;
 return {updates,inserts,offIds:[...new Set(offIds)],moves,held,clear,summary};
}
