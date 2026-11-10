import test from 'node:test';
import assert from 'node:assert/strict';
import {sameMasterData} from '../server/routes/pulse-master-sync.mjs';

test('records that differ only in key order are the same, so the minute sync sends no statement for them',()=>{
  assert.equal(sameMasterData({door:'V1',site:'Jayant OC',meta:{b:2,a:1},tags:['x','y']},{site:'Jayant OC',tags:['x','y'],meta:{a:1,b:2},door:'V1'}),true);
});

test('any real change is still written',()=>{
  assert.equal(sameMasterData({door:'V1',site:'Jayant OC'},{door:'V1',site:'Sasti OC'}),false);
  assert.equal(sameMasterData({door:'V1'},{door:'V1',status:'Inactive'}),false);
  assert.equal(sameMasterData({tags:['x','y']},{tags:['y','x']}),false);
  assert.equal(sameMasterData({hmr:100},{hmr:'100'}),false);
});
