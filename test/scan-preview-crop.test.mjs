import test from 'node:test';import assert from 'node:assert/strict';
import {scanContentBounds} from '../src/scan-preview-crop.mjs';
const sheet=(width=200,height=300)=>({width,height,data:new Uint8ClampedArray(width*height*4).fill(255)});
const paint=(image,x,y,w,h,color)=>{for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)image.data.set([...color,255],(row*image.width+col)*4)};
test('preview removes blank sheet margins around a colored full card without cutting its edges',()=>{
 const image=sheet();paint(image,35,10,130,180,[255,120,170]);paint(image,2,290,1,1,[0,0,0]);
 assert.deepEqual(scanContentBounds(image),{x:33,y:8,width:134,height:184});
});
test('monochrome full card border and header/footer remain inside preview bounds',()=>{
 const image=sheet();paint(image,30,20,140,1,[0,0,0]);paint(image,30,219,140,1,[0,0,0]);paint(image,30,20,1,200,[0,0,0]);paint(image,169,20,1,200,[0,0,0]);
 assert.deepEqual(scanContentBounds(image),{x:28,y:18,width:144,height:204});
 assert.equal(scanContentBounds(sheet()),null);
 const blank=sheet();paint(blank,20,20,2,2,[0,0,0]);assert.equal(scanContentBounds(blank),null);
});
