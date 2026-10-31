import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
const scope={React};
for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){
 if(!match[2].startsWith('.'))continue;
 const module=await import(new URL('../src/'+match[2],import.meta.url));
 for(const name of match[1].split(',').map(v=>v.trim()))scope[name]=module[name];
}
for(const name of ['ScanEquipmentReviewDialog','ScanExtractionStatus','ScanExtractionLine','ScanCorrectionStatus','BreakdownHoursField','ScanBatchReport','SmartSelect','GroqScanSettings','EmployeeIdLookup','LocalScannerPanel','ScanLine','Upload','Check','Save','Plus','Trash2','RefreshCw','ZoomIn','ZoomOut'])scope[name]=()=>null;
const {code}=await transformWithOxc(source.replace('const fleetCards=cards.filter','testCapture.setCards=setCards; testCapture.setSelected=setSelected; const fleetCards=cards.filter').replace(/^import .*;\r?\n/gm,'').replace('export default function','function'),'bulk-card-scanning.jsx',{jsx:{runtime:'classic'}});
const nodes=(tree,predicate)=>{const rows=[];const visit=n=>{if(Array.isArray(n))return n.forEach(visit);if(!React.isValidElement(n))return;if(predicate(n))rows.push(n);visit(n.props.children)};visit(tree);return rows};
function harness(search='',kind='vehicle'){
 const testCapture={},slots=[],refs=[],effects=[],listeners=new Map();let cursor=0,refCursor=0;
 const location={href:'https://example.com/?page=vlb-scan'+search,get search(){return new URL(this.href).search}};
 const window={location,history:{pushState(_state,_unused,path){location.href=new URL(path,location.href).href},replaceState(_state,_unused,path){location.href=new URL(path,location.href).href}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:()=>{}};
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};
 const useRef=initial=>{const i=refCursor++;return refs[i]||(refs[i]={current:initial})};
 const Component=new Function(...Object.keys({...scope,testCapture,window,useState,useRef,useEffect:()=>{}}),code+';return BulkCardScanning')(...Object.values({...scope,testCapture,window,useState,useRef,useEffect:fn=>effects.push(fn)}));
 const render=()=>{cursor=0;refCursor=0;effects.length=0;return Component({kind,session:{token:'test'}})};
 return {render,window,listeners,effects,slots,testCapture};
}
test('VLB scan and upload overview show status without correction or scan panels; attention opens a separate URL and Back restores overview',()=>{
 const app=harness();let tree=app.render();
 assert.equal(nodes(tree,n=>n.props.className==='scan-card-groups').length,1);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Cards in batch').length,0);
 assert.equal(nodes(tree,n=>n.props.className==='scan-draft'||n.props.className==='scan-source').length,0);
 const uploadTab=nodes(tree,n=>n.type==='button'&&n.props.children==='Upload files')[0];uploadTab.props.onClick();tree=app.render();
 assert.equal(nodes(tree,n=>n.props.className==='scan-upload-panel').length,1);
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

test('fleet upload details start collapsed and automatic-save alert hides repeated validation text',()=>{
 assert.match(source,/fleetRejection\)&&<details className="scan-fleet-rejection-details"><summary>Show fresh-upload details/);
 assert.match(source,/autoSaveError&&<div role="alert" className="scan-error">Automatic Saving Stopped <button/);
 assert.doesNotMatch(source,/Automatic saving stopped: \{autoSaveError\}/);
});


test('highlighted equipment review returns to the same choices using page Back, browser Back and refresh',()=>{
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
 assert.equal(nodes(tree,n=>n.type===scope.ScanEquipmentReviewDialog)[0].props.card.id,card.id);
 assert.equal(new URL(backApp.window.location.href).searchParams.has('scanView'),false);
 assert.equal(new URL(backApp.window.location.href).searchParams.get('batch'),'batch-1');
 const origin='&batch=batch-1&scanEquipment=card-1';
 for(const refreshed of [false,true]){
  const target=harness(refreshed?origin:'&batch=batch-1&scanView=review&scanReviewReturn=card-1');target.render();target.testCapture.setCards([card]);
  if(!refreshed){target.effects[0]();target.window.location.href='https://example.com/?page=vlb-scan'+origin;target.listeners.get('popstate')();}
  assert.equal(nodes(target.render(),n=>n.type===scope.ScanEquipmentReviewDialog)[0].props.card.id,card.id);
 }
});
