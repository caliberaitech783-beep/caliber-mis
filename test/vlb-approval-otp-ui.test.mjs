import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {displaySiteName} from '../region-scope.mjs';
import {formatDisplayDateTime} from '../date-time-format.mjs';

async function compile(file,scope,names){
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function').replaceAll('export function','function').replaceAll('export const','const');
 const {code}=await transformWithOxc(source,file,{jsx:{runtime:'classic'}});
 return new Function(...Object.keys(scope),code+';return {'+names.join(',')+'}')(...Object.values(scope));
}
const hooks=()=>{const slots=[];let cursor=0;const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value]};return {slots,useState,useRef:value=>useState(()=>({current:value}))[0],useEffect:()=>{},reset:()=>{cursor=0}}};
const otpCountdown=(expiresAt,now=Date.now())=>{const remaining=Math.floor((new Date(expiresAt).getTime()-now)/1000);return remaining<=0?'expired':`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')} left`};
const otpSentText=otp=>`OTP sent to ${otp.sentTo.length} PMs via Telegram`;
const session={token:'t'};
const batch={id:'b1',name:'CMLL/SASTI OC/30TH -DEC-26/S1/B01',site:'sasti oc',closed_at:null,closure_revision:1,requests:[],approvalOtps:[],canRequestReopen:true,canReopen:false};

test('the approval OTP panel offers the request first, then the code entry with countdown and resend',async()=>{
 const h=hooks();
 const {ApprovalOtpPanel,VlbUnlockOtpDialog}=await compile('vlb-approval-otp.jsx',{React,useState:h.useState,useEffect:h.useEffect,useRef:h.useRef,displaySiteName,otpCountdown,otpSentText},['ApprovalOtpPanel','VlbUnlockOtpDialog']);
 h.reset();let html=renderToStaticMarkup(React.createElement(ApprovalOtpPanel,{session,batch,purpose:'unlock_vlb',reason:'Wrong tipper on card 12',requestLabel:'Request unlock OTP'}));
 assert.match(html,/Request unlock OTP/);assert.match(html,/approve by phone/);assert.match(html,/Sasti OC/);assert.doesNotMatch(html,/Verify OTP/);
 const live={id:'o1',purpose:'unlock_vlb',status:'sent',sentTo:['pm','pm2'],channels:['telegram'],expiresAt:new Date(Date.now()+9*60000).toISOString(),reason:'Wrong tipper on card 12'};
 const h2=hooks();const mod=await compile('vlb-approval-otp.jsx',{React,useState:h2.useState,useEffect:h2.useEffect,useRef:h2.useRef,displaySiteName,otpCountdown,otpSentText},['ApprovalOtpPanel','VlbUnlockOtpDialog']);
 html=renderToStaticMarkup(React.createElement(mod.ApprovalOtpPanel,{session,batch:{...batch,approvalOtps:[live]},purpose:'unlock_vlb',reason:'x'}));
 assert.match(html,/OTP sent to 2 PMs via Telegram/);assert.match(html,/left\. Phone the PM/);assert.match(html,/aria-label="Unlock VLB OTP"/);assert.match(html,/Verify OTP/);assert.match(html,/Resend/);assert.doesNotMatch(html,/Request unlock OTP/);
 const h3=hooks();const dlg=await compile('vlb-approval-otp.jsx',{React,useState:h3.useState,useEffect:h3.useEffect,useRef:h3.useRef,displaySiteName,otpCountdown,otpSentText},['VlbUnlockOtpDialog']);
 html=renderToStaticMarkup(React.createElement(dlg.VlbUnlockOtpDialog,{session,batch:{...batch,approvalOtps:[live]},onChanged(){},onDismiss(){}}));
 assert.match(html,/Unlock VLB with PM approval/);assert.match(html,/Reason sent to the PM: Wrong tipper on card 12/);assert.doesNotMatch(html,/<textarea/,'no second reason box while a code is live');
});

test('the reopen dialog offers the PM OTP next to the on-screen request and while the request is pending',async()=>{
 const h=hooks();
 const ApprovalOtpPanel=props=>React.createElement('div',{className:'otp-panel'},props.requestLabel+':'+props.reason+':'+(props.disabled?'disabled':'enabled'));
 const {VlbReopenDialog}=await compile('vlb-reopen-dialog.jsx',{React,useState:h.useState,useEffect:h.useEffect,useRef:h.useRef,displaySiteName,formatDisplayDateTime,ApprovalOtpPanel},['VlbReopenDialog']);
 const closed={...batch,closed_at:'2026-12-30T10:00:00Z',pmApprovalTrial:{active:false}};
 h.reset();let html=renderToStaticMarkup(React.createElement(VlbReopenDialog,{session,batch:closed,actor:{login:'alice'},onChanged(){},onDismiss(){}}));
 assert.match(html,/Request PM approval/);assert.match(html,/Request reopen OTP::disabled/,'OTP needs the reason first');
 const pending={...closed,requests:[{id:'r1',requested_by:'alice',closure_revision:1,status:'pending',reason:'Late scan card received'}]};
 const h2=hooks();const mod=await compile('vlb-reopen-dialog.jsx',{React,useState:h2.useState,useEffect:h2.useEffect,useRef:h2.useRef,displaySiteName,formatDisplayDateTime,ApprovalOtpPanel},['VlbReopenDialog']);
 html=renderToStaticMarkup(React.createElement(mod.VlbReopenDialog,{session,batch:pending,actor:{login:'alice'},onChanged(){},onDismiss(){}}));
 assert.match(html,/Awaiting PM approval/);assert.match(html,/Request reopen OTP:Late scan card received:enabled/,'the pending request can still be completed by OTP');
 const trial={...pending,pmApprovalTrial:{active:true,endsAt:'2026-12-31T10:00:00Z'},canReopen:true};
 const h3=hooks();const mod3=await compile('vlb-reopen-dialog.jsx',{React,useState:h3.useState,useEffect:h3.useEffect,useRef:h3.useRef,displaySiteName,formatDisplayDateTime,ApprovalOtpPanel},['VlbReopenDialog']);
 html=renderToStaticMarkup(React.createElement(mod3.VlbReopenDialog,{session,batch:trial,actor:{login:'alice'},onChanged(){},onDismiss(){}}));
 assert.doesNotMatch(html,/otp-panel/,'no OTP during the trial');
});
