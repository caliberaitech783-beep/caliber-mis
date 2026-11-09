import {isDeletableScanCard,isAbortableScanCard} from '../src/scan-card-deletion-selection.mjs';
import {encodeDateRange,parseDateRange} from '../src/date-range-filter.mjs';
import {compactLogBookLabel} from '../shared/log-book-labels.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {scanReportCardStatus,CARD_STATUS_LEGEND} from '../src/scan-report-card-status.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc} from 'vite';
import * as operations from '../src/operations-report-model.mjs';
import {scanBatchReport,scanBatchReportTables} from '../shared/scan-batch-report.mjs';

const ReportSection=()=>null;
const nodes=(tree,type)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(node.type===type)found.push(node);visit(node.props.children)};visit(tree);return found};
async function component(file,name,scope={},initial=[]){
  const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function'),file,{jsx:{runtime:'classic'}});
  const slots=[...initial];let cursor=0;
  const environment={encodeDateRange,parseDateRange,isDeletableScanCard,isAbortableScanCard,compactLogBookLabel,canonicalSiteName,SmartSelect: "select",React,useRef:()=>({current:null}),useEffect:()=>{},useMemo:fn=>fn(),useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]},...scope};
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
    assert.equal(sections[0].props.recordDateFilter.value,encodeDateRange('2026-12-01','2026-12-31'));
    assert.ok(sections[0].props.reportKey&&!sections[0].props.reportKey.includes('2026-12'),'saved view identity is independent of the chosen dates');
    if(id==='vehicle')assert.equal(sections[0].props.rows.length,135,'all rows beyond the former 100-row page reach print/export');
    if(id==='breakdown')assert.ok(sections[0].props.rows.some(row=>row.includes(null)));
  }
  assert.equal(nodes(render({session:{token:'test'},reportId:'vehicle'}),'button').some(n=>n.props.children==='Print / Save PDF'),false);
});

test('opening an operational saved date range keeps its table mounted and blocks exports until matching data arrives',async()=>{
 const filters={from:'2026-11-01',to:'2026-11-04',site:'',shift:'',asset:'',employee:'',workOrder:'',loading:''};
 const render=await component('operations-reports.jsx','SavedOperationReports',operations,[filters,{records:[],reportRange:'2026-11-01|2026-11-04'},'',false,0,false]);
 let section=nodes(render({session:{token:'test'},reportId:'daily'}),ReportSection)[0];assert.equal(section.props.dataReady,true);
 section.props.recordDateFilter.onChange(encodeDateRange('2026-11-02','2026-11-03'));
 section=nodes(render({session:{token:'test'},reportId:'daily'}),ReportSection)[0];assert.ok(section,'restoring dates must not unmount the pending saved Print action');assert.equal(section.props.dataReady,false);assert.equal(section.props.recordDateFilter.value,encodeDateRange('2026-11-02','2026-11-03'));
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
 assert.deepEqual(nodes(tree,'dt').map(node=>node.props.children),['Counted trips','Machine loading trips','Handover completions','Kilometres','Working hours']);
 assert.deepEqual(nodes(render({batch:{...batch,kind:'equipment'},cards,token:'test'}),'dt').map(node=>node.props.children),['Working hours']);
 const header=nodes(tree,'header')[0];
 assert.equal(nodes(header,'h2').length,1);
 assert.deepEqual(nodes(header,'button').map(node=>node.props.children),['Download batch Excel','Download batch PDF']);
 const cardTable=nodes(tree,'table')[0];assert.deepEqual(nodes(nodes(cardTable,'tbody')[0],'tr').map(row=>row.props['data-card-id']),['automatic','corrected','pending']);
 assert.ok(nodes(tree,'summary').some(node=>nodes(node,'strong').some(strong=>strong.props.children==='All cards')));
});

test('deleted VLB scans are listed below the download controls with their saved vehicle snapshot',async()=>{
 const render=await component('scan-batch-report.jsx','ScanBatchReport',{scanBatchReport,scanBatchReportTables,scanReportCardStatus,CARD_STATUS_LEGEND});
 const batch={id:'batch',kind:'vehicle',name:'Deleted scans'},cards=[
  {id:'deleted-3',batch_id:'batch',ordinal:3,status:'rejected',draft:{},raw_fields:{manualDeletion:{vehicle:'V-200'}}},
  {id:'deleted-1',batch_id:'batch',ordinal:1,status:'rejected',draft:{},raw_fields:{manualDeletion:{vehicle:'V-101'}}},
  {id:'active',batch_id:'batch',ordinal:2,status:'review',draft:{door:'V-300'}}
 ];
 const tree=render({batch,cards,token:'test'}),box=nodes(tree,'div').find(node=>node.props.className==='scan-batch-deleted-cards');
 assert.ok(box);assert.deepEqual(nodes(box,'li').map(node=>node.props.children.join('')),['Card 1 · Vehicle V-101','Card 3 · Vehicle V-200']);
 assert.equal(nodes(render({batch:{...batch,kind:'equipment'},cards,token:'test'}),'div').some(node=>node.props.className==='scan-batch-deleted-cards'),false);
});

test('smart search sits beside All cards and Pulse-style filters open from every data column',async()=>{
 const render=await component('scan-batch-report.jsx','ScanBatchReport',{scanBatchReport,scanBatchReportTables,scanReportCardStatus,CARD_STATUS_LEGEND});
 const props={batch:{id:'batch',kind:'vehicle',name:'Chosen batch'},cards:[{id:'card',batch_id:'batch',ordinal:1,status:'review',draft:{}}],token:'test'};
 let tree=render(props);
 const smart=nodes(tree,'input').find(node=>node.props['aria-label']==='Smart search all cards');
 assert.ok(smart);assert.equal(smart.props.placeholder,'Smart search all cards');
 const allCards=nodes(tree,'summary').find(node=>nodes(node,'strong').some(strong=>strong.props.children==='All cards'));
 assert.ok(allCards&&nodes(allCards,'input').includes(smart));
 const cardTable=scanBatchReportTables(scanBatchReport(props.batch,props.cards)).find(table=>table.name==='Cards');
 const filters=nodes(tree,'button').filter(node=>node.props['aria-haspopup']==='dialog');
 assert.equal(filters.length,cardTable.columns.length+1,'every data column plus Issues has a filter menu');
 assert.equal(nodes(tree,'input').filter(node=>String(node.props['aria-label']||'').startsWith('Filter ')).length,0,'inline filter row is removed');
 filters[0].props.onClick();tree=render(props);
 const dialog=nodes(tree,'div').find(node=>node.props.role==='dialog');
 assert.ok(dialog);assert.ok(nodes(dialog,'button').some(node=>node.props.children==='All Values'));
 assert.ok(nodes(dialog,'input').some(node=>String(node.props['aria-label']||'').startsWith('Search ')));
 smart.props.onChange({target:{value:'V/833'}});
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
 const rows=Array.from({length:137},(_,id)=>({id,date:filters.from,site:'Sasti OC',shift:'S1',employeeId:'E'+id,employeeKey:'E'+id,siteKey:'sasti ob',category:id%2?'Volvo Driver':'Dumper Operator',dates:filters.from,employeeName:'Example',hours:0,trips:null,reason:'RED — Back-to-back OT',severity:'red',combinedHours:15,
  // Log books rotate VLB, ELB, LMV; the first driver worked on two: 46 VLB, 47 ELB and 45 LMV duties from 137 events.
  logBooks:id?[['VLB','ELB','LMV'][id%3]]:['VLB','ELB'],logBook:id?['VLB','ELB','LMV'][id%3]:'VLB + ELB'}));
 const none={red:0,orange:0,review:0},reds=red=>({...none,red});
 const sites=[{site:'Jayant OC',siteKey:'jayant ob',...none,books:{VLB:none,ELB:none,LMV:none}},{site:'Sasti OC',siteKey:'sasti ob',...reds(137),books:{VLB:reds(46),ELB:reds(47),LMV:reds(45)}}];
 const payload={summary:rows,details:rows,performance:rows,ot:rows,otSites:sites,exceptions:[],totals:{assets:137,employees:137,duties:137,exceptions:0},notes:[],options:{},generatedAt:'2026-11-10T10:00:00Z'};
 const render=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[filters,{query,payload},'',false,0,{}]);
 for(const reportId of ['manpower','employee']){
  const tree=render({session:{token:'test'},reportId,onSelect:()=>{}}),sections=nodes(tree,ReportSection);assert.equal(sections.length,reportId==='manpower'?3:2);
  for(const section of sections.filter(n=>n.props.category!=='manpower-review'))assert.equal(section.props.rows.length,137,'export receives every matching row');
  if(reportId==='employee'){const cols=sections[0].props.columns;assert.equal(cols.find(c=>c.key==='hours').value(rows[0]),0);assert.equal(cols.find(c=>c.key==='trips').value(rows[0]),'—');assert.ok(!cols.some(c=>c.key==='combinedHours'));}
 }
 // OT view: one line per site with red, orange, brown and drivers; pressing a number lists that site's drivers.
 const blank={key:'',data:null,error:''},props={session:{token:'test'},reportId:'ot',onSelect:()=>{}};
 const ot=async({site='',logBook='',tally=blank,driverOpen='',otPick={siteKey:'',severity:''},data=payload}={})=>{const view=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[{...filters,site},{query,payload:data},'',false,0,{},false,false,logBook,tally,driverOpen,{siteKey:'',shift:'',equipment:'',flag:''},otPick]);return ()=>view(props);};
 const categories=tree=>nodes(tree,ReportSection).map(n=>n.props.category);
 const counts=tree=>nodes(tree,'button').filter(n=>/mp-cat-count/.test(n.props.className||'')).map(n=>n.props['aria-label']);
 const sasti={siteKey:'sasti ob',severity:''};
 {const view=await ot(),overview=view();
  assert.deepEqual(categories(overview),[],'no driver list before a number is pressed');
  assert.deepEqual(nodes(overview,'th').filter(n=>n.props.scope==='row').map(n=>n.props.children),['Jayant OC','Sasti OC','All sites']);
  assert.deepEqual(counts(overview),['137 Red · Sasti OC','137 drivers · Sasti OC','137 Red · All sites','137 drivers · All sites'],'a site with no case shows zeros, not buttons');
  assert.deepEqual(nodes(nodes(overview,'div').find(n=>n.props.className==='mp-book-pick'),'button').map(n=>n.props.children),['All log books','VLB','ELB','LMV'],'log book is one selector');
  assert.equal(nodes(overview,'button').filter(n=>/mp-site-card|mp-ot-count|mp-ot-book/.test(n.props.className||'')).length,0,'the log-book grid and the site cards are gone');
  // Pressing a number opens that site's drivers (one row each) and, under them, each case.
  nodes(overview,'button').find(n=>n.props['aria-label']==='137 Red · Sasti OC').props.onClick();
  const [drivers,each]=nodes(view(),ReportSection);assert.deepEqual(categories(view()),['manpower-ot-drivers','manpower-ot']);
  assert.equal(drivers.props.title,'Sasti OC · Red only · drivers');assert.equal(drivers.props.rows.length,137,'one row per driver');assert.equal(each.props.rows.length,137,'export receives every matching case');
  assert.deepEqual(drivers.props.columns.map(c=>c.key),['employeeId','caliberCode','employeeName','category','red','orange','review','total','otMonth','otYear','logBook','dutyDates','shifts','equipment'],'one site: no Site column');
  assert.deepEqual([drivers.props.recordDateFilter,each.props.recordDateFilter],[false,false],'the page dates are the only date control');
  {const value=key=>drivers.props.columns.find(c=>c.key===key).value(drivers.props.rows[1]);assert.deepEqual(['employeeId','category','red','orange','review','total','dutyDates','logBook'].map(value),['E1','Volvo Driver',1,0,0,1,filters.from,'ELB']);}
  {const cols=each.props.columns;assert.equal(cols.find(c=>c.key==='combinedHours').value(rows[0]),15);assert.equal(cols.find(c=>c.key==='logBook').value(rows[0]),'VLB + ELB');const reason=cols.find(c=>c.key==='reason');assert.match(reason.value(rows[0]),/^RED/);assert.match(reason.render(rows[0]).props.className,/mp-flag-red/);assert.equal(each.props.rowClassName(rows[0]),'mp-ot-red');}
  nodes(view(),'button').find(n=>n.props['aria-label']==='137 Red · Sasti OC').props.onClick();assert.deepEqual(categories(view()),[],'pressing the same number again closes the list');
  nodes(view(),'button').find(n=>n.props['aria-label']==='137 drivers · All sites').props.onClick();
  const everywhere=nodes(view(),ReportSection)[0];assert.equal(everywhere.props.title,'All sites · All colours · drivers');assert.equal(everywhere.props.columns[0].key,'site','every site: the Site column returns');}
 // The log book selector narrows every number; a duty saved in two log books counts under both.
 for(const [book,expected] of [['VLB',46],['ELB',47],['LMV',45]]){const tree=(await ot({logBook:book,otPick:sasti}))();assert.equal(nodes(tree,ReportSection)[1].props.rows.length,expected,book);assert.ok(counts(tree).includes(expected+' Red · Sasti OC'));assert.match(nodes(tree,ReportSection)[0].props.description,new RegExp(' · '+book+' · '));}
 // The Site selection narrows the list of sites; one site opens by itself.
 {const only=(await ot({site:'Sasti OC'}))();assert.deepEqual(nodes(only,'th').filter(n=>n.props.scope==='row').map(n=>n.props.children),['Sasti OC']);assert.deepEqual(categories(only),['manpower-ot-drivers','manpower-ot']);
  const other=(await ot({site:'Jayant OC'}))();assert.equal(nodes(other,ReportSection)[0].props.rows.length,0,'another site never shows this site’s drivers');
  assert.deepEqual(categories((await ot({otPick:{siteKey:'not a site',severity:'red'}}))()),[],'a stale choice is ignored');}
 // Drivers list: OT counts for the month and year, and the name opens that driver's month-wise history.
 {const event=(id,date,severity)=>({id,date,dates:date,severity,reason:severity.toUpperCase()+' — fixture',shifts:date+' S1; '+date+' S2',logBook:'VLB',equipment:'Tipper / Volvo',combinedHours:15,books:'CARD'});
  const yearData={year:'2026',month:'2026-11',yearFrom:'2026-11-01',yearTo:'2026-11-10',monthFrom:'2026-11-01',monthTo:'2026-11-10',drivers:[{employeeKey:'E1',siteKey:'sasti ob',month:{red:4,orange:1,review:0,total:5},year:{red:20,orange:4,review:1,total:25},events:[event('a','2026-11-09','red'),event('b','2026-11-03','orange')],duties:{'2026-11':9}}]};
  const loaded={key:'sasti ob|2026-11|0',data:yearData,error:''},first=view=>nodes(view(),ReportSection)[0].props;
  const waiting=first(await ot({otPick:sasti}));assert.deepEqual(waiting.columns.slice(8,10).map(c=>c.label),['OT in Nov 2026','OT in 2026']);
  assert.deepEqual([waiting.rows[0].otMonth,waiting.rows[0].otYear],['Checking…','Checking…'],'counts are never shown as zero before they load');
  assert.equal(first(await ot({otPick:sasti,tally:{key:'sasti ob|2026-11|0',data:null,error:'Unable to load the month and year counts.'}})).rows[0].otYear,'Unavailable');
  assert.equal(first(await ot({otPick:{siteKey:'*',severity:''},tally:loaded})).rows[1].otYear,'Press the name','in a list of every site the counts are read for the driver whose name is pressed');
  assert.equal(first(await ot({otPick:{siteKey:'*',severity:''},tally:loaded,driverOpen:'E1|sasti ob'})).rows[1].otYear,25);
  const view=await ot({otPick:sasti,tally:loaded});
  assert.deepEqual(first(view).rows.slice(0,4).map(r=>[r.employeeId,r.otMonth,r.otYear]),[['E0',0,0],['E1',5,25],['E2',0,0],['E3',0,0]]);
  const name=first(view).columns.find(c=>c.key==='employeeName'),button=name.render(first(view).rows[1]);assert.equal(button.type,'button');assert.equal(button.props.children,'Example');assert.equal(name.value(first(view).rows[1]),'Example','exports keep the plain name');
  button.props.onClick();assert.deepEqual(categories(view()),['manpower-ot-drivers','manpower-ot-driver-history','manpower-ot']);
  const history=nodes(view(),ReportSection)[1].props;assert.deepEqual(history.rows.map(r=>[r.date,r.severity]),[['2026-11-09','red'],['2026-11-03','orange']]);assert.equal(history.title,'Example · flagged duties in 2026');assert.equal(history.rowClassName(history.rows[0]),'mp-ot-red');
  const monthTable=nodes(nodes(view(),'div').find(n=>/mp-driver-history/.test(n.props.className||'')),'tr').map(row=>[].concat(row.props.children).map(cell=>cell.props.children));
  assert.deepEqual(monthTable,[['Month','Duties','Red','Orange','Brown','OT times'],['Nov 2026',9,1,1,0,2],[['Year ','2026'],9,1,1,0,2]],'duties and OT month by month, then the year');
  first(view).columns.find(c=>c.key==='employeeName').render(first(view).rows[1]).props.onClick();assert.deepEqual(categories(view()),['manpower-ot-drivers','manpower-ot'],'pressing the name again closes the history');}
 // Cards to correct: one line on the OT and attendance pages, the full list on Manpower by Category.
 {const flawed={...payload,exceptions:[{id:'x',date:filters.from,site:'Sasti OC',siteKey:'sasti ob',shift:'S1',logBook:'VLB',reason:'Equipment master match is missing.'}],attendanceEquipment:[],attendanceSites:[],attendanceShifts:[]};
  const page=async reportId=>(await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[filters,{query,payload:flawed},'',false,0,{}]))({session:{token:'test'},reportId,onSelect:()=>{}});
  for(const reportId of ['ot','attendance']){const tree=await page(reportId),line=nodes(tree,'details').find(n=>n.props.className==='mp-notes mp-review');assert.equal(nodes(line,'summary')[0].props.children.join(''),'1 saved card needs correction (list for the MIS team)',reportId);assert.deepEqual(nodes(line,ReportSection).map(n=>[n.props.category,n.props.rows.length,n.props.recordDateFilter]),[['manpower-review',1,false]]);}
  const full=await page('manpower');assert.equal(nodes(full,'details').filter(n=>n.props.className==='mp-notes mp-review').length,0);assert.equal(nodes(full,ReportSection).at(-1).props.category,'manpower-review');
  assert.equal(nodes((await ot())(),'details').filter(n=>n.props.className==='mp-notes mp-review').length,0,'no line when nothing needs correction');}
 const tree=render({session:{token:'test'},reportId:'employee',onSelect:()=>{}});nodes(tree,'input').find(n=>n.props.type==='date').props.onChange({target:{value:'2026-11-09'}});
 assert.equal(nodes(render({session:{token:'test'},reportId:'employee',onSelect:()=>{}}),ReportSection).length,0,'changed filters cannot export stale results');
});


test('shift attendance equipment wise opens sites by shift, then equipment, then the coloured driver list',async()=>{
 const filters={from:'2026-11-10',to:'2026-11-10',site:'',shift:'',batch:'',employee:'',asset:''};
 const duty=(n,siteKey,site,shift,equipment,flag='normal',actual=true)=>({id:'d'+n,date:filters.from,shift,site,siteKey,employeeKey:'E'+n,employeeId:'E'+n,caliberCode:'C'+n,employeeName:'Driver '+n,equipment,doors:'V'+n,makeModel:'VOLVO FMX',status:'Present',trips:1,actual,actualLabel:actual?'Yes':'No — second machine',flag,flagLabel:flag==='red'?'RED — Back-to-back OT':'Normal duty',note:'',reason:'',remarks:''});
 const sasti=['sasti ob','Sasti OC'],rows=[duty(1,...sasti,'S1','Volvo Tippers'),duty(2,...sasti,'S1','Volvo Tippers','red'),duty(7,...sasti,'S1','Volvo Tippers'),duty(3,...sasti,'S1','Graders','zero'),duty(4,...sasti,'S1','Graders','normal',false),duty(5,...sasti,'S2','Volvo Tippers','review'),duty(6,'jayant ob','Jayant OC','S3','Excavator','orange')];
 const sites=[{siteKey:'dhoptala',site:'Dhoptala OC'},{siteKey:'jayant ob',site:'Jayant OC'},{siteKey:'sasti ob',site:'Sasti OC'}];
 // The batch behind each site and shift: Dhoptala has none for the shift that ended, Jayant and Sasti each have one still open, Sasti misses Shift 3.
 const batch=(siteKey,shift,state,name='')=>({siteKey,date:filters.from,shift,state,batch:name});
 const shiftBatches=[batch('dhoptala','S1','none'),batch('dhoptala','S2','not_due'),batch('dhoptala','S3','not_due'),batch('jayant ob','S1','closed','J1'),batch('jayant ob','S2','closed','J2'),batch('jayant ob','S3','vlb_open','JAYANT-S3'),batch('sasti ob','S1','closed','S1'),batch('sasti ob','S2','elb_open','SASTI-S2'),batch('sasti ob','S3','none')];
 const payload=(attendanceSites=sites,attendanceShifts=shiftBatches)=>({summary:[],details:[],performance:[],ot:[],otSites:[],shiftAttendance:[],attendanceEquipment:rows,attendanceSites,attendanceShifts,exceptions:[],totals:{},notes:[],options:{},generatedAt:'2026-11-10T10:00:00Z'});
 const blank={key:'',data:null,error:''};
 const mount=async({pick,chosen=filters,data=payload(),tally=blank,driverOpen=''}={})=>{const render=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[chosen,{query:new URLSearchParams(chosen).toString(),payload:data},'',false,0,{},false,false,'',tally,driverOpen,...(pick?[pick]:[])]);return ()=>render({session:{token:'test'},reportId:'attendance',onSelect:()=>{}});};
 const buttons=(tree,name)=>nodes(tree,'button').filter(n=>new RegExp('(^| )'+name+'( |$)').test(n.props.className||''));
 const categories=tree=>nodes(tree,ReportSection).map(n=>n.props.category);
 const press=(tree,label)=>nodes(tree,'button').find(n=>n.props['aria-label']===label).props.onClick();
 assert.equal(operations.operationReports.find(r=>r.id==='attendance').title,'Shift Attendance Equipment Wise');

 // Step 1: every assigned site by shift, counting actual duties. A box is red while its batch is missing and
 // outlined orange while the batch is open; the totals only carry the note. A shift not yet due stays a plain zero.
 const view=await mount(),first=view();
 assert.equal(nodes(first,'h1')[0].props.children,'Shift Attendance Equipment Wise');
 assert.deepEqual(nodes(first,'th').filter(n=>n.props.scope==='row').map(n=>n.props.children),['Dhoptala OC','Jayant OC','Sasti OC','All sites']);
 assert.deepEqual(buttons(first,'mp-att-count').map(n=>n.props['aria-label']),[
  '0 actual duties · Dhoptala OC · Shift 1 · No batch','0 actual duties · Dhoptala OC · All shifts · 1 shift no batch',
  '1 actual duty · Jayant OC · Shift 3 · VLB open','1 actual duty · Jayant OC · All shifts · 1 open',
  '4 actual duties · Sasti OC · Shift 1','1 actual duty · Sasti OC · Shift 2 · ELB open','0 actual duties · Sasti OC · Shift 3 · No batch','5 actual duties · Sasti OC · All shifts · 1 shift no batch · 1 open',
  '4 actual duties · All sites · Shift 1 · 1 shift no batch','1 actual duty · All sites · Shift 2 · 1 open','1 actual duty · All sites · Shift 3 · 1 shift no batch · 1 open','6 actual duties · All sites · All shifts · 2 shifts no batch · 2 open'],'the second machine of one driver is not another actual duty');
 assert.deepEqual(buttons(first,'mp-att-none').map(n=>n.props['aria-label'].split(' · ').slice(1,3).join(' ')),['Dhoptala OC Shift 1','Sasti OC Shift 3'],'only the box of one site and shift is painted red');
 assert.deepEqual(buttons(first,'mp-att-open').map(n=>n.props['aria-label'].split(' · ').slice(1,3).join(' ')),['Jayant OC Shift 3','Sasti OC Shift 2']);
 assert.deepEqual(nodes(nodes(first,'p').find(n=>n.props.className==='mp-att-status'),'span').slice(0,2).map(n=>[].concat(n.props.children).join('')),['2 shifts without a batch','2 batches open']);
 assert.deepEqual(categories(first),[],'no driver list before a site and shift are chosen');
 assert.equal(buttons(first,'mp-cat-open').length,0);

 // Step 2: pressing Shift 1 of a site lists its equipment with both totals and the four colours.
 press(first,'4 actual duties · Sasti OC · Shift 1');
 const second=view();
 assert.deepEqual(buttons(second,'mp-cat-open').map(n=>n.props.children),['Volvo Tippers','Graders','All equipment']);
 assert.deepEqual(buttons(second,'mp-cat-count').map(n=>n.props['aria-label']),['3 equipment-wise duties · Volvo Tippers','1 Red · Volvo Tippers','2 equipment-wise duties · Graders','1 Blue · Graders','5 equipment-wise duties · All equipment','1 Red · All equipment','1 Blue · All equipment']);
 assert.match(nodes(second,'p').find(n=>n.props.className==='mp-att-foot').props.children.join(''),/^1 duty here is a second machine/);
 assert.equal(nodes(second,'p').filter(n=>/mp-att-batch/.test(n.props.className||'')).length,0,'a closed batch needs no line');
 assert.deepEqual(categories(second),[]);

 // Step 3: pressing an equipment lists its drivers; date, site and shift are in the heading, not in the columns.
 buttons(second,'mp-cat-open')[0].props.onClick();
 const list=nodes(view(),ReportSection)[0].props;
 assert.equal(list.category,'shift-attendance');assert.equal(list.rows.length,3);assert.equal(list.recordDateFilter,false);
 assert.equal(list.title,'Shift Attendance Equipment Wise · Sasti OC · Shift 1 · 10-11-26 · Volvo Tippers');
 assert.equal(list.description,'3 equipment-wise duties · 3 actual duties · Saved records only · Press a name for the month-wise history');
 assert.deepEqual(list.columns.map(c=>c.key),['employeeId','caliberCode','employeeName','otMonth','otYear','doors','makeModel','status','trips','actualLabel','flagLabel','note','reason','remarks']);
 assert.deepEqual(list.rows.map(list.rowClassName),['mp-duty-normal','mp-duty-red','mp-duty-normal']);
 assert.match(list.columns.find(c=>c.key==='flagLabel').render(list.rows[1]).props.className,/mp-flag-red/);
 press(view(),'1 Red · Volvo Tippers');
 {const red=nodes(view(),ReportSection)[0].props;assert.equal(red.rows.length,1);assert.match(red.title,/Volvo Tippers · Red only$/);}

 // A shift with no batch still opens, and says so in words.
 press(view(),'0 actual duties · Sasti OC · Shift 3 · No batch');
 {const empty=view(),lines=nodes(empty,'p').filter(n=>/mp-att-batch/.test(n.props.className||''));assert.deepEqual(lines.map(n=>n.props.className),['mp-att-batch mp-att-batch-none']);assert.equal(lines[0].props.children.at(-1),'this shift');assert.equal(buttons(empty,'mp-cat-open').length,0);}
 press(view(),'5 actual duties · Sasti OC · All shifts · 1 shift no batch · 1 open');
 {const lines=nodes(view(),'p').filter(n=>/mp-att-batch/.test(n.props.className||''));assert.deepEqual(lines.map(n=>n.props.children.at(-1)),['Shift 3','Shift 2 SASTI-S2 (ELB open)']);}

 // Driver history: month and year OT beside the name, and the name opens the month-wise history.
 {const volvo={siteKey:'sasti ob',shift:'S1',equipment:'Volvo Tippers',flag:''},event={id:'a',date:'2026-11-09',dates:'2026-11-09',severity:'red',reason:'RED — fixture',shifts:'2026-11-09 S1; 2026-11-09 S2',logBook:'VLB',equipment:'Tipper / Volvo',combinedHours:15,books:'CARD'};
  const yearData={year:'2026',month:'2026-11',yearFrom:'2026-11-01',yearTo:'2026-11-10',monthFrom:'2026-11-01',monthTo:'2026-11-10',drivers:[{employeeKey:'E2',siteKey:'sasti ob',month:{red:1,orange:0,review:0,total:1},year:{red:1,orange:0,review:0,total:1},events:[event],duties:{'2026-11':8}},{employeeKey:'E1',siteKey:'sasti ob',month:{red:0,orange:0,review:0,total:0},year:{red:0,orange:0,review:0,total:0},events:[],duties:{'2026-11':10}}]};
  const rowsOf=view=>nodes(view(),ReportSection)[0].props;
  assert.deepEqual(rowsOf(await mount({pick:volvo})).rows.map(r=>r.otMonth),['Checking…','Checking…','Checking…'],'counts are never shown as zero before they load');
  const history=await mount({pick:volvo,tally:{key:'sasti ob|2026-11|0',data:yearData,error:''}});
  assert.deepEqual(rowsOf(history).rows.map(r=>[r.employeeId,r.otMonth,r.otYear]),[['E1',0,0],['E2',1,1],['E7',0,0]]);
  assert.deepEqual(rowsOf(history).columns.slice(3,5).map(c=>c.label),['OT in Nov 2026','OT in 2026']);
  const name=rowsOf(history).columns.find(c=>c.key==='employeeName'),button=name.render(rowsOf(history).rows[1]);assert.equal(button.props['aria-label'],'History of Driver 2');assert.equal(name.value(rowsOf(history).rows[1]),'Driver 2','exports keep the plain name');
  button.props.onClick();assert.deepEqual(categories(history()),['shift-attendance','manpower-ot-driver-history']);
  const table=nodes(nodes(history(),'div').find(n=>/mp-driver-history/.test(n.props.className||'')),'tr').map(row=>[].concat(row.props.children).map(cell=>cell.props.children));
  assert.deepEqual(table,[['Month','Duties','Red','Orange','Brown','OT times'],['Nov 2026',8,1,0,0,1],[['Year ','2026'],8,1,0,0,1]]);
  assert.deepEqual(nodes(history(),ReportSection)[1].props.rows.map(r=>r.id),['a']);
  // A driver with duties and no OT still has a history.
  rowsOf(history).columns.find(c=>c.key==='employeeName').render(rowsOf(history).rows[0]).props.onClick();
  assert.deepEqual(nodes(nodes(history(),'div').find(n=>/mp-driver-history/.test(n.props.className||'')),'tr')[1].props.children.map(cell=>cell.props.children),['Nov 2026',10,0,0,0,0]);}

 // A wider selection brings back the columns that no longer fit in the heading.
 {const all=nodes((await mount({pick:{siteKey:'*',shift:'',equipment:'*',flag:'zero'}}))(),ReportSection)[0].props;
  assert.equal(all.title,'Shift Attendance Equipment Wise · All sites · All shifts · 10-11-26 · All equipment · Blue only');assert.equal(all.rows.length,1);
  assert.deepEqual(all.columns.map(c=>c.key).filter(key=>['date','site','shift','equipment'].includes(key)),['site','shift','equipment']);
  assert.equal(all.rows[0].otYear,'Press the name','in a list of every site the counts are read for the driver whose name is pressed');}
 {const range={...filters,to:'2026-11-12'},later=[...shiftBatches,{siteKey:'sasti ob',date:'2026-11-11',shift:'S1',state:'none',batch:''},{siteKey:'sasti ob',date:'2026-11-12',shift:'S1',state:'none',batch:''}];
  const tree=(await mount({pick:{siteKey:'sasti ob',shift:'S1',equipment:'Graders',flag:''},chosen:range,data:payload(sites,later)}))(),days=nodes(tree,ReportSection)[0].props;
  assert.equal(days.columns[0].key,'date');assert.match(days.title,/10-11-26 to 12-11-26 · Graders$/);assert.equal(days.description,'2 equipment-wise duties · 1 actual duty · Saved records only · Press a name for the month-wise history');
  assert.ok(buttons(tree,'mp-att-none').some(n=>n.props['aria-label']==='4 actual duties · Sasti OC · Shift 1 · 2 days no batch'),'over several days the box counts the days without a batch');
  assert.equal(nodes(tree,'p').find(n=>n.props.className==='mp-att-batch mp-att-batch-none').props.children.at(-1),'11-11-26 · 12-11-26');}

 // One site in the report opens by itself; a stale choice is ignored.
 {const only=(await mount({chosen:{...filters,site:'Sasti OC'},data:payload([sites[2]],shiftBatches.filter(b=>b.siteKey==='sasti ob'))}))();assert.deepEqual(buttons(only,'mp-cat-open').map(n=>n.props.children),['Volvo Tippers','Graders','All equipment']);assert.equal(nodes(only,'th').filter(n=>n.props.scope==='row').length,1);}
 {const stale=(await mount({pick:{siteKey:'not a site',shift:'S1',equipment:'Volvo Tippers',flag:''}}))();assert.deepEqual(categories(stale),[]);assert.equal(buttons(stale,'mp-cat-open').length,0);}
});
