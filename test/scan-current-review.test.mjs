import test from 'node:test';
import assert from 'node:assert/strict';
import {checkScanCard} from '../server/routes/bulk-card-scanning.mjs';

const masters=[
 {id:1,master_name:'Equipment master',record_data:{category:'Vehicle',door:'V321',currentLocation:'Sasti OC'}},
 {id:2,master_name:'C-Dir Employee master',record_data:{name:'TEST DRIVER',empId:'EMP100'}},
 {id:3,master_name:'Shift Master',record_data:{site:'Sasti OC',shiftName:'Shift I',startTime:'06:00'}},
 {id:5,master_name:'Work Order master',record_data:{site:'Sasti OC',workOrderNo:'WO1'}}
];
masters.push({id:6,master_name:'Equipment master',record_data:{category:'Equipment',door:'D19',currentLocation:'Sasti OC'}});
const client={query:async sql=>({rows:sql.includes('FROM master_records')?masters:[]})};
const draft={bookDate:'2026-12-19',location:'Sasti OC',assetId:'1',employeeId:'2',shiftId:'3',workOrderId:'5',shiftHours:8,openingHmr:0,closingHmr:6,openingKmr:100,closingKmr:120,aFormNo:'75',timeMode:'with',trips:[{equipmentName:'D19',loadingTime:'09:02',unloadingTime:'09:09',tripCount:1}],scanMachineSummary:[{equipmentName:'D19',tripCount:1}],meterReviewFields:['openingHmr'],extractionReviewFields:['shiftHours']};
const card={id:'11111111-1111-4111-a111-111111111111',batch_id:'22222222-2222-4222-a222-222222222222',draft,page_count:1,expected_pages:1,confidence:null,review_note:'shiftHours: missing',raw_fields:{extractionWarning:'Gemini: check extracted values against the scan. shiftHours: missing printedTotalTrips: missing',tripGridIssues:['Trip 1: loading time unclear']}};

test('complete current values clear historical OCR warnings without requiring a second confirmation',async()=>{
 const result=await checkScanCard(client,'vehicle',card);
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.warnings,[]);
 assert.ok(result.data);assert.deepEqual(card.draft.extractionReviewFields,['shiftHours']);
});
test('scan review accepts a reset KMR below HMR',async()=>{
 const result=await checkScanCard(client,'vehicle',card,{...draft,openingHmr:200,closingHmr:206,openingKmr:0,closingKmr:40});
 assert.deepEqual(result.errors,[]);
 assert.equal(result.data.totalRunningKmr,40);
 assert.equal(result.data.totalWorkingHmr,6);
});
test('scan save excludes a borrowed opening loader and counts a final load without an unload',async()=>{
 const trips=[
  {rowNumber:1,equipmentName:'D19',equipmentSource:'previous-shift',equipmentNotation:{original:'',resolved:'D19'},loadingTime:'08:40',unloadingTime:'08:55',tripCount:1},
  {...draft.trips[0],rowNumber:2},
  {...draft.trips[0],rowNumber:3,loadingTime:'12:45',unloadingTime:''}
 ];
 const result=await checkScanCard(client,'vehicle',card,{...draft,trips,scanMachineSummary:[{equipmentName:'D19',tripCount:2}]});
 assert.deepEqual(result.errors,[]);
 assert.equal(result.data.totalTrips,2);
 assert.equal(result.data.trips[0].loadingTime,'');
 assert.equal(result.data.trips[2].unloadingTime,'');
});
test('genuinely missing values, invalid readings, summaries and missing pages still need correction',async()=>{
 const missing=await checkScanCard(client,'vehicle',card,{...draft,shiftHours:''});assert.ok(missing.errors.some(s=>/Shift hours/.test(s)));
 const invalid=await checkScanCard(client,'vehicle',card,{...draft,closingHmr:-1});assert.deepEqual(invalid.errors,[]);assert.match(invalid.data.meterRuleErrors.closingHmr,/below opening/);
 const summary=await checkScanCard(client,'vehicle',card,{...draft,scanMachineSummary:[{equipmentName:'D19',tripCount:2}]});assert.ok(summary.errors.some(s=>/summary mismatch/.test(s)));
 const back=await checkScanCard(client,'vehicle',{...card,expected_pages:2});assert.ok(back.errors.some(s=>/back page/.test(s)));
 const hours=await checkScanCard(client,'vehicle',card,{...draft,closingHmr:9});assert.match(hours.errors.join(' '),/HMR.*Exceeds limit/);
 const kmr=await checkScanCard(client,'vehicle',card,{...draft,closingKmr:351});assert.match(kmr.errors.join(' '),/KMR.*Exceeds limit/);
});
