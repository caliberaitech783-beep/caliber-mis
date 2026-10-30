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
 assert.equal(calls,1);assert.equal(result.provider,'gemini');assert.equal(result.hybrid,undefined);assert.equal(result.extraction.usage.totalTokenCount,150);assert.equal(result.handwrittenFields.bookDate,'2026-10-11');assert.equal(result.extraction.rows[1].loadingTime,'01:03');assert.equal(result.extraction.summary[0].tripCount,2);
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
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-parallel-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const releases=[],releaseByImage=new Map();let calls=0;
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'test',prepareViews:async()=>[],minIntervalMs:0,maxPending:3,concurrency:2,sleep:async()=>{},fetchImpl:async(_url,options)=>{calls++;const image=Buffer.from(JSON.parse(options.body).contents[0].parts.find(part=>part.inlineData).inlineData.data,'base64').toString();return new Promise(resolve=>{const release=()=>resolve(ok(JSON.stringify(response())));releases.push(release);releaseByImage.set(image,release)});}});
 const one=reader.recognize(Buffer.from('slow')),same=reader.recognize(Buffer.from('slow')),two=reader.recognize(Buffer.from('fast')),three=reader.recognize(Buffer.from('next'));
 await assert.rejects(reader.recognize(Buffer.from('overflow')),/queue full/);
 while(releases.length<2)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
 releaseByImage.get('fast')();await two;
 while(releases.length<3)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,3);releaseByImage.get('next')();await three;
 releaseByImage.get('slow')();const [a,b]=await Promise.all([one,same]);assert.deepEqual(a,b);assert.notEqual(a,b);
});

test('retry progress records timeout or HTTP reason without leaking the server key',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-progress-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;const progress=[];
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'never-display-secret',prepareViews:async()=>[],minIntervalMs:0,sleep:async()=>{},fetchImpl:async()=>{if(++calls===1)return {ok:false,status:503,headers:{get:()=>null}};return ok(JSON.stringify(response()));}});
 const result=await reader.recognize(Buffer.from('retry'),{onProgress:(stage,details)=>progress.push({stage,...details})});
 assert.equal(result.extraction.attempts,2);assert.ok(result.extraction.totalElapsedMs>=result.extraction.elapsedMs);assert.ok(progress.some(p=>p.stage==='retrying'&&p.reason==='HTTP 503'));assert.equal(JSON.stringify(progress).includes('never-display-secret'),false);
});

test('a missing printed site is re-read once before the result is cached',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-site-retry-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;const progress=[];
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'test',prepareViews:async()=>[],minIntervalMs:0,sleep:async()=>{},fetchImpl:async(_url,options)=>{
  calls++;const card=response();if(calls===1)card.fields.site=field(null);else card.fields.site=field('SASTI OB');
  if(calls===2)assert.match(JSON.parse(options.body).contents[0].parts.at(-1).text,/Re-inspect the printed SITE header/);
  return ok(JSON.stringify(card));
 }});
 const result=await reader.recognize(Buffer.from('site-retry'),{onProgress:(stage,details)=>progress.push({stage,...details})});
 assert.equal(calls,2);assert.equal(result.handwrittenFields.location,'SASTI OB');assert.ok(progress.some(item=>item.reason==='printed site missing or unclear'));
});

test('malformed trip rows trigger one complete table re-read before caching',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-table-retry-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'test',prepareViews:async()=>[],minIntervalMs:0,sleep:async()=>{},fetchImpl:async(_url,options)=>{
  calls++;const card=response();
  if(calls===1)card.trips.r=[[1,'T50'],[2,'T50','05:58','06:16']];
  else{assert.match(JSON.parse(options.body).contents[0].parts.at(-1).text,/exactly \[tripNo,equipmentType,equipmentNumber,loadingTime,unloadingTime\]/);card.trips.r=[[1,'T50','05:26','05:44'],[2,'T50','05:58','06:16']];}
  return ok(JSON.stringify(card));
 }});
 const result=await reader.recognize(Buffer.from('table-retry'));
 assert.equal(calls,2);assert.equal(result.extraction.rows[0].loadingTime,'05:26');assert.equal(result.extraction.rows[0].unloadingTime,'05:44');assert.deepEqual(result.responseRecoveryIssues,[]);
});

test('concurrent workers still share the request-start rate gate',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-rate-gate-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const starts=[];
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'test',prepareViews:async()=>[],minIntervalMs:50,fetchImpl:async()=>{starts.push(Date.now());return ok(JSON.stringify(response()));}});
 await Promise.all(['one','two','three'].map(value=>reader.recognize(Buffer.from(value))));
 assert.equal(starts.length,3);for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=45,'parallel request bypassed shared rate gate');
});

test('one-request prompt reads inverted headers and requires the printed site',()=>{assert.ok(cardPrompt('vehicle').includes('upside down'));assert.ok(cardPrompt('equipment').includes('header at the bottom'));assert.match(cardPrompt('vehicle'),/SITE: SASTI OB/);});

test('one missing or malformed field cannot discard valid header, meter and trip data',()=>{
 for(const invalid of [undefined,null,{value:'',status:'clear'},{value:null,status:'clear'},'unstructured name',{value:{text:'name'},status:'clear'},{value:'Name',status:'invalid'},{value:'x'.repeat(301),status:'clear'}]){
  const card=response();card.fields.employeeName=invalid;
  const parsed=parseCardResponse(JSON.stringify(card),'vehicle');
  assert.equal(parsed.fields.employeeName.value,null);
  assert.ok(['missing','unclear'].includes(parsed.fields.employeeName.status));
  assert.equal(parsed.fields.employeeCode.value,'3943');assert.equal(parsed.fields.door.value,'V309');
  assert.equal(parsed.fields.openingKmr.value,'222772.9');assert.equal(parsed.trips.r.length,2);
 }
 const card=response();card.fields.employeeName=field('सुरज कुमार');card.fields.openingHmr=field(0);
 const parsed=parseCardResponse(JSON.stringify(card),'vehicle');
 assert.equal(parsed.fields.employeeName.value,'सुरज कुमार');assert.equal(parsed.fields.openingHmr.value,'0');
 card.fields.openingKmr={status:'clear',value:{guess:123}};
 const uncertain=parseCardResponse(JSON.stringify(card),'vehicle');
 assert.equal(uncertain.fields.openingKmr.value,null);assert.equal(uncertain.fields.openingKmr.status,'unclear');
 assert.equal(uncertain.fields.closingKmr.value,'222836.3');
});
test('invalid response envelopes and unsafe trip rows still fail rather than inventing data',()=>{
 for(const fields of [null,[],false])assert.throws(()=>parseCardResponse(JSON.stringify({...response(),fields}),'vehicle'),/Invalid Priority A JSON/);
 const card=response();card.trips.r[0][0]=-1;const recovered=parseCardResponse(JSON.stringify(card),'vehicle');assert.ok(recovered.issues.some(issue=>issue.includes('printed trip number unreadable')));
});
test('a new-parser cached malformed name retains original evidence without another AI request',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-field-recovery-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const image=Buffer.from('valid-card-with-bad-name-cell');
 const {createHash}=await import('node:crypto');const imageHash=createHash('sha256').update(image).digest('hex');
 const card=response();card.fields.employeeName={status:'clear',value:''};const raw=JSON.stringify(card);
 await fs.writeFile(path.join(dir,imageHash+'-vehicle-single-v16.json'),JSON.stringify({imageHash,kind:'vehicle',model:MODEL,finishReason:'STOP',raw}));
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>{throw Error('Cached recovery must not request a key');},prepareViews:async()=>{throw Error('Cached recovery must not read image again');}});
 const result=await reader.recognize(image);
 assert.equal(result.handwrittenFields.employeeCode,'3943');assert.equal(result.handwrittenFields.employeeName,'');
 assert.equal(result.handwrittenFields.openingKmr,'222772.9');assert.equal(result.extraction.rows.length,2);
 assert.equal(result.extraction.originalResponse,raw);assert.equal(result.extraction.fields.employeeName.status,'unclear');
 assert.ok(result.extraction.issues.some(issue=>issue==='employeeName: unclear'));
});

test('meter-cell colons become decimal points while trip clock times retain their meaning',()=>{
 const card=response();card.fields.openingKmr=field('83995:6');card.fields.closingKmr=field('84050:2');card.fields.openingHmr=field('1924:0');card.fields.closingHmr=field('1940:5');
 const parsed=parseCardResponse(JSON.stringify(card),'vehicle');
 assert.equal(parsed.fields.openingKmr.value,'83995.6');assert.equal(parsed.fields.closingKmr.value,'84050.2');
 assert.equal(parsed.fields.openingHmr.value,'1924.0');assert.equal(parsed.fields.closingHmr.value,'1940.5');
 assert.equal(parsed.trips.r[0][2],'12:38');assert.equal(card.fields.openingKmr.value,'83995:6');
});

test('V/252 cannot acquire a duplicated separator digit before equipment lookup',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-v252-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const card=response();card.fields.door=field('V/1252');card.fields.site=field('Sasti OC');
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'test',prepareViews:async()=>[],minIntervalMs:0,fetchImpl:async()=>ok(JSON.stringify(card))});
 const result=await reader.recognize(Buffer.from('V/252'));
 assert.equal(result.handwrittenFields.door,'V/252');assert.equal(result.extraction.doorFormatting.original,'V/1252');
 const extracted=extractCard(result.text,'vehicle',[{id:252,master_name:'Equipment master',record_data:{door:'Volvo 252',category:'vehicle',site:'Sasti OC'}}],result);
 assert.equal(extracted.draft.doorText,'V/252');assert.equal(extracted.draft.assetId,'252');
});

test('five slow cards can extract together while the sixth remains queued',{timeout:5000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-five-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const releases=[];let calls=0;
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'test',prepareViews:async()=>[],minIntervalMs:0,sleep:async()=>{},fetchImpl:async()=>{calls++;return new Promise(resolve=>releases.push(()=>resolve(ok(JSON.stringify(response())))));}});
 const tasks=['one','two','three','four','five','six'].map(value=>reader.recognize(Buffer.from(value)));
 while(releases.length<5)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,5);releases[0]();await Promise.race(tasks);
 while(releases.length<6)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,6);for(const release of releases.slice(1))release();await Promise.all(tasks);
 assert.throws(()=>createGeminiCardReader({concurrency:6}),/concurrency/);
});

test('separate M and NO cells retain repeated V5 and L79 numbers and literal times',()=>{
 const card=response();card.trips.r=[[1,'V','5','05:51','06:04'],[2,'V','5','06:17','06:31'],[3,'L','79','08:10','08:25']];
 card.fields.machineSummary=[{equipmentType:field('V'),equipmentNumber:field('5'),tripCount:field('2')},{equipmentType:field('L'),equipmentNumber:field('79'),tripCount:field('1')}];
 const parsed=parseCardResponse(JSON.stringify(card),'vehicle');
 assert.deepEqual(parsed.trips.r,[[1,'V5','05:51','06:04'],[2,'V5','06:17','06:31'],[3,'L79','08:10','08:25']]);
 assert.deepEqual(parsed.fields.machineSummary.map(row=>row.equipmentName.value),['V5','L79']);assert.deepEqual(parsed.issues,[]);
 assert.equal(card.trips.r[0][1],'V');assert.equal(card.trips.r[0][2],'5');
 const zero=response();zero.trips.r=[{rowNumber:1,equipmentType:'V',equipmentNumber:'005',loadingTime:'05:51',unloadingTime:'06:04'}];
 assert.equal(parseCardResponse(JSON.stringify(zero),'vehicle').trips.r[0][1],'V005');
});
test('prefix-only machine extraction triggers one targeted NO-column re-read',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-machine-no-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;const progress=[];
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'test',prepareViews:async()=>[],minIntervalMs:0,sleep:async()=>{},fetchImpl:async(_url,options)=>{
  const card=response();if(++calls===1){card.trips.r=[[1,'V','05:51','06:04']];card.fields.machineSummary=[{equipmentName:field('V'),tripCount:field('1')}];}
  else{assert.ok(JSON.parse(options.body).contents[0].parts.at(-1).text.includes('adjacent NO columns'));card.trips.r=[[1,'V','5','05:51','06:04']];card.fields.machineSummary=[{equipmentType:field('V'),equipmentNumber:field('5'),tripCount:field('1')}];}
  return ok(JSON.stringify(card));
 }});
 const result=await reader.recognize(Buffer.from('V5 in adjacent table cells'),{onProgress:(stage,details)=>progress.push({stage,...details})});
 assert.equal(calls,2);assert.equal(result.extraction.rows[0].equipmentName,'V5');
 assert.equal(result.extraction.rows[0].loadingTime,'05:51');assert.deepEqual(result.responseRecoveryIssues,[]);
 assert.ok(progress.some(event=>event.reason==='equipment number missing in NO column'));
});
test('unreadable NO stays flagged without inventing a number or accepting a prefix-only cache',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-unclear-no-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;
 const card=response();card.trips.r=[[1,'V',null,'05:51','06:04']];card.fields.machineSummary=[];
 const reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'test',prepareViews:async()=>[],minIntervalMs:0,sleep:async()=>{},fetchImpl:async()=>{calls++;return ok(JSON.stringify(card));}});
 const result=await reader.recognize(Buffer.from('unreadable number'));
 assert.equal(calls,2);assert.equal(result.extraction.rows[0].equipmentName,'');
 assert.ok(result.responseRecoveryIssues.some(issue=>issue.includes('equipment number missing or unreadable')));
 await reader.recognize(Buffer.from('unreadable number'));assert.equal(calls,4,'explicit re-reading must not reuse an incomplete prefix-only result');
});

test('an unreturned machine summary is read again, and a misplaced one is kept',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-summary-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0,retry='';
 const opts={prepareViews:async()=>[],cacheDir:dir,getKey:async()=>'test-secret',minIntervalMs:0,sleep:async()=>{},fetchImpl:async(url,options)=>{calls++;const data=response();if(calls===1)data.fields.machineSummary=[];else retry=JSON.parse(options.body).contents[0].parts.at(-1).text;return ok(JSON.stringify(data));}};
 const result=await createGeminiCardReader(opts).recognize(Buffer.from('card'));
 assert.equal(calls,2);assert.match(retry,/no machine-wise summary/);assert.equal(result.extraction.summary[0].equipmentName,'T50');
 const misplaced=response();misplaced.machineSummary=misplaced.fields.machineSummary;delete misplaced.fields.machineSummary;
 assert.equal(parseCardResponse(JSON.stringify(misplaced),'vehicle').fields.machineSummary.length,1);
 const blank=response();blank.fields.machineSummary=[];calls=0;
 const still=await createGeminiCardReader({...opts,cacheDir:dir+'-blank',fetchImpl:async()=>{calls++;return ok(JSON.stringify(blank));}}).recognize(Buffer.from('blank'));
 t.after(()=>fs.rm(dir+'-blank',{recursive:true,force:true}));
 assert.equal(calls,2,'retries once only');assert.equal(still.extraction.summary.length,0,'a blank box is never invented');
});
test('malformed summary rows remain reviewable instead of failing the complete card',()=>{
 const card=response();card.fields.machineSummary=[null,'invalid',42];
 const parsed=parseCardResponse(JSON.stringify(card),'vehicle');
 assert.equal(parsed.fields.door.value,'V309');assert.equal(parsed.trips.r.length,2);
 assert.ok(parsed.issues.some(issue=>issue.includes('Summary row')));
});
