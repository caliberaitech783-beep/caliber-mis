import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {registerVlbBatches} from '../vlb-batches.mjs';
import {enforceContentDeletionPolicy} from '../content-deletion-policy.mjs';
import {withVlbTripHandovers} from '../vlb-trip-handover.mjs';
import {misRequestAllowed} from '../mis-application-access.mjs';

process.env.VLB_TWO_STAGE_BATCHES='0'; // legacy single-step batch expectations
async function setup(t){
 const connectionString=process.env.DELETION_TEST_DATABASE_URL;
 let db,pool;
 if(connectionString){
  const target=new URL(connectionString);assert.ok(['127.0.0.1','localhost'].includes(target.hostname)&&target.pathname==='/caliber_mis','Use only the isolated local test database.');
  const schema='vlb_recovery_'+randomUUID().replaceAll('-',''),bootstrap=new pg.Client({connectionString});await bootstrap.connect();await bootstrap.query('CREATE SCHEMA '+schema);await bootstrap.end();
  pool=new pg.Pool({connectionString,max:6,options:'-c search_path='+schema});db={query:(...args)=>pool.query(...args),exec:sql=>pool.query(sql)};
  t.after(async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end()});
 }else{db=new PGlite();t.after(()=>db.close());}

 await db.exec(`CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_no TEXT,book_type TEXT,site TEXT,book_date DATE,data JSONB,revision INTEGER DEFAULT 1,created_by TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),deleted_at TIMESTAMPTZ);
 CREATE TABLE mis_scan_batches(id UUID PRIMARY KEY,kind TEXT,name TEXT,expected_context JSONB);
 CREATE TABLE mis_scan_cards(id UUID PRIMARY KEY,batch_id UUID REFERENCES mis_scan_batches(id),ordinal INT,filename TEXT,status TEXT,revision INT,logbook_id BIGINT REFERENCES mis_log_books(id),image BYTEA,image_hash TEXT,image_blob_key TEXT,draft JSONB,raw_fields JSONB,UNIQUE(batch_id,ordinal));
 CREATE TABLE mis_scan_backup_items(backup_id UUID,card_id UUID,blob_key TEXT,image_hash TEXT,metadata JSONB,PRIMARY KEY(backup_id,card_id));`);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 pool??={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());app.use(enforceContentDeletionPolicy);
 const session=(req,res,next)=>{req.session={login:req.headers.authorization||'alice'};req.logBookScope={sites:req.session.login==='other-site'?['jayant ob']:['sasti ob']};next()};
 let otp,sendFail=false,removed=[];
 const recovery=registerVlbBatches(app,{pool,protect:[session],ensureBooks:async()=>{},getActor:async session=>({login:session.login,mis:session.login!=='viewer',pm:session.login==='viewer',pmScope:{sites:[]}}),sendOtp:async input=>{otp=input.otp;return sendFail?{sent:false}:{sent:true,messageId:'test'}},imageStorage:{stat:async()=>({exists:true,etag:'v1',sha256:'hash'}),remove:async key=>removed.push(key)}});
 t.after(recovery.stop);
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(path,method='GET',body,user='alice')=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method,headers:{Authorization:user,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()}};
 const create=async(shift='S1')=>{const r=await call('vlb-batches','POST',{site:'Sasti OC',date:'2026-12-30',shift,requestKey:randomUUID()});assert.equal(r.status,201,JSON.stringify(r.data));return r.data};
 const add=async(b,{scan=true,loading='08:00',unloading='',hash='hash'}={})=>{
  const scanId=randomUUID(),scanBatch=randomUUID(),data={location:b.site,bookDate:b.report_date,bookShiftCode:b.shift,door:'V05',timeMode:'with',trips:[{equipmentName:'V5',loadingTime:loading,unloadingTime:unloading,tripCount:1}],...(scan?{scanCardId:scanId,scanBatchId:scanBatch}:{})};
  const row=(await db.query("INSERT INTO mis_log_books(book_no,book_type,site,book_date,data,created_by) VALUES($1,'vehicle',$2,$3,$4,'alice') RETURNING *",['VLB/'+randomUUID(),b.site,b.report_date,JSON.stringify(data)])).rows[0];
  await db.query('INSERT INTO mis_vlb_batch_entries(batch_id,logbook_id,snapshot) VALUES($1,$2,$3)',[b.id,row.id,JSON.stringify(row)]);
  if(scan){await db.query("INSERT INTO mis_scan_batches VALUES($1,'vehicle','upload',$2)",[scanBatch,JSON.stringify({location:b.site,bookDate:b.report_date,cardShift:({S1:'I',S2:'II',D:'Day',N:'Night'})[b.shift]})]);
   await db.query("INSERT INTO mis_scan_cards VALUES($1,$2,1,'card.png','posted',1,$3,$4,$5,$6,$7,'{}')",[scanId,scanBatch,row.id,Buffer.from('source-image'),hash,'vehicle/'+scanId,JSON.stringify(data)]);
  }
  return {...row,scanId,scanBatch};
 };
 const preview=async(b,operation='delete',user='alice')=>call('vlb-batch-deletions/preview','POST',{batchId:b.id,operation,reason:'Correct testing batch'},user);
 const send=async p=>call('vlb-batch-deletions/'+p.id+'/otp','POST',{approval:p.approval,deleteReplacement:true});
 const confirm=async(p,patch={})=>call('vlb-batch-deletions/'+p.id+'/confirm','POST',{approval:p.approval,deleteReplacement:true,otp,...patch});
 const execute=async(b,operation='delete')=>{const p=await preview(b,operation);assert.equal(p.status,200,JSON.stringify(p.data));const s=await send(p.data);assert.equal(s.status,200,JSON.stringify(s.data));const r=await confirm(p.data);assert.equal(r.status,200,JSON.stringify(r.data));return r};
 return {db,pool,call,create,add,preview,send,confirm,execute,recovery,removed,otp:()=>otp,failSend:(on=true)=>sendFail=on};
}

test('whole batch deletion retains images for 240 hours, releases scope, and restoration swaps replacements atomically',async t=>{
 const h=await setup(t),old=await h.create(),card=await h.add(old);
 await h.db.query("INSERT INTO mis_scan_backup_items VALUES($1,$2,$3,'hash',$4)",[randomUUID(),card.scanId,'vehicle/'+card.scanId,JSON.stringify({logbookId:card.id})]);
 const unsaved=randomUUID();await h.db.query("INSERT INTO mis_scan_cards VALUES($1,$2,2,'draft.png','review',1,NULL,$3,'draft-hash',NULL,'{}','{}')",[unsaved,card.scanBatch,Buffer.from('draft-image')]);
 const p=await h.preview(old);assert.equal(p.status,200,JSON.stringify(p.data));assert.equal(p.data.manifest.target.records.length,1);assert.equal(p.data.manifest.target.scans.length,2);
 assert.equal((await h.confirm(p.data)).status,403,'no OTP cannot delete');
 assert.equal((await h.send(p.data)).status,200);
 const first=h.otp(),again=await h.send(p.data);assert.equal(again.status,200);assert.equal(again.data.alreadySent,true,'a repeat click reuses the delivered OTP');assert.equal(h.otp(),first);
 assert.equal(Math.round((new Date(again.data.validUntil)-new Date(again.data.sentAt))/60000),10,'one OTP is valid for 10 minutes from sending');
 await h.db.query("UPDATE mis_vlb_batch_deletions SET otp_requested_at=otp_requested_at-INTERVAL '5 minutes',delivered_at=delivered_at-INTERVAL '5 minutes' WHERE id=$1",[p.data.id]);
 const later=await h.send(p.data);assert.equal(later.data.alreadySent,true,'minutes later the same OTP is still the one to use');assert.equal(h.otp(),first);
 assert.equal((await h.confirm(p.data,{otp:'000000'})).status,400);
 assert.equal((await h.confirm(p.data)).status,200);
 assert.equal((await h.call('vlb-batches/'+old.id)).status,404);
 assert.equal((await h.db.query('SELECT id FROM mis_scan_cards')).rows.length,0);
 assert.equal((await h.db.query('SELECT * FROM mis_scan_backup_items')).rows.length,0);
 assert.equal(h.removed.length,0,'source blobs must not be removed during retention');
 await assert.rejects(()=>h.db.query("UPDATE mis_scan_batches SET expected_context='{}' WHERE id=$1",[card.scanBatch]),/deleted VLB batch/);
 await assert.rejects(()=>h.db.query("INSERT INTO mis_scan_cards(id,batch_id) VALUES($1,$2)",[randomUUID(),card.scanBatch]),/deleted VLB batch/);
 const deleted=(await h.call('vlb-batch-deletions')).data.batches[0];assert.ok(deleted.can_restore);assert.ok(Math.abs((new Date(deleted.restore_until)-new Date(deleted.deleted_at))-240*3600000)<1000);
 const replacement=await h.create();assert.notEqual(replacement.id,old.id);assert.match(replacement.name,/B02$/);const replacementCard=await h.add(replacement);
 const restore=await h.preview(old,'restore');assert.equal(restore.status,200,JSON.stringify(restore.data));assert.equal(restore.data.manifest.target.batch.id,replacement.id);assert.equal(restore.data.requiresReplacementDeletion,true);
 assert.equal((await h.call('vlb-batch-deletions/'+restore.data.id+'/otp','POST',{approval:restore.data.approval})).status,400);
 assert.equal((await h.send(restore.data)).status,200);
 // Force a restoration failure after replacement deletion: the whole transaction must roll back.
 await h.db.exec(`CREATE FUNCTION fail_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test restore failure'; END $$; CREATE TRIGGER fail_restore BEFORE INSERT ON mis_scan_cards FOR EACH ROW EXECUTE FUNCTION fail_restore();`);
 assert.equal((await h.confirm(restore.data)).status,500);
 assert.equal((await h.call('vlb-batches/'+replacement.id)).status,200);
 assert.equal((await h.db.query('SELECT deleted_at FROM mis_log_books WHERE id=$1',[replacementCard.id])).rows[0].deleted_at,null);
 await h.db.exec('DROP TRIGGER fail_restore ON mis_scan_cards');
 assert.equal((await h.confirm(restore.data)).status,200);
 const active=(await h.call('vlb-batches/'+old.id)).data;assert.equal(active.id,old.id);assert.ok(active.closed_at);assert.equal(String(active.records[0].id),String(card.id));
 const image=(await h.db.query('SELECT image FROM mis_scan_cards WHERE id=$1',[card.scanId])).rows[0].image;assert.equal(Buffer.from(image).toString(),'source-image');
 assert.equal((await h.db.query('SELECT * FROM mis_scan_backup_items')).rows.length,1);
 assert.equal((await h.call('vlb-batches/'+replacement.id)).status,404);
 assert.ok((await h.call('vlb-batch-deletions')).data.batches.find(b=>b.id===replacement.id).can_restore);
 assert.equal((await h.confirm(restore.data)).status,409,'completed requests cannot be replayed');
 await h.recovery.cleanupExpired();assert.equal(h.removed.length,0);
});

test('scope authorization, stale previews, extraction, OTP failure, and expiry fail without data loss',async t=>{
 const h=await setup(t),b=await h.create(),card=await h.add(b);
 assert.equal((await h.preview(b,'delete','viewer')).status,403);
 assert.equal((await h.preview(b,'delete','other-site')).status,404);
 const p=await h.preview(b);await h.db.query('UPDATE mis_log_books SET revision=revision+1 WHERE id=$1',[card.id]);assert.equal((await h.send(p.data)).status,409);
 await h.db.query("UPDATE mis_scan_cards SET status='reading' WHERE id=$1",[card.scanId]);assert.equal((await h.preview(b)).status,409);await h.db.query("UPDATE mis_scan_cards SET status='posted' WHERE id=$1",[card.scanId]);
 const fresh=await h.preview(b);h.failSend();assert.equal((await h.send(fresh.data)).status,503);assert.equal((await h.confirm(fresh.data)).status,403);
 h.failSend(false);assert.equal((await h.send(fresh.data)).status,200,'a failed delivery does not start the one-minute cooldown');assert.equal((await h.send(fresh.data)).data.alreadySent,true);
 await h.db.query('UPDATE mis_vlb_batch_deletions SET delivered_at=NULL WHERE id=$1',[fresh.data.id]);const wait=await h.send(fresh.data);assert.equal(wait.status,429);assert.match(wait.data.error,/Wait \d+ more seconds/);
 await h.db.query("UPDATE mis_vlb_batch_deletions SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[fresh.data.id]);assert.equal((await h.send(fresh.data)).status,409);
 assert.equal((await h.call('vlb-batches/'+b.id)).status,200);
});

test('deletion breaks only derived handovers; restoring reconnects without changing entered times',async t=>{
 const h=await setup(t),first=await h.create(),a=await h.add(first,{scan:false});await h.call('vlb-batches/'+first.id+'/close','POST');
 const second=await h.create('S2'),b=await h.add(second,{scan:false,loading:'',unloading:'08:22'});
 const read=async()=>withVlbTripHandovers(h.pool,[(await h.db.query('SELECT * FROM mis_log_books WHERE id=$1',[b.id])).rows[0]]);
 assert.equal((await read())[0].data.trips[0].tripStatus,'closed');
 await h.execute(first);const remaining=(await read())[0];assert.equal(remaining.data.trips[0].tripStatus,'awaiting-loading');assert.equal(remaining.data.trips[0].loadingTime,'');assert.equal(remaining.data.trips[0].unloadingTime,'08:22');
 await h.execute(first,'restore');assert.equal((await read())[0].data.trips[0].tripStatus,'closed');
 assert.equal((await h.db.query('SELECT data FROM mis_log_books WHERE id=$1',[a.id])).rows[0].data.trips[0].unloadingTime,'');
});

test('expired batches cannot restore and purge only their retained data and unreferenced images',async t=>{
 const h=await setup(t),old=await h.create(),card=await h.add(old);await h.execute(old);
 const next=await h.create(),other=await h.add(next,{hash:'other'});
 await h.db.query("UPDATE mis_vlb_batches SET restore_until=NOW()-INTERVAL '1 second' WHERE id=$1",[old.id]);
 assert.equal((await h.preview(old,'restore')).status,409);
 await h.recovery.cleanupExpired();
 assert.ok((await h.db.query('SELECT purged_at FROM mis_vlb_batches WHERE id=$1',[old.id])).rows[0].purged_at);
 assert.equal((await h.db.query('SELECT * FROM mis_vlb_batch_recovery_items WHERE batch_id=$1',[old.id])).rows.length,0);
 assert.deepEqual((await h.db.query('SELECT data FROM mis_log_books WHERE id=$1',[card.id])).rows[0].data,{permanentlyDeleted:true});
 assert.equal((await h.db.query('SELECT deleted_at FROM mis_log_books WHERE id=$1',[other.id])).rows[0].deleted_at,null);
 assert.deepEqual(h.removed,['vehicle/'+card.scanId]);
});

test('a deleted batch can be permanently deleted at once and never restored',async t=>{
 const h=await setup(t),old=await h.create(),card=await h.add(old);
 assert.equal((await h.preview(old,'purge')).status,409,'an active batch must be deleted first');
 await h.execute(old);
 await h.execute(old,'purge');
 const row=(await h.db.query('SELECT purged_at,restore_until>NOW() AS in_window FROM mis_vlb_batches WHERE id=$1',[old.id])).rows[0];
 assert.ok(row.purged_at);assert.equal(row.in_window,true);
 assert.equal((await h.db.query('SELECT * FROM mis_vlb_batch_recovery_items WHERE batch_id=$1',[old.id])).rows.length,0);
 assert.deepEqual((await h.db.query('SELECT data FROM mis_log_books WHERE id=$1',[card.id])).rows[0].data,{permanentlyDeleted:true});
 assert.equal((await h.db.query('SELECT * FROM mis_scan_cards WHERE image_hash=$1',['hash'])).rows.length,0);
 assert.equal((await h.preview(old,'restore')).status,409);
 assert.equal((await h.preview(old,'purge')).status,409);
 await h.recovery.cleanupExpired();
 assert.deepEqual(h.removed,['vehicle/'+card.scanId]);
 assert.equal((await h.call('vlb-batch-deletions')).data.batches.find(b=>b.id===old.id).can_restore,false);
});

test('all deleted batches can be permanently deleted with one approval',async t=>{
 const h=await setup(t);
 assert.equal((await h.preview({id:'all'},'purge-all')).status,409,'nothing to erase yet');
 const first=await h.create('S1'),a=await h.add(first);await h.execute(first);
 const second=await h.create('S2'),b=await h.add(second,{hash:'other'});await h.execute(second);
 const kept=await h.create('S1'),live=await h.add(kept,{hash:'live'});
 const p=await h.preview({id:'all'},'purge-all');assert.equal(p.status,200,JSON.stringify(p.data));
 assert.deepEqual(p.data.manifest.counts,{batches:2,cards:2,scans:2});
 assert.equal((await h.send(p.data)).status,200);
 const r=await h.confirm(p.data);assert.equal(r.status,200,JSON.stringify(r.data));
 for(const id of [first.id,second.id])assert.ok((await h.db.query('SELECT purged_at FROM mis_vlb_batches WHERE id=$1',[id])).rows[0].purged_at);
 for(const id of [a.id,b.id])assert.deepEqual((await h.db.query('SELECT data FROM mis_log_books WHERE id=$1',[id])).rows[0].data,{permanentlyDeleted:true});
 assert.equal((await h.db.query('SELECT deleted_at FROM mis_log_books WHERE id=$1',[live.id])).rows[0].deleted_at,null);
 assert.equal((await h.db.query('SELECT deleted_at FROM mis_vlb_batches WHERE id=$1',[kept.id])).rows[0].deleted_at,null);
 assert.equal((await h.preview({id:'all'},'purge-all')).status,409,'nothing left to erase');
});

test('an active batch and its cards can be permanently deleted in one approved step',async t=>{
 const h=await setup(t),b=await h.create(),card=await h.add(b);
 const p=await h.preview(b,'erase');assert.equal(p.status,200,JSON.stringify(p.data));assert.equal(p.data.manifest.target.records.length,1);assert.match(p.data.impact,/no 10-day restore window/);
 assert.equal((await h.send(p.data)).status,200);assert.equal((await h.confirm(p.data)).status,200);
 assert.equal((await h.call('vlb-batches/'+b.id)).status,404);
 assert.ok((await h.db.query('SELECT purged_at FROM mis_vlb_batches WHERE id=$1',[b.id])).rows[0].purged_at);
 assert.equal((await h.db.query('SELECT * FROM mis_vlb_batch_recovery_items WHERE batch_id=$1',[b.id])).rows.length,0);
 assert.deepEqual((await h.db.query('SELECT data FROM mis_log_books WHERE id=$1',[card.id])).rows[0].data,{permanentlyDeleted:true});
 assert.equal((await h.db.query('SELECT * FROM mis_scan_cards')).rows.length,0);
 assert.equal((await h.preview(b,'restore')).status,409);
 await h.recovery.cleanupExpired();assert.deepEqual(h.removed,['vehicle/'+card.scanId]);
 const fresh=await h.create();assert.equal((await h.call('vlb-batches/'+fresh.id)).status,200,'the same site, date and shift can be batched again');
});

test('new recovery endpoints require VLB application access',()=>{
 const session={permissions:{separateMisCredentials:true,misDesktopAccess:['Vehicle Log Book']}};
 assert.ok(misRequestAllowed(session,{path:'/api/vlb-batch-deletions/preview',method:'POST'}));
 assert.equal(misRequestAllowed({...session,permissions:{...session.permissions,misDesktopAccess:['Equipment Log Book']}},{path:'/api/vlb-batch-deletions/preview',method:'POST'}),false);
});

test('PostgreSQL serializes concurrent restores and consumes one approval only',{skip:!process.env.DELETION_TEST_DATABASE_URL},async t=>{
 const h=await setup(t),b=await h.create();await h.add(b);await h.execute(b);
 const p=(await h.preview(b,'restore')).data;assert.equal((await h.send(p)).status,200);
 const attempts=await Promise.all([h.confirm(p),h.confirm(p)]);assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
 assert.equal((await h.db.query('SELECT count(*)::int AS n FROM mis_vlb_batches WHERE deleted_at IS NULL')).rows[0].n,1);
 assert.equal((await h.db.query('SELECT count(*)::int AS n FROM mis_scan_cards')).rows[0].n,1);
});
