import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {hashPassword,verifyPassword} from '../server/services/password-auth.mjs';
import {applyPulseSnapshot,createPulseMasterSync,validatePulseSnapshot,PULSE_MASTER_NAMES,PULSE_LMV_MASTER} from '../server/routes/pulse-master-sync.mjs';

async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id SERIAL PRIMARY KEY,master_name TEXT NOT NULL,record_data JSONB NOT NULL); CREATE TABLE pulse_master_links(master_name TEXT NOT NULL,source_id TEXT NOT NULL,local_id INTEGER NOT NULL REFERENCES master_records(id) ON DELETE CASCADE,PRIMARY KEY(master_name,source_id),UNIQUE(local_id));');
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args);
 return {db,pool:{query,connect:async()=>({query,release(){}})}};
}
const snapshot=(door='EQ-1')=>({'Equipment master':[{id:5,door,chassis:'CH-1'}],'Region master':[{id:7,name:'West',code:'WCL'}],'Shift Master':[{id:9,name:'A Shift',start:'06:00'}]});

test('LMV snapshots adopt imported LMVs, skip demos and track their own source IDs',async t=>{
 const {db,pool}=await fixture(t);
 const {rows:[local]}=await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1) RETURNING id",[
   JSON.stringify({category:'LMV',chassis:'LMV-CHASSIS'}),
 ]);
 const records=[
   {id:5,category:'Other vehicles',chassisNo:'LMV-CHASSIS',reg:'LMV-REG',asset:'LMV-ASSET'},
   {id:6,door:'DEMO-LMV-WCL-1',demo:true},
 ];
 const syncLmv=rows=>applyPulseSnapshot(pool,{[PULSE_LMV_MASTER]:rows},[PULSE_LMV_MASTER]);
 await applyPulseSnapshot(pool,snapshot());
 await syncLmv(records);
 records[0].currentLocation='Updated site';
 await syncLmv(records);
 await applyPulseSnapshot(pool,snapshot('EQ-UPDATED'));
 const rows=async()=>(await db.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master' ORDER BY id")).rows;
 assert.deepEqual(await rows(),[
   {id:local.id,record_data:{category:'LMV',chassisNo:'LMV-CHASSIS',reg:'LMV-REG',registration:'LMV-REG',asset:'LMV-ASSET',assetNo:'LMV-ASSET',currentLocation:'Updated site'}},
   {id:local.id+1,record_data:{door:'EQ-UPDATED',chassis:'CH-1'}},
 ]);
 await assert.rejects(applyPulseSnapshot(pool,snapshot(),[PULSE_LMV_MASTER]),/did not return its LMV Master/);
 assert.equal((await rows()).length,2);
 await syncLmv([]);
 assert.deepEqual((await rows()).map(row=>row.record_data.door),['EQ-UPDATED']);
});

test('startup automatically requests the separate LMV master using the saved Pulse account',async t=>{
 const {pool}=await fixture(t),calls=[];
 let finishStartup;
 const startupFinished=new Promise(resolve=>{finishStartup=resolve});
 const service=createPulseMasterSync({
   pool,credentialStore:{read:async key=>key==='pulse-session'?{token:'test-session'}:null},
   onSnapshot:finishStartup,
   fetchImpl:async(url,{headers})=>{
     assert.equal(headers.Authorization,'Bearer test-session');
     const names=new URL(url).searchParams.get('names');
     calls.push(names);
     return Response.json(names===PULSE_LMV_MASTER?{[PULSE_LMV_MASTER]:[{id:5,door:'LMV-1'}]}:snapshot());
   },
 });
 t.after(()=>service.stop());
 await service.start();
 await startupFinished;
 assert.deepEqual(calls,[PULSE_LMV_MASTER,PULSE_MASTER_NAMES.join('|')]);
 assert.equal(service.status().counts[PULSE_LMV_MASTER],1);
 assert.ok(service.status().lmv.lastSuccess);
});

test('source updates preserve local IDs, adopt unique local matches and delete only linked source removals',async t=>{
 const {db,pool}=await fixture(t);
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1),('Region master',$2)",[JSON.stringify({door:'OLD',chassis:'CH-1'}),JSON.stringify({code:'LOCAL',name:'Local only'})]);
 const counts=await applyPulseSnapshot(pool,snapshot());assert.deepEqual(Object.values(counts),[1,1,0]);
 const before=(await db.query("SELECT id FROM master_records WHERE record_data->>'chassis'='CH-1'")).rows[0].id;
 await applyPulseSnapshot(pool,snapshot('EQ-UPDATED'));
 const equipment=(await db.query("SELECT * FROM master_records WHERE record_data->>'chassis'='CH-1'")).rows[0];
 assert.equal(equipment.id,before);assert.equal(equipment.record_data.door,'EQ-UPDATED');
 const deleted=snapshot();deleted['Equipment master']=[];await applyPulseSnapshot(pool,deleted);
 assert.equal((await db.query("SELECT * FROM master_records WHERE master_name='Equipment master'")).rows.length,0);
 assert.equal((await db.query("SELECT * FROM master_records WHERE record_data->>'code'='LOCAL'")).rows.length,1);
});
test('malformed, duplicate and missing master groups never erase existing data',async t=>{
 const {db,pool}=await fixture(t);await applyPulseSnapshot(pool,snapshot());
 for(const bad of [null,[],{}, {'Equipment master':{}},{'Equipment master':[{id:1},{id:1}]}])await assert.rejects(applyPulseSnapshot(pool,bad));
 assert.equal((await db.query('SELECT * FROM master_records')).rows.length,2);
});
test('full Pulse snapshots leave previously linked regions and local site edits intact',async t=>{
 const {db,pool}=await fixture(t);
 const local={code:'WCL',name:'Local West',sites:'Sasti OC | New Site'};
 const {rows:[{id}]}=await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Region master',$1) RETURNING id",[JSON.stringify(local)]);
 await db.query("INSERT INTO pulse_master_links VALUES('Region master','7',$1)",[id]);
 for(const source of [snapshot(),{...snapshot(),'Region master':[]}])await applyPulseSnapshot(pool,source);
 assert.deepEqual((await db.query("SELECT id,record_data FROM master_records WHERE master_name='Region master'")).rows,[{id,record_data:local}]);
 await assert.rejects(applyPulseSnapshot(pool,snapshot(),['Region master']),/Invalid Pulse master/);
});
test('a failed transaction rolls back changes across all three masters',async t=>{
 const {db,pool}=await fixture(t);await applyPulseSnapshot(pool,snapshot());
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Shift Master',$1),('Shift Master',$1)",[JSON.stringify({name:'Duplicate Shift'})]);
 const bad=snapshot('SHOULD-ROLLBACK');bad['Shift Master']=[{id:99,name:'Duplicate Shift'}];await assert.rejects(applyPulseSnapshot(pool,bad),/Multiple local/);
 assert.equal((await db.query("SELECT record_data FROM master_records WHERE master_name='Equipment master'")).rows[0].record_data.door,'EQ-1');
});
test('connection stores only a source session; expiry preserves last good copies and source requests stay read-only except login',async t=>{
 const {db,pool}=await fixture(t),dir=await mkdtemp(path.join(os.tmpdir(),'erp-pulse-sync-')),stateFile=path.join(dir,'session.json');t.after(()=>rm(dir,{recursive:true,force:true}));
 let expired=false;const calls=[];
 const service=createPulseMasterSync({pool,stateFile,fetchImpl:async(url,options)=>{
   calls.push([url,options.method||'GET']);assert.equal(new URL(url).origin,'https://pulse.cmll.in');
   if(url.endsWith('/api/login'))return Response.json({token:'private-source-session',role:'super',permissions:{adminLevel:'Admin'}});
   return expired?Response.json({error:'expired'},{status:401}):Response.json(snapshot());
 }});await service.start();t.after(()=>service.stop());
 await service.connect({username:'sync-admin',password:'do-not-store-me'});
 const saved=await readFile(stateFile,'utf8');assert.ok(!saved.includes('do-not-store-me'));assert.ok(!JSON.stringify(service.status()).includes('private-source-session'));
 assert.deepEqual(calls.map(c=>c[1]),['POST','GET']);assert.deepEqual(service.status().masters,PULSE_MASTER_NAMES);
 assert.equal(new URL(calls[1][0]).searchParams.get('names').includes('Region master'),false);
 expired=true;await assert.rejects(service.sync(),/expired or was denied/);assert.equal((await db.query('SELECT * FROM master_records')).rows.length,2);
 await service.disconnect();assert.equal(service.status().connected,false);await assert.rejects(readFile(stateFile),{code:'ENOENT'});
});
test('source authentication cannot use a manager or partial master permission',async t=>{
 const {pool}=await fixture(t);
 for(const permissions of [{adminLevel:'Manager'},{adminLevel:'Admin',masterAccess:['Equipment master'],mobileMasterAccess:[]}]){
 const service=createPulseMasterSync({pool,fetchImpl:async()=>Response.json({token:'hidden',role:'super',permissions})});
 await assert.rejects(service.connect({username:'someone',password:'hidden'}));assert.equal(service.status().connected,false);
 }
});

test('encrypted saved credentials reconnect once after Pulse session expiry without prompting',async t=>{
 const {pool}=await fixture(t),saved=new Map();let current='',expired=false,logins=0;
 const credentialStore={read:async k=>saved.get(k),write:async(k,v)=>saved.set(k,v),remove:async k=>saved.delete(k)};
 const service=createPulseMasterSync({pool,credentialStore,fetchImpl:async(url,options)=>{
  if(url.endsWith('/api/login')){current='session-'+(++logins);expired=false;return Response.json({token:current,role:'super',permissions:{adminLevel:'Admin'}})}
  return expired?Response.json({error:'expired'},{status:401}):Response.json(snapshot());
 }});await service.start();t.after(()=>service.stop());
 await service.connect({username:'test-admin',password:'synthetic-secret'});expired=true;await service.sync();
 assert.equal(logins,2);assert.equal(service.status().connected,true);assert.ok(!JSON.stringify(service.status()).includes('synthetic-secret'));
 await service.disconnect();assert.equal(saved.has('pulse'),false);
});
test('same shift at different sites adopts the correct local default without duplicates',async t=>{
 const {db,pool}=await fixture(t);
 const shifts=[{site:'Site One',shiftName:'Shift A',startTime:'05:00:00'},{site:'Site Two',shiftName:'Shift A',startTime:'06:00:00'}];
 for(const row of shifts)await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Shift Master',$1)",[JSON.stringify(row)]);
 const data=snapshot();data['Shift Master']=shifts.map((row,index)=>({...row,id:index+21,shiftCode:'A'}));
 await applyPulseSnapshot(pool,data);
 assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM master_records WHERE master_name='Shift Master'")).rows[0].count,2);
 assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM pulse_master_links WHERE master_name='Shift Master'")).rows[0].count,2);
});
test('employee sync preserves local credentials and never activates phone passwords for new copied accounts',async t=>{
 const {db,pool}=await fixture(t);const localHash=hashPassword('Local-secret-123');
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Users & employees',$1)",[JSON.stringify({login:'existing-user',employee:'Existing local',passwordHash:localHash,mustChangePassword:true})]);
 const data=snapshot();data['Users & employees']=[{id:100,login:'existing-user',employee:'Updated employee',passwordHash:'forged-source',mustChangePassword:false},{id:101,login:'new-user',employee:'New employee',phone:'9999999999',userType:'Super User'}];
 await applyPulseSnapshot(pool,data);await applyPulseSnapshot(pool,data);
 const users=(await db.query("SELECT record_data FROM master_records WHERE master_name='Users & employees'")).rows.map(row=>row.record_data);
 const existing=users.find(u=>u.login==='existing-user'),fresh=users.find(u=>u.login==='new-user');
 assert.equal(existing.passwordHash,localHash);assert.equal(existing.mustChangePassword,true);assert.equal(existing.employee,'Updated employee');
 assert.ok(fresh.passwordHash);assert.equal(verifyPassword(fresh.phone,fresh.passwordHash),false);assert.equal(users.length,2);
});
