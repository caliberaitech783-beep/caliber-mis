import test from 'node:test';
import assert from 'node:assert/strict';
import {cardPrompt,createGeminiCardReader} from '../gemini-card-reader.mjs';
import {aFields} from '../gemini-hybrid.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

test('door prompt distinguishes visible slash from real leading digits for all prefixes',()=>{
 for(const kind of ['vehicle','equipment']){
  const prompt=cardPrompt(kind);
  for(const text of ['V/833, never V1833','every alphabetic Door No prefix','multi-letter equipment prefixes','genuine leading 1','mark door unclear'])assert.ok(prompt.includes(text),text);
 }
});

test('slash release rereads old cached scans and preserves literal door evidence',async t=>{
 const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'door-slash-'));
 t.after(()=>fs.rm(cacheDir,{recursive:true,force:true}));
 const image=Buffer.from('door-slash-card'),imageHash=createHash('sha256').update(image).digest('hex');
 const payload=door=>({documentType:'VLB',fields:{...Object.fromEntries(aFields('vehicle').map(k=>[k,{value:null,status:'missing'}])),door:{value:door,status:'clear'},machineSummary:[]},trips:{p:true,r:[]}});
 await fs.writeFile(path.join(cacheDir,imageHash+'-vehicle-single-v10.json'),JSON.stringify({imageHash,kind:'vehicle',model:'gemini-3.1-flash-lite',finishReason:'STOP',raw:JSON.stringify(payload('V1833'))}));
 let calls=0;
 const reader=createGeminiCardReader({cacheDir,getKey:async()=>'test',prepareViews:async()=>[],minIntervalMs:0,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(payload('V/833'))}]}}]})};}});
 const result=await reader.recognize(image);
 assert.equal(calls,1);
 assert.equal(result.handwrittenFields.door,'V/833');
 assert.equal(result.handwritingCandidates.door.value,'V/833');
 assert.equal(result.extraction.fields.door.value,'V/833');
 await reader.recognize(image);assert.equal(calls,1);
});
