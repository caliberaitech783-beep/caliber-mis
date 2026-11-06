import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LOG_BOOK_SCHEMA,registerLogBooks} from '../server/routes/log-book.mjs';
import {twoStageEnabled,validateFleetEntry,buildMachineSnapshot,buildFleetList,closureBlockers,fleetProgress,activeSiteHolds,holdSummary,machineReportRows} from '../server/rules/vlb-two-stage.mjs';

const assets=[
 {id:'1',category:'Vehicle',door:'V1',currentLocation:'Sasti OC'},
 {id:'10',category:'Equipment',door:'VPC-019',equipmentName:'VPC 019',group:'Excavator',currentLocation:'Sasti OC'},
 {id:'11',category:'Equipment',door:'D1',equipmentName:'Dozer D1',group:'Dozer',currentLocation:'Sasti OC'},
 {id:'12',category:'Equipment',door:'VPC-077',equipmentName:'VPC 077',group:'Excavator',currentLocation:'Jayant OC'},
];

test('feature flag reads the environment per call',()=>{
 assert.equal(twoStageEnabled({}),true);assert.equal(twoStageEnabled({VLB_TWO_STAGE_BATCHES:'1'}),true);assert.equal(twoStageEnabled({VLB_TWO_STAGE_BATCHES:'off'}),false);assert.equal(twoStageEnabled({VLB_TWO_STAGE_BATCHES:'0'}),false);
});

test('machine snapshot reconciles labels to one master id and skips held cards',()=>{
 const records=[
  {id:1,book_no:'A',data:{location:'Sasti OC',trips:[{equipmentName:'V19',tripCount:5},{equipmentName:'VPC 019',equipmentId:'10',tripCount:3}]}},
  {id:2,book_no:'B',data:{location:'Sasti OC',trips:[{equipmentName:'VPC-019',tripCount:2}]}},
  {id:3,book_no:'C',data:{location:'Sasti OC',siteHolds:[{role:'vlb_loader',assetId:'12',assetSite:'Jayant OC'}],trips:[{equipmentName:'VPC 77',equipmentId:'12',tripCount:9}]}},
  {id:4,book_no:'D',data:{location:'Sasti OC',trips:[{equipmentName:'ZZ9',tripCount:1}]}},
 ];
 const {machines,unresolved}=buildMachineSnapshot(records,assets,'Sasti OC');
 assert.deepEqual(machines.map(m=>[m.assetId,m.trips,m.sourceCards]),[['10',10,2]]);
 assert.equal(unresolved.length,1);assert.equal(unresolved[0].bookNo,'D');
 const fleet=buildFleetList(assets,'Sasti OC',machines);
 assert.deepEqual(fleet.map(r=>[r.door,r.trips]),[['VPC-019',10],['D1',0]],'manual ELB includes every site machine, with VLB loaders first');
 const transferred=assets.map(a=>a.id==='12'?{...a,currentLocation:'Sasti OC'}:a);
 assert.equal(activeSiteHolds(records[2],assets).length,1);assert.equal(activeSiteHolds(records[2],transferred).length,0);
 assert.equal(holdSummary(records,assets)[0].assetId,'12');
 assert.equal(buildMachineSnapshot(records,transferred,'Sasti OC').machines.find(m=>m.assetId==='12').trips,9);
});

test('shift status rules tie trips and hours to a working machine',()=>{
 const errors=(input,trips)=>Object.values(validateFleetEntry(input,{trips,shiftHours:8}).errors);
 assert.match(errors({shiftStatus:'breakdown',statusReason:'Engine'},5).join(' '),/loaded 5 trips/);
 assert.match(errors({shiftStatus:'working',employeeId:'7',openingHmr:100,closingHmr:100},0).join(' '),/Zero trips and zero hours/);
 assert.match(errors({shiftStatus:'working',employeeId:'7',openingHmr:100,closingHmr:100},4).join(' '),/greater than zero/);
 assert.deepEqual(errors({shiftStatus:'working',employeeId:'7',openingHmr:100,closingHmr:103.5},0),[]);
 assert.deepEqual(errors({shiftStatus:'no_operator'},0),[]);
 assert.match(errors({shiftStatus:'maintenance'},0).join(' '),/reason or the job card/);
 assert.deepEqual(errors({shiftStatus:'maintenance',jobCardNo:'JC-1'},0),[]);
 assert.match(errors({shiftStatus:'working_partial_breakdown',employeeId:'7',openingHmr:1,closingHmr:3,manualBreakdownHours:8,statusReason:'x'},2).join(' '),/full-shift breakdown/);
 assert.equal(validateFleetEntry({shiftStatus:'breakdown',statusReason:'Engine'},{trips:0,shiftHours:12}).breakdownHours,12);
 assert.match(errors({shiftStatus:'working',employeeId:'7',openingHmr:1,closingHmr:10},1).join(' '),/exceed the 8-hour shift/);
});

test('closure requires loading machines and the machine report totals hours and trips',()=>{
 const fleet=[{assetId:'11',door:'D1',trips:0,saved_at:null},{assetId:'10',door:'VPC-019',trips:10,saved_at:'x',shift_status:'working'},{assetId:'13',door:'G1',trips:0,saved_at:null}];
 const blockers=closureBlockers({stage:'elb_open',fleet,holds:[]});
 assert.deepEqual(blockers,[]);
 assert.match(closureBlockers({stage:'elb_open',fleet:[...fleet,{door:'VPC-077',trips:4,skipped:true}],holds:[{label:'VPC-077',assetSite:'Jayant OC',cardCount:2,trips:17}]}).join(' '),/VPC-077 loaded 4 trips, no ELB saved/);
 assert.match(closureBlockers({stage:'vlb_open',fleet:[]})[0],/Lock VLB/);
 const report=machineReportRows([{assetId:'10',door:'VPC-019',trips:10,shift_status:'working'},{assetId:'11',door:'D1',trips:0,shift_status:'no_operator'}],[{asset_id:10,book_no:'E1',data:{openingHmr:100,closingHmr:105,employeeName:'Op'}}]);
 assert.equal(report.loaders[0].tripsPerHour,2);assert.equal(report.others[0].statusLabel,'No operator');assert.deepEqual([report.totals.trips,report.totals.hours,report.totals.working,report.totals.idle],[10,5,1,1]);
});

test('39 saved ELBs can close a 52-machine fleet with 13 unused machines',()=>{
 const fleet=Array.from({length:52},(_,index)=>({
  door:'E'+index,trips:index<20?1:0,
  ...(index<39?{saved_at:'2026-11-01',shift_status:'working'}:{}),
 }));
 assert.deepEqual(fleetProgress(fleet),{total:52,saved:39,remaining:0,optionalUnsaved:13,skipped:0,drafts:0,loaders:20});
 assert.deepEqual(closureBlockers({stage:'elb_open',fleet}),[]);
});

test('two-stage batch: holds wait for transfer, lock builds the fleet, stepper enforces status rules, closure permits unused equipment to remain blank',async t=>{
 const previous=process.env.VLB_TWO_STAGE_BATCHES;delete process.env.VLB_TWO_STAGE_BATCHES;t.after(()=>{if(previous===undefined)delete process.env.VLB_TWO_STAGE_BATCHES;else process.env.VLB_TWO_STAGE_BATCHES=previous;});
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const masters=[
  ['Equipment master',{category:'Vehicle',door:'V1',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  ['Equipment master',{category:'Vehicle',door:'V2',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  ['Users & employees',{login:'alice',employee:'Alice',employeeId:'CM-1',userRoles:'MIS User',status:'active',site:'Sasti OC'}],
  ['Users & employees',{login:'bob',employee:'Bob',employeeId:'CM-2',userRoles:'MIS User',status:'active',site:'Sasti OC'}],
  ['Shift Master',{site:'Sasti OC',shiftName:'Shift A',shiftCode:'I',startTime:'05:00:00',endTime:'13:00:00'}],
  ['Equipment master',{category:'Equipment',door:'VPC-019',equipmentName:'VPC 019',group:'Excavator',currentLocation:'Sasti OC'}],
  ['Equipment master',{category:'Equipment',door:'D1',equipmentName:'Dozer D1',group:'Dozer',currentLocation:'Sasti OC'}],
  ['Equipment master',{category:'Equipment',door:'VPC-077',equipmentName:'VPC 077',group:'Excavator',currentLocation:'Jayant OC'}],
  ['Equipment master',{category:'Equipment',door:'G9',equipmentName:'Grader G9',group:'Grader',currentLocation:'Jayant OC'}],
 ];
 const ids={};for(const [name,data] of masters){const {rows}=await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2) RETURNING id',[name,JSON.stringify(data)]);ids[data.door||data.login||data.shiftName]=String(rows[0].id);}
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json({limit:'5mb'}));
 const requireSession=(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.session={login:req.headers.authorization,role:'super',site:req.headers.authorization==='bob'?'Sasti OC':undefined,permissions:{adminLevel:['alice','admin'].includes(req.headers.authorization)?'Admin':''}};next()};
 registerLogBooks(app,{pool,requireSession,requireAdministrator:(req,res,next)=>next(),pulseMasterSync:{status:()=>({connected:false}),readBreakdownRequests:async()=>[]}});
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,method='GET',body,auth='alice')=>{const r=await fetch(base+route,{method,headers:{Authorization:auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const selection={site:'Sasti OC',date:'2026-12-18',shift:'S1'};
 const created=await call('/api/vlb-batches','POST',{...selection,requestKey:randomUUID()});
 assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.twoStage,true);assert.equal(created.data.stage,'vlb_open');assert.equal(created.data.canLockVlb,false,'empty batch cannot lock');
 const batch='/api/vlb-batches/'+created.data.id;
 const card=(door,trips)=>({bookDate:'2026-12-18',location:'Sasti OC',assetId:ids[door],employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,cardShift:'I',openingKmr:1000,closingKmr:1050,openingHmr:100,closingHmr:106,timeMode:'without',trips,requestKey:randomUUID()});
 const first=await call('/api/log-books/vehicle','POST',card('V1',[{equipmentName:'V19',tripCount:5},{equipmentName:'VPC 019',tripCount:3}]));
 assert.equal(first.status,201,JSON.stringify(first.data));assert.deepEqual(first.data.data.siteHolds,[]);
 const elbEarly=await call('/api/log-books/equipment','POST',{bookDate:'2026-12-18',location:'Sasti OC',assetId:ids.D1,employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,openingHmr:1,closingHmr:3,requestKey:randomUUID()});
 assert.equal(elbEarly.status,409);assert.match(elbEarly.data.error,/Lock VLB/);
 const elbNoBatch=await call('/api/log-books/equipment','POST',{bookDate:'2026-12-19',location:'Sasti OC',assetId:ids.D1,employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,openingHmr:1,closingHmr:3,requestKey:randomUUID()});
 assert.equal(elbNoBatch.status,409,'ELB without any batch for its site, date and shift is refused');assert.match(elbNoBatch.data.error,/Standalone ELB saving is discontinued/);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM mis_log_books WHERE book_type='equipment'")).rows[0].n,0,'no ELB record or book number is left behind');
 const held=await call('/api/log-books/vehicle','POST',card('V2',[{equipmentName:'VPC 77',tripCount:4}]));
 assert.equal(held.status,201,JSON.stringify(held.data));assert.equal(held.data.data.siteHolds.length,1);assert.equal(held.data.data.siteHolds[0].role,'vlb_loader');assert.equal(held.data.data.siteHolds[0].assetSite,'Jayant OC');
 let view=await call(batch);assert.equal(view.data.holds.length,1);assert.equal(view.data.holds[0].cardCount,1);assert.equal(view.data.holds[0].trips,4);
 const blocked=await call(batch+'/lock-vlb','POST',{});assert.equal(blocked.status,409);assert.match(blocked.data.error,/Awaiting transfer: VPC-077 from Jayant OC \(1 card, 4 trips\)/);
 await db.query("UPDATE master_records SET record_data=record_data||'{\"currentLocation\":\"Sasti OC\"}' WHERE id=$1",[ids['VPC-077']]);
 view=await call(batch);assert.equal(view.data.holds.length,0,'transfer clears the hold without any batch action');
 {const bob=await call(batch+'/lock-vlb','POST',{},'bob');assert.equal(bob.status,403,JSON.stringify(bob.data));}
 const locked=await call(batch+'/lock-vlb','POST',{});assert.equal(locked.status,200,JSON.stringify(locked.data));
 assert.equal(locked.data.stage,'elb_open');assert.ok(locked.data.vlb_locked_at);assert.equal(locked.data.canClose,true);assert.equal(locked.data.canContinue,false);
 assert.deepEqual(locked.data.machines.map(m=>[m.label,m.trips,m.sourceCards]),[['VPC-019',8,1],['VPC-077',4,1]]);
 assert.deepEqual(locked.data.fleet.map(r=>[r.door,r.trips]),[['VPC-019',8],['VPC-077',4],['D1',0]],'manual ELB contains loaders and unused site equipment');
 assert.equal(locked.data.fleetProgress.total,3);
 await db.query('DELETE FROM mis_vlb_batch_fleet WHERE batch_id=$1 AND asset_id=$2',[created.data.id,ids.D1]);
 assert.deepEqual((await call(batch)).data.fleet.map(row=>row.door),['VPC-019','VPC-077','D1'],'an older open batch automatically gains its missing zero-trip site equipment');
 assert.equal((await call(batch+'/lock-vlb','POST',{})).status,409,'cannot lock twice');
 assert.equal((await call('/api/log-books/vehicle','POST',card('V1',[{equipmentName:'V19',tripCount:1}]))).status,409,'VLB frozen after lock');
 const fleet=assetId=>batch+'/fleet/'+assetId;
 const tripsAsBreakdown=await call(fleet(ids['VPC-019']),'POST',{shiftStatus:'breakdown',statusReason:'Engine'});
 assert.equal(tripsAsBreakdown.status,400);assert.match(tripsAsBreakdown.data.error,/loaded 8 trips/);
 const zeroHours=await call(fleet(ids['VPC-019']),'POST',{shiftStatus:'working',employeeId:ids.alice,openingHmr:500,closingHmr:500});
 assert.equal(zeroHours.status,400);assert.match(zeroHours.data.error,/greater than zero/);
 const pulse=await call(fleet(ids['VPC-019'])+'/breakdowns');assert.equal(pulse.status,200,JSON.stringify(pulse.data));assert.equal(pulse.data.breakdownHours,0);assert.equal(pulse.data.assetId,ids['VPC-019']);assert.equal(pulse.data.bookDate,selection.date);assert.equal(pulse.data.shiftHours,8);assert.deepEqual(pulse.data.breakdowns,[]);
 assert.equal((await call(fleet(ids.G9)+'/breakdowns')).status,404,'cannot read an equipment outside the batch fleet');
 const denied=await call(fleet(ids['VPC-019'])+'/breakdowns','GET',undefined,'unassigned-user');assert.ok(denied.status>=400,'site scope is checked before the Pulse request');
 const draft=await call(fleet(ids['VPC-019'])+'/draft','PUT',{draft:{shiftStatus:'working',openingHmr:500}});assert.equal(draft.status,200);
 assert.equal((await call(batch+'/fleet')).data.fleet[0].draft,null,'incomplete ELB values are not persisted as drafts');
 const loader=await call(fleet(ids['VPC-019']),'POST',{shiftStatus:'working',employeeId:ids.alice,openingHmr:500,closingHmr:505,jobCardNo:'JC-7'});
 assert.equal(loader.status,200,JSON.stringify(loader.data));assert.equal(loader.data.record.book_type,'equipment');assert.equal(loader.data.record.data.shiftStatus,'working');assert.equal(loader.data.record.data.fleetTrips,8);
 assert.equal(loader.data.fleetProgress.saved,1);assert.equal(loader.data.fleet[0].draft,null);
 assert.equal((await call(batch)).data.canEditSavedFleet,true,'admin capability is supplied by the server');
 const editInput={shiftStatus:'working',employeeId:ids.alice,openingHmr:500,closingHmr:505,jobCardNo:'JC-7',remark:'Admin correction',revision:loader.data.record.revision};
 const edited=await call(fleet(ids['VPC-019']),'POST',editInput);
 assert.equal(edited.status,200,JSON.stringify(edited.data));
 assert.equal(edited.data.record.id,loader.data.record.id,'editing updates the existing record');
 assert.equal(edited.data.record.book_no,loader.data.record.book_no,'editing preserves the ELB number');
 assert.equal(edited.data.record.data.remark,'Admin correction');
 assert.equal((await call(fleet(ids['VPC-019']),'POST',editInput)).status,409,'stale edits cannot overwrite the new revision');
 let closeTry=await call(batch+'/close','POST',{});assert.equal(closeTry.status,409);assert.match(closeTry.data.error,/VPC-077 loaded 4 trips, no ELB saved/);
 const elbForm=await call('/api/log-books/equipment','POST',{bookDate:'2026-12-18',location:'Sasti OC',assetId:ids['VPC-077'],employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,openingHmr:40,closingHmr:44,shiftStatus:'working',requestKey:randomUUID()});
 assert.equal(elbForm.status,201,JSON.stringify(elbForm.data));
 view=await call(batch);assert.deepEqual(view.data.fleetProgress,{total:3,saved:2,remaining:0,optionalUnsaved:1,skipped:0,drafts:0,loaders:2});assert.deepEqual(view.data.closeBlockers,[]);
 assert.equal(view.data.machineReport.totals.trips,12);assert.equal(view.data.machineReport.totals.hours,9);assert.equal(view.data.machineReport.loaders[0].tripsPerHour,1.6);
 const adminView=await call(batch,'GET',undefined,'admin');assert.equal(adminView.data.canClose,true);
 const adminList=await call('/api/vlb-batches','GET',undefined,'admin');assert.equal(adminList.data.batches.find(row=>row.id===created.data.id)?.canClose,true);
 assert.equal((await call(batch+'/close','POST',{},'bob')).status,403,'non-owner MIS users cannot close');
 const elbPath='/api/log-books/equipment/'+elbForm.data.id;
 assert.equal((await call(elbPath,'DELETE',{revision:elbForm.data.revision+1})).status,409);
 assert.equal((await call(elbPath,'DELETE',{revision:elbForm.data.revision})).status,200);
 assert.equal((await call(batch)).data.fleet.find(row=>row.door==='VPC-077').saved_at,null);
 const replacement=await call('/api/log-books/equipment','POST',{bookDate:'2026-12-18',location:'Sasti OC',assetId:ids['VPC-077'],employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,openingHmr:40,closingHmr:44,shiftStatus:'working',requestKey:randomUUID()});
 assert.equal(replacement.status,201,JSON.stringify(replacement.data));
 const closed=await call(batch+'/close','POST',{},'admin');assert.equal(closed.status,200,JSON.stringify(closed.data));assert.equal(closed.data.stage,'closed');assert.ok(closed.data.closed_at);
 assert.equal(closed.data.audit.find(entry=>entry.action==='saved_and_locked').actor,'admin');
 assert.equal((await call('/api/log-books/equipment/'+replacement.data.id,'DELETE',{revision:replacement.data.revision})).status,403);
 assert.equal((await call(fleet(ids['VPC-019']),'POST',{shiftStatus:'not_in_use'})).status,409,'closed batch freezes machines');
 const list=await call('/api/vlb-batches');assert.equal(list.data.twoStage,true);assert.equal(list.data.batches[0].stage,'closed');
 assert.ok(closed.data.audit.some(e=>e.action==='vlb_locked')&&closed.data.audit.some(e=>e.action==='machine_saved')&&closed.data.audit.some(e=>e.action==='elb_card_linked'));
 // Both manual and scanned inserts may append to locked batches; existing cards remain protected.
 const frozen=(await db.query('SELECT closed_at,stage,vlb_locked_at,closure_revision FROM mis_vlb_batches WHERE id=$1',[created.data.id])).rows[0];
 for(const door of ['V3','V4','V5']){const result=await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1) RETURNING id",[JSON.stringify({category:'Vehicle',door,currentLocation:'Sasti OC',equipmentName:'Tipper'})]);ids[door]=String(result.rows[0].id);}
 const lateInput=card('V3',[{equipmentName:'V19',tripCount:2}]);
 const late=await call('/api/log-books/vehicle','POST',lateInput);assert.equal(late.status,201,JSON.stringify(late.data));
 assert.equal((await call('/api/log-books/vehicle','POST',lateInput)).status,200,'retry remains idempotent');
 assert.equal((await call('/api/log-books/vehicle/'+late.data.id,'PUT',{...lateInput,revision:late.data.revision,remark:'changed'})).status,409,'late VLB is immediately locked');
 const {insertLogBook,resolveLogBookData}=await import('../server/routes/log-book.mjs');
 await db.exec('BEGIN');try{const data=await resolveLogBookData(pool,'vehicle',card('V4',[{equipmentName:'V19',tripCount:3}]));data.scanCardId=randomUUID();await insertLogBook(pool,'vehicle',data,randomUUID(),'alice');await db.exec('COMMIT');}catch(error){await db.exec('ROLLBACK');throw error;}
 const newMachine=(await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1) RETURNING id",[JSON.stringify({category:'Equipment',door:'G2',equipmentName:'Grader G2',group:'Grader',currentLocation:'Sasti OC'})])).rows[0].id;
 const lateElbInput={bookDate:'2026-12-18',location:'Sasti OC',assetId:String(newMachine),employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,openingHmr:20,closingHmr:22,requestKey:randomUUID()};
 const lateElb=await call('/api/log-books/equipment','POST',lateElbInput);assert.equal(lateElb.status,201,JSON.stringify(lateElb.data));
 assert.equal((await call('/api/log-books/equipment/'+lateElb.data.id,'PUT',{...lateElbInput,revision:lateElb.data.revision,remark:'changed'})).status,409,'late ELB is immediately locked');
 const afterLate=await call(batch);assert.equal(afterLate.data.entry_count,4);assert.equal(afterLate.data.machineReport.totals.trips,17,'late VLB trips reach the machine report');
 assert.ok(afterLate.data.elbRecords.some(r=>r.id===lateElb.data.id));
 assert.deepEqual((await db.query('SELECT closed_at,stage,vlb_locked_at,closure_revision FROM mis_vlb_batches WHERE id=$1',[created.data.id])).rows[0],frozen,'adding cards leaves closure and locks untouched');
 assert.equal((await db.query('SELECT data FROM mis_log_books WHERE id=$1',[first.data.id])).rows[0].data.remark,first.data.data.remark,'existing cards remain unchanged');
 await db.query("UPDATE mis_vlb_batches SET closed_at=NULL,stage='elb_open' WHERE id=$1",[created.data.id]);
 const lateLocked=await call('/api/log-books/vehicle','POST',card('V5',[{equipmentName:'V19',tripCount:1}]));assert.equal(lateLocked.status,201,JSON.stringify(lateLocked.data));
 assert.equal((await call('/api/log-books/vehicle/'+first.data.id,'PUT',{...card('V1',first.data.data.trips),revision:first.data.revision})).status,409,'VLB stage lock still protects existing cards');
 assert.equal((await call(batch)).data.stage,'elb_open');

});
