import test from 'node:test';
import assert from 'node:assert/strict';
import {manualShiftWindow,MANUAL_SHIFTS} from '../shared/manual-shift.mjs';
import {normalizeLogBook,resolveLogBookData} from '../server/routes/log-book.mjs';
import {assertCombinedShiftMeters} from '../server/rules/log-book-shift-hmr.mjs';
const base={id:'3',name:'Shift A',shiftCode:'A',site:'Jayant OC',startTime:'05:00:00',endTime:'13:00:00'};
const payload={bookDate:'2026-11-01',location:'Jayant OC',assetId:1,employeeId:2,shiftId:3,shiftHours:12,cardShift:'I',openingHmr:100,closingHmr:111,openingKmr:1000,closingKmr:1100,trips:[],manualShift:'day'};
test('manual Day/Night options retain master starts and allow an independently selected duration',()=>{
 assert.deepEqual(MANUAL_SHIFTS.map(row=>row.label),['Day','Night']);
 const day=manualShiftWindow(payload,base,[]);assert.equal(day.startTime,'05:00');assert.equal(day.endTime,'17:00');
 const night=manualShiftWindow({...payload,manualShift:'night'},base,[{...base,id:'4',shiftCode:'NIGHT',startTime:'21:00:00',endTime:'05:00:00'}]);
 assert.equal(night.startTime,'21:00');assert.equal(night.endTime,'09:00');
 assert.equal(manualShiftWindow(payload,base,[{...base,site:'Sasti OC',shiftCode:'DAY',startTime:'08:00'}]).startTime,'05:00');
 assert.equal(base.endTime,'13:00:00','master remains unchanged');
});
for(const kind of ['vehicle','equipment'])test(kind+' manual and scan normalization apply their shift-hours rules',async()=>{
 const rows=[{id:1,master_name:'Equipment master',record_data:{kind,site:'Jayant OC',door:'V1'}},{id:2,master_name:'Employee master',record_data:{name:'Driver',site:'Jayant OC'}},{id:3,master_name:'Shift Master',record_data:base}];
 const client={query:async sql=>({rows:sql.includes('master_name=ANY')?[]:sql.includes("master_name='Equipment master'")?[rows[0]]:sql.includes("master_name='Shift Master'")?[rows[2]]:sql.includes('master_records')?rows:[]})};
 const saved=await resolveLogBookData(client,kind,payload,{manualEntry:true});
 assert.equal(saved.shiftHours,12);assert.equal(saved.manualShift,'day');assert.equal(saved.shiftName,'Day');assert.equal(saved.bookShiftCode,'S1');assert.equal(saved.idleHours,1);
 if(kind==='vehicle')assert.equal(normalizeLogBook(kind,payload).shiftHours,12);
 else assert.throws(()=>normalizeLogBook(kind,payload),/requires 8 hours/);
 assert.equal(normalizeLogBook(kind,{...payload,shiftHours:9,closingHmr:108},{manualEntry:true}).shiftHours,9);
});
test('manual combined HMR uses the selected 12 hours while scan entries retain their shift limit',async()=>{
 const client={query:async sql=>({rows:sql.includes("data->>'employeeId'")?[]:[{site:'Jayant OC',data:{cardShift:'I',totalWorkingHmr:4,shiftHours:8}}]})};
 const data={...payload,manualShiftOverride:true,totalWorkingHmr:8,door:'V1'};
 await assertCombinedShiftMeters(client,'vehicle',data);
 await assert.rejects(()=>assertCombinedShiftMeters(client,'vehicle',{...data,manualShiftOverride:false}),/limit is 8 hours/);
});
