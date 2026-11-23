// Attendance Sheet Mismatch (owner, 23 Nov 2026): Reports > Manpower & OT > Attendance Sheet Mismatch compares the
// attendance Excel a site keeps by hand with Pulse-II (shared/attendance-sheet-check.mjs). The attendance itself comes
// from the register's own read (/api/reports/manpower/attendance). These two reads give what that one does not hold:
//  - the sites this login may choose, and
//  - what Employee Master says about each EMP. ID of the sheet (name, designation, site, LEFT), with the people it holds
//    working at the chosen site, so a person missing from the sheet shows as well.
// Nothing is saved: the sheet never leaves the browser, only its ID numbers are asked about.
// The routes sit under /api/reports, so the Reports menu right and the login's sites decide who reads.
import {REGION_DATA} from '../../shared/region-scope.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {siteAllowed} from '../../shared/log-book-access.mjs';
import {employeeNumber} from '../../shared/hr-employee-master.mjs';
import {preferredPeople} from '../../shared/a-form-people.mjs';
import {SHEET_MAX_PEOPLE} from '../../shared/attendance-sheet-check.mjs';
import {readAFormPeople} from '../services/a-form-people-index.mjs';

const SITES=REGION_DATA.flatMap(region=>region.sites);
const fail=(res,status,error)=>res.status(status).json({error});

// index: the employee lists by CMLL number (shared/a-form-people.mjs). A number held on two lines is read at this site
// first, so a person who is on the list of this site is never called "held at another site".
export function sheetPeopleAnswer(index,site,numbers){
 const siteKey=canonicalSiteName(site);
 const people=numbers.map(number=>{
  const everyone=index.byNumber.get(number)||[],listed=preferredPeople(everyone.filter(person=>person.listed));
  const working=listed.find(person=>person.siteKeys.includes(siteKey))||listed[0]||null,known=working||preferredPeople(everyone)[0]||null;
  return {number,found:Boolean(known),name:known?.name||'',designation:known?.designation||'',siteLabel:known?.siteLabel||'',
   atSite:Boolean(working?.siteKeys.includes(siteKey)),working:Boolean(working),left:Boolean(known?.left)};
 });
 const sitePeople=[];
 for(const [number,everyone] of index.byNumber){
  const person=preferredPeople(everyone.filter(p=>p.listed&&p.siteKeys.includes(siteKey)))[0];
  if(person)sitePeople.push({number,name:person.name,designation:person.designation});
 }
 return {people,sitePeople};
}

// readIndex: the employee lists and A Form Master together (server/services/a-form-people-index.mjs); a test passes its own.
export function registerAttendanceSheetCheck(app,{pool,protect,readIndex=readAFormPeople}){
 app.get('/api/reports/manpower/attendance-sheet/sites',...protect,(req,res)=>{
  res.set('Cache-Control','private, no-store').json({sites:SITES.filter(site=>siteAllowed(req.logBookScope,site))});
 });

 app.post('/api/reports/manpower/attendance-sheet/people',...protect,async(req,res,next)=>{
  try{
   const site=String(req.body?.site??'').trim(),ids=req.body?.ids;
   const known=SITES.find(name=>canonicalSiteName(name)===canonicalSiteName(site));
   if(!known)return fail(res,400,'Select the site of this attendance sheet.');
   if(!siteAllowed(req.logBookScope,known))return fail(res,403,'This location is not assigned to your login.');
   if(!Array.isArray(ids)||!ids.length)return fail(res,400,'The sheet has no EMP. ID to check.');
   if(ids.length>SHEET_MAX_PEOPLE)return fail(res,400,`Check up to ${SHEET_MAX_PEOPLE} employees at a time.`);
   const numbers=[...new Set(ids.map(employeeNumber).filter(Boolean))];
   res.set('Cache-Control','private, no-store').json({site:known,...sheetPeopleAnswer(await readIndex(pool),known,numbers)});
  }catch(error){next(error);}
 });
}
