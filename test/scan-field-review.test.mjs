import test from 'node:test';import assert from 'node:assert/strict';import {scanFieldIssues,scanFieldState} from '../src/scan-field-review.mjs';
const valid={bookDate:'2026-10-13',location:'Jayant OC',assetId:'1',employeeId:'2',shiftId:'3',shiftHours:8,openingHmr:0,closingHmr:4,openingKmr:0,closingKmr:20,aFormNo:'2230',timeMode:'with',trips:[{equipmentName:'35',loadingTime:'06:25',unloadingTime:'06:36',tripCount:1}]};
test('only unresolved fields are flagged and flags clear as values are corrected',()=>{assert.deepEqual(scanFieldIssues(valid),{});const issues=scanFieldIssues({...valid,employeeId:'',shiftId:'',closingKmr:-1});assert.deepEqual(Object.keys(issues).sort(),['closingKmr','employeeId','shiftId']);assert.ok(!issues.openingHmr);assert.deepEqual(scanFieldIssues({...valid,employeeId:'4'}),{});});
test('invalid dates, readings and individual trip cells are flagged',()=>{const issues=scanFieldIssues({...valid,bookDate:'2026-02-31',closingHmr:-1,trips:[{equipmentName:'',loadingTime:'29:20',unloadingTime:'06:36',tripCount:0}]});for(const key of ['bookDate','closingHmr','trips.0.equipmentName','trips.0.loadingTime','trips.0.tripCount'])assert.ok(issues[key]);assert.ok(!issues['trips.0.unloadingTime']);assert.ok(!scanFieldIssues({...valid,timeMode:'without',trips:[{equipmentName:'35',tripCount:1}]})['trips.0.loadingTime']);});

test('missing scan fields differ from incorrect filled values, including trip cells',()=>{
 const draft={...valid,employeeId:' ',closingKmr:-1,trips:[{equipmentName:'',loadingTime:'29:20',unloadingTime:'06:36',tripCount:0}]};
 const issues=scanFieldIssues(draft);
 assert.equal(scanFieldState(draft,'employeeId',issues),'missing');
 assert.equal(scanFieldState(draft,'closingKmr',issues),'invalid');
 assert.equal(scanFieldState(draft,'trips.0.equipmentName',issues),'missing');
 assert.equal(scanFieldState(draft,'trips.0.loadingTime',issues),'invalid');
 assert.equal(scanFieldState(draft,'trips.0.tripCount',issues),'invalid');
 assert.equal(scanFieldState(draft,'openingHmr',issues),'');
 assert.equal(scanFieldState(valid,'employeeId',scanFieldIssues(valid)),'');
});
test('missing summary and unresolved matches remain manual-entry fields',()=>{
 assert.equal(scanFieldState({scanMachineSummary:[]},'scanMachineSummary',{scanMachineSummary:'Check summary'}),'missing');
 assert.equal(scanFieldState({},'workOrderId',{workOrderId:'No matching master'}),'missing');
 assert.equal(scanFieldState({openingHmr:0},'openingHmr',{openingHmr:'Compare reading'}),'invalid');
});
