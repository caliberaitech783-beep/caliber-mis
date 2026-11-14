import {shiftMeterIssues} from '../shared/trip-card-rules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetShiftHours,readFleetBreakdowns,saveFleetEntry} from '../server/rules/vlb-batch-stages.mjs';
import {normalizeLogBook} from '../server/routes/log-book.mjs';
import {manualShiftHours,manualShiftWindow} from '../shared/manual-shift.mjs';
import {normalizeShiftRecord} from '../shared/shift-master.mjs';
import {summarizePulseHours} from '../server/rules/log-book-hours.mjs';
import {assertCombinedShiftMeters} from '../server/rules/log-book-shift-hmr.mjs';
const shift={site:'Jayant OC',shiftCode:'B',startTime:'12:00:00',endTime:'21:00:00'};
const batch={id:'1',site:'jayant ob',shift:'S2',stage:'elb_open',report_date:'2026-11-01'};
test('Jayant Shift Master duration is accepted across batch and manual log-book paths',()=>{
 assert.equal(fleetShiftHours(shift),9);
 assert.equal(fleetShiftHours({...shift,startTime:'13:00',endTime:'20:30'}),7.5);
 assert.equal(normalizeShiftRecord({...shift,shiftName:'Shift B'}).startTime,'12:00:00');
 assert.deepEqual(
  (({startTime,endTime})=>({startTime,endTime}))(normalizeShiftRecord({...shift,shiftName:'Shift B',startTime:'13:00',endTime:'20:30'})),
  {startTime:'13:00:00',endTime:'20:30:00'},
 );
 assert.throws(()=>fleetShiftHours({...shift,site:'Sasti OC'}),/valid/);
 for(const hours of [7.5,8,9,12])assert.equal(manualShiftHours({location:'Jayant OC',bookShiftCode:'S2',shiftHours:hours}),hours);
 assert.equal(manualShiftHours({location:'Jayant OC',bookShiftCode:'S1',shiftHours:7.5}),7.5);
 for(const hours of [0,24.01])assert.throws(()=>manualShiftHours({location:'Jayant OC',bookShiftCode:'S2',shiftHours:hours}),/8-hour/);
 assert.throws(()=>manualShiftHours({location:'Sasti OC',bookShiftCode:'S2',shiftHours:9}),/8-hour/);
 assert.equal(manualShiftWindow({location:'Jayant OC',shiftHours:9},shift).endTime,'21:00');
});
test('Pulse clips breakdowns to the nine-hour window and calculates idle hours',()=>{
 const result=summarizePulseHours({rows:[{site:'Jayant OC',door:'TPC142',start:'2026-11-01 11:00:00',closedAt:'2026-11-01 22:00:00',ref:'BD1'}],date:'2026-11-01',site:'Jayant OC',asset:{door:'TPC142'},shift,shiftHours:9,runningHours:7,now:Date.parse('2026-11-02T00:00:00Z')});
 assert.equal(result.breakdownHours,9);assert.equal(result.idleHours,-7);
 assert.equal(result.shiftStart,'2026-11-01T06:30:00.000Z');assert.equal(result.shiftEnd,'2026-11-01T15:30:00.000Z');
 assert.throws(()=>summarizePulseHours({rows:[],date:'2026-11-01',site:'Sasti OC',asset:{},shift:{...shift,site:'Sasti OC'},shiftHours:9}),/valid date and shift/);
});
test('batch Pulse lookup and save use nine hours and reject excess HMR before insertion',async()=>{
 const client={query:async sql=>({rows:sql.includes("master_name='Shift Master'")?[{id:'2',record_data:shift}]:sql.includes('mis_vlb_batch_fleet')?[{asset_id:'3',door:'TPC142',trips:1}]:[]})};
 const readHours=async input=>{assert.equal(input.shiftHours,9);assert.equal(input.bookShiftCode,'S2');return {breakdownHours:0};};
 assert.equal((await readFleetBreakdowns(client,batch,'3',readHours,'mis')).shiftHours,9);
 let inserted=0;
 const ops={readHours,resolve:async(c,k,data)=>normalizeLogBook(k,data,{manualEntry:true}),insert:async(c,k,data)=>{inserted++;return {id:4,data}}};
 const input={entryMode:'working-only',employeeId:'5',openingHmr:100,closingHmr:109,shiftHours:9};
 const record=await saveFleetEntry(client,batch,'3',input,'mis',ops);assert.equal(record.data.shiftHours,9);assert.equal(record.data.idleHours,0);
 await assert.rejects(()=>saveFleetEntry(client,batch,'3',{...input,closingHmr:109.01},'mis',ops),/cannot exceed/);assert.equal(inserted,1);
});
test('combined cards allow nine hours in Jayant S2 and reject a combined excess',async()=>{
 const client={query:async()=>({rows:[{site:'Jayant OC',data:{bookShiftCode:'S2',totalWorkingHmr:4,shiftHours:9}}]})};
 const data={location:'Jayant OC',bookDate:'2026-11-01',bookShiftCode:'S2',shiftHours:9,totalWorkingHmr:5};
 await assertCombinedShiftMeters(client,'equipment',data);
 await assert.rejects(()=>assertCombinedShiftMeters(client,'equipment',{...data,totalWorkingHmr:5.01}),/limit is 9/);
});

test('nine-hour meter validation accepts equality and rejects an excess',()=>{
 assert.deepEqual(shiftMeterIssues({shiftHours:9,openingHmr:100,closingHmr:109},'equipment'),{});
 assert.match(shiftMeterIssues({shiftHours:9,openingHmr:100,closingHmr:109.001},'equipment').closingHmr,/maximum.*9-hour/);
});
