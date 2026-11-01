import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTripEquipment,validateTripEquipment} from '../trip-equipment-validation.mjs';
const assets=[{id:1,equipmentName:'Volvo150',site:'Jayant'},{id:2,door:'Tpc 20',site:'Jayant'},{id:3,door:'Lpc 30',site:'Jayant'},{id:4,door:'Spc 40',site:'Jayant'},{id:5,door:'Vpc 999',site:'Other'}];
test('approved aliases resolve only against location equipment',()=>{for(const [input,expected] of [['V150','Vpc 150'],['U150','Vpc 150'],['T20','Tpc 20'],['TA20','Tpc 20'],['L30','Lpc 30'],['S40','Spc 40'],['150','Vpc 150']])assert.equal(resolveTripEquipment({equipmentName:input},assets,'Jayant').equipmentName,expected);});
test('wrong site, wrong family, missing and ambiguous numbers require review',()=>{for(const input of ['V999','T150','V','V151'])assert.ok(resolveTripEquipment({equipmentName:input},assets,'Jayant').error);assert.ok(resolveTripEquipment({equipmentName:'150'},[...assets,{id:6,door:'Tpc150',site:'Jayant'}],'Jayant').error);});
test('U correction is disabled when any master equipment starts with U',()=>assert.ok(resolveTripEquipment({equipmentName:'U150'},[...assets,{id:8,equipmentName:'U99',site:'Other'}],'Jayant').error));
test('details and summary share identity and preserve source reading',()=>{const result=validateTripEquipment({location:'Jayant',trips:[{equipmentName:'U150',tripCount:2}],scanMachineSummary:[{equipmentName:'V150',tripCount:2}]},assets);assert.deepEqual(result.issues,{});assert.equal(result.draft.trips[0].equipmentId,'1');assert.equal(result.draft.trips[0].originalEquipmentName,'U150');assert.equal(result.draft.trips[0].equipmentName,result.draft.scanMachineSummary[0].equipmentName);});

test('scan normalization resolves U, TA and Tata without changing header aliases',async()=>{const {normalizeScanEquipmentRows}=await import('../scan-machine-rules.mjs');const draft={machineNotationRuleVersion:1,location:'Jayant',trips:[{equipmentName:'U150'},{equipmentName:'TA20'},{equipmentName:'Tata20'}]};const result=normalizeScanEquipmentRows(draft,assets);assert.deepEqual(result.trips.map(r=>r.equipmentId),['1','2','2']);assert.deepEqual(result.trips.map(r=>r.originalEquipmentName),['U150','TA20','Tata20']);assert.deepEqual(validateTripEquipment(result,assets).issues,{});});

const suffixedAssets=[
 {id:'tpc35',door:'TPC35 - 01150',equipmentName:'TPC35 - 01150',kind:'equipment',site:'Jayant OC'},
 {id:'vpc49',door:'VPC49 -62577',equipmentName:'VPC49 -62577',kind:'equipment',site:'Jayant OC'},
 {id:'tpc57',door:'TPC57- 05023',kind:'equipment',site:'Jayant OC'},
 {id:'vpc32',door:'VPC32 - 84749',kind:'equipment',site:'Sasti OC'},
];
test('live master serial suffixes never become part of the equipment number',()=>{
 for(const [input,expected] of [['TA35','Tpc 35'],['T35','Tpc 35'],['Tata35','Tpc 35'],['TPC35 - 01150','Tpc 35'],['TPC35-01150','Tpc 35'],['V49','Vpc 49'],['U49','Vpc 49'],['VPC49 -62577','Vpc 49'],['TA57','Tpc 57']]){
  const result=resolveTripEquipment({equipmentName:input},suffixedAssets,'Jayant');
  assert.equal(result.error,undefined,input);assert.equal(result.equipmentName,expected,input);assert.equal(result.originalEquipmentName,input);
 }
});
test('joined serial digits, absent numbers and wrong-site equipment are blocked in both collections',()=>{
 for(const equipmentName of ['TA3501150','TPC3501150','V4962577','Vpc 4962577','TA999999','V32']){
  const result=validateTripEquipment({location:'Jayant OC',trips:[{equipmentName,tripCount:1}],scanMachineSummary:[{equipmentName,tripCount:1}]},suffixedAssets);
  assert.ok(result.issues['trips.0.equipmentName'],equipmentName);assert.ok(result.issues['scanMachineSummary.0.equipmentName'],equipmentName);
 }
});
test('scan review and repeated detail/summary normalization keep TA35 as Tpc 35',async()=>{
 const {normalizeScanEquipmentRows}=await import('../scan-machine-rules.mjs');
 const {scanFieldIssues}=await import('../src/scan-field-review.mjs');
 const input={machineNotationRuleVersion:1,tripBodyRuleVersion:2,location:'Jayant OC',timeMode:'without',trips:[{equipmentName:'TA35',tripCount:2},{equipmentName:'V49',tripCount:1}],scanMachineSummary:[{equipmentName:'T35',tripCount:2},{equipmentName:'U49',tripCount:1}]};
 const before=JSON.stringify(suffixedAssets),scan=normalizeScanEquipmentRows(input,suffixedAssets),first=validateTripEquipment(scan,suffixedAssets),second=validateTripEquipment(first.draft,suffixedAssets);
 assert.deepEqual(first.issues,{});assert.deepEqual(second,first);
 assert.deepEqual(first.draft.trips.map(r=>r.equipmentName),['Tpc 35','Vpc 49']);assert.deepEqual(first.draft.scanMachineSummary.map(r=>r.equipmentName),['Tpc 35','Vpc 49']);
 assert.equal(first.draft.trips[0].originalEquipmentName,'TA35');assert.equal(first.draft.trips[0].equipmentId,'tpc35');
 const review=scanFieldIssues(first.draft,'vehicle',{}, {assets:suffixedAssets});assert.deepEqual(Object.keys(review).filter(k=>k.startsWith('trips.')||k.startsWith('scanMachineSummary')),[]);
 assert.equal(JSON.stringify(suffixedAssets),before,'master records are never modified');
});
test('different serials with the same door number require review instead of choosing one',()=>{
 assert.match(resolveTripEquipment({equipmentName:'TA35'},[...suffixedAssets,{id:'duplicate',door:'TPC35 - 99999',site:'Jayant OC'}],'Jayant').error,/Multiple equipment/);
});
