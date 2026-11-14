import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chooseScanCard,scanProgressChanged,scanProgressChangedIds,mergeScanCardRefresh,mergeScanProgressStages} from '../src/scan-reader-status.mjs';
import {scanProgressActive,SCAN_PARTIAL_REFRESH_MAX,SCAN_FULL_REFRESH_MAX_MS} from '../shared/scan-progress-poll.mjs';

// Reading the whole entry each time one card finished re-validated every unsaved
// card: for an entry of N cards that is N whole reads of up to N cards each. On
// 12 Nov 2026 the 10-connection pool showed 0 idle and up to 8 requests waiting.
// A changed card is now read on its own and merged into the cards on screen.

const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const full=(id,status,revision,extra={})=>({id,status,revision,raw_fields:{},draft:{trips:[]},checks:['review','approved','error'].includes(status)?{errors:[],warnings:[]}:null,...extra});
const slim=({id,status,revision,raw_fields})=>({id,status,revision,raw_fields:{...(raw_fields?.fleetReview?{fleetReview:raw_fields.fleetReview}:{}),...(raw_fields?.scanProgress?{scanProgress:raw_fields.scanProgress}:{})},checks:null});

test('only new or changed cards are named for the partial read',()=>{
 const shown=[full(A,'review',2),full(B,'reading',5),full(C,'queued',1)];
 assert.deepEqual(scanProgressChangedIds(shown.map(slim),shown),[]);
 assert.deepEqual(scanProgressChangedIds([slim(shown[0]),{...slim(shown[1]),revision:9},slim(shown[2])],shown),[],'a reading card changes revision with every stage');
 assert.deepEqual(scanProgressChangedIds([slim(shown[0]),{...slim(shown[1]),status:'review',revision:9},slim(shown[2])],shown),[B]);
 assert.deepEqual(scanProgressChangedIds([{...slim(shown[0]),revision:3},slim(shown[1]),{...slim(shown[2]),status:'reading'}],shown),[A,C]);
 assert.deepEqual(scanProgressChangedIds([{...slim(shown[0]),raw_fields:{fleetReview:{checkedAt:'t2'}}},slim(shown[1]),slim(shown[2])],shown),[A]);
 assert.deepEqual(scanProgressChangedIds([...shown.map(slim),{id:'new',status:'queued',revision:1}],shown),['new']);
 assert.deepEqual(scanProgressChangedIds([slim(shown[0])],shown),[],'a removed card is not a changed card');
});

test('a partial read replaces the changed cards and keeps every other card as shown',()=>{
 const shown=[full(A,'review',2,{checks:{errors:['Door number is missing or unreadable.'],warnings:[]}}),full(B,'reading',5),full(C,'queued',1)];
 const poll=[slim(shown[0]),{...slim(shown[1]),status:'review',revision:9},{...slim(shown[2]),status:'reading',revision:2,raw_fields:{scanProgress:{stage:'extracting'}}}];
 const fetched=[full(B,'review',9),full(C,'reading',2)];
 const merged=mergeScanCardRefresh(shown,poll,fetched,[B,C]);
 assert.equal(merged[0],shown[0],'the unchanged card keeps its object and its checks');
 assert.equal(merged[1],fetched[0]);
 assert.deepEqual(merged.map(card=>card.id),[A,B,C],'order follows the poll');
 assert.equal(mergeScanCardRefresh(shown,poll,[fetched[0]],[B,C]),null,'a requested card that did not come back');
 assert.equal(mergeScanCardRefresh([shown[1],shown[2]],poll,fetched,[B,C]),null,'an unchanged card that is not on screen');
 assert.deepEqual(mergeScanCardRefresh(shown,[poll[1],poll[2]],fetched,[B,C]).map(card=>card.id),[B,C],'a card missing from the poll is dropped');
 // A save made on this screen while the read was in flight is not overwritten by the older answer.
 const saved=[shown[0],full(B,'posted',10),shown[2]];
 assert.equal(mergeScanCardRefresh(saved,poll,fetched,[B,C])[1],saved[1]);
 // An unchanged reading card still shows its newest extraction stage.
 const reading=[shown[0],full(B,'reading',5,{raw_fields:{scanProgress:{stage:'extracting'}}})];
 const staged=mergeScanCardRefresh(reading,[{...slim(shown[0]),revision:3},{...slim(reading[1]),raw_fields:{scanProgress:{stage:'retrying',attempt:2}}}],[full(A,'review',3)],[A]);
 assert.deepEqual(staged[1].raw_fields.scanProgress,{stage:'retrying',attempt:2});
});

function harness(server){
 const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 const line=source.split('\n').find(line=>line.startsWith(' const load=async(id,fresh=true,'));
 assert.ok(line,'load found');
 const paths=[],noop=()=>{},state={rows:[],gate:undefined,now:1_000_000,uploading:false};
 const scope={kind:'vehicle',lmv:false,vlbBatch:null,scanProgressChanged,scanProgressChangedIds,mergeScanCardRefresh,mergeScanProgressStages,scanProgressActive,SCAN_PARTIAL_REFRESH_MAX,SCAN_FULL_REFRESH_MAX_MS,chooseScanCard,
  cardsView:{get current(){return {source:state.rows}}},batchLoads:{current:new Map()},partialSince:{current:0},uploadingRef:{get current(){return state.uploading}},activeRef:{current:'batch'},dirtyRef:{current:false},
  Date:{now:()=>state.now},window:{location:{search:''}},
  api:async path=>{paths.push(path.replace('/api/scan-batches/batch',''));const query=path.split('?')[1]||'',cards=server();
   if(query==='progress=1')return {batch:{id:'batch'},cards:cards.map(slim),progress:true};
   if(query.startsWith('cards=')){const ids=query.slice(6).split(',');return {batch:{id:'batch'},partial:true,cards:cards.filter(card=>ids.includes(card.id)),contextGate:{partial:true},duplicates:[]};}
   return {batch:{id:'batch'},cards,contextGate:{partial:false},duplicates:[]};},
  setConnectionError:noop,setBatch:noop,setContextGate:gate=>state.gate=gate,setStorage:noop,setReader:noop,setDuplicates:noop,setCards:fn=>state.rows=fn(state.rows),setSelected:noop};
 const load=new Function(...Object.keys(scope),line.trim()+';return load;')(...Object.values(scope));
 return {load,paths,state,partialSince:scope.partialSince};
}

test('while cards are being read, each poll reads only the cards that changed',async()=>{
 let cards=[full(A,'review',2),full(B,'reading',5),full(C,'queued',1)];
 const {load,paths,state,partialSince}=harness(()=>cards);
 await load('batch',false);
 assert.deepEqual(paths,['?progress=1',''],'an empty screen reads the whole entry');
 const [first]=state.rows;
 cards=[cards[0],full(B,'review',9),full(C,'reading',2)];
 await load('batch',false);
 assert.deepEqual(paths.slice(2),['?progress=1',`?cards=${B},${C}`]);
 assert.equal(state.rows[0],first,'the card that did not change was not read or validated again');
 assert.equal(state.rows[1].status,'review');assert.ok(state.rows[1].checks);
 assert.deepEqual(state.gate,{partial:true},'the save gate follows the partial answer');
 assert.ok(partialSince.current>0);
 await load('batch',false);
 assert.deepEqual(paths.slice(4),['?progress=1'],'nothing changed and a card is still being read: no further read');
});

test('the whole entry is read once after the work settles, and at least every minute meanwhile',async()=>{
 let cards=[full(A,'review',2),full(B,'reading',5),full(C,'reading',1)];
 const {load,paths,state,partialSince}=harness(()=>cards);
 await load('batch',false);
 cards=[cards[0],full(B,'review',9),cards[2]];
 await load('batch',false);
 cards=[cards[0],cards[1],full(C,'review',4)];
 await load('batch',false);
 assert.deepEqual(paths.slice(2),['?progress=1',`?cards=${B}`,'?progress=1',`?cards=${C}`]);
 // Nothing is queued or reading any more: one whole read refreshes checks that depend on other cards.
 await load('batch',false);
 assert.deepEqual(paths.slice(6),['?progress=1','']);
 assert.equal(partialSince.current,0);assert.deepEqual(state.gate,{partial:false});
 await load('batch',false);
 assert.deepEqual(paths.slice(8),['?progress=1'],'and only once');

 // A long upload: after a minute of partial reads the next change reads the whole entry.
 cards=[cards[0],cards[1],cards[2],{...full('dddddddd-dddd-4ddd-8ddd-dddddddddddd','reading',1)}];
 await load('batch',false);
 cards=[full(A,'review',3),...cards.slice(1)];
 await load('batch',false);
 assert.equal(paths.at(-1),`?cards=${A}`);
 state.now+=SCAN_FULL_REFRESH_MAX_MS;
 cards=[full(A,'review',4),...cards.slice(1)];
 await load('batch',false);
 assert.equal(paths.at(-1),'');assert.equal(partialSince.current,0);
});

test('the whole entry is read when the partial answer does not fit or too many cards changed',async()=>{
 // The changed card is in the poll but missing from the partial answer (for example it was just marked a duplicate).
 const real=[full(A,'review',2),full(B,'review',9)];let calls=0;
 const second=harness(()=>(++calls===2?[real[0]]:real));
 second.state.rows=[full(A,'review',2),full(B,'reading',5)];
 await second.load('batch',false);
 assert.deepEqual(second.paths,['?progress=1',`?cards=${B}`,''],'falls back to the whole entry');
 assert.equal(second.state.rows[1].status,'review');

 const many=Array.from({length:SCAN_PARTIAL_REFRESH_MAX+1},(_,i)=>full(`${String(i).padStart(8,'0')}-0000-4000-8000-000000000000`,'reading',1));
 let big=many;const third=harness(()=>big);
 await third.load('batch',false);
 big=many.map(card=>full(card.id,'review',2));
 await third.load('batch',false);
 assert.deepEqual(third.paths.slice(2),['?progress=1',''],'more changed cards than the limit');
});

test('the server limits the full read to the selected cards and still gates on every card',()=>{
 const source=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 const lines=source.split(/\r?\n/),first=lines.findIndex(line=>line.startsWith(" app.get('/api/scan-batches/:id',"));
 const handler=lines.slice(first,lines.indexOf(' }));',first)+1).join('\n');
 assert.match(handler,/const only=selectedScanCards\(req\.query\.cards\);/);
 assert.match(handler,/AND \(\$2::text\[\] IS NULL OR c\.id::text=ANY\(\$2::text\[\]\)\) ORDER BY ordinal`,\[batch\.id,only\]/,'the card rows, and so their checks, are limited to the selection');
 assert.match(handler,/const gateCards=only\?\(await db\.query\(`SELECT c\.status FROM mis_scan_cards c WHERE [^`]*c\.batch_id=\$1[^`]*`,\[batch\.id\]\)\)\.rows:cards;/,'the save gate still sees every card of the entry');
 assert.match(handler,/\.\.\.\(only\?\{partial:true\}:\{\}\)/);
 assert.match(handler,/contextGate:scanContextGate\(batch\.expected_context,gateCards\)/);
 const start=source.indexOf(' const selectedScanCards=value=>{'),body=source.slice(start,source.indexOf('\n };',start)+4);
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
 const selected=new Function('fail','SCAN_PARTIAL_REFRESH_MAX',body+';return selectedScanCards;')(fail,SCAN_PARTIAL_REFRESH_MAX);
 assert.equal(selected(undefined),null,'no selection reads the whole entry as before');
 assert.deepEqual(selected(`${A},${B},${A}`),[A,B]);
 for(const bad of ['',',',"x' OR 1=1",A+',not-a-card',Array.from({length:SCAN_PARTIAL_REFRESH_MAX+1},(_,i)=>`${String(i).padStart(8,'0')}-0000-4000-8000-000000000000`).join(',')])
  assert.throws(()=>selected(bad),{status:400},JSON.stringify(bad.slice(0,30)));
});

test('a stalled fleet check gets a targeted retry even without a progress change',async()=>{
 const pending=full(A,'review',2,{validationPending:true,checks:null});
 const unchanged=full(B,'review',3);
 const {load,paths,state}=harness(()=>[pending,unchanged]);
 await load('batch',true);
 await load('batch',false);
 assert.deepEqual(paths,['','?progress=1']);
 await load('batch',false,true);
 assert.deepEqual(paths.slice(2),['?progress=1',`?cards=${A}`]);
 assert.equal(state.rows[1],unchanged);
});
