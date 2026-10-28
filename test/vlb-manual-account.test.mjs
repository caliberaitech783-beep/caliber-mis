import test from 'node:test';import assert from 'node:assert/strict';
import {canonicalSiteName} from '../site-location.mjs';
import {manualLogBookLocation} from '../log-book-access.mjs';
test('manual VLB location resolves from the account without guessing across multiple sites',()=>{
 assert.equal(manualLogBookLocation({role:'normal',location:'Sasti OC'}),'Sasti OC');
 assert.equal(manualLogBookLocation({permissions:{site:'Jayant OC'}},{sites:['Jayant OC'].map(canonicalSiteName)}),'Jayant OC');
 assert.equal(manualLogBookLocation({}, {sites:['Sasti OC'].map(canonicalSiteName)}),'Sasti OC');
 assert.equal(manualLogBookLocation({}, {sites:null}),'');
 assert.equal(manualLogBookLocation({}, {sites:['Sasti OC','Jayant OC'].map(canonicalSiteName)}),'');
 assert.equal(manualLogBookLocation({location:'Jayant OC'}, {sites:['Sasti OC'].map(canonicalSiteName)}),'');
});
