// Owner, 24 Nov 2026: a VLB, ELB or LMV card, scanned or manual, takes only a machine of its book's category in the
// Equipment master, and a trip only an Equipment as loading machine. Old cards that do not fit are listed on
// Masters › Machine Category Re-check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {bookCategoryIssue,allowsLogBookKind,masterCategory} from '../shared/equipment-kind.mjs';
import {machineCategoryIssues} from '../shared/machine-category-recheck.mjs';
import {resolveTripEquipment} from '../shared/trip-equipment-validation.mjs';
import {scanFieldIssues} from '../src/scan-field-review.mjs';
import {addMachineAnswer,emptyMachineRecheck,machineSiteRows,machineSlotRows,cardsOfSlot} from '../src/machine-category-recheck-model.mjs';
import {misPageAllowed} from '../shared/mis-application-access.mjs';

const tipper={id:'1',door:'T11',category:'VEHICLE',group:'Tipper',site:'Sasti OC'};
const excavator={id:'2',door:'TPC65',category:'EQUIPMENT',group:'Excavator',site:'Sasti OC'};
const bolero={id:'3',door:'LMV-07',category:'LMV',group:'Bolero',site:'Sasti OC'};
const blankLoader={id:'4',door:'PL05',category:'',group:'Pay Loader',site:'Sasti OC'};

test('the category in the master decides the book, and an LMV is no longer taken by VLB or ELB',()=>{
 assert.equal(masterCategory(tipper),'vehicle');assert.equal(masterCategory(excavator),'equipment');assert.equal(masterCategory(bolero),'lmv');
 assert.equal(masterCategory({lmv:true,kind:'vehicle'}),'lmv','the options of the LMV scan keep lmv:true');
 for(const [asset,kind] of [[tipper,'vehicle'],[excavator,'equipment'],[bolero,'lmv']])assert.equal(bookCategoryIssue(asset,kind),'',asset.door+' fits '+kind);
 assert.match(bookCategoryIssue(excavator,'vehicle'),/TPC65 is Equipment in the Equipment Master, so it cannot be on a VLB card \(VLB takes Vehicle only\)\. Enter it on the ELB card/);
 assert.match(bookCategoryIssue(tipper,'equipment'),/T11 is Vehicle .* cannot be on an ELB card/);
 assert.match(bookCategoryIssue(bolero,'vehicle'),/LMV-07 is LMV .* VLB card .* Enter it on the LMV card/);
 assert.equal(allowsLogBookKind(bolero,'vehicle'),false);assert.equal(allowsLogBookKind(bolero,'equipment'),false);
 assert.match(bookCategoryIssue(tipper,'lmv'),/T11 is Vehicle .* cannot be on an LMV card .* Enter it on the VLB card/);
});

test('a record with no category is judged by its group, and the message says the category is missing',()=>{
 assert.equal(bookCategoryIssue(blankLoader,'equipment'),'');
 assert.match(bookCategoryIssue(blankLoader,'vehicle'),/PL05 has no Equipment category in the Equipment Master .* Set its category in Pulse/);
});

test('a trip is loaded only by an Equipment of the master, whatever its group says',()=>{
 const odd={id:'5',door:'TPC66',category:'VEHICLE',group:'Excavator',site:'Sasti OC'};
 assert.equal(resolveTripEquipment({equipmentName:'TPC65'},[tipper,excavator,odd],'Sasti OC').equipmentId,'2');
 assert.match(resolveTripEquipment({equipmentName:'TPC66'},[tipper,excavator,odd],'Sasti OC').error,/not assigned/,'a Vehicle in the master is not a loading machine');
});

test('scan review shows the category error on the door field',()=>{
 const options={assets:[{...excavator,kind:'equipment'},{...bolero,kind:'vehicle',lmv:true}],employees:[{id:'9'}],shifts:[{id:'1'}]};
 const vlb=scanFieldIssues({assetId:'2',location:'Sasti OC'},'vehicle',{},options);
 assert.match(vlb.assetId,/TPC65 is Equipment .* VLB card/);
 assert.match(scanFieldIssues({assetId:'3',location:'Sasti OC'},'vehicle',{},options).assetId,/LMV-07 is LMV .* VLB/);
 assert.equal(scanFieldIssues({assetId:'3',location:'Sasti OC'},'vehicle',{},options,true).assetId,undefined,'an LMV fits the LMV scan');
 assert.equal(scanFieldIssues({assetId:'2',location:'Sasti OC'},'equipment',{},options).assetId,undefined);
});

test('the save path and the options carry the rule',()=>{
 const route=fs.readFileSync(new URL('../server/routes/log-book.mjs',import.meta.url),'utf8');
 assert.match(route,/const categoryIssue=bookCategoryIssue\(/);
 assert.match(route,/kind:assetBookKind\(r\),category:text\(r\.category\|\|r\.equipmentCategory\)/);
 assert.doesNotMatch(route,/Select an asset from the correct log book category/);
});

test('old cards: machine of another category and trip machines that are not Equipment are listed',()=>{
 const assets=new Map([tipper,excavator,bolero].map(a=>[a.id,a]));
 assert.deepEqual(machineCategoryIssues({kind:'vehicle',assetId:'1',trips:[{equipmentId:'2'}]},assets),[]);
 const wrong=machineCategoryIssues({kind:'vehicle',assetId:'3',door:'LMV-07',trips:[{equipmentId:'1',equipmentName:'T11'},{equipmentId:'1'},{equipmentId:'2'}]},assets);
 assert.deepEqual(wrong.map(one=>[one.where,one.label,one.category]),[['machine','LMV-07','LMV'],['trip','T11','Vehicle']],'one line per machine, a repeated trip machine once');
 assert.deepEqual(machineCategoryIssues({kind:'equipment',assetId:'1',trips:[{equipmentId:'1'}]},assets).map(one=>one.where),['machine'],'ELB trips are not loading rows');
 assert.deepEqual(machineCategoryIssues({kind:'lmv',assetId:'3'},assets),[]);
 assert.deepEqual(machineCategoryIssues({kind:'vehicle',assetId:'99'},assets),[],'a machine gone from the master is not judged here');
});

test('the screen adds the days up and opens date by shift',()=>{
 const card=(id,date,shift,where)=>({id,date,shift,siteKey:'sasti',site:'Sasti OC',issues:[{where}]});
 let held=addMachineAnswer(emptyMachineRecheck(),{from:'2026-11-23',cards:10,listed:[card('a','2026-11-23','S1','machine')],sites:[{key:'sasti',site:'Sasti OC',cards:10,listed:1,machine:1,trip:0}]});
 held=addMachineAnswer(held,{from:'2026-11-24',cards:5,listed:[card('b','2026-11-24','S1','trip'),card('c','2026-11-24','S1','machine')],sites:[{key:'sasti',site:'Sasti OC',cards:5,listed:2,machine:1,trip:1}]});
 held=addMachineAnswer(held,{from:'2026-11-23',cards:10,listed:[],sites:[{key:'sasti',site:'Sasti OC',cards:10,listed:0,machine:0,trip:0}]});
 const {rows,total}=machineSiteRows(held);
 assert.deepEqual([rows[0].cards,rows[0].listed,total.machine,total.trip],[15,2,1,1],'a date asked again replaces its answer');
 const slots=machineSlotRows(held.listed);assert.deepEqual(slots.map(s=>[s.date,s.shift,s.count,s.machine,s.trip]),[['2026-11-24','S1',2,1,1]]);
 assert.equal(cardsOfSlot(held.listed,slots[0]).length,2);
});

test('the page sits under Caliber Punch Re-check for the same people, read only',()=>{
 const main=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/'Caliber ID Re-check','Caliber Punch Re-check','Machine Category Re-check','Equipment master'/);
 const access=fs.readFileSync(new URL('../shared/mis-application-access.mjs',import.meta.url),'utf8');
 assert.match(access,/route==='\/api\/caliber-recheck\/machines'\)return read/);
 assert.match(access,/if\(page==='Machine Category Re-check'\)return misPageAllowed\(session,'Caliber ID Re-check',view\)/);
 assert.equal(typeof misPageAllowed,'function');
 const page=fs.readFileSync(new URL('../src/machine-category-recheck.jsx',import.meta.url),'utf8');
 for(const step of ['Step 1 · ','Step 2 · ','Step 3 · '])assert.ok(page.includes(step));
 assert.match(page,/level>=2&&/);assert.match(page,/level>=3&&/);assert.match(page,/<DateShiftGrid /);
});
