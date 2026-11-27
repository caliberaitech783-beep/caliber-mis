import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {machineSummary,machineLabel,machineDiscrepancies,machineTripTotal} from '../shared/trip-card-rules.mjs';
import {normalizeScanEquipmentRows} from '../shared/scan-machine-rules.mjs';

const assets=[
 {id:'demo',door:'DEMO21-00179',kind:'equipment',site:'Dhoptala OB',cardAliases:['DE21']},
 ...[124,130,125,129,131].map(n=>({id:String(n),door:'VPC'+n,kind:'equipment',site:'Dhoptala OB'})),
];
const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
const handler=source.match(/onClick=\{\(\)=>\{(const listed=[\s\S]*?)\}\}><Plus\s+size=\{14\}\/>Add machine row/)[1];
const click=draft=>{
 const comparisonDraft=normalizeScanEquipmentRows(draft,assets);
 let result;
 const update=(key,value)=>{assert.equal(key,'scanMachineSummary');result={...draft,[key]:normalizeScanEquipmentRows({...draft,[key]:value,machineNotationRuleVersion:1},assets)[key]};};
 new Function('draft','comparisonDraft','machineSummary','machineLabel','update',handler)(draft,comparisonDraft,machineSummary,machineLabel,update);
 return result;
};
const videoDraft=()=>({location:'Dhoptala OB',machineNotationRuleVersion:1,
 trips:[{equipmentName:'DE21',tripCount:3},...[124,130,125,129,131].map((n,i)=>({equipmentName:'VPC'+n,tripCount:i===0?3:i===1?2:1}))],
 scanMachineSummary:[{equipmentName:'DEMO21-00179',tripCount:3}],
});

test('Add machine row adds the next missing machine instead of counting a resolved alias twice',()=>{
 const draft=videoDraft(),before=JSON.stringify(draft),result=click(draft);
 assert.deepEqual(result.scanMachineSummary.map(r=>[r.equipmentName,r.tripCount]),[['DEMO21-00179',3],['VPC124',3]]);
 assert.equal(JSON.stringify(draft),before);
});

test('successive clicks add all five missing machines from the video and retain the 11-trip total',()=>{
 let draft=videoDraft();
 for(let i=0;i<5;i++)draft=click(draft);
 assert.equal(draft.scanMachineSummary.length,6);
 assert.equal(machineTripTotal(draft.scanMachineSummary),11);
 const comparison=normalizeScanEquipmentRows(draft,assets);
 assert.deepEqual(machineDiscrepancies(comparison.trips,comparison.scanMachineSummary),[]);
 const extra=click(draft);
 assert.equal(extra.scanMachineSummary.length,7);
 assert.equal(extra.scanMachineSummary.at(-1).equipmentName,'');
 assert.equal(extra.scanMachineSummary.at(-1).tripCount,'');
 assert.equal(extra.scanMachineSummary[0].tripCount,3);
});

test('aliases already listed in an unnormalized summary do not duplicate a resolved trip machine',()=>{
 const draft=videoDraft();
 draft.trips[0].equipmentName='DEMO21-00179';
 draft.scanMachineSummary[0].equipmentName='DE21';
 const result=click(draft);
 assert.deepEqual(result.scanMachineSummary.map(r=>[r.equipmentName,r.tripCount]),[['DEMO21-00179',3],['VPC124',3]]);
});
