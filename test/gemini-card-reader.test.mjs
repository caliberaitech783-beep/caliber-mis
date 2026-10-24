import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGeminiCardReader,parseCardResponse,cardPrompt,MODEL} from '../gemini-card-reader.mjs';
import {aFields} from '../gemini-hybrid.mjs';
import {extractCard} from '../scan-extraction.mjs';
const field=value=>({value,status:value===null?'missing':'clear'});
const response=(kind='vehicle')=>({documentType:kind==='vehicle'?'VLB':'ELB',fields:{...Object.fromEntries(aFields(kind).map(k=>[k,field(null)])),bookDate:field('2026-10-11'),site:field('Jayant'),door:field('V309'),cardNumber:field('75'),employeeCode:field('3943'),openingHmr:field('18749'),closingHmr:field('18756'),...(kind==='vehicle'?{openingKmr:field('222772.9'),closingKmr:field('222836.3'),printedTotalTrips:field('2')}:{}),machineSummary:kind==='vehicle'?[{equipmentName:field('T50'),tripCount:field('2')}]:[]},trips:kind==='vehicle'?{p:true,r:[[1,'T50','12:38','12:49'],[2,'T50','1:03','1:12']]}:{p:false,r:[]}});
const ok=raw=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:raw}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:50,totalTokenCount:150}})});
test('one Gemini call fills header, meter, summary and literal individual rows; same-image cache avoids another call',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-single-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;
 const opts={prepareViews:async()=>[{label:'Header',image:Buffer.from('detail')}],cacheDir:dir,getKey:async()=>'test-secret',minIntervalMs:0,sleep:async()=>{},fetchImpl:async(url,options)=>{calls++;assert.ok(url.includes(MODEL));const body=JSON.parse(options.body);assert.equal(body.contents[0].parts.filter(p=>p.inlineData).length,2);assert.equal(body.contents[0].parts[1].inlineData.data,Buffer.from('card').toString('base64'));assert.ok(body.contents[0].parts[0].text.includes('ONE response'));const data=response();data.fields.shift=field('III (C)');return ok(JSON.stringify(data));}};
 const result=await createGeminiCardReader(opts).recognize(Buffer.from('card'));
 assert.equal(result.cardShift,'III');assert.equal(result.extraction.fields.shift.value,'III (C)');
 assert.equal(calls,1);assert.equal(result.provider,'gemini');assert.equal(result.hybrid,undefined);assert.equal(result.extraction.usage.totalTokenCount,150);assert.equal(result.handwrittenFields.bookDate,'2026-10-11');assert.equal(result.extraction.rows[1].loadingTime,'1:03');assert.equal(result.extraction.summary[0].tripCount,2);
 const draft=extractCard(result.text,'vehicle',[],result).draft;assert.equal(draft.bookDate,'2026-10-11');assert.equal(draft.aFormNo,'75');assert.equal(draft.openingKmr,'222772.9');
 const cached=await createGeminiCardReader(opts).recognize(Buffer.from('card'));assert.equal(calls,1);assert.equal(cached.extraction.originalResponse,result.extraction.originalResponse);assert.equal(JSON.stringify(result).includes('test-secret'),false);
});
test('ELB excludes vehicle fields and rejects vehicle trips; malformed output never populates a card',()=>{
 assert.ok(!cardPrompt('equipment').includes('openingKmr,'));const parsed=parseCardResponse(JSON.stringify(response('equipment')),'equipment');assert.deepEqual(parsed.trips,{p:false,r:[]});
 const bad=response('equipment');bad.trips={p:true,r:[[1,'V19','','']]};assert.throws(()=>parseCardResponse(JSON.stringify(bad),'equipment'));
 assert.throws(()=>parseCardResponse('{','vehicle'),/invalid JSON/);
});
test('rate-limited requests retry at most four times; bounded queue rejects excess scans and never falls back',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-single-retry-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;
 const reader=createGeminiCardReader({prepareViews:async()=>[],cacheDir:dir,getKey:async()=>'test',maxPending:1,minIntervalMs:0,sleep:async()=>{},fetchImpl:async()=>{calls++;return {ok:false,status:429,headers:{get:()=> '1'}}}});
 const first=reader.recognize(Buffer.from('one'));await assert.rejects(reader.recognize(Buffer.from('two')),/queue full/);await assert.rejects(first,/HTTP 429/);assert.equal(calls,4);
});

test('VLB scanned through ELB cannot silently discard its KMR and trips',()=>{assert.throws(()=>parseCardResponse(JSON.stringify({documentType:'VLB',fields:null,trips:{p:false,r:[]}}),'equipment'),/VLB card scanned on the ELB page/);assert.throws(()=>parseCardResponse(JSON.stringify({documentType:'unknown'}),'vehicle'),/type could not be confirmed/);});
