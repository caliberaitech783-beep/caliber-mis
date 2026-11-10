import {canonicalSiteName} from '../../shared/site-location.mjs';
import {manpowerFilters,buildManpowerReport,otHistoryWindows,otHistorySummary,otYearWindows,otDriverTally,OT_HISTORY_DAYS} from '../rules/manpower-report.mjs';
import {siteAllowed,filterLogBookSites,requireLogBookSite} from '../../shared/log-book-access.mjs';

const HISTORY_CARD_FIELDS=['bookDate','location','bookShiftCode','cardShift','shiftName','shiftId','masterShiftStart','door','assetId','employeeId','caliberId','employeeName','openingHmr','closingHmr','openingKmr','closingKmr','completedTrips','totalTrips','scanBatchId','scanCardId'];
const todayIst=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
// Slim read for OT look-backs: only the card fields that decide a duty, from all three log books.
async function slimCards(client,range,sites){
 const {rows}=await client.query(`SELECT l.id,l.book_no,l.book_type,l.book_date::text,l.site,l.asset_id,
  (SELECT COALESCE(jsonb_object_agg(field.key,field.value),'{}'::jsonb) FROM jsonb_each(l.data) AS field WHERE field.key=ANY($4::text[])) AS data,
  '[]'::jsonb AS batches
  FROM mis_log_books l WHERE l.book_type IN ('vehicle','equipment','lmv') AND l.deleted_at IS NULL AND l.book_date>=$$2026-11-01$$
  AND l.book_date BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR l.site=ANY($3::text[]))
  ORDER BY l.book_date,l.id LIMIT 50001`,[range.contextFrom,range.contextTo,sites,HISTORY_CARD_FIELDS]);
 if(rows.length>50000)throw Object.assign(new Error('Earlier duty history is too large to read for this selection. Open one site and try again.'),{status:400});
 return rows;
}
const MASTER_NAMES=['Equipment master','Shift Master','Employee master','ERP Employee master','C-Dir Employee master','Users & employees'];
async function reportMasters(client){
 const masters=(await client.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY id",[MASTER_NAMES])).rows;
 const fromMaster=names=>masters.filter(r=>names.includes(r.master_name)).map(r=>({...r.record_data,id:String(r.id)}));
 return {assets:fromMaster(['Equipment master']),employees:fromMaster(MASTER_NAMES.slice(2)),shifts:fromMaster(['Shift Master'])};
}

export function registerManpowerReports(app,{pool,protect,ensureBooks,withHandovers=async(_,rows)=>rows,today=todayIst}){
 app.get('/api/reports/manpower',...protect,async(req,res,next)=>{
  let client;
  try{
   const filters=manpowerFilters(req.query);
   if(filters.site)requireLogBookSite(req.logBookScope,filters.site);
   await ensureBooks();client=await pool.connect();
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   let sites=await filterLogBookSites(client,req.logBookScope);
   if(filters.site){if(sites===null)sites=(await client.query('SELECT DISTINCT site FROM mis_log_books WHERE book_date BETWEEN $1 AND $2',[filters.contextFrom,filters.contextTo])).rows.map(r=>r.site);sites=sites.filter(site=>canonicalSiteName(site)===canonicalSiteName(filters.site));}
   const {rows}=await client.query(`SELECT l.id,l.book_no,l.book_type,l.book_date::text,l.site,l.asset_id,
    l.data-'manualAttachments' AS data,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'closed_at',b.closed_at))
     FROM mis_vlb_batch_entries e JOIN mis_vlb_batches b ON b.id=e.batch_id
     WHERE e.logbook_id=l.id AND b.archived_at IS NULL AND b.deleted_at IS NULL),'[]'::jsonb) AS batches
    FROM mis_log_books l WHERE l.book_type IN ('vehicle','equipment','lmv') AND l.deleted_at IS NULL AND l.book_date>=$$2026-11-01$$
    AND l.book_date BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR l.site=ANY($3::text[]))
    ORDER BY l.book_date,l.id LIMIT 50001`,[filters.contextFrom,filters.contextTo,sites]);
   if(rows.length>50000)throw Object.assign(new Error('This range contains too many saved cards. Select a shorter date range.'),{status:400});
   const visible=rows.filter(r=>siteAllowed(req.logBookScope,r.site));
   const {rows:attendance}=await client.query(`SELECT book_date::text AS date,site,shift,employee_id,asset_id,reason,remarks
    FROM mis_shift_attendance WHERE book_date BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR site=ANY($3::text[]))
    ORDER BY book_date,site,shift,employee_id LIMIT 50001`,
   [filters.from,filters.to,filters.site?[canonicalSiteName(filters.site)]:req.logBookScope.sites]);
   if(attendance.length>50000)throw Object.assign(new Error('This range contains too many attendance entries. Select a shorter date range.'),{status:400});
   const linked=await withHandovers(client,visible.filter(r=>r.book_type==='vehicle'),sites);
   const masters=(await client.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY id",[['Equipment master','Shift Master','Employee master','ERP Employee master','C-Dir Employee master','Users & employees']])).rows;
   const fromMaster=names=>masters.filter(r=>names.includes(r.master_name)).map(r=>({...r.record_data,id:String(r.id)}));
   const batches=(await client.query(`SELECT id,name,site,book_date::text AS report_date,closed_at,shift,stage FROM mis_vlb_batches
    WHERE deleted_at IS NULL AND archived_at IS NULL AND book_date BETWEEN $1 AND $2`,[filters.from,filters.to])).rows.filter(b=>siteAllowed(req.logBookScope,b.site));
   const report=buildManpowerReport({records:[...linked,...visible.filter(r=>r.book_type!=='vehicle')],attendance:attendance.filter(r=>siteAllowed(req.logBookScope,r.site)),assets:fromMaster(['Equipment master']),employees:fromMaster(['Employee master','ERP Employee master','C-Dir Employee master','Users & employees']),shifts:fromMaster(['Shift Master']),batches,filters});
   await client.query('COMMIT');
   const fleetSites=new Set(report.otSites.filter(s=>siteAllowed(req.logBookScope,s.site)).map(s=>s.siteKey));
   res.set('Cache-Control','private, no-store').json({...report,fleet:report.fleet.filter(m=>fleetSites.has(m.siteKey)),fleetWork:report.fleetWork.filter(w=>fleetSites.has(w.siteKey)),otSites:report.otSites.filter(s=>siteAllowed(req.logBookScope,s.site)),attendanceSites:report.attendanceSites.filter(s=>siteAllowed(req.logBookScope,s.site)),attendanceShifts:report.attendanceShifts.filter(s=>siteAllowed(req.logBookScope,s.siteKey)),generatedAt:new Date().toISOString()});
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});if(error.status)return res.status(error.status).json({error:error.message});next(error);}
  finally{client?.release();}
 });
 // Earlier red / orange repeats per driver, read only when someone asks for them.
 // Only the card fields that decide a duty are read, one week at a time, from all three log books.
 app.get('/api/reports/manpower/ot-history',...protect,async(req,res,next)=>{
  let client;
  try{
   const filters=manpowerFilters(req.query),windows=otHistoryWindows(filters.from);
   if(filters.site)requireLogBookSite(req.logBookScope,filters.site);
   const period={historyFrom:windows[0]?.from||null,historyTo:windows.at(-1)?.to||null,historyDays:OT_HISTORY_DAYS};
   if(!windows.length)return res.set('Cache-Control','private, no-store').json({...period,drivers:[]});
   await ensureBooks();client=await pool.connect();
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   let sites=await filterLogBookSites(client,req.logBookScope);
   if(filters.site){if(sites===null)sites=(await client.query('SELECT DISTINCT site FROM mis_log_books WHERE book_date BETWEEN $1 AND $2',[period.historyFrom,filters.from])).rows.map(r=>r.site);sites=sites.filter(site=>canonicalSiteName(site)===canonicalSiteName(filters.site));}
   const masters=await reportMasters(client),events=[];
   for(const window of windows){
    const range=manpowerFilters({...window,site:filters.site}),rows=await slimCards(client,range,sites);
    events.push(...buildManpowerReport({records:rows.filter(r=>siteAllowed(req.logBookScope,r.site)),...masters,filters:range}).ot);
   }
   await client.query('COMMIT');
   res.set('Cache-Control','private, no-store').json({...period,drivers:otHistorySummary(events,filters.from)});
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});if(error.status)return res.status(error.status).json({error:error.message});next(error);}
  finally{client?.release();}
 });
 // OT counts per driver for the month and the calendar year of the report's To date, with each driver's
 // flagged duties for that year. One site at a time, one month per read, no long transaction.
 app.get('/api/reports/manpower/ot-drivers',...protect,async(req,res,next)=>{
  let client;
  try{
   const site=typeof req.query.site==='string'?req.query.site.trim():'',range=typeof req.query.to==='string'?otYearWindows(req.query.to,today()):null;
   if(!range||!site||site.length>200)return res.status(400).json({error:'Open a site and choose a valid date to see month and year OT counts.'});
   requireLogBookSite(req.logBookScope,site);
   const {windows,...period}=range;
   if(!windows.length)return res.set('Cache-Control','private, no-store').json({...period,drivers:[]});
   await ensureBooks();client=await pool.connect();
   let sites=await filterLogBookSites(client,req.logBookScope);
   if(sites===null)sites=(await client.query('SELECT DISTINCT site FROM mis_log_books WHERE book_date BETWEEN $1 AND $2',[period.yearFrom,period.yearTo])).rows.map(r=>r.site);
   sites=sites.filter(name=>canonicalSiteName(name)===canonicalSiteName(site));
   const masters=await reportMasters(client),events=[],duties=[];
   for(const window of windows){
    const filters=manpowerFilters({...window,site}),rows=await slimCards(client,filters,sites);
    const report=buildManpowerReport({records:rows.filter(r=>siteAllowed(req.logBookScope,r.site)),...masters,filters});
    events.push(...report.ot);
    // Actual duties from the same read: one per driver, date and shift, on saved VLB and ELB cards.
    for(const r of report.attendanceEquipment)if(r.actual)duties.push({employeeKey:r.employeeKey,siteKey:r.siteKey,date:r.date});
   }
   res.set('Cache-Control','private, no-store').json({...period,drivers:otDriverTally(events,period,duties)});
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
  finally{client?.release();}
 });
}
