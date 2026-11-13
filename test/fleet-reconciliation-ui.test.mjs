import {TableSmartPrint} from './helpers/smart-print-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {fleetMachineSummary,fleetScannedCardTotal} from '../shared/fleet-reconciliation-summary.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';

test('all assets, unused reasons, and zero-card summary rows stay available in the report',async()=>{
 const source=readFileSync(new URL('../src/fleet-reconciliation.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function');
 const {code}=await transformWithOxc(source,'fleet-reconciliation.jsx',{jsx:{runtime:'classic'}});
 const slots=[];let cursor=0;
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};
 const scope={TableSmartPrint,React,useState,useEffect:()=>{},useRef:()=>({current:0}),fleetMachineSummary,fleetScannedCardTotal,canonicalSiteName};
 const Component=new Function(...Object.keys(scope),code+';return FleetReconciliation')(...Object.values(scope));
 const nodes=(tree,predicate)=>{const result=[];const walk=n=>{if(Array.isArray(n))return n.forEach(walk);if(!React.isValidElement(n))return;if(predicate(n))result.push(n);walk(n.props.children)};walk(tree);return result};
 const render=()=>{cursor=0;return Component({session:{token:'test'}})};render();
 slots[0]={sites:['Sasti OC'],shifts:[],kinds:['vehicle','lmv','equipment'],reasons:['Driver unavailable']};
 const row=(id,kind,extra)=>({assetId:id,assetKey:id,site:'Sasti OC',date:'2026-11-02',shift:'S1',door:id,kind,name:kind,model:'M1',cards:[],breakdowns:[],operated:false,breakdown:false,reason:'',remarks:'',status:'Reason pending',...extra});
 slots[2]={site:'Sasti OC',date:'2026-11-02',shift:'S1',updatedAt:'2026-11-02T10:00:00Z',warnings:[],unmatched:[],summary:{vehicle:{total:2,operated:1,breakdownOnly:0,idle:1,pending:0},equipment:{total:1,operated:0,breakdownOnly:0,idle:0,pending:1}},rows:[row('V1','vehicle',{cards:[{id:1,reference:'VLB-1'}],operated:true,status:'Operated only'}),row('V2','vehicle',{reason:'Driver unavailable',remarks:'Absent',status:'Idle / Not operated'}),row('E1','equipment')]};
 slots[2].summary.lmv={total:1,operated:1,breakdownOnly:0,idle:0,pending:0};
 slots[2].rows.push(row('LM1','lmv',{cards:[{id:2,reference:'LMV-1'}],operated:true,status:'Operated only'}));
 let tree=render(),html=renderToStaticMarkup(tree);
 assert.match(html,/VLB-1/);assert.match(html,/Driver unavailable/);assert.doesNotMatch(html,/E1/);assert.match(html,/All assets/);
 assert.deepEqual(nodes(tree,n=>n.props.role==='tab').map(n=>n.props.id),['fleet-tab-vehicle','fleet-tab-lmv','fleet-tab-equipment']);
 assert.match(html,/1 total = 1 used in LMV/);
 assert.match(html,/<summary>Fleet details[^<]+<strong class="fleet-grand-total">Total fleet 4<\/strong><\/summary>/);
 for(const [label,total] of [['VLB',2],['LMV',1],['ELB',1]]){
  assert.ok(html.includes(`${label} details (<strong>${total}</strong>)`));
 }
 nodes(tree,n=>n.type==='select'&&n.props['aria-label']==='Assets to report')[0].props.onChange({target:{value:'unused'}});
 tree=render();html=renderToStaticMarkup(tree);assert.doesNotMatch(html,/VLB-1/);assert.match(html,/Driver unavailable/);assert.match(html,/Reason pending/);assert.match(html,/1 of 2 assets shown/);
 assert.match(html,/Total fleet 4/);
 nodes(tree,n=>n.type==='select'&&n.props.value==='detail')[0].props.onChange({target:{value:'summary'}});
 html=renderToStaticMarkup(render());assert.match(html,/V2/);assert.doesNotMatch(html,/E1/);assert.match(html,/1 machines/);
 tree=render();nodes(tree,n=>n.props.id==='fleet-tab-lmv')[0].props.onClick();
 html=renderToStaticMarkup(render());assert.match(html,/LMV-1/);assert.doesNotMatch(html,/VLB-1/);assert.doesNotMatch(html,/E1/);
 tree=render();nodes(tree,n=>n.props.role==='tab'&&n.props.id==='fleet-tab-equipment')[0].props.onClick();
 html=renderToStaticMarkup(render());assert.match(html,/E1/);assert.doesNotMatch(html,/VLB-1/);assert.match(html,/1 of 1 assets shown/);
});
