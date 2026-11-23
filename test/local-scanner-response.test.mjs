import test from 'node:test';import assert from 'node:assert/strict';import {readScannerResponse} from '../src/local-scanner-response.mjs';
test('an empty proxy error becomes a reconnect message rather than a JSON parsing failure',async()=>{await assert.rejects(readScannerResponse(new Response('',{status:502})),/retry automatically/);await assert.rejects(readScannerResponse(new Response('<html>Starting</html>',{status:503})),/reconnecting/)});
test('a recovered scanner response exposes the connected devices and files',async()=>{const data={devices:[{id:'brother',name:'Brother ADS-3100'}],files:[{name:'scan.pdf'}]};assert.deepEqual(await readScannerResponse(Response.json(data)),data)});
test('API errors retain the useful server explanation',async()=>{await assert.rejects(readScannerResponse(Response.json({error:'Scanner feeder empty'},{status:400})),/Scanner feeder empty/)});
// One driver, one shift, one payment (owner, 23 Nov 2026): the scan review answers this refusal with one question to the person.
test('a refusal the page answers itself keeps its code',async()=>{
 await assert.rejects(readScannerResponse(Response.json({error:'A already has card B on another vehicle in this shift.',code:'driver_shift_hmr_limit'},{status:409}),{mis:true}),error=>error.status===409&&error.code==='driver_shift_hmr_limit'&&/another vehicle/.test(error.message));
 await assert.rejects(readScannerResponse(Response.json({error:'Card changed.'},{status:409}),{mis:true}),error=>error.code===undefined);
});
test('a refused MIS save keeps the latest card the server sent with it',async()=>{const latest={id:'card',revision:3,status:'review',draft:{remark:'x'}};await assert.rejects(readScannerResponse(Response.json({error:'Card changed. Reload before saving.',latest},{status:409}),{mis:true}),error=>error.status===409&&error.message==='Card changed. Reload before saving.'&&JSON.stringify(error.latest)===JSON.stringify(latest))});
