import {randomUUID,randomInt,createHash,timingSafeEqual} from 'node:crypto';
import {canonicalSiteName} from './site-location.mjs';
import {vlbRecordShift} from './vlb-batch-format.mjs';
import {batchFail as fail,auditVlbBatch,lockVlbBatchWrites,matchingVlbBatch} from './vlb-batch-policy.mjs';
import {siteAllowed} from './log-book-access.mjs';
import {scopeHash} from './log-book-deletion-scope.mjs';
import {DELETION_PHONE} from './log-book-deletion-api.mjs';
import {decodeScanRow} from './scan-text-storage.mjs';

const uuid=v=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v||'');
const digest=(id,otp)=>createHash('sha256').update(`${id}:${otp}`).digest('hex');
const exists=async(c,name)=>Boolean((await c.query('SELECT to_regclass($1) AS name',[name])).rows[0].name);
const sameScope=(b,d)=>canonicalSiteName(b.site)===canonicalSiteName(d?.location)&&b.report_date===d?.bookDate&&b.shift===vlbRecordShift(d||{});
const approval=row=>`Approve ${row.operation} ${row.id} ${scopeHash(row.manifest).slice(0,12)}`;
const purgeImpact='The deleted batch is erased now instead of at the end of its 10-day restore window. Its retained VLB entries, scans and source images are removed permanently and it can no longer be restored, so the same cards can be scanned fresh. Existing downloaded exports, SSD copies and platform backups are outside this application action.';
const eraseImpact='The selected batch and all its saved VLB entries, unsaved scans and source images are erased now, with no 10-day restore window. Nothing can be restored afterwards, so the same cards can be scanned fresh. Other shifts keep their entered values; trip links and totals recalculate. Existing downloaded exports, SSD copies and platform backups are outside this application action.';
const impact='The selected batch and its saved VLB entries, unsaved scans and source images leave active use. They can be restored for 240 hours after deletion. After that, application recovery expires and retained application data is purged. Other shifts keep their entered values; trip links and totals recalculate. Existing downloaded exports, SSD copies and platform backups are outside this application action.';

export function registerVlbBatchDeletions(app,{pool,protect,handle,ensure,sendOtp,imageStorage}){
 async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(709224102)');await lockVlbBatchWrites(c);const value=await fn(c);await c.query('COMMIT');return value}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 function authorize(req){req.audit=false;if(!req.batchActor.canCreate)fail('Only authorized MIS users or administrators can delete or restore a batch.',403)}
 async function batch(c,id,req,deleted=false,purge=false){
  if(!uuid(id))fail('Invalid batch ID.',400);
  const b=(await c.query('SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!b||!siteAllowed(req.logBookScope,b.site)||b.report_date<'2026-11-01')fail('Batch is unavailable.',404);
  if(purge){if(!b.deleted_at||b.purged_at)fail('Only a deleted batch that is not yet erased can be deleted permanently.');}
  else if(deleted){if(!b.deleted_at||b.purged_at||(await c.query('SELECT $1::timestamptz<=clock_timestamp() AS expired',[b.restore_until])).rows[0].expired)fail('The 10-day restore window has expired or this batch is no longer deleted.');}
  else if(b.deleted_at||b.archived_at)fail('Batch is no longer active.');
  return b;
 }
 async function scope(c,b){
  const records=(await c.query('SELECT l.*,md5(to_jsonb(l)::text) AS fingerprint FROM mis_log_books l JOIN mis_vlb_batch_entries e ON e.logbook_id=l.id WHERE e.batch_id=$1 ORDER BY l.id FOR UPDATE OF l',[b.id])).rows;
  if(records.some(r=>r.deleted_at))fail('This batch includes an independently deleted record. Resolve that deletion before deleting the complete batch.');
  const ids=records.map(r=>String(r.id)),linked=records.map(r=>r.data?.scanCardId).filter(Boolean);
  let scans=[],scanBatches=[];
  if(await exists(c,'mis_scan_cards')){
   const candidates=(await c.query("SELECT * FROM mis_scan_batches WHERE kind='vehicle' AND NOT(COALESCE(expected_context,'{}'::jsonb) ? 'deletedVlbBatch') ORDER BY id")).rows;
   const contextual=candidates.filter(s=>sameScope(b,s.expected_context)).map(s=>s.id);
   scans=(await c.query("SELECT c.id,c.batch_id,c.ordinal,c.filename,c.status,c.revision,c.logbook_id,c.image_hash,c.image_blob_key,c.draft,md5((to_jsonb(c)-'image')::text) AS fingerprint FROM mis_scan_cards c WHERE c.batch_id=ANY($1::uuid[]) OR c.logbook_id=ANY($2::bigint[]) OR c.id::text=ANY($3::text[]) ORDER BY c.id FOR UPDATE",[contextual,ids,linked])).rows;
   // Include duplicate image copies only when no other saved batch owns them.
   if(scans.length){const duplicates=(await c.query("SELECT c.id,c.batch_id,c.ordinal,c.filename,c.status,c.revision,c.logbook_id,c.image_hash,c.image_blob_key,c.draft,md5((to_jsonb(c)-'image')::text) AS fingerprint FROM mis_scan_cards c WHERE c.image_hash=ANY($1::text[]) ORDER BY c.id FOR UPDATE",[scans.map(s=>s.image_hash)])).rows;scans=[...new Map([...scans,...duplicates].map(s=>[s.id,s])).values()].sort((a,b)=>a.id.localeCompare(b.id));}
   if(scans.some(s=>!candidates.some(b=>b.id===s.batch_id)))fail('A duplicate image belongs to another kind of upload. Resolve that ownership first.');
   if(scans.some(s=>s.logbook_id&&!ids.includes(String(s.logbook_id))))fail('A matching scan belongs to another saved record. No batch was changed; resolve its ownership first.');
   if(scans.some(s=>s.status==='reading'))fail('Extraction is still running for this batch. Wait for it to finish, then prepare deletion again.');
   scanBatches=candidates.filter(s=>contextual.includes(s.id)||scans.some(c=>c.batch_id===s.id));
   // A scan upload is indivisible: never delete another scope through an upload containing mixed data.
   for(const s of scanBatches){if(!sameScope(b,s.expected_context))fail('A linked upload has a different site, date or shift. Resolve that upload before deleting this batch.');}
   const all=(await c.query('SELECT id FROM mis_scan_cards WHERE batch_id=ANY($1::uuid[]) ORDER BY id',[scanBatches.map(s=>s.id)])).rows;
   if(all.some(s=>!scans.some(x=>x.id===s.id)))fail('A linked upload contains cards outside this batch. Resolve its ownership first.');
  }
  const backups=await exists(c,'mis_scan_backup_items')?(await c.query("SELECT backup_id,card_id,md5(to_jsonb(i)::text) AS fingerprint FROM mis_scan_backup_items i WHERE card_id=ANY($1::uuid[]) OR metadata->>'logbookId'=ANY($2::text[]) ORDER BY backup_id,card_id FOR UPDATE",[scans.map(s=>s.id),ids])).rows:[];
  return {batch:{id:b.id,name:b.name,site:b.site,date:b.report_date,shift:b.shift,closedAt:b.closed_at,revision:b.closure_revision},records:records.map(r=>({id:r.id,bookNo:r.book_no,revision:r.revision,fingerprint:r.fingerprint})),scans:scans.map(({draft,...s})=>({...s,door:decodeScanRow({draft}).draft?.door||''})),scanBatches:scanBatches.map(s=>({id:s.id,context:s.expected_context})),backups};
 }
 async function plan(c,req,operation,id){
  if(operation==='purge-all'){
   // Every deleted, not yet erased batch this user can see; one approval covers the whole list.
   const ids=(await c.query("SELECT id,site FROM mis_vlb_batches WHERE deleted_at IS NOT NULL AND purged_at IS NULL AND book_date>='2026-11-01' ORDER BY deleted_at,id")).rows.filter(b=>siteAllowed(req.logBookScope,b.site)).map(b=>b.id);
   if(!ids.length)fail('There are no deleted batches waiting to be erased.');
   const batches=[];for(const batchId of ids)batches.push(await plan(c,req,'purge',batchId));
   return {batches,counts:{batches:batches.length,cards:batches.reduce((n,b)=>n+(b.original.counts?.cards||0),0),scans:batches.reduce((n,b)=>n+(b.original.counts?.scans||0),0)},target:null};
  }
  const original=await batch(c,id,req,operation==='restore',operation==='purge');
  if(operation==='delete'||operation==='erase')return {original:{id:original.id,name:original.name},target:await scope(c,original)};
  const items=(await c.query('SELECT kind,item_key,md5(payload::text) AS fingerprint FROM mis_vlb_batch_recovery_items WHERE batch_id=$1 ORDER BY kind,item_key',[original.id])).rows;
  if(operation==='purge')return {original:{id:original.id,name:original.name,deletedAt:original.deleted_at,restoreUntil:original.restore_until,counts:original.deleted_counts},items,target:null};
  const replacement=await matchingVlbBatch(c,{location:original.site,bookDate:original.report_date,bookShiftCode:original.shift});
  if(replacement&&!siteAllowed(req.logBookScope,replacement.site))fail('Replacement batch is unavailable.',403);
  return {original:{id:original.id,name:original.name,deletedAt:original.deleted_at,restoreUntil:original.restore_until,counts:original.deleted_counts},items,target:replacement?await scope(c,replacement):null};
 }
 async function retain(c,b,manifest,actor){
  const ids=manifest.records.map(r=>r.id),scans=manifest.scans.map(s=>s.id);
  await c.query("INSERT INTO mis_vlb_batch_recovery_items(batch_id,kind,item_key,payload) SELECT $1,'book',l.id::text,to_jsonb(l) FROM mis_log_books l WHERE l.id=ANY($2::bigint[])",[b.id,ids]);
  if(manifest.scanBatches.length){
   await c.query("INSERT INTO mis_vlb_batch_recovery_items(batch_id,kind,item_key,payload) SELECT $1,'scan-batch',s.id::text,to_jsonb(s) FROM mis_scan_batches s WHERE s.id=ANY($2::uuid[])",[b.id,manifest.scanBatches.map(s=>s.id)]);
   await c.query("INSERT INTO mis_vlb_batch_recovery_items(batch_id,kind,item_key,payload) SELECT $1,'scan',s.id::text,to_jsonb(s) FROM mis_scan_cards s WHERE s.id=ANY($2::uuid[])",[b.id,scans]);
   await c.query("UPDATE mis_scan_batches SET expected_context=expected_context||jsonb_build_object('deletedVlbBatch',$1::text,'cancelled',true) WHERE id=ANY($2::uuid[])",[b.id,manifest.scanBatches.map(s=>s.id)]);
   await c.query('INSERT INTO mis_vlb_deleted_scan_uploads(scan_batch_id,batch_id) SELECT unnest($1::uuid[]),$2',[manifest.scanBatches.map(s=>s.id),b.id]);
   await c.query('DELETE FROM mis_scan_cards WHERE id=ANY($1::uuid[])',[scans]);
  }
  for(const i of manifest.backups){
   await c.query("INSERT INTO mis_vlb_batch_recovery_items(batch_id,kind,item_key,payload) SELECT $1,'backup',backup_id::text||'/'||card_id::text,to_jsonb(i) FROM mis_scan_backup_items i WHERE backup_id=$2 AND card_id=$3",[b.id,i.backup_id,i.card_id]);
   await c.query('DELETE FROM mis_scan_backup_items WHERE backup_id=$1 AND card_id=$2',[i.backup_id,i.card_id]);
  }
  await c.query('UPDATE mis_log_books SET deleted_at=clock_timestamp(),revision=revision+1 WHERE id=ANY($1::bigint[])',[ids]);
  await c.query('DELETE FROM mis_vlb_batch_scopes WHERE batch_id=$1',[b.id]);
  await c.query("UPDATE mis_vlb_batches SET deleted_at=clock_timestamp(),restore_until=clock_timestamp()+INTERVAL '240 hours',deleted_by=$2,archived_at=clock_timestamp(),closed_at=COALESCE(closed_at,clock_timestamp()),amendment_by=NULL,trial_reopened_until=NULL,closure_revision=closure_revision+1,deleted_counts=$3::jsonb WHERE id=$1",[b.id,actor,JSON.stringify({cards:ids.length,scans:scans.length})]);
  await c.query("UPDATE mis_vlb_reopen_requests SET withdrawn_at=clock_timestamp() WHERE batch_id=$1 AND withdrawn_at IS NULL",[b.id]);
  await auditVlbBatch(c,b,actor,'batch_deleted',{cards:ids.length,scans:scans.length,retentionHours:240});
 }
 async function restore(c,b,actor){
  // Keep image bytes inside PostgreSQL instead of materializing an entire batch in Node.
  const items=(await c.query("SELECT item_key,payload->>'id' AS id,payload->'data' AS data,(payload->>'revision')::int AS revision FROM mis_vlb_batch_recovery_items WHERE batch_id=$1 AND kind='book' ORDER BY item_key",[b.id])).rows;
  for(const r of items){
   const current=(await c.query('SELECT deleted_at,data,revision FROM mis_log_books WHERE id=$1 FOR UPDATE',[r.id])).rows[0];
   if(!current?.deleted_at||current.revision!==r.revision+1||scopeHash(current.data)!==scopeHash(r.data))fail('A retained card changed or is missing. Nothing was restored.');
   await c.query('UPDATE mis_log_books SET deleted_at=NULL,revision=revision+1 WHERE id=$1',[r.id]);
   await c.query('UPDATE mis_vlb_batch_entries SET snapshot=(SELECT to_jsonb(l) FROM mis_log_books l WHERE l.id=$2) WHERE batch_id=$1 AND logbook_id=$2',[b.id,r.id]);
  }
  await c.query('DELETE FROM mis_vlb_deleted_scan_uploads WHERE batch_id=$1',[b.id]);
  if(await exists(c,'mis_scan_batches'))await c.query("UPDATE mis_scan_batches s SET expected_context=i.payload->'expected_context' FROM mis_vlb_batch_recovery_items i WHERE i.batch_id=$1 AND i.kind='scan-batch' AND s.id::text=i.item_key",[b.id]);
  if(await exists(c,'mis_scan_cards'))await c.query("INSERT INTO mis_scan_cards SELECT (jsonb_populate_record(NULL::mis_scan_cards,jsonb_set(payload,'{revision}',to_jsonb((payload->>'revision')::int+1)))).* FROM mis_vlb_batch_recovery_items WHERE batch_id=$1 AND kind='scan'",[b.id]);
  if(await exists(c,'mis_scan_backup_items'))await c.query("INSERT INTO mis_scan_backup_items SELECT (jsonb_populate_record(NULL::mis_scan_backup_items,payload)).* FROM mis_vlb_batch_recovery_items WHERE batch_id=$1 AND kind='backup'",[b.id]);
  await c.query('UPDATE mis_vlb_batches SET deleted_at=NULL,deleted_by=NULL,restore_until=NULL,deleted_counts=NULL,archived_at=NULL,closed_at=clock_timestamp(),amendment_by=NULL,trial_reopened_until=NULL,closure_revision=closure_revision+1 WHERE id=$1',[b.id]);
  await c.query('INSERT INTO mis_vlb_batch_scopes(site,book_date,shift,batch_id) VALUES($1,$2,$3,$4)',[b.site,b.report_date,b.shift,b.id]);
  await c.query('DELETE FROM mis_vlb_batch_recovery_items WHERE batch_id=$1',[b.id]);
  await auditVlbBatch(c,b,actor,'batch_restored',{restoredLocked:true});
 }
 // Erase a deleted batch's retained contents, either when its restore window expires or on an approved permanent deletion.
 async function purge(c,b,actor,event){
  const expired=event==='batch_retention_expired';
  const items=(await c.query("SELECT kind,jsonb_build_object('id',payload->>'id','image_blob_key',payload->>'image_blob_key','blob_key',payload->>'blob_key','image_hash',payload->>'image_hash') AS payload FROM mis_vlb_batch_recovery_items WHERE batch_id=$1",[b.id])).rows;
  const ids=items.filter(i=>i.kind==='book').map(i=>String(i.payload.id));
  for(const i of items.filter(i=>['scan','backup'].includes(i.kind))){const key=i.payload.image_blob_key||i.payload.blob_key;if(key)await c.query('INSERT INTO mis_vlb_batch_blob_cleanup(batch_id,blob_key,image_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[b.id,key,i.payload.image_hash]);}
  // Keep FK-compatible tombstone identities; purge the recoverable card contents.
  await c.query('DELETE FROM mis_vlb_batch_entries WHERE batch_id=$1',[b.id]);
  if(await exists(c,'mis_pulse_trip_verifications'))await c.query('DELETE FROM mis_pulse_trip_verifications WHERE logbook_id=ANY($1::bigint[])',[ids]);
  if(await exists(c,'mis_log_book_deletions'))await c.query("UPDATE mis_log_book_deletions SET snapshot=(SELECT COALESCE(jsonb_agg(CASE WHEN s->>'id'=ANY($1::text[]) THEN jsonb_build_object('id',s->>'id','permanentlyDeleted',true) ELSE s END),'[]'::jsonb) FROM jsonb_array_elements(snapshot) s) WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot) s WHERE s->>'id'=ANY($1::text[]))",[ids]);
  await c.query("UPDATE mis_log_books SET data=jsonb_build_object('permanentlyDeleted',true),revision=revision+1 WHERE id=ANY($1::bigint[]) AND deleted_at IS NOT NULL",[ids]);
  await c.query("UPDATE mis_vlb_batch_audit SET detail=jsonb_build_object($2::text,true) WHERE batch_id=$1",[b.id,expired?'retentionExpired':'permanentlyDeleted']);
  await c.query('DELETE FROM mis_vlb_batch_recovery_items WHERE batch_id=$1',[b.id]);
  await c.query('UPDATE mis_vlb_batches SET purged_at=clock_timestamp() WHERE id=$1',[b.id]);
  await auditVlbBatch(c,b,actor,event,expired?{retentionHours:240}:{permanent:true});
 }
 function publicRequest(row){return {id:row.id,operation:row.operation,manifest:row.manifest,approval:approval(row),impact:row.operation.startsWith('purge')?purgeImpact:row.operation==='erase'?eraseImpact:impact,expiresAt:row.expires_at,recipient:'+91 9925565281',requiresReplacementDeletion:Boolean(row.operation==='restore'&&row.manifest.target)}}
 app.get('/api/vlb-batch-deletions',...protect,handle(async(req,res)=>{
  const rows=(await pool.query('SELECT id,name,site,book_date::text AS report_date,shift,deleted_at,deleted_by,restore_until,purged_at,deleted_counts,restore_until>clock_timestamp() AND purged_at IS NULL AS can_restore FROM mis_vlb_batches WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')).rows;
  res.json({batches:rows.filter(b=>siteAllowed(req.logBookScope,b.site))});
 }));
 app.post('/api/vlb-batch-deletions/preview',...protect,handle(async(req,res)=>{
  authorize(req);const {operation,batchId}=req.body,reason=String(req.body.reason||'').trim();
  if(!['delete','restore','purge','purge-all','erase'].includes(operation)||reason.length<5||reason.length>2000)fail('Choose delete, restore or permanent deletion and enter a reason of 5 to 2000 characters.',400);
  const row=await transaction(async c=>{const manifest=await plan(c,req,operation,batchId);return(await c.query('INSERT INTO mis_vlb_batch_deletions(id,actor,reason,operation,batch_id,replacement_id,manifest) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *',[randomUUID(),req.batchActor.login,reason,operation,operation==='purge-all'?manifest.batches[0].original.id:batchId,operation==='restore'?manifest.target?.batch.id||null:null,JSON.stringify(manifest)])).rows[0]});res.json(publicRequest(row));
 }));
 async function owned(c,req){
  authorize(req);if(!uuid(req.params.id))fail('Invalid request.',400);
  const row=(await c.query('SELECT *,expires_at<=clock_timestamp() AS expired FROM mis_vlb_batch_deletions WHERE id=$1 AND actor=$2 FOR UPDATE',[req.params.id,req.batchActor.login])).rows[0];
  if(!row||row.expired||row.completed_at)fail('Request expired or already completed. Prepare a fresh preview.');
  if(req.body.approval!==approval(row))fail('Enter the exact approval phrase.',400);
  if(row.replacement_id&&req.body.deleteReplacement!==true)fail('Confirm deletion of the replacement batch before restoring the original.',400);
  return row;
 }
 async function fresh(c,req,row){const current=await plan(c,req,row.operation,row.batch_id);if(scopeHash(current)!==scopeHash(row.manifest))fail('The cards or replacement batch changed. Prepare and approve a fresh preview.');}
 app.post('/api/vlb-batch-deletions/:id/otp',...protect,handle(async(req,res)=>{
  if(!sendOtp)fail('Deletion WhatsApp OTP is unavailable.',503);const otp=String(randomInt(100000,1000000));
  const row=await transaction(async c=>{
   const r=await owned(c,req);await fresh(c,req,r);
   // One OTP per approval: a delivered OTP stays valid for 10 minutes from sending, and every later request reuses it instead of issuing another.
   if(r.delivered_at&&r.otp_hash&&r.attempts<5)return {...r,alreadySent:true};
   const age=(await c.query('SELECT EXTRACT(EPOCH FROM clock_timestamp()-$1::timestamptz)::int AS seconds',[r.otp_requested_at||null])).rows[0].seconds;
   if(r.otp_requested_at&&age<60)fail(`An OTP was sent ${age} seconds ago and is still being delivered. Wait ${60-age} more seconds, then request again.`,429);
   const hour=(await c.query("SELECT count(*)::int AS n,EXTRACT(EPOCH FROM clock_timestamp()-min(otp_requested_at))::int AS oldest FROM mis_vlb_batch_deletions WHERE actor=$1 AND otp_requested_at>clock_timestamp()-INTERVAL '1 hour'",[req.batchActor.login])).rows[0];
   if(hour.n>=10)fail(`Ten deletion OTPs were requested in the last hour. Try again in ${Math.max(1,Math.ceil((3600-hour.oldest)/60))} minutes.`,429);
   // The approval now lasts at least 10 minutes from this OTP so the OTP never outlives it.
   return(await c.query("UPDATE mis_vlb_batch_deletions SET otp_hash=$2,otp_requested_at=clock_timestamp(),delivered_at=NULL,expires_at=GREATEST(expires_at,clock_timestamp()+INTERVAL '10 minutes') WHERE id=$1 RETURNING *",[r.id,digest(r.id,otp)])).rows[0];
  });
  const otpStatus=r=>({sent:true,sentAt:r.otp_requested_at,validUntil:r.expires_at,recipient:'+91 9925565281'});
  if(row.alreadySent)return res.json({...otpStatus(row),alreadySent:true});
  try{const delivery=await sendOtp({to:DELETION_PHONE,otp,requestId:row.id,count:Math.max(1,row.manifest.target?.records.length||row.manifest.original?.counts?.cards||row.manifest.counts?.cards||0)});if(!delivery?.sent||!delivery.messageId)throw Error('delivery');await pool.query('UPDATE mis_vlb_batch_deletions SET delivered_at=clock_timestamp() WHERE id=$1 AND otp_hash=$2',[row.id,digest(row.id,otp)]);}
  // A failed delivery releases the cooldown so the next attempt is not blocked, and does not count toward the hourly limit.
  catch{await pool.query('UPDATE mis_vlb_batch_deletions SET otp_hash=NULL,otp_requested_at=NULL,delivered_at=NULL WHERE id=$1 AND otp_hash=$2 AND completed_at IS NULL',[row.id,digest(row.id,otp)]).catch(()=>{});fail('WhatsApp OTP delivery failed. Nothing was changed. You can request the OTP again now.',503)}
  res.json(otpStatus(row));
 }));
 app.post('/api/vlb-batch-deletions/:id/confirm',...protect,handle(async(req,res)=>{
  const result=await transaction(async c=>{
   const row=await owned(c,req);if(!row.delivered_at||!row.otp_hash||row.attempts>=5)fail('A delivered OTP is required. After five attempts, prepare a new request.',403);
   const otp=String(req.body.otp||'');
   if(!/^\d{6}$/.test(otp)||!timingSafeEqual(Buffer.from(row.otp_hash,'hex'),Buffer.from(digest(row.id,otp),'hex'))){await c.query('UPDATE mis_vlb_batch_deletions SET attempts=attempts+1 WHERE id=$1',[row.id]);return {invalidOtp:true};}
   // Freeze extraction, upload and backup rows while the approved manifest is rechecked and moved.
   if(await exists(c,'mis_scan_cards'))await c.query('LOCK TABLE mis_scan_batches,mis_scan_cards IN SHARE ROW EXCLUSIVE MODE');
   if(await exists(c,'mis_scan_backup_items'))await c.query('LOCK TABLE mis_scan_backup_items IN SHARE ROW EXCLUSIVE MODE');
   await fresh(c,req,row);
   if(row.manifest.target)await retain(c,await batch(c,row.manifest.target.batch.id,req),row.manifest.target,req.batchActor.login);
   if(row.operation==='restore')await restore(c,await batch(c,row.batch_id,req,true),req.batchActor.login);
   if(row.operation==='purge'||row.operation==='erase')await purge(c,await batch(c,row.batch_id,req,false,true),req.batchActor.login,'batch_permanently_deleted');
   if(row.operation==='purge-all')for(const b of row.manifest.batches)await purge(c,await batch(c,b.original.id,req,false,true),req.batchActor.login,'batch_permanently_deleted');
   await c.query("UPDATE mis_vlb_batch_deletions SET completed_at=clock_timestamp(),otp_hash=NULL,manifest=jsonb_build_object('batchId',batch_id,'replacementId',replacement_id,'operation',operation) WHERE id=$1",[row.id]);
   return {complete:true,operation:row.operation,id:row.batch_id};
  });if(result.invalidOtp)return res.status(400).json({error:'Incorrect OTP.'});
  // Remove the erased batch's source images now instead of on the next sweep.
  if(result.operation?.startsWith('purge')||result.operation==='erase')void cleanupExpired().catch(e=>console.error('VLB permanent deletion cleanup:',e.code||e.name));
  res.json(result);
 }));
 let cleaning=false;
 async function cleanupExpired(){
  if(cleaning)return;cleaning=true;
  try{
   await ensure();
   const expired=(await pool.query('SELECT id FROM mis_vlb_batches WHERE deleted_at IS NOT NULL AND restore_until<=clock_timestamp() AND purged_at IS NULL ORDER BY restore_until LIMIT 10')).rows;
   for(const b of expired)await transaction(async c=>{
    const current=(await c.query('SELECT id FROM mis_vlb_batches WHERE id=$1 AND deleted_at IS NOT NULL AND restore_until<=clock_timestamp() AND purged_at IS NULL FOR UPDATE',[b.id])).rows[0];if(!current)return;
    await purge(c,b,'system','batch_retention_expired');
   });
   // Expired previews contain identities only, but discard them as well.
   await pool.query('DELETE FROM mis_vlb_batch_deletions WHERE completed_at IS NULL AND expires_at<clock_timestamp()');
   if(imageStorage?.stat&&imageStorage?.remove){
    const pending=(await pool.query('SELECT * FROM mis_vlb_batch_blob_cleanup WHERE completed_at IS NULL ORDER BY batch_id,blob_key LIMIT 50')).rows;
    for(const item of pending){try{await transaction(async c=>{
     await c.query('SELECT pg_advisory_xact_lock(709224103,hashtext($1))',[item.blob_key.toLowerCase()]);
     const referenced=(await c.query("SELECT 1 FROM mis_vlb_batch_recovery_items WHERE kind IN('scan','backup') AND COALESCE(payload->>'image_blob_key',payload->>'blob_key')=$1 LIMIT 1",[item.blob_key])).rows.length||await exists(c,'mis_scan_cards')&&(await c.query('SELECT 1 FROM mis_scan_cards WHERE image_blob_key=$1 LIMIT 1',[item.blob_key])).rows.length||await exists(c,'mis_scan_backup_items')&&(await c.query('SELECT 1 FROM mis_scan_backup_items WHERE blob_key=$1 LIMIT 1',[item.blob_key])).rows.length;
     if(referenced)throw Error('Image is still referenced; cleanup paused.');
     const stat=await imageStorage.stat(item.blob_key);if(typeof stat?.exists!=='boolean')throw Error('Image storage verification unavailable.');
     if(stat.exists){if(!stat.etag||stat.sha256!==item.image_hash)throw Error('Image version or checksum changed; cleanup paused.');await imageStorage.remove(item.blob_key,{etag:stat.etag});}
     await c.query("UPDATE mis_vlb_batch_blob_cleanup SET completed_at=clock_timestamp(),error='' WHERE batch_id=$1 AND blob_key=$2",[item.batch_id,item.blob_key]);
    });}catch{await pool.query("UPDATE mis_vlb_batch_blob_cleanup SET error='Cleanup pending: image may still be referenced, changed or storage unavailable.' WHERE batch_id=$1 AND blob_key=$2",[item.batch_id,item.blob_key]);}}
   }
  }finally{cleaning=false}
 }
 const timer=setInterval(()=>void cleanupExpired().catch(e=>console.error('VLB retention cleanup:',e.code||e.name)),60000);timer.unref();
 return {cleanupExpired,stop:()=>clearInterval(timer)};
}
