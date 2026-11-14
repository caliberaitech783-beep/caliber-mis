import {isMisAdministrator} from './mis-admin-access.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {managerReportScope,userSiteScope,userSiteSelection,reportScopeIncludesSite,displaySiteSelection} from './region-scope.mjs';

export function logBookSiteScope(session={},user={}) {
  const profile={...(session.permissions||{}),...session,...user};
  if(userSiteSelection(profile).length)return userSiteScope(profile);
  // Operational site assignments also apply to administrators in VLB and ELB.
  if(isMisAdministrator(session))return {sites:null,label:'All sites'};
  const scope=managerReportScope(profile);
  // An All assignment never grants unrestricted operational access to non-admins.
  if(scope.sites!==null)return scope;

  // Separate MIS identities still require an assigned site or region.
  return {sites:[],label:'Unassigned'};
}
export const siteAllowed=(scope,site)=>scope?.sites===null||reportScopeIncludesSite(scope,site);
export const scanDeletionAllowed=(scope,batch)=>Boolean(batch?.expected_context?.location&&siteAllowed(scope,batch.expected_context.location));
export const employeeAtLocation=(employee,location)=>Boolean(canonicalSiteName(location)&&displaySiteSelection(employee.site||employee.location||employee.currentLocation).some(site=>canonicalSiteName(site)===canonicalSiteName(location)));
export function requireLogBookSite(scope,site){
  if(!siteAllowed(scope,site))throw Object.assign(new Error('This location is not assigned to your login.'),{status:403});
}
export async function filterLogBookSites(client,scope){
  if(scope.sites===null)return null;
  const {rows}=await client.query('SELECT DISTINCT site FROM mis_log_books WHERE book_date>=$$2026-11-01$$');
  return rows.map(row=>row.site).filter(site=>siteAllowed(scope,site));
}

export async function allowedScanBatches(client,scope,login,batchId){
  if(scope.sites===null)return null;
  if(!scope.sites.length)return [];
  const params=batchId?[batchId]:[];
  const locations=(await client.query("SELECT DISTINCT draft->>'location' AS site FROM mis_scan_cards"+(batchId?' WHERE batch_id=$1':''),params)).rows.filter(row=>siteAllowed(scope,row.site)).map(row=>row.site);
  // Unfinished owned batches may contain unread cards, but no known out-of-scope cards.
  const {rows}=await client.query("SELECT b.id,to_jsonb(b)->'expected_context' AS expected_context FROM mis_scan_batches b LEFT JOIN mis_scan_cards c ON c.batch_id=b.id "+(batchId?'WHERE b.id=$3 ':'')+"GROUP BY b.id HAVING (b.created_by=$1 AND bool_and(COALESCE(c.draft->>'location','')='' OR c.draft->>'location'=ANY($2::text[])) AND bool_or(COALESCE(c.status,'queued')<>'posted')) OR (count(c.id)>0 AND bool_and(COALESCE(c.draft->>'location','')=ANY($2::text[])))",[login,locations,...params]);
  return rows.filter(row=>!row.expected_context?.location||siteAllowed(scope,row.expected_context.location)).map(row=>row.id);
}

export function manualLogBookLocation(session={},scope=logBookSiteScope(session)){
 const assigned=userSiteSelection({...session.permissions,...session});
 const sites=assigned.length?assigned:scope.sites||[];
 return sites.length===1&&siteAllowed(scope,sites[0])?displaySiteSelection(sites[0])[0]||'':'';
}

export function logBookAccountLocation(session={},scope=logBookSiteScope(session),users=[]){
 const login=String(session.login||'').trim().toLowerCase(),name=String(session.name||'').trim().toLowerCase();
 const user=users.find(row=>login&&String(row.login||'').trim().toLowerCase()===login)||users.find(row=>name&&String(row.employee||row.name||'').trim().toLowerCase()===name);
  return manualLogBookLocation(user&&userSiteSelection(user).length?user:session,scope);
}
