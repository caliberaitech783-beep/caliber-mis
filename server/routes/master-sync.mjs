import {PULSE_LMV_MASTER,PULSE_REGION_MASTER} from './pulse-master-sync.mjs';
import {MASTER_SYNC_INTERVAL_MS} from '../rules/master-sync-schedule.mjs';
import {HR_EMPLOYEE_MASTER,HR_EMPLOYEE_TRANSFER} from '../services/hr-employee-sync.mjs';

// Owner, 23 Nov 2026: HR Pulse (hrpulse.cmll.in) is the final authority for Employee Master, and Pulse-II copies every
// change within a minute. That replaces his morning order of the same day ("do not sync Employee Master").
//  - Employee Master: a person looks at the Preview of the whole list and applies it once; after that the changes are
//    copied every minute (server/services/hr-employee-minute-copy.mjs). "Sync all masters" and the hourly run leave it.
//  - Employee Transfer: copied every hour and on Sync, and within a minute when HR approves a new one.
// Employee Master is never copied from Oracle / ERP.
export const MASTER_SYNC_ROWS=[{name:'Users & employees',label:'Login Details',source:'Pulse'},{name:'Equipment master',label:'Equipment Master',source:'Pulse'},{name:PULSE_LMV_MASTER,label:'LMV Master',source:'Pulse'},{name:PULSE_REGION_MASTER,label:'Region / Site Master',source:'Pulse'},{name:'Shift Master',label:'Shift Master',source:'Pulse'},{name:HR_EMPLOYEE_MASTER,label:'Employee Master',source:'HR',preview:true,minute:true},{name:HR_EMPLOYEE_TRANSFER,label:'Employee Transfer',source:'HR',preview:true},{name:'Work Order master',label:'Work Contract Master',source:'Oracle'},{name:'Financial Year master',label:'Financial Year Master',source:'Oracle'},{name:'Company master',label:'Company Master',source:'Oracle'}];
export const HR_SYNC_ROWS=MASTER_SYNC_ROWS.filter(row=>row.source==='HR');
// The masters the hour and "Sync all masters" copy: Employee Master is not among them, it has its own minute copy.
const HOURLY_HR_ROWS=HR_SYNC_ROWS.filter(row=>!row.minute);
export const MASTERS_NOT_SYNCED=[];
export const HR_SYNC_ACTOR='Hourly HR sync';
export const HR_MINUTE_ACTOR='HR sync';
export const EMPLOYEE_MASTER_NEEDS_PREVIEW='Open Preview, look at the changes and apply them. After that Employee Master is copied from HR Pulse every minute.';
// Several server instances: an hourly run that finds a success newer than this leaves the copy to the other.
const HR_RECENT_MS=MASTER_SYNC_INTERVAL_MS-5*60*1000;
const MINUTE_MS=60*1000;
const unavailableHr={configured:()=>false,count:async()=>null,preview:async()=>{throw Object.assign(new Error('HR connection is not set up (HR_SYNC_KEY).'),{status:503})},sync:async()=>{throw new Error('HR connection is not set up (HR_SYNC_KEY).')}};

// copy: the minute copy of Employee Master (createHrEmployeeMinuteCopy); outbox: the site moves made here that go to
// HR Pulse (createHrSiteMoveOutbox). Each is null where it is not set up.
export function registerMasterSync(app,{pool,pulse,erp,hr=unavailableHr,copy=null,outbox=null,requireSession,requireAdministrator}){let busy=false;const protect=[requireSession,requireAdministrator];const ensure=()=>pool.query('CREATE TABLE IF NOT EXISTS mis_master_sync_state(master_name TEXT PRIMARY KEY,last_success TIMESTAMPTZ,error TEXT NOT NULL DEFAULT \'\')');
 const status=async()=>{
  await ensure();
  const p=pulse.status(),e=await erp.status().catch(()=>({configured:false,busy:false,error:'Oracle connection is unavailable. Pulse connection remains available.'}));
  const counts=(await pool.query(`
    SELECT master_name,count(*) n FROM master_records WHERE master_name=ANY($1::text[]) GROUP BY master_name
    UNION ALL
    SELECT master_name,count(*) n FROM pulse_master_links WHERE master_name=$2 GROUP BY master_name
  `,[MASTER_SYNC_ROWS.map(r=>r.name).filter(name=>name!==PULSE_LMV_MASTER&&name!==HR_EMPLOYEE_TRANSFER),PULSE_LMV_MASTER])).rows;
  const transfers=await hr.count(HR_EMPLOYEE_TRANSFER).catch(()=>null);
  const events=(await pool.query('SELECT * FROM mis_master_sync_state')).rows;
  const employeeCopy=copy?await copy.status().catch(()=>null):null;
  const siteMovesToHr=outbox?await outbox.status().catch(()=>null):null;
  const masters=MASTER_SYNC_ROWS.map(row=>{
   const event=events.find(entry=>entry.master_name===row.name);
   const count=row.name===HR_EMPLOYEE_TRANSFER?Number(transfers||0):Number(counts.find(entry=>entry.master_name===row.name)?.n||0);
   // Employee Master: the last minute that copied without a fault; its line says why when it stopped.
   if(row.minute)return {...row,count,connected:hr.configured(),lastSuccess:employeeCopy?.lastOkAt||event?.last_success||null,nextSync:null,error:employeeCopy?.stopped?.reason||employeeCopy?.error||event?.error||''};
   if(row.source==='HR'){const last=event?.last_success;return {...row,count,connected:hr.configured(),lastSuccess:last,nextSync:last?new Date(new Date(last).getTime()+MASTER_SYNC_INTERVAL_MS).toISOString():null,error:event?.error||''};}
   if(row.name===PULSE_LMV_MASTER)return {...row,count,connected:Boolean(p.lmv?.connected),lastSuccess:p.lmv?.lastSuccess||event?.last_success,error:p.lmv?.error||''};
   if(row.name===PULSE_REGION_MASTER)return {...row,count,connected:p.connected,lastSuccess:p.region?.lastSuccess||event?.last_success,error:p.region?.error||''};
   return {...row,count,connected:row.source==='Pulse'?p.connected:e.configured,lastSuccess:event?.last_success||(row.source==='Pulse'?p.lastSuccess:e.last_success),error:event?.error||(row.source==='Oracle'?e.error:'')||''};
  });
  return {busy:busy||p.busy||e.busy,masters,notSynced:MASTERS_NOT_SYNCED,employeeCopy,siteMovesToHr};
 };
 const run=async(name,actor,options={})=>{const row=MASTER_SYNC_ROWS.find(r=>r.name===name);if(!row)throw Object.assign(new Error('Unknown master.'),{status:400});
  // Employee Master is applied only after a Preview a person looked at: its key comes with the Apply.
  if(row.minute&&!options.planKey)return {name,ok:false,error:EMPLOYEE_MASTER_NEEDS_PREVIEW};
  try{let detail;if(row.source==='Pulse')await pulse.sync(name,actor);else if(row.source==='HR')detail=await hr.sync(name,{by:actor,planKey:options.planKey});else await erp.sync(name);
   // The whole list is applied: from now the changes are copied every minute (again, after a stop).
   if(row.minute&&copy)await copy.start({by:actor});
   await pool.query("INSERT INTO mis_master_sync_state(master_name,last_success,error) VALUES($1,NOW(),'') ON CONFLICT(master_name) DO UPDATE SET last_success=NOW(),error=''",[name]);return {name,ok:true,...(detail?.summary?{summary:detail.summary}:{})}}catch(e){const message=e.code?'Source sync failed ('+e.code+'). Existing data retained.':e.message;await pool.query('INSERT INTO mis_master_sync_state(master_name,error) VALUES($1,$2) ON CONFLICT(master_name) DO UPDATE SET error=EXCLUDED.error',[name,message]);return {name,ok:false,error:message}}};
 // Every hour: Employee Transfer.
 const hourly=async()=>{
  if(busy||!hr.configured())return [];
  busy=true;
  try{
   await ensure();
   const recent=new Map((await pool.query('SELECT master_name,last_success FROM mis_master_sync_state WHERE master_name=ANY($1::text[])',[HOURLY_HR_ROWS.map(row=>row.name)])).rows.map(row=>[row.master_name,row.last_success]));
   const results=[];
   for(const row of HOURLY_HR_ROWS){
    const last=recent.get(row.name);
    if(last&&Date.now()-new Date(last).getTime()<HR_RECENT_MS)continue;
    results.push(await run(row.name,HR_SYNC_ACTOR));
   }
   return results;
  }finally{busy=false;}
 };
 // Every minute: a transfer HR approved since the last look is copied at once (one small read tells), then the
 // changes of Employee Master. A transfer that had to wait is tried again by the hourly run, not every minute.
 const triedTransfers=new Map();
 const minute=async()=>{
  // No key for HR Pulse on this server: nothing can be copied from here. The live server tells the release approvers
  // once that has lasted ten minutes (server/services/hr-employee-minute-copy.mjs, notConnected).
  if(!hr.configured()){const told=copy?.notConnected?await copy.notConnected().catch(()=>null):null;return {skipped:'not connected',...(told?.told?{told:true}:{})};}
  let transfers=null;
  if(!busy&&typeof hr.transfers==='function'){
   try{
    await ensure();
    const approved=((await hr.transfers()).transfers||[]).map(row=>String(row.id||'')).filter(Boolean);
    const done=new Set((await pool.query('SELECT hr_id FROM hr_transfer_sync WHERE hr_id=ANY($1::text[])',[approved]).catch(()=>({rows:[]}))).rows.map(row=>row.hr_id));
    const fresh=approved.filter(id=>!done.has(id)&&!(Date.now()-(triedTransfers.get(id)||0)<HR_RECENT_MS));
    if(fresh.length&&!busy){busy=true;try{transfers=await run(HR_EMPLOYEE_TRANSFER,HR_MINUTE_ACTOR);}finally{busy=false;}for(const id of fresh)triedTransfers.set(id,Date.now());}
   }catch(error){transfers={ok:false,error:error?.message||'HR did not answer.'};}
  }
  // First the way out: a site move made here that HR Pulse has not confirmed yet is sent again.
  const moves=outbox?await outbox.flush().catch(error=>({failed:1,error:error?.message||'HR Pulse did not answer.'})):null;
  return {transfers,employees:copy?await copy.tick():null,...(outbox?{moves}:{})};
 };
 let timer=null,first=null,minuteTimer=null,minuteFirst=null;
 const start=({firstDelayMs=2*60*1000,minuteDelayMs=90*1000}={})=>{
  if(!(timer||first)){const tick=()=>void hourly().catch(error=>console.error('Hourly HR sync failed',error?.message));first=setTimeout(()=>{first=null;tick();timer=setInterval(tick,MASTER_SYNC_INTERVAL_MS);timer.unref?.();},firstDelayMs);first.unref?.();}
  if(!(minuteTimer||minuteFirst)){const tick=()=>void minute().catch(error=>console.error('HR minute copy failed',error?.message));minuteFirst=setTimeout(()=>{minuteFirst=null;tick();minuteTimer=setInterval(tick,MINUTE_MS);minuteTimer.unref?.();},minuteDelayMs);minuteFirst.unref?.();}
 };
 const stop=()=>{clearTimeout(first);clearInterval(timer);clearTimeout(minuteFirst);clearInterval(minuteTimer);first=null;timer=null;minuteFirst=null;minuteTimer=null;};
 app.get('/api/master-sync',...protect,async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await status())}catch(e){next(e)}});
 // Nothing is written: what a Sync of an HR master would change.
 app.get('/api/master-sync/preview',...protect,async(req,res,next)=>{const row=HR_SYNC_ROWS.find(r=>r.name===req.query.master);if(!row)return res.status(400).json({error:'Preview is for Employee Master and Employee Transfer.'});try{res.set('Cache-Control','no-store').json(await hr.preview(row.name))}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}});
 // A changed name the minute copy held: an administrator has looked at it and accepts it.
 app.post('/api/master-sync/employee-copy/accept',...protect,async(req,res,next)=>{if(!copy)return res.status(503).json({error:'The Employee Master copy is not set up on this server.'});try{const result=await copy.accept(req.body?.number,{by:req.session?.login||''});req.audit={eventType:'Master data',module:'Employee master',action:'Accept a held change from HR Pulse',targetType:'Employee',targetReference:'CMLL'+String(req.body?.number||'').replace(/\D/g,''),details:{name:result.name}};res.json({...result,...await status()})}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}});
 // Both whole lists matched now, as every night: what the minute copy missed is corrected by the same rules.
 app.post('/api/master-sync/employee-copy/match',...protect,async(req,res,next)=>{if(!copy)return res.status(503).json({error:'The Employee Master copy is not set up on this server.'});try{const result=await copy.match({by:req.session?.login||'',force:true});req.audit={eventType:'Master data',module:'Employee master',action:'Match Employee Master with HR Pulse',targetType:'Employee master',targetReference:'HR Pulse',details:{same:result.same===true,stopped:result.stopped===true,summary:result.summary||null}};res.json({match:result,...await status()})}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}});
 // "Sync all masters" leaves Employee Master to its Preview and its minute copy.
 app.post('/api/master-sync',...protect,async(req,res,next)=>{if(busy)return res.status(409).json({error:'A master sync is already running.'});const names=req.body.master==='all'?MASTER_SYNC_ROWS.filter(r=>!r.minute).map(r=>r.name):[req.body.master];if(names.some(n=>!MASTER_SYNC_ROWS.some(r=>r.name===n)))return res.status(400).json({error:'Unknown master.'});const planKey=names.length===1&&typeof req.body.planKey==='string'?req.body.planKey.slice(0,64):undefined;busy=true;try{await ensure();const results=[];for(const name of names)results.push(await run(name,req.session.login,{planKey}));busy=false;res.json({results,...await status(),busy:false})}catch(e){next(e)}finally{busy=false}});
 return {status,hourly,minute,start,stop};
}
