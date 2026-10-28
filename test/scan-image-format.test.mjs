import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createCanvas} from '@napi-rs/canvas';
import {scanImageDimensions,scanImageMime} from '../scan-image-format.mjs';
import {createLocalCardArchive} from '../scan-card-archive.mjs';
test('validates JPEG and PNG dimensions and rejects truncated or oversized images',()=>{
 const canvas=createCanvas(640,480);for(const type of ['image/png','image/jpeg']){const bytes=canvas.toBuffer(type);assert.equal(scanImageMime(bytes),type);assert.deepEqual(scanImageDimensions(bytes),{width:640,height:480});}
 assert.throws(()=>scanImageDimensions(Buffer.from([255,216,255,217])),/Invalid/);
 assert.throws(()=>scanImageDimensions(canvas.toBuffer('image/jpeg').subarray(0,30)),/Invalid/);
 const png=canvas.toBuffer('image/png');png.writeUInt32BE(10000,16);png.writeUInt32BE(10000,20);assert.throws(()=>scanImageDimensions(png),/20 million/);
});
test('archive retains compressed JPEG bytes with a matching filename and manifest extension',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'caliber-jpeg-archive-')),batch={id:randomUUID(),kind:'vehicle'},image=createCanvas(100,100).toBuffer('image/jpeg');
 const card={id:randomUUID(),ordinal:1,status:'posted',checked_by:'test',image,filename:'small-card.jpg',draft:{bookDate:'2026-10-28',location:'Test site'},raw_fields:{}};
 const result=await createLocalCardArchive(root)(batch,[card]),directory=path.join(root,result.folders[0]);
 const manifest=JSON.parse(await fs.readFile(path.join(directory,'saved-values.json'),'utf8'));assert.equal(manifest.cards[0].image,card.id+'.jpg');assert.deepEqual(await fs.readFile(path.join(directory,card.id+'.jpg')),image);
});
