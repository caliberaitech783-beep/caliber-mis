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
import {createHrEmployeeSync} from '../services/hr-employee-sync.mjs';
import {hrSiteName} from '../../shared/hr-employee-master.mjs';
import {machineDays,importedDays,mergeBiometricDays,MAX_DAYS} from '../../shared/trip-biometric-check.mjs';

const SITES=REGION_DATA.flatMap(region=>region.sites);
const fail=(res,status,error)=>res.status(status).json({error});

// index: the employee lists by CMLL number (shared/a-form-people.mjs). A number held on two lines is read at this site
// first, so a person who is on the list of this site is never called "held at another site".
export function sheetPeopleAnswer(index,site,numbers){
 const siteKey=canonicalSiteName(site);
 const people=numbers.map(number=>{
  const everyone=index.byNumber.get(number)||[],listed=preferredPeople(everyone.filter(person=>person.listed));
  const working=listed.find(person=>person.siteKeys.includes(siteKey))||listed[0]||null,known=working||preferredPeople(everyone)[0]||null;
  return {number,found:Boolean(known),name:known?.name||'',designation:known?.designation||'',department:known?.department||'',category:known?.category||'',siteLabel:known?.siteLabel||'',
   atSite:Boolean(working?.siteKeys.includes(siteKey)),working:Boolean(working),left:Boolean(known?.left)};
 });
 const sitePeople=[];
 for(const [number,everyone] of index.byNumber){
  const person=preferredPeople(everyone.filter(p=>p.listed&&p.siteKeys.includes(siteKey)))[0];
  if(person)sitePeople.push({number,name:person.name,designation:person.designation});
 }
 return {people,sitePeople};
}

// Biometric days for the tab (owner, 23 Nov 2026): the site machines' punches from HR Pulse and the punches imported on
// Attendance Management, one line per employee and date (shared/trip-biometric-check.mjs). Sent: every day punched at the
// chosen site, and the days elsewhere of the numbers asked for (people on a trip card here: a different site).
// source: 'both' | 'machine' | 'imported'. A machine read that fails is said, and the imported punches are still sent.
export const BIOMETRIC_SOURCES=['both','machine','imported'];
const IMPORTED_SQL=`SELECT caliber_code,punch_date::text AS date,in_time,out_time,site FROM mis_biometric_punches WHERE punch_date BETWEEN $1 AND $2 LIMIT 100001`;
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const validDate=d=>ISO.test(String(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
export async function readBiometricDays({pool,hrPunches,site,from,to,source='both',numbers=[]}){
 const siteKey=canonicalSiteName(site),asked=new Set(numbers.map(employeeNumber).filter(Boolean)),inRange=d=>d.date>=from&&d.date<=to;
 const machine={asked:source!=='imported',connected:false,punches:0,unread:0,error:''},imported={asked:source!=='machine',lines:0};
 let machineList=[],importedList=[];
 if(machine.asked){
  try{
   const answer=await hrPunches({from,to});
   const read=machineDays(answer,{siteName:name=>hrSiteName(name)||name});
   machineList=read.days;Object.assign(machine,{connected:true,punches:answer?.punches?.length||0,unread:read.unread});
  }catch(error){machine.error=error.status===503?'Pulse-II is not connected to HR Pulse, so the machine punches could not be read.':'HR Pulse did not give the machine punches ('+(error.message||'no answer')+').';}
 }
 if(imported.asked){
  try{const {rows}=await pool.query(IMPORTED_SQL,[from,to]);importedList=importedDays(rows.map(r=>({caliberCode:r.caliber_code,date:r.date,inTime:r.in_time,outTime:r.out_time,site:r.site})));}
  catch(error){if(error.code!=='42P01')throw error;}
  imported.lines=importedList.length;
 }
 const days=mergeBiometricDays(machineList,importedList).filter(d=>inRange(d)&&(!d.site||canonicalSiteName(d.site)===siteKey||asked.has(d.caliberCode)));
 return {days,machine,imported};
}

// readIndex: the employee lists and A Form Master together (server/services/a-form-people-index.mjs); a test passes its own.
// hrPunches: ({from,to}) => HR Pulse's machine punches; a test passes its own.
export function registerAttendanceSheetCheck(app,{pool,protect,readIndex=readAFormPeople,hrPunches=createHrEmployeeSync({pool}).biometricPunches}){
 app.post('/api/reports/manpower/attendance-sheet/biometric',...protect,async(req,res,next)=>{
  try{
   const site=String(req.body?.site??'').trim(),{from,to}=req.body||{},source=BIOMETRIC_SOURCES.includes(req.body?.source)?req.body.source:'both';
   const known=SITES.find(name=>canonicalSiteName(name)===canonicalSiteName(site));
   if(!known)return fail(res,400,'Select the site.');
   if(!siteAllowed(req.logBookScope,known))return fail(res,403,'This location is not assigned to your login.');
   if(!validDate(from)||!validDate(to)||to<from)return fail(res,400,'Select a valid From and To date.');
   if((Date.parse(to)-Date.parse(from))/86400000>=MAX_DAYS)return fail(res,400,`Select up to ${MAX_DAYS} days.`);
   const numbers=Array.isArray(req.body?.numbers)?req.body.numbers.slice(0,SHEET_MAX_PEOPLE):[];
   res.set('Cache-Control','private, no-store').json({site:known,from,to,source,...await readBiometricDays({pool,hrPunches,site:known,from,to,source,numbers})});
  }catch(error){next(error);}
 });

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
