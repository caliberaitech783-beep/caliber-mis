import {randomUUID,randomInt,createHash,timingSafeEqual} from 'node:crypto';

export const DELETION_PHONE='919925565281';
const schema=`CREATE TABLE IF NOT EXISTS mis_log_book_deletions(
 id UUID PRIMARY KEY,actor TEXT NOT NULL,reason TEXT NOT NULL,snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL,
 approved_at TIMESTAMPTZ,otp_hash TEXT,otp_requested_at TIMESTAMPTZ,delivered_at TIMESTAMPTZ,
 attempts INTEGER NOT NULL DEFAULT 0,completed_at TIMESTAMPTZ);
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS deletion_mode TEXT NOT NULL DEFAULT 'retained';
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS scan_selection JSONB NOT NULL DEFAULT '[]';
 ALTER TABLE mis_log_book_deletions ADD COLUMN IF NOT EXISTS pending_scan_blobs JSONB NOT NULL DEFAULT '[]';`;
const error=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const digest=(id,otp)=>createHash('sha256').update(`${id}:${otp}`).digest('hex');
const phrase=id=>`Approve deletion of ${id}`;
const impact='Selected VLB/ELB records and the exact linked source scans shown below (images, OCR text and drafts) will be permanently removed from the application database. Recovery snapshots for these records will be reduced to a minimal audit of IDs, book numbers, types and sites. Hot-storage source images are also deleted; unavailable storage is retried automatically and reported as pending until cleanup succeeds. Saved-batch links and Pulse verification queue rows for the selected IDs are removed. Completed actions in Pulse are outside this deletion. There is no application restore. Previously exported files and external backups are outside this deletion and may retain copies.';
const actor=req=>String(req.session.login||req.session.name||'');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function registerLogBookDeletion(app,{pool,protect,ensureBooks,sendOtp,imageStorage,permittedSites=async()=>null,assertSite=()=>{},allowsSite=()=>true}){
 async function cleanupBlobs(){
  if(!imageStorage)return;
  const rows=(await pool.query("SELECT id,pending_scan_blobs FROM mis_log_book_deletions WHERE completed_at IS NOT NULL AND approved_at IS NOT NULL AND delivered_at IS NOT NULL AND jsonb_array_length(pending_scan_blobs)>0")).rows;
  for(const row of rows){try{for(const key of row.pending_scan_blobs)await imageStorage.remove(key);await pool.query("UPDATE mis_log_book_deletions SET pending_scan_blobs='[]'::jsonb WHERE id=$1",[row.id]);}catch{ /* Keep verified, approved keys durably queued for retry. */ }}
 }
 if(imageStorage){const retry=setInterval(()=>{void ensure().then(cleanupBlobs).catch(()=>{});},60000);retry.unref();}
 let ready;const ensure=async()=>{await ensureBooks();await (ready??=pool.query(schema).catch(e=>{ready=null;throw e}));};
 const wrap=fn=>async(req,res,next)=>{req.audit=false;try{await ensure();await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
 async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function request(c,req){
  if(!uuid(req.params.id))error('Invalid deletion request.');
  const row=(await c.query('SELECT * FROM mis_log_book_deletions WHERE id=$1 AND actor=$2 FOR UPDATE',[req.params.id,actor(req)])).rows[0];
  if(!row||row.deletion_mode!=='permanent'||row.completed_at||new Date(row.expires_at)<=new Date())error('Deletion request expired or unavailable. Preview the records again.',409);
  if(req.body.approval!==phrase(row.id))error('Enter the exact approval phrase shown with the record preview.');
  return row;
 }
 async function linkedScans(c,records){
  if(!(await c.query("SELECT to_regclass('mis_scan_cards') AS relation")).rows[0].relation)return [];
  return (await c.query('SELECT id,batch_id,ordinal,filename,revision,logbook_id,image_blob_key FROM mis_scan_cards WHERE logbook_id=ANY($1::bigint[]) OR id::text=ANY($2::text[]) ORDER BY id FOR UPDATE',[records.map(r=>r.id),records.map(r=>r.data?.scanCardId).filter(Boolean)])).rows;
 }
 async function verifySelection(c,r,req){
  await current(c,r.snapshot,req);
  const scans=await linkedScans(c,r.snapshot);
  if(scans.length!==r.scan_selection.length||scans.some((scan,i)=>Object.keys(scan).some(key=>String(scan[key])!==String(r.scan_selection[i][key]))))error('Linked source scans changed. Preview and approve a fresh selection.',409);
  return scans;
 }
 async function current(c,snapshot,req){
  snapshot.forEach(r=>assertSite(req,r.site));
  const rows=(await c.query('SELECT * FROM mis_log_books WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',[snapshot.map(r=>r.id)])).rows;
  if(rows.length!==snapshot.length||snapshot.some(s=>!rows.some(r=>String(r.id)===String(s.id)&&r.book_type===s.book_type&&r.revision===s.revision&&!r.deleted_at)))error('Selected records changed or were deleted. Preview and approve a fresh selection.',409);
 }
 app.get('/api/log-book-deletions/entries',...protect,wrap(async(req,res)=>{
  const before=String(req.query.before||''),id=String(req.query.id||'');if((before&&!/^\d+$/.test(before))||(id&&!/^\d+$/.test(id)))error('Invalid record ID or page cursor.');
  const sites=await permittedSites(req);
  const rows=(await pool.query('SELECT id,book_no,book_type,data,revision,created_at FROM mis_log_books WHERE deleted_at IS NULL AND ($1::bigint IS NULL OR id<$1::bigint) AND ($2::bigint IS NULL OR id=$2::bigint) AND ($3::text[] IS NULL OR site=ANY($3::text[])) ORDER BY id DESC LIMIT 101',[before||null,id||null,sites])).rows;
  res.set('Cache-Control','no-store').json({records:rows.slice(0,100),nextCursor:rows.length>100?String(rows[99].id):null});
 }));
 app.get('/api/log-book-deletions/history',...protect,wrap(async(req,res)=>{
  const rows=(await pool.query('SELECT id,actor,reason,snapshot,approved_at,delivered_at,completed_at FROM mis_log_book_deletions WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 100')).rows;
  res.set('Cache-Control','no-store').json({records:rows.filter(r=>r.snapshot.every(s=>allowsSite(req,s.site)))});
 }));
 app.post('/api/log-book-deletions/preview',...protect,wrap(async(req,res)=>{
  const records=req.body.records,reason=String(req.body.reason||'').trim();
  if(!reason||reason.length>2000)error('Enter a deletion reason (up to 2000 characters).');
  if(!Array.isArray(records)||!records.length||records.length>500||records.some(r=>!r||!/^\d+$/.test(String(r.id))||!Number.isSafeInteger(r.revision))||new Set(records.map(r=>String(r.id))).size!==records.length)error('Select 1–500 distinct records with their current revisions.');
  const id=randomUUID();
  const selection=await transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(709224102)');
   const rows=(await c.query('SELECT * FROM mis_log_books WHERE id=ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE',[records.map(r=>String(r.id))])).rows;
   if(rows.length!==records.length||records.some(s=>!rows.some(r=>String(r.id)===String(s.id)&&r.revision===s.revision)))error('Selected records changed. Refresh before previewing.',409);
   rows.forEach(r=>assertSite(req,r.site));
   const scans=await linkedScans(c,rows);
   if(scans.some(s=>s.image_blob_key)&&!imageStorage)error('Source image storage is unavailable. No deletion was prepared.',503);
   if(scans.some(s=>s.logbook_id&&!rows.some(r=>String(r.id)===String(s.logbook_id))))error('A linked scan belongs to another record. No deletion was prepared.',409);
   await c.query("INSERT INTO mis_log_book_deletions(id,actor,reason,snapshot,expires_at,deletion_mode,scan_selection) VALUES($1,$2,$3,$4::jsonb,NOW()+INTERVAL '10 minutes','permanent',$5::jsonb)",[id,actor(req),reason,JSON.stringify(rows),JSON.stringify(scans)]);return {records:rows,scans};
  });
  res.json({id,records:selection.records,scans:selection.scans,reason,impact,approval:phrase(id),recipient:'+91 9925565281',expiresInMinutes:10});
 }));
 app.post('/api/log-book-deletions/:id/otp',...protect,wrap(async(req,res)=>{
  const otp=String(randomInt(100000,1000000));
  const row=await transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(709224102)');
   const r=await request(c,req);await verifySelection(c,r,req);
   if(r.otp_requested_at)error('OTP already requested. Preview again if delivery failed or it expired.',409);
   // Serialize requests for each account across server processes.
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['log-book-deletion:'+actor(req)]);
   const recent=(await c.query("SELECT COUNT(*)::int AS count,MAX(otp_requested_at) AS latest FROM mis_log_book_deletions WHERE actor=$1 AND otp_requested_at>NOW()-INTERVAL '1 hour'",[actor(req)])).rows[0];
   if(recent.count>=10||(recent.latest&&Date.now()-new Date(recent.latest).getTime()<60000))error('Wait at least one minute between OTP requests; maximum ten per hour.',429);
   await c.query('UPDATE mis_log_book_deletions SET approved_at=NOW(),otp_requested_at=NOW(),otp_hash=$2 WHERE id=$1',[r.id,digest(r.id,otp)]);return r;
  });
  try{
   if(!sendOtp)throw new Error('WhatsApp unavailable');
   const delivery=await sendOtp({to:DELETION_PHONE,otp,requestId:row.id,count:row.snapshot.length});
   if(!delivery?.sent||!delivery.messageId)throw new Error('WhatsApp did not accept the OTP');
   await pool.query('UPDATE mis_log_book_deletions SET delivered_at=NOW() WHERE id=$1',[row.id]);
  }catch{error('WhatsApp OTP could not be sent. No entries were deleted. Check WhatsApp configuration and preview again.',503);}
  res.json({sent:true,recipient:'+91 9925565281'});
 }));
 app.post('/api/log-book-deletions/:id/confirm',...protect,wrap(async(req,res)=>{
  const result=await transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(709224102)');
   const r=await request(c,req);
   if(!r.approved_at||!r.delivered_at||!r.otp_hash)error('Approval and successful WhatsApp OTP delivery are required.',403);
   if(r.attempts>=5)error('Too many incorrect attempts. Preview and approve again.',429);
   const otp=String(req.body.otp||'');
   if(!/^\d{6}$/.test(otp)||!timingSafeEqual(Buffer.from(digest(r.id,otp),'hex'),Buffer.from(r.otp_hash,'hex'))){
    await c.query('UPDATE mis_log_book_deletions SET attempts=attempts+1 WHERE id=$1',[r.id]);return {invalid:true};
   }
   const scans=await verifySelection(c,r,req);
   if(scans.length)await c.query('DELETE FROM mis_scan_cards WHERE id=ANY($1::uuid[])',[scans.map(s=>s.id)]);
   for(const table of ['mis_vlb_batch_entries','mis_pulse_trip_verifications']){
    if((await c.query('SELECT to_regclass($1) AS relation',[table])).rows[0].relation)await c.query('DELETE FROM '+table+' WHERE logbook_id=ANY($1::bigint[])',[r.snapshot.map(s=>s.id)]);
   }
   if((await c.query("SELECT to_regclass('mis_scan_backup_items') AS relation")).rows[0].relation)await c.query("UPDATE mis_scan_backup_items SET metadata=jsonb_build_object('permanentlyDeleted',true,'cardId',card_id) WHERE card_id=ANY($1::uuid[]) OR metadata->>'logbookId'=ANY($2::text[])",[scans.map(s=>s.id),r.snapshot.map(s=>String(s.id))]);
   const deleted=await c.query('DELETE FROM mis_log_books WHERE id=ANY($1::bigint[]) AND deleted_at IS NULL RETURNING id',[r.snapshot.map(s=>s.id)]);
   if(deleted.rowCount!==r.snapshot.length)error('Selection changed. No entries were deleted.',409);
   // Scrub full copies from overlapping and expired previews as well.
   await c.query(`UPDATE mis_log_book_deletions d SET snapshot=(SELECT jsonb_agg(CASE WHEN item->>'id'=ANY($1::text[]) THEN jsonb_build_object('id',item->'id','book_no',item->'book_no','book_type',item->'book_type','site',item->'site') ELSE item END ORDER BY position) FROM jsonb_array_elements(d.snapshot) WITH ORDINALITY AS s(item,position)) WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(d.snapshot) item WHERE item->>'id'=ANY($1::text[]))`,[r.snapshot.map(s=>String(s.id))]);
   await c.query("UPDATE mis_log_book_deletions SET completed_at=NOW(),otp_hash=NULL,scan_selection='[]'::jsonb,pending_scan_blobs=$2::jsonb WHERE id=$1",[r.id,JSON.stringify(scans.map(s=>s.image_blob_key).filter(Boolean))]);
   return {deleted:deleted.rowCount,requestId:r.id};
  });
  if(result.invalid)return res.status(400).json({error:'Incorrect WhatsApp OTP. No entries were deleted.'});
  await cleanupBlobs();
  const pending=(await pool.query("SELECT jsonb_array_length(pending_scan_blobs) AS count FROM mis_log_book_deletions WHERE id=$1",[result.requestId])).rows[0].count;
  res.status(pending?202:200).json({...result,cleanupPending:pending>0});
 }));
 return {cleanupBlobs};
}
