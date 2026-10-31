import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nextScanReviewCard,scanReviewNeighbours} from '../src/scan-next-card.mjs';
import {remainingScanCards} from '../src/scan-review-queue.mjs';
import {applySavedScanCard} from '../scan-batch-report.mjs';
const card=(id,status='review')=>({id,status,ordinal:Number(id)});
test('next correction follows the visible queue and skips completed or processing cards',()=>{
 const rows=[card('1'),card('2','posted'),card('3','reading'),card('4','rejected'),card('5','approved'),card('6','error')];
 assert.equal(nextScanReviewCard(rows,'1').id,'6');
 assert.equal(nextScanReviewCard(rows,'6'),null);
 assert.equal(nextScanReviewCard(rows,'missing'),null);
 assert.equal(nextScanReviewCard([rows[0],rows[5]],'1',[rows[0],card('6','posted')]),null);
 assert.equal(nextScanReviewCard([rows[0],rows[5]],'1',[rows[0]]),null);
});
const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
const handler=source.split('\n').find(line=>line.startsWith(' const review=async')).trim().replace(/^const review=/,'').replace(/;$/,'');
function harness({fail=false,postFail=false,autosaving=false,last=false,contextBlocked=false}={}){
 const current=card('1'),next=card('2'),visible=last?[current]:[current,next],events=[];
 const location={href:'https://example.test/?batch=test&card=1&scanView=review#scan'};
 const dirtyRef={current:true},selectedRevision={current:'1:1'};
 const scope={contextBlocked,groupFilter:'brown',card:current,savingRef:{current:autosaving},setNotice:v=>events.push(['notice',v]),setSavedCardId:()=>{},setBusy:v=>events.push(['busy',v]),setError:v=>events.push(['error',v]),api:async(path,config)=>{events.push([config.method==='PUT'?'put':'post',path,JSON.parse(config.body)]);if(fail)throw Error('Save failed');if(config.method==='POST'){if(postFail)throw Error('Equipment is not assigned to this site');return {record:{id:9,book_no:'TEST/0001',data:{scanCardId:current.id,scanBatchId:'test'}},archive:null};}return {revision:2};},draft:{},editRevision:{current:1},checked:false,noTrips:false,localStorage:{removeItem:()=>{}},draftKey:id=>id,setDirty:()=>{},dirtyRef,load:async()=>{events.push(['load']);return visible.map(row=>row.id===current.id&&!postFail?{...row,status:'posted'}:row);},batch:{id:'test'},list:async()=>events.push(['list']),nextScanReviewCard,remainingScanCards,applySavedScanCard,setCards:()=>{},setResults:()=>{},setArchiveResult:()=>{},filtered:visible,setAutosaveStatus:()=>{},selectedRevision,setSelected:id=>events.push(['selected',id]),window:{location,history:{replaceState:(_a,_b,url)=>{location.href=new URL(url,location.href).href;}}},reviewPage:true,navigateReview:()=>events.push(['overview'])};
 return {run:new Function(...Object.keys(scope),'return ('+handler+')')(...Object.values(scope)),events,location,selectedRevision};
}
test('successful explicit save advances after persistence and updates the card link',async()=>{
 const h=harness();await h.run('save');
 assert.ok(h.events.findIndex(e=>e[0]==='put')<h.events.findIndex(e=>e[0]==='selected'));
 assert.ok(h.events.findIndex(e=>e[0]==='put')<h.events.findIndex(e=>e[0]==='post'));
 assert.ok(h.events.findIndex(e=>e[0]==='post')<h.events.findIndex(e=>e[0]==='selected'));
 assert.deepEqual(h.events.find(e=>e[0]==='post'),['post','/api/scan-cards/1/auto-save',{revision:2}]);
 assert.ok(h.events.findIndex(e=>e[0]==='load')<h.events.findIndex(e=>e[0]==='selected'));
 assert.deepEqual(h.events.find(e=>e[0]==='selected'),['selected','2']);
 assert.equal(new URL(h.location.href).searchParams.get('card'),'2');
 assert.equal(h.selectedRevision.current,null);
});
test('failed or in-flight save never advances or closes the card',async()=>{
 for(const options of [{fail:true},{postFail:true},{autosaving:true}]){
  const h=harness(options);await h.run('save');
  assert.equal(h.events.some(e=>['selected','overview'].includes(e[0])),false);
 }
});

test('a blocked batch cannot save or advance, while rejecting a wrong card remains available',async()=>{
 const blocked=harness({contextBlocked:true});await blocked.run('save');
 assert.equal(blocked.events.some(event=>['put','post','selected'].includes(event[0])),false);
 assert.match(blocked.events.find(event=>event[0]==='error')?.[1],/Saving is blocked/);
 await blocked.run('reject');assert.equal(blocked.events.filter(event=>event[0]==='put').length,1);
});

test('failed validation retains the corrected draft without reporting a completed save',async()=>{
 const h=harness({postFail:true});await h.run('save');
 assert.match(h.events.find(e=>e[0]==='error'&&e[1])?.[1],/Corrections saved as a draft.*not assigned/);
 assert.equal(h.events.some(e=>e[0]==='notice'&&e[1].startsWith('Card saved.')),false);
});

test('saving the last visible card can continue with earlier remaining cards',()=>{
 const rows=[card('1'),card('2'),card('3')];
 assert.equal(nextScanReviewCard(rows,'3',[rows[0],rows[1],card('3','posted')],{wrap:true}).id,'1');
});
test('last card and successful rejection return to status overview without selecting another card',async()=>{
 const last=harness({last:true});await last.run('save');assert.ok(last.events.some(e=>e[0]==='overview'));
 const rejected=harness();await rejected.run('reject');assert.equal(rejected.events.some(e=>e[0]==='selected'),false);assert.ok(rejected.events.some(e=>e[0]==='overview'));
});

test('repeated rejection clicks send one request for only the selected card',async()=>{
 const h=harness();await Promise.all([h.run('reject'),h.run('reject'),h.run('reject')]);
 const requests=h.events.filter(e=>e[0]==='put');
 assert.equal(requests.length,1);
 assert.equal(requests[0][1],'/api/scan-cards/1');
 assert.equal(requests[0][2].action,'reject');
 assert.equal(h.events.some(e=>e[0]==='selected'),false);
});
test('blank-card review advances through rejected cards only when that group is open',()=>{
 const rows=[card('1'),card('2','rejected')];
 assert.equal(nextScanReviewCard(rows,'1'),null);
 assert.equal(nextScanReviewCard(rows,'1',rows,{includeRejected:true}).id,'2');
 assert.equal(nextScanReviewCard(rows,'2',rows,{includeRejected:true}),null);
});

test('Previous and Next follow remaining cards and stop at either end without changing saved state',()=>{
 const rows=[card('5'),card('7'),card('10')],before=JSON.stringify(rows);
 assert.equal(scanReviewNeighbours(rows,'5').previous,null);assert.equal(scanReviewNeighbours(rows,'5').next.id,'7');
 assert.equal(scanReviewNeighbours(rows,'7').previous.id,'5');assert.equal(scanReviewNeighbours(rows,'7').next.id,'10');
 assert.equal(scanReviewNeighbours(rows,'10').next,null);assert.deepEqual(scanReviewNeighbours(rows,'missing'),{previous:null,next:null});
 assert.equal(JSON.stringify(rows),before);
});

test('card navigation preserves unsaved corrections and never calls save or reject',()=>{
 const line=source.split('\n').find(line=>line.startsWith(' const moveReview=')).trim().replace(/^const moveReview=/,'').replace(/;$/,'');
 for(const blocked of ['busy','dirty','saving','none']){
  const changes=[],location={href:'https://example.test/?scanView=review&card=5'},scope={busy:blocked==='busy',dirty:blocked==='dirty',savingRef:{current:blocked==='saving'},filtered:[card('5'),card('7')],selectedRevision:{current:'5:1'},setSelected:id=>changes.push(id),setError:()=>{},setNotice:()=>{},window:{location,history:{replaceState:(_a,_b,url)=>location.href=new URL(url,location.href).href}}};
  new Function(...Object.keys(scope),'return ('+line+')')(...Object.values(scope))('7');
  assert.deepEqual(changes,blocked==='none'?['7']:[]);assert.equal(new URL(location.href).searchParams.get('card'),blocked==='none'?'7':'5');
 }
});
