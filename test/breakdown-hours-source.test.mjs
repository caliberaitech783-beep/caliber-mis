import test from 'node:test';import assert from 'node:assert/strict';
import {manualBreakdownHours,applyBreakdownHours} from '../breakdown-hours-source.mjs';
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
