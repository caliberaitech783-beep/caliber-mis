// Owner, 25 Nov 2026 (part 3, "close pe rok"): from the stop date a batch cannot Lock VLB, Lock LMV or Close until
// every machine of its site has an answer (a card, a whole-shift breakdown in Pulse-1, or an idle reason).
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LOG_BOOK_SCHEMA,registerLogBooks} from '../server/routes/log-book.mjs';
import {STOP_FROM,coverageStop,coverageStopFrom,coverageStopNote,coverageBlockers} from '../shared/batch-coverage-stop.mjs';
process.env.VLB_BATCH_ORDER_FROM='off'; // The shift-order gate is covered in vlb-batch-order.test.mjs.

test('the stop starts on 2 Dec 2026 in India, for batches of that date or later, and the Azure setting moves or ends it',()=>{
 assert.equal(STOP_FROM,'2026-12-02');
 assert.equal(coverageStopFrom({}),'2026-12-02');
 const at=iso=>new Date(iso);
 assert.equal(coverageStop({report_date:'2026-12-02'},{},at('2026-12-01T18:29:59Z')).active,false,'23:59 IST on 1 Dec: not yet');
 assert.equal(coverageStop({report_date:'2026-12-02'},{},at('2026-12-01T18:30:00Z')).active,true,'00:00 IST on 2 Dec');
 assert.equal(coverageStop({report_date:'2026-12-01'},{},at('2026-12-05T00:00:00Z')).active,false,'an older batch closes as before');
 assert.equal(coverageStop({report_date:'2026-12-20'},{BATCH_COVERAGE_STOP_FROM:'2026-12-10'},at('2026-12-05T00:00:00Z')).active,false,'the setting moves the first day');
 assert.equal(coverageStop({report_date:'2026-11-26'},{BATCH_COVERAGE_STOP_FROM:'2026-11-26'},at('2026-11-26T00:00:00Z')).active,true,'or brings it forward');
 for(const off of ['off','0','false','no','OFF'])assert.equal(coverageStop({report_date:'2026-12-20'},{BATCH_COVERAGE_STOP_FROM:off},at('2026-12-20T00:00:00Z')).active,false);
 assert.match(coverageStopNote({active:false,from:'2026-12-02'}),/^Warning only, nothing is stopped yet\. From 02-12-2026/);
 assert.match(coverageStopNote({active:true}),/are stopped until each machine/);
});

test('the blockers name each book still missing answers, with how to answer it',()=>{
 const book=(key,label,missing)=>({book:key,label,answered:2,total:2+missing.length,complete:!missing.length,missing:missing.map(door=>({door}))});
 const coverage={books:{vlb:book('vlb','VLB',['DT-02']),elb:book('elb','ELB',['EX-01']),lmv:book('lmv','LMV',[])}};
 assert.deepEqual(coverageBlockers(coverage,['vlb','elb','lmv'],{active:false}),[],'nothing stops before the stop date');
 const [vlb,elb,...rest]=coverageBlockers(coverage,['vlb','elb','lmv'],{active:true});
 assert.equal(vlb,'Every VLB machine needs an answer: 2/3 answered; no answer yet: DT-02. Add the card, or tick it under Machine roster and give the answer.');
 assert.match(elb,/no answer yet: EX-01\. Save its ELB on the Equipment ELB list/);
 assert.deepEqual(rest,[],'a complete book does not stop');
});

test('Lock VLB and Lock LMV wait for every machine of their book; Close waits for ELB too',async t=>{
 const saved={two:process.env.VLB_TWO_STAGE_BATCHES,pause:process.env.VLB_BATCH_LOCK_PAUSE_UNTIL,stop:process.env.BATCH_COVERAGE_STOP_FROM};
 delete process.env.VLB_TWO_STAGE_BATCHES;process.env.VLB_BATCH_LOCK_PAUSE_UNTIL='off';process.env.BATCH_COVERAGE_STOP_FROM='2026-11-01';
 t.after(()=>{for(const [key,value] of [['VLB_TWO_STAGE_BATCHES',saved.two],['VLB_BATCH_LOCK_PAUSE_UNTIL',saved.pause],['BATCH_COVERAGE_STOP_FROM',saved.stop]])value===undefined?delete process.env[key]:process.env[key]=value;});
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const masters=[
  ['Equipment master',{category:'Vehicle',door:'V1',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  ['Equipment master',{category:'Vehicle',door:'V2',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  ['Equipment master',{category:'Vehicle',door:'V3',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  ['Equipment master',{category:'LMV',door:'L1',currentLocation:'Sasti OC',equipmentName:'Pickup'}],
  ['Equipment master',{category:'LMV',door:'L2',currentLocation:'Sasti OC',equipmentName:'Pickup'}],
  ['Equipment master',{category:'Equipment',door:'VPC-019',equipmentName:'VPC 019',group:'Excavator',currentLocation:'Sasti OC'}],
  ['Users & employees',{login:'alice',employee:'Alice',employeeId:'CM-1',userRoles:'MIS User',status:'active',site:'Sasti OC'}],
  ['Shift Master',{site:'Sasti OC',shiftName:'Shift A',shiftCode:'I',startTime:'05:00:00',endTime:'13:00:00'}],
 ];
 const ids={};for(const [name,data] of masters){const {rows}=await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2) RETURNING id',[name,JSON.stringify(data)]);ids[data.door||data.login||data.shiftName]=String(rows[0].id);}
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 // Pulse-1 for the shift (20 Nov, 05:00-13:00): V2 in breakdown all shift, L1 idle (approved), nothing for V3 and L2.
 const pulseRequests=[
  {ref:'BD-501',site:'Sasti OC',door:'V2',start:'2026-11-20 03:00',closedAt:'2026-11-20 15:00',description:'Gearbox'},
  {ref:'BD-502',site:'Sasti OC',door:'L1',start:'2026-11-19 10:00',closedAt:'—',vehicleIdle:true,idealApprovedAt:'2026-11-19 12:00',idleReason:'No work'},
 ];
 const app=express();app.use(express.json({limit:'5mb'}));
 const requireSession=(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.session={login:req.headers.authorization,role:'super',permissions:{adminLevel:'Admin'}};next()};
 registerLogBooks(app,{pool,requireSession,requireAdministrator:(req,res,next)=>next(),pulseMasterSync:{status:()=>({connected:false}),readBreakdownRequests:async()=>pulseRequests}});
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,method='GET',body)=>{const r=await fetch(base+route,{method,headers:{Authorization:'alice','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const created=await call('/api/vlb-batches','POST',{site:'Sasti OC',date:'2026-11-20',shift:'S1',requestKey:randomUUID()});
 assert.equal(created.status,201,JSON.stringify(created.data));
 const batch='/api/vlb-batches/'+created.data.id;
 const card=await call('/api/log-books/vehicle','POST',{bookDate:'2026-11-20',location:'Sasti OC',assetId:ids.V1,employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,cardShift:'I',openingKmr:1000,closingKmr:1050,openingHmr:100,closingHmr:106,timeMode:'without',trips:[{equipmentName:'VPC 019',tripCount:3}],requestKey:randomUUID()});
 assert.equal(card.status,201,JSON.stringify(card.data));

 // Pulse-1 answers V2 (breakdown) and L1 (idle) by itself; V3 has nothing, so Lock VLB is refused, naming only V3.
 let view=await call(batch);
 const coverage=view.data.fleetCoverage;
 assert.equal(coverage.mode,'stop');
 assert.equal(coverage.pulseRead.ok,true,JSON.stringify(coverage.pulseRead));
 const v2=coverage.books.vlb.rows.find(row=>row.door==='V2');
 assert.equal(v2.answer,'pulse');assert.deepEqual([v2.pulse.breakdownHours,v2.pulse.references],[8,['BD-501']]);
 assert.equal(coverage.books.lmv.rows.find(row=>row.door==='L1').answer,'pulse_idle');
 assert.deepEqual(coverage.books.vlb.missing.map(row=>row.door),['V3']);
 assert.equal(view.data.canLockVlb,false);
 assert.match(view.data.lockBlockers.join(' '),/Every VLB machine needs an answer: 2\/3 answered; no answer yet: V3\./);
 let lock=await call(batch+'/lock-vlb','POST',{});
 assert.equal(lock.status,409);assert.match(lock.data.error,/no answer yet: V3\./);

 // An idle reason by hand answers V3; Lock VLB goes through.
 const idle=await call(batch+'/machines/'+ids.V3+'/answer','PUT',{book:'vlb',status:'no_operator',reason:'Driver on leave'});
 assert.equal(idle.status,200,JSON.stringify(idle.data));
 lock=await call(batch+'/lock-vlb','POST',{});
 assert.equal(lock.status,200,JSON.stringify(lock.data));assert.equal(lock.data.stage,'lmv_open');

 // L1 is idle in Pulse-1; L2 has nothing: Lock LMV waits for L2 only.
 view=await call(batch);
 assert.equal(view.data.canLockLmv,false);
 lock=await call(batch+'/lock-lmv','POST',{});
 assert.equal(lock.status,409);assert.match(lock.data.error,/Every LMV machine needs an answer: 1\/2 answered; no answer yet: L2\./);
 assert.equal((await call(batch+'/machines/'+ids.L2+'/answer','PUT',{book:'lmv',status:'standby',reason:'Kept at the office'})).status,200);
 lock=await call(batch+'/lock-lmv','POST',{});
 assert.equal(lock.status,200,JSON.stringify(lock.data));assert.equal(lock.data.stage,'elb_open');

 // Close waits for the loading machine's ELB as before, and now says so for the ELB book too.
 view=await call(batch);
 assert.match(view.data.closeBlockers.join(' '),/Every ELB machine needs an answer: 0\/1 answered; no answer yet: VPC-019\. Save its ELB on the Equipment ELB list/);
 const close=await call(batch+'/close','POST',{});
 assert.equal(close.status,409);assert.match(close.data.error,/VPC-019/);

 // Clearing an answer brings the warning back on the page; Fetch Pulse-1 by hand is gone.
 assert.deepEqual((await call(batch+'/machines/'+ids.V3+'/answer','DELETE')).data,{cleared:true});
 view=await call(batch);
 assert.deepEqual(view.data.fleetCoverage.books.vlb.missing.map(row=>row.door),['V3']);
 assert.equal((await fetch(base+batch+'/machines/'+ids.V2+'/pulse',{method:'POST',headers:{Authorization:'alice'}})).status,404);
});
