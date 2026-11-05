import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {batchShift,fixedMinuteInput,manualTimeValue,resolveShiftTime,shiftTimeInputValue,timeWithinShift} from '../shared/manual-trip-time.mjs';

test('manual VLB times use minutes and stay inside the selected batch shift',()=>{
 const day={id:'1',site:'Dudhichua OC',shiftCode:'A',startTime:'05:00:00',endTime:'13:00:00'};
 assert.equal(manualTimeValue('05:33:52'),'05:33');
 for(const value of ['05:00','08:25','13:00'])assert.equal(timeWithinShift(value,day),true,value);
 for(const value of ['04:59','13:01','23:00'])assert.equal(timeWithinShift(value,day),false,value);
 assert.equal(resolveShiftTime('05:33',day),'05:33');
 assert.equal(resolveShiftTime('12:45',day),'12:45');
 assert.equal(shiftTimeInputValue('13:27'),'01:27');
 assert.equal(fixedMinuteInput('1'),'1:');
 assert.equal(fixedMinuteInput('12'),'12:');
 assert.equal(fixedMinuteInput('12:3'),'12:3');
 assert.equal(fixedMinuteInput('12:34'),'12:34');
 assert.equal(fixedMinuteInput(''),'');
});

test('the active VLB manual table uses minute-only shift-validated inputs',()=>{
 const source=readFileSync(new URL('../src/log-book-form.jsx',import.meta.url),'utf8');
 assert.match(source,/resolveShiftTime,shiftTimeInputValue,timeWithinShift/);
 assert.equal((source.match(/fixedMinuteInput\(e\.target\.value\)/g)||[]).length,2);
 assert.equal((source.match(/type="text" inputMode="numeric" placeholder="HH:MM"/g)||[]).length,2);
 assert.doesNotMatch(source,/type="time"/);
 assert.match(source,/timeWithinShift\(value,selectedShift\)/);
 assert.match(source,/vehicle&&fleetReconciliation&&<details className="scan-fleet-reconciliation"><summary>Site fleet · VLB, breakdown and idle details<\/summary>\{fleetReconciliation\}<\/details>/);
});

test('overnight shift windows and effective batch shift selection are supported',()=>{
 const night={id:'2',site:'Dudhichua OC',shiftCode:'C',startTime:'21:00:00',endTime:'05:00:00'};
 for(const value of ['21:00','23:59','00:00','05:00'])assert.equal(timeWithinShift(value,night),true,value);
 for(const value of ['20:59','05:01','12:00'])assert.equal(timeWithinShift(value,night),false,value);
 assert.equal(resolveShiftTime('01:27',night),'01:27');
 const evening={startTime:'13:00',endTime:'21:00'};
 assert.equal(resolveShiftTime('01:27',evening),'13:27');
 assert.equal(resolveShiftTime('08:45',evening),'20:45');
 const shifts=[{id:'wrong-site',site:'Sasti OC',shiftCode:'A'},{id:'old',site:'Dudhichua OC',shiftCode:'A',effectiveTo:'2026-10-31'},night,{id:'current',site:'Dudhichua OC',shiftCode:'A',effectiveFrom:'2026-11-01',startTime:'05:00',endTime:'13:00'}];
 assert.equal(batchShift(shifts,{site:'Dudhichua OC',shift:'A',report_date:'2026-11-05'}).id,'current');
});
