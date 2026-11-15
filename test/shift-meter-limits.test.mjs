import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftMeterIssues} from '../shared/trip-card-rules.mjs';
import {normalizeLogBook} from '../server/routes/log-book.mjs';
import {scanFieldIssues} from '../src/scan-field-review.mjs';
import {applyScanContext} from '../shared/scan-batch-context.mjs';
import {extractCard} from '../server/rules/scan-extraction.mjs';
const base={bookDate:'2026-12-30',location:'Sasti OC',assetId:1,employeeId:2,shiftId:3,shiftHours:8,openingHmr:100.1,closingHmr:108.1,openingKmr:1000,closingKmr:1250,trips:[],aFormNo:'123'};
for(const hours of [8,12])test(`${hours}-hour limits allow equality and block 0.001 excess in manual and scan paths`,()=>{
 const valid={...base,shiftHours:hours,closingHmr:100.1+hours,closingKmr:1250};
 assert.deepEqual(shiftMeterIssues(valid),{});
 assert.doesNotThrow(()=>normalizeLogBook('vehicle',valid));
 for(const key of ['closingHmr','closingKmr']){
  const draft={...valid,[key]:valid[key]+0.001};
  assert.ok(shiftMeterIssues(draft)[key]);
  assert.match(scanFieldIssues(draft)[key],/Exceeds limit/);
  assert.throws(()=>normalizeLogBook('vehicle',draft),/Exceeds limit/);
 }
});
test('LMV manual entry and scan review accept custom durations independently of the batch shift',()=>{
 const context={bookDate:base.bookDate,location:base.location,cardShift:'I',logBookKind:'lmv'};
 for(const shiftHours of [0,8,12,10.5,26]){
  const original={...base,shiftHours,shiftId:'',cardShift:'Day',closingKmr:1500};
  const scanned=applyScanContext(context,original);
  assert.equal(scanned.shiftHours,shiftHours);
  assert.equal(scanned.shiftId,'');
  assert.equal(scanned.cardShift,'I');
  assert.deepEqual(scanFieldIssues(scanned,'vehicle',{shiftRuleVersion:1},null,true),{});
  assert.equal(normalizeLogBook('lmv',scanned).shiftHours,shiftHours);
  assert.equal(normalizeLogBook('lmv',original,{manualEntry:true}).shiftHours,shiftHours);
 }
 const ocr=extractCard('Shift: I\nShift hours: 10.5','vehicle',[],{},{lmv:true});
 assert.equal(Number(ocr.draft.shiftHours),10.5);
});

test('changing readings or shift clears limit errors; equipment checks HMR only',()=>{
 const draft={...base,closingHmr:109,closingKmr:1300};
 assert.equal(Object.keys(shiftMeterIssues(draft)).length,2);
 assert.deepEqual(Object.keys(shiftMeterIssues({...draft,shiftHours:12})),['closingKmr']);
 assert.equal(Object.keys(shiftMeterIssues(draft,'equipment')).length,1);
 assert.deepEqual(shiftMeterIssues({...base,closingHmr:'',closingKmr:'bad'}),{});
});
test('opening KMR can be lower than or equal to HMR in manual and scanned entry',()=>{
 for(const openingKmr of [0,50,100.1,100.101]){
  const draft={...base,openingKmr,closingKmr:200};
  assert.deepEqual(shiftMeterIssues(draft),{});
  const scanIssues=scanFieldIssues(draft);
  assert.equal(scanIssues.openingKmr,undefined);
  assert.equal(scanIssues.openingHmr,undefined);
  const saved=normalizeLogBook('vehicle',draft);
  assert.equal(saved.openingKmr,openingKmr);
  assert.equal(saved.openingHmr,base.openingHmr);
 }
});
test('a replacement meter preserves both readings and requires actual distance within 250 km',()=>{
 const draft={...base,closingKmr:900};
 assert.match(scanFieldIssues(draft).replacementKmr,/actual distance/);
 assert.throws(()=>normalizeLogBook('vehicle',draft),/actual distance/);
 for(const replacementKmr of [-1,250.001]){
  assert.throws(()=>normalizeLogBook('vehicle',{...draft,replacementKmr}),/actual distance|Exceeds limit/);
 }
 for(const replacementKmr of [0,65,250]){
  const input={...draft,replacementKmr};
  assert.equal(scanFieldIssues(input).replacementKmr,undefined);
  const data=normalizeLogBook('vehicle',input);
  assert.deepEqual([data.openingKmr,data.closingKmr,data.replacementKmr,data.totalRunningKmr],[1000,900,replacementKmr,replacementKmr]);
 }
 assert.equal(normalizeLogBook('vehicle',{...base,replacementKmr:65}).totalRunningKmr,250);
});
