import {parseScanContext} from '../scan-batch-context.mjs';
import {parseCaptureTiming,scanTimingLabel} from '../public/scan-timing.mjs';
import {checkScannerAvailability,SCANNER_UNAVAILABLE} from '../src/scanner-availability.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import React from 'react';import{transformWithOxc}from'vite';import{misDatabaseConfig}from'../mis-database-config.mjs';
test('scanner bridge rejects untrusted origin/window/nonce and uploads trusted pages to review only',async()=>{
 const src=readFileSync(new URL('../src/cloud-scanner-panel.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');const {code}=await transformWithOxc(src,'cloud-scanner.jsx',{jsx:{runtime:'classic'}});
 const effects=[],requests=[],messages=[];let listener,nonce,opened,review;
 const popup={closed:false,location:{href:""},close:()=>{},postMessage:(v,origin)=>messages.push({v,origin})};
 const window={location:{origin:'https://pulse-ll.cmll.in'},addEventListener:(_,f)=>listener=f,removeEventListener:()=>{},open:url=>{opened=url;return popup}};
 let available=false;const errors=[];let closed=0;popup.close=()=>{closed++};
 const scope={parseScanContext,setInterval:()=>0,clearInterval:()=>{},checkScannerAvailability:async()=>{if(!available)throw Error(SCANNER_UNAVAILABLE)},parseCaptureTiming,scanTimingLabel,React,useState:v=>[v,value=>{if(typeof value==='string')errors.push(value)}],useEffect:f=>effects.push(f),useRef:v=>({current:v}),window,fetch:async(url,options)=>{requests.push({url,contentType:options.headers['Content-Type'],body:options.headers['Content-Type'].startsWith('image/')?JSON.parse(decodeURIComponent(options.headers['X-Scan-Metadata'])):JSON.parse(options.body),image:options.headers['Content-Type'].startsWith('image/')?options.body:undefined});return {ok:true,json:async()=>(url==='/api/scanner-connector/ticket'?{ticket:'a'.repeat(64)}:{id:'test-batch'})}}};
 const C=new Function(...Object.keys(scope),code+';return CloudScannerPanel;')(...Object.values(scope));const tree=C({expectedContext:{bookDate:'2026-10-30',location:'Sasti OC',cardShift:'I'},kind:'vehicle',token:'synthetic-online-token',onBatch:id=>review=id});effects[0]();
 function find(node,direct=false){if(!React.isValidElement(node))return;if(node.type==='button'&&(direct?node.props.children==='Open installed connector directly':node.props.children!=='Open installed connector directly'))return node;for(const n of React.Children.toArray(node.props.children)){const found=find(n,direct);if(found)return found;}}
 await find(tree).props.onClick();assert.equal(closed,1);assert.equal(popup.location.href,'');assert.equal(requests.length,0);assert.ok(errors.includes(SCANNER_UNAVAILABLE));
 // A browser-blocked probe must not prevent top-level access to an installed
 // connector. The direct path must still request its normal one-use ticket.
 await find(tree,true).props.onClick();assert.equal(available,false);assert.equal(opened,'about:blank');assert.match(popup.location.href,/^http:\/\/127.0.0.1:4174\/scanner-connector.html#/);nonce=new URLSearchParams(new URL(popup.location.href).hash.slice(1)).get('nonce');assert.equal(requests[0].url,'/api/scanner-connector/ticket');assert.deepEqual(requests[0].body.expectedContext,{bookDate:'2026-10-30',location:'Sasti OC',cardShift:'I'});assert.equal(new URLSearchParams(new URL(popup.location.href).hash.slice(1)).get('ticket'),'a'.repeat(64));requests.length=0;
 const d={type:'scanner-page',nonce,cardId:'11111111-1111-4111-a111-111111111111',base64:'AAAA',filename:'page.png',captureTiming:{mode:'scanner',pages:14,durationMs:95000},paddleEvidence:{version:1,provider:'paddleocr',imageHash:'synthetic'}};
 for(const e of [{origin:'https://evil.example',source:popup,data:d},{origin:'http://127.0.0.1:4174',source:{},data:d},{origin:'http://127.0.0.1:4174',source:popup,data:{...d,nonce:'wrong'}}])await listener(e);
 assert.equal(requests.length,0);await listener({origin:'http://127.0.0.1:4174',source:popup,data:d});assert.equal(requests.length,2);assert.equal(requests[1].url,'/api/scan-batches/test-batch/cards');assert.deepEqual(requests[1].body.paddleEvidence,d.paddleEvidence);assert.deepEqual(requests[1].body.captureTiming,d.captureTiming);assert.equal(messages[0].v.type,'scanner-ack');assert.doesNotMatch(JSON.stringify(messages),/synthetic-online-token/);
 const bytes=Uint8Array.of(1,2,3).buffer;await listener({origin:'http://127.0.0.1:4174',source:popup,data:{...d,bytes,base64:undefined,cardId:'22222222-2222-4222-a222-222222222222'}});assert.equal(requests.length,3);assert.equal(requests[2].image,bytes);assert.equal(requests[2].body.base64,undefined);assert.equal(messages.at(-1).v.error,undefined);
 const jpeg=Uint8Array.of(255,216,255,217).buffer;await listener({origin:'http://127.0.0.1:4174',source:popup,data:{...d,bytes:jpeg,base64:undefined,filename:'page.jpg',cardId:'33333333-3333-4333-a333-333333333333'}});assert.equal(requests.at(-1).contentType,'image/jpeg');assert.equal(requests.at(-1).image,jpeg);
 await listener({origin:'http://127.0.0.1:4174',source:popup,data:{type:'scanner-complete',nonce}});assert.equal(review,'test-batch');assert.ok(requests.every(r=>!r.url.endsWith('/post')));
});
test('scanner reachability handles missing services and browser permission denial without navigating',async()=>{
 for(const failure of [Error('Connection refused'),new DOMException('Permission denied','NotAllowedError'),new DOMException('Timed out','TimeoutError')]){
  await assert.rejects(checkScannerAvailability(async()=>{throw failure}),{message:SCANNER_UNAVAILABLE});
 }
 await assert.rejects(checkScannerAvailability(async()=>({ok:false,type:'basic'})),{message:SCANNER_UNAVAILABLE});
 let checked=false;await checkScannerAvailability(async(url,options)=>{assert.equal(url,'http://127.0.0.1:4174/scanner-ready.txt');assert.equal(options.mode,'no-cors');assert.equal(options.redirect,'follow','Cross-origin no-cors requests fail with redirect:error before reaching the service');assert.equal(options.credentials,'omit');assert.equal(options.targetAddressSpace,'loopback');assert.ok(options.signal instanceof AbortSignal);checked=true;return {type:'opaque',ok:false}});assert.ok(checked);
 assert.equal(readFileSync(new URL('../public/scanner-ready.txt',import.meta.url),'utf8').trim(),'caliber-pc-scanner-ready');
});
test('local scanner database opt-in cannot select a remote or Pulse database',()=>{
 assert.equal(misDatabaseConfig({MIS_LOCAL_SCANNER_DATABASE:'true',DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1/caliber_erp'}).ssl,false);
 for(const host of ['evil.example','server.postgres.database.azure.com'])assert.throws(()=>misDatabaseConfig({MIS_LOCAL_SCANNER_DATABASE:'true',DATABASE_URL:`postgresql://synthetic:synthetic@${host}/caliber_erp`}));
 assert.throws(()=>misDatabaseConfig({DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1/caliber_erp'}));
});
