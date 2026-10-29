import {completeScanTripDetails} from '../scan-trip-completion.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCardResponse} from '../gemini-card-reader.mjs';
import {aFields} from '../gemini-hybrid.mjs';
import {responseReviewNeeded} from '../scan-response-recovery.mjs';
import {scanFieldIssues} from '../src/scan-field-review.mjs';
import {checkScanCard} from '../bulk-card-scanning.mjs';
import {mergeReextractedDraft} from '../scan-reextract.mjs';
import {normalizeScanEquipmentRows} from '../scan-machine-rules.mjs';
const field=value=>({value,status:value===null?'missing':'clear'});
const response=()=>({documentType:'VLB',fields:{...Object.fromEntries(aFields('vehicle').map(k=>[k,field(null)])),door:field('V/19'),bookDate:field('2026-10-29'),machineSummary:[]},trips:{p:true,r:[[1,'V19','08:30','09:00']]}});
test('one malformed row retains readable headers and rows, flags each invalid cell, and keeps literal times',()=>{
 const input=response();input.trips.r.push(['2','PL19',830,{bad:true}]);const original=JSON.stringify(input);
 const out=parseCardResponse(original,'vehicle');assert.equal(out.fields.door.value,'V/19');assert.deepEqual(out.trips.r[0],input.trips.r[0]);assert.deepEqual(out.trips.r[1],[2,'PL19',null,null]);assert.ok(out.issues.some(i=>i.includes('loading time')));assert.ok(out.issues.some(i=>i.includes('unloading time')));assert.equal(JSON.stringify(input),original);
});
test('null summaries, object rows and missing trip numbers require review instead of whole-card failure',()=>{
 const input=response();input.fields.machineSummary=null;input.trips.r=[{rowNumber:'7',equipmentName:'PL1',loadingTime:'12: 2',unloadingTime:'12:12'},[null,'H9','','']];const out=parseCardResponse(JSON.stringify(input),'vehicle');
 assert.deepEqual(out.trips.r[0],[7,'PL1','12: 2','12:12']);assert.equal(out.trips.r.length,2);assert.ok(out.issues.some(i=>i.includes('review position')));assert.ok(out.issues.some(i=>i.includes('Machine summary')));
});
test('recovery review cannot be bypassed by omitting the client flag or sending a truthy string',async()=>{
 const raw={responseRecoveryIssues:['Trip row 2: loading time unreadable']};assert.equal(responseReviewNeeded(raw,{}),true);assert.equal(responseReviewNeeded(raw,{responseRecoveryConfirmed:'yes'}),true);assert.equal(responseReviewNeeded(raw,{responseRecoveryConfirmed:true}),false);
 assert.ok(scanFieldIssues({},'vehicle',raw).responseRecoveryConfirmed);
 const check=await checkScanCard({query:async()=>({rows:[]})},'vehicle',{raw_fields:raw,draft:{},page_count:1,expected_pages:1});assert.ok(check.errors.some(i=>i.includes('flagged extraction')));
});
test('new body H means Hydra while version-one drafts keep their original Haulpak meaning',()=>{
 const assets=[{id:'1',door:'LPC7',kind:'equipment',site:'Majri OB'},{id:'2',door:'H7',kind:'equipment',site:'Majri OB'}],base={machineNotationRuleVersion:1,location:'Majri OB',trips:[{equipmentName:'H7'}]};
 assert.equal(normalizeScanEquipmentRows(base,assets).trips[0].equipmentName,'LPC7');assert.equal(normalizeScanEquipmentRows({...base,tripBodyRuleVersion:2},assets).trips[0].equipmentName,'H7');assert.equal(base.trips[0].equipmentName,'H7');
});
test('OC normalization after explicit re-extraction retains other manual corrections',()=>{
 const previous={location:'Majri OC',remark:'Checked',openingHmr:'100'},baseline={location:'Elsewhere',openingHmr:'90'},fresh={location:'Majri OB',tripLocationRuleVersion:1,openingHmr:'99'};
 const result=mergeReextractedDraft(previous,baseline,fresh);assert.equal(result.location,'Majri OB');assert.equal(result.remark,'Checked');assert.equal(result.openingHmr,'100');assert.equal(previous.location,'Majri OC');
});

test('recovered responses never carry equipment into unreadable rows or synthesize a summary',()=>{const draft={trips:[{equipmentName:'VPC1',tripCount:1},{equipmentName:'',tripCount:1}],scanMachineSummary:[]};assert.equal(completeScanTripDetails(draft,{responseRecoveryIssues:['Trip row 2: equipment unreadable']}),draft);assert.equal(draft.trips[1].equipmentName,'');assert.deepEqual(draft.scanMachineSummary,[]);});
