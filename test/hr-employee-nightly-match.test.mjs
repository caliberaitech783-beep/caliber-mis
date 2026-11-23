// Part E of the owner's plan of 23 Nov 2026: every night both whole lists, HR Pulse's Employee Master and Pulse-II's,
// are matched. Whatever the minute copy missed is corrected by the same rules, and the result is kept for the screen
// and told on Telegram when the two lists were not the same. The people and numbers below are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {createHrEmployeeMinuteCopy,matchDue,istDate,istHour,LISTED_SQL,HR_MATCH_HOUR,HR_MATCH_RETRY_MINUTES,HR_COPY_STATE_KEY} from '../server/services/hr-employee-minute-copy.mjs';
import {HR_COPY_STOP_LIMIT} from '../shared/hr-employee-changes.mjs';
import {registerMasterSync} from '../server/routes/master-sync.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';

const MAJRI='Majri OC',SASTI='Sasti OC',LALPETH='LALPETH OB',MINUTE=60000;
// 23 Nov 2026, 14:30 in India: the day the copy is started. The next night's match is due from 24 Nov 02:00 in India.
const START=Date.parse('2026-11-23T09:00:00.000Z'),NIGHT=Date.parse('2026-11-23T20:35:00.000Z');
const person=(number,name,site,extra={})=>({caliberId:'CMPL'+number,caliberCode:'CMLL'+number,name,site,currentLocation:site,currentDesignationName:'TIPPER DRIVER',currentDepartmentName:'PRODUCTION',
 hrListed:true,hrLeft:false,status:'Active',hrSite:site===MAJRI?'Majri OB':site===SASTI?'Sasti OB':site,hrStatus:'ACTIVE',hrCategory:'SKILLED',hrRegion:'WCL',employeeMasterRevision:3,...extra});
const hrLine=(number,name,site='Majri OB',extra={})=>({employeeId:'CMLL'+number,name,region:'WCL',site,department:'PRODUCTION',designation:'TIPPER DRIVER',category:'SKILLED',status:'ACTIVE',reportingTo:'',contact:'',leavingDate:'',source:'HR register',...extra});

async function fixture({people=[]}={}){
 const db=new PGlite();
 await db.exec("CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE pulse_master_links(master_name TEXT,source_id TEXT,local_id BIGINT);CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 for(const record of people)await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1)",[JSON.stringify(record)]);
 const query=(sql,params)=>/pg_try_advisory_lock/.test(sql)?Promise.resolve({rows:[{ok:true}]}):/pg_advisory/.test(sql)?Promise.resolve({rows:[]}):!params&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 const state={now:START,all:[],fail:''},calls={changes:0,employees:0},alerts=[];
 const hr={configured:()=>true,changes:async after=>{calls.changes++;return {ready:true,after,latest:String(after),more:false,numbers:[],employees:[]};},
  employees:async()=>{calls.employees++;if(state.fail)throw Object.assign(new Error(state.fail),{status:502});return {employees:state.all};}};
 const copy=createHrEmployeeMinuteCopy({pool,hr,now:()=>state.now,alert:async(message,key)=>{alerts.push({key,message});}});
 const all=async()=>(await db.query("SELECT id,record_data FROM master_records WHERE master_name='Employee master' ORDER BY id")).rows.map(r=>({id:Number(r.id),...r.record_data}));
 const saved=async()=>(await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[HR_COPY_STATE_KEY])).rows[0]?.setting_value||{};
 return {db,pool,copy,hr,state,calls,alerts,all,saved,close:()=>db.close()};
}

test('the match is due once a night from 02:00 in India, not on the day of the start, and not right after a failed try',()=>{
 const started={started:true,startedAt:new Date(START).toISOString()};
 assert.deepEqual([HR_MATCH_HOUR,istHour(START),istDate(START),istHour(NIGHT),istDate(NIGHT)],[2,14,'2026-11-23',2,'2026-11-24']);
 assert.equal(matchDue(started,START+MINUTE),false,'the day it was started');
 assert.equal(matchDue(started,Date.parse('2026-11-23T19:00:00.000Z')),false,'00:30 in India: before the hour');
 assert.equal(matchDue(started,NIGHT),true);
 assert.equal(matchDue({...started,lastMatch:{day:'2026-11-24'}},NIGHT+3*60*MINUTE),false,'done for that day');
 assert.equal(matchDue({...started,lastMatch:{day:'2026-11-23'}},NIGHT),true);
 assert.equal(matchDue({...started,matchTriedAt:new Date(NIGHT-5*MINUTE).toISOString()},NIGHT),false,'a try failed five minutes ago');
 assert.equal(matchDue({...started,matchTriedAt:new Date(NIGHT-HR_MATCH_RETRY_MINUTES*MINUTE).toISOString()},NIGHT),true);
 assert.equal(matchDue({...started,stopped:{at:'x'}},NIGHT),false);assert.equal(matchDue({},NIGHT),false);
 assert.equal(matchDue({...started,resumedAt:new Date(NIGHT-MINUTE).toISOString()},NIGHT),false,'started again that day after a stop');
});

test('the people Pulse-II lists, with their site, are read from the database in one small list',async()=>{
 const f=await fixture({people:[person(7001,'A',MAJRI),person(7002,'OFF',MAJRI,{hrListed:false}),person(7003,'LEFT MAN',SASTI,{hrLeft:true}),{caliberId:'LEFT',name:'NO NUMBER',site:MAJRI},{caliberId:'7004',name:'PLAIN',currentLocation:SASTI}]});
 try{
  const rows=(await f.db.query(LISTED_SQL)).rows.map(row=>[row.number,row.site]);
  assert.deepEqual(rows,[['7001',MAJRI],['7003',SASTI],[null,MAJRI],['7004',SASTI]],'a person already off HR\'s list is not in it');
 }finally{await f.close();}
});

test('what the minute copy missed is corrected; a site HR Pulse does not cover and a dummy ID are left alone',async()=>{
 const f=await fixture({people:[person(7001,'MISSED EDIT',MAJRI),person(7002,'REMOVED IN HR',MAJRI),person(7003,'SAME MAN',SASTI),person(9001,'LALPETH MAN',LALPETH,{hrSite:undefined}),
  // CMLL12227 is the shared dummy ID of Majri (shared/dummy-employee-ids.mjs): temporary drivers work under it.
  {caliberId:'CMPL12227',caliberCode:'CMLL12227',name:'DUMMY DRIVER',site:MAJRI},person(7005,'OLD ERP MAN',MAJRI,{hrListed:false})]});
 try{
  await f.copy.start({by:'owner'});
  f.state.all=[hrLine(7001,'MISSED EDIT','Majri OB',{designation:'VOLVO DRIVER',contact:'9000000001'}),hrLine(7003,'SAME MAN','Sasti OB'),hrLine(22501,'MISSED JOINER','Sasti OB')];
  // By hand, on the day of the start.
  const first=await f.copy.match({by:'owner',force:true});
  // Listed here at the sites HR Pulse covers: the three workers and the dummy ID. Lalpeth is not among them.
  assert.deepEqual([first.ok,first.same,first.hrLines,first.hrPeople,first.listedHere,first.held],[true,false,3,3,4,0]);
  assert.deepEqual(first.summary,{people:5,added:1,updated:1,unchanged:1,removed:1,left:0,moved:0,held:0,switchedOff:1});
  const [edit,removed,same,lalpeth,dummy,old,joiner]=await f.all();
  assert.deepEqual([edit.currentDesignationName,edit.hrContact],['VOLVO DRIVER','9000000001']);
  assert.deepEqual([removed.hrListed,removed.name],[false,'REMOVED IN HR'],'switched off, not deleted');
  assert.equal(same.employeeMasterRevision,3,'an unchanged person is not written');
  assert.deepEqual([lalpeth.hrListed,lalpeth.site,lalpeth.employeeMasterRevision],[true,LALPETH,3],'HR Pulse has no line for Lalpeth: its people are left as they are');
  assert.deepEqual([dummy.hrListed,dummy.name],[undefined,'DUMMY DRIVER']);
  assert.equal(old.hrListed,false);
  assert.deepEqual([joiner.caliberId,joiner.site],['CMPL22501',SASTI]);
  assert.equal(f.alerts.length,0,'a match a person asked for is answered on the screen, not on Telegram');
  const status=await f.copy.status();
  assert.deepEqual([status.lastMatch.same,status.lastMatch.day,status.lastMatch.by,status.matchHour],[false,'2026-11-23','owner',2]);
  // Matched again: now the same, and nothing is written.
  const again=await f.copy.match({by:'owner',force:true});
  assert.deepEqual([again.same,again.summary.added+again.summary.updated+again.summary.removed],[true,0]);
  assert.equal((await f.all())[0].employeeMasterRevision,edit.employeeMasterRevision);
 }finally{await f.close();}
});

test('the night: one match from 02:00 in India, told on Telegram only when the lists were not the same',async()=>{
 const f=await fixture({people:[person(7001,'FIRST MAN',MAJRI),person(7002,'SECOND MAN',MAJRI)]});
 try{
  await f.copy.start({by:'owner'});
  f.state.all=[hrLine(7001,'FIRST MAN'),hrLine(7002,'SECOND MAN','Majri OB',{designation:'VOLVO DRIVER'})];
  // The afternoon of the start: the minute copy runs, the match does not.
  f.state.now=START+MINUTE;await f.copy.tick();
  assert.deepEqual([f.calls.changes,f.calls.employees],[1,0]);
  // 02:05 the next night: the match runs before the minute's changes, once.
  f.state.now=NIGHT;
  assert.deepEqual(await f.copy.tick(),{ok:true,changed:0});
  assert.deepEqual([f.calls.changes,f.calls.employees],[2,1]);
  assert.equal((await f.all())[1].currentDesignationName,'VOLVO DRIVER');
  assert.deepEqual(f.alerts.map(a=>a.key),['hr-employee-copy:match:2026-11-24']);
  assert.match(f.alerts[0].message,/nightly match with HR Pulse \(2026-11-24\): the two lists were not the same\. Corrected in Pulse-II: 0 added, 1 updated, 0 removed, 0 marked LEFT, 0 moved\. Held for a person: 0\./);
  f.state.now=NIGHT+MINUTE;await f.copy.tick();f.state.now=NIGHT+6*60*MINUTE;await f.copy.tick();
  assert.equal(f.calls.employees,1,'once for that day');
  // The next night nothing differs: the match says "the same" and nobody is told.
  f.state.now=NIGHT+24*60*MINUTE;await f.copy.tick();
  assert.deepEqual([f.calls.employees,f.alerts.length,(await f.copy.status()).lastMatch.same,(await f.copy.status()).lastMatch.day],[2,1,true,'2026-11-25']);
 }finally{await f.close();}
});

test('HR Pulse not answering at night: tried again after 15 minutes, and the minute copy carries on',async()=>{
 const f=await fixture({people:[person(7001,'FIRST MAN',MAJRI)]});
 try{
  await f.copy.start({by:'owner'});
  f.state.all=[hrLine(7001,'FIRST MAN')];f.state.fail='HR did not answer. Existing data retained.';
  f.state.now=NIGHT;
  assert.deepEqual(await f.copy.tick(),{ok:true,changed:0},'the minute copy still ran');
  assert.deepEqual([f.calls.employees,(await f.saved()).matchError,(await f.copy.status()).lastMatch],[1,'HR did not answer. Existing data retained.',null]);
  f.state.now=NIGHT+5*MINUTE;await f.copy.tick();
  assert.equal(f.calls.employees,1);
  f.state.fail='';f.state.now=NIGHT+16*MINUTE;await f.copy.tick();
  assert.deepEqual([f.calls.employees,(await f.copy.status()).lastMatch.same],[2,true]);
  // An empty answer is never taken for "everybody left".
  f.state.all=[];
  await assert.rejects(f.copy.match({force:true}),{status:502,message:'HR Pulse returned no Employee Master. Nothing was changed.'});
  assert.equal((await f.all())[0].hrListed,true);
 }finally{await f.close();}
});

test('a match that would switch off more than 50 people applies nothing and stops the copy',async()=>{
 const many=Array.from({length:HR_COPY_STOP_LIMIT+2},(_,i)=>person(8000+i,'MAN '+i,MAJRI));
 const f=await fixture({people:many});
 try{
  await f.copy.start({by:'owner'});
  f.state.all=[hrLine(8000,'MAN 0')];
  const result=await f.copy.match({by:'owner',force:true});
  assert.deepEqual([result.ok,result.stopped,result.summary.removed],[false,true,51]);
  assert.equal((await f.all()).every(p=>p.hrListed===true),true);
  const status=await f.copy.status();
  assert.match(status.stopped.reason,/The match of both lists would switch off 51 people/);
  assert.deepEqual(f.alerts.map(a=>a.key.split(':').slice(0,2).join(':')),['hr-employee-copy:stopped']);
  await assert.rejects(f.copy.match({force:true}),{status:409});
  // Not started at all: refused too.
  const fresh=await fixture();
  try{await assert.rejects(fresh.copy.match({force:true}),{status:409,message:/not being copied yet/});}finally{await fresh.close();}
 }finally{await f.close();}
});

test('"Match both lists now" on Sync all masters, for a login with that page',async()=>{
 const f=await fixture({people:[person(7001,'FIRST MAN',MAJRI)]});
 try{
  await f.copy.start({by:'owner'});
  f.state.all=[hrLine(7001,'FIRST MAN','Majri OB',{contact:'9000000001'})];
  const hr={...f.hr,count:async()=>0,preview:async()=>({}),sync:async()=>({summary:{}}),transfers:async()=>({transfers:[]})};
  const app=express();app.use(express.json());const audits=[];
  app.use((req,res,next)=>{res.on('finish',()=>{if(req.audit)audits.push(req.audit)});next()});
  registerMasterSync(app,{pool:f.pool,pulse:{status:()=>({connected:true,busy:false})},erp:{status:async()=>({configured:false})},hr,copy:f.copy,requireSession:(q,s,n)=>{q.session={login:'owner'};n();},requireAdministrator:(q,s,n)=>n()});
  const server=app.listen(0);
  try{
   const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/master-sync/employee-copy/match',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const body=await response.json();
   assert.deepEqual([response.status,body.match.same,body.match.summary.updated,body.employeeCopy.lastMatch.by],[200,false,1,'owner']);
   assert.equal(audits.at(-1).action,'Match Employee Master with HR Pulse');
  }finally{server.close();}
  const login=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages,misMobileAccess:[]}});
  assert.equal(misRequestAllowed(login(['Pulse Master Sync']),{path:'/api/master-sync/employee-copy/match',method:'POST'}),true);
  assert.equal(misRequestAllowed(login(['Reports']),{path:'/api/master-sync/employee-copy/match',method:'POST'}),false);
  const panel=readFileSync(new URL('../src/hr-employee-copy-panel.jsx',import.meta.url),'utf8');
  for(const words of ['Match of both whole lists (every night from','Match both lists now','the same on','not the same on'])assert.ok(panel.includes(words),words);
  assert.ok(readFileSync(new URL('../src/pulse-master-sync.jsx',import.meta.url),'utf8').includes("call('/api/master-sync/employee-copy/match',{})"));
 }finally{await f.close();}
});
