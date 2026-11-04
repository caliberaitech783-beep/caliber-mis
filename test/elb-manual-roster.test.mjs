import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';

test('ELB manual renders the full equipment report below machine entry',async()=>{
 const source=readFileSync(new URL('../src/elb-batch-manual.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
 const {code}=await transformWithOxc(source,'elb-batch-manual.jsx',{jsx:{runtime:'classic'}});
 const Component=new Function('React','useEffect','useState','VlbFleetStepper',code+';return ElbBatchManual')(React,()=>{},initial=>[initial===null?{employees:[]}:initial,()=>{}],()=>React.createElement('div',null,'Machine entry'));
 const html=renderToStaticMarkup(Component({session:{token:'test'},batch:{name:'Batch 1'},fleetReconciliation:React.createElement('section',null,'Full equipment report · Idle reasons · Print report')}));
 assert.match(html,/Machine entry/);
 assert.match(html,/Full equipment report · Idle reasons · Print report/);
 assert.match(html,/<details class="scan-fleet-reconciliation"><summary>Fleet reconciliation · VLB \/ ELB<\/summary>/,'report is collapsed by default with an accessible toggle');
 assert.doesNotMatch(html,/<details[^>]*\bopen(?:=|\s|>)/);
 assert.ok(html.indexOf('Machine entry')<html.indexOf('Full equipment report'));
});
