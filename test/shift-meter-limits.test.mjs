import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftMeterIssues,meterRuleIssues,kmrMeterReplaced,kmrMissingDigitReadings} from '../shared/trip-card-rules.mjs';
import {normalizeLogBook} from '../server/routes/log-book.mjs';
import {scanFieldIssues} from '../src/scan-field-review.mjs';
import {applyScanContext} from '../shared/scan-batch-context.mjs';
import {extractCard} from '../server/rules/scan-extraction.mjs';
import {canAutoSaveScanCard} from '../shared/scan-auto-save.mjs';
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
test('a closing KMR one digit short is a reading to correct, not a meter replacement (Jayant OC V293, 7 Nov 2026)',()=>{
 const card={...base,openingKmr:'292146.5',closingKmr:'29276.4',openingHmr:'18337',closingHmr:'18344'};
 assert.deepEqual(kmrMissingDigitReadings(card),['292176.4','292276.4','292376.4']);
 assert.equal(kmrMeterReplaced(card),false);
 const message=shiftMeterIssues(card).closingKmr;
 assert.match(message,/one digit fewer/);
 assert.match(message,/not a meter replacement/);
 assert.match(message,/292176\.4 \(29\.9 km\)/);
 assert.equal(shiftMeterIssues(card).replacementKmr,undefined);
 assert.equal(scanFieldIssues(card).closingKmr,message);
 assert.equal(scanFieldIssues(card).replacementKmr,undefined);
 assert.equal(meterRuleIssues(card).closingKmr,message);
 // An actual distance typed in to get past the old question no longer saves the card.
 assert.throws(()=>normalizeLogBook('vehicle',{...card,replacementKmr:30}),/one digit fewer/);
 // Without shift hours the reading still blocks instead of saving a negative distance.
 assert.match(shiftMeterIssues({...card,shiftHours:''}).closingKmr,/one digit fewer/);
 const fixed={...card,closingKmr:'292176.4'};
 assert.deepEqual(shiftMeterIssues(fixed),{});
 assert.equal(normalizeLogBook('vehicle',fixed).totalRunningKmr,29.9);
});
test('a genuine new meter on a large odometer still asks for the actual distance',()=>{
 for(const closingKmr of ['35.2','812','4120.5']){
  const draft={...base,openingKmr:'292146.5',closingKmr};
  assert.deepEqual(kmrMissingDigitReadings(draft),[]);
  assert.equal(kmrMeterReplaced(draft),true);
  assert.match(shiftMeterIssues(draft).replacementKmr,/actual distance/);
 }
 // One digit short but no single digit gives a normal shift distance: still a replacement.
 const far={...base,openingKmr:'292146.5',closingKmr:'15000'};
 assert.deepEqual(kmrMissingDigitReadings(far),[]);
 assert.equal(kmrMeterReplaced(far),true);
});

test('V281 trip card 2268 flags dropped KMR decimals and requires reviewed readings before auto-save',()=>{
 const common={...base,bookDate:'2026-11-11',location:'Jayant OB',doorText:'V281',aFormNo:'2268',cardShift:'III',openingHmr:'18407',closingHmr:'18414'};
 const card=draft=>({status:'review',checks:{errors:[],warnings:[]},draft});
 const extracted=extractCard('', 'vehicle', [], {
  cardShift:'III',
  meterReadings:{openingKmr:{value:'2870123'},closingKmr:{value:'2871511'}},
 }).draft;
 assert.deepEqual([extracted.openingKmr,extracted.closingKmr],['2870123','2871511']);
 const raw={...common,openingKmr:extracted.openingKmr,closingKmr:extracted.closingKmr};
 const corrected={...common,openingKmr:'287012.3',closingKmr:'287151.1'};
 for(const draft of [raw,{...raw,openingKmr:corrected.openingKmr},{...raw,closingKmr:corrected.closingKmr}]){
  const issues=scanFieldIssues(draft);
  assert.match(issues.closingKmr,/Possible dropped decimal.*287012\.3.*287151\.1.*138\.8 km/);
  assert.equal(issues.replacementKmr,undefined);
  assert.equal(kmrMeterReplaced(draft),false);
  assert.equal(canAutoSaveScanCard(card(draft),'vehicle'),false);
 }
 assert.deepEqual(scanFieldIssues(corrected),{});
 assert.equal(canAutoSaveScanCard(card(corrected),'vehicle'),true);
 assert.equal(normalizeLogBook('vehicle',corrected).totalRunningKmr,138.8);
});

test('V281 partial closing KMR stays in correction mode throughout the edit',()=>{
 for(const [openingKmr,closingKmr] of [['2870123','28715'],...['','2','28','287','2871','28715'].map(value=>['287012.3',value])]){
  const draft={...base,openingKmr,closingKmr,replacementKmr:25};
  const issues=scanFieldIssues(draft);
  assert.ok(issues.closingKmr);
  assert.equal(issues.replacementKmr,undefined);
  assert.equal(kmrMeterReplaced(draft),false);
  assert.throws(()=>normalizeLogBook('vehicle',draft),/Closing KMR/);
 }
});
