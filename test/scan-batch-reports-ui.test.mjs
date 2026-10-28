import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {transformWithOxc} from 'vite';
const source=readFileSync(new URL('../src/scan-batch-reports.jsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function'),'scan-batch-reports.jsx',{jsx:{runtime:'classic'}});
const id1='11111111-1111-4111-a111-111111111111',id2='22222222-2222-4222-a222-222222222222',elb='33333333-3333-4333-a333-333333333333';
const nodes=(tree,type)=>{const rows=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(node.type===type)rows.push(node);visit(node.props.children)};visit(tree);return rows};
function harness(batches,search=''){
 const slots=[],effects=[],calls=[],urls=[];let cursor=0,effectCursor=0,pending=[];
 const SmartSelect=props=>React.createElement('select',props),ScanBatchReport=()=>null;
 const scope={React,SmartSelect,ScanBatchReport,window:{location:{search,href:'https://pulse-ll.cmll.in/'+search},history:{replaceState:(a,b,url)=>urls.push(url)}},
  useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]},
  useEffect:(fn,deps)=>{const i=effectCursor++,prior=effects[i];if(!prior||deps.some((v,n)=>v!==prior.deps[n]))pending.push(()=>{prior?.cleanup?.();effects[i]={deps,cleanup:fn()}})},setInterval:()=>1,clearInterval:()=>{},
  fetch:async(url,options)=>{calls.push({url,options});const body=url==='/api/scan-batches'?{batches}:{batch:batches.find(b=>b.id===url.split('/').at(-1)),cards:[{id:'card',batch_id:url.split('/').at(-1)}]};return {ok:true,json:async()=>body}}};
 const components=new Function(...Object.keys(scope),code+';return {ScanBatchReports,initialReportBatch,reportBatchUrl}')(...Object.values(scope));
 const render=(kind='vehicle')=>{cursor=0;effectCursor=0;pending=[];return components.ScanBatchReports({kind,session:{token:'test'}})};
 const flush=async(kind='vehicle')=>{let tree;for(let i=0;i<4;i++){tree=render(kind);for(const effect of pending)effect();await new Promise(r=>setImmediate(r));}return render(kind)};
 return {...components,render,flush,slots,calls,urls,SmartSelect,ScanBatchReport};
}
const batches=[{id:id1,kind:'vehicle',name:'Latest VLB batch',created_at:'2026-10-28',cards:2},{id:id2,kind:'vehicle',name:'Earlier VLB batch',created_at:'2026-10-27',cards:5},{id:elb,kind:'equipment',name:'ELB batch',created_at:'2026-10-28',cards:1}];
test('permanent report screen loads only matching batches, defaults to latest and switches the exact report',async()=>{
 const app=harness(batches,'?page=vlb-reports'),tree=await app.flush();
 assert.equal(nodes(tree,app.ScanBatchReport)[0].props.batch.id,id1);
 assert.deepEqual(nodes(tree,'option').map(n=>n.props.value),['',id1,id2]);
 nodes(tree,app.SmartSelect)[0].props.onChange({target:{value:id2}});
 assert.equal(nodes(app.render(),app.ScanBatchReport)[0].props.batch,null,'stale report is hidden during a batch switch');
 const next=await app.flush();assert.equal(nodes(next,app.ScanBatchReport)[0].props.batch.id,id2);assert.equal(nodes(next,app.ScanBatchReport)[0].props.cards[0].batch_id,id2);
 assert.ok(app.urls.at(-1).includes('batch='+id2));assert.ok(app.calls.every(c=>!c.options.method||c.options.method==='GET'),'reports must never start scanning or save cards');
});
test('reports page remains available without cards and direct links preserve a batch safely',async()=>{
 const empty=harness([],'?page=vlb-reports'),tree=await empty.flush();assert.match(renderToStaticMarkup(tree),/VLB Reports/);assert.match(renderToStaticMarkup(tree),/No scan\/upload batches yet/);
 const app=harness(batches,'?page=elb-reports&batch='+elb),report=await app.flush('equipment');assert.equal(nodes(report,app.ScanBatchReport)[0].props.batch.id,elb);assert.deepEqual(nodes(report,'option').map(n=>n.props.value),['',elb]);
 assert.equal(app.initialReportBatch('?batch=../../invalid'),'');assert.equal(app.initialReportBatch('?batch='+id1),id1);
 assert.equal(app.reportBatchUrl('https://pulse-ll.cmll.in/?page=vlb-reports&card=old&filter=review',id1),'/?page=vlb-reports&batch='+id1);
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');assert.ok(main.includes("{name:'Reports',pages:[...['VLB Reports','ELB Reports','Card Report'].filter(canOpenAdminPage)") && main.includes("reportCategory:'operations-'+r.id"));
});
