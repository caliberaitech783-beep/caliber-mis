import test from 'node:test';import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';import {cardDetailViews} from '../gemini-card-images.mjs';
test('native-pixel detail columns retain header and footer at either card orientation',async()=>{
 const source=createCanvas(100,200),ctx=source.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,100,200);ctx.fillStyle='black';ctx.fillRect(15,5,10,10);ctx.fillRect(75,185,10,10);
 const original=source.toBuffer('image/png'),sets=[];
 for(const angle of [0,180]){const canvas=createCanvas(100,200),c=canvas.getContext('2d');if(angle===180){c.translate(100,200);c.rotate(Math.PI);}c.drawImage(source,0,0);const bytes=canvas.toBuffer('image/png'),views=await cardDetailViews(bytes);assert.equal(views.length,4);sets.push(views.map(v=>v.image.toString('base64')).sort());
  for(const view of views){const image=await loadImage(view.image);assert.equal(image.width,54);assert.equal(image.height,200);const target=createCanvas(54,200),tctx=target.getContext('2d');tctx.drawImage(image,0,0);assert.ok(tctx.getImageData(0,0,54,200).data.some((v,i)=>i%4!==3&&v===0));}
 }
 assert.deepEqual(sets[0],sets[1],'both input orientations must supply the same upright/rotated pixel views');assert.deepEqual(source.toBuffer('image/png'),original);
});

test('concurrent encoding preserves every byte of the sequential quality-95 views',async()=>{
 const source=createCanvas(257,413),ctx=source.getContext('2d');ctx.fillStyle='#ed92a7';ctx.fillRect(0,0,257,413);ctx.fillStyle='#112255';ctx.font='18px sans-serif';ctx.fillText('V/252 V5 83995.6',8,35);ctx.fillText('07:05 07:45',110,390);
 const original=source.toBuffer('image/png'),image=await loadImage(original),expected=[];
 for(const degrees of [0,180])for(const [label,x,w] of [['Left overlapping full-height column',0,.54],['Right overlapping full-height column',.46,.54]]){
  const sx=Math.floor(x*image.width),sw=Math.min(image.width-sx,Math.ceil(w*image.width)),canvas=createCanvas(sw,image.height),c=canvas.getContext('2d');
  c.fillStyle='white';c.fillRect(0,0,sw,image.height);if(degrees===180){c.translate(sw,image.height);c.rotate(Math.PI);}c.drawImage(image,sx,0,sw,image.height,0,0,sw,image.height);
  expected.push({label:label+' ('+degrees+' degree view)',mimeType:'image/jpeg',image:await canvas.encode('jpeg',95)});
 }
 assert.deepEqual(await cardDetailViews(original),expected);
});
