import {isMisAdministrator} from './mis-admin-access.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {managerReportScope,userSiteScope,userSiteSelection,reportScopeIncludesSite,displaySiteSelection} from './region-scope.mjs';
import {employeeSiteOn} from './employee-site-moves.mjs';

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
// Since HR's master became the Employee Master (shared/hr-employee-master.mjs): a person HR marks LEFT, and anyone
// who is not on HR's list, is kept in the master for the cards already saved but is at no site. Such a person is
// never matched on a card and never offered in a list. A line HR's import has not touched (the staff directory,
// a dummy ID, an employee added by hand) carries neither mark and is judged by its site alone.
export const employeeOnHrList=employee=>employee?.hrListed!==false&&employee?.hrLeft!==true;
// date (a card's book date, YYYY-MM-DD): a worker moved to another site by an approved move belongs to the old
// site for cards dated before the move and to the new site from its date (shared/employee-site-moves.mjs).
// Without a date the site held today is used.
export const employeeAtLocation=(employee,location,date)=>Boolean(employeeOnHrList(employee)&&canonicalSiteName(location)&&displaySiteSelection(employeeSiteOn(employee,date)).some(site=>canonicalSiteName(site)===canonicalSiteName(location)));
export function requireLogBookSite(scope,site){
  if(!siteAllowed(scope,site))throw Object.assign(new Error('This location is not assigned to your login.'),{status:403});
}
const LOG_BOOK_SITES_SQL='SELECT DISTINCT site FROM mis_log_books WHERE book_date>=$$2026-11-01$$';
// The sites that hold cards, narrowed to a login's scope. There is no read-it-yourself helper any
// more: every server route takes the one shared list (server/services/log-book-site-list.mjs).
//
// On 15 Nov 2026 the live scan entry read spent 3.2 s on average (10.4 s at most)
// reading this site list, which it reads again on every poll. The list only grows
// when a log book is saved at a site that had none, so one read is shared by all
// callers for ttlMs and the user's scope is still applied to it on every call.
// The read itself took up to 17 s on live, so once a list is held an expired list
// is still answered at once and the new one is read through `pool` in the
// background; the caller's own connection is never kept after its request ends.
//
// trusted (the server passes withoutRowSecurityRequest, with a pool): the list is read outside
// the caller's login. Under row security a read made as one site's login returns that site only,
// so the list held for everybody was whichever sites the login that happened to refresh it may
// see, and the database checked every card against that login's sites (20 to 30 s on live on
// 23 Nov 2026, about 90,000 cards). Read as the server it is every site, and each caller's own
// scope is applied to it here as before.
// The trusted read always takes its own connection from the pool, never the caller's: a
// connection carries one login's scope at a time, and the caller may be using its own.
// Until the first trusted read is in, a caller that holds a connection is answered from that
// connection as its own login (what it always got, kept for nobody else) instead of waiting
// for a second connection while holding one.
// remember(site): a card was just saved at this site, so a site's first card is in the list at
// once instead of after the next read.
export function createLogBookSiteCache({pool=null,ttlMs=60_000,now=()=>Date.now(),trusted=null}={}){
  let sites=null,readAt=0,reading=null;
  const remembered=new Set();
  const shared=Boolean(trusted&&pool);
  const read=db=>shared?trusted(()=>pool.query(LOG_BOOK_SITES_SQL)):db.query(LOG_BOOK_SITES_SQL);
  const refresh=client=>{
    if(reading)return reading;
    let started;
    // A read that cannot even start is a failed read like any other, never an error thrown at a
    // caller that only asked for the list in the background.
    try{started=Promise.resolve(read(client));}catch(error){return Promise.reject(error);}
    reading=started.then(({rows})=>{
      const found=rows.map(row=>row.site);
      for(const site of found)remembered.delete(site);
      sites=[...found,...remembered];readAt=now();return sites;
    }).finally(()=>{reading=null;});
    return reading;
  };
  const all=client=>{
    if(sites&&now()-readAt<ttlMs)return sites;
    if(sites&&pool){refresh(pool).catch(()=>{});return sites;}
    if(shared&&client!==pool){
      refresh(pool).catch(()=>{});
      return client.query(LOG_BOOK_SITES_SQL).then(({rows})=>rows.map(row=>row.site));
    }
    return refresh(client);
  };
  const permitted=async(client,scope)=>{
    if(scope.sites===null)return null;
    return (await all(client)).filter(site=>siteAllowed(scope,site));
  };
  permitted.remember=site=>{
    if(typeof site!=='string'||!site||sites?.includes(site))return;
    remembered.add(site);
    if(sites)sites=[...sites,site];
  };
  return permitted;
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
