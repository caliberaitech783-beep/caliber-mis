import test from 'node:test';
import assert from 'node:assert/strict';
import {redeemScannerTicket} from '../scanner-connector-auth.mjs';
test('scanner authorization retries a pre-connection timeout once with the same ticket',async()=>{
 let calls=0;const payload={ticket:'synthetic',nonce:'test',kind:'vehicle'},response={ok:true};
 const result=await redeemScannerTicket(async(url,options)=>{calls++;assert.equal(url,'https://pulse-ll.cmll.in/api/scanner-connector/redeem');assert.deepEqual(JSON.parse(options.body),payload);if(calls===1)throw Object.assign(new TypeError('fetch failed'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});return response;},payload,{sleep:async()=>{}});
 assert.equal(result,response);assert.equal(calls,2);
});
test('scanner authorization never replays an ambiguous connection failure or an HTTP response',async()=>{
 for(const code of ['ECONNRESET','UND_ERR_SOCKET']){let calls=0;await assert.rejects(redeemScannerTicket(async()=>{calls++;throw Object.assign(new TypeError('fetch failed'),{cause:{code}});},{},{sleep:async()=>{}}));assert.equal(calls,1);}
 let calls=0;const response={status:401};assert.equal(await redeemScannerTicket(async()=>{calls++;return response;},{}),response);assert.equal(calls,1);
});
test('scanner timeout retries remain bounded',async()=>{
 let calls=0;await assert.rejects(redeemScannerTicket(async()=>{calls++;throw Object.assign(new TypeError('fetch failed'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});},{},{sleep:async()=>{}}));assert.equal(calls,2);
});
