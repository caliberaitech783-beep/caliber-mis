import {buildProductionReport,productionFilters,productionShifts,validateCapacity,assetCapacityPair,pairKey} from './production-report.mjs';
import {withEquipmentAliases} from './equipment-aliases.mjs';
import {siteAllowed,requireLogBookSite} from './log-book-access.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {isMisAdministrator} from './mis-admin-access.mjs';
import {linkVlbTripHandovers} from './vlb-trip-handover.mjs';
import {assetBookKind} from './equipment-kind.mjs';

export const PRODUCTION_REPORT_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_capacity_versions(
 id BIGSERIAL PRIMARY KEY,make TEXT NOT NULL,model TEXT NOT NULL,make_key TEXT NOT NULL,model_key TEXT NOT NULL,
 capacity NUMERIC(10,3) NOT NULL CHECK(capacity>0 AND capacity<=1000),effective_from DATE NOT NULL CHECK(effective_from>='2026-11-01'),
 reason TEXT NOT NULL,created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(make_key,model_key,effective_from));`;
const versionSelect='id,make,model,capacity,effective_from::text AS "effectiveFrom",reason,created_by AS "createdBy",created_at AS "createdAt"';
const invalid=(message,status=400)=>Object.assign(new Error(message),{status});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const masterRows=async client=>(await client.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY id",[['Equipment master','Shift Master']])).rows;
const masterList=(rows,name)=>rows.filter(r=>r.master_name===name).map(r=>({...r.record_data,id:String(r.id)}));
const capacityAssets=rows=>masterList(rows,'Equipment master').filter(a=>assetBookKind(a)==='vehicle'&&!a.sourceMissing);
export function registerProductionReports(app,{pool,protect,ensureBooks}){
 let ready;const ensure=async()=>{await ensureBooks();await(ready??=(pool.query(PRODUCTION_REPORT_SCHEMA).catch(e=>{ready=null;throw e;})));};
 const admin=(req,res,next)=>isMisAdministrator(req.session)?next():res.status(403).json({error:'Capacity approvals require an authorized administrator.'});
 app.get('/api/capacity-master',...protect,admin,async(req,res,next)=>{
  try{await ensure();const rows=await masterRows(pool),pairs=new Map();for(const a of capacityAssets(rows)){const p=assetCapacityPair(a);if(p.make&&p.model&&!/^\d+$/.test(p.make)){const k=pairKey(p);if(!pairs.has(k))pairs.set(k,{...p,vehicles:0});pairs.get(k).vehicles++;}}
   res.set('Cache-Control','private, no-store').json({pairs:[...pairs.values()].sort((a,b)=>(a.make+' '+a.model).localeCompare(b.make+' '+b.model)),versions:(await pool.query(`SELECT ${versionSelect} FROM mis_capacity_versions ORDER BY make_key,model_key,effective_from DESC`)).rows});
  }catch(e){next(e);}
 });
 app.post('/api/capacity-master',...protect,admin,async(req,res,next)=>{
  let client;try{
   const v=validateCapacity(req.body||{});await ensure();client=await pool.connect();await client.query('BEGIN');
   await client.query("SELECT pg_advisory_xact_lock(hashtext('mis_capacity_versions'))");
   const assets=capacityAssets(await masterRows(client));if(!assets.some(a=>pairKey(assetCapacityPair(a))===pairKey(v)))throw invalid('This vehicle make/model pair is not available in Equipment master. Sync or correct the equipment master first.');
   const prior=(await client.query('SELECT effective_from::text AS date FROM mis_capacity_versions WHERE make_key=$1 AND model_key=$2 ORDER BY effective_from DESC LIMIT 1',[v.makeKey,v.modelKey])).rows[0];
   if(prior){const latestClosed=(await client.query('SELECT max(book_date)::text AS date FROM mis_vlb_batches WHERE closed_at IS NOT NULL AND deleted_at IS NULL AND archived_at IS NULL')).rows[0]?.date;
    if(v.effectiveFrom<=prior.date||v.effectiveFrom<=today()||latestClosed&&v.effectiveFrom<=latestClosed)throw invalid('Existing approvals are immutable. Add a new version effective after today, the previous version and all processed batch dates. Historical corrections require a reviewed data correction.',409);
   }
   const saved=(await client.query(`INSERT INTO mis_capacity_versions(make,model,make_key,model_key,capacity,effective_from,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${versionSelect}`,[v.make,v.model,v.makeKey,v.modelKey,v.capacity,v.effectiveFrom,v.reason,String(req.session.login||req.session.username||req.session.user?.login||'administrator')])).rows[0];
   await client.query('COMMIT');res.status(201).set('Cache-Control','private, no-store').json(saved);
  }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});if(e.status||e.code==='23505')return res.status(e.status||409).json({error:e.status?e.message:'An approved version already exists for that make, model and effective date.'});next(e);}finally{client?.release();}
 });
 app.get('/api/reports/production/options',...protect,async(req,res,next)=>{
  try{await ensure();const masters=await masterRows(pool),shifts=masterList(masters,'Shift Master').filter(s=>siteAllowed(req.logBookScope,s.site||s.siteName));
   const sites=new Map();for(const r of [...shifts,...masterList(masters,'Equipment master')]){const site=r.currentLocation||r.site||r.siteName||r.location;if(site&&siteAllowed(req.logBookScope,site)&&!sites.has(canonicalSiteName(site)))sites.set(canonicalSiteName(site),site);}
   res.set('Cache-Control','private, no-store').json({sites:[...sites.values()].sort(),shifts:shifts.map(s=>({site:s.site||s.siteName,shiftCode:s.shiftCode,shiftName:s.shiftName,startTime:s.startTime,endTime:s.endTime,effectiveFrom:s.effectiveFrom,effectiveTo:s.effectiveTo,status:s.status,sourceMissing:s.sourceMissing}))});
  }catch(e){next(e);}
 });
 app.get('/api/reports/production',...protect,async(req,res,next)=>{
  let client;try{
   const filters=productionFilters(req.query);requireLogBookSite(req.logBookScope,filters.site);await ensure();client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const sites=(await client.query('SELECT DISTINCT site FROM mis_log_books WHERE book_date>=$$2026-11-01$$ UNION SELECT DISTINCT site FROM mis_vlb_batches WHERE book_date>=$$2026-11-01$$')).rows.map(r=>r.site).filter(s=>siteAllowed(req.logBookScope,s)&&canonicalSiteName(s)===canonicalSiteName(filters.site));
   const records=(await client.query(`SELECT l.id,l.book_no,l.book_type,l.book_date::text,l.site,l.asset_id,l.revision,l.data-'manualAttachments' AS data,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'site',b.site,'report_date',b.book_date::text,'shift',b.shift,'closed_at',b.closed_at,'snapshotRevision',e.snapshot->>'revision')) FROM mis_vlb_batch_entries e JOIN mis_vlb_batches b ON b.id=e.batch_id WHERE e.logbook_id=l.id AND b.deleted_at IS NULL AND b.archived_at IS NULL),'[]'::jsonb) AS batches
    FROM mis_log_books l WHERE l.deleted_at IS NULL AND l.book_date>=$$2026-11-01$$ AND l.site=ANY($1::text[])
    AND (l.book_date=$2 OR l.book_type='vehicle' AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(l.data->'trips','[]'::jsonb)) t WHERE (COALESCE(t->>'loadingTime','')='')<>(COALESCE(t->>'unloadingTime','')='')))
    ORDER BY l.book_date,l.id LIMIT 50001`,[sites,filters.date])).rows;
   if(records.length>50000)throw invalid('Too many cards or unresolved handovers for one report. Review the outstanding trip links first.');
   const masters=await masterRows(client),batches=(await client.query('SELECT id,name,site,book_date::text AS report_date,shift,closed_at,closure_revision FROM mis_vlb_batches WHERE deleted_at IS NULL AND archived_at IS NULL AND site=ANY($1::text[]) AND book_date=$2',[sites,filters.date])).rows;
   const capacities=(await client.query(`SELECT ${versionSelect} FROM mis_capacity_versions WHERE effective_from<=$1`,[filters.date])).rows;
   const linked=linkVlbTripHandovers(records.filter(r=>r.book_type==='vehicle'));
   const report=buildProductionReport({filters,records:[...linked,...records.filter(r=>r.book_type==='equipment')],assets:await withEquipmentAliases(client,masterList(masters,'Equipment master')),shifts:masterList(masters,'Shift Master'),batches,capacities});
   await client.query('COMMIT');res.set('Cache-Control','private, no-store').json({...report,generatedAt:new Date().toISOString()});
  }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});if(e.status)return res.status(e.status).json({error:e.message});next(e);}finally{client?.release();}
 });
}
