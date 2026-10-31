import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {registerLogBooks,insertLogBook,resolveLogBookData,LOG_BOOK_SCHEMA} from '../log-book.mjs';
import {vlbBatchActor,batchPmAtSite} from '../vlb-batch-access.mjs';
import {VLB_BATCH_SCHEMA,matchingVlbBatch} from '../vlb-batch-policy.mjs';

test('live saves auto-attach, closure blocks writes, and only the site-PM-approved MIS user can amend once',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB)');
 const masters=[
 [1,'Equipment master',{category:'Vehicle',door:'V07',currentLocation:'Sasti OC',equipmentName:'Tipper'}],
 [2,'C-Dir Employee master',{employee:'Driver',employeeId:'EMP1',site:'Sasti OC'}],
 [3,'Shift Master',{site:'Sasti OC',shiftName:'Shift A',shiftCode:'I'}],
 [4,'Shift Master',{site:'Sasti OC',shiftName:'Shift B',shiftCode:'II'}],
 [10,'Users & employees',{login:'alice',userType:'Mobile User',userGroup:'MIS User',site:'Sasti OC'}],
 [11,'Users & employees',{login:'bob',userType:'Mobile User',userGroup:'MIS User',site:'Sasti OC'}],
 [12,'Users & employees',{login:'pm',userType:'Super User',adminLevel:'Manager',managerRole:'Project Manager',managerSites:'Sasti OC'}],
 [13,'Users & employees',{login:'production',userType:'Super User',adminLevel:'Manager',managerRole:'Production Manager',managerSites:'Sasti OC'}],
 [14,'Users & employees',{login:'wrongpm',userType:'Super User',adminLevel:'Manager',managerRole:'Project Manager',managerSites:'Jayant OC'}],
 [15,'Users & employees',{login:'dual',userType:'Super User',adminLevel:'Manager',managerRole:'Project Manager',userRoles:['MIS User'],managerSites:'Sasti OC'}],
 ];for(const [id,name,row] of masters)await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[id,name,JSON.stringify(row)]);
 const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 const requireSession=(req,res,next)=>{const login=req.headers.authorization;if(!login)return res.status(401).json({error:'Sign in'});req.session={login,role:'super',permissions:{adminLevel:'Admin',separateMisCredentials:true,misDesktopAccess:['Vehicle Log Book']}};next()};
 registerLogBooks(app,{pool,requireSession,requireAdministrator:(_req,_res,next)=>next(),getSiteScope:async s=>({sites:s.login==='wrongpm'?['jayant ob']:['sasti ob']})});
 app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(path,method='GET',body,user='alice')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{Authorization:user,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()}};
 const input={bookDate:'2026-10-30',location:'Sasti OC',assetId:1,employeeId:2,shiftId:3,cardShift:'I',shiftHours:8,openingKmr:0,closingKmr:10,openingHmr:100,closingHmr:106,manualBreakdownHours:0,timeMode:'without',trips:[{equipmentName:'VPC28',tripCount:2}]};
 const save=async(patch={},user='alice')=>call('/api/log-books/vehicle','POST',{...input,...patch,requestKey:randomUUID()},user);
 const seed=await save();assert.equal(seed.status,201,JSON.stringify(seed.data));
 const createBody={site:'Sasti OC',date:'2026-10-30',shift:'S1',requestKey:randomUUID()};
 const created=await call('/api/vlb-batches','POST',createBody);assert.equal(created.status,201,JSON.stringify(created.data));const path='/api/vlb-batches/'+created.data.id;
 assert.equal(created.data.entry_count,1);
 const manual=await save({},'bob');assert.equal(manual.status,201,JSON.stringify(manual.data));
 const scan=async(user='alice')=>{await db.exec('BEGIN');try{const data={...await resolveLogBookData(pool,'vehicle',input),scanCardId:randomUUID()};const result=await insertLogBook(pool,'vehicle',data,randomUUID(),user);await db.exec('COMMIT');return result}catch(e){await db.exec('ROLLBACK');throw e}};
 const scanned=await scan();let batch=(await call(path)).data;assert.equal(batch.entry_count,3);assert.ok(batch.records.some(r=>r.id===scanned.id&&r.data.scanCardId));assert.ok(batch.records.some(r=>r.id===manual.data.id&&!r.data.scanCardId));
 assert.equal((await call('/api/vlb-batches','POST',{...createBody,requestKey:randomUUID()},'bob')).status,409);
 const edit=await call('/api/log-books/vehicle/'+manual.data.id,'PUT',{...input,remark:'Checked while open',revision:1},'bob');assert.equal(edit.status,200,JSON.stringify(edit.data));assert.equal((await call(path)).data.records.find(r=>r.id===manual.data.id).data.remark,'Checked while open');
 assert.equal((await call('/api/log-books/vehicle/'+manual.data.id,'PUT',{...input,bookDate:'2026-10-29',revision:2},'bob')).status,409,'batched cards cannot be moved to another selection');
 assert.equal((await call(path+'/close','POST',{})).status,200);
 const countBefore=Number((await db.query('SELECT count(*) AS n FROM mis_log_books')).rows[0].n);
 assert.equal((await save()).status,409);await assert.rejects(()=>scan(),/closed/);assert.equal(Number((await db.query('SELECT count(*) AS n FROM mis_log_books')).rows[0].n),countBefore);
 assert.equal((await call('/api/log-books/vehicle/'+manual.data.id,'PUT',{...input,revision:2},'bob')).status,409);
 assert.equal((await call('/api/vlb-batches','POST',{...createBody,requestKey:randomUUID()})).status,409,'closed scopes cannot get B02');
 const s2=await save({shiftId:4,cardShift:'II'});assert.equal(s2.status,201);assert.equal((await call(path)).data.entry_count,3,'next shift stays unbatched');
 const req=await call(path+'/reopen-request','POST',{reason:'Additional cards received after closure'});assert.equal(req.status,200);assert.equal((await call(path+'/reopen-request','POST',{reason:'Retry reason'})).data.id,req.data.id);
 assert.equal((await call(path+'/reopen','POST',{})).status,403);
 assert.equal((await call(path+'/reopen-decision','POST',{requestId:req.data.id,decision:'approve'},'production')).status,403,'Production Manager is not PM');
 assert.equal((await call(path+'/reopen-decision','POST',{requestId:req.data.id,decision:'approve'},'wrongpm')).status,404,'another site PM cannot even view this batch');
 const dualReq=await call(path+'/reopen-request','POST',{reason:'Dual-role correction needed'},'dual');assert.equal(dualReq.status,200);assert.equal((await call(path+'/reopen-decision','POST',{requestId:dualReq.data.id,decision:'approve'},'dual')).status,403,'no self approval');
 assert.equal((await call(path+'/reopen-decision','POST',{requestId:req.data.id,decision:'reject',note:'Please check the additional cards'},'pm')).status,200);
 assert.equal((await call(path+'/reopen','POST',{})).status,403);
 const req2=await call(path+'/reopen-request','POST',{reason:'Additional card details checked'});assert.notEqual(req2.data.id,req.data.id);
 assert.equal((await call(path+'/reopen-decision','POST',{requestId:req2.data.id,decision:'approve'},'pm')).status,200);
 await db.query("UPDATE master_records SET record_data=jsonb_set(record_data,'{managerSites}','\"Jayant OC\"') WHERE id=12");
 assert.equal((await call(path+'/reopen','POST',{})).status,403,'approval cannot be used after PM loses that site');
 assert.equal((await call(path)).data.approvalExpired,true);
 const replacement=await call(path+'/reopen-request','POST',{reason:'Current site PM approval required'});assert.equal(replacement.status,200);assert.notEqual(replacement.data.id,req2.data.id);
 await db.query("UPDATE master_records SET record_data=jsonb_set(record_data,'{managerSites}','\"Sasti OC\"') WHERE id=12");
 assert.equal((await call(path+'/reopen-decision','POST',{requestId:replacement.data.id,decision:'approve'},'pm')).status,200);
 assert.equal((await call(path+'/reopen','POST',{},'bob')).status,403,'another MIS user cannot consume approval');
 const reopened=await call(path+'/reopen','POST',{});assert.equal(reopened.status,200,JSON.stringify(reopened.data));assert.equal(reopened.data.name,created.data.name);assert.equal(reopened.data.amendment_by,'alice');
 assert.equal((await save({},'bob')).status,403);await assert.rejects(()=>scan('bob'),/another MIS user/);
 assert.equal((await call('/api/log-books/vehicle/'+manual.data.id,'PUT',{...input,revision:2},'bob')).status,403);
 assert.equal((await save()).status,201);await scan();
 const amended=await call('/api/log-books/vehicle/'+manual.data.id,'PUT',{...input,remark:'Approved amendment',revision:2});assert.equal(amended.status,200,JSON.stringify(amended.data));
 batch=(await call(path)).data;assert.equal(batch.entry_count,5);assert.equal(batch.records.find(r=>r.id===manual.data.id).data.remark,'Approved amendment');assert.ok(batch.audit.some(e=>e.action==='card_updated'));assert.ok(batch.audit.some(e=>e.action==='reopened'));assert.ok(batch.audit.some(e=>e.action==='reopen_rejected'));
 assert.equal((await call(path+'/close','POST',{})).status,200);assert.equal((await call(path+'/reopen','POST',{})).status,403,'used approvals are invalid for the next closure');assert.equal((await save()).status,409);
 await assert.rejects(()=>db.query("INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,request_key,closed_at) VALUES($1,'duplicate','sasti ob','2026-10-30','S1',2,'other',$2,NOW())",[randomUUID(),randomUUID()]),/already exists/,'database guard rejects duplicate batches');
 const pm=await vlbBatchActor(pool,{login:'pm'});assert.ok(batchPmAtSite(pm,'Sasti OC'));assert.equal(batchPmAtSite(pm,'Jayant OC'),false);
 const production=await vlbBatchActor(pool,{login:'production'});assert.equal(production.pm,false);
 await db.query("UPDATE master_records SET record_data=record_data||'{\"sourceMissing\":true}'::jsonb WHERE id=12");assert.equal((await vlbBatchActor(pool,{login:'pm'})).pm,false,'missing source users cannot act as PM');
 // Reapplying the migration leaves all saved card IDs and audit rows intact.
 await db.exec(LOG_BOOK_SCHEMA);assert.equal((await call(path)).data.entry_count,5);
});
test('legacy duplicate batches are preserved and blocked for separate review',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY);CREATE TABLE mis_vlb_batches(id UUID PRIMARY KEY,name TEXT UNIQUE,site TEXT,book_date DATE,shift TEXT,sequence INTEGER,created_by TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),closed_at TIMESTAMPTZ,request_key UUID)');
 for(let n=1;n<=2;n++)await db.query("INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,closed_at,request_key) VALUES($1,$2,'sasti ob','2026-10-30','S1',$3,'old',NOW(),$4)",[randomUUID(),'Legacy B0'+n,n,randomUUID()]);
 await db.exec(VLB_BATCH_SCHEMA);assert.equal(Number((await db.query('SELECT count(*) AS n FROM mis_vlb_batches')).rows[0].n),2);
 await assert.rejects(()=>matchingVlbBatch(db,{location:'Sasti OC',bookDate:'2026-10-30',bookShiftCode:'S1'}),/separate review/);
 assert.equal(Number((await db.query('SELECT count(*) AS n FROM mis_vlb_batches')).rows[0].n),2);
});
