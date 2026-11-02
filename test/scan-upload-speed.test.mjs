import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {createHash,randomUUID} from 'node:crypto';
import {encodeScanCanvas,prepareScanImages} from '../src/scan-upload-image.mjs';
import {createScanBlobStorage} from '../scan-blob-storage.mjs';

const browserCanvas=(width,height)=>{
 const canvas=createCanvas(width,height);
 canvas.toBlob=(callback,type,quality)=>callback(new Blob([canvas.toBuffer(type,Math.round(quality*100))],{type}));
 return canvas;
};
test('PDF upload encoding produces grayscale WebP pages far smaller than PNG while retaining dimensions and readable contrast',async t=>{
 const originalDocument=globalThis.document;t.after(()=>{globalThis.document=originalDocument;});
 globalThis.document={createElement:()=>browserCanvas(1,1)};
 const canvas=browserCanvas(1700,2267),ctx=canvas.getContext('2d'),pixels=ctx.createImageData(1700,2267);
 let seed=123;
 for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const gray=244+seed%10;pixels.data[i]=gray;pixels.data[i+1]=gray-3;pixels.data[i+2]=gray-6;pixels.data[i+3]=255;}
 ctx.putImageData(pixels,0,0);ctx.fillStyle='#1a2a7a';ctx.font='32px Arial';
 for(let y=70;y<2200;y+=65)ctx.fillText('HMR 12345.7   KMR 234567.8   Driver CMPL123   09:35',50,y);
 const png=canvas.toBuffer('image/png'),jpeg=canvas.toBuffer('image/jpeg',90),webp=await encodeScanCanvas(canvas),decoded=await loadImage(Buffer.from(await webp.arrayBuffer()));
 assert.equal(webp.type,'image/webp');assert.equal(decoded.width,canvas.width);assert.equal(decoded.height,canvas.height);
 assert.ok(webp.size<jpeg.length*0.6,`WebP ${webp.size}, JPEG ${jpeg.length}`);
 const copy=createCanvas(canvas.width,canvas.height);copy.getContext('2d').drawImage(decoded,0,0);
 const before=ctx.getImageData(0,0,canvas.width,canvas.height).data,after=copy.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
 let difference=0,colour=0;for(let i=0;i<before.length;i+=4){const luma=.299*before[i]+.587*before[i+1]+.114*before[i+2];difference+=Math.abs(luma-after[i]);colour+=Math.abs(after[i]-after[i+2]);}
 assert.ok(difference/(canvas.width*canvas.height)<3,'mean luminance difference stays below 3 / 255');
 assert.ok(colour/(canvas.width*canvas.height)<1,'encoded page is grayscale');
 console.log(`Sample scanned page: PNG ${png.length} bytes → JPEG q90 ${jpeg.length} bytes → grayscale WebP ${webp.size} bytes (${Math.round((1-webp.size/jpeg.length)*100)}% below JPEG)`);
});
test('ready WebP pages and smaller PNGs retain exact bytes, JPEG inputs are re-encoded and bitmaps are released',async t=>{
 const originalDocument=globalThis.document,originalBitmap=globalThis.createImageBitmap;let closed=0;
 t.after(()=>{globalThis.document=originalDocument;globalThis.createImageBitmap=originalBitmap;});
 globalThis.createImageBitmap=async blob=>{const bitmap=await loadImage(Buffer.from(await blob.arrayBuffer()));bitmap.close=()=>closed++;return bitmap;};
 globalThis.document={createElement:()=>browserCanvas(1,1)};
 const canvas=browserCanvas(600,800);canvas.getContext('2d').fillStyle='#2244aa';canvas.getContext('2d').fillRect(0,0,600,800);
 const webp=await encodeScanCanvas(canvas);assert.equal(webp.type,'image/webp');assert.equal(await prepareScanImages([webp]),webp);
 const jpeg=new Blob([canvas.toBuffer('image/jpeg',90)],{type:'image/jpeg'});const converted=await prepareScanImages([jpeg]);assert.equal(converted.type,'image/webp');assert.notEqual(converted,jpeg);
 const tiny=browserCanvas(50,50);tiny.getContext('2d').fillRect(0,0,50,50);const png=new Blob([tiny.toBuffer('image/png')],{type:'image/png'});assert.equal(await prepareScanImages([png]),png);assert.equal(closed,3);
 const combined=await prepareScanImages([webp,webp]);const decoded=await loadImage(Buffer.from(await combined.arrayBuffer()));assert.equal(decoded.width,600);assert.equal(decoded.height,1600);assert.equal(closed,5);
});
test('checksum-acknowledged Azure writes avoid readback; retries, missing checksums and corruption stay protected',async()=>{
 const image=Buffer.from('sample bytes'),args={id:randomUUID(),batchId:randomUUID(),kind:'vehicle',image};
 for(const mode of ['success','retry','missing','corrupt','failed']){
  const calls=[];
  const storage=createScanBlobStorage({account:'teststorage',container:'scanned-cards'},{env:{IDENTITY_ENDPOINT:'http://identity',IDENTITY_HEADER:'test'},fetchImpl:async(url,options)=>{
   if(String(url).startsWith('http:'))return Response.json({access_token:'test',expires_on:Date.now()/1000+3600});
   calls.push(options.method||'GET');
   if(options.method!=='PUT')return new Response(image);
   assert.equal(options.headers['Content-MD5'],createHash('md5').update(image).digest('base64'));
   return new Response(null,{status:mode==='retry'?412:mode==='failed'?500:201,headers:mode==='missing'?{}:{'Content-MD5':mode==='corrupt'?'wrong':options.headers['Content-MD5']}});
  }});
  if(['corrupt','failed'].includes(mode))await assert.rejects(storage.put(args),/checksum|not saved/);
  else await storage.put(args);
  assert.deepEqual(calls,['retry','missing'].includes(mode)?['PUT','GET']:['PUT']);
 }
});
