import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import React from 'react';import{transformWithOxc}from'vite';import{misDatabaseConfig}from'../mis-database-config.mjs';
test('scanner bridge rejects untrusted origin/window/nonce and uploads trusted pages to review only',async()=>{
 const src=readFileSync(new URL('../src/cloud-scanner-panel.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');const {code}=await transformWithOxc(src,'cloud-scanner.jsx',{jsx:{runtime:'classic'}});
 const effects=[],requests=[],messages=[];let listener,nonce,opened,review;
 const popup={closed:false,postMessage:(v,origin)=>messages.push({v,origin})};
 const window={location:{origin:'https://pulse-ll.cmll.in'},addEventListener:(_,f)=>listener=f,removeEventListener:()=>{},open:url=>{opened=url;nonce=new URL(url).hash.slice(1);nonce=new URLSearchParams(nonce).get('nonce');return popup}};
 const scope={React,useState:v=>[v,()=>{}],useEffect:f=>effects.push(f),useRef:v=>({current:v}),window,fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({id:'test-batch'})}}};
 const C=new Function(...Object.keys(scope),code+';return CloudScannerPanel;')(...Object.values(scope));const tree=C({kind:'vehicle',token:'synthetic-online-token',onBatch:id=>review=id});effects[0]();
 function find(node){if(!React.isValidElement(node))return;if(node.type==='button')return node;for(const n of React.Children.toArray(node.props.children)){const found=find(n);if(found)return found;}}
 find(tree).props.onClick();assert.match(opened,/^http:\/\/127.0.0.1:4174\/scanner-connector.html#/);
 const d={type:'scanner-page',nonce,cardId:'11111111-1111-4111-a111-111111111111',base64:'AAAA',filename:'page.png'};
 for(const e of [{origin:'https://evil.example',source:popup,data:d},{origin:'http://127.0.0.1:4174',source:{},data:d},{origin:'http://127.0.0.1:4174',source:popup,data:{...d,nonce:'wrong'}}])await listener(e);
 assert.equal(requests.length,0);await listener({origin:'http://127.0.0.1:4174',source:popup,data:d});assert.equal(requests.length,2);assert.equal(requests[1].url,'/api/scan-batches/test-batch/cards');assert.equal(messages[0].v.type,'scanner-ack');assert.doesNotMatch(JSON.stringify(messages),/synthetic-online-token/);
 await listener({origin:'http://127.0.0.1:4174',source:popup,data:{type:'scanner-complete',nonce}});assert.equal(review,'test-batch');assert.ok(requests.every(r=>!r.url.endsWith('/post')));
});
test('local scanner database opt-in cannot select a remote or Pulse database',()=>{
 assert.equal(misDatabaseConfig({MIS_LOCAL_SCANNER_DATABASE:'true',DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1/caliber_erp'}).ssl,false);
 for(const host of ['evil.example','server.postgres.database.azure.com'])assert.throws(()=>misDatabaseConfig({MIS_LOCAL_SCANNER_DATABASE:'true',DATABASE_URL:`postgresql://synthetic:synthetic@${host}/caliber_erp`}));
 assert.throws(()=>misDatabaseConfig({DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1/caliber_erp'}));
});
