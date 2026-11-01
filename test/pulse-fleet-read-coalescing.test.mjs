import test from 'node:test';
import assert from 'node:assert/strict';
import {createPulseMasterSync} from '../pulse-master-sync.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const snapshot=door=>({'Equipment master':[{id:1,door}],'Region master':[],'Shift Master':[],'Users & employees':[]});

test('simultaneous fleet reads share only the same actor and later reads fetch fresh data',async()=>{
 const calls=[],sharedSignIn={request(action,payload,actor){const pending=deferred();calls.push({action,actor,...pending});return pending.promise;}},service=createPulseMasterSync({sharedSignIn});
 const first=service.readEquipmentMasters('admin-a'),same=service.readEquipmentMasters('admin-a'),other=service.readEquipmentMasters('admin-b');
 assert.deepEqual(calls.map(c=>c.actor),['admin-a','admin-b']);
 calls[0].resolve(snapshot('V1'));calls[1].resolve(snapshot('V2'));
 const [a,b,c]=await Promise.all([first,same,other]);assert.deepEqual(a,b);assert.equal(c[0].door,'V2');
 a[0].door='changed locally';assert.equal(b[0].door,'V1');
 const next=service.readEquipmentMasters('admin-a');assert.equal(calls.length,3);calls[2].resolve(snapshot('V3'));assert.equal((await next)[0].door,'V3');
});

test('failed and empty fleet responses are not cached and all waiting readers receive the error',async()=>{
 const pending=[],service=createPulseMasterSync({sharedSignIn:{request(){const p=deferred();pending.push(p);return p.promise;}}});
 const first=service.readEquipmentMasters('admin'),same=service.readEquipmentMasters('admin');
 const rejected=Promise.all([assert.rejects(first,/offline/),assert.rejects(same,/offline/)]);pending[0].reject(Error('offline'));await rejected;
 const empty=service.readEquipmentMasters('admin');pending[1].resolve({'Equipment master':[]});await assert.rejects(empty,/no fleet records/);
 const retry=service.readEquipmentMasters('admin');assert.equal(pending.length,3);pending[2].resolve(snapshot('V4'));assert.equal((await retry)[0].door,'V4');
});

test('changing the source session never joins an older in-flight fleet read',async()=>{
 const shared=deferred(),manual=[],saved=new Map();let hold=false,session=0;
 const query=async sql=>({rows:sql.startsWith('INSERT INTO master_records')?[{id:1}]:[]});
 const pool={query,connect:async()=>({query,release(){}})};
 const service=createPulseMasterSync({pool,credentialStore:{write:async(k,v)=>saved.set(k,v),remove:async k=>saved.delete(k)},sharedSignIn:{request:()=>shared.promise},fetchImpl:async(url,options)=>{
  if(url.endsWith('/api/login'))return Response.json({token:'session-'+(++session),role:'super',permissions:{adminLevel:'Admin'}});
  if(!hold)return Response.json(snapshot('CONNECTED'));
  const p=deferred();manual.push({...p,authorization:options.headers.Authorization});return p.promise;
 }});
 const original=service.readEquipmentMasters('admin');
 await service.connect({username:'admin',password:'synthetic-test-only'});hold=true;
 const first=service.readEquipmentMasters('admin'),same=service.readEquipmentMasters('admin');assert.equal(manual.length,1);
 hold=false;await service.connect({username:'admin',password:'synthetic-test-only'});hold=true;
 const changed=service.readEquipmentMasters('admin');assert.equal(manual.length,2);assert.notEqual(manual[0].authorization,manual[1].authorization);
 shared.resolve(snapshot('SHARED'));manual[0].resolve(Response.json(snapshot('OLD')));manual[1].resolve(Response.json(snapshot('NEW')));
 assert.equal((await original)[0].door,'SHARED');assert.equal((await first)[0].door,'OLD');assert.equal((await same)[0].door,'OLD');assert.equal((await changed)[0].door,'NEW');
});
