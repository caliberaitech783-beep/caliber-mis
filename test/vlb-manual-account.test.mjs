import test from 'node:test';import assert from 'node:assert/strict';
import {canonicalSiteName} from '../site-location.mjs';
import {manualLogBookLocation,logBookAccountLocation} from '../log-book-access.mjs';
test('manual VLB location resolves from the account without guessing across multiple sites',()=>{
 assert.equal(manualLogBookLocation({role:'normal',location:'Sasti OC'}),'Sasti OC');
 assert.equal(manualLogBookLocation({permissions:{site:'Jayant OC'}},{sites:['Jayant OC'].map(canonicalSiteName)}),'Jayant OC');
 assert.equal(manualLogBookLocation({}, {sites:['Sasti OC'].map(canonicalSiteName)}),'Sasti OC');
 assert.equal(manualLogBookLocation({}, {sites:null}),'');
 assert.equal(manualLogBookLocation({}, {sites:['Sasti OC','Jayant OC'].map(canonicalSiteName)}),'');
 assert.equal(manualLogBookLocation({location:'Jayant OC'}, {sites:['Sasti OC'].map(canonicalSiteName)}),'');
});

test('account site uses the matching current Pulse master rather than a stale sign-in site',()=>{
 const session={login:'ADMIN01',name:'Admin',location:'Old site'},scope={sites:null};
 const users=[{login:'other',site:'Other site'},{login:'admin01',employee:'Admin',site:'Sasti OC'}];
 assert.equal(logBookAccountLocation(session,scope,users),'Sasti OC');
 assert.equal(logBookAccountLocation(session,scope,[{login:'admin01',site:'Sasti OC|Jayant OC'}]),'');
 assert.equal(logBookAccountLocation(session,scope,[{login:'admin01'}]),'');
 assert.equal(logBookAccountLocation(session,{sites:['sasti oc']},[{login:'admin01',site:'Jayant OC'}]),'');
});
