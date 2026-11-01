import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {canAutoSaveScanCard} from '../scan-auto-save.mjs';
import {SCAN_UPLOAD_MAX_WIDTH,SCAN_UPLOAD_MAX_HEIGHT} from '../src/scan-upload-image.mjs';

const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
const pageSource=source.slice(source.indexOf('async function* pages('),source.indexOf('\nconst uploadPageCount='));
function pageHarness({renderError=false,encodeError=false}={}){
 const canvases=[],cleaned=[],destroyed=[];
 const scope={SCAN_UPLOAD_MAX_WIDTH,SCAN_UPLOAD_MAX_HEIGHT,aborted:()=>new DOMException('Upload aborted.','AbortError'),scanUploadType:()=> 'application/pdf',
  document:{createElement:()=>{const canvas={width:0,height:0,getContext:()=>({})};canvases.push(canvas);return canvas;}},
  encodeScanCanvas:async canvas=>{assert.equal(canvas.width,1500);assert.equal(canvas.height,2000);if(encodeError)throw Error('encode failed');return new Blob(['encoded']);}};
 const pages=new Function(...Object.keys(scope),pageSource+';return pages;')(...Object.values(scope));
 const session={take:async file=>({task:{destroy:async()=>destroyed.push(file.name)},doc:{numPages:3,getPage:async number=>({getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:renderError?Promise.reject(Error('render failed')):Promise.resolve()}),cleanup:()=>cleaned.push(file.name+':'+number)})}})};
 return {pages,session,canvases,cleaned,destroyed};
}

test('successive PDF pages release render buffers before each encoded image waits for upload',async()=>{
 const app=pageHarness();
 for(const name of ['first.pdf','second.pdf','third.pdf','fourth.pdf']){
  let page=0;
  for await(const result of app.pages({name},null,app.session)){
   page++;assert.equal(result.name,name+' · page '+page);assert.equal(result.rendered,true);
   assert.ok(app.cleaned.includes(name+':'+page),'page data is released before yielding');
   assert.ok(app.canvases.every(canvas=>canvas.width===0&&canvas.height===0),'no rendered canvas remains alive while the image uploads');
  }
 }
 assert.equal(app.cleaned.length,12);assert.equal(app.destroyed.length,4);
});

test('PDF buffers and documents are released on render failure, encoding failure and early abort',async()=>{
 for(const mode of ['renderError','encodeError','abort','return']){
  const app=pageHarness({[mode]:true}),controller=new AbortController(),iterator=app.pages({name:mode},controller.signal,app.session);
  if(mode.endsWith('Error'))await assert.rejects(iterator.next(),/failed/);
  else{await iterator.next();if(mode==='abort'){controller.abort();await assert.rejects(iterator.next(),/Upload aborted/);}else await iterator.return();}
  assert.equal(app.cleaned.length,1);assert.deepEqual(app.destroyed,[mode]);assert.ok(app.canvases.every(canvas=>!canvas.width&&!canvas.height));
 }
});

test('only background polls during uploads use unchecked progress; final and normal reads remain full',async()=>{
 const line=source.split('\n').find(line=>line.startsWith(' const load=async(id,fresh=true)'));
 const paths=[],noop=()=>{},uploadingRef={current:true};let rows=[];
 const scope={batchLoads:{current:new Map()},uploadingRef,activeRef:{current:'batch'},vlbBatch:null,
  api:async path=>{paths.push(path);return {batch:{id:'batch'},cards:[{id:'card',status:'review',revision:1,checks:path.includes('?progress=1')?null:{errors:['Needs review']},draft:{},raw_fields:{}}]};},
  setConnectionError:noop,setBatch:noop,setContextGate:noop,setStorage:noop,setReader:noop,setCards:fn=>rows=fn(rows),setSelected:noop,
  chooseScanCard:noop,window:{location:{search:''}},dirtyRef:{current:false}};
 const load=new Function(...Object.keys(scope),line.trim()+';return load;')(...Object.values(scope));
 await load('batch',false);assert.equal(rows[0].checks,null);assert.equal(canAutoSaveScanCard(rows[0],'vehicle'),false);
 await load('batch');assert.ok(rows[0].checks);
 uploadingRef.current=false;await load('batch',false);
 assert.deepEqual(paths,['/api/scan-batches/batch?progress=1','/api/scan-batches/batch','/api/scan-batches/batch']);
});

test('elapsed timer updates its own component once per second and clears the interval',async()=>{
 const timerSource=readFileSync(new URL('../src/scan-upload-timer.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
 const {code}=await transformWithOxc(timerSource,'scan-upload-timer.jsx',{jsx:{runtime:'classic'}});
 let now=2000,elapsed,cleanup,tick,interval,cleared=false,updates=0;
 const scope={React,performance:{now:()=>now},formatExtractionTime:seconds=>Math.floor(seconds)+' sec',
  useState:initial=>{elapsed??=initial();return [elapsed,value=>{elapsed=value;updates++;}];},
  useEffect:fn=>{if(!cleanup)cleanup=fn();},setInterval:(fn,ms)=>{tick=fn;interval=ms;return 1;},clearInterval:id=>{assert.equal(id,1);cleared=true;}};
 const Timer=new Function(...Object.keys(scope),code+';return ScanUploadTimer;')(...Object.values(scope));
 let view=Timer({started:2000});assert.equal(view.props.children.at(-1),'0 sec');assert.equal(interval,1000);
 now=8000;tick();view=Timer({started:2000});assert.equal(view.props.children.at(-1),'6 sec');assert.equal(updates,2);
 cleanup();assert.equal(cleared,true);
 const parent=source.slice(source.indexOf('export default function BulkCardScanning'));
 assert.match(parent,/<ScanUploadTimer started=\{uploadStarted.current\}\/>/);
 assert.doesNotMatch(parent,/setUploadElapsed/,'timer state must not trigger the parent card validations');
});
