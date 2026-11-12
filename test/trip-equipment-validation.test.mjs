import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTripEquipment,validateTripEquipment} from '../shared/trip-equipment-validation.mjs';
const assets=[{id:1,kind:'equipment',equipmentName:'Volvo150',site:'Jayant'},{id:2,kind:'equipment',door:'Tpc 20',site:'Jayant'},{id:3,kind:'equipment',door:'Lpc 30',site:'Jayant'},{id:4,kind:'equipment',door:'Spc 40',site:'Jayant'},{id:5,kind:'equipment',door:'Vpc 999',site:'Other'}];
test('approved aliases resolve only against location equipment',()=>{for(const [input,expected] of [['V150','Vpc 150'],['U150','Vpc 150'],['T20','Tpc 20'],['TA20','Tpc 20'],['L30','Lpc 30'],['S40','Spc 40'],['150','Vpc 150']])assert.equal(resolveTripEquipment({equipmentName:input},assets,'Jayant').equipmentName,expected);});
test('wrong site, wrong family, missing and ambiguous numbers require review',()=>{for(const input of ['V999','T150','V','V151'])assert.ok(resolveTripEquipment({equipmentName:input},assets,'Jayant').error);assert.ok(resolveTripEquipment({equipmentName:'150'},[...assets,{id:6,kind:'equipment',door:'Tpc150',site:'Jayant'}],'Jayant').error);});
test('DE card notation resolves the exact DEMO machine number before duplicate aliases',()=>{
 const master=[
  {id:'demo19',kind:'equipment',door:'DEMO19-15295',site:'Sasti OC',cardAliases:['DE25']},
  {id:'demo25',kind:'equipment',door:'DEMO25-49001',site:'Sasti OC',cardAliases:['DE25']},
 ];
 for(const input of ['DE 25','DE25','DEMO25']){
  const result=resolveTripEquipment({equipmentName:input},master,'Sasti OC');
  assert.equal(result.error,undefined,input);assert.equal(result.equipmentId,'demo25',input);assert.equal(result.equipmentName,'DEMO25-49001',input);
 }
});
test('U correction is disabled when a genuine U-type machine code exists',()=>assert.ok(resolveTripEquipment({equipmentName:'U150'},[...assets,{id:8,kind:'equipment',equipmentName:'U99',site:'Other'}],'Jayant').error));
test('details and summary share identity and preserve source reading',()=>{const result=validateTripEquipment({location:'Jayant',trips:[{equipmentName:'U150',tripCount:2}],scanMachineSummary:[{equipmentName:'V150',tripCount:2}]},assets);assert.deepEqual(result.issues,{});assert.equal(result.draft.trips[0].equipmentId,'1');assert.equal(result.draft.trips[0].originalEquipmentName,'U150');assert.equal(result.draft.trips[0].equipmentName,result.draft.scanMachineSummary[0].equipmentName);});

test('scan normalization resolves U, TA and Tata without changing header aliases',async()=>{const {normalizeScanEquipmentRows}=await import('../shared/scan-machine-rules.mjs');const draft={machineNotationRuleVersion:1,location:'Jayant',trips:[{equipmentName:'U150'},{equipmentName:'TA20'},{equipmentName:'Tata20'}]};const result=normalizeScanEquipmentRows(draft,assets);assert.deepEqual(result.trips.map(r=>r.equipmentId),['1','2','2']);assert.deepEqual(result.trips.map(r=>r.originalEquipmentName),['U150','TA20','Tata20']);assert.deepEqual(validateTripEquipment(result,assets).issues,{});});

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
 const {normalizeScanEquipmentRows}=await import('../shared/scan-machine-rules.mjs');
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
 assert.match(resolveTripEquipment({equipmentName:'TA35'},[...suffixedAssets,{id:'duplicate',kind:'equipment',door:'TPC35 - 99999',site:'Jayant OC'}],'Jayant').error,/Multiple equipment/);
});
test('an explicit serial suffix selects the matching record among duplicate short codes',()=>{
 const master=[...suffixedAssets,{id:'other-tpc35',kind:'equipment',door:'TPC35 - 99999',site:'Jayant OC'}];
 const result=resolveTripEquipment({equipmentName:'T35 - 01150'},master,'Jayant');
 assert.equal(result.error,undefined);assert.equal(result.equipmentId,'tpc35');assert.equal(result.equipmentName,'Tpc 35');
 assert.match(resolveTripEquipment({equipmentName:'T35 - 12345'},suffixedAssets,'Jayant').error,/not assigned/);
});

const upRegistrationAssets=[...suffixedAssets,
 {id:'up-jayant',door:'UP64AT9857',equipmentName:'UP64AT9857',category:'VEHICLE',site:'Jayant OC'},
 {id:'up-other',door:'UP64CT8807',equipmentName:'UP64CT8807',category:'VEHICLE',site:'Dudhichua OC'},
 {id:'up-name',name:'UP64CT4922',category:'VEHICLE',site:'Jayant OC'},
];
test('UP registrations do not disable U49 correction in details or summary',()=>{
 const input={location:'Jayant OC',trips:[{equipmentName:'U49',tripCount:1}],scanMachineSummary:[{equipmentName:'U49',tripCount:1}]};
 const before=JSON.stringify(upRegistrationAssets),result=validateTripEquipment(input,upRegistrationAssets);
 assert.deepEqual(result.issues,{});
 for(const field of ['trips','scanMachineSummary']){assert.equal(result.draft[field][0].equipmentName,'Vpc 49');assert.equal(result.draft[field][0].equipmentId,'vpc49');assert.equal(result.draft[field][0].originalEquipmentName,'U49');}
 assert.equal(JSON.stringify(upRegistrationAssets),before);
});
test('genuine U machine codes still block correction even when UP registrations exist',()=>{
 for(const code of ['U99','U 99 - 12345','U/099']){const result=validateTripEquipment({location:'Jayant OC',trips:[{equipmentName:'U49'}],scanMachineSummary:[{equipmentName:'U49'}]},[...upRegistrationAssets,{id:'real-u',kind:'equipment',door:code,site:'Other'}]);for(const field of ['trips','scanMachineSummary'])assert.match(result.issues[field+'.0.equipmentName'],/U-type machine code/);}
});
test('UP registrations cannot supply a missing, wrong-site or ambiguous Volvo match',()=>{
 for(const input of ['U999999','U32'])assert.ok(resolveTripEquipment({equipmentName:input},upRegistrationAssets,'Jayant').error);
 assert.ok(resolveTripEquipment({equipmentName:'U49'},upRegistrationAssets.filter(r=>r.id!=='vpc49'),'Jayant').error);
 assert.match(resolveTripEquipment({equipmentName:'U49'},[...upRegistrationAssets,{id:'duplicate-v49',kind:'equipment',door:'Vpc49 - 99999',site:'Jayant OC'}],'Jayant').error,/Multiple equipment/);
});
test('scan normalization and review accept U49 with real-style UP registrations',async()=>{
 const {normalizeScanEquipmentRows}=await import('../shared/scan-machine-rules.mjs');const {scanFieldIssues}=await import('../src/scan-field-review.mjs');
 const input={machineNotationRuleVersion:1,tripBodyRuleVersion:2,location:'Jayant OC',timeMode:'without',trips:[{equipmentName:'U49',tripCount:2}],scanMachineSummary:[{equipmentName:'U49',tripCount:2}]};
 const scan=normalizeScanEquipmentRows(input,upRegistrationAssets),result=validateTripEquipment(scan,upRegistrationAssets);
 assert.deepEqual(result.issues,{});assert.equal(result.draft.trips[0].equipmentName,'Vpc 49');assert.equal(result.draft.scanMachineSummary[0].equipmentName,'Vpc 49');assert.equal(result.draft.trips[0].originalEquipmentName,'U49');
 const issues=scanFieldIssues(scan,'vehicle',{}, {assets:upRegistrationAssets});assert.deepEqual(Object.keys(issues).filter(k=>k.startsWith('trips.')||k.startsWith('scanMachineSummary')),[]);
});

test('same selected equipment supplies multiple vehicle door numbers despite matching master labels',()=>{
 const master=[...assets,{id:6,kind:'equipment',door:'Vpc150',site:'Jayant'}];
 for(const doorNo of ['V132','V133','V134']){
  const result=validateTripEquipment({doorNo,location:'Jayant',trips:[{equipmentId:'1',equipmentName:'Vpc 150',tripCount:2},{equipmentId:'1',equipmentName:'V150',tripCount:1}],scanMachineSummary:[{equipmentId:'1',equipmentName:'Vpc 150',tripCount:3}]},master);
  assert.deepEqual(result.issues,{});
  assert.equal(result.draft.doorNo,doorNo);
  assert.deepEqual(result.draft.trips.map(r=>r.equipmentId),['1','1']);
  assert.equal(result.draft.scanMachineSummary[0].equipmentId,'1');
  assert.deepEqual(validateTripEquipment(result.draft,master).issues,{});
 }
 assert.match(resolveTripEquipment({equipmentName:'Vpc150'},master,'Jayant').error,/Multiple equipment/);
});

test('selected equipment cannot bypass a changed label, location or missing master record',()=>{
 const master=[...assets,{id:6,kind:'equipment',door:'Vpc150',site:'Jayant'}];
 assert.equal(resolveTripEquipment({equipmentId:'1',equipmentName:'T20'},master,'Jayant').equipmentId,'2');
 assert.ok(resolveTripEquipment({equipmentId:'1',equipmentName:'Vpc150'},master,'Other').error);
 assert.ok(resolveTripEquipment({equipmentId:'999',equipmentName:'Vpc150'},master,'Jayant').error);
 assert.ok(resolveTripEquipment({equipmentId:'1',equipmentName:'Vpc150'},master.map(r=>({...r,sourceMissing:true})),'Jayant').error);
});

test('VLB save prefers the card site for a shared short code and preserves explicit identity',()=>{
 const local={id:'dch-124',kind:'equipment',door:'VPC124 - 10001',site:'DCH East'};
 const remote={id:'other-124',kind:'equipment',door:'VPC124 - 20002',site:'Jayant OC'};
 const roster=[remote,local];
 const site='DCH East',options={anySite:true};
 const row={equipmentName:'VPC-124',tripCount:1};
 const result=validateTripEquipment({location:site,trips:[row,row],scanMachineSummary:[{...row,tripCount:2}]},roster,options);
 assert.deepEqual(result.issues,{});
 assert.deepEqual(result.draft.trips.map(trip=>trip.equipmentId),[local.id,local.id]);
 assert.equal(result.draft.scanMachineSummary[0].equipmentId,local.id);
 assert.equal(resolveTripEquipment({...row,equipmentId:remote.id},roster,site,options).equipmentId,remote.id);
 assert.equal(resolveTripEquipment({equipmentName:remote.door},roster,site,options).equipmentId,remote.id);
 assert.equal(resolveTripEquipment(row,[remote],site,options).equipmentId,remote.id);
 const duplicate={...local,id:'duplicate',door:'VPC124 - 30003'};
 assert.match(resolveTripEquipment(row,[...roster,duplicate],site,options).error,/Multiple equipment/);
});
