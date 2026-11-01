import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LOG_BOOK_SCHEMA} from '../log-book.mjs';
import {registerVehicleTransferExpress,expressTransferMessage,pendingTransferFor} from '../vehicle-transfer-express.mjs';
import {registerEquipmentCreateExpress,normalizeEquipmentDraft,findExistingEquipment} from '../equipment-create-express.mjs';
import {checkOtpAttempt,hashOtp,OTP_MAX_ATTEMPTS} from '../otp-approval.mjs';
import {createOtpDelivery} from '../otp-delivery.mjs';
import {activeSiteHolds} from '../vlb-two-stage.mjs';

test('OTP attempts expire, count down and die after five wrong codes',()=>{
 const row={id:'r1',status:'sent',otp_hash:hashOtp('r1','482913'),attempts:0,expires_at:new Date(Date.now()+60000).toISOString()};
 assert.equal(checkOtpAttempt(row,'482913').ok,true);
 const wrong=checkOtpAttempt(row,'000000');assert.equal(wrong.ok,false);assert.equal(wrong.attempts,1);assert.match(wrong.message,/4 attempts left/);
 const dead=checkOtpAttempt({...row,attempts:OTP_MAX_ATTEMPTS-1},'000000');assert.equal(dead.status,'cancelled');
 assert.equal(checkOtpAttempt({...row,expires_at:new Date(Date.now()-1).toISOString()},'482913').status,'expired');
 assert.equal(checkOtpAttempt({...row,status:'used'},'482913').ok,false);
 assert.match(checkOtpAttempt(row,'12').message,/six-digit/);
});

test('delivery prefers Telegram and falls back to the registered mobile',async()=>{
 const users={pm1:{login:'pm1',phone:'919900000001'},pm2:{login:'pm2'}};
 const pool={query:async(sql,[login])=>({rows:users[login]?[{record_data:users[login]}]:[]})};
 const telegramSent=[],whatsappSent=[];
 const delivery=createOtpDelivery({pool,telegram:{async send(login,message){if(login==='pm2'){telegramSent.push(login);return true;}return false;}},whatsapp:{async send(to,otp){whatsappSent.push([to,otp]);return true;}}});
 const result=await delivery.send({logins:['pm1','PM2','ghost'],message:'m',otp:'123456'});
 assert.deepEqual(result.sentTo,['pm1','pm2']);assert.deepEqual(result.channels.sort(),['telegram','whatsapp']);assert.deepEqual(whatsappSent,[['919900000001','123456']]);assert.deepEqual(telegramSent,['pm2']);
});

test('new equipment draft needs chassis or registration and detects existing assets anywhere',()=>{
 assert.throws(()=>normalizeEquipmentDraft({door:'V-212',category:'Vehicle'},'Sasti OC'),/chassis number or the registration/);
 const draft=normalizeEquipmentDraft({door:'V-212',category:'vehicle',chassis:'MC2 1234',make:'Volvo'},'Sasti OC');
 assert.equal(draft.category,'Vehicle');assert.equal(draft.currentLocation,'Sasti OC');assert.equal(draft.equipmentName,'V-212');
 const assets=[{id:'1',door:'V212',currentLocation:'Jayant OC'},{id:'2',door:'T1',chassisNo:'mc21234',currentLocation:'Sasti OC'}];
 assert.equal(findExistingEquipment(draft,assets).matchedOn,'chassis');
 assert.equal(findExistingEquipment({door:'V 212',chassisNo:'',reg:''},assets).matchedOn,'door');
 assert.equal(findExistingEquipment({door:'V-999',chassisNo:'X',reg:'Y'},assets),null);
});

test('express transfer and new equipment complete on the PM OTP and clear batch holds',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const ids={};for(const [key,data] of [['vpc77',{category:'Equipment',door:'VPC-077',equipmentName:'VPC 077',currentLocation:'Jayant OC',chassisNo:'CH77'}],['d1',{category:'Equipment',door:'D1',currentLocation:'Sasti OC'}],['lost',{category:'Equipment',door:'L5',currentLocation:'Nowhere OC'}]]){const {rows}=await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1) RETURNING id",[JSON.stringify(data)]);ids[key]=String(rows[0].id);}
 const batchId=randomUUID();await db.query("INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,creator_login,request_key,continuous_entry,saved_lock_policy) VALUES($1,'CMLL/SASTI OC/18TH -DEC-26/S1/B01','sasti oc','2026-12-18','S1',1,NULL,'alice',$2,TRUE,TRUE)",[batchId,randomUUID()]);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const sent=[];let deliveryFails=false;
 const deliver=async({logins,message,otp})=>{if(deliveryFails)return {sentTo:[],channels:[],failures:['no channel']};sent.push({logins,message,otp});return {sentTo:logins,channels:['telegram'],failures:[]};};
 const pulseCalls=[];const pulseWriter={async completeTransfer(input){pulseCalls.push(['transfer',input.transfer.transferNo]);return {mode:'local-only'}},async createEquipment(input){pulseCalls.push(['create',input.equipment.door]);return {mode:'local-only'}}};
 const audits=[];
 const deps={pool,requireSession:(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.session={login:req.headers.authorization,name:req.headers.authorization};next()},
  accessContext:async session=>({canSubmit:session.login!=='viewer',scope:{sites:session.login==='other-site'?['jayant oc']:null}}),
  pmLogins:async(client,site)=>({'jayant oc':['pm-jayant','pm-jayant-2'],'sasti oc':['pm-sasti']})[String(site).toLowerCase()]||[],deliver,pulseWriter,auditEvent:(req,event)=>audits.push(event.action)};
 const app=express();app.use(express.json());
 const notified=[];registerVehicleTransferExpress(app,{...deps,notify:async(client,transfer)=>{notified.push(transfer.transferNo)}});registerEquipmentCreateExpress(app,deps);
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(route,body,auth='alice',method='POST')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}`+route,{method,headers:{Authorization:auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};

 assert.equal((await call('/api/vehicle-transfers/express',{batchId,assetId:ids.vpc77},'viewer')).status,403);
 assert.equal((await call('/api/vehicle-transfers/express',{batchId,assetId:ids.vpc77},'other-site')).status,403);
 assert.equal((await call('/api/vehicle-transfers/express',{batchId,assetId:ids.d1})).status,409,'already at the destination');
 assert.equal((await call('/api/vehicle-transfers/express',{batchId,assetId:ids.lost})).status,409,'no PM at the source site');
 deliveryFails=true;assert.match((await call('/api/vehicle-transfers/express',{batchId,assetId:ids.vpc77})).data.error,/no Telegram or mobile/);deliveryFails=false;
 const requested=await call('/api/vehicle-transfers/express',{batchId,assetId:ids.vpc77});
 assert.equal(requested.status,201,JSON.stringify(requested.data));assert.equal(requested.data.transfer.source,'Jayant OC');assert.equal(requested.data.transfer.destination,'Sasti OC');assert.deepEqual(requested.data.otp.sentTo,['pm-jayant','pm-jayant-2']);
 assert.equal(sent.length,1);assert.deepEqual(sent[0].logins,['pm-jayant','pm-jayant-2']);assert.match(sent[0].message,/VPC-077 is being logged at Sasti OC but is assigned to Jayant OC/);assert.match(sent[0].message,/OTP \d{6}, valid 10 minutes/);assert.match(sent[0].message,/CMLL\/SASTI OC/);
 assert.equal((await call('/api/vehicle-transfers/express',{batchId,assetId:ids.vpc77})).status,429,'one request per minute');
 const pending=await pendingTransferFor(pool,ids.vpc77);assert.equal(pending.transferNo,requested.data.transfer.transferNo);assert.equal(pending.otp.status,'sent');
 const otpRoute='/api/vehicle-transfers/express/'+requested.data.otp.id+'/verify';
 const wrong=await call(otpRoute,{otp:'000000'});assert.equal(wrong.status,400);assert.match(wrong.data.error,/4 attempts left/);
 const heldCard={data:{location:'Sasti OC',siteHolds:[{role:'vlb_loader',assetId:ids.vpc77,assetSite:'Jayant OC'}]}};
 const assetsBefore=(await db.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master'")).rows.map(r=>({id:String(r.id),...r.record_data}));
 assert.equal(activeSiteHolds(heldCard,assetsBefore).length,1);
 const done=await call(otpRoute,{otp:sent[0].otp});
 assert.equal(done.status,200,JSON.stringify(done.data));assert.equal(done.data.completed,true);assert.equal(done.data.transfer.status,'Completed');assert.equal(done.data.equipment.currentLocation,'Sasti OC');assert.equal(done.data.pulseWrite.mode,'local-only');
 const transfer=(await db.query("SELECT record_data FROM master_records WHERE master_name='Vehicle transfers'")).rows[0].record_data;
 assert.equal(transfer.sourceApprovedBy,'pm-jayant, pm-jayant-2');assert.equal(transfer.destinationMisVerifiedLogin,'alice');assert.equal(transfer.destinationAcceptanceImplied,true);assert.equal(transfer.expressOtp,true);
 const assetsAfter=(await db.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master'")).rows.map(r=>({id:String(r.id),...r.record_data}));
 assert.equal(activeSiteHolds(heldCard,assetsAfter).length,0,'the hold clears once the master moves');
 assert.equal(assetsAfter.find(a=>a.id===ids.vpc77).lastTransferNo,transfer.transferNo);
 assert.deepEqual(notified,[transfer.transferNo]);assert.deepEqual(pulseCalls,[['transfer',transfer.transferNo]]);
 assert.equal((await call(otpRoute,{otp:sent[0].otp})).status,400,'single use');
 assert.equal((await call('/api/vehicle-transfers/express',{batchId,assetId:ids.vpc77})).status,409,'now already at destination');
 const status=await call('/api/vehicle-transfers/express/'+requested.data.otp.id,null,'alice','GET');assert.equal(status.data.otp.status,'used');

 const missing=await call('/api/equipment/express',{batchId,draft:{door:'V-212',category:'Vehicle'}});assert.equal(missing.status,400);assert.match(missing.data.error,/chassis number or the registration/);
 const duplicate=await call('/api/equipment/express',{batchId,draft:{door:'VPC 77',category:'Equipment',chassis:'ch77'}});assert.equal(duplicate.status,409);assert.equal(duplicate.data.existing.door,'VPC-077');
 const otherSiteDup=await call('/api/equipment/express',{batchId,draft:{door:'L5',category:'Equipment',registration:'MH40'}});assert.equal(otherSiteDup.status,409);assert.equal(otherSiteDup.data.transferRequired,true);
 const created=await call('/api/equipment/express',{batchId,draft:{door:'V-212',category:'Vehicle',make:'Volvo',model:'FMX 460',chassis:'MC2ABC',registration:'MH40 AB 1234'},cardDraft:{door:'V-212',trips:[]}});
 assert.equal(created.status,201,JSON.stringify(created.data));assert.deepEqual(created.data.request.sentTo,['pm-sasti']);assert.match(sent.at(-1).message,/alice wants to add V-212 \(Volvo FMX 460, chassis MC2ABC, reg MH40 AB 1234\) to Sasti OC/);
 assert.equal((await call('/api/equipment/express',{batchId,draft:{door:'V 212',category:'Vehicle',chassis:'ZZ'}})).status,429,'one live request per door and site');
 const verifyRoute='/api/equipment/express/'+created.data.request.id+'/verify';
 assert.equal((await call(verifyRoute,{otp:'111111'})).status,400);
 const made=await call(verifyRoute,{otp:sent.at(-1).otp});
 assert.equal(made.status,200,JSON.stringify(made.data));assert.equal(made.data.equipment.door,'V-212');assert.equal(made.data.equipment.currentLocation,'Sasti OC');assert.equal(made.data.equipment.createdVia,'express-otp');assert.equal(made.data.equipment.approvedBy,'pm-sasti');assert.deepEqual(made.data.cardDraft,{door:'V-212',trips:[]});
 const master=(await db.query("SELECT record_data FROM master_records WHERE master_name='Equipment master' AND record_data->>'door'='V-212'")).rows;assert.equal(master.length,1);assert.equal(master[0].record_data.chassisNo,'MC2ABC');
 assert.equal((await call('/api/equipment/express',{batchId,draft:{door:'V-212',category:'Vehicle',chassis:'MC2ABC'}})).status,409,'now exists at this site');
 assert.deepEqual(pulseCalls.at(-1),['create','V-212']);
 assert.deepEqual(audits,['Request express transfer OTP','Complete express transfer by OTP','Request new equipment OTP','Create equipment by OTP']);
 assert.match(expressTransferMessage({transfer:{transferNo:'VT-1',source:'Jayant OC',destination:'Sasti OC',transferDate:'2026-11-01'},equipment:{door:'VPC-019'},requestedBy:'Op',otp:'123456'}),/date 01-11-2026/);
});
