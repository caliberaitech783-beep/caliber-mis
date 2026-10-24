import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {cardDetailViews} from '../gemini-card-images.mjs';
test('detail views retain native pixels and cover both table columns after a blank footer',async()=>{
 const canvas=createCanvas(100,200),c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,100,200);c.fillStyle='#999';c.fillRect(0,0,100,120);c.fillStyle='black';c.fillRect(20,50,10,10);c.fillRect(70,50,10,10);
 const original=canvas.toBuffer('image/png'),views=await cardDetailViews(original);assert.equal(views.length,3);
 const header=await loadImage(views[0].image),left=await loadImage(views[1].image),right=await loadImage(views[2].image);
 assert.equal(header.width,100);assert.ok(header.height<60);assert.equal(left.width,54);assert.equal(right.width,54);assert.equal(left.height,right.height);assert.deepEqual(canvas.toBuffer('image/png'),original);
 for(const image of [left,right]){const out=createCanvas(image.width,image.height),ctx=out.getContext('2d');ctx.drawImage(image,0,0);assert.ok(ctx.getImageData(0,0,image.width,image.height).data.some((v,i)=>i%4!==3&&v===0));}
});
