import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {masterAccessAllows} from './admin-access.mjs';
import {shiftIdentity} from './shift-master.mjs';
import {hashPassword} from './password-auth.mjs';
import {randomBytes} from 'node:crypto';

export const PULSE_MASTER_NAMES=['Equipment master','Region master','Shift Master','Users & employees'];
const SOURCE='https://pulse.cmll.in';
export function validatePulseSnapshot(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Pulse returned an invalid master response.');
 if(!PULSE_MASTER_NAMES.some(name=>Object.hasOwn(data,name)))throw new Error('Pulse returned no recognized master groups. Existing local masters are unchanged.');
 return Object.fromEntries(PULSE_MASTER_NAMES.map(name=>{
   const rows=data[name]??[];
   if(!Array.isArray(rows))throw new Error(`Invalid ${name} response.`);
   const seen=new Set();
   for(const row of rows){
     if(!row||typeof row!=='object'||Array.isArray(row)||!/^\d+$/.test(String(row.id))||Number(row.id)<1||seen.has(String(row.id)))throw new Error(`Invalid or duplicate source ID in ${name}.`);
     seen.add(String(row.id));
   }
   return [name,rows];
 }));
}
function recordKey(master,row){
 if(master==='Shift Master')return `${shiftIdentity({...row,shiftName:row.shiftName||row.name||row.shift})}|${String(row.effectiveFrom||'').trim()}`;
 if(master==='Users & employees')return String(row.login||row.empId||row.employeeId||row.employee||'').trim().toLowerCase();
 const value=master==='Equipment master'?(row.chassis||row.door||row.registration):master==='Region master'?(row.code||row.name):(row.name||row.shiftName||row.shift);
 return String(value||'').trim().toLowerCase();
}
export async function applyPulseSnapshot(pool,input,selectedNames=PULSE_MASTER_NAMES){
 if(selectedNames.some(n=>!PULSE_MASTER_NAMES.includes(n)))throw new Error('Invalid Pulse master.');
 const snapshot=validatePulseSnapshot(input),client=await pool.connect(),counts={};
 try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(783,42)');
   for(const name of selectedNames){
     const {rows:links}=await client.query('SELECT source_id,local_id FROM pulse_master_links WHERE master_name=$1',[name]);
     const mapped=new Map(links.map(r=>[String(r.source_id),r.local_id]));
     const {rows:locals}=await client.query('SELECT id,record_data FROM master_records WHERE master_name=$1',[name]);
     const linkedIds=new Set(links.map(r=>String(r.local_id)));
     const incomingIds=new Set(snapshot[name].map(r=>String(r.id)));
     for(const row of snapshot[name]){
       const {id:sourceId,passwordHash:sourcePasswordHash,mustChangePassword:sourcePasswordChange,...sourceData}=row;
       const data={...sourceData};let localId=mapped.get(String(sourceId));
       if(!localId){
         const key=recordKey(name,data),matches=key?locals.filter(r=>!linkedIds.has(String(r.id))&&recordKey(name,r.record_data)===key):[];
         if(matches.length>1)throw new Error(`Multiple local records match a Pulse ${name} record. Reconcile duplicates before syncing.`);
         localId=matches[0]?.id;
         if(name==='Users & employees'){
           const previous=locals.find(local=>String(local.id)===String(localId))?.record_data;
           data.passwordHash=previous?.passwordHash||hashPassword(randomBytes(32).toString('hex'));
           data.mustChangePassword=previous?.mustChangePassword===true;
         }
         if(!localId)localId=(await client.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2::jsonb) RETURNING id',[name,JSON.stringify(data)])).rows[0].id;
         linkedIds.add(String(localId));
         await client.query('INSERT INTO pulse_master_links(master_name,source_id,local_id) VALUES($1,$2,$3)',[name,String(sourceId),localId]);
       }
       if(name==='Users & employees'&&!data.passwordHash){
         const previous=locals.find(local=>String(local.id)===String(localId))?.record_data;
         data.passwordHash=previous?.passwordHash||hashPassword(randomBytes(32).toString('hex'));
         data.mustChangePassword=previous?.mustChangePassword===true;
       }
       await client.query('UPDATE master_records SET record_data=$1::jsonb WHERE id=$2 AND master_name=$3 AND record_data IS DISTINCT FROM $1::jsonb',[JSON.stringify(data),localId,name]);
     }
     for(const row of links)if(!incomingIds.has(String(row.source_id))){
       await client.query('DELETE FROM pulse_master_links WHERE master_name=$1 AND source_id=$2',[name,row.source_id]);
       await client.query('DELETE FROM master_records WHERE id=$1 AND master_name=$2',[row.local_id,name]);
     }
     counts[name]=snapshot[name].length;
   }
   await client.query('COMMIT');return counts;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

export function createPulseMasterSync({pool,stateFile,fetchImpl=fetch}){
 let breakdownCache=null;
 let token='',username='',lastSuccess=null,lastAttempt=null,error='',counts={},busy=false,started=false,timer;
 const request=async(route,options={})=>{
   let response;
   try{response=await fetchImpl(SOURCE+route,{...options,redirect:'error',signal:AbortSignal.timeout(45000)});}catch{throw new Error('Could not reach pulse.cmll.in. Existing local masters are unchanged.');}
   const body=await response.json().catch(()=>null);
   if(!response.ok){if([401,403].includes(response.status))throw new Error('Pulse access expired or was denied. Reconnect an authorized Pulse administrator.');throw new Error(`Pulse request failed (${response.status}). Existing local masters are unchanged.`);}
   return body;
 };
 const fetchMasters=async(sourceToken)=>validatePulseSnapshot(await request(`/api/masters?names=${encodeURIComponent(PULSE_MASTER_NAMES.join('|'))}`,{headers:{Authorization:`Bearer ${sourceToken}`,'Cache-Control':'no-cache'}}));
 const status=()=>({source:SOURCE,connected:Boolean(token),username,intervalSeconds:60,lastSuccess,lastAttempt,error,counts,busy,masters:PULSE_MASTER_NAMES});
 const save=async(sourceToken,sourceUsername)=>{
   if(!stateFile)throw new Error('Local Pulse sync storage is not configured.');
   await mkdir(path.dirname(stateFile),{recursive:true});
   await writeFile(stateFile+'.tmp',JSON.stringify({token:sourceToken,username:sourceUsername}),{mode:0o600});
   await rename(stateFile+'.tmp',stateFile);
 };
 const sync=async(master)=>{
   if(master&&!PULSE_MASTER_NAMES.includes(master))throw new Error('Invalid Pulse master.');
   if(busy)throw new Error('A master sync is already running.');
   if(!token)throw new Error('Connect Pulse before syncing.');
   busy=true;lastAttempt=new Date().toISOString();
   try{counts={...counts,...await applyPulseSnapshot(pool,await fetchMasters(token),master?[master]:PULSE_MASTER_NAMES)};lastSuccess=new Date().toISOString();error='';return {...status(),busy:false};}
   catch(cause){error=cause.message;throw cause;}finally{busy=false;}
 };
 return {
   status,
   async readBreakdownRequests(){if(!token)throw new Error('Connect Pulse to fetch breakdown hours.');if(breakdownCache?.token===token&&Date.now()-breakdownCache.at<15000)return breakdownCache.rows;const rows=await request('/api/requests',{headers:{Authorization:`Bearer ${token}`,'Cache-Control':'no-cache'}});if(!Array.isArray(rows))throw new Error('Pulse returned an invalid breakdown feed.');breakdownCache={token,at:Date.now(),rows};return rows;},
   sync,
   async connect(credentials){
     if(busy)throw new Error('A master sync is already running.');
     if(!credentials?.username||!credentials?.password)throw new Error('Enter your Pulse user name and password.');
     busy=true;
     try{
       const login=await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:String(credentials.username),password:String(credentials.password),portal:'operations'})});
       if(!login?.token||login.role!=='super'||!['admin','super admin'].includes(String(login.permissions?.adminLevel||'').toLowerCase()))throw new Error('Use a Pulse Admin or Super Admin with access to all four masters. Complete any required password change in Pulse first.');
       if(PULSE_MASTER_NAMES.some(name=>!masterAccessAllows(login.permissions,name)&&!masterAccessAllows(login.permissions,name,'mobileMasterAccess')))throw new Error('This Pulse account cannot read all four requested masters.');
       const snapshot=await fetchMasters(login.token);
       // Save only the authenticated session; passwords are never persisted.
       await save(login.token,String(credentials.username));token=login.token;username=String(credentials.username);
       lastAttempt=new Date().toISOString();counts=await applyPulseSnapshot(pool,snapshot);lastSuccess=new Date().toISOString();error='';
       return {...status(),busy:false};
     }catch(cause){error=cause.message;throw cause;}finally{busy=false;}
   },
   async disconnect(){if(busy)throw new Error('Wait for the current sync to finish.');if(stateFile)await unlink(stateFile).catch(e=>{if(e.code!=='ENOENT')throw e});token='';username='';error='';return status();},
   async start(){
     if(started||!stateFile)return;started=true;
     await pool.query('CREATE TABLE IF NOT EXISTS pulse_master_links(master_name TEXT NOT NULL,source_id TEXT NOT NULL,local_id BIGINT NOT NULL REFERENCES master_records(id) ON DELETE CASCADE,PRIMARY KEY(master_name,source_id),UNIQUE(local_id))');
     await pool.query('ALTER TABLE pulse_master_links ALTER COLUMN local_id TYPE BIGINT');
     try{const saved=JSON.parse(await readFile(stateFile,'utf8'));token=String(saved.token||'');username=String(saved.username||'');}catch(e){if(e.code!=='ENOENT')error='Saved Pulse connection could not be read. Reconnect Pulse.';}
     if(token)void sync().catch(()=>{});
     timer=setInterval(()=>{if(token&&!busy)void sync().catch(()=>{});},60000);timer.unref?.();
   },
   stop(){clearInterval(timer);},
 };
}

export function registerPulseMasterSync(app,{pool,stateFile,requireSession,requireAdministrator}){
 const service=createPulseMasterSync({pool,stateFile});
 app.get('/api/pulse-master-sync',requireSession,requireAdministrator,(_req,res)=>res.json(service.status()));
 for(const action of ['connect','sync','disconnect'])app.post(`/api/pulse-master-sync/${action}`,requireSession,requireAdministrator,async(req,res)=>{
   try{res.json(await service[action](action==='connect'?req.body:undefined));}catch(e){res.status(400).json({error:e.message});}
 });
 app.use('/api/masters/:master',(req,res,next)=>{
   if(req.params.master==='Users & employees'&&/^\/\d+\/password\/?$/.test(req.path))return next();
   if(!['GET','HEAD'].includes(req.method)&&service.status().connected&&PULSE_MASTER_NAMES.includes(req.params.master))return res.status(409).json({error:'This master is synced from Pulse. Make changes in Pulse; Nexus refreshes automatically.'});
   next();
 });
 return service;
}
