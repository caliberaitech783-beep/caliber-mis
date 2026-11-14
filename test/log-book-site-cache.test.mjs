import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLogBookSiteCache,logBookSiteScope} from '../shared/log-book-access.mjs';

const client=sites=>{
 const calls=[];
 return {calls,query:async sql=>{calls.push(sql);return {rows:sites.map(site=>({site}))};}};
};

test('one site list read is shared by every caller until it expires',async()=>{
 let clock=0;
 const db=client(['Jayant OC','Sasti OC','Bina OC']);
 const sites=createLogBookSiteCache({ttlMs:60_000,now:()=>clock});
 const [a,b]=await Promise.all([sites(db,logBookSiteScope({site:'Sasti OB'})),sites(db,logBookSiteScope({managerRegion:'NCL'}))]);
 assert.deepEqual(a,['Sasti OC']);
 assert.deepEqual(b,['Jayant OC']);
 assert.equal(db.calls.length,1,'parallel entry reads share one query');
 clock=59_999;
 await sites(db,logBookSiteScope({site:'Sasti OB'}));
 assert.equal(db.calls.length,1,'a poll inside the minute reuses the list');
 clock=60_000;
 await sites(db,logBookSiteScope({site:'Sasti OB'}));
 assert.equal(db.calls.length,2,'the list is read again after it expires');
});

test('all-site logins skip the read and an unassigned login sees no site',async()=>{
 const db=client(['Sasti OC']);
 const sites=createLogBookSiteCache();
 assert.equal(await sites(db,{sites:null}),null);
 assert.equal(db.calls.length,0);
 assert.deepEqual(await sites(db,{sites:[]}),[]);
});

test('a failed read is not kept',async()=>{
 let fail=true;
 const db={query:async()=>{if(fail)throw new Error('busy');return {rows:[{site:'Sasti OC'}]};}};
 const sites=createLogBookSiteCache();
 await assert.rejects(sites(db,logBookSiteScope({site:'Sasti OB'})),/busy/);
 fail=false;
 assert.deepEqual(await sites(db,logBookSiteScope({site:'Sasti OB'})),['Sasti OC']);
});

test('the scan routes read sites through the shared cache',()=>{
 const source=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 assert.match(source,/filterLogBookSites=createLogBookSiteCache\(\)/);
 assert.doesNotMatch(source,/import \{[^}]*\bfilterLogBookSites\b[^}]*\} from '..\/..\/shared\/log-book-access.mjs'/);
});
