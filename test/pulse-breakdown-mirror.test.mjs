import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPulseBreakdownMirror,readBreakdownRowsWithMirror,mirrorReadAt,withPulseCopyTime,PULSE_MIRROR_FRESH_MS,PULSE_MIRROR_MAX_AGE_MS} from '../server/services/pulse-breakdown-mirror.mjs';

// A small in-memory stand-in for the one-row table.
const fakePool=()=>{
 const state={row:null,writes:0,touches:0};
 return {state,async query(sql,args=[]){
  if(/^CREATE TABLE/.test(sql))return {rows:[]};
  if(/^SELECT rows/.test(sql))return {rows:state.row?[state.row]:[]};
  if(/^INSERT INTO pulse_breakdown_mirror/.test(sql)){state.writes++;state.row={rows:JSON.parse(args[0]),content_hash:args[2],read_at:args[3]};return {rows:[]};}
  if(/^UPDATE pulse_breakdown_mirror SET read_at/.test(sql)){state.touches++;if(state.row)state.row.read_at=args[0];return {rows:[]};}
  throw new Error('unexpected SQL '+sql);
 }};
};

test('the copy answers BD hours without calling Pulse, and an unchanged list is not rewritten',async()=>{
 let time=Date.parse('2026-11-15T14:00:00Z'),reads=0;const pool=fakePool();
 const feed=[{ref:'BD1',site:'Jayant OB',door:'V154',start:'2026-11-07 20:00:00',closedAt:'2026-11-07 22:00:00'}];
 const mirror=createPulseBreakdownMirror({pool,readFeed:async()=>{reads++;return feed;},now:()=>time});
 assert.equal(await mirror.read(),null,'empty before the first read');
 await mirror.refresh();await mirror.refresh();
 assert.equal(reads,2);assert.equal(pool.state.writes,1,'same list written once');assert.equal(pool.state.touches,1);
 const rows=await mirror.read();
 assert.deepEqual(rows,feed);assert.equal(mirrorReadAt(rows),time);
 let live=0;
 assert.deepEqual(await readBreakdownRowsWithMirror(mirror,async()=>{live++;return [];}),feed);
 assert.equal(live,0,'a fresh copy never waits on Pulse');
 assert.equal(mirror.status().fresh,true);assert.equal(mirror.status().rows,1);
});

test('a slow or down Pulse falls back to the last good copy up to a day old, then to the live error',async()=>{
 let time=Date.parse('2026-11-15T14:00:00Z'),fail=false;const pool=fakePool();
 const mirror=createPulseBreakdownMirror({pool,readFeed:async()=>{if(fail)throw new Error('Pulse request failed (504).');return [{ref:'BD1'}];},now:()=>time});
 await mirror.refresh();
 fail=true;await assert.rejects(mirror.refresh(),/504/);
 assert.match(mirror.status().lastError,/504/);
 time+=PULSE_MIRROR_FRESH_MS+60_000;
 let live=0;
 const rows=await readBreakdownRowsWithMirror(mirror,async()=>{live++;throw new Error('Pulse request failed (504).');});
 assert.equal(live,1,'an old copy first tries Pulse live');
 assert.deepEqual(rows,[{ref:'BD1'}],'Pulse down: the last good copy still answers');
 assert.deepEqual(await readBreakdownRowsWithMirror(mirror,async()=>[{ref:'LIVE'}]),[{ref:'LIVE'}],'Pulse back: live rows win over an old copy');
 time+=PULSE_MIRROR_MAX_AGE_MS;
 await assert.rejects(readBreakdownRowsWithMirror(mirror,async()=>{throw new Error('Pulse request failed (504).');}),/504/,'a copy older than a day is not used');
});

test('a restart starts from the stored copy instead of waiting for Pulse',async()=>{
 const time=Date.parse('2026-11-15T14:00:00Z'),pool=fakePool();
 await createPulseBreakdownMirror({pool,readFeed:async()=>[{ref:'BD9'}],now:()=>time}).refresh();
 const restarted=createPulseBreakdownMirror({pool,readFeed:async()=>{throw new Error('Pulse request failed (504).');},now:()=>time+60_000});
 assert.deepEqual(await restarted.read(),[{ref:'BD9'}]);
});

test('without a copy (switched off) the live read is used as before',async()=>{
 assert.deepEqual(await readBreakdownRowsWithMirror(null,async()=>[{ref:'LIVE'}]),[{ref:'LIVE'}]);
});

test('an old copy says when Pulse was last read only when part of the shift may be missing',()=>{
 const readAt=Date.parse('2026-11-15T10:00:00Z'),summary={breakdownHours:1,warnings:[],shiftEnd:'2026-11-15T12:30:00Z'};
 const fresh=withPulseCopyTime(summary,readAt,readAt+60_000);
 assert.equal(fresh.pulseAsOf,'2026-11-15T10:00:00.000Z');assert.deepEqual(fresh.warnings,[]);
 const stale=withPulseCopyTime(summary,readAt,readAt+30*60_000);
 assert.match(stale.warnings[0],/Pulse could not be read since 15 Nov,? 15:30 IST/);
 const pastShift=withPulseCopyTime({...summary,shiftEnd:'2026-11-07T18:30:00Z'},readAt,readAt+30*60_000);
 assert.deepEqual(pastShift.warnings,[],'a shift that ended before the copy is complete');
});

test('BD hours, the server start and health use the copy; Pulse gives the whole list only to Pulse Master Sync',()=>{
 const logBook=readFileSync(new URL('../server/routes/log-book.mjs',import.meta.url),'utf8');
 assert.match(logBook,/readBreakdownRowsWithMirror\(breakdownMirror,\(\)=>pulseMasterSync\.readBreakdownRequests\(\{actor\}\)\)/);
 assert.match(logBook,/copyAt=mirrorReadAt\(breakdownRows\)/);
 assert.match(logBook,/return copyAt\?withPulseCopyTime\(summary,copyAt\):summary/);
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/breakdownMirror:pulseBreakdownMirror/);
 assert.match(server,/await pulseBreakdownMirror\?\.start\(\)/);
 assert.match(server,/pulseBreakdownCopy:/);
 const sync=readFileSync(new URL('../server/routes/pulse-master-sync.mjs',import.meta.url),'utf8');
 assert.match(sync,/sharedSignIn\.request\('breakdown-mirror',\{\},null,\{menu:'Pulse Master Sync'\}\)/);
});
