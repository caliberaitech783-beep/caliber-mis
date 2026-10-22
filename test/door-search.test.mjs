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
