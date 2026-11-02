import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {dueBatchAlerts,shiftEndInstant,shiftsInForce,alertMessage,normalizeAlertSettings,createVlbBatchAlertWorker,DEFAULT_ALERT_SETTINGS} from '../vlb-batch-alerts.mjs';

const ist=(date,time)=>Date.parse(`${date}T${time}+05:30`);
const shifts=[
 {site:'Sasti OC',shiftName:'Shift A',shiftCode:'I',startTime:'05:00:00',endTime:'13:00:00'},
 {site:'Sasti OC',shiftName:'Shift B',shiftCode:'II',startTime:'13:00:00',endTime:'21:00:00'},
 {site:'Sasti OC',shiftName:'Shift C',shiftCode:'III',startTime:'21:00:00',endTime:'05:00:00'},
 {site:'Sasti OC',shiftName:'Shift A',shiftCode:'I',startTime:'06:00:00',endTime:'14:00:00',effectiveFrom:'2026-12-10'},
 {site:'Jayant OC',shiftName:'Shift A',shiftCode:'I',startTime:'05:00:00',endTime:'13:00:00',status:'Inactive'},
];

test('shift deadlines follow the Shift Master, cross midnight and prefer the dated revision',()=>{
 assert.equal(shiftEndInstant(shifts[0],'2026-12-01'),ist('2026-12-01','13:00:00'));
 assert.equal(shiftEndInstant(shifts[2],'2026-12-01'),ist('2026-12-02','05:00:00'),'night shift ends the next day');
 const before=shiftsInForce(shifts,'2026-12-01'),after=shiftsInForce(shifts,'2026-12-15');
 assert.equal(before.find(s=>s.code==='S1').endTime,'13:00:00');assert.equal(after.find(s=>s.code==='S1').endTime,'14:00:00');
 assert.ok(!before.some(s=>s.canonicalSite==='jayant ob'),'inactive rows are ignored');
});

test('alerts come due two and six hours after shift end, only for missing or open batches',()=>{
 const settings=DEFAULT_ALERT_SETTINGS;
 const none=dueBatchAlerts({nowMs:ist('2026-12-01','14:59:00'),shifts,batches:[],settings});
 assert.deepEqual(none.map(a=>a.key),['sasti ob|2026-11-30|S1|not_created','sasti ob|2026-11-30|S2|not_created','sasti ob|2026-11-30|S3|not_created'],'yesterday\'s shifts are checked too, today\'s shift I is not yet due');
 const due=dueBatchAlerts({nowMs:ist('2026-12-01','15:00:00'),shifts,batches:[],settings});
 assert.ok(due.some(a=>a.key==='sasti ob|2026-12-01|S1|not_created'),'shift I created-by deadline at 15:00');
 const open={id:'b1',name:'CMLL/SASTI OC/1ST-DEC-26/S1/B01',site:'Sasti OC',report_date:'2026-12-01',shift:'S1',closed_at:null,stage:'elb_open',card_count:94,creator_login:'mis.sasti'};
 const withOpen=dueBatchAlerts({nowMs:ist('2026-12-01','18:59:00'),shifts,batches:[open],settings});
 assert.ok(!withOpen.some(a=>a.date==='2026-12-01'&&a.shift==='S1'),'an open batch before the closed-by deadline raises nothing');
 const late=dueBatchAlerts({nowMs:ist('2026-12-01','19:00:00'),shifts,batches:[open],settings}).find(a=>a.key==='sasti ob|2026-12-01|S1|not_closed');
 assert.ok(late);assert.equal(late.batch.cards,94);assert.equal(late.batch.stage,'elb_open');
 assert.match(alertMessage(late,{nowMs:ist('2026-12-01','19:00:00')}),/Sasti OC, 2026-12-01, shift I\. VLB batch CMLL\/SASTI OC\/1ST-DEC-26\/S1\/B01 is still open \(ELB open, 94 cards, owner mis\.sasti\) 6 h after shift end/);
 assert.match(alertMessage(late,{nowMs:ist('2026-12-01','21:00:00'),sequence:2}),/Reminder 2\.$/);
 const closed=dueBatchAlerts({nowMs:ist('2026-12-01','23:00:00'),shifts,batches:[{...open,closed_at:'2026-12-01T10:00:00Z'}],settings});
 assert.ok(!closed.some(a=>a.shift==='S1'&&a.date==='2026-12-01'));
 const deleted=dueBatchAlerts({nowMs:ist('2026-12-01','23:00:00'),shifts,batches:[{...open,deleted_at:'2026-12-01T10:00:00Z'}],settings});
 assert.ok(deleted.some(a=>a.key==='sasti ob|2026-12-01|S1|not_created'),'a deleted batch counts as missing');
 assert.deepEqual(dueBatchAlerts({nowMs:ist('2026-10-31','23:00:00'),shifts,batches:[],settings}),[],'nothing before the operational start');
});

test('settings normalize hours and logins',()=>{
 const s=normalizeAlertSettings({createdByHours:'3',closedByHours:999,reminderHours:1,productionHeadLogins:'Head.One, head.two ,head.one'});
 assert.deepEqual(s,{enabled:true,createdByHours:3,closedByHours:6,reminderHours:1,productionHeadLogins:['head.one','head.two'],pulseAdminLogins:[]});
});

test('the worker sends once per recipient, reminds after the interval, clears when the batch closes and reports missing links',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);
 CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE mis_vlb_batches(id TEXT PRIMARY KEY,name TEXT,site TEXT,book_date DATE,shift TEXT,closed_at TIMESTAMPTZ,archived_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,stage TEXT DEFAULT 'vlb_open',creator_login TEXT,created_by TEXT,amendment_by TEXT);
 CREATE TABLE mis_vlb_batch_entries(batch_id TEXT,logbook_id BIGINT);`);
 let id=0;for(const row of shifts)await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[++id,'Shift Master',JSON.stringify(row)]);
 await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[++id,'Users & employees',JSON.stringify({login:'mis.sasti',userType:'Mobile User',userGroup:'MIS User',site:'Sasti OC'})]);
 const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const sent=[];let linked=new Set(['pm.sasti','head.one']);
 const telegram={async send(to,message,eventKey){if(!linked.has(to))return false;sent.push({to,message,eventKey});return true;}};
 let nowMs=ist('2026-12-01','15:00:00');
 await db.query('INSERT INTO app_settings(setting_key,setting_value) VALUES($1,$2::jsonb)',['vlb_batch_alerts',JSON.stringify({productionHeadLogins:['head.one']})]);
 const worker=createVlbBatchAlertWorker({pool,telegram,pmLogins:async()=>['pm.sasti'],now:()=>nowMs,log:{error(){}}});
 // Shift I of today is not created at 15:00; yesterday's shifts are also missing.
 let result=await worker.runOnce();assert.equal(result.due,4);assert.equal(result.sent,4);
 const forToday=sent.filter(s=>s.eventKey==='vlb-alert:sasti ob|2026-12-01|S1|not_created:1');
 assert.deepEqual(forToday.map(s=>s.to).sort(),['head.one','pm.sasti']);assert.match(forToday[0].message,/No VLB batch has been created 2 h after shift end/);
 // The next minute sends nothing new.
 nowMs+=60000;result=await worker.runOnce();assert.equal(result.sent,0);assert.equal(sent.length,8);
 // After the reminder interval the same alert goes again as reminder 2.
 nowMs=ist('2026-12-01','17:00:00');result=await worker.runOnce();
 assert.ok(sent.some(s=>s.eventKey==='vlb-alert:sasti ob|2026-12-01|S1|not_created:2'&&/Reminder 2\./.test(s.message)));
 // Creating the batch clears the not_created alert; leaving it open past 19:00 raises not_closed.
 await db.query("INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,creator_login) VALUES('b1','CMLL/SASTI OC/1ST-DEC-26/S1/B01','Sasti OC','2026-12-01','S1','mis.sasti')");
 nowMs=ist('2026-12-01','17:30:00');result=await worker.runOnce();assert.equal(result.cleared,1);
 const state=(await db.query("SELECT cleared_at FROM mis_vlb_batch_alert_state WHERE alert_key='sasti ob|2026-12-01|S1|not_created'")).rows[0];assert.ok(state.cleared_at);
 nowMs=ist('2026-12-01','19:00:00');result=await worker.runOnce();
 const open=sent.find(s=>s.eventKey==='vlb-alert:sasti ob|2026-12-01|S1|not_closed:1');assert.ok(open);assert.match(open.message,/still open \(VLB open, 0 cards, owner mis\.sasti\) 6 h after shift end/);
 // Closing the batch clears it; nothing more is sent.
 await db.query("UPDATE mis_vlb_batches SET closed_at=NOW() WHERE id='b1'");
 nowMs=ist('2026-12-01','21:30:00');result=await worker.runOnce();assert.ok(!sent.some(s=>s.eventKey.startsWith('vlb-alert:sasti ob|2026-12-01|S1|not_closed:2')),'a closed batch gets no reminder');
 assert.ok((await db.query("SELECT cleared_at FROM mis_vlb_batch_alert_state WHERE alert_key='sasti ob|2026-12-01|S1|not_closed'")).rows[0].cleared_at);
 // No Telegram link anywhere: the state records why and nothing is counted as sent.
 linked=new Set();await db.exec("DELETE FROM mis_vlb_batch_alert_state");
 result=await worker.runOnce();assert.equal(result.sent,0);
 const unsent=(await db.query("SELECT last_error,sent_count FROM mis_vlb_batch_alert_state WHERE alert_key='sasti ob|2026-11-30|S2|not_created'")).rows[0];
 assert.equal(unsent.sent_count,0);assert.match(unsent.last_error,/No recipient has linked Telegram yet/);
 // Disabled settings stop the worker without touching state.
 await db.query("UPDATE app_settings SET setting_value='{\"enabled\":false}'::jsonb WHERE setting_key='vlb_batch_alerts'");
 assert.deepEqual(await worker.runOnce(),{disabled:true,sent:0,cleared:0});
});
