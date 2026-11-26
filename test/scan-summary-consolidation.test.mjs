import test from 'node:test';
import assert from 'node:assert/strict';
import {combineMachineSummary,machineDiscrepancies} from '../shared/trip-card-rules.mjs';
import {completeScanTripDetails} from '../shared/scan-trip-completion.mjs';
import {normalizeScanEquipmentRows} from '../shared/scan-machine-rules.mjs';
const summary=[{equipmentName:'TPC34 - 01149',tripCount:4},{equipmentName:'TPC33 - 01144',tripCount:'9'},{equipmentName:'TPC35 - 01150',tripCount:1},{equipmentName:'TPC33 - 01144',tripCount:'1'}];
const trips=[{equipmentName:'TPC34 - 01149',tripCount:4},{equipmentName:'TPC33 - 01144',tripCount:10},{equipmentName:'TPC35 - 01150',tripCount:1}];
test('screenshot summary combines 9 + 1 and matches trip details without mutating evidence',()=>{
 const before=JSON.stringify(summary),result=completeScanTripDetails({trips,scanMachineSummary:summary});
 assert.deepEqual(result.scanMachineSummary,trips);
 assert.deepEqual(machineDiscrepancies(trips,result.scanMachineSummary),[]);
 assert.equal(JSON.stringify(summary),before);
 assert.deepEqual(combineMachineSummary(result.scanMachineSummary),result.scanMachineSummary);
});
test('combined counts still expose mismatches against detail trips',()=>{
 const combined=combineMachineSummary(summary.map((r,i)=>i===3?{...r,tripCount:2}:r));
 assert.equal(combined[1].tripCount,11);
 assert.ok(machineDiscrepancies(trips,combined).some(s=>s.includes('detail trips 10, scanned summary 11')));
});
test('invalid counts remain invalid and blank equipment rows stay separate for review',()=>{
 const result=combineMachineSummary([{equipmentName:'TPC33',tripCount:9},{equipmentName:'TPC33',tripCount:''},{equipmentName:'',tripCount:1},{equipmentName:'',tripCount:2}]);
 assert.equal(result[0].tripCount,'');assert.equal(result.length,3);
});
test('equipment aliases consolidate after resolution to the same master',()=>{
 const assets=[{id:'1',door:'TPC33 - 01144',kind:'equipment',site:'Jayant OC',cardAliases:['TPC33']}];
 const result=normalizeScanEquipmentRows({machineNotationRuleVersion:1,location:'Jayant OC',scanMachineSummary:[{equipmentName:'TPC33',tripCount:9},{equipmentName:'TPC33 - 01144',tripCount:1}]},assets);
 assert.equal(result.scanMachineSummary.length,1);assert.equal(result.scanMachineSummary[0].tripCount,10);
});
