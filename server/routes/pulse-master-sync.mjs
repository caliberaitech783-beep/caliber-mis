import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {masterAccessAllows} from '../../shared/admin-access.mjs';
import {shiftIdentity} from '../../shared/shift-master.mjs';
import {isLmv} from '../../shared/equipment-kind.mjs';
import {hashPassword} from '../services/password-auth.mjs';
import {randomBytes} from 'node:crypto';

export const PULSE_MASTER_NAMES=['Equipment master','Shift Master','Users & employees'];
export const PULSE_LMV_MASTER='LMV master';
export const PULSE_REGION_MASTER='Region master';
const SOURCE='https://pulse.cmll.in';
export function validatePulseSnapshot(data,names=PULSE_MASTER_NAMES){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Pulse returned an invalid master response.');
 if(!names.some(name=>Object.hasOwn(data,name)))throw new Error('Pulse returned no recognized master groups. Existing local masters are unchanged.');
 return Object.fromEntries(names.map(name=>{
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
function lmvSnapshot(data){
 if(!Array.isArray(data?.[PULSE_LMV_MASTER]))throw new Error('Pulse did not return its LMV Master. Existing LMV records were retained.');
 const snapshot=validatePulseSnapshot(data,[PULSE_LMV_MASTER]);
 snapshot[PULSE_LMV_MASTER]=snapshot[PULSE_LMV_MASTER]
   .filter(row=>row.demo!==true&&!/^DEMO-LMV-/i.test(String(row.door||row.equipmentName||'').trim()))
   .map(row=>({...row,category:'LMV',registration:row.registration||row.reg,assetNo:row.assetNo||row.asset}));
 return snapshot;
}
function recordKey(master,row){
 if(master===PULSE_REGION_MASTER)return String(row.code||row.shortName||row.name||'').trim().toLowerCase();
 if(master==='Shift Master')return `${shiftIdentity({...row,shiftName:row.shiftName||row.name||row.shift})}|${String(row.effectiveFrom||'').trim()}`;
 if(master==='Users & employees')return String(row.login||row.empId||row.employeeId||row.employee||'').trim().toLowerCase();
 if(master===PULSE_LMV_MASTER)return String(row.chassisNo||row.chassis||row.registration||row.reg||row.door||'').trim().toLowerCase();
 const value=master==='Equipment master'?(row.chassis||row.door||row.registration):(row.name||row.shiftName||row.shift);
 return String(value||'').trim().toLowerCase();
}
export async function applyPulseSnapshot(pool,input,selectedNames=PULSE_MASTER_NAMES){
 if(selectedNames.some(n=>n!==PULSE_LMV_MASTER&&n!==PULSE_REGION_MASTER&&!PULSE_MASTER_NAMES.includes(n)))throw new Error('Invalid Pulse master.');
 const regularNames=selectedNames.filter(name=>name!==PULSE_LMV_MASTER&&name!==PULSE_REGION_MASTER);
 const snapshot=regularNames.length?validatePulseSnapshot(input):{};
 if(selectedNames.includes(PULSE_LMV_MASTER))Object.assign(snapshot,lmvSnapshot(input));
 if(selectedNames.includes(PULSE_REGION_MASTER)){
   if(!Array.isArray(input?.[PULSE_REGION_MASTER]))throw new Error('Pulse did not return its Region / Site Master. Existing regions and sites were retained.');
   Object.assign(snapshot,validatePulseSnapshot(input,[PULSE_REGION_MASTER]));
   if(snapshot[PULSE_REGION_MASTER].some(row=>typeof row.name!=='string'||!row.name.trim()))throw new Error('Pulse returned an unnamed region. Existing regions and sites were retained.');
 }
 const client=await pool.connect(),counts={};
 try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(783,42)');
   for(const name of selectedNames){
     const target=name===PULSE_LMV_MASTER?'Equipment master':name;
     const sourceNames=target==='Equipment master'?['Equipment master',PULSE_LMV_MASTER]:[name];
     const {rows:targetLinks}=await client.query('SELECT master_name,source_id,local_id FROM pulse_master_links WHERE master_name=ANY($1::text[])',[sourceNames]);
     const links=targetLinks.filter(row=>row.master_name===name);
     const mapped=new Map(links.map(r=>[String(r.source_id),r.local_id]));
     const {rows:locals}=await client.query('SELECT id,record_data FROM master_records WHERE master_name=$1',[target]);
     const linkedIds=new Set(targetLinks.map(r=>String(r.local_id)));
     const incomingIds=new Set(snapshot[name].map(r=>String(r.id)));
     for(const row of snapshot[name]){
       const {id:sourceId,passwordHash:sourcePasswordHash,mustChangePassword:sourcePasswordChange,...sourceData}=row;
       const data={...sourceData};let localId=mapped.get(String(sourceId));
       if(!localId){
         const key=recordKey(name,data),matches=key?locals.filter(r=>!linkedIds.has(String(r.id))
           &&(name!==PULSE_LMV_MASTER||isLmv(r.record_data))&&recordKey(name,r.record_data)===key):[];
         if(matches.length>1)throw new Error(`Multiple local records match a Pulse ${name} record. Reconcile duplicates before syncing.`);
         localId=matches[0]?.id;
         if(name==='Users & employees'){
           const previous=locals.find(local=>String(local.id)===String(localId))?.record_data;
           data.passwordHash=previous?.passwordHash||hashPassword(randomBytes(32).toString('hex'));
           data.mustChangePassword=previous?.mustChangePassword===true;
         }
         if(!localId)localId=(await client.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2::jsonb) RETURNING id',[target,JSON.stringify(data)])).rows[0].id;
         linkedIds.add(String(localId));
         await client.query('INSERT INTO pulse_master_links(master_name,source_id,local_id) VALUES($1,$2,$3)',[name,String(sourceId),localId]);
       }
       if(name==='Users & employees'&&!data.passwordHash){
         const previous=locals.find(local=>String(local.id)===String(localId))?.record_data;
         data.passwordHash=previous?.passwordHash||hashPassword(randomBytes(32).toString('hex'));
         data.mustChangePassword=previous?.mustChangePassword===true;
       }
       await client.query('UPDATE master_records SET record_data=$1::jsonb WHERE id=$2 AND master_name=$3 AND record_data IS DISTINCT FROM $1::jsonb',[JSON.stringify(data),localId,target]);
     }
     for(const row of links)if(!incomingIds.has(String(row.source_id))){
       await client.query('DELETE FROM pulse_master_links WHERE master_name=$1 AND source_id=$2',[name,row.source_id]);
       await client.query('DELETE FROM master_records WHERE id=$1 AND master_name=$2',[row.local_id,target]);
     }
     if(name===PULSE_REGION_MASTER)await client.query(
       'DELETE FROM master_records WHERE master_name=$1 AND NOT EXISTS (SELECT 1 FROM pulse_master_links WHERE master_name=$1 AND local_id=master_records.id)',
       [name],
     );
     counts[name]=snapshot[name].length;
   }
   await client.query('COMMIT');return counts;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

// How long one Pulse read answers later callers. Card saves at scanning speed used to read Pulse's
// whole breakdown feed and whole fleet once per save; with six sites saving at once those reads
// filled Pulse's database connections and its own sign-in timed out (10 Nov 2026). A breakdown or a
// transfer completed in Pulse is seen at the latest after this window; a recheck reads fresh at once.
export const PULSE_FEED_REUSE_MS=20000,PULSE_FLEET_REUSE_MS=30000;
export function createPulseMasterSync({pool,stateFile,credentialStore,sharedSignIn,fetchImpl=fetch,onSnapshot=null,now=Date.now}){
 // Real-time checks that run after every applied snapshot (equipment alias redundancy and shadowing).
 const afterSnapshot=async()=>{if(!onSnapshot)return;try{await onSnapshot();}catch(e){console.error("Pulse snapshot follow-up failed:",e?.message||e);}};
 let breakdownCache=null;
 // Shared-sign-in breakdown reads, per actor: Pulse filters the feed by the actor's site scope, so
 // actors never share. An entry holds the last rows with their time and the request in flight.
 const sharedBreakdownReads=new Map();
 const fleetReadsInFlight=new Map(),fleetSnapshots=new Map();
 let token='',username='',lastSuccess=null,lastAttempt=null,error='',counts={},busy=false,started=false,timer;
 let lmvLastSuccess=null,lmvError='';
 let regionLastSuccess=null,regionError='';
 const request=async(route,options={})=>{
   let response;
   try{response=await fetchImpl(SOURCE+route,{...options,redirect:'error',signal:AbortSignal.timeout(45000)});}catch{throw new Error('Could not reach pulse.cmll.in. The connection will retry automatically.');}
   const body=await response.json().catch(()=>null);
   if(!response.ok){if([401,403].includes(response.status))throw Object.assign(new Error('Pulse access expired or was denied. Reconnect an authorized Pulse administrator with MIS verification access to the card site.'),{code:'PULSE_AUTH_EXPIRED',status:response.status});throw Object.assign(new Error(body?.error||`Pulse request failed (${response.status}).`),{status:response.status});}
   return body;
 };
 const fetchMasters=async(sourceToken)=>validatePulseSnapshot(await request(`/api/masters?names=${encodeURIComponent(PULSE_MASTER_NAMES.join('|'))}`,{headers:{Authorization:`Bearer ${sourceToken}`,'Cache-Control':'no-cache'}}));
 const status=()=>({source:SOURCE,connected:Boolean(token)||Boolean(sharedSignIn?.status().connected),connectionMode:token?'manual':'shared-sign-in',username,intervalSeconds:60,lastSuccess,lastAttempt,error,counts,busy,masters:PULSE_MASTER_NAMES,region:{lastSuccess:regionLastSuccess,error:regionError},lmv:{connected:Boolean(token),lastSuccess:lmvLastSuccess,error:lmvError}});
 const save=async(sourceToken,sourceUsername)=>{
   if(credentialStore){await credentialStore.write('pulse-session',{token:sourceToken,username:sourceUsername});return;}if(!stateFile)throw new Error('Local Pulse sync storage is not configured.');
   await mkdir(path.dirname(stateFile),{recursive:true});
   await writeFile(stateFile+'.tmp',JSON.stringify({token:sourceToken,username:sourceUsername}),{mode:0o600});
   await rename(stateFile+'.tmp',stateFile);
 };
 const reconnect=async()=>{const credentials=await credentialStore?.read('pulse');if(!credentials)throw new Error('Connect Pulse before syncing.');const login=await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credentials,portal:'operations'})});if(!login?.token||login.role!=='super'||!['admin','super admin'].includes(String(login.permissions?.adminLevel||'').toLowerCase())||PULSE_MASTER_NAMES.some(name=>!masterAccessAllows(login.permissions,name)&&!masterAccessAllows(login.permissions,name,'mobileMasterAccess')))throw new Error('Saved Pulse account is no longer authorized to sync masters.');await save(login.token,credentials.username);token=login.token;username=credentials.username;};
 const authorizedRequest=async(route,options={})=>{
  if(!token)throw new Error('Connect Pulse in Sync all masters to enable automatic MIS verification.');
  const send=()=>request(route,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`,'Cache-Control':'no-cache'}});
  try{return await send();}catch(error){if(error.status!==401||!credentialStore)throw error;await reconnect();return send();}
 };
 const sync=async(master,actor)=>{
   const lmv=master===PULSE_LMV_MASTER;
   const region=master===PULSE_REGION_MASTER;
   if(master&&!lmv&&!region&&!PULSE_MASTER_NAMES.includes(master))throw new Error('Invalid Pulse master.');
   if(busy)throw new Error('A master sync is already running.');
   if(region){
     busy=true;
     try{
       const snapshot=token
         ?await authorizedRequest(`/api/masters?names=${encodeURIComponent(PULSE_REGION_MASTER)}`)
         :await sharedSignIn?.request('masters',{names:[PULSE_REGION_MASTER]},actor);
       counts={...counts,...await applyPulseSnapshot(pool,snapshot,[PULSE_REGION_MASTER])};
       regionLastSuccess=new Date().toISOString();regionError='';
       return {...status(),busy:false};
     }catch(cause){regionError=cause.message;throw cause;}finally{busy=false;}
   }
   if(lmv){
     if(!token)throw new Error('Connect a Pulse service account to sync LMV Master.');
     busy=true;
     try{
       const snapshot=await authorizedRequest(`/api/masters?names=${encodeURIComponent(PULSE_LMV_MASTER)}`);
       counts={...counts,...await applyPulseSnapshot(pool,snapshot,[PULSE_LMV_MASTER])};
       lmvLastSuccess=new Date().toISOString();lmvError='';
       return {...status(),busy:false};
     }catch(cause){lmvError=cause.message;throw cause;}finally{busy=false;}
   }
   if(!token&&!sharedSignIn?.status().connected)throw new Error('Sign in to Pulse II to connect Pulse automatically.');
   busy=true;lastAttempt=new Date().toISOString();
   try{let snapshot;if(!token&&sharedSignIn)snapshot=validatePulseSnapshot(await sharedSignIn.request('masters',{},actor));else{try{snapshot=await fetchMasters(token)}catch(e){if(e.code!=='PULSE_AUTH_EXPIRED'||!credentialStore)throw e;await reconnect();snapshot=await fetchMasters(token)}}counts={...counts,...await applyPulseSnapshot(pool,snapshot,master?[master]:PULSE_MASTER_NAMES)};fleetSnapshots.clear();await afterSnapshot();lastSuccess=new Date().toISOString();error='';return {...status(),busy:false};}
   catch(cause){error=cause.message;throw cause;}finally{busy=false;}
 };
 const refresh=async()=>{
   if(busy)return;
   if(token)await sync(PULSE_LMV_MASTER).catch(()=>{});
   await sync().catch(()=>{});
   if(token||sharedSignIn?.status().connected)await sync(PULSE_REGION_MASTER).catch(()=>{});
 };
 const service={
   status,
   async readEquipmentMasters(actor,site,{fresh=false}={}){
     // Simultaneous reads share one request, and a snapshot answers later reads for a short
     // window, so saving at scanning speed does not read the whole fleet from Pulse once per
     // card. A recheck passes fresh, so a transfer just completed in Pulse is seen at once.
     // Different users, sites or source sessions never share.
     const sourceToken=token,key=JSON.stringify([sourceToken?'manual':'shared',sourceToken,actor||null,site||null]);
     if(!fresh){const snapshot=fleetSnapshots.get(key);if(snapshot&&now()-snapshot.at<PULSE_FLEET_REUSE_MS)return structuredClone(snapshot.rows);}
     let pending=fleetReadsInFlight.get(key);
     if(!pending){
       pending=(async()=>{
         const snapshot=!sourceToken&&sharedSignIn?await sharedSignIn.request('fleet',{site},actor):await request('/api/masters?names=Equipment%20master',{headers:{Authorization:`Bearer ${sourceToken}`,'Cache-Control':'no-cache'}});
         if(!Array.isArray(snapshot?.['Equipment master'])||!snapshot['Equipment master'].length)throw Error('Pulse returned no fleet records. Reconnect Pulse before saving scanned cards.');
         fleetSnapshots.set(key,{at:now(),rows:snapshot['Equipment master']});
         return snapshot['Equipment master'];
       })().finally(()=>{if(fleetReadsInFlight.get(key)===pending)fleetReadsInFlight.delete(key);});
       fleetReadsInFlight.set(key,pending);
     }
     return structuredClone(await pending);
   },
   async readBreakdownRequests({fresh=false,actor}={}){
     if(!token&&sharedSignIn){
       // One read of Pulse's feed per actor per window; callers only read the rows.
       const key=String(actor||''),entry=sharedBreakdownReads.get(key);
       if(!fresh&&entry){if(entry.rows&&now()-entry.at<PULSE_FEED_REUSE_MS)return entry.rows;if(entry.pending)return entry.pending;}
       const pending=sharedSignIn.request('requests',{},actor).then(rows=>{if(!Array.isArray(rows))throw new Error('Pulse returned an invalid breakdown feed.');sharedBreakdownReads.set(key,{at:now(),rows});return rows;})
         .finally(()=>{const current=sharedBreakdownReads.get(key);if(current?.pending===pending)sharedBreakdownReads.set(key,{...current,pending:null});});
       sharedBreakdownReads.set(key,{...entry,pending});
       return pending;
     }
     if(!token)throw new Error('Connect Pulse to fetch breakdown hours.');if(!fresh&&breakdownCache?.token===token&&now()-breakdownCache.at<15000)return breakdownCache.rows;const rows=await authorizedRequest('/api/requests');if(!Array.isArray(rows))throw new Error('Pulse returned an invalid breakdown feed.');breakdownCache={token,at:now(),rows};return rows;},
   forActor(actor){return sharedSignIn?{readBreakdownRequests:(options={})=>service.readBreakdownRequests({...options,actor}),verifyTripCard:async(reference,payload)=>{const row=await sharedSignIn.request('verify',{reference,payload},actor);sharedBreakdownReads.delete(String(actor||''));return row;}}:null;},
   async verifyTripCard(reference,payload){if(!reference)throw new Error('Pulse request reference is required.');const row=await authorizedRequest(`/api/requests/${encodeURIComponent(reference)}/verify`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});breakdownCache=null;return row;},
   sync,
   async connect(credentials){
     if(busy)throw new Error('A master sync is already running.');
     if(!credentials?.username||!credentials?.password)throw new Error('Enter your Pulse user name and password.');
     busy=true;
     try{
       const login=await request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:String(credentials.username),password:String(credentials.password),portal:'operations'})});
       if(!login?.token||login.role!=='super'||!['admin','super admin'].includes(String(login.permissions?.adminLevel||'').toLowerCase()))throw new Error('Use a Pulse Admin or Super Admin with access to the requested masters. Complete any required password change in Pulse first.');
       if(PULSE_MASTER_NAMES.some(name=>!masterAccessAllows(login.permissions,name)&&!masterAccessAllows(login.permissions,name,'mobileMasterAccess')))throw new Error('This Pulse account cannot read all requested masters.');
       const snapshot=await fetchMasters(login.token);
       // Credentials are persisted only through the encrypted integration store.
       await save(login.token,String(credentials.username));if(credentialStore)await credentialStore.write('pulse',{username:String(credentials.username),password:String(credentials.password)});token=login.token;username=String(credentials.username);
       lastAttempt=new Date().toISOString();counts=await applyPulseSnapshot(pool,snapshot);await afterSnapshot();lastSuccess=new Date().toISOString();error='';
       return {...status(),busy:false};
     }catch(cause){error=cause.message;throw cause;}finally{busy=false;}
   },
   async disconnect(){if(busy)throw new Error('Wait for the current sync to finish.');if(credentialStore){await credentialStore.remove('pulse');await credentialStore.remove('pulse-session');}if(stateFile)await unlink(stateFile).catch(e=>{if(e.code!=='ENOENT')throw e});token='';username='';error='';return status();},
   async start(){
     if(started||(!stateFile&&!credentialStore))return;started=true;
     await sharedSignIn?.start();
     await pool.query('CREATE TABLE IF NOT EXISTS pulse_master_links(master_name TEXT NOT NULL,source_id TEXT NOT NULL,local_id BIGINT NOT NULL REFERENCES master_records(id) ON DELETE CASCADE,PRIMARY KEY(master_name,source_id),UNIQUE(local_id))');
     await pool.query('ALTER TABLE pulse_master_links ALTER COLUMN local_id TYPE BIGINT');
     try{const saved=await credentialStore?.read('pulse-session')||(stateFile?JSON.parse(await readFile(stateFile,'utf8')):{});token=String(saved.token||'');username=String(saved.username||'');}catch(e){if(e.code!=='ENOENT')error='Saved Pulse connection could not be read. Reconnect Pulse.';}
     let hasSavedCredentials=false;try{hasSavedCredentials=Boolean(await credentialStore?.read('pulse'))}catch{error='Saved legacy Pulse credentials could not be read. Normal Pulse sign-in can reconnect automatically.';}
     if(token||hasSavedCredentials||sharedSignIn?.status().connected)void refresh();
     timer=setInterval(()=>{if(token||credentialStore)void refresh();},60000);timer.unref?.();
   },
   stop(){clearInterval(timer);sharedSignIn?.stop();},
 };
 return service;
}

export function registerPulseMasterSync(app,{pool,stateFile,credentialStore,sharedSignIn,requireSession,requireAdministrator,onSnapshot=null}){
 const service=createPulseMasterSync({pool,stateFile,credentialStore,sharedSignIn,onSnapshot});
 app.get('/api/pulse-master-sync',requireSession,requireAdministrator,(_req,res)=>res.json(service.status()));
 for(const action of ['connect','sync','disconnect'])app.post(`/api/pulse-master-sync/${action}`,requireSession,requireAdministrator,async(req,res)=>{
   try{res.json(await service[action](action==='connect'?req.body:undefined));}catch(e){res.status(400).json({error:e.message});}
 });
 app.use('/api/masters/:master',(req,res,next)=>{
   if(req.params.master==='Users & employees'&&/^\/\d+\/password\/?$/.test(req.path))return next();
   if(!['GET','HEAD'].includes(req.method)&&(req.params.master===PULSE_REGION_MASTER||(service.status().connected&&PULSE_MASTER_NAMES.includes(req.params.master))))return res.status(409).json({error:'This master is synced from Pulse. Make changes in Pulse; Nexus refreshes automatically.'});
   next();
 });
 return service;
}
