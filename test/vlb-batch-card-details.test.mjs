import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {renderToStaticMarkup} from 'react-dom/server';
import {requestedMisPage} from '../src/mis-navigation.mjs';
async function compile(file,name,bindings){const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');const {code}=await transformWithOxc(source,file,{jsx:{runtime:'classic'}});return new Function(...Object.keys(bindings),code+';return '+name)(...Object.values(bindings));}
test('Saved VLB legacy links lead to site batches; ELB remains separate',async()=>{
 assert.equal(requestedMisPage('?page=vlb-saved'),'Create VLB Batch');assert.equal(requestedMisPage('?page=elb-saved'),'Saved ELB');
 const Choice=await compile('log-book-mode-choice.jsx','LogBookModeChoice',{React,BookOpen:()=>null,Keyboard:()=>null,ScanLine:()=>null});
 const vehicle=renderToStaticMarkup(React.createElement(Choice,{kind:'vehicle'}));assert.match(vehicle,/Site batches/);assert.doesNotMatch(vehicle,/Saved VLB/);assert.match(renderToStaticMarkup(React.createElement(Choice,{kind:'equipment'})),/Saved ELB/);
});
test('batch details only show a member snapshot and gate its editor',async()=>{
 let editing=false;const Editor=()=>null,Details=()=>null;
 const Component=await compile('vlb-batch-card-details.jsx','VlbBatchCardDetails',{React,useEffect:()=>{},useState:initial=>[typeof initial==='boolean'?editing:initial,v=>editing=typeof v==='function'?v(editing):v],SavedLogBookDetails:Details,LogBookForm:Editor,PulseTripVerification:()=>null});
 const record={id:7,book_no:'VLB7',data:{}},batch={id:'batch1',name:'SITE/B01',records:[record]};
 assert.equal(Component({session:{},batch,record:{id:8}}),null);
 let tree=Component({session:{},batch,record,canEdit:false});assert.match(renderToStaticMarkup(tree),/SITE\/B01/);assert.doesNotMatch(renderToStaticMarkup(tree),/Edit this VLB/);
 editing=true;tree=Component({session:{},batch,record,canEdit:true});const editor=tree.props.children.find(child=>child?.type===Editor);assert.equal(editor.props.initialRecord,record);assert.equal(editor.props.vlbBatch,batch);
 editing=true;tree=Component({session:{},batch,record,canEdit:false});assert.equal(tree.props.children.some(child=>child?.type===Editor),false);
});
