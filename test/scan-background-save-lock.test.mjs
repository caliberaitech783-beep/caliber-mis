import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
const start=source.indexOf('  if(reviewPage||!options');
const end=source.indexOf('\n },[reviewPage,cards',start);
const body=source.slice(start,end).replace('void (async()=>','return (async()=>');
function fixture(reviewPage=false){
 const state={busy:false,progress:'',calls:[],failures:new Map()};
 const context={reviewPage,options:{},dirty:false,busy:false,fleetBusy:false,connectionError:'',savingRef:{current:false},uploadingRef:{current:false},contextBlocked:false,cards:[1,2].map(n=>({id:'c'+n,batch_id:'b',revision:1,ordinal:n})),card:null,bdFallbackMissing:false,kind:'vehicle',canAutoSaveScanCard:c=>!state.failures.has(c.id+':'+c.revision),autoSaveAttempts:{current:new Set()},autoSaveFailures:{current:state.failures},activeRef:{current:'b'},selectedCardRef:{current:''},bdFetchUnavailable:{current:false},setBusy:v=>state.busy=v,setProgress:v=>state.progress=v,setFailureTick:()=>{},setPulseHours:()=>{},setPulseHoursError:()=>{},setNotice:()=>{},setAutoSaveError:e=>state.error=e,setCards:()=>{},setResults:()=>{},setArchiveResult:()=>{},applySavedScanCard:c=>c,list:()=>{throw Error('refused save must not await refresh')},setError:()=>{},api:async(path,config)=>{state.calls.push(path);assert.ok(config.signal instanceof AbortSignal);throw Error('Vehicle already has a saved card');}};
 return {state,context,run:()=>new Function(...Object.keys(context),body)(...Object.values(context))};
}
test('review never starts background posting or takes the navigation busy lock',async()=>{
 const f=fixture(true);await f.run();assert.equal(f.state.busy,false);assert.deepEqual(f.state.calls,[]);
});
test('a refusal releases the busy lock, is not retried, and yields before the next card',async()=>{
 const f=fixture();await f.run();assert.deepEqual(f.state.calls,['/api/scan-cards/c1/auto-save']);assert.equal(f.state.busy,false);assert.equal(f.state.progress,'');assert.match(f.state.error.message,/already has/);await f.run();assert.deepEqual(f.state.calls,['/api/scan-cards/c1/auto-save','/api/scan-cards/c2/auto-save']);await f.run();assert.equal(f.state.calls.length,2);assert.equal(f.state.busy,false);
});
