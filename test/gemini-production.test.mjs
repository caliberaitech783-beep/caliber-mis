import test from 'node:test';import assert from 'node:assert/strict';
import {geminiEnabled,configuredGeminiKey} from '../gemini-card-reader.mjs';
test('online scanning explicitly enables Gemini and reuses a server key without Windows DPAPI',async()=>{
 assert.equal(geminiEnabled({MIS_GEMINI_API:'true'}),true);
 assert.equal(geminiEnabled({MIS_GEMINI_HYBRID:'true'}),false);
 assert.equal(await configuredGeminiKey({GEMINI_API_KEY:' synthetic '}),'synthetic');
 await assert.rejects(configuredGeminiKey({}),/not configured on the MIS server/);
});
