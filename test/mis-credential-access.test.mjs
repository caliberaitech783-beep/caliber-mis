import test from 'node:test';
import assert from 'node:assert/strict';
import {misRequestAllowed,misPageAllowed,authorizeMisRequest} from '../shared/mis-application-access.mjs';

test('Equipment master approval routes require the assigned menu and POST',()=>{
 const session=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages}});
 for(const path of ['/api/equipment-master/changes','/api/equipment-master/changes/pending-id/verify']){
  assert.equal(misRequestAllowed(session(['Equipment master']),{path,method:'POST'}),true);
  assert.equal(misRequestAllowed(session(['Employee master']),{path,method:'POST'}),false);
  assert.equal(misRequestAllowed(session(['Equipment master']),{path,method:'GET'}),false);
 }
});
test('equipment alias routes follow the scan, log book and Equipment master menus',()=>{
 const user=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages}});
 const admin=pages=>({role:'super',permissions:{separateMisCredentials:true,misDesktopAccess:[...pages,'Users & employees']}});
 const id='0b4d5f7e-1c2a-4b3d-9e8f-123456789abc',otp='9a8b7c6d-5e4f-4a3b-8c2d-abcdef012345';
 // Learning a mapping while saving a card (scan review or manual entry) and reading the list.
 for(const pages of [['Trip Card Bulk Scan'],['Job Card Bulk Scan'],['Vehicle Log Book'],['Equipment Log Book'],['Equipment master']]){
  assert.equal(misRequestAllowed(user(pages),{path:'/api/equipment-aliases',method:'POST'}),true,pages[0]);
  assert.equal(misRequestAllowed(user(pages),{path:'/api/equipment-aliases',method:'GET'}),true,pages[0]);
  assert.equal(misRequestAllowed(user(pages),{path:'/api/equipment-aliases/settings',method:'GET'}),true,pages[0]);
  assert.equal(misRequestAllowed(user(pages),{path:`/api/equipment-aliases/${id}/otp`,method:'POST'}),true,pages[0]);
  assert.equal(misRequestAllowed(user(pages),{path:`/api/equipment-aliases/${id}/otp/${otp}/verify`,method:'POST'}),true,pages[0]);
 }
 // Unrelated menus stay closed.
 for(const method of ['GET','POST'])assert.equal(misRequestAllowed(user(['Employee master','Dashboard']),{path:'/api/equipment-aliases',method}),false);
 assert.equal(misRequestAllowed(user(['Reports']),{path:'/api/equipment-aliases/settings',method:'GET'}),false);
 // Approver change and direct revoke remain administrator actions.
 assert.equal(misRequestAllowed(user(['Equipment master']),{path:'/api/equipment-aliases/settings',method:'PUT'}),false);
 assert.equal(misRequestAllowed(admin(['Equipment master']),{path:'/api/equipment-aliases/settings',method:'PUT'}),true);
 assert.equal(misRequestAllowed(user(['Equipment master']),{path:`/api/equipment-aliases/${id}`,method:'DELETE'}),false);
 assert.equal(misRequestAllowed(admin(['Equipment master']),{path:`/api/equipment-aliases/${id}`,method:'DELETE'}),true);
 assert.equal(misRequestAllowed(admin([]),{path:`/api/equipment-aliases/${id}`,method:'DELETE'}),false);
 // Wrong methods and unknown sub-routes still fail closed.
 assert.equal(misRequestAllowed(user(['Trip Card Bulk Scan']),{path:'/api/equipment-aliases',method:'DELETE'}),false);
 assert.equal(misRequestAllowed(user(['Trip Card Bulk Scan']),{path:`/api/equipment-aliases/${id}/otp`,method:'GET'}),false);
 assert.equal(misRequestAllowed(user(['Trip Card Bulk Scan']),{path:'/api/equipment-aliases/export',method:'GET'}),false);
});
import {installMisCredentialClient} from '../server/routes/mis-credential-client.mjs';
const session={permissions:{separateMisCredentials:true,misDesktopAccess:['Employee master','Vehicle Log Book','Trip Card Bulk Scan'],misMobileAccess:['Dashboard']}};
test('MIS API permissions fail closed and follow assigned masters and working menus',()=>{
 assert.equal(misRequestAllowed(session,{path:'/api/employee-master',method:'POST'}),true);
 assert.equal(misRequestAllowed(session,{path:'/api/erp-masters/Company%20master',method:'GET'}),false);
 assert.equal(misRequestAllowed(session,{path:'/api/log-books/equipment',method:'POST'}),false);
 assert.equal(misRequestAllowed(session,{path:'/api/log-books/vehicle',method:'POST'}),true);
 assert.equal(misRequestAllowed(session,{path:'/api/shift-attendance',method:'GET',query:{kind:'vehicle'}}),true);
 assert.equal(misRequestAllowed(session,{path:'/api/shift-attendance',method:'POST',body:{kind:'vehicle'}}),true);
 assert.equal(misRequestAllowed(session,{path:'/api/shift-attendance',method:'POST',body:{kind:'equipment'}}),false);
 assert.equal(misRequestAllowed(session,{path:'/api/shift-attendance',method:'DELETE',body:{kind:'vehicle'}}),false);
 assert.equal(misRequestAllowed(session,{path:'/api/unknown-new-feature',method:'GET'}),false);
 assert.equal(misPageAllowed(session,'Employee master','mobile'),false);assert.equal(misPageAllowed(session,'Employee master','desktop'),true);
});

test('VLB and ELB report pages inherit their corresponding scan access independently',()=>{
 assert.equal(misPageAllowed(session,'VLB Reports','desktop'),true);
 assert.equal(misPageAllowed(session,'VLB Reports','mobile'),false);
 assert.equal(misPageAllowed(session,'ELB Reports','desktop'),false);
 assert.equal(misPageAllowed({...session,permissions:{...session.permissions,misDesktopAccess:['Job Card Bulk Scan']}},'ELB Reports','desktop'),true);
});

test('automatic trip verification follows assigned VLB, trip-card and sync menus and rejects unrelated routes',()=>{
 for(const page of ['Vehicle Log Book','Trip Card Bulk Scan','Pulse Master Sync']){
  const user={permissions:{separateMisCredentials:true,misDesktopAccess:[page]}};
  assert.equal(misRequestAllowed(user,{path:'/api/pulse-trip-verification',method:'GET'}),true);
  assert.equal(misRequestAllowed(user,{path:'/api/pulse-trip-verification/12/retry',method:'POST'}),true);
  assert.equal(misRequestAllowed(user,{path:'/api/pulse-trip-verification/12/delete',method:'POST'}),false);
  assert.equal(misRequestAllowed(user,{path:'/api/pulse-trip-verification',method:'POST'}),false);
 }
 const unrelated={permissions:{separateMisCredentials:true,misDesktopAccess:['Equipment Log Book']}};
 assert.equal(misRequestAllowed(unrelated,{path:'/api/pulse-trip-verification',method:'GET'}),false);
 assert.equal(misRequestAllowed(unrelated,{path:'/api/pulse-trip-verification/12/retry',method:'POST'}),false);
});
test('card batch permissions resolve actual database kind instead of trusting the supplied kind',async()=>{
 const pool={query:async()=>({rows:[{kind:'equipment'}]})};
 assert.equal(await authorizeMisRequest(session,{path:'/api/scan-batches/12345678-1234-1234-1234-123456789abc',method:'POST',body:{kind:'vehicle'}},pool),false);
});
test('MIS client forwards separate credentials only to the fixed HTTPS issuer and never exposes the grant',async()=>{
 const routes=new Map(),calls=[];
 const client=installMisCredentialClient({post:(p,...handlers)=>routes.set(p,(req,res)=>{let index=0;const next=()=>handlers[index++]?.(req,res,next);return next();})},{pool:{query:async(q,v)=>{calls.push({q,v});return {rows:[]}}},sessionStore:{create:async value=>calls.push(value)},fetcher:async(url,options)=>{
 assert.equal(url,'https://pulse.cmll.in/api/integrations/mis/authenticate');assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).username,'mis.one');return {status:200,json:async()=>({grant:'a'.repeat(43),profile:{role:'super',login:'person',permissions:{separateMisCredentials:true}}})};}});
 let body;await routes.get('/api/mis-credentials/login')({body:{username:'mis.one',password:'separate-secret'}},{set(){},status(){return this},json(value){body=value}});
 assert.ok(body.token);assert.equal(body.grant,undefined);assert.equal(calls[0].login,'person');assert.equal(calls[1].v[1],'a'.repeat(43));
 assert.equal(await client.validateSession('token',{permissions:{}}),null);
});

test('Deletion is granted explicitly or through both book workflows and cannot bypass site controls',()=>{const session=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages}});assert.equal(misPageAllowed(session(['Vehicle Log Book']),'Deletion','desktop'),false);assert.equal(misPageAllowed(session(['Vehicle Log Book','Equipment Log Book']),'Deletion','desktop'),true);assert.equal(misPageAllowed(session(['Deletion']),'Deletion','desktop'),true);assert.equal(misRequestAllowed(session(['Deletion']),{path:'/api/log-book-deletions/entries',method:'GET'}),true);assert.equal(misRequestAllowed(session(['Scan Backup']),{path:'/api/log-book-deletions/entries',method:'GET'}),false);});
