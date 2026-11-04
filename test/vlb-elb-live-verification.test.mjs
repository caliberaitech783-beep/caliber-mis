import test from 'node:test';
import assert from 'node:assert/strict';
import {liveJson} from '../scripts/verify-vlb-elb-live.mjs';
const url='https://example.com/api/health';
test('live verification retries empty and restarting responses then parses JSON',async()=>{
 const replies=[new Response('',{status:200}),new Response('Restarting',{status:503}),Response.json({commit:'release'})];let waits=0;
 assert.deepEqual(await liveJson(url,{fetchImpl:async()=>replies.shift(),wait:async()=>{waits++}}),{commit:'release'});assert.equal(waits,2);
});
test('live verification fails clearly after bounded empty responses',async()=>{
 let calls=0;await assert.rejects(liveJson(url,{attempts:2,fetchImpl:async()=>{calls++;return new Response('')},wait:async()=>{}}),/api\/health returned an empty body/);assert.equal(calls,2);
});
test('permission failures are not retried and response contents are never exposed',async()=>{
 let calls=0;await assert.rejects(liveJson(url,{fetchImpl:async()=>{calls++;return new Response('private details',{status:403})},wait:async()=>{}}),/HTTP 403/);assert.equal(calls,1);
});
test('invalid JSON reports the endpoint and status',async()=>{
 await assert.rejects(liveJson(url,{fetchImpl:async()=>new Response('<html>private details</html>')}),/api\/health returned invalid JSON \(HTTP 200\)/);
});
