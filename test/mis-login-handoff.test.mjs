import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {installMisLoginHandoff} from '../server/routes/mis-login-handoff.mjs';
test('MIS callback requires browser state and one-time proof; session is retrieved without URL tokens',async()=>{
 const db=new PGlite();try{
 await db.exec('CREATE TABLE mis_credential_sessions(session_token UUID,grant_token TEXT)');
 const routes=new Map(),sessions=new Map(),sessionStore={create:async s=>sessions.set(s.token,s),get:async token=>sessions.get(token)};
 let exchange;
 const profile={login:'anoop',permissions:{application:'MIS',separateMisCredentials:true,sharedPulseCredentials:true}};
 const service=installMisLoginHandoff({get:(path,fn)=>routes.set(path,fn)},{pool:db,sessionStore,credentialClient:{validateSession:async(_token,session)=>session},fetcher:async(url,options)=>{exchange={url,...JSON.parse(options.body)};return {ok:true,json:async()=>({grant:'g'.repeat(43),profile})}}});await service.initialize();
 const call=async(path,query={},cookie='')=>{const result={status:200,cookies:{},body:null,url:null};const res={set(){},status(code){result.status=code;return this},json(body){result.body=body;return this},cookie(name,value,options){result.cookies[name]={value,options}},clearCookie(){},redirect(status,url){result.status=status;result.url=url}};await routes.get(path)({query,headers:{cookie}},res);return result};
 const start=await call('/api/mis-credentials/start');assert.equal(start.status,303);const target=new URL(start.url);assert.equal(target.origin,'https://pulse.cmll.in');assert.equal(target.searchParams.get('login'),'mis');const state=target.searchParams.get('misState'),cookie='__Host-mis_credential_state='+state;
 assert.equal(start.cookies.__Host_mis_credential_state,undefined);assert.equal(Object.values(start.cookies)[0].options.httpOnly,true);
 assert.equal((await call('/api/mis-credentials/callback',{state,code:'c'.repeat(43)})).status,400);
 const callback=await call('/api/mis-credentials/callback',{state,code:'c'.repeat(43)},cookie);assert.equal(callback.status,303);assert.equal(callback.url,'/?misCredentialReady='+state);assert.equal(exchange.url,'https://pulse.cmll.in/api/integrations/mis/exchange');assert.equal(exchange.state,state);assert.equal(exchange.verifier.length,43);
 assert.equal((await call('/api/mis-credentials/callback',{state,code:'c'.repeat(43)},cookie)).status,400);
 const readyName=Object.keys(callback.cookies).find(name=>name.startsWith('__Host-mis_credential_ready_'));const token=callback.cookies[readyName].value;assert.equal((await call('/api/mis-credentials/session',{handoff:state},readyName+'='+token)).body.token,token);
 assert.equal((await call('/api/mis-credentials/session')).status,401);
 }finally{await db.close()}
});


test('parallel MIS sign-ins retain separate browser state and cannot use another attempt cookie',async()=>{
 const db=new PGlite();try{
 await db.exec('CREATE TABLE mis_credential_sessions(session_token UUID,grant_token TEXT)');
 const routes=new Map(),jar=new Map(),sessions=new Map();let exchanges=0;
 const service=installMisLoginHandoff({get:(path,handler)=>routes.set(path,handler)},{pool:db,sessionStore:{create:async s=>sessions.set(s.token,s),get:async token=>sessions.get(token)},credentialClient:{validateSession:async(_token,session)=>session},fetcher:async()=>{exchanges++;return {ok:true,json:async()=>({grant:'g'.repeat(43),profile:{login:'test-user',permissions:{separateMisCredentials:true}}})}}});await service.initialize();
 const call=async(path,query={},cookies=[...jar].map(([k,v])=>k+'='+v).join('; '))=>{
  const result={status:200,set:[],cleared:[]};
  const res={set(){},status(code){result.status=code;return this},json(body){result.body=body;return this},cookie(name,value,options){jar.set(name,value);result.set.push({name,value,options})},clearCookie(name){jar.delete(name);result.cleared.push(name)},redirect(status,url){result.status=status;result.url=url}};
  await routes.get(path)({query,headers:{cookie:cookies}},res);return result;
 };
 const first=await call('/api/mis-credentials/start'),second=await call('/api/mis-credentials/start');
 const stateA=new URL(first.url).searchParams.get('misState'),stateB=new URL(second.url).searchParams.get('misState');
 assert.notEqual(first.set[0].name,second.set[0].name,'a later tab must not overwrite an earlier tab state');
 for(const attempt of [first,second]){assert.equal(attempt.set[0].options.httpOnly,true);assert.equal(attempt.set[0].options.secure,true);assert.equal(attempt.set[0].options.sameSite,'lax');}
 assert.equal((await call('/api/mis-credentials/callback',{state:stateA,code:'a'.repeat(43)},second.set[0].name+'='+stateB)).status,400);assert.equal(exchanges,0);
 const a=await call('/api/mis-credentials/callback',{state:stateA,code:'a'.repeat(43)});assert.equal(a.status,303);assert.ok(jar.has(second.set[0].name),'finishing one tab preserves the other pending tab');
 const b=await call('/api/mis-credentials/callback',{state:stateB,code:'b'.repeat(43)});assert.equal(b.status,303);assert.equal(exchanges,2);assert.equal(sessions.size,2);
 assert.equal((await call('/api/mis-credentials/callback',{state:stateA,code:'a'.repeat(43)},first.set[0].name+'='+stateA)).status,400);assert.equal(exchanges,2);
 const expired=await call('/api/mis-credentials/start'),stateC=new URL(expired.url).searchParams.get('misState');await db.query("UPDATE mis_login_pending SET expires_at=NOW()-INTERVAL '1 minute'");
 assert.equal((await call('/api/mis-credentials/callback',{state:stateC,code:'c'.repeat(43)})).status,400);assert.equal(exchanges,2);
 }finally{await db.close()}
});
