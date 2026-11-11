import test from 'node:test';import assert from 'node:assert/strict';
import {geminiEnabled,configuredGeminiKey} from '../server/services/gemini-card-reader.mjs';
test('online scanning explicitly enables Gemini and reuses a server key without Windows DPAPI',async()=>{
 assert.equal(geminiEnabled({MIS_GEMINI_API:'true'}),true);
 assert.equal(geminiEnabled({MIS_GEMINI_HYBRID:'true'}),false);
 assert.equal(await configuredGeminiKey({GEMINI_API_KEY:' synthetic '}),'synthetic');
 await assert.rejects(configuredGeminiKey({}),/not configured on the MIS server/);
});
test('each site reads with its own Gemini key and falls back to the shared key',async()=>{
 const {geminiSiteKeyName,geminiKeySource}=await import('../server/services/gemini-card-reader.mjs');
 const env={GEMINI_API_KEY:'shared',GEMINI_API_KEY_SASTI_OB:' sasti-key ',GEMINI_API_KEY_DHOPTALA_OB_2ND:'dhoptala-key'};
 assert.equal(geminiSiteKeyName('Sasti OC'),'GEMINI_API_KEY_SASTI_OB');
 assert.equal(geminiSiteKeyName('Gauri Pauni OC (2nd)'),'GEMINI_API_KEY_GAURI_PAUNI_OB_2ND');
 assert.equal(geminiSiteKeyName('Dudhichua East OC'),'GEMINI_API_KEY_DUDHICHUA_EAST_OB');
 assert.equal(await configuredGeminiKey(env,'Sasti OC'),'sasti-key');
 assert.equal(await configuredGeminiKey(env,'Dhoptala OC (2nd)'),'dhoptala-key');
 assert.equal(await configuredGeminiKey(env,'Majri OC'),'shared');
 assert.equal(await configuredGeminiKey(env),'shared');
 assert.equal(geminiKeySource(env,'Sasti OC'),'site');assert.equal(geminiKeySource(env,'Majri OC'),'shared');
});
