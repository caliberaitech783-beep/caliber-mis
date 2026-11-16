import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {transformWithOxc} from 'vite';
import {formatBytes,formatDuration,loadClockText,loadTimeKey,loadedText,rangeDays,rememberLoadTime,usualLoadTime} from '../src/report-load-clock.mjs';

// Owner's note, 16 Nov 2026: "REPORT LOADING TIME TO SHOWN" under a screenshot of Sr 6 Loading Equipment-wise on the
// dashboard that said only "Loading complete report data…" for 01–16 Nov.

test('the clock gives the seconds so far, the step the reading is at and how long it took last time',()=>{
 assert.equal(formatDuration(0),'0 s');
 assert.equal(formatDuration(41_400),'41 s');
 assert.equal(formatDuration(65_000),'1 min 05 s');
 assert.equal(formatBytes(2048),'2 KB');
 assert.equal(formatBytes(45.2*1048576),'45.2 MB');
 assert.equal(rangeDays('2026-11-01','2026-11-16'),16);
 assert.equal(rangeDays('2026-11-16','2026-11-16'),1);
 assert.equal(loadClockText({phase:'waiting',elapsedMs:23_000,days:16}),'Loading complete report data… 23 s · the server is reading 16 days of log books');
 assert.equal(loadClockText({phase:'receiving',elapsedMs:31_000,received:12.4*1048576,days:16,usualMs:41_000}),'Loading complete report data… 31 s · received 12.4 MB so far · last time it took 41 s');
 assert.equal(loadClockText({phase:'building',elapsedMs:45_000,days:16,usualMs:41_000}),'Loading complete report data… 45 s · all data received, drawing the report on this screen');
 assert.equal(loadedText({ms:41_000,bytes:45.2*1048576}),'loaded in 41 s (45.2 MB)');
 assert.equal(loadedText(null),'');
});

test('the last time is kept per kind of reading and number of days; a browser that keeps nothing still shows the clock',()=>{
 const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 assert.equal(usualLoadTime(loadTimeKey('logbooks',16),storage),null);
 rememberLoadTime(loadTimeKey('logbooks',16),41_234,storage);
 assert.equal(usualLoadTime(loadTimeKey('logbooks',16),storage),41_234);
 assert.equal(usualLoadTime(loadTimeKey('logbooks',15),storage),null,'another number of days is another time');
 assert.equal(usualLoadTime(loadTimeKey('',16),storage),null,'the full reading is another time');
 const broken={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
 assert.doesNotThrow(()=>rememberLoadTime('x',1,broken));
 assert.equal(usualLoadTime('x',broken),null);
});

async function loadOperationsData(fetch){
 const source=fs.readFileSync(new URL('../src/operations-reports.jsx',import.meta.url),'utf8');
 const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function'),'operations-reports.jsx',{jsx:{runtime:'classic'}});
 return new Function('fetch',code+';return operationsData')(fetch);
}

test('the reading says its step as it goes: waiting for the server, the bytes received, then drawing; it keeps the time it took',async()=>{
 const text=JSON.stringify({records:[{id:1}],assets:[]}),bytes=new TextEncoder().encode(text);
 const halves=[bytes.slice(0,10),bytes.slice(10)];
 let answer;const answered=new Promise(resolve=>{answer=resolve;});
 const fetch=()=>answered;
 const operationsData=await loadOperationsData(fetch);
 const reading=operationsData('2026-11-01','2026-11-16','token',false,'logbooks');
 const steps=[];const unwatch=reading.watch(()=>steps.push(reading.progress().phase));
 assert.deepEqual(reading.progress(),{phase:'waiting',received:0});
 assert.equal(typeof reading.startedAt,'number');
 let piece=0;
 answer({ok:true,status:200,body:{getReader:()=>({read:async()=>piece<halves.length?{done:false,value:halves[piece++]}:{done:true}})}});
 const result=await reading.promise;
 assert.deepEqual(result,{records:[{id:1}],assets:[]});
 assert.deepEqual(steps,['receiving','building']);
 assert.equal(reading.progress().received,bytes.byteLength);
 assert.equal(reading.stats().bytes,bytes.byteLength);
 assert.ok(reading.stats().ms>=0);
 unwatch();reading.release();
});

test('a refused reading without JSON says the report is unavailable, with the status',async()=>{
 const operationsData=await loadOperationsData(()=>Promise.resolve({ok:false,status:504,json:async()=>{throw new SyntaxError('Unexpected token <');}}));
 const reading=operationsData('2026-11-02','2026-11-16','token',false,'logbooks');
 await assert.rejects(reading.promise,/Report data unavailable \(504\)/);
 reading.release();
});
