import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {meterCorrectionReport} from '../scan-meter-history.mjs';
import {canonicalSiteName} from '../site-location.mjs';
import {displaySiteName} from '../region-scope.mjs';
import {bookShiftCode,systemBookDate} from '../trip-card-rules.mjs';
import {vlbRecordSource} from '../vlb-batch-format.mjs';

async function compile(file,scope,names){
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function').replaceAll('export const','const');
 const {code}=await transformWithOxc(source,file,{jsx:{runtime:'classic'}});
 return new Function(...Object.keys(scope),code+';return {'+names.join(',')+'}')(...Object.values(scope));
}
const nodes=(tree,predicate)=>{const found=[];const visit=node=>{if(Array.isArray(node))return node.forEach(visit);if(!React.isValidElement(node))return;if(predicate(node))found.push(node);visit(node.props.children)};visit(tree);return found};
const button=(tree,label)=>nodes(tree,n=>n.type==='button'&&renderToStaticMarkup(n).includes(label))[0];
const hooks=()=>{const slots=[];let cursor=0;const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};return {slots,useState,useRef:value=>useState(()=>({current:value}))[0],reset:()=>{cursor=0}}};
const statuses={working:{label:'Working',allowsTrips:true,needsOperator:true,needsHours:true},working_partial_breakdown:{label:'Working, partial breakdown',allowsTrips:true,needsOperator:true,needsBreakdown:'partial'},breakdown:{label:'Breakdown',allowsTrips:false,needsBreakdown:'full'},maintenance:{label:'Maintenance',allowsTrips:false},no_operator:{label:'No operator',allowsTrips:false},not_in_use:{label:'Not in use',allowsTrips:false}};
const fleet=[
 {assetId:'19',door:'VPC-019',equipmentName:'Excavator',trips:42,sourceCards:5,saved_at:null,skipped:false,draft:null},
 {assetId:'7',door:'D-07',equipmentName:'Dozer',trips:0,sourceCards:0,saved_at:'2026-11-01T03:00:00Z',shift_status:'maintenance',book_no:'ELB-1',draft:null},
 {assetId:'8',door:'G-08',equipmentName:'Grader',trips:0,sourceCards:0,saved_at:null,skipped:false,draft:{shiftStatus:'no_operator',remark:'No shift operator'}},
];

test('fleet stepper renders status buttons, blocks non-working statuses for a loader and computes hours',async()=>{
 const h=hooks();const calls=[];
 const fetch=async(url,request)=>{calls.push({url,method:request.method,body:request.body?JSON.parse(request.body):null});return {ok:true,json:async()=>({assetId:'19',draft:{},fleet})}};
 const {VlbFleetStepper,fleetHours,firstUnsavedIndex,tripsHint,fleetDraftFields}=await compile('vlb-fleet-stepper.jsx',{React,SmartSelect:'select',useState:h.useState,useRef:h.useRef,useEffect:()=>{},fetch,crypto:{randomUUID:()=>'key'}},['VlbFleetStepper','fleetHours','firstUnsavedIndex','tripsHint','fleetDraftFields']);
 assert.equal(fleetHours('100','106.5'),6.5);assert.equal(fleetHours('','5'),null);
 assert.equal(firstUnsavedIndex(fleet),0,'opens at the first machine without saved_at');
 assert.equal(firstUnsavedIndex([fleet[1],{...fleet[2],skipped:true},fleet[0]]),2,'prefers un-skipped machines');
 assert.equal(tripsHint(fleet[0],statuses),'VPC-019 loaded 42 trips on 5 tipper cards this shift. Only Working or Working, partial breakdown can be saved.');
 assert.equal(fleetDraftFields(fleet[2]).shiftStatus,'no_operator','drafts prefill the form');
 assert.equal(fleetDraftFields({...fleet[1],logbook:{shiftStatus:'maintenance',openingHmr:120,closingHmr:120}}).openingHmr,'120','saved log books prefill when no draft exists');
 const batch={id:'batch1',name:'B01',site:'Jayant OC',fleet,statuses,fleetProgress:{total:3,saved:1,remaining:2}};
 const render=()=>{h.reset();return VlbFleetStepper({session:{token:'t'},batch,options:{employees:[{id:'5',name:'Ramesh',caliberId:'C5'},{id:'6',name:'Arun'}]},onChanged(){},onDismiss(){}})};
 let tree=render();let html=renderToStaticMarkup(tree);
 assert.equal(nodes(tree,n=>n.props.role==='dialog').length,1);
 assert.match(html,/VPC-019 · Excavator/);assert.match(html,/42 trips loaded · 5 source cards/);assert.match(html,/1 of 3 saved/);
 assert.match(html,/VPC-019 loaded 42 trips on 5 tipper cards this shift/);
 const statusButtons=nodes(tree,n=>n.type==='button'&&n.props['aria-pressed']!==undefined);
 assert.deepEqual(statusButtons.map(n=>n.props.children),Object.values(statuses).map(s=>s.label));
 assert.deepEqual(statusButtons.filter(n=>n.props.disabled).map(n=>n.props.children),['Breakdown','Maintenance','No operator','Not in use'],'only working statuses stay enabled when trips were loaded');
 assert.equal(button(tree,'Next').props.disabled,true,'Next waits for a status');assert.equal(button(tree,'Previous').props.disabled,true);
 statusButtons[0].props.onClick();tree=render();html=renderToStaticMarkup(tree);
 assert.equal(statusButtons.length,6);assert.match(html,/Operator \*/,'working machines need an operator');assert.match(html,/Ramesh · C5/);assert.match(html,/Draft pending/);
 const inputs=nodes(tree,n=>n.type==='input');const opening=inputs.find(n=>n.props.step==='0.01');const closing=inputs.filter(n=>n.props.step==='0.01')[1];
 opening.props.onChange({target:{value:'1200'}});closing.props.onChange({target:{value:'1206.5'}});tree=render();assert.match(renderToStaticMarkup(tree),/Hours: 6.5/);
 nodes(tree,n=>n.type==='select')[0].props.onChange({target:{value:'5'}});tree=render();
 await button(tree,'Next').props.onClick();
 const save=calls.find(c=>c.url==='/api/vlb-batches/batch1/fleet/19'&&c.method==='POST');assert.ok(save,'Next posts the machine entry');
 assert.equal(save.body.shiftStatus,'working');assert.equal(save.body.employeeId,'5');assert.equal(save.body.openingHmr,'1200');assert.equal(save.body.closingHmr,'1206.5');assert.equal(save.body.requestKey,'key');
 tree=render();assert.match(renderToStaticMarkup(tree),/G-08 · Grader/,'moves to the next unsaved machine, skipping the saved dozer');
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props['aria-pressed']!==undefined).filter(n=>n.props.disabled).length,0,'zero-trip machines may take any status');
 // Zero trips: Working is still offered, the hint explains the hours rule, and the draft prefilled No operator.
 assert.match(renderToStaticMarkup(tree),/Zero trips: Working needs closing HMR above opening HMR/);
 assert.equal(nodes(tree,n=>n.type==='button'&&n.props['aria-pressed']===true)[0].props.children,'No operator');
 const failing=async()=>({ok:false,status:400,json:async()=>({error:'Select the operator for a working machine.'})});
 const {VlbFleetStepper:Failing}=await compile('vlb-fleet-stepper.jsx',{React,SmartSelect:'select',useState:h.useState,useRef:h.useRef,useEffect:()=>{},fetch:failing,crypto:{randomUUID:()=>'key'}},['VlbFleetStepper']);
 const renderFailing=()=>{h.reset();return Failing({session:{token:'t'},batch,options:{employees:[]},onChanged(){},onDismiss(){}})};
 tree=renderFailing();await button(tree,'Next').props.onClick();tree=renderFailing();assert.match(renderToStaticMarkup(tree),/Select the operator for a working machine\./,'server validation text shows under the buttons');
});

test('holds panel lists held assets with the express transfer button and walks through OTP verification',async()=>{
 const h=hooks();const calls=[];
 const fetch=async(url,request)=>{calls.push({url,body:JSON.parse(request.body)});return url.endsWith('/verify')?{ok:true,json:async()=>({transfer:{id:'t1',transferNo:'VT-7',status:'Completed'},completed:true})}:{ok:true,json:async()=>({transfer:{id:'t1',transferNo:'VT-7',source:'NIGAHI',destination:'JAYANT OC',status:'Awaiting source approval'},otp:{id:'otp1',expiresAt:new Date(Date.now()+600000).toISOString(),sentTo:['pm1','pm2'],channels:['telegram']}})}};
 const {VlbBatchHolds,NewEquipmentRequest,otpCountdown,holdRoles}=await compile('vlb-batch-holds.jsx',{React,useState:h.useState,useEffect:()=>{},fetch,displaySiteName},['VlbBatchHolds','NewEquipmentRequest','otpCountdown','holdRoles']);
 assert.equal(otpCountdown('2026-11-01T10:10:00Z',Date.parse('2026-11-01T10:00:30Z')),'9:30 left');assert.equal(otpCountdown('2026-11-01T10:00:00Z',Date.parse('2026-11-01T10:00:30Z')),'expired');
 assert.equal(holdRoles(['vlb_loader','elb_door']),'VLB loading machine, ELB machine');
 let changes=0;const batch={id:'batch1',site:'Jayant OC',holds:[{assetId:'19',label:'VPC-019',assetSite:'Nigahi',roles:['vlb_loader'],cards:[1,2],cardCount:2,trips:17}]};
 const render=()=>{h.reset();return VlbBatchHolds({session:{token:'t'},batch,onChanged:()=>changes++})};
 let tree=render();let html=renderToStaticMarkup(tree);
 assert.match(html,/Awaiting transfer/);assert.match(html,/VPC-019/);assert.match(html,/Nigahi/i);assert.match(html,/VLB loading machine/);
 const row=nodes(tree,n=>n.type==='tr')[1];assert.match(renderToStaticMarkup(row),/<td>2<\/td><td>17<\/td>/);
 const express=button(tree,'Express transfer (OTP)');assert.ok(express);await express.props.onClick();
 assert.deepEqual(calls[0],{url:'/api/vehicle-transfers/express',body:{batchId:'batch1',assetId:'19'}});
 tree=render();html=renderToStaticMarkup(tree);assert.match(html,/Transfer VT-7 · OTP sent to 2 PMs via Telegram · (10:00|9:5\d) left/);assert.equal(button(tree,'Express transfer (OTP)'),undefined);
 assert.equal(button(tree,'Verify').props.disabled,true);nodes(tree,n=>n.type==='input')[0].props.onChange({target:{value:'482913'}});tree=render();
 await button(tree,'Verify').props.onClick();assert.deepEqual(calls[1],{url:'/api/vehicle-transfers/express/otp1/verify',body:{otp:'482913'}});assert.equal(changes,1);
 tree=render();assert.match(renderToStaticMarkup(tree),/Transfer VT-7 completed/);
 assert.equal(VlbBatchHolds({session:{token:'t'},batch:{...batch,holds:[]}}),null,'no panel without holds');
 // The holds endpoints may not be deployed yet; the error text must show instead of breaking the page.
 const missing=async()=>({ok:false,status:404,json:async()=>{throw Error('not json')}});
 const {VlbBatchHolds:Missing}=await compile('vlb-batch-holds.jsx',{React,useState:h.useState,useEffect:()=>{},fetch:missing,displaySiteName},['VlbBatchHolds']);
 h.slots.length=0;const renderMissing=()=>{h.reset();return Missing({session:{token:'t'},batch})};
 tree=renderMissing();await button(tree,'Express transfer (OTP)').props.onClick();tree=renderMissing();assert.match(renderToStaticMarkup(tree),/not available on this server yet \(HTTP 404\)/);
 // New equipment request: door plus registration or chassis, site fixed to the batch, then OTP.
 h.slots.length=0;const equipmentCalls=[];
 const equipmentFetch=async(url,request)=>{equipmentCalls.push({url,body:JSON.parse(request.body)});return url.endsWith('/verify')?{ok:true,json:async()=>({equipment:{id:'99',door:'V-212'}})}:{ok:true,json:async()=>({request:{id:'req1',expiresAt:new Date(Date.now()+600000).toISOString(),sentTo:['pm1'],channels:['telegram']}})}};
 const {NewEquipmentRequest:Equipment}=await compile('vlb-batch-holds.jsx',{React,useState:h.useState,useEffect:()=>{},fetch:equipmentFetch,displaySiteName},['NewEquipmentRequest']);
 let created=0;const renderEquipment=()=>{h.reset();return Equipment({session:{token:'t'},batch,onCreated:()=>created++,onDismiss(){}})};
 tree=renderEquipment();html=renderToStaticMarkup(tree);assert.match(html,/Create new equipment/);assert.match(html,/<option>Vehicle<\/option><option selected="">Equipment<\/option>/);
 await button(tree,'Send OTP request').props.onClick();assert.equal(equipmentCalls.length,0);tree=renderEquipment();assert.match(renderToStaticMarkup(tree),/Enter the door number and either the registration or the chassis number/);
 const field=(tree,label)=>nodes(tree,n=>n.type==='label'&&renderToStaticMarkup(n).includes('<span>'+label))[0].props.children[1];
 field(tree,'Door number').props.onChange({target:{value:'V-212'}});tree=renderEquipment();field(tree,'Chassis').props.onChange({target:{value:'MC2XYZ'}});tree=renderEquipment();
 await button(tree,'Send OTP request').props.onClick();assert.equal(equipmentCalls[0].url,'/api/equipment/express');assert.equal(equipmentCalls[0].body.batchId,'batch1');assert.deepEqual({door:equipmentCalls[0].body.draft.door,chassis:equipmentCalls[0].body.draft.chassis,site:equipmentCalls[0].body.draft.site},{door:'V-212',chassis:'MC2XYZ',site:'Jayant OC'});
 tree=renderEquipment();assert.match(renderToStaticMarkup(tree),/OTP sent to 1 PM via Telegram/);nodes(tree,n=>n.props['aria-label']==='New equipment OTP')[0].props.onChange({target:{value:'517204'}});tree=renderEquipment();
 await button(tree,'Verify').props.onClick();assert.deepEqual(equipmentCalls[1],{url:'/api/equipment/express/req1/verify',body:{otp:'517204'}});assert.equal(created,1);
 tree=renderEquipment();assert.match(renderToStaticMarkup(tree),/V-212 has been created in the Equipment master/);
});

test('create batch shows the stage indicator and Close batch only for two-stage batches',async()=>{
 const h=hooks();const calls=[];let elbEntry=null;
 const fetch=async(url,request)=>{calls.push({url,method:request.method,body:request.body?JSON.parse(request.body):null});return {ok:true,json:async()=>({id:'batch1',twoStage:true,stage:'elb_open',records:[]})}};
 const Stepper=()=>null,Holds=()=>null,Equipment=()=>null;
 const {VlbCreateBatch,stageLabel}=await compile('vlb-create-batch.jsx',{React,SmartSelect:'select',useState:h.useState,useRef:h.useRef,useEffect:()=>{},fetch,canonicalSiteName,displaySiteName,bookShiftCode,systemBookDate,vlbRecordSource,VlbBatchCardDetails:()=>null,VlbBatchReport:()=>null,VlbBatchGovernance:()=>null,VlbReopenDialog:()=>null,VlbFleetStepper:Stepper,VlbBatchHolds:Holds,NewEquipmentRequest:Equipment,window:{prompt:()=>'Correct VLB card V07'}},['VlbCreateBatch','stageLabel']);
 assert.equal(stageLabel('vlb_open'),'VLB open');assert.equal(stageLabel('elb_open'),'ELB open');assert.equal(stageLabel('closed'),'Closed');assert.equal(stageLabel(undefined,{closed_at:'2026-11-01'}),'Closed');
 const options={sites:['Jayant OC'],shifts:[{site:'Jayant OC',name:'Shift A',shiftCode:'I'}]},selection={site:'Jayant OC',date:'2026-11-01',shift:'S1'};
 const base={id:'batch1',name:'CMLL/JAYANT OC/1ST-NOV-26/S1/B01',site:'Jayant OC',report_date:'2026-11-01',shift:'S1',records:[],created_by:'alice'};
 const render=()=>{h.reset();return VlbCreateBatch({session:{token:'t'},onExit(){},onManual(){},onScan(){},onElbEntry:batch=>{elbEntry=batch}})};
 render();h.slots[0]=options;h.slots[1]=selection;h.slots[8]=false;h.slots[13]=true;h.slots[14]={login:'alice',mis:true};
 // Legacy payload: no stage indicator, Save & lock batch everywhere, no two-stage components rendered.
 h.slots[3]=[{...base,created_by:'alice'}];h.slots[4]=base;h.slots[5]=base;
 let tree=render();let html=renderToStaticMarkup(tree);
 assert.doesNotMatch(html,/vlb-stage-steps/);assert.doesNotMatch(html,/Close batch/);assert.doesNotMatch(html,/Lock VLB/);assert.match(html,/OPEN · Jayant OC/);
 assert.ok(button(tree,'Save &amp; lock batch'));assert.equal(nodes(tree,n=>[Stepper,Holds,Equipment].includes(n.type)).length,0);
 assert.match(renderToStaticMarkup(nodes(tree,n=>n.type==='tr')[1]),/<td>OPEN<\/td>/);
 // Two-stage VLB stage: Lock VLB with blockers, ELB disabled hint, list shows VLB open.
 const vlbStage={...base,twoStage:true,stage:'vlb_open',canLockVlb:false,lockBlockers:['Awaiting transfer: VPC-019 from NIGAHI (2 cards, 17 trips).'],holds:[],fleet:[]};
 h.slots[3]=[{...base,stage:'vlb_open'}];h.slots[5]=vlbStage;h.slots[4]={...base,stage:'vlb_open'};h.slots[23]=true;
 tree=render();html=renderToStaticMarkup(tree);
 assert.match(html,/<ol class="vlb-stage-steps"[^>]*><li aria-current="step" class="current">1 VLB<\/li><li>2 ELB<\/li><li>Closed<\/li><\/ol>/);
 assert.equal(button(tree,'Lock VLB').props.disabled,true);assert.match(html,/Lock VLB is blocked: Awaiting transfer: VPC-019 from NIGAHI/);assert.match(html,/Lock VLB first/);
 assert.equal(button(tree,'Save &amp; lock batch'),undefined);assert.equal(button(tree,'Close batch'),undefined);assert.match(renderToStaticMarkup(nodes(tree,n=>n.type==='tr')[1]),/<td>VLB open<\/td>/);assert.ok(button(nodes(tree,n=>n.type==='tr')[1],'Open batch'));
 assert.equal(nodes(tree,n=>n.type===Holds).length,1);assert.equal(nodes(tree,n=>n.type===Equipment).length,0);
 button(tree,'Create new equipment').props.onClick();tree=render();assert.equal(nodes(tree,n=>n.type===Equipment).length,1);assert.equal(nodes(tree,n=>n.type===Equipment)[0].props.batch,vlbStage);
 button(tree,'Hide new equipment form').props.onClick();
 h.slots[5]={...vlbStage,canLockVlb:true,lockBlockers:[]};tree=render();assert.equal(button(tree,'Lock VLB').props.disabled,false);await button(tree,'Lock VLB').props.onClick();assert.equal(calls.at(-1).url,'/api/vlb-batches/batch1/lock-vlb');assert.equal(calls.at(-1).method,'POST');
 // ELB stage: stage indicator moves, Start/Continue machines, fleet table, blockers, Close batch, Unlock VLB with reason.
 const elbStage={...base,twoStage:true,stage:'elb_open',canEnterFleet:true,canClose:false,canUnlockVlb:true,closeBlockers:['Machines without a saved ELB: VPC-019 loaded 42 trips, no ELB saved.'],holds:[],statuses,fleetProgress:{total:2,saved:1,remaining:1,skipped:0,drafts:1,loaders:1},fleet:[{assetId:'19',door:'VPC-019',equipmentName:'Excavator',trips:42,saved_at:null,draft:{shiftStatus:'working'}},{assetId:'7',door:'D-07',equipmentName:'Dozer',trips:0,saved_at:'2026-11-01T03:00:00Z',shift_status:'maintenance',book_no:'ELB-1'}]};
 h.slots[3]=[{...base,stage:'elb_open',created_by:'bob'}];h.slots[4]={...base,stage:'elb_open',canClose:false};h.slots[5]=elbStage;
 tree=render();html=renderToStaticMarkup(tree);
 assert.match(html,/<li>1 VLB<\/li><li aria-current="step" class="current">2 ELB<\/li>/);
 const start=button(tree,'Continue machines');assert.ok(start,'saved machines mean Continue');assert.equal(start.props.disabled,false);
 assert.match(html,/1 of 2 machines saved · 1 remaining · 1 draft · 1 loading machine/);
 assert.match(html,/<td>VPC-019<\/td><td>Excavator<\/td><td>42<\/td><td>Not saved<\/td><td><span class="vlb-draft-indicator">Draft<\/span><\/td>/);
 assert.match(html,/<td>D-07<\/td><td>Dozer<\/td><td>0<\/td><td>Maintenance<\/td><td>ELB-1<\/td>/);
 assert.match(html,/Close batch is blocked: Machines without a saved ELB/);
 const closeButtons=nodes(tree,n=>n.type==='button'&&n.props.children==='Close batch');assert.ok(closeButtons.length>=2,'detail panel and open batch notice both show Close batch');assert.ok(closeButtons.every(n=>n.props.disabled));
 assert.equal(button(tree,'Save &amp; lock batch'),undefined);assert.equal(button(tree,'Lock VLB'),undefined);
 assert.match(renderToStaticMarkup(nodes(tree,n=>n.type==='tr')[1]),/<td>ELB open<\/td>/);
 button(tree,'ELB manual / scan').props.onClick();assert.equal(elbEntry,elbStage);
 assert.equal(nodes(tree,n=>n.type===Stepper).length,0);start.props.onClick();tree=render();const stepper=nodes(tree,n=>n.type===Stepper)[0];assert.equal(stepper.props.batch,elbStage);assert.equal(stepper.props.options,options);
 stepper.props.onChanged({record:{id:1},fleet:[],fleetProgress:{total:2,saved:2,remaining:0},closeBlockers:[]});assert.deepEqual(h.slots[5].closeBlockers,[]);assert.equal(h.slots[5].fleetProgress.saved,2);assert.equal(h.slots[5].record,undefined);
 await button(tree,'Unlock VLB').props.onClick();assert.equal(calls.at(-1).url,'/api/vlb-batches/batch1/unlock-vlb');assert.deepEqual(calls.at(-1).body,{reason:'Correct VLB card V07'});
 h.slots[5]={...elbStage,canClose:true,closeBlockers:[]};tree=render();await nodes(tree,n=>n.type==='button'&&n.props.children==='Close batch'&&!n.props.disabled)[0].props.onClick();assert.equal(calls.at(-1).url,'/api/vlb-batches/batch1/close');
 const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');assert.ok(source.includes("onElbEntry={batch=>{rememberVlbEntryBatch(session,batch);selectMenu('Equipment Log Book Options')}}"),'main.jsx routes ELB entry from the batch');
});

test('batch report adds the machine-wise shift report with totals only when the server supplies it',async()=>{
 const h=hooks();const ReportSection=()=>null;
 const {VlbBatchReport,MachineReport}=await compile('vlb-batch-report.jsx',{React,useState:h.useState,vlbRecordSource,displaySiteName,meterCorrectionReport},['VlbBatchReport','MachineReport']);
 const records=[{id:1,book_no:'VLB-1',data:{door:'V07'}}];
 const batch={id:'b',name:'B01',site:'Jayant OC',report_date:'2026-11-01',shift:'S1',records};
 h.reset();let tree=VlbBatchReport({batch,ReportSection});assert.equal(tree.type,ReportSection,'legacy batches return the report section alone');
 const machineReport={loaders:[{assetId:'19',door:'VPC-019',equipmentName:'Excavator',status:'working',statusLabel:'Working',trips:42,sourceCards:5,operator:'Ramesh',openingHmr:1200,closingHmr:1206.5,hours:6.5,tripsPerHour:6.46,breakdownHours:0,bookNo:'ELB-2'}],others:[{assetId:'7',door:'D-07',equipmentName:'Dozer',status:'maintenance',statusLabel:'Maintenance',trips:0,hours:0,remark:'Service due'}],totals:{machines:2,trips:42,hours:6.5,working:1,down:1,idle:0}};
 h.reset();tree=VlbBatchReport({batch:{...batch,machineReport,statuses},ReportSection});
 assert.equal(nodes(tree,n=>n.type===ReportSection).length,1);const machine=nodes(tree,n=>n.type===MachineReport)[0];assert.equal(machine.props.report,machineReport);
 const html=renderToStaticMarkup(tree);
 assert.match(html,/Machine-wise shift report/);
 assert.match(html,/<td>VPC-019<\/td><td>Excavator<\/td><td>42<\/td><td>5<\/td><td>Ramesh<\/td><td>1200<\/td><td>1206.5<\/td><td>6.5<\/td><td>6.46<\/td><td>0<\/td><td>Working<\/td><td>ELB-2<\/td>/);
 assert.match(html,/Other equipment/);assert.match(html,/<td>D-07<\/td><td>Dozer<\/td><td colSpan="5">Maintenance<\/td><td>0<\/td>/);assert.match(html,/Service due/);
 assert.match(html,/Totals · 2 machines<\/th><th>42<\/th>/);assert.match(html,/Fleet summary: 2 machines · 1 working · 1 down · 0 idle/);
});
