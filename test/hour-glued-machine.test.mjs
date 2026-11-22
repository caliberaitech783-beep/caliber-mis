import test from 'node:test';
import assert from 'node:assert/strict';
import {correctHourGluedMachines,normalizeScanEquipmentRows,scanEquipmentMatchIssues,aliasMachineHint,tripRowWrittenMachine,selectTripEquipment} from '../shared/scan-machine-rules.mjs';
import {aliasForSelection,attachEquipmentAliases} from '../shared/equipment-alias-rules.mjs';
import {scanBatchMismatches} from '../shared/equipment-aliases.mjs';
import {readTripMachines} from '../server/rules/scan-extraction.mjs';
import {completeScanTripDetails} from '../shared/scan-trip-completion.mjs';

// The loading hour read twice (rule of 23 Nov 2026). On the trip card the hour is written
// right against the machine number in the narrow NO column; the reader returned
// "T | 65 | 8:38" as T658 at 08:38. 423 saved mappings on live had this shape.
const site='Jayant OB';
const tpc65={id:'2634',door:'TPC65 - 05018',name:'TPC65 - 05018',kind:'equipment',category:'Equipment',site};
const tpc50={id:'2600',door:'TPC50- 05008',name:'TPC50- 05008',kind:'equipment',category:'Equipment',site};
const vpc82={id:'2700',door:'VPC82 - 86007',name:'VPC82 - 86007',kind:'equipment',category:'Equipment',site};
const assets=[tpc65,tpc50,vpc82];
const draft=(trips,summary=[],extra={})=>({location:site,machineNotationRuleVersion:1,tripBodyRuleVersion:2,timeMode:'with',trips:trips.map(([equipmentName,loadingTime,unloadingTime=''],index)=>({rowNumber:index+1,equipmentName,loadingTime,unloadingTime,tripCount:1})),scanMachineSummary:summary.map(([equipmentName,tripCount])=>({equipmentName,tripCount})),...extra});
const names=result=>result.trips.map(row=>row.equipmentName);

// Jayant OC, 19 Nov 2026, Shift I, tipper V/642: the reader's own answer for the ten trip rows.
const card=[['T655','05:09','05:23'],['T655','05:54','06:08'],['T656','06:42','06:55'],['T507','07:27','07:40'],['T658','08:38','08:51'],['T659','09:10','09:28'],['T659','09:38','09:51'],['T6510','10:08','10:22'],['T6510','10:52','11:05'],['T6511','11:39','']];

test('the real card: every T65 row is put back, the written text is kept, a single unconfirmed row is left for review',()=>{
 const result=correctHourGluedMachines(draft(card,[['T65',10]]),assets);
 assert.deepEqual(names(result),['TPC65 - 05018','TPC65 - 05018','TPC65 - 05018','T507','TPC65 - 05018','TPC65 - 05018','TPC65 - 05018','TPC65 - 05018','TPC65 - 05018','TPC65 - 05018']);
 assert.deepEqual(result.trips[0].equipmentNotation,{original:'T655',resolved:'TPC65 - 05018',hourGlued:'5'});
 assert.deepEqual(result.trips[7].equipmentNotation,{original:'T6510',resolved:'TPC65 - 05018',hourGlued:'10'});
 assert.equal(result.trips[3].equipmentNotation,undefined,'T507 at 07:27 is TPC50 only if the card says so somewhere else');
 const matched=normalizeScanEquipmentRows(result,assets);
 assert.equal(matched.trips[4].equipmentName,'TPC65 - 05018');assert.equal(matched.trips[4].equipmentNotation.hourGlued,'8','matching to the master keeps the correction and its note');
 assert.deepEqual(Object.keys(scanEquipmentMatchIssues(result,assets)),['trips.3.equipmentName'],'only the unconfirmed row still needs the reviewer');
 assert.equal(aliasMachineHint(matched.trips[4]),'Written: T658 · read as TPC65 - 05018: the 8 on the end is the loading hour');
});

test('without a summary, two rows loaded in different hours confirm each other; one row alone does not',()=>{
 assert.deepEqual(names(correctHourGluedMachines(draft([['T655','05:09'],['T658','08:38']]),assets)),['TPC65 - 05018','TPC65 - 05018']);
 assert.deepEqual(names(correctHourGluedMachines(draft([['T655','05:09'],['T655','05:54']]),assets)),['T655','T655'],'the same hour twice is one piece of evidence');
 assert.deepEqual(names(correctHourGluedMachines(draft([['T658','08:38']]),assets)),['T658']);
 assert.deepEqual(names(correctHourGluedMachines(draft([['T658','08:38']],[['V82',1]]),assets)),['T658'],'another machine in the summary confirms nothing');
 assert.deepEqual(names(correctHourGluedMachines(draft([['T507','07:27']],[['T50',1]]),assets)),['TPC50- 05008'],'the summary names the machine');
});

test('nothing is rewritten unless the extra digits are that row\'s own loading hour',()=>{
 const same=input=>assert.equal(correctHourGluedMachines(input,assets),input);
 same(draft([['T658','09:10'],['T659','08:38']],[['T65',2]]));
 same(draft([['T65','08:38'],['V82','09:10']],[['T65',1],['V82',1]]));
 same(draft([['T658','','08:51']],[['T65',1]]));
 same(draft([['T658','Load','08:51']],[['T65',1]]));
 same(draft([['T668','08:38']],[['T65',1]]));
 // A 12-hour time kept as written beside its shift-clock value: 2:15 on Shift II is 14:15.
 const afternoon=draft([['T652','14:15']],[['T65',1]]);
 assert.deepEqual(names(correctHourGluedMachines(afternoon,assets)),['TPC65 - 05018']);
 assert.equal(correctHourGluedMachines(afternoon,assets).trips[0].equipmentNotation.hourGlued,'2');
 const written=draft([['T652','14:15']],[['T65',1]]);written.trips[0].writtenLoadingTime='2:15';
 assert.deepEqual(names(correctHourGluedMachines(written,assets)),['TPC65 - 05018']);
});

test('a number that is a real machine at the site is never touched, whatever the hour says',()=>{
 const tpc658={id:'9001',door:'TPC658 - 00001',name:'TPC658 - 00001',kind:'equipment',category:'Equipment',site};
 const input=draft([['T658','08:38'],['T655','05:09']],[['T65',2]]);
 const result=correctHourGluedMachines(input,[...assets,tpc658]);
 assert.deepEqual(names(result),['T658','TPC65 - 05018'],'T658 exists here; T655 does not');
 // The same number at another site does not count: matching is always inside the card's site.
 assert.deepEqual(names(correctHourGluedMachines(input,[...assets,{...tpc658,site:'Majri OB'}])),['TPC65 - 05018','TPC65 - 05018']);
});

test('the machine left after removing the hour must be one real door: not an alias, not two machines',()=>{
 const aliased=attachEquipmentAliases([vpc82,tpc50],[{equipment_id:2700,kind:'equipment',written_text:'T65',written_key:'TPC65',status:'active'}]);
 const input=draft([['T655','05:09'],['T658','08:38']],[['T65',2]]);
 assert.equal(correctHourGluedMachines(input,aliased),input,'T65 here is only a saved alias of VPC82');
 const twin={...tpc65,id:'2635',door:'TPC65 - 09999',name:'TPC65 - 09999'};
 assert.equal(correctHourGluedMachines(input,[...assets,twin]),input,'two machines answer to T65');
 // A label that already answers to an alias is left to that alias.
 const known=attachEquipmentAliases(assets,[{equipment_id:2700,kind:'equipment',written_text:'T658',written_key:'TPC658',status:'active'}]);
 assert.deepEqual(names(correctHourGluedMachines(input,known)),['TPC65 - 05018','T658']);
});

test('only scanned trip rows with times are read this way; explicit choices and old drafts stay as they are',()=>{
 const input=draft(card,[['T65',10]]);
 for(const untouched of [{...input,machineNotationRuleVersion:undefined},{...input,machineNotationRuleVersion:2},{...input,timeMode:'without'},{...input,location:''},{...input,trips:undefined}])assert.equal(correctHourGluedMachines(untouched,assets),untouched);
 const chosen=draft([['T655','05:09'],['T658','08:38']],[['T65',2]]);
 chosen.trips[0]=selectTripEquipment(chosen.trips[0],'2600',assets,site);
 const result=correctHourGluedMachines(chosen,assets);
 assert.equal(result.trips[0].equipmentId,'2600','the reviewer\'s dropdown choice wins');
 assert.equal(result.trips[1].equipmentName,'TPC65 - 05018','the summary still confirms the other row');
});

test('a corrected row is not offered as a mismatch pair and never becomes a saved mapping',()=>{
 const result=normalizeScanEquipmentRows(correctHourGluedMachines(draft(card,[['T65',10]]),assets),assets);
 assert.equal(tripRowWrittenMachine(result.trips[4]),'TPC65 - 05018');
 assert.equal(tripRowWrittenMachine(result.trips[3]),'T507');
 assert.equal(tripRowWrittenMachine({equipmentSource:'master-selection',equipmentName:'TPC65 - 05018',equipmentNotation:{original:'T658'}}),'');
 const box=scanBatchMismatches({cards:[{id:'c1',ordinal:1,status:'review',draft:{...result,doorText:''}}],assets:[...assets,{id:'1',door:'V642',kind:'vehicle',category:'Vehicle',site}],site,kind:'vehicle'});
 const body=box.categories.find(category=>category.id==='body');
 assert.deepEqual(body.right.map(pair=>pair.written),['T507'],'only the row the rule left alone is asked about');
 assert.ok(!body.left.some(asset=>asset.id==='2634'),'TPC65 counts as named on the card');
 // If the reviewer overrides a corrected row, the written text is still T658: number 658 is not 50, nothing is saved.
 const overridden=selectTripEquipment(result.trips[4],'2600',assets,site);
 assert.equal(overridden.originalEquipmentName,'T658');assert.equal(aliasForSelection(overridden.originalEquipmentName,tpc50),null);
});

test('a ditto row below a corrected row carries the corrected machine down',()=>{
 const input=draft([['T655','05:09','05:23'],['','05:54','06:08'],['T658','08:38','08:51']],[['T65',3]]);
 const read=normalizeScanEquipmentRows(correctHourGluedMachines(input,assets),assets);
 const completed=completeScanTripDetails(read,{});
 assert.deepEqual(completed.trips.map(row=>row.equipmentName),['TPC65 - 05018','TPC65 - 05018','TPC65 - 05018']);
 assert.equal(completed.trips[1].equipmentSource,'previous-trip-row');
});

test('the card reader applies the rule before matching rows to the Equipment master',()=>{
 const masters=assets.map(asset=>({id:Number(asset.id),master_name:'Equipment master',record_data:{door:asset.door,equipmentName:asset.door,category:'Equipment',currentLocation:site}}));
 const read=readTripMachines(draft(card,[['T65',10]]),masters);
 assert.equal(read.trips[0].equipmentName,'TPC65 - 05018');assert.equal(read.trips[0].equipmentNotation.original,'T655');
 assert.equal(read.trips[3].equipmentName,'TPC507','an unmatched row keeps its canonical read form for the reviewer');
 assert.equal(read.scanMachineSummary[0].equipmentName,'TPC65 - 05018');
});
