import {compactLogBookLabel} from '../log-book-labels.mjs';
import {scanReportCardStatus,CARD_STATUS_LEGEND} from '../src/scan-report-card-status.mjs';
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
  const environment={compactLogBookLabel,SmartSelect: "select",React,useEffect:()=>{},useMemo:fn=>fn(),useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]},...scope};
  const render=new Function(...Object.keys(environment),code+';return '+name)(...Object.values(environment));
  return props=>{cursor=0;return render({...props,ReportSection})};
}

test('all operational reports use shared controls with full filtered data, preserving zero and unavailable values',async()=>{
  const records=Array.from({length:137},(_,i)=>({id:i,book_no:'BOOK-'+i,book_type:i===136?'equipment':'vehicle',data:{bookDate:'2026-12-28',location:i===135?'Other':'Site A',door:'V'+i,assetId:i,shiftName:'Day',shiftHours:8,openingHmr:0,closingHmr:0,openingKmr:0,closingKmr:10,breakdownHours:null,trips:[{equipmentName:'L1',tripCount:1,loadingTime:'08:00',unloadingTime:'08:10'}]}}));
  const filters={from:'2026-12-01',to:'2026-12-31',site:'Site A',shift:'',asset:'',employee:'',workOrder:'',loading:''};
  const data={records},render=await component('operations-reports.jsx','SavedOperationReports',operations,[filters,data,'',false,0,false]);
  for(const {id} of operations.operationReports.filter(r=>!['manpower','employee','ot'].includes(r.id))){
    const tree=render({session:{token:'test'},reportId:id}),sections=nodes(tree,ReportSection);
    assert.equal(sections.length,1,id);
    const expected=operations.buildOperationReport(id,operations.filterRecords(operations.normalise(records),filters),{...data,filters,monthly:false});
    assert.deepEqual(sections[0].props.rows,expected.rows,id);
    assert.deepEqual(sections[0].props.columns.map(c=>c.label),expected.columns,id);
    if(expected.rows.length)assert.deepEqual(sections[0].props.columns.map(c=>c.value(expected.rows[0])),expected.rows[0],id);
    assert.match(sections[0].props.title,/2026-12-01 to 2026-12-31/);
    if(id==='vehicle')assert.equal(sections[0].props.rows.length,135,'all rows beyond the former 100-row page reach print/export');
    if(id==='breakdown')assert.ok(sections[0].props.rows.some(row=>row.includes(null)));
  }
  assert.equal(nodes(render({session:{token:'test'},reportId:'vehicle'}),'button').some(n=>n.props.children==='Print / Save PDF'),false);
});

test('VLB and ELB batch reports hide individual trip and loading equipment sections while retaining scoped card data',async()=>{
  const render=await component('scan-batch-report.jsx','ScanBatchReport',{scanBatchReport,scanBatchReportTables,scanReportCardStatus,CARD_STATUS_LEGEND});
  for(const kind of ['vehicle','equipment']){
    const batch={id:'batch',kind,name:'Chosen batch'},cards=Array.from({length:121},(_,i)=>({id:'card-'+i,batch_id:batch.id,ordinal:i+1,status:'review',draft:{door:'S/01',openingHmr:0,closingHmr:8}}));
    cards.push({id:'foreign',batch_id:'other',ordinal:122,status:'posted'});
    const sections=nodes(render({batch,cards,token:'test'}),ReportSection);
    const visibleTables=scanBatchReportTables(scanBatchReport(batch,cards)).filter(table=>table.name==='Batch summary');
    assert.deepEqual(sections.map(section=>section.props.title),visibleTables.map(table=>table.title));
    const summaries=nodes(render({batch,cards,token:'test'}),'summary').map(node=>node.props.children);
    assert.ok(!summaries.includes('Individual trips')&&!summaries.includes('Loading equipment'));
    const table=nodes(render({batch,cards,token:'test'}),'table')[0];
    const rows=nodes(nodes(table,'tbody')[0],'tr');assert.equal(rows.length,121);assert.ok(rows.every(row=>row.props['data-card-id']!=='foreign'));
    const headings=nodes(table,'th').map(n=>n.props.children);if(kind==='equipment')assert.ok(!headings.includes('Opening KMR'));

  }
});

test('original-card index sends all cards to shared controls while gallery remains paginated',async()=>{
  const render=await component('card-reports.jsx','CardReportGallery');
  const cards=Array.from({length:31},(_,i)=>({id:'card-'+i,ordinal:i+1,filename:'Page '+i,page_count:1}));
  const tree=render({batch:{id:'batch',name:'Batch',created_at:'2026-12-28'},cards,token:'test'});
  const index=nodes(tree,ReportSection)[0];assert.equal(index.props.rows.length,31);
  assert.equal(index.props.columns.find(c=>c.key==='filename').value(cards[30]),'Page 30');
  assert.ok(nodes(tree,'button').some(n=>n.props.children==='Next cards'));
});

test('batch report shows only saved totals as tiles, keeps its heading and downloads, and lists every card in the batch',async()=>{
 const render=await component('scan-batch-report.jsx','ScanBatchReport',{scanBatchReport,scanBatchReportTables,scanReportCardStatus,CARD_STATUS_LEGEND});
 const batch={id:'batch',kind:'vehicle',name:'Combined saves'};
 const saved=(id,ordinal,mode)=>({id,batch_id:batch.id,ordinal,status:'posted',saved_data:{scanCardId:id,scanBatchId:batch.id,door:'V'+ordinal,scanSaveMode:mode}});
 const cards=[saved('automatic',1,'automatic-validation'),saved('corrected',2,'manual-review'),{id:'pending',batch_id:batch.id,ordinal:3,status:'review',draft:{}},{...saved('foreign',4,'automatic-validation'),batch_id:'other'}];
 const tree=render({batch,cards,token:'test'});
 assert.deepEqual(nodes(tree,'dt').map(node=>node.props.children),['Trips','Kilometres','Working hours']);
 assert.deepEqual(nodes(render({batch:{...batch,kind:'equipment'},cards,token:'test'}),'dt').map(node=>node.props.children),['Working hours']);
 const header=nodes(tree,'header')[0];
 assert.equal(nodes(header,'h2').length,1);
 assert.deepEqual(nodes(header,'button').map(node=>node.props.children),['Download batch Excel','Download batch PDF']);
 const cardTable=nodes(tree,'table')[0];assert.deepEqual(nodes(nodes(cardTable,'tbody')[0],'tr').map(row=>row.props['data-card-id']),['automatic','corrected','pending']);
 assert.ok(nodes(tree,'summary').some(node=>node.props.children==='All cards'));
});

test('one search beside the batch report heading controls every table without duplicate search fields',async()=>{
 const render=await component('scan-batch-report.jsx','ScanBatchReport',{scanBatchReport,scanBatchReportTables,scanReportCardStatus,CARD_STATUS_LEGEND});
 const props={batch:{id:'batch',kind:'vehicle',name:'Chosen batch'},cards:[{id:'card',batch_id:'batch',ordinal:1,status:'review',draft:{}}],token:'test'};
 let tree=render(props);
 const searches=nodes(tree,'input').filter(node=>node.props.type==='search');
 assert.equal(searches.length,1);assert.equal(searches[0].props.placeholder,'Search this report');
 assert.ok(nodes(nodes(tree,'header')[0],'input').includes(searches[0]));
 searches[0].props.onChange({target:{value:'V/833'}});
 tree=render(props);
 for(const section of nodes(tree,ReportSection)){assert.equal(section.props.showSearch,false);assert.equal(section.props.query,'V/833');}
});

test('the all-cards table stays visible while batch checks block saving and downloads',async()=>{
 const render=await component('scan-batch-report.jsx','ScanBatchReport',{scanBatchReport,scanBatchReportTables,scanReportCardStatus,CARD_STATUS_LEGEND});
 const context={bookDate:'2026-12-30',location:'Sasti OC',cardShift:'I'},batch={id:'batch',kind:'vehicle',expected_context:context};
 const cards=Array.from({length:10},(_,i)=>{const id='card-'+i;return {id,batch_id:batch.id,ordinal:i+1,status:i<4?'posted':i===9?'reading':'review',draft:context,raw_fields:{extractionDraft:context},...(i<4?{saved_data:{...context,scanCardId:id,scanBatchId:batch.id}}:{})}});
 const tree=render({batch,cards,token:'test',contextBlocked:true}),table=nodes(tree,'table').find(node=>node.props['aria-label']==='Scanned card summary');
 assert.ok(table);assert.equal(nodes(nodes(table,'tbody')[0],'tr').length,10);
 const badges=nodes(table,'span').map(n=>n.props.children);assert.equal(badges.filter(value=>value==='Saved').length,4);assert.ok(badges.includes('Processing'));

 for(const button of nodes(tree,'button').filter(node=>['Download batch Excel','Download batch PDF'].includes(node.props.children)))assert.equal(button.props.disabled,true);
});

test('coloured card links open the exact card and cannot discard unsaved work',async()=>{
 const render=await component('scan-batch-report.jsx','ScanBatchReport',{scanBatchReport,scanBatchReportTables,scanReportCardStatus,CARD_STATUS_LEGEND});
 const batch={id:'batch',kind:'vehicle'},cards=[{id:'card7',batch_id:'batch',ordinal:7,status:'error',error:'Extraction failed'}];let selected='',prevented=false;
 let tree=render({batch,cards,onReviewCard:id=>selected=id});let link=nodes(tree,'a')[0];assert.match(link.props.className,/scan-report-error/);assert.match(link.props.href,/card=card7/);assert.match(link.props['aria-label'],/card 7/);link.props.onClick({preventDefault(){prevented=true}});assert.equal(selected,'card7');assert.equal(prevented,true);
 selected='';tree=render({batch,cards,reviewDisabled:true,onReviewCard:id=>selected=id});nodes(tree,'a')[0].props.onClick({preventDefault(){}});assert.equal(selected,'');
});


test('manpower views route to their dedicated report with shared export controls',async()=>{
 const ManpowerReports=()=>null,render=await component('operations-reports.jsx','OperationsReports',{ManpowerReports});
 for(const reportId of ['manpower','employee','ot']){const tree=render({session:{token:'test'},reportId});assert.equal(tree.type,ManpowerReports);assert.equal(tree.props.reportId,reportId);assert.equal(tree.props.ReportSection,ReportSection);}
});

test('manpower reports export complete selected data, separate shift hours, and retain OT colours and reasons',async()=>{
 const filters={from:'2026-11-10',to:'2026-11-10',site:'',shift:'',batch:'',employee:'',asset:''},query=new URLSearchParams(filters).toString();
 const rows=Array.from({length:137},(_,id)=>({id,date:filters.from,site:'Sasti OC',shift:'S1',employeeId:'E'+id,employeeName:'Example',hours:0,trips:null,reason:'RED — Back-to-back OT',severity:'red',combinedHours:15}));
 const payload={summary:rows,details:rows,performance:rows,ot:rows,exceptions:[],totals:{assets:137,employees:137,duties:137,exceptions:0},notes:[],options:{},generatedAt:'2026-11-10T10:00:00Z'};
 const render=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[filters,{query,payload},'',false,0,{}]);
 for(const reportId of ['manpower','employee','ot']){
  const tree=render({session:{token:'test'},reportId,onSelect:()=>{}}),sections=nodes(tree,ReportSection);assert.equal(sections.length,reportId==='manpower'?3:2);
  for(const section of sections.filter(n=>n.props.category!=='manpower-review'))assert.equal(section.props.rows.length,137,'export receives every matching row');
  if(reportId==='employee'){const cols=sections[0].props.columns;assert.equal(cols.find(c=>c.key==='hours').value(rows[0]),0);assert.equal(cols.find(c=>c.key==='trips').value(rows[0]),'—');assert.ok(!cols.some(c=>c.key==='combinedHours'));}
  if(reportId==='ot'){const cols=sections[0].props.columns;assert.equal(cols.find(c=>c.key==='combinedHours').value(rows[0]),15);const reason=cols.find(c=>c.key==='reason');assert.match(reason.value(rows[0]),/^RED/);assert.match(reason.render(rows[0]).props.className,/mp-flag-red/);assert.equal(sections[0].props.rowClassName(rows[0]),'mp-ot-red');}
 }
 const tree=render({session:{token:'test'},reportId:'employee',onSelect:()=>{}});nodes(tree,'input').find(n=>n.props.type==='date').props.onChange({target:{value:'2026-11-09'}});
 assert.equal(nodes(render({session:{token:'test'},reportId:'employee',onSelect:()=>{}}),ReportSection).length,0,'changed filters cannot export stale results');
});

