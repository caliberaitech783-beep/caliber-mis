import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import express from 'express';import {PGlite} from '@electric-sql/pglite';
import {registerLogBookDashboard} from '../server/routes/log-book-dashboard.mjs';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {transformWithOxc} from 'vite';
import * as recentRules from '../shared/recent-activity.mjs';
import {buildRecentActivity,batchCompletionTimes,completedIn,completedBySite,cardsInside,logShiftsFor,recentSiteRows,recentWindow,locksIn,locksBySite,lockCards,batchStageTimes,durationLabel,averageLockMinutes} from '../shared/recent-activity.mjs';

const NOW=Date.parse('2026-11-11T16:00:00Z'),ago=hours=>new Date(NOW-hours*3600000).toISOString();

test('log books are counted by save time and shifts by lock time, in 6, 12 and 24 hours',()=>{
 const recent=buildRecentActivity({now:NOW,
  cards:[{site:'sasti ob',book_type:'vehicle',date:'2026-11-02',shift:'I',h6:4,h12:9,h24:20},{site:'Sasti OC',book_type:'lmv',date:'2026-11-02',shift:'S1',h6:0,h12:2,h24:3},{site:'Jayant OC',book_type:'equipment',date:'2026-11-03',shift:'',h6:1,h12:1,h24:5}],
  batches:[
   {id:'a',name:'Sasti 02-11 S1',site:'Sasti OC',date:'2026-11-02',shift:'I',vlb_locked_at:ago(2),lmv_locked_at:ago(1),closed_at:null,cards:40,machines_saved:6},
   {id:'b',name:'Jayant 03-11 S2',site:'Jayant OC',date:'2026-11-03',shift:'II',vlb_locked_at:ago(30),lmv_locked_at:ago(10),closed_at:ago(7),cards:55,machines_saved:9},
   // Closed under the one-step rule: the closing time stands for VLB, LMV and ELB.
   {id:'c',name:'Majri 04-11 S3',site:'Majri OC',date:'2026-11-04',shift:'III',vlb_locked_at:null,lmv_locked_at:null,closed_at:ago(20),cards:12,machines_saved:3},
   {id:'d',name:'Old',site:'Majri OC',date:'2026-11-01',shift:'I',vlb_locked_at:ago(40),lmv_locked_at:ago(39),closed_at:ago(38),cards:99,machines_saved:99}],
  // LMV log books belong to a site, date and shift; the site alias and the two ways of writing shift 1 are one shift.
  lmvBooks:[{site:'Sasti OC',date:'2026-11-02',shift:'S1',count:4},{site:'sasti ob',date:'2026-11-02',shift:'I',count:1},{site:'Jayant OC',date:'2026-11-03',shift:'S2',count:2}]});
 assert.deepEqual(recent.logs[6],{total:5,vehicle:4,lmv:0,equipment:1});
 assert.deepEqual(recent.logs[12],{total:12,vehicle:9,lmv:2,equipment:1});
 assert.deepEqual(recent.logs[24],{total:28,vehicle:20,lmv:3,equipment:5});
 assert.deepEqual(recent.bySite[24].map(s=>[s.site,s.vehicle,s.lmv,s.equipment]),[['Sasti OC',20,3,0],['Jayant OC',0,0,5]],'site aliases are added together; the site with the most cards is on top');
 assert.deepEqual(recent.bySite[6].map(s=>[s.site,s.total]),[['Sasti OC',4],['Jayant OC',1]]);
 assert.deepEqual(recent.shifts,{6:{vlb:1,lmv:1,elb:0},12:{vlb:1,lmv:2,elb:1},24:{vlb:2,lmv:3,elb:2}});
 assert.deepEqual(completedIn(recent,'lmv',12).map(r=>[r.site,r.dateLabel,r.shiftLabel]),[['Sasti OC','02-11-26','Shift 1'],['Jayant OC','03-11-26','Shift 2']],'newest first');
 assert.deepEqual(completedIn(recent,'elb',6),[]);
 assert.deepEqual(batchCompletionTimes({closed_at:null,vlb_locked_at:null,lmv_locked_at:null}),{vlb:null,lmv:null,elb:null});
 // The cards inside the completed shifts: trip cards for VLB, LMV log books for LMV, ELB cards for ELB.
 assert.deepEqual(recent.shiftCards,{6:{vlb:40,lmv:5,elb:0},12:{vlb:40,lmv:7,elb:9},24:{vlb:52,lmv:7,elb:12}});
 assert.deepEqual(completedIn(recent,'vlb',24).map(r=>[r.batchName,r.cards]),[['Sasti 02-11 S1',40],['Majri 04-11 S3',12]]);
 assert.deepEqual(completedIn(recent,'vlb',24,'sasti ob').map(r=>r.batchName),['Sasti 02-11 S1'],'one site, whichever way its name is written');
 assert.deepEqual(completedBySite(recent,'lmv',24),[{site:'Sasti OC',shifts:1,cards:5},{site:'Jayant OC',shifts:1,cards:2},{site:'Majri OC',shifts:1,cards:0}],'equal shifts: more cards first');
 // A site opens into its saved cards by card date and shift.
 assert.deepEqual(logShiftsFor(recent,'Sasti OC',12).map(r=>[r.dateLabel,r.shiftLabel,r.counts[12]]),[['02-11-26','Shift 1',{total:11,vehicle:9,lmv:2,equipment:0}]]);
 assert.deepEqual(logShiftsFor(recent,'Sasti OC',6).map(r=>r.counts[6].total),[4]);
 assert.deepEqual(logShiftsFor(recent,'Jayant OC',6).map(r=>[r.dateLabel,r.shift,r.counts[6].equipment]),[['03-11-26','',1]],'a card with no shift recorded is still listed');
 // Batches locked: the whole batch saved and locked. Batch "a" has only its VLB and LMV locked, so it is not one yet.
 assert.deepEqual(recent.batchLocks,{6:0,12:1,24:2});
 assert.deepEqual(locksIn(recent,24).map(r=>[r.batchName,r.site,r.dateLabel,r.shiftLabel,r.vehicle,r.lmv,r.equipment,r.minutesAgo]),
  [['Jayant 03-11 S2','Jayant OC','03-11-26','Shift 2',55,2,9,420],['Majri 04-11 S3','Majri OC','04-11-26','Shift 3',12,0,3,1200]],'the latest lock first, with every card inside the batch');
 assert.deepEqual(locksIn(recent,6),[]);assert.deepEqual(locksIn(recent,12).map(r=>r.batchId),['b']);
});

test('batches locked are listed site by site, the most batches on top, with who locked each one',()=>{
 const batch=(id,site,date,shift,hours,cards,by)=>({id,name:id,site,date,shift,vlb_locked_at:ago(hours+2),lmv_locked_at:ago(hours+1),closed_at:ago(hours),cards,machines_saved:cards/5,locked_by:by});
 const input={now:NOW,
  batches:[batch('m1','Majri OC','2026-11-02','I',1,10,'Asha'),batch('s1','Sasti OC','2026-11-02','I',2,30,'Ravi'),batch('s2','sasti ob','2026-11-02','II',3,20,'Ravi'),batch('s3','Sasti OC','2026-11-02','II',4,5,''),batch('j1','Jayant OC','2026-11-02','I',9,80,'Asha'),
   // Reopened after locking: no lock time, so it is not counted until it is locked again.
   {...batch('open','Majri OC','2026-11-03','I',1,7,''),closed_at:null},
   // The clock of the server a little ahead is accepted; a lock a day and more old is not listed.
   {...batch('old','Majri OC','2026-11-01','I',25,7,'')}],
  lmvBooks:[{site:'Sasti OC',date:'2026-11-02',shift:'S2',count:6},{site:'Majri OC',date:'2026-11-02',shift:'S1',count:2}]};
 const recent=buildRecentActivity(input);
 assert.deepEqual(recent.batchLocks,{6:4,12:5,24:5});
 assert.deepEqual([6,12,24].map(hours=>recent.shifts[hours].elb),[4,5,5],'the batch lock closes the ELB shift: the two figures are the same');
 // s2 and s3 are one site, date and shift: their six LMV log books are added once.
 assert.deepEqual(locksBySite(recent,6),[{site:'Sasti OC',batches:3,cards:{vehicle:55,lmv:6,equipment:11}},{site:'Majri OC',batches:1,cards:{vehicle:10,lmv:2,equipment:2}}]);
 assert.deepEqual(locksBySite(recent,24).map(s=>s.site),['Sasti OC','Jayant OC','Majri OC'],'equal batches: more cards first');
 assert.deepEqual(locksIn(recent,6,'sasti ob').map(r=>[r.batchName,r.lockedBy,r.lmv]),[['s1','Ravi',0],['s2','Ravi',6],['s3','',6]],'one site, whichever way its name is written');
 assert.deepEqual(lockCards(locksIn(recent,24)),{vehicle:145,lmv:8,equipment:29});
 // A login with only the vehicle log book sees the batches and their trip cards and LMV log books, not the ELB cards.
 const vehicle=buildRecentActivity({...input,kinds:['vehicle']});
 assert.deepEqual(vehicle.batchLocks,{6:4,12:5,24:5});assert.deepEqual(lockCards(locksIn(vehicle,24)),{vehicle:145,lmv:8,equipment:0});
 assert.deepEqual(buildRecentActivity({...input,kinds:[]}).batchLocks,{6:0,12:0,24:0});
});

test('sites are listed from the most completed shifts to the fewest, and one shift\'s LMV log books are added once',()=>{
 const batch=(id,site,date,shift,hours,cards)=>({id,name:id,site,date,shift,vlb_locked_at:ago(hours),lmv_locked_at:ago(hours),closed_at:ago(hours),cards,machines_saved:cards});
 const recent=buildRecentActivity({now:NOW,
  batches:[batch('m1','Majri OC','2026-11-02','I',1,10),batch('s1','Sasti OC','2026-11-02','I',2,30),batch('s2','Sasti OC','2026-11-02','II',3,20),batch('s3','Sasti OC','2026-11-02','II',4,5),batch('j1','Jayant OC','2026-11-02','I',9,80)],
  lmvBooks:[{site:'Sasti OC',date:'2026-11-02',shift:'S2',count:6},{site:'Majri OC',date:'2026-11-02',shift:'S1',count:2}]});
 assert.deepEqual(completedBySite(recent,'vlb',6),[{site:'Sasti OC',shifts:3,cards:55},{site:'Majri OC',shifts:1,cards:10}]);
 assert.deepEqual(completedBySite(recent,'vlb',12).map(s=>s.site),['Sasti OC','Jayant OC','Majri OC'],'equal shifts: more cards first');
 // s2 and s3 are the same site, date and shift: their six LMV log books count once.
 assert.deepEqual(completedBySite(recent,'lmv',6),[{site:'Sasti OC',shifts:3,cards:6},{site:'Majri OC',shifts:1,cards:2}]);
 assert.equal(recent.shiftCards[6].lmv,8);assert.equal(cardsInside(completedIn(recent,'elb',24)),145);
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
   CREATE TABLE mis_vlb_batches(id TEXT PRIMARY KEY,name TEXT,site TEXT,book_date DATE,shift TEXT,vlb_locked_at TIMESTAMPTZ,lmv_locked_at TIMESTAMPTZ,closed_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ,created_at TIMESTAMPTZ,creator_login TEXT,created_by TEXT);
   CREATE TABLE mis_vlb_batch_entries(batch_id TEXT,logbook_id BIGINT);CREATE TABLE mis_vlb_batch_fleet(batch_id TEXT,asset_id BIGINT,logbook_id BIGINT);
   CREATE TABLE mis_vlb_batch_audit(id BIGSERIAL PRIMARY KEY,batch_id TEXT,actor TEXT,action TEXT,occurred_at TIMESTAMPTZ,detail JSONB);
   CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);`);
  // Batch "two" was locked once by another login, reopened, and locked again nine hours ago by r.kumar.
  const history=(batch,actor,action,hours)=>db.query('INSERT INTO mis_vlb_batch_audit(batch_id,actor,action,occurred_at) VALUES($1,$2,$3,$4)',[batch,actor,action,ago(hours)]);
  await history('two','someone','saved_and_locked',14);await history('two','R.Kumar','reopened',12);await history('two','R.Kumar','saved_and_locked',9);await history('two','r.kumar','saved_and_locked',40);await history('one','a.singh','vlb_locked',4);
  await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2)',['Users & employees',JSON.stringify({login:' r.kumar ',employee:'Ravi Kumar'})]);
  const book=(type,site,hours,extra={})=>db.query('INSERT INTO mis_log_books(book_no,book_type,book_date,site,data,created_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[type+hours,type,extra.date||'2026-11-03',site,JSON.stringify(extra.data||{}),ago(hours),extra.deleted||null]);
  // Cards dated 3 Nov but saved today: the save time decides.
  await book('vehicle','Sasti OC',1);await book('vehicle','Sasti OC',8);await book('vehicle','Sasti OC',20);await book('vehicle','Sasti OC',30);
  await book('vehicle','Sasti OC',2,{deleted:ago(1)});await book('equipment','Jayant OC',5);await book('lmv','x',3,{data:{location:'Sasti OC',bookShiftCode:'S1'}});
  await book('vehicle','Sasti OC',1,{date:'2026-10-30'});
  // An LMV log book of Jayant's shift, saved two days ago: outside the 24 hours, inside the shift locked today.
  await book('lmv','y',40,{data:{location:'Jayant OC',cardShift:'I'}});
  // Batch "one" holds trip cards 1 and 2 and the deleted card 5; batch "two" has one machine saved and one still open.
  await db.exec(`INSERT INTO mis_vlb_batch_entries VALUES('one',1),('one',2),('one',5);INSERT INTO mis_vlb_batch_fleet VALUES('two',11,6),('two',12,NULL);`);
  const batch=(id,site,vlb,lmv,closed,extra={})=>db.query('INSERT INTO mis_vlb_batches VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,site,'2026-11-03','I',vlb,lmv,closed,extra.deleted||null,extra.archived||null,extra.created||null,extra.creator||null,extra.createdBy||null]);
  // Batch "two" was started 33 hours ago by r.kumar (recorded the older way, in created_by): VLB locked 3 hours later, LMV 19 hours after that, the batch 2 hours after that.
  await batch('one','Sasti OC',ago(4),null,null,{created:ago(6),creator:'a.singh'});await batch('two','Jayant OC',ago(30),ago(11),ago(9),{created:ago(33),createdBy:'R.Kumar'});await batch('gone','Sasti OC',ago(1),ago(1),ago(1),{deleted:ago(1)});
  const app=express();const protect=[(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.session={login:'admin',permissions:{}};req.logBookScope={sites:req.headers['x-scope']==='sasti'?['sasti ob']:null};next()}];
  registerLogBookDashboard(app,{pool:{query:(s,p)=>db.query(s,p)},protect,ensureBooks:async()=>{},now:()=>NOW});app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const root='http://127.0.0.1:'+server.address().port;
  const get=async(path,extra={})=>{const response=await fetch(root+'/api/dashboard/log-books'+path,{headers:{Authorization:'test',...extra}});return {status:response.status,body:await response.json()}};
  let result=await get('/recent');assert.equal(result.status,200,JSON.stringify(result.body));
  assert.deepEqual(result.body.logs,{6:{total:3,vehicle:1,lmv:1,equipment:1},12:{total:4,vehicle:2,lmv:1,equipment:1},24:{total:5,vehicle:3,lmv:1,equipment:1}});
  assert.deepEqual(result.body.shifts,{6:{vlb:1,lmv:0,elb:0},12:{vlb:1,lmv:1,elb:1},24:{vlb:1,lmv:1,elb:1}});
  assert.deepEqual(result.body.bySite[24].map(s=>s.site),['Sasti OC','Jayant OC'],'the site with the most cards on top');
  // Cards inside the completed shifts: a deleted card is not counted, an open machine is not counted.
  assert.deepEqual(result.body.completed.map(r=>[r.kind,r.batchName,r.cards]),[['vlb','one',2],['elb','two',1],['lmv','two',1]]);
  assert.deepEqual(result.body.shiftCards,{6:{vlb:2,lmv:0,elb:0},12:{vlb:2,lmv:1,elb:1},24:{vlb:2,lmv:1,elb:1}});
  // Batches locked: batch "two" alone, with its cards and the name of the login that locked it last. "one" has only its VLB locked.
  assert.deepEqual(result.body.batchLocks,{6:0,12:1,24:1});
  assert.deepEqual(result.body.locked.map(r=>[r.batchName,r.site,r.vehicle,r.lmv,r.equipment,r.lockedBy,r.minutesAgo]),[['two','Jayant OC',0,1,1,'Ravi Kumar',540]]);
  // Batch start to close: 24 hours from the start to the lock, divided into VLB, LMV and ELB, with the name of who started it.
  assert.deepEqual(result.body.locked.map(r=>[r.startedBy,r.startedAt,r.closedAt,r.totalMinutes,r.stages.map(s=>[s.key,s.minutes])]),[['Ravi Kumar',ago(33),ago(9),1440,[['vlb',180],['lmv',1140],['elb',120]]]]);
  // A site opens into its cards by card date and shift.
  assert.deepEqual(result.body.logShifts.filter(r=>r.site==='Sasti OC').map(r=>[r.dateLabel,r.shift,r.counts[24].total]),[['03-11-26','S1',1],['03-11-26','',3]]);
  result=await get('/recent',{'x-scope':'sasti'});assert.deepEqual(result.body.logs[24],{total:4,vehicle:3,lmv:1,equipment:0});assert.deepEqual(result.body.shifts[24],{vlb:1,lmv:0,elb:0});
  assert.deepEqual(result.body.completed.map(r=>[r.kind,r.batchName,r.cards]),[['vlb','one',2]]);
  assert.deepEqual(result.body.batchLocks,{6:0,12:0,24:0},'another site\'s locked batch is not counted for this login');assert.deepEqual(result.body.locked,[]);
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
 const overtime=screen.indexOf('<ManpowerReports session={session} reportId="ot"'),loading=screen.indexOf('<OperationsReports session={session} reportId="loading" ReportSection={ReportSection}/>');
 assert.ok(overtime>batch&&loading>overtime,'the Loading Equipment-wise Report is the last report on the dashboard');
 assert.match(screen,/RECENT_WINDOWS\.map\(hours=><button key=\{hours\} type="button" aria-pressed=\{siteHours===hours\} onClick=\{\(\)=>setSiteHours\(hours\)\}>/,'6, 12 and 24 hour buttons on the site comparison');
 assert.match(panel,/headers:\{Authorization:'Bearer '\+session\.token\}/,'the read carries the sign-in');
 for(const text of ['Log books saved',' shifts completed','Completed in the last 6, 12 and 24 hours'])assert.ok(panel.includes(text),text);
 // The front shows the figures alone: no batch numbers and no card totals under them (owner, 13 Nov 2026).
 for(const gone of ['lb-recent-batches','lb-recent-cards'])assert.ok(!panel.includes(gone)&&!css.includes(gone),gone+' is no longer on the front of the panel');
 // A figure opens its sites, the highest on top, each with the batches locked there; a site opens alone, with one Back to the sites.
 assert.match(panel,/shiftSites\.map\(site=><React\.Fragment key=\{site\.site\}>\{totalRow\(siteButton\(site\.site\),site\.shifts,site\.cards\)\}\{completedIn\(recent,open\.row,open\.hours,site\.site\)\.map\(lockRow\)\}<\/React\.Fragment>\)/);
 assert.ok(css.includes('.lb-recent-locks .lb-recent-site-row td{'),'each site has its own tinted line above its batches');
 assert.ok(css.includes('.lb-recent-locks :is(th,td):is(:nth-child(2),:nth-child(3),:nth-child(6)){display:none}'),'a phone keeps the batch number, its cards and the lock time');
 assert.match(panel,/shiftSites=shiftRow\?completedBySite\(recent,open\.row,open\.hours\):\[\]/);
 // Batches locked (owner, 13 Nov 2026): its own line on the front, and a list of the batches with the cards in each, the lock time and who locked it.
 assert.match(panel,/<th scope="row">Batches locked<small>whole batch saved and locked<\/small><\/th>\{recent\.windows\.map\(hours=>cell\(recent\.batchLocks\[hours\],\{row:'batch',hours\},'Batches locked'\)\)\}/);
 assert.match(panel,/lockSites\.map\(site=>\{const rows=locksIn\(recent,open\.hours,site\.site\);return <React\.Fragment key=\{site\.site\}>\{batchTotalRow\(siteButton\(site\.site\),rows,site\.cards\)\}\{rows\.map\(batchRow\)\}<\/React\.Fragment>;\}\)/);
 // Batch start to close (owner, 13 Nov 2026): the time is a link that opens the batch's VLB, LMV and ELB time, with one Back to the batches.
 assert.match(panel,/onClick=\{\(\)=>setOpen\(\{\.\.\.open,batch:row\.batchId\}\)\}/);
 assert.match(panel,/<StepBackButton onBack=\{\(\)=>setOpen\(\{row:open\.row,hours:open\.hours,site:open\.site\}\)\} label="Back to batches"\/>/);
 assert.ok(css.includes('.lb-recent-stages :is(th,td):is(:nth-child(2),:nth-child(3)){display:table-cell}'),'a phone keeps the From and To times of each stage');
 assert.ok(css.indexOf('.lb-recent-stages :is(th,td):is(:nth-child(2),:nth-child(3)){display:table-cell}')>css.indexOf('.lb-recent-locks :is(th,td):is(:nth-child(2),:nth-child(3),:nth-child(6)){display:none}'),'the rule for the stages comes after the rule it replaces');
 assert.ok(css.includes('.lb-recent-batchlocks :is(th,td):nth-child(6){display:table-cell}.lb-recent-batchlocks :is(th,td).lb-recent-wide{display:none}'),'a phone keeps every kind of card and the lock time of a locked batch');
 assert.ok(css.indexOf('.lb-recent-batchlocks :is(th,td):nth-child(6){display:table-cell}')>css.indexOf('.lb-recent-locks :is(th,td):is(:nth-child(2),:nth-child(3),:nth-child(6)){display:none}'),'the rule for locked batches comes after the rule it replaces');
 assert.match(panel,/logSites=logs\?\[\.\.\.\(recent\.bySite\[open\.hours\]\|\|\[\]\)\]\.sort\(\(a,b\)=>b\.total-a\.total/);
 assert.match(panel,/<StepBackButton onBack=\{\(\)=>setOpen\(\{row:open\.row,hours:open\.hours\}\)\} label="Back to sites"\/>/);
 assert.ok(css.includes('.lb-dialog button.lb-recent-site{'),'a site name in the list is a link');
 assert.ok(css.includes('.lb-reports .op-report-picker{display:none}'),'no report list on the dashboard copy');
});

// The panel as plain HTML with one figure's list open (open: {row, hours, site}); null shows the front alone.
async function panelHtml(recent,open=null){
 const source=fs.readFileSync(new URL('../src/log-book-recent-activity.jsx',import.meta.url),'utf8');
 const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function').replaceAll('export const','const'),'log-book-recent-activity.jsx',{jsx:{runtime:'classic'}});
 const environment={React,useEffect:()=>{},useState:()=>[open,()=>{}],Clock:()=>null,StepBackButton:({label})=>React.createElement('button',null,label),...recentRules};
 const Panel=new Function(...Object.keys(environment),code+';return RecentActivityPanel')(...Object.values(environment));
 return renderToStaticMarkup(Panel({recent,error:'',Dialog:({title,children})=>React.createElement('section',{'aria-label':title},children)}));
}
const plain=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
// The lines of the list a figure opens, cell by cell.
const listRows=html=>[...html.slice(html.indexOf('<section')).matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(row=>[...row[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map(cell=>plain(cell[1])));

test('the front shows the figures alone; a shift figure opens its sites with the batches locked there',async()=>{
 const batch=(id,name,site,date,shift,hours,cards,machines)=>({id,name,site,date,shift,vlb_locked_at:ago(hours+2),lmv_locked_at:ago(hours+1),closed_at:ago(hours),cards,machines_saved:machines});
 const recent=buildRecentActivity({now:NOW,batches:[
  batch('j1','CMLL/JAYANT OC/3RD -NOV-26/S1/B01','Jayant OC','2026-11-03','I',1,300,65),
  batch('d1','CMLL/DUDHICHUA OC/4TH -NOV-26/S1/B01','Dudhichua OC','2026-11-04','I',2,140,32),
  batch('d2','CMLL/DUDHICHUA OC/3RD -NOV-26/S3/B01','Dudhichua OC','2026-11-03','III',5,133,31),
  batch('s1','CMLL/SASTI OC/4TH -NOV-26/S3/B01','Sasti OC','2026-11-04','III',20,149,39)]});
 const front=await panelHtml(recent);
 assert.match(front,/aria-label="ELB shifts completed, last 24 hours: 4"/);assert.match(front,/aria-label="ELB shifts completed, last 6 hours: 3"/);
 assert.ok(!front.includes('CMLL/')&&!/\d (ELB cards|trip cards|LMV log books)/.test(plain(front)),'no batch numbers and no card totals under the figures');
 // ELB in 24 hours: the site with the most shifts on top, its batches under it with the latest first, then the total.
 let html=await panelHtml(recent,{row:'elb',hours:24});
 assert.match(plain(html),/4 ELB shifts completed · 167 ELB cards/);
 assert.deepEqual(listRows(html).map(row=>[...row.slice(0,4),row[5]]),[
  ['Site and batch number','Card date','Shift','ELB cards','How long ago'],
  ['Dudhichua OC 2 shifts','','','63',''],
  ['CMLL/DUDHICHUA OC/4TH -NOV-26/S1/B01','04-11-26','Shift 1','32','2 h 0 min ago'],
  ['CMLL/DUDHICHUA OC/3RD -NOV-26/S3/B01','03-11-26','Shift 3','31','5 h 0 min ago'],
  ['Jayant OC 1 shift','','','65',''],
  ['CMLL/JAYANT OC/3RD -NOV-26/S1/B01','03-11-26','Shift 1','65','1 h 0 min ago'],
  ['Sasti OC 1 shift','','','39',''],
  ['CMLL/SASTI OC/4TH -NOV-26/S3/B01','04-11-26','Shift 3','39','20 h 0 min ago'],
  ['All sites 4 shifts','','','167','']]);
 assert.equal(listRows(html)[0][4],'Locked at');assert.ok(listRows(html)[2][4],'each batch shows when it was locked');
 // The same list for the trip cards of VLB in 6 hours: only what was locked in those hours.
 html=await panelHtml(recent,{row:'vlb',hours:6});
 assert.deepEqual(listRows(html).map(row=>[row[0],row[3]]),[['Site and batch number','Trip cards'],['Jayant OC 1 shift','300'],['CMLL/JAYANT OC/3RD -NOV-26/S1/B01','300'],['Dudhichua OC 1 shift','140'],['CMLL/DUDHICHUA OC/4TH -NOV-26/S1/B01','140'],['All sites 2 shifts','440']]);
 // One site alone: its batches and its own total, with Back to sites.
 html=await panelHtml(recent,{row:'elb',hours:24,site:'Dudhichua OC'});
 assert.match(plain(html),/Back to sites/);assert.match(plain(html),/2 ELB shifts completed · 63 ELB cards/);
 assert.deepEqual(listRows(html).map(row=>[row[0],row[3]]),[['Batch number','ELB cards'],['CMLL/DUDHICHUA OC/4TH -NOV-26/S1/B01','32'],['CMLL/DUDHICHUA OC/3RD -NOV-26/S3/B01','31'],['Dudhichua OC 2 shifts','63']]);
 // Nothing locked in the hours chosen.
 assert.match(plain(await panelHtml(buildRecentActivity({now:NOW}),{row:'elb',hours:6})),/Nothing was completed in this time\./);
});

test('Batches locked has its own line on the front, and opens the batches with their cards, lock time and who locked them',async()=>{
 // Each batch: VLB locked two hours before the batch lock, LMV one hour before it, and started "started" hours before it.
 const batch=(id,name,site,date,shift,hours,cards,machines,by,started=5,startedBy='')=>({id,name,site,date,shift,created_at:ago(hours+started),vlb_locked_at:ago(hours+2),lmv_locked_at:ago(hours+1),closed_at:ago(hours),cards,machines_saved:machines,locked_by:by,started_by:startedBy});
 const input={now:NOW,batches:[
  batch('j1','CMLL/JAYANT OC/3RD -NOV-26/S1/B01','Jayant OC','2026-11-03','I',1,300,65,'Asha Verma'),
  batch('d1','CMLL/DUDHICHUA OC/4TH -NOV-26/S1/B01','Dudhichua OC','2026-11-04','I',2,140,32,'Ravi Kumar',5,'Asha Verma'),
  batch('d2','CMLL/DUDHICHUA OC/3RD -NOV-26/S3/B01','Dudhichua OC','2026-11-03','III',5,133,31,'',29),
  batch('s1','CMLL/SASTI OC/4TH -NOV-26/S3/B01','Sasti OC','2026-11-04','III',20,149,39,'Asha Verma'),
  // Trip cards and LMV log books locked, the batch itself still open: a completed VLB and LMV shift, not a locked batch.
  {...batch('s2','CMLL/SASTI OC/5TH -NOV-26/S1/B01','Sasti OC','2026-11-05','I',1,90,0,''),closed_at:null}],
  lmvBooks:[{site:'Dudhichua OC',date:'2026-11-04',shift:'S1',count:7},{site:'Jayant OC',date:'2026-11-03',shift:'S1',count:4}]};
 const recent=buildRecentActivity(input);
 const front=await panelHtml(recent);
 assert.match(front,/aria-label="Batches locked, last 6 hours: 3"/);assert.match(front,/aria-label="Batches locked, last 12 hours: 3"/);assert.match(front,/aria-label="Batches locked, last 24 hours: 4"/);
 assert.match(front,/aria-label="VLB shifts completed, last 24 hours: 5"/);
 assert.match(plain(front),/Batches locked whole batch saved and locked 3 3 4$/,'the last line of the front');
 let html=await panelHtml(recent,{row:'batch',hours:24});
 assert.match(html,/aria-label="Batches locked · last 24 hours"/);
 assert.match(plain(html),/4 batches locked · 722 trip cards · 11 LMV log books · 167 ELB cards/);
 assert.deepEqual(listRows(html).map(row=>[...row.slice(0,6),row[8]]),[
  ['Site and batch number','Card date','Shift','Trip cards','LMV log books','ELB cards','Locked by'],
  ['Dudhichua OC 2 batches','','','273','7','63',''],
  ['CMLL/DUDHICHUA OC/4TH -NOV-26/S1/B01','04-11-26','Shift 1','140','7','32','Ravi Kumar'],
  ['CMLL/DUDHICHUA OC/3RD -NOV-26/S3/B01','03-11-26','Shift 3','133','0','31','—'],
  ['Jayant OC 1 batch','','','300','4','65',''],
  ['CMLL/JAYANT OC/3RD -NOV-26/S1/B01','03-11-26','Shift 1','300','4','65','Asha Verma'],
  ['Sasti OC 1 batch','','','149','0','39',''],
  ['CMLL/SASTI OC/4TH -NOV-26/S3/B01','04-11-26','Shift 3','149','0','39','Asha Verma'],
  ['All sites 4 batches','','','722','11','167','']]);
 assert.equal(listRows(html)[0][7],'Locked at');assert.match(listRows(html)[2][7],/11 Nov, 07:30 pm 2 h 0 min ago$/,'the lock time in Indian time, and under it how long ago');
 // Batch start to close: each batch's time with its start time under it; a site's line and the last line show the average.
 assert.deepEqual(listRows(html).map(row=>row[6]),['Batch start to close','17 h 0 min average','5 h 0 min started 11 Nov, 02:30 pm','1 day 5 h 0 min started 10 Nov, 11:30 am','5 h 0 min average','5 h 0 min started 11 Nov, 03:30 pm','5 h 0 min average','5 h 0 min started 10 Nov, 08:30 pm','11 h 0 min average']);
 assert.match(html,/aria-label="Batch start to close, CMLL\/DUDHICHUA OC\/3RD -NOV-26\/S3\/B01: 1 day 5 h 0 min\. Show VLB, LMV and ELB time"/);
 assert.match(plain(html),/or a time to see how much of it was VLB, LMV and ELB\./);
 // Six hours: only the batches locked in those hours.
 html=await panelHtml(recent,{row:'batch',hours:6});
 assert.deepEqual(listRows(html).map(row=>row[0]),['Site and batch number','Dudhichua OC 2 batches','CMLL/DUDHICHUA OC/4TH -NOV-26/S1/B01','CMLL/DUDHICHUA OC/3RD -NOV-26/S3/B01','Jayant OC 1 batch','CMLL/JAYANT OC/3RD -NOV-26/S1/B01','All sites 3 batches']);
 // One site alone, with Back to sites.
 html=await panelHtml(recent,{row:'batch',hours:24,site:'Sasti OC'});
 assert.match(plain(html),/Back to sites/);assert.match(plain(html),/1 batch locked · 149 trip cards · 0 LMV log books · 39 ELB cards/);
 assert.deepEqual(listRows(html).map(row=>[row[0],row[3],row[5]]),[['Batch number','Trip cards','ELB cards'],['CMLL/SASTI OC/4TH -NOV-26/S3/B01','149','39'],['Sasti OC 1 batch','149','39']]);
 // A login with only the vehicle log book: the batches with their trip cards and LMV log books, no ELB column.
 html=await panelHtml(buildRecentActivity({...input,kinds:['vehicle']}),{row:'batch',hours:24});
 assert.deepEqual(listRows(html)[0],['Site and batch number','Card date','Shift','Trip cards','LMV log books','Batch start to close','Locked at','Locked by']);
 assert.match(plain(html),/4 batches locked · 722 trip cards · 11 LMV log books /);assert.ok(!plain(html).includes('ELB cards'));
 // Nothing locked in the hours chosen, and figures read by a browser that still has the earlier server reply.
 assert.match(plain(await panelHtml(buildRecentActivity({now:NOW}),{row:'batch',hours:6})),/Nothing was completed in this time\./);
 const earlier={...recent};delete earlier.batchLocks;delete earlier.locked;assert.ok(!(await panelHtml(earlier)).includes('Batches locked'),'no empty line while an earlier reply is on screen');
 // A reply from the server before this change has no start time: the batch is listed with a dash, and nothing to open.
 const before={...recent,locked:recent.locked.map(({startedAt,closedAt,totalMinutes,stages,startedBy,...row})=>row)};
 html=await panelHtml(before,{row:'batch',hours:24});
 assert.deepEqual(listRows(html).map(row=>row[6]),['Batch start to close','','—','—','','—','','—','']);assert.ok(!html.includes('Show VLB, LMV and ELB time'));
});

test('a batch\'s start to close time opens into the time of VLB, LMV and ELB, which add up to it',async()=>{
 const batch=(id,name,site,hours,started,extra={})=>({id,name,site,date:'2026-11-03',shift:'III',created_at:ago(hours+started),vlb_locked_at:ago(hours+2),lmv_locked_at:ago(hours+1),closed_at:ago(hours),cards:133,machines_saved:31,locked_by:'',started_by:'',...extra});
 const input={now:NOW,batches:[
  batch('d1','CMLL/DUDHICHUA OC/4TH -NOV-26/S1/B01','Dudhichua OC',2,5,{locked_by:'Ravi Kumar',started_by:'Asha Verma'}),
  batch('d2','CMLL/DUDHICHUA OC/3RD -NOV-26/S3/B01','Dudhichua OC',5,29),
  // Saved and locked in one step, the older way: no VLB and LMV lock times.
  batch('m1','CMLL/MAJRI OC/3RD -NOV-26/S3/B01','Majri OC',3,4,{vlb_locked_at:null,lmv_locked_at:null})],
  lmvBooks:[{site:'Dudhichua OC',date:'2026-11-03',shift:'S3',count:7}]};
 const recent=buildRecentActivity(input);
 let html=await panelHtml(recent,{row:'batch',hours:24,batch:'d2'});
 assert.match(html,/aria-label="Batch start to close · CMLL\/DUDHICHUA OC\/3RD -NOV-26\/S3\/B01"/);
 assert.match(plain(html),/Dudhichua OC · card date 03-11-26 · Shift 3\./);
 assert.match(plain(html),/Batch start to close: 1 day 5 h 0 min · started 10 Nov, 11:30 am · locked 11 Nov, 04:30 pm/);
 assert.deepEqual(listRows(html),[
  ['Stage','From','To','Time taken','Cards'],
  ['VLB batch start to VLB lock','10 Nov, 11:30 am','11 Nov, 02:30 pm','1 day 3 h 0 min','133 trip cards'],
  ['LMV VLB lock to LMV lock','11 Nov, 02:30 pm','11 Nov, 03:30 pm','1 h 0 min','7 LMV log books'],
  ['ELB LMV lock to batch lock','11 Nov, 03:30 pm','11 Nov, 04:30 pm','1 h 0 min','31 ELB cards'],
  ['Batch start to close VLB + LMV + ELB','10 Nov, 11:30 am','11 Nov, 04:30 pm','1 day 5 h 0 min','']]);
 assert.match(plain(html),/The three add up to the batch start to close time\./);
 // One Back, to the batches; the 6, 12 and 24 hour buttons belong to the list, not to one batch.
 const opened=plain(html.slice(html.indexOf('<section')));
 assert.match(opened,/Back to batches/);assert.ok(!opened.includes('Back to sites')&&!opened.includes('Last 6 hours'));
 // Who started the batch and who locked it, where known.
 html=await panelHtml(recent,{row:'batch',hours:24,site:'Dudhichua OC',batch:'d1'});
 assert.match(plain(html),/Batch start to close: 5 h 0 min · started 11 Nov, 02:30 pm by Asha Verma · locked 11 Nov, 07:30 pm by Ravi Kumar/);
 assert.deepEqual(listRows(html).map(row=>row[3]),['Time taken','3 h 0 min','1 h 0 min','1 h 0 min','5 h 0 min']);
 // Locked in one step: the whole time, and a line saying why it is not divided.
 html=await panelHtml(recent,{row:'batch',hours:24,batch:'m1'});
 assert.match(plain(html),/Batch start to close: 4 h 0 min · started/);assert.match(plain(html),/saved and locked in one step/);assert.deepEqual(listRows(html),[]);
 // A login with only the vehicle log book sees the three times, without the ELB cards.
 html=await panelHtml(buildRecentActivity({...input,kinds:['vehicle']}),{row:'batch',hours:24,batch:'d2'});
 assert.deepEqual(listRows(html).map(row=>[row[3],row[4]]),[['Time taken','Cards'],['1 day 3 h 0 min','133 trip cards'],['1 h 0 min','7 LMV log books'],['1 h 0 min','—'],['1 day 5 h 0 min','']]);
 // A batch that the latest read no longer holds: the list shows again.
 html=await panelHtml(recent,{row:'batch',hours:24,batch:'gone'});
 assert.equal(listRows(html)[0][0],'Site and batch number');assert.match(html,/aria-label="Batches locked · last 24 hours"/);
});

test('VLB, LMV and ELB time are whole minutes between the clock times shown, and always add up to batch start to close',()=>{
 const at=clock=>'2026-11-12T'+clock+'Z';
 const times=batchStageTimes({created_at:at('14:40:50'),vlb_locked_at:at('16:32:10'),lmv_locked_at:at('16:50:59'),closed_at:at('20:03:05')});
 assert.equal(times.totalMinutes,323);assert.equal(durationLabel(times.totalMinutes),'5 h 23 min');
 assert.deepEqual(times.stages.map(stage=>[stage.key,stage.minutes]),[['vlb',112],['lmv',18],['elb',193]]);
 assert.deepEqual([times.startedAt,times.closedAt],[at('14:40:00.000'),at('20:03:00.000')],'seconds are cut, so a figure is the difference of the two times shown');
 assert.deepEqual(times.stages.map(stage=>[stage.from,stage.to]),[[at('14:40:00.000'),at('16:32:00.000')],[at('16:32:00.000'),at('16:50:00.000')],[at('16:50:00.000'),at('20:03:00.000')]],'each stage starts where the one before it ends');
 // Locked in one step: the whole time only. No start time: nothing to show.
 assert.deepEqual(batchStageTimes({created_at:at('10:00:00'),vlb_locked_at:null,lmv_locked_at:null,closed_at:at('12:30:00')}),{startedAt:at('10:00:00.000'),closedAt:at('12:30:00.000'),totalMinutes:150,stages:[]});
 assert.deepEqual(batchStageTimes({closed_at:at('12:30:00')}),{startedAt:'',closedAt:'',totalMinutes:null,stages:[]});
 assert.equal(batchStageTimes({created_at:at('13:00:00'),closed_at:at('12:30:00')}).totalMinutes,null);
 // A lock time out of its place is held inside the batch: the three still add up.
 assert.deepEqual(batchStageTimes({created_at:at('10:00:00'),vlb_locked_at:at('13:00:00'),lmv_locked_at:at('12:00:00'),closed_at:at('14:00:00')}).stages.map(stage=>stage.minutes),[180,0,60]);
 assert.deepEqual(batchStageTimes({created_at:at('10:00:00'),vlb_locked_at:at('09:00:00'),lmv_locked_at:at('15:00:00'),closed_at:at('14:00:00')}).stages.map(stage=>stage.minutes),[0,240,0]);
 // Any four times: VLB + LMV + ELB is the batch start to close time, to the minute.
 let seed=7;const next=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
 for(let i=0;i<500;i++){
  const start=NOW-Math.floor(next()*20*86400000),moments=[next(),next(),next()].map(part=>new Date(start+Math.floor(part*9*86400000)).toISOString());
  if(i%2===0)moments.sort();
  const result=batchStageTimes({created_at:new Date(start).toISOString(),vlb_locked_at:moments[0],lmv_locked_at:moments[1],closed_at:[...moments].sort()[2]});
  assert.equal(result.stages.reduce((sum,stage)=>sum+stage.minutes,0),result.totalMinutes);assert.ok(result.stages.every(stage=>stage.minutes>=0));
 }
 assert.deepEqual([0,45,60,323,1440,3072,null,undefined,''].map(durationLabel),['0 min','45 min','1 h 0 min','5 h 23 min','1 day 0 h 0 min','2 days 3 h 12 min','—','—','—']);
 assert.equal(averageLockMinutes([{totalMinutes:100},{totalMinutes:201},{totalMinutes:null},{}]),151);assert.equal(averageLockMinutes([{totalMinutes:null}]),null);assert.equal(averageLockMinutes([]),null);
 // The list of locked batches carries the time of each batch.
 const recent=buildRecentActivity({now:NOW,batches:[{id:'a',name:'A',site:'Sasti OC',date:'2026-11-02',shift:'I',created_at:ago(9),vlb_locked_at:ago(6),lmv_locked_at:ago(5.5),closed_at:ago(1),cards:4,machines_saved:2,started_by:'Asha',locked_by:'Ravi'}]});
 assert.deepEqual(locksIn(recent,6).map(row=>[row.startedBy,row.lockedBy,row.totalMinutes,row.stages.map(stage=>stage.minutes)]),[['Asha','Ravi',480,[180,30,270]]]);
});
