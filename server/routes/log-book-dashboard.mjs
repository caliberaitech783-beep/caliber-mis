import {canonicalSiteName} from '../../shared/site-location.mjs';
import {REGION_DATA,displaySiteName} from '../../shared/region-scope.mjs';
import {siteAllowed,requireLogBookSite,filterLogBookSites} from '../../shared/log-book-access.mjs';
import {savedLogBookFilters} from '../rules/saved-log-book-filters.mjs';
import {misPageAllowed} from '../../shared/mis-application-access.mjs';
import {OPERATIONAL_START} from '../../shared/operational-start.mjs';
import {recentWindow,recentWindows,buildRecentActivity} from '../../shared/recent-activity.mjs';
import {bookShiftCode} from '../../shared/trip-card-rules.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';

// The shift a saved card belongs to. An LMV log book carries its own shift code; a trip card or an ELB card
// carries the card's shift, or failing that the shift of its batch.
const savedCardShift=row=>row.book_type==='lmv'
 ?bookShiftCode(row.book_shift)||bookShiftCode(row.card_shift)||bookShiftCode(row.shift_name)||bookShiftCode(row.batch_shift)
 :bookShiftCode(row.card_shift)||bookShiftCode(row.batch_shift)||bookShiftCode(row.book_shift)||bookShiftCode(row.shift_name);

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
// Sites the owner removed from this dashboard (11 Nov 2026). They no longer show as empty rows;
// if cards are saved for one in the selected dates it comes back, so no saved card is ever hidden.
export const DASHBOARD_REMOVED_SITES=new Set(['Lalpeth OC'].map(site=>canonicalSiteName(site)));
export function summarizeLogBooks({rows,sites,from,to,location='',draftCount=0,kinds=['vehicle','equipment']}){
 // A master record with no real site ("-" or blank) is not a site: it must not show as an empty row.
 const names=new Map(sites.filter(site=>canonicalSiteName(site)&&!DASHBOARD_REMOVED_SITES.has(canonicalSiteName(site))).map(site=>[canonicalSiteName(site),displaySiteName(site)]));
 for(const row of rows)names.set(canonicalSiteName(row.site),displaySiteName(row.site));
 const allSites=[...names.values()].sort((a,b)=>a.localeCompare(b));
 const selected=canonicalSiteName(location),siteRows=allSites.filter(site=>!selected||canonicalSiteName(site)===selected).map(site=>({site,vehicle:0,equipment:0}));
 const bySite=new Map(siteRows.map(row=>[canonicalSiteName(row.site),row])),days=new Map();
 for(let day=new Date(from+'T00:00:00Z');day<=new Date(to+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+1)){const date=day.toISOString().slice(0,10);days.set(date,{date,vehicle:0,equipment:0});}
 for(const row of rows){if(!kinds.includes(row.book_type)||!days.has(row.day))continue;const target=bySite.get(canonicalSiteName(row.site));if(!target)continue;target[row.book_type]+=Number(row.count);days.get(row.day)[row.book_type]+=Number(row.count);}
 return {from,to,sites:allSites,kinds,bySite:siteRows,trend:[...days.values()],totals:{vehicle:siteRows.reduce((sum,r)=>sum+r.vehicle,0),equipment:siteRows.reduce((sum,r)=>sum+r.equipment,0),activeSites:siteRows.filter(r=>r.vehicle+r.equipment>0).length,recoveryDrafts:draftCount}};
}
export function registerLogBookDashboard(app,{pool,protect,ensureBooks,now=()=>Date.now()}){
 const handle=fn=>async(req,res,next)=>{try{await ensureBooks();res.set('Cache-Control','no-store');await fn(req,res)}catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}};
 const context=async req=>{
  // With hours (6, 12 or 24) the time of the save decides, so every operational card date is read.
  const hours=recentWindow(req.query.hours);
  const filters=dashboardFilters(hours?{...req.query,from:OPERATIONAL_START,to:''}:req.query);if(filters.location)requireLogBookSite(req.logBookScope,filters.location);
  let permitted=await filterLogBookSites(pool,req.logBookScope);
  if(filters.location){const rows=(await pool.query('SELECT DISTINCT site FROM mis_log_books')).rows;permitted=rows.map(r=>r.site).filter(site=>siteAllowed(req.logBookScope,site)&&canonicalSiteName(site)===canonicalSiteName(filters.location));}
  const kinds=['vehicle','equipment'].filter(kind=>!req.session.permissions?.separateMisCredentials||misPageAllowed(req.session,kind==='vehicle'?'Vehicle Log Book':'Equipment Log Book'));
  return {filters,kinds,hours,params:[filters.from,filters.to,permitted,kinds,filters.shift]};
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
 // Completed in the last 6, 12 and 24 hours: cards by the time they were saved, shifts and whole batches by the time they were locked.
 app.get('/api/dashboard/log-books/recent',...protect,handle(async(req,res)=>{
  const kinds=['vehicle','equipment'].filter(kind=>!req.session.permissions?.separateMisCredentials||misPageAllowed(req.session,kind==='vehicle'?'Vehicle Log Book':'Equipment Log Book'));
  const current=now(),since=hours=>new Date(current-hours*3600000).toISOString(),allowed=row=>siteAllowed(req.logBookScope,row.site);
  // 6, 12 and 24 hours, and with ?hours= one more window of the user's own choice (whole hours, 1 to 24).
  const windows=recentWindows(req.query.hours),widest=Math.max(...windows);
  // Counted by site, book and also card date and shift, so that a site opens into its shifts. One count for each window:
  // the windows are whole numbers checked above, and their times go in as parameters $1, $2, ...
  const counts=windows.map((hours,index)=>`count(*) FILTER (WHERE created_at>=$${index+1}::timestamptz)::int AS h${hours}`).join(',');
  const p=windows.length;
  const cards=(await pool.query(`SELECT CASE WHEN book_type='lmv' THEN COALESCE(NULLIF(data->>'location',''),site) ELSE site END AS site,book_type,book_date::text AS date,
   COALESCE(data->>'bookShiftCode','') AS book_shift,COALESCE(data->>'cardShift','') AS card_shift,COALESCE(data->>'batchShift','') AS batch_shift,COALESCE(data->>'shiftName','') AS shift_name,
   ${counts}
   FROM mis_log_books WHERE deleted_at IS NULL AND book_date>=$${p+1}::date AND created_at>=$${p+2}::timestamptz AND book_type=ANY($${p+3}::text[]) GROUP BY 1,2,3,4,5,6,7`,
   [...windows.map(since),OPERATIONAL_START,since(widest),['vehicle','lmv','equipment']])).rows.filter(allowed)
   .map(row=>({site:row.site,book_type:row.book_type,date:row.date,shift:savedCardShift(row),...Object.fromEntries(windows.map(hours=>['h'+hours,row['h'+hours]]))}));
  // Every site this login may see that works in batches, so that a site which locked nothing can be named.
  const batchSites=(await pool.query(`SELECT DISTINCT site FROM mis_vlb_batches WHERE deleted_at IS NULL AND archived_at IS NULL AND book_date>=$1::date`,[OPERATIONAL_START])).rows
   .filter(allowed).map(row=>row.site);
  // With each batch: the trip cards and the ELB cards saved in it (the same counts as the Batch Status report).
  // created_at is the batch start: with the lock times it gives the batch start to close time and its VLB, LMV and ELB parts.
  const batches=(await pool.query(`SELECT b.id,b.name,b.site,b.book_date::text AS date,b.shift,b.created_at,COALESCE(b.creator_login,b.created_by,'') AS created_by,b.vlb_locked_at,b.lmv_locked_at,b.closed_at,
   (SELECT count(*)::int FROM mis_vlb_batch_entries e JOIN mis_log_books l ON l.id=e.logbook_id AND l.deleted_at IS NULL WHERE e.batch_id=b.id) AS cards,
   (SELECT count(*)::int FROM mis_vlb_batch_fleet f JOIN mis_log_books l ON l.id=f.logbook_id AND l.deleted_at IS NULL WHERE f.batch_id=b.id) AS machines_saved
   FROM mis_vlb_batches b WHERE b.deleted_at IS NULL AND b.archived_at IS NULL AND b.book_date>=$2::date AND (b.vlb_locked_at>=$1::timestamptz OR b.lmv_locked_at>=$1::timestamptz OR b.closed_at>=$1::timestamptz)
   ORDER BY b.book_date,b.id LIMIT 5000`,[since(widest),OPERATIONAL_START])).rows.filter(allowed);
  // Who saved and locked each batch: the lock is recorded in the batch history at the same moment (index on occurred_at).
  // Who started it is on the batch itself. Both are shown by name where Users & employees has one.
  const closedBatches=batches.filter(batch=>batch.closed_at);
  if(closedBatches.length){
   const lockers=new Map((await pool.query(`SELECT batch_id::text AS batch_id,actor FROM mis_vlb_batch_audit WHERE occurred_at>=$1::timestamptz AND action='saved_and_locked' ORDER BY occurred_at,id LIMIT 20000`,
    [since(widest)])).rows.map(row=>[row.batch_id,String(row.actor||'').trim()]));
   const starter=batch=>String(batch.created_by||'').trim();
   const logins=[...new Set([...lockers.values(),...closedBatches.map(starter)].map(actor=>actor.toLowerCase()).filter(Boolean))];
   const names=logins.length?new Map((await pool.query(`SELECT lower(trim(record_data->>'login')) AS login,
    COALESCE(NULLIF(trim(record_data->>'employee'),''),NULLIF(trim(record_data->>'name'),'')) AS name
    FROM master_records WHERE master_name='Users & employees' AND lower(trim(record_data->>'login'))=ANY($1::text[])`,[logins])).rows.filter(row=>row.name).map(row=>[row.login,row.name])):new Map();
   const named=actor=>names.get(actor.toLowerCase())||actor;
   for(const batch of closedBatches){batch.locked_by=named(lockers.get(String(batch.id))||'');batch.started_by=named(starter(batch));}
  }
  // LMV log books are kept by site, date and shift, not by batch: read for the dates of these batches only.
  const dates=[...new Set(batches.map(batch=>batch.date))];
  const lmvBooks=kinds.includes('vehicle')&&dates.length?(await pool.query(`SELECT COALESCE(NULLIF(data->>'location',''),site) AS site,book_date::text AS date,
   COALESCE(data->>'bookShiftCode','') AS book_shift,COALESCE(data->>'cardShift','') AS card_shift,COALESCE(data->>'shiftName','') AS shift_name,count(*)::int AS count
   FROM mis_log_books WHERE book_type='lmv' AND deleted_at IS NULL AND book_date=ANY($1::date[]) GROUP BY 1,2,3,4,5`,[dates])).rows
   .map(row=>({site:row.site,date:row.date,shift:vlbRecordShift({bookShiftCode:row.book_shift,cardShift:row.card_shift,shiftName:row.shift_name}),count:row.count})):[];
  res.json(buildRecentActivity({now:current,cards,batches,lmvBooks,kinds,windows,batchSites}));
 }));
 app.get('/api/dashboard/log-books/records',...protect,handle(async(req,res)=>{
  const {filters,kinds,hours,params}=await context(req),kind=String(req.query.kind||'');
  if(!kinds.includes(kind))return res.status(403).json({error:'This logbook type is not available to your login.'});
  const before=String(req.query.before||'');if(before&&!/^\d+$/.test(before))return res.status(400).json({error:'Invalid page cursor.'});
  const rows=(await pool.query(`SELECT id,book_no,book_type,book_date::text AS day,site,data->>'door' AS door,data->>'cardShift' AS shift FROM mis_log_books WHERE ${where} AND book_type=$6 AND ($7::bigint IS NULL OR id<$7::bigint)${hours?' AND created_at>=$8::timestamptz':''} ORDER BY id DESC LIMIT 101`,[...params,kind,before||null,...(hours?[new Date(now()-hours*3600000).toISOString()]:[])])).rows.filter(row=>!filters.location||canonicalSiteName(row.site)===canonicalSiteName(filters.location));
  res.json({records:rows.slice(0,100),nextCursor:rows.length>100?String(rows[99].id):null});
 }));
}
