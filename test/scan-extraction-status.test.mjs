import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFileSync} from 'node:fs';
import {transformWithOxc} from 'vite';
const source=readFileSync(new URL('../src/scan-extraction-status.jsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function'),'scan-extraction-status.jsx',{jsx:{runtime:'classic'}});
const nodes=(tree,predicate)=>{const result=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(predicate(node))result.push(node);visit(node.props.children)};visit(tree);return result;};
function harness(storage=new Map(),initial=100000){
 const hooks=[],pending=[],timers=new Set();let cursor=0,changed=false,now=initial;
 const scope={React,Date:{now:()=>now},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)};
 scope.useState=initial=>{const i=cursor++;hooks[i]??={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{const next=typeof value==='function'?value(hooks[i].value):value;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;changed=true;}}];};
 scope.useEffect=(fn,deps)=>{const i=cursor++,prior=hooks[i];if(!prior||deps.some((value,n)=>!Object.is(value,prior.deps[n]))){hooks[i]={deps};pending.push(()=>{prior?.cleanup?.();hooks[i].cleanup=fn();});}};
 const component=new Function(...Object.keys(scope),code+';return {ScanExtractionStatus,formatExtractionTime};')(...Object.values(scope));
 const render=props=>{for(let i=0;i<10;i++){cursor=0;changed=false;const tree=component.ScanExtractionStatus(props);for(const effect of pending.splice(0))effect();if(!changed)return tree;}throw Error('Timer did not settle');};
 return {...component,render,storage,timers,advance:seconds=>{now+=seconds*1000;for(const tick of timers)tick();}};
}
test('extraction timer ticks while reading, survives refresh, and stops when extraction ends',()=>{
 const app=harness(),props={batchId:'one',pending:2,total:3,uploading:false};
 let tree=app.render(props);assert.equal(nodes(tree,node=>node.props.role==='timer')[0].props.children,'0 sec');
 app.advance(5);tree=app.render(props);assert.equal(nodes(tree,node=>node.props.role==='timer')[0].props.children,'5 sec');
 tree=app.render({...props,pending:1});assert.equal(nodes(tree,node=>node.props.role==='timer')[0].props.children,'5 sec');
 const refreshed=harness(app.storage,105000);tree=refreshed.render({...props,pending:1});
 assert.equal(nodes(tree,node=>node.props.role==='timer')[0].props.children,'5 sec');
 assert.equal(refreshed.render({...props,pending:0}),null);assert.equal(refreshed.timers.size,0);assert.equal(app.storage.size,0);
});
test('batch switching and invalid stored timestamps cannot show another batch elapsed time',()=>{
 const app=harness();let tree=app.render({batchId:'one',pending:1,total:1,uploading:false});app.advance(65);
 tree=app.render({batchId:'one',pending:1,total:1,uploading:false});assert.equal(nodes(tree,node=>node.props.role==='timer')[0].props.children,'1 min 05 sec');
 app.storage.set('caliberScanExtractionStart:two','Infinity');
 tree=app.render({batchId:'two',pending:1,total:1,uploading:false});assert.equal(nodes(tree,node=>node.props.role==='timer')[0].props.children,'0 sec');
 assert.equal(app.formatExtractionTime(125),'2 min 05 sec');assert.equal(app.formatExtractionTime(-1),'0 sec');
 const page=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 assert.equal((page.match(/<ScanExtractionStatus /g)||[]).length,1);
 assert.ok(!page.includes('You can review completed cards while'));
});
