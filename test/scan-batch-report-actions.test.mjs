import {isDeletableScanCard,isAbortableScanCard} from '../src/scan-card-deletion-selection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {scanBatchReport,scanBatchReportTables} from '../shared/scan-batch-report.mjs';
import {scanReportCardStatus,CARD_STATUS_LEGEND} from '../src/scan-report-card-status.mjs';
const source=readFileSync(new URL('../src/scan-batch-report.jsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replace('export default function','function'),'scan-batch-report.jsx',{jsx:{runtime:'classic'}});
const Component=new Function('React','useState','scanBatchReport','scanBatchReportTables','scanReportCardStatus','CARD_STATUS_LEGEND','isDeletableScanCard','isAbortableScanCard',code+';return ScanBatchReport')(React,initial=>[initial,()=>{}],scanBatchReport,scanBatchReportTables,scanReportCardStatus,CARD_STATUS_LEGEND,isDeletableScanCard,isAbortableScanCard);
const nodes=(tree,type)=>{const result=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(node.type===type)result.push(node);visit(node.props.children)};visit(tree);return result};
const batch={id:'11111111-1111-4111-a111-111111111111',name:'Scan entry',kind:'vehicle'};
const cards=['review','approved','error','rejected','reading','queued','posted'].map((status,index)=>({id:'card-'+index,batch_id:batch.id,ordinal:index+1,revision:3,status,filename:'page.png',draft:{bookDate:'2026-11-01',location:'Dudhichua OB',cardShift:'I',doorText:'V/559'},...(status==='posted'?{logbook_id:9}:{}),checks:{errors:[]}}));
for(const kind of ['vehicle','equipment'])test(kind+' scan table aborts reading and sends the exact unsaved row to OTP deletion',()=>{
 const deleted=[];let aborted=0;
 const tree=Component({batch:{...batch,kind},cards,onAbort:()=>aborted++,onDeleteCard:card=>deleted.push(card)});
 const buttons=nodes(tree,'button'),abort=buttons.find(button=>button.props.children==='Abort scanning');assert.equal(abort.props.disabled,false);abort.props.onClick();assert.equal(aborted,1);
 const deletes=buttons.filter(button=>button.props.children==='Delete card');assert.equal(deletes.length,cards.length);
 for(let i=0;i<cards.length;i++){assert.equal(Boolean(deletes[i].props.disabled),i>=4);deletes[i].props.onClick();}
 assert.deepEqual(deleted,cards.slice(0,4));
 const html=renderToStaticMarkup(tree);assert.match(html,/scan-report-card-actions/);assert.match(html,/WhatsApp OTP verification/);
});
test('read-only reports have no mutation controls; busy or dirty state disables deletion',()=>{
 const report=Component({batch,cards});assert.ok(!nodes(report,'button').some(button=>['Delete card','Abort scanning'].includes(button.props.children)));
 let called=false;const blocked=Component({batch,cards,onAbort:()=>{},abortDisabled:true,onDeleteCard:()=>called=true,actionsDisabled:true});
 const buttons=nodes(blocked,'button');assert.equal(buttons.find(button=>button.props.children==='Abort scanning').props.disabled,true);
 for(const button of buttons.filter(button=>button.props.children==='Delete card')){assert.equal(button.props.disabled,true);button.props.onClick();}assert.equal(called,false);
});
for(const kind of ['vehicle','equipment'])test(kind+' multi-select tracks visible eligible cards, clears selection and drops stale revisions',()=>{
 const slots=[];let cursor=0;const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};
 const Stateful=new Function('React','useState','scanBatchReport','scanBatchReportTables','scanReportCardStatus','CARD_STATUS_LEGEND','isDeletableScanCard','isAbortableScanCard',code+';return ScanBatchReport')(React,useState,scanBatchReport,scanBatchReportTables,scanReportCardStatus,CARD_STATUS_LEGEND,isDeletableScanCard,isAbortableScanCard);
 const requests=[],members=cards.map((card,i)=>({...card,draft:{...card.draft,aFormNo:i===0?'FINDME':'OTHER'+i,jobCardNo:i===0?'FINDME':'OTHER'+i}}));const props={batch:{...batch,kind},cards:members,onDeleteCard:()=>{},onDeleteCards:items=>requests.push(items)};const render=()=>{cursor=0;return Stateful(props)};
 const get=(tree,type,label)=>nodes(tree,type).find(node=>node.props['aria-label']===label);const selectedButton=tree=>nodes(tree,'button').find(button=>Array.isArray(button.props.children)&&button.props.children[0]==='Delete selected (');
 let tree=render();assert.equal(selectedButton(tree).props.disabled,true);
 const checks=nodes(tree,'input').filter(n=>String(n.props['aria-label']||'').startsWith('Select card '));assert.deepEqual(checks.map(n=>Boolean(n.props.disabled)),[false,false,false,false,true,true,true]);
 checks[0].props.onChange({target:{checked:true}});tree=render();checks[2].props.onChange({target:{checked:true}});tree=render();selectedButton(tree).props.onClick();assert.deepEqual(requests[0], [members[0],members[2]]);
 get(tree,'input','Select all visible unsaved cards').props.onChange({target:{checked:true}});tree=render();assert.equal(selectedButton(tree).props.children[1],4);
 nodes(tree,'button').find(n=>n.props.children==='Clear selection').props.onClick();tree=render();assert.equal(selectedButton(tree).props.disabled,true);
 get(tree,'input','Search batch report').props.onChange({target:{value:'FINDME'}});tree=render();get(tree,'input','Select all visible unsaved cards').props.onChange({target:{checked:true}});tree=render();selectedButton(tree).props.onClick();assert.deepEqual(requests.at(-1),[members[0]],'select all applies only to the filtered visible rows');
 members[0]={...members[0],revision:99};tree=render();assert.equal(selectedButton(tree).props.disabled,true,'a changed card requires a fresh selection');
 props.actionsDisabled=true;tree=render();assert.equal(get(tree,'input','Select all visible unsaved cards').props.disabled,true);
});
for(const kind of ['vehicle','equipment'])test(kind+' abort selection stays selected through OCR progress and never enables deletion of processing cards',()=>{
 const slots=[];let cursor=0;const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};
 const Stateful=new Function('React','useState','scanBatchReport','scanBatchReportTables','scanReportCardStatus','CARD_STATUS_LEGEND','isDeletableScanCard','isAbortableScanCard',code+';return ScanBatchReport')(React,useState,scanBatchReport,scanBatchReportTables,scanReportCardStatus,CARD_STATUS_LEGEND,isDeletableScanCard,isAbortableScanCard);
 const members=cards.map(card=>({...card})),aborts=[],deletes=[];const props={batch:{...batch,kind},cards:members,onDeleteCard:()=>{},onDeleteCards:items=>deletes.push(items),onAbortCards:items=>aborts.push(items)};const render=()=>{cursor=0;return Stateful(props)};const pick=(tree,label)=>nodes(tree,'input').find(node=>node.props['aria-label']===label);const action=(tree,label)=>nodes(tree,'button').find(node=>Array.isArray(node.props.children)&&node.props.children[0]===label+' (');
 let tree=render();assert.equal(pick(tree,'Select card 7').props.disabled,true);assert.equal(pick(tree,'Select card 5').props.disabled,false);assert.equal(pick(tree,'Select card 6').props.disabled,false);pick(tree,'Select card 5').props.onChange({target:{checked:true}});pick(tree,'Select card 6').props.onChange({target:{checked:true}});tree=render();assert.equal(action(tree,'Abort selected').props.disabled,false);assert.equal(action(tree,'Delete selected').props.disabled,true);action(tree,'Delete selected').props.onClick();assert.equal(deletes.length,0);
 members[4]={...members[4],revision:30};members[5]={...members[5],revision:31,status:'reading'};tree=render();assert.equal(pick(tree,'Select card 5').props.checked,true);assert.equal(pick(tree,'Select card 6').props.checked,true);action(tree,'Abort selected').props.onClick();assert.deepEqual(aborts[0],[members[4],members[5]]);
 pick(tree,'Select card 1').props.onChange({target:{checked:true}});tree=render();assert.equal(action(tree,'Abort selected').props.disabled,true);assert.equal(action(tree,'Delete selected').props.disabled,true);assert.match(renderToStaticMarkup(tree),/Select only queued\/processing cards to abort/);
 nodes(tree,'button').find(node=>node.props.children==='Clear selection').props.onClick();tree=render();pick(tree,'Select card 5').props.onChange({target:{checked:true}});members[4]={...members[4],status:'review',revision:32};tree=render();assert.equal(pick(tree,'Select card 5').props.checked,false,'a finished card must not become selected for deletion automatically');assert.equal(action(tree,'Abort selected').props.disabled,true);
 members[4]={...members[4],status:'reading'};props.actionsDisabled=true;props.selectionDisabled=false;tree=render();assert.equal(pick(tree,'Select card 5').props.disabled,false,'uploads can continue while pending cards are selected');pick(tree,'Select card 5').props.onChange({target:{checked:true}});tree=render();assert.equal(action(tree,'Abort selected').props.disabled,false);props.selectionDisabled=true;tree=render();assert.equal(action(tree,'Abort selected').props.disabled,true);
});
