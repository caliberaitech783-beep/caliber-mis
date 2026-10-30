import {bookShiftCode} from './trip-card-rules.mjs';
import {requireScanUploadContext} from './scan-batch-context.mjs';

export const SCAN_BATCH_NAMING_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_scan_batch_counters(
 prefix TEXT PRIMARY KEY,
 last_number BIGINT NOT NULL CHECK(last_number>0)
);`;

const segment=value=>String(value||'').trim().toUpperCase().replace(/[\/\\\x00-\x1f\x7f]+/g,'-');
export function tripBatchPrefix(context,user){
 const selected=requireScanUploadContext('vehicle',context);
 const username=segment(user).replace(/\s+/g,'');
 if(!username)throw new Error('A signed-in username is required to name a Trip Card batch.');
 return `CMLL/${selected.bookDate}/${segment(selected.location)}/${bookShiftCode(selected.cardShift)}/${username}`;
}

// Allocate and insert in one statement: concurrent callers serialize on the
// prefix's counter row, and a failed insert cannot consume a batch number.
// Names are assigned only at creation, so retries, add-ons and posting retain it.
export async function createScanBatch(client,{id,kind,name,user,expectedContext}){
 const context=requireScanUploadContext(kind,expectedContext);
 if(kind!=='vehicle')return (await client.query(
  'INSERT INTO mis_scan_batches(id,kind,name,created_by,expected_context) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id,name',
  [id,kind,String(name||'Scanned cards').slice(0,200),user,context?JSON.stringify(context):null]
 )).rows[0];
 const prefix=tripBatchPrefix(context,user);
 return (await client.query(`WITH next_number AS (
  INSERT INTO mis_scan_batch_counters(prefix,last_number)
  SELECT $5,COALESCE(MAX(CASE WHEN substring(name FROM length($5::text)+3) ~ '^[0-9]{1,15}$'
   THEN substring(name FROM length($5::text)+3)::bigint ELSE 0 END),0)+1
  FROM mis_scan_batches WHERE kind='vehicle' AND left(name,length($5::text)+2)=$5||'/B'
  ON CONFLICT(prefix) DO UPDATE SET last_number=GREATEST(mis_scan_batch_counters.last_number,EXCLUDED.last_number-1)+1
  RETURNING last_number
 ) INSERT INTO mis_scan_batches(id,kind,name,created_by,expected_context)
 SELECT $1,$2,$5||'/B'||CASE WHEN last_number<10 THEN '0' ELSE '' END||last_number::text,$3,$4::jsonb
 FROM next_number RETURNING id,name`,[id,kind,user,JSON.stringify(context),prefix])).rows[0];
}
