import {displaySiteSelection,displaySiteName} from '../../shared/region-scope.mjs';
import {logBookSiteScope,siteAllowed,requireLogBookSite,employeeAtLocation,employeeOnHrList} from '../../shared/log-book-access.mjs';
import {employeeIdentity,employeeReferenceVariants} from '../../shared/employee-identity.mjs';
import {needsDriverConfirm,driverConfirmQuestion,fetchRefusal,employeeDesignation,employeeLeft} from '../../shared/caliber-id-check.mjs';
import {employeeSiteOn,isBookDate} from '../../shared/employee-site-moves.mjs';
export const EMPLOYEE_FIND_SQL="SELECT id,record_data FROM master_records WHERE master_name='Employee master' AND (upper(record_data->>'caliberId')=ANY($1::text[]) OR upper(record_data->>'employeeId')=ANY($1::text[]) OR upper(record_data->>'caliberCode')=ANY($1::text[]) OR (COALESCE(record_data->>'caliberCode','')='' AND upper(COALESCE(record_data->>'caliberId',record_data->>'employeeId')) ~ '^(CMPL|CMLL)?[0-9]+$' AND ('CMLL'||substring(COALESCE(record_data->>'caliberId',record_data->>'employeeId') from '[0-9]+$'))=ANY($1::text[])) OR (COALESCE(record_data->>'caliberId',record_data->>'employeeId','')='' AND upper(record_data->>'employeeCode')=ANY($1::text[])))";
// A person says, once, that this employee drives or operates although the designation says otherwise.
// The mark stays on the employee, so the scan does not stop his or her later cards for this reason.
const CONFIRM_DRIVER_SQL="UPDATE master_records SET record_data=record_data||$2::jsonb WHERE id=$1 AND master_name='Employee master'";
// What the Fetch box gets back for an employee it may put on the card.
export const fetchedEmployee=row=>{const identity=employeeIdentity(row.record_data);return {id:String(row.id),name:row.record_data.name||row.record_data.employee,caliberId:identity.employeeId,employeeId:identity.employeeId,caliberCode:identity.caliberCode,site:row.record_data.site||row.record_data.currentLocation||row.record_data.location,source:'Employee master'};};
export function registerErpEmployees(app,{pool,requireSession,requireAdministrator,getSiteScope=async session=>logBookSiteScope(session)}){
 app.post('/api/log-books/employee-lookup',requireSession,requireAdministrator,async(req,res)=>{try{
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
  if(found.length&&!listed.length)return res.status(403).json({error:fetchRefusal(found[0].record_data,location,bookDate)});
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
  return res.status(404).json({error:'No employee has this number. Check the card.'});
 }catch(e){res.status(e.status||500).json({error:e.status?e.message:'Could not look up Employee Master. Please retry.'});}});
}
