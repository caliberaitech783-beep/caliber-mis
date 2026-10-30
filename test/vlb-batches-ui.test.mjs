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
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function').replaceAll('export const','const');
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
 const {VlbCreateBatch,availableShifts}=await compile('vlb-create-batch.jsx',{React,useState,useRef:value=>useState(()=>({current:value}))[0],useEffect:()=>{},fetch,canonicalSiteName,displaySiteName,bookShiftCode,systemBookDate,vlbRecordSource,VlbBatchReport:()=>null},['VlbCreateBatch','availableShifts']);
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

test('opened batch search and shared export controls use only its saved snapshots',async()=>{
 const slots=[];let cursor=0;
 const useState=initial=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value]};
 const ReportSection=()=>null;
 const {VlbBatchReport,vlbBatchColumns}=await compile('vlb-batch-report.jsx',{React,useState,vlbRecordSource,displaySiteName},['VlbBatchReport','vlbBatchColumns']);
 const records=[{id:1,book_no:'VLB_M/29TH-OCT26/S1/001',data:{door:'V07',totalTrips:0,totalWorkingHmr:0}},{id:2,book_no:'VLB_S/29TH-OCT26/S1/001',data:{door:'V12',scanCardId:'scan'}}];
 const batch={id:'saved',name:'CMLL/SASTI OC/29TH -OCT-26/S1/B01',site:'Sasti OC',report_date:'2026-10-29',shift:'S1',records};
 const render=()=>{cursor=0;return VlbBatchReport({batch,ReportSection})};
 let report=render();assert.equal(report.type,ReportSection);assert.equal(report.props.rows,records);assert.equal(report.props.exportLabel,'Generate');assert.equal(report.props.smartPrintAction,true);
 assert.equal(vlbBatchColumns.find(c=>c.key==='hours').value(records[0]),0);
 assert.equal(vlbBatchColumns.find(c=>c.key==='source').value(records[1]),'VLB Scan');
 const search=nodes(report.props.controls,n=>n.type==='input')[0];assert.equal(search.props['aria-label'],'Smart Search opened batch');search.props.onChange({target:{value:'V12'}});report=render();assert.equal(report.props.query,'V12');assert.equal(report.props.rows.length,2,'search must not alter batch membership');
 // Exercise the shared section: its Generate menu must receive the same
 // filtered rows and column choices that the report table supplies for print.
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 const source=main.slice(main.indexOf('function ReportSection('),main.indexOf('// The step a request waited'));
 const {code}=await transformWithOxc(source,'report-section.jsx',{jsx:{runtime:'classic'}});
 const ExportMenu=()=>null,ReportTable=()=>null,FileBarChart=()=>null;
 const shared=new Function('React','useState','ExportMenu','ReportTable','FileBarChart','VehicleHistoryScroll',code+';return ReportSection')(React,useState,ExportMenu,ReportTable,FileBarChart,()=>null);
 slots.length=0;cursor=0;let tree=shared(report.props);
 const table=nodes(tree,n=>n.type===ReportTable)[0];assert.equal(table.props.smartPrintAction,true);assert.equal(table.props.query,'V12');
 table.props.onExportViewChange({sourceRows:records,columns:[vlbBatchColumns[0]],rows:[records[1]]});
 cursor=0;tree=shared(report.props);const menu=nodes(tree,n=>n.type===ExportMenu)[0];assert.deepEqual(menu.props.rows,[records[1]]);assert.deepEqual(menu.props.columns,[vlbBatchColumns[0]]);assert.equal(menu.props.label,'Generate');
});
