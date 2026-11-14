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

