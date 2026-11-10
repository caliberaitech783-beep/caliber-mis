import test from 'node:test';
import assert from 'node:assert/strict';
import {createPulseMasterSync,PULSE_FEED_REUSE_MS,PULSE_FLEET_REUSE_MS} from '../server/routes/pulse-master-sync.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const snapshot=door=>({'Equipment master':[{id:1,door}],'Region master':[],'Shift Master':[],'Users & employees':[]});

test('simultaneous fleet reads share only the same actor; a snapshot answers later reads for the reuse window and a recheck reads fresh',async()=>{
 let clock=1_000_000;const now=()=>clock;
 const calls=[],sharedSignIn={request(action,payload,actor){const pending=deferred();calls.push({action,payload,actor,...pending});return pending.promise;}},service=createPulseMasterSync({sharedSignIn,now});
 const first=service.readEquipmentMasters('admin-a'),same=service.readEquipmentMasters('admin-a'),other=service.readEquipmentMasters('admin-b');
 assert.deepEqual(calls.map(c=>[c.action,c.actor]),[['fleet','admin-a'],['fleet','admin-b']]);
 calls[0].resolve(snapshot('V1'));calls[1].resolve(snapshot('V2'));
 const [a,b,c]=await Promise.all([first,same,other]);assert.deepEqual(a,b);assert.equal(c[0].door,'V2');
 a[0].door='changed locally';assert.equal(b[0].door,'V1');
 // Within the window the snapshot answers without a request to Pulse, as its own copy.
 clock+=PULSE_FLEET_REUSE_MS-1;const reused=await service.readEquipmentMasters('admin-a');assert.equal(calls.length,2);assert.equal(reused[0].door,'V1');reused[0].door='changed too';
 // A recheck reads fresh at once and the new snapshot answers the reads that follow.
 const fresh=service.readEquipmentMasters('admin-a',undefined,{fresh:true});assert.equal(calls.length,3);calls[2].resolve(snapshot('V3'));assert.equal((await fresh)[0].door,'V3');
 assert.equal((await service.readEquipmentMasters('admin-a'))[0].door,'V3');assert.equal(calls.length,3);
 // After the window the next read asks Pulse again.
 clock+=PULSE_FLEET_REUSE_MS;const later=service.readEquipmentMasters('admin-a');assert.equal(calls.length,4);calls[3].resolve(snapshot('V4'));assert.equal((await later)[0].door,'V4');
});

test('shared-sign-in breakdown reads are shared per actor for the reuse window, read fresh on request and refreshed after a verification',async()=>{
 let clock=5_000_000;const now=()=>clock,calls=[];
 const service=createPulseMasterSync({sharedSignIn:{request(action,payload,actor){const p=deferred();calls.push({action,payload,actor,...p});return p.promise;}},now});
 const a1=service.readBreakdownRequests({actor:'site-a'}),a2=service.readBreakdownRequests({actor:'site-a'}),b1=service.readBreakdownRequests({actor:'site-b'});
 assert.deepEqual(calls.map(c=>[c.action,c.actor]),[['requests','site-a'],['requests','site-b']]);
 const rowsA=[{ref:'A-1'}];calls[0].resolve(rowsA);calls[1].resolve([{ref:'B-1'}]);
 assert.equal(await a1,rowsA);assert.equal(await a2,rowsA);assert.equal((await b1)[0].ref,'B-1');
 clock+=PULSE_FEED_REUSE_MS-1;assert.equal(await service.readBreakdownRequests({actor:'site-a'}),rowsA);assert.equal(calls.length,2);
 const fresh=service.readBreakdownRequests({actor:'site-a',fresh:true});assert.equal(calls.length,3);calls[2].resolve([{ref:'A-2'}]);assert.equal((await fresh)[0].ref,'A-2');
 clock+=PULSE_FEED_REUSE_MS;const later=service.readBreakdownRequests({actor:'site-a'});assert.equal(calls.length,4);calls[3].resolve([{ref:'A-3'}]);assert.equal((await later)[0].ref,'A-3');
 // Reads scoped to an actor share the same window; a verification changes the feed, so it clears the window.
 const scoped=service.forActor('site-a');assert.equal((await scoped.readBreakdownRequests())[0].ref,'A-3');assert.equal(calls.length,4);
 const verify=scoped.verifyTripCard('A-3',{});assert.equal(calls[4].action,'verify');calls[4].resolve({verifiedAt:'now'});await verify;
 const afterVerify=service.readBreakdownRequests({actor:'site-a'});assert.equal(calls.length,6);calls[5].resolve([]);assert.deepEqual(await afterVerify,[]);
});

test('a failed or invalid breakdown read is not reused and the next read asks Pulse again',async()=>{
 const calls=[];const service=createPulseMasterSync({sharedSignIn:{request(action,payload,actor){const p=deferred();calls.push({action,actor,...p});return p.promise;}}});
 const first=service.readBreakdownRequests({actor:'x'}),same=service.readBreakdownRequests({actor:'x'});assert.equal(calls.length,1);
 const rejected=Promise.all([assert.rejects(first,/offline/),assert.rejects(same,/offline/)]);calls[0].reject(Error('offline'));await rejected;
 const invalid=service.readBreakdownRequests({actor:'x'});assert.equal(calls.length,2);calls[1].resolve({error:'not an array'});await assert.rejects(invalid,/invalid breakdown feed/);
 const retry=service.readBreakdownRequests({actor:'x'});assert.equal(calls.length,3);calls[2].resolve([{ref:'R'}]);assert.equal((await retry)[0].ref,'R');
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

test('ordinary MIS saving uses scoped fleet access without requesting full master-sync permission',async()=>{
 const calls=[];
 const service=createPulseMasterSync({sharedSignIn:{async request(action,payload,actor){
  calls.push({action,payload,actor});
  if(action==='masters')throw Object.assign(Error('Your Pulse account is not authorised to sync all four masters.'),{status:403});
  assert.equal(action,'fleet');assert.equal(actor,'ordinary-mis');
  if(payload.site!=='Jayant OB')throw Object.assign(Error('Site access denied'),{status:403});
  return snapshot('TPC35 - 01150');
 }}});
 assert.equal((await service.readEquipmentMasters('ordinary-mis','Jayant OB'))[0].door,'TPC35 - 01150');
 await assert.rejects(service.readEquipmentMasters('ordinary-mis','Other site'),e=>e.status===403);
 assert.ok(calls.every(c=>c.action==='fleet'));
});
test('simultaneous fleet reads for different sites never share authorization results',async()=>{
 const calls=[];const service=createPulseMasterSync({sharedSignIn:{request(action,payload,actor){const p=deferred();calls.push({action,payload,actor,...p});return p.promise;}}});
 const first=service.readEquipmentMasters('mis','Jayant OB'),other=service.readEquipmentMasters('mis','Majri OC');
 assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.payload.site),['Jayant OB','Majri OC']);
 calls[0].resolve(snapshot('JAYANT'));calls[1].reject(Object.assign(Error('Site access denied'),{status:403}));
 assert.equal((await first)[0].door,'JAYANT');await assert.rejects(other,e=>e.status===403);
});
