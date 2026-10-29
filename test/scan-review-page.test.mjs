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
for(const name of ['ScanCorrectionStatus','BreakdownHoursField','ScanBatchReport','SmartSelect','GroqScanSettings','EmployeeIdLookup','LocalScannerPanel','ScanLine','Upload','Check','Save','Plus','Trash2','RefreshCw','ZoomIn','ZoomOut'])scope[name]=()=>null;
const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replace('export default function','function'),'bulk-card-scanning.jsx',{jsx:{runtime:'classic'}});
const nodes=(tree,predicate)=>{const rows=[];const visit=n=>{if(Array.isArray(n))return n.forEach(visit);if(!React.isValidElement(n))return;if(predicate(n))rows.push(n);visit(n.props.children)};visit(tree);return rows};
function harness(search='',kind='vehicle'){
 const slots=[],refs=[],effects=[],listeners=new Map();let cursor=0,refCursor=0;
 const location={href:'https://example.com/?page=vlb-scan'+search,get search(){return new URL(this.href).search}};
 const window={location,history:{pushState(_state,_unused,path){location.href=new URL(path,location.href).href}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:()=>{}};
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};
 const useRef=initial=>{const i=refCursor++;return refs[i]||(refs[i]={current:initial})};
 const Component=new Function(...Object.keys({...scope,window,useState,useRef,useEffect:()=>{}}),code+';return BulkCardScanning')(...Object.values({...scope,window,useState,useRef,useEffect:fn=>effects.push(fn)}));
 const render=()=>{cursor=0;refCursor=0;effects.length=0;return Component({kind,session:{token:'test'}})};
 return {render,window,listeners,effects,slots};
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

test('only Needs attention opens the review page; other status options stay on the overview',()=>{
 const app=harness();
 for(const group of ['orange','red']){
  const tree=app.render();nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-'+group)[0].props.onClick();
  assert.equal(new URL(app.window.location.href).searchParams.has('scanView'),false);
  assert.equal(nodes(app.render(),n=>n.props['aria-label']==='Cards in batch').length,0);
 }
 const tree=app.render();nodes(tree,n=>n.type==='button'&&n.props.className==='scan-group-button scan-group-brown')[0].props.onClick();
 assert.equal(new URL(app.window.location.href).searchParams.get('scanView'),'review');
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
