import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {MIS_TELEGRAM_SCHEMA} from '../server/routes/mis-telegram.mjs';
import {registerReleaseNotice,releaseNoticePayload,releaseNoticeMessage,RELEASE_NOTICE_PURPOSE} from '../server/routes/release-notice.mjs';
import {integrationSignature} from '../server/services/integration-secret-store.mjs';
import {readFile} from 'node:fs/promises';
import {offScheduleNoticeNeeded} from '../scripts/release-notice-rule.mjs';

const commit='a'.repeat(40);
test('an off-schedule release tells the linked release-alert people once, and only a signed notice is accepted',async t=>{
 const db=new PGlite();await db.exec(MIS_TELEGRAM_SCHEMA);
 await db.exec("CREATE TABLE master_records(id SERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)");
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Users & employees',$1),('Users & employees',$2),('Users & employees',$3)",[
  {login:'Owner',mobile:'+91 90000 00001'},{login:'manager',whatsapp:'9000000002'},{login:'unlinked',mobile:'9000000003'}]);
 await db.query("INSERT INTO mis_telegram_links(login_name,chat_id) VALUES('owner','101'),('manager','102')");
 const pool={query:(...args)=>db.query(...args)};
 const key=randomBytes(32);let drained=0;const now=new Date('2026-11-14T17:40:00Z');
 const app=express();app.use(express.json());
 registerReleaseNotice(app,{pool,sign:data=>integrationSignature(key,RELEASE_NOTICE_PURPOSE,data),drain:()=>{drained++},now:()=>now});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.close()});
 const send=async(notice,signingKey=key)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/release-notice`,{method:'POST',headers:{'Content-Type':'application/json','X-Release-Signature':integrationSignature(signingKey,RELEASE_NOTICE_PURPOSE,releaseNoticePayload(notice))},body:JSON.stringify(notice)});return {status:response.status,body:await response.json()}};
 const notice={commit,subject:'Fix VLB lock',trigger:'workflow_dispatch',actor:'owner',runUrl:'https://github.com/x/y/actions/runs/1',sentAt:now.toISOString(),mobiles:['9000000001','+91-9000000002','9000000003','9999999999']};

 await t.test('a notice signed with another key or changed after signing is refused',async()=>{
  assert.equal((await send(notice,randomBytes(32))).status,403);
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/release-notice`,{method:'POST',headers:{'Content-Type':'application/json','X-Release-Signature':integrationSignature(key,RELEASE_NOTICE_PURPOSE,releaseNoticePayload(notice))},body:JSON.stringify({...notice,mobiles:['9111111111']})});
  assert.equal(response.status,403);
  assert.equal((await send({...notice,sentAt:'2026-11-14T16:00:00Z'})).status,403);
  assert.equal((await db.query('SELECT * FROM mis_telegram_outbox')).rows.length,0);
 });
 await t.test('a scheduled release sends nothing',async()=>{
  const result=await send({...notice,trigger:'schedule'});assert.equal(result.status,200);assert.equal(result.body.told,0);
  assert.equal((await db.query('SELECT * FROM mis_telegram_outbox')).rows.length,0);
 });
 await t.test('linked people get the message; the answer counts, never names a number',async()=>{
  const result=await send(notice);assert.equal(result.status,200);
  assert.deepEqual(result.body,{told:2,noLogin:1,noTelegram:1});
  assert.ok(!JSON.stringify(result.body).includes('900000'));
  const {rows}=await db.query('SELECT chat_id,message FROM mis_telegram_outbox ORDER BY chat_id');
  assert.deepEqual(rows.map(row=>row.chat_id),['101','102']);
  assert.match(rows[0].message,/OUTSIDE the release schedule/);assert.match(rows[0].message,/14 Nov 2026, 23:10 IST/);assert.match(rows[0].message,/aaaaaaa - Fix VLB lock/);
  assert.ok(drained>=1);
 });
 await t.test('the same release is told only once',async()=>{
  await send(notice);assert.equal((await db.query('SELECT * FROM mis_telegram_outbox')).rows.length,2);
 });
});

test('the release workflow sends the notice only for a release outside the schedule, without failing it',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/main_caliber-mis-783.yml',import.meta.url),'utf8');
 const step=workflow.slice(workflow.indexOf('- name: Tell the release-alert people'));
 assert.match(step,/if: always\(\) && steps\.live-health\.outcome == 'success' && github\.event_name != 'schedule' && needs\.plan\.outputs\.approval != 'window' && needs\.plan\.outputs\.approval != 'telegram'/);
 assert.match(step,/RELEASE_APPROVAL_KIND: \$\{\{ needs\.plan\.outputs\.approval \}\}/);
 const login=workflow.slice(workflow.indexOf('- name: Refresh Azure sign-in for the off-schedule notice'));
 assert.match(login,/if: [^\n]*needs\.plan\.outputs\.approval != 'telegram'/);
 assert.match(workflow,/approval: \$\{\{ steps\.window\.outputs\.approval \}\}/);
 assert.match(step,/continue-on-error: true/);
 assert.match(step,/RELEASE_ALERT_MOBILES: \$\{\{ secrets\.RELEASE_ALERT_MOBILES \}\}/);
 assert.match(workflow,/name: Verify Pulse-II release health\r?\n\s+id: live-health/);
 assert.ok(!/\b\d{10}\b/.test(workflow),'no phone number in the public workflow');
});

test('the notice message names the schedule and the commit',()=>{
 const text=releaseNoticeMessage({commit,subject:'',actor:'',runUrl:'',liveAt:new Date('2026-11-15T03:00:00Z')});
 assert.match(text,/06:00, 09:00, 12:00, 15:00, 18:00, 21:00 and 00:00 IST/);assert.match(text,/Started by: unknown/);
});

test('no notice for a window release or an Approve tap on Telegram; an OTP or unknown release still tells',()=>{
 assert.equal(offScheduleNoticeNeeded({trigger:'schedule'}),false);
 assert.equal(offScheduleNoticeNeeded({trigger:'workflow_dispatch',when:'Scheduled window now (backup trigger: releases only in the hour after a window)'}),false);
 assert.equal(offScheduleNoticeNeeded({trigger:'workflow_dispatch',approval:'window'}),false);
 // 15 Nov 2026: PR 320 and PR 321, both approved on Telegram, alerted Anoop and Mohit as "OUTSIDE the schedule".
 assert.equal(offScheduleNoticeNeeded({trigger:'workflow_dispatch',when:'Urgent: deploy now (needs OTP from the owner)',approval:'telegram'}),false);
 assert.equal(offScheduleNoticeNeeded({trigger:'workflow_dispatch',when:'Urgent: deploy now (needs OTP from the owner)',approval:'otp'}),true);
 assert.equal(offScheduleNoticeNeeded({trigger:'workflow_dispatch',approval:'owner'}),true);
 assert.equal(offScheduleNoticeNeeded({trigger:'workflow_dispatch'}),true);
});
