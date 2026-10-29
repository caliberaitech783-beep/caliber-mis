import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyCardMachine,normalizeScanEquipmentRows,scanEquipmentMatchIssues,compactScanEquipmentReferences} from '../scan-machine-rules.mjs';
import {extractCard} from '../scan-extraction.mjs';
import {aFields,reconcile} from '../gemini-hybrid.mjs';
import {completeScanTripDetails} from '../scan-trip-completion.mjs';

const site='Jayant OC';
const assets=['VPC012','TPC012','SPC012','LPC012','D012','G012','PL012','H012'].map((door,i)=>({id:String(i+1),door,kind:'equipment',site}));
const input=names=>({machineNotationRuleVersion:1,location:site,trips:names.map(equipmentName=>({equipmentName,loadingTime:'12:02',unloadingTime:'12:12',tripCount:1})),scanMachineSummary:names.map(equipmentName=>({equipmentName,tripCount:1}))});

test('approved trip body aliases match equipment at the selected site and retain literal evidence',()=>{
 const names=['V / 012','E 012','S012','H012','Dozer012','Grader012','Pay Loader012','Hydra012'];
 const original=input(names),result=normalizeScanEquipmentRows(original,assets);
 assert.deepEqual(result.trips.map(r=>r.equipmentName),assets.map(r=>r.door));
 assert.deepEqual(result.scanMachineSummary.map(r=>r.equipmentName),assets.map(r=>r.door));
 assert.deepEqual(result.trips.map(r=>r.equipmentNotation.original),names);
 assert.deepEqual(original,input(names));
 assert.deepEqual(normalizeScanEquipmentRows(result,assets),result);
 assert.deepEqual(scanEquipmentMatchIssues(result,assets),{});
 assert.equal(result.trips[0].loadingTime,'12:02');
 assert.equal(identifyCardMachine('H012','vehicle').code,'H');
 assert.equal(identifyCardMachine('H012','equipment').label,'Hydra');
});

test('missing, duplicate and wrong-site master matches remain flagged without guessing',()=>{
 const original=input(['E012','H012','Hydra012','V','19']);
 const elsewhere=assets.map(r=>({...r,site:'Sasti OC'}));
 const result=normalizeScanEquipmentRows(original,elsewhere);
 assert.deepEqual(result.trips.map(r=>r.equipmentName),['TPC012','LPC012','Hydra012','V','19']);
 assert.equal(Object.keys(scanEquipmentMatchIssues(result,elsewhere)).length,6);
 assert.match(scanEquipmentMatchIssues(input(['E012']),[...assets,{...assets[1],id:'duplicate'}])['trips.0.equipmentName'],/multiple/);
 assert.equal(normalizeScanEquipmentRows(input(['H']),assets).trips[0].equipmentName,'H');
});

test('text trip rows keep body H distinct from Hydra and header H',()=>{
 const masters=assets.map(r=>({id:Number(r.id),master_name:'Equipment master',record_data:{door:r.door,category:'equipment',site}}));
 const text=`SITE ${site}\nDOOR NO H/77\n1 E 012 12:02 12:12\n2 H 012 12:20 12:30\n3 Hydra 012 12:40 12:50`;
 const result=extractCard(text,'vehicle',masters);
 assert.deepEqual(result.draft.trips.map(r=>r.equipmentName),['TPC012','H012','H012']);
 assert.equal(result.raw.door,'H/77');
 assert.equal(compactScanEquipmentReferences('3 Hydra 012 12:40 12:50'),'3 Hydra012 12:40 12:50');
});

test('Gemini reconciliation accepts body aliases without changing original responses or times',()=>{
 const fields=Object.fromEntries(aFields('vehicle').map(k=>[k,{value:null,status:'missing'}]));
 fields.machineSummary=[{equipmentName:{value:'TPC012',status:'clear'},tripCount:{value:'1',status:'clear'}},{equipmentName:{value:'H012',status:'clear'},tripCount:{value:'1',status:'clear'}}];
 const trips={p:true,r:[[1,'E012','12:2','12:12'],[2,'H012','12:20','12:30']]};
 const before=structuredClone({fields,trips}),result=reconcile(fields,trips,'vehicle');
 assert.equal(result.issues.some(s=>/conflict|absent/.test(s)),false);
 assert.equal(result.rows[0].loadingTime,'12:02');
 assert.deepEqual({fields,trips},before);
});

test('Hydra continuation rows retain their resolved meaning on subsequent validation',()=>{
 const draft=input(['Hydra012','']);draft.scanMachineSummary=[];
 const normalized=normalizeScanEquipmentRows(draft,assets);
 const completed=completeScanTripDetails(normalized,{gemini:{trips:{r:[[1,'Hydra012','12:02','12:12'],[2,'','12:20','12:30']]}}});
 const result=normalizeScanEquipmentRows(completed,assets);
 assert.deepEqual(result.trips.map(r=>r.equipmentName),['H012','H012']);
 assert.equal(result.scanMachineSummary[0].equipmentName,'H012');
});
