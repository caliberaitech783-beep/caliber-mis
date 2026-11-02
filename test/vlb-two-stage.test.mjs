import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {LOG_BOOK_SCHEMA,registerLogBooks} from '../log-book.mjs';
import {twoStageEnabled,validateFleetEntry,buildMachineSnapshot,buildFleetList,closureBlockers,activeSiteHolds,holdSummary,machineReportRows} from '../vlb-two-stage.mjs';

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
 assert.deepEqual(fleet.map(r=>[r.door,r.trips]),[['VPC-019',10],['D1',0]]);
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

test('closure lists missing machines, loaders first, and the machine report totals hours and trips',()=>{
 const fleet=[{assetId:'11',door:'D1',trips:0,saved_at:null},{assetId:'10',door:'VPC-019',trips:10,saved_at:'x',shift_status:'working'},{assetId:'13',door:'G1',trips:0,saved_at:null}];
 const blockers=closureBlockers({stage:'elb_open',fleet,holds:[]});
 assert.equal(blockers.length,1);assert.match(blockers[0],/^Machines without a saved ELB: D1 no ELB saved; G1 no ELB saved\.$/);
 assert.match(closureBlockers({stage:'elb_open',fleet:[{door:'VPC-019',trips:10}],holds:[{label:'VPC-077',assetSite:'Jayant OC',cardCount:2,trips:17}]}).join(' '),/VPC-019 loaded 10 trips, no ELB saved/);
 assert.match(closureBlockers({stage:'vlb_open',fleet:[]})[0],/Lock VLB/);
 const report=machineReportRows([{assetId:'10',door:'VPC-019',trips:10,shift_status:'working'},{assetId:'11',door:'D1',trips:0,shift_status:'no_operator'}],[{asset_id:10,book_no:'E1',data:{openingHmr:100,closingHmr:105,employeeName:'Op'}}]);
 assert.equal(report.loaders[0].tripsPerHour,2);assert.equal(report.others[0].statusLabel,'No operator');assert.deepEqual([report.totals.trips,report.totals.hours,report.totals.working,report.totals.idle],[10,5,1,1]);
});

test('two-stage batch: holds wait for transfer, lock builds the fleet, stepper enforces status rules, closure needs every machine',async t=>{
 const previous=process.env.VLB_TWO_STAGE_BATCHES;delete process.env.VLB_TWO_STAGE_BATCHES;t.after(()=>{if(previous===undefined)delete process.env.VLB_TWO_STAGE_BATCHES;else process.env.VLB_TWO_STAGE_BATCHES=previous;});
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const masters=[
  ['Equipment master',{category:'Vehicle',door:'V1',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  ['Equipment master',{category:'Vehicle',door:'V2',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
  ['Users & employees',{login:'alice',employee:'Alice',employeeId:'CM-1',userRoles:'MIS User',status:'active',site:'Sasti OC'}],
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
 const requireSession=(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({error:'Sign in'});req.session={login:req.headers.authorization,role:'super',permissions:{adminLevel:req.headers.authorization==='alice'?'Admin':''}};next()};
 registerLogBooks(app,{pool,requireSession,requireAdministrator:(req,res,next)=>next(),pulseMasterSync:{status:()=>({connected:false}),readBreakdownRequests:async()=>[]}});
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,method='GET',body,auth='alice')=>{const r=await fetch(base+route,{method,headers:{Authorization:auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const selection={site:'Sasti OC',date:'2026-12-18',shift:'S1'};
 const created=await call('/api/vlb-batches','POST',{...selection,requestKey:randomUUID()});
 assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.twoStage,true);assert.equal(created.data.stage,'vlb_open');assert.equal(created.data.canLockVlb,false,'empty batch cannot lock');
 const batch='/api/vlb-batches/'+created.data.id;
 const card=(door,trips)=>({bookDate:'2026-12-18',location:'Sasti OC',assetId:ids[door],employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,cardShift:'I',openingKmr:10,closingKmr:60,openingHmr:100,closingHmr:106,timeMode:'without',trips,requestKey:randomUUID()});
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
 assert.deepEqual(locked.data.fleet.map(r=>[r.door,r.trips]),[['VPC-019',8],['VPC-077',4],['D1',0]],'grader at Jayant is not in the Sasti fleet');
 assert.equal(locked.data.fleetProgress.total,3);
 assert.equal((await call(batch+'/lock-vlb','POST',{})).status,409,'cannot lock twice');
 assert.equal((await call('/api/log-books/vehicle','POST',card('V1',[{equipmentName:'V19',tripCount:1}]))).status,409,'VLB frozen after lock');
 const fleet=assetId=>batch+'/fleet/'+assetId;
 const tripsAsBreakdown=await call(fleet(ids['VPC-019']),'POST',{shiftStatus:'breakdown',statusReason:'Engine'});
 assert.equal(tripsAsBreakdown.status,400);assert.match(tripsAsBreakdown.data.error,/loaded 8 trips/);
 const zeroHours=await call(fleet(ids['VPC-019']),'POST',{shiftStatus:'working',employeeId:ids.alice,openingHmr:500,closingHmr:500});
 assert.equal(zeroHours.status,400);assert.match(zeroHours.data.error,/greater than zero/);
 const draft=await call(fleet(ids['VPC-019'])+'/draft','PUT',{draft:{shiftStatus:'working',openingHmr:500}});assert.equal(draft.status,200);
 assert.equal((await call(batch+'/fleet')).data.fleet[0].draft.openingHmr,500,'auto-saved draft survives a reload');
 const loader=await call(fleet(ids['VPC-019']),'POST',{shiftStatus:'working',employeeId:ids.alice,openingHmr:500,closingHmr:505,jobCardNo:'JC-7'});
 assert.equal(loader.status,200,JSON.stringify(loader.data));assert.equal(loader.data.record.book_type,'equipment');assert.equal(loader.data.record.data.shiftStatus,'working');assert.equal(loader.data.record.data.fleetTrips,8);
 assert.equal(loader.data.fleetProgress.saved,1);assert.equal(loader.data.fleet[0].draft,null);
 let closeTry=await call(batch+'/close','POST',{});assert.equal(closeTry.status,409);assert.match(closeTry.data.error,/VPC-077 loaded 4 trips, no ELB saved; D1 no ELB saved/);
 const dozerZero=await call(fleet(ids.D1),'POST',{shiftStatus:'working',employeeId:ids.alice,openingHmr:10,closingHmr:10});
 assert.equal(dozerZero.status,400);assert.match(dozerZero.data.error,/Zero trips and zero hours/);
 const dozer=await call(fleet(ids.D1),'POST',{shiftStatus:'no_operator'});
 assert.equal(dozer.status,200,JSON.stringify(dozer.data));assert.equal(dozer.data.record.data.employeeName,'');assert.equal(dozer.data.record.data.idleHours,8);
 const elbForm=await call('/api/log-books/equipment','POST',{bookDate:'2026-12-18',location:'Sasti OC',assetId:ids['VPC-077'],employeeId:ids.alice,shiftId:ids['Shift A'],shiftHours:8,openingHmr:40,closingHmr:44,shiftStatus:'working',requestKey:randomUUID()});
 assert.equal(elbForm.status,201,JSON.stringify(elbForm.data));
 view=await call(batch);assert.equal(view.data.fleetProgress.saved,3,'a normal ELB save joins the batch fleet');assert.deepEqual(view.data.closeBlockers,[]);
 assert.equal(view.data.machineReport.totals.trips,12);assert.equal(view.data.machineReport.totals.hours,9);assert.equal(view.data.machineReport.loaders[0].tripsPerHour,1.6);
 const reSave=await call(fleet(ids.D1),'POST',{shiftStatus:'maintenance',jobCardNo:'JC-9'});assert.equal(reSave.status,200);assert.equal(reSave.data.record.id,dozer.data.record.id,'re-saving a machine updates its log book');
 const closed=await call(batch+'/close','POST',{});assert.equal(closed.status,200,JSON.stringify(closed.data));assert.equal(closed.data.stage,'closed');assert.ok(closed.data.closed_at);
 assert.equal((await call(fleet(ids.D1),'POST',{shiftStatus:'not_in_use'})).status,409,'closed batch freezes machines');
 const list=await call('/api/vlb-batches');assert.equal(list.data.twoStage,true);assert.equal(list.data.batches[0].stage,'closed');
 assert.ok(closed.data.audit.some(e=>e.action==='vlb_locked')&&closed.data.audit.some(e=>e.action==='machine_saved')&&closed.data.audit.some(e=>e.action==='elb_card_linked'));
});
