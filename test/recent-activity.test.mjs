import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import express from 'express';import {PGlite} from '@electric-sql/pglite';
import {registerLogBookDashboard} from '../server/routes/log-book-dashboard.mjs';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {transformWithOxc} from 'vite';
import * as recentRules from '../shared/recent-activity.mjs';
import {buildRecentActivity,batchCompletionTimes,completedIn,completedBySite,cardsInside,logShiftsFor,recentSiteRows,recentWindow} from '../shared/recent-activity.mjs';

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
   CREATE TABLE mis_vlb_batches(id TEXT PRIMARY KEY,name TEXT,site TEXT,book_date DATE,shift TEXT,vlb_locked_at TIMESTAMPTZ,lmv_locked_at TIMESTAMPTZ,closed_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ);
   CREATE TABLE mis_vlb_batch_entries(batch_id TEXT,logbook_id BIGINT);CREATE TABLE mis_vlb_batch_fleet(batch_id TEXT,asset_id BIGINT,logbook_id BIGINT);`);
  const book=(type,site,hours,extra={})=>db.query('INSERT INTO mis_log_books(book_no,book_type,book_date,site,data,created_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[type+hours,type,extra.date||'2026-11-03',site,JSON.stringify(extra.data||{}),ago(hours),extra.deleted||null]);
  // Cards dated 3 Nov but saved today: the save time decides.
  await book('vehicle','Sasti OC',1);await book('vehicle','Sasti OC',8);await book('vehicle','Sasti OC',20);await book('vehicle','Sasti OC',30);
  await book('vehicle','Sasti OC',2,{deleted:ago(1)});await book('equipment','Jayant OC',5);await book('lmv','x',3,{data:{location:'Sasti OC',bookShiftCode:'S1'}});
  await book('vehicle','Sasti OC',1,{date:'2026-10-30'});
  // An LMV log book of Jayant's shift, saved two days ago: outside the 24 hours, inside the shift locked today.
  await book('lmv','y',40,{data:{location:'Jayant OC',cardShift:'I'}});
  // Batch "one" holds trip cards 1 and 2 and the deleted card 5; batch "two" has one machine saved and one still open.
  await db.exec(`INSERT INTO mis_vlb_batch_entries VALUES('one',1),('one',2),('one',5);INSERT INTO mis_vlb_batch_fleet VALUES('two',11,6),('two',12,NULL);`);
  const batch=(id,site,vlb,lmv,closed,extra={})=>db.query('INSERT INTO mis_vlb_batches VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,site,'2026-11-03','I',vlb,lmv,closed,extra.deleted||null,extra.archived||null]);
  await batch('one','Sasti OC',ago(4),null,null);await batch('two','Jayant OC',ago(30),ago(11),ago(9));await batch('gone','Sasti OC',ago(1),ago(1),ago(1),{deleted:ago(1)});
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
  // A site opens into its cards by card date and shift.
  assert.deepEqual(result.body.logShifts.filter(r=>r.site==='Sasti OC').map(r=>[r.dateLabel,r.shift,r.counts[24].total]),[['03-11-26','S1',1],['03-11-26','',3]]);
  result=await get('/recent',{'x-scope':'sasti'});assert.deepEqual(result.body.logs[24],{total:4,vehicle:3,lmv:1,equipment:0});assert.deepEqual(result.body.shifts[24],{vlb:1,lmv:0,elb:0});
  assert.deepEqual(result.body.completed.map(r=>[r.kind,r.batchName,r.cards]),[['vlb','one',2]]);
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
 assert.match(panel,/shiftSites=open&&!logs\?completedBySite\(recent,open\.row,open\.hours\):\[\]/);
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
