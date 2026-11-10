import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {registerVlbBatches} from '../server/routes/vlb-batches.mjs';

// Every open batch screen asks for the batch list every 4 s. On 11 Nov 2026 that was 865 reads in
// 9 minutes at 2.7 s each. Requests close together share one read, and a batch action clears it.
test('batch list requests share one recent database read; a batch action clears it; site access still applies',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT,site TEXT,book_date DATE,data JSONB,revision INTEGER DEFAULT 1,created_by TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),deleted_at TIMESTAMPTZ)');
 let listReads=0;
 const query=(sql,args)=>{
  if(/^SELECT b\.\*,b\.book_date::text AS report_date,\(SELECT count/.test(sql))listReads++;
  return sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 const protect=[(req,res,next)=>{const user=req.headers.authorization;req.session={login:user,role:'normal',permissions:{}};req.logBookScope={sites:user==='restricted'?['sasti oc']:null};next()}];
 registerVlbBatches(app,{pool,protect,ensureBooks:async()=>{},getActor:async s=>({login:s.login,mis:true,pm:false,pmScope:{sites:[]}})});
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(path='',body,user='alice')=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/vlb-batches'+path,{method:body?'POST':'GET',headers:{Authorization:user,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};

 assert.equal((await call()).status,200);
 const before=listReads;
 const lists=await Promise.all(['alice','bob','carol','dave'].map(user=>call('',undefined,user)));
 assert.ok(lists.every(r=>r.status===200&&Array.isArray(r.data.batches)));
 assert.equal(listReads,before,'a list read a moment ago is reused by everyone');

 const id=randomUUID();
 await db.query("INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,request_key) VALUES($1,'Jayant OB 31-12 S1',$2,'2026-12-31','S1',1,'alice',$3)",[id,'Jayant OB',randomUUID()]);
 await call('',{site:''});
 const after=await call('',undefined,'bob');
 assert.ok(listReads>before,'a batch action makes the next list read again');
 assert.ok(after.data.batches.some(b=>b.id===id),'the batch appears after a batch action');
 const restricted=await call('',undefined,'restricted');
 assert.ok(!restricted.data.batches.some(b=>b.id===id),'other sites stay hidden');
});
