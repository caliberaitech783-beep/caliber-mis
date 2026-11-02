import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerClientErrorReports,normalizeClientErrorReport,createReportLimiter,scrubReportUrl,formatClientErrorLog} from '../client-error-report.mjs';

test('browser error reports are normalised, scrubbed and bounded',()=>{
 assert.equal(normalizeClientErrorReport(null),null);
 assert.equal(normalizeClientErrorReport({message:'   '}),null);
 const report=normalizeClientErrorReport({kind:'bogus',message:'x'.repeat(5000),stack:'s',url:'/?batch=abc&token=secret&card=1',uiVersion:'abc123',screen:'VLB Scan'});
 assert.equal(report.kind,'render');
 assert.equal(report.message.length,2000);
 assert.equal(report.url,'/?batch=abc&token=%5Bremoved%5D&card=1');
 assert.equal(scrubReportUrl('not a url at all'),'/not%20a%20url%20at%20all');
 assert.match(formatClientErrorLog(report,{login:'anoop',serverCommit:'deadbeef'}),/^Browser error \(render\) for anoop on VLB Scan · ui abc123 · server deadbeef: x/);
 let now=0;const allow=createReportLimiter({limit:2,windowMs:1000,now:()=>now});
 assert.ok(allow('a'));assert.ok(allow('a'));assert.equal(allow('a'),false);assert.ok(allow('b'));
 now=1001;assert.ok(allow('a'));
});

test('POST /api/client-errors stores the report for the signed-in user and the server log; GET lists it for administrators',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query};
 const logged=[];
 const app=express();app.use(express.json());
 const requireSession=(req,res,next)=>{const user=req.headers.authorization;if(!user)return res.status(401).json({error:'no session'});req.session={login:user,role:user==='admin'?'super':'normal'};next()};
 const requireAdministrator=(req,res,next)=>req.session.role==='super'?next():res.status(403).json({error:'admin only'});
 registerClientErrorReports(app,{pool,requireSession,requireAdministrator,serverCommit:()=>'abc1234',log:{error:(...parts)=>logged.push(parts.join(' '))}});
 const server=app.listen(0);t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
 const call=(path,method='GET',body,auth='anoop')=>fetch(base+path,{method,headers:{...(auth?{Authorization:auth}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}).then(async r=>({status:r.status,data:await r.json()}));
 assert.equal((await call('/api/client-errors','POST',{message:'boom'},'')).status,401);
 assert.equal((await call('/api/client-errors','POST',{})).status,400);
 const stored=await call('/api/client-errors','POST',{kind:'render',message:"Cannot read properties of undefined (reading 'length')",stack:'TypeError: ...\n at ScanPage',componentStack:'\n at ScanDuplicateList',url:'/?batch=b1&token=xyz',uiVersion:'1111111',screen:'Caliber Pulse-II — VLB Scan'});
 assert.equal(stored.status,200);assert.equal(stored.data.recorded,true);
 assert.equal(logged.length,1);
 assert.match(logged[0],/Browser error \(render\) for anoop on Caliber Pulse-II — VLB Scan · ui 1111111 · server abc1234: Cannot read properties/);
 assert.match(logged[0],/at ScanDuplicateList/);
 assert.equal((await call('/api/client-errors')).status,403);
 const listed=await call('/api/client-errors','GET',null,'admin');
 assert.equal(listed.status,200);assert.equal(listed.data.errors.length,1);
 const row=listed.data.errors[0];
 assert.equal(row.login,'anoop');assert.equal(row.server_commit,'abc1234');assert.equal(row.url,'/?batch=b1&token=%5Bremoved%5D');
 assert.equal(row.component_stack,'\n at ScanDuplicateList');
});
