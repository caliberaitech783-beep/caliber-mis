import {randomUUID} from 'node:crypto';
import {cardMachineKey} from './scan-machine-rules.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {aliasWrittenText,aliasWrittenKey,assetIdentifiers,attachEquipmentAliases} from './equipment-alias-rules.mjs';
export {aliasWrittenText,aliasWrittenKey,assetIdentifiers,aliasForSelection,attachEquipmentAliases} from './equipment-alias-rules.mjs';

// A written machine on a card (body "L21") that Pulse calls something else (DEMO21-00179).
// Once a reviewer maps the written text to the Pulse record, the alias is stored against
// the equipment id and applied everywhere the matcher runs: scan review, the Pulse fleet
// hold, manual entry and later batches. It follows the asset, not the site. Saved
// logbooks are never rewritten.
export const EQUIPMENT_ALIAS_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_equipment_aliases(
  id UUID PRIMARY KEY,equipment_id BIGINT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('vehicle','equipment')),
  written_key TEXT NOT NULL,written_text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  site TEXT NOT NULL DEFAULT '',book TEXT NOT NULL DEFAULT '',batch_id TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),revoked_by TEXT,revoked_at TIMESTAMPTZ);
 CREATE UNIQUE INDEX IF NOT EXISTS mis_equipment_aliases_one_active ON mis_equipment_aliases(kind,written_key,equipment_id) WHERE status='active';
 CREATE INDEX IF NOT EXISTS mis_equipment_aliases_equipment ON mis_equipment_aliases(equipment_id) WHERE status='active';`;

const text=value=>String(value??'').normalize('NFKC').trim();
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};

const prepared=new WeakSet();
export async function ensureEquipmentAliases(pool){if(prepared.has(pool))return;await pool.query(EQUIPMENT_ALIAS_SCHEMA);prepared.add(pool);}
// Works through the scan validation client too (a per-request wrapper around the pool):
// a missing table is created on first use instead of being prepared per wrapper.
export async function loadEquipmentAliases(pool){
 const read=async()=>{
  const links=(await pool.query("SELECT to_regclass('pulse_master_links') IS NOT NULL AS present")).rows[0]?.present;
  return (await pool.query(links?"SELECT a.*,l.source_id FROM mis_equipment_aliases a LEFT JOIN pulse_master_links l ON l.local_id=a.equipment_id AND l.master_name='Equipment master' WHERE a.status='active' ORDER BY a.created_at":"SELECT a.*,NULL::text AS source_id FROM mis_equipment_aliases a WHERE a.status='active' ORDER BY a.created_at")).rows;
 };
 try{return await read();}catch(e){if(e?.code!=='42P01')throw e;await pool.query(EQUIPMENT_ALIAS_SCHEMA);return read();}
}
export const withEquipmentAliases=async(pool,assets,options)=>attachEquipmentAliases(assets,await loadEquipmentAliases(pool),options);

export const publicAlias=row=>({id:row.id,equipmentId:String(row.equipment_id),kind:row.kind,writtenKey:row.written_key,writtenText:row.written_text,status:row.status,site:row.site,book:row.book,batchId:row.batch_id,requestedBy:row.requested_by,createdAt:row.created_at,revokedBy:row.revoked_by||null,revokedAt:row.revoked_at||null});

const recordSite=r=>canonicalSiteName(r.currentLocation||r.site||r.location);
// Create (or confirm) an alias. Rejects a written key that already names a real door of
// another asset at the same site: a written key may never shadow a real door.
export async function createEquipmentAlias(pool,{equipmentId,kind='equipment',writtenText,site='',book='',batchId='',requestedBy}){
 await ensureEquipmentAliases(pool);
 if(!/^\d+$/.test(String(equipmentId||'')))fail('Select the equipment record to map.');
 if(!['vehicle','equipment'].includes(kind))fail('Invalid machine kind.');
 const written=aliasWrittenText(writtenText);if(!written)fail('The written machine text is missing.');
 const key=aliasWrittenKey(written,kind);if(!key)fail('The written machine text has no usable machine number.');
 const record=(await pool.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master' AND id=$1",[Number(equipmentId)])).rows[0];
 if(!record||record.record_data?.sourceMissing)fail('The equipment record is no longer in the Equipment master.',404);
 const asset=record.record_data,assetSite=recordSite(asset);
 if(assetIdentifiers(asset).some(label=>cardMachineKey(label,kind)===key))return {alias:null,redundant:true};
 const others=(await pool.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master' AND id<>$1",[Number(equipmentId)])).rows;
 const shadow=others.find(r=>!r.record_data?.sourceMissing&&recordSite(r.record_data)===assetSite&&assetIdentifiers(r.record_data).some(label=>cardMachineKey(label,kind)===key));
 if(shadow)fail(`${written} is already a real door (${assetIdentifiers(shadow.record_data)[0]}) at ${asset.currentLocation||asset.site||'this site'}. It cannot also be an alias.`,409);
 const existing=(await pool.query("SELECT * FROM mis_equipment_aliases WHERE kind=$1 AND written_key=$2 AND equipment_id=$3 AND status='active'",[kind,key,Number(equipmentId)])).rows[0];
 if(existing)return {alias:existing,created:false};
 const row=(await pool.query('INSERT INTO mis_equipment_aliases(id,equipment_id,kind,written_key,written_text,site,book,batch_id,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),Number(equipmentId),kind,key,written,text(site).slice(0,120),text(book).slice(0,20),text(batchId).slice(0,80),text(requestedBy).slice(0,120)||'unknown'])).rows[0];
 return {alias:row,created:true};
}

export async function revokeEquipmentAlias(pool,id,revokedBy){
 await ensureEquipmentAliases(pool);
 if(!uuid(id))fail('Invalid alias.',404);
 const row=(await pool.query("UPDATE mis_equipment_aliases SET status='revoked',revoked_by=$2,revoked_at=NOW() WHERE id=$1 AND status='active' RETURNING *",[id,text(revokedBy).slice(0,120)||'unknown'])).rows[0];
 if(!row)fail('Alias not found or already revoked.',404);
 return row;
}

// Held scan cards re-run their Pulse fleet check on the next batch read once an alias changes.
export const requeueHeldScanCards=pool=>pool.query("UPDATE mis_scan_cards SET raw_fields=raw_fields-'fleetReview' WHERE status IN('review','approved','error') AND jsonb_typeof(raw_fields->'fleetReview'->'issues')='array' AND jsonb_array_length(raw_fields->'fleetReview'->'issues')>0").catch(e=>{if(e?.code!=='42P01')throw e;});

export function registerEquipmentAliases(app,{pool,protect=[],requireAdministrator=null,audit=()=>{},onChange=()=>requeueHeldScanCards(pool)}){
 const guard=Array.isArray(protect)?protect:[protect];
 const handle=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store');await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.message||'Equipment alias request failed.'});}};
 app.get('/api/equipment-aliases',...guard,handle(async(req,res)=>{
  res.json({aliases:(await loadEquipmentAliases(pool)).map(publicAlias)});
 }));
 app.post('/api/equipment-aliases',...guard,handle(async(req,res)=>{
  const actor=req.session?.login||req.session?.name||'';
  const result=await createEquipmentAlias(pool,{...req.body,requestedBy:actor});
  if(result.alias&&result.created){audit(req,{action:'Equipment alias created',reference:result.alias.written_text+' → equipment '+result.alias.equipment_id,details:publicAlias(result.alias)});await onChange(result.alias);}
  res.status(result.created?201:200).json({alias:result.alias?publicAlias(result.alias):null,created:Boolean(result.created),redundant:Boolean(result.redundant)});
 }));
 app.delete('/api/equipment-aliases/:id',...guard,...(requireAdministrator?[requireAdministrator]:[]),handle(async(req,res)=>{
  const actor=req.session?.login||req.session?.name||'';
  const row=await revokeEquipmentAlias(pool,req.params.id,actor);
  audit(req,{action:'Equipment alias revoked',reference:row.written_text+' → equipment '+row.equipment_id,details:publicAlias(row)});await onChange(row);
  res.json({alias:publicAlias(row)});
 }));
}
