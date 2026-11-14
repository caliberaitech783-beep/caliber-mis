import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMasterCache,MASTER_SQL} from '../server/services/scan-master-cache.mjs';

function fakeClient(state){
  return {calls:[],async query(sql,args){this.calls.push(sql.includes('data_revisions')?'revision':'masters');
    if(sql.includes('data_revisions')){if(state.noRevision)throw Error('relation "data_revisions" does not exist');return {rows:[{revision:String(state.revision)}]};}
    assert.equal(sql,MASTER_SQL);return {rows:state.rows.map(r=>({...r}))};}};
}
const rows=[{id:1,master_name:'Employee master',record_data:{name:'A'}},{id:2,master_name:'Equipment master',record_data:{door:'V1'}}];

test('the master lists are read once per master-data revision and reread when masters change',async()=>{
  const state={revision:7,rows},client=fakeClient(state),read=createMasterCache();
  assert.deepEqual((await read(client,['Employee master','Equipment master'])).rows,rows);
  assert.deepEqual((await read(client,['Equipment master','Employee master'])).rows,rows);
  assert.deepEqual(client.calls,['revision','masters','revision']);
  state.revision=8;state.rows=[...rows,{id:3,master_name:'Employee master',record_data:{name:'B'}}];
  assert.equal((await read(client,['Employee master','Equipment master'])).rows.length,3);
  assert.deepEqual(read.stats(),{hits:1,loads:2,cached:1});
});

test('callers that replace a row\'s record_data do not change the shared copy',async()=>{
  const client=fakeClient({revision:1,rows}),read=createMasterCache();
  const first=(await read(client,['Equipment master'])).rows;first[1].record_data={...first[1].record_data,cardAliases:['X']};
  assert.equal((await read(client,['Equipment master'])).rows[1].record_data.cardAliases,undefined);
});

test('readers that arrive together share one load',async()=>{
  let release;const gate=new Promise(r=>release=r);let loads=0;
  const client={async query(sql){if(sql.includes('data_revisions'))return {rows:[{revision:'3'}]};loads++;await gate;return {rows};}};
  const read=createMasterCache();const all=Promise.all([read(client,['Employee master']),read(client,['Employee master']),read(client,['Employee master'])]);
  await new Promise(r=>setImmediate(r));release();await all;assert.equal(loads,1);
});

test('without a revision table the lists are read directly and never kept',async()=>{
  const state={noRevision:true,rows},client=fakeClient(state),read=createMasterCache();
  await read(client,['Employee master']);await read(client,['Employee master']);
  assert.deepEqual(client.calls,['revision','masters','revision','masters']);
});

test('a failed load is not kept',async()=>{
  let fail=true;const client={async query(sql){if(sql.includes('data_revisions'))return {rows:[{revision:'1'}]};if(fail){fail=false;throw Error('connection lost');}return {rows};}};
  const read=createMasterCache();await assert.rejects(read(client,['Employee master']),/connection lost/);
  assert.equal((await read(client,['Employee master'])).rows.length,2);
});

test('card reading and the scan-entry read use the shared master copy',()=>{
  const source=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
  assert.match(source,/const masters=scanMastersForBook\(\(await readScanMasters\(pool,MASTER_NAMES\)\)\.rows,batch\);/);
  assert.match(source,/matchingMasters\?\?=scanMastersForBook\(\(await readScanMasters\(db,MASTER_NAMES\)\)\.rows,batch\);/);
});

test('automatic saving takes the master lists from the shared copy, read before its transaction starts',async()=>{
 const {readFile}=await import('node:fs/promises');
 const route=await readFile(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 const reader=route.slice(route.indexOf('const readScanIssueMasters='),route.indexOf('const scanIssueOptions='));
 assert.match(reader,/readScanMasters\(pool,MASTER_NAMES\)/);
 const options=route.slice(route.indexOf('const scanIssueOptions='),route.indexOf('const liveCards='));
 assert.doesNotMatch(options,/MASTER_SQL|readScanMasters/,'no master read while the save transaction is open');
 const save=route.slice(route.indexOf("app.post('/api/scan-cards/:id/auto-save'"));
 assert.match(save,/\[,prefetched,issueMasters,masters\]=await Promise\.all\(/);
 assert.ok(save.indexOf('readScanIssueMasters()')>0&&save.indexOf('readScanIssueMasters()')<save.indexOf('pool.connect()'),'masters are read before the connection is taken');
 assert.ok(save.indexOf('readSaveEquipment()')>0&&save.indexOf('readSaveEquipment()')<save.indexOf('pool.connect()'),'the equipment lists are read before the connection is taken');
});
