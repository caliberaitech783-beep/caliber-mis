import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {reportWindow,dueWindow,verdict,healthReportMessage,liveFigures,createHealthReporter,isLiveSlot} from '../server/services/health-report.mjs';
import {automationForEventKey} from '../server/services/automation-switches.mjs';
import {AUTOMATIONS} from '../server/rules/automation-catalogue.mjs';
import {registerAutomationCentre} from '../server/routes/automation-centre.mjs';

// Owner, 16 Nov 2026: a Telegram speed report at 10:00, 16:00 and 21:00 IST.
const ist=text=>Date.parse(text+'+05:30');

test('the three report times each cover the time since the previous one',()=>{
 const morning=reportWindow(ist('2026-11-16T10:05:00'));
 assert.equal(morning.key,'2026-11-16 10:00 IST');
 assert.equal(morning.at,ist('2026-11-16T10:00:00'));
 assert.equal(morning.from,ist('2026-11-15T21:00:00'),'10:00 covers the night from 21:00');
 assert.equal(reportWindow(ist('2026-11-16T16:00:00')).from,ist('2026-11-16T10:00:00'));
 assert.equal(reportWindow(ist('2026-11-16T21:29:00')).from,ist('2026-11-16T16:00:00'));
 const early=reportWindow(ist('2026-11-17T03:00:00'));
 assert.equal(early.key,'2026-11-16 21:00 IST','after midnight the last report is still 21:00 of the day before');
 assert.equal(early.from,ist('2026-11-16T16:00:00'));
 assert.equal(dueWindow(ist('2026-11-16T10:00:00'))?.key,'2026-11-16 10:00 IST');
 assert.equal(dueWindow(ist('2026-11-16T10:29:59'))?.key,'2026-11-16 10:00 IST');
 assert.equal(dueWindow(ist('2026-11-16T10:30:00')),null,'a server started late does not send an old report');
 assert.equal(dueWindow(ist('2026-11-16T09:59:00')),null);
 assert.equal(dueWindow(ist('2026-11-16T22:00:00')),null);
});

const calm={batches:{closed:0,averageMs:null,longest:null},reading:{cards:0,notRead:0},
 saving:{reads:40,averageMs:150,slowestMs:350,duplicate:{avgMs:3,maxMs:7},largest:{name:'card-check',avgMs:73,maxMs:238}},
 server:{measuredFrom:0,freezes:0,longestFreezeMs:0,mostWaiting:0,free:10,waitingNow:0},
 queue:{slots:4,active:0,waiting:0},engines:{live:8,reading:0,blocked:0},pulseCopy:{fresh:true,ageSeconds:14}};

test('the verdict is green, amber or red with the reasons of the worst level',()=>{
 assert.deepEqual(verdict(calm),{level:0,good:true,label:'SPEED GOOD',icon:'🟢',reasons:[]});
 const amber=verdict({...calm,saving:{...calm.saving,averageMs:1200}});
 assert.deepEqual([amber.good,amber.label,amber.icon],[false,'SPEED SLOW','🔴'],'two states only: any crossed limit is SLOW');
 assert.deepEqual(amber.reasons,['card save 1.2 s on average']);
 const red=verdict({...calm,saving:{...calm.saving,averageMs:1200},server:{...calm.server,mostWaiting:7},engines:{live:8,reading:0,blocked:1,blockedReason:'credit'}});
 assert.equal(red.label,'SPEED SLOW');
 assert.deepEqual(red.reasons,['7 requests waited for the database','card reading held: credit','card save 1.2 s on average'],'the worst reasons first');
 assert.equal(verdict({...calm,reading:{cards:10,notRead:9}}).level,0,'too few cards to judge the not-read share');
});

test('the message has the verdict, batches closed, the longest batch with its usernames, and the figures',()=>{
 const window={from:ist('2026-11-15T21:00:00'),at:ist('2026-11-16T10:00:00'),key:'2026-11-16 10:00 IST'};
 const figures={...calm,
  batches:{closed:12,averageMs:3*3600000+10*60000,longest:{name:'CMLL/GAURI PAUNI OC (2ND)/9TH -NOV-26/S1/B01',site:'Gauri Pauni OC (2nd)',
   startedBy:'TeklalMahto',lockedBy:'rakesh<b>',totalMs:7*3600000+45*60000,vlbMs:5*3600000,lmvMs:3600000,elbMs:45*60000}},
  reading:{cards:640,notRead:4,readAverageMs:6100,readSlowestMs:42000,queueAverageMs:12000,queueSlowestMs:180000}};
 const text=healthReportMessage({window,figures});
 assert.match(text,/^🟢🟢 <b>SPEED GOOD<\/b> 🟢🟢\n/,'the punch line comes first, bold');
 assert.match(text,/\n<b>PULSE-II SPEED REPORT<\/b>\n🕙 15 Nov 21:00 → 16 Nov 10:00 IST · 13 h/);
 const slow=healthReportMessage({window,figures:{...figures,server:{...calm.server,mostWaiting:7}}});
 assert.match(slow,/^🔴🔴 <b>SPEED SLOW<\/b> 🔴🔴\n• 7 requests waited for the database\n/);
 assert.match(text,/<b>📦 Batches closed: 12<\/b>/);
 assert.match(text,/⏳ Longest: 9TH -NOV-26\/S1\/B01/);
 assert.match(text,/7 h 45 min start to close/);
 assert.match(text,/👤 Started teklalmahto · locked rakesh&lt;b&gt;/,'usernames, lower case and escaped');
 assert.match(text,/VLB 5 h 0 min · LMV 1 h 0 min · ELB 45 min 0 s/);
 assert.match(text,/⏱ Average start to close: 3 h 10 min/);
 assert.match(text,/640 cards · 6.1 s\/card · slowest 42 s/);
 assert.match(text,/⚡ 150 ms avg · slowest 350 ms/);
 assert.match(text,/🔎 Duplicate check 3 ms avg · 7 ms slowest/);
 assert.match(text,/🧩 Largest step: card rule check 73 ms avg · 238 ms slowest/);
 assert.match(text,/🔌 Database: 10 free, 0 waiting now · most waiting 0/);
 assert.match(text,/🤖 Engines 8 live, none blocked, 0 reading now/);
 assert.match(text,/🔄 Pulse breakdown copy fresh \(14 s old\)/);
 assert.ok(text.length<4000);
 const none=healthReportMessage({window,figures:calm});
 assert.match(none,/Batches closed: 0/);assert.doesNotMatch(none,/Longest/);
 assert.match(none,/No cards scanned in this period/);
 assert.match(healthReportMessage({window,figures:{...calm,server:{...calm.server,measuredFrom:ist('2026-11-16T09:05:00')}}}),/Server \(since restart 09:05\)/,
  'a restart inside the period is shown, because the server figures start there');
});

test('live figures take the period from the per-minute history and the whole save from the last saves',()=>{
 const from=ist('2026-11-16T10:00:00');
 const minute=(time,extra)=>({minute:new Date(ist(time)).toISOString(),freezes:0,longestFreezeMs:0,poolMaxWaiting:0,...extra});
 const figures=liveFigures({
  performance:{measuredSince:new Date(ist('2026-11-16T06:00:00')).toISOString(),minutes:[minute('2026-11-16T09:30:00',{freezes:9,longestFreezeMs:9000,poolMaxWaiting:9}),
   minute('2026-11-16T11:00:00',{freezes:2,longestFreezeMs:800}),minute('2026-11-16T12:00:00',{freezes:1,longestFreezeMs:400,poolMaxWaiting:2})]},
  pool:{idle:10,waiting:0},
  scanning:{liveEngines:8,reading:1,outages:[],entryReadLane:{slots:4,active:0,waiting:0},
   entryReadSteps:{reads:40,total:{avgMs:150,maxMs:350},steps:{queue:{avgMs:500,maxMs:900},'card-check':{avgMs:73,maxMs:238},'duplicate-saved':{avgMs:3,maxMs:7}}}},
  pulseCopy:{fresh:true,ageSeconds:14}},from);
 assert.deepEqual(figures.server,{measuredFrom:from,freezes:3,longestFreezeMs:800,mostWaiting:2,free:10,waitingNow:0,
  warmupUntil:null,warmupMinutes:10,warmupFreezes:0},'minutes before the period are left out; a restart long before the period changes nothing');
 assert.deepEqual(figures.saving.largest,{name:'card-check',avgMs:73,maxMs:238},'waiting in the queue is not a step of the save');
 assert.equal(figures.saving.averageMs,150);
 assert.deepEqual(figures.engines,{live:8,reading:1,blocked:0,blockedReason:''});
});

test('freezes and database waits in the first 10 minutes after a restart are left out and the report says so',()=>{
 const window=reportWindow(ist('2026-11-16T16:00:00'));
 const minute=(time,extra)=>({minute:new Date(ist(time)).toISOString(),freezes:0,longestFreezeMs:0,poolMaxWaiting:0,...extra});
 // 16 Nov 2026: release restart at 15:16:16, freezes up to 2.6 s in the next 3 minutes.
 const performance={measuredSince:new Date(ist('2026-11-16T15:16:16')).toISOString(),minutes:[
  minute('2026-11-16T15:16:00',{freezes:2,longestFreezeMs:2613,poolMaxWaiting:6}),minute('2026-11-16T15:17:00',{freezes:2,longestFreezeMs:1160}),
  minute('2026-11-16T15:18:00',{freezes:2,longestFreezeMs:1159}),minute('2026-11-16T15:26:00',{freezes:1,longestFreezeMs:3000}),
  minute('2026-11-16T15:27:00',{freezes:1,longestFreezeMs:400})]};
 const figures=liveFigures({performance,pool:{idle:8,waiting:0}},window.from);
 assert.equal(figures.server.warmupUntil,ist('2026-11-16T15:26:16'));
 assert.equal(figures.server.freezes,1,'15:26 starts inside the 10 minutes, so only 15:27 counts');
 assert.equal(figures.server.longestFreezeMs,400);
 assert.equal(figures.server.mostWaiting,0,'the 6 waiting at 15:16 is left out');
 assert.equal(figures.server.warmupFreezes,7);
 assert.equal(verdict({...calm,server:figures.server}).good,true);
 const text=healthReportMessage({window,figures:{...calm,server:figures.server}});
 assert.match(text,/Server \(since restart 15:16\)/);
 assert.match(text,/🧊 Freezes 1 · longest 400 ms \(first 10 min after restart left out: 7 freezes\)/);
 const late=liveFigures({performance:{...performance,minutes:[...performance.minutes,minute('2026-11-16T15:40:00',{freezes:1,longestFreezeMs:2500})]},pool:{idle:8,waiting:0}},window.from);
 assert.equal(verdict({...calm,server:late.server}).good,false,'a freeze after the 10 minutes still counts');
});

test('the report leaves out card saves in the first 10 minutes after a restart and says so',()=>{
 const window=reportWindow(ist('2026-11-16T16:00:00'));
 const cold={reads:4,total:{avgMs:5974,maxMs:13858},steps:{'card-fill':{avgMs:9000,maxMs:13226}}};
 const live=afterWarmup=>liveFigures({scanning:{liveEngines:8,outages:[],entryReadSteps:{...cold,afterWarmup}}},window.from);
 const onlyCold=live({reads:0,total:null,steps:{},slowest:[],warmupMinutes:10,warmupSkipped:4});
 assert.equal(onlyCold.saving.averageMs,null,'the 4 cold saves are not judged');
 assert.equal(verdict({...calm,saving:onlyCold.saving}).good,true);
 assert.match(healthReportMessage({window,figures:{...calm,saving:onlyCold.saving}}),/Only 4 saves so far, all in the first 10 min after restart \(left out\)/);
 const mixed=live({reads:12,total:{avgMs:300,maxMs:900},steps:{'card-fill':{avgMs:120,maxMs:400}},slowest:[],warmupMinutes:10,warmupSkipped:4});
 assert.equal(mixed.saving.averageMs,300);
 assert.equal(mixed.saving.slowestMs,900);
 const text=healthReportMessage({window,figures:{...calm,saving:mixed.saving}});
 assert.match(text,/Card saving \(last 12 saves\)/);
 assert.match(text,/4 saves in the first 10 min after restart left out/);
 assert.equal(live(undefined).saving.averageMs,5974,'an older tracker without afterWarmup still works');
});

const fakePool=({batches=[],audit=[],cards=[]}={})=>{
 const claimed=new Set(),queries=[];
 return {queries,claimed,async query(sql,params=[]){
  queries.push(sql);
  if(/CREATE TABLE/.test(sql))return {rows:[]};
  if(/INSERT INTO mis_health_reports/.test(sql)){if(claimed.has(params[0]))return {rows:[]};claimed.add(params[0]);return {rows:[{window_key:params[0]}]};}
  if(/UPDATE mis_health_reports/.test(sql))return {rows:[]};
  if(/FROM mis_vlb_batches/.test(sql))return {rows:batches};
  if(/FROM mis_vlb_batch_audit/.test(sql))return {rows:audit};
  if(/FROM mis_scan_cards/.test(sql))return {rows:cards};
  throw new Error('unexpected '+sql);
 }};
};

test('one message per report time to every owner login, with the longest batch and its usernames',async()=>{
 const pool=fakePool({
  batches:[
   {id:'a',name:'CMLL/DIPKA/15TH -NOV-26/S1/B01',site:'Dipka',created_at:'2026-11-16T00:00:00Z',vlb_locked_at:null,lmv_locked_at:null,closed_at:'2026-11-16T01:00:00Z',started_by:'ramesh'},
   {id:'b',name:'CMLL/KUSMUNDA/15TH -NOV-26/S3/B01',site:'Kusmunda',created_at:'2026-11-15T20:00:00Z',vlb_locked_at:null,lmv_locked_at:null,closed_at:'2026-11-16T02:30:00Z',started_by:'suresh'}],
  audit:[{batch_id:'b',actor:'Mahesh'}],
  cards:[{status:'posted',timing:{scanTiming:{totalMs:5000,queuedMs:1000}}},{status:'error',timing:{}},
   {status:'review',timing:{__caliberUtf8JsonV1:Buffer.from(JSON.stringify({scanTiming:{totalMs:7000,queuedMs:3000}})).toString('base64')}}]});
 const sent=[];
 const telegram={async send(login,message,key,options){sent.push({login,message,key,options});return true;}};
 let clock=ist('2026-11-16T10:01:00');
 const reporter=createHealthReporter({pool,telegram,recipients:async()=>['owner1','owner2'],now:()=>clock,log:{error(){}},
  live:()=>({performance:{measuredSince:'2026-11-15T00:00:00Z',minutes:[]},pool:{idle:10,waiting:0},scanning:null,pulseCopy:{enabled:false}})});
 const first=await reporter.tick();
 assert.deepEqual({claimed:first.claimed,people:first.people,sent:first.sent},{claimed:true,people:2,sent:2});
 assert.deepEqual(sent.map(s=>s.key),['health-report:2026-11-16 10:00 IST:owner1','health-report:2026-11-16 10:00 IST:owner2']);
 assert.equal(sent[0].options.html,true);
 assert.deepEqual(sent[0].options.photo,{speed:{good:true,period:'15 Nov 21:00 → 16 Nov 10:00 IST · 13 h',reasons:[]}},'the green / red headline picture goes with it');
 const text=sent[0].message;
 assert.match(text,/Batches closed: 2/);
 assert.match(text,/Longest: 15TH -NOV-26\/S3\/B01/);
 assert.match(text,/Kusmunda · 6 h 30 min start to close/);
 assert.match(text,/Started suresh · locked mahesh/);
 assert.match(text,/3 cards · 6 s\/card · slowest 7 s/,'encoded card fields are read too');
 assert.match(text,/Not read 1/);
 clock=ist('2026-11-16T10:05:00');
 assert.equal((await reporter.tick()).claimed,false,'a second tick or a second server in the same window sends nothing');
 assert.equal(sent.length,2);
 clock=ist('2026-11-16T12:00:00');
 assert.deepEqual(await reporter.tick(),{due:false});
 const sample=await reporter.sendSample();
 assert.equal(sample.sent,2);
 assert.match(sent.at(-1).message,/SPEED REPORT \(SAMPLE\)/);
 assert.match(sent.at(-1).key,/^health-report:sample:/);
 assert.match(sent.at(-1).message,/16 Nov 10:00 → 16 Nov 12:00 IST/);
});

test('it runs only on the live slot and is the Automation Centre line A25 with its own switch',()=>{
 assert.equal(isLiveSlot({}),true);assert.equal(isLiveSlot({WEBSITE_SLOT_NAME:'Production'}),true);
 assert.equal(isLiveSlot({WEBSITE_SLOT_NAME:'staging'}),false);
 assert.equal(automationForEventKey('health-report:2026-11-16 10:00 IST:owner'),'health-report');
 const line=AUTOMATIONS.find(item=>item.key==='health-report');
 assert.equal(line.code,'A25');assert.equal(AUTOMATIONS.at(-1),line);
 assert.match(line.trigger,/10:00, 16:00 and 21:00 IST/);
 const source=readFileSync(new URL('../src/automation-centre.jsx',import.meta.url),'utf8');
 assert.match(source,/row\.key==='health-report'&&<button[^>]*onClick=\{\(\)=>void sendHealthSample\(row\)\}>Send sample to Telegram<\/button>/);
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/if\(healthReportEnabled\(\)&&isLiveSlot\(\)\)scheduleBackgroundStart\(\(\)=>healthReporter\.start\(\)/);
});

test('only an administrator can send a sample of A25',async t=>{
 let result={verdict:'SPEED GOOD',people:1,sent:1},calls=0;
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.session={login:req.get('Authorization')};next();});
 registerAutomationCentre(app,{pool:{query:async()=>({rows:[]})},centre:{overview:async()=>({rows:[]})},requireSession:(req,res,next)=>next(),
  requireAdministrator:(req,res,next)=>req.session.login==='admin'?next():res.sendStatus(403),
  healthReporter:{async sendSample(){calls++;return result;}}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const send=async(who='admin')=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/automation-centre/health-report/sample',{method:'POST',headers:{Authorization:who}});
  return {status:response.status,body:await response.json().catch(()=>({}))};};
 assert.equal((await send('operator')).status,403);assert.equal(calls,0);
 assert.deepEqual(await send(),{status:200,body:result});
 result={verdict:'x',people:0,sent:0};assert.match((await send()).body.error,/connected Telegram/);
 result={verdict:'x',people:1,sent:0};assert.match((await send()).body.error,/switched OFF/);
});

test('the headline picture is green for SPEED GOOD and red for SPEED SLOW, and the outbox sends it',async()=>{
 const {speedReportBanner}=await import('../server/services/site-report-banner.mjs');
 const {createCanvas,loadImage}=await import('@napi-rs/canvas');
 const colour=async png=>{const image=await loadImage(png),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return [...ctx.getImageData(image.width-20,image.height-20,1,1).data].slice(0,3);};
 const [gr,gg]=await colour(await speedReportBanner({good:true,period:'16 Nov 10:00 → 16 Nov 16:00 IST · 6 h'}));
 assert.ok(gg>gr,'green');
 const [rr,rg]=await colour(await speedReportBanner({good:false,period:'x',reasons:['card save 3.4 s on average']}));
 assert.ok(rr>rg,'red');
 const source=readFileSync(new URL('../server/routes/mis-telegram.mjs',import.meta.url),'utf8');
 assert.match(source,/photo\.speed\?speedReportBanner\(photo\.speed\):siteReportBanner\(photo\)/);
});
