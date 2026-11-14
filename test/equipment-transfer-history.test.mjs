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
