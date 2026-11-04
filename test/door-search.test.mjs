import test from 'node:test';import assert from 'node:assert/strict';
import {searchSiteDoors,doorLabel} from '../src/door-search.mjs';
const rows=[{id:'s12',door:'S12',kind:'vehicle',site:'Dhoptala OC (2nd)'},{id:'s2',door:'S2',kind:'vehicle',site:'Dhoptala OB'},{id:'v12',door:'V12',kind:'vehicle',site:'Dhoptala OC'},{id:'other',door:'S19',kind:'vehicle',site:'Sasti OC'},{id:'no-site',door:'S20',kind:'vehicle',site:''},{id:'eq',door:'S30',kind:'equipment',site:'Dhoptala OC'}];
test('door prefix search is site-specific, case-insensitive and naturally sorted',()=>{
 assert.deepEqual(searchSiteDoors(rows,'vehicle','Dhoptala OC','s').map(r=>r.id),['s2','s12']);
 assert.deepEqual(searchSiteDoors(rows,'vehicle','Dhoptala OC','S1').map(r=>r.id),['s12']);
 assert.deepEqual(searchSiteDoors(rows,'vehicle','Dhoptala OC','V').map(r=>r.id),['v12']);
 assert.deepEqual(searchSiteDoors(rows,'equipment','Dhoptala OC','S').map(r=>r.id),['eq']);
 assert.deepEqual(searchSiteDoors(rows,'vehicle','','S'),[]);assert.deepEqual(searchSiteDoors(rows,'vehicle','Sasti OC','S').map(r=>r.id),['other']);
 assert.deepEqual(searchSiteDoors(rows,'vehicle','Dhoptala OC','12'),[]);
});
test('door labels avoid repeating identical equipment names',()=>{assert.equal(doorLabel({door:'S12-MH123',name:'S12-MH123'}),'S12-MH123');});

test('full-word and multi-letter door searches use the selected vehicle/equipment context',()=>{
 const assets=[{id:'truck',kind:'vehicle',site:'Jayant OC',door:'H12'},{id:'hydra',kind:'equipment',site:'Jayant OC',door:'H12'},{id:'pc',kind:'equipment',site:'Jayant OC',door:'VPC19'}];
 assert.deepEqual(searchSiteDoors(assets,'vehicle','Jayant OC','Haulpak').map(r=>r.id),['truck']);
 assert.deepEqual(searchSiteDoors(assets,'equipment','Jayant OC','Hydra').map(r=>r.id),['hydra']);
 for(const input of ['V','VPC','v p c','Volvo'])assert.deepEqual(searchSiteDoors(assets,'equipment','Jayant OC',input).map(r=>r.id),['pc']);
});
