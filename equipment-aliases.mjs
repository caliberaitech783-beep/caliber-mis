import {randomUUID} from 'node:crypto';
import {cardMachineKey,identifyCardMachine,matchCardMachine} from './scan-machine-rules.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {displaySiteName} from './region-scope.mjs';
import {assetBookKind} from './equipment-kind.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {generateOtp,hashOtp,otpExpiresAt,checkOtpAttempt,resendTooSoon,otpFail,OTP_TTL_MINUTES} from './otp-approval.mjs';
import {aliasWrittenText,aliasWrittenKey,assetIdentifiers,attachEquipmentAliases} from './equipment-alias-rules.mjs';
export {aliasWrittenText,aliasWrittenKey,assetIdentifiers,aliasForSelection,attachEquipmentAliases} from './equipment-alias-rules.mjs';

// A written machine on a card (body "L21") that Pulse calls something else (DEMO21-00179).
// A reviewer maps the written text to the Pulse record once. With EQUIPMENT_ALIAS_OTP on,
// the pair is applied to the open batch at once as a card-only selection and becomes a
// permanent alias only after an OTP (the fixed mapping approver by Telegram, or the site
// Project Manager as the emergency route). With the flag off the pair is active at once.
// Active aliases ride on the asset as cardAliases wherever the matcher runs. The alias
// follows the asset, not the site. Saved logbooks are never rewritten.
export const aliasOtpEnabled=(env=process.env)=>['1','true','on','yes'].includes(String(env.EQUIPMENT_ALIAS_OTP||'').trim().toLowerCase());
export const ALIAS_STATUSES=Object.freeze(['pending','active','suspended','retired','revoked']);
export const ALIAS_ROUTES=Object.freeze({nitish:'Mapping approver',site_pm:'Site Project Manager (emergency)'});
export const EMERGENCY_REASONS=Object.freeze({on_leave:'On leave',unwell:'Unwell',not_answering:'Not answering',other:'Other'});
export const ALIAS_OTP_PURPOSES=Object.freeze({map_equipment:{label:'Equipment mapping approval',verb:'map'},revoke_alias:{label:'Equipment mapping revoke',verb:'revoke the mapping of'}});
export const ALIAS_APPROVER_SETTING_KEY='equipment_alias_approver';
export const DEFAULT_ALIAS_APPROVER=Object.freeze({login:'nitish',name:'Nitish Kumar Tiwari',caliberId:'5431'});
export const ALIAS_WEEKLY_SETTING_KEY='equipment_alias_weekly_summary';

export const EQUIPMENT_ALIAS_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_equipment_aliases(
  id UUID PRIMARY KEY,equipment_id BIGINT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('vehicle','equipment')),
  written_key TEXT NOT NULL,written_text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',
  site TEXT NOT NULL DEFAULT '',book TEXT NOT NULL DEFAULT '',batch_id TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),revoked_by TEXT,revoked_at TIMESTAMPTZ);
 ALTER TABLE mis_equipment_aliases DROP CONSTRAINT IF EXISTS mis_equipment_aliases_status_check;
 ALTER TABLE mis_equipment_aliases ADD CONSTRAINT mis_equipment_aliases_status_check CHECK(status IN ('pending','active','suspended','retired','revoked'));
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS approval_route TEXT;
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS emergency_reason TEXT;
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS nitish_otp_count INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS otp_id UUID;
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS approved_by TEXT;
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS revoke_otp_id UUID;
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS revoke_route TEXT;
 ALTER TABLE mis_equipment_aliases ADD COLUMN IF NOT EXISTS revoke_reason TEXT;
 DROP INDEX IF EXISTS mis_equipment_aliases_one_active;
 CREATE UNIQUE INDEX IF NOT EXISTS mis_equipment_aliases_one_live ON mis_equipment_aliases(kind,written_key,equipment_id) WHERE status IN ('pending','active','suspended');
 CREATE INDEX IF NOT EXISTS mis_equipment_aliases_equipment ON mis_equipment_aliases(equipment_id) WHERE status IN ('active','suspended');
 CREATE TABLE IF NOT EXISTS mis_equipment_alias_history(
  id BIGSERIAL PRIMARY KEY,alias_id UUID NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL DEFAULT '',detail JSONB NOT NULL DEFAULT '{}',at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS mis_equipment_alias_history_alias ON mis_equipment_alias_history(alias_id,id);
 CREATE TABLE IF NOT EXISTS mis_equipment_alias_otps(
  id UUID PRIMARY KEY,alias_id UUID NOT NULL,purpose TEXT NOT NULL CHECK(purpose IN ('map_equipment','revoke_alias')),route TEXT NOT NULL CHECK(route IN ('nitish','site_pm')),
  reason TEXT NOT NULL DEFAULT '',requested_by TEXT NOT NULL,requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),sent_to TEXT[] NOT NULL,channels TEXT[] NOT NULL DEFAULT '{}',
  otp_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','used','expired','cancelled')),used_at TIMESTAMPTZ,approved_by TEXT);
 CREATE INDEX IF NOT EXISTS mis_equipment_alias_otps_alias ON mis_equipment_alias_otps(alias_id) WHERE status='sent';`;

const text=value=>String(value??'').normalize('NFKC').trim();
const login=value=>text(value).toLowerCase();
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const recordSite=r=>canonicalSiteName(r?.currentLocation||r?.site||r?.location);
const formatDate=value=>{const m=text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:text(value)};
const describeMachine=(written,kind)=>{const m=identifyCardMachine(written,kind==='vehicle'?'vehicle':'trip-body',{allowSuffix:true});return m?`${m.label} · No. ${m.number}`:'';};

// Works through the scan validation client too (a per-request wrapper around the pool):
// a missing table is created on first use instead of being prepared per wrapper.
export async function ensureEquipmentAliases(pool){await pool.query(EQUIPMENT_ALIAS_SCHEMA);}
const LINK_SQL="LEFT JOIN pulse_master_links l ON l.local_id=a.equipment_id AND l.master_name='Equipment master'";
const tablePresent=async(pool,name)=>(await pool.query(`SELECT to_regclass('${name}') IS NOT NULL AS present`)).rows[0]?.present;
// Reads never create the schema: they may run inside another transaction (manual save, batch
// stages) where a failed statement would abort it. Before the first write the table is simply
// absent and there are no aliases. Only active aliases resolve a written label; a suspended
// alias still indexes so the matcher reports the key as ambiguous beside the real door.
export async function loadEquipmentAliases(pool,{statuses=['active','suspended']}={}){
 if(!await tablePresent(pool,'mis_equipment_aliases'))return [];
 const links=await tablePresent(pool,'pulse_master_links');
 return (await pool.query(`SELECT a.*,${links?'l.source_id':'NULL::text AS source_id'} FROM mis_equipment_aliases a ${links?LINK_SQL:''} WHERE a.status=ANY($1::text[]) ORDER BY a.created_at`,[statuses])).rows;
}
export const withEquipmentAliases=async(pool,assets,options)=>attachEquipmentAliases(assets,await loadEquipmentAliases(pool),options);

export const publicAlias=row=>row?{id:row.id,equipmentId:String(row.equipment_id),kind:row.kind,writtenKey:row.written_key,writtenText:row.written_text,status:row.status,site:row.site,book:row.book,batchId:row.batch_id,requestedBy:row.requested_by,createdAt:row.created_at,
 approvalRoute:row.approval_route||null,emergencyReason:row.emergency_reason||null,nitishOtpCount:Number(row.nitish_otp_count||0),approvedBy:row.approved_by||null,approvedAt:row.approved_at||null,suspendedReason:row.suspended_reason||null,suspendedAt:row.suspended_at||null,retiredAt:row.retired_at||null,
 revokedBy:row.revoked_by||null,revokedAt:row.revoked_at||null,revokeRoute:row.revoke_route||null,revokeReason:row.revoke_reason||null,...(row.equipment_door!==undefined?{equipmentDoor:row.equipment_door,equipmentName:row.equipment_name,equipmentSite:row.equipment_site}:{}),...(row.history?{history:row.history}:{}),...(row.otps?{otps:row.otps}:{})}:null;
export const publicAliasOtp=row=>row?{id:row.id,aliasId:row.alias_id,purpose:row.purpose,route:row.route,reason:row.reason,requestedBy:row.requested_by,requestedAt:row.requested_at,expiresAt:row.expires_at,sentTo:row.sent_to,channels:row.channels,attempts:row.attempts,status:row.status}:null;

export const aliasHistory=(client,aliasId,action,actor,detail={})=>client.query('INSERT INTO mis_equipment_alias_history(alias_id,action,actor,detail) VALUES($1,$2,$3,$4::jsonb)',[aliasId,action,login(actor)||'system',JSON.stringify(detail)]);

// Approver setting: one login, seeded NITISH. Changing it is an administrator settings edit.
export async function readAliasApprover(pool){
 try{const {rows}=await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[ALIAS_APPROVER_SETTING_KEY]);const value=rows[0]?.setting_value||{};return {login:login(value.login)||DEFAULT_ALIAS_APPROVER.login,name:text(value.name)||DEFAULT_ALIAS_APPROVER.name,caliberId:text(value.caliberId)||DEFAULT_ALIAS_APPROVER.caliberId};}
 catch(e){if(e?.code==='42P01')return {...DEFAULT_ALIAS_APPROVER};throw e;}
}
export async function writeAliasApprover(pool,input={}){
 const value={login:login(input.login),name:text(input.name).slice(0,120),caliberId:text(input.caliberId).slice(0,20)};
 if(!value.login)fail('Enter the MIS login of the equipment mapping approver.');
 await pool.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()',[ALIAS_APPROVER_SETTING_KEY,JSON.stringify(value)]);
 return value;
}
export async function approverTelegramLinked(pool,approverLogin){
 try{return (await pool.query('SELECT 1 FROM mis_telegram_links WHERE login_name=$1',[login(approverLogin)])).rowCount>0;}catch(e){if(e?.code==='42P01')return false;throw e;}
}

// Section 4 of the spec, word for word apart from the values.
export function aliasOtpMessage({purpose='map_equipment',alias,asset,requestedBy,otp,site,counts,emergencyReason}){
 const where=displaySiteName(site||alias.site||recordSite(asset)||''),door=asset?assetIdentifiers(asset)[0]||('equipment '+alias.equipment_id):'equipment '+alias.equipment_id;
 const machine=describeMachine(alias.written_text,alias.kind);
 const lines=[`Caliber Pulse: ${ALIAS_OTP_PURPOSES[purpose].label}`];
 if(purpose==='map_equipment')lines.push(`${requestedBy} asks to map written machine ${alias.written_text}${machine?' ('+machine+')':''} to ${door}${where?' at '+where:''}.`);
 else lines.push(`${requestedBy} asks to revoke the mapping of written machine ${alias.written_text}${machine?' ('+machine+')':''} to ${door}${where?' at '+where:''}.`);
 if(counts?.rows)lines.push(`Seen on ${counts.rows} row(s) across ${counts.cards} card(s) in ${counts.batch||'the open batch'}${counts.context?' ('+counts.context+')':''}.`);
 if(emergencyReason)lines.push(`${DEFAULT_ALIAS_APPROVER.login.toUpperCase()} could not be reached: ${emergencyReason}`);
 lines.push(`OTP ${otp}, valid ${OTP_TTL_MINUTES} minutes. Share it only if you approve. Reading out this code is your approval and is recorded in the batch audit.`);
 return lines.join('\n');
}

async function assetRecord(pool,equipmentId){
 const record=(await pool.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master' AND id=$1",[Number(equipmentId)])).rows[0];
 return record&&!record.record_data?.sourceMissing?{...record.record_data,id:String(record.id)}:null;
}
async function shadowingAsset(pool,equipmentId,kind,key,assetSite){
 const others=(await pool.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master' AND id<>$1",[Number(equipmentId)])).rows;
 const row=others.find(r=>!r.record_data?.sourceMissing&&recordSite(r.record_data)===assetSite&&assetBookKind(r.record_data)===kind&&assetIdentifiers(r.record_data).some(label=>cardMachineKey(label,kind)===key));
 return row?{...row.record_data,id:String(row.id)}:null;
}

// Create (or confirm) an alias. A written key may never shadow a real door of another asset
// at the same site. With the OTP flag on the row starts pending; otherwise it is active.
export async function createEquipmentAlias(pool,{equipmentId,kind='equipment',writtenText,site='',book='',batchId='',requestedBy,otp=aliasOtpEnabled()}){
 await ensureEquipmentAliases(pool);
 if(!/^\d+$/.test(String(equipmentId||'')))fail('Select the equipment record to map.');
 if(!['vehicle','equipment'].includes(kind))fail('Invalid machine kind.');
 const written=aliasWrittenText(writtenText);if(!written)fail('The written machine text is missing.');
 const key=aliasWrittenKey(written,kind);if(!key)fail('The written machine text has no usable machine number.');
 const asset=await assetRecord(pool,equipmentId);
 if(!asset)fail('The equipment record is no longer in the Equipment master.',404);
 if(assetIdentifiers(asset).some(label=>cardMachineKey(label,kind)===key))return {alias:null,redundant:true};
 const shadow=await shadowingAsset(pool,equipmentId,kind,key,recordSite(asset));
 if(shadow)fail(`${written} is already a real door (${assetIdentifiers(shadow)[0]}) at ${asset.currentLocation||asset.site||'this site'}. It cannot also be an alias.`,409);
 const existing=(await pool.query("SELECT * FROM mis_equipment_aliases WHERE kind=$1 AND written_key=$2 AND equipment_id=$3 AND status IN ('pending','active','suspended')",[kind,key,Number(equipmentId)])).rows[0];
 if(existing)return {alias:existing,created:false};
 const status=otp?'pending':'active';
 const row=(await pool.query('INSERT INTO mis_equipment_aliases(id,equipment_id,kind,written_key,written_text,status,site,book,batch_id,requested_by,approval_route,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[randomUUID(),Number(equipmentId),kind,key,written,status,text(site).slice(0,120),text(book).slice(0,20),text(batchId).slice(0,80),login(requestedBy).slice(0,120)||'unknown',otp?null:'reviewer',otp?null:login(requestedBy)||'unknown',otp?null:new Date().toISOString()])).rows[0];
 await aliasHistory(pool,row.id,otp?'created_pending':'created_active',requestedBy,{writtenText:written,writtenKey:key,equipmentId:String(equipmentId),site,book,batchId});
 return {alias:row,created:true};
}

// When the OTP rule is switched on, aliases that were saved on a reviewer's choice alone go
// back to pending so each one is approved once; the box offers them again.
export async function demoteUnapprovedAliases(pool,actor='system'){
 await ensureEquipmentAliases(pool);
 const {rows}=await pool.query("UPDATE mis_equipment_aliases SET status='pending',approval_route=NULL,approved_by=NULL,approved_at=NULL WHERE status='active' AND (approval_route IS NULL OR approval_route='reviewer') RETURNING id");
 for(const row of rows)await aliasHistory(pool,row.id,'demoted_pending',actor,{reason:'OTP approval rule enabled'});
 return rows.length;
}

async function lockAlias(client,id){
 if(!uuid(id))fail('Invalid alias.',404);
 const row=(await client.query('SELECT * FROM mis_equipment_aliases WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!row)fail('Alias not found.',404);return row;
}
const cancelLive=(client,aliasId,purpose,except=null)=>client.query("UPDATE mis_equipment_alias_otps SET status='cancelled' WHERE alias_id=$1 AND purpose=$2 AND status='sent' AND ($3::uuid IS NULL OR id<>$3)",[aliasId,purpose,except]);

// One OTP per pair. Route nitish: the mapping approver by Telegram only, no WhatsApp
// fallback, resend always available after the one-per-minute rule. Route site_pm: the site
// Project Managers through the usual Telegram-then-WhatsApp delivery, always offered as a
// backup, with a reason from the fixed list.
export async function issueAliasOtp(client,{aliasId,purpose='map_equipment',route,emergencyReason='',emergencyNote='',requestedBy,requesterName,site='',counts=null,approver,telegram,pmLogins,deliver}){
 if(!ALIAS_OTP_PURPOSES[purpose])fail('Invalid OTP purpose.');
 if(!ALIAS_ROUTES[route])fail('Choose the approval route: the mapping approver or the site Project Manager.');
 const alias=await lockAlias(client,aliasId);
 if(purpose==='map_equipment'&&!['pending','suspended'].includes(alias.status))fail(alias.status==='active'?'This mapping is already approved.':'This mapping is no longer open for approval.',409);
 if(purpose==='revoke_alias'&&!['active','suspended'].includes(alias.status))fail('Only an active mapping can be revoked.',409);
 const live=(await client.query("SELECT * FROM mis_equipment_alias_otps WHERE alias_id=$1 AND purpose=$2 AND route=$3 AND status='sent' ORDER BY requested_at DESC LIMIT 1",[alias.id,purpose,route])).rows[0];
 if(live&&resendTooSoon(live.requested_at))fail('An OTP was sent less than a minute ago. Wait before requesting again.',429);
 const asset=await assetRecord(client,alias.equipment_id);
 const otp=generateOtp(),id=randomUUID(),expiresAt=otpExpiresAt();
 const requester=requesterName||requestedBy;
 let sentTo=[],channels=[],reason='';
 if(route==='nitish'){
  const target=login(approver?.login||DEFAULT_ALIAS_APPROVER.login);
  if(!telegram)fail('Telegram delivery is not configured on this server. Use the emergency route to the site PM.',503);
  const message=aliasOtpMessage({purpose,alias,asset,requestedBy:requester,otp,site,counts});
  const delivered=await telegram.send(target,message,`alias-otp:${id}:${target}`);
  if(!delivered)fail(`${target.toUpperCase()} has not linked Telegram from the ${target.toUpperCase()} login. Only the emergency OTP to the site PM is available.`,409);
  sentTo=[target];channels=['telegram'];
  await client.query('UPDATE mis_equipment_aliases SET nitish_otp_count=nitish_otp_count+1 WHERE id=$1',[alias.id]);
 }else{
  const reasonCode=text(emergencyReason);if(!EMERGENCY_REASONS[reasonCode])fail('Choose why the mapping approver cannot be reached.');
  reason=reasonCode==='other'?text(emergencyNote).slice(0,300):EMERGENCY_REASONS[reasonCode];
  if(reasonCode==='other'&&reason.length<5)fail('Describe why the mapping approver cannot be reached.');
  if(typeof deliver!=='function'||typeof pmLogins!=='function')fail('PM OTP delivery is not configured on this server.',503);
  const targetSite=site||alias.site||(asset?asset.currentLocation||asset.site:'');
  const logins=await pmLogins(client,targetSite);
  if(!logins.length)fail(`No Project Manager is assigned to ${displaySiteName(targetSite)}. Ask an MIS administrator.`,409);
  const message=aliasOtpMessage({purpose,alias,asset,requestedBy:requester,otp,site:targetSite,counts,emergencyReason:reason});
  const delivery=await deliver({logins,message,otp,eventKey:`alias-otp:${id}`});
  if(!delivery.sentTo.length)fail(`${displaySiteName(targetSite)} PM has no Telegram or mobile registered. ${(delivery.failures||[]).join(' ')}`.trim(),409);
  sentTo=delivery.sentTo;channels=delivery.channels;
 }
 if(live)await client.query("UPDATE mis_equipment_alias_otps SET status='cancelled' WHERE id=$1",[live.id]);
 const row=(await client.query('INSERT INTO mis_equipment_alias_otps(id,alias_id,purpose,route,reason,requested_by,sent_to,channels,otp_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[id,alias.id,purpose,route,reason,login(requestedBy),sentTo,channels,hashOtp(id,otp),expiresAt])).rows[0];
 await aliasHistory(client,alias.id,purpose==='map_equipment'?'otp_sent':'revoke_otp_sent',requestedBy,{route,sentTo,channels,reason,otpId:id});
 return row;
}

// Entering the code is the approver's decision. Either route makes the pair permanent and
// cancels the live code on the other route, so a pair is never approved twice.
export async function verifyAliasOtp(client,{aliasId,otpId,otp,login:actor,requeue=async()=>{}}){
 const alias=await lockAlias(client,aliasId);
 const row=uuid(otpId)?(await client.query('SELECT * FROM mis_equipment_alias_otps WHERE id=$1 AND alias_id=$2 FOR UPDATE',[otpId,alias.id])).rows[0]:null;
 if(!row||row.requested_by!==login(actor))fail('This approval request is no longer available. Request a new OTP.',404);
 const check=checkOtpAttempt(row,otp);
 if(!check.ok){
  if(check.status!=='missing'&&(check.status!==row.status||check.attempts!==undefined&&check.attempts!==row.attempts))await client.query('UPDATE mis_equipment_alias_otps SET status=$2,attempts=$3 WHERE id=$1',[row.id,check.status,check.attempts??row.attempts]);
  fail(check.message,400);
 }
 const used=(await client.query("UPDATE mis_equipment_alias_otps SET status='used',used_at=NOW(),approved_by=$2 WHERE id=$1 RETURNING *",[row.id,row.sent_to.join(', ')])).rows[0];
 await cancelLive(client,alias.id,row.purpose,row.id);
 let updated;
 if(row.purpose==='map_equipment'){
  updated=(await client.query("UPDATE mis_equipment_aliases SET status='active',approval_route=$2,emergency_reason=$3,otp_id=$4,approved_by=$5,approved_at=NOW(),suspended_reason=NULL,suspended_at=NULL WHERE id=$1 RETURNING *",[alias.id,row.route,row.route==='site_pm'?row.reason:null,row.id,used.approved_by])).rows[0];
  await aliasHistory(client,alias.id,'approved',actor,{route:row.route,approvedBy:used.sent_to,emergencyReason:row.route==='site_pm'?row.reason:null,otpId:row.id});
 }else{
  updated=(await client.query("UPDATE mis_equipment_aliases SET status='revoked',revoked_by=$2,revoked_at=NOW(),revoke_otp_id=$3,revoke_route=$4,revoke_reason=$5 WHERE id=$1 RETURNING *",[alias.id,used.approved_by,row.id,row.route,row.reason||null])).rows[0];
  await aliasHistory(client,alias.id,'revoked',actor,{route:row.route,approvedBy:used.sent_to,otpId:row.id});
 }
 await requeue(updated);
 return {alias:updated,otp:used};
}

export async function liveAliasOtps(client,aliasId,actor){
 const {rows}=await client.query("SELECT * FROM mis_equipment_alias_otps WHERE alias_id=$1 AND requested_by=$2 AND status='sent' AND expires_at>clock_timestamp() ORDER BY requested_at DESC",[aliasId,login(actor)]);
 return rows;
}

// Direct revoke, used when the OTP rule is off (administrators only).
export async function revokeEquipmentAlias(pool,id,revokedBy,reason=''){
 await ensureEquipmentAliases(pool);
 if(!uuid(id))fail('Invalid alias.',404);
 const row=(await pool.query("UPDATE mis_equipment_aliases SET status='revoked',revoked_by=$2,revoked_at=NOW(),revoke_route='direct',revoke_reason=$3 WHERE id=$1 AND status IN ('pending','active','suspended') RETURNING *",[id,login(revokedBy).slice(0,120)||'unknown',text(reason).slice(0,300)||null])).rows[0];
 if(!row)fail('Alias not found or already revoked.',404);
 await aliasHistory(pool,row.id,'revoked',revokedBy,{route:'direct',reason});
 return row;
}

// Held scan cards re-run their Pulse fleet check on the next batch read once an alias changes.
export const requeueHeldScanCards=pool=>pool.query("UPDATE mis_scan_cards SET raw_fields=raw_fields-'fleetReview' WHERE status IN('review','approved','error') AND jsonb_typeof(raw_fields->'fleetReview'->'issues')='array' AND jsonb_array_length(raw_fields->'fleetReview'->'issues')>0").catch(e=>{if(e?.code!=='42P01')throw e;});

// Section 7: run after every Pulse snapshot. Redundant aliases retire silently; an alias
// whose written key now names a real door of another asset at the same site is suspended,
// the matcher reports it ambiguous, and the approver plus the MIS managers are told.
export async function reconcileEquipmentAliases(pool,{telegram=null,notifyLogins=async()=>[],log=console}={}){
 const aliases=await loadEquipmentAliases(pool,{statuses:['pending','active','suspended']});
 if(!aliases.length)return {retired:0,suspended:0,restored:0};
 const masters=(await pool.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master'")).rows.map(r=>({...r.record_data,id:String(r.id)}));
 const byId=new Map(masters.map(a=>[a.id,a]));
 const result={retired:0,suspended:0,restored:0};
 for(const alias of aliases){
  const asset=byId.get(String(alias.equipment_id));
  if(!asset||asset.sourceMissing)continue;
  const key=alias.written_key,kind=alias.kind,site=recordSite(asset);
  if(assetIdentifiers(asset).some(label=>cardMachineKey(label,kind)===key)){
   await pool.query("UPDATE mis_equipment_aliases SET status='retired',retired_at=NOW() WHERE id=$1",[alias.id]);
   await aliasHistory(pool,alias.id,'retired','system',{reason:'Pulse now carries the written key as a real door',door:assetIdentifiers(asset)[0]});
   result.retired++;continue;
  }
  const shadow=masters.find(a=>a.id!==asset.id&&!a.sourceMissing&&recordSite(a)===site&&assetBookKind(a)===kind&&assetIdentifiers(a).some(label=>cardMachineKey(label,kind)===key));
  if(shadow&&alias.status!=='suspended'){
   const reason=`${alias.written_text} is now a real door (${assetIdentifiers(shadow)[0]}, record ${shadow.id}) at ${displaySiteName(site)}; the alias on ${assetIdentifiers(asset)[0]} (record ${asset.id}) is suspended until a new OTP resolves it.`;
   await pool.query("UPDATE mis_equipment_aliases SET status='suspended',suspended_reason=$2,suspended_at=NOW() WHERE id=$1",[alias.id,reason]);
   await aliasHistory(pool,alias.id,'suspended','system',{reason,shadowId:shadow.id,previousStatus:alias.status});
   result.suspended++;
   if(telegram){try{for(const target of await notifyLogins())await telegram.send(target,`Caliber Pulse: equipment alias suspended\n${reason}`,`alias-shadow:${alias.id}:${shadow.id}:${target}`);}catch(e){log?.error?.('Alias suspension alert failed:',e?.message||e);}}
  }else if(!shadow&&alias.status==='suspended'&&alias.approved_at&&!alias.suspended_reason?.includes('revoke')){
   // The collision went away (rename or transfer): the approved alias answers again.
   await pool.query("UPDATE mis_equipment_aliases SET status='active',suspended_reason=NULL,suspended_at=NULL WHERE id=$1",[alias.id]);
   await aliasHistory(pool,alias.id,'restored','system',{reason:'The shadowing door is no longer at this site'});
   result.restored++;
  }
 }
 if(result.retired||result.suspended||result.restored)await requeueHeldScanCards(pool);
 return result;
}

// Section 3: the written machines in a batch that no Pulse door answers, beside the Pulse
// equipment at the site that no card names. Three categories in order. Only equipment whose
// current Pulse location is this site appears on the left; transfer cases stay in the hold.
export function scanBatchMismatches({cards=[],assets=[],site='',kind='vehicle',aliases=[]}){
 const canonical=canonicalSiteName(site);
 const atSite=assets.filter(a=>!a.sourceMissing&&recordSite(a)===canonical);
 const vehicles=atSite.filter(a=>assetBookKind(a)==='vehicle'),equipment=atSite.filter(a=>assetBookKind(a)==='equipment');
 const live=cards.filter(card=>['review','approved','error'].includes(card.status));
 const pending=aliases.filter(a=>['pending','suspended'].includes(a.status));
 const category=(id,label,rows,pool,assetKind)=>{
  const used=new Set(),unmatched=new Map();
  for(const {written,card,field}of rows){
   if(!text(written))continue;
   const result=matchCardMachine(pool,written,site,assetKind);
   if(result.match){used.add(String(result.match.id));continue;}
   if(result.status==='missing-number'||result.status==='missing-prefix')continue;
   const key=cardMachineKey(written,assetKind);if(!key)continue;
   const entry=unmatched.get(key)||{key,written:aliasWrittenText(written),machine:describeMachine(written,assetKind),rows:0,cards:new Set(),fields:[],ambiguous:result.status==='ambiguous',candidates:result.matches.map(m=>String(m.id))};
   entry.rows++;entry.cards.add(card.id);entry.fields.push({cardId:card.id,ordinal:card.ordinal,field});unmatched.set(key,entry);
  }
  const number=value=>Number((String(value).match(/\d+/)||[0])[0]);
  const left=pool.filter(a=>!used.has(String(a.id))).map(a=>({id:String(a.id),door:assetIdentifiers(a)[0]||'',name:text(a.equipmentName||a.name),model:text(a.model||a.modelNo),make:text(a.make),site:text(a.currentLocation||a.site||a.location),number:number(assetIdentifiers(a)[0]||'')}));
  const right=[...unmatched.values()].map(entry=>{
   const alias=pending.find(a=>a.kind===assetKind&&a.written_key===entry.key);
   const ranked=[...left].sort((a,b)=>Math.abs(a.number-number(entry.key))-Math.abs(b.number-number(entry.key))||a.door.localeCompare(b.door,undefined,{numeric:true}));
   return {...entry,cards:entry.cards.size,suggestions:ranked.slice(0,5).map(a=>a.id),alias:alias?publicAlias(alias):null};
  }).sort((a,b)=>number(a.key)-number(b.key));
  return {id,label,kind:assetKind,left:left.sort((a,b)=>a.number-b.number||a.door.localeCompare(b.door)),right,pairsPending:right.length};
 };
 const categories=[];
 if(kind==='vehicle'){
  categories.push(category('tipper','Tippers (trip card header)',live.map(card=>({written:card.draft?.doorText||card.raw_fields?.door||'',card,field:'doorText'})),vehicles,'vehicle'));
  categories.push(category('body','Trip body equipment',live.flatMap(card=>[...(card.draft?.trips||[]).map((row,i)=>({written:row.equipmentSource==='master-selection'?'':row.equipmentNotation?.original||row.equipmentName||'',card,field:'trips.'+i+'.equipmentName'})),...(card.draft?.scanMachineSummary||[]).map((row,i)=>({written:row.equipmentNotation?.original||row.equipmentName||'',card,field:'scanMachineSummary.'+i+'.equipmentName'}))]),equipment,'equipment'));
 }else categories.push(category('elb','Job card equipment (header)',live.map(card=>({written:card.draft?.doorText||card.raw_fields?.door||'',card,field:'doorText'})),equipment,'equipment'));
 const open=categories.filter(c=>c.right.length);
 return {site,kind,categories,pending:open.reduce((n,c)=>n+c.right.length,0),current:open[0]?{category:open[0].id,pair:open[0].right[0]}:null};
}

// Section 10: weekly Telegram line to the approver and the MIS managers.
export async function aliasWeeklySummary(pool,{since,until}){
 const {rows}=await pool.query("SELECT site,approval_route,emergency_reason,approved_by,requested_by FROM mis_equipment_aliases WHERE approved_at>=$1 AND approved_at<$2 AND approval_route IN ('nitish','site_pm')",[since,until]);
 const bySite=new Map(),byRoute={nitish:0,site_pm:0};let selfApproved=0;
 for(const r of rows){byRoute[r.approval_route]=(byRoute[r.approval_route]||0)+1;bySite.set(r.site||'(no site)',(bySite.get(r.site||'(no site)')||0)+1);if(r.approval_route==='site_pm'&&String(r.approved_by||'').split(/,\s*/).map(login).includes(login(r.requested_by)))selfApproved++;}
 return {total:rows.length,byRoute,bySite:[...bySite].map(([site,count])=>({site:displaySiteName(site),count})),selfApproved,
  message:[`Caliber Pulse: equipment mappings this week (${formatDate(since.slice(0,10))} to ${formatDate(until.slice(0,10))})`,`Approved: ${rows.length} (approver ${byRoute.nitish||0}, emergency PM ${byRoute.site_pm||0}, PM self-approved ${selfApproved}).`,...[...bySite].map(([site,count])=>`${displaySiteName(site)}: ${count}`)].join('\n')};
}
export async function sendAliasWeeklySummary(pool,{telegram,recipients=async()=>[],now=()=>Date.now()}){
 const stamp=new Date(now());const ist=new Date(stamp.getTime()+330*60000);
 if(ist.getUTCDay()!==1||ist.getUTCHours()<9)return null;
 const weekKey=ist.toISOString().slice(0,10);
 let sent={};try{sent=(await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[ALIAS_WEEKLY_SETTING_KEY])).rows[0]?.setting_value||{};}catch(e){if(e?.code!=='42P01')throw e;}
 if(sent.lastWeek===weekKey)return null;
 const until=new Date(Date.UTC(ist.getUTCFullYear(),ist.getUTCMonth(),ist.getUTCDate())-330*60000).toISOString(),since=new Date(Date.parse(until)-7*86400000).toISOString();
 const summary=await aliasWeeklySummary(pool,{since,until});
 for(const target of await recipients())await telegram.send(target,summary.message,`alias-weekly:${weekKey}:${target}`);
 await pool.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()',[ALIAS_WEEKLY_SETTING_KEY,JSON.stringify({lastWeek:weekKey})]).catch(()=>{});
 return summary;
}

// MIS managers from the Users master (manager role "MIS Manager"), used beside the approver.
export async function misManagerLogins(client){
 const {rows}=await client.query("SELECT record_data FROM master_records WHERE master_name='Users & employees'");
 return [...new Set(rows.map(r=>r.record_data||{}).filter(u=>!u.sourceMissing&&String(u.adminLevel||u.permissions?.adminLevel||'').toLowerCase()==='manager'&&String(Array.isArray(u.managerRole)?u.managerRole.join('|'):u.managerRole||'').includes('MIS Manager')).map(u=>login(u.login)).filter(Boolean))];
}

export function registerEquipmentAliases(app,{pool,protect=[],requireAdministrator=null,audit=()=>{},onChange=()=>requeueHeldScanCards(pool),telegram=null,pmLogins=null,deliver=null,otpEnabled=aliasOtpEnabled,transaction=null}){
 const guard=Array.isArray(protect)?protect:[protect];
 const admin=requireAdministrator?[requireAdministrator]:[];
 // Prepare the tables once at start-up (outside any request transaction); write paths ensure again.
 let ready=null;const ensure=()=>ready??=ensureEquipmentAliases(pool).catch(e=>{ready=null;throw e;});void ensure().catch(()=>{});
 const handle=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store');await ensure();await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.message||'Equipment alias request failed.'});}};
 const actorOf=req=>login(req.session?.login||req.session?.name||'');
 const inTransaction=transaction||(async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}});
 const detailed=async(rows,actor)=>{
  if(!rows.length)return [];
  const ids=rows.map(r=>r.id);
  const history=(await pool.query('SELECT * FROM mis_equipment_alias_history WHERE alias_id=ANY($1::uuid[]) ORDER BY id',[ids])).rows;
  const otps=actor?(await pool.query("SELECT * FROM mis_equipment_alias_otps WHERE alias_id=ANY($1::uuid[]) AND requested_by=$2 AND status='sent' AND expires_at>clock_timestamp() ORDER BY requested_at DESC",[ids,actor])).rows:[];
  const assets=(await pool.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master' AND id=ANY($1::bigint[])",[[...new Set(rows.map(r=>Number(r.equipment_id)))]])).rows;
  const byId=new Map(assets.map(a=>[String(a.id),a.record_data]));
  return rows.map(r=>{const a=byId.get(String(r.equipment_id))||{};return publicAlias({...r,equipment_door:assetIdentifiers(a)[0]||'',equipment_name:text(a.equipmentName||a.name),equipment_site:text(a.currentLocation||a.site||a.location),history:history.filter(h=>h.alias_id===r.id).map(h=>({id:h.id,action:h.action,actor:h.actor,detail:h.detail,at:h.at})),otps:otps.filter(o=>o.alias_id===r.id).map(publicAliasOtp)});});
 };
 const settings=async()=>{const approver=await readAliasApprover(pool);return {otpEnabled:otpEnabled(),approver,approverTelegramLinked:await approverTelegramLinked(pool,approver.login),routes:ALIAS_ROUTES,emergencyReasons:EMERGENCY_REASONS};};
 app.get('/api/equipment-aliases/settings',...guard,handle(async(req,res)=>res.json(await settings())));
 app.put('/api/equipment-aliases/settings',...guard,...admin,handle(async(req,res)=>{
  const approver=await writeAliasApprover(pool,req.body?.approver||req.body||{});
  audit(req,{action:'Equipment mapping approver changed',reference:approver.login,details:approver});
  res.json(await settings());
 }));
 app.get('/api/equipment-aliases',...guard,handle(async(req,res)=>{
  await ensureEquipmentAliases(pool);
  const all=req.query.all==='1',site=canonicalSiteName(String(req.query.site||''));
  const rows=(await pool.query(`SELECT * FROM mis_equipment_aliases WHERE ($1::boolean OR status IN ('pending','active','suspended')) ORDER BY created_at DESC`,[all])).rows.filter(r=>!site||canonicalSiteName(r.site)===site);
  res.json({...(await settings()),aliases:await detailed(rows,actorOf(req))});
 }));
 app.post('/api/equipment-aliases',...guard,handle(async(req,res)=>{
  const result=await createEquipmentAlias(pool,{...req.body,requestedBy:actorOf(req),otp:otpEnabled()});
  if(result.alias&&result.created){audit(req,{action:result.alias.status==='active'?'Equipment alias created':'Equipment alias requested',reference:result.alias.written_text+' → equipment '+result.alias.equipment_id,details:publicAlias(result.alias)});if(result.alias.status==='active')await onChange(result.alias);}
  res.status(result.created?201:200).json({alias:result.alias?(await detailed([result.alias],actorOf(req)))[0]:null,created:Boolean(result.created),redundant:Boolean(result.redundant),otpRequired:Boolean(result.alias&&result.alias.status==='pending')});
 }));
 app.post('/api/equipment-aliases/:id/otp',...guard,handle(async(req,res)=>{
  if(!otpEnabled())fail('Mapping approval by OTP is switched off on this server.',409);
  const purpose=req.body?.purpose==='revoke_alias'?'revoke_alias':'map_equipment';
  const approver=await readAliasApprover(pool);
  const row=await inTransaction(client=>issueAliasOtp(client,{aliasId:req.params.id,purpose,route:String(req.body?.route||''),emergencyReason:req.body?.emergencyReason,emergencyNote:req.body?.emergencyNote,requestedBy:actorOf(req),requesterName:req.session?.name||actorOf(req),site:req.body?.site||'',counts:req.body?.counts||null,approver,telegram,pmLogins,deliver}));
  audit(req,{action:'Equipment alias OTP sent',reference:req.params.id,details:publicAliasOtp(row)});
  res.json({otp:publicAliasOtp(row)});
 }));
 app.post('/api/equipment-aliases/:id/otp/:otpId/verify',...guard,handle(async(req,res)=>{
  const result=await inTransaction(client=>verifyAliasOtp(client,{aliasId:req.params.id,otpId:req.params.otpId,otp:req.body?.otp,login:actorOf(req)}));
  await onChange(result.alias);
  audit(req,{action:result.alias.status==='revoked'?'Equipment alias revoked':'Equipment alias approved',reference:result.alias.written_text+' → equipment '+result.alias.equipment_id,details:publicAlias(result.alias)});
  res.json({alias:(await detailed([result.alias],actorOf(req)))[0],approved:result.alias.status==='active',revoked:result.alias.status==='revoked'});
 }));
 app.delete('/api/equipment-aliases/:id',...guard,...admin,handle(async(req,res)=>{
  if(otpEnabled())fail('Revoking a mapping needs an OTP: request one from the Equipment master ALIAS column.',409);
  const row=await revokeEquipmentAlias(pool,req.params.id,actorOf(req),req.body?.reason||'');
  audit(req,{action:'Equipment alias revoked',reference:row.written_text+' → equipment '+row.equipment_id,details:publicAlias(row)});await onChange(row);
  res.json({alias:publicAlias(row)});
 }));
}
