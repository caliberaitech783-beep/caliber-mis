import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc} from 'vite';
import {adaptiveRefreshInterval} from '../src/mobile-performance.mjs';

const source=readFileSync(new URL('../src/site-update-notice.jsx',import.meta.url),'utf8');
const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replace('export default function','function'),'site-update-notice.jsx',{jsx:{runtime:'classic'}});
const nodes=(tree,predicate)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(predicate(node))found.push(node);visit(node.props.children)};visit(tree);return found};

test('updates never reload automatically; Later suppresses the same version and Refresh preserves the current page',async()=>{
  const priorWindow=globalThis.window,priorFetch=globalThis.fetch;
  const intervals=[],navigations=[],listeners=new Map();let serverVersion='b'.repeat(40);
  globalThis.window={location:{href:'https://pulse-ll.cmll.in/?page=trip-scan&batch=123&card=456#review',replace:url=>navigations.push(url)},setInterval:(fn,ms)=>{intervals.push({fn,ms});return 1},clearInterval(){},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
  globalThis.fetch=async()=>({ok:true,json:async()=>({version:serverVersion})});
  try{
    const slots=[],effects=[];let cursor=0;
    const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=value}]};
    const scope={React,adaptiveRefreshInterval,useState,useRef:value=>useState({current:value})[0],useEffect:fn=>effects.push(fn)};
    const Component=new Function(...Object.keys(scope),code+';return SiteUpdateNotice')(...Object.values(scope));
    const render=()=>{cursor=0;effects.length=0;return Component({currentVersion:'a'.repeat(40)})};
    assert.equal(render(),null);const cleanup=effects[0]();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(intervals.map(timer=>timer.ms),[60000]);
    for(let i=0;i<20;i++)await intervals[0].fn();
    let tree=render();assert.equal(navigations.length,0);
    assert.equal(nodes(tree,node=>node.props.role==='timer').length,0);
    nodes(tree,node=>node.type==='button'&&node.props.children==='Later')[0].props.onClick();
    await intervals[0].fn();assert.equal(render(),null);
    serverVersion='c'.repeat(40);await intervals[0].fn();tree=render();
    nodes(tree,node=>node.type==='button'&&node.props.children==='Refresh now')[0].props.onClick();
    assert.equal(navigations.length,1);const url=new URL(navigations[0],'https://pulse-ll.cmll.in');
    assert.equal(url.searchParams.get('page'),'trip-scan');assert.equal(url.searchParams.get('batch'),'123');assert.equal(url.searchParams.get('card'),'456');assert.equal(url.hash,'#review');assert.equal(url.searchParams.get('updated'),serverVersion);
    serverVersion='a'.repeat(40);await intervals[0].fn();assert.equal(render(),null,'matching releases stay quiet');assert.equal(navigations.length,1);
    cleanup();assert.equal(listeners.size,0);
  }finally{globalThis.window=priorWindow;globalThis.fetch=priorFetch}
});
