import {canonicalSiteName} from '../../shared/site-location.mjs';
import {manpowerFilters,buildManpowerReport,attendanceWindows,joinOtReports,joinManpowerReports,MANPOWER_VIEWS,lockedSiteDays,nextReportDate,otHistoryWindows,otHistorySummary,otYearWindows,otDriverTally,OT_HISTORY_DAYS} from '../rules/manpower-report.mjs';
import {siteAllowed,requireLogBookSite} from '../../shared/log-book-access.mjs';
import {sharedLogBookSites} from '../services/log-book-site-list.mjs';
import {directLane,reportKey} from '../services/report-lane.mjs';
import {buildReportInWorker} from '../services/report-build-pool.mjs';
import {requireHrAttendance} from './hr-attendance-access.mjs';
import {readHrAbsences} from './hr-attendance-change.mjs';
import {createAttendancePunches,punchKeysBetween} from '../services/attendance-punches.mjs';
import {createHrEmployeeSync} from '../services/hr-employee-sync.mjs';
import {attendanceAnswerCache,fingerprint,ATTENDANCE_WEEK_KEEP_MS,ATTENDANCE_RECENT_KEEP_MS} from '../services/attendance-answer-cache.mjs';
import {HISTORY_CARD_FIELDS,ATTENDANCE_CARD_FIELDS,ATTENDANCE_BATCH_COLUMNS,attendanceDayStoreEnabled,cardSignatures,lockedDayCards,lockedSignedDays,dayCardBatchesText} from '../services/attendance-day-store.mjs';

const todayIst=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
// Slim read for OT look-backs: only the card fields that decide a duty, from all three log books.
// withBatches adds each card's batches (for the Source batches column and the batch filter).
const CARD_BATCHES=`COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'closed_at',b.closed_at))
     FROM mis_vlb_batch_entries e JOIN mis_vlb_batches b ON b.id=e.batch_id
     WHERE e.logbook_id=l.id AND b.archived_at IS NULL AND b.deleted_at IS NULL),'[]'::jsonb)`;
async function slimCards(client,range,sites,fields=HISTORY_CARD_FIELDS,{withBatches=false,tooLarge='Earlier duty history is too large to read for this selection. Open one site and try again.'}={}){
 const {rows}=await client.query(`SELECT l.id,l.book_no,l.book_type,l.book_date::text,l.site,l.asset_id,
  (SELECT COALESCE(jsonb_object_agg(field.key,field.value),'{}'::jsonb) FROM jsonb_each(l.data) AS field WHERE field.key=ANY($4::text[])) AS data,
  ${withBatches?CARD_BATCHES:"'[]'::jsonb"} AS batches
  FROM mis_log_books l WHERE l.book_type IN ('vehicle','equipment','lmv') AND l.deleted_at IS NULL AND l.book_date>=$$2026-11-01$$
  AND l.book_date BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR l.site=ANY($3::text[]))
  ORDER BY l.book_date,l.id LIMIT 50001`,[range.contextFrom,range.contextTo,sites,fields]);
 if(rows.length>50000)throw Object.assign(new Error(tooLarge),{status:400});
 return rows;
}
// The full report also shows a card's remark (Manpower by Category list).
const REPORT_CARD_FIELDS=[...ATTENDANCE_CARD_FIELDS,'remark'];
const MASTER_NAMES=['Equipment master','Shift Master','Employee master','ERP Employee master','C-Dir Employee master','Users & employees'];
export async function reportMasters(client){
 const masters=(await client.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY id",[MASTER_NAMES])).rows;
 const fromMaster=names=>masters.filter(r=>names.includes(r.master_name)).map(r=>({...r.record_data,id:String(r.id)}));
 // sourceMaster: Employee Master decides an ambiguous ID before the other lists (identityIndex in the report rules).
 const employees=masters.filter(r=>MASTER_NAMES.slice(2).includes(r.master_name)).map(r=>({...r.record_data,id:String(r.id),sourceMaster:r.master_name}));
 return {assets:fromMaster(['Equipment master']),employees,shifts:fromMaster(['Shift Master'])};
}
// The same masters as one JSON text for a report worker, built by Postgres (24 Nov 2026): the Employee master alone is about
// 21,000 lines, and unpacking it on every attendance read held the main thread. Each line is its record with id = the row
// id as text, as reportMasters gives it. The Shift Master is also read as rows: the main thread needs it for the locked days.
const MASTER_LINES=`COALESCE(json_agg(record_data||jsonb_build_object('id',id::text) ORDER BY id) FILTER (WHERE master_name=ANY($1::text[])),'[]'::json)`;
// Employee lines also name their list (sourceMaster), as in reportMasters: the report rules let Employee Master decide an ambiguous ID.
const EMPLOYEE_LINES=`COALESCE(json_agg(record_data||jsonb_build_object('id',id::text,'sourceMaster',master_name) ORDER BY id) FILTER (WHERE master_name=ANY($1::text[])),'[]'::json)`;
export async function reportMastersText(client){
 const {rows:[row]}=await client.query(`SELECT json_build_object('assets',${MASTER_LINES.replace('$1','$2')},'employees',${EMPLOYEE_LINES.replace('$1','$3')},'shifts',${MASTER_LINES.replace('$1','$4')})::text AS masters
  FROM master_records WHERE master_name=ANY($1::text[])`,[MASTER_NAMES,['Equipment master'],MASTER_NAMES.slice(2),['Shift Master']]);
 const shifts=(await client.query("SELECT id,record_data FROM master_records WHERE master_name='Shift Master' ORDER BY id")).rows.map(r=>({...r.record_data,id:String(r.id)}));
 return {shifts,mastersJson:row?.masters||'{"assets":[],"employees":[],"shifts":[]}'};
}

// readPunches: ({from,to}) => who punched the biometric machine ("number|siteKey|date"; server/services/attendance-punches.mjs).
// A card left out for an ID mix-up counts when its Caliber ID punched (owner, 24 Nov 2026, "Card + punch").
export function registerManpowerReports(app,{pool,protect,ensureBooks,withHandovers=async(_,rows)=>rows,today=todayIst,lane=directLane,useDayStore=attendanceDayStoreEnabled(),buildInWorker=buildReportInWorker,answerCache=attendanceAnswerCache,readPunches=createAttendancePunches({pool,hrPunches:createHrEmployeeSync({pool}).biometricPunches})}){
 // The server's one list of sites that hold cards (server/services/log-book-site-list.mjs).
 const filterLogBookSites=sharedLogBookSites(pool);
 app.get('/api/reports/manpower',...protect,async(req,res,next)=>{
  try{
   const filters=manpowerFilters(req.query);
   if(filters.site)requireLogBookSite(req.logBookScope,filters.site);
   await ensureBooks();
   // The Category card list is one day's cards, read when a date is opened; a longer list is the old 38 MB read.
   if(req.query.view==='category-cards'&&filters.from!==filters.to)return res.status(400).json({error:'The saved card list is read one day at a time. Open a date first.'});
   if(req.query.view==='ot'||Object.hasOwn(MANPOWER_VIEWS,req.query.view))return res.set('Cache-Control','private, no-store').json(await readWeeks(req,filters,req.query.view));
   const body=await lane.run(reportKey('manpower',req),async()=>{
   let client;
   try{
   client=await pool.connect();
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
   // What HR Pulse marked absent with an OTP: the card stays, its attendance is not counted (shared/hr-attendance-change.mjs).
   const hrChanges=(await readHrAbsences(client,{from:filters.contextFrom,to:filters.contextTo})).filter(c=>siteAllowed(req.logBookScope,c.siteKey));
   const masters=(await client.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY id",[['Equipment master','Shift Master','Employee master','ERP Employee master','C-Dir Employee master','Users & employees']])).rows;
   const fromMaster=names=>masters.filter(r=>names.includes(r.master_name)).map(r=>({...r.record_data,id:String(r.id)}));
   const batches=(await client.query(`SELECT id,name,site,book_date::text AS report_date,closed_at,shift,stage FROM mis_vlb_batches
    WHERE deleted_at IS NULL AND archived_at IS NULL AND book_date BETWEEN $1 AND $2`,[filters.from,filters.to])).rows.filter(b=>siteAllowed(req.logBookScope,b.site));
   await client.query('COMMIT');
   // The connection goes back to the pool before the report is put together.
   client.release();client=null;
   const report=buildManpowerReport({records:[...linked,...visible.filter(r=>r.book_type!=='vehicle')],attendance:attendance.filter(r=>siteAllowed(req.logBookScope,r.site)),assets:fromMaster(['Equipment master']),employees:fromMaster(['Employee master','ERP Employee master','C-Dir Employee master','Users & employees']),shifts:fromMaster(['Shift Master']),batches,filters,hrChanges});
   const fleetSites=new Set(report.otSites.filter(s=>siteAllowed(req.logBookScope,s.site)).map(s=>s.siteKey));
   return {...report,fleet:report.fleet.filter(m=>fleetSites.has(m.siteKey)),fleetWork:report.fleetWork.filter(w=>fleetSites.has(w.siteKey)),otSites:report.otSites.filter(s=>siteAllowed(req.logBookScope,s.site)),attendanceSites:report.attendanceSites.filter(s=>siteAllowed(req.logBookScope,s.site)),attendanceShifts:report.attendanceShifts.filter(s=>siteAllowed(req.logBookScope,s.siteKey)),generatedAt:new Date().toISOString()};
   }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});throw error;}
   finally{client?.release();}
   });
   res.set('Cache-Control','private, no-store').json(body);
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
 });
 // OT & Multiple Duties (its tab and dashboard Sr 5), Manpower by Category, its Reconciliation, Shift Performance and Shift
 // Attendance Equipment Wise: one week of cards at a time from one snapshot, each week with its adjoining days, so a month of
 // every site stays under the card read limit. Only the card fields the report uses are read, with each card's batches.
 // Every saved card counts, as before; open batches are not left out here. Trip counts come from each card's own trip rows.
 const readWeeks=(req,filters,view)=>lane.run(reportKey(view==='ot'?'manpower-ot':'manpower-'+view,req),async()=>{
  let client;
  try{
   client=await pool.connect();
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   let sites=await filterLogBookSites(client,req.logBookScope);
   if(filters.site){if(sites===null)sites=(await client.query('SELECT DISTINCT site FROM mis_log_books WHERE book_date BETWEEN $1 AND $2',[filters.contextFrom,filters.contextTo])).rows.map(r=>r.site);sites=sites.filter(site=>canonicalSiteName(site)===canonicalSiteName(filters.site));}
   const {rows:attendance}=await client.query(`SELECT book_date::text AS date,site,shift,employee_id,asset_id,reason,remarks
    FROM mis_shift_attendance WHERE book_date BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR site=ANY($3::text[]))
    ORDER BY book_date,site,shift,employee_id LIMIT 50001`,
   [filters.from,filters.to,filters.site?[canonicalSiteName(filters.site)]:req.logBookScope.sites]);
   if(attendance.length>50000)throw Object.assign(new Error('This range contains too many attendance entries. Select a shorter date range.'),{status:400});
   const masters=await reportMasters(client);
   const hrAbsent=(await readHrAbsences(client,{from:filters.contextFrom,to:filters.contextTo})).filter(c=>siteAllowed(req.logBookScope,c.siteKey));
   const batches=(await client.query(`SELECT id,name,site,book_date::text AS report_date,closed_at,shift,stage FROM mis_vlb_batches
    WHERE deleted_at IS NULL AND archived_at IS NULL AND book_date BETWEEN $1 AND $2`,[filters.from,filters.to])).rows.filter(b=>siteAllowed(req.logBookScope,b.site));
   const present=attendance.filter(r=>siteAllowed(req.logBookScope,r.site)),parts=[],mastersJson=JSON.stringify(masters);
   for(const window of attendanceWindows(filters.from,filters.to)){
    const range=manpowerFilters({...filters,...window}),rows=(await slimCards(client,range,sites,view==='ot'?ATTENDANCE_CARD_FIELDS:REPORT_CARD_FIELDS,{withBatches:true,tooLarge:'One week of saved cards is too large to read. Open one site and try again.'})).filter(r=>siteAllowed(req.logBookScope,r.site));
    // The week is built on a worker thread (buildManpowerWeek), so card saving is not frozen while a month is read;
    // the cards and masters go over as JSON text, the cheapest hand-over for the main thread.
    parts.push({window,report:await buildInWorker('manpower-week',{rowsJson:JSON.stringify(rows),attendance:present.filter(r=>r.date>=window.from&&r.date<=window.to),mastersJson,batches,filters:range,view,hrChanges:hrAbsent.filter(c=>c.date>=range.contextFrom&&c.date<=range.contextTo)})});
   }
   await client.query('COMMIT');
   client.release();client=null;
   if(view!=='ot'){
    // The Category counts of every card are worked out on the worker too (about 1.3 s for a month of every site).
    const cells=MANPOWER_VIEWS[view].includes('cells')?await buildInWorker('manpower-cells',JSON.stringify(parts.flatMap(({report})=>report.details))):undefined;
    const report=joinManpowerReports(parts,filters,view,{cells}),fleetSites=new Set(report.otSites.filter(s=>siteAllowed(req.logBookScope,s.site)).map(s=>s.siteKey));
    return {...report,...(report.fleet?{fleet:report.fleet.filter(m=>fleetSites.has(m.siteKey)),fleetWork:report.fleetWork.filter(w=>fleetSites.has(w.siteKey))}:{}),
     ...(report.attendanceShifts?{attendanceShifts:report.attendanceShifts.filter(s=>siteAllowed(req.logBookScope,s.siteKey))}:{}),
     otSites:report.otSites.filter(s=>siteAllowed(req.logBookScope,s.site)),attendanceSites:report.attendanceSites.filter(s=>siteAllowed(req.logBookScope,s.site)),generatedAt:new Date().toISOString()};
   }
   const report=joinOtReports(parts,filters);
   return {...report,otSites:report.otSites.filter(s=>siteAllowed(req.logBookScope,s.site)),attendanceSites:report.attendanceSites.filter(s=>siteAllowed(req.logBookScope,s.site)),attendanceShifts:report.attendanceShifts.filter(s=>siteAllowed(req.logBookScope,s.siteKey)),generatedAt:new Date().toISOString()};
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client?.release();}
 });
 // Attendance Batch-wise and Month-wise: the same duties as the full report, without the card data, batch list per card,
 // trip-handover links and tables those two screens never show. Trip counts come from each card's own trip rows, as in
 // the full report; handover links between cards do not change them.
 const readAttendance=hr=>async(req,res,next)=>{
  try{
   const filters=manpowerFilters({from:req.query.from,to:req.query.to});
   // HR Pulse asks only=days to check its saved days against the signatures (shared/hr-attendance-change.mjs).
   const only=hr&&req.query.only==='days'?'days':'';
   await ensureBooks();
   const body=await lane.run(reportKey(hr?'hr-attendance':'manpower-attendance',req),async()=>{
   let client,building=null;
   try{
   // Who punched (machine and imported), read once for the whole range before a database connection is held (HR Pulse
   // is waited for at most a few seconds); a failed read counts no punch.
   const punched=await readPunches({from:filters.contextFrom,to:filters.contextTo}).catch(()=>[]);
   client=await pool.connect();
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const sites=await filterLogBookSites(client,req.logBookScope);
   const {rows:attendance}=await client.query(`SELECT book_date::text AS date,site,shift,employee_id,asset_id,reason,remarks
    FROM mis_shift_attendance WHERE book_date BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR site=ANY($3::text[]))
    ORDER BY book_date,site,shift,employee_id LIMIT 50001`,[filters.from,filters.to,req.logBookScope.sites]);
   if(attendance.length>50000)throw Object.assign(new Error('This range contains too many attendance entries. Select a shorter date range.'),{status:400});
   const {shifts,mastersJson}=await reportMastersText(client);
   const batches=(await client.query(`SELECT ${ATTENDANCE_BATCH_COLUMNS} FROM mis_vlb_batches
    WHERE deleted_at IS NULL AND archived_at IS NULL AND book_date BETWEEN $1 AND $2`,[filters.contextFrom,filters.contextTo])).rows.filter(b=>siteAllowed(req.logBookScope,b.site));
   const present=attendance.filter(r=>siteAllowed(req.logBookScope,r.site)),scope={sites:req.logBookScope?.sites};
   // What HR Pulse marked absent with an OTP; a change makes a new key, so no kept week or answer outlives it.
   const hrAbsent=(await readHrAbsences(client,{from:filters.contextFrom,to:filters.contextTo})).filter(c=>siteAllowed(req.logBookScope,c.siteKey));
   // Only locked site-days are read (the rest is left out of the report anyway): from the stored locked days where a
   // stored day still matches its cards and batches, the rest live. See server/services/attendance-day-store.mjs.
   const locked=lockedSiteDays(shifts,batches),signatures=await cardSignatures(client,{from:filters.contextFrom,to:filters.contextTo},sites,batches);
   // One week of cards at a time from the same snapshot (each with its adjoining days), so a month of every site
   // neither reaches the card read limit nor sits in memory at once. Every week sees the whole range's batches,
   // so a site is listed in each week even when it saved nothing in that week.
   // 24 Nov 2026: the cards come as JSON text and each week is built on a report worker (server/rules/attendance-read.mjs)
   // while the next week is read; the main thread no longer unpacks or builds anything.
   // Repeat opens (server/services/attendance-answer-cache.mjs): each week gets a key from everything it is built from,
   // and the answer a key from its weeks. An unchanged answer is sent at once; an unchanged week that ended at least two
   // days ago is not read or built again.
   const mastersKey=fingerprint(mastersJson),siteNames=[...new Set(batches.map(b=>b.site))],keepBefore=nextReportDate(today(),-1);
   const plans=attendanceWindows(filters.from,filters.to).map(window=>{const range=manpowerFilters(window);
    return {window,range,days:lockedSignedDays(signatures,{from:range.contextFrom,to:range.contextTo},locked),attendance:present.filter(r=>r.date>=window.from&&r.date<=window.to),punched:punchKeysBetween(punched,range.contextFrom,range.contextTo),hrChanges:hrAbsent.filter(c=>c.date>=range.contextFrom&&c.date<=range.contextTo),kept:Boolean(answerCache)&&window.to<keepBefore};});
   for(const plan of plans){
    plan.linksJson=hr?null:await dayCardBatchesText(client,plan.days);
    const weekBatches=batches.filter(b=>b.report_date>=plan.range.contextFrom&&b.report_date<=plan.range.contextTo).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    plan.key=fingerprint('attendance-week',hr,scope.sites??null,plan.range,mastersKey,siteNames,weekBatches,plan.days.map(d=>[d.site,d.date,d.signature]),plan.linksJson,plan.attendance,plan.punched,plan.hrChanges);
   }
   const answerKey=fingerprint('attendance-answer',hr,scope.sites??null,filters,plans.map(p=>p.key),[...locked].sort(),only);
   const ready=answerCache?.get(answerKey);
   if(ready){await client.query('COMMIT');client.release();client=null;return ready;}
   const weeks=[];
   for(const plan of plans){
    const kept=plan.kept?answerCache.get(plan.key):null;
    if(kept){weeks.push(Promise.resolve({window:plan.window,json:kept}));continue;}
    const read=await lockedDayCards(client,{from:plan.range.contextFrom,to:plan.range.contextTo},{sites,locked,signatures,useStore:useDayStore,asText:true});
    // One week is built at a time, so a month of cards is never held at once.
    if(building)await building;
    building=buildInWorker('attendance-week',{cardsJson:read.cardsJson,linksJson:plan.linksJson,mastersJson,attendance:plan.attendance,batches,filters:plan.range,hr,scope,punched:plan.punched,hrChanges:plan.hrChanges})
     .then(json=>{if(plan.kept)answerCache.set(plan.key,json,ATTENDANCE_WEEK_KEEP_MS);return {window:plan.window,json};});
    // A build that fails while the next week is read is reported when it is awaited, not as an unhandled error.
    building.catch(()=>{});
    weeks.push(building);
   }
   await client.query('COMMIT');
   client.release();client=null;
   const built=await Promise.all(weeks);
   building=null;
   // The weeks are joined and the answer written as JSON text on the worker too; it is sent as it is.
   const text=await buildInWorker('attendance-answer',{weeks:built,filters,hr,scope,locked:[...locked],only});
   answerCache?.set(answerKey,text,plans.every(p=>p.kept)?ATTENDANCE_WEEK_KEEP_MS:ATTENDANCE_RECENT_KEEP_MS);
   return text;
   }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});await building?.catch(()=>{});throw error;}
   finally{client?.release();}
   });
   res.set('Cache-Control','private, no-store').type('application/json').send(body);
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
 };
 app.get('/api/reports/manpower/attendance',...protect,readAttendance(false));
 app.get('/api/integrations/hr/attendance',requireHrAttendance(),readAttendance(true));
 // Earlier red / orange repeats per driver, read only when someone asks for them.
 // Only the card fields that decide a duty are read, one week at a time, from all three log books.
 app.get('/api/reports/manpower/ot-history',...protect,async(req,res,next)=>{
  let client;
  try{
   const filters=manpowerFilters(req.query),windows=otHistoryWindows(filters.from);
   if(filters.site)requireLogBookSite(req.logBookScope,filters.site);
   const period={historyFrom:windows[0]?.from||null,historyTo:windows.at(-1)?.to||null,historyDays:OT_HISTORY_DAYS};
   if(!windows.length)return res.set('Cache-Control','private, no-store').json({...period,drivers:[]});
   await ensureBooks();
   const body=await lane.run(reportKey('ot-history',req),async()=>{
   try{
   client=await pool.connect();
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   let sites=await filterLogBookSites(client,req.logBookScope);
   if(filters.site){if(sites===null)sites=(await client.query('SELECT DISTINCT site FROM mis_log_books WHERE book_date BETWEEN $1 AND $2',[period.historyFrom,filters.from])).rows.map(r=>r.site);sites=sites.filter(site=>canonicalSiteName(site)===canonicalSiteName(filters.site));}
   const masters=await reportMasters(client),events=[];
   for(const window of windows){
    const range=manpowerFilters({...window,site:filters.site}),rows=await slimCards(client,range,sites);
    events.push(...buildManpowerReport({records:rows.filter(r=>siteAllowed(req.logBookScope,r.site)),...masters,filters:range}).ot);
   }
   await client.query('COMMIT');
   return {...period,drivers:otHistorySummary(events,filters.from)};
   }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});throw error;}
   finally{client?.release();client=null;}
   });
   res.set('Cache-Control','private, no-store').json(body);
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
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
   await ensureBooks();
   const body=await lane.run(reportKey('ot-drivers',req),async()=>{
   try{
   client=await pool.connect();
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
   return {...period,drivers:otDriverTally(events,period,duties)};
   }finally{client?.release();client=null;}
   });
   res.set('Cache-Control','private, no-store').json(body);
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
 });
}
