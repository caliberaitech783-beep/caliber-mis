import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc} from 'vite';
import * as operations from '../src/operations-report-model.mjs';
import {scanBatchReport,scanBatchReportTables} from '../scan-batch-report.mjs';

const ReportSection=()=>null;
const nodes=(tree,type)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(node.type===type)found.push(node);visit(node.props.children)};visit(tree);return found};
async function component(file,name,scope={},initial=[]){
  const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function'),file,{jsx:{runtime:'classic'}});
  const slots=[...initial];let cursor=0;
  const environment={React,useEffect:()=>{},useMemo:fn=>fn(),useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]},...scope};
  const render=new Function(...Object.keys(environment),code+';return '+name)(...Object.values(environment));
  return props=>{cursor=0;return render({...props,ReportSection})};
}

test('all operational reports use shared controls with full filtered data, preserving zero and unavailable values',async()=>{
  const records=Array.from({length:137},(_,i)=>({id:i,book_no:'BOOK-'+i,book_type:i===136?'equipment':'vehicle',data:{bookDate:'2026-10-28',location:i===135?'Other':'Site A',door:'V'+i,assetId:i,shiftName:'Day',shiftHours:8,openingHmr:0,closingHmr:0,openingKmr:0,closingKmr:10,breakdownHours:null,trips:[{equipmentName:'L1',tripCount:1,loadingTime:'08:00',unloadingTime:'08:10'}]}}));
  const filters={from:'2026-10-01',to:'2026-10-31',site:'Site A',shift:'',asset:'',employee:'',workOrder:'',loading:''};
  const data={records},render=await component('operations-reports.jsx','OperationsReports',operations,[filters,data,'',false,0,false]);
  for(const {id} of operations.operationReports){
    const tree=render({session:{token:'test'},reportId:id}),sections=nodes(tree,ReportSection);
    assert.equal(sections.length,1,id);
    const expected=operations.buildOperationReport(id,operations.filterRecords(operations.normalise(records),filters),{...data,filters,monthly:false});
    assert.deepEqual(sections[0].props.rows,expected.rows,id);
    assert.deepEqual(sections[0].props.columns.map(c=>c.label),expected.columns,id);
    if(expected.rows.length)assert.deepEqual(sections[0].props.columns.map(c=>c.value(expected.rows[0])),expected.rows[0],id);
    assert.match(sections[0].props.title,/2026-10-01 to 2026-10-31/);
    if(id==='vehicle')assert.equal(sections[0].props.rows.length,135,'all rows beyond the former 100-row page reach print/export');
    if(id==='breakdown')assert.ok(sections[0].props.rows.some(row=>row.includes(null)));
  }
  assert.equal(nodes(render({session:{token:'test'},reportId:'vehicle'}),'button').some(n=>n.props.children==='Print / Save PDF'),false);
});

test('VLB and ELB batch reports hide individual trip and loading equipment sections while retaining scoped card data',async()=>{
  const render=await component('scan-batch-report.jsx','ScanBatchReport',{scanBatchReport,scanBatchReportTables});
  for(const kind of ['vehicle','equipment']){
    const batch={id:'batch',kind,name:'Chosen batch'},cards=Array.from({length:121},(_,i)=>({id:'card-'+i,batch_id:batch.id,ordinal:i+1,status:'review',draft:{door:'S/01',openingHmr:0,closingHmr:8}}));
    cards.push({id:'foreign',batch_id:'other',ordinal:122,status:'posted'});
    const sections=nodes(render({batch,cards,token:'test'}),ReportSection);
    const visibleTables=scanBatchReportTables(scanBatchReport(batch,cards)).filter(table=>!['Individual trips','Loading equipment'].includes(table.name));
    assert.deepEqual(sections.map(section=>section.props.title),visibleTables.map(table=>table.title));
    const summaries=nodes(render({batch,cards,token:'test'}),'summary').map(node=>node.props.children);
    assert.ok(!summaries.includes('Individual trips')&&!summaries.includes('Loading equipment'));
    const table=sections.find(n=>n.props.columns.some(c=>c.key==='ordinal'));
    assert.equal(table.props.rows.length,121);
    assert.ok(table.props.rows.every(row=>row.id!=='foreign'));
    assert.equal(table.props.columns.find(c=>c.key==='openingHmr').value(table.props.rows[0]),0);
    if(kind==='equipment')assert.ok(table.props.columns.every(c=>!['trips','openingKmr','closingKmr'].includes(c.key)));
  }
});

test('original-card index sends all cards to shared controls while gallery remains paginated',async()=>{
  const render=await component('card-reports.jsx','CardReportGallery');
  const cards=Array.from({length:31},(_,i)=>({id:'card-'+i,ordinal:i+1,filename:'Page '+i,page_count:1}));
  const tree=render({batch:{id:'batch',name:'Batch',created_at:'2026-10-28'},cards,token:'test'});
  const index=nodes(tree,ReportSection)[0];assert.equal(index.props.rows.length,31);
  assert.equal(index.props.columns.find(c=>c.key==='filename').value(cards[30]),'Page 30');
  assert.ok(nodes(tree,'button').some(n=>n.props.children==='Next cards'));
});

test('Saved metric lists every posted card from either review path and excludes drafts and foreign batches',async()=>{
 const render=await component('scan-batch-report.jsx','ScanBatchReport',{scanBatchReport,scanBatchReportTables});
 const batch={id:'batch',kind:'vehicle',name:'Combined saves'};
 const saved=(id,ordinal,mode)=>({id,batch_id:batch.id,ordinal,status:'posted',saved_data:{scanCardId:id,scanBatchId:batch.id,door:'V'+ordinal,scanSaveMode:mode}});
 const cards=[saved('automatic',1,'automatic-validation'),saved('corrected',2,'manual-review'),{id:'pending',batch_id:batch.id,ordinal:3,status:'review',draft:{}},{...saved('foreign',4,'automatic-validation'),batch_id:'other'}];
 let tree=render({batch,cards,token:'test'});
 const button=nodes(tree,'button').find(node=>node.props['aria-label']==='Show all saved cards');
 assert.equal(button.props.children,'2');button.props.onClick();
 tree=render({batch,cards,token:'test'});
 const cardTable=nodes(tree,ReportSection).find(node=>node.props.columns.some(c=>c.key==='ordinal'));
 assert.deepEqual(cardTable.props.rows.map(row=>row.id),['automatic','corrected']);
 assert.ok(nodes(tree,'summary').some(node=>node.props.children==='Saved cards'));
 nodes(tree,'button').find(node=>node.props['aria-label']==='Show all batch cards').props.onClick();
 const all=nodes(render({batch,cards,token:'test'}),ReportSection).find(node=>node.props.columns.some(c=>c.key==='ordinal'));
 assert.equal(all.props.rows.length,3);
});

test('one search beside the batch report heading controls every table without duplicate search fields',async()=>{
 const render=await component('scan-batch-report.jsx','ScanBatchReport',{scanBatchReport,scanBatchReportTables});
 const props={batch:{id:'batch',kind:'vehicle',name:'Chosen batch'},cards:[{id:'card',batch_id:'batch',ordinal:1,status:'review',draft:{}}],token:'test'};
 let tree=render(props);
 const searches=nodes(tree,'input').filter(node=>node.props.type==='search');
 assert.equal(searches.length,1);assert.equal(searches[0].props.placeholder,'Search this report');
 assert.ok(nodes(nodes(tree,'header')[0],'input').includes(searches[0]));
 searches[0].props.onChange({target:{value:'V/833'}});
 tree=render(props);
 for(const section of nodes(tree,ReportSection)){assert.equal(section.props.showSearch,false);assert.equal(section.props.query,'V/833');}
});
