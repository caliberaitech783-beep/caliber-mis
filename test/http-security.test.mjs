import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {securityHeaders,protectStaticFiles,createLoginLimiter} from '../server/middleware/http-security.mjs';
import {installMisCredentialClient} from '../server/routes/mis-credential-client.mjs';

async function serve(t,app){
 const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 return `http://127.0.0.1:${server.address().port}`;
}
test('static protection blocks source maps and private files while preserving scanner assets',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mis-static-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'app-assets'));await writeFile(path.join(root,'app-assets','app.js.map'),'private');
 await writeFile(path.join(root,'package.json'),'private');await writeFile(path.join(root,'scanner-transfer.mjs'),'export const ok=true;');
 const app=express();app.use(securityHeaders,protectStaticFiles,express.static(root));
 const base=await serve(t,app);
 for(const name of ['/app-assets/app.js.map','/package.json','/%70ackage.json','/server.mjs','/.env','/src/main.jsx'])assert.equal((await fetch(base+name)).status,404,name);
 const response=await fetch(base+'/scanner-transfer.mjs');assert.equal(response.status,200);
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
});
test('login throttle blocks before contacting Pulse and ignores spoofed forwarding headers',async t=>{
 const app=express();app.use(express.json());let calls=0;
 installMisCredentialClient(app,{pool:{},sessionStore:{},fetcher:async()=>{calls++;return {status:401,json:async()=>({error:'Incorrect credentials'})};}});
 const base=await serve(t,app);
 for(let i=0;i<21;i++){
  const response=await fetch(base+'/api/mis-credentials/login',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':`192.0.2.${i}`},body:JSON.stringify({username:i%2?' USER ':'user',password:'wrong'})});
  assert.equal(response.status,i===20?429:401);
  if(i===20)assert.ok(Number(response.headers.get('retry-after'))>0);
 }
 assert.equal(calls,20);
});
test('limiter expires and bounded storage does not evict active limits',()=>{
 let time=0;const limiter=createLoginLimiter({limit:1,windowMs:1000,maxEntries:1,now:()=>time});
 const run=username=>{let status=200;const res={set(){},status(value){status=value;return this;},json(){}};limiter({body:{username}},res,()=>{});return status;};
 assert.equal(run('a'),200);assert.equal(run('b'),429);assert.equal(run('a'),429);
 time=1000;assert.equal(run('b'),200);
});
