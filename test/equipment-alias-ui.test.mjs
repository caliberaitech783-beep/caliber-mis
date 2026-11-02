import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {aliasForSelection} from '../equipment-alias-rules.mjs';
import {formatDisplayDateTime} from '../date-time-format.mjs';
import {canonicalSiteName} from '../site-location.mjs';
import {searchSiteDoors,doorLabel} from '../src/door-search.mjs';
import {nextMismatchPair,mismatchPairCount} from '../src/scan-alias-mismatch.mjs';

async function compile(file,scope,names){
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function').replaceAll('export const','const');
 const {code}=await transformWithOxc(source,file,{jsx:{runtime:'classic'}});
 return new Function(...Object.keys(scope),code+';return {'+names.join(',')+'}')(...Object.values(scope));
}
const hooks=()=>{const slots=[];let cursor=0;const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};return {slots,useState,useRef:value=>useState(()=>({current:value}))[0],useEffect(){},useMemo:(fn)=>fn(),reset(){cursor=0}}};
const otpCountdown=(expiresAt,now=Date.now())=>{const remaining=Math.floor((new Date(expiresAt).getTime()-now)/1000);return remaining<=0?'expired':`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')} left`};
const otpSentText=otp=>`OTP sent to ${otp.sentTo.length} PMs via WhatsApp`;
const session={token:'t'};
const data={site:'Dudhichua East OB',kind:'vehicle',otpEnabled:true,batchName:'VLB-DCHE-0111-A',context:{bookDate:'2026-11-01',location:'Dudhichua East OB',cardShift:'I'},categories:[
 {id:'tipper',label:'Tippers (trip card header)',kind:'vehicle',left:[{id:'3',door:'DEMO732-00211',name:'Volvo',number:732}],right:[{key:'V732',written:'V 732',machine:'Volvo · No. 732',rows:3,cards:3,suggestions:['3'],alias:null}]},
 {id:'body',label:'Trip body equipment',kind:'equipment',left:[{id:'1',door:'DEMO21-00179',name:'',number:21}],right:[{key:'LPC21',written:'L21',machine:'LPC · No. 21',rows:9,cards:4,suggestions:['1'],alias:null}]}]};

test('pairs run in order and skipping advances to the next pair or category',()=>{
 assert.equal(mismatchPairCount(data),2);
 assert.deepEqual(nextMismatchPair(data).pair.key,'V732');
 assert.equal(nextMismatchPair(data,new Set(['tipper:V732'])).pair.key,'LPC21');
 assert.equal(nextMismatchPair(data,new Set(),new Set(['tipper'])).category.id,'body');
 assert.equal(nextMismatchPair(data,new Set(['tipper:V732','body:LPC21'])),null);
});

test('the mismatch box shows one pair at a time with the two columns, the suggestion and the pair line',async()=>{
 const h=hooks();
 const EquipmentAliasOtpPanel=props=>React.createElement('div',{className:'otp-panel'},'OTP for '+props.alias.writtenText);
 const {ScanAliasMismatchDialog}=await compile('scan-alias-mismatch-dialog.jsx',{React,useState:h.useState,useEffect:h.useEffect,useRef:h.useRef,useMemo:h.useMemo,EquipmentAliasOtpPanel,nextMismatchPair,mismatchPairCount},['ScanAliasMismatchDialog']);
 const html=renderToStaticMarkup(React.createElement(ScanAliasMismatchDialog,{session,batchLabel:'DCH (East) · 01-11-2026 · Shift I',data,busy:false,error:'',approver:{login:'nitish'},approverTelegramLinked:true,skippedPairs:new Set(),skippedCategories:new Set(),onPair(){},onSkipPair(){},onSkipCategory(){},onClose(){},onRefresh(){}}));
 assert.match(html,/Equipment mismatch · trip cards vs Pulse/);assert.match(html,/Category 1 of 2 · Tippers \(trip card header\) · 1 pair\(s\) pending · 2 in all/);
 assert.match(html,/Pulse tippers at this site, not found on any card/);assert.match(html,/DEMO732-00211/);assert.match(html,/suggested by number/);
 assert.match(html,/Card tippers not found in Pulse/);assert.match(html,/V 732<\/strong> read as Volvo · No\. 732 · 3 row\(s\) on 3 card\(s\)/);
 assert.doesNotMatch(html,/L21/,'only one pair on screen');assert.match(html,/Pair and continue to OTP/);assert.match(html,/Skip this pair/);assert.match(html,/Skip category/);
 const h2=hooks();const pending={...data,categories:[{...data.categories[0],right:[{...data.categories[0].right[0],alias:{id:'a1',status:'pending',writtenText:'V 732',otps:[]}}]},data.categories[1]]};
 const mod=await compile('scan-alias-mismatch-dialog.jsx',{React,useState:h2.useState,useEffect:h2.useEffect,useRef:h2.useRef,useMemo:h2.useMemo,EquipmentAliasOtpPanel,nextMismatchPair,mismatchPairCount},['ScanAliasMismatchDialog']);
 const resumed=renderToStaticMarkup(React.createElement(mod.ScanAliasMismatchDialog,{session,batchLabel:'x',data:pending,busy:false,error:'',approver:null,approverTelegramLinked:true,skippedPairs:new Set(),skippedCategories:new Set(),onPair(){},onSkipPair(){},onSkipCategory(){},onClose(){},onRefresh(){}}));
 assert.match(resumed,/OTP for V 732/,'a pending pair resumes at its OTP step');assert.doesNotMatch(resumed,/Pair and continue to OTP/);
 const h3=hooks();const empty=await compile('scan-alias-mismatch-dialog.jsx',{React,useState:h3.useState,useEffect:h3.useEffect,useRef:h3.useRef,useMemo:h3.useMemo,EquipmentAliasOtpPanel,nextMismatchPair,mismatchPairCount},['ScanAliasMismatchDialog']);
 const done=renderToStaticMarkup(React.createElement(empty.ScanAliasMismatchDialog,{session,batchLabel:'x',data:{...data,categories:data.categories.map(c=>({...c,right:[]}))},busy:false,error:'',skippedPairs:new Set(),skippedCategories:new Set(),onPair(){},onSkipPair(){},onSkipCategory(){},onClose(){},onRefresh(){}}));
 assert.match(done,/All written machines in this batch match Pulse/);assert.match(done,/Start card review/);
});

test('the OTP panel always offers the approver route and the emergency route, and reports an unlinked approver',async()=>{
 const h=hooks();
 const {EquipmentAliasOtpPanel}=await compile('equipment-alias-otp-panel.jsx',{React,useState:h.useState,useEffect:h.useEffect,otpCountdown,otpSentText},['EquipmentAliasOtpPanel']);
 const alias={id:'a1',status:'pending',writtenText:'L21',otps:[]};
 let html=renderToStaticMarkup(React.createElement(EquipmentAliasOtpPanel,{session,alias,approver:{login:'nitish'},approverTelegramLinked:true}));
 assert.match(html,/Send OTP to NITISH/);assert.match(html,/Emergency OTP to site PM…/);assert.match(html,/only permanence waits/);assert.doesNotMatch(html,/<input type="text" inputMode="numeric"/);
 const h2=hooks();const mod=await compile('equipment-alias-otp-panel.jsx',{React,useState:h2.useState,useEffect:h2.useEffect,otpCountdown,otpSentText},['EquipmentAliasOtpPanel']);
 html=renderToStaticMarkup(React.createElement(mod.EquipmentAliasOtpPanel,{session,alias,approver:{login:'nitish'},approverTelegramLinked:false}));
 assert.match(html,/NITISH has not linked Telegram/);assert.match(html,/disabled=""[^>]*>Send OTP to NITISH/);assert.match(html,/Emergency OTP to site PM…/);
 const h3=hooks();const live=await compile('equipment-alias-otp-panel.jsx',{React,useState:h3.useState,useEffect:h3.useEffect,otpCountdown,otpSentText},['EquipmentAliasOtpPanel']);
 html=renderToStaticMarkup(React.createElement(live.EquipmentAliasOtpPanel,{session,alias:{...alias,otps:[{id:'o1',purpose:'map_equipment',route:'nitish',status:'sent',sentTo:['nitish'],channels:['telegram'],expiresAt:new Date(Date.now()+9*60000).toISOString()}]},approver:{login:'nitish'},approverTelegramLinked:true}));
 assert.match(html,/OTP sent to NITISH by Telegram · (?:8:[0-5]\d|9:00) left/);assert.match(html,/aria-label="Equipment mapping OTP"/);assert.match(html,/Resend to NITISH/);assert.match(html,/Emergency OTP to site PM…/,'the emergency route stays visible while a code is live');
});

test('manual entry pairs a typed machine with a Pulse record at the site',async()=>{
 const h=hooks();
 const EquipmentAliasOtpPanel=()=>React.createElement('div',null,'otp');
 const aliasApi=()=>async()=>({});
 const {ManualAliasDialog}=await compile('manual-alias-dialog.jsx',{React,useState:h.useState,useEffect:h.useEffect,useRef:h.useRef,EquipmentAliasOtpPanel,aliasApi,aliasForSelection,searchSiteDoors,doorLabel,canonicalSiteName},['ManualAliasDialog']);
 const assets=[{id:'1',door:'DEMO21-00179',name:'DEMO21-00179',kind:'equipment',site:'Dudhichua East OB'},{id:'2',door:'VPC131',kind:'equipment',site:'Dudhichua East OB'},{id:'9',door:'LPC 21',kind:'equipment',site:'Jayant OC'}];
 const html=renderToStaticMarkup(React.createElement(ManualAliasDialog,{session,kind:'equipment',written:'L21',site:'Dudhichua East OB',assets,otpEnabled:true,onPaired(){},onDismiss(){}}));
 assert.match(html,/Written machine not in Pulse/);assert.match(html,/<strong>L21<\/strong> is not a door of any machine at Dudhichua East OB/);
 assert.match(html,/DEMO21-00179<\/strong><em> suggested by number/);assert.doesNotMatch(html,/LPC 21/,'other sites stay out');assert.match(html,/Pair and continue to OTP/);
});

test('the Equipment master ALIAS cell lists live aliases with status and the revoke control',async()=>{
 const {EquipmentAliasCell,aliasHover}=await compile('equipment-alias-admin.jsx',{React,useState(){},useEffect(){},useRef(){},EquipmentAliasOtpPanel(){},aliasApi(){},formatDisplayDateTime},['EquipmentAliasCell','aliasHover']);
 const aliases=[{id:'a1',equipmentId:'1',writtenText:'L21',status:'active',approvalRoute:'nitish',approvedBy:'nitish',approvedAt:'2026-11-02T10:00:00Z'},{id:'a2',equipmentId:'1',writtenText:'HL21',status:'pending',createdAt:'2026-11-02T10:00:00Z'},{id:'a3',equipmentId:'2',writtenText:'X',status:'revoked'}];
 const html=renderToStaticMarkup(React.createElement('table',null,React.createElement('tbody',null,React.createElement('tr',null,React.createElement(EquipmentAliasCell,{aliases,record:{id:'1'},canRevoke:true,onRevoke(){}})))));
 assert.match(html,/L21/);assert.match(html,/HL21 \(Pending approval\)/);assert.doesNotMatch(html,/>X</);assert.match(html,/aria-label="Revoke alias L21"/);
 assert.match(aliasHover(aliases[0]),/Active · approved by the mapping approver · by nitish/);
});
