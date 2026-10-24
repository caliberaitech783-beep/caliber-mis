import test from 'node:test';import assert from 'node:assert/strict';
import {readConnectorResponse,waitForScannerService} from '../public/scanner-response.mjs';
test('empty or HTML startup responses never expose a JSON parsing error',async()=>{
 for(const body of ['', '<html>Proxy starting</html>'])await assert.rejects(readConnectorResponse(new Response(body,{status:502})),/starting or reconnecting/);
 assert.deepEqual(await readConnectorResponse(Response.json({devices:[]})),{devices:[]});
 await assert.rejects(readConnectorResponse(Response.json({error:'Online scanner authorization expired.'},{status:401})),/authorization expired/);
});
test('readiness waits for the service before the single-use authorization is sent',async()=>{
 let calls=0;await waitForScannerService(async(url,options)=>{calls++;assert.equal(url,'/api/health');assert.equal(options.method,undefined);return new Response('',{status:calls===1?502:200});},async()=>{});assert.equal(calls,2);
 calls=0;await assert.rejects(waitForScannerService(async()=>{calls++;throw Error('offline');},async()=>{}),/not ready/);assert.equal(calls,3);
});
