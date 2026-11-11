import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc} from 'vite';

const hookSource=readFileSync(new URL('../src/mis-shared-signin.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export function','function');
const {code:hookCode}=await transformWithOxc(hookSource,'shared-signin.jsx',{jsx:{runtime:'classic'}});
async function runHook(search,session=null){
  const requests=[],redirects=[],events=[],effects=[];
  const scope={React,useState:initial=>[initial,()=>{}],useEffect:effect=>effects.push(effect),
    fetch:async url=>{requests.push(url);return {ok:true,json:async()=>url.endsWith('/config')?{mode:'client'}:{token:'synthetic-mis-session'}};},
    window:{location:{search,replace:url=>redirects.push(url)},history:{replaceState:()=>{}},dispatchEvent:event=>events.push(event)},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}};
  const hook=new Function(...Object.keys(scope),`${hookCode};return useMisSharedSignIn;`)(...Object.values(scope));
  hook(session,{autoStart:true});effects[0]();await new Promise(resolve=>setImmediate(resolve));
  return {requests,redirects,events};
}

test('opening MIS with an existing Pulse session automatically starts the shared Pulse session handoff',async()=>{
  const result=await runHook('');
  assert.deepEqual(result.requests,['/api/mis-sso/config']);
  assert.deepEqual(result.redirects,['/api/mis-credentials/start']);assert.deepEqual(result.events,[]);
});

test('only a completed shared-sign-in callback exchanges the server-held handoff',async()=>{
  const result=await runHook('?misSsoReady=1');
  assert.deepEqual(result.requests,['/api/mis-sso/config','/api/mis-sso/session']);
  assert.equal(result.events[0].type,'mis-shared-signin');
  assert.deepEqual(result.redirects,[]);
});

test('refreshing MIS restores the saved session instead of signing the user out',async()=>{
  const entry=readFileSync(new URL('../src/mis-entry.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/enableCalendarFieldClicks\(document\);[\s\S]*$/,'');
  const {code}=await transformWithOxc(entry,'mis-entry.jsx',{jsx:{runtime:'classic'}});
  const Login=()=>null,Workspace=()=>null;
  let options,receivedSession;
  const saved={token:'old-synthetic-session'};
  const scope={React,useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect:()=>{},
    useMisSharedSignIn:(session,settings)=>{receivedSession=session;options=settings;return {error:''};},MisSharedLogin:Login,MisWorkspace:Workspace,
    sessionStorage:{getItem:()=>JSON.stringify(saved),setItem:()=>{},removeItem:()=>{}},localStorage:{getItem:()=>null,removeItem:()=>{}}};
  const App=new Function(...Object.keys(scope),`${code};return MisApp;`)(...Object.values(scope));
  assert.equal(App().type,Workspace);assert.deepEqual(receivedSession,saved);assert.equal(options.autoStart,true);
});


test('a completed tab-scoped credential handoff requests only its own ready cookie',async()=>{
 const handoff='a'.repeat(43);
 const result=await runHook('?misCredentialReady='+handoff);
 assert.deepEqual(result.requests,['/api/mis-sso/config','/api/mis-credentials/session?handoff='+handoff]);
 assert.equal(result.events[0].type,'mis-shared-signin');
 assert.deepEqual(result.redirects,[]);
});

test('an explicit MIS handoff completes even when a copied tab already has a session marker',async()=>{const result=await runHook('?misCredentialReady='+('a'.repeat(43)),{token:'browser-session.AAAAAAAAAAAAAAAA'});assert.ok(result.requests.some(url=>url.startsWith('/api/mis-credentials/session')));assert.equal(result.events[0]?.type,'mis-shared-signin');assert.deepEqual(result.redirects,[]);});

test('a failed sign-in mode read during a restart is retried and never opens the old password form',async()=>{
  const requests=[],redirects=[],effects=[],statuses=[];let calls=0;
  const scope={React,useState:initial=>{statuses.push(initial);return [initial,value=>statuses.push(typeof value==='function'?value(statuses.at(-1)):value)];},useEffect:effect=>effects.push(effect),
    fetch:async url=>{requests.push(url);if(++calls===1)return {ok:false,status:503,json:async()=>({})};return {ok:true,json:async()=>({mode:'client'})};},
    setTimeout:run=>setImmediate(run),
    window:{location:{search:'',replace:url=>redirects.push(url)},history:{replaceState:()=>{}},dispatchEvent:()=>{}},CustomEvent:class{}};
  const hook=new Function(...Object.keys(scope),`${hookCode};return useMisSharedSignIn;`)(...Object.values(scope));
  const initial=hook(null,{autoStart:true});effects[0]();
  for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(initial.mode,'checking');
  assert.deepEqual(requests,['/api/mis-sso/config','/api/mis-sso/config']);
  assert.ok(!statuses.some(status=>status.mode==='off'));
  assert.equal(statuses.at(-1).mode,'client');
  assert.deepEqual(redirects,['/api/mis-credentials/start']);
});

test('the main app shows the old password form only when the server says shared sign-in is off, and that form hands over to Pulse when refused',()=>{
  const app=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
  assert.match(app,/sharedSignIn\.mode==='client'\|\|sharedSignIn\.mode==='checking'\)\) return <MisSharedLogin/);
  assert.match(app,/refusal\?\.code==='PULSE_SIGNIN_REQUIRED'\)\{window\.location\.assign\('\/api\/mis-credentials\/start'\)/);
});

async function runHandoffThroughRestart(statuses,{search='?misCredentialReady='+('a'.repeat(43))}={}){
  const requests=[],redirects=[],events=[],effects=[],states=[];let sessionCalls=0;
  const scope={React,useState:initial=>[initial,value=>states.push(typeof value==='function'?value(states.at(-1)||initial):value)],useEffect:effect=>effects.push(effect),
    fetch:async url=>{requests.push(url);
      if(url.endsWith('/config'))return {ok:true,status:200,json:async()=>({mode:'client'})};
      const status=statuses[sessionCalls++]??200;
      if(status==='network')throw new TypeError('Failed to fetch');
      return {ok:status===200,status,json:async()=>{if(status!==200)throw SyntaxError('Unexpected token <');return {token:'synthetic-mis-session'};}};},
    setTimeout:run=>setImmediate(run),
    window:{location:{search,replace:url=>redirects.push(url)},history:{replaceState:()=>{}},dispatchEvent:event=>events.push(event)},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}};
  const hook=new Function(...Object.keys(scope),`${hookCode};return useMisSharedSignIn;`)(...Object.values(scope));
  hook(null,{autoStart:true});effects[0]();
  for(let i=0;i<30;i++)await new Promise(resolve=>setImmediate(resolve));
  return {requests,redirects,events,states,sessionCalls};
}

test('a Pulse hand-over that meets a restarting MIS (503, 502, dropped connection) waits and completes sign-in',async()=>{
  const result=await runHandoffThroughRestart([503,502,'network',504]);
  assert.equal(result.requests.filter(url=>url.startsWith('/api/mis-credentials/session')).length,5);
  assert.equal(result.events[0]?.type,'mis-shared-signin');
  assert.ok(result.states.some(state=>/restarting/.test(state?.error||'')));
  assert.deepEqual(result.redirects,[]);
});

test('a real refusal from MIS is not repeated and is shown to the user',async()=>{
  const result=await runHandoffThroughRestart([401]);
  assert.equal(result.requests.filter(url=>url.startsWith('/api/mis-credentials/session')).length,1);
  assert.deepEqual(result.events,[]);
  assert.match(result.states.at(-1)?.error||'',/Pulse could not complete MIS sign-in/);
});

test('waiting for a restart stops within the 60-second life of the hand-over cookie',()=>{
  const delays=hookSource.match(/delays=\[([0-9,]+)\]/)[1].split(',').map(Number);
  assert.ok(delays.reduce((a,b)=>a+b,0)<=50000);
});
