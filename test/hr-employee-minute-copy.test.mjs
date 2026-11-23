// Owner, 23 Nov 2026: "Pulse HR is now the final authority for employee master. All the creation, edit, and delete
// will only happen from Pulse HR ... any data entered in Pulse HR should be auto synchronized on minute to minute
// basis with Pulse 2."
//   - HR Pulse says which employee numbers changed and gives every line those people have now;
//   - Pulse-II applies only those people: details taken, a new person added, LEFT and removed people switched off
//     (never deleted), another site as a dated move;
//   - what could put a wrong person on a number is held and nothing changes for it;
//   - the copy starts only after a person applied a Preview, and stops itself when one minute would switch off
//     more than 50 people.
// The people and numbers below are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {planHrChanges,samePerson,nameKey,slashedId,HR_COPY_STOP_LIMIT,HR_CHANGE_EXISTING_FIELDS} from '../shared/hr-employee-changes.mjs';
import {readHrMasterSheet} from '../shared/hr-employee-master.mjs';
import {createHrEmployeeMinuteCopy,EXISTING_FOR_SQL,HR_COPY_STATE_KEY,HR_COPY_SILENT_MINUTES,istDate} from '../server/services/hr-employee-minute-copy.mjs';
import {createHrEmployeeSync,hrEmployeeSheet} from '../server/services/hr-employee-sync.mjs';
import {registerMasterSync,HR_MINUTE_ACTOR} from '../server/routes/master-sync.mjs';
import {automationForEventKey} from '../server/services/automation-switches.mjs';
import {AUTOMATIONS} from '../server/rules/automation-catalogue.mjs';
import {employeeAtLocation,employeeOnHrList} from '../shared/log-book-access.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';

const MAJRI='Majri OC',SASTI='Sasti OC',START=Date.parse('2026-11-23T09:00:00.000Z'),MINUTE=60000;
const person=(number,name,site,extra={})=>({caliberId:'CMPL'+number,caliberCode:'CMLL'+number,name,site,currentLocation:site,currentDesignationName:'TIPPER DRIVER',currentDepartmentName:'PRODUCTION',
 hrListed:true,hrLeft:false,status:'Active',hrSite:site===MAJRI?'Majri OB':site===SASTI?'Sasti OB':site,hrStatus:'ACTIVE',hrCategory:'SKILLED',hrRegion:'WCL',employeeMasterRevision:3,panNo:'KEEP'+number,...extra});
const hrLine=(number,name,site='Majri OB',extra={})=>({employeeId:'CMLL'+number,name,region:'WCL',site,department:'PRODUCTION',designation:'TIPPER DRIVER',category:'SKILLED',status:'ACTIVE',reportingTo:'',contact:'',leavingDate:'',source:'HR register',...extra});
const row=(id,record,master='Employee master')=>({id,master_name:master,record_data:record});

test('the same person, and two people',()=>{
 assert.equal(samePerson('Sample Kumar Patel','SAMPLE KUMAR PATEL'),true);
 assert.equal(samePerson('SAMPLE','SAMPLE YADAV'),true);
 assert.equal(samePerson('SAMPLE KUMAR PATEL','SAMPLE PATEL'),true);
 assert.equal(samePerson('FIRST KUMAR EXAMPLE','OTHER RAY'),false);
 assert.equal(samePerson('RAM KUMAR YADAV','SHYAM KUMAR SINGH'),false);
 assert.equal(samePerson('RAM KUMAR','RAM SINGH'),false);
 assert.equal(nameKey(' ram  kumar-yadav '),'RAM KUMAR YADAV');
});

test('one line in HR Pulse: the details are taken, a person Pulse-II does not have is added, and an unchanged person is not written',()=>{
 const existing=[row(1,person(7001,'OLD SPELLING MAN',MAJRI)),row(2,person(7002,'SAME MAN',MAJRI))];
 const plan=planHrChanges(existing,['7001','7002','22501'],[
  hrLine(7001,'OLD SPELING MAN','Majri OB',{designation:'VOLVO DRIVER',reportingTo:'A MANAGER',contact:'9000000001'}),
  hrLine(7002,'SAME MAN'),hrLine(22501,'NEW JOINER','Sasti OB',{designation:'EXCAVATOR OPERATOR'})],{now:'2026-11-23T09:00:00.000Z'});
 assert.deepEqual(plan.updates,[{id:'1',patch:{name:'OLD SPELING MAN',hrReportingTo:'A MANAGER',hrContact:'9000000001',currentDesignationName:'VOLVO DRIVER',hrCopiedAt:'2026-11-23T09:00:00.000Z'}}]);
 assert.equal(plan.inserts.length,1);
 const added=plan.inserts[0];
 assert.deepEqual([added.caliberId,added.caliberCode,added.name,added.site,added.currentLocation,added.currentDesignationName,added.hrListed,added.hrLeft,added.status,added.source],
  ['CMPL22501','CMLL22501','NEW JOINER',SASTI,SASTI,'EXCAVATOR OPERATOR',true,false,'Active','HR Pulse']);
 assert.equal(employeeAtLocation(added,SASTI),true,'the new joiner can be put on a Sasti card at once');
 assert.deepEqual([plan.offIds,plan.moves,plan.held],[[],[],[]]);
 assert.deepEqual(plan.summary,{people:3,added:1,updated:1,unchanged:1,removed:0,left:0,moved:0,held:0,switchedOff:0});
});

test('LEFT and removed in HR Pulse: the person is switched off, never deleted',()=>{
 const existing=[row(1,person(7001,'LEAVING MAN',MAJRI)),row(2,person(7002,'REMOVED MAN',MAJRI)),row(3,person(7003,'ALREADY OFF',MAJRI,{hrListed:false}))];
 const plan=planHrChanges(existing,['7001','7002','7003'],[hrLine(7001,'LEAVING MAN','Majri OB',{status:'left',leavingDate:'2026-11-20T00:00:00Z'})],{now:'2026-11-23T09:00:00.000Z'});
 assert.deepEqual(plan.updates,[{id:'1',patch:{hrStatus:'LEFT',status:'Left',hrLeft:true,hrLeavingDate:'2026-11-20',hrCopiedAt:'2026-11-23T09:00:00.000Z'}}]);
 assert.deepEqual(plan.offIds,['2'],'the line HR Pulse no longer holds; a person already off is left alone');
 assert.deepEqual([plan.summary.left,plan.summary.removed,plan.summary.switchedOff],[1,1,2]);
 assert.equal(employeeOnHrList({...existing[0].record_data,...plan.updates[0].patch}),false,'a LEFT person is never matched on a new card');
});

test('what could put a wrong person on a number is held, and nothing changes for that number',()=>{
 const existing=[row(1,person(7001,'WORKING DRIVER',MAJRI)),row(2,person(7002,'OLD ERP PERSON',MAJRI,{hrListed:false})),row(3,person(7003,'TWICE MAN',MAJRI))];
 const lines=[hrLine(7001,'COMPLETELY OTHER'),hrLine(7002,'NEW OFFICE PERSON','Sasti OB'),hrLine(7003,'TWICE MAN','Majri OB'),hrLine(7003,'TWICE MAN','Sasti OB'),hrLine(7004,'')];
 const plan=planHrChanges(existing,['7001','7002','7003','7004'],lines);
 assert.deepEqual([plan.updates,plan.inserts,plan.offIds,plan.moves],[[],[],[],[]]);
 assert.deepEqual(plan.held.map(item=>[item.number,item.employeeId,item.reason]),[['7001','CMLL7001','other-name'],['7002','CMLL7002','old-person'],['7003','CMLL7003','two-lines'],['7004','CMLL7004','no-name']]);
 assert.match(plan.held[0].detail,/WORKING DRIVER in Pulse-II, COMPLETELY OTHER in HR Pulse/);
 assert.match(plan.held[1].detail,/belongs to OLD ERP PERSON, who is not on HR's list/);
 assert.match(plan.held[2].detail,/CMLL7003 is on 2 lines in HR Pulse/);
 assert.equal(plan.summary.held,4);
 // A name an administrator has looked at and accepted is taken.
 const accepted=planHrChanges(existing,['7001'],lines,{accepted:{7001:nameKey('COMPLETELY OTHER')}});
 assert.deepEqual([accepted.held,accepted.updates[0].patch.name,accepted.clear],[[],'COMPLETELY OTHER',['7001']]);
});

test('another site in HR Pulse is a move; a site set by an OTP in Pulse-II is never pulled back',()=>{
 const existing=[row(1,person(7001,'MOVING MAN',MAJRI)),row(2,person(7002,'OTP MOVED MAN',SASTI,{siteLockedAt:'2026-11-23T05:00:00Z',siteLockedBy:'sasti.operator'})),
  row(3,person(7003,'HR MOVED MAN',SASTI,{siteLockedAt:'2026-11-23T05:00:00Z',siteLockedBy:'hr-transfer'})),row(4,person(7004,'OFFICE BOUND',MAJRI)),row(5,person(7005,'NO SITE MAN',''))];
 const plan=planHrChanges(existing,['7001','7002','7003','7004','7005'],[hrLine(7001,'MOVING MAN','Sasti OB'),hrLine(7002,'OTP MOVED MAN','Majri OB'),hrLine(7003,'HR MOVED MAN','Majri OB'),hrLine(7004,'OFFICE BOUND','Nagpur CO'),hrLine(7005,'NO SITE MAN','Sasti OB')]);
 assert.deepEqual(plan.moves.map(move=>[move.id,move.from,move.to]),[['1',MAJRI,SASTI],['3',SASTI,MAJRI]]);
 assert.deepEqual(plan.held.map(item=>[item.number,item.reason]),[['7002','site-by-otp'],['7004','site-not-ours']]);
 assert.match(plan.held[0].detail,/moved this worker to Sasti OC with an OTP; HR Pulse still shows Majri OB/);
 const placed=plan.updates.find(update=>update.id==='5').patch;
 assert.deepEqual([placed.site,placed.currentLocation],[SASTI,SASTI],'a worker with no site takes HR\'s');
 assert.equal(plan.updates.some(update=>'site' in update.patch&&update.id!=='5'),false,'a site is never changed by a plain patch');
});

test('an ID with a slash is never taken for a number: the line is held, and left out of the whole-list copy',()=>{
 assert.equal(slashedId('CMLL6665/1'),true);assert.equal(slashedId('CMLL 6665'),false);assert.equal(slashedId('CMLL-6665'),false);
 const plan=planHrChanges([],['66651'],[hrLine('6665/1','SLASH MAN')]);
 assert.deepEqual([plan.inserts,plan.updates,plan.held.map(item=>[item.number,item.employeeId,item.reason])],[[],[],[['66651','CMLL6665/1','bad-id']]]);
 const sheet=hrEmployeeSheet([hrLine('6665/1','SLASH MAN'),hrLine(7001,'PLAIN MAN')]);
 assert.deepEqual(sheet.slice(1).map(cells=>cells[0]),['ID CMLL6665/1','CMLL7001']);
 const read=readHrMasterSheet(sheet,{leaveOut:true});
 assert.deepEqual([read.records.map(record=>record.number),read.problems.map(problem=>[problem.employeeId,problem.problem])],[['7001'],[['ID CMLL6665/1','No usable Employee ID. Write the CMLL number.']]]);
});

test('dummy driver IDs are untouched, and an old second line of a number steps aside',()=>{
 const existing=[row(1,person(21327,'REAL MAN',MAJRI)),row(2,{caliberId:'21327',name:'REAL MAN',site:MAJRI,hrListed:true,hrLeft:false,status:'Active'})];
 const plan=planHrChanges(existing,['21327','99999999'],[hrLine(21327,'REAL MAN')]);
 assert.deepEqual(plan.offIds,['2']);
 assert.equal(plan.held.length,0);
 assert.ok(HR_CHANGE_EXISTING_FIELDS.includes('siteLockedBy')&&HR_CHANGE_EXISTING_FIELDS.includes('hrLeavingDate'));
});

// ---- the service, on a real database engine ----
async function fixture({people=[],locked=true}={}){
 const db=new PGlite();
 await db.exec("CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE pulse_master_links(master_name TEXT,source_id TEXT,local_id BIGINT);CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 for(const record of people)await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1)",[JSON.stringify(record)]);
 const reads=[];
 const query=(sql,params)=>{
  if(/pg_try_advisory_lock/.test(sql))return Promise.resolve({rows:[{ok:state.locked}]});
  if(/pg_advisory/.test(sql))return Promise.resolve({rows:[]});
  if(sql===EXISTING_FOR_SQL)reads.push(params[0]);
  return !params&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,params);
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const state={now:START,locked,feeds:[],fail:null,ready:true,all:[]},asked=[],alerts=[];
 // HR Pulse: each call hands out the next prepared answer; with none prepared, nothing changed.
 const hr={configured:()=>true,
  changes:async after=>{asked.push(String(after));if(state.fail)throw Object.assign(new Error(state.fail),{status:502});if(!state.ready)return {ready:false,after,latest:after,more:false,numbers:[],employees:[]};
   const next=state.feeds.shift();return next?{ready:true,after,more:false,...next}:{ready:true,after,latest:String(after),more:false,numbers:[],employees:[]};},
  employees:async()=>({employees:state.all})};
 const copy=createHrEmployeeMinuteCopy({pool,hr,now:()=>state.now,alert:async(message,key)=>{alerts.push({key,message});}});
 const all=async()=>(await db.query("SELECT id,record_data FROM master_records WHERE master_name='Employee master' ORDER BY id")).rows.map(r=>({id:Number(r.id),...r.record_data}));
 const saved=async()=>(await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[HR_COPY_STATE_KEY])).rows[0]?.setting_value||{};
 const minute=async()=>{state.now+=MINUTE;return copy.tick();};
 return {db,pool,copy,hr,state,asked,alerts,reads,all,saved,minute,close:()=>db.close()};
}

test('the database reads only the people asked for, whatever way their number is written',async()=>{
 const f=await fixture({people:[person(7001,'A',MAJRI),{caliberId:'7002',name:'B',site:MAJRI},{employeeId:'CMLL 7003',name:'C',site:MAJRI},{caliberId:'X',caliberCode:'CMLL-07004',name:'D',site:MAJRI},
  person(70010,'TEN TIMES',MAJRI),{caliberId:'LEFT',name:'NO NUMBER',site:MAJRI},person(7005,'NOT ASKED',MAJRI)]});
 try{
  const found=(await f.db.query(EXISTING_FOR_SQL,[['7001','7002','7003','7004']])).rows;
  assert.deepEqual(found.map(r=>r.record_data.name),['A','B','C','D']);
  assert.equal('panNo' in found[0].record_data,false,'only the fields the plan reads');
 }finally{await f.close();}
});

test('it starts only after a person applied the Preview; then one minute copies one batch',async()=>{
 const f=await fixture({people:[person(7001,'FIRST MAN',MAJRI),person(7002,'LEAVING MAN',MAJRI),person(7003,'REMOVED MAN',MAJRI),person(7004,'MOVING MAN',MAJRI)]});
 try{
  f.state.feeds.push({latest:'5',numbers:['7001'],employees:[hrLine(7001,'FIRST MAN RENAMED')]});
  assert.deepEqual(await f.minute(),{skipped:'not started'});
  assert.deepEqual([f.asked,(await f.all())[0].name],[[],'FIRST MAN'],'HR Pulse is not even asked before the start');
  await f.copy.start({by:'owner'});
  assert.deepEqual([(await f.copy.status()).started,(await f.saved()).startedBy],[true,'owner']);

  f.state.feeds.length=0;
  f.state.feeds.push({latest:'9',numbers:['7001','7002','7003','7004','22501'],employees:[
   hrLine(7001,'FIRST MAN','Majri OB',{designation:'VOLVO DRIVER'}),hrLine(7002,'LEAVING MAN','Majri OB',{status:'LEFT',leavingDate:'2026-11-22'}),
   hrLine(7004,'MOVING MAN','Sasti OB'),hrLine(22501,'NEW JOINER','Sasti OB')]});
  const done=await f.minute();
  assert.deepEqual([done.ok,done.changed,done.held],[true,5,0]);
  // The moved worker counts as updated too: the site HR Pulse writes is noted on the line.
  assert.deepEqual(done.summary,{people:5,added:1,updated:3,unchanged:0,removed:1,left:1,moved:1,held:0,switchedOff:2});
  const [first,leaving,removed,moving,joiner]=await f.all();
  assert.deepEqual([first.currentDesignationName,first.employeeMasterRevision,first.panNo],['VOLVO DRIVER',4,'KEEP7001'],'details taken, everything else of the record kept');
  assert.deepEqual([leaving.hrLeft,leaving.status,leaving.hrLeavingDate],[true,'Left','2026-11-22']);
  assert.deepEqual([removed.hrListed,removed.name,removed.site],[false,'REMOVED MAN',MAJRI],'switched off, still there for saved cards');
  assert.deepEqual([moving.site,moving.siteMoves.length,moving.siteMoves[0].fromDate,moving.siteLockedBy],[SASTI,1,istDate(f.state.now),'hr-master']);
  assert.equal(employeeAtLocation(moving,MAJRI,'2026-11-01'),true,'an earlier card still finds the worker at the old site');
  assert.deepEqual([joiner.caliberId,joiner.site,joiner.source],['CMPL22501',SASTI,'HR Pulse']);
  const move=(await f.db.query('SELECT from_site,to_site,requested_by FROM mis_employee_site_moves')).rows;
  assert.deepEqual(move.map(m=>[m.from_site,m.to_site,m.requested_by]),[[MAJRI,SASTI,'hr-master']],'the move is on the register of site moves');
  const state=await f.saved();
  assert.deepEqual([state.seq,state.lastSummary.added,Boolean(state.lastChangeAt),state.error],['9',1,true,'']);

  // The next minute asks from 9; nothing changed, so the database is not read at all.
  f.reads.length=0;
  assert.deepEqual(await f.minute(),{ok:true,changed:0});
  assert.deepEqual([f.asked.at(-1),f.reads.length,(await f.saved()).seq],['9',0,'9']);
  // The same people given again (HR's second look) change nothing and write nothing.
  f.state.feeds.push({latest:'9',numbers:['7001'],employees:[hrLine(7001,'FIRST MAN','Majri OB',{designation:'VOLVO DRIVER'})]});
  const before=(await f.all())[0].employeeMasterRevision;
  assert.equal((await f.minute()).summary.unchanged,1);
  assert.equal((await f.all())[0].employeeMasterRevision,before);
 }finally{await f.close();}
});

test('it stops itself when one minute would switch off more than 50 people, and starts again only after a person applies',async()=>{
 const many=Array.from({length:HR_COPY_STOP_LIMIT+1},(_,i)=>person(8000+i,'MAN '+i,MAJRI));
 const f=await fixture({people:many});
 try{
  await f.copy.start({by:'owner'});
  f.state.feeds.push({latest:'70',numbers:many.map((_,i)=>String(8000+i)),employees:[]});
  const stopped=await f.minute();
  assert.deepEqual([stopped.ok,stopped.stopped,stopped.summary.switchedOff],[false,true,51]);
  assert.equal((await f.all()).every(p=>p.hrListed===true),true,'nothing of that minute was applied');
  const state=await f.saved();
  assert.match(state.stopped.reason,/would switch off 51 people \(removed 51, marked LEFT 0\)\. Nothing was applied\. Open Preview on Sync all masters, check and apply\./);
  assert.equal(state.seq,undefined,'the change number is not moved on');
  assert.deepEqual(f.alerts.map(a=>a.key.split(':').slice(0,2).join(':')),['hr-employee-copy:stopped']);
  assert.match(f.alerts[0].message,/stopped the Employee Master copy from HR Pulse at 14:31 IST/);
  // Stopped: later minutes do nothing until a person has applied the Preview again.
  const asked=f.asked.length;
  assert.deepEqual(await f.minute(),{skipped:'stopped'});
  assert.equal(f.asked.length,asked);
  await f.copy.start({by:'owner'});
  assert.equal((await f.copy.status()).stopped,null);
  // Exactly 50 goes through.
  f.state.feeds.push({latest:'71',numbers:many.slice(0,HR_COPY_STOP_LIMIT).map((_,i)=>String(8000+i)),employees:[]});
  const fifty=await f.minute();
  assert.deepEqual([fifty.ok,fifty.summary.removed],[true,50]);
  assert.equal((await f.all()).filter(p=>p.hrListed===false).length,50);
 }finally{await f.close();}
});

test('a held change is told once, stays on the list until HR Pulse corrects it, and a changed name can be accepted',async()=>{
 const f=await fixture({people:[person(7001,'WORKING DRIVER',MAJRI),person(7003,'TWICE MAN',MAJRI)]});
 try{
  await f.copy.start({by:'owner'});
  const clash=hrLine(7001,'COMPLETELY OTHER');
  f.state.feeds.push({latest:'3',numbers:['7001','7003'],employees:[clash,hrLine(7003,'TWICE MAN','Majri OB'),hrLine(7003,'TWICE MAN','Sasti OB')]});
  assert.equal((await f.minute()).held,2);
  assert.deepEqual((await f.all()).map(p=>p.name),['WORKING DRIVER','TWICE MAN']);
  assert.deepEqual((await f.copy.status()).held.map(item=>[item.number,item.reason]),[['7001','other-name'],['7003','two-lines']]);
  assert.equal(f.alerts.length,1);assert.match(f.alerts[0].message,/2 changes are held for a person to look at/);
  // The same two again a minute later: still held, not told again.
  f.state.feeds.push({latest:'3',numbers:['7001','7003'],employees:[clash,hrLine(7003,'TWICE MAN','Majri OB'),hrLine(7003,'TWICE MAN','Sasti OB')]});
  await f.minute();
  assert.equal(f.alerts.length,1);
  // HR Pulse removes the second line of 7003: it is copied and leaves the held list.
  f.state.feeds.push({latest:'4',numbers:['7003'],employees:[hrLine(7003,'TWICE MAN','Majri OB',{contact:'9000000003'})]});
  await f.minute();
  assert.deepEqual((await f.copy.status()).held.map(item=>item.number),['7001']);
  assert.equal((await f.all())[1].hrContact,'9000000003');
  // Only a changed name can be accepted here; the administrator's yes copies it from HR Pulse's list.
  await assert.rejects(f.copy.accept('7003',{by:'admin'}),{status:404});
  f.state.all=[clash,hrLine(7003,'TWICE MAN')];
  assert.deepEqual(await f.copy.accept('CMLL7001',{by:'admin'}),{accepted:true,name:'COMPLETELY OTHER',stillHeld:false});
  assert.deepEqual([(await f.all())[0].name,(await f.copy.status()).held],['COMPLETELY OTHER',[]]);
  // Accepted once: the same name coming again in a later minute is not held again.
  f.state.feeds.push({latest:'5',numbers:['7001'],employees:[hrLine(7001,'COMPLETELY OTHER','Majri OB',{contact:'9'})]});
  assert.equal((await f.minute()).held,0);
 }finally{await f.close();}
});

test('HR Pulse not answering: nothing changes, the owner is told once after ten minutes, and it carries on by itself',async()=>{
 const f=await fixture({people:[person(7001,'FIRST MAN',MAJRI)]});
 try{
  await f.copy.start({by:'owner'});
  f.state.fail='HR did not answer. Existing data retained.';
  for(let i=0;i<HR_COPY_SILENT_MINUTES;i++)assert.deepEqual(await f.minute(),{ok:false,error:'HR did not answer. Existing data retained.'});
  assert.equal(f.alerts.length,0,'not within the first ten minutes');
  await f.minute();await f.minute();
  assert.deepEqual(f.alerts.map(a=>a.key.split(':').slice(0,2).join(':')),['hr-employee-copy:silent']);
  assert.match(f.alerts[0].message,/has not been able to copy Employee Master from HR Pulse since 14:31 IST/);
  assert.equal((await f.copy.status()).error,'HR did not answer. Existing data retained.');
  f.state.fail=null;
  f.state.feeds.push({latest:'2',numbers:['7001'],employees:[hrLine(7001,'FIRST MAN','Majri OB',{contact:'9'})]});
  assert.equal((await f.minute()).ok,true);
  assert.deepEqual([(await f.copy.status()).error,(await f.all())[0].hrContact],['','9']);
  // HR Pulse without its change list yet: said plainly, nothing else happens.
  f.state.ready=false;
  assert.deepEqual(await f.minute(),{ok:false,notReady:true});
  assert.match((await f.copy.status()).error,/change list is not ready yet/);
 }finally{await f.close();}
});

test('one server at a time, and not twice in one minute',async()=>{
 const f=await fixture({people:[person(7001,'FIRST MAN',MAJRI)]});
 try{
  await f.copy.start({by:'owner'});
  f.state.locked=false;
  assert.deepEqual(await f.minute(),{skipped:'another server'});
  assert.equal(f.asked.length,0);
  f.state.locked=true;
  assert.deepEqual(await f.minute(),{ok:true,changed:0});
  f.state.now+=20000;
  assert.deepEqual(await f.copy.tick(),{skipped:'recent'},'another server looked 20 seconds ago');
  assert.equal(f.asked.length,1);
 }finally{await f.close();}
});

test('Pulse-II asks HR Pulse for the changes after the number it holds, with its own key',async()=>{
 const calls=[];
 const sync=createHrEmployeeSync({pool:{query:async()=>({rows:[]})},key:'s'.repeat(40),base:'https://hr.test',request:async(url,options)=>{calls.push([String(url),options.headers['X-MIS-Sync-Key'].length]);return new Response(JSON.stringify({ready:true,latest:'12',numbers:[],employees:[]}),{status:200,headers:{'Content-Type':'application/json'}});}});
 assert.equal((await sync.changes('12')).latest,'12');
 await sync.changes('not a number');await sync.employees();
 assert.deepEqual(calls,[['https://hr.test/api/integrations/mis/employee-changes?after=12',40],['https://hr.test/api/integrations/mis/employee-changes?after=0',40],['https://hr.test/api/integrations/mis/employees',40]]);
});

test('every minute: a newly approved HR transfer is copied at once, a waiting one is left to the hour, then Employee Master',async()=>{
 const f=await fixture();
 try{
  await f.db.exec('CREATE TABLE hr_transfer_sync(hr_id TEXT PRIMARY KEY,record_data JSONB NOT NULL,outcome TEXT NOT NULL,employee_id BIGINT,synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await f.db.query("INSERT INTO hr_transfer_sync(hr_id,record_data,outcome) VALUES('t-done','{}','Moved')");
  const synced=[],ticks=[];let approved=[{id:'t-done'}];
  const hr={configured:()=>true,count:async()=>1,preview:async()=>({}),transfers:async()=>({transfers:approved}),sync:async(name,options)=>{synced.push([name,options.by]);return {summary:{}};}};
  const copy={status:async()=>({started:true,held:[]}),tick:async()=>{ticks.push(1);return {ok:true,changed:0};},start:async()=>{},accept:async()=>({})};
  const sync=registerMasterSync(express(),{pool:f.pool,pulse:{status:()=>({connected:true,busy:false})},erp:{status:async()=>({configured:false})},hr,copy,requireSession:(q,s,n)=>n(),requireAdministrator:(q,s,n)=>n()});
  assert.deepEqual(await sync.minute(),{transfers:null,employees:{ok:true,changed:0}},'with no outbox set up, nothing about moves');
  assert.deepEqual([synced,ticks.length],[[],1],'every approved transfer is already in Pulse-II: nothing is read');
  approved=[{id:'t-done'},{id:'t-new'}];
  assert.equal((await sync.minute()).transfers.ok,true);
  assert.deepEqual(synced,[['Employee transfer',HR_MINUTE_ACTOR]]);
  // It could not be applied (person not in Employee Master yet): the next minutes leave it to the hourly run.
  await sync.minute();await sync.minute();
  assert.deepEqual([synced.length,ticks.length],[1,4]);
 }finally{await f.close();}
});

test('the alert is a line of the Automation Centre, and the server and the page are wired',()=>{
 assert.equal(automationForEventKey('hr-employee-copy:stopped:2026-11-23T09:01:00.000Z:mohitchadda'),'hr-employee-copy');
 const line=AUTOMATIONS.find(item=>item.key==='hr-employee-copy');
 assert.deepEqual([line.code,line.category,AUTOMATIONS.indexOf(line)],['A27','Masters',26]);
 assert.deepEqual(AUTOMATIONS.map(item=>item.code),AUTOMATIONS.map((item,index)=>'A'+String(index+1).padStart(2,'0')));
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.ok(server.includes('const hrEmployeeCopy=createHrEmployeeMinuteCopy({pool,hr:hrEmployeeSync,'));
 assert.ok(server.includes('hr:hrEmployeeSync,copy:hrEmployeeCopy,outbox:hrSiteMoveOutbox,requireSession,requireAdministrator});'));
 assert.ok(server.includes("if(process.env.HR_SYNC_SCHEDULE!=='0')masterSync.start();"),'one setting still stops both timers');
 const page=readFileSync(new URL('../src/pulse-master-sync.jsx',import.meta.url),'utf8');
 assert.ok(page.includes('<HrEmployeeCopyPanel copy={data?.employeeCopy} moves={data?.siteMovesToHr} working={working} onAccept={acceptHeld}/>'));
 assert.ok(page.includes('{!row.minute&&<button onClick={()=>sync(row.name)}'),'Employee Master has no Sync button: only Preview, then Apply');
 assert.ok(page.includes("call('/api/master-sync/employee-copy/accept',{number:item.number})"));
 const panel=readFileSync(new URL('../src/hr-employee-copy-panel.jsx',import.meta.url),'utf8');
 for(const words of ['Copied every minute.','Not started.','Accept this name','Correct in HR Pulse'])assert.ok(panel.includes(words),words);
 const login=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages,misMobileAccess:[]}});
 assert.equal(misRequestAllowed(login(['Pulse Master Sync']),{path:'/api/master-sync/employee-copy/accept',method:'POST'}),true);
 assert.equal(misRequestAllowed(login(['Reports']),{path:'/api/master-sync/employee-copy/accept',method:'POST'}),false);
});
