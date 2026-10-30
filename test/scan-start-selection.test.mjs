import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {registerLocalDocumentScanning} from '../local-document-scanning.mjs';
import React from 'react';import {transformWithOxc} from 'vite';import {readFileSync} from 'node:fs';
import {parseScanContext} from '../scan-batch-context.mjs';
const expectedContext={bookDate:'2026-10-30',location:'Sasti OC',cardShift:'I'};
test('scanner start routes reject missing selections before accessing scanner, folder, database or uploads',async t=>{
 const app=express();app.use(express.json());let queries=0;const auth=(req,res,next)=>{req.session={login:'test'};next()};
 registerLocalDocumentScanning(app,{enabled:true,pool:{query:async()=>{queries++;return {rows:[]}}},requireSession:auth,requireAdministrator:auth,inbox:'unused',outputRoot:'unused'});
 const server=app.listen(0);t.after(()=>new Promise(r=>server.close(r)));const root='http://127.0.0.1:'+server.address().port;
 for(const operation of ['capture','folder','files'])for(const value of [undefined,{},...Object.keys(expectedContext).map(key=>({...expectedContext,[key]:''}))]){
  const r=await fetch(root+'/api/local-scanner/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'vehicle',expectedContext:value})});assert.equal(r.status,400);assert.match((await r.json()).error,/date, site and shift/);
 }
 assert.equal(queries,0);
});
test('feeder and folder buttons cannot start without selections, including direct handler calls',async()=>{
 let source=readFileSync(new URL('../src/local-scanner-panel.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');const {code}=await transformWithOxc(source,'local-scanner.jsx',{jsx:{runtime:'classic'}});
 const calls=[],errors=[];const scope={React,parseScanContext,useState:initial=>[initial,value=>{if(typeof value==='string')errors.push(value)}],useRef:v=>({current:v}),useEffect:()=>{},ScanLine:'svg',FolderOpen:'svg',RefreshCw:'svg',Download:'svg',organizationScanners:()=>[],scannerConnectionMessage:()=>'',chooseConnectedScanner:()=>'',readScannerResponse:async r=>r.json(),fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {json:async()=>({id:'test-job'})}}};
 const C=new Function(...Object.keys(scope),code+';return WindowsScannerPanel;')(...Object.values(scope));
 function buttons(node,result=[]){if(!React.isValidElement(node))return result;if(node.type==='button')result.push(node);for(const n of React.Children.toArray(node.props.children))buttons(n,result);return result;}
 const locked=buttons(C({kind:'vehicle',disabled:true}));const feeder=locked.find(b=>React.Children.toArray(b.props.children).some(v=>typeof v==='string'&&v.includes('Scan all cards')));assert.equal(feeder.props.disabled,true);await feeder.props.onClick();assert.equal(calls.length,0);
 const missing=buttons(C({kind:'vehicle',expectedContext:{}}));await missing.find(b=>React.Children.toArray(b.props.children).some(v=>typeof v==='string'&&v.includes('Scan all cards'))).props.onClick();assert.equal(calls.length,0);
 const ready=buttons(C({kind:'vehicle',expectedContext}));await ready.find(b=>React.Children.toArray(b.props.children).some(v=>typeof v==='string'&&v.includes('Scan all cards'))).props.onClick();assert.equal(calls.length,1);assert.deepEqual(calls[0].body.expectedContext,expectedContext);
});
