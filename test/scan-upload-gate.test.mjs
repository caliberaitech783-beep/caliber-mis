import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {createCanvas} from '@napi-rs/canvas';
import {createKeyedSerializer,uploadDuplicateLockKey} from '../server/services/scan-upload-gate.mjs';
import {createFingerprintPool,fingerprintWorkerCount} from '../server/services/scan-fingerprint-pool.mjs';
import {fingerprintScanImage} from '../server/services/scan-fingerprint.mjs';
import {fingerprintForUpload} from '../server/services/scan-duplicates.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('uploads to one entry run one at a time; other entries are not held up',async()=>{
 const gate=createKeyedSerializer(),order=[];let releaseFirst;
 const first=gate.run('entry-a',async()=>{order.push('a1 start');await new Promise(resolve=>{releaseFirst=resolve;});order.push('a1 end');});
 const second=gate.run('entry-a',async()=>{order.push('a2');});
 const other=gate.run('entry-b',async()=>{order.push('b1');});
 await other;await tick();
 assert.deepEqual(order,['a1 start','b1'],'entry b ran while entry a waited; the second upload of entry a did not start');
 releaseFirst();await Promise.all([first,second]);
 assert.deepEqual(order,['a1 start','b1','a1 end','a2']);
 assert.equal(gate.size(),0,'no key is left behind');
});

test('a failed upload does not block the next one for the same entry',async()=>{
 const gate=createKeyedSerializer();
 await assert.rejects(gate.run('entry',async()=>{throw Error('refused');}),/refused/);
 assert.equal(await gate.run('entry',async()=>'next'),'next');
});

test('the site/date/shift lock is taken only for the visual duplicate check',()=>{
 const batch={kind:'vehicle',expected_context:{bookDate:'2026-11-15',location:' Jayant OB ',cardShift:'I'}};
 assert.equal(uploadDuplicateLockKey(batch,{enabled:false}),null);
 assert.equal(uploadDuplicateLockKey(batch,{enabled:true}),'scan-duplicates:vehicle|2026-11-15|jayant ob|I');
 assert.equal(uploadDuplicateLockKey({kind:'vehicle'},{enabled:true}),null);
});

function fakeWorker(handler){
 const worker=new EventEmitter();
 worker.unref=()=>{};worker.terminate=async()=>{worker.emit('exit',0);};
 worker.postMessage=message=>setImmediate(()=>handler(worker,message));
 return worker;
}

test('fingerprints run in workers, at most the pool size at once',async()=>{
 let started=0,active=0,maxActive=0;const replies=[];
 const pool=createFingerprintPool({size:2,createWorker:()=>{started++;return fakeWorker((worker,{id,image})=>{active++;maxActive=Math.max(maxActive,active);replies.push(()=>{active--;worker.emit('message',{id,result:{size:image.length}});});});},fallback:async()=>{throw Error('fallback must not run');}});
 const jobs=[1,2,3,4,5].map(n=>pool.fingerprint(Buffer.alloc(n)));
 while(replies.length<2)await tick();
 assert.equal(started,2);assert.equal(pool.status().waiting,3);
 while(replies.length){replies.shift()();await tick();await tick();}
 assert.deepEqual((await Promise.all(jobs)).map(r=>r.size),[1,2,3,4,5]);
 assert.equal(maxActive,2);
 await pool.close();
});

test('a worker that cannot start or crashes falls back to the main thread',async()=>{
 const noWorkers=createFingerprintPool({size:1,createWorker:()=>{throw Error('no threads');},fallback:async image=>({inThread:image.length})});
 assert.deepEqual(await noWorkers.fingerprint(Buffer.alloc(3)),{inThread:3});
 const crashing=createFingerprintPool({size:1,createWorker:()=>fakeWorker(worker=>worker.emit('error',Error('crashed'))),fallback:async image=>({inThread:image.length})});
 assert.deepEqual(await crashing.fingerprint(Buffer.alloc(4)),{inThread:4});
 await crashing.close();
 assert.equal(createFingerprintPool({size:0,fallback:async()=>'thread'}).status().inThread,true);
});

test('worker count: one or two, or the configured number',()=>{
 assert.equal(fingerprintWorkerCount({},1),1);
 assert.equal(fingerprintWorkerCount({},2),1);
 assert.equal(fingerprintWorkerCount({},16),2);
 assert.equal(fingerprintWorkerCount({MIS_SCAN_FINGERPRINT_WORKERS:'4'},16),4);
 assert.equal(fingerprintWorkerCount({MIS_SCAN_FINGERPRINT_WORKERS:'0'},16),0);
});

test('a real worker thread gives the same fingerprint as the main thread',async()=>{
 const canvas=createCanvas(900,1200),ctx=canvas.getContext('2d');
 ctx.fillStyle='#f6f3ea';ctx.fillRect(0,0,900,1200);ctx.fillStyle='#111';ctx.font='26px Arial';
 for(let y=60;y<1150;y+=55)ctx.fillText('V 252  07:05  07:40  L01  2',40,y);
 const jpeg=await canvas.encode('jpeg',85);
 const pool=createFingerprintPool({size:1});
 try{assert.deepEqual(await pool.fingerprint(jpeg),await fingerprintScanImage(jpeg));}
 finally{await pool.close();}
 assert.equal(await fingerprintForUpload(Buffer.from('not an image'),{fingerprint:async()=>{throw Error('bad image');}}),null,'a failed fingerprint never fails the upload');
});

test('the upload handler saves the picture and fingerprint before taking a connection, inside the entry queue',async()=>{
 const source=await fs.readFile(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 const start=source.indexOf("app.post('/api/scan-batches/:id/cards'"),end=source.indexOf("app.get('/api/scan-cards/:id/image'");
 const handler=source.slice(start,end);
 const saved=handler.indexOf('alreadySaved=(await pool.query'),put=handler.indexOf('imageStorage.put('),run=handler.indexOf('entryUploads.run(batch.id'),connect=handler.indexOf('pool.connect()');
 assert.ok(saved>0&&put>saved&&run>put&&connect>run,'saved-card check, Blob write, then entry queue, then the pool connection');
 assert.equal(handler.split('imageStorage.put(').length,2,'the picture is written once, outside the transaction');
 assert.match(handler,/if\(siteLock\)await c\.query/);
 assert.doesNotMatch(handler,/'scan-duplicates:'\+/,'the site lock key comes from uploadDuplicateLockKey');
});
