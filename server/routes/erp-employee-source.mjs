import {displaySiteSelection} from '../../shared/region-scope.mjs';
import {logBookSiteScope,siteAllowed,requireLogBookSite,employeeAtLocation} from '../../shared/log-book-access.mjs';
import {employeeIdentity,employeeReferenceVariants} from '../../shared/employee-identity.mjs';
export function registerErpEmployees(app,{pool,requireSession,requireAdministrator,getSiteScope=async session=>logBookSiteScope(session)}){
 app.post('/api/log-books/employee-lookup',requireSession,requireAdministrator,async(req,res)=>{try{
  const scope=await getSiteScope(req.session),location=String(req.body.location||'').trim();
  if(scope.sites!==null||location)requireLogBookSite(scope,location);
  const allowed=row=>(scope.sites===null||displaySiteSelection(row.site||row.location||row.currentLocation).some(site=>siteAllowed(scope,site)))&&(!location||employeeAtLocation(row,location));
  const id=String(req.body.caliberId||'').trim().toUpperCase();
  if(!/^[A-Z0-9-]{1,40}$/.test(id))return res.status(400).json({error:'Enter a valid Employee ID or Caliber ID.'});
  const references=employeeReferenceVariants(id);
  const found=(await pool.query("SELECT id,record_data FROM master_records WHERE master_name='Employee master' AND (upper(record_data->>'caliberId')=ANY($1::text[]) OR upper(record_data->>'employeeId')=ANY($1::text[]) OR upper(record_data->>'caliberCode')=ANY($1::text[]) OR (COALESCE(record_data->>'caliberCode','')='' AND upper(COALESCE(record_data->>'caliberId',record_data->>'employeeId')) ~ '^(CMPL|CMLL)?[0-9]+$' AND ('CMLL'||substring(COALESCE(record_data->>'caliberId',record_data->>'employeeId') from '[0-9]+$'))=ANY($1::text[])) OR (COALESCE(record_data->>'caliberId',record_data->>'employeeId','')='' AND upper(record_data->>'employeeCode')=ANY($1::text[])))",[references])).rows;
  const eligible=found.filter(row=>allowed(row.record_data));
  if(eligible.length>1)return res.status(409).json({error:'More than one employee matches this ID at the selected location. Check Employee Master.'});
  if(eligible.length===1){const r=eligible[0],identity=employeeIdentity(r.record_data);return res.set('Cache-Control','no-store').json({id:String(r.id),name:r.record_data.name||r.record_data.employee,caliberId:identity.employeeId,employeeId:identity.employeeId,caliberCode:identity.caliberCode,site:r.record_data.site||r.record_data.currentLocation||r.record_data.location,source:'Employee master'});}
  if(found.length)return res.status(403).json({error:'Employee is not assigned to the selected location.'});
  return res.status(404).json({error:'No employee in Employee Master matches this ID.'});
 }catch(e){res.status(e.status||500).json({error:e.status?e.message:'Could not look up Employee Master. Please retry.'});}});
}
