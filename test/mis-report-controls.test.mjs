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
  const environment={TabSelectionDialog:({children})=>children,encodeDateRange,parseDateRange,isDeletableScanCard,isAbortableScanCard,compactLogBookLabel,canonicalSiteName,SmartSelect: "select",React,useRef:()=>({current:null}),useEffect:()=>{},useMemo:fn=>fn(),useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]},...scope};
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
 // OT view: every site is loaded and shown first; duty details appear only after a site is opened.
 const ot=async(site,severity='',history={key:'',data:null,error:''},logBook='',drill={category:'',severity:''})=>{const chosen={...filters,site},view=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[chosen,{query,payload},'',false,0,{},false,false,severity,history,logBook,drill]);return view({session:{token:'test'},reportId:'ot',onSelect:()=>{}});};
 const overview=await ot('');assert.deepEqual(nodes(overview,ReportSection).map(n=>n.props.category),['manpower-review'],'no duty table before a site is opened');
 assert.deepEqual(nodes(overview,'button').filter(n=>n.props.className==='mp-site-card').map(n=>nodes(n,'strong')[0].props.children),['Jayant OC','Sasti OC']);
 // Flag totals: one row for all log books, then VLB, ELB and LMV; each row is red, orange, review.
 const counts=tree=>nodes(tree,'button').filter(n=>/mp-ot-count/.test(n.props.className)).map(n=>nodes(n,'strong')[0].props.children);
 assert.deepEqual(counts(overview),[137,0,0,46,0,0,47,0,0,45,0,0]);
 assert.deepEqual(nodes(overview,'button').filter(n=>n.props.className==='mp-ot-book').map(n=>nodes(n,'b')[0].props.children),['All','VLB','ELB','LMV']);
 assert.deepEqual(nodes(nodes(overview,'button').filter(n=>n.props.className==='mp-site-card')[1],'b').map(n=>n.props.children),['VLB',46,0,0,'ELB',47,0,0,'LMV',45,0,0],'each site card lists the three log books');
 assert.equal(nodes(overview,'div').filter(n=>n.props.className==='mp-metrics'||n.props.className==='mp-legend').length,0,'old summary panel is gone');
 const drilled=await ot('Sasti OC'),sections=nodes(drilled,ReportSection);assert.deepEqual(sections.map(n=>n.props.category),['manpower-ot','manpower-review']);assert.equal(sections[0].props.rows.length,137,'export receives every matching row');
 {const cols=sections[0].props.columns;assert.equal(cols.find(c=>c.key==='combinedHours').value(rows[0]),15);assert.equal(cols.find(c=>c.key==='category').value(rows[1]),'Volvo Driver');const reason=cols.find(c=>c.key==='reason');assert.match(reason.value(rows[0]),/^RED/);assert.match(reason.render(rows[0]).props.className,/mp-flag-red/);assert.equal(sections[0].props.rowClassName(rows[0]),'mp-ot-red');}
 // Driver category table: the name, each non-zero count and the driver count are buttons that drill down.
 const cellValue=cell=>{const inner=cell.props.children;return React.isValidElement(inner)?inner.props.children:inner;};
 assert.deepEqual(nodes(drilled,'tbody')[1].props.children.map(row=>row.props.children.flat().map(cellValue)),[['Dumper Operator',69,0,0,69],['Volvo Driver',68,0,0,68]]);
 {const picked=nodes(await ot('Sasti OC','',undefined,'',{category:'Volvo Driver',severity:''}),ReportSection);assert.deepEqual(picked.map(n=>n.props.category),['manpower-ot-drivers','manpower-ot','manpower-review']);
  const [drivers,duties]=picked;assert.equal(drivers.props.rows.length,68,'one row per driver of the chosen category');assert.equal(duties.props.rows.length,68);assert.ok(duties.props.rows.every(r=>r.category==='Volvo Driver'));assert.match(drivers.props.title,/Sasti OC · Volvo Driver · drivers/);assert.match(duties.props.title,/Sasti OC · Volvo Driver$/);
  const value=key=>drivers.props.columns.find(c=>c.key===key).value(drivers.props.rows[0]);assert.deepEqual(['employeeId','red','orange','review','total','dutyDates'].map(value),['E1',1,0,0,1,filters.from]);}
 {const orangeOnly=nodes(await ot('Sasti OC','',undefined,'',{category:'Volvo Driver',severity:'orange'}),ReportSection);assert.deepEqual(orangeOnly.slice(0,2).map(n=>n.props.rows.length),[0,0],'a colour inside a category lists only that colour');assert.match(orangeOnly[1].props.title,/Volvo Driver · ORANGE only/);
  const redWins=nodes(await ot('Sasti OC','orange',undefined,'',{category:'Volvo Driver',severity:'red'}),ReportSection);assert.deepEqual(redWins.map(n=>n.props.category),['manpower-ot-history','manpower-ot-drivers','manpower-ot','manpower-review']);assert.equal(redWins[2].props.rows.length,68,'the colour pressed in the category table decides the list under it');
  const stale=nodes(await ot('Sasti OC','',undefined,'',{category:'Not at this site',severity:'red'}),ReportSection);assert.deepEqual(stale.map(n=>n.props.category),['manpower-ot','manpower-review']);assert.equal(stale[0].props.rows.length,137,'a category that is not at the opened site is ignored');}
 {const view=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[{...filters,site:'Sasti OC'},{query,payload},'',false,0,{},false,false,'',{key:'',data:null,error:''},'']),props={session:{token:'test'},reportId:'ot',onSelect:()=>{}};
  const press=label=>nodes(view(props),'button').find(n=>n.props['aria-label']===label).props.onClick();
  press('68 RED · Volvo Driver');let shown=nodes(view(props),ReportSection);assert.deepEqual(shown.map(n=>n.props.category),['manpower-ot-drivers','manpower-ot','manpower-review']);assert.match(shown[0].props.title,/Volvo Driver · RED only · drivers/);assert.equal(shown[1].props.rows.length,68);
  press('69 drivers · Dumper Operator');shown=nodes(view(props),ReportSection);assert.equal(shown[0].props.rows.length,69);assert.ok(shown[1].props.rows.every(r=>r.category==='Dumper Operator'));
  press('69 drivers · Dumper Operator');assert.deepEqual(nodes(view(props),ReportSection).map(n=>n.props.category),['manpower-ot','manpower-review'],'pressing the same choice again shows every category');}
 assert.equal(sections[0].props.columns.find(c=>c.key==='logBook').value(rows[0]),'VLB + ELB');
 // Choosing a log book narrows the site's duty list to it; a duty saved in two log books shows under both.
 for(const [book,expected] of [['VLB',46],['ELB',47],['LMV',45]]){const view=await ot('Sasti OC','',undefined,book),list=nodes(view,ReportSection)[0];assert.equal(list.props.rows.length,expected,book);assert.match(list.props.title,new RegExp('Sasti OC · '+book));assert.equal(list.props.rows.some(r=>r.employeeId==='E0'),book!=='LMV',book);assert.deepEqual(counts(view),[137,0,0,46,0,0,47,0,0,45,0,0],'the totals keep showing every log book');}
 {const lmvReds=nodes(await ot('Sasti OC','red',undefined,'LMV'),ReportSection)[0];assert.equal(lmvReds.props.category,'manpower-ot-history');assert.equal(lmvReds.props.rows.length,45);assert.match(lmvReds.props.title,/RED drivers on LMV/);assert.equal(lmvReds.props.columns.find(c=>c.key==='logBook').value(lmvReds.props.rows[0]),'LMV');}
 assert.equal(nodes(await ot('Jayant OC'),ReportSection)[0].props.rows.length,0,'another site never shows this site’s drivers');
 const earlier={historyFrom:'2026-11-01',historyTo:'2026-11-09',historyDays:90,drivers:[{employeeKey:'E5',siteKey:'sasti ob',red:3,orange:1,review:0,redDates:['2026-11-02','2026-11-04','2026-11-06'],orangeDates:['2026-11-08']}]};
 const repeats=nodes(await ot('Sasti OC','red',{key:filters.from+'|'+filters.to+'|sasti ob',data:earlier,error:''}),ReportSection)[0];assert.equal(repeats.props.category,'manpower-ot-history');assert.equal(repeats.props.rows.length,137);
 {const top=repeats.props.rows[0],value=key=>repeats.props.columns.find(c=>c.key===key).value(top);assert.equal(top.employeeId,'E5','most repeated driver is listed first');assert.deepEqual(['now','pastRed','pastOrange','total'].map(value),[1,3,1,4]);assert.match(value('pastDates'),/2026-11-02 RED.*2026-11-08 ORANGE/);assert.equal(repeats.props.columns.find(c=>c.key==='pastRed').value(repeats.props.rows[1]),0);}
 const waiting=nodes(await ot('Sasti OC','red'),ReportSection)[0];assert.equal(waiting.props.rows[0].pastRed,'Checking…','earlier counts are never shown as zero before they load');
 const tree=render({session:{token:'test'},reportId:'employee',onSelect:()=>{}});nodes(tree,'input').find(n=>n.props.type==='date').props.onChange({target:{value:'2026-11-09'}});
 assert.equal(nodes(render({session:{token:'test'},reportId:'employee',onSelect:()=>{}}),ReportSection).length,0,'changed filters cannot export stale results');
});


test('shift attendance equipment wise opens sites by shift, then equipment, then the coloured driver list',async()=>{
 const filters={from:'2026-11-10',to:'2026-11-10',site:'',shift:'',batch:'',employee:'',asset:''};
 const duty=(n,siteKey,site,shift,equipment,flag='normal',actual=true)=>({id:'d'+n,date:filters.from,shift,site,siteKey,employeeId:'E'+n,caliberCode:'C'+n,employeeName:'Driver '+n,equipment,doors:'V'+n,makeModel:'VOLVO FMX',status:'Present',trips:1,actual,actualLabel:actual?'Yes':'No — second machine',flag,flagLabel:flag==='red'?'RED — Back-to-back OT':'Normal duty',note:'',reason:'',remarks:''});
 const sasti=['sasti ob','Sasti OC'],rows=[duty(1,...sasti,'S1','Volvo Tippers'),duty(2,...sasti,'S1','Volvo Tippers','red'),duty(7,...sasti,'S1','Volvo Tippers'),duty(3,...sasti,'S1','Graders','zero'),duty(4,...sasti,'S1','Graders','normal',false),duty(5,...sasti,'S2','Volvo Tippers','review'),duty(6,'jayant ob','Jayant OC','S3','Excavator','orange')];
 const sites=[{siteKey:'dhoptala',site:'Dhoptala OC'},{siteKey:'jayant ob',site:'Jayant OC'},{siteKey:'sasti ob',site:'Sasti OC'}];
 const payload=(attendanceSites=sites)=>({summary:[],details:[],performance:[],ot:[],otSites:[],shiftAttendance:[],attendanceEquipment:rows,attendanceSites,exceptions:[],totals:{},notes:[],options:{},generatedAt:'2026-11-10T10:00:00Z'});
 const mount=async(pick,chosen=filters,data=payload())=>{const render=await component('manpower-reports.jsx','ManpowerReports',{OPERATIONAL_START:'2026-11-01'},[chosen,{query:new URLSearchParams(chosen).toString(),payload:data},'',false,0,{},false,false,'',{key:'',data:null,error:''},'',{category:'',severity:''},...(pick?[pick]:[])]);return ()=>render({session:{token:'test'},reportId:'attendance',onSelect:()=>{}});};
 const buttons=(tree,name)=>nodes(tree,'button').filter(n=>new RegExp('(^| )'+name+'( |$)').test(n.props.className||''));
 const categories=tree=>nodes(tree,ReportSection).map(n=>n.props.category);
 assert.equal(operations.operationReports.find(r=>r.id==='attendance').title,'Shift Attendance Equipment Wise');

 // Step 1: every assigned site by shift, counting actual duties; a site with no duty shows zeros and no button.
 const view=await mount(),first=view();
 assert.equal(nodes(first,'h1')[0].props.children,'Shift Attendance Equipment Wise');
 assert.deepEqual(nodes(first,'th').filter(n=>n.props.scope==='row').map(n=>n.props.children),['Dhoptala OC','Jayant OC','Sasti OC','All sites']);
 assert.deepEqual(buttons(first,'mp-att-count').map(n=>n.props.children),[1,1,4,1,5,4,1,1,6],'the second machine of one driver is not another actual duty');
 assert.deepEqual(categories(first),['manpower-review'],'no driver list before a site and shift are chosen');
 assert.equal(buttons(first,'mp-cat-open').length,0);

 // Step 2: pressing Shift 1 of a site lists its equipment with both totals and the four colours.
 buttons(first,'mp-att-count').find(n=>n.props['aria-label']==='4 actual duties · Sasti OC · Shift 1').props.onClick();
 const second=view();
 assert.deepEqual(buttons(second,'mp-cat-open').map(n=>n.props.children),['Volvo Tippers','Graders','All equipment']);
 assert.deepEqual(buttons(second,'mp-cat-count').map(n=>n.props['aria-label']),['3 equipment-wise duties · Volvo Tippers','1 Red · Volvo Tippers','2 equipment-wise duties · Graders','1 Blue · Graders','5 equipment-wise duties · All equipment','1 Red · All equipment','1 Blue · All equipment']);
 assert.match(nodes(second,'p').find(n=>n.props.className==='mp-att-foot').props.children.join(''),/^1 duty here is a second machine/);
 assert.deepEqual(categories(second),['manpower-review']);

 // Step 3: pressing an equipment lists its drivers; date, site and shift are in the heading, not in the columns.
 buttons(second,'mp-cat-open')[0].props.onClick();
 const list=nodes(view(),ReportSection)[0].props;
 assert.equal(list.category,'shift-attendance');assert.equal(list.rows.length,3);
 assert.equal(list.title,'Shift Attendance Equipment Wise · Sasti OC · Shift 1 · 10-11-26 · Volvo Tippers');
 assert.equal(list.description,'3 equipment-wise duties · 3 actual duties · Saved records only');
 assert.deepEqual(list.columns.map(c=>c.key),['employeeId','caliberCode','employeeName','doors','makeModel','status','trips','actualLabel','flagLabel','note','reason','remarks']);
 assert.deepEqual(list.rows.map(list.rowClassName),['mp-duty-normal','mp-duty-red','mp-duty-normal']);
 assert.match(list.columns.find(c=>c.key==='flagLabel').render(list.rows[1]).props.className,/mp-flag-red/);
 buttons(view(),'mp-cat-count').find(n=>n.props['aria-label']==='1 Red · Volvo Tippers').props.onClick();
 {const red=nodes(view(),ReportSection)[0].props;assert.equal(red.rows.length,1);assert.match(red.title,/Volvo Tippers · Red only$/);}

 // A wider selection brings back the columns that no longer fit in the heading.
 {const all=nodes((await mount({siteKey:'*',shift:'',equipment:'*',flag:'zero'}))(),ReportSection)[0].props;
  assert.equal(all.title,'Shift Attendance Equipment Wise · All sites · All shifts · 10-11-26 · All equipment · Blue only');assert.equal(all.rows.length,1);
  assert.deepEqual(all.columns.map(c=>c.key).filter(key=>['date','site','shift','equipment'].includes(key)),['site','shift','equipment']);}
 {const range={...filters,to:'2026-11-12'},days=nodes((await mount({siteKey:'sasti ob',shift:'S1',equipment:'Graders',flag:''},range))(),ReportSection)[0].props;
  assert.equal(days.columns[0].key,'date');assert.match(days.title,/10-11-26 to 12-11-26 · Graders$/);assert.equal(days.description,'2 equipment-wise duties · 1 actual duty · Saved records only');}

 // One site in the report opens by itself; a stale choice is ignored.
 {const only=(await mount(undefined,{...filters,site:'Sasti OC'},payload([sites[2]])))();assert.deepEqual(buttons(only,'mp-cat-open').map(n=>n.props.children),['Volvo Tippers','Graders','All equipment']);assert.equal(nodes(only,'th').filter(n=>n.props.scope==='row').length,1);}
 {const stale=(await mount({siteKey:'not a site',shift:'S1',equipment:'Volvo Tippers',flag:''}))();assert.deepEqual(categories(stale),['manpower-review']);assert.equal(buttons(stale,'mp-cat-open').length,0);}
});
