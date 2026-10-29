import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCard} from '../scan-extraction.mjs';
import {markedShiftEvidence,manualTripShiftPatch} from '../trip-card-rules.mjs';
import {scanFieldIssues} from '../src/scan-field-review.mjs';
import {cardPrompt} from '../gemini-card-reader.mjs';
import {checkScanCard} from '../bulk-card-scanning.mjs';
test('new Trip Cards derive hours from all five checked options, ignoring conflicting printed hours',()=>{
 for(const [label,shift,hours]of [['I (A)','I',8],['II (B)','II',8],['III (C)','III',8],['DAY SHIFT','Day',12],['NIGHT SHIFT','Night',12]]){
  for(const text of ['[x] '+label,label+' ✓']){
   const {draft,raw}=extractCard(text+'\nShift Hours: '+(hours===8?12:8),'vehicle',[]);
   assert.equal(draft.cardShift,shift,text);assert.equal(draft.shiftHours,hours,text);assert.equal(raw.shiftRuleVersion,1);
  }
 }
});
test('missing, conflicting and image-unclear marks cannot fall back to printed hours or a single OCR guess',()=>{
 for(const [text,hints]of [['[ ] I [ ] II [ ] III',{}],['[x] I [x] Day',{}],['[x] I [x] II',{cardShift:'I'}],['[x] I',{cardShift:'I',shiftSelectionStatus:'unclear'}],['[x] I',{cardShift:'II'}]]){
  const {draft,raw}=extractCard(text+'\nSHIFT HOURS: 8','vehicle',[],hints);
  assert.equal(draft.cardShift,'');assert.equal(draft.shiftHours,'');assert.equal(draft.shiftId,'');
  assert.ok(scanFieldIssues(draft,'vehicle',raw).cardShift);
 }
 assert.equal(markedShiftEvidence('[x] III (C)').status,'clear');
});
test('manual marked-shift and linked-shift choices immediately supply the required hours',()=>{
 for(const [shift,hours]of [['I',8],['II',8],['III',8],['Day',12],['Night',12]]){
  assert.equal(manualTripShiftPatch('cardShift',shift).shiftHours,hours);
  assert.deepEqual(manualTripShiftPatch('shiftId','1',[{id:'1',name:shift}]),{cardShift:shift,shiftHours:hours});
 }
 assert.deepEqual(manualTripShiftPatch('shiftId','1',[{id:'1',name:'Unclear'}]),{cardShift:'',shiftHours:''});
 assert.equal(scanFieldIssues({cardShift:'Day',shiftHours:8},'vehicle',{shiftRuleVersion:1}).shiftHours,'The marked shift requires 12 hours.');
 assert.equal(extractCard('SHIFT HOURS: 8','equipment',[]).draft.shiftHours,8);
 assert.equal(extractCard('SHIFT HOURS: 8','equipment',[]).raw.shiftRuleVersion,undefined);
 assert.equal(scanFieldIssues({},'vehicle',{}).cardShift,undefined);
});
test('vision instructions cover extended handwritten ticks and both shift groups',()=>{
 const prompt=cardPrompt('vehicle');assert.match(prompt,/tick may start inside a checkbox and extend well outside/);assert.match(prompt,/I \(A\), II \(B\), III \(C\) each mean 8 hours/);assert.match(prompt,/DAY SHIFT and NIGHT SHIFT each mean 12 hours/);
});
test('server rejects missing or mismatched marked shifts only for scans using the new rule',async()=>{
 const client={query:async()=>({rows:[]})},card={raw_fields:{shiftRuleVersion:1},draft:{cardShift:'Day',shiftHours:8},page_count:1,expected_pages:1};
 const wrong=await checkScanCard(client,'vehicle',card);assert.ok(wrong.errors.includes('The marked shift requires 12 hours.'));
 const blank=await checkScanCard(client,'vehicle',{...card,draft:{shiftHours:8}});assert.ok(blank.errors.some(s=>s.startsWith('Select one clearly marked')));
 const existing=await checkScanCard(client,'vehicle',{...card,raw_fields:{}});assert.ok(!existing.errors.includes('The marked shift requires 12 hours.'));
 assert.equal(card.draft.shiftHours,8);
});
