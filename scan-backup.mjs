import {randomUUID} from 'node:crypto';
import {imageHash} from './scan-blob-storage.mjs';
export const DAY=86400000;
export function backupWindows(first,now=new Date()){
 if(!first)return [];
 const start=new Date(first).getTime();if(!Number.isFinite(start))throw Error('Invalid backup start.');
 const windows=[];
 for(let index=0;start+(index+2)*30*DAY<=new Date(now).getTime();index++){
  const from=new Date(start+index*30*DAY).toISOString(),to=new Date(start+(index+1)*30*DAY).toISOString();
  windows.push({from,to,dueAt:new Date(start+(index+2)*30*DAY).toISOString()});
 }
 return windows;
}
export const SCAN_BACKUP_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_scan_backups(id UUID PRIMARY KEY,window_start TIMESTAMPTZ NOT NULL,window_end TIMESTAMPTZ NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_by TEXT NOT NULL,destination TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ,UNIQUE(window_start,window_end));
 CREATE TABLE IF NOT EXISTS mis_scan_backup_items(backup_id UUID NOT NULL REFERENCES mis_scan_backups(id),card_id UUID NOT NULL,blob_key TEXT NOT NULL,image_hash TEXT NOT NULL,image_bytes BIGINT NOT NULL,metadata JSONB NOT NULL,verified_at TIMESTAMPTZ,PRIMARY KEY(backup_id,card_id));
 CREATE INDEX IF NOT EXISTS mis_scan_cards_blob_date ON mis_scan_cards(blob_uploaded_at,id) WHERE image_blob_key IS NOT NULL;
`;
const validId=value=>/^[a-f0-9-]{36}$/i.test(String(value||''));
export function registerScanBackup(app,{pool,requireSession,requireAdministrator,imageStorage,getSiteScope=async()=>({sites:null}),now=()=>new Date()}){
 const wrap=fn=>async(req,res,next)=>{try{await fn(req,res)}catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}};
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
 const protect=[requireSession,requireAdministrator];
 // Backups cover all sites. Restricted accounts cannot export another site's cards.
 protect[2]=async(req,res,next)=>{try{const scope=await getSiteScope(req.session);if(scope.sites!==null)return res.status(403).json({error:'Scanned-card backup requires an administrator with access to all sites.'});next()}catch(e){next(e)}};
 async function status(){
  const first=(await pool.query('SELECT min(blob_uploaded_at) AS first FROM mis_scan_cards WHERE image_blob_key IS NOT NULL')).rows[0]?.first;
  const jobs=(await pool.query('SELECT b.*,count(i.card_id)::int AS cards,count(i.verified_at)::int AS verified,COALESCE(sum(i.image_bytes),0)::text AS bytes FROM mis_scan_backups b LEFT JOIN mis_scan_backup_items i ON i.backup_id=b.id GROUP BY b.id ORDER BY b.window_start')).rows;
  const windows=backupWindows(first,now());
  const due=windows.filter(window=>!jobs.some(job=>new Date(job.window_start).toISOString()===window.from&&job.status==='complete'));
  return {enabled:Boolean(imageStorage),hotDays:60,cycleDays:30,firstScanAt:first||null,nextDueAt:first?new Date(new Date(first).getTime()+(jobs.filter(job=>job.status==='complete').length+2)*30*DAY).toISOString():null,due,jobs};
 }
 async function jobFor(id){if(!validId(id))fail('Invalid backup reference.');const job=(await pool.query('SELECT * FROM mis_scan_backups WHERE id=$1',[id])).rows[0];if(!job)fail('Backup not found.',404);return job;}
 app.get('/api/scan-backups',...protect,wrap(async(req,res)=>res.set('Cache-Control','no-store').json(await status())));
 app.post('/api/scan-backups',...protect,wrap(async(req,res)=>{
  if(!imageStorage)fail('Hot Blob storage is not enabled.',503);
  const state=await status(),window=state.due[0];if(!window)fail('No 30-day backup block is due yet.',409);
  const c=await pool.connect();try{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(709224160)');
   let job=(await c.query('SELECT * FROM mis_scan_backups WHERE window_start=$1 AND window_end=$2 FOR UPDATE',[window.from,window.to])).rows[0];
   if(!job){const id=randomUUID();job=(await c.query('INSERT INTO mis_scan_backups(id,window_start,window_end,created_by) VALUES($1,$2,$3,$4) RETURNING *',[id,window.from,window.to,req.session.login||req.session.name])).rows[0];
    await c.query(`INSERT INTO mis_scan_backup_items(backup_id,card_id,blob_key,image_hash,image_bytes,metadata)
     SELECT $1,c.id,c.image_blob_key,c.image_hash,c.image_bytes,jsonb_build_object('cardId',c.id,'batchId',c.batch_id,'kind',b.kind,'filename',c.filename,'scanCreatedAt',c.created_at,'draft',c.draft,'originalExtraction',c.raw_fields,'reviewedBy',c.checked_by,'reviewedAt',c.checked_at,'logbookId',c.logbook_id,'bookNumber',l.book_no,'savedLogbookData',l.data)
     FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id LEFT JOIN mis_log_books l ON l.id=c.logbook_id
     WHERE c.image_blob_key IS NOT NULL AND c.blob_uploaded_at >= $2 AND c.blob_uploaded_at < $3`,[id,window.from,window.to]);
   }
   await c.query('COMMIT');res.json({job});
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }));
 app.get('/api/scan-backups/:id/items',...protect,wrap(async(req,res)=>{
  await jobFor(req.params.id);const after=req.query.after||null;if(after&&!validId(after))fail('Invalid backup cursor.');
  const rows=(await pool.query('SELECT card_id,image_hash,image_bytes,metadata,verified_at FROM mis_scan_backup_items WHERE backup_id=$1 AND ($2::uuid IS NULL OR card_id>$2) ORDER BY card_id LIMIT 100',[req.params.id,after])).rows;
  res.set('Cache-Control','no-store').json({items:rows,next:rows.length===100?rows.at(-1).card_id:null});
 }));
 app.get('/api/scan-backups/:id/images/:cardId',...protect,wrap(async(req,res)=>{
  if(!imageStorage)fail('Hot storage is unavailable.',503);await jobFor(req.params.id);if(!validId(req.params.cardId))fail('Invalid card reference.');
  const item=(await pool.query('SELECT * FROM mis_scan_backup_items WHERE backup_id=$1 AND card_id=$2',[req.params.id,req.params.cardId])).rows[0];if(!item)fail('Card not found in this backup.',404);
  const bytes=await imageStorage.read(item.blob_key,item.image_hash);if(imageHash(bytes)!==item.image_hash)fail('Image verification failed.',502);
  res.set('Cache-Control','no-store').type('application/octet-stream').send(bytes);
 }));
 app.post('/api/scan-backups/:id/verified',...protect,wrap(async(req,res)=>{
  const job=await jobFor(req.params.id);if(job.status==='complete')return res.json({complete:true});
  const {cardId,sha256}=req.body;if(!validId(cardId)||!/^[a-f0-9]{64}$/.test(sha256||''))fail('Invalid verification receipt.');
  const result=await pool.query('UPDATE mis_scan_backup_items SET verified_at=NOW() WHERE backup_id=$1 AND card_id=$2 AND image_hash=$3 RETURNING card_id',[job.id,cardId,sha256]);if(!result.rows.length)fail('Backup checksum did not match.',409);res.json({verified:true});
 }));
 app.post('/api/scan-backups/:id/complete',...protect,wrap(async(req,res)=>{
  const job=await jobFor(req.params.id);if(job.status==='complete')return res.json({complete:true});const destination=String(req.body.destination||'').trim().slice(0,240);if(!destination)fail('Choose an SSD backup folder.');
  const result=await pool.query("UPDATE mis_scan_backups SET status='complete',destination=$2,completed_at=NOW() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM mis_scan_backup_items WHERE backup_id=$1 AND verified_at IS NULL) RETURNING id",[req.params.id,destination]);
  if(!result.rows.length)fail('Some files are not verified. Resume this backup before marking it complete.',409);res.json({complete:true});
 }));
 return {start:()=>pool.query(SCAN_BACKUP_SCHEMA)};
}
