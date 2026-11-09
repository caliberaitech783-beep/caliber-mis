import {reconcileFleet,shiftForDate,validFleetDate,fleetShift,fleetAssetKind,assetIdentity,IDLE_REASONS} from '../rules/fleet-reconciliation.mjs';
import {siteAllowed,requireLogBookSite} from '../../shared/log-book-access.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {misPageAllowed} from '../../shared/mis-application-access.mjs';

const fleetBookPages={
 vehicle:['Vehicle Log Book','Trip Card Bulk Scan'],
 lmv:['LMV Log Book','LMV Scan'],
 equipment:['Equipment Log Book','Job Card Bulk Scan']
};

export const FLEET_REASON_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_fleet_idle_reasons(site_key TEXT NOT NULL,book_date DATE NOT NULL,shift TEXT NOT NULL,asset_key TEXT NOT NULL,reason TEXT NOT NULL,remarks TEXT NOT NULL DEFAULT '',updated_by TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(site_key,book_date,shift,asset_key));
CREATE TABLE IF NOT EXISTS mis_fleet_idle_reason_history(id BIGSERIAL PRIMARY KEY,site_key TEXT NOT NULL,book_date DATE NOT NULL,shift TEXT NOT NULL,asset_key TEXT NOT NULL,reason TEXT NOT NULL,remarks TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`;
export function registerFleetReconciliation(app,{pool,protect,ensureBooks,pulseMasterSync}){
 let ready;const ensure=async()=>{await ensureBooks();await(ready??=pool.query(FLEET_REASON_SCHEMA).catch(e=>{ready=null;throw e}));};
 const handle=fn=>async(req,res,next)=>{try{res.set('Cache-Control','no-store');await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}};
 const kindsFor=req=>Object.keys(fleetBookPages).filter(kind=>!req.session.permissions?.separateMisCredentials||fleetBookPages[kind].some(page=>misPageAllowed(req.session,page)));
 const masters=async()=>{
  const {rows}=await pool.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[])",[['Equipment master','Shift Master']]);
  const assets=[],shifts=[],lmvIds=new Set();
  for(const row of rows){
   const record={...row.record_data,id:String(row.id)};
   if(row.master_name==='Shift Master')shifts.push(record);
   else{
    assets.push(record);
    if(fleetAssetKind(record)==='lmv')lmvIds.add(record.id);
   }
  }
  return {assets,shifts,lmvIds};
 };
 app.get('/api/reports/fleet-reconciliation/options',...protect,handle(async(req,res)=>{
  const data=await masters(),kinds=kindsFor(req);
  const assets=kinds.includes('lmv')?data.assets:data.assets.filter(asset=>!data.lmvIds.has(asset.id));
  const sites=[...new Set(assets.map(a=>a.currentLocation||a.site||a.location).filter(s=>s&&siteAllowed(req.logBookScope,s)))].sort();
  const shifts=data.shifts.filter(s=>siteAllowed(req.logBookScope,s.site||s.siteName)).map(s=>({...s,code:fleetShift(s.shiftCode||s.shiftName||s.name||s.shift)}));
  res.json({sites,shifts,kinds,reasons:IDLE_REASONS});
 }));
 const selection=async(req,input)=>{
  const date=String(input.date||''),site=String(input.site||''),shift=String(input.shift||''),kind=String(input.kind||'');
  if(!validFleetDate(date)||date>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})||!site||!['S1','S2','S3','D','N'].includes(shift)||kind&&!Object.hasOwn(fleetBookPages,kind))throw Object.assign(Error('Choose a valid site, date and shift. Future dates are unavailable.'),{status:400});
  requireLogBookSite(req.logBookScope,site);const kinds=kindsFor(req);if(!kinds.length||kind&&!kinds.includes(kind))throw Object.assign(Error('This logbook type is not permitted.'),{status:403});
  const data=await masters(),window=shiftForDate(data.shifts,site,date,shift);if(window.start>Date.now())throw Object.assign(Error('This shift has not started.'),{status:400});return {date,site,shift,kind,kinds,window,...data};
 };
 app.get('/api/reports/fleet-reconciliation',...protect,handle(async(req,res)=>{
  const s=await selection(req,req.query);await ensure();
  let breakdowns;try{breakdowns=await pulseMasterSync.readBreakdownRequests({fresh:true,actor:req.session.login||req.session.name});if(!Array.isArray(breakdowns))throw Error('Invalid feed');}catch{throw Object.assign(Error('Pulse breakdown data is unavailable. Reconnect Pulse and retry; missing breakdown data is not treated as zero.'),{status:503});}
  const books=(await pool.query('SELECT id,book_no,book_type,asset_id,site,data FROM mis_log_books WHERE deleted_at IS NULL AND book_date=$1::date AND book_type=ANY($2::text[])',[s.date,s.kinds])).rows.filter(b=>siteAllowed(req.logBookScope,b.site)&&(b.book_type==='lmv'||!s.lmvIds.has(String(b.asset_id||b.data?.assetId))));
  const reasons=(await pool.query('SELECT asset_key,reason,remarks,updated_at,updated_by FROM mis_fleet_idle_reasons WHERE site_key=$1 AND book_date=$2::date AND shift=$3',[canonicalSiteName(s.site),s.date,s.shift])).rows;
  const result=reconcileFleet({...s,assets:s.assets.filter(a=>s.kinds.includes(fleetAssetKind(a))),books,breakdowns,reasons});
  const sync=pulseMasterSync.status?.();
  res.json({...result,date:s.date,site:s.site,shift:s.shift,window:s.window,partialShift:Date.now()<s.window.end,updatedAt:new Date().toISOString(),masterSync:sync?{connected:sync.connected,lastSuccess:sync.lastSuccess}:null,populationNote:'Fleet population uses the current Pulse-synced Equipment Master location. Historical site assignments are not available; compare unmatched cards before relying on past-date totals.'});
 }));
 app.put('/api/reports/fleet-reconciliation/idle-reason',...protect,handle(async(req,res)=>{
  const s=await selection(req,req.body),asset=s.assets.find(a=>String(a.id)===String(req.body.assetId));
  if(!asset||canonicalSiteName(asset.currentLocation||asset.site||asset.location)!==canonicalSiteName(s.site)||!s.kinds.includes(fleetAssetKind(asset)))throw Object.assign(Error('Asset is not in the permitted site roster.'),{status:403});
  const reason=String(req.body.reason||''),remarks=String(req.body.remarks||'').trim();if(!IDLE_REASONS.includes(reason)||remarks.length>2000||reason==='Other'&&!remarks)throw Object.assign(Error('Choose an idle reason. Other requires remarks (maximum 2,000 characters).'),{status:400});
  await ensure();const values=[canonicalSiteName(s.site),s.date,s.shift,assetIdentity(asset),reason,remarks,String(req.session.login||req.session.name)];
  // A single statement saves the current reason and an append-only audit record atomically.
  await pool.query(`WITH saved AS (INSERT INTO mis_fleet_idle_reasons(site_key,book_date,shift,asset_key,reason,remarks,updated_by) VALUES($1,$2::date,$3,$4,$5,$6,$7) ON CONFLICT(site_key,book_date,shift,asset_key) DO UPDATE SET reason=EXCLUDED.reason,remarks=EXCLUDED.remarks,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *) INSERT INTO mis_fleet_idle_reason_history(site_key,book_date,shift,asset_key,reason,remarks,updated_by) SELECT site_key,book_date,shift,asset_key,reason,remarks,updated_by FROM saved`,values);
  res.json({saved:true});
 }));
}
