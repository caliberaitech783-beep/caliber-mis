import {canonicalSiteName} from './site-location.mjs';
import {managerReportScope,userSiteScope,userSiteSelection,reportScopeIncludesSite,displaySiteSelection} from './region-scope.mjs';

export function logBookSiteScope(session={},user={}) {
  const profile={...(session.permissions||{}),...session,...user};
  const hasSite=userSiteSelection(profile).length>0;
  const regional=Boolean(profile.managerSites||profile.managerRegion||profile.region);
  if(session.role==='normal'&&hasSite)return userSiteScope(profile);
  if(regional)return managerReportScope(profile);
  if(hasSite)return userSiteScope(profile);
  const administrator=session.role==='super'&&(!session.permissions||['admin','super admin'].includes(String(session.permissions?.adminLevel||'').toLowerCase()));
  // Separate MIS identities need an explicit assignment or explicit All region.
  if(administrator&&!session.permissions?.separateMisCredentials)return {sites:null,label:'All sites'};
  return {sites:[],label:'Unassigned'};
}
export const siteAllowed=(scope,site)=>scope?.sites===null||reportScopeIncludesSite(scope,site);
export const employeeAtLocation=(employee,location)=>Boolean(canonicalSiteName(location)&&displaySiteSelection(employee.site||employee.location||employee.currentLocation).some(site=>canonicalSiteName(site)===canonicalSiteName(location)));
export function requireLogBookSite(scope,site){
  if(!siteAllowed(scope,site))throw Object.assign(new Error('This location is not assigned to your login.'),{status:403});
}
export async function filterLogBookSites(client,scope){
  if(scope.sites===null)return null;
  const {rows}=await client.query('SELECT DISTINCT site FROM mis_log_books');
  return rows.map(row=>row.site).filter(site=>siteAllowed(scope,site));
}

export async function allowedScanBatches(client,scope,login){
  if(scope.sites===null)return null;
  if(!scope.sites.length)return [];
  const locations=(await client.query("SELECT DISTINCT draft->>'location' AS site FROM mis_scan_cards")).rows.filter(row=>siteAllowed(scope,row.site)).map(row=>row.site);
  // Keep the owner's unfinished batch accessible after individual cards save.
  // Completed batches and other users still require every card to be in scope;
  // saving a card separately enforces requireLogBookSite on its location.
  const {rows}=await client.query("SELECT b.id FROM mis_scan_batches b LEFT JOIN mis_scan_cards c ON c.batch_id=b.id GROUP BY b.id HAVING (b.created_by=$1 AND bool_or(COALESCE(c.status,'queued')<>'posted')) OR (count(c.id)>0 AND bool_and(COALESCE(c.draft->>'location','')=ANY($2::text[])))",[login,locations]);
  return rows.map(row=>row.id);
}

export function manualLogBookLocation(session={},scope=logBookSiteScope(session)){
 const assigned=userSiteSelection({...session.permissions,...session});
 const sites=assigned.length?assigned:scope.sites||[];
 return sites.length===1&&siteAllowed(scope,sites[0])?displaySiteSelection(sites[0])[0]||'':'';
}
