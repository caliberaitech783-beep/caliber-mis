import {createHash} from 'node:crypto';
import {decodeScanRow} from './scan-text-storage.mjs';

export const deletionError=(message,status=409)=>{throw Object.assign(Error(message),{status});};
export function stableJson(value){
 const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
 return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}
export const scopeHash=value=>createHash('sha256').update(stableJson(value)).digest('hex');
const number=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const dateKey=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const cardNumber=data=>number(data?.scanCardNumber||data?.aFormNo||data?.jobCardNo);
const hasTable=async(c,name)=>Boolean((await c.query('SELECT to_regclass($1) AS relation',[name])).rows[0].relation);
const scanColumns=`c.id,c.batch_id,b.kind,c.ordinal,c.filename,c.status,c.revision,c.logbook_id,c.image_hash,c.image_blob_key,c.image_bytes,
 c.draft,b.expected_context,md5((to_jsonb(c)-'image')::text) AS fingerprint`;
const linkedScanSql=`SELECT ${scanColumns} FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id
 WHERE c.logbook_id=ANY($1::bigint[]) OR c.id::text=ANY($2::text[]) ORDER BY c.id FOR UPDATE OF c`;

export async function discoverDeletionScope(c,records,{skipRequestId=null,assertSite=()=>{},imageStorage}={}){
 const ids=records.map(r=>String(r.id)),linkedIds=records.map(r=>r.data?.scanCardId).filter(Boolean);
 const tables={};for(const name of ['mis_scan_cards','mis_scan_backup_items','mis_vlb_batch_entries','mis_pulse_trip_verifications'])tables[name]=await hasTable(c,name);
 const keys=records.filter(r=>cardNumber(r.data)).map(r=>({kind:r.book_type,date:dateKey(r.book_date||r.data?.bookDate),asset:String(r.asset_id),number:cardNumber(r.data)}));
 let scans=tables.mis_scan_cards?(await c.query(linkedScanSql,[ids,linkedIds])).rows:[];
 for(const scan of scans){
  const draft=decodeScanRow({...scan}).draft;
  if(!keys.some(k=>k.kind===scan.kind&&k.date===draft?.bookDate&&k.asset===String(draft?.assetId)&&k.number===cardNumber(draft))&&cardNumber(draft)&&validDate(draft?.bookDate)&&/^\d+$/.test(String(draft?.assetId||'')))keys.push({kind:scan.kind,date:draft.bookDate,asset:String(draft.assetId),number:cardNumber(draft)});
 }
 const initialBackups=tables.mis_scan_backup_items?(await c.query(`SELECT i.image_hash FROM mis_scan_backup_items i WHERE i.card_id::text=ANY($1::text[]) OR i.metadata->>'logbookId'=ANY($2::text[]) OR EXISTS(
  SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS k(kind text,date text,asset text,number text)
  WHERE i.metadata->>'kind'=k.kind AND COALESCE(i.metadata->'savedLogbookData'->>'bookDate',i.metadata->'draft'->>'bookDate')=k.date
  AND COALESCE(i.metadata->'savedLogbookData'->>'assetId',i.metadata->'draft'->>'assetId')=k.asset
  AND regexp_replace(upper(COALESCE(NULLIF(i.metadata->'savedLogbookData'->>'scanCardNumber',''),NULLIF(i.metadata->'savedLogbookData'->>'aFormNo',''),NULLIF(i.metadata->'savedLogbookData'->>'jobCardNo',''),NULLIF(i.metadata->'draft'->>'aFormNo',''),i.metadata->'draft'->>'jobCardNo','')),'[^A-Z0-9]','','g')=k.number)`,[linkedIds,ids,JSON.stringify(keys)])).rows:[];
 const hashes=new Set([...scans.map(s=>s.image_hash),...initialBackups.map(b=>b.image_hash)].filter(Boolean));
 if(tables.mis_scan_cards){
  // Fixed record identities; expand image hashes without adopting unrelated draft identities.
  for(let pass=0;pass<3;pass++){
   const found=(await c.query(`SELECT ${scanColumns} FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id
    WHERE c.logbook_id=ANY($1::bigint[]) OR c.id::text=ANY($2::text[]) OR c.image_hash=ANY($3::text[]) OR EXISTS(
     SELECT 1 FROM jsonb_to_recordset($4::jsonb) AS k(kind text,date text,asset text,number text)
     WHERE b.kind=k.kind AND c.draft->>'bookDate'=k.date AND c.draft->>'assetId'=k.asset
     AND regexp_replace(upper(COALESCE(NULLIF(c.draft->>'scanCardNumber',''),NULLIF(c.draft->>'aFormNo',''),c.draft->>'jobCardNo','')),'[^A-Z0-9]','','g')=k.number)
    ORDER BY c.id LIMIT 5001 FOR UPDATE OF c`,[ids,linkedIds,[...hashes],JSON.stringify(keys)])).rows;
   if(found.length>5000)deletionError('More than 5,000 duplicate scans match. Narrow the record selection.');
   scans=found;const before=hashes.size;scans.forEach(s=>hashes.add(s.image_hash));if(hashes.size===before)break;
  }
 }
 const scanIds=[...new Set([...linkedIds,...scans.map(s=>s.id)])];
 const backups=tables.mis_scan_backup_items?(await c.query(`SELECT i.backup_id,i.card_id,i.blob_key,i.image_hash,i.image_bytes,i.metadata,
   b.destination,md5(row_to_json(i)::text) AS fingerprint FROM mis_scan_backup_items i JOIN mis_scan_backups b ON b.id=i.backup_id
   WHERE i.card_id::text=ANY($1::text[]) OR i.metadata->>'logbookId'=ANY($2::text[]) OR i.image_hash=ANY($3::text[])
   ORDER BY i.backup_id,i.card_id FOR UPDATE OF i,b`,[scanIds,ids,[...hashes]])).rows:[];
 const allScanIds=[...new Set([...scanIds,...backups.map(b=>b.card_id)])];
 const conflicts=(await c.query(`SELECT l.id,l.book_no FROM mis_log_books l WHERE l.id<>ALL($1::bigint[]) AND l.deleted_at IS NULL AND(
   l.data->>'scanCardId'=ANY($2::text[]) OR l.id=ANY($3::bigint[]) OR EXISTS(
    SELECT 1 FROM jsonb_to_recordset($4::jsonb) AS k(kind text,date text,asset text,number text)
    WHERE l.book_type=k.kind AND l.book_date=k.date::date AND l.asset_id::text=k.asset
    AND regexp_replace(upper(COALESCE(NULLIF(l.data->>'scanCardNumber',''),NULLIF(l.data->>'aFormNo',''),l.data->>'jobCardNo','')),'[^A-Z0-9]','','g')=k.number)) ORDER BY l.id`,
  [ids,allScanIds,[...scans.map(s=>s.logbook_id),...backups.map(b=>b.metadata?.logbookId)].filter(Boolean),JSON.stringify(keys)])).rows;
 if(conflicts.length)deletionError('A duplicate belongs to another active record outside this selection. Include that record before preparing deletion.');
 if(scans.some(s=>s.logbook_id&&!ids.includes(String(s.logbook_id))))deletionError('A duplicate belongs to another retained logbook. Its record must be selected first.');
 const snapshots=(await c.query(`SELECT d.id AS request_id,s.position::int AS position,s.item->>'id' AS record_id,s.item->>'book_no' AS book_no,
  s.item->>'site' AS site,md5(s.item::text) AS fingerprint FROM mis_log_book_deletions d
  CROSS JOIN LATERAL jsonb_array_elements(d.snapshot) WITH ORDINALITY AS s(item,position)
  WHERE ($3::uuid IS NULL OR d.id<>$3::uuid) AND(s.item->>'id'=ANY($1::text[]) OR s.item->'data'->>'scanCardId'=ANY($2::text[]))
  ORDER BY d.id,s.position`,[ids,allScanIds,skipRequestId])).rows;
 const batchLinks=tables.mis_vlb_batch_entries?(await c.query(`SELECT e.batch_id,e.logbook_id,md5(e.snapshot::text) AS fingerprint
  FROM mis_vlb_batch_entries e WHERE e.logbook_id=ANY($1::bigint[]) OR e.snapshot->'data'->>'scanCardId'=ANY($2::text[])
  ORDER BY e.batch_id,e.logbook_id FOR UPDATE`,[ids,allScanIds])).rows:[];
 if(batchLinks.some(b=>!ids.includes(String(b.logbook_id))))deletionError('A saved-batch snapshot belongs to an unselected record. Include that record first.');
 const verification=tables.mis_pulse_trip_verifications?(await c.query('SELECT j.logbook_id,j.status,j.request_ref,md5(row_to_json(j)::text) AS fingerprint FROM mis_pulse_trip_verifications j WHERE logbook_id=ANY($1::bigint[]) ORDER BY logbook_id FOR UPDATE',[ids])).rows:[];
 snapshots.forEach(s=>{if(s.site)assertSite(s.site);});
 const sites=[...new Set(records.map(r=>r.site))],recordSite=sites.length===1?sites[0]:null;
 const publicScans=scans.map(s=>{
  const draft=decodeScanRow({...s}).draft||{},site=draft.location||s.expected_context?.location||records.find(r=>String(r.id)===String(s.logbook_id))?.site||recordSite;
  assertSite(site);
  return {id:s.id,batch_id:s.batch_id,kind:s.kind,ordinal:s.ordinal,filename:s.filename,status:s.status,revision:s.revision,logbook_id:s.logbook_id,
   site,bookDate:draft.bookDate||null,door:draft.door||null,cardNumber:cardNumber(draft),image_hash:s.image_hash,image_blob_key:s.image_blob_key,image_bytes:s.image_bytes,fingerprint:s.fingerprint,
   match:linkedIds.includes(s.id)||ids.includes(String(s.logbook_id))?'Linked source':hashes.has(s.image_hash)?'Duplicate image or card identity':'Duplicate card identity'};
 });
 const publicBackups=backups.map(b=>{
  assertSite(b.metadata?.savedLogbookData?.location||b.metadata?.draft?.location||recordSite);
  return {backup_id:b.backup_id,card_id:b.card_id,blob_key:b.blob_key,image_hash:b.image_hash,image_bytes:b.image_bytes,destination:b.destination||'',fingerprint:b.fingerprint};
 });
 const files=publicBackups.flatMap(b=>{
  const ext=/\.jpg$/i.test(b.blob_key)?'.jpg':'.png',folderName='Pulse-II-'+b.backup_id;
  return [ext,'.json'].map(suffix=>({key:b.backup_id+'/'+b.card_id+suffix,backup_id:b.backup_id,card_id:b.card_id,folderName,filename:b.card_id+suffix,
   destination:b.destination,kind:suffix==='.json'?'metadata':'image',imageFilename:b.card_id+ext,imageHash:b.image_hash,expectedBytes:suffix==='.json'?null:String(b.image_bytes)}));
 });
 const cloud=[];const seen=new Set();
 for(const scan of publicScans)if(scan.image_blob_key&&!seen.has(scan.image_blob_key)){seen.add(scan.image_blob_key);cloud.push({key:scan.image_blob_key,imageHash:scan.image_hash});}
 for(const backup of publicBackups)if(backup.blob_key&&!seen.has(backup.blob_key)){seen.add(backup.blob_key);cloud.push({key:backup.blob_key,imageHash:backup.image_hash});}
 if(tables.mis_scan_cards&&cloud.length){
  const shared=(await c.query('SELECT id FROM mis_scan_cards WHERE image_blob_key=ANY($1::text[]) AND id::text<>ALL($2::text[]) LIMIT 1',[cloud.map(item=>item.key),publicScans.map(s=>s.id)])).rows;
  if(shared.length)deletionError('A backup image is shared with an unlisted scan. The deletion scope needs review.');
 }
 if(cloud.length&&!imageStorage?.stat)deletionError('Source image storage cannot verify this exact deletion list.',503);
 let next=0;await Promise.all(Array.from({length:Math.min(8,cloud.length)},async()=>{while(next<cloud.length){const item=cloud[next++],stat=await imageStorage.stat(item.key);if(typeof stat?.exists!=='boolean')deletionError('Cloud image verification is incomplete.',503);if(stat.exists&&stat.sha256&&stat.sha256!==item.imageHash)deletionError('A cloud image checksum changed. No deletion was prepared.');Object.assign(item,{exists:stat.exists,etag:stat.etag||null,bytes:stat.bytes??null,location:stat.location||item.key});if(item.exists&&!item.etag)deletionError('A cloud image cannot be bound to an exact version.',503);}}));
 cloud.sort((a,b)=>a.key.localeCompare(b.key));
 return {version:2,records:records.map(r=>({id:r.id,book_no:r.book_no,book_type:r.book_type,site:r.site,revision:r.revision,fingerprint:scopeHash(r)})),
  scans:publicScans,backups:publicBackups,files,cloud,snapshots,batchLinks,verification,localFiles:[]};
}

export function bindLocalFiles(manifest,files){
 if(!Array.isArray(files)||files.length!==manifest.files.length||new Set(files.map(f=>f?.key)).size!==files.length)deletionError('Verify every listed SSD file before approving this deletion.');
 const normalized=manifest.files.map(expected=>{
  const file=files.find(f=>f?.key===expected.key);
  if(!file||typeof file.exists!=='boolean')deletionError('Every listed SSD file needs an exact presence check.');
  if(!file.exists)return {key:file.key,exists:false,bytes:0,sha256:null};
  if(!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/i.test(file.sha256||''))deletionError('Invalid SSD file fingerprint.');
  if(expected.kind==='image'&&(file.sha256!==expected.imageHash||String(file.bytes)!==expected.expectedBytes))deletionError('An SSD image does not match its registered scan.');
  return {key:file.key,exists:true,bytes:file.bytes,sha256:file.sha256.toLowerCase()};
 });
 return {...manifest,localFiles:normalized};
}
