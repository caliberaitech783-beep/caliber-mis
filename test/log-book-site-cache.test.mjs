import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLogBookSiteCache,logBookSiteScope} from '../shared/log-book-access.mjs';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {sharedLogBookSites} from '../server/services/log-book-site-list.mjs';
import {rowSecurityPool,rowSecurityContext,initializeRowSecurity} from '../server/services/row-security.mjs';

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

test('with a pool an expired list is answered at once and refreshed in the background',async()=>{
 let clock=0,release;
 const db=client(['Sasti OC']);
 const pool={calls:0,query:()=>{pool.calls+=1;return new Promise(resolve=>{release=()=>resolve({rows:[{site:'Sasti OC'},{site:'Jayant OC'}]});});}};
 const sites=createLogBookSiteCache({pool,ttlMs:60_000,now:()=>clock});
 const ncl=logBookSiteScope({managerRegion:'NCL'});
 assert.deepEqual(await sites(db,ncl),[],'the first read waits on the caller connection');
 assert.equal(db.calls.length,1);
 clock=60_000;
 assert.deepEqual(await sites(db,ncl),[],'the expired list is answered without waiting');
 assert.deepEqual(await sites(db,ncl),[]);
 assert.equal(pool.calls,1,'one background read for both callers');
 assert.equal(db.calls.length,1,'the caller connection is not used for the background read');
 release();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(await sites(db,ncl),['Jayant OC']);
});

test('the scan routes read sites through the shared cache',()=>{
 const source=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 assert.match(source,/filterLogBookSites=sharedLogBookSites\(pool\)/);
 assert.doesNotMatch(source,/import \{[^}]*\bfilterLogBookSites\b[^}]*\} from '..\/..\/shared\/log-book-access.mjs'/);
});

// 23 Nov 2026: a manual VLB card took 3 to 4 minutes to save. For a site login the save listed the
// sites by reading every card saved since 1 November (20 to 30 s on live), inside its transaction,
// while it held the site, date and shift lock. Every route now takes the server's one list.
test('no server route reads the site list for itself any more',()=>{
 const access=readFileSync(new URL('../shared/log-book-access.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(access,/export (async )?function filterLogBookSites/,'the read-it-yourself helper is gone');
 for(const file of ['log-book.mjs','log-book-dashboard.mjs','manpower-report-api.mjs','bulk-card-scanning.mjs','pulse-trip-verification.mjs']){
  const source=readFileSync(new URL('../server/routes/'+file,import.meta.url),'utf8');
  assert.match(source,/sharedLogBookSites\(pool\)/,file+' takes the shared list');
  assert.doesNotMatch(source,/createLogBookSiteCache\(/,file+' does not keep a list of its own');
 }
});

test('with a trusted reader the list is read through the pool as the server, never on a caller connection',async()=>{
 let clock=0,asServer=false;
 const pool={reads:[],query:async()=>{pool.reads.push(asServer);return {rows:[{site:'Sasti OC'},{site:'Jayant OC'}]};}};
 const trusted=task=>{asServer=true;try{return task();}finally{asServer=false;}};
 const sites=createLogBookSiteCache({pool,trusted,ttlMs:60_000,now:()=>clock});
 const sasti=logBookSiteScope({site:'Sasti OB'}),ncl=logBookSiteScope({managerRegion:'NCL'});
 assert.deepEqual(await sites(pool,sasti),['Sasti OC'],'a caller that holds no connection waits for the shared read');
 assert.deepEqual(pool.reads,[true],'read once, as the server');
 const db=client(['Sasti OC']);
 assert.deepEqual(await sites(db,ncl),['Jayant OC'],'another login gets its own sites from the same list');
 assert.equal(db.calls.length,0,'a held list is never read again on the caller connection');
 clock=60_000;
 assert.deepEqual(await sites(db,ncl),['Jayant OC']);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(pool.reads,[true,true],'the refresh is a server read through the pool too');
 assert.equal(db.calls.length,0);
});

test('before the first shared read a caller holding a connection is answered from it, and that answer is kept for nobody',async()=>{
 let release;
 const pool={calls:0,query:()=>{pool.calls+=1;return new Promise(resolve=>{release=()=>resolve({rows:[{site:'Sasti OC'},{site:'Jayant OC'}]});});}};
 const sites=createLogBookSiteCache({pool,trusted:task=>task()});
 const sasti=logBookSiteScope({site:'Sasti OB'}),ncl=logBookSiteScope({managerRegion:'NCL'});
 // Row security hands a Sasti login only Sasti on its own connection.
 const own=client(['Sasti OC']);
 assert.deepEqual(await sites(own,sasti),['Sasti OC'],'answered at once, without waiting for a second connection');
 assert.equal(own.calls.length,1);
 assert.equal(pool.calls,1,'the shared read was started through the pool');
 release();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(await sites(own,ncl),['Jayant OC'],'the Sasti-only answer was not kept as the list');
 assert.equal(own.calls.length,1);
});

test('a site whose first card was just saved is in the list at once and survives a read that started earlier',async()=>{
 let clock=0,release;
 const answers=[[{site:'Sasti OC'}],[{site:'Sasti OC'}],[{site:'Sasti OC'},{site:'Jayant OC'}]];
 const pool={query:()=>{const rows=answers.shift();return new Promise(resolve=>{release=()=>resolve({rows});});}};
 const sites=createLogBookSiteCache({pool,trusted:task=>task(),ttlMs:60_000,now:()=>clock});
 const ncl=logBookSiteScope({managerRegion:'NCL'});
 const first=sites(pool,ncl);release();assert.deepEqual(await first,[]);
 clock=60_000;await sites(pool,ncl);                    // a refresh starts and has not answered yet
 sites.remember('Jayant OC');sites.remember('');sites.remember(undefined);
 assert.deepEqual(await sites(pool,ncl),['Jayant OC'],'seen at once');
 release();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(await sites(pool,ncl),['Jayant OC'],'the older read did not drop it');
 clock=120_000;await sites(pool,ncl);release();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(await sites(pool,ncl),['Jayant OC'],'and it is listed once when the database returns it');
});

test('under row security one site login never decides which sites another login sees',async()=>{
 // A stand-in database that applies the site rule the way row security does: a connection sees
 // every site only while it carries the server's empty scope.
 const every=['Sasti OC','Jayant OC'],reads=[];let connections=0;
 const native={connect:async()=>{
  const id=++connections;let scope=null;
  return {release(){},query:async(sql,args)=>{
   if(/set_config\('mis\.request_scope'/.test(sql)){scope=args[0];return {rows:[]};}
   if(/FROM pg_roles/.test(sql))return {rows:[{name:'mis_app',rolbypassrls:false,rolsuper:false}]};
   if(/SELECT DISTINCT site FROM mis_log_books/.test(sql)){
    reads.push({connection:id,scope});
    return {rows:(scope===''?every:every.filter(site=>JSON.parse(scope).sites.includes(canonicalSiteName(site)))).map(site=>({site}))};
   }
   return {rows:[]};
  }};
 }};
 const pool=rowSecurityPool(native,{enabled:true,resolveScope:req=>req.logBookScope});
 await initializeRowSecurity(pool,{enabled:true});
 const sites=sharedLogBookSites(pool);
 assert.equal(sharedLogBookSites(pool),sites,'every route given this pool shares one list');
 const as=(scope,task)=>new Promise((resolve,reject)=>rowSecurityContext({session:{login:'site-user'},logBookScope:scope},null,()=>{task().then(resolve,reject);}));
 const sasti=logBookSiteScope({site:'Sasti OB'}),jayant=logBookSiteScope({site:'Jayant OB'});
 // A Sasti login in the middle of its own work, holding a connection, asks first.
 const held=await as(sasti,async()=>{const db=await pool.connect();try{return await sites(db,sasti);}finally{db.release();}});
 assert.deepEqual(held,['Sasti OC']);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(await as(jayant,()=>sites(pool,jayant)),['Jayant OC'],'a Jayant login gets Jayant although a Sasti login caused the read');
 assert.deepEqual(await as(sasti,()=>sites(pool,sasti)),['Sasti OC']);
 const server=reads.filter(read=>read.scope==='');
 assert.equal(server.length,1,'the list kept for everybody was read once, with the server scope');
 assert.ok(reads.every(read=>read.scope===''||read.connection!==server[0].connection),'the server read had a connection of its own');
});
