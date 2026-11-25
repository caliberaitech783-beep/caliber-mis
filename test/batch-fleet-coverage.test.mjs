// Owner, 25 Nov 2026: when a batch closes, every VLB, ELB and LMV machine of the site needs an answer for
// the shift: a card, its breakdown in Pulse-1, or an idle reason. The batch page counts and lists them. It only warns.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {batchFleetCoverage,siteRoster,assetCoverageKind,idleAnswerIssue,pulseAnswerStatus,answerMachineIssue,IDLE_REASONS} from '../shared/batch-fleet-coverage.mjs';
import {BATCH_MACHINE_ANSWER_SCHEMA,readBatchMachineAnswers,saveIdleAnswer,savePulseAnswer,clearMachineAnswer} from '../server/rules/batch-machine-answers.mjs';

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

test('the batch page gets the coverage and shows it; it stops no lock or close yet',()=>{
 const route=read('server/routes/vlb-batches.mjs');
 assert.match(route,/batchFleetCoverage\(\{assets,site:batch\.site,vlbRecords:records,lmvRecords/);
 assert.match(route,/zeroTripEntries,fleetCoverage,/);
 for(const file of ['server/rules/vlb-two-stage.mjs','server/rules/vlb-batch-stages.mjs'])assert.doesNotMatch(read(file),/fleetCoverage|batch-fleet-coverage|batch-machine-answers/,'warning mode: no blocker reads it');
 const page=read('src/vlb-create-batch.jsx');
 assert.match(page,/<BatchFleetCoverage key=\{viewed\.id\} coverage=\{viewed\.fleetCoverage\}/);
 const panel=read('src/batch-fleet-coverage.jsx');
 assert.ok(panel.includes("'Step 1 · Machine coverage · '"));
 assert.match(panel,/book&&<ReportSection[^>]*'Step 2 · '/,'Step 2 opens under Step 1');
});

// Part 2 (owner, 25 Nov 2026): a VLB or LMV machine with no card is answered by its breakdown in Pulse-1 or an idle reason.
test('a Pulse-1 whole-shift breakdown or an idle reason answers a VLB / LMV machine; a part-shift breakdown still wants a card',()=>{
 assert.equal(pulseAnswerStatus(8,8),'pulse');
 assert.equal(pulseAnswerStatus(12,12),'pulse');
 assert.equal(pulseAnswerStatus(3,8),'pulse_partial');
 assert.equal(pulseAnswerStatus(0,8),'','no breakdown in Pulse-1 answers nothing');
 const coverage=batchFleetCoverage({assets,site:'Sasti OC',vlbRecords:[{asset_id:'1',data:{}}],answers:[
  {book:'vlb',assetId:'2',status:'pulse',breakdownHours:8,shiftHours:8},
  {book:'vlb',assetId:'3',status:'pulse_partial',breakdownHours:2,shiftHours:8},
  {book:'lmv',assetId:'6',status:'no_operator',reason:'Driver on leave'},
  {book:'lmv',assetId:'7',status:'standby',reason:'Kept for GM visit'},
  {book:'vlb',assetId:'1',status:'not_in_use',reason:'old answer'},
 ]});
 const {vlb,lmv}=coverage.books;
 assert.deepEqual([vlb.total,vlb.answered,vlb.cards,vlb.pulse,vlb.idle,vlb.remaining],[3,2,1,1,0,1]);
 assert.equal(vlb.rows.find(r=>r.door==='DT-01').answer,'card','a card wins over a saved answer');
 assert.match(vlb.rows.find(r=>r.door==='DT-03').note,/card needed/);
 assert.deepEqual(vlb.missing.map(r=>r.door),['DT-03']);
 assert.deepEqual([lmv.answered,lmv.idle,lmv.complete],[2,2,true]);
 assert.equal(vlb.takesAnswers,true);
 assert.equal(coverage.books.elb.takesAnswers,false,'ELB is answered on its fleet list');
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

test('answers are saved once per batch and machine, replaced, cleared, and refused on a closed batch',async()=>{
 const db=new PGlite();
 await db.exec('CREATE TABLE mis_vlb_batches(id UUID PRIMARY KEY);CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);');
 await db.exec(BATCH_MACHINE_ANSWER_SCHEMA);
 const id='6f1c1d1e-0000-4000-8000-000000000001';
 await db.query('INSERT INTO mis_vlb_batches VALUES($1)',[id]);
 for(const one of assets)await db.query("INSERT INTO master_records VALUES($1,'Equipment master',$2::jsonb)",[one.id,JSON.stringify(one)]);
 const batch={id,name:'B1',site:'Sasti OC',closed_at:null};
 const saved=await saveIdleAnswer(db,batch,'2',{book:'vlb',status:'no_operator',reason:'Driver absent'},'mis1');
 assert.deepEqual([saved.status,saved.reason],['no_operator','Driver absent']);
 await assert.rejects(saveIdleAnswer(db,batch,'6',{book:'vlb',status:'no_work',reason:'xyz'},'mis1'),/does not belong to the VLB book/);
 const none=await savePulseAnswer(db,batch,'3','vlb',{breakdownHours:0,shiftHours:8,breakdowns:[]},'mis1');
 assert.equal(none.saved,false);
 assert.match(none.message,/no breakdown/);
 const pulse=await savePulseAnswer(db,batch,'2','vlb',{breakdownHours:8,shiftHours:8,breakdowns:[{reference:'BD-7',description:'Engine overheating'}]},'mis1');
 assert.deepEqual([pulse.saved,pulse.status,pulse.reason],[true,'pulse','Engine overheating'],'Pulse-1 replaces the earlier answer');
 const rows=await readBatchMachineAnswers(db,batch);
 assert.equal(rows.length,1);
 assert.equal(rows[0].breakdownHours,8);
 assert.equal(rows[0].pulse.breakdowns[0].reference,'BD-7');
 assert.deepEqual(await clearMachineAnswer(db,batch,'2'),{cleared:true});
 assert.equal((await readBatchMachineAnswers(db,batch)).length,0);
 await assert.rejects(saveIdleAnswer(db,{...batch,closed_at:new Date()},'2',{book:'vlb',status:'no_work',reason:'xyz'},'mis1'),/closed/);
 await db.close();
});

test('the routes read Pulse-1 before the batch lock and write an audit line; the panel offers Pulse-1, idle reasons and Clear',()=>{
 const route=read('server/routes/vlb-batches.mjs');
 const pulse=route.slice(route.indexOf("'/api/vlb-batches/:id/machines/:assetId/pulse'"),route.indexOf("'/api/vlb-batches/:id/machines/:assetId/answer'"));
 assert.ok(pulse.indexOf('readBatchShiftBreakdowns(pool')>0);
 assert.ok(pulse.indexOf('readBatchShiftBreakdowns(pool')<pulse.indexOf('batchTransaction('),'Pulse-1 is read outside the lock');
 assert.match(pulse,/machine_answer_pulse/);
 assert.match(route,/app\.put\('\/api\/vlb-batches\/:id\/machines\/:assetId\/answer'[\s\S]*?machine_answer_idle/);
 assert.match(route,/app\.delete\('\/api\/vlb-batches\/:id\/machines\/:assetId\/answer'[\s\S]*?machine_answer_cleared/);
 assert.match(route,/answers:await readBatchMachineAnswers\(client,batch\)/);
 assert.match(route,/await pool\.query\(BATCH_MACHINE_ANSWER_SCHEMA\)/);
 const panel=read('src/batch-fleet-coverage.jsx');
 for(const label of ['Fetch Pulse-1','Idle reason…','>Clear<','Fetch Pulse-1 for all'])assert.ok(panel.includes(label),label);
});
