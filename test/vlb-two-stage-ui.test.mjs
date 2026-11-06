import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {meterCorrectionReport} from '../shared/scan-meter-history.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {displaySiteName} from '../shared/region-scope.mjs';
import {bookShiftCode,systemBookDate} from '../shared/trip-card-rules.mjs';
import {employeeAtLocation} from '../shared/log-book-access.mjs';
import {vlbRecordSource,vlbRecordEntryType,vlbRecordTrips} from '../shared/vlb-batch-format.mjs';
import {matchesSmartSearch} from '../shared/smart-search.mjs';
import {isSurfaceMiner,splitSurfaceMinerHmr} from '../shared/surface-miner-hmr.mjs';

async function compile(file,scope,names){
 scope={employeeAtLocation,matchesSmartSearch,isSurfaceMiner,splitSurfaceMinerHmr,...scope};
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
 {assetId:'8',door:'G-08',equipmentName:'Grader',trips:0,sourceCards:0,saved_at:null,skipped:false,draft:null},
];

test('ELB has Working and Breakdown details tabs and fetches Pulse for each machine before saving',async()=>{
 const h=hooks(),calls=[];let lastDeps,cleanup;
 const useEffect=(fn,deps)=>{if(!lastDeps||deps.some((v,i)=>v!==lastDeps[i])){cleanup?.();lastDeps=deps;cleanup=fn();}};
 const pulse={shiftHours:8,breakdownHours:1.5,breakdowns:[{reference:'BD-1',description:'Hydraulic leak',start:'2026-11-02T03:30:00Z',end:'2026-11-02T05:00:00Z',status:'Restored',hours:1.5}],fetchedAt:'2026-11-02T08:00:00Z'};
 const fetch=async(url,request)=>{calls.push({url,method:request.method,body:request.body?JSON.parse(request.body):null});return {ok:true,json:async()=>request.method==='GET'?(url.includes('/19/')?pulse:{...pulse,breakdownHours:0,breakdowns:[]}):{fleet:[{...fleet[0],saved_at:'now'},fleet[1],fleet[2]]}}};
 const {VlbFleetStepper,fleetHours,fleetIdleHours,focusNextElbField,firstUnsavedIndex,fleetDraftFields}=await compile('vlb-fleet-stepper.jsx',{React,SmartSelect:'select',useState:h.useState,useRef:h.useRef,useEffect,fetch,crypto:{randomUUID:()=>'key'}},['VlbFleetStepper','fleetHours','fleetIdleHours','focusNextElbField','firstUnsavedIndex','fleetDraftFields']);
 assert.equal(fleetHours('100','106.5'),6.5);assert.equal(firstUnsavedIndex(fleet),0);assert.equal(fleetDraftFields(fleet[2]).shiftStatus,'working');
 assert.equal(fleetIdleHours(8,1),7);assert.equal(fleetIdleHours(8,null),null);
 const focusCalls=[];const fields=[{focus:()=>focusCalls.push('operator')},{focus:()=>focusCalls.push('opening')},{focus:()=>focusCalls.push('closing')},{focus:()=>focusCalls.push('remark')}];let prevented=false;
 focusNextElbField({key:'Enter',shiftKey:false,isComposing:false,target:fields[2],currentTarget:{querySelectorAll:()=>fields},preventDefault:()=>{prevented=true}});assert.equal(prevented,true);assert.deepEqual(focusCalls,['remark']);
 assert.equal(fleetDraftFields({...fleet[1],logbook:{shiftStatus:'maintenance',openingHmr:120,closingHmr:120}}).openingHmr,'120');
 const batch={id:'batch1',name:'B01',site:'Jayant OC',report_date:'2026-11-02',shift:'S1',fleet,statuses};
 const render=()=>{h.reset();return VlbFleetStepper({session:{token:'t'},batch,options:{employees:[{id:'5',name:'Ramesh',caliberId:'C5',site:'Jayant OC'},{id:'6',name:'Other site employee',caliberId:'C6',site:'Sasti OC'}]},onChanged(){},onDismiss(){}})};
 let tree=render();assert.equal(button(tree,'Next').props.disabled,true,'waits for Pulse instead of treating pending data as zero');
 await new Promise(setImmediate);tree=render();let html=renderToStaticMarkup(tree);
 assert.deepEqual(nodes(tree,n=>n.props.role==='tab').map(n=>n.props.children),['Working',['Breakdown details',' (1)']]);
 assert.equal(nodes(tree,n=>n.props['aria-label']==='Shift status').length,0,'the six status selectors are removed');
 assert.match(html,/Caliber ID/);assert.match(html,/Select Caliber ID/);assert.match(html,/C5 · Ramesh/);assert.doesNotMatch(html,/C6|Other site employee/);
 assert.match(html,/1.500/);assert.match(html,/Hydraulic leak/);assert.match(html,/BD-1/);
 assert.equal(nodes(tree,n=>n.type==='input'&&n.props['aria-label']==='Breakdown Hrs').length,0,'Pulse total is read only');
 const tabs=nodes(tree,n=>n.props.role==='tab');tabs[1].props.onClick();tree=render();assert.equal(nodes(tree,n=>n.props.id==='elb-breakdown-panel')[0].props.hidden,false);
 tabs[0].props.onClick();tree=render();
 const inputs=nodes(tree,n=>n.type==='input');inputs.filter(n=>n.props.step==='0.01')[0].props.onChange({target:{value:'1200'}});inputs.filter(n=>n.props.step==='0.01')[1].props.onChange({target:{value:'1206.5'}});nodes(tree,n=>n.type==='select')[0].props.onChange({target:{value:'5'}});
 tree=render();let htmlAfterHours=renderToStaticMarkup(tree);assert.match(htmlAfterHours,/Idle hours<\/span><input[^>]*readOnly=""[^>]*value="1\.5"/);assert.doesNotMatch(htmlAfterHours,/Status reason/);assert.equal((htmlAfterHours.match(/<span>Remark/g)||[]).length,1);
 await button(tree,'Next').props.onClick();const save=calls.find(c=>c.method==='POST');assert.equal(save.body.entryMode,'working-only');assert.equal(save.body.openingHmr,'1200');assert.equal(save.body.employeeId,'5');assert.equal(save.body.idleHours,'1.5');
 tree=render();assert.match(renderToStaticMarkup(tree),/G-08/);assert.equal(button(tree,'Next').props.disabled,true,'the previous equipment total is not reused');
 await new Promise(setImmediate);tree=render();assert.match(renderToStaticMarkup(tree),/No breakdown found/);assert.ok(calls.some(c=>c.url==='/api/vlb-batches/batch1/fleet/8/breakdowns'));
 cleanup?.();
});

test('Surface Miner ELB shows the saved operator split and its combined HMR',async()=>{
 const h=hooks();
 const {VlbFleetStepper}=await compile('vlb-fleet-stepper.jsx',{React,SmartSelect:'select',useState:h.useState,useEffect:()=>{}},['VlbFleetStepper']);
 const machine={...fleet[0],door:'SM1',equipmentName:'Surface Miner',saved_at:'now',logbook:{
  employeeId:7,openingHmr:100,closingHmr:108,operatorSplit:{secondOperatorId:8,handoverHmr:104},
 }};
 const batch={id:'batch1',site:'Sasti OC',fleet:[machine],canEditSavedFleet:true};
 const tree=VlbFleetStepper({session:{token:'t'},batch,options:{employees:[]},embedded:true});
 const html=renderToStaticMarkup(tree);
 assert.match(html,/Second operator \(optional\)/);
 assert.equal(nodes(tree,node=>node.props['data-elb-entry']==='handover-hmr')[0].props.value,'104');
 assert.match(html,/First operator 4.00 h · Second operator 4.00 h · Combined HMR 8.00 h/);
});

test('Dudhicau West PL82 opens in a stable editor outside the machine table',async()=>{
 const h=hooks();
 const {VlbFleetStepper}=await compile('vlb-fleet-stepper.jsx',{React,SmartSelect:'select',useState:h.useState,useEffect:()=>{},fetch:async()=>({ok:true,json:async()=>({})}),crypto:{randomUUID:()=>'key'}},['VlbFleetStepper']);
 const machines=fleet.map(item=>item.door==='G-08'?{...item,door:'PL82',equipmentName:'Wheel Loader'}:item);
 const batch={id:'batch1',site:'Dudhicau West',report_date:'2026-11-02',shift:'S1',fleet:machines,statuses};
 const render=()=>{h.reset();return VlbFleetStepper({session:{token:'t'},batch,options:{employees:[]},embedded:true})};
 let tree=render(),html=renderToStaticMarkup(tree);
 assert.match(html,/<\/table><\/div><\/section><section class="vlb-fleet-machine-editor"/);
 button(tree,'Enter ELB').props.onClick();tree=render();html=renderToStaticMarkup(tree);
 assert.match(html,/aria-selected="true"><td>PL82/);
 assert.match(html,/<\/table><\/div><\/section><section class="vlb-fleet-machine-editor"[\s\S]*?id="vlb-fleet-stepper-title">PL82/);
 const search=nodes(tree,node=>node.type==='input'&&node.props.type==='search')[0];
 search.props.onChange({target:{value:'No matching equipment'}});
 assert.match(renderToStaticMarkup(render()),/id="vlb-fleet-stepper-title">PL82/);
});

test('switching machines ignores late Pulse responses and failed lookups show retry instead of zero',async()=>{
 const h=hooks(),pending=[];let lastDeps,cleanup;
 const useEffect=(fn,deps)=>{if(!lastDeps||deps.some((v,i)=>v!==lastDeps[i])){cleanup?.();lastDeps=deps;cleanup=fn();}};
 const fetch=(url,request)=>request.method==='GET'?new Promise(resolve=>pending.push({url,resolve})):Promise.resolve({ok:true,json:async()=>({})});
 const {VlbFleetStepper}=await compile('vlb-fleet-stepper.jsx',{React,SmartSelect:'select',useState:h.useState,useEffect,fetch,crypto:{randomUUID:()=>'key'}},['VlbFleetStepper']);
 const batch={id:'batch1',site:'Jayant OC',report_date:'2026-11-02',shift:'S1',fleet,statuses};
 const render=()=>{h.reset();return VlbFleetStepper({session:{token:'t'},batch,options:{employees:[]}})};
 let tree=render();await button(tree,'Skip').props.onClick();tree=render();assert.equal(pending.length,2);
 pending[0].resolve({ok:true,json:async()=>({breakdownHours:7,breakdowns:[],fetchedAt:'2026-11-02'})});await new Promise(setImmediate);tree=render();assert.doesNotMatch(renderToStaticMarkup(tree),/7\.000/);assert.equal(button(tree,'Next').props.disabled,true);
 pending[1].resolve({ok:false,status:503,json:async()=>({error:'Pulse offline'})});await new Promise(setImmediate);tree=render();assert.match(renderToStaticMarkup(tree),/Pulse offline/);assert.equal(button(tree,'Next').props.disabled,true);
 button(tree,'Retry Pulse').props.onClick();tree=render();pending[2].resolve({ok:true,json:async()=>({breakdownHours:0,breakdowns:[],fetchedAt:'2026-11-02'})});await new Promise(setImmediate);tree=render();assert.match(renderToStaticMarkup(tree),/No breakdown found/);assert.equal(button(tree,'Next').props.disabled,false);cleanup?.();
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
 const h=hooks();const calls=[];let elbEntry=null,equipmentElb=null;
 const fetch=async(url,request)=>{calls.push({url,method:request.method,body:request.body?JSON.parse(request.body):null});return {ok:true,json:async()=>({id:'batch1',twoStage:true,stage:'elb_open',records:[]})}};
 const Stepper=()=>null,Holds=()=>null,Equipment=()=>null;
 const {VlbCreateBatch,stageLabel}=await compile('vlb-create-batch.jsx',{React,SmartSelect:'select',useState:h.useState,useRef:h.useRef,useEffect:()=>{},fetch,canonicalSiteName,displaySiteName,bookShiftCode,systemBookDate,vlbRecordSource,vlbRecordEntryType,VlbBatchCardDetails:()=>null,VlbBatchReport:()=>null,VlbBatchGovernance:()=>null,VlbReopenDialog:()=>null,VlbFleetStepper:Stepper,VlbBatchHolds:Holds,NewEquipmentRequest:Equipment,window:{prompt:()=>'Correct VLB card V07'}},['VlbCreateBatch','stageLabel']);
 assert.equal(stageLabel('vlb_open'),'VLB open');assert.equal(stageLabel('elb_open'),'ELB open');assert.equal(stageLabel('closed'),'ELB locked · Batch closed');assert.equal(stageLabel(undefined,{closed_at:'2026-11-01'}),'ELB locked · Batch closed');
 const options={sites:['Jayant OC'],shifts:[{site:'Jayant OC',name:'Shift A',shiftCode:'I'}]},selection={site:'Jayant OC',date:'2026-11-01',shift:'S1'};
 const base={id:'batch1',name:'CMLL/JAYANT OC/1ST-NOV-26/S1/B01',site:'Jayant OC',report_date:'2026-11-01',shift:'S1',records:[],created_by:'alice'};
 const render=()=>{h.reset();return VlbCreateBatch({session:{token:'t'},onExit(){},onManual(){},onScan(){},onElbEntry:batch=>{elbEntry=batch},onEquipmentElb:batch=>{equipmentElb=batch}})};
 render();h.slots[0]=options;h.slots[1]=selection;h.slots[8]=false;h.slots[13]=true;h.slots[14]={login:'alice',mis:true};
 // Legacy payload: no stage indicator, Save & lock batch everywhere, no two-stage components rendered.
 h.slots[3]=[{...base,created_by:'alice'}];h.slots[4]=base;h.slots[5]=base;
 let tree=render();let html=renderToStaticMarkup(tree);
 assert.doesNotMatch(html,/vlb-stage-steps/);assert.doesNotMatch(html,/Close batch/);assert.doesNotMatch(html,/Lock VLB/);assert.doesNotMatch(html,/OPEN · Jayant OC/);
 assert.ok(button(tree,'Save &amp; lock batch'));assert.equal(nodes(tree,n=>[Stepper,Holds,Equipment].includes(n.type)).length,0);
 assert.match(renderToStaticMarkup(nodes(tree,n=>n.type==='tr')[1]),/<td>OPEN<\/td>/);
 // Two-stage VLB stage: Lock VLB with blockers, ELB disabled hint, list shows VLB open.
 const vlbStage={...base,twoStage:true,stage:'vlb_open',canLockVlb:false,lockBlockers:['Awaiting transfer: VPC-019 from NIGAHI (2 cards, 17 trips).'],holds:[],fleet:[]};
 h.slots[3]=[{...base,stage:'vlb_open'}];h.slots[5]=vlbStage;h.slots[4]={...base,stage:'vlb_open'};h.slots[23]=true;
 tree=render();html=renderToStaticMarkup(tree);
 assert.match(html,/<ol class="vlb-stage-steps"[^>]*><li aria-current="step" class="current">1 VLB open<\/li><li>2 ELB open<\/li><li>3 ELB locked · Batch closed<\/li><\/ol>/);
 assert.equal(button(tree,'Lock VLB').props.disabled,true);assert.match(html,/Lock VLB is blocked: Awaiting transfer: VPC-019 from NIGAHI/);assert.match(html,/Lock VLB first/);
 assert.equal(button(tree,'Save &amp; lock batch'),undefined);assert.equal(button(tree,'Close batch'),undefined);assert.match(renderToStaticMarkup(nodes(tree,n=>n.type==='tr')[1]),/<td>VLB open<\/td>/);assert.ok(button(nodes(tree,n=>n.type==='tr')[1],'Open batch'));
 assert.equal(nodes(tree,n=>n.type===Holds).length,1);assert.equal(nodes(tree,n=>n.type===Equipment).length,0);
 button(tree,'Create new equipment').props.onClick();tree=render();assert.equal(nodes(tree,n=>n.type===Equipment).length,1);assert.equal(nodes(tree,n=>n.type===Equipment)[0].props.batch,vlbStage);
 button(tree,'Hide new equipment form').props.onClick();
 h.slots[5]={...vlbStage,canLockVlb:true,lockBlockers:[]};tree=render();assert.equal(button(tree,'Lock VLB').props.disabled,false);await button(tree,'Lock VLB').props.onClick();assert.equal(calls.at(-1).url,'/api/vlb-batches/batch1/lock-vlb');assert.equal(calls.at(-1).method,'POST');
 // ELB stage: the batch remains visible, while entry moves to ELB Manual instead of opening a second stepper here.
 const elbStage={...base,twoStage:true,stage:'elb_open',canEnterFleet:true,canClose:false,canUnlockVlb:true,closeBlockers:['Machines without a saved ELB: VPC-019 loaded 42 trips, no ELB saved.'],holds:[],statuses,fleetProgress:{total:3,saved:1,remaining:1,optionalUnsaved:1,skipped:0,drafts:0,loaders:1},fleet:[{assetId:'19',door:'VPC-019',equipmentName:'Excavator',trips:42,saved_at:null,draft:null},{assetId:'7',door:'D-07',equipmentName:'Dozer',trips:0,saved_at:'2026-11-01T03:00:00Z',shift_status:'maintenance',book_no:'ELB-1',logbook:{employeeName:'Ramesh',caliberId:'C5',openingHmr:120,closingHmr:124,totalWorkingHmr:4,breakdownHours:1,idleHours:3,availabilityHours:4,jobCardNo:'JC-9',remark:'Service',bookDate:'2026-11-01',location:'Jayant OC',shiftName:'Shift A'}}]};
 h.slots[3]=[{...base,stage:'elb_open',created_by:'bob'}];h.slots[4]={...base,stage:'elb_open',canClose:false};h.slots[5]=elbStage;
 tree=render();html=renderToStaticMarkup(tree);
 assert.match(html,/<li>1 VLB open<\/li><li aria-current="step" class="current">2 ELB open<\/li>/);
 assert.equal(button(tree,'Continue ELB entries'),undefined);assert.equal(button(tree,'Start ELB entries'),undefined);
 assert.match(html,/ELBs saved: 1 · Required remaining: 1 · 1 optional with no saved ELB · 1 loading machine/);assert.doesNotMatch(html,/1 draft/);
 assert.match(html,/<td>VPC-019<\/td><td>Excavator<\/td><td>42<\/td><td>Not saved<\/td><td>—<\/td><td>—<\/td>/);
 assert.match(html,/<td>D-07<\/td><td>Dozer<\/td><td>0<\/td><td>Maintenance<\/td>/);
 assert.match(html,/<th>Operator<\/th><th>Caliber ID<\/th><th>Opening HMR<\/th><th>Closing HMR<\/th><th>Working HMR<\/th><th>BD hours<\/th><th>Idle hours<\/th><th>Availability hours<\/th><th>Job card<\/th><th>Remarks<\/th>/);
 assert.doesNotMatch(html,/Close &amp; lock ELB is blocked: Machines without a saved ELB/);
 const closeButtons=nodes(tree,n=>n.type==='button'&&React.Children.toArray(n.props.children).join('')==='Close & lock ELB');assert.ok(closeButtons.length>=2,'detail panel and open batch notice both show Close & lock ELB');assert.ok(closeButtons.every(n=>n.props.disabled));assert.match(html,/The batch owner or an MIS administrator can close and lock this ELB/);
 assert.equal(button(tree,'Save &amp; lock batch'),undefined);assert.equal(button(tree,'Lock VLB'),undefined);
 assert.match(renderToStaticMarkup(nodes(tree,n=>n.type==='tr')[1]),/<td>ELB open<\/td>/);
 button(tree,'Process Equipment ELB').props.onClick();assert.equal(equipmentElb,elbStage);
 for(const label of ['Open ELB manual / scan','Create new equipment','Manual','Scan','Upload'])assert.equal(button(tree,label),undefined,label+' is hidden during ELB');
 button(tree,'Hide Equipment ELB').props.onClick();tree=render();
 assert.equal(button(tree,'Process Equipment ELB'),undefined);
 assert.equal(nodes(tree,n=>n.props.id==='vlb-equipment-elb-details')[0].props.hidden,true);
 assert.equal(button(tree,'Show Equipment ELB').props['aria-expanded'],false);
 assert.ok(button(tree,'Unlock VLB'));assert.ok(button(tree,'Close &amp; lock ELB'));
 button(tree,'Show Equipment ELB').props.onClick();tree=render();
 assert.ok(button(tree,'Process Equipment ELB'));assert.equal(nodes(tree,n=>n.props.id==='vlb-equipment-elb-details')[0].props.hidden,false);
 assert.equal(nodes(tree,n=>n.type===Stepper).length,0,'the separate batch-page entry flow is removed');
 await button(tree,'Unlock VLB').props.onClick();assert.equal(calls.at(-1).url,'/api/vlb-batches/batch1/unlock-vlb');assert.deepEqual(calls.at(-1).body,{reason:'Correct VLB card V07'});
 h.slots[14]={login:'admin',admin:true};h.slots[3]=[{...base,stage:'elb_open',created_by:'bob',canClose:true}];
 h.slots[5]={...elbStage,canClose:true,closeBlockers:[],fleetProgress:{...elbStage.fleetProgress,saved:2,remaining:0}};tree=render();assert.equal(button(tree,'Close batch').props.disabled,false);assert.match(renderToStaticMarkup(tree),/ELBs saved: 2 · Required remaining: 0 · 1 optional with no saved ELB/);await nodes(tree,n=>n.type==='button'&&React.Children.toArray(n.props.children).join('')==='Close & lock ELB'&&!n.props.disabled)[0].props.onClick();assert.equal(calls.at(-1).url,'/api/vlb-batches/batch1/close');
 const source=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');assert.ok(source.includes("onElbEntry={batch=>{rememberVlbEntryBatch(session,batch);selectMenu('Equipment Log Book Options')}}"),'main.jsx routes ELB entry choices from the batch');assert.ok(source.includes("onEquipmentElb={batch=>{rememberVlbEntryBatch(session,batch);selectMenu('Equipment Log Book')}}"),'main.jsx routes equipment processing directly to the contextual ELB report');
});

test('ELB fleet table shows a serial number column before Door',()=>{
 const css=readFileSync(new URL('../src/log-book-readability.css',import.meta.url),'utf8');
 assert.match(css,/\.vlb-fleet-table thead tr::before\{content:"Sr\. No\."\}/);
 assert.match(css,/\.vlb-fleet-table tbody tr::before\{content:counter\(vlb-fleet-row\)\}/);
});

test('batch report adds the machine-wise shift report with totals only when the server supplies it',async()=>{
 const h=hooks();const ReportSection=()=>null;
 const {VlbBatchReport,MachineReport}=await compile('vlb-batch-report.jsx',{React,useState:h.useState,vlbRecordEntryType,vlbRecordSource,vlbRecordTrips,displaySiteName,meterCorrectionReport},['VlbBatchReport','MachineReport']);
 const records=[{id:1,book_no:'VLB-1',data:{door:'V07'}}];
 const batch={id:'b',name:'B01',site:'Jayant OC',report_date:'2026-11-01',shift:'S1',records};
 h.reset();let tree=VlbBatchReport({batch,ReportSection});assert.equal(nodes(tree,n=>n.type===ReportSection).length,1,'legacy batches include the report section');
 const machineReport={loaders:[{assetId:'19',door:'VPC-019',equipmentName:'Excavator',status:'working',statusLabel:'Working',trips:42,sourceCards:5,operator:'Ramesh',openingHmr:1200,closingHmr:1206.5,hours:6.5,tripsPerHour:6.46,breakdownHours:0,bookNo:'ELB-2'}],others:[{assetId:'7',door:'D-07',equipmentName:'Dozer',status:'maintenance',statusLabel:'Maintenance',trips:0,hours:0,remark:'Service due'}],totals:{machines:2,trips:42,hours:6.5,working:1,down:1,idle:0}};
 h.reset();tree=VlbBatchReport({batch:{...batch,machineReport,statuses},ReportSection});
 assert.equal(nodes(tree,n=>n.type===ReportSection).length,1);const machine=nodes(tree,n=>n.type===MachineReport)[0];assert.equal(machine.props.report,machineReport);
 const html=renderToStaticMarkup(tree);
 assert.match(html,/Machine-wise shift report/);
 assert.match(html,/<td>VPC-019<\/td><td>Excavator<\/td><td>42<\/td><td>5<\/td><td>Ramesh<\/td><td>1200<\/td><td>1206.5<\/td><td>6.5<\/td><td>6.46<\/td><td>0<\/td><td>Working<\/td><td>ELB-2<\/td>/);
 assert.match(html,/Other equipment/);assert.match(html,/<td>D-07<\/td><td>Dozer<\/td><td colSpan="5">Maintenance<\/td><td>0<\/td>/);assert.match(html,/Service due/);
 assert.match(html,/Totals · 2 machines<\/th><th>42<\/th>/);assert.match(html,/Fleet summary: 2 machines · 1 working · 1 down · 0 idle/);
});

test('View report keeps the unbatched action beside stages and shows entry options only while VLB is open',async()=>{
 const h=hooks(),calls=[];
 const batch={id:'selected-batch',name:'Jayant batch',site:'Jayant OC',report_date:'2026-11-03',shift:'S1',records:[{data:{}},{data:{scanCardId:'scan',scanEntrySource:'scan'}},{data:{scanCardId:'upload',scanEntrySource:'upload'}}],twoStage:true,stage:'vlb_open',closed_at:null};
 const browser={location:{href:'https://example.test/?page=vlb-create-batch'},history:{replaceState(_state,_unused,path){browser.location.href=new URL(path,browser.location.href).href}}};
 const fetch=async url=>{calls.push(url);return {ok:true,json:async()=>batch}};
 const Report=()=>null;
 const {VlbCreateBatch}=await compile('vlb-create-batch.jsx',{React,SmartSelect:'select',useState:h.useState,useRef:h.useRef,useEffect:()=>{},fetch,canonicalSiteName,displaySiteName,bookShiftCode,systemBookDate,vlbRecordSource,vlbRecordEntryType,VlbBatchCardDetails:()=>null,VlbBatchReport:Report,VlbBatchGovernance:()=>null,VlbReopenDialog:()=>null,VlbFleetStepper:()=>null,VlbBatchHolds:()=>null,NewEquipmentRequest:()=>null,window:browser},['VlbCreateBatch']);
 const entered=[];
 const render=()=>{h.reset();return VlbCreateBatch({session:{token:'test'},onExit(){},onManual:value=>entered.push(['manual',value.id]),onScan:value=>{entered.push(['scan',value.id]);browser.location.href='https://example.test/?page=trip-scan'}})};
 render();h.slots[0]={sites:['Jayant OC'],shifts:[]};h.slots[3]=[batch];h.slots[8]=false;h.slots[13]=true;h.slots[14]={login:'alice',mis:true};
 let tree=render();assert.equal(nodes(tree,n=>n.props['aria-label']==='Batch entry options').length,0);
 await button(tree,'View report').props.onClick();tree=render();
 assert.deepEqual(calls,['/api/vlb-batches/selected-batch']);
 for(const selected of [batch,{...batch,stage:'elb_open'},{...batch,stage:'closed',closed_at:'2026-11-03T12:00:00Z'}]){
  h.slots[5]=selected;tree=render();
  const entryOptions=nodes(tree,n=>n.props['aria-label']==='Batch entry options');
  assert.equal(entryOptions.length,selected.stage==='vlb_open'?1:0);
  for(const label of ['Manual','Scan','PDF'])assert.equal(Boolean(button(tree,label)),selected.stage==='vlb_open');
  if(selected.stage==='vlb_open'){
   assert.match(renderToStaticMarkup(entryOptions[0]),/Manual \(1\).*Scan \(1\).*PDF \(1\)/);
   button(tree,'Scan').props.onClick();tree=render();assert.equal(nodes(tree,n=>n.type===Report)[0].props.entryType,'scan');
   button(tree,'Scan').props.onClick();tree=render();assert.equal(nodes(tree,n=>n.type===Report)[0].props.entryType,'');
  }
  const toolbar=nodes(tree,n=>n.props.className==='vlb-batch-stage-toolbar')[0];
  assert.ok(toolbar);assert.ok(button(toolbar,'Show unbatched entries'));
  assert.equal(React.Children.toArray(toolbar.props.children)[0].props.stage,selected.stage);
  assert.doesNotMatch(renderToStaticMarkup(tree),/OPEN · Jayant OC · 2026-11-03 · S1/);
 }
 assert.deepEqual(entered,[]);
});

test('saved ELB buttons stay disabled after saving and unsaved machines remain selectable',async()=>{
 const h=hooks();
 const fetch=async()=>({ok:true,json:async()=>({fleet:[{...fleet[0],saved_at:'now'},fleet[1],fleet[2]]})});
 const {VlbFleetStepper}=await compile('vlb-fleet-stepper.jsx',{React,SmartSelect:'select',useState:h.useState,useEffect:()=>{},fetch,crypto:{randomUUID:()=>'key'}},['VlbFleetStepper']);
 const render=()=>{h.reset();return VlbFleetStepper({session:{token:'t'},batch:{id:'batch1',fleet,statuses},options:{employees:[]},embedded:true})};
 let tree=render();
 assert.equal(button(tree,'Saved').props.disabled,true);
 assert.equal(button(tree,'Enter ELB').props.disabled,false);
 button(tree,'Saved').props.onClick();tree=render();
 assert.match(renderToStaticMarkup(nodes(tree,n=>n.type==='tr'&&n.props['aria-selected']===true)[0]),/VPC-019/,'saved rows cannot be selected even through the handler');
 h.slots[9]={key:'batch1:19:::',loading:false,data:{breakdownHours:0,breakdowns:[]},error:''};tree=render();
 await button(tree,'Next').props.onClick();tree=render();
 const savedButtons=nodes(tree,n=>n.type==='button'&&n.props.children==='Saved');
 assert.equal(savedButtons.length,2);
 assert.ok(savedButtons.every(n=>n.props.disabled));
 assert.match(renderToStaticMarkup(nodes(tree,n=>n.type==='tr'&&n.props['aria-selected']===true)[0]),/G-08/,'save advances to the next unsaved machine');
});


test('admins can open saved ELBs, edit prefilled values and save the current revision',async()=>{
 const h=hooks(),calls=[];
 const savedFleet=fleet.map(item=>item.assetId==='7'?{...item,logbook_revision:4,logbook:{openingHmr:100,closingHmr:104,statusReason:'Original'}}:item);
 const fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({fleet:savedFleet})}};
 const {VlbFleetStepper}=await compile('vlb-fleet-stepper.jsx',{React,SmartSelect:'select',useState:h.useState,useEffect:()=>{},fetch,crypto:{randomUUID:()=>'key'}},['VlbFleetStepper']);
 const render=()=>{h.reset();return VlbFleetStepper({session:{token:'t'},batch:{id:'batch1',fleet:savedFleet,statuses,canEditSavedFleet:true},options:{employees:[]},embedded:true})};
 let tree=render();assert.equal(button(tree,'Edit').props.disabled,false);button(tree,'Edit').props.onClick();tree=render();
 const remark=nodes(tree,n=>n.type==='input'&&n.props.value==='Original')[0];assert.ok(remark,'saved data pre-fills the editor');remark.props.onChange({target:{value:'Corrected'}});
 h.slots[9]={key:'batch1:7:::',loading:false,data:{breakdownHours:0,breakdowns:[]},error:''};tree=render();
 assert.equal(button(tree,'Skip').props.disabled,true);
 await button(tree,'Save changes').props.onClick();
 assert.equal(calls[0].url,'/api/vlb-batches/batch1/fleet/7');assert.equal(calls[0].body.revision,4);assert.equal(calls[0].body.statusReason,'Corrected');
});

test('ELB machine controls share filtered and sorted rows with print and export, and select the correct machine',async()=>{
 const h=hooks();
 const ExportMenu=()=>null;
 const {VlbFleetStepper}=await compile('vlb-fleet-stepper.jsx',{React,SmartSelect:'select',useState:h.useState,useEffect:()=>{}},['VlbFleetStepper']);
 const batch={id:'batch1',name:'B10',fleet,statuses};
 const render=()=>{h.reset();return VlbFleetStepper({session:{token:'t'},batch,embedded:true,ExportMenu})};
 const change=(control,value)=>control.props.onChange({target:{value}});
 const list=tree=>nodes(tree,node=>node.props.className?.split(' ').includes('vlb-fleet-machine-list'))[0];
 const rowKeys=tree=>nodes(list(tree),node=>node.type==='tr'&&node.key!=null).map(node=>node.key);
 const search=tree=>nodes(list(tree),node=>node.type==='input'&&node.props.type==='search')[0];
 const select=(tree,index)=>nodes(list(tree),node=>node.type==='select')[index];
 let tree=render();
 change(select(tree,1),'trips:asc');tree=render();
 assert.deepEqual(rowKeys(tree),['7','8','19']);
 change(select(tree,0),'Not saved');tree=render();
 assert.deepEqual(rowKeys(tree),['8','19']);
 const menus=nodes(tree,node=>node.type===ExportMenu);
 assert.equal(menus.length,2);
 assert.equal(menus[0].props.printOnly,true);
 for(const menu of menus){
  assert.deepEqual(menu.props.rows.map(item=>item.assetId),['8','19']);
  assert.match(menu.props.title,/B10/);
 }
 button(list(tree),'Enter ELB').props.onClick();tree=render();
 assert.equal(nodes(list(tree),node=>node.props['aria-selected']===true)[0].key,'8');
 change(search(tree),'vpc019 excavator');tree=render();
 assert.deepEqual(rowKeys(tree),['19']);
 change(search(tree),'no matching machine');tree=render();
 assert.match(renderToStaticMarkup(list(tree)),/No machines match/);
 assert.equal(nodes(tree,node=>node.type===ExportMenu).length,0);
 button(list(tree),'Reset view').props.onClick();
 assert.deepEqual(rowKeys(render()),['19','7','8']);
});

test('machine report headers toggle numeric sorting and keep missing values last within equipment groups',async()=>{
 const h=hooks();
 const {MachineReport}=await compile('vlb-batch-report.jsx',{React,useState:h.useState,vlbRecordSource},['MachineReport']);
 const report={loaders:[{assetId:'a',door:'V10',trips:10},{assetId:'b',door:'V2',trips:2},{assetId:'c',door:'V3',trips:null}],others:[{assetId:'d',door:'D10'},{assetId:'e',door:'D2'}],totals:{trips:12}};
 const render=()=>{h.reset();return MachineReport({report})};
 const doors=tree=>nodes(tree,n=>n.type==='tr'&&n.key!=null).map(n=>React.Children.toArray(n.props.children)[0].props.children);
 let tree=render();assert.equal(nodes(tree,n=>n.type==='th'&&n.props['aria-sort']).length,12);
 button(tree,'Trips').props.onClick();tree=render();assert.deepEqual(doors(tree),['V2','V10','V3','D10','D2']);assert.equal(nodes(tree,n=>n.type==='th'&&n.props['aria-sort']==='ascending').length,1);
 button(tree,'Trips').props.onClick();tree=render();assert.deepEqual(doors(tree),['V10','V2','V3','D10','D2']);
 button(tree,'Door').props.onClick();tree=render();assert.deepEqual(doors(tree),['V2','V3','V10','D2','D10']);assert.equal(report.loaders[0].door,'V10');assert.match(renderToStaticMarkup(tree),/Totals · 5 machines/);
});
