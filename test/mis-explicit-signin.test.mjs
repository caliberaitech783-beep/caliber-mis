import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformWithOxc} from 'vite';

const hookSource=readFileSync(new URL('../src/mis-shared-signin.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export function','function');
const {code:hookCode}=await transformWithOxc(hookSource,'shared-signin.jsx',{jsx:{runtime:'classic'}});
async function runHook(search){
  const requests=[],redirects=[],events=[],effects=[];
  const scope={React,useState:initial=>[initial,()=>{}],useEffect:effect=>effects.push(effect),
    fetch:async url=>{requests.push(url);return {ok:true,json:async()=>url.endsWith('/config')?{mode:'client'}:{token:'synthetic-mis-session'}};},
    window:{location:{search,replace:url=>redirects.push(url)},history:{replaceState:()=>{}},dispatchEvent:event=>events.push(event)},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}};
  const hook=new Function(...Object.keys(scope),`${hookCode};return useMisSharedSignIn;`)(...Object.values(scope));
  hook(null,{autoStart:true});effects[0]();await new Promise(resolve=>setImmediate(resolve));
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

test('a fresh MIS page shows sign-in even when browser storage contains a previous session',async()=>{
  const entry=readFileSync(new URL('../src/mis-entry.jsx',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/createRoot\([\s\S]*$/,'');
  const {code}=await transformWithOxc(entry,'mis-entry.jsx',{jsx:{runtime:'classic'}});
  const Login=()=>null,Workspace=()=>null;
  let options;
  const scope={React,useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useEffect:()=>{},
    useMisSharedSignIn:(_session,settings)=>{options=settings;return {error:''};},MisSharedLogin:Login,MisWorkspace:Workspace,
    sessionStorage:{getItem:()=>JSON.stringify({token:'old-synthetic-session'})},localStorage:{getItem:()=>JSON.stringify({token:'old-synthetic-session'})}};
  const App=new Function(...Object.keys(scope),`${code};return MisApp;`)(...Object.values(scope));
  assert.equal(App().type,Login);assert.equal(options.autoStart,true);
});
