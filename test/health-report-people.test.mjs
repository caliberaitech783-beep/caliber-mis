import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {DELETION_PHONE} from '../server/rules/deletion-otp-routing.mjs';
import {normalizeHealthReportPeople,readHealthReportPeople,writeHealthReportPeople,healthReportLogins,healthReportPeopleCheck,HEALTH_REPORT_PEOPLE_KEY} from '../server/services/health-report-people.mjs';
import {registerAutomationCentre} from '../server/routes/automation-centre.mjs';

// Owner, 16 Nov 2026: a "PULSE USER" sheet of six people (name, user ID, mobile) to get the A25 speed report.
// Sample people only; real numbers live in the app settings, never in this public code.
const users=[
 {login:'ownerlogin',mobile:DELETION_PHONE},
 {login:'sample.one',mobile:'+91 90000 00001'},
 {login:'sample.two',phone:'9000000002'},
 {login:'sample.three',whatsapp:'919000000003'},
 {login:'gone',mobile:'9000000009',sourceMissing:true},
];
const fakePool=({linked=['ownerlogin','sample.one']}={})=>{
 const settings=new Map();
 return {settings,async query(sql,params=[]){
  if(/FROM master_records WHERE master_name='Users & employees'/.test(sql))return {rows:users.map(record_data=>({record_data}))};
  if(/FROM mis_telegram_links/.test(sql))return {rows:linked.map(login_name=>({login_name}))};
  if(/SELECT setting_value FROM app_settings/.test(sql))return {rows:settings.has(params[0])?[{setting_value:settings.get(params[0])}]:[]};
  if(/INSERT INTO app_settings/.test(sql)){settings.set(params[0],JSON.parse(params[1]));return {rows:[]};}
  throw new Error('unexpected '+sql);
 }};
};

test('the people list keeps each login or number once, in order, one per line or comma',()=>{
 assert.deepEqual(normalizeHealthReportPeople({people:' 9000000001\nSAMPLE.TWO, sample.two ;\n\n 9000000003 '}).people,['9000000001','SAMPLE.TWO','9000000003']);
 assert.deepEqual(normalizeHealthReportPeople({people:['a','A','b']}).people,['a','b']);
 assert.equal(normalizeHealthReportPeople({people:Array.from({length:40},(_,i)=>'p'+i)}).people.length,30);
 assert.deepEqual(normalizeHealthReportPeople({}).people,[]);
});

test('the speed report goes to the owner and to every saved person, found by login or mobile number',async()=>{
 const pool=fakePool();
 assert.deepEqual(await healthReportLogins(pool),['ownerlogin'],'with nobody saved it goes to the owner only, as before');
 await writeHealthReportPeople(pool,{people:'9000000001\n9000000002\nsample.extra\n9000000003\n9000000009\n9111111111'});
 assert.deepEqual(pool.settings.get(HEALTH_REPORT_PEOPLE_KEY).people.length,6);
 assert.deepEqual(await healthReportLogins(pool),['ownerlogin','sample.one','sample.two','sample.extra','sample.three']);
 const check=await healthReportPeopleCheck(pool);
 assert.deepEqual(check.owner,[{login:'ownerlogin',telegramLinked:true}]);
 const by=Object.fromEntries(check.people.map(p=>[p.entry,p]));
 assert.equal(by['9000000001'].telegramLinked,true);assert.match(by['9000000001'].note,/Pulse-II login sample\.one\. Telegram connected\./);
 assert.match(by['9000000002'].note,/Telegram not connected yet/);
 assert.match(by['9000000009'].note,/No Pulse-II user has this mobile number/,'a user missing from the source is not matched');
 assert.match(by['9111111111'].note,/No Pulse-II user has this mobile number/);
 assert.deepEqual((await readHealthReportPeople(pool)).people,['9000000001','9000000002','sample.extra','9000000003','9000000009','9111111111']);
});

test('only an administrator reads and changes the A25 people, and the MIS allow-list lets them through',async t=>{
 const pool=fakePool();
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.session={login:req.get('Authorization')};next();});
 registerAutomationCentre(app,{pool,centre:{overview:async()=>({rows:[]})},requireSession:(req,res,next)=>next(),
  requireAdministrator:(req,res,next)=>req.session.login==='admin'?next():res.sendStatus(403)});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const call=async(method,who='admin',body)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/automation-centre/health-report/people',
  {method,headers:{Authorization:who,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json().catch(()=>({}))};};
 assert.equal((await call('GET','operator')).status,403);
 assert.equal((await call('PUT','operator',{people:'9000000001'})).status,403);
 assert.equal(pool.settings.size,0);
 assert.equal((await call('PUT','admin',{people:5})).status,400);
 const saved=await call('PUT','admin',{people:'9000000001\nsample.extra'});
 assert.equal(saved.status,200);assert.deepEqual(saved.body.settings.people,['9000000001','sample.extra']);
 assert.equal(saved.body.check.people[0].logins[0],'sample.one');
 assert.deepEqual((await call('GET')).body.settings.people,['9000000001','sample.extra']);
});
