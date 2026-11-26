import test from 'node:test';
import assert from 'node:assert/strict';
import {saveManualLogBook} from '../src/manual-log-book-save.mjs';

const saved={id:'42',book_no:'VLB_M/TEST/001',data:{totalTrips:1}};
const quick={timeoutMs:100,recoverAfterMs:5,recoverEveryMs:5};

test('a responsive save returns directly without a confirmation lookup',async()=>{
 let lookups=0;
 assert.equal(await saveManualLogBook(async()=>saved,{...quick,recover:async()=>{lookups++;}}),saved);
 assert.equal(lookups,0);
});

test('a stalled response is recovered by reference without repeating the write',async()=>{
 let writes=0,signal,lookups=0;
 const result=await saveManualLogBook(s=>{writes++;signal=s;return new Promise(()=>{});},{...quick,recover:async()=>++lookups<2?null:saved});
 assert.equal(result,saved);assert.equal(writes,1);assert.equal(lookups,2);assert.equal(signal.aborted,true);
});

test('a lost network response can still confirm the committed card',async()=>{
 assert.equal(await saveManualLogBook(async()=>{throw new TypeError('Failed to fetch');},{...quick,recover:async()=>saved}),saved);
});

test('an empty response cannot masquerade as a successful save',async()=>{
 assert.equal(await saveManualLogBook(async()=>({}),{...quick,recover:async()=>saved}),saved);
 await assert.rejects(saveManualLogBook(async()=>({}),{timeoutMs:10}),/Invalid save acknowledgement/);
});

test('a stalled confirmation is bounded and never presented as saved',async()=>{
 let signal;
 await assert.rejects(saveManualLogBook(s=>{signal=s;return new Promise(()=>{});},{...quick,timeoutMs:20,recover:()=>new Promise(()=>{})}),{code:'SAVE_UNCONFIRMED'});
 assert.equal(signal.aborted,true);
});

test('edits without recovery also stop waiting and preserve an uncertain outcome',async()=>{
 await assert.rejects(saveManualLogBook(()=>new Promise(()=>{}),{timeoutMs:10}),{code:'SAVE_UNCONFIRMED'});
});

test('validation and duplicate responses remain errors, never replaced by an old card',async()=>{
 const error=Object.assign(new Error('Duplicate card'),{details:{code:'duplicate_card'}});
 let lookups=0;
 await assert.rejects(saveManualLogBook(async()=>{throw error;},{...quick,recover:()=>{lookups++;return saved;}}),e=>e===error);
 assert.equal(lookups,0);
});

test('a late save failure after successful recovery is observed safely',async()=>{
 let reject;
 assert.equal(await saveManualLogBook(()=>new Promise((_,r)=>{reject=r;}),{...quick,recover:async()=>saved}),saved);
 reject(new Error('late failure'));
 await new Promise(resolve=>setImmediate(resolve));
});
