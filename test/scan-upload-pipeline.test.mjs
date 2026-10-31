import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfUploadSession,transferScanGroups} from '../src/scan-upload-pipeline.mjs';
import {scanValidationClient} from '../scan-validation-cache.mjs';
import {readFileSync} from 'node:fs';

test('the counted PDF is reused for rendering and retained documents are bounded and cleaned up',async()=>{
 const opened=[],destroyed=[],open=async file=>{opened.push(file);return {doc:{numPages:3},task:{destroy:async()=>destroyed.push(file)}};};
 const session=createPdfUploadSession(open);
 assert.equal(await session.count('one'),3);assert.equal(await session.count('two'),3);
 assert.deepEqual(destroyed,['two']);
 const entry=await session.take('one');assert.deepEqual(opened,['one','two']);await entry.task.destroy();
 const second=await session.take('two');assert.deepEqual(opened,['one','two','two']);await second.task.destroy();
 await session.dispose();assert.deepEqual(destroyed,['two','one','two']);
 const unused=createPdfUploadSession(open);await unused.count('unused');await unused.dispose();
 assert.equal(destroyed.at(-1),'unused');await assert.rejects(unused.take('unused'),/closed/);
});

test('one next card prepares during upload while requests remain ordered', {timeout:2000},async()=>{
 const prepared=[],sent=[];let active=0,releaseNext;
 const nextReady=new Promise(resolve=>releaseNext=resolve);
 async function* groups(){for(const n of [1,2,3])yield [n];}
 await transferScanGroups(groups(),{prepare:async group=>{prepared.push(group[0]);if(group[0]===2)releaseNext();return new Blob([String(group[0])]);},send:async(group,body)=>{
  assert.equal(++active,1);if(group[0]===1){await nextReady;assert.deepEqual(prepared,[1,2]);}
  assert.equal(await body.text(),String(group[0]));sent.push(group[0]);active--;
 }});
 assert.deepEqual(prepared,[1,2,3]);assert.deepEqual(sent,[1,2,3]);
});

test('upload failure or abort cannot send later prepared cards',async()=>{
 for(const abort of [false,true]){
  const prepared=[],sent=[],controller=new AbortController();
  async function* groups(){for(const n of [1,2,3])yield [n];}
  await assert.rejects(transferScanGroups(groups(),{signal:controller.signal,prepare:async group=>{prepared.push(group[0]);return group[0];},send:async group=>{sent.push(group[0]);if(abort)controller.abort();else throw Error('offline');}}),abort?/Upload aborted/:/offline/);
  assert.deepEqual(sent,[1]);assert.ok(prepared.length<=2);
 }
});

test('a failed prefetched render retains the preceding acknowledged upload',async()=>{
 const sent=[];async function* groups(){yield [1];yield [2];}
 await assert.rejects(transferScanGroups(groups(),{prepare:async group=>{if(group[0]===2)throw Error('bad page');return group;},send:async group=>sent.push(group[0])}),/bad page/);
 assert.deepEqual(sent,[1]);
});

test('master validation reads share one database request but remain fresh across batch polls',async()=>{
 const calls=[],database={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{id:1}]};}};
 const client=scanValidationClient(database),sql='SELECT id,record_data FROM master_records WHERE master_name=ANY($1::text[])';
 await Promise.all(Array.from({length:100},()=>client.query(sql,[['Equipment master']])));
 assert.equal(calls.length,1);
 await client.query(sql,[['Shift Master']]);assert.equal(calls.length,2);
 await scanValidationClient(database).query(sql,[['Equipment master']]);assert.equal(calls.length,3);
 for(let i=0;i<2;i++){await client.query('SELECT id FROM mis_scan_cards WHERE id=$1',['a']);await client.query('UPDATE master_records SET record_data=$1',[{}]);await client.query('SELECT id FROM master_records FOR UPDATE');}
 assert.equal(calls.length,9);
});

test('overlapping background batch polls coalesce; an explicit refresh reads after the in-flight poll',async()=>{
 const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 const line=source.split('\n').find(line=>line.startsWith(' const load=async(id,fresh=true)'));
 assert.ok(line);
 let requests=0,release,rows=[];const gate=new Promise(resolve=>release=resolve),noop=()=>{};
 const scope={vlbBatch:undefined,batchLoads:{current:new Map()},activeRef:{current:'batch'},api:async()=>{const revision=++requests;if(revision===1)await gate;return {batch:{id:'batch'},cards:[{id:'card',revision}]};},setConnectionError:noop,setBatch:noop,setContextGate:noop,setStorage:noop,setReader:noop,setCards:fn=>rows=fn(rows),setSelected:noop,chooseScanCard:noop,window:{location:{search:''}},dirtyRef:{current:false}};
 const load=new Function(...Object.keys(scope),line.trim()+';return load;')(...Object.values(scope));
 const first=load('batch',false),same=load('batch',false),fresh=load('batch');
 assert.equal(requests,1);release();await Promise.all([first,same,fresh]);assert.equal(requests,2);assert.equal(rows[0].revision,2);
});
