// Owner, 25 Nov 2026: when a batch closes, every VLB, ELB and LMV machine of the site needs an answer for
// the shift: a card, its breakdown in Pulse-1, or an idle reason. The batch page counts and lists them. It only warns.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pulseShiftStatus,sitePulseRequests,shiftWindow,pulseTime} from '../shared/pulse-shift-status.mjs';
import {PGlite} from '@electric-sql/pglite';
import {batchFleetCoverage,siteRoster,assetCoverageKind,idleAnswerIssue,answerMachineIssue,IDLE_REASONS} from '../shared/batch-fleet-coverage.mjs';
import {BATCH_MACHINE_ANSWER_SCHEMA,readBatchMachineAnswers,saveIdleAnswer,clearMachineAnswer} from '../server/rules/batch-machine-answers.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const asset=(id,door,category,site='Sasti OC',extra={})=>({id,door,category,currentLocation:site,equipmentName:door+' machine',...extra});
const assets=[
 asset(1,'DT-01','Vehicle'),asset(2,'DT-02','Vehicle'),asset(3,'DT-03','Vehicle'),
 asset(4,'EX-01','Equipment'),asset(5,'EX-02','Equipment'),
 asset(6,'LMV-01','LMV'),asset(7,'LMV-02','LMV'),
 asset(8,'DT-09','Vehicle','Durgapur'),
 asset(9,'DT-OLD','Vehicle','Sasti OC',{status:'Inactive'}),
 asset(10,'DT-GONE','Vehicle','Sasti OC',{sourceMissing:true}),
];

test('the site roster takes each active machine of the site into its book by the Equipment Master category',()=>{
 const roster=siteRoster(assets,'Sasti OC');
 assert.deepEqual(roster.vehicle.map(r=>r.door),['DT-01','DT-02','DT-03'],'inactive, missing and other-site machines are left out');
 assert.deepEqual(roster.equipment.map(r=>r.door),['EX-01','EX-02']);
 assert.deepEqual(roster.lmv.map(r=>r.door),['LMV-01','LMV-02']);
 assert.equal(assetCoverageKind({group:'Excavator'}),'equipment','no category: judged by its group');
 assert.equal(assetCoverageKind({lmv:true,category:'Vehicle'}),'lmv');
});

test('a machine with a saved card of the batch is answered; the rest are listed as no answer yet',()=>{
 const coverage=batchFleetCoverage({assets,site:'Sasti OC',
  vlbRecords:[{asset_id:'1',book_no:'V-11',data:{}},{asset_id:'1',book_no:'V-12',data:{}},{asset_id:'8',book_no:'V-90',data:{}}],
  lmvRecords:[{book_no:'L-1',data:{assetId:'6'}}],
  elbFleet:[{assetId:'4',door:'EX-01',saved_at:'2026-11-25',shift_status:'breakdown',book_no:'E-4'},{assetId:'5',door:'EX-02',saved_at:null,shift_status:null}],
 });
 assert.equal(coverage.mode,'warning');
 const {vlb,elb,lmv}=coverage.books;
 assert.deepEqual([vlb.total,vlb.answered,vlb.remaining,vlb.otherSite],[3,1,2,1]);
 assert.deepEqual(vlb.missing.map(r=>r.door),['DT-02','DT-03']);
 assert.deepEqual(vlb.rows.find(r=>r.door==='DT-01').cards,['V-11','V-12']);
 assert.equal(vlb.rows.find(r=>r.door==='DT-09').atSite,false,'a card for a machine of another site counts, shown apart');
 assert.deepEqual([elb.total,elb.answered,elb.remaining],[2,1,1],'an ELB saved with a status (breakdown too) is an answer');
 assert.deepEqual([lmv.total,lmv.answered,lmv.remaining],[2,1,1]);
 assert.equal(coverage.complete,false);
 assert.equal(coverage.warnings[0],'VLB 1/3 machines answered; no answer yet: DT-02, DT-03.');
});

test('before the ELB list is made the site Equipment is the ELB roster; an ELB card answers it',()=>{
 const coverage=batchFleetCoverage({assets,site:'Sasti OC',elbRecords:[{asset_id:'5',book_no:'E-5',data:{}}]});
 assert.deepEqual(coverage.books.elb.missing.map(r=>r.door),['EX-01']);
});

test('all answered: complete with no warning',()=>{
 const coverage=batchFleetCoverage({assets,site:'Sasti OC',
  vlbRecords:[1,2,3].map(id=>({asset_id:String(id),data:{}})),lmvRecords:[6,7].map(id=>({data:{assetId:String(id)}})),
  elbRecords:[4,5].map(id=>({asset_id:String(id),data:{}}))});
 assert.equal(coverage.complete,true);
 assert.deepEqual(coverage.warnings,[]);
});

test('the batch page gets the coverage from the stage details and shows it',()=>{
 const route=read('server/routes/vlb-batches.mjs');
 assert.match(route,/stageDetails\(client,batch,\{assets,vlbCards:records,lmvRecords,/);
 const stages=read('server/rules/vlb-batch-stages.mjs');
 assert.match(stages,/fleetCoverage=await machineCoverage\(/);
 const page=read('src/vlb-create-batch.jsx');
 assert.match(page,/<BatchFleetCoverage key=\{viewed\.id\} coverage=\{viewed\.fleetCoverage\}/);
 const panel=read('src/batch-fleet-coverage.jsx');
 assert.ok(panel.includes("'Step 1 · Machine coverage · '"));
 assert.match(panel,/book&&<ReportSection[^>]*'Step 2 · '/,'Step 2 opens under Step 1');
});


// Part 2 (owner, 25 Nov 2026): "if any vehicle or equipment is in maintenance or idle it should fetch from pulse.cmll.in".
// What Pulse-1 holds for the shift is read by itself for every VLB and LMV machine; only the rest take a reason by hand.
const window=shiftWindow('2026-11-20','05:00:00',8);// 05:00-13:00 IST
const NOW=Date.parse('2026-11-21T00:00:00+05:30');
const request=(door,start,closedAt,extra={})=>({ref:'BD-'+door,site:'Sasti OC',door,start,closedAt,description:'Engine work',...extra});

test('the shift window is the report date and Shift Master start in India, for its hours',()=>{
 assert.equal(new Date(window.start).toISOString(),'2026-11-19T23:30:00.000Z');
 assert.equal(window.hours,8);
 assert.equal(shiftWindow('2026-11-20','5:00',8).start,window.start,'a one-digit hour reads the same');
 assert.equal(shiftWindow('2026-11-20','',8),null);
 assert.ok(Number.isNaN(pulseTime('—')));
});

test('Pulse-1: a breakdown covering the shift is whole; part of it is not; an idle request gives its reason; other sites and machines do not count',()=>{
 const requests=sitePulseRequests([
  request('DT-01','2026-11-19 22:00','2026-11-20 14:00'),
  request('DT-02','2026-11-20 07:00','2026-11-20 09:30'),
  request('DT-02','2026-11-20 09:00','2026-11-20 10:00'),
  request('DT-03','2026-11-18 10:00','—',{vehicleIdle:true,idealApprovedAt:'2026-11-20 08:00',idleReason:'No work',description:'Face closed'}),
  request('DT-01','2026-11-20 06:00','2026-11-20 08:00',{site:'Durgapur'}),
  request('DT-01','2026-11-20 06:00','2026-11-20 08:00',{archivedAt:'2026-11-20'}),
 ],'Sasti OC');
 const one=pulseShiftStatus(assets[0],requests,window,NOW);
 assert.deepEqual([one.breakdownHours,one.wholeShift,one.idle],[8,true,null]);
 assert.deepEqual(one.references,['BD-DT-01']);
 const two=pulseShiftStatus(assets[1],requests,window,NOW);
 assert.deepEqual([two.breakdownHours,two.wholeShift],[3,false],'overlapping requests are merged: 07:00-10:00');
 const three=pulseShiftStatus(assets[2],requests,window,NOW);
 assert.deepEqual(three.idle,{reason:'No work',remarks:'Face closed',reference:'BD-DT-03'});
 assert.equal(three.breakdownHours,3,'the time before the idle approval (05:00-08:00) is breakdown');
 const lmv=pulseShiftStatus(assets[5],requests,window,NOW);
 assert.deepEqual([lmv.breakdownHours,lmv.idle],[0,null]);
});

test('a shift still running counts a breakdown from its start until now as whole',()=>{
 const requests=sitePulseRequests([request('DT-01','2026-11-20 04:00','—')],'Sasti OC');
 const status=pulseShiftStatus(assets[0],requests,window,Date.parse('2026-11-20T09:00:00+05:30'));
 assert.deepEqual([status.breakdownHours,status.wholeShift],[4,true]);
});

test('coverage: Pulse-1 answers a whole-shift breakdown and an idle request; a part-shift breakdown and a card stay as they are',()=>{
 const rows=[request('DT-02','2026-11-19 22:00','2026-11-20 14:00'),request('DT-03','2026-11-20 06:00','2026-11-20 07:00'),
  request('LMV-01','2026-11-19 10:00','—',{vehicleIdle:true,idleReason:'Standby'}),request('DT-01','2026-11-19 22:00','2026-11-20 14:00')];
 const coverage=batchFleetCoverage({assets,site:'Sasti OC',vlbRecords:[{asset_id:'1',data:{}}],pulse:{rows,window,now:NOW,readAt:NOW}});
 const {vlb,lmv}=coverage.books;
 assert.equal(coverage.pulseRead.ok,true);
 assert.equal(vlb.rows.find(r=>r.door==='DT-01').answer,'card','a card wins over Pulse-1');
 assert.equal(vlb.rows.find(r=>r.door==='DT-01').pulse.wholeShift,true,'Pulse-1 is still shown beside it');
 assert.equal(vlb.rows.find(r=>r.door==='DT-02').answer,'pulse');
 assert.equal(vlb.rows.find(r=>r.door==='DT-03').answer,'');
 assert.match(vlb.rows.find(r=>r.door==='DT-03').note,/card needed/);
 assert.deepEqual([vlb.total,vlb.cards,vlb.pulse,vlb.idle,vlb.remaining],[3,1,1,0,1]);
 assert.equal(lmv.rows.find(r=>r.door==='LMV-01').answer,'pulse_idle');
 assert.deepEqual([lmv.idle,lmv.remaining],[1,1]);
 // A reason saved by hand wins over Pulse-1; without the Pulse copy, nothing is taken from it and the page says so.
 const byHand=batchFleetCoverage({assets,site:'Sasti OC',pulse:{rows,window,now:NOW},answers:[{book:'vlb',assetId:'2',status:'no_work',reason:'Face closed'}]});
 assert.equal(byHand.books.vlb.rows.find(r=>r.door==='DT-02').answer,'no_work');
 const unread=batchFleetCoverage({assets,site:'Sasti OC',pulse:{error:'Pulse-1 did not answer in time.'}});
 assert.deepEqual(unread.pulseRead,{ok:false,error:'Pulse-1 did not answer in time.'});
 assert.equal(unread.books.vlb.remaining,3);
});

test('an idle reason needs a VLB / LMV book, a listed reason and written details; the machine must be of the site and book',()=>{
 assert.match(idleAnswerIssue({book:'elb',status:'no_work',reason:'abc'}),/ELB fleet list/);
 assert.match(idleAnswerIssue({book:'vlb',status:'holiday',reason:'abc'}),/Choose why/);
 assert.match(idleAnswerIssue({book:'vlb',status:'no_work',reason:'  '}),/Write the reason/);
 assert.equal(idleAnswerIssue({book:'vlb',status:'no_work',reason:'No face'}),'');
 assert.deepEqual(Object.keys(IDLE_REASONS),['no_operator','not_in_use','no_work','standby','transferred_out']);
 assert.equal(answerMachineIssue(assets[0],{site:'Sasti OC',book:'vlb'}),'');
 assert.match(answerMachineIssue(assets[0],{site:'Sasti OC',book:'lmv'}),/does not belong to the LMV book/);
 assert.match(answerMachineIssue(assets[7],{site:'Sasti OC',book:'vlb'}),/does not put this machine at this site/);
 assert.match(answerMachineIssue(assets[8],{site:'Sasti OC',book:'vlb'}),/not active/);
});

test('answers by hand are saved once per batch and machine, replaced, cleared, and refused on a closed batch',async()=>{
 const db=new PGlite();
 await db.exec('CREATE TABLE mis_vlb_batches(id UUID PRIMARY KEY);CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);');
 await db.exec(BATCH_MACHINE_ANSWER_SCHEMA);
 const id='6f1c1d1e-0000-4000-8000-000000000001';
 await db.query('INSERT INTO mis_vlb_batches VALUES($1)',[id]);
 for(const one of assets)await db.query("INSERT INTO master_records VALUES($1,'Equipment master',$2::jsonb)",[one.id,JSON.stringify(one)]);
 const batch={id,name:'B1',site:'Sasti OC',closed_at:null};
 const saved=await saveIdleAnswer(db,batch,'2',{book:'vlb',status:'no_operator',reason:'Driver absent'},'mis1');
 assert.deepEqual([saved.status,saved.reason],['no_operator','Driver absent']);
 await saveIdleAnswer(db,batch,'2',{book:'vlb',status:'standby',reason:'GM visit'},'mis1');
 await assert.rejects(saveIdleAnswer(db,batch,'6',{book:'vlb',status:'no_work',reason:'xyz'},'mis1'),/does not belong to the VLB book/);
 const rows=await readBatchMachineAnswers(db,batch);
 assert.deepEqual(rows.map(r=>[r.assetId,r.status,r.reason]),[['2','standby','GM visit']]);
 assert.deepEqual(await clearMachineAnswer(db,batch,'2'),{cleared:true});
 assert.equal((await readBatchMachineAnswers(db,batch)).length,0);
 await assert.rejects(saveIdleAnswer(db,{...batch,closed_at:new Date()},'2',{book:'vlb',status:'no_work',reason:'xyz'},'mis1'),/closed/);
 await db.close();
});

test('the batch routes read the Pulse-1 copy before the batch lock, with a time limit, for the page, Lock VLB, Lock LMV and Close',()=>{
 const route=read('server/routes/vlb-batches.mjs');
 assert.doesNotMatch(route,/machines\/:assetId\/pulse/,'no Fetch Pulse-1 by hand any more');
 assert.match(route,/const coveragePulseRows=async req=>\{[\s\S]*?Promise\.race\(\[prefetchFleetBreakdownRows\(req\.batchActor\?\.login\)[\s\S]*?5000/);
 for(const action of ['close','lock-vlb','lock-lmv'])assert.ok(route.includes("app.post('/api/vlb-batches/:id/"+action+"',...protect,handle(async(req,res)=>{const pulseRows=await coveragePulseRows(req);await batchTransaction("),action+' reads Pulse-1 before its lock');
 assert.match(route,/app\.put\('\/api\/vlb-batches\/:id\/machines\/:assetId\/answer'[\s\S]*?machine_answer_idle/);
 assert.match(route,/app\.delete\('\/api\/vlb-batches\/:id\/machines\/:assetId\/answer'[\s\S]*?machine_answer_cleared/);
 assert.match(route,/await pool\.query\(BATCH_MACHINE_ANSWER_SCHEMA\)/);
 const stages=read('server/rules/vlb-batch-stages.mjs');
 assert.match(stages,/answers:await readBatchMachineAnswers\(client,batch\),pulse\}/);
 const panel=read('src/batch-fleet-coverage.jsx');
 assert.doesNotMatch(panel,/Fetch Pulse-1/);
 for(const label of ["label:'Pulse-1 (this shift)'",'Idle reason…','>Clear<','are read from Pulse-1 (pulse.cmll.in)'])assert.ok(panel.includes(label),label);
});
