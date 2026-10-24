import test from 'node:test';import assert from 'node:assert/strict';
import {manualScanIssues,retainManualFields} from '../src/scan-manual-fields.mjs';
const valid={doorText:'S/14',bookDate:'2026-10-19',location:'Jayant OC',assetId:'1',employeeId:'2',shiftId:'3',shiftHours:8,openingHmr:0,closingHmr:6,openingKmr:0,closingKmr:50,aFormNo:'75',timeMode:'with',trips:[{rowNumber:1,equipmentName:'V12',loadingTime:'1:03',unloadingTime:'1:12',tripCount:1}],scanMachineSummary:[{equipmentName:'V12',tripCount:1}],extractionReviewFields:['bookDate','assetId','trips'],meterReviewFields:['openingHmr','closingHmr']};
test('clear extracted values including zero and literal short-hour times need no manual entry',()=>{
 const before=JSON.stringify(valid);assert.deepEqual(manualScanIssues(valid),{});assert.equal(JSON.stringify(valid),before);
});
test('missing, invalid and conflicting values stay visible without exposing healthy fields',()=>{
 const issues=manualScanIssues({...valid,assetId:'',aFormNo:'',closingKmr:-1,trips:[{...valid.trips[0],loadingTime:''}]});
 for(const key of ['assetId','aFormNo','closingKmr','trips.0.loadingTime'])assert.ok(issues[key]);
 for(const key of ['bookDate','doorText','employeeId','openingKmr','trips.0.unloadingTime'])assert.equal(issues[key],undefined);
 const conflict=manualScanIssues({...valid,scanMachineSummary:[{equipmentName:'V12',tripCount:2}]});assert.ok(conflict.scanMachineSummary);assert.ok(conflict['trips.0.equipmentName']);
});
test('a specific meter disagreement remains visible, while ELB does not require vehicle rows or KMR',()=>{
 assert.ok(manualScanIssues({...valid,meterReviewMessages:{openingHmr:'Two readings disagree'}}).openingHmr);
 const elb={...valid,jobCardNo:'E1',trips:[],scanMachineSummary:[]};delete elb.openingKmr;delete elb.closingKmr;assert.deepEqual(manualScanIssues(elb,'equipment'),{});
});
test('visibility survives autosave but resets on another card; complete draft remains intact',()=>{
 const first=retainManualFields(null,'one:review',{assetId:'missing'}),saved=retainManualFields(first,'one:review',{});
 assert.ok(saved.fields.has('assetId'));assert.equal(retainManualFields(saved,'two:review',{}).fields.size,0);
 assert.equal(valid.trips.length,1);assert.equal(valid.openingKmr,0);
});
