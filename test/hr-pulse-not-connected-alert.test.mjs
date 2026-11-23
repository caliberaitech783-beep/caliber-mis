// Owner, 23 Nov 2026: "Yes add it" to a Telegram alert for when Pulse-II loses its connection to HR Pulse.
// That afternoon a release moved the connection key (the server setting HR_SYNC_KEY) off the live server: the
// every-minute copy from HR Pulse stood still for 22 minutes and Refresh at a card could not ask HR Pulse, and nobody
// was told, because a server without the key simply skipped its minute.
//   - the live server tells the release approvers once it has been without the key for ten minutes;
//   - it tells again every hour while it lasts, and a later loss is told afresh;
//   - it tells also when the other slot is still copying Employee Master (Refresh is answered by the live server),
//     and the message says which of the two it is;
//   - the test slot never speaks, nor does a server whose copy from HR Pulse was never started;
//   - it never holds back a server that has the key (lastRunAt is not touched);
//   - Refresh says plainly that Pulse-II is not connected, instead of "did not answer, press again".
// The people and numbers below are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {createHrEmployeeMinuteCopy,HR_COPY_STATE_KEY,HR_COPY_SILENT_MINUTES,HR_COPY_DISCONNECTED_REMIND_MINUTES,HR_COPY_NOT_CONNECTED} from '../server/services/hr-employee-minute-copy.mjs';
import {registerErpEmployees,REFRESH_NOT_CONNECTED} from '../server/routes/erp-employee-source.mjs';
import {registerMasterSync} from '../server/routes/master-sync.mjs';
import {automationForEventKey} from '../server/services/automation-switches.mjs';
import {AUTOMATIONS} from '../server/rules/automation-catalogue.mjs';

const START=Date.parse('2026-11-23T11:18:00.000Z'),MINUTE=60000;
async function fixture({live}={}){
 const db=new PGlite();
 await db.exec("CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE pulse_master_links(master_name TEXT,source_id TEXT,local_id BIGINT);CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 const query=(sql,params)=>/pg_try_advisory_lock/.test(sql)?Promise.resolve({rows:[{ok:true}]}):/pg_advisory/.test(sql)?Promise.resolve({rows:[]}):!params&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 const state={now:START,connected:true},alerts=[];
 const hr={configured:()=>state.connected,changes:async after=>({ready:true,after,latest:String(after),more:false,numbers:[],employees:[]}),employees:async()=>({employees:[]}),transfers:async()=>({transfers:[]})};
 const copy=createHrEmployeeMinuteCopy({pool,hr,now:()=>state.now,alert:async(message,key)=>{alerts.push({key,message});},...(live===undefined?{}:{live})});
 const saved=async()=>(await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[HR_COPY_STATE_KEY])).rows[0]?.setting_value||{};
 const patch=async value=>db.query("UPDATE app_settings SET setting_value=setting_value||$2::jsonb WHERE setting_key=$1",[HR_COPY_STATE_KEY,JSON.stringify(value)]);
 const later=minutes=>{state.now+=minutes*MINUTE;};
 return {db,pool,hr,copy,state,alerts,saved,patch,later,close:()=>db.close()};
}
const CAUSE='\nCause: the server setting HR_SYNC_KEY is missing on the live server. It must be saved on both slots and kept with each slot (Azure, App Service settings).';

test('the live server tells the approvers once it has been without the HR Pulse key for ten minutes, then every hour',async()=>{
 const f=await fixture();
 try{
  await f.copy.start({by:'owner'});f.later(1);
  assert.equal((await f.copy.tick()).ok,true);
  const lastOk=(await f.saved()).lastOkAt;
  assert.deepEqual(await f.copy.notConnected(),{skipped:'connected'},'a server that has the key has nothing to say');

  // The key leaves the live server (23 Nov 2026: a release moved it away). 16:49 IST is when it found out.
  f.state.connected=false;
  assert.deepEqual(await f.copy.tick(),{skipped:'not connected'});
  assert.deepEqual(await f.copy.notConnected(),{skipped:'not connected'});
  f.later(HR_COPY_SILENT_MINUTES-1);
  assert.deepEqual(await f.copy.notConnected(),{skipped:'not connected'},'not yet ten minutes');
  assert.equal(f.alerts.length,0);
  f.later(1);
  assert.deepEqual(await f.copy.notConnected(),{skipped:'not connected',told:true});
  assert.equal(f.alerts.length,1);
  assert.match(f.alerts[0].key,/^hr-employee-copy:not-connected:/);
  assert.equal(f.alerts[0].message,'⛔ The live server of Pulse-II has not been connected to HR Pulse since 16:49 IST. Refresh at a card cannot ask HR Pulse, and Employee Master changes and transfers are not coming.'+CAUSE);
  const after=await f.saved();
  assert.equal(after.error,HR_COPY_NOT_CONNECTED,'Sync all masters shows why');
  assert.equal(after.lastRunAt,lastOk,'lastRunAt is not touched: a server that has the key must not skip its minute');
  assert.equal(after.lastOkAt,lastOk);

  // Every minute after that: quiet. After an hour: told again, under another key.
  for(let i=0;i<5;i++){f.later(1);assert.deepEqual(await f.copy.notConnected(),{skipped:'not connected'});}
  assert.equal(f.alerts.length,1);
  f.later(HR_COPY_DISCONNECTED_REMIND_MINUTES-5);
  assert.equal((await f.copy.notConnected()).told,true);
  assert.equal(f.alerts.length,2);assert.notEqual(f.alerts[1].key,f.alerts[0].key);

  // The key is back: the copy runs again and its error is cleared. A later loss is a new one: ten minutes, then told,
  // although the last telling was less than an hour ago.
  f.state.connected=true;f.later(1);
  assert.equal((await f.copy.tick()).ok,true);
  assert.equal((await f.saved()).error,'');assert.equal((await f.saved()).disconnected,null);
  f.state.connected=false;f.later(1);
  assert.deepEqual(await f.copy.notConnected(),{skipped:'not connected'});
  f.later(HR_COPY_SILENT_MINUTES);
  assert.equal((await f.copy.notConnected()).told,true);
  assert.equal(f.alerts.length,3);
 }finally{await f.close();}
});

test('it tells also while the other slot is still copying, and says so; the test slot and a copy never started stay quiet',async()=>{
 const f=await fixture();
 try{
  // Never started: there is no connection to lose, however long.
  f.state.connected=false;
  for(let i=0;i<30;i++){assert.deepEqual(await f.copy.notConnected(),{skipped:'not connected'});f.later(1);}
  assert.equal(f.alerts.length,0);
  f.state.connected=true;
  await f.copy.start({by:'owner'});f.later(1);await f.copy.tick();

  // The live server has no key; the other slot copied two minutes ago, every minute. Refresh at a card is answered
  // by the live server, so the people are told, and the message does not say that nothing is being copied.
  f.state.connected=false;
  let told=0;
  for(let i=0;i<=HR_COPY_SILENT_MINUTES;i++){
   const fresh=new Date(f.state.now-2*MINUTE).toISOString();
   await f.patch({lastOkAt:fresh,lastRunAt:fresh,error:''});
   if((await f.copy.notConnected()).told)told++;
   f.later(1);
  }
  assert.equal(told,1);assert.equal(f.alerts.length,1);
  assert.match(f.alerts[0].message,/^⛔ The live server of Pulse-II has not been connected to HR Pulse since \d\d:\d\d IST\. Refresh at a card cannot ask HR Pulse\. Employee Master is still being copied by the other server\.\nCause: /);
  assert.equal((await f.saved()).error,'','the other server\'s copy is running: its line is left alone');
 }finally{await f.close();}

 // The test slot (not live) without the key: never a word.
 const slot=await fixture({live:false});
 try{
  await slot.copy.start({by:'owner'});slot.later(1);await slot.copy.tick();
  slot.state.connected=false;
  for(let i=0;i<90;i++){assert.deepEqual(await slot.copy.notConnected(),{skipped:'not connected'});slot.later(1);}
  assert.equal(slot.alerts.length,0);
 }finally{await slot.close();}
});

test('the minute run of Sync all masters asks the copy to tell, and the alert is a line of the Automation Centre',async()=>{
 const f=await fixture();
 try{
  await f.copy.start({by:'owner'});f.later(1);await f.copy.tick();
  const app=express();
  const sync=registerMasterSync(app,{pool:f.pool,pulse:{configured:()=>false},erp:{configured:()=>false},hr:f.hr,copy:f.copy,requireSession:(req,res,next)=>next(),requireAdministrator:(req,res,next)=>next()});
  f.state.connected=false;
  assert.deepEqual(await sync.minute(),{skipped:'not connected'});
  f.later(HR_COPY_SILENT_MINUTES);
  assert.deepEqual(await sync.minute(),{skipped:'not connected',told:true});
  f.later(1);
  assert.deepEqual(await sync.minute(),{skipped:'not connected'});
  assert.equal(f.alerts.length,1);
  assert.equal(automationForEventKey(f.alerts[0].key+':mohitchadda'),'hr-employee-copy','the alert follows the A27 switch');
  assert.match(AUTOMATIONS.find(item=>item.key==='hr-employee-copy').rule,/the live server has lost its connection to HR Pulse \(the server setting HR_SYNC_KEY is missing\) for 10 minutes, told again every hour/);
  const source=readFileSync(new URL('../server/routes/master-sync.mjs',import.meta.url),'utf8');
  assert.ok(source.includes("if(!hr.configured()){const told=copy?.notConnected?await copy.notConnected().catch(()=>null):null;"));
  // The live server is the one that speaks: server.mjs says which slot this is.
  assert.ok(readFileSync(new URL('../server.mjs',import.meta.url),'utf8').includes('createHrEmployeeMinuteCopy({pool,hr:hrEmployeeSync,live:isLiveSlot(),'));
 }finally{await f.close();}
});

test('Refresh says that Pulse-II is not connected, not that HR Pulse did not answer',async()=>{
 const f=await fixture();
 const app=express();app.use(express.json());
 let copy=f.copy;
 registerErpEmployees(app,{pool:f.pool,requireSession:(req,res,next)=>{req.session={login:'site.operator'};next()},requireAdministrator:(req,res,next)=>next(),getSiteScope:async()=>({sites:null,label:'All sites'}),hrCopy:()=>copy});
 const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
 const refresh=async()=>{const r=await fetch(base+'/api/log-books/employee-refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caliberId:'7001',location:'Majri OC'})});return {status:r.status,body:await r.json()};};
 try{
  assert.equal(REFRESH_NOT_CONNECTED,'Pulse-II is not connected to HR Pulse right now, so it could not be asked. Please tell your MIS administrator.');
  f.state.connected=false;
  assert.deepEqual(await refresh(),{status:503,body:{error:REFRESH_NOT_CONNECTED,refresh:true}},'the key is missing on this server');
  copy=null;
  assert.deepEqual(await refresh(),{status:503,body:{error:REFRESH_NOT_CONNECTED,refresh:true}},'no copy on this server at all');
  // HR Pulse asked and not answering is another matter: pressing again in a minute helps.
  copy=f.copy;f.state.connected=true;f.hr.employees=async()=>{throw Object.assign(new Error('HR did not answer. Existing data retained.'),{status:502});};
  assert.deepEqual(await refresh(),{status:502,body:{error:'HR Pulse did not answer. Press Refresh again in a minute.',refresh:true}});
 }finally{server.close();await f.close();}
});
