import {TableSmartPrint} from './helpers/smart-print-stub.mjs';
import {idleShiftHours} from '../shared/breakdown-hours-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
const scope={TableSmartPrint,idleShiftHours,React,useMemo:fn=>fn()};
for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){
 if(!match[2].startsWith('.'))continue;
 const module=await import(new URL('../src/'+match[2],import.meta.url));
 for(const name of match[1].split(',').map(v=>v.trim()))scope[name]=module[name];
}
scope.useStepBackTarget=()=>({current:null});
for(const name of ['WorkOrderJobSelect','ScanCardAbortDialog','ScanBatchMismatchDialog','ScanEquipmentReviewDialog','ScanExtractionStatus','ScanExtractionLine','ScanCorrectionStatus','BreakdownHoursField','ScanBatchReport','SmartSelect','GroqScanSettings','EmployeeIdLookup','LocalScannerPanel','ScanLine','Upload','Check','Save','Plus','Trash2','RefreshCw','ZoomIn','ZoomOut'])scope[name]=()=>null;
scope.ApplicationErrorBoundary=({children})=>children;
const {code}=await transformWithOxc(source.replace('const fleetCards=cards.filter','testCapture.setCards=setCards; testCapture.setSelected=setSelected; testCapture.setOptions=setOptions; testCapture.setDirty=setDirty;testCapture.setDraft=setDraft;testCapture.setBatch=setBatch; testCapture.activeRef=activeRef; testCapture.setAliasCheckedBatches=setAliasCheckedBatches; testCapture.setBatches=setBatches; testCapture.setBatchCardSummary=setBatchCardSummary; testCapture.autoSaveFailures=autoSaveFailures; testCapture.setFailureTick=setFailureTick; const fleetCards=cards.filter').replace('const mismatchPromptedCards=useRef', 'testCapture.setContextGate=setContextGate; testCapture.setExpectedContext=setExpectedContext; const mismatchPromptedCards=useRef').replace(/^import .*;\r?\n/gm,'').replace('export default function','function'),'bulk-card-scanning.jsx',{jsx:{runtime:'classic'}});
const nodes=(tree,predicate)=>{const rows=[];const visit=n=>{if(Array.isArray(n))return n.forEach(visit);if(!React.isValidElement(n))return;if(predicate(n))rows.push(n);visit(n.props.children)};visit(tree);return rows};
function harness(search='',kind='vehicle'){
 const testCapture={},slots=[],refs=[],effects=[],listeners=new Map();let cursor=0,refCursor=0;
 const location={href:'https://example.com/?page=vlb-scan'+search,get search(){return new URL(this.href).search}};
 const window={location,history:{pushState(_state,_unused,path){location.href=new URL(path,location.href).href},replaceState(_state,_unused,path){location.href=new URL(path,location.href).href}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:()=>{}};
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};
 const useRef=initial=>{const i=refCursor++;return refs[i]||(refs[i]={current:initial})};
 const Component=new Function(...Object.keys({...scope,testCapture,window,useState,useRef,useEffect:()=>{}}),code+';return BulkCardScanning')(...Object.values({...scope,testCapture,window,useState,useRef,useEffect:fn=>effects.push(fn)}));
 const render=(props={})=>{cursor=0;refCursor=0;effects.length=0;return Component({kind,session:{token:'test'},...props})};
 return {render,window,listeners,effects,slots,testCapture};
}
test('manual DC to DEMO correction updates every matching trip and summary through the review controls',()=>{
 const app=harness('&scanView=review');app.render();
 const assets=[{id:'demo25',door:'DEMO25-49001',kind:'equipment',site:'Sasti OC'}];
 const draft={location:'Sasti OC',machineNotationRuleVersion:1,trips:[{equipmentName:'DC25',tripCount:2},{equipmentName:'DC25',tripCount:4}],scanMachineSummary:[{equipmentName:'DC25',tripCount:6}]};
 const card={id:'demo-card',batch_id:'batch1',ordinal:1,status:'review',draft,raw_fields:{},checks:{errors:[]}};
 app.testCapture.setCards([card]);app.testCapture.setSelected(card.id);app.testCapture.setOptions({assets,employees:[],shifts:[],workOrders:[],sites:['Sasti OC']});app.testCapture.setDraft(draft);
 const tree=app.render();
 nodes(tree,n=>n.props['data-trip-equipment']===0)[0].props.onChange({target:{value:'demo25'}});
 const corrected=app.render();
 assert.deepEqual(nodes(corrected,n=>n.props['data-trip-equipment']!==undefined).map(n=>n.props.value),['demo25','demo25']);
 assert.equal(nodes(corrected,n=>n.props['aria-label']==='Machine-wise summary equipment row 1')[0].props.value,'demo25');
});

test('equipment correction commits trip details and machine summary in one atomic draft update',()=>{
 assert.match(source,/const correctEquipment=.*setDraft\(current=>\{const corrected=correctMatchingTripEquipment\(current,collection,index,id,assets\)/);
 assert.doesNotMatch(source,/const correctEquipment=.*update\('trips'.*update\('scanMachineSummary'/);
});

test('Wrong door review keeps every VLB card field visible while focusing its messages',()=>{
 const app=harness('&scanView=review&scanGroup=wrong-door');app.render();
 const draft={doorText:'',assetId:'',bookDate:'2026-11-01',location:'Sasti OC',trips:[{equipmentName:'LPC01',tripCount:2}],scanMachineSummary:[],openingHmr:'',closingHmr:''};
 const card={id:'door-card',batch_id:'batch1',ordinal:1,status:'review',draft,raw_fields:{},checks:{errors:['Enter door number.','Driver / operator is required.','Closing HMR is missing.'],warnings:['Batch values applied. Card shows Date: 2026-11-02; batch 2026-11-01.']}};
 app.testCapture.setCards([card]);app.testCapture.setSelected(card.id);app.testCapture.setOptions({assets:[],employees:[],shifts:[],workOrders:[],sites:['Sasti OC']});app.testCapture.setDraft(draft);
 const tree=app.render();
 const status=nodes(tree,n=>n.type===scope.ScanCorrectionStatus&&n.props.errors)[0];assert.ok(status);
 assert.ok(status.props.errors.some(message=>/door/i.test(message)));
 assert.ok(!status.props.errors.some(message=>/HMR|driver|summary|date/i.test(message)));
 assert.deepEqual(status.props.warnings,[]);
 assert.deepEqual(nodes(tree,n=>n.props['data-field']&&!n.props.hidden).map(n=>n.props['data-field']),['bookDate','location','doorText','assetId','employeeId','shiftId','cardShift','shiftHours','workOrderId','openingKmr','closingKmr','openingHmr','closingHmr']);
 assert.ok(nodes(tree,n=>n.props['data-review-section']==='trips').every(n=>!n.props.hidden));
 assert.equal(nodes(tree,n=>n.type==='h2'&&n.props.children==='Ready for automatic saving').length,0,'hidden issues continue blocking final save');
 const expandedToggle=nodes(tree,n=>n.type==='button'&&n.props.children==='Show only fields needing input')[0];
 assert.ok(expandedToggle);
 expandedToggle.props.onClick();
 const focusedTree=app.render();
 assert.deepEqual(nodes(focusedTree,n=>n.props['data-field']&&!n.props.hidden).map(n=>n.props['data-field']),['doorText','assetId']);
 const focusedToggle=nodes(focusedTree,n=>n.type==='button'&&n.props.children==='Show all values')[0];
 assert.ok(focusedToggle);
 focusedToggle.props.onClick();
 assert.ok(nodes(app.render(),n=>n.props['data-review-section']==='trips').every(n=>!n.props.hidden));
});

test('an open card shows its remaining errors after leaving the selected issue group',()=>{
 const app=harness('&scanView=review&scanGroup=wrong-door');app.render();
 const draft={bookDate:'2026-11-01',location:'Sasti OC',trips:[{equipmentName:'E1',tripCount:1}],scanMachineSummary:[{equipmentName:'E1',tripCount:1}]};
 const card={id:'first',batch_id:'batch-1',ordinal:1,status:'review',draft,raw_fields:{},checks:{errors:['Enter door number.','Closing HMR is missing.']}};
 const next={...card,id:'second',ordinal:2};
 const correctedDraft={...draft,doorText:'V1',assetId:'v1'};
 const corrected={...card,draft:correctedDraft,checks:{errors:['Closing HMR is missing.']}};
 const sync=()=>app.effects.find(fn=>String(fn).includes('wasInReview'))();
 app.testCapture.setOptions({assets:[{id:'v1',kind:'vehicle',door:'V1',site:'Sasti OC'}],employees:[],shifts:[],workOrders:[],sites:['Sasti OC']});
 app.testCapture.setCards([card,next]);app.testCapture.setSelected(card.id);app.testCapture.setDraft(draft);
 app.render();sync();
 app.testCapture.setCards([corrected,next]);app.testCapture.setDraft(correctedDraft);
 app.render();sync();
 const tree=app.render();
 const status=nodes(tree,n=>n.type===scope.ScanCorrectionStatus&&n.props.errors)[0];
 assert.ok(status.props.errors.includes('Closing HMR is missing.'));
 assert.ok(nodes(tree,n=>n.props['data-field']==='closingHmr'&&!n.props.hidden).length);
 assert.equal(new URL(app.window.location.href).searchParams.get('scanView'),'review');

 app.testCapture.setCards([{...corrected,status:'posted'},next]);
 app.render();sync();
 const nextTree=app.render();
 assert.ok(nodes(nextTree,n=>n.type===scope.ScanCorrectionStatus&&n.props.errors?.includes('Enter door number.')).length);
 sync();
 app.testCapture.setCards([{...corrected,status:'posted'},{...next,status:'posted'}]);
 app.render();sync();
 assert.equal(new URL(app.window.location.href).searchParams.has('scanView'),false);
});

test('VLB overview keeps compact input panels separate from corrections; attention opens a separate URL and Back restores overview',()=>{
 const app=harness();let tree=app.render();
 assert.equal(nodes(tree,n=>n.props.className==='scan-card-groups').length,1);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
 assert.equal(nodes(tree,n=>n.props.className==='scan-draft'||n.props.className==='scan-source').length,0);
 const uploadTab=nodes(tree,n=>n.type==='button'&&n.props.children==='Upload files')[0];uploadTab.props.onClick();tree=app.render();
 assert.equal(nodes(tree,n=>n.props.className?.split(' ').includes('scan-upload-panel')).length,1);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
 nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-brown')[0].props.onClick();tree=app.render();
 assert.equal(new URL(app.window.location.href).searchParams.get('scanView'),'review');
 assert.equal(new URL(app.window.location.href).searchParams.get('scanGroup'),'brown');
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
 assert.equal(nodes(tree,n=>n.props.className==='scan-card-groups').length,0);
 assert.equal(nodes(tree,n=>n.props.role==='status'&&n.props.className==='scan-review-empty').length,1);
 nodes(tree,n=>n.type==='button'&&n.props.children==='Back to card status')[0].props.onClick();tree=app.render();
 assert.equal(new URL(app.window.location.href).searchParams.has('scanView'),false);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
});
test('review links survive refresh and browser Back restores card status',()=>{
 const app=harness('&scanView=review&scanGroup=brown');let tree=app.render();
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
 app.effects[0]();app.window.location.href='https://example.com/?page=vlb-scan';app.listeners.get('popstate')();tree=app.render();
 assert.equal(nodes(tree,n=>n.props.className==='scan-card-groups').length,1);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
});

test('Needs attention, Blank / no data and Error open review; All okay stays on overview',()=>{
 for(const group of ['brown','red','error']){
  const app=harness(),tree=app.render();
  nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-'+group)[0].props.onClick();
  assert.equal(new URL(app.window.location.href).searchParams.get('scanView'),'review');
  assert.equal(new URL(app.window.location.href).searchParams.get('scanGroup'),group);
  assert.equal(nodes(app.render(),n=>n.props.className==='scan-card-groups').length,0);
 }
 const app=harness(),tree=app.render();
 nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-orange')[0].props.onClick();
 assert.equal(new URL(app.window.location.href).searchParams.has('scanView'),false);
});

test('review starts compact and heading can be restored while keeping Back and review content available',()=>{
 const app=harness('&scanView=review&scanGroup=brown');let tree=app.render();
 assert.equal(nodes(tree,n=>n.props.className==='scan-hero').length,0);
 assert.equal(nodes(tree,n=>n.props.className?.includes('scan-review-compact')).length,1);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Back to card status').length,1);
 nodes(tree,n=>n.type==='button'&&n.props.children==='Show heading and summary')[0].props.onClick();
 assert.equal(nodes(app.render(),n=>n.props.className==='scan-hero').length,1);
 nodes(app.render(),n=>n.type==='button'&&n.props.children==='Hide heading and summary')[0].props.onClick();
 assert.equal(nodes(app.render(),n=>n.props.className==='scan-hero').length,0);
});
test('scan overview uses the compact title-only banner',()=>{
 const hero=nodes(harness().render(),n=>n.props.className==='scan-hero')[0];
 assert.equal(hero.type,'header');
 assert.equal(React.Children.count(hero.props.children),1);
 const heading=React.Children.only(hero.props.children);
 assert.equal(heading.type,'h1');
 assert.match(String(heading.props.children[1]),/Trip Cards · Scan & Review/);
});

test('the purple extraction strip stays on the overview and is omitted from card review',()=>{
 assert.equal(nodes(harness().render(),node=>node.type===scope.ScanExtractionStatus).length,1);
 assert.equal(nodes(harness('&scanView=review&scanGroup=brown').render(),node=>node.type===scope.ScanExtractionStatus).length,0);
});

test('fleet reconciliation is collapsed below Card status on the VLB overview',()=>{
 const report=React.createElement('section',{'aria-label':'fleet report'}),tree=harness().render({fleetReconciliation:report});
 const details=nodes(tree,n=>n.type==='details'&&n.props.className==='scan-fleet-reconciliation')[0];
 assert.ok(details);assert.equal(details.props.open,undefined);
 const ordered=nodes(tree,n=>n.props.className==='scan-card-groups'||n.props.className==='scan-fleet-reconciliation').map(n=>n.props.className);
 assert.deepEqual(ordered,['scan-card-groups','scan-fleet-reconciliation']);
});

test('fleet upload details start collapsed and the automatic-save alert names the refused card and the server reason',()=>{
 assert.match(source,/fleetRejection\)&&<details className="scan-fleet-rejection-details"><summary>Show fresh-upload details/);
 assert.match(source,/role=\{autoSaveError.retryAt\?"status":"alert"\}/);
 assert.match(source,/autoSaveError.retryAt\?"Automatic saving is waiting at card ":"Automatic saving stopped at card "/);
 assert.match(source,/\{autoSaveError.ordinal\}\.<\/strong> \{autoSaveError.message\}/);
 assert.match(source,/autoSaveFailures\.current\.set\(key,e\.message\)/);
 assert.match(source,/autoSaveFailures\.current\.clear\(\);setFailureTick/);
});

test('a refused automatic save moves the card from All okay to Needs attention and the entry chip follows the tiles',()=>{
 const app=harness('&batch=batch-1');app.render();
 const okay=n=>({id:'card-'+n,batch_id:'batch-1',ordinal:n,filename:'ok'+n+'.png',status:'review',revision:3,checks:{errors:[],warnings:[]},draft:{bookDate:'2026-11-01',doorText:'V'+n,assetId:String(n),employeeId:'1',shiftId:'1',cardShift:'I',shiftHours:8,openingHmr:1,closingHmr:2,openingKmr:10,closingKmr:11,location:'Sasti OC',timeMode:'without',trips:[{equipmentName:'E1',tripCount:1}],scanMachineSummary:[{equipmentName:'E1',tripCount:1}]},raw_fields:{}});
 const saved={...okay(9),status:'posted',book_no:'VLB_S/1ST-NOV26/S1/001'};
 app.testCapture.setBatch({id:'batch-1',kind:'vehicle',expected_context:{bookDate:'2026-11-01',location:'Sasti OC',cardShift:'I'}});
 app.testCapture.setCards([okay(1),okay(2),saved]);
 app.testCapture.setBatches([{id:'batch-1',name:'B1',cards:3,posted:1,tripCount:11},{id:'batch-2',name:'B2',cards:4,posted:1,tripCount:13},{id:'empty',name:'Deleted PDF batch',cards:0,posted:0,tripCount:0}]);
 let tree=app.render({vlbBatch:{id:'vlb-1'}});
 const tile=id=>nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-'+id)[0];
 const count=id=>nodes(tile(id),n=>n.type==='strong')[0].props.children.join('');
 const chip=name=>nodes(tree,n=>n.type==='button'&&nodes(n,m=>m.type==='strong'&&m.props.children===name).length)[0];
 assert.equal(count('orange'),'3/3');
 assert.deepEqual(nodes(tile('orange'),n=>n.type==='small')[0].props.children,'1 saved · 2 waiting to save');
 assert.equal(nodes(chip('B1'),n=>n.type==='span')[0].props.children[0],'3 cards · 1 saved · 2 waiting to save');
 assert.equal(nodes(chip('B2'),n=>n.type==='span')[0].props.children[0],'4 cards · 1 saved · 3 unsaved','other entries keep the server counts');
 assert.equal(chip('Deleted PDF batch'),undefined,'an entry left with zero cards after permanent PDF deletion is not shown');
 const headline=()=>nodes(tree,n=>n.props['aria-label']==='Total cards in this batch')[0];
 const text=node=>Array.isArray(node)?node.map(text).join(''):React.isValidElement(node)?text(node.props.children):node==null?'':String(node);
 assert.match(text(headline()),/Loading current batch total/,'never replace an unavailable saved total with raw scan counts');
 app.testCapture.setBatchCardSummary({batchId:'vlb-1',entry_count:121,manual_count:2,scan_count:119});
 tree=app.render({vlbBatch:{id:'vlb-1'}});
 assert.match(text(headline()),/Saved to log book: 121 cards/);
 assert.match(text(headline()),/Manual: 2/);
 assert.match(text(headline()),/Scan\/PDF: 119/);
 assert.doesNotMatch(text(headline()),/ scanned/,'no "of N scanned" when saved records outnumber the listed scan cards');
 app.testCapture.setBatchCardSummary({batchId:'vlb-1',entry_count:5,manual_count:1,scan_count:4});
 tree=app.render({vlbBatch:{id:'vlb-1'}});
 assert.match(text(headline()),/Saved to log book: 5 cards · Manual: 1 · Scan\/PDF: 4 of 7 scanned/);
 app.testCapture.setBatchCardSummary({batchId:'vlb-1',entry_count:121,manual_count:2,scan_count:119});
 tree=app.render({vlbBatch:{id:'vlb-1'}});
 const total=React.Children.toArray(nodes(tree,n=>n.props.className==='scan-entry-breakdown')[0].props.children);
 assert.equal(total[0].props.children[0].props.children,'Scan entries:');
 assert.equal(total[0].props.children.slice(1,4).join(''),' B1 (3) + B2 (4) = ');
 assert.deepEqual(total[0].props.children[4].props.children,[7,' scan card','s']);
 assert.deepEqual(total[1].props.children,['Total Trips: ',16],'active entry uses loaded cards and other entries use their fetched totals');
 app.testCapture.autoSaveFailures.current.set('card-2:3','VLB is locked for batch B1. Ask the site PM to unlock VLB before adding or changing tipper cards.');
 app.testCapture.setFailureTick(n=>n+1);
 tree=app.render({vlbBatch:{id:'vlb-1'}});
 assert.equal(count('orange'),'2/3');
 assert.equal(count('brown'),'1/3');
 assert.deepEqual(nodes(tile('orange'),n=>n.type==='small')[0].props.children,'1 saved · 1 waiting to save');
 assert.equal(nodes(chip('B1'),n=>n.type==='span')[0].props.children[0],'3 cards · 1 saved · 1 waiting to save · 1 needs attention');
 const refused=nodes(tree,n=>n.props?.['aria-label']==='Cards in batch');
 assert.equal(refused.length,0,'overview keeps the tiles; the refused card opens from Needs attention');
 app.testCapture.autoSaveFailures.current.set('card-9:3','stale');
 app.testCapture.setFailureTick(n=>n+1);
 tree=app.render({vlbBatch:{id:'vlb-1'}});
 assert.equal(count('orange'),'2/3','a saved card is never marked refused');
});


test('highlighted equipment review returns without reprompting and permits manual reopening',()=>{
 const app=harness('&batch=batch-1');app.render();
 const card={id:'card-1',batch_id:'batch-1',ordinal:1,filename:'trip.png',status:'review',draft:{},raw_fields:{fleetReview:{issues:[{key:'trip',door:'E1',selectedSite:'Sasti',pulseSite:'Majri',fields:['trips.0.equipmentName']}]}}};
 app.testCapture.setCards([card]);
 let tree=app.render();
 nodes(tree,n=>n.type==='button'&&n.props.children==='Equipment review')[0].props.onClick();
 tree=app.render();
 nodes(tree,n=>n.type===scope.ScanEquipmentReviewDialog)[0].props.onReview();
 // Keep the card unselected so this navigation test does not need editor fixtures.
 app.testCapture.setSelected('');tree=app.render();
 assert.equal(new URL(app.window.location.href).searchParams.get('scanReviewReturn'),card.id);
 assert.equal(new URL(app.window.location.href).searchParams.get('batch'),'batch-1');
 const backApp=app;
 nodes(tree,n=>n.type==='button'&&n.props.children==='Back to equipment review')[0].props.onClick();
 tree=backApp.render();
 assert.equal(nodes(tree,n=>n.type===scope.ScanEquipmentReviewDialog).length,0);
 nodes(tree,n=>n.type==='button'&&n.props.children==='Equipment review')[0].props.onClick();
 tree=backApp.render();
 assert.equal(nodes(tree,n=>n.type===scope.ScanEquipmentReviewDialog)[0].props.card.id,card.id);
 assert.equal(new URL(backApp.window.location.href).searchParams.has('scanView'),false);
 assert.equal(new URL(backApp.window.location.href).searchParams.get('batch'),'batch-1');
 const origin='&batch=batch-1';
 for(const refreshed of [false,true]){
  const target=harness(refreshed?origin:'&batch=batch-1&scanView=review&scanReviewReturn=card-1');target.render();target.testCapture.setCards([card]);
  if(!refreshed){target.effects[0]();target.window.location.href='https://example.com/?page=vlb-scan'+origin;target.listeners.get('popstate')();}
  assert.equal(nodes(target.render(),n=>n.type===scope.ScanEquipmentReviewDialog).length,0);
 }
});


test('Scan and Upload require complete setup and activate only the selected input card',()=>{
 const complete={site:'Test site',report_date:'2026-11-01',shift:'S1'};
 const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&n.props.children===label)[0];
 const scanner=tree=>nodes(tree,n=>n.props.className==='scan-scanner-card')[0];
 const uploader=tree=>nodes(tree,n=>n.props.className==='scan-upload-panel scan-input-card')[0];
 for(const missing of ['site','report_date','shift']){
  const app=harness(),tree=app.render({vlbBatch:{...complete,[missing]:''}});
  assert.equal(button(tree,'Scan').props.disabled,true,missing);
  assert.equal(button(tree,'Upload files').props.disabled,true,missing);
  assert.equal(scanner(tree).props.inert,true,missing);
  assert.equal(uploader(tree).props.inert,true,missing);
 }
 const app=harness(),props={vlbBatch:complete};let tree=app.render(props);
 assert.equal(button(tree,'Scan').props.disabled,false);
 assert.equal(button(tree,'Upload files').props.disabled,false);
 assert.equal(scanner(tree).props.inert,true);assert.equal(uploader(tree).props.inert,true);
 button(tree,'Scan').props.onClick();tree=app.render(props);
 assert.equal(scanner(tree).props.inert,false);assert.equal(uploader(tree).props.inert,true);
 assert.equal(nodes(tree,n=>n.type===scope.LocalScannerPanel)[0].props.disabled,false);
 assert.equal(button(tree,'Choose scan files').props.disabled,true);
 button(tree,'Upload files').props.onClick();tree=app.render(props);
 assert.equal(scanner(tree).props.inert,true);assert.equal(uploader(tree).props.inert,false);
 assert.equal(nodes(tree,n=>n.type===scope.LocalScannerPanel)[0].props.disabled,true);
 assert.equal(button(tree,'Choose scan files').props.disabled,false);
});

test('Delete PDF sits left of Scan and permanently selects saved or unsaved cards from only the chosen PDF',()=>{
 const app=harness();let tree=app.render(),alwaysAvailable=nodes(tree,n=>n.type==='button'&&React.Children.toArray(n.props.children).includes('Delete PDF'))[0];assert.equal(alwaysAvailable.props.disabled,false);alwaysAvailable.props.onClick();tree=app.render();assert.ok(nodes(tree,n=>n.props['aria-labelledby']==='scan-pdf-deletion-title')[0]);nodes(tree,n=>n.type==='button'&&n.props.children==='Cancel')[0].props.onClick();app.testCapture.setBatch({id:'batch-1',kind:'vehicle'});app.testCapture.activeRef.current='batch-1';app.testCapture.setCards([
  {id:'wrong-1',batch_id:'batch-1',ordinal:1,revision:1,status:'review',filename:'Wrong cards.pdf · page 1',draft:{},raw_fields:{}},
  {id:'right-1',batch_id:'batch-1',ordinal:2,revision:1,status:'review',filename:'Correct cards.pdf · page 1',draft:{},raw_fields:{}},
  {id:'wrong-saved',batch_id:'batch-1',ordinal:4,revision:1,status:'posted',logbook_id:'55',filename:'Wrong cards.pdf · page 3',draft:{},raw_fields:{}},
  {id:'wrong-2',batch_id:'batch-1',ordinal:3,revision:1,status:'error',filename:'Wrong cards.pdf · page 2',draft:{},raw_fields:{}}
 ]);
 tree=app.render();const workflow=nodes(tree,n=>n.props['aria-label']==='Scanning workflow')[0],buttons=nodes(workflow,n=>n.type==='button');
 const deletePdf=buttons.find(n=>React.Children.toArray(n.props.children).includes('Delete PDF')),scan=buttons.find(n=>n.props.children==='Scan');
 assert.ok(deletePdf);assert.equal(deletePdf.props.disabled,false);assert.equal(buttons.indexOf(deletePdf)+1,buttons.indexOf(scan));
 deletePdf.props.onClick();tree=app.render();
 const chooser=nodes(tree,n=>n.props['aria-labelledby']==='scan-pdf-deletion-title')[0];assert.ok(chooser);
 assert.deepEqual(nodes(chooser,n=>n.type==='strong').map(n=>n.props.children),['Wrong cards.pdf','Correct cards.pdf']);
 assert.equal(nodes(chooser,n=>n.props.children==='No unsaved uploaded PDF is available to delete. PDFs with saved log-book cards remain protected.').length,0);
 nodes(chooser,n=>n.type==='button'&&n.props.children==='Delete permanently')[0].props.onClick();tree=app.render();
 const deletion=nodes(tree,n=>typeof n.type==='function'&&n.type.name==='ScanCardDeletionDialog')[0];
 assert.deepEqual(deletion.props.targets.map(card=>card.id).sort(),['wrong-1','wrong-2','wrong-saved']);assert.equal(deletion.props.permanent,true);assert.equal(deletion.props.otpRequired,true);assert.ok(!deletion.props.targets.some(card=>card.id==='right-1'));
});

test('scan setup fills its single read-only Site from the Pulse account options',()=>{
 const app=harness();app.render();app.testCapture.setOptions({accountLocation:'Sasti OC',sites:['Sasti OC','Jayant OC'],shifts:[]});let tree=app.render();
 const site=nodes(tree,n=>n.type==='input'&&n.props['aria-label']==='Site')[0];
 assert.equal(site.props.readOnly,true);assert.equal(site.props.value,'Sasti OC');assert.equal(site.props.onChange,undefined);
 const sync=app.effects.find(fn=>/accountSite/.test(String(fn))&&/current.location/.test(String(fn)));assert.ok(sync);sync();tree=app.render();
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,true,'date and shift are still required');
 const date=nodes(tree,n=>n.type==='input'&&n.props['aria-label']==='Card date')[0];date.props.onInput({target:{value:'2026-11-01'}});
 nodes(tree,n=>n.props['aria-label']==='Shift')[0].props.onChange({target:{value:'I'}});tree=app.render();
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,false);
});

test('all-site administrators can select any authorized scan site while keeping date and shift required',()=>{
 const app=harness();app.render();app.testCapture.setOptions({canSelectSite:true,accountLocation:'Sasti OC',sites:['Sasti OC','Jayant OC'],shifts:[]});let tree=app.render();
 const sync=app.effects.find(fn=>/accountSite/.test(String(fn))&&/current.location/.test(String(fn)));sync();tree=app.render();
 const site=nodes(tree,n=>n.props['aria-label']==='Site')[0];assert.equal(site.type,scope.SmartSelect);assert.equal(site.props.readOnly,undefined);
 site.props.onChange({target:{value:'Jayant OC'}});tree=app.render();
 nodes(tree,n=>n.type==='input'&&n.props['aria-label']==='Card date')[0].props.onInput({target:{value:'2026-11-01'}});
 assert.equal(nodes(app.render(),n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,true);
 nodes(tree,n=>n.props['aria-label']==='Shift')[0].props.onChange({target:{value:'I'}});tree=app.render();
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Site')[0].props.value,'Jayant OC');
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,false);
 nodes(tree,n=>n.props['aria-label']==='Site')[0].props.onChange({target:{value:'Not authorized'}});tree=app.render();
 nodes(tree,n=>n.props['aria-label']==='Shift')[0].props.onChange({target:{value:'I'}});assert.equal(nodes(app.render(),n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,true);
});

test('LMV scan fills the default site without choosing a date or shift',()=>{
 const app=harness(),props={logBookKind:'lmv'};
 app.render(props);
 app.testCapture.setOptions({canSelectSite:true,lmvEntrySite:'Sasti OC',sites:['Sasti OC','Jayant OC'],shifts:[]});
 app.render(props);
 app.effects.find(fn=>/accountSite/.test(String(fn))&&/current.location/.test(String(fn)))();
 const tree=app.render(props);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Site')[0].props.value,'Sasti OC');
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Card date')[0].props.value,'');
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Shift')[0].props.value,'');
});

test('opening a site batch keeps its own site ahead of the account default',()=>{
 const app=harness(),vlbBatch={id:'selected',site:'Jayant OC',report_date:'2026-11-01',shift:'S1'};app.render({vlbBatch});
 app.testCapture.setOptions({canSelectSite:true,accountLocation:'Sasti OC',sites:['Sasti OC','Jayant OC'],shifts:[]});const tree=app.render({vlbBatch});
 const site=nodes(tree,n=>n.props['aria-label']==='Site')[0];assert.equal(site.props.value,'Jayant OC');assert.equal(site.props.readOnly,true);
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props.children==='Scan')[0].props.disabled,false);
});
test('right-click on a status tile offers to reject every unsaved card in that group and sends them for manual entry',async()=>{
 const app=harness('&batch=batch-1');app.render();
 const mismatch=i=>({id:'card-'+i,batch_id:'batch-1',ordinal:i,filename:'trip'+i+'.png',status:'review',revision:3,draft:{bookDate:'2026-11-01',doorText:'V1',assetId:'1',trips:[{equipmentName:'L01',tripCount:1}],scanMachineSummary:[{equipmentName:'L01',tripCount:9}]},raw_fields:{}});
 const saved={id:'card-9',batch_id:'batch-1',ordinal:9,filename:'ok.png',status:'posted',revision:1,draft:{bookDate:'2026-11-01',doorText:'V1',assetId:'1'},raw_fields:{}};
 app.testCapture.setBatch({id:'batch-1',kind:'vehicle',expected_context:{bookDate:'2026-11-01',location:'Sasti OC',cardShift:'I'}});
 app.testCapture.setCards([mismatch(1),mismatch(2),saved]);
 let tree=app.render();
 const tile=id=>nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-'+id)[0];
 assert.equal(tile('orange').props.onContextMenu,undefined,'All okay cards save on their own; no bulk reject there');
 assert.equal(nodes(tree,n=>n.props.role==='menu').length,0);
 let prevented=0;tile('wrong-caliber').props.onContextMenu({preventDefault:()=>prevented++,clientX:40,clientY:50});tree=app.render();
 assert.equal(prevented,1);
 const menu=nodes(tree,n=>n.props.role==='menu')[0];assert.equal(menu.props['aria-label'],'Actions for Wrong Caliber ID');
 const reject=nodes(menu,n=>n.props.className==='scan-group-menu-reject')[0];
 assert.deepEqual(reject.props.children,['Reject all ',2,' card(s) in "','Wrong Caliber ID','"']);
 assert.equal(reject.props.disabled,false);
 const calls=[];app.window.confirm=message=>{calls.push(message);return true};
 const requests=[];globalThis.fetch=async(path,config)=>{requests.push({path,body:config?.body?JSON.parse(config.body):null});
  if(path.endsWith('/reject-group'))return {ok:true,status:200,text:async()=>JSON.stringify({rejected:2,remaining:0})};
  if(path.startsWith('/api/scan-batches/batch-1'))return {ok:true,status:200,text:async()=>JSON.stringify({batch:{id:'batch-1',kind:'vehicle'},cards:[],duplicates:[]})};
  return {ok:true,status:200,text:async()=>JSON.stringify({batches:[]})}};
 try{await reject.props.onClick();}finally{delete globalThis.fetch;}
 assert.match(calls[0],/Reject all 2 card\(s\) in "Wrong Caliber ID"/);
 const sent=requests.find(r=>r.path==='/api/scan-batches/batch-1/reject-group');
 assert.deepEqual(sent.body,{group:'Wrong Caliber ID',cards:[{id:'card-1',revision:3},{id:'card-2',revision:3}]},'only the unsaved cards of that group are sent, never the saved card');
 tree=app.render();
 assert.equal(nodes(tree,n=>n.props.role==='menu').length,0,'the menu closes after the action');
 assert.equal(nodes(tree,n=>n.props.role==='status'&&String(n.props.children).includes('rejected for manual entry')).length>0||app.slots.some(v=>typeof v==='string'&&v.includes('2 card(s) in "Wrong Caliber ID" rejected for manual entry')),true);
});
test('declining the confirmation leaves every card as it was',async()=>{
 const app=harness('&batch=batch-1');app.render();
 app.testCapture.setBatch({id:'batch-1',kind:'vehicle',expected_context:{bookDate:'2026-11-01',location:'Sasti OC',cardShift:'I'}});
 app.testCapture.setCards([{id:'card-1',batch_id:'batch-1',ordinal:1,filename:'a.png',status:'review',revision:1,draft:{},raw_fields:{}}]);
 let tree=app.render();
 nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-red')[0].props.onContextMenu({preventDefault(){},clientX:1,clientY:1});tree=app.render();
 app.window.confirm=()=>false;let fetched=0;globalThis.fetch=async()=>{fetched++;throw Error('must not be called')};
 try{await nodes(tree,n=>n.props.className==='scan-group-menu-reject')[0].props.onClick();}finally{delete globalThis.fetch;}
 assert.equal(fetched,0);
});
test('Back to card status stays usable while a draft is dirty, so a rejected autosave cannot trap the reviewer',()=>{
 const app=harness('&scanView=review&scanGroup=brown');app.render();
 app.testCapture.setDirty(true);let tree=app.render();
 const back=nodes(tree,n=>n.type==='button'&&n.props.children==='Back to card status')[0];
 assert.equal(back.props.disabled,false);
 back.props.onClick();tree=app.render();
 assert.equal(new URL(app.window.location.href).searchParams.has('scanView'),false);
 assert.equal(nodes(tree,n=>n.props.className==='scan-card-groups').length,1);
});

test('automatic equipment prompts stay closed during corrections and open only once on overview',()=>{
 const app=harness('&scanView=review');app.render();
 const draft={doorText:'V99',location:'Sasti OC'};
 const card={id:'once-card',status:'review',draft,raw_fields:{fleetReview:{signature:scope.scanFleetSignature(draft),issues:[{door:'V99',fields:['assetId']}]}}};
 app.testCapture.setCards([card]);app.render();
 const prompt=()=>app.effects.find(fn=>String(fn).includes('nextFleetReviewPrompt'))();
 prompt();
 assert.equal(nodes(app.render(),n=>n.type===scope.ScanEquipmentReviewDialog).length,0);
 nodes(app.render(),n=>n.type==='button'&&n.props.children==='Back to card status')[0].props.onClick();
 app.render();prompt();
 let tree=app.render();
 assert.equal(nodes(tree,n=>n.type===scope.ScanEquipmentReviewDialog).length,1);
 nodes(tree,n=>n.type===scope.ScanEquipmentReviewDialog)[0].props.onReview();
 app.testCapture.setSelected('');tree=app.render();
 nodes(tree,n=>n.type==='button'&&n.props.children==='Back to equipment review')[0].props.onClick();
 app.render();prompt();
 assert.equal(nodes(app.render(),n=>n.type===scope.ScanEquipmentReviewDialog).length,0);
});


test('mismatch panel prompts once per card despite changing errors and preserves manual opening',()=>{
 const app=harness();app.render();app.testCapture.setBatch({id:'batch-errors'});
 const gate=rows=>({context:{},mismatches:rows});
 const row={id:'error-1',issues:['Date mismatch','Shift mismatch']};
 app.testCapture.setContextGate(gate([row]));app.render();
 const prompt=()=>app.effects.find(fn=>String(fn).includes('mismatchPromptedCards'))();
 const toggle=tree=>nodes(tree,n=>n.type==='button'&&n.props['aria-controls']==='scan-mismatch-list')[0];
 const opened=tree=>toggle(tree).props['aria-expanded'];
 prompt();let tree=app.render();assert.equal(opened(tree),true);
 toggle(tree).props.onClick();app.render();
 app.testCapture.setContextGate(gate([{...row,issues:['Shift mismatch']}]));app.render();prompt();
 assert.equal(opened(app.render()),false);
 app.testCapture.setContextGate(gate([]));app.render();prompt();
 app.testCapture.setContextGate(gate([{...row,issues:['Location mismatch']}]));app.render();prompt();
 assert.equal(opened(app.render()),false);
 app.testCapture.setContextGate(gate([row,{id:'error-2',issues:['Date mismatch']}]));app.render();prompt();
 tree=app.render();assert.equal(opened(tree),true);
 toggle(tree).props.onClick();tree=app.render();toggle(tree).props.onClick();assert.equal(opened(app.render()),true);
});

test('date/site/shift prompts do not interrupt correction of an error card',()=>{
 const app=harness('&scanView=review');app.render();
 app.testCapture.setBatch({id:'batch-errors'});app.testCapture.setSelected('error-1');
 app.testCapture.setContextGate({context:{},mismatches:[{id:'error-1',issues:['Date mismatch','Shift mismatch']}]});
 app.render();app.effects.find(fn=>String(fn).includes('mismatchPromptedCards'))();
 app.testCapture.setSelected('');let tree=app.render();
 nodes(tree,n=>n.type==='button'&&n.props.children==='Back to card status')[0].props.onClick();
 app.render();app.effects.find(fn=>String(fn).includes('mismatchPromptedCards'))();
 tree=app.render();
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props['aria-controls']==='scan-mismatch-list')[0].props['aria-expanded'],false);
});
for(const kind of ['vehicle','equipment'])test(kind+' selected abort opens only an exact pending-card confirmation',()=>{
 const app=harness('',kind);app.render();const batch={id:'abort-batch',kind},pending=[{id:'abort-one',batch_id:batch.id,ordinal:1,status:'reading',revision:3,filename:'one.png',draft:{},raw_fields:{}},{id:'abort-two',batch_id:batch.id,ordinal:2,status:'queued',revision:1,filename:'two.png',draft:{},raw_fields:{}}];app.testCapture.setBatch(batch);app.testCapture.setCards(pending);
 let tree=app.render(),report=nodes(tree,n=>n.type===scope.ScanBatchReport)[0];assert.equal(typeof report.props.onAbortCards,'function');report.props.onAbortCards(pending);tree=app.render();let dialog=nodes(tree,n=>n.type===scope.ScanCardAbortDialog)[0];assert.deepEqual(dialog.props.targets.map(card=>card.id),['abort-one','abort-two']);assert.equal(dialog.props.kind,kind);assert.equal(nodes(tree,n=>n.type===scope.ScanBatchReport)[0].props.selectionDisabled,true);
 app.testCapture.setCards(pending.map(card=>({...card,revision:20,status:'review'})));tree=app.render();dialog=nodes(tree,n=>n.type===scope.ScanCardAbortDialog)[0];assert.equal(dialog.props.targets[0].status,'reading','confirmation retains the exact reviewed selection');dialog.props.onClose();tree=app.render();assert.equal(nodes(tree,n=>n.type===scope.ScanCardAbortDialog).length,0);
 report=nodes(tree,n=>n.type===scope.ScanBatchReport)[0];report.props.onAbortCards([{...pending[0],status:'posted',logbook_id:9}]);tree=app.render();assert.equal(nodes(tree,n=>n.type===scope.ScanCardAbortDialog).length,0);report.props.onAbortCards([{...pending[0],batch_id:'another-batch'}]);tree=app.render();assert.equal(nodes(tree,n=>n.type===scope.ScanCardAbortDialog).length,0);
});

test('finished validation opens the unresolved card once without routing through a status tile',()=>{
 const app=harness();app.render();
 const context={bookDate:'2026-11-01',location:'Sasti OC',cardShift:'I',confirmed:true};
 const batch={id:'batch-review',kind:'vehicle',expected_context:context};
 app.testCapture.setBatch(batch);app.testCapture.activeRef.current=batch.id;
 app.testCapture.setExpectedContext(context);
 app.testCapture.setOptions({assets:[],employees:[],sites:['Sasti OC'],shifts:[],workOrders:[]});
 app.testCapture.setAliasCheckedBatches(new Set([batch.id]));
 const row={id:'unresolved',batch_id:batch.id,ordinal:2,status:'review',revision:2,draft:{},raw_fields:{},checks:{errors:['Door number is missing.'],warnings:[]}};
 const route=()=>app.effects.find(effect=>String(effect).includes('autoReviewEntry.current'))();
 app.testCapture.setCards([{...row,id:'saved',status:'posted'},{...row,validationPending:true,checks:null}]);
 app.render();route();assert.equal(new URL(app.window.location.href).searchParams.has('scanView'),false);
 app.testCapture.setCards([{...row,id:'saved',status:'posted'},row]);
 app.render();route();
 assert.equal(new URL(app.window.location.href).searchParams.get('scanGroup'),'actionable');
 assert.equal(new URL(app.window.location.href).searchParams.get('card'),'unresolved');
 const tree=app.render();
 nodes(tree,node=>node.type==='button'&&node.props.children==='Back to card status')[0].props.onClick();
 app.render();route();assert.equal(new URL(app.window.location.href).searchParams.has('scanView'),false);
});

test('a refused card can navigate Next in review without restarting background posting',()=>{
 const app=harness('&scanView=review&scanGroup=all');app.render();
 const draft={location:'Sasti OC',trips:[],scanMachineSummary:[]};
 const cards=[1,2].map(n=>({id:'refused-'+n,batch_id:'b',ordinal:n,revision:1,status:'review',draft,raw_fields:{},checks:{errors:['Needs correction']}}));
 app.testCapture.setCards(cards);app.testCapture.setSelected(cards[0].id);app.testCapture.setDraft(draft);app.testCapture.setOptions({assets:[],employees:[],shifts:[],workOrders:[],sites:['Sasti OC']});
 app.testCapture.autoSaveFailures.current.set(cards[0].id+':1','Vehicle already has a saved card');app.testCapture.setFailureTick(n=>n+1);
 const tree=app.render();const next=nodes(tree,n=>n.type==='button'&&n.props.children==='Next')[0];assert.equal(next.props.disabled,false);next.props.onClick();assert.equal(new URL(app.window.location.href).searchParams.get('card'),cards[1].id);
});
