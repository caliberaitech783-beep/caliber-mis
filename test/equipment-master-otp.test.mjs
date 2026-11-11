import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {registerEquipmentMasterOtp,toPulseChanges} from '../server/routes/equipment-master-otp.mjs';
import {equipmentChangeText,equipmentChanges,validEquipmentOtp} from '../src/equipment-otp-dialog.mjs';

const links=[{local_id:11,source_id:501},{local_id:12,source_id:502}];
const pool={query:async(_sql,[,ids])=>({rows:links.filter(row=>ids.includes(row.local_id))})};

async function serve({syncError}={}){
 const calls=[],syncs=[];
 const app=express();app.use(express.json());
 const pulse={sync:async(master,who)=>{syncs.push([master,who]);if(syncError&&syncs.length===1)throw new Error(syncError);}};
 const sharedSignIn={request:async(action,payload,actor)=>{calls.push({action,payload,actor});
  if(action==='equipment-changes')return {id:'0b5b2c1e-1111-4222-8333-444455556666',summary:{add:1,edit:1,delete:1,total:3},sentTo:['••••6090','••••9175','••••4667'],expiresAt:new Date(Date.now()+600000).toISOString()};
  if(payload.otp!=='123456')throw Object.assign(new Error('Wrong OTP. Check the code and try again.'),{status:400});
  return {status:'approved',summary:{add:1,edit:1,delete:1,total:3}};}};
 const requireSuper=(req,_res,next)=>{req.session={login:'MIS.ADMIN'};next();};
 registerEquipmentMasterOtp(app,{pool,pulse,sharedSignIn,requireSuper,wait:async()=>{}});
 app.post('/api/masters/:master',(_req,res)=>res.json({direct:true}));
 const server=await new Promise(resolve=>{const s=app.listen(0,()=>resolve(s));});
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 return {calls,syncs,post,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('Pulse-II ids are translated to Pulse ids and local-only records are refused',async()=>{
 const changes=await toPulseChanges(pool,[
  {operation:'add',record:{id:99,door:'T-9'}},
  {operation:'edit',id:11,record:{id:11,door:'T-1',make:'BEML'}},
  {operation:'delete',id:12,label:'T-2'},
 ]);
 assert.deepEqual(changes,[
  {operation:'add',record:{door:'T-9'},label:'T-9'},
  {operation:'edit',id:501,record:{door:'T-1',make:'BEML'},label:'T-1'},
  {operation:'delete',id:502,label:'T-2'},
 ]);
 await assert.rejects(toPulseChanges(pool,[{operation:'delete',id:77,label:'T-77'}]),error=>error.status===409&&/T-77 is not linked/.test(error.message));
 await assert.rejects(toPulseChanges(pool,[]),/at least one/);
});

test('direct Equipment master writes are closed; other masters still pass',async()=>{
 const {post,close}=await serve();
 try{
  const blocked=await post('/api/masters/Equipment%20master',{door:'X'});
  assert.equal(blocked.status,409);assert.equal(blocked.body.code,'equipment_otp_required');
  assert.deepEqual((await post('/api/masters/Region%20master',{name:'X'})).body,{direct:true});
 }finally{await close();}
});

test('one OTP request goes to Pulse, then the verified set is pulled back at once',async()=>{
 const {calls,syncs,post,close}=await serve({syncError:'A master sync is already running.'});
 try{
  const requested=await post('/api/equipment-master/changes',{changes:[{operation:'edit',id:11,record:{door:'T-1'}}]});
  assert.equal(requested.status,200);assert.equal(requested.body.sentTo.length,3);
  assert.deepEqual(calls[0],{action:'equipment-changes',payload:{changes:[{operation:'edit',id:501,record:{door:'T-1'},label:'T-1'}]},actor:'MIS.ADMIN'});
  const wrong=await post(`/api/equipment-master/changes/${requested.body.id}/verify`,{otp:'654321'});
  assert.equal(wrong.status,400);assert.match(wrong.body.error,/Wrong OTP/);
  assert.equal(syncs.length,0,'nothing is pulled before the OTP is accepted');
  assert.equal((await post(`/api/equipment-master/changes/${requested.body.id}/verify`,{otp:'12'})).status,400);
  const done=await post(`/api/equipment-master/changes/${requested.body.id}/verify`,{otp:'123456'});
  assert.equal(done.status,200);assert.equal(done.body.status,'approved');assert.equal(done.body.synced,true);
  assert.deepEqual(syncs,[['Equipment master','MIS.ADMIN'],['Equipment master','MIS.ADMIN']],'a busy sync is retried');
  assert.deepEqual(calls.at(-1),{action:'equipment-changes-verify',payload:{id:requested.body.id,otp:'123456'},actor:'MIS.ADMIN'});
 }finally{await close();}
});

test('the shared dialog helpers build one change list per action',()=>{
 assert.equal(validEquipmentOtp(' 123456 '),true);assert.equal(validEquipmentOtp('12345'),false);
 assert.equal(equipmentChangeText({add:2,delete:1}),'2 adds, 1 delete');
 assert.deepEqual(equipmentChanges.remove([{id:'4',door:'A'},{door:'unsaved'}]),[{operation:'delete',id:4,label:'A'}]);
 assert.deepEqual(equipmentChanges.edit(4,{door:'A'}),[{operation:'edit',id:4,record:{door:'A'},label:'A'}]);
});
