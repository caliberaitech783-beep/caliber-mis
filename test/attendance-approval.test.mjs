// Owner, 27 Nov 2026: trip card batches up to 20 Nov 2026 are approved day by day for every site, by
// Level 1 Site HR → Level 2 Office HR → Level 3 RHR → Level 4 Directors, and then locked. One Telegram message
// per site, day and approver with Approve / Send back, or the same from Masters › Attendance approval.
//   - a day starts at Site HR only when every batch of that date is closed;
//   - only the approvers of that level and site may act; RHR is per region, Directors for all sites;
//   - Send back (with a reason, on Telegram the next message) returns the day to the batch creators; a batch
//     reopened and closed again puts it back at Site HR;
//   - a locked day's batches cannot be reopened and its cards and Present entries cannot change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {APPROVAL_LEVELS,LOCKED_LEVEL,approvalUntil,approversFor,groupDays,reconcileDay,approveDay,sendBackDay,normalScope,parseCallback,approvalMessage} from '../shared/attendance-approval.mjs';
import {createAttendanceApproval} from '../server/routes/attendance-approval.mjs';
import {describeServerError} from '../server/middleware/server-error-response.mjs';
import {misRequestAllowed,misPageAllowed} from '../shared/mis-application-access.mjs';

const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const APPROVERS=[
 {level:1,scope:'Sasti OC',login:'sasti.hr'},{level:1,scope:'Majri OC',login:'majri.hr'},
 {level:2,scope:'*',login:'office.hr'},{level:3,scope:'WCL',login:'rhr.wcl'},{level:3,scope:'NCL',login:'rhr.ncl'},{level:4,scope:'*',login:'director.one'},
];

test('the window runs from 1 Nov to 20 Nov 2026 unless the setting moves it',()=>{
 assert.equal(approvalUntil({}),'2026-11-20');
 assert.equal(approvalUntil({ATTENDANCE_APPROVAL_UNTIL:'2026-11-25'}),'2026-11-25');
 assert.equal(approvalUntil({ATTENDANCE_APPROVAL_UNTIL:'soon'}),'2026-11-20');
 assert.deepEqual(APPROVAL_LEVELS.map(l=>l.label),['Site HR','Office HR','RHR','Directors']);
});

test('approvers: Site HR per site, RHR per region, Directors for all sites',()=>{
 assert.deepEqual(approversFor(APPROVERS,'Sasti OB',1),['sasti.hr']);
 assert.deepEqual(approversFor(APPROVERS,'Sasti OC',3),['rhr.wcl']);
 assert.deepEqual(approversFor(APPROVERS,'Jayant OC',3),['rhr.ncl']);
 assert.deepEqual(approversFor(APPROVERS,'Jayant OC',1),[]);
 assert.deepEqual(approversFor(APPROVERS,'Dudhichua OC',4),['director.one']);
 assert.equal(normalScope('wcl'),'WCL');assert.equal(normalScope('*'),'*');assert.equal(normalScope('nowhere'),'');
});

test('a day is one site and date, ready only when every batch is closed',()=>{
 const days=groupDays([
  {id:'a',site:'Sasti OC',reportDate:'2026-11-18',shift:'Shift I',closedAt:'2026-11-19T01:00:00Z',createdBy:'maker1'},
  {id:'b',site:'SASTI OB',reportDate:'2026-11-18',shift:'Shift II',closedAt:'2026-11-19T02:00:00Z',createdBy:'maker2'},
  {id:'c',site:'Sasti OC',reportDate:'2026-11-19',shift:'Shift I',closedAt:null,createdBy:'maker1'},
 ]);
 assert.equal(days.length,2);
 assert.equal(days[0].batches.length,2);assert.equal(days[0].ready,true);assert.deepEqual(days[0].creators,['maker1','maker2']);
 assert.equal(days[1].ready,false);
});

test('the levels in order, a send back and a corrected day',()=>{
 const at='2026-11-27T10:00:00Z';
 const day={ready:true,signature:'a:0:x'};
 let state=reconcileDay(null,day,{at}).state;
 assert.equal(state.level,1);
 for(let level=1;level<=3;level++){state=approveDay(state,{login:'p'+level,at});assert.equal(state.level,level+1);}
 const back=sendBackDay(state,{login:'director.one',at,reason:'Night duty of 3 drivers missing'});
 assert.equal(back.status,'sent_back');assert.equal(back.level,1);
 assert.throws(()=>approveDay(back,{login:'x',at}),/sent back/);
 assert.throws(()=>sendBackDay(state,{login:'x',at,reason:'no'}),/Write why/);
 assert.equal(reconcileDay(back,day,{at}).changed,false,'unchanged batches: still sent back');
 const fixed=reconcileDay(back,{ready:true,signature:'a:1:y'},{at}).state;
 assert.equal(fixed.status,'waiting');assert.equal(fixed.level,1);assert.equal(fixed.corrected,true);
 const locked=approveDay(state,{login:'director.one',at});
 assert.equal(locked.level,LOCKED_LEVEL);assert.equal(locked.status,'locked');
 assert.equal(reconcileDay(locked,{ready:false,signature:'z'},{at}).changed,false,'a locked day never moves');
 assert.deepEqual(parseCallback('att:0123456789abcdef:a'),{id:'0123456789abcdef',action:'approve'});
 assert.equal(parseCallback('emd:0123456789abcdef:a'),null);
 assert.match(approvalMessage({site:'Sasti OC',region:'WCL',date:'2026-11-18',level:3,batches:[{shift:'Shift I'}]}),/LEVEL 3 · RHR.*\(WCL\)[\s\S]*18-11-2026/);
});

const fixture=async()=>{
 const db=new PGlite();
 await db.exec(`
  CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE mis_telegram_links(login_name TEXT,chat_id TEXT);
  CREATE TABLE mis_vlb_batches(id TEXT PRIMARY KEY,site TEXT,book_date DATE,shift TEXT,closed_at TIMESTAMPTZ,closure_revision INT DEFAULT 0,
   creator_login TEXT,created_by TEXT,amendment_by TEXT,deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ);
  CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_type TEXT,book_date DATE,site TEXT,asset_id BIGINT,data JSONB,deleted_at TIMESTAMPTZ,card_key TEXT);
  CREATE TABLE mis_shift_attendance(book_date DATE,site TEXT,shift TEXT,employee_id BIGINT,reason TEXT);`);
 const logins=['sasti.hr','majri.hr','office.hr','rhr.wcl','rhr.ncl','director.one','maker1'];
 for(const login of logins){
  await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Users & employees',$1)",[JSON.stringify({login,name:login.toUpperCase()})]);
  await db.query('INSERT INTO mis_telegram_links(login_name,chat_id) VALUES($1,$2)',[login,'chat-'+login]);
 }
 for(const [id,shift] of [['b1','Shift I'],['b2','Shift II'],['b3','Shift III']])
  await db.query("INSERT INTO mis_vlb_batches(id,site,book_date,shift,closed_at,creator_login) VALUES($1,'Sasti OC','2026-11-18',$2,'2026-11-19T00:00:00Z','maker1')",[id,shift]);
 await db.query("INSERT INTO mis_vlb_batches(id,site,book_date,shift,closed_at,creator_login) VALUES('b4','Sasti OC','2026-11-19','Shift I',NULL,'maker1')");
 await db.query("INSERT INTO mis_vlb_batches(id,site,book_date,shift,closed_at,creator_login) VALUES('b5','Sasti OC','2026-11-21','Shift I','2026-11-22T00:00:00Z','maker1')");
 await db.query(`INSERT INTO mis_log_books(book_type,book_date,site,asset_id,data) VALUES('vehicle','2026-11-18','Sasti OC',1,'{"employeeRecordId":"11"}'),('equipment','2026-11-18','sasti ob',2,'{"employeeRecordId":"12"}')`);
 await db.query("INSERT INTO mis_shift_attendance VALUES('2026-11-18','Sasti OC','Shift A',13,'VTC Training')");
 // node-postgres runs a parameterless text of several statements at once (the schema); PGlite's query does not.
 const query=(sql,params)=>/pg_(try_)?advisory/.test(sql)?Promise.resolve({rows:[{ok:true}]}):!params?.length?db.exec(sql).then(results=>results.at(-1)||{rows:[]}):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 const sent=[],texts=[];
 const otps=[],clock={now:Date.parse('2026-11-27T06:00:00Z')};
 const approval=createAttendanceApproval({pool,env:{},now:()=>clock.now,log:()=>{},
  sendButtons:async(chatId,text,buttons)=>{sent.push({chatId,text,buttons});return true;},
  sendText:async(chatId,text,options)=>{texts.push({chatId,text,options});return true;},
  deliverOtp:async request=>{otps.push(request);return {sentTo:request.logins,channels:['telegram'],failures:[]};}});
 await approval.ensure();
 for(const a of APPROVERS)await db.query('INSERT INTO mis_attendance_approvers(level,scope,login) VALUES($1,$2,$3)',[a.level,a.scope,a.login]);
 return {db,approval,sent,texts,otps,clock};
};
const tap=async(f,chat,action='a')=>{
 const message=[...f.sent].reverse().find(m=>m.chatId===chat);
 assert.ok(message,'a message to '+chat);
 const data=message.buttons[0][action==='a'?0:1].callback_data;
 return f.approval.handleTelegramCallback({data,logins:[chat.replace('chat-','')],chatId:chat});
};

test('one Telegram message per day climbs Site HR, Office HR, RHR, Directors and locks the day',async()=>{
 const f=await fixture();
 const run=await f.approval.reconcile();
 assert.equal(run.days,2,'21 Nov is outside the window');
 await f.approval.notifyDue();
 assert.deepEqual(f.sent.map(m=>m.chatId),['chat-sasti.hr'],'only the closed day, only to Site HR of Sasti OC');
 assert.match(f.sent[0].text,/Sasti OC<\/b> · 18-11-2026/);assert.match(f.sent[0].text,/Batches: 3/);assert.match(f.sent[0].text,/VTC Training 1/);
 await f.approval.notifyDue();assert.equal(f.sent.length,1,'never sent twice');

 assert.match((await f.approval.handleTelegramCallback({data:f.sent[0].buttons[0][0].callback_data,logins:['majri.hr'],chatId:'chat-majri.hr'})).answer,/another login/);
 await assert.rejects(f.approval.act({site:'Sasti OC',date:'2026-11-18',action:'approve',login:'office.hr',source:'MIS'}),/Only Site HR of Sasti OC/);

 assert.match((await tap(f,'chat-sasti.hr')).answer,/Sent to Office HR/);
 assert.match((await tap(f,'chat-sasti.hr')).answer,/moved on/,'the old button is spent');
 assert.equal(f.sent.at(-1).chatId,'chat-office.hr');
 await tap(f,'chat-office.hr');
 assert.equal(f.sent.at(-1).chatId,'chat-rhr.wcl','RHR of the region, not of NCL');
 assert.match(f.sent.at(-1).text,/Site HR: SASTI\.HR/);
 await f.approval.act({site:'Sasti OC',date:'2026-11-18',action:'approve',login:'rhr.wcl',name:'RHR WCL',source:'MIS'});
 assert.match((await tap(f,'chat-director.one')).answer,/locked/);
 const day=(await f.db.query("SELECT level,status FROM mis_attendance_days WHERE book_date='2026-11-18'")).rows[0];
 assert.deepEqual(day,{level:LOCKED_LEVEL,status:'locked'});
 assert.ok(f.texts.some(t=>t.chatId==='chat-maker1'&&/locked/.test(t.text)),'the batch creator is told');

 // The lock: cards (every spelling of the site), Present entries and the batches of that day.
 const locked=async(sql,params)=>{const error=await f.db.query(sql,params).then(()=>null,e=>e);assert.ok(error,'refused: '+sql);assert.equal(error.code,'CA423');assert.equal(describeServerError(error).status,423);};
 await locked(`UPDATE mis_log_books SET data='{"employeeRecordId":"99"}' WHERE site='Sasti OC'`);
 await locked("DELETE FROM mis_log_books WHERE site='sasti ob'");
 await locked(`INSERT INTO mis_log_books(book_type,book_date,site,asset_id,data) VALUES('vehicle','2026-11-18','Sasti OC',3,'{}')`);
 await locked("UPDATE mis_vlb_batches SET closed_at=NULL WHERE id='b1'");
 await locked("INSERT INTO mis_shift_attendance VALUES('2026-11-18','Sasti OC','Shift I',14,'Present')");
 await f.db.query("UPDATE mis_log_books SET card_key='k' WHERE site='Sasti OC'");
 await f.db.query(`UPDATE mis_log_books SET data='{}' WHERE book_date='2026-11-19'`);
 await f.db.query("UPDATE mis_vlb_batches SET closed_at=NULL WHERE id='b5'");
 // Days that are not locked keep working: Present entries and cards are saved, changed and deleted as before.
 await f.db.query("INSERT INTO mis_shift_attendance VALUES('2026-11-19','Sasti OC','Shift I',14,'Present')");
 await f.db.query("UPDATE mis_shift_attendance SET reason='No work' WHERE book_date='2026-11-19'");
 await f.db.query("DELETE FROM mis_shift_attendance WHERE book_date='2026-11-19'");
 await f.db.query(`INSERT INTO mis_log_books(book_type,book_date,site,asset_id,data) VALUES('vehicle','2026-11-19','Sasti OC',3,'{}')`);
 await f.db.query("DELETE FROM mis_log_books WHERE book_date='2026-11-19'");
});

test('Send back takes the reason from the next Telegram message; a reopened and closed batch starts again at Site HR',async()=>{
 const f=await fixture();
 await f.approval.reconcile();await f.approval.notifyDue();
 await tap(f,'chat-sasti.hr');
 assert.match((await tap(f,'chat-office.hr','b')).answer,/reason/);
 assert.equal(f.texts.at(-1).chatId,'chat-office.hr');assert.deepEqual(f.texts.at(-1).options,{reply_markup:{force_reply:true}});
 assert.equal(await f.approval.handleTelegramText({chatId:'chat-rhr.wcl',text:'hello',logins:['rhr.wcl']}),null,'other chats are not ours');
 assert.match((await f.approval.handleTelegramText({chatId:'chat-office.hr',text:'no',logins:['office.hr']})).reply,/Write why/);
 await tap(f,'chat-office.hr','b');
 assert.match((await f.approval.handleTelegramText({chatId:'chat-office.hr',text:'Night duty of 3 drivers missing',logins:['office.hr']})).reply,/sent back/);
 let day=(await f.db.query("SELECT level,status,sent_back FROM mis_attendance_days WHERE book_date='2026-11-18'")).rows[0];
 assert.equal(day.status,'sent_back');assert.equal(day.sent_back.reason,'Night duty of 3 drivers missing');
 assert.ok(f.texts.some(t=>t.chatId==='chat-maker1'&&/sent back/.test(t.text)&&/Night duty/.test(t.text)));

 // The creator reopens a batch: not ready. Closes it again: back at Site HR, who gets a new message.
 await f.db.query("UPDATE mis_vlb_batches SET closed_at=NULL WHERE id='b3'");
 await f.approval.reconcile();
 assert.equal((await f.db.query("SELECT status FROM mis_attendance_days WHERE book_date='2026-11-18'")).rows[0].status,'not_ready');
 await f.db.query("UPDATE mis_vlb_batches SET closed_at='2026-11-27T05:00:00Z',closure_revision=1 WHERE id='b3'");
 await f.approval.reconcile();
 day=(await f.db.query("SELECT level,status,corrected FROM mis_attendance_days WHERE book_date='2026-11-18'")).rows[0];
 assert.deepEqual(day,{level:1,status:'waiting',corrected:true});
 const before=f.sent.length;await f.approval.notifyDue();
 assert.equal(f.sent.length,before+1);assert.equal(f.sent.at(-1).chatId,'chat-sasti.hr');assert.match(f.sent.at(-1).text,/Corrected/);

 // A batch reopened while the day waits at a higher level also sends it back to Site HR.
 await tap(f,'chat-sasti.hr');
 await f.db.query("UPDATE mis_vlb_batches SET closure_revision=2,closed_at='2026-11-27T05:30:00Z' WHERE id='b2'");
 await f.approval.reconcile();
 assert.equal((await f.db.query("SELECT level FROM mis_attendance_days WHERE book_date='2026-11-18'")).rows[0].level,1);
});

test('the screen lists only the sites of the login; an administrator sees all and sets the approvers',async()=>{
 const f=await fixture();
 await f.approval.reconcile();
 assert.equal((await f.approval.overview({login:'majri.hr'})).days.length,0);
 const mine=await f.approval.overview({login:'sasti.hr'});
 assert.equal(mine.days.length,2);assert.equal(mine.days.find(d=>d.date==='2026-11-18').mine,true);
 assert.equal(mine.days.find(d=>d.date==='2026-11-19').status,'not_ready');
 assert.equal((await f.approval.overview({login:'nobody',admin:true})).days.length,2);
 await assert.rejects(f.approval.saveApprovers({list:[{level:1,scope:'Mars OC',login:'sasti.hr'}],login:'admin'}),/not a site/);
 await assert.rejects(f.approval.saveApprovers({list:[{level:1,scope:'Sasti OC',login:'ghost'}],login:'admin'}),/No MIS login/);
 const saved=await f.approval.saveApprovers({list:[{level:1,scope:'sasti oc',login:'Maker1'}],login:'admin'});
 assert.deepEqual(saved,[{level:1,scope:'Sasti OC',login:'maker1'}]);
 const detail=await f.approval.dayDetail({site:'Sasti OC',date:'2026-11-18'});
 assert.deepEqual({vlb:detail.summary.vlb,elb:detail.summary.elb,people:detail.summary.people,training:detail.summary.training},{vlb:1,elb:1,people:3,training:1});
});

test('every MIS login may reach the page and its routes; it is wired into the server and the Masters menu',()=>{
 const session={permissions:{separateMisCredentials:true,misDesktopAccess:[]}};
 assert.equal(misPageAllowed(session,'Attendance approval','desktop'),true);
 assert.equal(misRequestAllowed(session,{path:'/api/attendance-approval',method:'GET'}),true);
 assert.equal(misRequestAllowed(session,{path:'/api/attendance-approval/act',method:'POST'}),true);
 assert.equal(misRequestAllowed(session,{path:'/api/attendance-approval/approvers',method:'PUT'}),true);
 assert.equal(misRequestAllowed(session,{path:'/api/attendance-approval/act',method:'GET'}),false);
 const server=source('server.mjs'),main=source('src/main.jsx');
 assert.match(server,/attendanceApproval\.handleTelegramCallback\(input\)/);
 assert.match(server,/telegramCallbacks\.text=input=>attendanceApproval\.handleTelegramText\(input\)/);
 assert.match(main,/'Machine Roster','Attendance approval'/);
 assert.match(source('server/routes/mis-telegram.mjs'),/onText\(\{chatId,text/);
});

// Owner, 27 Nov 2026: "add an rhr unlock button with reason and it should be with otp; if any user needs to reopen the
// batch he needs to send request for otp to rhr to open it with otp request".
test('a locked day is reopened only with an OTP from the RHR of its region, then climbs the four levels again',async()=>{
 const f=await fixture();
 await f.approval.reconcile();await f.approval.notifyDue();
 for(const chat of ['chat-sasti.hr','chat-office.hr','chat-rhr.wcl','chat-director.one'])await tap(f,chat);
 assert.equal((await f.approval.lockStatus({site:'Sasti OB',date:'2026-11-18'})).locked,true);

 await assert.rejects(f.approval.requestUnlock({site:'Sasti OC',date:'2026-11-19',reason:'Wrong driver on a card',login:'maker1'}),/not locked/);
 await assert.rejects(f.approval.requestUnlock({site:'Sasti OC',date:'2026-11-18',reason:'fix',login:'maker1'}),/at least 10/);
 const request=await f.approval.requestUnlock({site:'Sasti OC',date:'2026-11-18',reason:'Shift III card of DT-112 has the wrong driver',login:'maker1',name:'Maker One'});
 assert.deepEqual(f.otps.at(-1).logins,['rhr.wcl'],'only the RHR of WCL gets the OTP');
 assert.match(f.otps.at(-1).message,/Maker One asks to unlock Sasti OC · 18-11-2026 \(WCL\)[\s\S]*wrong driver[\s\S]*OTP \d{6}/);
 assert.equal(f.otps.at(-1).eventKey,'attendance-unlock-otp:'+request.id);
 await assert.rejects(f.approval.requestUnlock({site:'Sasti OC',date:'2026-11-18',reason:'Shift III card of DT-112 has the wrong driver',login:'maker1'}),/less than a minute/);
 const status=await f.approval.lockStatus({site:'Sasti OC',date:'2026-11-18'});
 assert.equal(status.request.id,request.id);assert.deepEqual(status.rhr,['rhr.wcl']);

 await assert.rejects(f.approval.verifyUnlock({id:request.id,otp:f.otps.at(-1).otp,login:'majri.hr'}),/Only the person who asked, or the RHR/);
 await assert.rejects(f.approval.verifyUnlock({id:request.id,otp:'000000',login:'maker1'}),/Wrong OTP. 4 attempts left/);
 await assert.rejects(f.db.query("UPDATE mis_vlb_batches SET closed_at=NULL WHERE id='b3'"),e=>e.code==='CA423','still locked before the right OTP');
 const unlocked=await f.approval.verifyUnlock({id:request.id,otp:f.otps.at(-1).otp,login:'maker1'});
 assert.equal(unlocked.status,'unlocked');
 await assert.rejects(f.approval.verifyUnlock({id:request.id,otp:f.otps.at(-1).otp,login:'maker1'}),/already used/);
 assert.ok(f.texts.some(t=>t.chatId==='chat-sasti.hr'&&/unlocked<\/b> with the OTP of RHR/.test(t.text)),'Site HR is told');
 assert.equal((await f.approval.lockStatus({site:'Sasti OC',date:'2026-11-18'})).locked,false);
 await assert.rejects(f.approval.act({site:'Sasti OC',date:'2026-11-18',action:'approve',login:'sasti.hr'}),/unlocked by RHR/);

 // The batch is reopened, the card corrected, the batch closed: the day is back at Site HR, marked corrected.
 await f.db.query("UPDATE mis_vlb_batches SET closed_at=NULL WHERE id='b3'");
 await f.db.query(`UPDATE mis_log_books SET data='{"employeeRecordId":"21"}' WHERE site='Sasti OC'`);
 await f.approval.reconcile();
 await f.db.query("UPDATE mis_vlb_batches SET closed_at='2026-11-27T07:00:00Z',closure_revision=1 WHERE id='b3'");
 await f.approval.reconcile();
 const day=(await f.db.query("SELECT level,status,corrected,trail FROM mis_attendance_days WHERE book_date='2026-11-18'")).rows[0];
 assert.deepEqual({level:day.level,status:day.status,corrected:day.corrected},{level:1,status:'waiting',corrected:true});
 assert.ok(day.trail.some(t=>t.action==='unlocked'&&t.reason.includes('DT-112')&&t.approvedBy.includes('rhr.wcl')));
 const before=f.sent.length;await f.approval.notifyDue();
 assert.equal(f.sent.length,before+1);assert.equal(f.sent.at(-1).chatId,'chat-sasti.hr');
});

test('the OTP request and unlock are reachable for every MIS login, and the reopen window shows the RHR OTP panel',()=>{
 const session={permissions:{separateMisCredentials:true,misDesktopAccess:[]}};
 assert.equal(misRequestAllowed(session,{path:'/api/attendance-approval/lock',method:'GET'}),true);
 assert.equal(misRequestAllowed(session,{path:'/api/attendance-approval/unlock',method:'POST'}),true);
 assert.equal(misRequestAllowed(session,{path:'/api/attendance-approval/unlock/verify',method:'POST'}),true);
 const dialog=source('src/vlb-reopen-dialog.jsx');
 assert.match(dialog,/<AttendanceUnlock session=\{session\} site=\{batch\.site\} date=\{batch\.report_date\}/);
 assert.match(dialog,/batch\.canReopen&&!dayLocked&&/,'Reopen batch waits for the unlock');
 assert.match(source('src/attendance-unlock.jsx'),/Send OTP request to RHR/);
 assert.match(source('server.mjs'),/deliverOtp:request=>approvalOtpDelivery\.send\(request\)/);
});

// Owner, 27 Nov 2026: "send me the test message in telegram" → a "Send sample to my Telegram" button.
test('Send sample to my Telegram: only to the login\'s own chat, marked SAMPLE, buttons change nothing',async()=>{
 const f=await fixture();
 await assert.rejects(f.approval.sendSample({login:'nobody'}),/has not connected Telegram/);
 const result=await f.approval.sendSample({login:'Office.HR'});
 assert.deepEqual(result,{sent:1,site:'Sasti OC',date:'2026-11-18',realDay:true},'a real closed day is used');
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].chatId,'chat-office.hr');
 assert.match(f.sent[0].text,/^🧪 <b>SAMPLE<\/b>[\s\S]*LEVEL 1 · SITE HR[\s\S]*Sasti OC<\/b> · 18-11-2026[\s\S]*Batches: 3/);
 assert.deepEqual(f.sent[0].buttons[0].map(b=>b.callback_data),['atts:a','atts:b']);
 assert.equal(f.texts.at(-1).chatId,'chat-office.hr');assert.match(f.texts.at(-1).text,/SAMPLE[\s\S]*ATTENDANCE UNLOCK[\s\S]*OTP 123456/);
 assert.match((await f.approval.handleTelegramCallback({data:'atts:a',logins:['office.hr'],chatId:'chat-office.hr'})).answer,/Sample only: nothing was approved/);
 assert.match((await f.approval.handleTelegramCallback({data:'atts:b',logins:['office.hr'],chatId:'chat-office.hr'})).answer,/Sample only: nothing was sent back/);
 await assert.rejects(f.approval.sendSample({login:'office.hr'}),/less than 30 seconds/);
 f.clock.now+=31000;await f.approval.sendSample({login:'office.hr'});assert.equal(f.sent.length,2);
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM mis_attendance_days')).rows[0].n,0,'a sample saves no approval');
 assert.equal(misRequestAllowed({permissions:{separateMisCredentials:true,misDesktopAccess:[]}},{path:'/api/attendance-approval/sample',method:'POST'}),true);
 assert.match(source('src/attendance-approval.jsx'),/Send sample to my Telegram/);
});
