import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {createEquipmentAlias,issueAliasOtp,verifyAliasOtp,loadEquipmentAliases,withEquipmentAliases,reconcileEquipmentAliases,scanBatchMismatches,aliasOtpMessage,aliasWeeklySummary,demoteUnapprovedAliases,registerEquipmentAliases,readAliasApprover,writeAliasApprover,aliasOtpEnabled} from '../equipment-aliases.mjs';
import {matchCardMachine} from '../scan-machine-rules.mjs';

const site='Dudhichua East OB';
async function database(){
 const db=new PGlite();const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 await db.exec(`CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT NOT NULL,record_data JSONB NOT NULL);
  CREATE TABLE pulse_master_links(master_name TEXT NOT NULL,source_id TEXT NOT NULL,local_id BIGINT NOT NULL,PRIMARY KEY(master_name,source_id));
  CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL,updated_at TIMESTAMPTZ);
  CREATE TABLE mis_telegram_links(login_name TEXT PRIMARY KEY,chat_id TEXT NOT NULL);
  CREATE TABLE mis_scan_cards(id TEXT PRIMARY KEY,status TEXT NOT NULL,raw_fields JSONB NOT NULL DEFAULT '{}');`);
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1),('Equipment master',$2),('Equipment master',$3),('Equipment master',$4)",[{door:'DEMO21-00179',category:'Equipment',currentLocation:site},{door:'VPC131-00123',category:'Equipment',currentLocation:site},{door:'V 732',category:'Vehicle',currentLocation:site},{door:'LPC 21',category:'Equipment',currentLocation:'Jayant OC'}]);
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Users & employees',$1),('Users & employees',$2)",[{login:'nitish',name:'Nitish Kumar Tiwari'},{login:'pm1',adminLevel:'Manager',managerRole:'Project Manager|MIS Manager',mobile:'919900000001'}]);
 await db.query("INSERT INTO mis_scan_cards VALUES('held','review',$1)",[{fleetReview:{issues:[{door:'LPC21'}],signature:'s'}}]);
 return {db,pool};
}
const telegramStub=linked=>{const sent=[];return {sent,send:async(login,message,key)=>{if(!linked.includes(login))return false;sent.push({login,message,key});return true;}};};
const otpOf=message=>message.match(/OTP (\d{6})/)[1];

test('the flag is off unless EQUIPMENT_ALIAS_OTP says on',()=>{
 assert.equal(aliasOtpEnabled({}),false);assert.equal(aliasOtpEnabled({EQUIPMENT_ALIAS_OTP:'0'}),false);assert.equal(aliasOtpEnabled({EQUIPMENT_ALIAS_OTP:'1'}),true);assert.equal(aliasOtpEnabled({EQUIPMENT_ALIAS_OTP:'on'}),true);
});

test('with the OTP rule on a pair starts pending, does not resolve cards, and becomes active only after the approver reads out the code',async t=>{
 const {db,pool}=await database();t.after(()=>db.close());
 const created=await createEquipmentAlias(pool,{equipmentId:'1',writtenText:'L21',site,book:'vlb',batchId:'b1',requestedBy:'mohit',otp:true});
 assert.equal(created.alias.status,'pending');
 assert.equal((await withEquipmentAliases(pool,[{id:'1',door:'DEMO21-00179'}]))[0].cardAliases,undefined,'a pending alias never rides on the asset');
 const telegram=telegramStub([]);
 await assert.rejects(issueAliasOtp(pool,{aliasId:created.alias.id,route:'nitish',requestedBy:'mohit',approver:{login:'nitish'},telegram}),/NITISH has not linked Telegram/);
 await assert.rejects(issueAliasOtp(pool,{aliasId:created.alias.id,route:'bogus',requestedBy:'mohit',telegram}),/Choose the approval route/);
 const linked=telegramStub(['nitish']);
 const otp=await issueAliasOtp(pool,{aliasId:created.alias.id,route:'nitish',requestedBy:'mohit',requesterName:'Mohit',approver:{login:'nitish'},telegram:linked,site,counts:{rows:9,cards:4,batch:'VLB-DCHE-0111-A',context:'01-11-2026, Shift I A'}});
 assert.equal(otp.route,'nitish');assert.deepEqual(otp.sent_to,['nitish']);assert.deepEqual(otp.channels,['telegram']);
 assert.match(linked.sent[0].message,/^Caliber Pulse: Equipment mapping approval\nMohit asks to map written machine L21 \(LPC · No\. 21\) to DEMO21-00179 at Dudhichua East OC\.\nSeen on 9 row\(s\) across 4 card\(s\) in VLB-DCHE-0111-A \(01-11-2026, Shift I A\)\.\nOTP \d{6}, valid 10 minutes\. Share it only if you approve\./);
 await assert.rejects(issueAliasOtp(pool,{aliasId:created.alias.id,route:'nitish',requestedBy:'mohit',approver:{login:'nitish'},telegram:linked}),/less than a minute/,'one request per minute per route');
 assert.equal((await loadEquipmentAliases(pool,{statuses:['pending']}))[0].nitish_otp_count,1);
 await assert.rejects(verifyAliasOtp(pool,{aliasId:created.alias.id,otpId:otp.id,otp:'000000',login:'bob'}),/no longer available/,'only the requester enters the code');
 await assert.rejects(verifyAliasOtp(pool,{aliasId:created.alias.id,otpId:otp.id,otp:'000000',login:'mohit'}),/4 attempts left/);
 // The emergency route is available at the same time; approval on one cancels the other.
 const deliveries=[];const deliver=async({logins,message,otp})=>{deliveries.push({logins,message,otp});return {sentTo:logins,channels:['whatsapp'],failures:[]}};
 await assert.rejects(issueAliasOtp(pool,{aliasId:created.alias.id,route:'site_pm',requestedBy:'mohit',pmLogins:async()=>['pm1'],deliver}),/why the mapping approver cannot be reached/);
 const emergency=await issueAliasOtp(pool,{aliasId:created.alias.id,route:'site_pm',emergencyReason:'on_leave',requestedBy:'mohit',requesterName:'Mohit',site,pmLogins:async()=>['pm1'],deliver});
 assert.match(deliveries[0].message,/NITISH could not be reached: On leave/);assert.equal(emergency.reason,'On leave');
 const approved=await verifyAliasOtp(pool,{aliasId:created.alias.id,otpId:otp.id,otp:otpOf(linked.sent[0].message),login:'mohit',requeue:async()=>{}});
 assert.equal(approved.alias.status,'active');assert.equal(approved.alias.approval_route,'nitish');assert.equal(approved.alias.approved_by,'nitish');assert.equal(approved.alias.otp_id,otp.id);
 const live=(await db.query("SELECT status FROM mis_equipment_alias_otps WHERE id=$1",[emergency.id])).rows[0].status;assert.equal(live,'cancelled','the other route is cancelled so a pair is never approved twice');
 assert.deepEqual((await withEquipmentAliases(pool,[{id:'1',door:'DEMO21-00179'}]))[0].cardAliases,['L21']);
 const history=(await db.query('SELECT action FROM mis_equipment_alias_history WHERE alias_id=$1 ORDER BY id',[created.alias.id])).rows.map(r=>r.action);
 assert.deepEqual(history,['created_pending','otp_sent','otp_sent','approved']);
 await assert.rejects(issueAliasOtp(pool,{aliasId:created.alias.id,route:'nitish',requestedBy:'mohit',approver:{login:'nitish'},telegram:linked}),/already approved/);
 // Revoke by OTP on the emergency route; PM self-approval is allowed (the PM is the requester).
 const revoke=await issueAliasOtp(pool,{aliasId:created.alias.id,purpose:'revoke_alias',route:'site_pm',emergencyReason:'other',emergencyNote:'Nitish on night shift',requestedBy:'pm1',site,pmLogins:async()=>['pm1'],deliver});
 assert.match(deliveries[1].message,/Equipment mapping revoke\nPM1 asks to revoke the mapping of written machine L21/i);
 const revoked=await verifyAliasOtp(pool,{aliasId:created.alias.id,otpId:revoke.id,otp:deliveries[1].otp,login:'pm1'});
 assert.equal(revoked.alias.status,'revoked');assert.equal(revoked.alias.revoke_route,'site_pm');
 assert.deepEqual(await loadEquipmentAliases(pool),[]);
});

test('switching the rule on demotes reviewer-saved aliases to pending; the approver setting is seeded NITISH and editable',async t=>{
 const {db,pool}=await database();t.after(()=>db.close());
 const direct=await createEquipmentAlias(pool,{equipmentId:'1',writtenText:'L21',requestedBy:'mohit',otp:false});
 assert.equal(direct.alias.status,'active');assert.equal(direct.alias.approval_route,'reviewer');
 assert.equal(await demoteUnapprovedAliases(pool),1);
 assert.equal((await loadEquipmentAliases(pool,{statuses:['pending']})).length,1);
 assert.deepEqual(await readAliasApprover(pool),{login:'nitish',name:'Nitish Kumar Tiwari',caliberId:'5431'});
 await writeAliasApprover(pool,{login:'RAVI'});assert.equal((await readAliasApprover(pool)).login,'ravi');
});

test('every Pulse snapshot retires redundant aliases, suspends shadowed ones with a Telegram line, and restores them when the collision goes',async t=>{
 const {db,pool}=await database();t.after(()=>db.close());
 const alias=(await createEquipmentAlias(pool,{equipmentId:'1',writtenText:'L21',site,requestedBy:'mohit',otp:false})).alias;
 const dozer=(await createEquipmentAlias(pool,{equipmentId:'2',writtenText:'D7',site,requestedBy:'mohit',otp:false})).alias;
 const telegram=telegramStub(['nitish','pm1']);
 assert.deepEqual(await reconcileEquipmentAliases(pool,{telegram,notifyLogins:async()=>['nitish','pm1']}),{retired:0,suspended:0,restored:0});
 // A new arrival at the site carries the written key as its real door: shadowing.
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1)",[{door:'L 21',category:'Equipment',currentLocation:site}]);
 const result=await reconcileEquipmentAliases(pool,{telegram,notifyLogins:async()=>['nitish','pm1']});
 assert.equal(result.suspended,1);
 const suspended=(await db.query('SELECT status,suspended_reason FROM mis_equipment_aliases WHERE id=$1',[alias.id])).rows[0];
 assert.equal(suspended.status,'suspended');assert.match(suspended.suspended_reason,/L21 is now a real door \(L 21, record 7\)/);
 assert.equal(telegram.sent.length,2);assert.match(telegram.sent[0].message,/equipment alias suspended/);
 assert.equal((await db.query("SELECT raw_fields FROM mis_scan_cards WHERE id='held'")).rows[0].raw_fields.fleetReview,undefined,'held cards are rechecked');
 // The matcher now reports the written key as ambiguous instead of resolving silently.
 const assets=await withEquipmentAliases(pool,(await db.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master'")).rows.map(r=>({...r.record_data,id:String(r.id)})));
 assert.equal(matchCardMachine(assets,'L21',site,'equipment').status,'ambiguous');
 assert.equal(await reconcileEquipmentAliases(pool,{telegram}).then(r=>r.suspended),0,'already suspended: no second alert');
 // The shadowing record transfers away: the approved alias answers again.
 await db.query("UPDATE master_records SET record_data=record_data||'{\"currentLocation\":\"Jayant OC\"}' WHERE id=7");
 assert.equal((await reconcileEquipmentAliases(pool,{telegram})).restored,1);
 assert.equal((await db.query('SELECT status FROM mis_equipment_aliases WHERE id=$1',[alias.id])).rows[0].status,'active');
 // Pulse renames the aliased asset itself to the written key: redundant, retire silently.
 await db.query("UPDATE master_records SET record_data=record_data||'{\"door\":\"D7\"}' WHERE id=2");
 const retired=await reconcileEquipmentAliases(pool,{telegram});
 assert.equal(retired.retired,1);assert.equal((await db.query('SELECT status FROM mis_equipment_aliases WHERE id=$1',[dozer.id])).rows[0].status,'retired');
 assert.equal(telegram.sent.length,2,'retirement sends no message');
});

test('the mismatch box lists Pulse records no card names beside written machines no door answers, category by category, ranked by number',()=>{
 const assets=[{id:'1',door:'DEMO21-00179',kind:'equipment',category:'Equipment',currentLocation:site,model:'PC210'},{id:'2',door:'VPC131-00123',kind:'equipment',category:'Equipment',currentLocation:site},{id:'3',door:'V 732',kind:'vehicle',category:'Vehicle',currentLocation:site},{id:'4',door:'V 733',kind:'vehicle',category:'Vehicle',currentLocation:site},{id:'5',door:'LPC 21',kind:'equipment',category:'Equipment',currentLocation:'Jayant OC'}];
 const card=(id,ordinal,doorText,trips)=>({id,ordinal,status:'review',draft:{doorText,location:site,trips:trips.map(t=>({equipmentName:t,equipmentNotation:{original:t,resolved:t}}))},raw_fields:{door:doorText}});
 const cards=[card('c1',1,'V 732',['L21','L21','VPC131']),card('c2',2,'V 734',['L21']),card('c3',3,'V 733',['VPC131']),{id:'c4',ordinal:4,status:'rejected',draft:{doorText:'V 999',trips:[{equipmentName:'X9'}]}}];
 const result=scanBatchMismatches({cards,assets,site,kind:'vehicle',aliases:[]});
 assert.equal(result.categories.length,2);
 const [tippers,body]=result.categories;
 assert.equal(tippers.label,'Tippers (trip card header)');assert.deepEqual(tippers.left.map(a=>a.door),[],'both site tippers are named on cards');
 assert.deepEqual(tippers.right.map(p=>[p.written,p.rows,p.cards]),[['V 734',1,1]]);
 assert.deepEqual(body.left.map(a=>a.door),['DEMO21-00179']);
 assert.deepEqual(body.right.map(p=>[p.key,p.written,p.rows,p.cards,p.suggestions]),[['LPC21','L21',3,2,['1']]]);
 assert.equal(body.right[0].machine,'LPC · No. 21');
 assert.deepEqual(result.current,{category:'tipper',pair:tippers.right[0]});assert.equal(result.pending,2);
 const resolved=scanBatchMismatches({cards,assets:assets.map(a=>a.id==='1'?{...a,cardAliases:['L21']}:a),site,kind:'vehicle',aliases:[]});
 assert.equal(resolved.categories[1].right.length,0,'an active alias removes the pair');
 const pending=scanBatchMismatches({cards,assets,site,kind:'vehicle',aliases:[{id:'a1',kind:'equipment',written_key:'LPC21',written_text:'L21',status:'pending',equipment_id:1}]});
 assert.equal(pending.categories[1].right[0].alias.status,'pending','a pending pair resumes at its OTP step');
 const elb=scanBatchMismatches({cards:[{id:'e1',ordinal:1,status:'review',draft:{doorText:'L21',location:site},raw_fields:{}}],assets,site,kind:'equipment'});
 assert.equal(elb.categories.length,1);assert.equal(elb.categories[0].id,'elb');assert.deepEqual(elb.categories[0].left.map(a=>[a.door,a.model]),[['DEMO21-00179','PC210'],['VPC131-00123','']]);
});

test('the weekly summary counts approvals by route and site and PM self-approvals',async t=>{
 const {db,pool}=await database();t.after(()=>db.close());
 await pool.query((await import('../equipment-aliases.mjs')).EQUIPMENT_ALIAS_SCHEMA);
 await db.query("INSERT INTO mis_equipment_aliases(id,equipment_id,kind,written_key,written_text,status,site,requested_by,approval_route,approved_by,approved_at) VALUES(gen_random_uuid(),1,'equipment','LPC21','L21','active',$1,'mohit','nitish','nitish',NOW()-interval '2 days'),(gen_random_uuid(),2,'equipment','D7','D7','active',$1,'pm1','site_pm','pm1',NOW()-interval '1 day'),(gen_random_uuid(),3,'vehicle','V734','V 734','active','Jayant OC','mohit','site_pm','pm2',NOW()-interval '3 days') ON CONFLICT DO NOTHING",[site]);
 const summary=await aliasWeeklySummary(pool,{since:new Date(Date.now()-7*86400000).toISOString(),until:new Date().toISOString()});
 assert.equal(summary.total,3);assert.deepEqual(summary.byRoute,{nitish:1,site_pm:2});assert.equal(summary.selfApproved,1);
 assert.match(summary.message,/Approved: 3 \(approver 1, emergency PM 2, PM self-approved 1\)/);assert.match(summary.message,/Dudhichua East OC: 2/);
});

test('the alias API with the rule on: pair returns otpRequired, OTP routes and verify go through the session login, settings expose the approver',async t=>{
 const {db,pool}=await database();t.after(()=>db.close());
 await db.query("INSERT INTO mis_telegram_links VALUES('nitish','chat-1')");
 const app=express();app.use(express.json());const telegram=telegramStub(['nitish']);
 registerEquipmentAliases(app,{pool,protect:(req,res,next)=>{req.session={login:req.headers.authorization||'mohit',name:'Mohit'};next();},requireAdministrator:(req,res,next)=>next(),telegram,pmLogins:async()=>['pm1'],deliver:async({logins,otp})=>({sentTo:logins,channels:['whatsapp'],failures:[]}),otpEnabled:()=>true,audit(){}});
 const server=app.listen(0);const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,body,user='mohit',method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:user},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 try{
  const settings=await call('/api/equipment-aliases/settings');assert.equal(settings.data.otpEnabled,true);assert.equal(settings.data.approver.login,'nitish');assert.equal(settings.data.approverTelegramLinked,true);
  const created=await call('/api/equipment-aliases',{equipmentId:'1',kind:'equipment',writtenText:'L21',site,book:'vlb'});
  assert.equal(created.status,201);assert.equal(created.data.otpRequired,true);assert.equal(created.data.alias.status,'pending');assert.equal(created.data.alias.equipmentDoor,'DEMO21-00179');
  const id=created.data.alias.id;
  assert.equal((await call('/api/equipment-aliases/'+id,undefined,'mohit','DELETE')).status,409,'direct revoke is refused while the OTP rule is on');
  const sent=await call('/api/equipment-aliases/'+id+'/otp',{route:'nitish',site,counts:{rows:2,cards:1}});
  assert.equal(sent.status,200,JSON.stringify(sent.data));assert.equal(sent.data.otp.route,'nitish');
  const listed=await call('/api/equipment-aliases');assert.equal(listed.data.aliases[0].otps.length,1,'the live OTP survives a reload for the requester');
  assert.equal((await call('/api/equipment-aliases',undefined,'bob')).data.aliases[0].otps.length,0);
  const wrong=await call('/api/equipment-aliases/'+id+'/otp/'+sent.data.otp.id+'/verify',{otp:'000000'});assert.equal(wrong.status,400);
  const ok=await call('/api/equipment-aliases/'+id+'/otp/'+sent.data.otp.id+'/verify',{otp:otpOf(telegram.sent[0].message)});
  assert.equal(ok.status,200,JSON.stringify(ok.data));assert.equal(ok.data.approved,true);assert.equal(ok.data.alias.status,'active');assert.equal(ok.data.alias.history.at(-1).action,'approved');
  assert.equal((await db.query("SELECT raw_fields FROM mis_scan_cards WHERE id='held'")).rows[0].raw_fields.fleetReview,undefined,'held cards are rechecked after approval');
  const again=await call('/api/equipment-aliases',{equipmentId:'1',kind:'equipment',writtenText:'L21'});assert.equal(again.status,200);assert.equal(again.data.created,false);assert.equal(again.data.otpRequired,false);
  const emergency=await call('/api/equipment-aliases/'+id+'/otp',{purpose:'revoke_alias',route:'site_pm',emergencyReason:'unwell',site});
  assert.equal(emergency.status,200,JSON.stringify(emergency.data));assert.deepEqual(emergency.data.otp.sentTo,['pm1']);
  const saved=await call('/api/equipment-aliases/settings',{approver:{login:'ravi'}},'mohit','PUT');assert.equal(saved.data.approver.login,'ravi');assert.equal(saved.data.approverTelegramLinked,false);
 }finally{server.close();}
});
