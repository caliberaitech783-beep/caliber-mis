import {canonicalSiteName} from './site-location.mjs';
import {displaySiteName,userSiteScope} from './region-scope.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
import {OPERATIONAL_START} from './operational-start.mjs';
import {stageLabel,batchStage} from './vlb-two-stage.mjs';

// Late VLB batch alerts. A minute worker compares every site shift in the Shift Master
// with the batches that exist, and tells the site Project Managers and the production
// head by Telegram when a shift's batch was not created, or is still open, some hours
// after the shift ended. Every message goes through the MIS Telegram outbox with an
// event key, so a restart or a second instance never sends the same alert twice.

export const VLB_BATCH_ALERT_SETTING_KEY='vlb_batch_alerts';
export const VLB_BATCH_ALERT_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_vlb_batch_alert_state(
  alert_key TEXT PRIMARY KEY,site TEXT NOT NULL,book_date DATE NOT NULL,shift TEXT NOT NULL,alert_type TEXT NOT NULL,
  first_sent_at TIMESTAMPTZ,last_sent_at TIMESTAMPTZ,sent_count INTEGER NOT NULL DEFAULT 0,recipients TEXT[] NOT NULL DEFAULT '{}',
  last_error TEXT NOT NULL DEFAULT '',cleared_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`;
export const DEFAULT_ALERT_SETTINGS=Object.freeze({enabled:true,createdByHours:2,closedByHours:6,reminderHours:2,productionHeadLogins:[],pulseAdminLogins:[]});
export const SHIFT_LABELS={S1:'I',S2:'II',S3:'III',D:'Day',N:'Night'};

const text=value=>String(value??'').trim();
const login=value=>text(value).toLowerCase();
const IST_OFFSET='+05:30';
const DAY=86400000;
const clock=value=>{const m=text(value).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);return m&&Number(m[1])<24&&Number(m[2])<60?`${m[1].padStart(2,'0')}:${m[2]}:${m[3]||'00'}`:'';};

export function normalizeAlertSettings(input={}){
 const hours=(value,fallback,min,max)=>{const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?Math.round(n*4)/4:fallback;};
 const list=value=>[...new Set((Array.isArray(value)?value:String(value||'').split(/[,\s;]+/)).map(login).filter(Boolean))].slice(0,20);
 return {
  enabled:input.enabled===undefined?DEFAULT_ALERT_SETTINGS.enabled:Boolean(input.enabled),
  createdByHours:hours(input.createdByHours,DEFAULT_ALERT_SETTINGS.createdByHours,0.25,48),
  closedByHours:hours(input.closedByHours,DEFAULT_ALERT_SETTINGS.closedByHours,0.25,72),
  reminderHours:hours(input.reminderHours,DEFAULT_ALERT_SETTINGS.reminderHours,0.5,24),
  productionHeadLogins:list(input.productionHeadLogins),
  pulseAdminLogins:list(input.pulseAdminLogins),
 };
}

// Calendar date in India for an instant.
export const indiaDate=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const indiaStamp=ms=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true}).format(new Date(ms));

// The instant a Shift Master row ends on a given calendar date (India time). Shifts that
// end at or before their start time end on the following day.
export function shiftEndInstant(row,date){
 const start=clock(row.startTime||row.start),end=clock(row.endTime||row.end);
 if(!end||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 let ms=Date.parse(`${date}T${end}${IST_OFFSET}`);
 if(!Number.isFinite(ms))return null;
 if(start&&end<=start)ms+=DAY;
 return ms;
}

// One Shift Master row per site and shift code in force on the date: dated revisions win.
export function shiftsInForce(rows,date){
 const chosen=new Map();
 for(const row of rows||[]){
  if(!row||row.sourceMissing||text(row.status).toLowerCase()==='inactive')continue;
  const site=canonicalSiteName(row.site||row.siteName),code=bookShiftCode(row.shiftCode||row.shiftName||row.shift||row.name);
  if(!site||!code||!clock(row.endTime||row.end))continue;
  if(row.effectiveFrom&&row.effectiveFrom>date)continue;
  if(row.effectiveTo&&row.effectiveTo<date)continue;
  const key=site+'|'+code,current=chosen.get(key);
  if(!current||String(row.effectiveFrom||'')>String(current.effectiveFrom||''))chosen.set(key,{...row,site:text(row.site||row.siteName),canonicalSite:site,code});
 }
 return [...chosen.values()];
}

// Which alerts are due now. Looks at today and yesterday in India, since a night shift
// and its closing deadline run past midnight.
export function dueBatchAlerts({nowMs=Date.now(),shifts=[],batches=[],settings=DEFAULT_ALERT_SETTINGS}={}){
 const today=indiaDate(nowMs),yesterday=indiaDate(nowMs-DAY),alerts=[];
 const index=new Map();
 for(const batch of batches){if(batch.deleted_at||batch.archived_at)continue;index.set(canonicalSiteName(batch.site)+'|'+String(batch.report_date||batch.book_date).slice(0,10)+'|'+batch.shift,batch);}
 for(const date of [yesterday,today]){
  if(date<OPERATIONAL_START)continue;
  for(const shift of shiftsInForce(shifts,date)){
   const end=shiftEndInstant(shift,date);if(end===null)continue;
   const createdBy=end+settings.createdByHours*3600000,closedBy=end+settings.closedByHours*3600000;
   const batch=index.get(shift.canonicalSite+'|'+date+'|'+shift.code)||null;
   const base={site:shift.site,canonicalSite:shift.canonicalSite,date,shift:shift.code,shiftEnd:end,endTime:clock(shift.endTime||shift.end)};
   if(!batch&&nowMs>=createdBy)alerts.push({...base,type:'not_created',dueAt:createdBy,key:`${shift.canonicalSite}|${date}|${shift.code}|not_created`,batch:null});
   if(batch&&!batch.closed_at&&nowMs>=closedBy)alerts.push({...base,type:'not_closed',dueAt:closedBy,key:`${shift.canonicalSite}|${date}|${shift.code}|not_closed`,batch:{id:batch.id,name:batch.name,stage:batchStage(batch),cards:Number(batch.card_count)||0,owner:text(batch.amendment_by||batch.creator_login||batch.created_by)}});
  }
 }
 return alerts.sort((a,b)=>a.dueAt-b.dueAt||a.key.localeCompare(b.key));
}

export function alertMessage(alert,{nowMs=Date.now(),sequence=1}={}){
 const hours=Math.max(0,Math.round((nowMs-alert.shiftEnd)/360000)/10),site=displaySiteName(alert.site),label=SHIFT_LABELS[alert.shift]||alert.shift;
 const when=`${hours} h after shift end (${indiaStamp(alert.shiftEnd)})`;
 const body=alert.type==='not_created'
  ?`No VLB batch has been created ${when}. Open Site batches to create it.`
  :`VLB batch ${alert.batch.name} is still open (${stageLabel(alert.batch.stage)}, ${alert.batch.cards} card${alert.batch.cards===1?'':'s'}${alert.batch.owner?', owner '+alert.batch.owner:''}) ${when}. Open Site batches to close it.`;
 return `Pulse-II: ${site}, ${alert.date}, shift ${label}. ${body}${sequence>1?` Reminder ${sequence}.`:''}`;
}

const readShiftRows=async pool=>(await pool.query("SELECT record_data FROM master_records WHERE master_name='Shift Master'")).rows.map(r=>r.record_data||{});
const readBatches=async(pool,dates)=>(await pool.query(`SELECT b.id,b.name,b.site,b.book_date::text AS report_date,b.shift,b.closed_at,b.archived_at,b.deleted_at,b.stage,b.creator_login,b.created_by,b.amendment_by,
 (SELECT count(*) FROM mis_vlb_batch_entries e WHERE e.batch_id=b.id) AS card_count FROM mis_vlb_batches b WHERE b.book_date=ANY($1::date[])`,[dates])).rows;
async function misUsersAtSite(pool,site){
 const canonical=canonicalSiteName(site),{rows}=await pool.query("SELECT record_data FROM master_records WHERE master_name='Users & employees'");
 return rows.map(r=>r.record_data||{}).filter(user=>{const roles=[user.userGroup,...(Array.isArray(user.userRoles)?user.userRoles:[])].map(text);return roles.includes('MIS User')&&userSiteScope(user).sites.includes(canonical);}).map(user=>login(user.login)).filter(Boolean);
}

export async function readAlertSettings(pool){
 try{const {rows}=await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[VLB_BATCH_ALERT_SETTING_KEY]);return normalizeAlertSettings(rows[0]?.setting_value||{});}
 catch{return normalizeAlertSettings({});}
}
export async function writeAlertSettings(pool,input){
 const settings=normalizeAlertSettings(input);
 await pool.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()',[VLB_BATCH_ALERT_SETTING_KEY,JSON.stringify(settings)]);
 return settings;
}

export function createVlbBatchAlertWorker({pool,telegram,pmLogins,ensureSchema=async()=>{},readSettings=()=>readAlertSettings(pool),now=()=>Date.now(),intervalMs=60000,log=console,pendingReminder=null}){
 let ready,running=false,timer;
 const ensure=()=>ready??=(async()=>{await ensureSchema();await pool.query(VLB_BATCH_ALERT_SCHEMA);})().catch(e=>{ready=null;throw e;});
 async function recipientsFor(alert,settings){
  const pms=await pmLogins(pool,alert.site).catch(()=>[]);
  const logins=new Set([...pms.map(login),...settings.productionHeadLogins]);
  if(!logins.size)for(const user of await misUsersAtSite(pool,alert.site))logins.add(user);
  return [...logins].filter(Boolean);
 }
 async function deliver(alert,settings,sequence,nowMs){
  const recipients=await recipientsFor(alert,settings),message=alertMessage(alert,{nowMs,sequence}),delivered=[],failures=[];
  for(const to of recipients){
   try{if(await telegram.send(to,message,`vlb-alert:${alert.key}:${sequence}`))delivered.push(to);}
   catch(error){failures.push(`${to}: ${error.message}`);}
  }
  const error=!recipients.length?'No site Project Manager, production head or MIS user is configured for this site.':!delivered.length?'No recipient has linked Telegram yet.':failures.join('; ');
  return {recipients,delivered,error};
 }
 async function runOnce(){
  if(running)return {skipped:true};running=true;
  try{
   await ensure();
   const settings=await readSettings(),nowMs=now();
   // The daily "pending in Pulse" reminder rides on the same worker and is independent of the batch alerts switch.
   if(pendingReminder&&settings.pulseAdminLogins.length)await pendingReminder({pool,telegram,logins:settings.pulseAdminLogins,nowMs}).catch(e=>log.error?.('Pending in Pulse reminder:',e.code||e.message));
   if(!settings.enabled)return {disabled:true,sent:0,cleared:0};
   const dates=[indiaDate(nowMs-DAY),indiaDate(nowMs)];
   const alerts=dueBatchAlerts({nowMs,shifts:await readShiftRows(pool),batches:await readBatches(pool,dates),settings});
   const active=new Set(alerts.map(a=>a.key));
   const states=new Map((await pool.query('SELECT * FROM mis_vlb_batch_alert_state WHERE cleared_at IS NULL OR book_date=ANY($1::date[])',[dates])).rows.map(r=>[r.alert_key,r]));
   let sent=0,cleared=0;
   for(const alert of alerts){
    const state=states.get(alert.key);
    const lastSent=state?.last_sent_at&&!state.cleared_at?new Date(state.last_sent_at).getTime():null;
    const due=!state||state.cleared_at||state.sent_count===0||nowMs-lastSent>=settings.reminderHours*3600000;
    if(!due)continue;
    const sequence=state&&!state.cleared_at?Number(state.sent_count)+1:1;
    const result=await deliver(alert,settings,sequence,nowMs);
    const stamp=new Date(nowMs).toISOString(),delivered=result.delivered.length>0;
    await pool.query(`INSERT INTO mis_vlb_batch_alert_state(alert_key,site,book_date,shift,alert_type,first_sent_at,last_sent_at,sent_count,recipients,last_error,cleared_at)
     VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,NULL)
     ON CONFLICT(alert_key) DO UPDATE SET first_sent_at=CASE WHEN mis_vlb_batch_alert_state.cleared_at IS NULL THEN COALESCE(mis_vlb_batch_alert_state.first_sent_at,EXCLUDED.first_sent_at) ELSE EXCLUDED.first_sent_at END,
      last_sent_at=CASE WHEN $7>0 THEN EXCLUDED.last_sent_at ELSE mis_vlb_batch_alert_state.last_sent_at END,
      sent_count=CASE WHEN mis_vlb_batch_alert_state.cleared_at IS NULL THEN mis_vlb_batch_alert_state.sent_count+$7 ELSE $7 END,
      recipients=EXCLUDED.recipients,last_error=EXCLUDED.last_error,cleared_at=NULL`,
     [alert.key,alert.site,alert.date,alert.shift,alert.type,delivered?stamp:null,delivered?1:0,result.delivered,result.error]);
    if(delivered)sent++;
   }
   for(const [key,state] of states){if(!active.has(key)&&!state.cleared_at){await pool.query('UPDATE mis_vlb_batch_alert_state SET cleared_at=$2 WHERE alert_key=$1',[key,new Date(nowMs).toISOString()]);cleared++;}}
   return {sent,cleared,due:alerts.length};
  }finally{running=false;}
 }
 const start=()=>{if(timer)return;timer=setInterval(()=>void runOnce().catch(e=>log.error?.('VLB batch alerts:',e.code||e.message)),intervalMs);timer.unref?.();};
 const stop=()=>{if(timer)clearInterval(timer);timer=undefined;};
 return {runOnce,start,stop,ensure};
}

export function registerVlbBatchAlertSettings(app,{pool,requireSession,requireAdministrator,worker=null}){
 const guard=[requireSession,requireAdministrator];
 app.get('/api/vlb-batch-alerts/settings',...guard,async(req,res,next)=>{try{req.audit=false;res.set('Cache-Control','no-store').json(await readAlertSettings(pool));}catch(e){next(e);}});
 app.put('/api/vlb-batch-alerts/settings',...guard,async(req,res,next)=>{try{
  const input=req.body||{};
  for(const key of ['createdByHours','closedByHours','reminderHours'])if(input[key]!==undefined&&!Number.isFinite(Number(input[key])))return res.status(400).json({error:'Enter the alert hours as numbers.'});
  if(input.productionHeadLogins!==undefined&&!Array.isArray(input.productionHeadLogins)&&typeof input.productionHeadLogins!=='string')return res.status(400).json({error:'Enter production head logins separated by commas.'});
  const settings=await writeAlertSettings(pool,{...await readAlertSettings(pool),...input});
  res.set('Cache-Control','no-store').json(settings);
 }catch(e){next(e);}});
 app.get('/api/vlb-batch-alerts/state',...guard,async(req,res,next)=>{try{
  req.audit=false;await worker?.ensure?.();
  const {rows}=await pool.query('SELECT alert_key,site,book_date::text AS date,shift,alert_type AS type,first_sent_at,last_sent_at,sent_count,recipients,last_error,cleared_at FROM mis_vlb_batch_alert_state ORDER BY cleared_at NULLS FIRST,book_date DESC,site,shift LIMIT 200');
  res.set('Cache-Control','no-store').json({alerts:rows.map(r=>({...r,site:displaySiteName(r.site)}))});
 }catch(e){next(e);}});
 app.post('/api/vlb-batch-alerts/run',...guard,async(req,res,next)=>{try{res.json(await worker.runOnce());}catch(e){next(e);}});
}
