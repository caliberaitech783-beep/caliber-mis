import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {renderToStaticMarkup} from 'react-dom/server';
import {requestedMisPage} from '../src/mis-navigation.mjs';
async function compile(file,name,bindings){const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');const {code}=await transformWithOxc(source,file,{jsx:{runtime:'classic'}});return new Function(...Object.keys(bindings),code+';return '+name)(...Object.values(bindings));}
test('Saved VLB and Saved ELB legacy links lead to site batches',async()=>{
 assert.equal(requestedMisPage('?page=vlb-saved'),'Create VLB Batch');assert.equal(requestedMisPage('?page=elb-saved'),'Create VLB Batch');
 const Choice=await compile('log-book-mode-choice.jsx','LogBookModeChoice',{React,BookOpen:()=>null,Keyboard:()=>null,ScanLine:()=>null});
 const vehicle=renderToStaticMarkup(React.createElement(Choice,{kind:'vehicle'}));assert.match(vehicle,/Site batches/);assert.doesNotMatch(vehicle,/Saved VLB/);const equipment=renderToStaticMarkup(React.createElement(Choice,{kind:'equipment'}));assert.match(equipment,/Site batches/);assert.doesNotMatch(equipment,/Saved ELB/);assert.match(equipment,/close and lock ELB/);
});
test('batch details only show a member snapshot and gate its editor',async()=>{
 let editing=false;const Editor=()=>null,Details=()=>null;
 const Component=await compile('vlb-batch-card-details.jsx','VlbBatchCardDetails',{React,useEffect:()=>{},useState:initial=>[typeof initial==='boolean'?editing:initial,v=>editing=typeof v==='function'?v(editing):v],StepBackButton:()=>null,SavedLogBookDetails:Details,LogBookForm:Editor,PulseTripVerification:()=>null});
 const record={id:7,book_no:'VLB7',data:{}},batch={id:'batch1',name:'SITE/B01',records:[record]};
 assert.equal(Component({session:{},batch,record:{id:8}}),null);
 let tree=Component({session:{},batch,record,canEdit:false});assert.match(renderToStaticMarkup(tree),/SITE\/B01/);assert.doesNotMatch(renderToStaticMarkup(tree),/Edit this VLB/);
 editing=true;tree=Component({session:{},batch,record,canEdit:true});const editor=tree.props.children.find(child=>child?.type===Editor);assert.equal(editor.props.initialRecord,record);assert.equal(editor.props.vlbBatch,batch);
 editing=true;tree=Component({session:{},batch,record,canEdit:false});assert.equal(tree.props.children.some(child=>child?.type===Editor),false);
});

test('viewing a batch card reveals and focuses its details with a return action',async()=>{
 const effects=[],calls=[],StepBack=()=>null;
 const node={scrollIntoView:options=>calls.push(['scroll',options]),focus:options=>calls.push(['focus',options])};
 const Component=await compile('vlb-batch-card-details.jsx','VlbBatchCardDetails',{React,useEffect:fn=>effects.push(fn),useState:initial=>[initial,()=>{}],document:{getElementById:id=>id==='vlb-selected-card-details'?node:null},StepBackButton:StepBack,SavedLogBookDetails:()=>null,LogBookForm:()=>null,PulseTripVerification:()=>null});
 const record={id:7,book_no:'VLB7',data:{}},batch={name:'SITE/B01',records:[record]};let closed=false;
 const tree=Component({session:{},batch,record,onClose:()=>closed=true});
 effects[0]();
 assert.deepEqual(calls,[['scroll',{block:'start'}],['focus',{preventScroll:true}]]);
 assert.equal(tree.props.tabIndex,-1);
 const back=tree.props.children.find(child=>child?.type===StepBack);assert.equal(back.props.label,'Back to batch report');back.props.onBack();assert.equal(closed,true);
});

test('ELB trip card picker lists only matching cards and exposes saved trips without a scan',async()=>{
 const {tripSerialNumber}=await import('../shared/log-book-labels.mjs');
 let selected='';
 const Component=await compile('elb-trip-cards.jsx','ElbTripCards',{React,useEffect:()=>{},useState:initial=>initial===''?[selected,value=>selected=value]:[initial,()=>{}],tripSerialNumber});
 const matching={id:7,book_no:'VLB/7',data:{door:'TIPPER-7',timeMode:'without',trips:[{equipmentName:'Other loader',tripCount:9},{equipmentName:'Loader 19',tripCount:2}]}};
 const batch={records:[matching,{id:8,book_no:'VLB/8',data:{}}],elbTripCardRows:{19:{7:[1]}}};
 const props={batch,equipment:{asset_id:19},token:'test'};
 const tree=Component(props);
 assert.match(renderToStaticMarkup(tree),/VLB\/7/);
 assert.doesNotMatch(renderToStaticMarkup(tree),/VLB\/8|Loader 19/);
 tree.props.children[1].props.children[0].props.children[0].props.onClick();
 const html=renderToStaticMarkup(Component(props));
 assert.match(html,/Loader 19/);
 assert.match(html,/No original scan was saved for this trip card/);
 assert.doesNotMatch(html,/Other loader|VLB\/8/);
 assert.match(renderToStaticMarkup(Component({...props,equipment:{asset_id:20}})),/No VLB trip cards in this batch/);
});
