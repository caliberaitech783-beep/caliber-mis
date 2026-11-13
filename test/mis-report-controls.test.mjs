import {TableSmartPrint} from './helpers/smart-print-stub.mjs';
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
const nodes=(tree,type)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(node.type===type)found.push(node);visit(node.props.children);visit(node.props.rowsView)};visit(tree);return found};
// The Trip Timing tab hands its plain table to the delay view as `rowsView` (its "All trip rows" sub-tab).
const TripTimingReport=()=>null;
// The Loading Equipment-wise tab does the same with its "All machines list" sub-tab.
const LoadingMachineReport=()=>null;
async function component(file,name,scope={},initial=[]){
  const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function'),file,{jsx:{runtime:'classic'}});
  const slots=[...initial];let cursor=0;
  const environment={TableSmartPrint,StepBackButton:()=>null,encodeDateRange,parseDateRange,isDeletableScanCard,isAbortableScanCard,compactLogBookLabel,canonicalSiteName,SmartSelect: "select",TripTimingReport,LoadingMachineReport,React,useRef:()=>({current:null}),useEffect:()=>{},useMemo:fn=>fn(),useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]},...scope};
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
  // Every third case started in Shift 3 (46), the rest in Shift 1 (91).
  startDate:filters.from,startShift:id%3?'S1':'S3',
  // Log books rotate VLB, ELB, LMV; the first driver worked on two: 46 VLB, 47 ELB and 45 LMV duties from 137 events.
  logBooks:id?[['VLB','ELB','LMV'][id%3]]:['VLB','ELB'],logBook:id?['VLB','ELB','LMV'][id%3]:'VLB + ELB'}));
 const none={red:0,orange:0,review:0},reds=red=>({...none,red});
 const sites=[{site:'Jayant OC',siteKey:'jayant ob',...none,books:{VLB:none,ELB:none,LMV:none}},{site:'Sasti OC',siteKey:'sasti ob',...reds(137),books:{VLB:reds(46),ELB:reds(47),LMV:reds(45)}}];
 const payload={summary:rows,details:rows,performance:rows,ot:rows,otSites:sites,exceptions:[],totals:{assets:137,employees:137,duties:137,exceptions:0},notes:[],options:{},generatedAt:'2026-11-10T10:00:00Z'};
 const render=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[filters,{query,payload},'',false,0,{}]);
 for(const reportId of ['manpower','employee']){
  const tree=render({session:{token:'test'},reportId,onSelect:()=>{}}),sections=nodes(tree,ReportSection);assert.equal(sections.length,reportId==='manpower'?4:2);
  for(const section of sections.filter(n=>!['manpower-review','manpower-sites'].includes(n.props.category)))assert.equal(section.props.rows.length,137,'export receives every matching row');
  if(reportId==='employee'){const cols=sections[0].props.columns;assert.equal(cols.find(c=>c.key==='hours').value(rows[0]),0);assert.equal(cols.find(c=>c.key==='trips').value(rows[0]),'—');assert.ok(!cols.some(c=>c.key==='combinedHours'));}
 }
 // OT view in five steps: every site, one site date by shift, a date and shift by equipment category, the drivers of a category, one driver's history.
 // Cases two in three are Shift 1 + Shift 2 (91), the rest Shift 2 + Shift 3 (46); odd drivers work a Tipper, even ones an Excavator.
 // Ten more Tipper drivers worked a normal Shift 1. So 284 duties: Shift 1 = 91 red + 10 normal, Shift 2 = 137 red, Shift 3 = 46 red.
 const pair=id=>id%3?['S1','S2']:['S2','S3'],machine=id=>id%2?'Tipper':'Excavator';
 const cases=rows.map(r=>({...r,shifts:pair(r.id).map(code=>filters.from+' '+code).join('; ')}));
 const duty=(id,code,flag,key='E'+id)=>({id:key+code,date:filters.from,shift:code,site:'Sasti OC',siteKey:'sasti ob',employeeKey:key,employeeId:key,caliberCode:'C'+key,employeeName:'Example',category:'Volvo Driver',equipment:machine(id),doors:'V'+key,makeModel:'Volvo FMX',logBooks:flag==='normal'?['VLB']:rows[id].logBooks,logBook:'VLB',flag,flagLabel:flag==='normal'?'Normal duty':'RED — Back-to-back OT',others:'',hours:8,trips:null,books:'CARD'});
 const otDuties=[...rows.flatMap(r=>pair(r.id).map(code=>duty(r.id,code,'red'))),...Array.from({length:10},(_,i)=>duty(1,'S1','normal','N'+i))];
 const otPayload={...payload,ot:cases,otDuties};
 const blank={key:'',data:null,error:''},props={session:{token:'test'},reportId:'ot',onSelect:()=>{}},closed={siteKey:'',filter:'',scope:false,date:'',shift:'',equipment:'',flag:''};
 const ot=async({site='',logBook='',tally=blank,driverOpen='',otPick=closed,data=otPayload}={})=>{const view=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[{...filters,site},{query,payload:data},'',false,0,{},false,false,logBook,tally,driverOpen,{siteKey:'',shift:'',equipment:'',flag:''},otPick]);return ()=>view(props);};
 const categories=tree=>nodes(tree,ReportSection).map(n=>n.props.category);
 const section=(tree,category)=>nodes(tree,ReportSection).find(n=>n.props.category===category)?.props;
 const counts=tree=>nodes(tree,'button').filter(n=>/mp-cat-count/.test(n.props.className||'')).map(n=>n.props['aria-label']);
 const box=(tree,name)=>nodes(tree,'div').find(n=>n.props['aria-label']===name);
 const press=(view,label)=>nodes(view(),'button').find(n=>n.props['aria-label']===label).props.onClick();
 const sasti={...closed,siteKey:'sasti ob'},shiftOne={...sasti,scope:true,date:filters.from,shift:'S1'},everyone={...sasti,scope:true,equipment:'*'};
 // Step 1: one line per site; cases by colour, total duties and the share of red and orange duties.
 {const view=await ot(),overview=view();
  assert.deepEqual(categories(overview),['manpower-ot-sites'],'only the site lines before a number is pressed');
  assert.deepEqual(nodes(box(overview,'Cases by site'),'th').filter(n=>n.props.scope==='row').map(n=>n.props.children),['Sasti OC','Jayant OC','All sites']);
  assert.deepEqual(nodes(box(overview,'Cases by site'),'th').filter(n=>n.props.scope==='col').map(n=>[].concat(n.props.children)[0]),['Site','Total duties','Red','Orange','Brown','Red OT %','Orange OT %','Drivers']);
  assert.deepEqual(counts(overview),['284 duties · Sasti OC','137 Red · Sasti OC','137 drivers · Sasti OC','284 duties · All sites','137 Red · All sites','137 drivers · All sites'],'a site with nothing shows zeros, not buttons');
  assert.deepEqual(section(overview,'manpower-ot-sites').rows.map(r=>[r.site,r.duties,r.red,r.redPct,r.orangePct,r.drivers]),[['Sasti OC',284,137,'96.5%','0%',137],['Jayant OC',0,0,'—','—',0],['All sites',284,137,'96.5%','0%',137]],'the export holds what the table shows; red OT % is red duties out of all duties');
  assert.deepEqual(nodes(nodes(overview,'div').find(n=>n.props.className==='mp-book-pick'),'button').map(n=>n.props.children),['All log books','VLB','ELB','LMV'],'log book is one selector');
  // Step 2: pressing any number of a site opens it date by shift.
  press(view,'137 Red · Sasti OC');assert.deepEqual(categories(view()),['manpower-ot-sites','manpower-ot-dates']);
  const grid=()=>box(view(),'Duties by date and shift');
  assert.deepEqual(nodes(grid(),'th').filter(n=>n.props.scope==='col').map(n=>[].concat(n.props.children)[0]),['Date','Shift 1','Shift 2','Shift 3','Day duties','OT duties','Red OT %','Orange OT %']);
  assert.deepEqual(nodes(grid(),'th').filter(n=>n.props.scope==='row').map(n=>[].concat(n.props.children)[0]),['10-11-26'],'one selected date: one row and no All dates row');
  assert.deepEqual(nodes(grid(),'button').filter(n=>/mp-cat-count/.test(n.props.className)).map(n=>n.props['aria-label']),['101 duties · 10-11-26 · Shift 1','91 Red · 10-11-26 · Shift 1','137 duties · 10-11-26 · Shift 2','137 Red · 10-11-26 · Shift 2','46 duties · 10-11-26 · Shift 3','46 Red · 10-11-26 · Shift 3','284 duties · 10-11-26'],'a driver on two shifts is counted in both');
  assert.deepEqual(section(view(),'manpower-ot-dates').rows.map(r=>[r.date,r.S1_duties,r.S1_red,r.S2_red,r.S3_duties,r.duties,r.ot,r.redPct]),[['10-11-26',101,91,137,46,284,274,'96.5%']]);
  // Step 3: a box opens that date and shift by equipment category.
  press(view,'101 duties · 10-11-26 · Shift 1');assert.deepEqual(categories(view()),['manpower-ot-sites','manpower-ot-dates','manpower-ot-categories']);
  const byCategory=()=>section(view(),'manpower-ot-categories');
  assert.equal(byCategory().title,'Step 3 · Sasti OC · 10-11-26 · Shift 1 · by equipment category');
  assert.deepEqual(byCategory().rows.map(r=>[r.equipment,r.people,r.machines,r.red,r.redPct,r.orange,r.ot,r.otPct]),[['Tipper',55,55,45,'81.8%',0,45,'81.8%'],['Excavator',46,46,46,'100%',0,46,'100%'],['All categories',101,101,91,'90.1%',0,91,'90.1%']]);
  assert.ok(!byCategory().columns.some(c=>c.key==='duties'),'one shift: people and duties are the same number');
  // Step 4: a category lists its drivers, OT duties first; a colour lists only those.
  nodes(box(view(),'Duties by equipment category'),'button').find(n=>n.props.className==='mp-cat-open'&&n.props.children==='Tipper').props.onClick();
  assert.deepEqual(categories(view()),['manpower-ot-sites','manpower-ot-dates','manpower-ot-categories','manpower-ot-drivers','manpower-ot']);
  const drivers=()=>section(view(),'manpower-ot-drivers'),each=()=>section(view(),'manpower-ot');
  assert.equal(drivers().title,'Step 4 · Sasti OC · 10-11-26 · Shift 1 · Tipper · drivers');assert.equal(drivers().rows.length,55);
  assert.deepEqual([drivers().rows[0].flag,drivers().rows[44].flag,drivers().rows[45].flag],['red','red','normal'],'OT duties first');
  assert.deepEqual(drivers().columns.map(c=>c.key),['employeeId','caliberCode','employeeName','category','doors','makeModel','logBook','others','flagLabel','hours','trips','otMonthRed','otMonthOrange','otYearRed','otYearOrange','books'],'one date, shift, site and category: none of them is a column');
  assert.deepEqual([drivers().recordDateFilter,each().recordDateFilter],[false,false],'the page dates are the only date control');
  assert.equal(drivers().rowClassName(drivers().rows[0]),'mp-duty-red');assert.match(drivers().columns.find(c=>c.key==='flagLabel').render(drivers().rows[0]).props.className,/mp-flag-red/);
  assert.equal(each().rows.length,45,'the cases behind the listed OT duties');
  {const cols=each().columns;assert.equal(cols.find(c=>c.key==='combinedHours').value(cases[1]),15);const reason=cols.find(c=>c.key==='reason');assert.match(reason.render(cases[1]).props.className,/mp-flag-red/);assert.equal(each().rowClassName(cases[1]),'mp-ot-red');}
  press(view,'45 Red · Tipper');assert.equal(drivers().title,'Step 4 · Sasti OC · 10-11-26 · Shift 1 · Tipper · Red only · drivers');assert.equal(drivers().rows.length,45);
  press(view,'45 Red · Tipper');assert.deepEqual(categories(view()).slice(-1),['manpower-ot-categories'],'pressing the same number again closes the list');
  // A colour in a box goes straight to those drivers, across every category.
  press(view,'46 Red · 10-11-26 · Shift 3');assert.equal(drivers().title,'Step 4 · Sasti OC · 10-11-26 · Shift 3 · All categories · Red only · drivers');assert.equal(drivers().rows.length,46);assert.ok(drivers().columns.some(c=>c.key==='equipment'));
  // A whole day: people are different persons, so Duties returns as a column.
  press(view,'284 duties · 10-11-26');assert.equal(byCategory().title,'Step 3 · Sasti OC · 10-11-26 · All shifts · by equipment category');
  assert.deepEqual(byCategory().rows.map(r=>[r.equipment,r.people,r.duties]),[['Tipper',78,146],['Excavator',69,138],['All categories',147,284]]);
  // The strip above the date table narrows it to one equipment category.
  assert.deepEqual(nodes(box(view(),'Equipment category'),'button').map(n=>n.props['aria-label']),['All categories · 284 duties','Tipper · 146 duties','Excavator · 138 duties']);
  press(view,'Excavator · 138 duties');assert.deepEqual(section(view(),'manpower-ot-dates').rows.map(r=>[r.duties,r.S1_duties]),[[138,46]]);assert.match(section(view(),'manpower-ot-dates').title,/ · Excavator$/);
  // The trail steps back: the site name closes everything under the date table, All sites closes the site.
  const trail=()=>nodes(nodes(view(),'p').find(n=>n.props.className==='mp-trail'),'button');
  press(view,'46 duties · 10-11-26 · Shift 1');assert.deepEqual(trail().map(n=>n.props.children),['All sites','Sasti OC','10-11-26 · Shift 1']);
  trail()[1].props.onClick();assert.deepEqual(categories(view()),['manpower-ot-sites','manpower-ot-dates']);
  trail()[0].props.onClick();assert.deepEqual(categories(view()),['manpower-ot-sites']);}
 // Several dates: every date has a row, then All dates; a stale date or shift is read as the whole selection.
 {const two={...filters,to:'2026-11-11'},twoQuery=new URLSearchParams(two).toString();
  const view=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[two,{query:twoQuery,payload:otPayload},'',false,0,{},false,false,'',blank,'',{siteKey:'',shift:'',equipment:'',flag:''},{...sasti,scope:true,date:'2026-10-01',shift:'S9'}]),tree=view(props);
  assert.deepEqual(nodes(box(tree,'Duties by date and shift'),'th').filter(n=>n.props.scope==='row').map(n=>[].concat(n.props.children)[0]),['10-11-26','11-11-26','All dates']);
  assert.equal(section(tree,'manpower-ot-categories').title,'Step 3 · Sasti OC · All dates · All shifts · by equipment category');
  assert.ok(counts(tree).includes('284 duties · All dates'));}
 // The log book selector narrows every number; a duty saved in two log books counts under both.
 for(const [book,expected,worked] of [['VLB',46,102],['ELB',47,94],['LMV',45,90]]){const tree=(await ot({logBook:book,otPick:everyone}))();assert.equal(section(tree,'manpower-ot').rows.length,expected,book);assert.ok(counts(tree).includes(expected+' Red · Sasti OC'));assert.ok(counts(tree).includes(worked+' duties · Sasti OC'),book);assert.match(section(tree,'manpower-ot-drivers').description,new RegExp(' · '+book+' · '));}
 // The Site selection narrows the list of sites; one site opens by itself.
 {const only=(await ot({site:'Sasti OC'}))();assert.deepEqual(nodes(box(only,'Cases by site'),'th').filter(n=>n.props.scope==='row').map(n=>n.props.children),['Sasti OC']);assert.deepEqual(categories(only),['manpower-ot-sites','manpower-ot-dates']);
  const other=(await ot({site:'Jayant OC'}))();assert.deepEqual(section(other,'manpower-ot-dates').rows.map(r=>r.duties),[0],'another site never shows this site’s duties');
  assert.deepEqual(categories((await ot({otPick:{...closed,siteKey:'not a site',scope:true,equipment:'*'}}))()),['manpower-ot-sites'],'a stale choice is ignored');}
 // Drivers list: red and orange for the month and year, and the name opens that driver's month-wise history.
 {const event=(id,date,severity)=>({id,date,dates:date,severity,reason:severity.toUpperCase()+' — fixture',shifts:date+' S1; '+date+' S2',logBook:'VLB',equipment:'Tipper / Volvo',combinedHours:15,books:'CARD'});
  const yearData={year:'2026',month:'2026-11',yearFrom:'2026-11-01',yearTo:'2026-11-10',monthFrom:'2026-11-01',monthTo:'2026-11-10',drivers:[{employeeKey:'E1',siteKey:'sasti ob',month:{red:4,orange:1,review:0,total:5},year:{red:20,orange:4,review:1,total:25},events:[event('a','2026-11-09','red'),event('b','2026-11-03','orange')],duties:{'2026-11':9}}]};
  const loaded={key:'sasti ob|2026-11|0',data:yearData,error:''},list=view=>section(view(),'manpower-ot-drivers'),row=(view,id)=>list(view).rows.find(r=>r.employeeId===id);
  const waiting=await ot({otPick:everyone});assert.deepEqual(list(waiting).columns.filter(c=>/^ot(Month|Year)/.test(c.key)).map(c=>c.label),['Red in Nov 2026','Orange in Nov 2026','Red in 2026','Orange in 2026']);
  assert.deepEqual(['otMonthRed','otMonthOrange','otYearRed','otYearOrange'].map(key=>row(waiting,'E1')[key]),Array(4).fill('Checking…'),'counts are never shown as zero before they load');
  assert.equal(row(await ot({otPick:everyone,tally:{key:'sasti ob|2026-11|0',data:null,error:'Unable to load the month and year counts.'}}),'E1').otYearRed,'Unavailable');
  const all={...everyone,siteKey:'*'};
  assert.equal(row(await ot({otPick:all,tally:loaded}),'E1').otYearRed,'Press the name','in a list of every site the counts are read for the driver whose name is pressed');
  assert.equal(row(await ot({otPick:all,tally:loaded,driverOpen:'E1|sasti ob'}),'E1').otYearRed,20);assert.equal(list(await ot({otPick:all})).columns[1].key,'site','every site: the Site column returns after the shift');
  const view=await ot({otPick:everyone,tally:loaded});
  assert.deepEqual(['E0','E1','E2'].map(id=>[row(view,id).otMonthRed,row(view,id).otMonthOrange,row(view,id).otYearRed,row(view,id).otYearOrange]),[[0,0,0,0],[4,1,20,4],[0,0,0,0]],'red and orange are counted apart, for the month and for the year');
  const name=()=>list(view).columns.find(c=>c.key==='employeeName'),button=name().render(row(view,'E1'));assert.equal(button.type,'button');assert.equal(button.props.children,'Example');assert.equal(name().value(row(view,'E1')),'Example','exports keep the plain name');
  button.props.onClick();assert.deepEqual(categories(view()).slice(-3),['manpower-ot-drivers','manpower-ot-driver-history','manpower-ot']);
  const history=section(view(),'manpower-ot-driver-history');assert.deepEqual(history.rows.map(r=>[r.date,r.severity]),[['2026-11-09','red'],['2026-11-03','orange']]);assert.equal(history.title,'Example · flagged duties in 2026');assert.equal(history.rowClassName(history.rows[0]),'mp-ot-red');
  const monthTable=nodes(nodes(view(),'div').find(n=>/mp-driver-history/.test(n.props.className||'')),'tr').map(line=>[].concat(line.props.children).map(cell=>cell.props.children));
  assert.deepEqual(monthTable,[['Month','Duties','Red','Orange','Brown','OT times','OT % of duties'],['Nov 2026',9,1,1,0,2,'44.4%'],[['Year ','2026'],9,1,1,0,2,'44.4%']],'duties and OT month by month, then the year; four of the nine duties were part of a case');
  name().render(row(view,'E1')).props.onClick();assert.deepEqual(categories(view()).slice(-2),['manpower-ot-drivers','manpower-ot'],'pressing the name again closes the history');}
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
 const shiftBatches=[batch('dhoptala','S1','none'),batch('dhoptala','S2','not_due'),batch('dhoptala','S3','not_due'),batch('jayant ob','S1','closed','J1'),batch('jayant ob','S2','lmv_open','JAYANT-S2'),batch('jayant ob','S3','vlb_open','JAYANT-S3'),batch('sasti ob','S1','closed','S1'),batch('sasti ob','S2','elb_open','SASTI-S2'),batch('sasti ob','S3','none')];
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
  '0 actual duties · Jayant OC · Shift 2 · LMV open','1 actual duty · Jayant OC · Shift 3 · VLB open','1 actual duty · Jayant OC · All shifts · 2 open',
  '4 actual duties · Sasti OC · Shift 1','1 actual duty · Sasti OC · Shift 2 · ELB open','0 actual duties · Sasti OC · Shift 3 · No batch','5 actual duties · Sasti OC · All shifts · 1 shift no batch · 1 open',
  '4 actual duties · All sites · Shift 1 · 1 shift no batch','1 actual duty · All sites · Shift 2 · 2 open','1 actual duty · All sites · Shift 3 · 1 shift no batch · 1 open','6 actual duties · All sites · All shifts · 2 shifts no batch · 3 open'],'the second machine of one driver is not another actual duty');
 assert.deepEqual(buttons(first,'mp-att-none').map(n=>n.props['aria-label'].split(' · ').slice(1,3).join(' ')),['Dhoptala OC Shift 1','Sasti OC Shift 3'],'only the box of one site and shift is painted red');
 assert.deepEqual(buttons(first,'mp-att-open').map(n=>n.props['aria-label'].split(' · ').slice(1,3).join(' ')),['Jayant OC Shift 2','Jayant OC Shift 3','Sasti OC Shift 2']);
 assert.deepEqual(nodes(nodes(first,'p').find(n=>n.props.className==='mp-att-status'),'span').slice(0,2).map(n=>[].concat(n.props.children).join('')),['2 shifts without a batch','3 batches open']);
 assert.deepEqual(categories(first),[],'no driver list before a site and shift are chosen');
 assert.equal(buttons(first,'mp-cat-open').length,0);

 // Step 2: pressing Shift 1 of a site lists its equipment with both totals and the four colours.
 press(first,'4 actual duties · Sasti OC · Shift 1');
 const second=view();
 assert.deepEqual(buttons(second,'mp-cat-open').map(n=>n.props.children),['Volvo Tippers','Graders','All equipment']);
 assert.deepEqual(buttons(second,'mp-cat-count').map(n=>n.props['aria-label']),['3 equipment-wise duties · Volvo Tippers','1 Red · Volvo Tippers','2 equipment-wise duties · Graders','1 second machine · Graders','1 Blue · Graders','5 equipment-wise duties · All equipment','1 second machine · All equipment','1 Red · All equipment','1 Blue · All equipment'],'Second machine is equipment-wise minus actual duties; a zero is not a button');
 assert.match(nodes(second,'p').find(n=>n.props.className==='mp-att-foot').props.children.join(''),/^1 duty here is a second machine/);
 assert.equal(nodes(second,'p').filter(n=>/mp-att-batch/.test(n.props.className||'')).length,0,'a closed batch needs no line');
 assert.deepEqual(categories(second),[]);
 // The Second machine number lists only the drivers for whom this equipment was a second machine in the shift.
 press(second,'1 second machine · Graders');
 {const extra=nodes(view(),ReportSection)[0].props;assert.equal(extra.title,'Shift Attendance Equipment Wise · Sasti OC · Shift 1 · 10-11-26 · Graders · Second machine only');
  assert.deepEqual(extra.rows.map(r=>[r.equipment,r.actual,r.actualLabel]),[['Graders',false,'No — second machine']]);assert.equal(extra.description.split(' · ').slice(0,2).join(' · '),'1 equipment-wise duty · 0 actual duties');
  assert.equal(buttons(view(),'mp-cat-count').find(n=>n.props['aria-label']==='1 second machine · Graders').props['aria-pressed'],true);}
 press(view(),'1 second machine · Graders');assert.deepEqual(categories(view()),[],'pressing the same number again closes the list');

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
  assert.deepEqual(table,[['Month','Duties','Red','Orange','Brown','OT times','OT % of duties'],['Nov 2026',8,1,0,0,1,'25%'],[['Year ','2026'],8,1,0,0,1,'25%']]);
  assert.deepEqual(nodes(history(),ReportSection)[1].props.rows.map(r=>r.id),['a']);
  // A driver with duties and no OT still has a history.
  rowsOf(history).columns.find(c=>c.key==='employeeName').render(rowsOf(history).rows[0]).props.onClick();
  assert.deepEqual(nodes(nodes(history(),'div').find(n=>/mp-driver-history/.test(n.props.className||'')),'tr')[1].props.children.map(cell=>cell.props.children),['Nov 2026',10,0,0,0,0,'0%']);}

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

test('manpower by category opens sites, then date by shift, then equipment category, and the two lists follow',async()=>{
 const filters={from:'2026-11-10',to:'2026-11-11',site:'',shift:'',batch:'',employee:'',asset:''},query=new URLSearchParams(filters).toString();
 const names={'sasti ob':'Sasti OC','jayant ob':'Jayant OC'};
 // Sasti: three machines, three employees, five duties on six cards (one card has no matched employee). Jayant: one of each.
 const card=(id,date,shift,equipment,door,employee,siteKey='sasti ob')=>({id,date,site:names[siteKey],siteKey,shift,equipment,door,assetKey:siteKey+'|'+door,employeeKey:employee,dutyKey:employee&&JSON.stringify([employee,siteKey,date,shift]),employeeId:employee,employeeName:'Example'});
 const details=[card(1,'2026-11-10','S1','Tipper','V1','E1'),card(2,'2026-11-10','S1','Tipper','V2','E2'),card(3,'2026-11-10','S1','Excavator','X1','E3'),card(4,'2026-11-10','S2','Tipper','V1','E1'),card(5,'2026-11-11','S1','Tipper','V1','E1'),card(6,'2026-11-10','S1','Tipper','V1',''),card(7,'2026-11-10','S1','Dozer','D1','E9','jayant ob')];
 const line=(date,shift,equipment,siteKey='sasti ob')=>({date,site:names[siteKey],siteKey,shift,equipment,category:'VEHICLE',group:equipment,make:'Make',model:'Model',assets:1,employees:1});
 const summary=[line('2026-11-10','S1','Tipper'),line('2026-11-10','S1','Excavator'),line('2026-11-10','S2','Tipper'),line('2026-11-11','S1','Tipper'),line('2026-11-10','S1','Dozer','jayant ob')];
 const payload={summary,details,performance:[],ot:[],otSites:[{site:'Jayant OC',siteKey:'jayant ob'},{site:'Sasti OC',siteKey:'sasti ob'}],exceptions:[],totals:{assets:4,employees:4,duties:6,exceptions:0},notes:[],options:{},generatedAt:'2026-11-11T10:00:00Z'};
 const view=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[filters,{query,payload},'',false,0,{}]),tree=()=>view({session:{token:'test'},reportId:'manpower',onSelect:()=>{}});
 const section=category=>nodes(tree(),ReportSection).find(n=>n.props.category===category)?.props,categories=()=>nodes(tree(),ReportSection).map(n=>n.props.category);
 const press=label=>nodes(tree(),'button').find(n=>n.props['aria-label']===label).props.onClick(),counts=r=>[r.machines,r.employees,r.duties,r.cards];
 // Step 1: one line per site; the two lists hold everything until a site is opened.
 assert.deepEqual(categories(),['manpower-sites','manpower-summary','manpower-assignments','manpower-review']);
 assert.deepEqual(section('manpower-sites').rows.map(r=>[r.site,...counts(r)]),[['Jayant OC',1,1,1,1],['Sasti OC',3,3,5,6],['All sites',4,4,6,7]],'the All sites line equals the count cards on top');
 assert.deepEqual([section('manpower-summary').rows.length,section('manpower-assignments').rows.length],[5,7]);
 // Step 2: a site opens date by shift, and the lists narrow to it.
 press('5 duties · Sasti OC');assert.deepEqual(categories().slice(0,2),['manpower-sites','manpower-dates']);
 assert.deepEqual(section('manpower-dates').rows.map(r=>[r.date,r.S1_duties,r.S1_machines,r.S2_duties,r.S3_duties,...counts(r)]),[['10-11-26',3,3,1,0,3,3,4,5],['11-11-26',1,1,0,0,1,1,1,1],['All dates',4,3,1,0,3,3,5,6]]);
 assert.equal(section('manpower-assignments').title,'Vehicle & Employee Assignments · Sasti OC');assert.equal(section('manpower-assignments').rows.length,6);
 // Step 3: a box opens that date and shift by equipment category.
 press('3 duties · 3 machines · 10-11-26 · Shift 1');assert.equal(section('manpower-categories').title,'Step 3 · Sasti OC · 10-11-26 · Shift 1 · by equipment category');
 assert.deepEqual(section('manpower-categories').rows.map(r=>[r.equipment,...counts(r)]),[['Tipper',2,2,2,3],['Excavator',1,1,1,1],['All categories',3,3,3,4]],'a card without a matched employee is a saved card, not a duty');
 assert.equal(section('manpower-assignments').rows.length,4);
 // A category narrows the two lists to its makes, models and cards.
 nodes(tree(),'button').find(n=>n.props.className==='mp-cat-open'&&n.props.children==='Tipper').props.onClick();
 assert.equal(section('manpower-assignments').title,'Vehicle & Employee Assignments · Sasti OC · 10-11-26 · Shift 1 · Tipper');
 assert.deepEqual([section('manpower-summary').rows.length,section('manpower-assignments').rows.map(r=>r.id)],[1,[1,2,6]]);
 // The whole day, then the trail back to every site.
 press('4 duties · 10-11-26');assert.deepEqual(section('manpower-categories').rows.map(r=>[r.equipment,r.duties]),[['Tipper',3],['Excavator',1],['All categories',4]]);
 const trail=()=>nodes(nodes(tree(),'p').find(n=>n.props.className==='mp-trail'),'button');
 assert.deepEqual(trail().map(n=>n.props.children),['All sites','Sasti OC','10-11-26 · All shifts']);
 trail()[0].props.onClick();assert.deepEqual(categories(),['manpower-sites','manpower-summary','manpower-assignments','manpower-review']);assert.equal(section('manpower-assignments').rows.length,7);
});

test('manpower by category reconciliation compares the fleet with saved cards, shift by shift, down to the machines',async()=>{
 const filters={from:'2026-11-10',to:'2026-11-10',site:'',shift:'',batch:'',employee:'',asset:''},query=new URLSearchParams(filters).toString();
 // Sasti fleet: three tippers and one excavator. Shift 1: V1 worked, V2 has a card with 0 trips and 0 km, X1 worked, V3 has no card,
 // and V9 (listed at another site) has a card here. Shift 2: only V1 worked, with 0 km written.
 const machine=(door,equipment)=>({siteKey:'sasti ob',key:'k'+door,door,equipment,makeModel:'Make Model'});
 const fleet=[machine('V1','Tipper'),machine('V2','Tipper'),machine('V3','Tipper'),machine('X1','Excavator')];
 const did=(door,shift,equipment,active,zeroKm,inFleet=true)=>({siteKey:'sasti ob',date:filters.from,shift,key:'k'+door,inFleet,door,equipment,makeModel:'Make Model',logBook:equipment==='Tipper'?'VLB':'ELB',trips:equipment==='Tipper'?(active?5:0):null,km:equipment==='Tipper'?(zeroKm?0:40):null,hours:7,active,zeroKm,employees:'SAMPLE DRIVER',books:'CARD-'+door+shift});
 const fleetWork=[did('V1','S1','Tipper',true,false),did('V2','S1','Tipper',false,true),did('X1','S1','Excavator',true,false),did('V9','S1','Tipper',true,false,false),did('V1','S2','Tipper',true,true)];
 const payload={summary:[],details:[],performance:[],ot:[],fleet,fleetWork,otSites:[{site:'Jayant OC',siteKey:'jayant ob'},{site:'Sasti OC',siteKey:'sasti ob'}],exceptions:[],totals:{assets:0,employees:0,duties:0,exceptions:0},notes:[],options:{},generatedAt:'2026-11-11T10:00:00Z'};
 assert.equal(operations.operationReports.find(r=>r.id==='manpower-reconciliation').title,'Manpower by Category Reconciliation');
 const view=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[filters,{query,payload},'',false,0,{}]),tree=()=>view({session:{token:'test'},reportId:'manpower-reconciliation',onSelect:()=>{}});
 const section=category=>nodes(tree(),ReportSection).find(n=>n.props.category===category)?.props,categories=()=>nodes(tree(),ReportSection).map(n=>n.props.category);
 const press=label=>nodes(tree(),'button').find(n=>n.props['aria-label']===label).props.onClick();
 const counts=r=>[r.available,r.carded,r.active,r.zero,r.zeroKm,r.none,r.share,r.outside];
 assert.ok(nodes(tree(),'button').some(n=>n.props.children==='Manpower by Category Reconciliation'&&n.props['aria-current']==='page'),'the tab row names the report');
 assert.equal(nodes(tree(),'div').filter(n=>n.props.className==='mp-metrics').length,0,'the count cards of the other tabs are not shown');
 // Step 1: three shifts of four machines are twelve machine-shifts; four had a card, three worked.
 assert.deepEqual(categories(),['manpower-rc-sites']);
 assert.deepEqual(section('manpower-rc-sites').rows.map(r=>[r.site,r.machines,...counts(r)]),[['Jayant OC',0,0,0,0,0,0,0,'—',0],['Sasti OC',4,12,4,3,1,2,8,'33.3%',1],['All sites',4,12,4,3,1,2,8,'33.3%',1]]);
 // Step 2: one line per date and shift.
 press('4 machines · Sasti OC');
 assert.deepEqual(section('manpower-rc-shifts').rows.map(r=>[r.date,r.shift,...counts(r)]),[['10-11-26','Shift 1',4,3,2,1,1,1,'75%',1],['10-11-26','Shift 2',4,1,1,0,1,3,'25%',0],['10-11-26','Shift 3',4,0,0,0,0,4,'0%',0],['All dates','All shifts',12,4,3,1,2,8,'33.3%',1]]);
 // Step 3: the shift by equipment category; a card of a machine listed elsewhere stays outside Available and Card saved.
 press('4 Available · 10-11-26 · Shift 1');assert.equal(section('manpower-rc-categories').title,'Step 3 · Sasti OC · 10-11-26 · Shift 1 · by equipment category');
 assert.deepEqual(section('manpower-rc-categories').rows.map(r=>[r.equipment,...counts(r)]),[['Tipper',3,2,1,1,1,1,'66.7%',1],['Excavator',1,1,1,0,0,0,'100%',0],['All categories',4,3,2,1,1,1,'75%',1]]);
 // Step 4: every machine of the category, or only those of the number pressed.
 nodes(tree(),'button').find(n=>n.props.className==='mp-cat-open'&&n.props.children==='Tipper').props.onClick();
 assert.deepEqual(section('manpower-rc-machines').rows.map(r=>[r.door,r.statusLabel]),[['V1','Active production'],['V2','Zero trips · Zero km'],['V3','No card'],['V9','Not in fleet list · worked']]);
 assert.deepEqual(section('manpower-rc-machines').columns.map(c=>c.key),['door','makeModel','statusLabel','logBook','trips','km','hours','employees','books']);
 press('1 No card · Tipper');assert.equal(section('manpower-rc-machines').title,'Step 4 · Sasti OC · 10-11-26 · Shift 1 · Tipper · No card · machines');assert.deepEqual(section('manpower-rc-machines').rows.map(r=>r.door),['V3']);
 press('1 Zero km · Tipper');assert.deepEqual(section('manpower-rc-machines').rows.map(r=>r.door),['V2']);
 press('1 Not in fleet list · All categories');assert.deepEqual(section('manpower-rc-machines').rows.map(r=>r.door),['V9']);
 // The total line opens every shift together, with Date and Shift as columns of the machine list.
 press('8 No card · All dates · All shifts');press('8 No card · All categories');
 assert.equal(section('manpower-rc-machines').rows.length,8);assert.deepEqual(section('manpower-rc-machines').columns.slice(0,2).map(c=>c.key),['shift','door'],'one date: only Shift returns as a column');
 const trail=()=>nodes(nodes(tree(),'p').find(n=>n.props.className==='mp-trail'),'button');
 trail()[0].props.onClick();assert.deepEqual(categories(),['manpower-rc-sites']);
});
