import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftMeterIssues} from '../trip-card-rules.mjs';
import {normalizeLogBook} from '../log-book.mjs';
import {scanFieldIssues} from '../src/scan-field-review.mjs';
import {scanCardStatus} from '../src/scan-reader-status.mjs';
const base={bookDate:'2026-10-30',location:'Sasti OC',assetId:1,employeeId:2,shiftId:3,shiftHours:8,openingHmr:100.1,closingHmr:108.1,openingKmr:1000,closingKmr:1250,trips:[],aFormNo:'123'};
for(const hours of [8,12])test(`${hours}-hour limits allow equality and reject 0.001 excess in manual and scan paths`,()=>{
 const valid={...base,shiftHours:hours,closingHmr:100.1+hours,closingKmr:1000+(hours===8?250:350)};
 assert.deepEqual(shiftMeterIssues(valid),{});
 assert.doesNotThrow(()=>normalizeLogBook('vehicle',valid));
 for(const key of ['closingHmr','closingKmr']){
  const draft={...valid,[key]:valid[key]+0.001};
  assert.ok(shiftMeterIssues(draft)[key]);
  assert.ok(scanFieldIssues(draft)[key]);
  assert.throws(()=>normalizeLogBook('vehicle',draft),/Exceeds limit/);
  assert.equal(scanCardStatus({status:'approved',draft}),'Need Attention');
 }
});
test('changing readings or shift clears limit errors; equipment checks HMR only',()=>{
 const draft={...base,closingHmr:109,closingKmr:1300};
 assert.equal(Object.keys(shiftMeterIssues(draft)).length,2);
 assert.deepEqual(shiftMeterIssues({...draft,shiftHours:12}),{});
 assert.equal(Object.keys(shiftMeterIssues(draft,'equipment')).length,1);
 assert.deepEqual(shiftMeterIssues({...base,closingHmr:'',closingKmr:'bad'}),{});
});
