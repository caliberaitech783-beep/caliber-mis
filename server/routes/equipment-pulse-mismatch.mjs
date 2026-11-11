import {compareEquipmentWithPulse,equipmentMismatchMessage} from '../../shared/equipment-pulse-mismatch.mjs';
import {canonicalSiteName,equipmentSiteName} from '../../shared/site-location.mjs';
import {siteAllowed} from '../../shared/log-book-access.mjs';
import {isMisAdministrator} from '../../shared/mis-admin-access.mjs';
import {capacityRegionLocations} from './production-report-api.mjs';

// Equipment list check. Every few hours (six by default) the equipment list behind the Equipment
// Deployment report is compared with the equipment list read from Pulse at that moment. A
// difference raises a pop-up notice in Pulse-II and a Telegram message (WhatsApp when switched on),
// and the same check repeats, and so the notice returns, until the two lists agree.
// One row per time slot with a unique key, so a restart or a second server never repeats a check.

export const EQUIPMENT_MISMATCH_SETTING_KEY='equipment_pulse_mismatch';
export const EQUIPMENT_MISMATCH_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_equipment_mismatch_runs(
  id BIGSERIAL PRIMARY KEY,slot_key TEXT UNIQUE NOT NULL,trigger_type TEXT NOT NULL DEFAULT 'scheduled',requested_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',matches BOOLEAN,machine_count INTEGER NOT NULL DEFAULT 0,result JSONB,error TEXT NOT NULL DEFAULT '',
  telegram_sent INTEGER NOT NULL DEFAULT 0,whatsapp_sent INTEGER NOT NULL DEFAULT 0,delivery_note TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),checked_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS mis_equipment_mismatch_seen(
  run_id BIGINT NOT NULL REFERENCES mis_equipment_mismatch_runs(id) ON DELETE CASCADE,login_name TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(run_id,login_name));`;
export const DEFAULT_MISMATCH_SETTINGS=Object.freeze({enabled:true,intervalHours:6,popup:true,telegram:true,whatsapp:false,logins:[]});
const INTERVALS=[1,2,3,4,6,8,12,24];
const HOUR=3600000,RETRY_MS=30*60000,MANUAL_GAP_MS=2*60000;

const text=value=>String(value??'').trim();
const loginOf=value=>text(value).toLowerCase();
export function normalizeMismatchSettings(input={}){
 const flag=(key)=>input[key]===undefined?DEFAULT_MISMATCH_SETTINGS[key]:input[key]===true;
 const hours=Number(input.intervalHours);
 return {enabled:flag('enabled'),intervalHours:INTERVALS.includes(hours)?hours:DEFAULT_MISMATCH_SETTINGS.intervalHours,
  popup:flag('popup'),telegram:flag('telegram'),whatsapp:flag('whatsapp'),
  logins:[...new Set((Array.isArray(input.logins)?input.logins:String(input.logins||'').split(/[,\s;]+/)).map(loginOf).filter(Boolean))].slice(0,30)};
}
export async function readMismatchSettings(pool){
 try{return normalizeMismatchSettings((await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[EQUIPMENT_MISMATCH_SETTING_KEY])).rows[0]?.setting_value||{});}
 catch{return normalizeMismatchSettings({});}
}
export async function writeMismatchSettings(pool,input){
 const settings=normalizeMismatchSettings(input);
 await pool.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()',[EQUIPMENT_MISMATCH_SETTING_KEY,JSON.stringify(settings)]);
 return settings;
}

const indiaParts=ms=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(part=>[part.type,part.value]));
export const indiaStamp=ms=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ms)).replace(/\//g,'-').replace(',','');
// The slot a moment belongs to: India calendar date plus the block of hours, e.g. 2026-11-11 block 3 of 6 hours = 18:00 to 24:00.
export function mismatchSlot(nowMs,intervalHours){
 const parts=indiaParts(nowMs);
 return `scheduled:${parts.year}-${parts.month}-${parts.day}:${intervalHours}h:${Math.floor(Number(parts.hour)/intervalHours)}`;
}

// Pulse-II equipment with the Pulse record each one is linked to. Vehicles that come from Pulse's
// separate LMV Master are left out: the Pulse equipment list this check reads does not carry them.
export async function readLocalEquipment(pool){
 const {rows}=await pool.query(`SELECT m.id,m.record_data,l.master_name AS link_master,l.source_id
  FROM master_records m LEFT JOIN pulse_master_links l ON l.local_id=m.id AND l.master_name IN ('Equipment master','LMV master')
  WHERE m.master_name='Equipment master' ORDER BY m.id`);
 return rows.filter(row=>row.link_master!=='LMV master').map(row=>({...row.record_data,pulseId:row.link_master==='Equipment master'?text(row.source_id):''}));
}
async function readLocations(pool,assets,pulseAssets){
 const {rows}=await pool.query("SELECT id,master_name,record_data FROM master_records WHERE master_name='Region master' ORDER BY id");
 return [...new Map([...capacityRegionLocations(rows),...[...assets,...pulseAssets].map(asset=>equipmentSiteName(asset)||asset.siteName)]
  .filter(Boolean).map(site=>[canonicalSiteName(site),site])).values()];
}

// A site-limited user sees only the lines of the sites they may open.
export function scopedMismatchResult(result,scope){
 if(!result)return null;
 const machines=(result.machines||[]).filter(machine=>[machine.pulseIISite,machine.pulseSite].filter(Boolean).some(site=>siteAllowed(scope,site)));
 const counts=(result.counts||[]).filter(row=>siteAllowed(scope,row.site));
 return {...result,machines,counts,matches:!machines.length&&!counts.length};
}

export function createEquipmentMismatchWorker({pool,pulse,telegram=null,whatsapp=null,defaultLogins=async()=>[],ensureSchema=async()=>{},now=()=>Date.now(),intervalMs=5*60000,log=console}){
 let ready,running=false,timer;
 const ensure=()=>ready??=(async()=>{await ensureSchema();await pool.query(EQUIPMENT_MISMATCH_SCHEMA);})().catch(e=>{ready=null;throw e;});
 const recipients=async settings=>settings.logins.length?settings.logins:[...new Set((await defaultLogins().catch(()=>[])).map(loginOf).filter(Boolean))];
 async function claim(slot,trigger,by){
  const inserted=(await pool.query('INSERT INTO mis_equipment_mismatch_runs(slot_key,trigger_type,requested_by) VALUES($1,$2,$3) ON CONFLICT(slot_key) DO NOTHING RETURNING id',[slot,trigger,by])).rows[0];
  if(inserted)return inserted.id;
  // A check that could not reach Pulse is tried again after half an hour, inside the same slot.
  return (await pool.query("UPDATE mis_equipment_mismatch_runs SET status='running',started_at=NOW(),error='' WHERE slot_key=$1 AND (status='failed' OR status='running') AND started_at<NOW()-($2::text||' milliseconds')::interval RETURNING id",[slot,String(RETRY_MS)])).rows[0]?.id||null;
 }
 async function deliver(settings,result,slot,nowMs){
  const message='Caliber Pulse-II\n'+equipmentMismatchMessage(result,{checkedAt:indiaStamp(nowMs)})+'\nhttps://pulse-ll.cmll.in/?page=equipment-deployment';
  const logins=await recipients(settings),notes=[];let telegramSent=0,whatsappSent=0;
  if(!logins.length)notes.push('No recipient is set and no MIS manager was found.');
  for(const to of logins){
   if(settings.telegram&&telegram){
    try{if(await telegram.send(to,message,`equipment-mismatch:${slot}:${to}`))telegramSent++;else notes.push(`${to}: Telegram not linked`);}
    catch(error){notes.push(`${to}: Telegram ${error.message}`);}
   }
   if(settings.whatsapp&&whatsapp){
    try{if(await whatsapp.send(to,message))whatsappSent++;else notes.push(`${to}: no WhatsApp number`);}
    catch(error){notes.push(`${to}: WhatsApp ${error.message}`);}
   }
  }
  return {telegramSent,whatsappSent,note:notes.join('; ').slice(0,900)};
 }
 async function check({slot,trigger,by='',notify=true,settings}){
  const id=await claim(slot,trigger,by);
  if(!id)return {skipped:true};
  const nowMs=now();
  try{
   const pulseAssets=await pulse.readEquipmentList();
   const localAssets=await readLocalEquipment(pool);
   const result=compareEquipmentWithPulse({localAssets,pulseAssets,locations:await readLocations(pool,localAssets,pulseAssets)});
   const delivery=notify&&!result.matches?await deliver(settings,result,slot,nowMs):{telegramSent:0,whatsappSent:0,note:''};
   await pool.query("UPDATE mis_equipment_mismatch_runs SET status='done',matches=$2,machine_count=$3,result=$4::jsonb,error='',telegram_sent=$5,whatsapp_sent=$6,delivery_note=$7,checked_at=$8 WHERE id=$1",
    [id,result.matches,result.machines.length,JSON.stringify(result),delivery.telegramSent,delivery.whatsappSent,delivery.note,new Date(nowMs).toISOString()]);
   await pool.query("DELETE FROM mis_equipment_mismatch_runs WHERE started_at<NOW()-INTERVAL '120 days'");
   return {id:String(id),matches:result.matches,machines:result.machines.length,...delivery};
  }catch(error){
   await pool.query("UPDATE mis_equipment_mismatch_runs SET status='failed',error=$2,checked_at=NOW() WHERE id=$1",[id,text(error.message).slice(0,300)||'The check could not be completed.']).catch(()=>{});
   throw error;
  }
 }
 async function runOnce(){
  if(running)return {skipped:true};running=true;
  try{
   await ensure();
   const settings=await readMismatchSettings(pool);
   if(!settings.enabled)return {disabled:true};
   // Without a Pulse connection there is nothing to compare with; the slot stays open for the next tick.
   if(pulse.status&&!pulse.status().connected)return {waiting:true};
   return await check({slot:mismatchSlot(now(),settings.intervalHours),trigger:'scheduled',settings});
  }finally{running=false;}
 }
 async function runNow(by){
  await ensure();
  const recent=(await pool.query("SELECT 1 FROM mis_equipment_mismatch_runs WHERE trigger_type='manual' AND started_at>NOW()-($1::text||' milliseconds')::interval LIMIT 1",[String(MANUAL_GAP_MS)])).rows[0];
  if(recent)throw Object.assign(new Error('A check was run a moment ago. Wait two minutes before checking again.'),{status:429});
  return check({slot:`manual:${new Date(now()).toISOString()}`,trigger:'manual',by:loginOf(by),notify:false,settings:await readMismatchSettings(pool)});
 }
 const start=()=>{if(timer)return;const tick=()=>void runOnce().catch(e=>log.error?.('Equipment list check:',e.code||e.message));tick();timer=setInterval(tick,intervalMs);timer.unref?.();};
 const stop=()=>{if(timer)clearInterval(timer);timer=undefined;};
 return {runOnce,runNow,start,stop,ensure,recipients};
}

const RUN_COLUMNS='id::text AS id,trigger_type AS "trigger",requested_by AS "requestedBy",status,matches,machine_count AS "machineCount",error,telegram_sent AS "telegramSent",whatsapp_sent AS "whatsappSent",delivery_note AS "deliveryNote",started_at AS "startedAt",checked_at AS "checkedAt"';
export function registerEquipmentMismatch(app,{pool,protect,worker}){
 const guard=Array.isArray(protect)?protect:[protect];
 const handle=fn=>async(req,res,next)=>{try{req.audit=false;res.set('Cache-Control','private, no-store');await worker.ensure();await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
 const login=req=>loginOf(req.session?.login);
 const latestDone=async()=>(await pool.query(`SELECT ${RUN_COLUMNS},result FROM mis_equipment_mismatch_runs WHERE status='done' ORDER BY checked_at DESC LIMIT 1`)).rows[0]||null;
 // The latest finished check with its full lists, plus the latest attempt when that one failed.
 app.get('/api/reports/equipment-pulse-mismatch',...guard,handle(async(req,res)=>{
  const settings=await readMismatchSettings(pool),run=await latestDone();
  const last=(await pool.query(`SELECT ${RUN_COLUMNS} FROM mis_equipment_mismatch_runs ORDER BY started_at DESC LIMIT 1`)).rows[0]||null;
  const result=scopedMismatchResult(run?.result,req.logBookScope);
  res.json({settings:{enabled:settings.enabled,intervalHours:settings.intervalHours},canCheck:isMisAdministrator(req.session),
   run:run?{...run,result,matches:result.matches,machineCount:result.machines.length}:null,lastAttempt:last&&last.id!==run?.id?last:null});
 }));
 app.post('/api/reports/equipment-pulse-mismatch/check',...guard,handle(async(req,res)=>{
  if(!isMisAdministrator(req.session))return res.status(403).json({error:'Only an administrator can run the check now.'});
  try{res.json(await worker.runNow(login(req)));}
  catch(e){if(e.status)throw e;res.status(502).json({error:'Pulse could not be read: '+(text(e.message)||'no reply')+' The next automatic check will try again.'});}
 }));
 // The pop-up: the newest scheduled check that found a difference, until this user has pressed OK on it.
 app.get('/api/reports/equipment-pulse-mismatch/notice',...guard,handle(async(req,res)=>{
  const settings=await readMismatchSettings(pool);
  if(!settings.enabled||!settings.popup)return res.json({notice:null});
  const user=login(req);
  if(!isMisAdministrator(req.session)&&!(await worker.recipients(settings)).includes(user))return res.json({notice:null});
  const run=(await pool.query(`SELECT ${RUN_COLUMNS},result FROM mis_equipment_mismatch_runs r WHERE status='done' AND trigger_type='scheduled' ORDER BY checked_at DESC LIMIT 1`)).rows[0];
  if(!run||run.matches||Date.now()-new Date(run.checkedAt).getTime()>settings.intervalHours*2*HOUR)return res.json({notice:null});
  if((await pool.query('SELECT 1 FROM mis_equipment_mismatch_seen WHERE run_id=$1 AND login_name=$2',[run.id,user])).rows[0])return res.json({notice:null});
  const result=scopedMismatchResult(run.result,req.logBookScope);
  if(result.matches)return res.json({notice:null});
  res.json({notice:{id:run.id,checkedAt:run.checkedAt,intervalHours:settings.intervalHours,pulseIITotal:result.pulseIITotal,pulseTotal:result.pulseTotal,
   byKind:Object.fromEntries(Object.keys(result.byKind||{}).map(kind=>[kind,result.machines.filter(machine=>machine.kind===kind).length])),
   machineCount:result.machines.length,machines:result.machines.slice(0,8),counts:result.counts.slice(0,8)}});
 }));
 app.post('/api/reports/equipment-pulse-mismatch/notice/seen',...guard,handle(async(req,res)=>{
  const id=text(req.body?.id);
  if(!/^\d{1,18}$/.test(id))return res.status(400).json({error:'Invalid notice.'});
  await pool.query('INSERT INTO mis_equipment_mismatch_seen(run_id,login_name) SELECT id,$2 FROM mis_equipment_mismatch_runs WHERE id=$1 ON CONFLICT DO NOTHING',[id,login(req)]);
  res.json({ok:true});
 }));
}
