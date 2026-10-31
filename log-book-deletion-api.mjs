import {randomUUID,randomInt,createHash,timingSafeEqual} from 'node:crypto';
import {discoverDeletionScope,bindLocalFiles,scopeHash,stableJson,deletionError} from './log-book-deletion-scope.mjs';
export const DELETION_PHONE='919925565281';
const schema=`CREATE TABLE IF NOT EXISTS mis_log_book_deletions(
 id UUID PRIMARY KEY,actor TEXT NOT NULL,reason TEXT NOT NULL,snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL,
 approved_at TIMESTAMPTZ,otp_hash TEXT,otp_requested_at TIMESTAMPTZ,delivered_at TIMESTAMPTZ,
 attempts INTEGER NOT NULL DEFAULT 0,completed_at TIMESTAMPTZ);
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS deletion_mode TEXT NOT NULL DEFAULT 'retained';
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS scan_selection JSONB NOT NULL DEFAULT '[]';
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS pending_scan_blobs JSONB NOT NULL DEFAULT '[]';
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS deletion_manifest JSONB;
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS pending_local_files JSONB NOT NULL DEFAULT '[]';
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS local_receipts JSONB NOT NULL DEFAULT '[]';
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS database_deleted_at TIMESTAMPTZ;
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS otp_verified_at TIMESTAMPTZ;
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS cleanup_error TEXT NOT NULL DEFAULT '';`;
const actor=req=>String(req.session.login||req.session.name||'');
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const digest=(id,otp)=>createHash('sha256').update(`${id}:${otp}`).digest('hex');
const hash=manifest=>scopeHash(manifest);
const phrase=row=>`Approve deletion of ${row.id} ${hash(row.deletion_manifest).slice(0,12)}`;
const impact='Permanently delete the exact listed records, all listed duplicate scan copies and source images, and the listed SSD image/JSON files. Listed full recovery snapshots and backup metadata become minimal deletion audits. There is no application restore. Parent batches, unlisted files and other active records are preserved. Unknown exports, platform backups and provider retention are outside this scope.';

export function registerLogBookDeletion(app,{pool,protect,ensureBooks,sendOtp,imageStorage,permittedSites=async()=>null,assertSite=()=>{},allowsSite=()=>true}){
 let ready,cleaning=false;
 const ensure=async()=>{await ensureBooks();await(ready??=pool.query(schema).catch(e=>{ready=null;throw e}));};
 const wrap=fn=>async(req,res,next)=>{req.audit=false;try{await ensure();await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
 async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(709224102)');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function imageTransaction(key,fn){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(709224103,hashtext($1))',[key]);const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const finish=id=>pool.query("UPDATE mis_log_book_deletions SET completed_at=NOW(),cleanup_error='' WHERE id=$1 AND database_deleted_at IS NOT NULL AND otp_verified_at IS NOT NULL AND completed_at IS NULL AND jsonb_array_length(pending_scan_blobs)=0 AND jsonb_array_length(pending_local_files)=0",[id]);
 async function cleanupBlobs(){
  if(!imageStorage||cleaning)return;cleaning=true;
  try{
   const rows=(await pool.query("SELECT id,pending_scan_blobs FROM mis_log_book_deletions WHERE approved_at IS NOT NULL AND delivered_at IS NOT NULL AND (completed_at IS NOT NULL OR (database_deleted_at IS NOT NULL AND otp_verified_at IS NOT NULL)) AND jsonb_array_length(pending_scan_blobs)>0 ORDER BY created_at")).rows;
   for(const row of rows){
    for(const item of row.pending_scan_blobs){try{
     const key=typeof item==='string'?item:item.key;
     await imageTransaction(key,async c=>{
      const current=(await c.query('SELECT pending_scan_blobs FROM mis_log_book_deletions WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
      if(!current?.pending_scan_blobs.some(p=>stableJson(p)===stableJson(item)))return;
      if((await c.query('SELECT id FROM mis_scan_cards WHERE image_blob_key=$1 LIMIT 1',[key])).rows.length)throw Object.assign(Error('A source image is referenced by a new scan.'),{code:'IMAGE_REFERENCED'});
      await imageStorage.remove(key,typeof item==='string'?{}:{etag:item.etag});
      await c.query("UPDATE mis_log_book_deletions SET pending_scan_blobs=COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(pending_scan_blobs) item WHERE item<>$2::jsonb),'[]'::jsonb),cleanup_error='' WHERE id=$1",[row.id,JSON.stringify(item)]);
     });
    }catch(e){await pool.query('UPDATE mis_log_book_deletions SET cleanup_error=$2 WHERE id=$1',[row.id,e.code==='IMAGE_REFERENCED'?'A cloud image is now referenced by another scan. Cleanup is paused for review.':e.status===412?'A cloud image changed after approval. Cleanup is paused for review.':'Cloud cleanup is unavailable; the approved image remains pending.']);break;}}
    await finish(row.id);
   }
  }finally{cleaning=false;}
 }
 async function quickCleanup(){let timer;try{await Promise.race([cleanupBlobs().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,1500);timer.unref();})]);}finally{clearTimeout(timer);}}
 if(imageStorage){const timer=setInterval(()=>void ensure().then(cleanupBlobs).catch(()=>{}),60000);timer.unref();}
 async function owned(c,req,{afterDeletion=false,approval=true}={}){
  if(!uuid(req.params.id))deletionError('Invalid deletion request.',400);
  const row=(await c.query('SELECT * FROM mis_log_book_deletions WHERE id=$1 AND actor=$2 FOR UPDATE',[req.params.id,actor(req)])).rows[0];
  if(!row||row.deletion_mode!=='permanent-v2'||(!afterDeletion&&(row.database_deleted_at||row.completed_at||new Date(row.expires_at)<=new Date())))deletionError('Deletion request expired or unavailable. Prepare and approve a fresh list.');
  row.snapshot.forEach(r=>assertSite(req,r.site));
  if(approval&&req.body.approval!==phrase(row))deletionError('Enter the exact approval phrase for this complete list.',400);
  return row;
 }
 async function current(c,row,req){
  const records=(await c.query('SELECT * FROM mis_log_books WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',[row.snapshot.map(r=>r.id)])).rows;
  if(records.length!==row.snapshot.length||records.some(r=>r.deleted_at))deletionError('Selected records changed. Prepare a fresh approval list.');
  records.forEach(r=>assertSite(req,r.site));
  const plan=await discoverDeletionScope(c,records,{skipRequestId:row.id,assertSite:site=>assertSite(req,site),imageStorage});
  plan.localFiles=row.deletion_manifest.localFiles;
  if(hash(plan)!==hash(row.deletion_manifest))deletionError('Records, duplicate copies, images or linked backups changed. Prepare and approve a fresh list.');
  return plan;
 }
 function view(row){const m=row.deletion_manifest;return {id:row.id,records:row.snapshot,scans:m.scans,manifest:m,scopeHash:hash(m),reason:row.reason,impact,approval:phrase(row),filesReady:m.localFiles.length===m.files.length,recipient:'+91 9925565281',expiresInMinutes:10};}
 async function status(req,id){
  const row=(await pool.query('SELECT * FROM mis_log_book_deletions WHERE id=$1 AND actor=$2',[id,actor(req)])).rows[0];if(!row||row.deletion_mode!=='permanent-v2')deletionError('Deletion request not found.',404);
  row.snapshot.forEach(r=>assertSite(req,r.site));
  if(row.database_deleted_at&&row.otp_verified_at&&!row.completed_at&&!row.pending_scan_blobs.length&&!row.pending_local_files.length){await finish(id);row.completed_at=true;}
  const m=row.deletion_manifest;return {id:row.id,approval:phrase(row),scopeHash:hash(m),otpVerified:Boolean(row.otp_verified_at),databaseDeleted:Boolean(row.database_deleted_at),complete:Boolean(row.completed_at),pendingCloud:row.pending_scan_blobs.length,pendingFiles:row.pending_local_files,files:m.files,cleanupError:row.cleanup_error,deleted:row.snapshot.length,scans:m.scans.length,backupMetadata:m.backups.length,localFiles:m.localFiles.length};
 }
 app.get('/api/log-book-deletions/entries',...protect,wrap(async(req,res)=>{
  const before=String(req.query.before||''),id=String(req.query.id||'');if((before&&!/^\d+$/.test(before))||(id&&!/^\d+$/.test(id)))deletionError('Invalid record ID or page cursor.',400);
  const sites=await permittedSites(req),rows=(await pool.query('SELECT id,book_no,book_type,data,revision,created_at FROM mis_log_books WHERE deleted_at IS NULL AND ($1::bigint IS NULL OR id<$1::bigint) AND ($2::bigint IS NULL OR id=$2::bigint) AND ($3::text[] IS NULL OR site=ANY($3::text[])) ORDER BY id DESC LIMIT 101',[before||null,id||null,sites])).rows;
  res.set('Cache-Control','no-store').json({records:rows.slice(0,100),nextCursor:rows.length>100?String(rows[99].id):null});
 }));
 app.get('/api/log-book-deletions/pending',...protect,wrap(async(req,res)=>{
  const rows=(await pool.query("SELECT id,created_at FROM mis_log_book_deletions WHERE actor=$1 AND deletion_mode='permanent-v2' AND database_deleted_at IS NOT NULL AND completed_at IS NULL ORDER BY created_at DESC",[actor(req)])).rows;
  res.set('Cache-Control','no-store').json({requests:rows});
 }));
 app.get('/api/log-book-deletions/history',...protect,wrap(async(req,res)=>{
  const rows=(await pool.query('SELECT id,actor,reason,snapshot,approved_at,delivered_at,completed_at,database_deleted_at FROM mis_log_book_deletions WHERE completed_at IS NOT NULL OR database_deleted_at IS NOT NULL ORDER BY COALESCE(completed_at,database_deleted_at) DESC LIMIT 100')).rows;
  res.set('Cache-Control','no-store').json({records:rows.filter(r=>r.snapshot.every(s=>allowsSite(req,s.site)))});
 }));
 app.get('/api/log-book-deletions/:id/status',...protect,wrap(async(req,res)=>{
  if(!uuid(req.params.id))deletionError('Invalid deletion request.',400);res.set('Cache-Control','no-store').json(await status(req,req.params.id));
 }));
 app.post('/api/log-book-deletions/preview',...protect,wrap(async(req,res)=>{
  const records=req.body.records,reason=String(req.body.reason||'').trim();if(!reason||reason.length>2000)deletionError('Enter a deletion reason (up to 2000 characters).',400);
  if(!Array.isArray(records)||!records.length||records.length>500||records.some(r=>!r||!/^\d+$/.test(String(r.id))||!Number.isSafeInteger(r.revision))||new Set(records.map(r=>String(r.id))).size!==records.length)deletionError('Select 1–500 distinct records with current revisions.',400);
  const result=await transaction(async c=>{
   const rows=(await c.query('SELECT * FROM mis_log_books WHERE id=ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE',[records.map(r=>String(r.id))])).rows;
   if(rows.length!==records.length||records.some(s=>!rows.some(r=>String(r.id)===String(s.id)&&r.revision===s.revision)))deletionError('Selected records changed. Refresh before previewing.');rows.forEach(r=>assertSite(req,r.site));
   const manifest=await discoverDeletionScope(c,rows,{assertSite:site=>assertSite(req,site),imageStorage});const id=randomUUID();
   await c.query("INSERT INTO mis_log_book_deletions(id,actor,reason,snapshot,expires_at,deletion_mode,scan_selection,deletion_manifest) VALUES($1,$2,$3,$4::jsonb,NOW()+INTERVAL '10 minutes','permanent-v2',$5::jsonb,$6::jsonb)",[id,actor(req),reason,JSON.stringify(rows),JSON.stringify(manifest.scans),JSON.stringify(manifest)]);
   return view({id,snapshot:rows,reason,deletion_manifest:manifest});
  });res.json(result);
 }));
 app.post('/api/log-book-deletions/:id/files',...protect,wrap(async(req,res)=>{
  const result=await transaction(async c=>{const row=await owned(c,req,{approval:false});if(row.otp_requested_at)deletionError('The approved list is frozen. Prepare a new preview to change files.');if(req.body.scopeHash!==hash(row.deletion_manifest))deletionError('The approval list changed. Reload the preview.');await current(c,row,req);row.deletion_manifest=bindLocalFiles(row.deletion_manifest,req.body.files);await c.query('UPDATE mis_log_book_deletions SET deletion_manifest=$2::jsonb WHERE id=$1',[row.id,JSON.stringify(row.deletion_manifest)]);return view(row);});res.json(result);
 }));
 app.post('/api/log-book-deletions/:id/otp',...protect,wrap(async(req,res)=>{
  const otp=String(randomInt(100000,1000000));
  const row=await transaction(async c=>{const r=await owned(c,req);await current(c,r,req);bindLocalFiles(r.deletion_manifest,r.deletion_manifest.localFiles);if(r.otp_requested_at)deletionError('OTP already requested. Prepare a new preview if it expired.');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['log-book-deletion:'+actor(req)]);const recent=(await c.query("SELECT COUNT(*)::int AS count,MAX(otp_requested_at) AS latest FROM mis_log_book_deletions WHERE actor=$1 AND otp_requested_at>NOW()-INTERVAL '1 hour'",[actor(req)])).rows[0];if(recent.count>=10||(recent.latest&&Date.now()-new Date(recent.latest).getTime()<60000))deletionError('Wait at least one minute between OTP requests; maximum ten per hour.',429);await c.query('UPDATE mis_log_book_deletions SET approved_at=NOW(),otp_requested_at=NOW(),otp_hash=$2 WHERE id=$1',[r.id,digest(r.id,otp)]);return r;});
  try{const delivery=await sendOtp?.({to:DELETION_PHONE,otp,requestId:row.id,count:row.snapshot.length});if(!delivery?.sent||!delivery.messageId)throw Error();await pool.query('UPDATE mis_log_book_deletions SET delivered_at=NOW() WHERE id=$1',[row.id]);}catch{deletionError('WhatsApp OTP could not be sent. No entries or files were deleted. Prepare a new preview after checking the connection.',503);}
  res.json({sent:true,recipient:'+91 9925565281'});
 }));
 app.post('/api/log-book-deletions/:id/confirm',...protect,wrap(async(req,res)=>{
  const result=await transaction(async c=>{
   const r=await owned(c,req);if(!r.approved_at||!r.delivered_at||!r.otp_hash)deletionError('Approval and successful WhatsApp OTP delivery are required.',403);if(r.attempts>=5)deletionError('Too many incorrect attempts. Prepare a new preview.',429);
   const otp=String(req.body.otp||'');if(!/^\d{6}$/.test(otp)||!timingSafeEqual(Buffer.from(digest(r.id,otp),'hex'),Buffer.from(r.otp_hash,'hex'))){await c.query('UPDATE mis_log_book_deletions SET attempts=attempts+1 WHERE id=$1',[r.id]);return {invalid:true};}
   const m=await current(c,r,req),files=bindLocalFiles(m,req.body.files||[]);if(stableJson(files.localFiles)!==stableJson(m.localFiles))deletionError('An SSD file changed after approval. Prepare and approve a fresh list.');
   const scanIds=m.scans.map(s=>s.id),ids=r.snapshot.map(s=>s.id);
   if(scanIds.length){const result=await c.query('DELETE FROM mis_scan_cards WHERE id=ANY($1::uuid[]) RETURNING id',[scanIds]);if(result.rowCount!==scanIds.length)deletionError('Duplicate scan selection changed. Cleanup rolled back.');}
   if(m.batchLinks.length)await c.query('DELETE FROM mis_vlb_batch_entries WHERE logbook_id=ANY($1::bigint[])',[ids]);
   if(m.verification.length)await c.query('DELETE FROM mis_pulse_trip_verifications WHERE logbook_id=ANY($1::bigint[])',[ids]);
   if(m.backups.length)await c.query("UPDATE mis_scan_backup_items i SET metadata=jsonb_build_object('permanentlyDeleted',true,'cardId',i.card_id) FROM jsonb_to_recordset($1::jsonb) AS t(backup_id uuid,card_id uuid) WHERE i.backup_id=t.backup_id AND i.card_id=t.card_id",[JSON.stringify(m.backups.map(({backup_id,card_id})=>({backup_id,card_id})))]);
   const deleted=await c.query('DELETE FROM mis_log_books WHERE id=ANY($1::bigint[]) AND deleted_at IS NULL RETURNING id',[ids]);if(deleted.rowCount!==ids.length)deletionError('Record selection changed. Cleanup rolled back.');
   if(m.snapshots.length)await c.query(`UPDATE mis_log_book_deletions d SET snapshot=(SELECT jsonb_agg(CASE WHEN EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS t(request_id uuid,position int) WHERE t.request_id=d.id AND t.position=s.position) THEN jsonb_build_object('id',item->'id','book_no',item->'book_no','book_type',item->'book_type','site',item->'site') ELSE item END ORDER BY s.position) FROM jsonb_array_elements(d.snapshot) WITH ORDINALITY s(item,position)) WHERE d.id=ANY($2::uuid[])`,[JSON.stringify(m.snapshots.map(({request_id,position})=>({request_id,position}))),[...new Set(m.snapshots.map(s=>s.request_id))]]);
   const minimal=r.snapshot.map(({id,book_no,book_type,site})=>({id,book_no,book_type,site})),pending=m.localFiles.filter(f=>f.exists);
   await c.query("UPDATE mis_log_book_deletions SET database_deleted_at=NOW(),otp_verified_at=NOW(),otp_hash=NULL,snapshot=$2::jsonb,scan_selection='[]'::jsonb,pending_scan_blobs=$3::jsonb,pending_local_files=$4::jsonb WHERE id=$1",[r.id,JSON.stringify(minimal),JSON.stringify(m.cloud.filter(item=>item.exists).map(({key,etag})=>({key,etag}))),JSON.stringify(pending)]);
   return {id:r.id};
  });if(result.invalid)return res.status(400).json({error:'Incorrect WhatsApp OTP. No entries or files were deleted.'});
  await quickCleanup();await finish(result.id);const state=await status(req,result.id);res.status(state.complete?200:202).json({...state,requestId:result.id,cleanupPending:!state.complete});
 }));
 app.post('/api/log-book-deletions/:id/local-receipts',...protect,wrap(async(req,res)=>{
  await transaction(async c=>{
   const r=await owned(c,req,{afterDeletion:true});if(!r.database_deleted_at||!r.otp_verified_at)deletionError('Successful OTP verification is required before SSD deletion.',403);
   const receipts=req.body.receipts;if(!Array.isArray(receipts)||receipts.length>r.deletion_manifest.localFiles.length||new Set(receipts.map(f=>f?.key)).size!==receipts.length)deletionError('Invalid SSD deletion receipts.',400);
   for(const receipt of receipts){const file=r.deletion_manifest.localFiles.find(f=>f.key===receipt?.key&&f.exists);if(!file||file.sha256!==receipt.sha256||file.bytes!==receipt.bytes||!['deleted','already-absent'].includes(receipt.status))deletionError('SSD receipt does not match an approved file.',400);}
   const keys=new Set(receipts.map(f=>f.key)),pending=r.pending_local_files.filter(f=>!keys.has(f.key)),recorded=new Set(r.local_receipts.map(f=>f.key)),merged=[...r.local_receipts,...receipts.filter(f=>!recorded.has(f.key))];
   await c.query('UPDATE mis_log_book_deletions SET pending_local_files=$2::jsonb,local_receipts=$3::jsonb WHERE id=$1',[r.id,JSON.stringify(pending),JSON.stringify(merged)]);
  });await finish(req.params.id);res.json(await status(req,req.params.id));
 }));
 return {cleanupBlobs};
}
