import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {installMisLoginHandoff} from '../mis-login-handoff.mjs';
test('MIS callback requires browser state and one-time proof; session is retrieved without URL tokens',async()=>{
 const db=new PGlite();try{
 await db.exec('CREATE TABLE mis_credential_sessions(session_token UUID,grant_token TEXT)');
 const routes=new Map(),sessions=new Map(),sessionStore={create:async s=>sessions.set(s.token,s),get:async token=>sessions.get(token)};
 let exchange;
 const profile={login:'anoop',permissions:{application:'MIS',separateMisCredentials:true,sharedPulseCredentials:true}};
 const service=installMisLoginHandoff({get:(path,fn)=>routes.set(path,fn)},{pool:db,sessionStore,credentialClient:{validateSession:async(_token,session)=>session},fetcher:async(url,options)=>{exchange={url,...JSON.parse(options.body)};return {ok:true,json:async()=>({grant:'g'.repeat(43),profile})}}});await service.initialize();
 const call=async(path,query={},cookie='')=>{const result={status:200,cookies:{},body:null,url:null};const res={set(){},status(code){result.status=code;return this},json(body){result.body=body;return this},cookie(name,value,options){result.cookies[name]={value,options}},clearCookie(){},redirect(status,url){result.status=status;result.url=url}};await routes.get(path)({query,headers:{cookie}},res);return result};
 const start=await call('/api/mis-credentials/start');assert.equal(start.status,303);const target=new URL(start.url);assert.equal(target.origin,'https://pulse.cmll.in');assert.equal(target.searchParams.get('login'),'mis');const state=target.searchParams.get('misState'),cookie='__Host-mis_credential_state='+state;
 assert.equal(start.cookies.__Host_mis_credential_state,undefined);assert.equal(start.cookies['__Host-mis_credential_state'].options.httpOnly,true);
 assert.equal((await call('/api/mis-credentials/callback',{state,code:'c'.repeat(43)})).status,400);
 const callback=await call('/api/mis-credentials/callback',{state,code:'c'.repeat(43)},cookie);assert.equal(callback.status,303);assert.equal(callback.url,'/?misCredentialReady=1');assert.equal(exchange.url,'https://pulse.cmll.in/api/integrations/mis/exchange');assert.equal(exchange.state,state);assert.equal(exchange.verifier.length,43);
 assert.equal((await call('/api/mis-credentials/callback',{state,code:'c'.repeat(43)},cookie)).status,400);
 const token=callback.cookies['__Host-mis_credential_ready'].value;assert.equal((await call('/api/mis-credentials/session',{},'__Host-mis_credential_ready='+token)).body.token,token);
 assert.equal((await call('/api/mis-credentials/session')).status,401);
 }finally{await db.close()}
});
