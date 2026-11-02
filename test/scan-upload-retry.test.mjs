import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadWithRetry,isTransientUploadError,UPLOAD_RETRY_DELAYS_MS} from '../src/scan-upload-retry.mjs';

test('only restart-shaped failures are retried',()=>{
 assert.ok(isTransientUploadError(Object.assign(new TypeError('Failed to fetch'))));
 assert.ok(isTransientUploadError(new Error('The local scanner service is starting or reconnecting. This page will retry automatically.')));
 assert.ok(isTransientUploadError(new Error('The local scanner service is unavailable.')));
 assert.ok(isTransientUploadError(Object.assign(new Error('Bad gateway'),{status:502})));
 assert.equal(isTransientUploadError(new Error('Enter the card date, site and marked shift in a new batch before uploading.')),false);
 assert.equal(isTransientUploadError(Object.assign(new Error('x'),{name:'AbortError'})),false);
 assert.equal(isTransientUploadError(null),false);
});

test('a card upload waits out a server restart and then succeeds; a real rejection is not retried',async()=>{
 const waits=[],retries=[];
 let calls=0;
 const result=await uploadWithRetry(async()=>{calls++;if(calls<3)throw new TypeError('Failed to fetch');return {id:'card'};},{sleep:async ms=>{waits.push(ms)},onRetry:info=>retries.push(info.attempt)});
 assert.deepEqual(result,{id:'card'});
 assert.equal(calls,3);
 assert.deepEqual(waits,UPLOAD_RETRY_DELAYS_MS.slice(0,2));
 assert.deepEqual(retries,[1,2]);
 let fatal=0;
 await assert.rejects(uploadWithRetry(async()=>{fatal++;throw new Error('Invalid scan metadata.');},{sleep:async()=>{}}),/Invalid scan metadata/);
 assert.equal(fatal,1);
});

test('retries stop when the delays are exhausted or the upload is aborted',async()=>{
 let calls=0;
 await assert.rejects(uploadWithRetry(async()=>{calls++;throw new TypeError('Failed to fetch');},{sleep:async()=>{},delays:[1,1]}),/Failed to fetch/);
 assert.equal(calls,3);
 const controller=new AbortController();calls=0;
 await assert.rejects(uploadWithRetry(async()=>{calls++;controller.abort();throw new TypeError('Failed to fetch');},{signal:controller.signal,sleep:async()=>{}}),/Failed to fetch/);
 assert.equal(calls,1);
});
