// Regression: on 1 November 2026 the meter-limit refactor removed the
// `meterLimitIssues` definition from the VLB scan page but left two uses in the
// Total KMR / Total HMR labels. Every card opened in review then threw a
// ReferenceError and the operator saw "This screen could not be displayed",
// so no VLB entry could be reviewed or closed. This test renders the card
// form itself (the earlier page tests only rendered the overview and empty
// review groups), including the state right after mismatch cards are deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
import {scanContextGate} from '../scan-batch-context.mjs';
const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
const scope={React};
for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){
 if(!match[2].startsWith('.'))continue;
 const module=await import(new URL('../src/'+match[2],import.meta.url));
 for(const name of match[1].split(',').map(v=>v.trim()))scope[name]=module[name];
}
for(const name of ['ScanEquipmentReviewDialog','ScanExtractionStatus','ScanExtractionLine','ScanCorrectionStatus','BreakdownHoursField','ScanBatchReport','SmartSelect','EmployeeIdLookup','LocalScannerPanel','ScanAliasMismatchDialog','ScanDuplicateList','ScanUploadTimer','ScanLine','Check','Save','Plus','Trash2','RefreshCw','ZoomIn','ZoomOut'])scope[name]=()=>null;
scope.ApplicationErrorBoundary=({children})=>children;
scope.ScanBatchMismatchDialog=({gate})=>React.createElement('section',{className:'scan-mismatch-dialog'},gate.mismatches.length);
const {code}=await transformWithOxc(source
 .replace('const awaitingContext=Boolean(','testCapture.setContextGate=setContextGate; testCapture.setMismatchListOpen=setMismatchListOpen; const awaitingContext=Boolean(')
 .replace('const fleetCards=cards.filter','testCapture.setCards=setCards; testCapture.setSelected=setSelected; testCapture.setOptions=setOptions; testCapture.setBatch=setBatch; testCapture.setDraft=setDraft; const fleetCards=cards.filter')
 .replace(/^import .*;\r?\n/gm,'').replace('export default function','function'),'bulk-card-scanning.jsx',{jsx:{runtime:'classic'}});
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
const totalText=label=>React.Children.toArray(label.props.children)[0]?.props?.children;
const meterTotals=tree=>nodes(tree,n=>n.type==='label'&&/^Total (KMR|HMR)/.test(String(totalText(n)||'')));
const context={bookDate:'2026-11-01',location:'Jayant OB',cardShift:'I'};
const draftFor=(i,extra={})=>({bookDate:'2026-11-01',bookDateSource:'scan',location:'Jayant OB',cardShift:'I',doorText:'V/'+(200+i),assetId:'',employeeId:'',shiftId:'',shiftHours:'8',openingHmr:'100',closingHmr:'108',openingKmr:'1000',closingKmr:'1050',trips:[],...extra});
const card=(i,extra={})=>({id:'card-'+i,batch_id:'b1',ordinal:i,filename:'JAYANT SHIFT A 01.11.26 40 CARDS.pdf · page '+i,status:'review',revision:2,draft:draftFor(i),raw_fields:{extractionDraft:draftFor(i)},context_mismatch:[],...extra});
const batch={id:'b1',kind:'vehicle',name:'CMLL/2026-11-01/JAYANT OB/S1/ANOOP/B08',expected_context:{...context,confirmed:true,cancelled:false},created_at:'2026-11-02T10:00:00Z'};
const options={sites:['Jayant OB'],assets:[],employees:[],shifts:[],workOrders:[],accountLocation:'Jayant OB',canSelectSite:true};
function loaded(app,cards,{selected='card-1',mismatchListOpen=false}={}){
 app.render();
 app.testCapture.setBatch(batch);app.testCapture.setCards(cards);app.testCapture.setOptions(options);
 app.testCapture.setContextGate(scanContextGate(batch.expected_context,cards));app.testCapture.setMismatchListOpen(mismatchListOpen);
 app.testCapture.setSelected(selected);app.testCapture.setDraft(cards.find(c=>c.id===selected).draft);
 return app.render();
}
test('the review page renders the card form for a selected VLB card',()=>{
 const tree=loaded(harness('&batch=b1&scanView=review&scanGroup=all'),[card(1),card(2)]);
 assert.equal(nodes(tree,n=>n.props.id==='scan-entry-fields').length,1,'card form is shown');
 const totals=meterTotals(tree);
 assert.equal(totals.length,2,'Total KMR and Total HMR labels render');
 assert.ok(totals.every(label=>label.props.className===''),'readings within the 8-hour limit are not highlighted');
});
test('meter totals over the shift limit are highlighted without blocking the form',()=>{
 const over=card(1,{draft:draftFor(1,{closingHmr:'120',closingKmr:'1400'})});
 const tree=loaded(harness('&batch=b1&scanView=review&scanGroup=all'),[over]);
 const totals=meterTotals(tree);
 assert.equal(totals.length,2);
 assert.ok(totals.every(label=>label.props.className==='scan-meter-limit'),'both totals carry the limit highlight');
 assert.equal(nodes(tree,n=>n.props.id==='scan-entry-fields')[0].props.disabled,false,'the form stays editable');
});
test('the page still renders after mismatch cards are deleted from the batch',()=>{
 const cards=Array.from({length:40},(_,k)=>card(k+1));
 for(const i of [2,9,22])cards[i-1]=card(i,{status:'rejected',review_note:'Removed from batch: wrong date, site or shift',draft:draftFor(i,{bookDate:'2026-10-01'}),context_mismatch:['Date: 2026-10-01; expected 2026-11-01']});
 for(const search of ['&batch=b1','&batch=b1&scanView=review&scanGroup=all','&batch=b1&scanView=review&scanGroup=error']){
  const tree=loaded(harness(search),cards,{mismatchListOpen:true});
  assert.ok(tree,'renders '+search);
  assert.equal(nodes(tree,n=>n.props.className==='scan-mismatch-dialog').length,0,'no mismatch cards remain to delete for '+search);
 }
});

// Regression: on 29 October 2026 the Scania door-number fix rewrote the review
// page line that held the "Extraction needs checking" section, dropping the
// checkbox that sets draft.responseRecoveryConfirmed. The server refuses to save
// any card with responseRecoveryIssues until that flag is true, so every such
// card was stuck with "Card still needs attention" and automatic saving stopped.
test('cards with response recovery issues list them and offer the confirmation checkbox',()=>{
 const issues=['Trip row 2: loading time unreadable or invalid; check the original scan.'];
 const app=harness('&batch=b1&scanView=review&scanGroup=all');
 const tree=loaded(app,[card(1,{raw_fields:{extractionDraft:draftFor(1),responseRecoveryIssues:issues}}),card(2)]);
 const section=nodes(tree,n=>n.props['data-testid']==='scan-response-recovery');
 assert.equal(section.length,1,'the Extraction needs checking section renders');
 assert.deepEqual(nodes(section[0],n=>n.type==='li').map(n=>n.props.children),issues);
 const box=nodes(section[0],n=>n.type==='input'&&n.props.type==='checkbox');
 assert.equal(box.length,1,'the confirmation checkbox renders');
 assert.equal(box[0].props.checked,false);
 box[0].props.onChange({target:{checked:true}});
 const after=app.render();
 const checked=nodes(after,n=>n.props['data-testid']==='scan-response-recovery');
 assert.equal(nodes(checked[0],n=>n.type==='input'&&n.props.type==='checkbox')[0].props.checked,true,'ticking the box sets responseRecoveryConfirmed on the draft');
 assert.equal(nodes(loaded(harness('&batch=b1&scanView=review&scanGroup=all'),[card(1),card(2)]),n=>n.props['data-testid']==='scan-response-recovery').length,0,'cards without issues show no section');
});
