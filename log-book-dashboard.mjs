import {canonicalSiteName} from './site-location.mjs';
import {REGION_DATA,displaySiteName} from './region-scope.mjs';
import {siteAllowed,requireLogBookSite,filterLogBookSites} from './log-book-access.mjs';
import {savedLogBookFilters} from './saved-log-book-filters.mjs';
import {misPageAllowed} from './mis-application-access.mjs';

export const dashboardShift=value=>({I:'S1',II:'S2',III:'S3',Day:'D',Night:'N',DN:'D',S1:'S1',S2:'S2',S3:'S3',D:'D',N:'N'})[value]||'';
export function dashboardFilters(query={}){
 const now=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),end=now<'2026-11-01'?'2026-11-01':now;
 const start=new Date(end+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-6);
 const from=start.toISOString().slice(0,10)<'2026-11-01'?'2026-11-01':start.toISOString().slice(0,10);
 const filters=savedLogBookFilters({...query,from:query.from||from,to:query.to||end});
 if((Date.parse(filters.to)-Date.parse(filters.from))/86400000>365)throw Object.assign(Error('Select a date range of up to 366 days.'),{status:400});
 const shift=String(query.shift||'');if(shift&&!['S1','S2','S3','D','N'].includes(shift))throw Object.assign(Error('Select a valid shift.'),{status:400});
 return {...filters,shift};
}
const shiftSql=`CASE COALESCE(NULLIF(data->>'cardShift',''),data->>'batchShift','') WHEN 'I' THEN 'S1' WHEN 'II' THEN 'S2' WHEN 'III' THEN 'S3' WHEN 'Day' THEN 'D' WHEN 'Night' THEN 'N' WHEN 'DN' THEN 'D' ELSE COALESCE(NULLIF(data->>'cardShift',''),data->>'batchShift','') END`;
export function summarizeLogBooks({rows,sites,from,to,location='',draftCount=0,kinds=['vehicle','equipment']}){
 const names=new Map(sites.map(site=>[canonicalSiteName(site),displaySiteName(site)]));
 for(const row of rows)names.set(canonicalSiteName(row.site),displaySiteName(row.site));
 const allSites=[...names.values()].sort((a,b)=>a.localeCompare(b));
 const selected=canonicalSiteName(location),siteRows=allSites.filter(site=>!selected||canonicalSiteName(site)===selected).map(site=>({site,vehicle:0,equipment:0}));
 const bySite=new Map(siteRows.map(row=>[canonicalSiteName(row.site),row])),days=new Map();
 for(let day=new Date(from+'T00:00:00Z');day<=new Date(to+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+1)){const date=day.toISOString().slice(0,10);days.set(date,{date,vehicle:0,equipment:0});}
 for(const row of rows){if(!kinds.includes(row.book_type)||!days.has(row.day))continue;const target=bySite.get(canonicalSiteName(row.site));if(!target)continue;target[row.book_type]+=Number(row.count);days.get(row.day)[row.book_type]+=Number(row.count);}
 return {from,to,sites:allSites,kinds,bySite:siteRows,trend:[...days.values()],totals:{vehicle:siteRows.reduce((sum,r)=>sum+r.vehicle,0),equipment:siteRows.reduce((sum,r)=>sum+r.equipment,0),activeSites:siteRows.filter(r=>r.vehicle+r.equipment>0).length,recoveryDrafts:draftCount}};
}
export function registerLogBookDashboard(app,{pool,protect,ensureBooks}){
 const handle=fn=>async(req,res,next)=>{try{await ensureBooks();res.set('Cache-Control','no-store');await fn(req,res)}catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}};
 const context=async req=>{
  const filters=dashboardFilters(req.query);if(filters.location)requireLogBookSite(req.logBookScope,filters.location);
  let permitted=await filterLogBookSites(pool,req.logBookScope);
  if(filters.location){const rows=(await pool.query('SELECT DISTINCT site FROM mis_log_books')).rows;permitted=rows.map(r=>r.site).filter(site=>siteAllowed(req.logBookScope,site)&&canonicalSiteName(site)===canonicalSiteName(filters.location));}
  const kinds=['vehicle','equipment'].filter(kind=>!req.session.permissions?.separateMisCredentials||misPageAllowed(req.session,kind==='vehicle'?'Vehicle Log Book':'Equipment Log Book'));
  return {filters,kinds,params:[filters.from,filters.to,permitted,kinds,filters.shift]};
 };
 const where=`deleted_at IS NULL AND book_date BETWEEN $1::date AND $2::date AND ($3::text[] IS NULL OR site=ANY($3::text[])) AND book_type=ANY($4::text[]) AND ($5='' OR ${shiftSql}=$5)`;
 app.get('/api/dashboard/log-books',...protect,handle(async(req,res)=>{
  const {filters,kinds,params}=await context(req);
  const rows=(await pool.query(`SELECT site,book_type,book_date::text AS day,count(*)::int AS count FROM mis_log_books WHERE ${where} GROUP BY site,book_type,book_date`,params)).rows;
  const masters=(await pool.query("SELECT record_data FROM master_records WHERE master_name='Equipment master'")).rows;
  const sites=[...REGION_DATA.flatMap(r=>r.sites),...masters.flatMap(({record_data:r})=>[r.currentLocation||r.site||r.location]).filter(Boolean),...(req.logBookScope.sites||[])].filter(site=>siteAllowed(req.logBookScope,site));
  let draftCount=0;
  if((await pool.query("SELECT to_regclass('mis_workflow_drafts') AS name")).rows[0]?.name){
   const drafts=(await pool.query("SELECT workflow,site,COALESCE(payload->'context'->>'bookDate',payload->'form'->>'bookDate',to_char(created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD')) AS day,COALESCE(payload->'context'->>'cardShift',payload->'form'->>'cardShift','') AS shift FROM mis_workflow_drafts WHERE owner_login=$1 AND deleted_at IS NULL AND COALESCE(payload->>'permanentlyDeleted','false')<>'true'",[String(req.session.login||req.session.name||'').trim().toLowerCase()])).rows;
   draftCount=drafts.filter(d=>kinds.includes(d.workflow.endsWith('vehicle')?'vehicle':'equipment')&&siteAllowed(req.logBookScope,d.site)&&(!filters.location||canonicalSiteName(d.site)===canonicalSiteName(filters.location))&&d.day>=filters.from&&d.day<=filters.to&&(!filters.shift||dashboardShift(d.shift)===filters.shift)).length;
  }
  res.json({...summarizeLogBooks({rows,sites,from:filters.from,to:filters.to,location:filters.location,draftCount,kinds}),shift:filters.shift,updatedAt:new Date().toISOString()});
 }));
 app.get('/api/dashboard/log-books/records',...protect,handle(async(req,res)=>{
  const {filters,kinds,params}=await context(req),kind=String(req.query.kind||'');
  if(!kinds.includes(kind))return res.status(403).json({error:'This logbook type is not available to your login.'});
  const before=String(req.query.before||'');if(before&&!/^\d+$/.test(before))return res.status(400).json({error:'Invalid page cursor.'});
  const rows=(await pool.query(`SELECT id,book_no,book_type,book_date::text AS day,site,data->>'door' AS door,data->>'cardShift' AS shift FROM mis_log_books WHERE ${where} AND book_type=$6 AND ($7::bigint IS NULL OR id<$7::bigint) ORDER BY id DESC LIMIT 101`,[...params,kind,before||null])).rows.filter(row=>!filters.location||canonicalSiteName(row.site)===canonicalSiteName(filters.location));
  res.json({records:rows.slice(0,100),nextCursor:rows.length>100?String(rows[99].id):null});
 }));
}
