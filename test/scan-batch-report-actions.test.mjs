import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {scanBatchReport,scanBatchReportTables} from '../scan-batch-report.mjs';
import {scanReportCardStatus,CARD_STATUS_LEGEND} from '../src/scan-report-card-status.mjs';
const source=readFileSync(new URL('../src/scan-batch-report.jsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replace('export default function','function'),'scan-batch-report.jsx',{jsx:{runtime:'classic'}});
const Component=new Function('React','useState','scanBatchReport','scanBatchReportTables','scanReportCardStatus','CARD_STATUS_LEGEND',code+';return ScanBatchReport')(React,initial=>[initial,()=>{}],scanBatchReport,scanBatchReportTables,scanReportCardStatus,CARD_STATUS_LEGEND);
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
