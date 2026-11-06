import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftMeterIssues} from '../shared/trip-card-rules.mjs';
import {normalizeLogBook} from '../server/routes/log-book.mjs';
import {scanFieldIssues} from '../src/scan-field-review.mjs';
import {scanCardStatus} from '../src/scan-reader-status.mjs';
const base={bookDate:'2026-12-30',location:'Sasti OC',assetId:1,employeeId:2,shiftId:3,shiftHours:8,openingHmr:100.1,closingHmr:108.1,openingKmr:1000,closingKmr:1250,trips:[],aFormNo:'123'};
for(const hours of [8,12])test(`${hours}-hour limits allow equality and report 0.001 excess without blocking saves in manual and scan paths`,()=>{
 const valid={...base,shiftHours:hours,closingHmr:100.1+hours,closingKmr:1000+(hours===8?250:350)};
 assert.deepEqual(shiftMeterIssues(valid),{});
 assert.doesNotThrow(()=>normalizeLogBook('vehicle',valid));
 for(const key of ['closingHmr','closingKmr']){
  const draft={...valid,[key]:valid[key]+0.001};
  assert.ok(shiftMeterIssues(draft)[key]);
  assert.equal(scanFieldIssues(draft)[key],undefined);
  assert.match(normalizeLogBook('vehicle',draft).meterRuleErrors[key],/Exceeds limit/);
  assert.notEqual(scanCardStatus({status:'approved',draft}),'Need Attention');
 }
});
test('changing readings or shift clears limit errors; equipment checks HMR only',()=>{
 const draft={...base,closingHmr:109,closingKmr:1300};
 assert.equal(Object.keys(shiftMeterIssues(draft)).length,2);
 assert.deepEqual(shiftMeterIssues({...draft,shiftHours:12}),{});
 assert.equal(Object.keys(shiftMeterIssues(draft,'equipment')).length,1);
 assert.deepEqual(shiftMeterIssues({...base,closingHmr:'',closingKmr:'bad'}),{});
});
test('vehicle opening KMR must exceed opening HMR in manual and scanned entry',()=>{
 for(const openingKmr of [100.1,50]){
  const draft={...base,openingKmr,closingKmr:200};
  const issues=shiftMeterIssues(draft);
  assert.match(issues.openingHmr,/wrong boxes/);assert.match(issues.openingKmr,/greater than Opening HMR/);
  assert.match(scanFieldIssues(draft).openingKmr,/greater than Opening HMR/);
  assert.throws(()=>normalizeLogBook('vehicle',draft),/Opening KMR must be greater/);
 }
 assert.deepEqual(shiftMeterIssues({...base,openingKmr:100.101,closingKmr:200}),{});
 assert.doesNotThrow(()=>normalizeLogBook('vehicle',{...base,openingKmr:100.101,closingKmr:200}));
 assert.deepEqual(shiftMeterIssues({...base,openingHmr:0,closingHmr:0,openingKmr:0,closingKmr:0}),{});
 assert.deepEqual(shiftMeterIssues({...base,openingKmr:0},'equipment'),{});
});
