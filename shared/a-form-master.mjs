// A Form Master (owner, 23 Nov 2026): one line links an A Form no., a CMLL id (Employee ID) and a site.
//
// HR keeps an A Form register at every mine. A driver writes that number in the FORM A box of his trip card,
// and the biometric device of a site can know him by it. The same A Form no. is used again at other sites
// (1,923 of HR's 2,777 numbers on 23 Nov 2026), so a number names a person only together with its site.
//
// The master is used three ways:
//  - a scanned card: the Caliber ID read, the FORM A box read and the batch's site must be one line here
//    (shared/caliber-id-check.mjs);
//  - a biometric file whose code column is the A Form no.: the code is changed to the CMLL id of that site
//    (shared/attendance-mismatch.mjs);
//  - the A Form Master page, which shows the three columns and takes HR's Excel.
// The site a person works at is still the one Employee Master holds. A line here for another site is kept
// but has no effect until Employee Master agrees.
import {canonicalSiteName} from './site-location.mjs';
import {employeeNumber,hrSiteName} from './hr-employee-master.mjs';

export const A_FORM_MASTER='A Form master';
export const A_FORM_MAX_LINES=30000;

const text=value=>value===null||value===undefined?'':String(value).trim();
const heading=value=>text(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const HEADINGS={
 employeeId:['employee id','emp id','cmll id','cmll','caliber id','c id','employee code'],
 aForm:['a form','a form no','a form number','form a','form a no','aform','aform no'],
 site:['site office','site','site name','location'],
};

// The numbers written in one cell as comparison keys: capitals and digits only, no leading zeros in the
// number ("0467" = "467", "D01" = "D1"). One cell can hold two numbers ("463/478", "192 & 278").
// A cell with no digit at all ("A", "-", "NA") is not a number.
export function aFormKeys(value){
 return [...new Set(text(value).toUpperCase().split(/[/&,;]|\bAND\b/).map(part=>part.replace(/[^A-Z0-9]/g,'').replace(/^([A-Z]*)0+(?=\d)/,'$1')).filter(key=>/\d/.test(key)))];
}
// What the FORM A box of a card can mean: as written, and without a leading "A" ("A63" is A Form no. 63).
export function cardAFormKeys(value){
 return [...new Set(aFormKeys(value).flatMap(key=>/^A\d+$/.test(key)?[key,key.slice(1)]:[key]))];
}
export const aFormEmployeeId=number=>'CMLL'+number;
const lineKey=(siteKey,number)=>siteKey+'|'+number;

// The lines of A Form Master among a list of master rows ({master_name, record_data}), ready to be asked:
//   owners  "site|A Form no."  -> the CMLL numbers that number is written against at that site
//   forms   "site|CMLL number" -> the A Form numbers of that person at that site
// Worked out once for a list of rows and kept with it: the scan asks for every card of an entry.
const linksOf=new WeakMap();
export function aFormLinks(masters){
 let links=masters&&typeof masters==='object'?linksOf.get(masters):null;
 if(links)return links;
 const owners=new Map(),forms=new Map();
 for(const row of masters||[]){
  if(row?.master_name!==A_FORM_MASTER)continue;
  const data=row.record_data||{},number=employeeNumber(data.employeeId),site=canonicalSiteName(data.site);
  if(!number||!site)continue;
  for(const key of aFormKeys(data.aFormNo)){
   const at=site+'|'+key,held=owners.get(at);if(held)held.add(number);else owners.set(at,new Set([number]));
   const mine=site+'|'+number,keys=forms.get(mine);if(keys)keys.push(key);else forms.set(mine,[key]);
  }
 }
 links={owners,forms};
 if(masters&&typeof masters==='object')linksOf.set(masters,links);
 return links;
}
// The CMLL numbers the FORM A box of a card names at this site (cardAFormKeys of what is written in the box).
export function aFormNumbersAt(links,location,keys){
 const site=canonicalSiteName(location),found=new Set();
 if(site)for(const key of keys)for(const number of links.owners.get(site+'|'+key)||[])found.add(number);
 return [...found];
}
// The A Form numbers A Form Master holds for this CMLL number at this site.
export const aFormKeysOf=(links,location,number)=>links.forms.get(canonicalSiteName(location)+'|'+number)||[];

// Reads the rows of HR's sheet (the first rows may be titles). A line is kept, or listed as left out with the reason.
export function readAFormSheet(rows){
 const sheet=Array.isArray(rows)?rows:[];
 const columnsOf=row=>{const cells=(Array.isArray(row)?row:[]).map(heading),at={};for(const [field,names] of Object.entries(HEADINGS)){const index=cells.findIndex(cell=>names.includes(cell));if(index>=0)at[field]=index;}return at;};
 const headerAt=sheet.slice(0,15).findIndex(row=>{const at=columnsOf(row);return at.employeeId!==undefined&&at.aForm!==undefined&&at.site!==undefined;});
 if(headerAt<0)throw Object.assign(new Error('Choose the A Form Excel. The sheet needs the columns EMPLOYEE ID, A FORM and SITE / OFFICE.'),{status:400});
 const at=columnsOf(sheet[headerAt]),records=[],problems=[],seen=new Set();
 let lines=0;
 sheet.slice(headerAt+1).forEach((row,index)=>{
  if(!Array.isArray(row)||row.every(value=>text(value)===''))return;
  lines++;
  const line=headerAt+index+2,employeeId=text(row[at.employeeId]).toUpperCase(),aFormNo=text(row[at.aForm]).slice(0,60),site=text(row[at.site]);
  const number=employeeNumber(employeeId),siteName=hrSiteName(site),siteKey=canonicalSiteName(siteName);
  const problem=!number?'No usable Employee ID. Write the CMLL number.':!siteName?'Site is not one of the Pulse-II sites.':seen.has(lineKey(siteKey,number))?`CMLL${number} is on two lines for this site. The first line is kept.`:'';
  if(problem){problems.push({line,employeeId:employeeId||'(blank)',aFormNo,site,problem});return;}
  seen.add(lineKey(siteKey,number));
  records.push({line,number,employeeId:aFormEmployeeId(number),aFormNo,keys:aFormKeys(aFormNo),site,siteName,siteKey});
 });
 if(lines>A_FORM_MAX_LINES)throw Object.assign(new Error(`The A Form Excel holds more than ${A_FORM_MAX_LINES.toLocaleString('en-IN')} lines.`),{status:400});
 return {records,problems,lines};
}

// An A Form no. written against two people of one site cannot name either of them until HR corrects it.
export function sharedAFormNumbers(records){
 const owners=new Map();
 for(const record of records)for(const key of record.keys||aFormKeys(record.aFormNo)){
  const at=record.siteKey+'|'+key;
  (owners.get(at)||owners.set(at,{site:record.siteName,aFormNo:key,employeeIds:[]}).get(at)).employeeIds.push(record.employeeId);
 }
 return [...owners.values()].filter(row=>row.employeeIds.length>1);
}

const stored=row=>{const data=row.record_data||{},number=employeeNumber(data.employeeId),siteName=hrSiteName(data.site)||text(data.site);return {id:String(row.id),number,siteName,siteKey:canonicalSiteName(siteName),aFormNo:text(data.aFormNo)};};

// Works out every change without writing. `existing` is every A Form Master line ({id, record_data}).
// The file replaces the lines of each site it names; a site with no line in the file keeps what it has.
// employees: the slim Employee Master lines ({number, siteKey, listed}), only to say how many lines will have no effect yet.
export function planAFormMaster(existing,records,{now=new Date().toISOString(),fileName='',employees=null}={}){
 const held=new Map();
 for(const row of existing.map(stored))if(row.number&&row.siteKey)held.set(lineKey(row.siteKey,row.number),row);
 const covered=new Set(records.map(record=>record.siteKey)),inFile=new Set(),inserts=[],updates=[],bySite=new Map();
 const siteRow=name=>bySite.get(name)||bySite.set(name,{site:name,lines:0,withForm:0,added:0,changed:0,removed:0,unchanged:0}).get(name);
 for(const record of records){
  const key=lineKey(record.siteKey,record.number),counts=siteRow(record.siteName),prev=held.get(key);
  inFile.add(key);counts.lines++;if(record.keys.length)counts.withForm++;
  const data={aFormNo:record.aFormNo,employeeId:record.employeeId,site:record.siteName,siteAsWritten:record.site,importedAt:now,importFile:fileName};
  if(!prev){inserts.push(data);counts.added++;}
  else if(prev.aFormNo!==record.aFormNo){updates.push({id:prev.id,data});counts.changed++;}
  else counts.unchanged++;
 }
 const removed=[...held.entries()].filter(([key,row])=>covered.has(row.siteKey)&&!inFile.has(key)).map(([,row])=>row);
 for(const row of removed)siteRow(row.siteName).removed++;
 const shared=sharedAFormNumbers(records);
 // A line works only at the site Employee Master holds for that person.
 let notInEmployeeMaster=0,otherSite=0;
 if(employees){
  const sitesOf=new Map();
  for(const employee of employees)if(employee.number&&employee.listed!==false)(sitesOf.get(employee.number)||sitesOf.set(employee.number,new Set()).get(employee.number)).add(employee.siteKey);
  for(const record of records){const sites=sitesOf.get(record.number);if(!sites)notInEmployeeMaster++;else if(!sites.has(record.siteKey))otherSite++;}
 }
 const sites=[...bySite.values()].sort((a,b)=>a.site.localeCompare(b.site));
 const summary={lines:records.length,withForm:records.filter(record=>record.keys.length).length,added:inserts.length,changed:updates.length,removed:removed.length,
  unchanged:sites.reduce((sum,row)=>sum+row.unchanged,0),sharedNumbers:shared.length,notInEmployeeMaster,otherSite,employeesChecked:Boolean(employees),sites};
 return {inserts,updates,deleteIds:removed.map(row=>row.id),summary,lists:{shared,removed:removed.map(row=>({employeeId:aFormEmployeeId(row.number),aFormNo:row.aFormNo,site:row.siteName}))}};
}

// One line typed on the page: the same checks as a line of the file.
export function aFormLine(input={}){
 const number=employeeNumber(input.employeeId),siteName=hrSiteName(input.site),aFormNo=text(input.aFormNo).slice(0,60);
 if(!number)throw Object.assign(new Error('Enter the CMLL id, for example CMLL12345.'),{status:400});
 if(!siteName)throw Object.assign(new Error('Choose the site.'),{status:400});
 if(!aFormKeys(aFormNo).length)throw Object.assign(new Error('Enter the A Form no.'),{status:400});
 return {number,siteKey:canonicalSiteName(siteName),data:{aFormNo,employeeId:aFormEmployeeId(number),site:siteName}};
}
