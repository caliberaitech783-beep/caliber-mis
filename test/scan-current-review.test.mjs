import test from 'node:test';
import assert from 'node:assert/strict';
import {checkScanCard} from '../bulk-card-scanning.mjs';

const masters=[
 {id:1,master_name:'Equipment master',record_data:{category:'Vehicle',door:'V321',currentLocation:'Sasti OC'}},
 {id:2,master_name:'C-Dir Employee master',record_data:{name:'TEST DRIVER',empId:'EMP100'}},
 {id:3,master_name:'Shift Master',record_data:{site:'Sasti OC',shiftName:'Shift I',startTime:'06:00'}},
 {id:5,master_name:'Work Order master',record_data:{site:'Sasti OC',workOrderNo:'WO1'}}
];
const client={query:async sql=>({rows:sql.includes('FROM master_records')?masters:[]})};
const draft={bookDate:'2026-10-19',location:'Sasti OC',assetId:'1',employeeId:'2',shiftId:'3',workOrderId:'5',shiftHours:8,openingHmr:0,closingHmr:6,openingKmr:0,closingKmr:20,aFormNo:'75',timeMode:'with',trips:[{equipmentName:'D19',loadingTime:'09:02',unloadingTime:'09:09',tripCount:1}],scanMachineSummary:[{equipmentName:'D19',tripCount:1}],meterReviewFields:['openingHmr'],extractionReviewFields:['shiftHours']};
const card={id:'11111111-1111-4111-a111-111111111111',batch_id:'22222222-2222-4222-a222-222222222222',draft,page_count:1,expected_pages:1,confidence:null,review_note:'shiftHours: missing',raw_fields:{extractionWarning:'Gemini: check extracted values against the scan. shiftHours: missing printedTotalTrips: missing',tripGridIssues:['Trip 1: loading time unclear']}};

test('complete current values clear historical OCR warnings without requiring a second confirmation',async()=>{
 const result=await checkScanCard(client,'vehicle',card);
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.warnings,[]);
 assert.ok(result.data);assert.deepEqual(card.draft.extractionReviewFields,['shiftHours']);
});
test('genuinely missing values, invalid readings, summaries and missing pages still need correction',async()=>{
 const missing=await checkScanCard(client,'vehicle',card,{...draft,shiftHours:''});assert.ok(missing.errors.some(s=>/Shift hours/.test(s)));
 const invalid=await checkScanCard(client,'vehicle',card,{...draft,closingHmr:-1});assert.ok(invalid.errors.some(s=>/HMR/.test(s)));
 const summary=await checkScanCard(client,'vehicle',card,{...draft,scanMachineSummary:[{equipmentName:'D19',tripCount:2}]});assert.ok(summary.errors.some(s=>/summary mismatch/.test(s)));
 const back=await checkScanCard(client,'vehicle',{...card,expected_pages:2});assert.ok(back.errors.some(s=>/back page/.test(s)));
 const hours=await checkScanCard(client,'vehicle',card,{...draft,closingHmr:9});assert.ok(hours.errors.some(s=>/HMR.*Exceeds limit/.test(s)));assert.equal(hours.data,undefined);
 const kmr=await checkScanCard(client,'vehicle',card,{...draft,closingKmr:251});assert.ok(kmr.errors.some(s=>/KMR.*Exceeds limit/.test(s)));assert.equal(kmr.data,undefined);
});
