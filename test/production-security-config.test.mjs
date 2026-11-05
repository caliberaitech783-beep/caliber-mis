import test from'node:test';import assert from'node:assert/strict';import{assertProductionSecurityConfig,legacyPasswordRouteGuard}from'../server/services/production-security-config.mjs';
test('production cannot silently start with shared administrator credentials or disabled RLS',()=>{
 const secure={WEBSITE_SITE_NAME:'caliber-mis-783',MIS_DATABASE_CONNECTION_MODE:'isolated',MIS_RLS_ENABLED:'true',MIS_REQUIRE_MFA:'true',MIS_SSO_MODE:'client'};assert.doesNotThrow(()=>assertProductionSecurityConfig(secure));assert.doesNotThrow(()=>assertProductionSecurityConfig({...secure,MIS_REQUIRE_MFA:'false'}));
 for(const key of ['MIS_DATABASE_CONNECTION_MODE','MIS_RLS_ENABLED'])assert.throws(()=>assertProductionSecurityConfig({...secure,[key]:'false'}),/Production MIS requires/);
 assert.throws(()=>assertProductionSecurityConfig({...secure,MIS_SSO_MODE:'off'}),/Pulse identity client/);assert.doesNotThrow(()=>assertProductionSecurityConfig({MIS_SSO_MODE:'off'}));
});
test('MIS client disables inherited local passwords while preserving issuer and PC-scanner authentication',()=>{
 for(const mode of ['client',undefined,'off','issuer']){let allowed=false,status=0,body;const res={status(value){status=value;return this;},json(value){body=value;}};legacyPasswordRouteGuard({MIS_SSO_MODE:mode})({},res,()=>allowed=true);if(mode==='off'||mode==='issuer')assert.equal(allowed,true);else{assert.equal(status,403);assert.equal(body.code,'PULSE_SIGNIN_REQUIRED');}}
});
