// A wrong OTP must be counted, and the count must stay.
//
// Found 23 Nov 2026: four OTP checks wrote the wrong-try count inside a database transaction and then threw the
// "Wrong OTP" error from inside that same transaction. The transaction helper rolls back on any throw, so the
// count was undone every time: "five wrong attempts" never ended an OTP, and a six-digit code could be guessed
// for the whole ten minutes. The same happened to the "cancelled" and "expired" marks.
//
// The rule now: the transaction hands the refusal back ({refused:message}), commits, and only then is the 400
// answered (the way server/routes/employee-site-move.mjs already did it).
//
// These tests need a database that really rolls back. PGlite is one real Postgres session, so the BEGIN /
// COMMIT / ROLLBACK the routes send are real. A stand-in pool that ignores ROLLBACK would pass on the old
// code too, so never swap one in here; the first test below fails if that ever happens.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {registerVehicleTransferExpress} from '../server/routes/vehicle-transfer-express.mjs';
import {registerEquipmentCreateExpress} from '../server/routes/equipment-create-express.mjs';
import {registerEquipmentAliases} from '../shared/equipment-aliases.mjs';
import {registerVlbBatches} from '../server/routes/vlb-batches.mjs';
import {issueApprovalOtp} from '../server/services/vlb-approval-otp.mjs';
import {registerReleaseOtp,RELEASE_OTP_KEY} from '../server/routes/release-otp.mjs';
import {OTP_MAX_ATTEMPTS} from '../shared/otp-approval.mjs';
process.env.VLB_BATCH_ORDER_FROM='off'; // the VLB test opens one batch by itself; vlb-batch-order.test.mjs covers the order

const realPool=db=>{
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args);
 return {query,connect:async()=>({query,release(){}})};
};
const serve=async(t,app)=>{
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close()});
 return async(path,body,method='POST')=>{
  const response=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  return {status:response.status,data,error:data.error};
 };
};

// verify(code) enters a code; readOtp() reads {attempts,status} straight from the database.
async function fiveWrongCodesEndIt({verify,readOtp,rightOtp}){
 const wrong=rightOtp==='111111'?'222222':'111111';
 for(let n=1;n<=OTP_MAX_ATTEMPTS;n++){
  const answer=await verify(wrong),left=OTP_MAX_ATTEMPTS-n;
  assert.equal(answer.status,400);
  assert.equal(answer.error,left?`Wrong OTP. ${left} attempt${left===1?'':'s'} left.`:'Too many wrong attempts. Request a new OTP.');
  const saved=await readOtp();
  assert.deepEqual([Number(saved.attempts),saved.status],[n,left?'sent':'cancelled'],`wrong code ${n} is kept in the database`);
 }
 const late=await verify(rightOtp);
 assert.equal(late.status,400);
 assert.equal(late.error,'This OTP was cancelled. Request a new OTP.','after five wrong codes the right code no longer works');
 const end=await readOtp();
 assert.deepEqual([Number(end.attempts),end.status],[OTP_MAX_ATTEMPTS,'cancelled']);
}
// expire() moves the OTP past its ten minutes.
async function expiredCodeIsMarked({verify,readOtp,rightOtp,expire}){
 await expire();
 const answer=await verify(rightOtp);
 assert.equal(answer.status,400);assert.equal(answer.error,'This OTP has expired. Request a new OTP.');
 assert.equal((await readOtp()).status,'expired','"expired" is kept in the database');
}

test('the test database really rolls back (a stand-in that ignores ROLLBACK would hide the fault)',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE proof(n INT)');
 const client=await realPool(db).connect();
 await client.query('BEGIN');await client.query('INSERT INTO proof VALUES($1)',[1]);await client.query('ROLLBACK');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM proof')).rows[0].n,0);
});

const expressFixture=async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const assetId=String((await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1) RETURNING id",[JSON.stringify({category:'Equipment',door:'VPC-077',equipmentName:'VPC 077',currentLocation:'Jayant OC',chassisNo:'TESTCH77'})])).rows[0].id);
 const batchId=randomUUID();
 await db.query("INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,creator_login,request_key,continuous_entry,saved_lock_policy) VALUES($1,'TEST/SASTI OC/S1/B01','sasti oc','2026-12-18','S1',1,NULL,'alice',$2,TRUE,TRUE)",[batchId,randomUUID()]);
 const sent=[],notified=[];
 const deps={pool:realPool(db),requireSession:(req,res,next)=>{req.session={login:'alice',name:'alice'};next()},
  accessContext:async()=>({canSubmit:true,scope:{sites:null}}),
  pmLogins:async(client,site)=>({'jayant oc':['pm-jayant'],'sasti oc':['pm-sasti']})[String(site).toLowerCase()]||[],
  deliver:async({logins,otp})=>{sent.push(otp);return {sentTo:logins,channels:['telegram'],failures:[]}}};
 const app=express();app.use(express.json());
 registerVehicleTransferExpress(app,{...deps,notify:async(client,transfer)=>{notified.push(transfer.transferNo)}});
 registerEquipmentCreateExpress(app,deps);
 return {db,assetId,batchId,sent,notified,call:await serve(t,app)};
};

test('express vehicle transfer OTP: five wrong codes end it, and an expired code is marked',async t=>{
 const f=await expressFixture(t);
 const ask=async()=>{const asked=await f.call('/api/vehicle-transfers/express',{batchId:f.batchId,assetId:f.assetId});assert.equal(asked.status,201,JSON.stringify(asked.data));return asked.data.otp.id};
 const tools=id=>({verify:otp=>f.call('/api/vehicle-transfers/express/'+id+'/verify',{otp}),rightOtp:f.sent.at(-1),
  readOtp:async()=>(await f.db.query('SELECT attempts,status FROM mis_vehicle_transfer_otps WHERE id=$1',[id])).rows[0],
  expire:()=>f.db.query("UPDATE mis_vehicle_transfer_otps SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[id])});
 const location=async()=>(await f.db.query('SELECT record_data FROM master_records WHERE id=$1',[f.assetId])).rows[0].record_data.currentLocation;

 const first=await ask();
 // A code that is not six digits is not a guess and is not counted.
 assert.equal((await tools(first).verify('12')).error,'Enter the six-digit OTP.');
 assert.equal((await tools(first).readOtp()).attempts,0);
 await fiveWrongCodesEndIt(tools(first));
 assert.equal(await location(),'Jayant OC','nothing moved');
 assert.deepEqual(f.notified,[]);

 const second=await ask();
 await expiredCodeIsMarked(tools(second));
 assert.equal(await location(),'Jayant OC');

 // The right code on a fresh OTP still completes the transfer.
 const third=await ask();
 const done=await tools(third).verify(f.sent.at(-1));
 assert.equal(done.status,200,JSON.stringify(done.data));assert.equal(done.data.completed,true);
 assert.equal(await location(),'Sasti OC');
 assert.equal((await tools(third).readOtp()).status,'used');
 assert.equal(f.notified.length,1);
});

test('new equipment OTP: five wrong codes end it, and an expired code is marked',async t=>{
 const f=await expressFixture(t);
 const ask=async()=>{const asked=await f.call('/api/equipment/express',{batchId:f.batchId,draft:{door:'V-212',category:'Vehicle',chassis:'TESTCH212'}});assert.equal(asked.status,201,JSON.stringify(asked.data));return asked.data.request.id};
 const tools=id=>({verify:otp=>f.call('/api/equipment/express/'+id+'/verify',{otp}),rightOtp:f.sent.at(-1),
  readOtp:async()=>(await f.db.query('SELECT attempts,status FROM mis_equipment_create_requests WHERE id=$1',[id])).rows[0],
  expire:()=>f.db.query("UPDATE mis_equipment_create_requests SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[id])});
 const created=async()=>(await f.db.query("SELECT count(*)::int AS n FROM master_records WHERE master_name='Equipment master' AND record_data->>'door'='V-212'")).rows[0].n;

 await fiveWrongCodesEndIt(tools(await ask()));
 assert.equal(await created(),0,'nothing created');
 await expiredCodeIsMarked(tools(await ask()));
 assert.equal(await created(),0);

 const third=await ask();
 const made=await tools(third).verify(f.sent.at(-1));
 assert.equal(made.status,200,JSON.stringify(made.data));assert.equal(made.data.equipment.door,'V-212');
 assert.equal(await created(),1);
 assert.equal((await tools(third).readOtp()).status,'used');
});

test('equipment alias OTP: five wrong codes end it, and an expired code is marked',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const site='Sasti OC';
 await db.exec(`CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT NOT NULL,record_data JSONB NOT NULL);
  CREATE TABLE pulse_master_links(master_name TEXT NOT NULL,source_id TEXT NOT NULL,local_id BIGINT NOT NULL,PRIMARY KEY(master_name,source_id));
  CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL,updated_at TIMESTAMPTZ);
  CREATE TABLE mis_telegram_links(login_name TEXT PRIMARY KEY,chat_id TEXT NOT NULL);
  CREATE TABLE mis_scan_cards(id TEXT PRIMARY KEY,status TEXT NOT NULL,raw_fields JSONB NOT NULL DEFAULT '{}');`);
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1)",[JSON.stringify({door:'DEMO21-00179',category:'Equipment',currentLocation:site})]);
 const sent=[];let changes=0;
 const app=express();app.use(express.json());
 registerEquipmentAliases(app,{pool:realPool(db),protect:(req,res,next)=>{req.session={login:'alice',name:'Alice'};next();},requireAdministrator:(req,res,next)=>next(),
  pmLogins:async()=>['pm1'],deliver:async({logins,otp})=>{sent.push(otp);return {sentTo:logins,channels:['telegram'],failures:[]}},otpEnabled:()=>true,onChange:async()=>{changes++},audit(){}});
 const call=await serve(t,app);
 const created=await call('/api/equipment-aliases',{equipmentId:'1',kind:'equipment',writtenText:'L21',site,book:'vlb'});
 assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.alias.status,'pending');
 const aliasId=created.data.alias.id;
 const ask=async()=>{const asked=await call('/api/equipment-aliases/'+aliasId+'/otp',{route:'site_pm',emergencyReason:'on_leave',site});assert.equal(asked.status,200,JSON.stringify(asked.data));return asked.data.otp.id};
 const tools=id=>({verify:otp=>call('/api/equipment-aliases/'+aliasId+'/otp/'+id+'/verify',{otp}),rightOtp:sent.at(-1),
  readOtp:async()=>(await db.query('SELECT attempts,status FROM mis_equipment_alias_otps WHERE id=$1',[id])).rows[0],
  expire:()=>db.query("UPDATE mis_equipment_alias_otps SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[id])});
 const aliasStatus=async()=>(await db.query('SELECT status FROM mis_equipment_aliases WHERE id=$1',[aliasId])).rows[0].status;

 await fiveWrongCodesEndIt(tools(await ask()));
 assert.equal(await aliasStatus(),'pending','not approved');
 await expiredCodeIsMarked(tools(await ask()));
 assert.equal(await aliasStatus(),'pending');
 assert.equal(changes,0,'a refused code changes nothing for the scan cards');

 const third=await ask();
 const ok=await tools(third).verify(sent.at(-1));
 assert.equal(ok.status,200,JSON.stringify(ok.data));assert.equal(ok.data.approved,true);
 assert.equal(await aliasStatus(),'active');
 assert.equal((await tools(third).readOtp()).status,'used');
 assert.equal(changes,1);
});

test('VLB batch reopen OTP: five wrong codes end it, and an expired code is marked',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const pool=realPool(db),sent=[];
 const deliver=async({logins,otp})=>{sent.push(otp);return {sentTo:logins,channels:['telegram'],failures:[]}};
 const app=express();app.use(express.json());
 const session=(req,res,next)=>{req.session={login:'alice',name:'ALICE'};req.logBookScope={sites:['sasti ob']};next()};
 registerVlbBatches(app,{pool,protect:[session],ensureBooks:async()=>{},approvalOtp:{pmLogins:async()=>['pm'],deliver},
  getActor:async actor=>({login:actor.login,mis:actor.login==='alice',pm:actor.login==='pm',pmScope:{sites:actor.login==='pm'?['sasti ob']:[]}})});
 const call=await serve(t,app);
 await db.query('INSERT INTO mis_log_books(book_no,book_type,site,book_date,asset_id,request_key,data,created_by) VALUES($1,$2,$3,$4,1,$7,$5,$6)',[randomUUID(),'vehicle','Sasti OC','2026-12-30',JSON.stringify({location:'Sasti OC',bookDate:'2026-12-30',bookShiftCode:'S1',door:'V07',aFormNo:'CARD1'}),'alice',randomUUID()]);
 const made=await call('/api/vlb-batches',{site:'Sasti OC',date:'2026-12-30',shift:'S1',requestKey:randomUUID()});
 assert.equal(made.status,201,JSON.stringify(made.data));
 const path='/api/vlb-batches/'+made.data.id;
 for(const step of ['/lock-vlb','/lock-lmv','/close']){const done=await call(path+step,{});assert.equal(done.status,200,step+' '+JSON.stringify(done.data));}
 const reason='Late scan card received';
 const request=await call(path+'/reopen-request',{reason});
 assert.equal(request.status,200,JSON.stringify(request.data));
 // Asking for this OTP from the screen was switched off on 18 Nov 2026 (reopening needs no approval now), but
 // the route that checks a code is still there. The OTP is made the way the screen used to make it.
 const batch=async()=>(await db.query('SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE id=$1',[made.data.id])).rows[0];
 const ask=async()=>(await issueApprovalOtp(pool,{batch:await batch(),purpose:'reopen',reason,requestId:request.data.id,requestedBy:'alice',requesterName:'ALICE',pmLogins:async()=>['pm'],deliver})).id;
 const tools=id=>({verify:otp=>call(path+'/approval-otp/'+id+'/verify',{otp}),rightOtp:sent.at(-1),
  readOtp:async()=>(await db.query('SELECT attempts,status FROM mis_vlb_approval_otps WHERE id=$1',[id])).rows[0],
  expire:()=>db.query("UPDATE mis_vlb_approval_otps SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[id])});
 const requestStatus=async()=>(await db.query('SELECT status FROM mis_vlb_reopen_requests WHERE id=$1',[request.data.id])).rows[0].status;

 await fiveWrongCodesEndIt(tools(await ask()));
 assert.ok((await batch()).closed_at,'still closed');assert.equal(await requestStatus(),'pending');
 await expiredCodeIsMarked(tools(await ask()));
 assert.ok((await batch()).closed_at);assert.equal(await requestStatus(),'pending');

 const third=await ask();
 const ok=await tools(third).verify(sent.at(-1));
 assert.equal(ok.status,200,JSON.stringify(ok.data));assert.deepEqual([ok.data.approved,ok.data.reopened],[true,true]);
 assert.equal((await batch()).closed_at,null,'reopened on the right code');
 assert.equal((await tools(third).readOtp()).status,'used');
});

// Already right before this change (the refusal was never thrown inside the transaction). Kept here with a
// real transaction because test/release-otp.test.mjs uses an in-memory stand-in that would not show the fault.
test('urgent release OTP: five wrong codes end it, and an expired code is marked',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL,updated_at TIMESTAMPTZ)');
 const clock={now:Date.parse('2026-11-15T10:00:00Z')},sent=[];
 const app=express();app.use(express.json());
 registerReleaseOtp(app,{pool:realPool(db),verifyIdentity:async()=>({actor:'dev1',run_id:'77'}),now:()=>clock.now,sendOtp:async({otp})=>{sent.push(otp);return {channel:'telegram'}}});
 const call=await serve(t,app);
 const ask=async()=>{const asked=await call('/api/release-otp/request',{});assert.equal(asked.status,200,JSON.stringify(asked.data));};
 const tools=()=>({verify:otp=>call('/api/release-otp/verify',{otp}),rightOtp:sent.at(-1),
  readOtp:async()=>(await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[RELEASE_OTP_KEY])).rows[0].setting_value,
  expire:async()=>{clock.now+=11*60000}});

 await ask();await fiveWrongCodesEndIt(tools());
 await ask();await expiredCodeIsMarked(tools());
 await ask();
 const ok=await tools().verify(sent.at(-1));
 assert.equal(ok.status,200,JSON.stringify(ok.data));assert.equal(ok.data.approved,true);
 assert.equal((await tools().readOtp()).status,'used');
});
