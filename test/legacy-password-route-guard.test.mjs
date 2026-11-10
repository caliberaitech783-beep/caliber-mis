import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyPasswordRouteGuard} from '../server/services/production-security-config.mjs';

const run=env=>{let sent=null,nextCalled=false;const res={status(code){sent={code};return this;},json(body){sent.body=body;return this;}};legacyPasswordRouteGuard(env)({},res,()=>{nextCalled=true;});return {sent,nextCalled};};

test('the old password form is refused under Pulse sign-in with a reload instruction and a machine-readable code',()=>{
  for(const env of [{},{MIS_SSO_MODE:'client'}]){
    const {sent,nextCalled}=run(env);
    assert.equal(nextCalled,false);assert.equal(sent.code,403);
    assert.equal(sent.body.code,'PULSE_SIGNIN_REQUIRED');
    assert.match(sent.body.error,/Reload this page/);
  }
});

test('the test platform without Pulse keeps its own password sign-in',()=>{
  assert.equal(run({MIS_SSO_MODE:'off'}).nextCalled,true);
});
