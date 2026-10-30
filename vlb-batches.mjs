import {randomUUID} from 'node:crypto';
import {canonicalSiteName} from './site-location.mjs';
import {requireLogBookSite} from './log-book-access.mjs';
import {vlbBatchSelection,vlbBatchName,vlbRecordShift} from './vlb-batch-format.mjs';

export const VLB_BATCH_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_vlb_batches(
 id UUID PRIMARY KEY,name TEXT UNIQUE NOT NULL,site TEXT NOT NULL,book_date DATE NOT NULL,shift TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence>0),created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 closed_at TIMESTAMPTZ,request_key UUID UNIQUE NOT NULL,
 UNIQUE(site,book_date,shift,sequence));
 CREATE UNIQUE INDEX IF NOT EXISTS mis_vlb_one_open_batch_per_user ON mis_vlb_batches(created_by) WHERE closed_at IS NULL;
 CREATE TABLE IF NOT EXISTS mis_vlb_batch_entries(
 batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),logbook_id BIGINT PRIMARY KEY REFERENCES mis_log_books(id),
 snapshot JSONB NOT NULL);
 CREATE INDEX IF NOT EXISTS mis_vlb_batch_entries_batch ON mis_vlb_batch_entries(batch_id);`;
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const actor=req=>{const login=String(req.session.login||req.session.name||'').trim();if(!login)fail('Sign in to manage batches.',401);return login};
// The transaction lock serializes creation across users, keeping membership and
// sequence allocation atomic even when two users select the same saved cards.
const lock=client=>client.query("SELECT pg_advisory_xact_lock(hashtext('mis_vlb_saved_batches'))");
async function eligible(client,selection,{locking=false}={}){
 const {rows}=await client.query(`SELECT l.id,l.book_no,l.book_type,l.site,l.book_date::text,l.data,l.revision,l.created_by,l.created_at
 FROM mis_log_books l WHERE l.book_type='vehicle' AND l.deleted_at IS NULL AND l.book_date=$1
 AND NOT EXISTS(SELECT 1 FROM mis_vlb_batch_entries e WHERE e.logbook_id=l.id)
 ORDER BY l.id${locking?' FOR UPDATE OF l':''}`,[selection.date]);
 return rows.filter(r=>canonicalSiteName(r.site)===selection.site&&vlbRecordShift(r.data)===selection.shift);
}
async function owned(client,id,user,scope){
 if(!uuid(id))fail('Invalid batch ID.');
 const batch=(await client.query('SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE id=$1 AND created_by=$2',[id,user])).rows[0];
 if(!batch)fail('Batch is unavailable.',404);
 requireLogBookSite(scope,batch.site);return batch;
}
async function details(client,batch){
 const records=(await client.query('SELECT snapshot FROM mis_vlb_batch_entries WHERE batch_id=$1 ORDER BY logbook_id',[batch.id])).rows.map(r=>r.snapshot);
 return {...batch,records,entry_count:records.length};
}
export function registerVlbBatches(app,{pool,protect,ensureBooks}){
 let ready;
 const ensure=async()=>{await ensureBooks();await (ready??=pool.query(VLB_BATCH_SCHEMA).catch(e=>{ready=null;throw e}))};
 const handle=fn=>async(req,res,next)=>{try{await ensure();res.set('Cache-Control','no-store');await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}};
 app.get('/api/vlb-batches',...protect,handle(async(req,res)=>{
  const {rows}=await pool.query(`SELECT b.*,b.book_date::text AS report_date,(SELECT count(*)::int FROM mis_vlb_batch_entries e WHERE e.batch_id=b.id) AS entry_count
   FROM mis_vlb_batches b WHERE b.created_by=$1 ORDER BY (b.closed_at IS NULL) DESC,b.created_at DESC LIMIT 100`,[actor(req)]);
  // An open batch continues to block creation even if its site assignment has changed.
  const openBatch=rows.find(b=>!b.closed_at)||null;
  const batches=rows.filter(b=>{try{requireLogBookSite(req.logBookScope,b.site);return true}catch{return false}});
  res.json({batches,openBatch:openBatch?{id:openBatch.id,...(batches.includes(openBatch)?openBatch:{restricted:true})}:null});
 }));
 app.get('/api/vlb-batches/preview',...protect,handle(async(req,res)=>{
  const selection=vlbBatchSelection(req.query);requireLogBookSite(req.logBookScope,selection.site);
  const records=await eligible(pool,selection);
  const sequence=Number((await pool.query('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM mis_vlb_batches WHERE site=$1 AND book_date=$2 AND shift=$3',[selection.site,selection.date,selection.shift])).rows[0].n);
  res.json({selection,records,name:vlbBatchName(selection,sequence)});
 }));
 app.get('/api/vlb-batches/:id',...protect,handle(async(req,res)=>res.json(await details(pool,await owned(pool,req.params.id,actor(req),req.logBookScope)))));
 app.post('/api/vlb-batches',...protect,handle(async(req,res)=>{
  const user=actor(req),selection=vlbBatchSelection(req.body);requireLogBookSite(req.logBookScope,selection.site);
  if(!uuid(req.body.requestKey))fail('Invalid batch save reference.');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');await lock(client);
   const prior=(await client.query('SELECT id,created_by,site,book_date::text AS report_date,shift FROM mis_vlb_batches WHERE request_key=$1',[req.body.requestKey])).rows[0];
   if(prior){if(prior.created_by!==user||prior.site!==selection.site||prior.report_date!==selection.date||prior.shift!==selection.shift)fail('Batch save reference already used.',409);const result=await details(client,await owned(client,prior.id,user,req.logBookScope));await client.query('COMMIT');return res.json(result)}
   if((await client.query('SELECT id FROM mis_vlb_batches WHERE created_by=$1 AND closed_at IS NULL',[user])).rows.length)fail('Close the previous batch before creating a new batch.',409);
   const records=await eligible(client,selection,{locking:true});if(!records.length)fail('No saved, unbatched Manual or Scan entries match this site, date and shift.');
   const sequence=Number((await client.query('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM mis_vlb_batches WHERE site=$1 AND book_date=$2 AND shift=$3',[selection.site,selection.date,selection.shift])).rows[0].n);
   const batch=(await client.query('INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *,book_date::text AS report_date',[randomUUID(),vlbBatchName(selection,sequence),selection.site,selection.date,selection.shift,sequence,user,req.body.requestKey])).rows[0];
   await client.query('INSERT INTO mis_vlb_batch_entries(batch_id,logbook_id,snapshot) SELECT $1,(r->>\'id\')::bigint,r FROM jsonb_array_elements($2::jsonb) r',[batch.id,JSON.stringify(records)]);
   await client.query('COMMIT');res.status(201).json({...batch,records,entry_count:records.length});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
 }));
 app.post('/api/vlb-batches/:id/close',...protect,handle(async(req,res)=>{
  const client=await pool.connect();try{
   await client.query('BEGIN');await lock(client);
   const batch=await owned(client,req.params.id,actor(req),req.logBookScope);
   const closed=batch.closed_at?batch:(await client.query('UPDATE mis_vlb_batches SET closed_at=NOW() WHERE id=$1 RETURNING *,book_date::text AS report_date',[batch.id])).rows[0];
   const result=await details(client,closed);await client.query('COMMIT');res.json(result);
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
 }));
}
