import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc} from 'vite';

const source=readFileSync(new URL('../src/vlb-batch-reports.jsx',import.meta.url),'utf8');
const stripped=source.replace(/^import .*;\r?\n/gm,'').replace('export default function','function').replaceAll('export const ','const ');
const {code}=await transformWithOxc(stripped,'vlb-batch-reports.jsx',{jsx:{runtime:'classic'}});
const nodes=(tree,type)=>{const rows=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(node.type===type)rows.push(node);visit(node.props.children)};visit(tree);return rows};
const text=tree=>{const out=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(typeof node==='string'||typeof node==='number')return out.push(String(node));if(React.isValidElement(node))visit(node.props.children)};visit(tree);return out.join('')};

function harness(batches,{denied=''}={}){
 const slots=[],effects=[],calls=[];let cursor=0,effectCursor=0,pending=[];
 const SmartSelect=props=>React.createElement('select',props),ScanBatchReports=()=>null,VlbBatchReport=()=>null,VlbBatchCardDetails=()=>null;
 const scope={React,SmartSelect,ScanBatchReports,VlbBatchReport,VlbBatchCardDetails,crypto:{randomUUID:()=>'view-key'},
  useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]},
  useMemo:fn=>fn(),
  useEffect:(fn,deps)=>{const i=effectCursor++,prior=effects[i];if(!prior||deps.some((v,n)=>v!==prior.deps[n]))pending.push(()=>{prior?.cleanup?.();effects[i]={deps,cleanup:fn()}})},
  fetch:async(url,options)=>{calls.push({url,options});if(denied)return {ok:false,json:async()=>({error:denied})};
   const id=url.split('/').at(-1),body=url==='/api/vlb-batches'?{batches}:{...batches.find(b=>b.id===id),records:id==='b-empty'?[]:[{id:7,book_no:'VLB-7',data:{door:'T-01'}},{id:8,book_no:'VLB-8',data:{door:'T-02',scanCardId:'card'}}]};
   return {ok:true,json:async()=>body}}};
 const components=new Function(...Object.keys(scope),code+';return {VlbBatchReports,vlbBatchStatus,defaultVlbReportBatch}')(...Object.values(scope));
 const render=()=>{cursor=0;effectCursor=0;pending=[];return components.VlbBatchReports({session:{token:'test'},ReportSection:()=>null})};
 const flush=async()=>{for(let i=0;i<4;i++){render();for(const effect of pending)effect();await new Promise(r=>setImmediate(r));}return render()};
 return {...components,render,flush,calls,SmartSelect,ScanBatchReports,VlbBatchReport,VlbBatchCardDetails};
}
const batches=[
 {id:'b-empty',name:'Sasti OC 9 Nov Shift II',site:'Sasti OC',report_date:'2026-11-09',shift:'II',entry_count:0,stage:'vlb_open'},
 {id:'b-done',name:'Sasti OC 9 Nov Shift I',site:'Sasti OC',report_date:'2026-11-09',shift:'I',entry_count:2,stage:'elb_open'},
 {id:'b-closed',name:'Gouri 8 Nov Shift I',site:'Gouri',report_date:'2026-11-08',shift:'I',entry_count:5,closed_at:'2026-11-08T12:00:00Z'},
];

test('VLB Reports lists every shift batch and opens the newest one that has saved cards',async()=>{
 const app=harness(batches),tree=await app.flush();
 assert.deepEqual(nodes(tree,'option').map(n=>n.props.value),['','b-empty','b-done','b-closed'],'manual-only and closed shift batches are all listed');
 assert.equal(nodes(tree,app.VlbBatchReport)[0].props.batch.id,'b-done','an empty open batch is not the default');
 assert.equal(nodes(tree,app.VlbBatchReport)[0].props.batch.records.length,2,'scanned and manually entered cards are both in the report');
 assert.match(text(nodes(tree,'option')[2]),/2 VLB · VLB locked · ELB open/);
 assert.equal(app.vlbBatchStatus(batches[2]),'Batch closed');assert.equal(app.vlbBatchStatus(batches[0]),'VLB open');
 assert.equal(app.defaultVlbReportBatch([batches[0]]),'b-empty');assert.equal(app.defaultVlbReportBatch([]),'');
 assert.ok(app.calls.every(call=>!call.options.method&&call.options.headers.Authorization==='Bearer test'),'the report only reads, always with the session token');
});

test('choosing a batch, searching and viewing a card stay inside the read-only report',async()=>{
 const app=harness(batches);let tree=await app.flush();
 nodes(tree,app.SmartSelect)[0].props.onChange({target:{value:'b-empty'}});tree=await app.flush();
 assert.match(text(tree),/No VLB card has been saved in this batch yet/);
 nodes(tree,app.SmartSelect)[0].props.onChange({target:{value:'b-closed'}});tree=await app.flush();
 nodes(tree,app.VlbBatchReport)[0].props.onView({id:8});tree=app.render();
 const details=nodes(tree,app.VlbBatchCardDetails)[0];assert.equal(details.props.record.id,8);assert.equal(details.props.kind,'vehicle');assert.equal(details.props.canEdit,false);
 nodes(tree,'input')[0].props.onChange({target:{value:'gouri'}});tree=app.render();
 assert.deepEqual(nodes(tree,'option').map(n=>n.props.value),['','b-closed']);
});

test('scan / upload batches stay one click away and are the fallback for scan-only logins',async()=>{
 const app=harness(batches);let tree=await app.flush();
 nodes(tree,'button').find(n=>n.props.children==='Scan / upload batches').props.onClick();tree=app.render();
 assert.equal(nodes(tree,app.ScanBatchReports)[0].props.kind,'vehicle');assert.equal(nodes(tree,app.VlbBatchReport).length,0);
 const denied=harness([],{denied:'Only authorized MIS users and site Project Managers can use VLB batches.'}),fallback=await denied.flush();
 assert.equal(nodes(fallback,denied.ScanBatchReports).length,1);assert.match(text(fallback),/Shift batch reports are not available for this login/);
 const empty=harness([]);assert.match(text(await empty.flush()),/No shift batches yet/);
});

test('the Reports menu opens the shift batch page for VLB Reports',()=>{
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/renderedActive==='VLB Reports' \? \(<VlbBatchReports /);assert.match(main,/import VlbBatchReports from '\.\/vlb-batch-reports\.jsx'/);
});
