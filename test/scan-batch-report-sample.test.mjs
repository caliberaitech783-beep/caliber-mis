import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {registerAutomationCentre} from '../server/routes/automation-centre.mjs';

// Owner, 16 Nov 2026: "Send sample to Telegram" on the A24 line of the Automation Centre.
test('only an administrator can send a sample, and every outcome is explained',async t=>{
 let result={batch:'CMLL/DIPKA/15TH -NOV-26/S1/B01',people:1,sent:1},calls=0;const audits=[];
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.session={login:req.get('Authorization')};next();});
 registerAutomationCentre(app,{pool:{query:async()=>({rows:[]})},centre:{overview:async()=>({rows:[]})},requireSession:(req,res,next)=>next(),
  requireAdministrator:(req,res,next)=>{res.on('finish',()=>req.audit&&audits.push(req.audit));return req.session.login==='admin'?next():res.sendStatus(403);},
  scanBatchReporter:{async sendSample(){calls++;return result;}}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const send=async(who='admin')=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/automation-centre/scan-batch-report/sample',{method:'POST',headers:{Authorization:who}});
  return {status:response.status,body:await response.json().catch(()=>({}))};};
 assert.equal((await send('operator')).status,403);assert.equal(calls,0);
 assert.deepEqual(await send(),{status:200,body:result});
 assert.equal(audits.at(-1).action,'Send sample A24 Site-wise batch completion report');
 result={batch:null,people:0,sent:0};assert.match((await send()).body.error,/No closed batch/);
 result={batch:'x',people:0,sent:0};assert.match((await send()).body.error,/no MIS login on the owner's mobile number has connected Telegram/);
 result={batch:'x',people:1,sent:0};assert.match((await send()).body.error,/switched OFF/);
});

test('the A24 line has the Send sample to Telegram button',()=>{
 const source=readFileSync(new URL('../src/automation-centre.jsx',import.meta.url),'utf8');
 assert.match(source,/row\.key==='scan-batch-report'&&<button[^>]*onClick=\{\(\)=>void sendSample\(row\)\}>Send sample to Telegram<\/button>/);
 assert.match(source,/request\('\/scan-batch-report\/sample','POST',\{\}\)/);
});

// A MIS login with separate credentials is checked against the MIS route list too (fix, 16 Nov 2026):
// without this the button answered "This MIS menu is not assigned to your login."
test('MIS administrators may send the sample; other MIS logins may not',async()=>{
 const {misRequestAllowed}=await import('../shared/mis-application-access.mjs');
 const session=pages=>({role:'super',permissions:{separateMisCredentials:true,misDesktopAccess:pages}});
 const sample={path:'/api/automation-centre/scan-batch-report/sample',method:'POST'};
 assert.equal(misRequestAllowed(session(['Users & employees']),sample),true);
 assert.equal(misRequestAllowed(session(['Reports']),sample),false);
 assert.equal(misRequestAllowed(session(['Users & employees']),{...sample,method:'GET'}),false);
});
