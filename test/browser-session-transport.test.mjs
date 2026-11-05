import test from'node:test';import assert from'node:assert/strict';import{browserSessionRequestInit}from'../src/browser-session-transport.mjs';
test('browser writes carry CSRF proof while preserving transport and scoped connector headers',()=>{
 const result=browserSessionRequestInit({method:'POST',body:'payload',headers:{Authorization:'Bearer browser-session','X-Caliber-Scanner':'1'}},'preference=dark; __Host-mis_csrf=proof');
 assert.equal(result.headers.get('x-csrf-token'),'proof');assert.equal(result.headers.get('authorization'),'Bearer browser-session');assert.equal(result.headers.get('x-caliber-scanner'),'1');assert.equal(result.body,'payload');
 assert.equal(browserSessionRequestInit({},'').headers.has('X-CSRF-Token'),false);
 const scoped=browserSessionRequestInit({headers:{Authorization:'Bearer browser-session.AAAAAAAAAAAAAAAA'}},'__Host-mis_csrf_BBBBBBBBBBBBBBBB=other-tab; __Host-mis_csrf_AAAAAAAAAAAAAAAA=this-tab');
 assert.equal(scoped.headers.get('x-csrf-token'),'this-tab');
});
