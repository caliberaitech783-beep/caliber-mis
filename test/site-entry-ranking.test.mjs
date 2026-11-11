import test from 'node:test';
import assert from 'node:assert/strict';
import {sitesLowToHigh} from '../shared/site-entry-ranking.mjs';

const rows=[{site:'Dhoptala OC (2nd)',vehicle:539,equipment:135},{site:'Dudhichua East OC',vehicle:155,equipment:0},{site:'Dudhichua OC',vehicle:136,equipment:37},{site:'Lalpeth OC',vehicle:0,equipment:0},{site:'Majri OC',vehicle:1405,equipment:255},{site:'Sasti OC',vehicle:1006,equipment:323}];

test('site comparison lists the lowest entry site first and the highest last',()=>{
 assert.deepEqual(sitesLowToHigh(rows).map(r=>r.site),['Lalpeth OC','Dudhichua East OC','Dudhichua OC','Dhoptala OC (2nd)','Sasti OC','Majri OC']);
 assert.equal(rows[0].site,'Dhoptala OC (2nd)','the server list is left untouched');
});

test('only the logbook kinds in view are counted, and equal totals go by site name',()=>{
 assert.deepEqual(sitesLowToHigh(rows,['equipment']).map(r=>r.site),['Dudhichua East OC','Lalpeth OC','Dudhichua OC','Dhoptala OC (2nd)','Majri OC','Sasti OC']);
 assert.deepEqual(sitesLowToHigh(undefined),[]);
});
