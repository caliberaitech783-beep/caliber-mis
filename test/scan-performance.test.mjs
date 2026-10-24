import test from 'node:test';import assert from 'node:assert/strict';
import {captureTiming,parseCaptureTiming,scanTimingLabel} from '../public/scan-timing.mjs';
import {scanBatchMetrics} from '../src/scan-batch-metrics.mjs';
const valid={doorText:'S/14',bookDate:'2026-10-19',location:'Jayant OC',assetId:'1',employeeId:'2',shiftId:'3',shiftHours:8,openingHmr:0,closingHmr:6,openingKmr:0,closingKmr:50,aFormNo:'75',timeMode:'with',trips:[{rowNumber:1,equipmentName:'V12',loadingTime:'1:03',unloadingTime:'1:12',tripCount:1}],scanMachineSummary:[{equipmentName:'V12',tripCount:1}],meterReviewFields:['openingHmr'],extractionReviewFields:['trips']};
test('capture duration uses job timestamps, freezes at completion and keeps scan/import wording distinct',()=>{
 const job={mode:'scanner',pages:14,created_at:'2026-10-24T08:00:00Z',completed_at:'2026-10-24T08:01:35Z'};const timing=captureTiming(job,Date.parse('2026-10-24T09:00:00Z'));assert.equal(scanTimingLabel(timing),'14 pages scanned in 1 min 35 sec');assert.equal(scanTimingLabel({...timing,mode:'folder'}),'14 pages imported in 1 min 35 sec');
 assert.equal(parseCaptureTiming({...timing,durationMs:-1}),null);assert.equal(parseCaptureTiming({...timing,pages:121}),null);assert.equal(captureTiming({...job,created_at:'invalid'}),null);assert.equal(captureTiming({...job,completed_at:null},Date.parse('2026-10-24T08:00:05Z')).durationMs,5000);
});
test('detected card error percentage excludes pending cards and routine handwriting reminders',()=>{
 const row=(id,status,draft=valid,errors=[])=>({id,status,draft,raw_fields:{},checks:{errors}});
 const cards=[row('good','review',valid,['Confirm or correct the highlighted meter readings against the original reading table before approval.']),row('missing','review',{...valid,employeeId:''}),row('failed','error',{}),row('pending','queued',{}),row('reading','reading',{})];
 const result=scanBatchMetrics(cards,'vehicle');assert.equal(result.assessed,3);assert.equal(result.errors,2);assert.equal(result.failures,1);assert.equal(result.errorPercent,200/3);assert.equal(result.failurePercent,100/3);
 assert.equal(scanBatchMetrics([row('pending','queued',{})],'vehicle').errorPercent,null);assert.equal(scanBatchMetrics([row('duplicate','review',valid,['This scan duplicates an earlier card.'])],'vehicle').errors,1);
 const corrected=scanBatchMetrics([row('good','review'),row('corrected','review')],'vehicle');assert.equal(corrected.errorPercent,0);
});
