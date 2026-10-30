import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {canonicalSiteName} from '../site-location.mjs';
import {displaySiteName} from '../region-scope.mjs';
import {bookShiftCode,systemBookDate} from '../trip-card-rules.mjs';
import {vlbRecordSource} from '../vlb-batch-format.mjs';
import {requestedMisPage,misPageUrl} from '../src/mis-navigation.mjs';
import {misPageAllowed,misRequestAllowed} from '../mis-application-access.mjs';

async function compile(file,scope,names){
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function');
 const {code}=await transformWithOxc(source,file,{jsx:{runtime:'classic'}});
 return new Function(...Object.keys(scope),code+';return {'+names.join(',')+'}')(...Object.values(scope));
}
const nodes=(tree,predicate)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(predicate(node))found.push(node);visit(node.props.children)};visit(tree);return found};
test('VLB has four cards, ELB retains three, and batch access inherits the VLB permission',async()=>{
 const icon=()=>null,{LogBookModeChoice}=await compile('log-book-mode-choice.jsx',{React,BookOpen:icon,Keyboard:icon,ScanLine:icon,Layers:icon},['LogBookModeChoice']);
 let clicked=false;const cards=nodes(LogBookModeChoice({kind:'vehicle',onCreateBatch:()=>clicked=true}),n=>n.type==='button');assert.equal(cards.length,4);assert.match(renderToStaticMarkup(cards[3]),/Create Batch/);cards[3].props.onClick();assert.ok(clicked);
 assert.equal(nodes(LogBookModeChoice({kind:'equipment'}),n=>n.type==='button').length,3);
 assert.equal(requestedMisPage('?page=vlb-create-batch'),'Create VLB Batch');
 assert.equal(misPageUrl('https://mis.example/?page=trip-scan&batch=old','Create VLB Batch'),'/?page=vlb-create-batch');
 const session={permissions:{separateMisCredentials:true,misDesktopAccess:['Vehicle Log Book']}};
 assert.ok(misPageAllowed(session,'Create VLB Batch','desktop'));
 for(const [path,method] of [['/api/vlb-batches','GET'],['/api/vlb-batches/preview','GET'],['/api/vlb-batches','POST'],['/api/vlb-batches/id/close','POST']])assert.ok(misRequestAllowed(session,{path,method}));
 assert.equal(misPageAllowed({...session,permissions:{...session.permissions,misDesktopAccess:['Equipment Log Book']}},'Create VLB Batch','desktop'),false);
});

test('Create and Close Batch controls follow saved membership and open batch state',async()=>{
 const slots=[];let cursor=0;const calls=[];
 const useState=initial=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value]};
 const records=[{id:1,book_no:'VLB-1',data:{door:'V07'}},{id:2,book_no:'VLB-2',data:{door:'V12',scanCardId:'saved-scan'}}],batch={id:'batch1',name:'CMLL/SASTI OC/30TH -OCT-26/S1/B01',records,site:'Sasti OC',report_date:'2026-10-30',shift:'S1'};
 const fetch=async(url,request)=>{calls.push({url,request});return {ok:true,json:async()=>url.endsWith('/close')?{...batch,closed_at:'2026-10-30T10:00:00Z'}:batch}};
 const {VlbCreateBatch,availableShifts}=await compile('vlb-create-batch.jsx',{React,useState,useRef:value=>useState(()=>({current:value}))[0],useEffect:()=>{},fetch,canonicalSiteName,displaySiteName,bookShiftCode,systemBookDate,vlbRecordSource},['VlbCreateBatch','availableShifts']);
 const options={sites:['Sasti OC'],shifts:[{site:'Sasti OB',name:'Shift A',shiftCode:'I'},{site:'Sasti OC',name:'Shift B',shiftCode:'II'},{site:'Jayant OC',name:'Shift C',shiftCode:'III'},{site:'Sasti OC',name:'Night',status:'inactive'}]};
 const selection={site:'Sasti OC',date:'2026-10-30',shift:'S1'};assert.deepEqual(availableShifts(options,selection).map(s=>s.code),['S1','S2']);
 const render=()=>{cursor=0;return VlbCreateBatch({session:{token:'test'},onExit(){}})};
 render();slots[0]=options;slots[1]=selection;slots[2]={records,name:batch.name};slots[8]=false;slots[13]=true;
 const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&renderToStaticMarkup(n).includes(label))[0];
 let tree=render();assert.match(renderToStaticMarkup(tree),/2 cards · 1 Manual \+ 1 Scan/);assert.equal(button(tree,'Create Batch').props.disabled,false);
 await button(tree,'Create Batch').props.onClick();tree=render();assert.equal(button(tree,'Create Batch').props.disabled,true);assert.equal(button(tree,'Close Batch').props.disabled,false);
 const sent=JSON.parse(calls[0].request.body);assert.deepEqual({site:sent.site,date:sent.date,shift:sent.shift},selection);assert.ok(sent.requestKey);assert.equal(sent.records,undefined,'server selects all entries');
 await button(tree,'Close Batch').props.onClick();tree=render();assert.equal(button(tree,'Close Batch'),undefined);assert.match(renderToStaticMarkup(tree),/CLOSED/);assert.equal(button(tree,'Create Batch').props.disabled,false);
 slots[2]={records:[],name:batch.name};assert.equal(button(render(),'Create Batch').props.disabled,true);
});
