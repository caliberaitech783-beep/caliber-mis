// Site Sheet vs Trip Card (owner, 23 Nov 2026): "make a software which will not be linked to the working, but user-wise
// it will save". The attendance Excel a site keeps by hand is read in the browser (src/attendance-sheet-run.mjs) and kept
// here per login, so the report opens again without uploading and without an Excel download. Only the sheet's lines and
// marks are kept (shared/site-sheet-days.mjs savedSheetFrom); nothing of the working data is written. Each opening
// compares the kept sheet with the trip cards of that moment (the screen reads them as before).
//
// Who sees what: a login sees the sheets it saved; an MIS administrator sees every sheet, with who saved it. A login with
// one or a few sites saves and opens only sheets of its own sites. The same login saving the same site and month again
// replaces its older sheet.
// The routes sit under /api/reports, so the Reports menu right decides who reaches them (misRequestAllowed).
import {REGION_DATA} from '../../shared/region-scope.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {siteAllowed} from '../../shared/log-book-access.mjs';
import {isMisAdministrator} from '../../shared/mis-admin-access.mjs';
import {savedSheetFrom,sheetMonth} from '../../shared/site-sheet-days.mjs';

const SITES=REGION_DATA.flatMap(region=>region.sites);
export const SITE_SHEETS_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_site_attendance_sheets(
  id BIGSERIAL PRIMARY KEY,site TEXT NOT NULL,site_key TEXT NOT NULL,month TEXT NOT NULL,first_date TEXT NOT NULL,last_date TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',sheet_name TEXT NOT NULL DEFAULT '',people INTEGER NOT NULL DEFAULT 0,sheet JSONB NOT NULL,
  saved_by TEXT NOT NULL,saved_name TEXT NOT NULL DEFAULT '',saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE UNIQUE INDEX IF NOT EXISTS mis_site_attendance_sheets_one ON mis_site_attendance_sheets(saved_by,site_key,month);`;
const LIST_SQL=`SELECT id::text AS id,site,month,first_date,last_date,file_name,sheet_name,people,saved_by,saved_name,saved_at
 FROM mis_site_attendance_sheets WHERE ($1::boolean OR saved_by=$2) ORDER BY saved_at DESC LIMIT 300`;
const ONE_SQL=`SELECT id::text AS id,site,month,first_date,last_date,file_name,sheet_name,people,saved_by,saved_name,saved_at,sheet
 FROM mis_site_attendance_sheets WHERE id=$1`;
const SAVE_SQL=`INSERT INTO mis_site_attendance_sheets(site,site_key,month,first_date,last_date,file_name,sheet_name,people,sheet,saved_by,saved_name)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
 ON CONFLICT(saved_by,site_key,month) DO UPDATE SET site=EXCLUDED.site,first_date=EXCLUDED.first_date,last_date=EXCLUDED.last_date,
  file_name=EXCLUDED.file_name,sheet_name=EXCLUDED.sheet_name,people=EXCLUDED.people,sheet=EXCLUDED.sheet,saved_name=EXCLUDED.saved_name,saved_at=NOW()
 RETURNING id::text AS id`;
const DELETE_SQL='DELETE FROM mis_site_attendance_sheets WHERE id=$1';

const text=value=>String(value??'').trim();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const who=session=>text(session?.login||session?.username||session?.userId||session?.id);
const meta=row=>({id:row.id,site:row.site,month:row.month,firstDate:row.first_date,lastDate:row.last_date,fileName:row.file_name,sheetName:row.sheet_name,
 people:Number(row.people)||0,savedBy:row.saved_by,savedName:row.saved_name||row.saved_by,savedAt:row.saved_at instanceof Date?row.saved_at.toISOString():String(row.saved_at||'')});
// A sheet this login may open: its own (or any, for an MIS administrator), and of a site its login holds.
const visible=(req,row)=>Boolean(row)&&(isMisAdministrator(req.session)||row.saved_by===who(req.session))&&siteAllowed(req.logBookScope,row.site);

export function registerSiteSheets(app,{pool,protect}){
 let schema=null;
 const ensureSchema=()=>schema??=pool.query(SITE_SHEETS_SCHEMA).catch(error=>{schema=null;throw error;});
 const wrap=fn=>async(req,res,next)=>{try{await ensureSchema();res.set('Cache-Control','private, no-store');await fn(req,res);}catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}};

 app.get('/api/reports/manpower/site-sheets',...protect,wrap(async(req,res)=>{
  const admin=isMisAdministrator(req.session);
  const {rows}=await pool.query(LIST_SQL,[admin,who(req.session)]);
  res.json({admin,sheets:rows.filter(row=>siteAllowed(req.logBookScope,row.site)).map(meta)});
 }));

 app.get('/api/reports/manpower/site-sheets/:id',...protect,wrap(async(req,res)=>{
  if(!/^\d{1,18}$/.test(String(req.params.id)))fail('This saved sheet does not exist.',404);
  const row=(await pool.query(ONE_SQL,[req.params.id])).rows[0];
  if(!visible(req,row))fail('This saved sheet does not exist.',404);
  res.json({...meta(row),sheet:row.sheet});
 }));

 app.post('/api/reports/manpower/site-sheets',...protect,wrap(async(req,res)=>{
  const site=SITES.find(name=>canonicalSiteName(name)===canonicalSiteName(text(req.body?.site)));
  if(!site)fail('Select the site of this attendance sheet.');
  if(!siteAllowed(req.logBookScope,site))fail('This location is not assigned to your login.',403);
  const by=who(req.session);if(!by)fail('Sign in again to save this sheet.',401);
  let sheet;try{sheet=savedSheetFrom(req.body?.sheet);}catch(error){fail(error.message);}
  const filled=[...sheet.filledDates].sort();
  const {rows:[saved]}=await pool.query(SAVE_SQL,[site,canonicalSiteName(site),sheetMonth(sheet),filled[0],filled.at(-1),text(req.body?.fileName).slice(0,200),sheet.sheetName,
   sheet.people.length,JSON.stringify(sheet),by,text(req.session?.name).slice(0,120)]);
  res.json({id:saved.id,site,month:sheetMonth(sheet)});
 }));

 app.delete('/api/reports/manpower/site-sheets/:id',...protect,wrap(async(req,res)=>{
  if(!/^\d{1,18}$/.test(String(req.params.id)))fail('This saved sheet does not exist.',404);
  const row=(await pool.query(ONE_SQL,[req.params.id])).rows[0];
  if(!visible(req,row))fail('This saved sheet does not exist.',404);
  await pool.query(DELETE_SQL,[req.params.id]);
  res.json({deleted:req.params.id});
 }));
}
