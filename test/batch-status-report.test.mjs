import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {batchStatusFilters,buildBatchStatusReport,buildBatchDetail,shiftEndTime,workingMinutes,sitesInsights,shiftsInsight,rankSites,ratingOf} from '../shared/batch-status-report.mjs';
import {registerBatchStatusReport} from '../server/routes/batch-status-report-api.mjs';
import {displaySiteName} from '../shared/region-scope.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {operationReports,buildOperationReport} from '../src/operations-report-model.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';

const at=(day,clock)=>new Date(`2026-11-${day}T${clock}:00+05:30`);
const shifts=[{id:'1',site:'Sasti',shiftCode:'A',startTime:'05:00',endTime:'13:00'},{id:'2',site:'Sasti',shiftCode:'B',startTime:'13:00',endTime:'21:00'},{id:'3',site:'Sasti',shiftCode:'C',startTime:'21:00',endTime:'05:00'}];
const A='00000000-0000-4000-8000-00000000000a',B='00000000-0000-4000-8000-00000000000b',C='00000000-0000-4000-8000-00000000000c';
const batches=[
 {id:A,name:'SASTI OC-1ST NOV-S1',site:'Sasti',date:'2026-11-01',shift:'S1',stage:'closed',created_at:at('01','16:10'),vlb_locked_at:at('01','17:30'),lmv_locked_at:at('01','17:40'),closed_at:at('01','21:00'),created_by:'operator.one',cards:6,machines_total:2,machines_saved:2},
 {id:B,name:'SASTI OC-1ST NOV-S2',site:'Sasti',date:'2026-11-01',shift:'S2',stage:'lmv_open',created_at:at('02','08:00'),vlb_locked_at:at('02','09:00'),lmv_locked_at:null,closed_at:null,created_by:'operator.two',cards:4,machines_total:0,machines_saved:0},
 {id:C,name:'SASTI OC-1ST NOV-S3',site:'Sasti',date:'2026-11-01',shift:'S3',stage:'vlb_open',created_at:at('02','10:00'),vlb_locked_at:null,lmv_locked_at:null,closed_at:null,created_by:'operator.one',cards:1,machines_total:0,machines_saved:0}];
const eventsA=[['created','16:10'],['card_added','16:19'],['card_added','16:23'],['card_added','16:29'],['card_added','16:32'],['card_added','17:20'],['card_added','17:24'],['vlb_locked','17:30'],['lmv_locked','17:40'],['machine_saved','17:47'],['machine_saved','20:50'],['saved_and_locked','21:00']]
 .map(([action,clock])=>({batch_id:A,action,actor:'operator.one',at:at('01',clock),item:action==='card_added'?'CAL/VLB/011126/S1/0001 · V9001':action==='machine_saved'?'EX9001':''}));
const events=[...eventsA,{batch_id:B,action:'created',actor:'operator.two',at:at('02','08:00')},{batch_id:B,action:'vlb_locked',actor:'operator.two',at:at('02','09:00')},
 {batch_id:C,action:'created',actor:'operator.one',at:at('02','10:00')},{batch_id:C,action:'vlb_locked',actor:'operator.one',at:at('02','10:30')},{batch_id:C,action:'vlb_unlocked',actor:'site.pm',at:at('02','11:00')}];
const lmvBooks=[{book_no:'CAL/LMV/01-11-26/001',site:'Sasti',date:'2026-11-01',shift:'S1',at:at('01','17:36'),by:'operator.one'}];
const input={from:'2026-11-01',to:'2026-11-02',now:at('03','09:00').getTime(),siteStarts:[{site:'Sasti',firstDate:'2026-11-01'},{site:'Jayant',firstDate:'2026-11-02'}],shifts,batches,events,lmvBooks};

test('filters accept an operational range of at most 31 days',()=>{
 assert.deepEqual(batchStatusFilters({from:'2026-11-01',to:'2026-11-09'}),{from:'2026-11-01',to:'2026-11-09'});
 for(const query of [{},{from:'2026-10-31',to:'2026-11-02'},{from:'2026-11-05',to:'2026-11-02'},{from:'2026-11-01',to:'2026-12-02'},{from:'2026-11-31',to:'2026-12-01'}])assert.throws(()=>batchStatusFilters(query),e=>e.status===400);
});

test('a shift ends by the Shift Master in India time, on the next day when it crosses midnight',()=>{
 assert.equal(shiftEndTime(shifts,'Sasti','S1','2026-11-01'),at('01','13:00').getTime());
 assert.equal(shiftEndTime(shifts,'Sasti','S3','2026-11-01'),at('02','05:00').getTime());
 assert.equal(shiftEndTime([],'Jayant','S2','2026-11-01'),at('01','21:00').getTime(),'three-shift default without a Shift Master row');
 assert.equal(shiftEndTime([],'Jayant','D','2026-11-01'),null,'no guess for a day shift without a Shift Master row');
});

test('working time counts only the gaps up to the idle limit',()=>{
 const minute=60000;
 assert.equal(workingMinutes([0,5*minute,15*minute,26*minute,30*minute]),5+10+4);
 assert.equal(workingMinutes([]),0);assert.equal(workingMinutes([7]),0);
});

test('every due shift is counted once, at the stage where it stands',()=>{
 const report=buildBatchStatusReport(input),sasti=report.sites.find(s=>s.site===displaySiteName('Sasti')),jayant=report.sites.find(s=>s.site===displaySiteName('Jayant'));
 assert.deepEqual([sasti.due,sasti.locked,sasti.balance,sasti.notCreated,sasti.vlbOpen,sasti.lmvOpen,sasti.elbOpen],[6,1,5,3,1,1,0]);
 assert.equal(sasti.balance,sasti.notCreated+sasti.vlbOpen+sasti.lmvOpen+sasti.elbOpen);
 assert.equal(sasti.oldestPending,'01-11-26 Shift 2');assert.equal(sasti.withinTargetPercent,100);assert.equal(sasti.averageLockHours,8);assert.equal(sasti.slowestStage,'ELB');assert.equal(sasti.rework,1);
 assert.deepEqual([jayant.due,jayant.notCreated],[3,3],'a site is counted from the date of its first batch');
 assert.deepEqual([report.total.due,report.total.locked,report.total.balance],[9,1,8]);
 const locked=report.shifts.find(r=>r.batchId===A);
 assert.deepEqual([locked.stage,locked.waitHours,locked.vlbHours,locked.lmvHours,locked.elbHours,locked.lockHours,locked.pendingHours],['locked',3.2,1.3,0.2,3.3,8,null]);
 assert.equal(locked.workHours,1,'59 minutes of work, including the LMV log book saved for that shift');
 assert.deepEqual([locked.cards,locked.lmvBooks,locked.machinesSaved,locked.machinesTotal,locked.enteredBy],[6,1,2,2,'operator.one']);
 const lmvOpen=report.shifts.find(r=>r.batchId===B);
 assert.deepEqual([lmvOpen.stage,lmvOpen.pendingHours,lmvOpen.vlbHours,lmvOpen.lmvHours,lmvOpen.lockHours,lmvOpen.machinesTotal],['lmv_open',36,1,null,null,null]);
 const reopened=report.shifts.find(r=>r.batchId===C);
 assert.deepEqual([reopened.stage,reopened.vlbHours,reopened.rework],['vlb_open',null,1],'an unlocked VLB stage has no lock time');
 assert.equal(report.shifts.filter(r=>r.stage==='none').every(r=>r.batchId===''&&r.cards===null),true);
});

test('a shift whose end time has not passed is not yet due',()=>{
 const report=buildBatchStatusReport({...input,now:at('02','14:00').getTime()});
 assert.equal(report.sites.find(s=>s.site===displaySiteName('Sasti')).due,4,'1 Nov three shifts and 2 Nov Shift 1');
 assert.equal(report.shifts.some(r=>r.date==='2026-11-02'&&r.shift==='S2'),false);
});

test('a shift of today is counted the moment it ends, and the report says how many are in',()=>{
 const sastiAt=clock=>{const report=buildBatchStatusReport({...input,now:at('02',clock).getTime()}),s=report.sites.find(s=>s.site===displaySiteName('Sasti'));return [s.due,s.todayCounted,s.todayShifts,report.today];};
 assert.deepEqual(sastiAt('12:59'),[3,0,3,'2026-11-02'],'Shift 1 of today has not ended');
 assert.deepEqual(sastiAt('13:00'),[4,1,3,'2026-11-02']);
 assert.deepEqual(sastiAt('21:30'),[5,2,3,'2026-11-02']);
 const report=buildBatchStatusReport({...input,now:at('02','14:00').getTime()});
 assert.deepEqual([report.total.todayCounted,report.total.todayShifts],[2,6]);
 assert.equal(sitesInsights(report.sites,report.total).includes("Today's shifts are counted as soon as they end: 2 of today's 6 site shifts are already in Shifts due."),true);
 const past=buildBatchStatusReport(input);
 assert.deepEqual([past.today,past.sites[0].todayShifts,past.total.todayShifts],['',null,null],'a range that does not include today shows no today figure');
});

test('sites are ranked by the share of due shifts locked and rated green, orange or red',()=>{
 const report=buildBatchStatusReport(input);
 assert.deepEqual(report.sites.map(s=>[s.site,s.rank,s.percentDone,s.rating,s.ratingLabel]),[[displaySiteName('Sasti'),1,17,'poor','Poor'],[displaySiteName('Jayant'),2,0,'poor','Poor']]);
 assert.deepEqual([report.total.rank,report.total.percentDone,report.total.rating],[null,11,'poor']);
 assert.deepEqual([0,24,25,49,50,100,null].map(ratingOf),['poor','poor','average','average','good','good','']);
 const site=(name,locked,due)=>({site:name,locked,due});
 assert.deepEqual(rankSites([site('D',0,28),site('A',3,28),site('C',0,28),site('B',14,28),site('E',6,56)]).map(s=>s.site+s.rank),['B1','A2','E2','C4','D4'],'equal shares hold the same rank, and the next rank skips');
});

test('the summary lines follow the table',()=>{
 const report=buildBatchStatusReport(input),lines=sitesInsights(report.sites,report.total);
 assert.equal(lines[0],'8 of 9 shifts are not yet locked. Most of them: Batch not created (6).');
 assert.equal(lines[1],`Rank 1: ${displaySiteName('Sasti')}, 17% of due shifts locked. Last (rank 2): ${displaySiteName('Jayant')}, 0%.`);
 assert.equal(shiftsInsight(report.shifts.filter(r=>r.site===displaySiteName('Sasti'))),'1 of 6 shifts locked. 3 shifts have no batch yet. Locked shifts took 8 hours on average after shift end; 0 took more than 24 hours.');
 assert.deepEqual(sitesInsights([],report.total),[]);
});

test('one batch: milestones, time in each stage, rework and every action',()=>{
 const detail=buildBatchDetail({batch:batches[0],shifts,events:eventsA,lmvBooks,now:input.now});
 assert.deepEqual(detail.timeline.map(r=>[r.label,r.sincePrevious,r.sinceShiftEnd]),[['Shift ended',null,null],['Batch created',3.2,3.2],['VLB locked',1.3,4.5],['LMV locked',0.2,4.7],['Batch locked',3.3,8]]);
 assert.deepEqual(detail.stages.map(s=>[s.stage,s.clockHours,s.workMinutes,s.items]),[['VLB',1.3,32,6],['LMV',0.2,10,1],['ELB',3.3,17,2],['Whole batch',4.8,59,9]]);
 assert.equal(detail.stages[2].waitHours,3);assert.equal(detail.stages[0].minutesPerItem,5.3);
 assert.equal(detail.actions.length,13);assert.equal(detail.actions[0].gapMinutes,null);
 const waiting=detail.actions.filter(a=>a.waiting);assert.deepEqual(waiting.map(a=>[a.action,a.gapMinutes,a.workMinutes]),[['Trip card saved',48,0],['Machine entry saved',183,0]]);
 assert.equal(detail.actions.find(a=>a.action==='LMV log book saved').item,'CAL/LMV/01-11-26/001');
 assert.equal(detail.insight,'Locked 8 hours after the shift ended. On the batch: 4.8 hours by the clock, 59 minutes of actual work. Longest wait: ELB stage, 3 hours.');
 const open=buildBatchDetail({batch:batches[2],shifts,events:events.filter(e=>e.batch_id===C),lmvBooks:[],now:input.now});
 assert.equal(open.rework.find(r=>r.label==='VLB unlocked after locking').count,1);assert.equal(open.timeline[2].at,null);assert.match(open.insight,/^VLB open\. Pending for 28 hours since the shift ended\./);
});

test('the tab is listed under Operations and its route needs the Reports menu',()=>{
 assert.deepEqual(operationReports.find(r=>r.id==='batch-status'),{id:'batch-status',title:'Batch Status & Turnaround',group:'Operations'});
 assert.match(buildOperationReport('batch-status',[]).rows[0][1],/Batch Status & Turnaround/);
 const session=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages}});
 assert.equal(misRequestAllowed(session(['Reports']),{path:'/api/reports/batch-status',method:'GET'}),true);
 assert.equal(misRequestAllowed(session(['Dashboard']),{path:'/api/reports/batch-status/batch',method:'GET'}),false);
});

test('the report route reads only permitted sites and never changes data',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);
  CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT,book_date DATE,site TEXT,asset_id BIGINT,data JSONB,created_by TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),deleted_at TIMESTAMPTZ);
  CREATE TABLE mis_vlb_batches(id UUID PRIMARY KEY,name TEXT,site TEXT,book_date DATE,shift TEXT,stage TEXT,created_at TIMESTAMPTZ,vlb_locked_at TIMESTAMPTZ,lmv_locked_at TIMESTAMPTZ,closed_at TIMESTAMPTZ,creator_login TEXT,created_by TEXT,deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ);
  CREATE TABLE mis_vlb_batch_entries(batch_id UUID,logbook_id BIGINT);
  CREATE TABLE mis_vlb_batch_fleet(batch_id UUID,asset_id BIGINT,logbook_id BIGINT);
  CREATE TABLE mis_vlb_batch_audit(id BIGSERIAL PRIMARY KEY,batch_id UUID,actor TEXT,action TEXT,occurred_at TIMESTAMPTZ,detail JSONB DEFAULT '{}');`);
 for(const shift of shifts)await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Shift Master',$1)",[JSON.stringify(shift)]);
 const other='00000000-0000-4000-8000-00000000000d',deleted='00000000-0000-4000-8000-00000000000e';
 for(const b of [...batches,{...batches[0],id:other,name:'JAYANT OC-1ST NOV-S1',site:'Jayant'},{...batches[1],id:deleted,name:'deleted',deleted_at:at('02','12:00')}])
  await db.query('INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,stage,created_at,vlb_locked_at,lmv_locked_at,closed_at,creator_login,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[b.id,b.name,b.site,b.date,b.shift,b.stage,b.created_at,b.vlb_locked_at,b.lmv_locked_at,b.closed_at,b.created_by,b.deleted_at||null]);
 for(const e of events)await db.query('INSERT INTO mis_vlb_batch_audit(batch_id,actor,action,occurred_at,detail) VALUES($1,$2,$3,$4,$5)',[e.batch_id,e.actor,e.action,e.at,JSON.stringify(e.action==='card_added'?{after:{book_no:'CAL/VLB/011126/S1/0001',data:{door:'V9001'}}}:e.action==='machine_saved'?{door:'EX9001'}:{})]);
 await db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,created_by,created_at) VALUES('CAL/LMV/01-11-26/001','lmv','2026-11-01','Sasti',1,$1,'operator.one',$2)",[JSON.stringify({location:'Sasti',bookShiftCode:'S1',private:'must-not-leak'}),at('01','17:36')]);
 for(let i=0;i<6;i++){const id=(await db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,created_by) VALUES($1,'vehicle','2026-11-01','Sasti',1,'{}','operator.one') RETURNING id",['CARD-'+i])).rows[0].id;await db.query('INSERT INTO mis_vlb_batch_entries VALUES($1,$2)',[A,id]);}
 await db.query('INSERT INTO mis_vlb_batch_fleet VALUES($1,1,NULL),($1,2,NULL)',[A]);
 const statements=[],query=(sql,args)=>{statements.push(sql);return db.query(sql,args);},pool={query,connect:async()=>({query,release(){}})};
 const app=express();const auth=(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.logBookScope=req.headers.authorization==='admin'?{sites:null}:{sites:[canonicalSiteName('Sasti')]};next();};
 registerBatchStatusReport(app,{pool,protect:[auth],ensureBooks:async()=>{},now:()=>input.now});app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
 const call=(path,token='reader')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{headers:token?{Authorization:token}:{}});
 const list='/api/reports/batch-status?from=2026-11-01&to=2026-11-02';
 assert.equal((await call(list,'')).status,401);assert.equal((await call('/api/reports/batch-status?from=2026-10-01&to=2026-11-02')).status,400);
 let response=await call(list),report=await response.json();assert.equal(response.status,200,JSON.stringify(report));assert.match(response.headers.get('cache-control'),/no-store/);
 assert.deepEqual(report.sites.map(s=>s.site),[displaySiteName('Sasti')],'another site is not shown to a login without it');
 assert.deepEqual([report.total.due,report.total.locked,report.total.notCreated,report.total.vlbOpen,report.total.lmvOpen],[6,1,3,1,1]);
 const locked=report.shifts.find(r=>r.batchId===A);assert.deepEqual([locked.cards,locked.lmvBooks,locked.machinesSaved,locked.machinesTotal,locked.workHours,locked.lockHours],[6,1,0,2,1,8]);
 assert.equal(report.shifts.some(r=>r.batchId===deleted),false);assert.equal(JSON.stringify(report).includes('must-not-leak'),false);
 report=await (await call(list,'admin')).json();assert.equal(report.sites.length,2);
 assert.equal((await call('/api/reports/batch-status/batch?id=not-an-id')).status,400);assert.equal((await call('/api/reports/batch-status/batch?id='+deleted)).status,404);assert.equal((await call('/api/reports/batch-status/batch?id='+other)).status,403);
 response=await call('/api/reports/batch-status/batch?id='+A);const detail=await response.json();assert.equal(response.status,200,JSON.stringify(detail));
 assert.equal(detail.batch.name,'SASTI OC-1ST NOV-S1');assert.equal(detail.actions.length,13);assert.equal(detail.actions[1].item,'CAL/VLB/011126/S1/0001 · V9001');assert.equal(detail.actions.find(a=>a.action==='Machine entry saved').item,'EX9001');
 assert.equal(detail.stages[3].workMinutes,59);assert.equal(detail.timeline[4].sinceShiftEnd,8);
 assert.equal(statements.some(sql=>/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(sql)),false,'the report only reads');
});
