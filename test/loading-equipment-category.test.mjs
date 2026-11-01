import test from 'node:test';
import assert from 'node:assert/strict';
import {assetBookKind} from '../equipment-kind.mjs';
import {validateTripEquipment} from '../trip-equipment-validation.mjs';
import {normalizeScanEquipmentRows,scanEquipmentMatchIssues,selectTripEquipment,siteEquipmentOptions} from '../scan-machine-rules.mjs';
import {scanFieldIssues} from '../src/scan-field-review.mjs';
const raw=[
 {id:'1802',equipmentName:'T11 - MH34BZ2638',category:'VEHICLE',currentLocation:'Dhoptala OC (2nd)'},
 {id:'2339',equipmentName:'T22 - MH34BZ7681',category:'VEHICLE',currentLocation:'Dudhichua OC'},
 {id:'2608',equipmentName:'T15 - MH34BZ5065',category:'VEHICLE',currentLocation:'Jayant OC'},
 {id:'2612',equipmentName:'T9-MH34BZ1312',category:'VEHICLE',currentLocation:'Jayant OC'},
 {id:'2606',equipmentName:'T10-MH34BZ2637',category:'VEHICLE',currentLocation:'Jayant OC'},
 {id:'1752',equipmentName:'S42 - MH34BZ0252',category:'VEHICLE',currentLocation:'Sasti OC'},
 {id:'1754',equipmentName:'S44 - MH34BZ0269',category:'VEHICLE',currentLocation:'Sasti OC'},
 {id:'1866',equipmentName:'SPC44 - 79598',category:'EQUIPMENT',currentLocation:'Sasti OC'},
 ...[9,10,11,22].map(n=>({id:'tpc'+n,equipmentName:'TPC'+n+' - 12345',category:'EQUIPMENT',currentLocation:'Majri OC'})),
 {id:'tpc15',equipmentName:'TPC15 - 01046',category:'EQUIPMENT',currentLocation:'Dhoptala OC (2nd)'},
 {id:'spc42',equipmentName:'SPC42 - 12345',category:'EQUIPMENT',currentLocation:'Dhoptala OC (2nd)'},
 {id:'vpc49',equipmentName:'VPC49 -62577',category:'EQUIPMENT',currentLocation:'Jayant OC'},
 {id:'vehicle-u',equipmentName:'U99',category:'VEHICLE',currentLocation:'Other'},
];
const options=raw.map(r=>({id:r.id,door:r.equipmentName,name:r.equipmentName,kind:assetBookKind(r),site:r.currentLocation}));
const draft=(location,equipmentName)=>({location,timeMode:'without',machineNotationRuleVersion:1,tripBodyRuleVersion:2,trips:[{equipmentName,tripCount:1}],scanMachineSummary:[{equipmentName,tripCount:1}]});
const invalid=[['Dhoptala OC (2nd)','T11'],['Dhoptala OC (2nd)','TA11'],['Dudhichua OC','T22'],['Dudhichua OC','TA22'],...['T15','TA15','T9','TA9','T10','TA10'].map(v=>['Jayant OC',v]),['Sasti OC','S42']];
test('all eleven live wrong-location collisions are blocked in details, summary and scan review',()=>{
 for(const assets of [raw,options])for(const [site,input] of invalid){const original=draft(site,input);for(const candidate of [original,normalizeScanEquipmentRows(original,assets)]){const result=validateTripEquipment(candidate,assets),review=scanFieldIssues(candidate,'vehicle',{}, {assets});for(const field of ['trips','scanMachineSummary']){assert.ok(result.issues[field+'.0.equipmentName'],site+' '+input);assert.ok(review[field+'.0.equipmentName'],site+' '+input);}}}
});
test('Sasti S44 resolves uniquely to equipment SPC44 despite a same-number Scania vehicle',()=>{
 const before=JSON.stringify(raw);for(const assets of [raw,options]){const input=draft('Sasti OC','S44');const normalized=normalizeScanEquipmentRows(input,assets),result=validateTripEquipment(normalized,assets);assert.deepEqual(result.issues,{});for(const field of ['trips','scanMachineSummary']){assert.equal(result.draft[field][0].equipmentName,'Spc 44');assert.equal(result.draft[field][0].equipmentId,'1866');}assert.deepEqual(scanEquipmentMatchIssues(normalized,assets),{});}assert.equal(JSON.stringify(raw),before);
});
test('vehicle master IDs cannot bypass loading-equipment validation',()=>{
 for(const assets of [raw,options]){const input=draft('Sasti OC','S44');input.trips[0]={...input.trips[0],equipmentSource:'master-selection',equipmentId:'1754'};assert.ok(validateTripEquipment(input,assets).issues['trips.0.equipmentName']);assert.equal(selectTripEquipment({},'1754',assets,'Sasti OC').equipmentId,'');const selected=selectTripEquipment({},'1866',assets,'Sasti OC');assert.equal(selected.equipmentId,'1866');assert.deepEqual(validateTripEquipment({...draft('Sasti OC','S44'),trips:[{...selected,tripCount:1}]},assets).issues,{});}
});
test('classification accepts raw category aliases and typed options but rejects unclassified records',()=>{
 assert.equal(validateTripEquipment(draft('Jayant OC','U49'),raw).draft.trips[0].equipmentName,'Vpc 49');
 const categoryAlias=[{id:'e',door:'TPC35',equipmentCategory:'Equipment',location:'Jayant OC'},{id:'v',door:'T35',equipmentCategory:'Vehicle',location:'Jayant OC'}];assert.equal(validateTripEquipment(draft('Jayant OC','TA35'),categoryAlias).draft.trips[0].equipmentId,'e');
 assert.ok(validateTripEquipment(draft('Jayant OC','TA35'),[{id:'unknown',door:'TPC35',site:'Jayant OC'}]).issues['trips.0.equipmentName']);
 assert.equal(siteEquipmentOptions(raw,'Sasti OC').length,1);
});
