import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scanRefreshRequestOptions,scanProgressRetryDelay,isTransientScanRefreshError} from '../shared/scan-progress-poll.mjs';

test('each progress and detail request has an independent timeout budget',()=>{
 const original=AbortSignal.timeout, budgets=[];
 AbortSignal.timeout=ms=>{budgets.push(ms);return new AbortController().signal;};
 try{
  const progress=scanRefreshRequestOptions();
  const partial=scanRefreshRequestOptions(true);
  const fallback=scanRefreshRequestOptions(true);
  assert.deepEqual(budgets,[20000,90000,90000]);
  assert.notEqual(progress.signal,partial.signal);
  assert.notEqual(partial.signal,fallback.signal);
 }finally{AbortSignal.timeout=original;}
});

test('refresh retries back off to a minute and reset after recovery',()=>{
 assert.deepEqual([0,1,2,3,4,5,100].map(scanProgressRetryDelay),[4000,8000,16000,32000,60000,60000,60000]);
 assert.equal(scanProgressRetryDelay(0),4000);
});

test('temporary refresh failures do not become permission or context failures',()=>{
 for(const error of [new DOMException('signal timed out','TimeoutError'),new TypeError('Failed to fetch'),Object.assign(Error('Restarting'),{status:503}),Object.assign(Error('Too many requests'),{status:429})])assert.equal(isTransientScanRefreshError(error),true);
 for(const error of [Object.assign(Error('Sign in again'),{status:401}),Object.assign(Error('Access denied'),{status:403}),Error('This scan entry belongs to another site, date or shift.'),Object.assign(Error('Deleted entry'),{status:404})])assert.equal(isTransientScanRefreshError(error),false);
});

test('the polling flow separates notices from save blockers and yields to saves',()=>{
 const page=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 assert.match(page,/savingRef\.current\|\|autoSavingRef\.current\|\|!shouldReadScanProgress/);
 assert.match(page,/if\(isTransientScanRefreshError\(e\)\)\{if\(message!==null\)setRefreshNotice\(message\);\}else setConnectionError\(message\)/);
 assert.match(page,/setConnectionError\(''\);setRefreshNotice\(''\);setBatch/);
 const saveEffect=page.slice(page.indexOf('  if(!options||dirty||busy||fleetBusy||connectionError'),page.indexOf(' const choices='));
 assert.ok(saveEffect.length);
 assert.doesNotMatch(saveEffect.split(' },[reviewPage')[0],/refreshNotice/);
 assert.match(page,/if\(activeRef\.current!==pollId\)return;progressFailures\+\+/);
});
