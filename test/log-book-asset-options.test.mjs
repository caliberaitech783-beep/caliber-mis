import test from 'node:test';import assert from 'node:assert/strict';
import {logBookAssets,missingAssetMessage} from '../src/log-book-asset-options.mjs';
test('manual doors match site aliases, accept unassigned assets, and exclude other sites or categories',()=>{
 const assets=[{id:'1',kind:'vehicle',site:'Dhoptala OC (2nd)'},{id:'2',kind:'vehicle',site:'Sasti OC'},{id:'3',kind:'equipment',site:'Dhoptala OB'},{id:'4',kind:'vehicle',site:''}];
 assert.deepEqual(logBookAssets({assets},'vehicle','Dhoptala OC').map(r=>r.id),['1','4']);
 assert.deepEqual(logBookAssets({assets},'equipment','Dhoptala OC').map(r=>r.id),['3']);
});
test('empty master, wrong category and missing location have different actionable messages',()=>{
 assert.match(missingAssetMessage({assets:[]},'vehicle','Dhoptala OC'),/Master is empty/);
 assert.match(missingAssetMessage({assets:[{kind:'equipment'}]},'vehicle','Dhoptala OC'),/category/);
 assert.match(missingAssetMessage({assets:[{kind:'vehicle',site:'Sasti OC'}]},'vehicle','Dhoptala OC'),/Current Location/);
 assert.equal(missingAssetMessage({assets:[{kind:'vehicle',site:'Dhoptala OB'}]},'vehicle','Dhoptala OC'),'');
});
