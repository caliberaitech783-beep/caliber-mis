import test from 'node:test';
import assert from 'node:assert/strict';
import {assetAtSiteOnDate,transferForAsset,attachTransferHistory,assetForSiteOnDate} from '../shared/equipment-transfer-history.mjs';
import {PGlite} from '@electric-sql/pglite';
import {resolveLogBookData} from '../server/routes/log-book.mjs';

const asset={id:'42',door:'VPC 60',currentLocation:'Gauri Pauni'};
const transfer={equipmentMasterId:'42',source:'Majari',destination:'Gauri Pauni',transferDate:'2026-11-12',status:'Completed'};
test('source can enter through transfer date and destination afterwards',()=>{
 assert.equal(assetAtSiteOnDate(asset,[transfer],'Majari','2026-11-08'),true);
 assert.equal(assetAtSiteOnDate(asset,[transfer],'Majari','2026-11-12'),true);
 assert.equal(assetAtSiteOnDate(asset,[transfer],'Majari','2026-11-13'),false);
 assert.equal(assetAtSiteOnDate(asset,[transfer],'Gauri Pauni','2026-11-12'),true);
 assert.equal(assetAtSiteOnDate(asset,[transfer],'Gauri Pauni','2026-11-11'),false);
});
test('only completed, matching and continuous transfers are used',()=>{
 assert.equal(assetAtSiteOnDate(asset,[{...transfer,status:'Awaiting source approval'}],'Majari','2026-11-12'),false);
 assert.equal(transferForAsset({...transfer,equipmentMasterId:'99'},asset),false);
 assert.equal(assetAtSiteOnDate(asset,[{...transfer,destination:'Other'}],'Majari','2026-11-12'),false);
});
test('ambiguous door numbers do not attach another asset’s history',()=>{
 const assets=[asset,{...asset,id:'43'}];
 const history=attachTransferHistory(assets,[{...transfer,equipmentMasterId:'',equipment:'VPC 60'}]);
 assert.equal(history[0].transferHistory.length,0);
 assert.equal(history[1].transferHistory.length,0);
});
test('dated options include the prior site through the transfer date',()=>{
 const record={...asset,site:asset.currentLocation,transferHistory:[transfer]};
 assert.equal(assetForSiteOnDate(record,'Majari','2026-11-12').site,'Majari');
 assert.equal(assetForSiteOnDate(record,'Majari','2026-11-13').site,'Gauri Pauni');
});

test('VPC52 and VPC53 remain at Jayant through 17 November only',()=>{
 for(const door of ['VPC52','VPC 53 - 01702']){
  const moved={id:door,door,currentLocation:'Dudhichua OB'};
  assert.equal(assetAtSiteOnDate(moved,[],'Jayant OB','2026-11-01'),true,door);
  assert.equal(assetAtSiteOnDate(moved,[],'Jayant OB','2026-11-17'),true,door);
  assert.equal(assetAtSiteOnDate(moved,[],'Dudhichua OB','2026-11-17'),false,door);
  assert.equal(assetAtSiteOnDate(moved,[],'Jayant OB','2026-11-18'),false,door);
  assert.equal(assetAtSiteOnDate(moved,[],'Dudhichua OB','2026-11-18'),true,door);
 }
});

test('manual and scan validation use the transfer date for a previous site',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY, master_name TEXT, record_data JSONB)');
 const add=async(name,data)=>(await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2) RETURNING id',[name,data])).rows[0].id;
 const id=await add('Equipment master',{category:'Vehicle',door:'VPC60',currentLocation:'Gauri Pauni'});
 const machine=await add('Equipment master',{category:'Equipment',door:'TPC 63',currentLocation:'Gauri Pauni'});
 const employee=await add('Employee master',{name:'Driver',employeeId:'111',site:'Majari'});
 const shift=await add('Shift Master',{name:'Shift A',site:'Majari',shiftCode:'S1'});
 await add('Vehicle transfers',{equipmentMasterId:String(id),source:'Majari',destination:'Gauri Pauni',transferDate:'2026-11-12',status:'Completed'});
 await add('Vehicle transfers',{equipmentMasterId:String(machine),source:'Majari',destination:'Gauri Pauni',transferDate:'2026-11-12',status:'Completed'});
 const input={bookDate:'2026-11-12',location:'Majari',assetId:id,employeeId:employee,shiftId:shift,shiftHours:8,openingKmr:10,closingKmr:20,openingHmr:10,closingHmr:11,trips:[]};
 const previous=process.env.VLB_TWO_STAGE_BATCHES;process.env.VLB_TWO_STAGE_BATCHES='0';
 t.after(()=>{if(previous===undefined)delete process.env.VLB_TWO_STAGE_BATCHES;else process.env.VLB_TWO_STAGE_BATCHES=previous;});
 for(const manualEntry of [true,false]){
  const result=await resolveLogBookData(db,'vehicle',input,{manualEntry});
  assert.deepEqual(result.siteHolds,[]);
  await assert.rejects(()=>resolveLogBookData(db,'vehicle',{...input,bookDate:'2026-11-13'},{manualEntry}),/different location/);
  const equipment={...input,assetId:machine};
  assert.deepEqual((await resolveLogBookData(db,'equipment',equipment,{manualEntry})).siteHolds,[]);
  await assert.rejects(()=>resolveLogBookData(db,'equipment',{...equipment,bookDate:'2026-11-13'},{manualEntry}),/different location/);
 }
});

// 16 Nov 2026: a transfer waits about three days for approvals; the destination's pending log books
// must not fail with "must belong to this location" meanwhile.
test('a pending transfer lets the destination enter log books from the transfer date',async()=>{
 const {assignmentWindows,logBookAssignment}=await import('../shared/log-book-transfers.mjs');
 const atSource={id:'42',door:'VPC 52',currentLocation:'Majari'};
 for(const status of ['Awaiting source approval','Awaiting destination MIS verification','Awaiting destination PM acceptance']){
  const pending={...transfer,status};
  assert.equal(assetAtSiteOnDate(atSource,[pending],'Gauri Pauni','2026-11-12'),true,status);
  assert.equal(assetAtSiteOnDate(atSource,[pending],'Gauri Pauni','2026-11-14'),true,status);
  assert.equal(assetAtSiteOnDate(atSource,[pending],'Gauri Pauni','2026-11-11'),false,status);
  assert.equal(assetAtSiteOnDate(atSource,[pending],'Majari','2026-11-14'),true,status);
  assert.equal(assetForSiteOnDate({...atSource,transferHistory:[pending]},'Gauri Pauni','2026-11-13').currentLocation,'Gauri Pauni');
 }
 // A pending transfer from another site, a cancelled one or another machine's is not evidence.
 assert.equal(assetAtSiteOnDate({...atSource,currentLocation:'Other'},[{...transfer,status:'Awaiting destination PM acceptance'}],'Gauri Pauni','2026-11-13'),false);
 assert.equal(assetAtSiteOnDate(atSource,[{...transfer,status:'Cancelled'}],'Gauri Pauni','2026-11-13'),false);
 assert.equal(assetAtSiteOnDate(atSource,[{...transfer,equipmentMasterId:'99',status:'Awaiting destination PM acceptance'}],'Gauri Pauni','2026-11-13'),false);
 // With an exact-time history, the pending destination opens at its transfer time and the source stays open.
 const history=[{equipmentMasterId:'42',source:'Gauri Pauni',destination:'Majari',transferDate:'2026-11-01',transferTime:'06:00',status:'Completed'},{...transfer,transferTime:'14:00',status:'Awaiting destination PM acceptance'}];
 const windows=assignmentWindows(atSource,history);
 assert.equal(logBookAssignment(windows,'Gauri Pauni','2026-11-13','06:00',8)?.partial,false);
 assert.equal(logBookAssignment(windows,'Majari','2026-11-13','06:00',8)?.partial,false);
 assert.equal(logBookAssignment(windows,'Gauri Pauni','2026-11-12','10:00',8).start,Date.parse('2026-11-12T14:00:00+05:30'));
 assert.throws(()=>logBookAssignment(windows,'Gauri Pauni','2026-11-11','06:00',8),/not assigned to this site/);
});
