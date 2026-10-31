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
import {formatDisplayDateTime} from '../date-time-format.mjs';

async function compile(file,scope,names){
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function').replaceAll('export const','const');
 const {code}=await transformWithOxc(source,file,{jsx:{runtime:'classic'}});
 return new Function(...Object.keys(scope),code+';return {'+names.join(',')+'}')(...Object.values(scope));
}
const nodes=(tree,predicate)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(predicate(node))found.push(node);visit(node.props.children)};visit(tree);return found};
test('VLB and ELB show three entry options and standalone batch access inherits the VLB permission',async()=>{
 const icon=()=>null,{LogBookModeChoice}=await compile('log-book-mode-choice.jsx',{React,BookOpen:icon,Keyboard:icon,ScanLine:icon,Layers:icon},['LogBookModeChoice']);
 const cards=nodes(LogBookModeChoice({kind:'vehicle'}),n=>n.type==='button');assert.equal(cards.length,3);assert.doesNotMatch(renderToStaticMarkup(LogBookModeChoice({kind:'vehicle'})),/Create Batch/);
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');assert.ok(main.includes("{label:'Create Batch',page:'Create VLB Batch'},{label:'Vehicle Log Book (VLB)'"));assert.ok(main.includes("activePages:['Vehicle Log Book','Trip Card Bulk Scan','Saved VLB']"));
 assert.equal(nodes(LogBookModeChoice({kind:'equipment'}),n=>n.type==='button').length,3);
 assert.equal(requestedMisPage('?page=vlb-create-batch'),'Create VLB Batch');
 assert.equal(misPageUrl('https://mis.example/?page=trip-scan&batch=old','Create VLB Batch'),'/?page=vlb-create-batch');
 const session={permissions:{separateMisCredentials:true,misDesktopAccess:['Vehicle Log Book']}};
 assert.ok(misPageAllowed(session,'Create VLB Batch','desktop'));
 for(const [path,method] of [['/api/vlb-batches','GET'],['/api/vlb-batches/preview','GET'],['/api/vlb-batches','POST'],['/api/vlb-batches/id/close','POST']])assert.ok(misRequestAllowed(session,{path,method}));
 assert.equal(misPageAllowed({...session,permissions:{...session.permissions,misDesktopAccess:['Equipment Log Book']}},'Create VLB Batch','desktop'),false);
});

test('dedicated PM navigation permits only review routes without granting VLB editing permissions',()=>{
 const pm={role:'super',permissions:{separateMisCredentials:true,adminLevel:'Manager',managerRoles:['Project Manager'],misDesktopAccess:[]}};
 assert.equal(requestedMisPage('?page=vlb-batch-approvals'),'Batch reopening approvals');
 assert.equal(misPageAllowed(pm,'Batch reopening approvals'),true);
 assert.equal(misRequestAllowed(pm,{path:'/api/vlb-batches/approvals',method:'GET'}),true);
 const path='/api/vlb-batches/00000000-0000-4000-8000-000000000001';
 assert.equal(misRequestAllowed(pm,{path:path+'/reopen-decision',method:'POST'}),true);
 for(const route of ['/api/vlb-batches',path+'/reopen-request',path+'/reopen',path+'/close'])assert.equal(misRequestAllowed(pm,{path:route,method:'POST'}),false);
 const production={...pm,permissions:{...pm.permissions,managerRoles:['Production Manager']}};
 assert.equal(misPageAllowed(production,'Batch reopening approvals'),false);
 assert.equal(misRequestAllowed(production,{path:path+'/reopen-decision',method:'POST'}),false);
});

test('Create and Close Batch controls follow saved membership and open batch state',async()=>{
 const slots=[];let cursor=0;const calls=[];
 const useState=initial=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value]};
 const records=[{id:1,book_no:'VLB-1',data:{door:'V07'}},{id:2,book_no:'VLB-2',data:{door:'V12',scanCardId:'saved-scan'}}],batch={id:'batch1',name:'CMLL/SASTI OC/30TH -OCT-26/S1/B01',records,site:'Sasti OC',report_date:'2026-10-30',shift:'S1'};
 const fetch=async(url,request)=>{calls.push({url,request});return {ok:true,json:async()=>({...batch,closed_at:'2026-10-30T10:00:00Z',closure_revision:1})}};
 const {VlbCreateBatch,availableShifts}=await compile('vlb-create-batch.jsx',{React,SmartSelect:"select",useState,useRef:value=>useState(()=>({current:value}))[0],useEffect:()=>{},fetch,canonicalSiteName,displaySiteName,bookShiftCode,systemBookDate,vlbRecordSource,VlbBatchReport:()=>null,VlbBatchGovernance:()=>null,VlbReopenDialog:()=>null},['VlbCreateBatch','availableShifts']);
 const options={sites:['Sasti OC'],shifts:[{site:'Sasti OB',name:'Shift A',shiftCode:'I'},{site:'Sasti OC',name:'Shift B',shiftCode:'II'},{site:'Jayant OC',name:'Shift C',shiftCode:'III'},{site:'Sasti OC',name:'Night',status:'inactive'}]};
 const selection={site:'Sasti OC',date:'2026-10-30',shift:'S1'};assert.deepEqual(availableShifts(options,selection).map(s=>s.code),['S1','S2']);
 const render=()=>{cursor=0;return VlbCreateBatch({session:{token:'test'},onExit(){}})};
 render();slots[0]=options;slots[1]=selection;slots[2]={records,name:batch.name};slots[8]=false;slots[13]=true;
 const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&renderToStaticMarkup(n).includes(label))[0];
 let tree=render();assert.match(renderToStaticMarkup(tree),/2 cards · 1 Manual \+ 1 Scan/);assert.equal(button(tree,'Create Batch').props.disabled,false);
 await button(tree,'Create Batch').props.onClick();tree=render();assert.equal(button(tree,'Create Batch').props.disabled,false);assert.equal(button(tree,'Save &amp; lock batch'),undefined);assert.match(renderToStaticMarkup(tree),/CLOSED/);
 const sent=JSON.parse(calls[0].request.body);assert.deepEqual({site:sent.site,date:sent.date,shift:sent.shift},selection);assert.ok(sent.requestKey);assert.equal(sent.records,undefined,'server selects all entries');
 slots[4]={...batch,amendment_by:'alice'};slots[5]=slots[4];tree=render();await button(tree,'Save &amp; lock batch').props.onClick();tree=render();assert.equal(button(tree,'Save &amp; lock batch'),undefined);assert.match(renderToStaticMarkup(tree),/CLOSED/);assert.equal(button(tree,'Create Batch').props.disabled,false);
 slots[2]={records:[],name:batch.name};tree=render();assert.equal(button(tree,'Create Batch').props.disabled,false,'new batch can start empty');assert.doesNotMatch(renderToStaticMarkup(tree),/Create Batch · 0 cards/);
 slots[2]={records,name:batch.name,existingBatch:batch};assert.equal(button(render(),'Create Batch').props.disabled,true);assert.ok(button(render(),'Open existing batch'));
 slots[3]=[{...batch,created_by:'alice'},{...batch,id:'other',name:'Other open batch',created_by:'bob'},{...batch,id:'closed',name:'Locked batch',created_by:'alice',closed_at:'2026-10-30T10:00:00Z'}];slots[14]={login:'alice',mis:true};slots[4]={...batch,created_by:'alice'};
 tree=render();let html=renderToStaticMarkup(tree);assert.ok(html.indexOf('vlb-batch-setup')<html.indexOf('Open batch:'));assert.ok(html.indexOf('vlb-batch-tabs')<html.indexOf('All matching saved entries')||html.includes('CLOSED'));
 const tab=label=>nodes(tree,n=>n.props.role==='tab'&&n.props.children===label)[0];assert.equal(tab('Open').props['aria-selected'],true);assert.doesNotMatch(html,/Locked batch/);
 tab('Closed').props.onClick();tree=render();assert.equal(nodes(tree,n=>n.props.role==='tab'&&n.props.children==='Closed')[0].props['aria-selected'],true);
 const rows=nodes(tree,n=>n.type==='tr');const ownerRow=rows.find(n=>renderToStaticMarkup(n).includes('CMLL/SASTI'));const otherRow=rows.find(n=>renderToStaticMarkup(n).includes('Other open batch'));assert.equal(button(ownerRow,'Save &amp; lock batch').props.disabled,false);assert.equal(button(otherRow,'Save &amp; lock batch').props.disabled,true);
 await button(ownerRow,'Save &amp; lock batch').props.onClick();assert.ok(calls.at(-1).url.endsWith('/batch1/close'));assert.equal(calls.at(-1).request.method,'POST');
 tree=render();nodes(tree,n=>n.props.role==='tab'&&n.props.children==='Edit')[0].props.onClick();tree=render();assert.ok(button(tree,'Edit batch'));const approval=button(tree,'Request PM approval');assert.ok(approval);await approval.props.onClick();assert.equal(slots[15],true,'locked edit opens the existing approval dialog');assert.equal(calls.at(-1).request.method,'GET','editing a locked batch does not bypass approval');
 slots[18]={active:true,endsAt:'2026-11-10T13:00:00Z'};tree=render();assert.ok(button(tree,'Reopen batch'));assert.equal(button(tree,'Request PM approval'),undefined);assert.match(renderToStaticMarkup(tree),/VLB trial: PM approval is paused until/);

});

test('approval popup requests a reason, shows pending state, and consumes only an approved grant',async()=>{
 const slots=[];let cursor=0;const calls=[];let changes=0,dismissed=0;
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};
 const fetch=async(url,request)=>{calls.push({url,body:JSON.parse(request.body)});return {ok:true,json:async()=>url.endsWith('/reopen-request')?{id:'request',requested_by:'alice',status:'pending',closure_revision:1}:{id:'batch',records:[]}}};
 const {VlbReopenDialog}=await compile('vlb-reopen-dialog.jsx',{React,SmartSelect:"select",useState,useRef:value=>useState(()=>({current:value}))[0],useEffect:()=>{},fetch,displaySiteName,formatDisplayDateTime},['VlbReopenDialog']);
 let batch={id:'batch',name:'B01',site:'Sasti OC',closed_at:'2026-10-30',closure_revision:1,canRequestReopen:true,requests:[]};const actor={login:'alice',mis:true};
 const render=()=>{cursor=0;return VlbReopenDialog({session:{token:'test'},batch,actor,onChanged:async()=>{changes++},onDismiss:()=>dismissed++})};
 const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&renderToStaticMarkup(n).includes(label))[0];
 let tree=render();assert.equal(button(tree,'Request PM approval').props.disabled,true);assert.match(renderToStaticMarkup(tree),/PM approval required/);
 nodes(tree,n=>n.type==='textarea')[0].props.onChange({target:{value:'Additional cards received'}});tree=render();await button(tree,'Request PM approval').props.onClick();
 assert.equal(calls[0].url,'/api/vlb-batches/batch/reopen-request');assert.equal(calls[0].body.reason,'Additional cards received');assert.equal(changes,1);tree=render();assert.match(renderToStaticMarkup(tree),/Awaiting PM approval/);assert.equal(button(tree,'Request PM approval'),undefined);
 batch={...batch,canReopen:true,requests:[{id:'request',requested_by:'alice',status:'approved',closure_revision:1,decided_by:'pm'}]};tree=render();assert.match(renderToStaticMarkup(tree),/PM approval granted/);await button(tree,'Reopen approved batch').props.onClick();assert.equal(calls[1].url,'/api/vlb-batches/batch/reopen');assert.equal(dismissed,1);
 batch={...batch,pmApprovalTrial:{active:true,endsAt:'2026-11-10T13:00:00Z'},requests:[]};tree=render();assert.match(renderToStaticMarkup(tree),/Reopen during VLB trial/);assert.equal(nodes(tree,n=>n.type==='textarea').length,0);await button(tree,'Reopen batch').props.onClick();assert.equal(calls.at(-1).url,'/api/vlb-batches/batch/reopen');
});

test('PM approval screen requires a rejection reason and sends the selected request and review remark',async()=>{
 const slots=[];let cursor=0;const calls=[];let changes=0;
 const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};
 const fetch=async(url,request)=>{calls.push({url,body:JSON.parse(request.body)});return {ok:true,json:async()=>({})}};
 const {ApprovalRequest}=await compile('vlb-batch-approvals.jsx',{React,SmartSelect:"select",useState,useRef:()=>({current:0}),useEffect:()=>{},fetch,displaySiteName,batchDateTime:()=>'-'},['ApprovalRequest']);
 let request={id:'request2',batch_id:'batch',name:'B01',site:'Sasti OC',requested_by:'alice',reason:'Extra cards',status:'pending',current_revision:1,closure_revision:1,canDecide:true};
 const render=()=>{cursor=0;return ApprovalRequest({request,session:{token:'test'},onChanged:async()=>changes++})};
 const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&renderToStaticMarkup(n).includes(label))[0];
 await button(render(),'Reject request').props.onClick();assert.equal(calls.length,0);assert.match(renderToStaticMarkup(render()),/Enter a rejection reason/);
 nodes(render(),n=>n.type==='textarea')[0].props.onChange({target:{value:'Please verify the meter readings'}});await button(render(),'Reject request').props.onClick();assert.deepEqual(calls[0].body,{requestId:'request2',decision:'reject',note:'Please verify the meter readings'});assert.equal(changes,1);
 await button(render(),'Approve reopening').props.onClick();assert.equal(calls[1].body.decision,'approve');
 request={...request,canDecide:false,status:'approved',decision_note:'Checked against original scan',decided_by:'pm'};assert.equal(button(render(),'Approve reopening'),undefined);assert.match(renderToStaticMarkup(render()),/Checked against original scan/);
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
