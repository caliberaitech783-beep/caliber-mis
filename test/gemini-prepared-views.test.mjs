import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGeminiCardReader} from '../server/services/gemini-card-reader.mjs';
import {aFields} from '../server/services/gemini-hybrid.mjs';
import {scanReadTiming} from '../server/services/scan-extraction-queue.mjs';

// Every trip card is read twice (first read, then the door recheck). On
// 12 Nov 2026 Gemini answered in 6.1 s at the median over 1,159 cards, yet a
// site's queue moved only about 6 to 18 cards a minute: preparing the pictures
// runs one card at a time, and it ran for both reads of every card.

const field=value=>({value,status:value===null?'missing':'clear'});
const response=()=>({documentType:'VLB',fields:{...Object.fromEntries(aFields('vehicle').map(k=>[k,field(null)])),bookDate:field('2026-10-11'),site:field('Jayant'),door:field('V/309'),cardNumber:field('75'),employeeCode:field('3943'),openingHmr:field('18749'),closingHmr:field('18756'),openingKmr:field('222772.9'),closingKmr:field('222836.3'),printedTotalTrips:field('2'),machineSummary:[{equipmentType:field('T'),equipmentNumber:field('50'),tripCount:field('2')}]},trips:{p:true,r:[[1,'T','50','12:38','12:49'],[2,'T','50','13:03','13:12']]}});
const ok=()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(response())}]}}]})});

async function reader(t,overrides={}){
 const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'prepared-views-'));t.after(()=>fs.rm(cacheDir,{recursive:true,force:true}));
 const seen={prepared:0,bodies:[]};
 const made=createGeminiCardReader({cacheDir,getKey:async()=>'test',minIntervalMs:0,sleep:async()=>{},
  prepareViews:async()=>{seen.prepared++;return [{label:'Header',mimeType:'image/webp',image:Buffer.from('view-'+seen.prepared)}];},
  fetchImpl:async(_url,init)=>{seen.bodies.push(JSON.parse(init.body));return ok();},...overrides});
 return {reader:made,seen};
}
const pictures=body=>body.contents[0].parts.filter(part=>part.inlineData).map(part=>part.inlineData.data);

test('the door recheck reuses the pictures of the first read and still asks Gemini again',async t=>{
 const {reader:cards,seen}=await reader(t),image=Buffer.from('card-one');
 const first=await cards.recognize(image,{kind:'vehicle'});
 assert.equal(seen.prepared,1);assert.equal(first.extraction.prepReused,false);assert.ok(first.extraction.prepMs>=0);
 const second=await cards.recognize(image,{kind:'vehicle',forceRead:true});
 assert.equal(seen.bodies.length,2,'the recheck is a fresh Gemini request');
 assert.equal(seen.prepared,1,'the pictures were not made again');
 assert.deepEqual(pictures(seen.bodies[1]),pictures(seen.bodies[0]),'the recheck sends the same pictures');
 assert.match(seen.bodies[1].contents[0].parts[0].text,/Re-inspect the Door No cell/);
 assert.doesNotMatch(seen.bodies[0].contents[0].parts[0].text,/Re-inspect the Door No cell/);
 assert.equal(second.extraction.prepReused,true);assert.equal(second.extraction.prepMs,0);
 // The kept pictures are released by the recheck: a later fresh read prepares again.
 await cards.recognize(image,{kind:'vehicle',forceRead:true});
 assert.equal(seen.prepared,2);
});

test('pictures are kept per scan and per card type, never across cards',async t=>{
 const {reader:cards,seen}=await reader(t);
 await cards.recognize(Buffer.from('card-one'),{kind:'vehicle'});
 await cards.recognize(Buffer.from('card-two'),{kind:'vehicle',forceRead:true});
 assert.equal(seen.prepared,2,'another scan is prepared on its own');
 assert.notDeepEqual(pictures(seen.bodies[1])[0],pictures(seen.bodies[0])[0]);
 await cards.recognize(Buffer.from('card-one'),{kind:'vehicle',forceRead:true});
 assert.equal(seen.prepared,2,'the first scan still has its pictures');
});

test('a failed preparation is not kept, and old pictures are not reused',async t=>{
 let fail=true,clock=1_000_000;
 const {reader:cards,seen}=await reader(t,{now:()=>clock,prepareImage:async image=>{if(fail){fail=false;throw Error('decode failed');}return image;}});
 const image=Buffer.from('card-one');
 await assert.rejects(cards.recognize(image,{kind:'vehicle'}),/decode failed/);
 await cards.recognize(image,{kind:'vehicle'});
 assert.equal(seen.prepared,1,'the second attempt prepared the pictures itself');
 clock+=5*60_000+1;
 await cards.recognize(image,{kind:'vehicle',forceRead:true});
 assert.equal(seen.prepared,2,'pictures older than five minutes are made again');
});

test('only a few cards keep their pictures at a time',async t=>{
 const {reader:cards,seen}=await reader(t,{maxPending:40});
 for(let i=0;i<20;i++)await cards.recognize(Buffer.from('card-'+i),{kind:'vehicle'});
 assert.equal(seen.prepared,20);
 await cards.recognize(Buffer.from('card-19'),{kind:'vehicle',forceRead:true});
 assert.equal(seen.prepared,20,'a recent card is still kept');
 await cards.recognize(Buffer.from('card-0'),{kind:'vehicle',forceRead:true});
 assert.equal(seen.prepared,21,'the oldest cards were dropped to bound memory');
});

test('a card records where its reading time went',()=>{
 const created=new Date('2026-11-12T17:05:00.000Z'),claimedAt=created.getTime()+90_000;
 const timing=scanReadTiming(created,{claimedAt,firstReadAt:claimedAt+7_200,recheckedAt:claimedAt+14_900},claimedAt+15_400,{workers:8,engine:true});
 assert.deepEqual(timing,{queuedMs:90_000,firstReadMs:7_200,recheckMs:7_700,finishMs:500,totalMs:15_400,finishedAt:'2026-11-12T17:06:45.400Z',workers:8,engine:true});
 assert.equal(scanReadTiming('2026-11-12T17:05:00.000Z',{claimedAt},claimedAt+10).queuedMs,90_000,'a text timestamp is read too');
 const partial=scanReadTiming(null,{claimedAt},claimedAt+10);
 assert.equal(partial.queuedMs,null);assert.equal(partial.firstReadMs,null);assert.equal(partial.totalMs,10);
});

test('the reader stores the timing with the card it finished',async()=>{
 const source=await fs.readFile(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 const worker=source.split('\n').find(line=>line.startsWith(' async function readQueuedCards('));
 assert.match(worker,/decodeScanRow\(current\);const timing=\{claimedAt:Date\.now\(\)\};/);
 assert.match(worker,/timing\.firstReadAt=Date\.now\(\);await readerAnswered\(lane\);/);
 assert.match(worker,/timing\.recheckedAt=Date\.now\(\);extracted\.raw\.scanReadToken=/);
 assert.match(worker,/extracted\.raw\.scanTiming=scanReadTiming\(current\.created_at,timing,Date\.now\(\),\{workers:lane\.workers,engine:role==='engine'\}\);/);
 assert.ok(worker.indexOf('extracted.raw.scanTiming=')<worker.lastIndexOf("UPDATE mis_scan_cards SET status='review'"),'set before the card is saved');
});
