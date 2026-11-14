// 14 November 2026: on site links every card opened in review showed "Loading scan
// preview…" for the whole download, and leaving the card threw the bytes away.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createScanPreviewLoader,SCAN_PREVIEW_CACHE_LIMIT,SCAN_PREVIEW_PREFETCH} from '../src/scan-preview-cache.mjs';

const image=id=>new Blob(['scan '+id],{type:'image/webp'});
function setup({limit,timeoutMs,respond}={}){
 const calls=[],revoked=[];let created=0,clock=0;
 const fetch=async(path,{signal,headers})=>{calls.push({path,signal,headers});const id=path.split('/')[3];return respond?respond(id,signal):{ok:true,blob:async()=>image(id)};};
 const loader=createScanPreviewLoader({fetch,trim:async blob=>blob,createObjectURL:blob=>'blob:'+(++created),revokeObjectURL:url=>revoked.push(url),limit,timeoutMs,now:()=>++clock});
 loader.setToken('t1');
 return {loader,calls,revoked};
}

test('a selected card is downloaded once and reused; prefetch reuses a download in flight',async()=>{
 const {loader,calls}=setup();
 const first=await loader.load('a');
 assert.equal(calls.length,1);assert.equal(calls[0].headers.Authorization,'Bearer t1');assert.match(first.original,/^blob:/);
 assert.equal(await loader.load('a'),first);
 loader.prefetch(['b','c','a']);
 assert.deepEqual(calls.map(c=>c.path).slice(1),['/api/scan-cards/b/image','/api/scan-cards/c/image']);
 loader.prefetch(['b']);
 assert.equal(calls.length,3,'a card already downloading is not requested again');
 const second=await loader.load('b');
 assert.equal(calls.length,3,'the prefetched scan is served from memory');
 assert.match(second.original,/^blob:/);
});

test('the cache keeps the last few scans, never the open card is evicted, and evicted URLs are revoked',async()=>{
 const {loader,revoked}=setup({limit:2});
 await loader.load('a');await loader.load('b');await loader.load('c');
 assert.equal(loader.size(),2);assert.equal(loader.has('a'),false);assert.deepEqual(revoked,['blob:1']);
 assert.equal(loader.has('c'),true,'the open card stays');
 loader.clear();assert.equal(loader.size(),0);assert.equal(revoked.length,3);
 assert.equal(SCAN_PREVIEW_CACHE_LIMIT>=4&&SCAN_PREVIEW_PREFETCH>=1,true);
});

test('cropping runs once per card and falls back to the original',async()=>{
 const calls=[];
 const loader=createScanPreviewLoader({fetch:async path=>({ok:true,blob:async()=>image(path)}),trim:async blob=>{calls.push(blob);return new Blob(['cropped']);},createObjectURL:blob=>'blob:'+(blob.size),revokeObjectURL(){}});
 await loader.load('a');
 const [one,two]=await Promise.all([loader.cropped('a'),loader.cropped('a')]);
 assert.equal(one,two);assert.equal(calls.length,1);assert.notEqual(one,(await loader.load('a')).original);
 const failing=createScanPreviewLoader({fetch:async path=>({ok:true,blob:async()=>image(path)}),trim:async()=>{throw Error('no canvas')},createObjectURL:()=>'blob:orig',revokeObjectURL(){}});
 await failing.load('b');assert.equal(await failing.cropped('b'),'blob:orig');
 assert.equal(await loader.cropped('missing'),'');
});

test('a failed or timed-out download is forgotten so Retry asks again, and a new sign-in clears everything',async()=>{
 let fail=true;
 const {loader,calls}=setup({timeoutMs:20,respond:(id,signal)=>id==='slow'?new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})))):fail?{ok:false}:{ok:true,blob:async()=>image(id)}});
 await assert.rejects(loader.load('a'),/Could not load scan/);
 assert.equal(loader.size(),0);
 fail=false;await loader.load('a');assert.equal(calls.length,2);
 await assert.rejects(loader.load('slow'),/took too long/);
 assert.equal(loader.has('slow'),false);
 loader.setToken('t2');assert.equal(loader.size(),0);
 await loader.load('a');assert.equal(calls.at(-1).headers.Authorization,'Bearer t2');
});
