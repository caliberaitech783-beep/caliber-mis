import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nextScanReviewCard} from '../src/scan-next-card.mjs';
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
function harness({fail=false,autosaving=false,last=false}={}){
 const current=card('1'),next=card('2'),visible=last?[current]:[current,next],events=[];
 const location={href:'https://example.test/?batch=test&card=1&scanView=review#scan'};
 const dirtyRef={current:true},selectedRevision={current:'1:1'};
 const scope={card:current,savingRef:{current:autosaving},setNotice:v=>events.push(['notice',v]),setSavedCardId:()=>{},setBusy:v=>events.push(['busy',v]),setError:v=>events.push(['error',v]),api:async(path,config)=>{events.push(['put',path,JSON.parse(config.body)]);if(fail)throw Error('Save failed');},draft:{},editRevision:{current:1},checked:false,noTrips:false,localStorage:{removeItem:()=>{}},draftKey:id=>id,setDirty:()=>{},dirtyRef,load:async()=>{events.push(['load']);return visible;},batch:{id:'test'},list:async()=>events.push(['list']),nextScanReviewCard,filtered:visible,setAutosaveStatus:()=>{},selectedRevision,setSelected:id=>events.push(['selected',id]),window:{location,history:{replaceState:(_a,_b,url)=>{location.href=new URL(url,location.href).href;}}},reviewPage:true,navigateReview:()=>events.push(['overview'])};
 return {run:new Function(...Object.keys(scope),'return ('+handler+')')(...Object.values(scope)),events,location,selectedRevision};
}
test('successful explicit save advances after persistence and updates the card link',async()=>{
 const h=harness();await h.run('save');
 assert.ok(h.events.findIndex(e=>e[0]==='put')<h.events.findIndex(e=>e[0]==='selected'));
 assert.ok(h.events.findIndex(e=>e[0]==='load')<h.events.findIndex(e=>e[0]==='selected'));
 assert.deepEqual(h.events.find(e=>e[0]==='selected'),['selected','2']);
 assert.equal(new URL(h.location.href).searchParams.get('card'),'2');
 assert.equal(h.selectedRevision.current,null);
});
test('failed or in-flight save never advances or closes the card',async()=>{
 for(const options of [{fail:true},{autosaving:true}]){
  const h=harness(options);await h.run('save');
  assert.equal(h.events.some(e=>['selected','overview'].includes(e[0])),false);
 }
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