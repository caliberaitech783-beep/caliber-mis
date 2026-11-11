import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import express from 'express';import {PGlite} from '@electric-sql/pglite';
import {registerLogBookDashboard} from '../server/routes/log-book-dashboard.mjs';
import {buildRecentActivity,batchCompletionTimes,completedIn,recentSiteRows,recentWindow} from '../shared/recent-activity.mjs';

const NOW=Date.parse('2026-11-11T16:00:00Z'),ago=hours=>new Date(NOW-hours*3600000).toISOString();

test('log books are counted by save time and shifts by lock time, in 6, 12 and 24 hours',()=>{
 const recent=buildRecentActivity({now:NOW,
  cards:[{site:'sasti ob',book_type:'vehicle',h6:4,h12:9,h24:20},{site:'Sasti OC',book_type:'lmv',h6:0,h12:2,h24:3},{site:'Jayant OC',book_type:'equipment',h6:1,h12:1,h24:5}],
  batches:[
   {id:'a',name:'Sasti 02-11 S1',site:'Sasti OC',date:'2026-11-02',shift:'I',vlb_locked_at:ago(2),lmv_locked_at:ago(1),closed_at:null},
   {id:'b',name:'Jayant 03-11 S2',site:'Jayant OC',date:'2026-11-03',shift:'II',vlb_locked_at:ago(30),lmv_locked_at:ago(10),closed_at:ago(7)},
   // Closed under the one-step rule: the closing time stands for VLB, LMV and ELB.
   {id:'c',name:'Majri 04-11 S3',site:'Majri OC',date:'2026-11-04',shift:'III',vlb_locked_at:null,lmv_locked_at:null,closed_at:ago(20)},
   {id:'d',name:'Old',site:'Majri OC',date:'2026-11-01',shift:'I',vlb_locked_at:ago(40),lmv_locked_at:ago(39),closed_at:ago(38)}]});
 assert.deepEqual(recent.logs[6],{total:5,vehicle:4,lmv:0,equipment:1});
 assert.deepEqual(recent.logs[12],{total:12,vehicle:9,lmv:2,equipment:1});
 assert.deepEqual(recent.logs[24],{total:28,vehicle:20,lmv:3,equipment:5});
 assert.deepEqual(recent.bySite[24].map(s=>[s.site,s.vehicle,s.lmv,s.equipment]),[['Jayant OC',0,0,5],['Sasti OC',20,3,0]],'site aliases are added together');
 assert.deepEqual(recent.shifts,{6:{vlb:1,lmv:1,elb:0},12:{vlb:1,lmv:2,elb:1},24:{vlb:2,lmv:3,elb:2}});
 assert.deepEqual(completedIn(recent,'lmv',12).map(r=>[r.site,r.dateLabel,r.shiftLabel]),[['Sasti OC','02-11-26','Shift 1'],['Jayant OC','03-11-26','Shift 2']],'newest first');
 assert.deepEqual(completedIn(recent,'elb',6),[]);
 assert.deepEqual(batchCompletionTimes({closed_at:null,vlb_locked_at:null,lmv_locked_at:null}),{vlb:null,lmv:null,elb:null});
});

test('a login with only the vehicle log book sees no ELB figures',()=>{
 const recent=buildRecentActivity({now:NOW,kinds:['vehicle'],cards:[{site:'Sasti OC',book_type:'equipment',h6:3,h12:3,h24:3},{site:'Sasti OC',book_type:'vehicle',h6:1,h12:1,h24:1}],
  batches:[{id:'a',site:'Sasti OC',date:'2026-11-02',shift:'I',vlb_locked_at:ago(3),lmv_locked_at:ago(2),closed_at:ago(1)}]});
 assert.deepEqual(recent.logs[6],{total:1,vehicle:1,lmv:0,equipment:0});assert.deepEqual(recent.shiftKinds,['vlb','lmv']);assert.equal(recent.shifts[6].elb,0);
});

test('the site comparison for a window keeps every dashboard site, zero or not',()=>{
 const recent=buildRecentActivity({now:NOW,cards:[{site:'Sasti OC',book_type:'vehicle',h6:2,h12:2,h24:6},{site:'New Mine',book_type:'equipment',h6:0,h12:0,h24:1}]});
 assert.deepEqual(recentSiteRows(recent,6,['Jayant OC','Sasti OC']),[{site:'Jayant OC',vehicle:0,equipment:0},{site:'Sasti OC',vehicle:2,equipment:0}]);
 assert.deepEqual(recentSiteRows(recent,24,['Jayant OC','Sasti OC']).at(-1),{site:'New Mine',vehicle:0,equipment:1});
 assert.equal(recentWindow('12'),12);assert.equal(recentWindow('5'),0);assert.equal(recentWindow(undefined),0);
});

test('the dashboard reads the last 24 hours within the login\'s sites and lists one window\'s cards',async()=>{
 const db=new PGlite();let server;try{
  await db.exec(`CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT,book_date DATE,site TEXT,data JSONB,created_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ);
   CREATE TABLE mis_vlb_batches(id TEXT PRIMARY KEY,name TEXT,site TEXT,book_date DATE,shift TEXT,vlb_locked_at TIMESTAMPTZ,lmv_locked_at TIMESTAMPTZ,closed_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ);`);
  const book=(type,site,hours,extra={})=>db.query('INSERT INTO mis_log_books(book_no,book_type,book_date,site,data,created_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[type+hours,type,extra.date||'2026-11-03',site,JSON.stringify(extra.data||{}),ago(hours),extra.deleted||null]);
  // Cards dated 3 Nov but saved today: the save time decides.
  await book('vehicle','Sasti OC',1);await book('vehicle','Sasti OC',8);await book('vehicle','Sasti OC',20);await book('vehicle','Sasti OC',30);
  await book('vehicle','Sasti OC',2,{deleted:ago(1)});await book('equipment','Jayant OC',5);await book('lmv','x',3,{data:{location:'Sasti OC'}});
  await book('vehicle','Sasti OC',1,{date:'2026-10-30'});
  const batch=(id,site,vlb,lmv,closed,extra={})=>db.query('INSERT INTO mis_vlb_batches VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,site,'2026-11-03','I',vlb,lmv,closed,extra.deleted||null,extra.archived||null]);
  await batch('one','Sasti OC',ago(4),null,null);await batch('two','Jayant OC',ago(30),ago(11),ago(9));await batch('gone','Sasti OC',ago(1),ago(1),ago(1),{deleted:ago(1)});
  const app=express();const protect=[(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.session={login:'admin',permissions:{}};req.logBookScope={sites:req.headers['x-scope']==='sasti'?['sasti ob']:null};next()}];
  registerLogBookDashboard(app,{pool:{query:(s,p)=>db.query(s,p)},protect,ensureBooks:async()=>{},now:()=>NOW});app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const root='http://127.0.0.1:'+server.address().port;
  const get=async(path,extra={})=>{const response=await fetch(root+'/api/dashboard/log-books'+path,{headers:{Authorization:'test',...extra}});return {status:response.status,body:await response.json()}};
  let result=await get('/recent');assert.equal(result.status,200,JSON.stringify(result.body));
  assert.deepEqual(result.body.logs,{6:{total:3,vehicle:1,lmv:1,equipment:1},12:{total:4,vehicle:2,lmv:1,equipment:1},24:{total:5,vehicle:3,lmv:1,equipment:1}});
  assert.deepEqual(result.body.shifts,{6:{vlb:1,lmv:0,elb:0},12:{vlb:1,lmv:1,elb:1},24:{vlb:1,lmv:1,elb:1}});
  assert.deepEqual(result.body.bySite[24].map(s=>s.site),['Jayant OC','Sasti OC']);
  result=await get('/recent',{'x-scope':'sasti'});assert.deepEqual(result.body.logs[24],{total:4,vehicle:3,lmv:1,equipment:0});assert.deepEqual(result.body.shifts[24],{vlb:1,lmv:0,elb:0});
  assert.equal((await fetch(root+'/api/dashboard/log-books/recent')).status,401);
  result=await get('/records?kind=vehicle&location=Sasti%20OC&hours=12');assert.equal(result.status,200,JSON.stringify(result.body));assert.deepEqual(result.body.records.map(r=>r.book_no),['vehicle8','vehicle1']);
  result=await get('/records?kind=vehicle&hours=24&from=2026-11-11&to=2026-11-11');assert.equal(result.body.records.length,3,'the hours replace the dashboard dates');
 }finally{server?.closeAllConnections();await new Promise(r=>server?server.close(r):r());await db.close()}
});

test('the dashboard shows the last 6, 12 and 24 hours, Trip Timing in place of the daily trend, and the site comparison below it',()=>{
 const read=file=>fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
 const screen=read('log-book-dashboard.jsx'),panel=read('log-book-recent-activity.jsx'),css=read('log-book-dashboard.css');
 assert.ok(!screen.includes('Daily entry trend'),'the daily trend graph is removed');
 assert.match(screen,/<RecentActivityPanel recent=\{live\.recent\} error=\{live\.error\} Dialog=\{Dialog\}\/>/);
 const timing=screen.indexOf('<OperationsReports session={session} reportId="timing" ReportSection={ReportSection}/>'),sites=screen.indexOf('<h3>Site comparison</h3>'),batch=screen.indexOf('<BatchStatusReport');
 assert.ok(timing>0&&sites>timing&&batch>sites,'Trip Timing, then the site comparison, then the other reports');
 assert.match(screen,/RECENT_WINDOWS\.map\(hours=><button key=\{hours\} type="button" aria-pressed=\{siteHours===hours\} onClick=\{\(\)=>setSiteHours\(hours\)\}>/,'6, 12 and 24 hour buttons on the site comparison');
 assert.match(panel,/headers:\{Authorization:'Bearer '\+session\.token\}/,'the read carries the sign-in');
 for(const text of ['Log books saved',' shifts completed','Completed in the last 6, 12 and 24 hours'])assert.ok(panel.includes(text),text);
 assert.ok(css.includes('.lb-reports .op-report-picker{display:none}'),'no report list on the dashboard copy');
});
