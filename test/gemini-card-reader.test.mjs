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
test('rate-limited requests retry at most twice; bounded queue rejects excess scans and never falls back',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-single-retry-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;
 const reader=createGeminiCardReader({prepareViews:async()=>[],cacheDir:dir,getKey:async()=>'test',maxPending:1,minIntervalMs:0,sleep:async()=>{},fetchImpl:async()=>{calls++;return {ok:false,status:429,headers:{get:()=> '1'}}}});
 const first=reader.recognize(Buffer.from('one'));await assert.rejects(reader.recognize(Buffer.from('two')),/queue full/);await assert.rejects(first,/HTTP 429/);assert.equal(calls,2);
});

test('VLB scanned through ELB cannot silently discard its KMR and trips',()=>{assert.throws(()=>parseCardResponse(JSON.stringify({documentType:'VLB',fields:null,trips:{p:false,r:[]}}),'equipment'),/VLB card scanned on the ELB page/);assert.throws(()=>parseCardResponse(JSON.stringify({documentType:'unknown'}),'vehicle'),/type could not be confirmed/);});

test('two distinct cards progress independently; duplicate captures share one request and queued work remains bounded',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-parallel-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const releases=[];let calls=0;
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'test',prepareViews:async()=>[],minIntervalMs:0,maxPending:3,sleep:async()=>{},fetchImpl:async()=>{calls++;return new Promise(resolve=>releases.push(()=>resolve(ok(JSON.stringify(response())))));}});
 const one=reader.recognize(Buffer.from('slow')),same=reader.recognize(Buffer.from('slow')),two=reader.recognize(Buffer.from('fast')),three=reader.recognize(Buffer.from('next'));
 await assert.rejects(reader.recognize(Buffer.from('overflow')),/queue full/);
 while(releases.length<2)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
 releases[1]();await two;
 while(releases.length<3)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,3);releases[2]();await three;
 releases[0]();const [a,b]=await Promise.all([one,same]);assert.deepEqual(a,b);assert.notEqual(a,b);
});

test('retry progress records timeout or HTTP reason without leaking the server key',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-progress-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;const progress=[];
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'never-display-secret',prepareViews:async()=>[],minIntervalMs:0,sleep:async()=>{},fetchImpl:async()=>{if(++calls===1)return {ok:false,status:503,headers:{get:()=>null}};return ok(JSON.stringify(response()));}});
 const result=await reader.recognize(Buffer.from('retry'),{onProgress:(stage,details)=>progress.push({stage,...details})});
 assert.equal(result.extraction.attempts,2);assert.ok(result.extraction.totalElapsedMs>=result.extraction.elapsedMs);assert.ok(progress.some(p=>p.stage==='retrying'&&p.reason==='HTTP 503'));assert.equal(JSON.stringify(progress).includes('never-display-secret'),false);
});

test('concurrent workers still share the request-start rate gate',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-rate-gate-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const starts=[];
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'test',prepareViews:async()=>[],minIntervalMs:50,fetchImpl:async()=>{starts.push(Date.now());return ok(JSON.stringify(response()));}});
 await Promise.all(['one','two','three'].map(value=>reader.recognize(Buffer.from(value))));
 assert.equal(starts.length,3);for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=45,'parallel request bypassed shared rate gate');
});
