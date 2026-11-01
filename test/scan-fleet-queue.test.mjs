import test from 'node:test';
import assert from 'node:assert/strict';
import {createScanFleetQueue} from '../scan-fleet-queue.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('fleet work is bounded to two requests and coalesces queued and active keys',async()=>{
 const queue=createScanFleetQueue(),jobs=Array.from({length:4},deferred),started=[];let active=0,peak=0;
 const work=n=>async()=>{started.push(n);peak=Math.max(peak,++active);await jobs[n].promise;active--;};
 for(let n=0;n<4;n++)assert.equal(queue.queue('card-'+n,work(n)),true);
 assert.equal(queue.queue('card-0',()=>assert.fail('active duplicate')),false);
 assert.equal(queue.queue('card-3',()=>assert.fail('waiting duplicate')),false);
 await tick();assert.deepEqual(started,[0,1]);
 jobs[0].resolve();await tick();assert.deepEqual(started,[0,1,2]);
 jobs[1].resolve();await tick();assert.deepEqual(started,[0,1,2,3]);
 jobs[2].resolve();jobs[3].resolve();await tick();assert.equal(peak,2);
 assert.equal(queue.queue('card-0',()=>started.push('recheck')),true);
 await tick();assert.equal(started.at(-1),'recheck');await queue.stop();
});

test('failed fleet work releases its key, reports once and continues even if reporting fails',async()=>{
 const errors=[],queue=createScanFleetQueue({concurrency:1,onError:async error=>{errors.push(error.message);throw Error('logger failed');}}),done=[];
 queue.queue('first',()=>{throw Error('Pulse offline');});queue.queue('next',()=>done.push('next'));
 await tick();assert.deepEqual(errors,['Pulse offline']);assert.deepEqual(done,['next']);
 assert.equal(queue.queue('first',()=>done.push('retry')),true);await tick();assert.deepEqual(done,['next','retry']);await queue.stop();
});

test('stop drops waiting work, prevents new work and waits for active work',async()=>{
 const queue=createScanFleetQueue({concurrency:1}),first=deferred(),started=[];
 queue.queue('first',async()=>{started.push('first');await first.promise;});
 queue.queue('waiting',()=>started.push('waiting'));await tick();
 let finished=false;const stopping=queue.stop().then(()=>{finished=true;});
 assert.equal(queue.queue('new',()=>started.push('new')),false);await tick();assert.equal(finished,false);
 first.resolve();await stopping;assert.deepEqual(started,['first']);assert.equal(finished,true);
});

test('stop before a scheduled callback begins does not start it',async()=>{
 const queue=createScanFleetQueue();queue.queue('first',()=>assert.fail('stopped callback'));
 await queue.stop();await queue.stop();
});

test('pending admission includes active work and frees capacity when jobs settle',async()=>{
 const queue=createScanFleetQueue({concurrency:2,maxPending:3}),jobs=Array.from({length:4},deferred),started=[];
 const add=n=>queue.queue('card-'+n,async()=>{started.push(n);await jobs[n].promise;});
 assert.equal(add(0),true);assert.equal(add(1),true);assert.equal(add(2),true);assert.equal(add(3),false);
 await tick();assert.deepEqual(started,[0,1]);assert.equal(add(3),false);
 jobs[0].resolve();await tick();assert.deepEqual(started,[0,1,2]);assert.equal(add(3),true);
 jobs[1].resolve();await tick();assert.deepEqual(started,[0,1,2,3]);
 jobs[2].resolve();jobs[3].resolve();await queue.stop();assert.equal(add(4),false);
});

test('queue limits reject unbounded or inconsistent configuration',()=>{
 for(const maxPending of [0,1,101,Infinity,2.5])assert.throws(()=>createScanFleetQueue({maxPending}),/pending limit/);
});
