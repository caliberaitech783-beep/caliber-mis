import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {prepareGeminiScanImage,normalizeScanImage} from '../local-card-ocr.mjs';
import {cardDetailViews,summaryDetailViews,allCardDetailViews} from '../gemini-card-images.mjs';
import {createGeminiCardReader} from '../gemini-card-reader.mjs';
import {aFields} from '../gemini-hybrid.mjs';

const field=value=>({value,status:value===null?'missing':'clear'});
const response=()=>({documentType:'ELB',fields:{...Object.fromEntries(aFields('equipment').map(key=>[key,field(null)])),site:field('Sasti OC'),machineSummary:[]},trips:{p:false,r:[]}});
const ok=()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(response())}]}}]})});
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-speed-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('upload-ready JPEG stays byte-identical, with all six existing detail views unchanged',async()=>{
 const canvas=createCanvas(1200,1600),ctx=canvas.getContext('2d'),pixels=ctx.createImageData(1200,1600);let seed=123;
 for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const value=244+seed%10;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;pixels.data[i+3]=255;}
 ctx.putImageData(pixels,0,0);ctx.fillStyle='#111';ctx.font='28px Arial';
 for(let y=60;y<1560;y+=65)ctx.fillText('HMR 12345.7   KMR 234567.8   V/252   V5 07:05',30,y);
 const jpeg=await canvas.encode('jpeg',97);canvas.width=canvas.height=1;
 const oldStart=performance.now(),normalized=await normalizeScanImage(jpeg),oldViews=(await Promise.all([cardDetailViews(normalized),summaryDetailViews(normalized)])).flat(),oldMs=performance.now()-oldStart;
 const newStart=performance.now(),source=await prepareGeminiScanImage(jpeg),views=await allCardDetailViews(source),newMs=performance.now()-newStart;
 assert.equal(source,jpeg,'no re-encoding of the original JPEG');
 assert.deepEqual(views,oldViews,'all detail labels, dimensions, quality and encoded pixels must match');
 assert.ok(jpeg.length<normalized.length*.7);
 const beforeBytes=normalized.length+oldViews.reduce((sum,view)=>sum+view.image.length,0),afterBytes=jpeg.length+views.reduce((sum,view)=>sum+view.image.length,0);
 console.log(`Synthetic extraction: original image ${normalized.length} PNG bytes -> ${jpeg.length} JPEG bytes; total images ${beforeBytes} -> ${afterBytes} bytes; preparation ${Math.round(oldMs)} -> ${Math.round(newMs)} ms (local sample only)`);
});

test('Gemini image preparation rejects invalid JPEGs and retains PNG white-background normalization',async()=>{
 await assert.rejects(prepareGeminiScanImage(Buffer.from([255,216,255,217])),/Invalid PNG, JPEG or WebP/);
 const canvas=createCanvas(20,30),png=canvas.toBuffer('image/png'),prepared=await prepareGeminiScanImage(png);
 assert.deepEqual(prepared,await normalizeScanImage(png));
 const oversized=Buffer.from(png);oversized.writeUInt32BE(20000001,16);oversized.writeUInt32BE(1,20);
 await assert.rejects(prepareGeminiScanImage(oversized));
});

test('Gemini sends the original JPEG using its real MIME type',async t=>{
 const dir=await temporary(t),canvas=createCanvas(30,40),jpeg=await canvas.encode('jpeg',97);let calls=0;
 const reader=createGeminiCardReader({cacheDir:dir,prepareImage:prepareGeminiScanImage,prepareViews:async()=>[],getKey:async()=>'synthetic',minIntervalMs:0,fetchImpl:async(_url,options)=>{
  calls++;const original=JSON.parse(options.body).contents[0].parts.find(part=>part.inlineData).inlineData;
  assert.equal(original.mimeType,'image/jpeg');assert.deepEqual(Buffer.from(original.data,'base64'),jpeg);return ok();
 }});
 await reader.recognize(jpeg,{kind:'equipment'});assert.equal(calls,1);
});

test('native preparation is bounded across readers while provider requests can overlap',async t=>{
 const dir=await temporary(t),prepared=[],releasePreparation=[],releaseRequest=[];let preparing=0,maxPreparing=0,activeRequests=0,maxRequests=0;
 const options={cacheDir:dir,getKey:async()=>'synthetic',minIntervalMs:0,prepareViews:async image=>{
  preparing++;maxPreparing=Math.max(maxPreparing,preparing);prepared.push(image.toString());
  await new Promise(resolve=>releasePreparation.push(resolve));preparing--;return [];
 },fetchImpl:async()=>{activeRequests++;maxRequests=Math.max(maxRequests,activeRequests);await new Promise(resolve=>releaseRequest.push(resolve));activeRequests--;return ok();}};
 const readers=[createGeminiCardReader(options),createGeminiCardReader(options)];
 const jobs=readers.map((reader,index)=>reader.recognize(Buffer.from('native-'+index),{kind:'equipment'}));
 while(releasePreparation.length<1)await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(prepared.length,1);
 releasePreparation[0]();while(releasePreparation.length<2)await new Promise(resolve=>setImmediate(resolve));
 releasePreparation[1]();while(releaseRequest.length<2)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(maxPreparing,1);assert.equal(maxRequests,2);
 releaseRequest.forEach(release=>release());await Promise.all(jobs);
});

test('failed preparation releases the shared preparation slot for subsequent cards',async t=>{
 const dir=await temporary(t),reader=createGeminiCardReader({cacheDir:dir,getKey:async()=>'synthetic',minIntervalMs:0,prepareViews:async image=>{if(image.toString()==='bad')throw Error('Cannot decode image');return [];},fetchImpl:async()=>ok()});
 await assert.rejects(reader.recognize(Buffer.from('bad'),{kind:'equipment'}),/Cannot decode image/);
 assert.equal((await reader.recognize(Buffer.from('good'),{kind:'equipment'})).provider,'gemini');
});
