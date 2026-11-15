import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCardMachine,separatorCorrectedKey} from '../shared/scan-machine-rules.mjs';
import {linkedScanEquipment,canonicalLinkedScanDoor,separatorDoorFields} from '../shared/scan-fleet-door.mjs';
import {scanFleetAssignment} from '../shared/scan-fleet-assignment.mjs';
import {extractCard,matchScanDraft} from '../server/rules/scan-extraction.mjs';
import {doorSuggestion} from '../shared/scan-correction-suggestions.mjs';
const tipper=(id,door,site='Majri OB')=>({id,door,kind:'vehicle',currentLocation:site,equipmentType:'Tipper'});
const fleet=[tipper('334','V334 - 2330932'),tipper('134','V134'),tipper('133','V133'),tipper('704','V704-00226'),tipper('1','S01')];
test('a slash or dash read as 1 (V/334 -> V 1334) links the real door V334',()=>{
 for(const written of ['V 1334','V1334','v-1334']){
  const result=matchCardMachine(fleet,written,'Majri OB','vehicle');
  assert.equal(result.status,'separator',written);assert.equal(result.match.id,'334');
  assert.equal(linkedScanEquipment(fleet,written,'Majri OB','vehicle').id,'334');
 }
 assert.equal(matchCardMachine(fleet,'S101','Majri OB','vehicle').match.id,'1');
});
test('a real door with the leading 1 always wins over the separator correction',()=>{
 const withReal=[...fleet,tipper('1334','V1334')];
 const result=matchCardMachine(withReal,'V 1334','Majri OB','vehicle');
 assert.equal(result.status,'matched');assert.equal(result.match.id,'1334');
});
test('the correction stays inside the site and never guesses between two doors',()=>{
 assert.equal(matchCardMachine(fleet,'V 1334','Sasti OC','vehicle').match,null);
 const twice=[...fleet,tipper('334b','V-334')];
 assert.notEqual(matchCardMachine(twice,'V 1334','Majri OB','vehicle').status,'separator');
 assert.equal(separatorCorrectedKey('V15','vehicle'),'');
 assert.equal(separatorCorrectedKey('V 1334','vehicle'),'V334');
});
// 15 Nov 2026, Dudhichua East 5 Nov S3: card V/840 read as V1840 linked V-840, but the
// door box kept V1840, so the door list showed nothing and the Pulse site check
// reported "V1840 not registered" and blocked the save.
const dch=[tipper('840','V-840','Dudhichua East OB'),tipper('841','V-841','Dudhichua East OB')];
test('V/840 read as V1840 puts the real door V-840 in the box and keeps the writing',()=>{
 assert.equal(linkedScanEquipment(dch,'V1840','Dudhichua East OB','vehicle').id,'840');
 assert.equal(canonicalLinkedScanDoor(dch[0],'V1840','vehicle'),'V-840');
 assert.deepEqual(separatorDoorFields(dch[0],'V1840','vehicle'),{doorText:'V-840',doorTextWritten:'V1840'});
 // An exact read changes nothing beyond the master label, and keeps no written copy.
 assert.deepEqual(separatorDoorFields(dch[0],'V/840','vehicle'),{});
 assert.equal(canonicalLinkedScanDoor(dch[0],'V/840','vehicle'),'V-840');
 // A real door V1840 is never rewritten.
 assert.equal(canonicalLinkedScanDoor(tipper('1840','V1840','Dudhichua East OB'),'V1840','vehicle'),'V1840');
 assert.equal(doorSuggestion({doorText:'V-840',location:'Dudhichua East OB'},dch),null);
});
test('the Pulse site check reads V1840 as V-840 too, unless Pulse has a real V1840',()=>{
 const pulse=[{door:'V-840',currentLocation:'Dudhichua East OB'}];
 assert.equal(scanFleetAssignment(pulse,{doorText:'V-840',location:'Dudhichua East OB'}),null);
 assert.equal(scanFleetAssignment(pulse,{doorText:'V1840',location:'Dudhichua East OB'}),null);
 // V-840 at another mine still needs its transfer.
 assert.equal(scanFleetAssignment([{door:'V-840',currentLocation:'Majri OB'}],{doorText:'V1840',location:'Dudhichua East OB'}).pulseSite,'Majri OB');
 // A real V1840 wins: its own site decides.
 assert.equal(scanFleetAssignment([...pulse,{door:'V1840',currentLocation:'Majri OB'}],{doorText:'V1840',location:'Dudhichua East OB'}).pulseSite,'Majri OB');
 // Two V840 records never guess.
 assert.equal(scanFleetAssignment([...pulse,{door:'V/840',currentLocation:'Majri OB'}],{doorText:'V1840',location:'Dudhichua East OB'}).pulseSite,'Not registered');
});
test('the scan fills the real door at read time and when matched later',()=>{
 const masters=[{id:840,master_name:'Equipment master',record_data:{door:'V-840',category:'vehicle',currentLocation:'Dudhichua East OB'}}];
 const later=matchScanDraft({doorText:'V1840',location:'Dudhichua East OB'},{},'vehicle',masters);
 assert.equal(later.assetId,'840');assert.equal(later.doorText,'V-840');assert.equal(later.doorTextWritten,'V1840');
 const read=extractCard('Site: DCH EAST OB\nDoor No V1840\nDATE 05/11/26','vehicle',masters,{handwrittenFields:{door:'V1840',location:'Dudhichua East OB'}});
 assert.equal(read.raw.door,'V1840');
 assert.equal(read.draft.assetId,'840');assert.equal(read.draft.doorText,'V-840');assert.equal(read.draft.doorTextWritten,'V1840');
});
