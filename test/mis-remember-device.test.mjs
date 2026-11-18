import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {createServer} from 'node:http';import {PGlite} from '@electric-sql/pglite';
import {browserSessionMiddleware,SESSION_COOKIE,CSRF_COOKIE,REMEMBER_COOKIE,REMEMBER_DEVICE_MS} from '../server/middleware/browser-session-security.mjs';
import {installMisLoginHandoff} from '../server/routes/mis-login-handoff.mjs';
import {readFileSync} from 'node:fs';
import {createPulseSignInBridge} from '../server/services/pulse-signin-bridge.mjs';

// "Remember me" on the Pulse MIS sign-in page keeps MIS signed in after the browser
// (or the Claude app's browser pane) restarts; without it the cookies end with the browser.
async function harness(t,remember){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE auth_sessions(token UUID PRIMARY KEY,login_name TEXT,permissions JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE mis_credential_sessions(session_token UUID PRIMARY KEY REFERENCES auth_sessions(token) ON DELETE CASCADE,grant_token TEXT NOT NULL,remembered BOOLEAN NOT NULL DEFAULT false);`);
 const sessionStore={create:async s=>db.query('INSERT INTO auth_sessions(token,login_name,permissions) VALUES($1,$2,$3)',[s.token,s.login,JSON.stringify(s.permissions)]),get:async token=>(await db.query('SELECT login_name AS login,permissions FROM auth_sessions WHERE token=$1',[token])).rows[0]};
 const profile={login:'owner',permissions:{separateMisCredentials:true,misDesktopAccess:['Vehicle Log Book']}};
 const app=express();app.use(express.json());app.use(browserSessionMiddleware());
 const service=installMisLoginHandoff(app,{pool:db,sessionStore,credentialClient:{validateSession:async(_token,session)=>session},
  fetcher:async()=>({ok:true,json:async()=>({grant:'g'.repeat(43),profile,...(remember===undefined?{}:{remember})})})});
 await service.initialize();
 // Stands in for /api/security/account, which renews the cookie each time MIS opens.
 app.get('/api/renew',(req,res)=>res.json({token:req.establishBrowserSession(String(req.headers.authorization).replace(/^Bearer /,'')),remembered:req.browserSessionRemembered}));
 app.post('/api/logout',(_req,res)=>res.status(204).end());
 const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port,jar=new Map();
 const call=async(path,{method='GET',headers={}}={})=>{
  const csrf=[...jar].find(([name])=>name.startsWith(CSRF_COOKIE+'_'))?.[1]||'';
  const response=await fetch(base+path,{method,redirect:'manual',headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'X-CSRF-Token':csrf,...headers}});
  const set=response.headers.getSetCookie();
  for(const line of set){const [pair]=line.split(';');const at=pair.indexOf('=');const name=pair.slice(0,at),value=pair.slice(at+1);if(!value||/Expires=Thu, 01 Jan 1970/i.test(line))jar.delete(name);else jar.set(name,value);}
  return {response,set,body:response.headers.get('content-type')?.includes('json')?await response.json():null};
 };
 const signIn=async()=>{
  const start=await call('/api/mis-credentials/start');const state=new URL(start.response.headers.get('location')).searchParams.get('misState');
  const callback=await call('/api/mis-credentials/callback?'+new URLSearchParams({code:'c'.repeat(43),state}));assert.equal(callback.response.status,303);
  return call('/api/mis-credentials/session?handoff='+state);
 };
 return {db,jar,call,signIn};
}
const lifetime=(set,prefix)=>set.find(line=>line.startsWith(prefix+'_'))?.match(/Max-Age=(\d+)/i)?.[1];

test('Remember me keeps MIS cookies for 30 days and renews them on each visit',async t=>{
 const {db,jar,call,signIn}=await harness(t,true);
 const session=await signIn();assert.equal(session.response.status,200);assert.match(session.body.token,/^browser-session\.[A-Za-z0-9_-]{16}$/);
 const days=String(REMEMBER_DEVICE_MS/1000);
 assert.equal(lifetime(session.set,SESSION_COOKIE),days);assert.equal(lifetime(session.set,CSRF_COOKIE),days);assert.equal(lifetime(session.set,REMEMBER_COOKIE),days);
 assert.ok(session.set.find(line=>line.startsWith(SESSION_COOKIE+'_')).includes('HttpOnly'));
 assert.equal([...jar.keys()].some(name=>name.startsWith('__Host-mis_credential_remember')),false,'the one-time hand-over mark is cleared');
 assert.equal((await db.query('SELECT remembered FROM mis_credential_sessions')).rows[0].remembered,true);
 const renewed=await call('/api/renew',{headers:{Authorization:'Bearer '+session.body.token}});
 assert.equal(renewed.body.token,session.body.token,'the same browser context is kept');
 assert.equal(session.body.rememberDevice,true);assert.equal(renewed.body.remembered,true);
 assert.equal(lifetime(renewed.set,SESSION_COOKIE),days);assert.equal(lifetime(renewed.set,REMEMBER_COOKIE),days);
 const out=await call('/api/logout',{method:'POST',headers:{Authorization:'Bearer '+session.body.token,Origin:'https://pulse-ll.cmll.in'}});
 assert.equal(out.response.status,204);assert.equal([...jar.keys()].some(name=>name.startsWith(REMEMBER_COOKIE)),false);
});

test('without Remember me (shared site PCs) the cookies still end when the browser closes',async t=>{
 for(const remember of [undefined,false,'yes']){
  const {db,call,signIn}=await harness(t,remember);
  const session=await signIn();assert.equal(session.response.status,200);
  assert.equal(lifetime(session.set,SESSION_COOKIE),undefined);assert.equal(lifetime(session.set,CSRF_COOKIE),undefined);
  assert.equal(session.set.some(line=>line.startsWith(REMEMBER_COOKIE+'_')),false);
  assert.equal((await db.query('SELECT remembered FROM mis_credential_sessions')).rows[0].remembered,false);
  const renewed=await call('/api/renew',{headers:{Authorization:'Bearer '+session.body.token}});
  assert.equal(lifetime(renewed.set,SESSION_COOKIE),undefined);
  assert.equal(session.body.rememberDevice,false);assert.equal(renewed.body.remembered,false);
 }
});

test('a remembered sign-in keeps its Pulse link for 30 days, an ordinary one for 7',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE auth_sessions(token TEXT PRIMARY KEY,login_name TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),permissions JSONB);
  CREATE TABLE mis_credential_sessions(session_token TEXT,grant_token TEXT,remembered BOOLEAN NOT NULL DEFAULT false);`);
 const access=JSON.stringify({misDesktopAccess:['Vehicle Log Book']});
 await db.query("INSERT INTO auth_sessions VALUES('plain','plain-user',NOW()-INTERVAL '10 days',$1),('kept','kept-user',NOW()-INTERVAL '20 days',$1),('old','old-user',NOW()-INTERVAL '31 days',$1)",[access]);
 await db.query("INSERT INTO mis_credential_sessions VALUES('plain','plain-grant',false),('kept','kept-grant',true),('old','old-grant',true)");
 const used=[];const bridge=createPulseSignInBridge({pool:db,fetchImpl:async(_url,options)=>{used.push(JSON.parse(options.body).grant);return Response.json([]);}});
 await bridge.request('requests',{},'kept-user');assert.deepEqual(used,['kept-grant']);
 await assert.rejects(()=>bridge.request('requests',{},'plain-user'),error=>error.status===401);
 await assert.rejects(()=>bridge.request('requests',{},'old-user'),error=>error.status===401);
});

test('the page keeps a remembered sign-in on the device and any other in the tab',async()=>{
 // The .jsx module imports CSS, so take the plain function text out of it.
 const source=readFileSync(new URL('../src/account-security.jsx',import.meta.url),'utf8');
 const start=source.indexOf('export function storeBrowserSession'),end=source.indexOf('\n}',start)+2;
 assert.ok(start>=0&&end>start);
 const store=new Function('return '+source.slice(start,end).replace('export ',''))();
 const storage=()=>{const m=new Map();return {m,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
 const local=storage(),tab=storage();
 store({token:'browser-session.abcdefghijklmnop',rememberDevice:true},{local,tab});
 assert.ok(local.m.has('nerveCenterSession'));assert.equal(tab.m.has('nerveCenterSession'),false);
 store({token:'browser-session.abcdefghijklmnop'},{local,tab});
 assert.equal(local.m.has('nerveCenterSession'),false,'an ordinary sign-in leaves nothing on the device');assert.ok(tab.m.has('nerveCenterSession'));
});
