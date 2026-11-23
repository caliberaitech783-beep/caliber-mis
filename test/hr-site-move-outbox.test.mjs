// Owner, 23 Nov 2026: "it should be two-way ... anything which MIS changes during batch creation should get auto
// updated in HR employee master also." The change the MIS makes to an employee while a batch is made is the site
// move with an OTP on a card.
//   - such a move, when it changes the site held today, is told to HR Pulse at once and again every minute until
//     HR Pulse answers; it is written with the move, so a move can never be saved without its message;
//   - a move that came from HR Pulse, or one that only fills in history, is never sent;
//   - an OTP on an old card (dated before HR's master set today's site) no longer moves the worker's present site
//     back: it fills in where the worker was then.
// The people and numbers below are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {planSiteMove,employeeSiteOn,hrSiteSince,siteMoves} from '../shared/employee-site-moves.mjs';
import {employeeAtLocation} from '../shared/log-book-access.mjs';
import {applyEmployeeSiteMove,EMPLOYEE_SITE_MOVE_SCHEMA} from '../server/routes/employee-site-move.mjs';
import {createHrSiteMoveOutbox,HR_SITE_MOVE_OUTBOX_SCHEMA,siteMovePayload} from '../server/services/hr-site-move-outbox.mjs';
import {createHrEmployeeSync} from '../server/services/hr-employee-sync.mjs';
import {registerMasterSync} from '../server/routes/master-sync.mjs';
import {planHrChanges} from '../shared/hr-employee-changes.mjs';

const MAJRI='Majri OC',SASTI='Sasti OC';
const person=(number,name,site,extra={})=>({caliberId:'CMPL'+number,caliberCode:'CMLL'+number,name,site,currentLocation:site,currentDesignationName:'TIPPER DRIVER',hrListed:true,hrLeft:false,status:'Active',employeeMasterRevision:3,...extra});
// HR's master was applied on 23 Nov 2026 at 03:15 in India.
const HR_AT='2026-11-22T21:45:58.720Z';

test('an OTP on an old card fills in where the worker was then; the site held today stays HR\'s',()=>{
 const worker=person(7001,'MOVED EARLIER',MAJRI,{hrImportedAt:HR_AT});
 assert.equal(hrSiteSince(worker),'2026-11-23','India date of HR\'s master');
 // A Sasti card of 10 Nov is entered late: the worker was at Sasti then, and is at Majri in HR's master.
 const plan=planSiteMove(worker,{to:SASTI,fromDate:'2026-11-10',at:'2026-11-24T05:00:00.000Z',by:'sasti.operator',approvedBy:['majri.pm'],card:{door:'V942'}});
 assert.equal(plan.latest,false);
 assert.deepEqual(Object.keys(plan.patch),['siteMoves'],'today\'s site and its lock are not touched');
 assert.deepEqual(plan.patch.siteMoves.map(move=>[move.from,move.to,move.fromDate,move.by]),[[MAJRI,SASTI,'2026-11-10','sasti.operator'],[SASTI,MAJRI,'2026-11-23','hr-master']]);
 const after={...worker,...plan.patch};
 assert.deepEqual(['2026-11-05','2026-11-10','2026-11-22','2026-11-23','2026-12-01'].map(date=>employeeSiteOn(after,date)),[MAJRI,SASTI,SASTI,MAJRI,MAJRI]);
 assert.equal(employeeSiteOn(after),MAJRI,'the site held today');
 assert.equal(employeeAtLocation(after,SASTI,'2026-11-10'),true,'the old Sasti card finds its driver');
 assert.equal(employeeAtLocation(after,MAJRI),true);assert.equal(after.siteLockedAt,undefined);
 // HR Pulse's copy is therefore never told "the site was set by an OTP" for this worker.
 assert.deepEqual(planHrChanges([{id:1,master_name:'Employee master',record_data:{...after,name:'MOVED EARLIER'}}],['7001'],[{employeeId:'CMLL7001',name:'MOVED EARLIER',site:'Majri OB',status:'ACTIVE'}]).held,[]);
 // A Majri card of 18 Nov then says the worker was already back on that day: the history takes it, today's site still stays.
 const second=planSiteMove(after,{to:MAJRI,fromDate:'2026-11-18',at:'2026-11-24T06:00:00.000Z',by:'majri.operator',approvedBy:['sasti.pm']});
 assert.deepEqual([second.latest,'site' in second.patch,'siteLockedAt' in second.patch],[false,false,false]);
 const later={...after,...second.patch};
 assert.deepEqual(['2026-11-12','2026-11-18','2026-11-25'].map(date=>employeeSiteOn(later,date)),[SASTI,MAJRI,MAJRI]);
});

test('a card dated on or after HR\'s master moves the worker as before, and so does a worker HR never stamped',()=>{
 const worker=person(7001,'MOVING NOW',MAJRI,{hrImportedAt:HR_AT});
 const plan=planSiteMove(worker,{to:SASTI,fromDate:'2026-11-23',at:'2026-11-24T05:00:00.000Z',by:'sasti.operator',approvedBy:['majri.pm']});
 assert.deepEqual([plan.latest,plan.patch.site,plan.patch.currentLocation,plan.patch.siteLockedAt,plan.patch.siteLockedBy,plan.patch.siteMoves.length],[true,SASTI,SASTI,'2026-11-24T05:00:00.000Z','sasti.operator',1]);
 const unstamped=planSiteMove(person(7002,'NO STAMP',MAJRI),{to:SASTI,fromDate:'2026-11-10',at:'2026-11-24T05:00:00.000Z',by:'sasti.operator',approvedBy:['majri.pm']});
 assert.deepEqual([unstamped.latest,unstamped.patch.site,siteMoves(unstamped.patch).length],[true,SASTI,1]);
 // The copy from HR Pulse stamps the line too (hrCopiedAt).
 assert.equal(hrSiteSince({hrCopiedAt:'2026-11-25T20:00:00.000Z'}),'2026-11-26');assert.equal(hrSiteSince({}),'');
});

async function fixture(){
 const db=new PGlite();
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 for(const record of [person(7001,'OTP MAN',MAJRI,{hrImportedAt:HR_AT}),person(7002,'HR TRANSFER MAN',MAJRI,{hrImportedAt:HR_AT}),person(7003,'OLD CARD MAN',MAJRI,{hrImportedAt:HR_AT})])
  await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1)",[JSON.stringify(record)]);
 await db.exec(EMPLOYEE_SITE_MOVE_SCHEMA);
 const query=(sql,params)=>db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 const state={connected:true,fail:'',answers:[]},posted=[];
 const hr={configured:()=>state.connected,sendSiteMove:async move=>{posted.push(move);if(state.fail)throw Object.assign(new Error(state.fail),{status:502});return state.answers.shift()||{received:true,outcome:'applied',detail:"HR Pulse's Employee Master now shows Sasti OB."};}};
 const outbox=createHrSiteMoveOutbox({pool,hr});
 const waiting=async()=>(await db.query('SELECT move_id,payload,tries,sent_at,outcome,detail FROM mis_hr_site_move_outbox ORDER BY move_id')).rows;
 return {db,pool,outbox,hr,state,posted,waiting,close:()=>db.close()};
}

test('the outbox table is made with the site-move tables',()=>{
 assert.ok(EMPLOYEE_SITE_MOVE_SCHEMA.replace(/\s+/g,' ').includes(HR_SITE_MOVE_OUTBOX_SCHEMA.replace(/\s+/g,' ')),'one statement, written in both places');
});

test('an OTP move that changes today\'s site is written for HR Pulse with the move; a move from HR and an old-card move are not',async()=>{
 const f=await fixture();
 try{
  const moved=await applyEmployeeSiteMove(f.pool,{employeeId:1,to:SASTI,fromDate:'2026-11-24',requestedBy:'sasti.operator',requestedName:'Sasti Operator',approvedBy:['majri.pm'],card:{door:'V942',cardNo:'A-5512',batchId:'b1'}});
  assert.equal(moved.move.latest,true);
  await applyEmployeeSiteMove(f.pool,{employeeId:2,to:SASTI,fromDate:'2026-11-24',requestedBy:'hr-transfer',requestedName:'HR transfer TR0001',approvedBy:['HR Pulse'],card:{hrTransfer:'TR0001'}});
  const old=await applyEmployeeSiteMove(f.pool,{employeeId:3,to:SASTI,fromDate:'2026-11-10',requestedBy:'sasti.operator',approvedBy:['majri.pm'],card:{door:'V101'}});
  assert.equal(old.move.latest,false);assert.equal(old.row.record_data.site,MAJRI,'the old card did not move today\'s site');
  const lines=await f.waiting();
  assert.equal(lines.length,1,'only the OTP move that changed today\'s site');
  assert.deepEqual(lines[0].payload,{moveId:moved.move.id,employeeId:'CMPL7001',name:'OTP MAN',fromSite:MAJRI,toSite:SASTI,fromDate:'2026-11-24',requestedBy:'sasti.operator',requestedName:'Sasti Operator',approvedBy:['majri.pm'],card:{door:'V942',cardNo:'A-5512'}});
  assert.equal(Number((await f.db.query('SELECT count(*) n FROM mis_employee_site_moves')).rows[0].n),3,'all three are on the register of moves');
  // A move that fails is not left half done: no register line, no message.
  await assert.rejects(applyEmployeeSiteMove(f.pool,{employeeId:999,to:SASTI,fromDate:'2026-11-24',requestedBy:'x'}),/no longer in Employee Master/);
  assert.equal((await f.waiting()).length,1);
  assert.deepEqual(siteMovePayload({moveId:5,employeeId:' CMPL1 ',name:null,from:'A',to:'B',fromDate:'2026-11-24',approvedBy:'x',card:null}),{moveId:'5',employeeId:'CMPL1',name:'',fromSite:'A',toSite:'B',fromDate:'2026-11-24',requestedBy:'',requestedName:'',approvedBy:[],card:{door:'',cardNo:''}});
 }finally{await f.close();}
});

test('a waiting move is sent until HR Pulse answers; "held" is shown with HR Pulse\'s reason',async()=>{
 const f=await fixture();
 try{
  await applyEmployeeSiteMove(f.pool,{employeeId:1,to:SASTI,fromDate:'2026-11-24',requestedBy:'sasti.operator',requestedName:'Sasti Operator',approvedBy:['majri.pm'],card:{door:'V942'}});
  // HR Pulse is not connected, then does not answer: the move waits.
  f.state.connected=false;
  assert.deepEqual(await f.outbox.flush(),{sent:0,held:0,failed:0,skipped:'not connected'});
  f.state.connected=true;f.state.fail='HR Pulse did not answer.';
  assert.deepEqual(await f.outbox.flush(),{sent:0,held:0,failed:1});
  assert.deepEqual(await f.outbox.flush(),{sent:0,held:0,failed:1});
  let status=await f.outbox.status();
  assert.deepEqual([status.waiting,status.notSent.map(line=>[line.employeeId,line.from,line.to,line.tries,line.detail]),status.held],[1,[['CMPL7001',MAJRI,SASTI,2,'HR Pulse did not answer.']],[]]);
  assert.ok(status.waitingSince);
  // HR Pulse answers: sent once, and never again.
  f.state.fail='';
  assert.deepEqual(await f.outbox.flush(),{sent:1,held:0,failed:0});
  assert.deepEqual(await f.outbox.flush(),{sent:0,held:0,failed:0});
  assert.equal(f.posted.length,3);assert.equal(f.posted[2].employeeId,'CMPL7001');
  status=await f.outbox.status();
  assert.deepEqual([status.waiting,status.notSent,status.held,Boolean(status.lastSentAt)],[0,[],[],true]);
  const line=(await f.waiting())[0];
  assert.deepEqual([line.outcome,line.tries,Boolean(line.sent_at)],['applied',3,true]);
  // A move HR Pulse cannot place: it is delivered, nothing changed there, and the reason is shown.
  await f.db.query("UPDATE master_records SET record_data=record_data||'{\"hrImportedAt\":null}'::jsonb WHERE id=2");
  await applyEmployeeSiteMove(f.pool,{employeeId:2,to:SASTI,fromDate:'2026-11-24',requestedBy:'sasti.operator',approvedBy:['majri.pm']});
  f.state.answers.push({received:true,outcome:'held',detail:"CMPL7002 is on 2 lines in HR Pulse's Employee Master. Keep one line, then raise the transfer in HR Pulse."});
  assert.deepEqual(await f.outbox.flush(),{sent:0,held:1,failed:0});
  status=await f.outbox.status();
  assert.deepEqual([status.waiting,status.held.map(item=>[item.employeeId,item.outcome,item.detail])],[0,[['CMPL7002','held',"CMPL7002 is on 2 lines in HR Pulse's Employee Master. Keep one line, then raise the transfer in HR Pulse."]]]);
  // Two calls at the same moment share one send.
  await applyEmployeeSiteMove(f.pool,{employeeId:3,to:SASTI,fromDate:'2026-11-24',requestedBy:'sasti.operator',approvedBy:['majri.pm']});
  const before=f.posted.length;
  await Promise.all([f.outbox.flush(),f.outbox.flush()]);
  assert.equal(f.posted.length,before+1);
 }finally{await f.close();}
});

test('Pulse-II posts the move to HR Pulse with its key, and says so when HR Pulse refuses',async()=>{
 const calls=[];let status=200;
 const sync=createHrEmployeeSync({pool:{query:async()=>({rows:[]})},key:'s'.repeat(40),base:'https://hr.test',request:async(url,options)=>{calls.push([String(url),options.method,options.headers['X-MIS-Sync-Key'].length,JSON.parse(options.body).moveId]);
  return new Response(JSON.stringify(status===200?{received:true,outcome:'applied',detail:'ok'}:{error:'Invalid Pulse-II sync key'}),{status,headers:{'Content-Type':'application/json'}});}});
 assert.equal((await sync.sendSiteMove({moveId:'41'})).outcome,'applied');
 assert.deepEqual(calls,[['https://hr.test/api/integrations/mis/site-move','POST',40,'41']]);
 status=401;
 await assert.rejects(sync.sendSiteMove({moveId:'42'}),{status:502,message:'HR Pulse refused the site move (401: Invalid Pulse-II sync key).'});
 await assert.rejects(createHrEmployeeSync({pool:{},key:'',request:async()=>{}}).sendSiteMove({moveId:'1'}),{status:503});
});

test('every minute the waiting moves are sent first, and Sync all masters shows them',async()=>{
 const f=await fixture();
 try{
  await f.db.exec("CREATE TABLE pulse_master_links(master_name TEXT,source_id TEXT,local_id BIGINT);CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await applyEmployeeSiteMove(f.pool,{employeeId:1,to:SASTI,fromDate:'2026-11-24',requestedBy:'sasti.operator',approvedBy:['majri.pm']});
  const order=[];
  const hr={configured:()=>true,count:async()=>0,preview:async()=>({}),sync:async()=>({summary:{}}),transfers:async()=>({transfers:[]}),sendSiteMove:async move=>{order.push('move '+move.employeeId);return {received:true,outcome:'applied',detail:'ok'};}};
  const outbox=createHrSiteMoveOutbox({pool:f.pool,hr});
  const copy={status:async()=>({started:true,held:[]}),tick:async()=>{order.push('copy');return {ok:true,changed:0};},start:async()=>{},accept:async()=>({})};
  const sync=registerMasterSync(express(),{pool:f.pool,pulse:{status:()=>({connected:true,busy:false})},erp:{status:async()=>({configured:false})},hr,copy,outbox,requireSession:(q,s,n)=>n(),requireAdministrator:(q,s,n)=>n()});
  assert.equal((await sync.status()).siteMovesToHr.waiting,1);
  const minute=await sync.minute();
  assert.deepEqual([minute.moves,order],[{sent:1,held:0,failed:0},['move CMPL7001','copy']]);
  assert.equal((await sync.status()).siteMovesToHr.waiting,0);
 }finally{await f.close();}
});

test('the server sends a move right after its OTP, and the screen shows what is on its way',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.ok(server.includes('afterMove:()=>hrSiteMoveOutbox?.flush()});'));
 assert.ok(server.includes('hrSiteMoveOutbox=createHrSiteMoveOutbox({pool,hr:hrEmployeeSync});'));
 assert.ok(server.includes('copy:hrEmployeeCopy,outbox:hrSiteMoveOutbox,requireSession,requireAdministrator});'));
 const route=readFileSync(new URL('../server/routes/employee-site-move.mjs',import.meta.url),'utf8');
 assert.ok(route.includes("if(plan.latest&&!/^hr-/i.test(text(requestedBy)))await client.query(QUEUE_SITE_MOVE_SQL,"));
 assert.ok(route.includes('if(outcome.move&&afterMove)void Promise.resolve().then(()=>afterMove()).catch(()=>{});'));
 const panel=readFileSync(new URL('../src/hr-employee-copy-panel.jsx',import.meta.url),'utf8');
 for(const words of ['Site moves made here with an OTP:','waiting to reach HR Pulse','held by HR Pulse','<SiteMovesToHr moves={moves}/>'])assert.ok(panel.includes(words),words);
});
