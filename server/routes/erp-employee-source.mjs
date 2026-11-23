import {displaySiteSelection,displaySiteName} from '../../shared/region-scope.mjs';
import {logBookSiteScope,siteAllowed,requireLogBookSite,employeeAtLocation,employeeOnHrList} from '../../shared/log-book-access.mjs';
import {employeeIdentity,employeeReferenceVariants} from '../../shared/employee-identity.mjs';
import {needsDriverConfirm,driverConfirmQuestion,fetchRefusal,employeeDesignation,employeeLeft,ID_NOT_FOUND,CONTACT_HR} from '../../shared/caliber-id-check.mjs';
import {employeeSiteOn,isBookDate} from '../../shared/employee-site-moves.mjs';
export const EMPLOYEE_FIND_SQL="SELECT id,record_data FROM master_records WHERE master_name='Employee master' AND (upper(record_data->>'caliberId')=ANY($1::text[]) OR upper(record_data->>'employeeId')=ANY($1::text[]) OR upper(record_data->>'caliberCode')=ANY($1::text[]) OR (COALESCE(record_data->>'caliberCode','')='' AND upper(COALESCE(record_data->>'caliberId',record_data->>'employeeId')) ~ '^(CMPL|CMLL)?[0-9]+$' AND ('CMLL'||substring(COALESCE(record_data->>'caliberId',record_data->>'employeeId') from '[0-9]+$'))=ANY($1::text[])) OR (COALESCE(record_data->>'caliberId',record_data->>'employeeId','')='' AND upper(record_data->>'employeeCode')=ANY($1::text[])))";
// A person says, once, that this employee drives or operates although the designation says otherwise.
// The mark stays on the employee, so the scan does not stop his or her later cards for this reason.
const CONFIRM_DRIVER_SQL="UPDATE master_records SET record_data=record_data||$2::jsonb WHERE id=$1 AND master_name='Employee master'";
// What the Fetch box gets back for an employee it may put on the card.
export const fetchedEmployee=row=>{const identity=employeeIdentity(row.record_data);return {id:String(row.id),name:row.record_data.name||row.record_data.employee,caliberId:identity.employeeId,employeeId:identity.employeeId,caliberCode:identity.caliberCode,site:row.record_data.site||row.record_data.currentLocation||row.record_data.location,source:'Employee master'};};
// What the person at the card is told when HR Pulse holds the number in a way that changes nothing here
// (shared/hr-employee-changes.mjs holds it for a person to look at on Sync all masters).
export function hrRefreshBlockLine(held){
 if(['other-name','old-person'].includes(held?.reason))return 'HR Pulse has this ID under another name'+(held.name?' ('+held.name+')':'')+'.'+CONTACT_HR;
 if(held?.reason==='two-lines')return 'HR Pulse has this ID on more than one line.'+CONTACT_HR;
 return 'HR Pulse holds this ID in a form Pulse-II cannot use.'+CONTACT_HR;
}
export const REFRESH_NOT_CONNECTED='Pulse-II is not connected to HR Pulse right now, so it could not be asked. Please tell your MIS administrator.';
// hrCopy: () => the copy from HR Pulse (server/services/hr-employee-minute-copy.mjs), asked when a person presses Refresh.
export function registerErpEmployees(app,{pool,requireSession,requireAdministrator,getSiteScope=async session=>logBookSiteScope(session),hrCopy=()=>null}){
 // refresh:true on a refusal tells the Fetch box to offer Refresh: the number is one HR settles (not found, or left).
 const answered=handler=>async(req,res)=>{try{await handler(req,res)}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Could not look up Employee Master. Please retry.'});}};
 const lookup=async(req,res)=>{
  const scope=await getSiteScope(req.session),location=String(req.body.location||'').trim();
  if(scope.sites!==null||location)requireLogBookSite(scope,location);
  // The card's date: a worker moved to another site by an approved move belongs to the old site on earlier cards.
  const bookDate=isBookDate(req.body.bookDate)?req.body.bookDate:'';
  // With a card site given, that site (already checked against the login) and the card's date decide.
  const allowed=row=>location?employeeAtLocation(row,location,bookDate):scope.sites===null||displaySiteSelection(row.site||row.location||row.currentLocation).some(site=>siteAllowed(scope,site));
  const id=String(req.body.caliberId||'').trim().toUpperCase();
  if(!/^[A-Z0-9-]{1,40}$/.test(id))return res.status(400).json({error:'Enter a valid Employee ID or Caliber ID.'});
  const references=employeeReferenceVariants(id);
  const found=(await pool.query(EMPLOYEE_FIND_SQL,[references])).rows;
  const listed=found.filter(row=>employeeOnHrList(row.record_data));
  // Kept for the cards already saved, but not on HR's list: never fetched for a new card.
  if(found.length&&!listed.length)return res.status(403).json({error:fetchRefusal(found[0].record_data,location,bookDate),refresh:true});
  const eligible=listed.filter(row=>allowed(row.record_data));
  if(eligible.length>1)return res.status(409).json({error:'More than one employee matches this ID at the selected location. Check Employee Master.'});
  if(eligible.length===1){
   const r=eligible[0],identity=employeeIdentity(r.record_data);
   // On a scanned card a helper, mechanic or supervisor is not put on the card until a person confirms it
   // (shared/caliber-id-check.mjs): most such numbers are a misread of a driver's number.
   if(req.query.scan==='1'&&needsDriverConfirm(r.record_data)){
    const kind=req.body.kind==='equipment'?'equipment':'vehicle';
    if(req.body.confirmDriver!==true)return res.status(409).json({error:driverConfirmQuestion(r.record_data,kind),confirmDriver:{name:r.record_data.name||r.record_data.employee||'',designation:employeeDesignation(r.record_data)}});
    const by=String(req.session?.login||req.session?.name||'');
    await pool.query(CONFIRM_DRIVER_SQL,[r.id,JSON.stringify({driverConfirmedAt:new Date().toISOString(),driverConfirmedBy:by,driverConfirmedAtSite:location})]);
    req.audit={eventType:'Master data',module:'Employee master',action:'Confirm driver or operator',targetType:'Employee',targetReference:identity.employeeId,details:{designation:employeeDesignation(r.record_data),site:location,kind}};
   }
   return res.set('Cache-Control','no-store').json(fetchedEmployee(r));
  }
  // The number belongs to someone at another site. Say who: the number is most often a misread. When it is
  // not, the card's site and date allow the one approved way to move that person: Fetch from Pulse-II with OTP
  // (server/routes/employee-site-move.mjs). siteMove tells the Fetch box what that move would be.
  if(listed.length){
   const owner=listed[0].record_data,from=employeeSiteOn(owner,bookDate),identity=employeeIdentity(owner);
   const siteMove=location&&bookDate&&from&&!employeeLeft(owner)?{employeeId:identity.employeeId,name:owner.name||owner.employee||'',designation:employeeDesignation(owner),from:displaySiteName(from)||from,to:displaySiteName(location)||location,fromDate:bookDate}:null;
   return res.status(403).json({error:fetchRefusal(owner,location,bookDate),...(siteMove?{siteMove}:{})});
  }
  return res.status(404).json({error:ID_NOT_FOUND,refresh:true});
 };
 app.post('/api/log-books/employee-lookup',requireSession,requireAdministrator,answered(lookup));
 // Refresh (owner, 23 Nov 2026): "ID not found. Please contact your HR team. And there one refresh button should be
 // there. If [it] is added and then the refresh button is done and it is showing from HR Pulse, then it should allow
 // to move further." HR Pulse is asked for this one number now; when it holds the person, Employee Master takes him
 // by the rules of the minute copy and the ordinary lookup answers, so the card goes on exactly as after a Fetch.
 // Nothing is created or edited in Pulse-II by a person: only what HR Pulse holds is taken.
 app.post('/api/log-books/employee-refresh',requireSession,requireAdministrator,answered(async(req,res)=>{
  const scope=await getSiteScope(req.session),location=String(req.body.location||'').trim();
  if(scope.sites!==null||location)requireLogBookSite(scope,location);
  const id=String(req.body.caliberId||'').trim().toUpperCase();
  if(!/^[A-Z0-9-]{1,40}$/.test(id))return res.status(400).json({error:'Enter a valid Employee ID or Caliber ID.'});
  const copy=hrCopy();
  // 503: this server has no connection to HR Pulse at all (its key is missing), so pressing again will not help and
  // HR cannot help either: the person is sent to the MIS administrator. (23 Nov 2026: the line said "did not answer.
  // Press Refresh again in a minute" while the key was gone.) 502: HR Pulse was asked and did not answer in time.
  if(!copy)return res.status(503).json({error:REFRESH_NOT_CONNECTED,refresh:true});
  let asked;
  try{asked=await copy.person(id,{by:String(req.session?.login||req.session?.name||'')});}
  catch(e){if(!e.status)throw e;return res.status(e.status).json({error:e.status===503?REFRESH_NOT_CONNECTED:e.status>=500?'HR Pulse did not answer. Press Refresh again in a minute.':e.message,refresh:true});}
  if(!asked.found)return res.status(404).json({error:ID_NOT_FOUND,refresh:true});
  if(asked.blocked)return res.status(409).json({error:hrRefreshBlockLine(asked.blocked),refresh:true});
  if(asked.changed)req.audit={eventType:'Master data',module:'Employee master',action:'Refresh from HR Pulse',targetType:'Employee',targetReference:id,details:{added:asked.added===true,site:location}};
  return lookup(req,res);
 }));
}
