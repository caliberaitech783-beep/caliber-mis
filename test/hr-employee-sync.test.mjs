// Employee Master and Employee Transfer copied from HR every hour (owner, 23 Nov 2026): server/services/hr-employee-sync.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import {createHrEmployeeSync,hrEmployeeSheet,planHrTransfers,HR_SYNC_LIMITS} from '../server/services/hr-employee-sync.mjs';
import {registerMasterSync,MASTER_SYNC_ROWS,HR_SYNC_ACTOR,EMPLOYEE_MASTER_NEEDS_PREVIEW} from '../server/routes/master-sync.mjs';
import {EMPLOYEE_MASTER_OWNER_KEY,HR_MASTER_OWNER} from '../shared/hr-employee-master.mjs';

const KEY='s'.repeat(40);
const hrLine=(employeeId,name,site,status='',designation='TIPPER DRIVER')=>({employeeId,name,region:'WCL',site,department:'PRODUCTION',designation,category:'TEMPORARY',status,source:'HR register'});

async function fixture({employees=[],transfers=[],people=[],owner=true}={}){
 const db=new PGlite();
 await db.exec("CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE pulse_master_links(master_name TEXT,source_id TEXT,local_id BIGINT);CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 for(const person of people)await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1)",[JSON.stringify(person)]);
 if(owner)await db.query('INSERT INTO app_settings(setting_key,setting_value) VALUES($1,$2)',[EMPLOYEE_MASTER_OWNER_KEY,JSON.stringify({owner:HR_MASTER_OWNER,since:'2026-11-22T00:00:00Z'})]);
 const query=(sql,params)=>/pg_advisory/.test(sql)?Promise.resolve({rows:[]}):!params&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 const calls=[],hr={employees,transfers};
 const request=async(url,options)=>{calls.push({path:new URL(url).pathname,key:options.headers['X-MIS-Sync-Key']});const what=new URL(url).pathname.split('/').pop();
  return new Response(JSON.stringify(what==='employees'?{employees:hr.employees}:{transfers:hr.transfers}),{status:200,headers:{'Content-Type':'application/json'}});};
 const sync=createHrEmployeeSync({pool,key:KEY,base:'https://hr.test',request});
 const all=async()=>(await db.query("SELECT id,record_data FROM master_records WHERE master_name='Employee master' ORDER BY id")).rows;
 return {db,pool,sync,hr,calls,all,close:()=>db.close()};
}

test('Sync all masters has two HR lines: Employee Master (Preview, then copied every minute) and Employee Transfer',()=>{
 const rows=MASTER_SYNC_ROWS.filter(row=>row.source==='HR');
 assert.deepEqual(rows.map(row=>[row.name,row.label,row.preview,row.minute===true]),[['Employee master','Employee Master',true,true],['Employee transfer','Employee Transfer',true,false]]);
});

test("HR's lines become the rows of HR's master Excel",()=>{
 assert.deepEqual(hrEmployeeSheet([hrLine('CMLL1','RAM','Majri OB','LEFT')]),[['EMPLOYEE ID','NAME','REGION','SITE / OFFICE','DEPARTMENT','DESIGNATION','CATEGORY','STATUS'],['CMLL1','RAM','WCL','Majri OB','PRODUCTION','TIPPER DRIVER','TEMPORARY','LEFT']]);
 assert.throws(()=>hrEmployeeSheet(undefined),{status:502});
});

test("the hourly copy takes HR's details, keeps the site Pulse-II holds, adds new people, and leaves bad lines out",async()=>{
 const f=await fixture({people:[{caliberId:'CMPL100',employeeId:'CMPL100',name:'RAM OLD',site:'Majri OC',status:'Active',hrListed:true},{caliberId:'CMPL200',employeeId:'CMPL200',name:'SHYAM',site:'Majri OC',status:'Active',hrListed:true}],
  employees:[hrLine('CMLL100','RAM','Sasti OB'),hrLine('CMLL200','SHYAM','Majri OB','LEFT'),hrLine('CMLL300','NEW MAN','Jayant OB'),hrLine('','NO ID','Majri OB')]});
 try{
  const preview=await f.sync.preview('Employee master');
  assert.equal(f.calls[0].path,'/api/integrations/mis/employees');assert.equal(f.calls[0].key,KEY);
  assert.deepEqual([preview.summary.added,preview.summary.left,preview.summary.siteChanged,preview.summary.siteKept,preview.leftOut.lines,preview.stop],[1,1,0,1,1,'']);
  assert.equal((await f.all())[0].record_data.name,'RAM OLD','a preview writes nothing');
  const result=await f.sync.sync('Employee master',{by:HR_SYNC_ACTOR});
  assert.equal(result.applied,true);assert.equal(result.linesLeftOut,1);
  const [ram,shyam,added]=(await f.all()).map(row=>row.record_data);
  assert.deepEqual([ram.name,ram.site,ram.hrSite],['RAM','Majri OC','Sasti OB'],'the site Pulse-II holds is kept');
  assert.deepEqual([shyam.status,shyam.hrLeft],['Left',true]);
  assert.deepEqual([added.caliberId,added.site,added.source],['CMPL300','Jayant OC','HR master']);
  assert.equal((await f.pool.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[EMPLOYEE_MASTER_OWNER_KEY])).rows[0].setting_value.by,HR_SYNC_ACTOR);
 }finally{await f.close();}
});

test('a copy nobody looked at stops when HR would take many people off its list; Apply after a Preview writes it',async()=>{
 const people=Array.from({length:HR_SYNC_LIMITS.notListed+5},(_,i)=>({caliberId:'CMPL'+(1000+i),name:'P'+i,site:'Majri OC',status:'Active',hrListed:true}));
 const f=await fixture({people,employees:[hrLine('CMLL1000','P0','Majri OB')]});
 try{
  await assert.rejects(f.sync.sync('Employee master',{by:HR_SYNC_ACTOR}),error=>error.status===409&&/Stopped: this copy would take 204 people off/.test(error.message));
  assert.equal((await f.all()).filter(row=>row.record_data.hrListed===false).length,0,'nothing was changed');
  const preview=await f.sync.preview('Employee master');
  assert.match(preview.stop,/Stopped/);
  await f.sync.sync('Employee master',{by:'owner',planKey:preview.planKey});
  assert.equal((await f.all()).filter(row=>row.record_data.hrListed===false).length,204);
  await assert.rejects(f.sync.sync('Employee master',{planKey:'stale'}),{status:409});
 }finally{await f.close();}
});

test("before HR's master was ever applied, only a Preview and Apply can start it",async()=>{
 const f=await fixture({owner:false,employees:[hrLine('CMLL1','A','Majri OB')]});
 try{await assert.rejects(f.sync.sync('Employee master'),error=>error.status===409&&/not been applied/.test(error.message));}finally{await f.close();}
});

test('transfers are planned in date order, once each, and wait when the person or the site is unknown',()=>{
 const employees=[{id:'1',record_data:{caliberId:'CMPL100',site:'Majri OC'}}];
 const t=(id,date,to,employeeId='CMLL100')=>({id,code:'TR-'+id,transferDate:date,employeeId,name:'RAM',fromSite:'',toSite:to,approvedAt:date+'T10:00:00Z'});
 const {items,summary}=planHrTransfers([t('b','2026-11-20','Jayant OB'),t('a','2026-11-10','Sasti OB'),t('c','2026-11-21','Head Office'),t('d','2026-11-21','Sasti OB','CMLL999'),t('e','2026-11-22','Jayant OB'),t('f','2026-11-01','Majri OB')],employees,new Set(['f']));
 assert.deepEqual(items.map(item=>[item.id,item.outcome]),[['f','Already in Pulse-II'],['a','Will move'],['b','Will move'],['c','Waiting: To site is not a Pulse-II site'],['d','Waiting: not in Employee Master'],['e','Already at that site']]);
 assert.deepEqual(summary,{transfers:6,move:2,atSite:1,done:1,waiting:2});
});

test('an approved HR transfer moves the worker from its date as an approved move, once, and is never undone by the master copy',async()=>{
 const f=await fixture({people:[{caliberId:'CMPL100',employeeId:'CMPL100',name:'RAM',site:'Majri OC',status:'Active',hrListed:true}],
  employees:[hrLine('CMLL100','RAM','Majri OB')],
  transfers:[{id:'u1',code:'TR-1',transferDate:'2026-11-21',employeeId:'CMLL100',name:'RAM',fromSite:'Majri OB',toSite:'Sasti OB',approvedAt:'2026-11-21T10:00:00Z'},
   {id:'u2',code:'TR-2',transferDate:'2026-11-21',employeeId:'CMLL555',name:'NOT YET',fromSite:'Majri OB',toSite:'Sasti OB',approvedAt:'2026-11-21T10:00:00Z'}]});
 try{
  const preview=await f.sync.preview('Employee transfer');
  assert.deepEqual(preview.items.map(item=>[item.code,item.outcome]),[['TR-2','Waiting: not in Employee Master'],['TR-1','Will move']]);
  const first=await f.sync.sync('Employee transfer',{by:HR_SYNC_ACTOR});
  assert.deepEqual([first.summary.moved,first.summary.waiting],[1,1]);
  const ram=(await f.all())[0].record_data;
  assert.equal(ram.site,'Sasti OC');assert.ok(ram.siteLockedAt);
  assert.deepEqual(ram.siteMoves.map(move=>[move.from,move.to,move.fromDate]),[['Majri OC','Sasti OC','2026-11-21']]);
  const register=(await f.db.query('SELECT employee_ref,from_site,to_site,requested_by,approved_by FROM mis_employee_site_moves')).rows;
  assert.deepEqual(register.map(row=>[row.to_site,row.requested_by,row.approved_by]),[['Sasti OC','hr-transfer',['HR Pulse']]]);
  assert.equal((await f.sync.sync('Employee transfer')).summary.moved,0,'a transfer is applied once');
  assert.equal(await f.sync.count('Employee transfer'),1);
  // HR's register still says Majri: the master copy keeps the moved site.
  await f.sync.sync('Employee master',{by:HR_SYNC_ACTOR});
  assert.equal((await f.all())[0].record_data.site,'Sasti OC');
 }finally{await f.close();}
});

test('HR refusing or not answering changes nothing and says so',async()=>{
 const pool={query:async()=>({rows:[]}),connect:async()=>({query:async()=>({rows:[]}),release(){}})};
 await assert.rejects(createHrEmployeeSync({pool,key:''}).preview('Employee master'),{status:503});
 const refused=createHrEmployeeSync({pool,key:KEY,request:async()=>new Response(JSON.stringify({error:'Invalid Pulse-II sync key'}),{status:401})});
 await assert.rejects(refused.preview('Employee master'),error=>error.status===502&&/401: Invalid Pulse-II sync key/.test(error.message));
 const down=createHrEmployeeSync({pool,key:KEY,request:async()=>{throw new Error('ECONNRESET')}});
 await assert.rejects(down.sync('Employee master'),{status:502});
});

test('the hourly run syncs Employee Transfer (Employee Master has its own minute copy), records the result, and leaves a copy another instance made minutes ago',async()=>{
 const synced=[];
 const f=await fixture();
 try{
  const hr={configured:()=>true,count:async()=>7,preview:async()=>({}),sync:async(name,options)=>{synced.push([name,options.by]);if(name==='Employee transfer')throw Object.assign(new Error('HR did not answer. Existing data retained.'),{status:502});return {summary:{added:1}};}};
  const sync=registerMasterSync(express(),{pool:f.pool,pulse:{status:()=>({connected:true,busy:false})},erp:{status:async()=>({configured:false})},hr,requireSession:(q,s,n)=>n(),requireAdministrator:(q,s,n)=>n()});
  assert.deepEqual((await sync.hourly()).map(r=>[r.name,r.ok]),[['Employee transfer',false]]);
  assert.deepEqual(synced,[['Employee transfer',HR_SYNC_ACTOR]]);
  let rows=(await sync.status()).masters.filter(m=>m.name==='Employee transfer');
  assert.deepEqual(rows.map(m=>[m.label,m.count,m.connected,Boolean(m.lastSuccess),m.error]),[['Employee Transfer',7,true,false,'HR did not answer. Existing data retained.']]);
  hr.sync=async name=>{synced.push([name]);return {summary:{moved:1}};};
  synced.length=0;
  assert.deepEqual((await sync.hourly()).map(r=>[r.name,r.ok]),[['Employee transfer',true]]);
  rows=(await sync.status()).masters.filter(m=>m.name==='Employee transfer');
  assert.deepEqual([rows[0].error,Boolean(rows[0].lastSuccess),Boolean(rows[0].nextSync)],['',true,true]);
  synced.length=0;
  await sync.hourly();
  assert.deepEqual(synced,[],'a sync from minutes ago is left alone');
 }finally{await f.close();}
});

test('the page shows the HR source, a Preview button, and Apply sends the key of the preview it shows',async()=>{
 const fs=await import('node:fs');
 const page=fs.readFileSync(new URL('../src/pulse-master-sync.jsx',import.meta.url),'utf8');
 assert.match(page,/hrpulse\.cmll\.in \(HR\)/);
 assert.match(page,/\/api\/master-sync\/preview\?master=/);
 assert.match(page,/sync\(preview\.master,preview\.planKey\)/);
 const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/const hrEmployeeSync=createHrEmployeeSync\(\{pool\}\);/);assert.match(server,/hr:hrEmployeeSync,copy:hrEmployeeCopy/);
 assert.match(server,/masterSync\.start\(\)/);
});

test('Employee Master: the hour and Sync all leave it; it is applied only with the key of a Preview, which starts the minute copy',async()=>{
 const synced=[],started=[],f=await fixture();
 try{
  const hr={configured:()=>true,count:async()=>0,preview:async name=>({master:name}),sync:async(name,options)=>{synced.push([name,options.planKey||'']);return {summary:{}};}};
  const copy={status:async()=>({started:started.length>0,held:[],stopped:null,error:'',lastOkAt:null,connected:true}),start:async({by})=>{started.push(by);},tick:async()=>({skipped:'not started'}),accept:async()=>({accepted:true,name:'X'})};
  const app=express();app.use(express.json());
  const sync=registerMasterSync(app,{pool:f.pool,pulse:{status:()=>({connected:true,busy:false}),sync:async()=>{}},erp:{status:async()=>({configured:false}),sync:async()=>{}},hr,copy,requireSession:(q,s,n)=>{q.session={login:'owner'};n();},requireAdministrator:(q,s,n)=>n()});
  await sync.hourly();
  assert.deepEqual(synced,[['Employee transfer','']]);
  const status=await sync.status();
  assert.deepEqual(status.masters.filter(m=>m.source==='HR').map(m=>[m.label,m.minute===true]),[['Employee Master',true],['Employee Transfer',false]]);
  assert.deepEqual(status.notSynced,[]);assert.equal(status.employeeCopy.started,false);
  const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
  try{
   const post=async body=>{const r=await fetch(base+'/api/master-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
   synced.length=0;
   assert.equal((await post({master:'all'})).status,200);
   assert.deepEqual(synced,[['Employee transfer','']],'Sync all leaves Employee Master alone');
   synced.length=0;
   const bare=await post({master:'Employee master'});
   assert.deepEqual([bare.status,bare.body.results[0].ok,bare.body.results[0].error],[200,false,EMPLOYEE_MASTER_NEEDS_PREVIEW]);
   assert.deepEqual([synced,started],[[],[]],'nothing is applied and nothing starts without a Preview');
   const applied=await post({master:'Employee master',planKey:'key-of-the-preview'});
   assert.deepEqual([applied.body.results[0].ok,synced,started],[true,[['Employee master','key-of-the-preview']],['owner']]);
   assert.equal(applied.body.employeeCopy.started,true);
   assert.equal((await fetch(base+'/api/master-sync/preview?master=Employee%20master')).status,200);
   assert.equal((await fetch(base+'/api/master-sync/preview?master=Employee%20transfer')).status,200);
   assert.equal((await fetch(base+'/api/master-sync/preview?master=Shift%20Master')).status,400);
   const accepted=await fetch(base+'/api/master-sync/employee-copy/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number:'7001'})});
   assert.equal(accepted.status,200);assert.equal((await accepted.json()).accepted,true);
  }finally{server.close();}
 }finally{await f.close();}
});
