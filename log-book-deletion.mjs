import {randomUUID,randomInt,createHash,timingSafeEqual} from 'node:crypto';

export const DELETION_PHONE='919925565281';
const schema=`CREATE TABLE IF NOT EXISTS mis_log_book_deletions(
 id UUID PRIMARY KEY,actor TEXT NOT NULL,reason TEXT NOT NULL,snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL,
 approved_at TIMESTAMPTZ,otp_hash TEXT,otp_requested_at TIMESTAMPTZ,delivered_at TIMESTAMPTZ,
 attempts INTEGER NOT NULL DEFAULT 0,completed_at TIMESTAMPTZ);`;
const error=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const digest=(id,otp)=>createHash('sha256').update(`${id}:${otp}`).digest('hex');
const phrase=id=>`Approve deletion of ${id}`;
const impact='Selected VLB/ELB records will leave the active register and operational reports. Source scans are retained. Records and a full snapshot remain in the database for administrator-assisted recovery; there is no self-service restore.';
const actor=req=>String(req.session.login||req.session.name||'');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function registerLogBookDeletion(app,{pool,protect,ensureBooks,sendOtp,permittedSites=async()=>null,assertSite=()=>{},allowsSite=()=>true}){
 let ready;const ensure=async()=>{await ensureBooks();await (ready??=pool.query(schema).catch(e=>{ready=null;throw e}));};
 const wrap=fn=>async(req,res,next)=>{req.audit=false;try{await ensure();await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
 async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function request(c,req){
  if(!uuid(req.params.id))error('Invalid deletion request.');
  const row=(await c.query('SELECT * FROM mis_log_book_deletions WHERE id=$1 AND actor=$2 FOR UPDATE',[req.params.id,actor(req)])).rows[0];
  if(!row||row.completed_at||new Date(row.expires_at)<=new Date())error('Deletion request expired or unavailable. Preview the records again.',409);
  if(req.body.approval!==phrase(row.id))error('Enter the exact approval phrase shown with the record preview.');
  return row;
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
  const snapshot=await transaction(async c=>{
   const rows=(await c.query('SELECT * FROM mis_log_books WHERE id=ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE',[records.map(r=>String(r.id))])).rows;
   if(rows.length!==records.length||records.some(s=>!rows.some(r=>String(r.id)===String(s.id)&&r.revision===s.revision)))error('Selected records changed. Refresh before previewing.',409);
   rows.forEach(r=>assertSite(req,r.site));
   await c.query("INSERT INTO mis_log_book_deletions(id,actor,reason,snapshot,expires_at) VALUES($1,$2,$3,$4::jsonb,NOW()+INTERVAL '10 minutes')",[id,actor(req),reason,JSON.stringify(rows)]);return rows;
  });
  res.json({id,records:snapshot,reason,impact,approval:phrase(id),recipient:'+91 9925565281',expiresInMinutes:10});
 }));
 app.post('/api/log-book-deletions/:id/otp',...protect,wrap(async(req,res)=>{
  const otp=String(randomInt(100000,1000000));
  const row=await transaction(async c=>{
   const r=await request(c,req);await current(c,r.snapshot,req);
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
   const r=await request(c,req);
   if(!r.approved_at||!r.delivered_at||!r.otp_hash)error('Approval and successful WhatsApp OTP delivery are required.',403);
   if(r.attempts>=5)error('Too many incorrect attempts. Preview and approve again.',429);
   const otp=String(req.body.otp||'');
   if(!/^\d{6}$/.test(otp)||!timingSafeEqual(Buffer.from(digest(r.id,otp),'hex'),Buffer.from(r.otp_hash,'hex'))){
    await c.query('UPDATE mis_log_book_deletions SET attempts=attempts+1 WHERE id=$1',[r.id]);return {invalid:true};
   }
   await current(c,r.snapshot,req);
   const deleted=await c.query('UPDATE mis_log_books SET deleted_at=NOW(),updated_at=NOW(),revision=revision+1 WHERE id=ANY($1::bigint[]) AND deleted_at IS NULL RETURNING id',[r.snapshot.map(s=>s.id)]);
   if(deleted.rowCount!==r.snapshot.length)error('Selection changed. No entries were deleted.',409);
   await c.query('UPDATE mis_log_book_deletions SET completed_at=NOW(),otp_hash=NULL WHERE id=$1',[r.id]);
   return {deleted:deleted.rowCount,requestId:r.id};
  });
  if(result.invalid)return res.status(400).json({error:'Incorrect WhatsApp OTP. No entries were deleted.'});
  res.json(result);
 }));
}
