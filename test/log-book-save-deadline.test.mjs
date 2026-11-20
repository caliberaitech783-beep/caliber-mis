import test from 'node:test';
import assert from 'node:assert/strict';
import {readSaveBreakdownRequests} from '../shared/log-book-save-deadline.mjs';
import {applyBreakdownHours,prefetchBreakdownRows,lockedReadHours} from '../shared/breakdown-hours-source.mjs';

test('responsive Pulse data and failures pass through the save deadline',async()=>{
 const rows=[{id:1}];
 assert.equal(await readSaveBreakdownRequests(()=>rows),rows);
 await assert.rejects(readSaveBreakdownRequests(()=>{throw Error('offline')}),/offline/);
});

test('stalled Pulse stops blocking saving and uses explicit fallback without treating unknown as zero',async()=>{
 let rejectLate;
 const remote=new Promise((_,reject)=>{rejectLate=reject});
 let failure;
 try{await readSaveBreakdownRequests(()=>remote,{timeoutMs:20});}catch(error){failure=error;}
 assert.match(failure?.message,/did not respond/);
 for(const manual of ['1.5','']){
  const saved=await applyBreakdownHours({shiftHours:8,manualBreakdownHours:manual},{readHours:()=>{throw failure}});
  assert.equal(saved.breakdownHours,manual?1.5:null);
  assert.equal(saved.breakdownHoursSource,manual?'manual':null);
  assert.match(saved.hoursWarning,/did not respond/);
 }
 rejectLate(Error('late network failure'));
 await new Promise(resolve=>setImmediate(resolve));
});

test('the production save prefetch returns a timeout and never retries Pulse inside the transaction',async()=>{
 const started=Date.now();let calls=0;
 const prefetched=await prefetchBreakdownRows(()=>{calls++;return new Promise(()=>{})},'operator');
 assert.match(prefetched.error?.message,/did not respond/);
 assert.ok(Date.now()-started<10000,'the save must not wait for the 45-second network timeout');
 const result=await applyBreakdownHours({shiftHours:8,manualBreakdownHours:2},{readHours:lockedReadHours(()=>{throw Error('must not fetch inside transaction')},prefetched)});
 assert.equal(calls,1);assert.equal(result.breakdownHours,2);
});
