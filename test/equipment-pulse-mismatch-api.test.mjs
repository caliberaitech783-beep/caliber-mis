import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {createEquipmentMismatchWorker,registerEquipmentMismatch,mismatchSlot,normalizeMismatchSettings,writeMismatchSettings,readMismatchSettings,resolveRecipients} from '../server/routes/equipment-pulse-mismatch.mjs';
import {createAutomationCentre,registerAutomationCentre} from '../server/routes/automation-centre.mjs';
import {MIS_TELEGRAM_SCHEMA} from '../server/routes/mis-telegram.mjs';
import {normalizeWhatsAppReportSettings} from '../shared/whatsapp-report-settings.mjs';
import {DEFAULT_ALERT_SETTINGS} from '../server/routes/vlb-batch-alerts.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';

const HOUR=3600000;
async function setup(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE pulse_master_links(master_name TEXT NOT NULL,source_id TEXT NOT NULL,local_id BIGINT NOT NULL,PRIMARY KEY(master_name,source_id));
  CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB,updated_at TIMESTAMPTZ);
  CREATE TABLE whatsapp_alert_history(id BIGSERIAL PRIMARY KEY,report_type TEXT,target_name TEXT,report_level TEXT DEFAULT '',recipient_name TEXT DEFAULT '',recipient_phone TEXT DEFAULT '',status TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
  ${MIS_TELEGRAM_SCHEMA}`);
 const pool={query:(sql,args)=>args?db.query(sql,args):db.exec(sql).then(results=>results.at(-1))};
 const add=async(master,data)=>(await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2) RETURNING id',[master,data])).rows[0].id;
 const link=(master,source,local)=>db.query('INSERT INTO pulse_master_links VALUES($1,$2,$3)',[master,String(source),local]);
 return {db,pool,add,link};
}
async function serve(t,register){
 const app=express();app.use(express.json());
 const auth=(req,res,next)=>{const who=req.get('Authorization');if(!who)return res.sendStatus(401);
  req.session={role:'super',login:who,permissions:{adminLevel:who==='admin'?'Admin':'Manager'}};req.logBookScope={sites:null};next();};
 register(app,auth);
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close()});
 return async(path,who='admin',method='GET',body)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{Authorization:who,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json().catch(()=>null)};};
}

test('settings keep to the allowed hours and a clean login list',()=>{
 assert.deepEqual(normalizeMismatchSettings({}),{enabled:true,intervalHours:6,popup:true,telegram:true,whatsapp:false,logins:[]});
 assert.deepEqual(normalizeMismatchSettings({logins:''}).logins,[],'an emptied list means the MIS managers');
 assert.deepEqual(normalizeMismatchSettings({logins:'+91 90000 00002, 09000000002, Boss'}).logins,['9000000002','boss']);
 assert.deepEqual(normalizeMismatchSettings({intervalHours:5,logins:' A1, a1 ;B2 ',whatsapp:true,enabled:false}),{enabled:false,intervalHours:6,popup:true,telegram:true,whatsapp:true,logins:['a1','b2']});
 const at=Date.parse('2026-11-11T16:10:00Z');// 21:40 IST
 assert.equal(mismatchSlot(at,6),'scheduled:2026-11-11:6h:3');
 assert.equal(mismatchSlot(at+3*HOUR,6),'scheduled:2026-11-12:6h:0');
});

test('a mismatch is checked once per slot, sent by Telegram, popped up until OK, and repeated in the next slot',async t=>{
 const {pool,add,link}=await setup(t);
 const sasti=await add('Equipment master',{door:'EX-01',chassis:'CH1',group:'Excavator',currentLocation:'Sasti OB'});await link('Equipment master',1,sasti);
 await add('Equipment master',{door:'NEW-7',chassis:'CH7',group:'Drill',currentLocation:'Sasti OB',pulseWrite:{mode:'local-only'}});
 const lmv=await add('Equipment master',{door:'LMV-1',category:'LMV',currentLocation:'Sasti OB'});await link('LMV master',50,lmv);
 await writeMismatchSettings(pool,{logins:['boss','nolink']});
 let nowMs=Date.now(),pulseRows=[{id:1,door:'EX-01',chassis:'CH1',group:'Excavator',currentLocation:'Majri OB'}],connected=true,reads=0;
 const sent=[];
 const telegram={async send(login,message,key){if(login==='nolink')return false;sent.push({login,message,key});return true;}};
 const worker=createEquipmentMismatchWorker({pool,now:()=>nowMs,telegram,pulse:{status:()=>({connected}),readEquipmentList:async()=>{reads++;if(!pulseRows)throw Error('Pulse is temporarily unavailable.');return pulseRows;}}});
 const call=await serve(t,(app,auth)=>registerEquipmentMismatch(app,{pool,worker,protect:[auth]}));

 connected=false;assert.deepEqual(await worker.runOnce(),{waiting:true});connected=true;
 const first=await worker.runOnce();
 assert.equal(first.matches,false);assert.equal(first.machines,2);assert.equal(first.telegramSent,1);
 assert.match(first.note,/nolink: Telegram not linked/);
 assert.equal(sent[0].key,'equipment-mismatch:'+mismatchSlot(nowMs,6)+':boss');
 assert.match(sent[0].message,/Equipment list mismatch/);assert.match(sent[0].message,/NEW-7 \(In Pulse-II, not in Pulse/);assert.doesNotMatch(sent[0].message,/LMV-1/);
 assert.deepEqual(await worker.runOnce(),{skipped:true});assert.equal(reads,1);

 const report=(await call('/api/reports/equipment-pulse-mismatch')).body;
 assert.equal(report.run.matches,false);assert.equal(report.canCheck,true);
 assert.deepEqual(report.run.result.machines.map(m=>[m.kind,m.door]),[['missing-in-pulse','NEW-7'],['site-differs','EX-01']]);
 assert.equal((await call('/api/reports/equipment-pulse-mismatch','boss')).body.canCheck,false);
 assert.equal((await call('/api/reports/equipment-pulse-mismatch/check','boss','POST')).status,403);

 const noticeUrl='/api/reports/equipment-pulse-mismatch/notice';
 const notice=(await call(noticeUrl)).body.notice;
 assert.equal(notice.machineCount,2);assert.equal(notice.intervalHours,6);
 assert.equal((await call(noticeUrl,'boss')).body.notice.id,notice.id);
 assert.equal((await call(noticeUrl,'stranger')).body.notice,null,'only administrators and the listed people see the pop-up');
 assert.equal((await call(noticeUrl+'/seen','admin','POST',{id:'x'})).status,400);
 assert.equal((await call(noticeUrl+'/seen','admin','POST',{id:notice.id})).status,200);
 assert.equal((await call(noticeUrl)).body.notice,null);
 assert.equal((await call(noticeUrl,'boss')).body.notice.id,notice.id,'one person pressing OK does not close it for another');

 nowMs+=6*HOUR;// next 6-hour slot, still different
 const second=await worker.runOnce();assert.equal(second.matches,false);assert.equal(sent.length,2);
 assert.notEqual((await call(noticeUrl)).body.notice.id,notice.id,'the notice returns after the next check');

 const manual=await call('/api/reports/equipment-pulse-mismatch/check','admin','POST');
 assert.equal(manual.status,200);assert.equal(sent.length,2,'checking by hand sends no message');
 assert.equal((await call('/api/reports/equipment-pulse-mismatch/check','admin','POST')).status,429);

 nowMs+=6*HOUR;pulseRows=[{id:1,door:'EX-01',chassis:'CH1',group:'Excavator',currentLocation:'Sasti'},{id:2,door:'NEW-7',chassis:'CH7',group:'Drill',currentLocation:'Sasti'}];
 const third=await worker.runOnce();assert.equal(third.matches,true);assert.equal(sent.length,2);
 assert.equal((await call('/api/reports/equipment-pulse-mismatch')).body.run.matches,true);

 nowMs+=6*HOUR;pulseRows=null;
 await assert.rejects(worker.runOnce(),/temporarily unavailable/);
 const failed=(await call('/api/reports/equipment-pulse-mismatch')).body;
 assert.equal(failed.lastAttempt.status,'failed');assert.equal(failed.run.matches,true,'the last good result stays on screen');

 await writeMismatchSettings(pool,{enabled:false});
 assert.deepEqual(await worker.runOnce(),{disabled:true});
});

test('a mobile number in the people list reaches the Pulse-II login that carries it',async t=>{
 const {db,pool,add}=await setup(t);
 await add('Users & employees',{login:'Owner1',mobile:'+91 90000 00002'});
 await add('Users & employees',{login:'gone',mobile:'9000000002',sourceMissing:true});
 await add('Users & employees',{login:'pm1',whatsapp:'9000000001'});
 await add('Equipment master',{door:'NEW-7',chassis:'CH7',group:'Drill',currentLocation:'Sasti OB'});
 await db.query("INSERT INTO mis_telegram_links(login_name,chat_id) VALUES('owner1','555')");
 await writeMismatchSettings(pool,{logins:'9000000002, 9111111111, pm1'});
 const sent=[];
 const worker=createEquipmentMismatchWorker({pool,telegram:{async send(login,message,key){sent.push(login);return true;}},pulse:{status:()=>({connected:true}),readEquipmentList:async()=>[{id:1,door:'EX-01',chassis:'CH1',group:'Excavator',currentLocation:'Sasti'}]}});
 assert.deepEqual(await resolveRecipients(pool,['9000000002','9111111111','pm1']).then(r=>[r.logins,r.unknown]),[['owner1','pm1'],['9111111111']]);
 const run=await worker.runOnce();
 assert.deepEqual(sent,['owner1','pm1']);assert.match(run.note,/9111111111: no Pulse-II user has this mobile number/);
 const check=await worker.recipientCheck(await readMismatchSettings(pool));
 assert.deepEqual(check.map(p=>[p.entry,p.telegramLinked]),[['9000000002',true],['9111111111',false],['pm1',false]]);
 assert.match(check[0].note,/Pulse-II login owner1. Telegram connected./);assert.match(check[2].note,/Telegram not connected yet/);
});

test('the Automation Centre lists every rule with its channels and counts to date',async t=>{
 const {db,pool}=await setup(t);
 await db.exec(`INSERT INTO mis_telegram_outbox(event_key,chat_id,message,status) VALUES
  ('equipment-mismatch:scheduled:2026-11-11:6h:3:boss','1','m','sent'),('equipment-mismatch:scheduled:2026-11-12:6h:0:boss','1','m','sent'),('equipment-mismatch:scheduled:2026-11-12:6h:1:boss','1','m','failed'),
  ('vlb-alert:sasti ob|2026-11-10|S1|not_created:1','1','m','sent'),('vlb-alert:sasti ob|2026-11-10|S1|not_closed:1','1','m','sent'),('vlb-alert:sasti ob|2026-11-10|S1|not_closed:2','1','m','sent'),
  ('created:T-1:99','1','m','sent'),('resolved:T-1:99','1','m','sent');
  INSERT INTO whatsapp_alert_history(report_type,target_name,recipient_name,recipient_phone,status) VALUES
  ('System notification','R1','A','919999999999','Sent'),('System notification','R1','Telegram group','-100','Sent by Telegram'),('System notification','R2','B','919999999998','Failed: paused'),
  ('Consolidated CRM report','All','C','919999999997','Sent');`);
 const context=async()=>({whatsappSettings:normalizeWhatsAppReportSettings({}),whatsappConfigured:true,misTelegram:{enabled:true},pulseTelegram:{configured:true,paused:false},pulseTelegramPurpose:()=>true,
  vlbAlerts:{...DEFAULT_ALERT_SETTINGS},vlbAlertsRunning:true,scheduledJobs:false,emailConfigured:true,deletionWhatsApp:false});
 const centre=createAutomationCentre({pool,context});
 const call=await serve(t,(app,auth)=>registerAutomationCentre(app,{pool,centre,requireSession:auth,requireAdministrator:(req,res,next)=>req.session.login==='admin'?next():res.sendStatus(403)}));
 assert.equal((await call('/api/automation-centre','boss')).status,403);
 const {body}=await call('/api/automation-centre');
 const row=key=>body.rows.find(item=>item.key===key);
 assert.deepEqual(body.rows.map(item=>item.code),body.rows.map((item,index)=>'A'+String(index+1).padStart(2,'0')),'codes run in order with no gaps');
 assert.equal(body.totals.automations,body.rows.length);
 assert.deepEqual([row('equipment-mismatch').sent,row('equipment-mismatch').channels],[2,{telegram:'on',whatsapp:'off',email:null,popup:'on'}]);
 assert.equal(row('equipment-mismatch').trigger,'Every 6 hours, repeated until the lists match');
 assert.deepEqual([row('vlb-batch-not-created').sent,row('vlb-batch-not-closed').sent,row('mis-ticket').sent],[1,2,2]);
 assert.deepEqual([row('request-opened').sent,row('request-opened').sentTelegram,row('request-opened').sentWhatsApp],[2,1,1]);
 assert.equal(row('request-closed').sent,null,'rules that share one history show the shared total once');
 assert.match(row('request-closed').countNote,/counted together/);
 assert.equal(row('crm-report').sent,1);assert.equal(row('crm-report').channels.whatsapp,'off','scheduled reports show OFF while scheduled jobs are off');
 assert.equal(row('deletion-otp').sent,null);
 assert.equal(body.totals.sentToDate,2+1+2+2+2+1);
 await db.exec('DELETE FROM whatsapp_alert_history');
 assert.equal((await call('/api/automation-centre')).body.rows.find(item=>item.key==='request-opened').sent,2,'counts survive the clearing of the delivery history');

 assert.equal((await call('/api/automation-centre/equipment-mismatch','admin','PUT',{intervalHours:5})).status,400);
 const saved=await call('/api/automation-centre/equipment-mismatch','admin','PUT',{intervalHours:12,whatsapp:true,logins:'boss, pm1'});
 assert.deepEqual(saved.body.mismatchSettings,{enabled:true,intervalHours:12,popup:true,telegram:true,whatsapp:true,logins:['boss','pm1']});
 const changed=saved.body.rows.find(item=>item.key==='equipment-mismatch');
 assert.equal(changed.channels.whatsapp,'on');assert.equal(changed.people,'boss, pm1');assert.match(changed.trigger,/Every 12 hours/);
});

test('MIS logins reach the Automation Centre only as administrators',()=>{
 const session=pages=>({role:'super',permissions:{separateMisCredentials:true,misDesktopAccess:pages}});
 const get={path:'/api/automation-centre',method:'GET'},put={path:'/api/automation-centre/equipment-mismatch',method:'PUT'};
 assert.equal(misRequestAllowed(session(['Users & employees']),get),true);
 assert.equal(misRequestAllowed(session(['Users & employees']),put),true);
 assert.equal(misRequestAllowed(session(['Reports']),get),false);
 assert.equal(misRequestAllowed(session(['Reports']),put),false);
 assert.equal(misRequestAllowed(session(['Reports']),{path:'/api/reports/equipment-pulse-mismatch/notice',method:'GET'}),true);
 assert.equal(misRequestAllowed(session(['Dashboard']),{path:'/api/reports/equipment-pulse-mismatch',method:'GET'}),false);
});
