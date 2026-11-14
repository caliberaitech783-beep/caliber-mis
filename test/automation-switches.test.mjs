import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {AUTOMATIONS,AUTOMATION_KEYS,automationRows} from '../server/rules/automation-catalogue.mjs';
import {automationForEventKey,automationForPurpose,configureAutomationSwitches,automationOn,writeAutomationSwitch,readAutomationSwitches} from '../server/services/automation-switches.mjs';
import {createAutomationCentre,registerAutomationCentre} from '../server/routes/automation-centre.mjs';
import {createOtpDelivery,telegramOutboxSender} from '../server/services/otp-delivery.mjs';
import {sendTelegramText} from '../server/services/telegram.mjs';
import {sendMetaWhatsAppText} from '../server/rules/meta-whatsapp.mjs';
import {MIS_TELEGRAM_SCHEMA} from '../server/routes/mis-telegram.mjs';
import {normalizeWhatsAppReportSettings} from '../shared/whatsapp-report-settings.mjs';
import {DEFAULT_ALERT_SETTINGS} from '../server/routes/vlb-batch-alerts.mjs';
import {readMismatchSettings} from '../server/routes/equipment-pulse-mismatch.mjs';

const context=(over={})=>({whatsappSettings:normalizeWhatsAppReportSettings({}),whatsappConfigured:true,misTelegram:{enabled:true},pulseTelegram:{configured:true,paused:false},pulseTelegramPurpose:()=>true,
 vlbAlerts:{...DEFAULT_ALERT_SETTINGS},vlbAlertsRunning:true,scheduledJobs:true,emailConfigured:true,deletionWhatsApp:true,mismatch:{enabled:true,intervalHours:6,popup:true,telegram:true,whatsapp:false,logins:[]},...over});

async function database(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB,updated_at TIMESTAMPTZ);
  CREATE TABLE whatsapp_alert_history(id BIGSERIAL PRIMARY KEY,report_type TEXT,recipient_name TEXT DEFAULT '',recipient_phone TEXT DEFAULT '',status TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
  ${MIS_TELEGRAM_SCHEMA}`);
 const pool={query:(sql,args)=>args?db.query(sql,args):db.exec(sql).then(results=>results.at(-1))};
 configureAutomationSwitches({pool});t.after(()=>configureAutomationSwitches({}));
 return {db,pool};
}

test('every message the application sends finds its automation line',()=>{
 for(const item of AUTOMATIONS)for(const prefix of item.count.outbox||[]){
  const [name,kind]=prefix.split('/');
  const key=kind?automationForEventKey(`${name}:site|2026-11-10|S1|${kind}:1`):automationForEventKey(`${name}:42:login`);
  assert.equal(key,item.key,`${prefix} belongs to ${item.code}`);
 }
 assert.equal(automationForEventKey('release:abc:1'),null,'release codes are not an Automation Centre line');
 assert.equal(automationForEventKey('otp:boss:1'),null);
 for(const [purpose,key] of [['requestOpened','request-opened'],['idleReminder','request-reminders'],['offRoadEscalation','request-reminders'],['dailyUpdate','daily-update'],
  ['consolidatedTicketReport','crm-report'],['consolidatedRequestReport','hierarchy-report'],['passwordResetOtp','password-otp'],['logBookDeletionOtp','deletion-otp']])
  assert.equal(automationForPurpose(purpose),key,purpose);
 assert.equal(automationForPurpose('manualReports'),null,'a report sent by hand is not an automation');
 assert.equal(automationForPurpose('pmApprovalOtp'),null,'approval codes are switched by their event key');
 for(const purpose of ['requestOpened','requestClosed','requestVerified','requestIdle','offRoadEscalation','dailyUpdate','consolidatedTicketReport','consolidatedRequestReport','passwordResetOtp','logBookDeletionOtp'])
  assert.ok(AUTOMATION_KEYS.has(automationForPurpose(purpose)),purpose);
});

test('a line switched OFF shows OFF on every channel; a line ON that sends nothing says why',()=>{
 const rows=automationRows(context({misTelegram:{enabled:false},switches:{'transfer-otp':{enabled:false,changedBy:'Mohit',changedAt:'2026-11-15T03:00:00Z'},'request-opened':{enabled:false}}}));
 const row=key=>rows.find(item=>item.key===key);
 assert.deepEqual([row('transfer-otp').switchedOn,row('transfer-otp').active,row('transfer-otp').channels.whatsapp,row('transfer-otp').switchChangedBy],[false,false,'off','Mohit']);
 assert.equal(row('transfer-otp').notSendingReason,'');
 assert.match(row('transfer-otp').offWarning,/cannot be finished/);
 assert.deepEqual(row('request-opened').channels,{telegram:'off',whatsapp:'off',email:null,popup:'on'},'in-app breakdown pop-ups stay');
 assert.equal(row('request-opened').active,false);
 assert.equal(row('vlb-batch-not-created').switchedOn,true,'every line starts ON');
 assert.equal(row('vlb-batch-not-created').channels.telegram,'off');
 assert.match(row('vlb-batch-not-created').notSendingReason,/^Nothing goes out: the Pulse-II Telegram bot is not connected/);
 assert.equal(row('equipment-otp').notSendingReason,'','WhatsApp still carries the code');
 const quiet=automationRows(context({vlbAlerts:{...DEFAULT_ALERT_SETTINGS,enabled:false}})).find(item=>item.key==='vlb-batch-not-closed');
 assert.match(quiet.notSendingReason,/VLB batch alerts are switched off on the Telegram Integration page/);
 const mismatchOff=automationRows(context({mismatch:{...context().mismatch,enabled:false},switches:{'equipment-mismatch':{enabled:true}}})).find(item=>item.key==='equipment-mismatch');
 assert.equal(mismatchOff.switchedOn,false,'A01 follows its own settings box');
});

test('a switched-off automation sends nothing on Telegram, WhatsApp or the approval-code fallback',async t=>{
 const {db,pool}=await database(t);
 await db.query('INSERT INTO mis_telegram_links(login_name,chat_id) VALUES($1,$2)',['pm1','111']);
 const outbox=telegramOutboxSender(pool);
 assert.equal(await outbox.send('pm1','code','transfer-otp:7:pm1'),true,'ON by default');
 await writeAutomationSwitch(pool,{key:'transfer-otp',enabled:false,changedBy:'Mohit'});
 assert.equal(await automationOn('transfer-otp'),false);
 assert.equal(await outbox.send('pm1','code','transfer-otp:8:pm1'),false);
 assert.equal(await outbox.send('pm1','code','equipment-otp:8:pm1'),true,'other lines carry on');
 assert.deepEqual((await db.query("SELECT event_key FROM mis_telegram_outbox ORDER BY id")).rows.map(row=>row.event_key),['transfer-otp:7:pm1','equipment-otp:8:pm1']);

 let whatsappCalls=0;
 const delivery=createOtpDelivery({pool,telegram:outbox,whatsapp:{async send(){whatsappCalls++;return true;}}});
 const refused=await delivery.send({logins:['pm1'],message:'code',otp:'123456',eventKey:'transfer-otp:9'});
 assert.deepEqual([refused.sentTo,whatsappCalls],[[],0]);
 assert.match(refused.failures[0],/Switched off in the Automation Centre/);

 await writeAutomationSwitch(pool,{key:'request-opened',enabled:false});
 let fetched=0;const fetchImpl=async()=>{fetched++;return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:1},messages:[{id:'w1'}]})};};
 const env={TELEGRAM_BOT_TOKEN:'token',TELEGRAM_DEFAULT_CHAT_ID:'-100'};
 await assert.rejects(sendTelegramText({message:'Opened',purpose:'requestOpened'},{env,fetchImpl}),{code:'TELEGRAM_POLICY_PAUSED',status:409});
 await assert.rejects(sendMetaWhatsAppText({to:'919999999999',message:'Opened',purpose:'requestOpened'},{env:{META_WHATSAPP_ACCESS_TOKEN:'t',META_WHATSAPP_PHONE_NUMBER_ID:'1'},fetchImpl}),{code:'WHATSAPP_POLICY_PAUSED'});
 assert.equal(fetched,0,'nothing reached Telegram or WhatsApp');
 await sendTelegramText({message:'Closed',purpose:'requestClosed'},{env,fetchImpl});
 assert.equal(fetched,1,'a line still ON sends as before');
 await writeAutomationSwitch(pool,{key:'request-opened',enabled:true});
 await sendTelegramText({message:'Opened',purpose:'requestOpened'},{env,fetchImpl});
 assert.equal(fetched,2,'switching ON again sends at once');
 assert.deepEqual(Object.keys(await readAutomationSwitches(pool)).sort(),['request-opened','transfer-otp'],'each switch is kept by its own key');
});

test('administrators switch a line ON and OFF on the Automation Centre; A01 uses its own settings',async t=>{
 const {pool}=await database(t);
 const centre=createAutomationCentre({pool,context:async()=>context()});
 const app=express();app.use(express.json());
 const auth=(req,res,next)=>{const who=req.get('Authorization');if(!who)return res.sendStatus(401);req.session={login:who,name:who==='admin'?'Mohit':who};next();};
 const audits=[];
 registerAutomationCentre(app,{pool,centre,requireSession:auth,requireAdministrator:(req,res,next)=>{res.on('finish',()=>req.audit&&audits.push(req.audit));return req.session.login==='admin'?next():res.sendStatus(403);}});
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(body,who='admin')=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/automation-centre/switch',{method:'PUT',headers:{Authorization:who,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json().catch(()=>({}))};};

 assert.equal((await call({key:'transfer-otp',enabled:false},'boss')).status,403);
 assert.equal((await call({key:'not-a-line',enabled:false})).status,400);
 assert.equal((await call({key:'transfer-otp',enabled:'no'})).status,400);
 const off=await call({key:'transfer-otp',enabled:false});
 assert.equal(off.status,200);
 const row=off.body.rows.find(item=>item.key==='transfer-otp');
 assert.deepEqual([row.switchedOn,row.active,row.switchChangedBy],[false,false,'Mohit']);
 assert.equal(off.body.totals.active,off.body.rows.filter(item=>item.active).length);
 assert.equal(audits.at(-1).action,'Switch off A08 Express transfer approval code');
 assert.equal((await call({key:'transfer-otp',enabled:true})).body.rows.find(item=>item.key==='transfer-otp').switchedOn,true);

 const mismatch=await call({key:'equipment-mismatch',enabled:false});
 assert.equal(mismatch.body.mismatchSettings.enabled,false);
 assert.equal((await readMismatchSettings(pool)).enabled,false,'A01 switch writes the box in its own settings');
 assert.equal(mismatch.body.rows.find(item=>item.key==='equipment-mismatch').channels.popup,'off');
});
