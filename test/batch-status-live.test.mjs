import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {buildWorkingNow,buildRecentLocks,siteLiveCells,siteLockCells,lastLockLabel,batchLiveCell,liveSummary,agoLabel,WORKING_NOW_MINUTES,LAST_ACTION_HOURS,LIVE_REFRESH_MS} from '../shared/batch-status-live.mjs';
import {registerBatchStatusReport} from '../server/routes/batch-status-report-api.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {displaySiteName} from '../shared/region-scope.mjs';

const now=new Date('2026-11-11T10:00:00+05:30').getTime();
const ago=minutes=>new Date(now-minutes*60000).toISOString();
const W='00000000-0000-4000-8000-00000000000f',A='00000000-0000-4000-8000-00000000000a',B='00000000-0000-4000-8000-00000000000b',J='00000000-0000-4000-8000-00000000000c';
const sasti=canonicalSiteName('Sasti'),jayant=canonicalSiteName('Jayant');

test('working now means a save in a batch within the last 10 minutes; last action looks back one day',()=>{
 assert.equal(WORKING_NOW_MINUTES,10);assert.equal(LAST_ACTION_HOURS,24);assert.equal(LIVE_REFRESH_MS,60000);
 const actions=[
  {actor:'ramesh',action:'card_added',at:ago(2),batchId:A,batchName:'SASTI-S1',site:'Sasti',date:'2026-11-11',shift:'S1'},
  {actor:'Ramesh',action:'card_added',at:ago(6),batchId:A,batchName:'SASTI-S1',site:'Sasti',date:'2026-11-11',shift:'S1'},
  {actor:'sunil',action:'machine_saved',at:ago(9),batchId:B,batchName:'SASTI-S3',site:'Sasti',date:'2026-11-10',shift:'S3'},
  {actor:'old.hand',action:'card_added',at:ago(11),batchId:A,batchName:'SASTI-S1',site:'Sasti',date:'2026-11-11',shift:'S1'},
  {actor:'night',action:'vlb_locked',at:ago(5*60),batchId:J,batchName:'JAYANT-S3',site:'Jayant',date:'2026-11-10',shift:'S3'},
  {actor:'ancient',action:'card_added',at:ago(25*60),batchId:J,site:'Jayant',date:'2026-11-09',shift:'S1'},
  {actor:'',action:'card_added',at:ago(1),batchId:A,site:'Sasti',date:'2026-11-11',shift:'S1'}];
 const live=buildWorkingNow({now,actions,names:{ramesh:'Ramesh Kumar'}});
 assert.equal(live.count,2,'Ramesh (two saves, either spelling) and Sunil; 11 minutes ago is not working now');
 assert.deepEqual(live.people.map(p=>[p.name,p.saves,p.stage,p.minutesAgo,p.shiftLabel]),[['Ramesh Kumar',2,'VLB',2,'Shift 1'],['sunil',1,'ELB',9,'Shift 3']]);
 assert.equal(live.people[0].site,displaySiteName('Sasti'));assert.equal(live.people[0].dateLabel,'11-11-26');
 assert.deepEqual(live.sites[sasti],{working:['Ramesh Kumar','sunil'],count:2,lastAt:ago(2),minutesAgo:2},'a history line with no person is ignored');
 assert.deepEqual([live.sites[jayant].count,live.sites[jayant].minutesAgo],[0,300]);
 assert.deepEqual(live.batches[A],{working:['Ramesh Kumar'],stage:'VLB'});
 assert.equal(live.batches[J],undefined);
});

test('Live now lists people site by site (A to Z), the latest save first inside a site',()=>{
 const actions=[
  {actor:'sasti.late',action:'card_added',at:ago(1),batchId:A,site:'Sasti',date:'2026-11-11',shift:'S1'},
  {actor:'jayant.early',action:'card_added',at:ago(8),batchId:J,site:'Jayant',date:'2026-11-11',shift:'S1'},
  {actor:'sasti.early',action:'card_added',at:ago(7),batchId:B,site:'Sasti',date:'2026-11-10',shift:'S3'},
  {actor:'jayant.late',action:'card_added',at:ago(2),batchId:J,site:'Jayant',date:'2026-11-11',shift:'S1'}];
 const live=buildWorkingNow({now,actions});
 assert.equal(displaySiteName('Jayant').localeCompare(displaySiteName('Sasti'))<0,true);
 assert.deepEqual(live.people.map(p=>p.login),['jayant.late','jayant.early','sasti.late','sasti.early']);
});

test('batches locked in the last 6, 12 and 24 hours and the last lock, site by site and for all sites',()=>{
 const locks=buildRecentLocks({now,rows:[
  {site:'Sasti',h6:1,h12:2,h24:3,last_at:ago(90)},{site:'SASTI OC',h6:0,h12:0,h24:1,last_at:ago(20*60)},
  {site:'Jayant',h6:0,h12:0,h24:0,last_at:ago(31*60)},{site:'',h6:9,h12:9,h24:9,last_at:ago(1)}]});
 assert.deepEqual(locks[sasti],{h6:1,h12:2,h24:4,lastAt:ago(90),minutesAgo:90},'two spellings of one site add up; the latest lock wins');
 assert.deepEqual(locks[jayant],{h6:0,h12:0,h24:0,lastAt:ago(31*60),minutesAgo:31*60},'saving all day but nothing locked in 24 hours');
 assert.equal(Object.keys(locks).length,2,'a row without a site is left out');
 const live={...buildWorkingNow({now,actions:[]}),locks};
 assert.deepEqual(siteLockCells(null,sasti),{locksRead:false});
 assert.deepEqual(siteLockCells(live,jayant),{locksRead:true,locked6:0,locked12:0,locked24:0,lastLockMinutes:1860});
 assert.deepEqual(siteLockCells(live,''),{locksRead:true,locked6:1,locked12:2,locked24:4,lastLockMinutes:90},'ALL SITES');
 assert.deepEqual(siteLockCells(live,'nowhere'),{locksRead:true,locked6:0,locked12:0,locked24:0,lastLockMinutes:null},'never locked');
 assert.deepEqual([lastLockLabel(null),lastLockLabel(0),lastLockLabel(90),lastLockLabel(1860),lastLockLabel(3000)],['—','just now','1 h 30 min ago','1 day 7 h 0 min ago','2 days 2 h 0 min ago']);
});

test('the cells read plainly before, with and without live figures',()=>{
 const live=buildWorkingNow({now,actions:[{actor:'ramesh',action:'card_added',at:ago(3),batchId:A,site:'Sasti',date:'2026-11-11',shift:'S1'},{actor:'night',action:'lmv_saved',at:ago(90),site:'Jayant',date:'2026-11-10',shift:'S3'}]});
 assert.deepEqual(siteLiveCells(null,sasti),{workingNow:'…',lastAction:'…'});
 assert.deepEqual(siteLiveCells(live,sasti),{workingNow:'1 · ramesh',lastAction:'3 min ago',workingCount:1});
 assert.deepEqual(siteLiveCells(live,jayant),{workingNow:'—',lastAction:'1 h 30 min ago',workingCount:0});
 assert.deepEqual(siteLiveCells(live,'nowhere'),{workingNow:'—',lastAction:'—',workingCount:0});
 assert.deepEqual(siteLiveCells(live,''),{workingNow:'1',lastAction:'3 min ago',workingCount:1},'ALL SITES');
 assert.equal(batchLiveCell(live,A),'ramesh (VLB)');assert.equal(batchLiveCell(live,B),'—');assert.equal(batchLiveCell(null,A),'…');
 assert.equal(agoLabel(0),'just now');
 assert.match(liveSummary(live),/^1 person is working now at 1 site/);
 assert.match(liveSummary(buildWorkingNow({now,actions:[]})),/Nobody has saved anything in a batch in the last 10 minutes/);
});

test('the live route reads only permitted sites, matches LMV books to their batch and never changes data',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT,book_date DATE,site TEXT,asset_id BIGINT,data JSONB,created_by TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),deleted_at TIMESTAMPTZ);
  CREATE TABLE mis_vlb_batches(id UUID PRIMARY KEY,name TEXT,site TEXT,book_date DATE,shift TEXT,stage TEXT,created_at TIMESTAMPTZ,vlb_locked_at TIMESTAMPTZ,lmv_locked_at TIMESTAMPTZ,closed_at TIMESTAMPTZ,creator_login TEXT,created_by TEXT,deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ);
  CREATE TABLE mis_vlb_batch_audit(id BIGSERIAL PRIMARY KEY,batch_id UUID,actor TEXT,action TEXT,occurred_at TIMESTAMPTZ,detail JSONB DEFAULT '{}');`);
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Users & employees',$1),('Users & employees',$2)",[JSON.stringify({login:'Ramesh',employee:'Ramesh Kumar',phone:'secret-phone'}),JSON.stringify({login:'lmv.clerk',name:'LMV CLERK'})]);
 const deleted='00000000-0000-4000-8000-00000000000d';
 for(const [id,name,site,date,shift,del] of [[A,'SASTI-S1','Sasti','2026-11-11','S1',null],[B,'SASTI-S3','Sasti','2026-11-10','S3',null],[J,'JAYANT-S1','Jayant','2026-11-11','S1',null],[W,'SASTI-2ND NOV-S2','Sasti','2026-11-02','S2',null],[deleted,'GONE','Sasti','2026-11-11','S2',ago(30)]])
  await db.query('INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,stage,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,name,site,date,shift,'vlb_open',del]);
 // The route compares with the server clock, so the history is written relative to the database's NOW().
 const rows=[[A,'ramesh','card_added',2],[A,'ramesh','card_updated',4],[B,'sunil','machine_saved',30],[J,'jayant.op','card_added',1],[deleted,'ghost','card_added',1],[W,'late.entry','card_added',1],[A,'yesterday','card_added',26*60]];
 for(const [batch,actor,action,minutes] of rows)await db.query(`INSERT INTO mis_vlb_batch_audit(batch_id,actor,action,occurred_at,detail) VALUES($1,$2,$3,NOW()-($4::int*INTERVAL '1 minute'),'{"private":"must-not-leak"}')`,[batch,actor,action,minutes]);
 await db.query(`INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,created_by,created_at) VALUES('CAL/LMV/1','lmv',$1,'Sasti',1,$2,'lmv.clerk',NOW()-INTERVAL '3 minutes')`,[new Date(Date.now()+19800000).toISOString().slice(0,10),JSON.stringify({location:'Sasti',bookShiftCode:'S1',private:'must-not-leak'})]);
 // Sites enter shifts a week late: a save now into a 2 Nov batch is work happening now.
 await db.query(`INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,created_by,created_at) VALUES('CAL/LMV/2','lmv','2026-11-02','Sasti',1,$1,'lmv.late',NOW()-INTERVAL '5 minutes')`,[JSON.stringify({location:'Sasti',bookShiftCode:'S2'})]);
 await db.query('UPDATE mis_vlb_batches SET book_date=$1 WHERE id=ANY($2::uuid[])',[new Date(Date.now()+19800000).toISOString().slice(0,10),[A,J]]);
 // Locks are counted by their own time: a 2 Nov batch locked 20 hours ago is inside the last 24 hours; a deleted batch never counts.
 for(const [id,hours] of [[B,2],[W,20],[deleted,1]])await db.query(`UPDATE mis_vlb_batches SET closed_at=NOW()-($2::int*INTERVAL '1 hour') WHERE id=$1`,[id,hours]);
 const statements=[],query=(sql,args)=>{statements.push(sql);return db.query(sql,args);},pool={query,connect:async()=>({query,release(){}})};
 const app=express();const auth=(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.logBookScope=req.headers.authorization==='admin'?{sites:null}:{sites:[sasti]};next();};
 registerBatchStatusReport(app,{pool,protect:[auth],ensureBooks:async()=>{}});app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
 const call=(token='reader')=>fetch(`http://127.0.0.1:${server.address().port}/api/reports/batch-status/live`,{headers:token?{Authorization:token}:{}});
 assert.equal((await call('')).status,401);
 let response=await call(),live=await response.json();assert.equal(response.status,200,JSON.stringify(live));assert.match(response.headers.get('cache-control'),/no-store/);
 assert.deepEqual(live.people.map(p=>[p.name,p.saves,p.stage,p.batchId]).sort(),[['LMV CLERK',1,'LMV',A],['Ramesh Kumar',2,'VLB',A],['late.entry',1,'VLB',W],['lmv.late',1,'LMV',W]],'LMV books matched to their batch, including a week-old batch; 30 minutes ago is not working now; deleted batch and other site left out');
 assert.equal(live.count,4);assert.deepEqual(Object.keys(live.sites),[sasti],'Jayant is not shown to a Sasti login');
 assert.equal(live.sites[sasti].minutesAgo,1);
 assert.deepEqual(Object.keys(live.locks),[sasti]);
 assert.deepEqual([live.locks[sasti].h6,live.locks[sasti].h12,live.locks[sasti].h24,live.locks[sasti].minutesAgo],[1,1,2,120]);
 assert.equal(JSON.stringify(live).includes('must-not-leak')||JSON.stringify(live).includes('secret-phone'),false);
 live=await (await call('admin')).json();assert.equal(live.count,5);assert.equal(live.sites[jayant].count,1);
 assert.equal(statements.some(sql=>/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(sql)),false,'the live route only reads');
});

test('the screen shows Live now, Working now and Last action, refreshing once a minute only while on screen',()=>{
 const source=readFileSync(new URL('../src/batch-status-report.jsx',import.meta.url),'utf8');
 assert.match(source,/column\('site','Site'\),column\('workingNow','Working now'\),column\('lastAction','Last action'\)/);
 assert.match(source,/column\('stageLabel','Stage now',null,stageBadge\),column\('workingNow','Working now'\)/);
 assert.match(source,/startVisiblePoll\(\(\)=>request\('\/api\/reports\/batch-status\/live',session\.token,c\.signal\)/);
 assert.match(source,/,LIVE_REFRESH_MS\);/);
 assert.match(source,/<ReportSection key="bs-live" title=\{'Live now · '/);
 assert.match(source,/report\.sites\.map\(s=>\(\{\.\.\.s,\.\.\.siteLiveCells\(live,s\.siteKey\),\.\.\.siteLockCells\(live,s\.siteKey\)\}\)\)/);
 // 13 Nov 2026: the owner removed Of which today's shifts and VLB / LMV / ELB open from Step 1 (still one click away in Step 2).
 const step1=source.slice(source.indexOf('export const siteColumns'),source.indexOf('export const shiftColumns'));
 for(const gone of ["Of which today's shifts","'VLB open'","'LMV open'","'ELB open'"])assert.equal(step1.includes(gone),false,gone);
 assert.match(step1,/lastLockColumn,\.\.\.RECENT_WINDOWS\.map\(lockColumn\)/);
 assert.match(source,/listed\.map\(r=>\(\{\.\.\.r,workingNow:batchLiveCell\(live,r\.batchId\)\}\)\)/);
 assert.doesNotMatch(source,/setInterval\(/);
 const policy=readFileSync(new URL('../server/rules/vlb-batch-policy.mjs',import.meta.url),'utf8');
 assert.match(policy,/CREATE INDEX IF NOT EXISTS mis_vlb_batch_audit_occurred_idx ON mis_vlb_batch_audit\(occurred_at DESC\)/);
});
