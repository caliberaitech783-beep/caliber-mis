import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LOG_BOOK_SCHEMA,registerLogBooks} from '../server/routes/log-book.mjs';
import {PAUSE_UNTIL,batchLockPause,batchLockPauseUntil,batchLockPauseEndsAt,batchLocksPaused,batchLockPauseNote} from '../shared/batch-lock-pause.mjs';
process.env.BATCH_COVERAGE_STOP_FROM='off'; // Every machine needs an answer before lock / close: covered in batch-fleet-coverage.test.mjs.
process.env.VLB_BATCH_ORDER_FROM='off'; // The shift-order gate is covered in vlb-batch-order.test.mjs.

// Owner, 24 Nov 2026: VLB, LMV and ELB locking off for five days.
test('the pause runs to the end of 29 Nov 2026 in India and can be moved or ended by the Azure setting',()=>{
 assert.equal(PAUSE_UNTIL,'2026-11-29');
 assert.equal(batchLockPauseUntil({}),'2026-11-29');
 assert.equal(batchLockPauseEndsAt('2026-11-29').toISOString(),'2026-11-29T18:30:00.000Z','midnight IST after the last day');
 assert.equal(batchLocksPaused({},new Date('2026-11-24T12:00:00Z')),true);
 assert.equal(batchLocksPaused({},new Date('2026-11-29T18:29:59Z')),true,'still on at 23:59 IST on 29 Nov');
 assert.equal(batchLocksPaused({},new Date('2026-11-29T18:30:00Z')),false,'locks return by themselves at 00:00 IST on 30 Nov');
 for(const off of ['off','0','false','no','OFF'])assert.equal(batchLocksPaused({VLB_BATCH_LOCK_PAUSE_UNTIL:off},new Date('2026-11-25T00:00:00Z')),false);
 assert.equal(batchLocksPaused({VLB_BATCH_LOCK_PAUSE_UNTIL:'2026-12-02'},new Date('2026-12-02T10:00:00Z')),true,'the setting moves the last day');
 assert.equal(batchLocksPaused({VLB_BATCH_LOCK_PAUSE_UNTIL:'2026-11-25'},new Date('2026-11-26T00:00:00Z')),false,'or brings it forward');
 const pause=batchLockPause({},new Date('2026-11-25T00:00:00Z'));
 assert.deepEqual(pause,{active:true,until:'2026-11-29',endsAt:'2026-11-29T18:30:00.000Z'});
 assert.match(batchLockPauseNote(pause),/Locking is off until 29-11-2026/);
 assert.deepEqual(batchLockPause({},new Date('2026-12-01T00:00:00Z')),{active:false,until:null,endsAt:null});
 assert.equal(batchLockPauseNote({active:false}),'');
});

test('the entry pickers offer every open batch while the pause runs; a closed batch is still reopened first',()=>{
 const workspace=readFileSync(new URL('../src/vlb-entry-workspace.jsx',import.meta.url),'utf8');
 assert.match(workspace,/if\(batch\.stageWait\)return batch\.stageWait;\r?\n[^\n]*\n if\(batch\.lockPaused&&!batch\.closed_at\)return '';/);
 const page=readFileSync(new URL('../src/vlb-create-batch.jsx',import.meta.url),'utf8');
 assert.match(page,/if\(batch\.twoStage===true&&batch\.lockPaused&&!batch\.closed_at\)return true;/);
});

test('while the pause runs, VLB, LMV and ELB cards save in every open stage and Close batch locks VLB and LMV itself',async t=>{
 const saved={two:process.env.VLB_TWO_STAGE_BATCHES,pause:process.env.VLB_BATCH_LOCK_PAUSE_UNTIL};
 delete process.env.VLB_TWO_STAGE_BATCHES;process.env.VLB_BATCH_LOCK_PAUSE_UNTIL='2099-12-31';
 t.after(()=>{for(const [key,value] of [['VLB_TWO_STAGE_BATCHES',saved.two],['VLB_BATCH_LOCK_PAUSE_UNTIL',saved.pause]])value===undefined?delete process.env[key]:process.env[key]=value;});
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const masters=[
  ['Equipment master',{category:'Vehicle',door:'V1',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  ['Equipment master',{category:'LMV',door:'L1',currentLocation:'Sasti OC',equipmentName:'Pickup'}],
  ['Users & employees',{login:'alice',employee:'Alice',employeeId:'CM-1',userRoles:'MIS User',status:'active',site:'Sasti OC'}],
  ['Users & employees',{login:'bob',employee:'Bob',employeeId:'CM-2',userRoles:'MIS User',status:'active',site:'Sasti OC'}],
  ['Shift Master',{site:'Sasti OC',shiftName:'Shift A',shiftCode:'I',startTime:'05:00:00',endTime:'13:00:00'}],
  ['Shift Master',{site:'Sasti OC',shiftName:'Shift B',shiftCode:'II',startTime:'13:00:00',endTime:'21:00:00'}],
  ['Equipment master',{category:'Equipment',door:'VPC-019',equipmentName:'VPC 019',group:'Excavator',currentLocation:'Sasti OC'}],
  ['Equipment master',{category:'Equipment',door:'VPC-020',equipmentName:'VPC 020',group:'Excavator',currentLocation:'Sasti OC'}],
  ['Equipment master',{category:'Equipment',door:'D1',equipmentName:'Dozer D1',group:'Dozer',currentLocation:'Sasti OC'}],
 ];
 const ids={};for(const [name,data] of masters){const {rows}=await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2) RETURNING id',[name,JSON.stringify(data)]);ids[data.door||data.login||data.shiftName]=String(rows[0].id);}
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json({limit:'5mb'}));
 const requireSession=(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.session={login:req.headers.authorization,role:'super',site:req.headers.authorization==='bob'?'Sasti OC':undefined,permissions:{adminLevel:req.headers.authorization==='alice'?'Admin':''}};next()};
 registerLogBooks(app,{pool,requireSession,requireAdministrator:(req,res,next)=>next(),pulseMasterSync:{status:()=>({connected:false}),readBreakdownRequests:async()=>[]}});
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,method='GET',body,auth='alice')=>{const r=await fetch(base+route,{method,headers:{Authorization:auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const selection={site:'Sasti OC',date:'2026-12-18',shift:'S1'};
 const created=await call('/api/vlb-batches','POST',{...selection,requestKey:randomUUID()});
 assert.equal(created.status,201,JSON.stringify(created.data));
 assert.equal(created.data.lockPaused,true);assert.equal(created.data.lockPause.until,'2099-12-31');assert.match(created.data.lockPause.note,/Locking is off until 31-12-2099/);
 const batch='/api/vlb-batches/'+created.data.id;
 const card=(door,trips)=>({bookDate:'2026-12-18',location:'Sasti OC',assetId:ids[door],employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,cardShift:'I',openingKmr:1000,closingKmr:1050,openingHmr:100,closingHmr:106,timeMode:'without',trips,requestKey:randomUUID()});
 const elb=(door,hmr=[1,3])=>({bookDate:'2026-12-18',location:'Sasti OC',assetId:ids[door],employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,openingHmr:hmr[0],closingHmr:hmr[1],requestKey:randomUUID()});

 // VLB open: the trip card, an LMV card and an ELB card all save.
 const first=await call('/api/log-books/vehicle','POST',card('V1',[{equipmentName:'VPC 019',tripCount:3}]));
 assert.equal(first.status,201,JSON.stringify(first.data));
 const lmv=await call('/api/log-books/lmv','POST',{...card('L1',[]),manualEntry:true});
 assert.equal(lmv.status,201,'LMV saves while VLB is open: '+JSON.stringify(lmv.data));
 const dozer=await call('/api/log-books/equipment','POST',elb('D1'));
 assert.equal(dozer.status,201,'ELB saves while VLB is open: '+JSON.stringify(dozer.data));
 let view=await call(batch);
 assert.equal(view.data.stage,'vlb_open');assert.equal(view.data.canClose,true,'Close batch is offered while VLB is open');
 assert.deepEqual(view.data.elbRecords.map(r=>r.id),[dozer.data.id]);
 assert.deepEqual(view.data.lmvRecords.map(r=>r.id),[lmv.data.id]);

 // Another shift of the same date still waits for Lock VLB: a site and date hold one VLB-open batch.
 assert.equal((await call('/api/vlb-batches','POST',{...selection,shift:'S2',requestKey:randomUUID()},'bob')).status,409);

 // After Lock VLB a changed trip card moves the machine trips at once, and the ELB saved before stays.
 const vlbLocked=await call(batch+'/lock-vlb','POST',{});
 assert.equal(vlbLocked.status,200,JSON.stringify(vlbLocked.data));assert.equal(vlbLocked.data.stage,'lmv_open');
 assert.equal(vlbLocked.data.stageWait,'');
 assert.equal(vlbLocked.data.fleet.find(r=>r.door==='D1').logbook_id,dozer.data.id,'the ELB saved before Lock VLB stays on its machine');

 // The next shift never waits for this batch's LMV or ELB: Close batch straight from VLB open does
 // Lock VLB, Lock LMV and the close while the first batch is still at LMV open.
 const second=await call('/api/vlb-batches','POST',{...selection,shift:'S2',requestKey:randomUUID()},'bob');
 assert.equal(second.status,201,JSON.stringify(second.data));
 const secondPath='/api/vlb-batches/'+second.data.id;
 const secondCard=await call('/api/log-books/vehicle','POST',{...card('V1',[]),shiftId:ids['Shift B'],cardShift:'II',openingHmr:106,closingHmr:110,openingKmr:1050,closingKmr:1060});
 assert.equal(secondCard.status,201,JSON.stringify(secondCard.data));
 assert.equal((await call('/api/vlb-batches','GET',undefined,'bob')).data.batches.find(b=>b.id===second.data.id).lockPaused,true);
 const closedSecond=await call(secondPath+'/close','POST',{},'bob');
 assert.equal(closedSecond.status,200,JSON.stringify(closedSecond.data));
 assert.equal((await call(secondPath,'GET',undefined,'bob')).data.stage,'closed');
 assert.equal((await call(batch)).data.stage,'lmv_open');
 const changed=await call('/api/log-books/vehicle/'+first.data.id,'PUT',{...card('V1',[{equipmentName:'VPC 020',tripCount:5}]),revision:first.data.revision});
 assert.equal(changed.status,200,'a VLB card changes after Lock VLB: '+JSON.stringify(changed.data));
 view=await call(batch);
 assert.deepEqual(view.data.machines.filter(m=>m.trips>0).map(m=>[m.door,m.trips]),[['VPC-020',5]],'the trips follow the changed card');
 assert.equal(view.data.fleet.find(r=>r.door==='VPC-019').trips,0,'the machine the card no longer names needs no ELB');

 // Close batch locks LMV itself; it still needs an ELB for the loading machine.
 const refused=await call(batch+'/close','POST',{});
 assert.equal(refused.status,409);assert.match(refused.data.error,/VPC-020/);
 assert.equal((await call(batch)).data.stage,'lmv_open','a refused close leaves the stage as it was');
 const loader=await call('/api/log-books/equipment','POST',elb('VPC-020',[10,16]));
 assert.equal(loader.status,201,'ELB saves while LMV is open: '+JSON.stringify(loader.data));
 const closed=await call(batch+'/close','POST',{});
 assert.equal(closed.status,200,JSON.stringify(closed.data));
 view=await call(batch);
 assert.equal(view.data.stage,'closed');assert.ok(view.data.lmv_locked_at,'Close batch locked LMV');assert.ok(view.data.vlb_locked_at);
 const actions=(await db.query('SELECT action FROM mis_vlb_batch_audit WHERE batch_id=$1 ORDER BY id',[created.data.id])).rows.map(r=>r.action);
 assert.deepEqual(actions.filter(a=>['vlb_locked','lmv_locked','saved_and_locked'].includes(a)),['vlb_locked','lmv_locked','saved_and_locked']);
 // A closed batch is still reopened before an existing card changes.
 assert.equal((await call('/api/log-books/vehicle/'+first.data.id,'PUT',{...card('V1',[{equipmentName:'VPC 020',tripCount:6}]),revision:changed.data.revision})).status,409);
});

test('the batch page shows the pause and opens entry in every stage while it runs',()=>{
 const page=readFileSync(new URL('../src/vlb-create-batch.jsx',import.meta.url),'utf8');
 assert.match(page,/lockPaused&&!viewed\.closed_at&&viewed\.lockPause\?\.note/);
 assert.match(page,/Close batch \(locks VLB and LMV\)/);
 assert.match(page,/const lmvList=lmvOpen&&!lockPaused;/);
 const route=readFileSync(new URL('../server/routes/vlb-batches.mjs',import.meta.url),'utf8');
 assert.match(route,/if\(twoStageEnabled\(\)&&batchLocksPaused\(\)\)\{\r?\n   if\(batchStage\(batch\)==='vlb_open'\)batch=await lockVlb/);
});
