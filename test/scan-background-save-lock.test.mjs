import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {autoSaveWithBusyRetry,isBusyAutoSaveError,busyAutoSaveStoppedMessage,AUTO_SAVE_BUSY_DELAYS_MS} from '../shared/scan-auto-save-retry.mjs';
const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
const start=source.indexOf('  if(reviewPage||!options');
const end=source.indexOf('\n },[reviewPage,cards',start);
const body=source.slice(start,end).replace('void (async()=>','return (async()=>');
function fixture(reviewPage=false){
 const state={autoSaving:null,calls:[],failures:new Map(),waits:[]};
 const context={reviewPage,options:{},dirty:false,busy:false,fleetBusy:false,connectionError:'',savingRef:{current:false},uploadingRef:{current:false},contextBlocked:false,cards:[1,2].map(n=>({id:'c'+n,batch_id:'b',revision:1,ordinal:n})),card:null,bdFallbackMissing:false,kind:'vehicle',lmv:false,canAutoSaveScanCard:c=>!state.failures.has(c.id+':'+c.revision),autoSaveAttempts:{current:new Set()},autoSaveFailures:{current:state.failures},activeRef:{current:'b'},selectedCardRef:{current:''},bdFetchUnavailable:{current:false},autoSavingRef:{current:null},autoSavePaused:{current:false},setAutoSaveWait:w=>{if(w)state.waits.push(w)},autoSaveWithBusyRetry:(perform,config)=>autoSaveWithBusyRetry(perform,{...config,sleep:async()=>{}}),isBusyAutoSaveError,busyAutoSaveStoppedMessage,setAutoSaving:v=>state.autoSaving=v,setFailureTick:()=>{},setPulseHours:()=>{},setPulseHoursError:()=>{},setNotice:()=>{},setAutoSaveError:e=>state.error=e,setCards:()=>{},setResults:()=>{},setArchiveResult:()=>{},applySavedScanCard:c=>c,list:()=>{throw Error('refused save must not await refresh')},setError:()=>{},api:async(path,config)=>{state.calls.push(path);assert.ok(config.signal instanceof AbortSignal);throw Error('Vehicle already has a saved card');}};
 return {state,context,run:()=>new Function(...Object.keys(context),body)(...Object.values(context))};
}
test('review never starts background posting or takes the navigation busy lock',async()=>{
 const f=fixture(true);await f.run();assert.equal(f.state.autoSaving,null);assert.deepEqual(f.state.calls,[]);
});
test('refused cards are attempted once each and the queue releases its lock',async()=>{
 const f=fixture();
 await f.run();
 assert.deepEqual(f.state.calls,['/api/scan-cards/c1/auto-save','/api/scan-cards/c2/auto-save']);
 assert.equal(f.state.autoSaving,null);
 assert.match(f.state.error.message,/already has/);
 await f.run();
 assert.equal(f.state.calls.length,2);
});

test('an in-flight save keeps its lock scoped to one card and does not refresh the entry list',async()=>{
 const f=fixture();
 let finish;
 f.context.api=path=>{
  f.state.calls.push(path);
  if(path.includes('/c1/'))return new Promise(resolve=>{finish=resolve;});
  assert.equal(f.context.autoSavingRef.current.id,'c2');
  return Promise.resolve({record:{id:2,book_no:'VLB/2'}});
 };
 const pending=f.run();
 assert.equal(f.context.autoSavingRef.current.id,'c1');
 assert.equal(f.state.autoSaving.id,'c1');
 await f.run();
 assert.deepEqual(f.state.calls,['/api/scan-cards/c1/auto-save']);
 finish({record:{id:1,book_no:'VLB/1'}});
 await pending;
 assert.deepEqual(f.state.calls,['/api/scan-cards/c1/auto-save','/api/scan-cards/c2/auto-save']);
 assert.equal(f.context.autoSavingRef.current,null);
 assert.equal(f.state.autoSaving,null);
 assert.equal(f.state.error,undefined);
});

const busy=()=>Object.assign(new Error('The server is reconnecting to the database. Please retry in a moment.'),{status:503,transient:true});
test('a busy server is waited out and the same card is saved without any stop message',async()=>{
 const f=fixture();let calls=0;
 f.context.api=async path=>{f.state.calls.push(path);calls+=1;if(calls<3)throw busy();return {record:{id:1,book_no:'VLB/1'}};};
 await f.run();
 assert.deepEqual(f.state.calls,[...Array(3).fill('/api/scan-cards/c1/auto-save'),'/api/scan-cards/c2/auto-save']);
 assert.deepEqual(f.state.waits.map(w=>[w.ordinal,w.seconds,w.nextAttempt,w.totalAttempts]),[[1,5,2,7],[1,10,3,7]]);
 assert.equal(f.state.error,undefined);assert.equal(f.state.failures.size,0);assert.equal(f.context.autoSavePaused.current,false);assert.equal(f.state.autoSaving,null);
});
test('a server that stays busy pauses saving without listing the card as refused or moving to the next card',async()=>{
 const f=fixture();
 f.context.api=async path=>{f.state.calls.push(path);throw busy();};
 await f.run();
 assert.equal(f.state.calls.length,AUTO_SAVE_BUSY_DELAYS_MS.length+1);
 assert.equal(f.state.failures.size,0,'a busy server is not a refusal');
 assert.equal(f.context.autoSavePaused.current,'b');
 assert.ok(f.state.error.retryAt>Date.now());
 assert.match(f.state.error.message,/stayed busy through 7 tries.*No card was lost/);
 assert.equal(f.state.error.ordinal,1);
 await f.run();
 assert.equal(f.state.calls.length,AUTO_SAVE_BUSY_DELAYS_MS.length+1,'paused during the retry cooldown');
 f.context.autoSavePaused.current=false;
 f.context.api=async path=>{f.state.calls.push(path);return {record:{id:1,book_no:'VLB/1'}};};
 await f.run();
 assert.deepEqual(f.state.calls.slice(AUTO_SAVE_BUSY_DELAYS_MS.length+1),['/api/scan-cards/c1/auto-save','/api/scan-cards/c2/auto-save'],'the same card is tried first after Retry');
});
