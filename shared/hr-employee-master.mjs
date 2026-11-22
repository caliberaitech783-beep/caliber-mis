// HR's all-sites Excel is the Employee Master (owner, 22 Nov 2026).
//
// Until then Employee Master was a copy of the old ERP: about 13,750 people were listed at the seven
// sites, of whom HR had only about 8,540. A misread Caliber ID on a scanned card could land on any of the
// others (resigned, moved, never at that site) and be saved under that person.
//
// The import replaces Employee Master in place:
//  - a person in HR's file is found by the number of the Employee ID (CMPL123 = CMLL123 = 123) and takes
//    HR's name, site, department, designation, category and status. The record keeps its id, so every
//    saved card keeps its driver;
//  - a person HR marks LEFT, and everyone who is not in HR's file, stays in the list but is never matched
//    on a card and never offered in a list (shared/log-book-access.mjs employeeAtLocation);
//  - the dummy IDs of temporary drivers (shared/dummy-employee-ids.mjs) are not in HR's file and stay usable;
//  - a site of ours with no line at all in the file is not covered by it, and its people are left as they are;
//  - nothing is deleted.
// A file with a line that cannot be placed (no usable ID, a number on two lines, a site that is not one
// of ours, no name) is refused as a whole, with the lines listed.
import {canonicalSiteName} from './site-location.mjs';
import {REGION_DATA} from './region-scope.mjs';
import {DUMMY_EMPLOYEE_IDS} from './dummy-employee-ids.mjs';

export const HR_MASTER_SHEET='ALL SITES MASTER';
export const HR_MASTER_MAX_LINES=30000;
// app_settings key: who maintains Employee Master. It records when HR's file was applied and by whom.
// The copy from Oracle / ERP is switched off whether or not it is set (owner, 23 Nov 2026; server/routes/erp-master-sync.mjs).
export const EMPLOYEE_MASTER_OWNER_KEY='employee_master_owner';
export const HR_MASTER_OWNER='hr-master';

const text=value=>value===null||value===undefined?'':String(value).trim();
const heading=value=>text(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const HEADINGS={
 employeeId:['employee id','emp id','caliber id','employee code'],
 name:['name','employee name'],
 region:['region'],
 site:['site office','site','site name','location'],
 department:['department','department name'],
 designation:['designation','designation name'],
 category:['category'],
 status:['status'],
};
const SITES=new Map(REGION_DATA.flatMap(({sites})=>sites).map(site=>[canonicalSiteName(site),site]));
const DUMMY_NUMBERS=new Set(DUMMY_EMPLOYEE_IDS.map(row=>row.id.replace(/\D/g,'')));

// The number of an Employee ID or Caliber ID: CMPL123, CMLL123 and 123 are one person.
export function employeeNumber(value){
 const match=text(value).toUpperCase().replace(/[\s/-]/g,'').match(/^(?:CMPL|CMLL)?(\d{1,9})$/);
 return match&&Number(match[1])>0?String(Number(match[1])):'';
}
export const recordNumber=(record={})=>employeeNumber(record.caliberId)||employeeNumber(record.employeeId)||employeeNumber(record.caliberCode);
// Our own name of a site as HR writes it ("Dudhichua OB East" is Dudhichua East OC); '' when it is not one of ours.
export const hrSiteName=value=>SITES.get(canonicalSiteName(value))||'';
export const isDummyNumber=number=>DUMMY_NUMBERS.has(String(number));

// Reads the rows of the sheet (the first rows may be titles). Every line is either a record or a problem.
// A file with a problem line gives no records, so nothing can be applied from it, unless leaveOut is asked
// (owner, 23 Nov 2026: three numbers stayed on two lines in HR's file and held the whole master back). Then the
// problem lines are left out, and leftAsIs names the people on them: planHrMaster keeps those people exactly as
// they are in Pulse-II instead of marking them "not on HR's list".
export function readHrMasterSheet(rows,{leaveOut=false}={}){
 const sheet=Array.isArray(rows)?rows:[];
 const columnsOf=row=>{const cells=(Array.isArray(row)?row:[]).map(heading),at={};for(const [field,names] of Object.entries(HEADINGS)){const index=cells.findIndex(cell=>names.includes(cell));if(index>=0)at[field]=index;}return at;};
 const headerAt=sheet.slice(0,15).findIndex(row=>{const at=columnsOf(row);return at.employeeId!==undefined&&at.name!==undefined&&at.site!==undefined;});
 if(headerAt<0)throw Object.assign(new Error(`Choose HR's master Excel. The sheet "${HR_MASTER_SHEET}" needs the columns EMPLOYEE ID, NAME and SITE / OFFICE.`),{status:400});
 const at=columnsOf(sheet[headerAt]),records=[],problems=[];
 const cell=(row,field)=>at[field]===undefined?'':text(row[at[field]]);
 let lines=0;
 sheet.slice(headerAt+1).forEach((row,index)=>{
  if(!Array.isArray(row)||row.every(value=>text(value)===''))return;
  lines++;
  const line=headerAt+index+2,employeeId=cell(row,'employeeId').toUpperCase(),name=cell(row,'name'),site=cell(row,'site');
  const number=employeeNumber(employeeId),siteName=hrSiteName(site),status=cell(row,'status').toUpperCase();
  const record={line,employeeId,number,name,region:cell(row,'region'),site,siteName,siteKey:canonicalSiteName(siteName),department:cell(row,'department'),designation:cell(row,'designation'),category:cell(row,'category'),status,left:status==='LEFT'};
  const problem=!number?'No usable Employee ID. Write the CMLL number.':!name?'Name is blank.':!siteName?'Site is not one of the Pulse-II sites.':'';
  if(problem)problems.push({line,employeeId:employeeId||'(blank)',name,site,problem});
  else records.push(record);
 });
 if(lines>HR_MASTER_MAX_LINES)throw Object.assign(new Error(`HR's master holds more than ${HR_MASTER_MAX_LINES.toLocaleString('en-IN')} lines.`),{status:400});
 const byNumber=new Map();
 for(const record of records)(byNumber.get(record.number)||byNumber.set(record.number,[]).get(record.number)).push(record);
 for(const [number,lines] of byNumber){
  if(lines.length<2)continue;
  const where=[...new Set(lines.map(line=>line.site))].join(' and ');
  for(const line of lines)problems.push({line:line.line,employeeId:line.employeeId,name:line.name,site:line.site,problem:`CMLL${number} is on ${lines.length} lines (${where}). Keep it on one line.`});
 }
 problems.sort((a,b)=>a.line-b.line);
 const bad=new Set(problems.map(problem=>problem.line)),leftAsIs=[...new Set(problems.map(problem=>employeeNumber(problem.employeeId)).filter(Boolean))];
 return {records:!problems.length?records:leaveOut?records.filter(record=>!bad.has(record.line)):[],problems,lines,leftAsIs:leaveOut?leftAsIs:[]};
}

const same=(a,b)=>String(a??'')===String(b??'');
const siteOf=record=>text(record.site||record.currentLocation||record.location);
const working=record=>!/^(resigned|left)$/i.test(text(record.status));
const person=(row,number)=>({id:String(row.id),employeeId:text(row.record_data.caliberId||row.record_data.employeeId)||'CMPL'+number,name:text(row.record_data.name||row.record_data.employee),site:siteOf(row.record_data),designation:text(row.record_data.currentDesignationName||row.record_data.designationName),status:text(row.record_data.status)});

// The fields of an Employee master line the plan reads. The server reads only these (HR_MASTER_EXISTING_FIELDS),
// so a plan never pulls the whole master (about 44 MB) into memory.
export const HR_MASTER_EXISTING_FIELDS=['caliberId','employeeId','caliberCode','name','employee','site','currentLocation','location','currentDepartmentName','currentDesignationName','designationName','status','resignationAcceptenceDate','hrCategory','hrRegion','hrSite','hrStatus','hrListed','hrLeft','siteLockedAt'];

// Works out every change without writing. `existing` is every Employee master line ({id, master_name, record_data}).
// The result holds, for each person on HR's list, only the fields that change (`patch`), the new people
// (`inserts`), and the ids of the people who are not on HR's list (`notListedIds`).
// applySites: HR's site replaces the site held for a person who is already on HR's list. It is always so
// on the first import; a later import keeps the site Pulse-II holds unless it is asked for. A person whose
// site was set by an approved move (siteLockedAt) keeps it either way.
// leftAsIs: the numbers named on lines of the file that were left out; those people are not touched at all.
export function planHrMaster(existing,records,{applySites=true,now=new Date().toISOString(),fileName='',leftAsIs=[]}={}){
 const untouched=new Set(leftAsIs.map(String));
 const byNumber=new Map();
 for(const row of existing){const number=recordNumber(row.record_data);if(number)(byNumber.get(number)||byNumber.set(number,[]).get(number)).push(row);}
 // Two old lines can hold one number (CMPL21327 and 21327): the line written as CMPL is the person, the other steps aside.
 const primary=rows=>rows.find(row=>/^CMPL\d+$/i.test(text(row.record_data.caliberId)))||[...rows].sort((a,b)=>Number(a.id)-Number(b.id))[0];
 const updates=[],inserts=[],notListedIds=[],used=new Set();
 const lists={siteChanged:[],siteKept:[],added:[],nameChanged:[],workingAgain:[],left:[],notListed:[]};
 const bySite={};
 const siteRow=name=>bySite[name]||(bySite[name]={site:name,listed:0,added:0,siteChanged:0,left:0,notListed:0});
 let unchanged=0;
 for(const record of records){
  const rows=byNumber.get(record.number)||[],prev=rows.length?primary(rows):null,counts=siteRow(record.siteName);
  counts.listed++;if(record.left)counts.left++;
  const hr={name:record.name,hrCategory:record.category,hrRegion:record.region,hrSite:record.site,hrStatus:record.status,status:record.left?'Left':'Active',hrListed:true,hrLeft:record.left};
  if(record.department)hr.currentDepartmentName=record.department;
  if(record.designation)hr.currentDesignationName=record.designation;
  if(!prev){
   const id='CMPL'+record.number;
   inserts.push({caliberId:id,employeeId:id,caliberCode:'CMLL'+record.number,currentDepartmentName:'',currentDesignationName:'',...hr,currentLocation:record.siteName,site:record.siteName,source:'HR master',hrImportedAt:now,hrImportFile:fileName,employeeMasterRevision:1});
   counts.added++;lists.added.push({employeeId:id,name:record.name,site:record.siteName,designation:record.designation,status:record.status});
   continue;
  }
  used.add(String(prev.id));
  const saved=prev.record_data,before=person(prev,record.number);
  const siteDiffers=canonicalSiteName(siteOf(saved))!==record.siteKey;
  const takeSite=siteDiffers&&!saved.siteLockedAt&&(applySites||saved.hrListed!==true);
  if(takeSite){hr.currentLocation=record.siteName;hr.site=record.siteName;counts.siteChanged++;lists.siteChanged.push({...before,to:record.siteName});}
  else if(siteDiffers)lists.siteKept.push({...before,hrSite:record.siteName,reason:saved.siteLockedAt?'Site set by an approved move':'Site held in Pulse-II kept'});
  if(!same(before.name,record.name))lists.nameChanged.push({...before,to:record.name});
  if(!record.left&&!working(saved))lists.workingAgain.push({...before,resignedOn:text(saved.resignationAcceptenceDate)});
  if(record.left)lists.left.push(before);
  const patch=Object.fromEntries(Object.entries(hr).filter(([key,value])=>!same(value,saved[key])));
  if(!Object.keys(patch).length&&prev.master_name==='Employee master'){unchanged++;continue;}
  updates.push({id:String(prev.id),patch:{...patch,hrImportedAt:now,hrImportFile:fileName}});
 }
 // A site of ours that has no line at all in the file is not covered by it (HR's first file has no Lalpeth):
 // its people are left as they are, and the preview says so.
 const covered=new Set(records.map(record=>record.siteKey)),sitesNotInFile={};
 let dummyKept=0,alreadyNotListed=0,leftAsIsPeople=0;
 for(const row of existing){
  if(used.has(String(row.id)))continue;
  const number=recordNumber(row.record_data);
  if(number&&isDummyNumber(number)){dummyKept++;continue;}
  if(number&&untouched.has(number)){leftAsIsPeople++;continue;}
  if(row.record_data.hrListed===false){alreadyNotListed++;continue;}
  const before=person(row,number),key=canonicalSiteName(before.site);
  if(SITES.has(key)&&!covered.has(key)){sitesNotInFile[SITES.get(key)]=(sitesNotInFile[SITES.get(key)]||0)+1;continue;}
  notListedIds.push(String(row.id));
  if(SITES.has(key))siteRow(SITES.get(key)).notListed++;
  lists.notListed.push(before);
 }
 const active=lists.notListed.filter(row=>working(row)).length;
 const summary={lines:records.length,updated:updates.length,added:inserts.length,unchanged,siteChanged:lists.siteChanged.length,siteKept:lists.siteKept.length,nameChanged:lists.nameChanged.length,workingAgain:lists.workingAgain.length,left:lists.left.length,
  notListed:notListedIds.length,notListedAtSites:Object.values(bySite).reduce((sum,row)=>sum+row.notListed,0),notListedWorking:active,notListedResigned:notListedIds.length-active,alreadyNotListed,dummyKept,leftAsIsNumbers:untouched.size,leftAsIsPeople,
  sitesNotInFile:Object.entries(sitesNotInFile).map(([site,people])=>({site,people})),
  sites:[...SITES.values()].filter(site=>bySite[site]).map(site=>bySite[site])};
 return {updates,inserts,notListedIds,summary,lists};
}

