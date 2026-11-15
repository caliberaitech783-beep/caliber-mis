import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {completeAcceptance,createTransferPulseQueue,queueAcceptance,nextPulseRetryDelay} from '../server/rules/vehicle-transfer-acceptance.mjs';
import {classifyPulseTransferError,createPulseWriter} from '../server/rules/pulse-writer.mjs';
import {createPulseTransferSwitch} from '../server/services/pulse-transfer-switch.mjs';
import {createPulseSignInBridge} from '../server/services/pulse-signin-bridge.mjs';

async function setup(){
 const db=new PGlite();
 const query=db.query.bind(db);
 const pool={query,connect:async()=>({query,release(){}})};
 await db.exec(`CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT NOT NULL,record_data JSONB NOT NULL);
  CREATE TABLE pulse_master_links(master_name TEXT NOT NULL,source_id TEXT NOT NULL,local_id BIGINT NOT NULL,PRIMARY KEY(master_name,source_id));
  CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB,updated_at TIMESTAMPTZ);`);
 const insert=async(master,data)=>Number((await query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2::jsonb) RETURNING id',[master,JSON.stringify(data)])).rows[0].id);
 const vehicle=await insert('Equipment master',{door:'VPC40',chassisNo:'CHVPC40',currentLocation:'Sasti OC'});
 await insert('Equipment master',{door:'V77',chassisNo:'CHV77',currentLocation:'Majri OC'});
 await query("INSERT INTO pulse_master_links VALUES('Equipment master','5123',$1)",[vehicle]);
 const transfer=await insert('Vehicle transfers',{transferNo:'VT-1-A1B2',transferDate:'2026-11-16',source:'Sasti OC',destination:'Majri OC',equipment:'VPC40',door:'VPC40',chassisNo:'CHVPC40',equipmentMasterId:vehicle,
  status:'Awaiting destination PM acceptance',submittedBy:'MIS Majri',submittedLogin:'mis.majri',sourceApprovedBy:'PM Sasti',destinationMisVerifiedBy:'MIS Majri',destinationMisVerifiedAt:'2026-11-16T04:00:00Z'});
 const record=async id=>(await query('SELECT record_data FROM master_records WHERE id=$1',[id])).rows[0].record_data;
 return {db,pool,query,vehicle,transfer,record};
}
const acceptance={acceptedAt:'2026-11-16T05:00:00.000Z',acceptedBy:'PM Majri',acceptedLogin:'pm.majri'};
const tx=async(pool,fn)=>{const c=await pool.connect();await c.query('BEGIN');try{const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}};

test('the writer sends the transfer through the Pulse bridge with Pulse\'s own vehicle id and every stage',async()=>{
 const t=await setup();
 try{
  const calls=[];
  const sharedSignIn={request:async(action,body,actor,opts)=>{calls.push({action,body,actor,opts});return {pulseTransferId:'77',equipmentId:'5123',site:'Majri OC',replay:false};}};
  const writer=createPulseWriter({env:{},sharedSignIn,transferSwitch:createPulseTransferSwitch({pool:t.pool}),pool:t.pool});
  assert.equal(await writer.transferMode(),'bridge','ON by default');
  const before=await t.record(t.transfer);
  const result=await writer.completeTransfer({transfer:before,equipment:{id:t.vehicle},people:{destinationAcceptedBy:'PM Majri',destinationAcceptedLogin:'pm.majri'},route:'workflow'});
  assert.equal(result.mode,'pulse');assert.equal(result.pulseTransferId,'77');
  const [call]=calls;
  assert.equal(call.action,'vehicle-transfer-complete');assert.equal(call.actor,null);assert.equal(call.opts.menu,'Pulse Master Sync');assert.ok(call.opts.timeoutMs<=15000);
  assert.equal(call.body.equipmentId,'5123');assert.equal(call.body.master,'Equipment master');assert.equal(call.body.route,'workflow');
  assert.equal(call.body.transfer.transferNo,'VT-1-A1B2');assert.equal(call.body.transfer.status,undefined,'only transfer fields travel');
  assert.equal(call.body.people.submittedBy,'MIS Majri');assert.equal(call.body.people.destinationAcceptedBy,'PM Majri');
  // Express transfers name the OTP approver and the requesting MIS user.
  await writer.completeTransfer({transfer:before,equipment:{id:t.vehicle},approvedBy:['pm.sasti'],requester:'mis.majri'});
  assert.equal(calls[1].body.route,'express');assert.equal(calls[1].body.people.sourceApprovedBy,'pm.sasti');assert.equal(calls[1].body.people.destinationAcceptedBy,'Express OTP transfer (mis.majri)');
 }finally{await t.db.close();}
});

test('switch OFF refuses Pulse writes; the switch is kept in app_settings and starts ON',async()=>{
 const t=await setup();
 try{
  const transferSwitch=createPulseTransferSwitch({pool:t.pool,cacheMs:0});
  const writer=createPulseWriter({env:{},sharedSignIn:{request:async()=>{throw Error('must not be called');}},transferSwitch,pool:t.pool});
  assert.equal((await transferSwitch.status()).on,true);
  await transferSwitch.set(false,'Admin.One');
  assert.deepEqual({on:(await transferSwitch.status()).on,by:(await transferSwitch.status()).by},{on:false,by:'admin.one'});
  assert.equal(await writer.transferMode(),'off');
  await assert.rejects(writer.completeTransfer({transfer:await t.record(t.transfer),equipment:{id:t.vehicle}}),e=>e.extra.code==='pulse_write_unavailable'&&/switched off/.test(e.message));
  await assert.rejects(writer.assertAvailable('equipment'),/create this asset/,'new assets are still refused');
  assert.equal(await createPulseWriter({env:{}}).transferMode(),'off','no bridge, no switch: off');
 }finally{await t.db.close();}
});

test('Pulse refusals are final, missing answers are retried',()=>{
 for(const status of [400,404,409,422]){const e=classifyPulseTransferError(Object.assign(Error('Pulse shows VPC40 at Majri OC, not Sasti OC.'),{status}));assert.equal(e.retryable,false);assert.equal(e.extra.code,'pulse_refused');assert.match(e.message,/Pulse shows/);}
 assert.equal(classifyPulseTransferError(Error('Pulse is temporarily unavailable')).retryable,true);
 assert.match(classifyPulseTransferError(Object.assign(Error('Your assigned MIS menus do not allow this Pulse connection action.'),{status:403})).message,/not ready/);
 assert.match(classifyPulseTransferError(Object.assign(Error('Sign in'),{status:401})).message,/seven days/);
 assert.equal(classifyPulseTransferError(Object.assign(Error('x'),{status:503})).retryable,true);
});

test('acceptance moves only after Pulse answered and records Pulse\'s reference',async()=>{
 const t=await setup();
 try{
  const result=await tx(t.pool,c=>completeAcceptance(c,{id:t.transfer,acceptance,pulse:{mode:'pulse',pulseTransferId:'77'}}));
  assert.equal(result.updated.status,'Completed');assert.equal(result.updated.pulseWrite.pulseTransferId,'77');assert.equal(result.updated.destinationAcceptedLogin,'pm.majri');
  assert.equal((await t.record(t.vehicle)).currentLocation,'Majri OC');
  await assert.rejects(tx(t.pool,c=>completeAcceptance(c,{id:t.transfer,acceptance,pulse:{}})),e=>e.status===409);
 }finally{await t.db.close();}
});

test('an acceptance Pulse could not take waits, is retried, and finishes when Pulse answers',async()=>{
 const t=await setup();
 try{
  let clock=Date.parse('2026-11-16T05:00:00Z');const now=()=>clock;
  await tx(t.pool,c=>queueAcceptance(c,{id:t.transfer,acceptance,error:Error('Pulse did not answer.'),now}));
  await assert.rejects(tx(t.pool,c=>queueAcceptance(c,{id:t.transfer,acceptance,error:Error('again'),now})),/already accepted/);
  let answer=()=>{throw Object.assign(Error('Pulse is temporarily unavailable'),{retryable:true,extra:{code:'pulse_unavailable'}});};
  const done=[];
  const writer={transferMode:async()=>'bridge',completeTransfer:async()=>answer()};
  const queue=createTransferPulseQueue({pool:t.pool,writer,now,onCompleted:async r=>{done.push(r.updated.transferNo);}});
  assert.equal((await queue.runOnce()).completed,0,'not due before two minutes');
  clock+=nextPulseRetryDelay(1);
  assert.equal((await queue.runOnce()).waiting,1);
  const waiting=await t.record(t.transfer);
  assert.equal(waiting.pulseQueue.attempts,2);assert.equal(Date.parse(waiting.pulseQueue.nextAt),clock+nextPulseRetryDelay(2));
  assert.equal((await t.record(t.vehicle)).currentLocation,'Sasti OC','nothing moved while Pulse is silent');
  assert.equal(await queue.waiting(),1);
  answer=()=>({mode:'pulse',pulseTransferId:'77'});
  clock+=nextPulseRetryDelay(2);
  assert.equal((await queue.runOnce()).completed,1);
  const finished=await t.record(t.transfer);
  assert.equal(finished.status,'Completed');assert.equal(finished.pulseQueue,undefined);assert.equal(finished.pulseWaited.attempts,2);assert.equal(finished.destinationAcceptedBy,'PM Majri');
  assert.equal((await t.record(t.vehicle)).currentLocation,'Majri OC');assert.deepEqual(done,['VT-1-A1B2']);
 }finally{await t.db.close();}
});

test('a queued acceptance Pulse refuses is stopped with the reason; switching OFF finishes it locally',async()=>{
 const t=await setup();
 try{
  let clock=Date.parse('2026-11-16T05:00:00Z');const now=()=>clock;
  await tx(t.pool,c=>queueAcceptance(c,{id:t.transfer,acceptance,error:Error('no answer'),now}));
  clock+=nextPulseRetryDelay(1);
  const refusals=[];
  const refusing={transferMode:async()=>'bridge',completeTransfer:async()=>{throw Object.assign(Error('Pulse shows VPC40 at Dudhichua East OC, not Sasti OC.'),{retryable:false,extra:{code:'pulse_refused'}});}};
  assert.equal((await createTransferPulseQueue({pool:t.pool,writer:refusing,now,onRefused:async r=>{refusals.push(r.error);}}).runOnce()).refused,1);
  const refused=await t.record(t.transfer);
  assert.equal(refused.pulseQueue,undefined);assert.match(refused.pulseRefused.error,/Dudhichua/);assert.equal(refused.status,'Awaiting destination PM acceptance','the PM can accept again after a correction');
  assert.equal(refusals.length,1);
  await tx(t.pool,c=>queueAcceptance(c,{id:t.transfer,acceptance,error:Error('no answer'),now}));
  assert.equal((await t.record(t.transfer)).pulseRefused,undefined,'a new acceptance clears the old refusal');
  clock+=nextPulseRetryDelay(1);
  const off={transferMode:async()=>'off',completeTransfer:async()=>{throw Error('must not be called');}};
  assert.equal((await createTransferPulseQueue({pool:t.pool,writer:off,now}).runOnce()).completed,1);
  const local=await t.record(t.transfer);
  assert.equal(local.status,'Completed');assert.equal(local.pulseWrite.mode,'local-only');
 }finally{await t.db.close();}
});

test('the sign-in bridge keeps Pulse\'s own 404 answer and its timeout option',async()=>{
 const pool={query:async()=>({rows:[{grant_token:'g'}]})};
 const answers=[{status:404,body:{error:'Majri X is not a site in Pulse. Nothing was changed.'}},{status:404,body:null}];
 const seen=[];
 const bridge=createPulseSignInBridge({pool,fetchImpl:async(url,options)=>{seen.push(options.signal);const a=answers.shift();return {ok:false,status:a.status,json:async()=>{if(!a.body)throw Error('html');return a.body;}};}});
 await assert.rejects(bridge.request('vehicle-transfer-complete',{},null,{menu:'Pulse Master Sync',timeoutMs:15000}),e=>e.status===404&&/not a site in Pulse/.test(e.message));
 await assert.rejects(bridge.request('masters',{}),e=>e.status===503&&/still being applied/.test(e.message));
 assert.ok(seen[0]);
});
