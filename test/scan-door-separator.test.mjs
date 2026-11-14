import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCardMachine,separatorCorrectedKey} from '../shared/scan-machine-rules.mjs';
import {linkedScanEquipment} from '../shared/scan-fleet-door.mjs';
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
