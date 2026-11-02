import test from 'node:test';import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {randomUUID} from 'node:crypto';
import {scanImageDimensions,scanImageExtension,scanImageMime} from '../scan-image-format.mjs';
import {sniffScanImageType,scanImageExtensionForType} from '../public/scan-image-type.mjs';
import {scanBlobKey} from '../scan-blob-storage.mjs';
import {SCAN_ENCODE_MAX_BYTES,prepareLocalScanImage} from '../scan-image-encode.mjs';
import {compressScannerPage,MAX_PAGE_BYTES} from '../public/scanner-compression.mjs';
import {prepareGeminiScanImage} from '../local-card-ocr.mjs';

const browserCanvas=(width,height)=>{
 const canvas=createCanvas(width,height);
 canvas.toBlob=(callback,type,quality)=>callback(new Blob([canvas.toBuffer(type,Math.round(quality*100))],{type}));
 return canvas;
};
function samplePage(width,height){
 const canvas=createCanvas(width,height),ctx=canvas.getContext('2d'),pixels=ctx.createImageData(width,height);
 let seed=7;for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const gray=238+seed%14;pixels.data[i]=gray;pixels.data[i+1]=gray-4;pixels.data[i+2]=gray-9;pixels.data[i+3]=255;}
 ctx.putImageData(pixels,0,0);ctx.strokeStyle='#222';ctx.lineWidth=3;for(let y=120;y<height-80;y+=70){ctx.beginPath();ctx.moveTo(60,y);ctx.lineTo(width-60,y);ctx.stroke();}
 ctx.fillStyle='#1a2a7a';ctx.font='34px sans-serif';for(let y=100;y<height-100;y+=70)ctx.fillText('V/252  83995.6  07:05  07:45  CMPL123',80,y);
 return canvas;
}

test('WebP scans are recognised with their dimensions, extension and blob key',()=>{
 const canvas=createCanvas(640,480);
 for(const [type,ext] of [['image/png','.png'],['image/jpeg','.jpg'],['image/webp','.webp']]){
  const bytes=canvas.toBuffer(type);
  assert.equal(scanImageMime(bytes),type);assert.equal(sniffScanImageType(new Uint8Array(bytes)),type);
  assert.equal(scanImageExtension(bytes),ext);assert.equal(scanImageExtensionForType(type),ext);
  assert.deepEqual(scanImageDimensions(bytes),{width:640,height:480});
  const key=scanBlobKey('Vehicle',randomUUID(),randomUUID(),bytes);assert.match(key,new RegExp('^vehicle/[0-9a-f-]{36}/[0-9a-f-]{36}\\'+ext+'$'));
 }
 // Lossless (VP8L) and simple lossy (VP8) WebP headers are parsed as well as the extended container.
 const vp8l=Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8L\0\0\0\0'),Buffer.from([0x2f]),Buffer.alloc(4)]);vp8l.writeUInt32LE((639)|(479<<14),21);
 assert.deepEqual(scanImageDimensions(Buffer.concat([vp8l,Buffer.alloc(8)])),{width:640,height:480});
 const vp8=Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 \0\0\0\0'),Buffer.from([0,0,0,0x9d,0x01,0x2a]),Buffer.alloc(8)]);vp8.writeUInt16LE(640,26);vp8.writeUInt16LE(480,28);
 assert.deepEqual(scanImageDimensions(vp8),{width:640,height:480});
 assert.throws(()=>scanImageDimensions(Buffer.from('RIFF\0\0\0\0WEBPXXXX\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0')),/Invalid/);
 const huge=Buffer.from(canvas.toBuffer('image/webp'));huge.writeUIntLE(9999,24,3);huge.writeUIntLE(9999,27,3);assert.throws(()=>scanImageDimensions(huge),/20 million/);
});

test('local scanner service encodes a colour page once as grayscale WebP within the transfer limit',async()=>{
 const page=samplePage(2480,3508),png=page.toBuffer('image/png'),encoded=await prepareLocalScanImage(png);
 assert.equal(scanImageMime(encoded),'image/webp');assert.ok(encoded.length<=SCAN_ENCODE_MAX_BYTES,`${encoded.length} bytes`);
 assert.ok(encoded.length<png.length/8,`WebP ${encoded.length} should be far below PNG ${png.length}`);
 const decoded=await loadImage(encoded);assert.equal(Math.max(decoded.width,decoded.height),2400);
 const check=createCanvas(decoded.width,decoded.height).getContext('2d');check.drawImage(decoded,0,0);
 const [r,g,b]=check.getImageData(Math.round(decoded.width/2),20,1,1).data;assert.ok(Math.abs(r-g)<=2&&Math.abs(g-b)<=2,'pixels are grayscale');
 // Already-prepared pages are retained byte for byte, so a retry does not re-encode.
 assert.equal(await prepareLocalScanImage(encoded),encoded);
 assert.equal(await prepareGeminiScanImage(encoded),encoded);
 console.log(`Sample 300 dpi page: PNG ${png.length} bytes → grayscale WebP ${encoded.length} bytes`);
});

test('connector compression reuses prepared pages and converts PNG pages to grayscale WebP under 500 KB',async()=>{
 const page=samplePage(1240,1754);let decodes=0;
 const options={decode:async blob=>{decodes++;return loadImage(Buffer.from(await blob.arrayBuffer()))},makeCanvas:()=>browserCanvas(1,1)};
 const ready=new Blob([page.toBuffer('image/webp',80)],{type:'image/webp'});
 const reused=await compressScannerPage(ready,options);assert.equal(reused.blob,ready);assert.equal(reused.reused,true);assert.equal(decodes,0);
 const result=await compressScannerPage(new Blob([page.toBuffer('image/png')],{type:'image/png'}),options);
 assert.equal(result.blob.type,'image/webp');assert.ok(result.blob.size<=MAX_PAGE_BYTES);assert.equal(result.width,1240);assert.equal(decodes,1);
 const decoded=await loadImage(Buffer.from(await result.blob.arrayBuffer()));const ctx=createCanvas(decoded.width,decoded.height).getContext('2d');ctx.drawImage(decoded,0,0);
 const [r,g,b]=ctx.getImageData(600,30,1,1).data;assert.ok(Math.abs(r-g)<=2&&Math.abs(g-b)<=2,'pixels are grayscale');
 // A JPEG above the limit is still recompressed.
 const large=new Blob([Buffer.concat([page.toBuffer('image/jpeg',100),Buffer.alloc(MAX_PAGE_BYTES)])],{type:'image/jpeg'});
 const recompressed=await compressScannerPage(large,options);assert.equal(recompressed.blob.type,'image/webp');assert.ok(recompressed.blob.size<=MAX_PAGE_BYTES);
});
