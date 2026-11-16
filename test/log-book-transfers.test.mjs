import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {resolveLogBookData} from '../server/routes/log-book.mjs';

test('both books accept historical assignments and enforce the exact overnight transfer boundary',async t=>{
 const db=new PGlite();
 t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 const source='Majari',destination='Gauri Pauni';
 const date='2026-11-12',next='2026-11-13';
 const move={status:'Completed',transferDate:next,transferTime:'02:30:15',source,destination};
 const masters=[
  ['Equipment master',{category:'Vehicle',door:'VPC 60',currentLocation:destination}],
  ['Equipment master',{category:'Equipment',door:'L1',currentLocation:destination}],
  ['Users & employees',{employee:'Operator'}],
  ['Shift Master',{site:source,shiftName:'III',startTime:'21:00:00'}],
  ['Shift Master',{site:destination,shiftName:'III',startTime:'21:00:00'}],
  ['Vehicle transfers',{...move,equipmentMasterId:'1'}],
  ['Vehicle transfers',{...move,equipmentMasterId:'2'}],
  ['Vehicle transfers',{...move,equipmentMasterId:'1',status:'Awaiting source approval',transferDate:'2026-11-09'}],
 ];
 for(const [name,data] of masters)await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2)',[name,JSON.stringify(data)]);
 const input={bookDate:date,location:source,shiftHours:8,assetId:1,shiftId:4,employeeId:3,openingHmr:100,closingHmr:102,openingKmr:10,closingKmr:15};
 const trip={equipmentName:'L1',tripCount:1,loadingTime:'02:15:00',unloadingTime:'02:30:15'};
 const vehicle=patch=>resolveLogBookData(db,'vehicle',{...input,trips:[trip],...patch});
 const equipment=patch=>resolveLogBookData(db,'equipment',{...input,assetId:2,...patch});
 for(const save of [vehicle,equipment]){
  const previous=await save({bookDate:'2026-11-08'});
  assert.equal(previous.scheduledHours,undefined);
  const old=await save({});
  assert.equal(old.location,source);
  assert.equal(old.transferPeriod.end,'2026-11-12T21:00:15.000Z');
  assert.equal(old.scheduledHours,5.504166666666666);
  const moved=await save({location:destination,shiftId:5,trips:[]});
  assert.equal(moved.transferPeriod.start,old.transferPeriod.end);
  assert.equal(moved.scheduledHours+old.scheduledHours,8);
  await assert.rejects(save({bookDate:next}),/not assigned/);
  await assert.rejects(save({location:destination,shiftId:5,bookDate:'2026-11-08',trips:[]}),/not assigned/);
 }
 await assert.rejects(vehicle({trips:[{...trip,unloadingTime:'02:30:16'}]}),/Split the entry at the transfer time/);
 await assert.rejects(vehicle({trips:[{...trip,loadingTime:'02:30:15',unloadingTime:'02:31:00'}]}),/transfer period/);
 const destinationTrip=await vehicle({location:destination,shiftId:5,trips:[{...trip,loadingTime:'02:30:15',unloadingTime:'02:31:00'}]});
 assert.equal(destinationTrip.totalTrips,1);
 const job={jobType:'Loading',startDate:date,startTime:'22:00:00',endDate:next,endTime:'02:30:15'};
 assert.equal((await equipment({jobDetails:[job]})).jobDetails.length,1);
 await assert.rejects(equipment({jobDetails:[{...job,endTime:'02:30:16'}]}),/Split the entry at the transfer time/);
 await assert.rejects(equipment({closingHmr:106}),/Working hours/);
});


// Owner, 16 Nov 2026: Sasti -> Majri on the 15th at 12:00. Sasti's late entries up to 12:00 on the
// 15th are never stopped; Majri enters from 12:00. LMV follows the same split as VLB and ELB, and a
// transfer with no time uses the moment it was completed that day.
test('Sasti keeps entering up to the transfer time on VLB, ELB and LMV; Majri from it',async t=>{
 const db=new PGlite();
 t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 const source='Sasti',destination='Majri',day='2026-11-15';
 const move={status:'Completed',transferDate:day,transferTime:'12:00:00',source,destination};
 const masters=[
  ['Equipment master',{category:'Vehicle',door:'V1',currentLocation:destination}],
  ['Equipment master',{category:'Equipment',door:'L1',currentLocation:destination}],
  ['Equipment master',{category:'LMV',door:'LMV1',currentLocation:destination}],
  ['Users & employees',{employee:'Operator'}],
  ['Shift Master',{site:source,shiftName:'I',startTime:'06:00:00'}],
  ['Shift Master',{site:destination,shiftName:'I',startTime:'06:00:00'}],
  ['Vehicle transfers',{...move,equipmentMasterId:'1'}],
  ['Vehicle transfers',{...move,equipmentMasterId:'2'}],
  ['Vehicle transfers',{...move,equipmentMasterId:'3'}],
 ];
 for(const [name,data] of masters)await db.query('INSERT INTO master_records(master_name,record_data) VALUES($1,$2)',[name,JSON.stringify(data)]);
 const input={location:source,shiftHours:8,shiftId:5,employeeId:4,openingHmr:100,closingHmr:102,openingKmr:10,closingKmr:15};
 for(const [kind,assetId] of [['vehicle',1],['equipment',2],['lmv',3]]){
  const save=patch=>resolveLogBookData(db,kind,{...input,assetId,bookDate:day,...(kind==='vehicle'?{trips:[]}:{}),...patch});
  for(const bookDate of ['2026-11-12','2026-11-13','2026-11-14'])assert.equal((await save({bookDate})).location,source,kind+' '+bookDate);
  const sasti=await save({});
  assert.equal(sasti.transferPeriod.end,'2026-11-15T06:30:00.000Z',kind);
  assert.equal(sasti.scheduledHours,6,kind);
  const majri=await save({location:destination,shiftId:6});
  assert.equal(majri.transferPeriod.start,'2026-11-15T06:30:00.000Z',kind);
  assert.equal(majri.scheduledHours,2,kind);
  await assert.rejects(save({bookDate:'2026-11-16'}),/not assigned|different location/,kind);
  await assert.rejects(save({location:destination,shiftId:6,bookDate:'2026-11-14'}),/not assigned|different location/,kind);
 }
 // No transfer time: the completion (destination acceptance) at 12:00 on the 15th is the cutoff.
 await db.query("UPDATE master_records SET record_data=record_data-'transferTime'||jsonb_build_object('sourceApprovedAt','2026-11-15T09:00:00+05:30','destinationAcceptedAt','2026-11-15T12:00:00+05:30') WHERE master_name='Vehicle transfers'");
 for(const [kind,assetId] of [['vehicle',1],['equipment',2],['lmv',3]]){
  const sasti=await resolveLogBookData(db,kind,{...input,assetId,bookDate:day,...(kind==='vehicle'?{trips:[]}:{})});
  assert.equal(sasti.transferPeriod.end,'2026-11-15T06:30:00.000Z',kind);
 }
});
