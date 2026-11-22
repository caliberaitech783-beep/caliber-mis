import {PULSE_LMV_MASTER,PULSE_REGION_MASTER} from './pulse-master-sync.mjs';
import {MASTER_SYNC_INTERVAL_MS} from '../rules/master-sync-schedule.mjs';
import {HR_EMPLOYEE_MASTER,HR_EMPLOYEE_TRANSFER} from '../services/hr-employee-sync.mjs';

// Owner, 23 Nov 2026 (later the same day): Employee Master and Employee Transfer are synced from HR (hrpulse.cmll.in)
// every hour, with a Preview before Apply (server/services/hr-employee-sync.mjs). Employee Master is still not
// copied from Oracle / ERP. HR's master Excel on the Employee Master page stays as the way to apply a file by hand.
export const MASTER_SYNC_ROWS=[{name:'Users & employees',label:'Login Details',source:'Pulse'},{name:'Equipment master',label:'Equipment Master',source:'Pulse'},{name:PULSE_LMV_MASTER,label:'LMV Master',source:'Pulse'},{name:PULSE_REGION_MASTER,label:'Region / Site Master',source:'Pulse'},{name:'Shift Master',label:'Shift Master',source:'Pulse'},{name:HR_EMPLOYEE_MASTER,label:'Employee Master',source:'HR',preview:true},{name:HR_EMPLOYEE_TRANSFER,label:'Employee Transfer',source:'HR',preview:true},{name:'Work Order master',label:'Work Contract Master',source:'Oracle'},{name:'Financial Year master',label:'Financial Year Master',source:'Oracle'},{name:'Company master',label:'Company Master',source:'Oracle'}];
export const HR_SYNC_ROWS=MASTER_SYNC_ROWS.filter(row=>row.source==='HR');
// Owner, 23 Nov 2026: deploy both, but do not sync Employee Master for now; only Employee Transfer syncs.
// Its Preview still shows what HR holds (it writes nothing). Azure setting HR_EMPLOYEE_MASTER_SYNC=on starts it.
export const HR_PAUSED_NOTE='Paused by the owner. Preview shows what would change; nothing is written.';
export const hrMasterPaused=(name,env=process.env)=>name===HR_EMPLOYEE_MASTER&&env.HR_EMPLOYEE_MASTER_SYNC!=='on';
export const HR_SYNC_ACTOR='Hourly HR sync';
// Several server instances: an hourly run that finds a success newer than this leaves the copy to the other.
const HR_RECENT_MS=MASTER_SYNC_INTERVAL_MS-5*60*1000;
const unavailableHr={configured:()=>false,count:async()=>null,preview:async()=>{throw Object.assign(new Error('HR connection is not set up (HR_SYNC_KEY).'),{status:503})},sync:async()=>{throw new Error('HR connection is not set up (HR_SYNC_KEY).')}};

export function registerMasterSync(app,{pool,pulse,erp,hr=unavailableHr,env=process.env,requireSession,requireAdministrator}){const paused=name=>hrMasterPaused(name,env);let busy=false;const protect=[requireSession,requireAdministrator];const ensure=()=>pool.query('CREATE TABLE IF NOT EXISTS mis_master_sync_state(master_name TEXT PRIMARY KEY,last_success TIMESTAMPTZ,error TEXT NOT NULL DEFAULT \'\')');
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
  const masters=MASTER_SYNC_ROWS.map(row=>{
   const event=events.find(entry=>entry.master_name===row.name);
   const count=row.name===HR_EMPLOYEE_TRANSFER?Number(transfers||0):Number(counts.find(entry=>entry.master_name===row.name)?.n||0);
   if(row.source==='HR'){const last=event?.last_success;return {...row,count,connected:hr.configured(),paused:paused(row.name),lastSuccess:last,nextSync:paused(row.name)?null:last?new Date(new Date(last).getTime()+MASTER_SYNC_INTERVAL_MS).toISOString():null,error:event?.error||''};}
   if(row.name===PULSE_LMV_MASTER)return {...row,count,connected:Boolean(p.lmv?.connected),lastSuccess:p.lmv?.lastSuccess||event?.last_success,error:p.lmv?.error||''};
   if(row.name===PULSE_REGION_MASTER)return {...row,count,connected:p.connected,lastSuccess:p.region?.lastSuccess||event?.last_success,error:p.region?.error||''};
   return {...row,count,connected:row.source==='Pulse'?p.connected:e.configured,lastSuccess:event?.last_success||(row.source==='Pulse'?p.lastSuccess:e.last_success),error:event?.error||(row.source==='Oracle'?e.error:'')||''};
  });
  return {busy:busy||p.busy||e.busy,masters,notSynced:[]};
 };
 const run=async(name,actor,options={})=>{const row=MASTER_SYNC_ROWS.find(r=>r.name===name);if(!row)throw Object.assign(new Error('Unknown master.'),{status:400});try{let detail;if(row.source==='Pulse')await pulse.sync(name,actor);else if(row.source==='HR')detail=await hr.sync(name,{by:actor,planKey:options.planKey});else await erp.sync(name);await pool.query("INSERT INTO mis_master_sync_state(master_name,last_success,error) VALUES($1,NOW(),'') ON CONFLICT(master_name) DO UPDATE SET last_success=NOW(),error=''",[name]);return {name,ok:true,...(detail?.summary?{summary:detail.summary}:{})}}catch(e){const message=e.code?'Source sync failed ('+e.code+'). Existing data retained.':e.message;await pool.query('INSERT INTO mis_master_sync_state(master_name,error) VALUES($1,$2) ON CONFLICT(master_name) DO UPDATE SET error=EXCLUDED.error',[name,message]);return {name,ok:false,error:message}}};
 // Every hour: Employee Master first, so a transfer finds a person who joined in the same hour.
 const hourly=async()=>{
  if(busy||!hr.configured())return [];
  busy=true;
  try{
   await ensure();
   const recent=new Map((await pool.query('SELECT master_name,last_success FROM mis_master_sync_state WHERE master_name=ANY($1::text[])',[HR_SYNC_ROWS.map(row=>row.name)])).rows.map(row=>[row.master_name,row.last_success]));
   const results=[];
   for(const row of HR_SYNC_ROWS){
    if(paused(row.name))continue;
    const last=recent.get(row.name);
    if(last&&Date.now()-new Date(last).getTime()<HR_RECENT_MS)continue;
    results.push(await run(row.name,HR_SYNC_ACTOR));
   }
   return results;
  }finally{busy=false;}
 };
 let timer=null,first=null;
 const start=({firstDelayMs=2*60*1000}={})=>{if(timer||first)return;const tick=()=>void hourly().catch(error=>console.error('Hourly HR sync failed',error?.message));first=setTimeout(()=>{first=null;tick();timer=setInterval(tick,MASTER_SYNC_INTERVAL_MS);timer.unref?.();},firstDelayMs);first.unref?.();};
 const stop=()=>{clearTimeout(first);clearInterval(timer);first=null;timer=null;};
 app.get('/api/master-sync',...protect,async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await status())}catch(e){next(e)}});
 // Nothing is written: what a Sync of an HR master would change.
 app.get('/api/master-sync/preview',...protect,async(req,res,next)=>{const row=HR_SYNC_ROWS.find(r=>r.name===req.query.master);if(!row)return res.status(400).json({error:'Preview is for Employee Master and Employee Transfer.'});try{res.set('Cache-Control','no-store').json(await hr.preview(row.name))}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}});
 app.post('/api/master-sync',...protect,async(req,res,next)=>{if(busy)return res.status(409).json({error:'A master sync is already running.'});if(paused(req.body.master))return res.status(409).json({error:'Employee Master sync from HR is paused by the owner.'});const names=req.body.master==='all'?MASTER_SYNC_ROWS.map(r=>r.name).filter(name=>!paused(name)):[req.body.master];if(names.some(n=>!MASTER_SYNC_ROWS.some(r=>r.name===n)))return res.status(400).json({error:'Unknown master.'});const planKey=names.length===1&&typeof req.body.planKey==='string'?req.body.planKey.slice(0,64):undefined;busy=true;try{await ensure();const results=[];for(const name of names)results.push(await run(name,req.session.login,{planKey}));busy=false;res.json({results,...await status(),busy:false})}catch(e){next(e)}finally{busy=false}});
 return {status,hourly,start,stop};
}
