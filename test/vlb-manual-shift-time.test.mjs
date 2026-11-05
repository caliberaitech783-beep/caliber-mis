import test from 'node:test';
import assert from 'node:assert/strict';
import {batchShift,manualTimeValue,timeWithinShift} from '../shared/manual-trip-time.mjs';

test('manual VLB times use minutes and stay inside the selected batch shift',()=>{
 const day={id:'1',site:'Dudhichua OC',shiftCode:'A',startTime:'05:00:00',endTime:'13:00:00'};
 assert.equal(manualTimeValue('05:33:52'),'05:33');
 for(const value of ['05:00','08:25','13:00'])assert.equal(timeWithinShift(value,day),true,value);
 for(const value of ['04:59','13:01','23:00'])assert.equal(timeWithinShift(value,day),false,value);
});

test('overnight shift windows and effective batch shift selection are supported',()=>{
 const night={id:'2',site:'Dudhichua OC',shiftCode:'C',startTime:'21:00:00',endTime:'05:00:00'};
 for(const value of ['21:00','23:59','00:00','05:00'])assert.equal(timeWithinShift(value,night),true,value);
 for(const value of ['20:59','05:01','12:00'])assert.equal(timeWithinShift(value,night),false,value);
 const shifts=[{id:'wrong-site',site:'Sasti OC',shiftCode:'A'},{id:'old',site:'Dudhichua OC',shiftCode:'A',effectiveTo:'2026-10-31'},night,{id:'current',site:'Dudhichua OC',shiftCode:'A',effectiveFrom:'2026-11-01',startTime:'05:00',endTime:'13:00'}];
 assert.equal(batchShift(shifts,{site:'Dudhichua OC',shift:'A',report_date:'2026-11-05'}).id,'current');
});
