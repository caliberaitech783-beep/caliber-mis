import test from 'node:test';
import assert from 'node:assert/strict';
import {logBookSiteScope,siteAllowed} from '../shared/log-book-access.mjs';
test('VLB and ELB use explicit site before broader regional settings',()=>{
 const session={role:'super',permissions:{separateMisCredentials:true,adminLevel:'Admin'}};
 assert.equal(siteAllowed(logBookSiteScope(session,{site:'Sasti OC',managerRegion:'All'}),'Jayant OC'),false);
 assert.equal(siteAllowed(logBookSiteScope(session,{site:'Sasti OC',managerRegion:'WCL'}),'Majri OC'),false);
 assert.equal(siteAllowed(logBookSiteScope(session,{managerRegion:'NCL'}),'Jayant OC'),true);
 assert.equal(siteAllowed(logBookSiteScope(session,{managerRegion:'NCL'}),'Sasti OC'),false);
 assert.deepEqual(logBookSiteScope(session,{managerRegion:'All'}).sites,[]);
 assert.deepEqual(logBookSiteScope(session,{}).sites,[]);
});
test('only actual administrators receive all-site access',()=>{
 for(const session of [{role:'super',permissions:{adminLevel:'Admin'}},{role:'super',permissions:{separateMisCredentials:true,misDesktopAccess:['Users & employees']}}]){
  assert.equal(logBookSiteScope(session).sites,null);
  assert.equal(siteAllowed(logBookSiteScope(session,{site:'Sasti OC'}),'Jayant OC'),false);
  assert.equal(siteAllowed(logBookSiteScope(session,{site:'Sasti OC'}),'Sasti OB'),true);
  const multiple=logBookSiteScope(session,{site:'Sasti OC | Jayant OC'});
  assert.equal(siteAllowed(multiple,'Sasti OC'),true);
  assert.equal(siteAllowed(multiple,'Jayant OC'),true);
  assert.equal(siteAllowed(multiple,'Majri OC'),false);
 }
 assert.deepEqual(logBookSiteScope({role:'super',permissions:{separateMisCredentials:true,adminLevel:'Admin'}}).sites,[]);
});
