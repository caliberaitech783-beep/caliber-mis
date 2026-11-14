import test from 'node:test';import assert from 'node:assert/strict';import {summarizePulseHours} from '../server/rules/log-book-hours.mjs';
const input={date:'2026-10-16',site:'Sasti OC',asset:{door:'V321'},shift:{startTime:'20:00:00'},shiftHours:8,runningHours:5,now:Date.parse('2026-10-19T00:00:00Z')};
test('Pulse BD is clipped to the shift, merged across overlapping requests, and ignores another vehicle/site and idle requests',()=>{const rows=[{ref:'A',site:'Sasti OC',door:'V321',start:'2026-10-16 19:00:00',closedAt:'2026-10-16 21:00:00'},{ref:'B',site:'Sasti OC',door:'V321',start:'2026-10-16 20:30:00',closedAt:'2026-10-16 22:00:00'},{site:'Sasti OC',door:'V999',start:'2026-10-16 20:00:00',closedAt:'2026-10-17 04:00:00'},{site:'Sasti OC',door:'V321',vehicleIdle:true,start:'2026-10-16 20:00:00',closedAt:'2026-10-17 04:00:00'}];const h=summarizePulseHours({...input,rows});assert.equal(h.breakdownHours,2);assert.equal(h.availabilityHours,5);assert.equal(h.idleHours,1);});
test('no matching breakdowns is zero only after a valid response; inconsistent totals stay visible',()=>{assert.equal(summarizePulseHours({...input,rows:[]}).idleHours,3);const h=summarizePulseHours({...input,runningHours:9,rows:[]});assert.equal(h.idleHours,-1);assert.equal(h.warnings.length,1);assert.throws(()=>summarizePulseHours({...input,shift:{},rows:[]}));});

test('a shared vehicle model name cannot identify the vehicle in maintenance',()=>{
 const asset={...input.asset,category:'Vehicle',equipmentName:'Volvo Tipper'};
 const request={site:input.site,equipment:'Volvo Tipper',start:'2026-10-16 20:30:00'};
 const result=summarizePulseHours({...input,asset,rows:[
  {...request,ref:'OTHER',door:'V322'},
  {...request,ref:'MATCH',door:'V321',closedAt:'2026-10-16 21:30:00'},
 ]});
 assert.deepEqual(result.references,['MATCH']);
 assert.equal(result.breakdowns[0].ongoing,false);
});

test('Pulse event details preserve actual times and count carry-over and ongoing time only within the shift',()=>{
 const now=Date.parse('2026-10-17T00:00:00+05:30');
 const rows=[{ref:'A',complaint:'Hydraulic leak',site:'Sasti OC',door:'V321',start:'2026-10-16 19:00:00',closedAt:'2026-10-16 21:00:00'},{ref:'B',complaint:'Engine fault',site:'Sasti OC',door:'V321',start:'2026-10-16 20:30:00'},{ref:'OTHER',site:'Other site',door:'V321',start:'2026-10-16 20:00:00'}];
 const result=summarizePulseHours({...input,rows,now});assert.equal(result.breakdownHours,4);assert.equal(result.breakdowns.length,2);
 assert.equal(result.breakdowns[0].description,'Hydraulic leak');assert.equal(result.breakdowns[0].hours,1);assert.equal(result.breakdowns[0].start,'2026-10-16T13:30:00.000Z');
 assert.equal(result.breakdowns[1].end,null);assert.equal(result.breakdowns[1].ongoing,true);assert.equal(result.breakdowns[1].hours,3.5);
 assert.equal(result.shiftStart,'2026-10-16T14:30:00.000Z');
});

test('an 8-hour shift with 7 hours worked only has BD when Pulse reports a matching event',()=>{
 const noBreakdown=summarizePulseHours({...input,runningHours:7,rows:[]});
 assert.equal(noBreakdown.breakdownHours,0);
 assert.equal(noBreakdown.idleHours,1);
 const withBreakdown=summarizePulseHours({...input,runningHours:7,rows:[
  {site:input.site,door:'V321',start:'2026-10-16 20:00:00',closedAt:'2026-10-16 20:30:00'},
 ]});
 assert.equal(withBreakdown.breakdownHours,0.5);
 assert.equal(withBreakdown.idleHours,0.5);
});
