import {PULSE_LMV_MASTER,PULSE_REGION_MASTER} from './pulse-master-sync.mjs';

export const MASTER_SYNC_ROWS=[{name:'Users & employees',label:'Login Details',source:'Pulse'},{name:'Equipment master',label:'Equipment Master',source:'Pulse'},{name:PULSE_LMV_MASTER,label:'LMV Master',source:'Pulse'},{name:PULSE_REGION_MASTER,label:'Region / Site Master',source:'Pulse'},{name:'Shift Master',label:'Shift Master',source:'Pulse'},{name:'Work Order master',label:'Work Contract Master',source:'Oracle'},{name:'Financial Year master',label:'Financial Year Master',source:'Oracle'},{name:'Company master',label:'Company Master',source:'Oracle'}];
export function registerMasterSync(app,{pool,pulse,erp,requireSession,requireAdministrator}){let busy=false;const protect=[requireSession,requireAdministrator];const ensure=()=>pool.query('CREATE TABLE IF NOT EXISTS mis_master_sync_state(master_name TEXT PRIMARY KEY,last_success TIMESTAMPTZ,error TEXT NOT NULL DEFAULT \'\')');
 const status=async()=>{
  await ensure();
  const p=pulse.status(),e=await erp.status().catch(()=>({configured:false,busy:false,error:'Oracle connection is unavailable. Pulse connection remains available.'}));
  const counts=(await pool.query(`
    SELECT master_name,count(*) n FROM master_records WHERE master_name=ANY($1::text[]) GROUP BY master_name
    UNION ALL
    SELECT master_name,count(*) n FROM pulse_master_links WHERE master_name=$2 GROUP BY master_name
  `,[MASTER_SYNC_ROWS.map(r=>r.name).filter(name=>name!==PULSE_LMV_MASTER),PULSE_LMV_MASTER])).rows;
  const events=(await pool.query('SELECT * FROM mis_master_sync_state')).rows;
  const masters=MASTER_SYNC_ROWS.map(row=>{
   const event=events.find(entry=>entry.master_name===row.name);
   const count=Number(counts.find(entry=>entry.master_name===row.name)?.n||0);
   if(row.name===PULSE_LMV_MASTER)return {...row,count,connected:Boolean(p.lmv?.connected),lastSuccess:p.lmv?.lastSuccess||event?.last_success,error:p.lmv?.error||''};
   if(row.name===PULSE_REGION_MASTER)return {...row,count,connected:p.connected,lastSuccess:p.region?.lastSuccess||event?.last_success,error:p.region?.error||''};
   return {...row,count,connected:row.source==='Pulse'?p.connected:e.configured,lastSuccess:event?.last_success||(row.source==='Pulse'?p.lastSuccess:e.last_success),error:event?.error||(row.source==='Oracle'?e.error:'')||''};
  });
  return {busy:busy||p.busy||e.busy,masters};
 };
 const run=async(name,actor)=>{const row=MASTER_SYNC_ROWS.find(r=>r.name===name);if(!row)throw Object.assign(new Error('Unknown master.'),{status:400});try{if(row.source==='Pulse')await pulse.sync(name,actor);else await erp.sync(name);await pool.query("INSERT INTO mis_master_sync_state(master_name,last_success,error) VALUES($1,NOW(),'') ON CONFLICT(master_name) DO UPDATE SET last_success=NOW(),error=''",[name]);return {name,ok:true}}catch(e){const message=e.code?'Source sync failed ('+e.code+'). Existing data retained.':e.message;await pool.query('INSERT INTO mis_master_sync_state(master_name,error) VALUES($1,$2) ON CONFLICT(master_name) DO UPDATE SET error=EXCLUDED.error',[name,message]);return {name,ok:false,error:message}}};
 app.get('/api/master-sync',...protect,async(req,res,next)=>{try{res.set('Cache-Control','no-store').json(await status())}catch(e){next(e)}});
 app.post('/api/master-sync',...protect,async(req,res,next)=>{if(busy)return res.status(409).json({error:'A master sync is already running.'});const names=req.body.master==='all'?MASTER_SYNC_ROWS.map(r=>r.name):[req.body.master];if(names.some(n=>!MASTER_SYNC_ROWS.some(r=>r.name===n)))return res.status(400).json({error:'Unknown master.'});busy=true;try{await ensure();const results=[];for(const name of names)results.push(await run(name,req.session.login));res.json({results,...await status(),busy:false})}catch(e){next(e)}finally{busy=false}});
 return {status};
}
