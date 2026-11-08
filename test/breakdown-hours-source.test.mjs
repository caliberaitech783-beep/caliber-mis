import test from 'node:test';import assert from 'node:assert/strict';
import {manualBreakdownHours,applyBreakdownHours,prefetchBreakdownRows,lockedReadHours} from '../shared/breakdown-hours-source.mjs';
const data=()=>({bookDate:'2026-10-28',location:'Sasti OC',assetId:1,shiftId:2,shiftHours:8,totalWorkingHmr:4,availabilityHours:4,idleHours:4,manualBreakdownHours:'2.5'});
test('Pulse is always tried first and its actual zero beats a manual fallback',async()=>{
 let calls=0;const result=await applyBreakdownHours(data(),{readHours:async input=>{calls++;assert.equal(input.runningHours,4);return {breakdownHours:0,source:'Pulse'}}});
 assert.equal(calls,1);assert.equal(result.breakdownHours,0);assert.equal(result.breakdownHoursSource,'pulse');assert.equal(result.manualBreakdownHours,null);assert.equal(result.hoursWarning,undefined);
});
test('Pulse failure retains manual value, actor and selected context without changing running/idle formulas',async()=>{
 const result=await applyBreakdownHours(data(),{readHours:async()=>{throw Error('Pulse offline')},actor:'operator',now:()=> 'now'});
 assert.equal(result.breakdownHours,2.5);assert.equal(result.breakdownHoursSource,'manual');assert.equal(result.hoursSource.enteredBy,'operator');assert.equal(result.hoursSource.assetId,1);assert.equal(result.hoursSource.enteredAt,'now');assert.equal(result.idleHours,4);
 assert.equal((await applyBreakdownHours({...data(),manualBreakdownHours:0})).breakdownHours,0);
});
test('missing or unusable Pulse values allow fallback and absent manual values remain unknown',async()=>{
 for(const value of [null,undefined,'',NaN,-1,9]){
  const result=await applyBreakdownHours(data(),{readHours:async()=>({breakdownHours:value})});assert.equal(result.breakdownHours,2.5);assert.equal(result.breakdownHoursSource,'manual');
 }
 const result=await applyBreakdownHours({...data(),manualBreakdownHours:''});assert.equal(result.breakdownHours,null);assert.equal(result.breakdownHoursSource,null);
});
test('manual hours are non-negative and cannot exceed the shift, with zero kept valid',()=>{
 for(const value of [-1,9,Infinity,'NaN',true,{},' '])assert.throws(()=>manualBreakdownHours(value,8));
 assert.equal(manualBreakdownHours('0',8),0);assert.equal(manualBreakdownHours('8',8),8);assert.equal(manualBreakdownHours('',8),null);
});
test('the Pulse feed is read once before the lock and reused inside it',async()=>{
 let reads=0;const prefetched=await prefetchBreakdownRows(async actor=>{reads++;assert.equal(actor,'operator');return [{id:1}]},'operator');
 const seen=[];const readHours=lockedReadHours(async input=>{seen.push(input);return {breakdownHours:1}},prefetched);
 const result=await applyBreakdownHours(data(),{readHours,actor:'operator'});
 assert.equal(reads,1);assert.deepEqual(seen[0].breakdownRows,[{id:1}]);assert.equal(seen[0].runningHours,4);assert.equal(result.breakdownHoursSource,'pulse');
});
test('a failed prefetch repeats its failure inside the lock, so the manual fallback is unchanged',async()=>{
 const prefetched=await prefetchBreakdownRows(async()=>{throw Error('Pulse offline')});
 let called=false;const inner=async()=>{called=true;return {breakdownHours:0}},readHours=lockedReadHours(inner,prefetched);
 const result=await applyBreakdownHours(data(),{readHours,actor:'operator'});
 assert.equal(called,false);assert.equal(result.breakdownHoursSource,'manual');assert.equal(result.hoursWarning,'Pulse offline');
 assert.equal(await prefetchBreakdownRows(null),null,'no feed reader means no prefetch');
 assert.equal(lockedReadHours(inner,null),inner,'without a prefetch the reader is used as before');
});
