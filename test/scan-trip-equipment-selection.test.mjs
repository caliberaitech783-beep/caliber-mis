import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTripEquipment,correctMatchingTripEquipment,matchCardMachine,tripEquipmentSelectionValue,normalizeScanEquipmentRows,scanEquipmentMatchIssues} from '../shared/scan-machine-rules.mjs';
import {completePreviousShiftMachines} from '../shared/scan-trip-estimates.mjs';
import {machineDiscrepancies} from '../shared/trip-card-rules.mjs';
import {completeScanTripDetails} from '../shared/scan-trip-completion.mjs';
import {validateTripEquipment} from '../shared/trip-equipment-validation.mjs';
const assets=[
 {id:'vpc3',door:'VPC3 - 76167',kind:'equipment',site:'Sasti OC'},
 {id:'vpc4',door:'VPC4 - 76168',kind:'equipment',site:'Sasti OC'},
];
const demoAssets=[...assets,{id:'demo25',door:'DEMO25-49001',kind:'equipment',site:'Sasti OC'}];
test('DE resolves to DEMO at the selected site while DC stays unresolved',()=>{
 assert.equal(matchCardMachine(demoAssets,'DE 25','Sasti OC').match.id,'demo25');
 assert.equal(matchCardMachine(demoAssets,'DC25','Sasti OC').match,null);
 assert.equal(matchCardMachine(demoAssets,'DE25','Jayant OC').match,null);
 const result=validateTripEquipment({location:'Sasti OC',trips:[{equipmentName:'DE25',tripCount:1}],scanMachineSummary:[]},demoAssets);
 assert.deepEqual(result.issues,{});
 assert.equal(result.draft.trips[0].equipmentId,'demo25');
});
for(const collection of ['trips','scanMachineSummary'])test('correcting '+collection+' repairs matching OCR labels throughout this card without changing counts',()=>{
 const input={location:'Sasti OC',machineNotationRuleVersion:1,tripBodyRuleVersion:2,trips:[{equipmentName:'DC25',tripCount:2,loadingTime:'09:47'},{equipmentName:'DC 25',tripCount:4}],scanMachineSummary:[{equipmentName:'DC25',tripCount:6}]};
 const corrected=correctMatchingTripEquipment(input,collection,0,'demo25',demoAssets);
 assert.ok([...corrected.trips,...corrected.scanMachineSummary].every(row=>row.equipmentId==='demo25'));
 assert.deepEqual(corrected.trips.map(row=>row.tripCount),[2,4]);
 assert.equal(corrected.trips[0].loadingTime,'09:47');
 const validated=validateTripEquipment(normalizeScanEquipmentRows(completeScanTripDetails(corrected),demoAssets),demoAssets);
 assert.deepEqual(validated.issues,{});
 assert.deepEqual(machineDiscrepancies(validated.draft.trips,validated.draft.scanMachineSummary),[]);
 const missing={...validated.draft,trips:validated.draft.trips.map((row,i)=>({...row,tripCount:i?3:2}))};
 assert.ok(machineDiscrepancies(missing.trips,missing.scanMachineSummary).length);
});
test('card correction preserves explicit choices and clearing only changes the selected row',()=>{
 const explicit=selectTripEquipment({equipmentName:'DC25',tripCount:1},'vpc3',demoAssets,'Sasti OC');
 const input={location:'Sasti OC',trips:[{equipmentName:'DC25',tripCount:1},explicit],scanMachineSummary:[{equipmentName:'DC25',tripCount:1}]};
 const corrected=correctMatchingTripEquipment(input,'trips',0,'demo25',demoAssets);
 assert.equal(corrected.trips[1].equipmentId,'vpc3');
 const cleared=correctMatchingTripEquipment(corrected,'trips',0,'',demoAssets);
 assert.equal(cleared.trips[0].equipmentName,'');
 assert.equal(cleared.scanMachineSummary[0].equipmentId,'demo25');
});
const draft=trips=>({location:'Sasti OC',machineNotationRuleVersion:1,trips,scanMachineSummary:[{equipmentName:'VPC3 - 76167',tripCount:3}]});

test('VPC3 dropdown selection survives summary completion, validation and serialized draft reopening',()=>{
 const chosen=selectTripEquipment({equipmentName:'V',tripCount:1},'vpc3',assets,'Sasti OC');
 const input=draft([chosen,{equipmentName:'VPC3',tripCount:1},{equipmentName:'VPC3',tripCount:1}]);
 const completed=completeScanTripDetails(input);
 assert.equal(completed.trips[0].equipmentName,'VPC3 - 76167');
 assert.equal(completed.trips[0].originalEquipmentName,'V');
 const saved=validateTripEquipment(normalizeScanEquipmentRows(completed,assets),assets);
 assert.deepEqual(saved.issues,{});
 assert.deepEqual(machineDiscrepancies(saved.draft.trips,saved.draft.scanMachineSummary),[]);
 const reopened=completeScanTripDetails(normalizeScanEquipmentRows(JSON.parse(JSON.stringify(saved.draft)),assets));
 assert.equal(reopened.trips[0].equipmentName,'VPC3 - 76167');
 assert.equal(reopened.trips[0].equipmentId,'vpc3');
 assert.deepEqual(reopened.trips.map(r=>tripEquipmentSelectionValue(r,assets,'Sasti OC')),['vpc3','vpc3','vpc3']);
 assert.deepEqual(scanEquipmentMatchIssues(reopened,assets),{});
});

test('changing or clearing equipment retains the explicit choice during inference',()=>{
 const first=selectTripEquipment({equipmentName:'V',tripCount:1},'vpc3',assets,'Sasti OC');
 const changed=selectTripEquipment(first,'vpc4',assets,'Sasti OC');
 assert.equal(completeScanTripDetails(draft([changed])).trips[0].equipmentName,'VPC4 - 76168');
 const cleared=selectTripEquipment(first,'',assets,'Sasti OC');
 const result=completeScanTripDetails(draft([first,{...cleared,loadingTime:'09:00'}]));
 assert.equal(result.trips[1].equipmentName,'');
 assert.equal(tripEquipmentSelectionValue(result.trips[1],assets,'Sasti OC'),'');
 assert.ok(validateTripEquipment(result,assets).issues['trips.1.equipmentName']);
});

test('manual identity resolves duplicate door numbers without changing the selected serial',()=>{
 const duplicates=[...assets,{id:'other-vpc3',door:'VPC3 - 99999',kind:'equipment',site:'Sasti OC'}];
 const chosen=selectTripEquipment({equipmentName:'V3',tripCount:1},'other-vpc3',duplicates,'Sasti OC');
 const input={...draft([chosen]),scanMachineSummary:[]};
 const result=validateTripEquipment(normalizeScanEquipmentRows(input,duplicates),duplicates);
 assert.deepEqual(result.issues,{});
 assert.equal(normalizeScanEquipmentRows(result.draft,duplicates).trips[0].equipmentName,'VPC3 - 99999');
 assert.equal(tripEquipmentSelectionValue(result.draft.trips[0],duplicates,'Sasti OC'),'other-vpc3');
 assert.deepEqual(scanEquipmentMatchIssues(result.draft,duplicates),{});
});

test('removed or transferred equipment remains blocked instead of matching another machine',()=>{
 const chosen=selectTripEquipment({equipmentName:'V3',tripCount:1},'vpc3',assets,'Sasti OC');
 for(const changed of [assets.slice(1),assets.map(a=>a.id==='vpc3'?{...a,site:'Jayant OC'}:a),assets.map(a=>a.id==='vpc3'?{...a,sourceMissing:true}:a)]){
  const input={...draft([chosen]),scanMachineSummary:[]};
  assert.ok(validateTripEquipment(input,changed).issues['trips.0.equipmentName']);
  assert.equal(tripEquipmentSelectionValue(chosen,changed,'Sasti OC'),'');
  assert.ok(scanEquipmentMatchIssues(input,changed)['trips.0.equipmentName']);
 }
});

test('previous-shift inference does not refill a manually cleared equipment selection',()=>{
 const cleared=selectTripEquipment({equipmentName:'V3',loadingTime:'09:00',unloadingTime:'09:20'},'',assets,'Sasti OC');
 const input={bookDate:'2026-11-01',cardShift:'II',trips:[cleared]};
 const records=[{id:'previous',data:{bookDate:'2026-11-01',cardShift:'I',trips:[{equipmentName:'VPC3',loadingTime:'08:00'}]}}];
 assert.equal(completePreviousShiftMachines(input,records).trips[0].equipmentName,'');
});

test('reopened Majri OB summary rows resolve handwritten and saved equipment labels to master IDs',()=>{
 const site='majri ob';
 const numbers=['89','28','108','16','07'];
 const roster=numbers.map((number,index)=>({
  id:'loader-'+number,door:'VPC'+Number(number)+' - '+(76100+index),kind:'equipment',site,
 }));
 const rows=numbers.map((number,index)=>({equipmentName:'V'+number,tripCount:[1,5,1,2,2][index]}));
 const input={location:site,machineNotationRuleVersion:1,trips:[],scanMachineSummary:rows};
 const saved=validateTripEquipment(normalizeScanEquipmentRows(input,roster),roster);
 assert.deepEqual(saved.issues,{});
 for(const summary of [rows,JSON.parse(JSON.stringify(saved.draft.scanMachineSummary))]){
  assert.deepEqual(summary.map(row=>tripEquipmentSelectionValue(row,roster,site)),roster.map(asset=>asset.id));
  assert.deepEqual(summary.map(row=>row.tripCount),[1,5,1,2,2]);
 }
 assert.equal(tripEquipmentSelectionValue(rows[0],roster.slice(1),site),'');
});
