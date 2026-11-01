import {randomUUID} from 'node:crypto';
import {canonicalSiteName} from '../site-location.mjs';
import {vlbRecordShift} from '../vlb-batch-format.mjs';
// Arrange a permitted batch for tests of logbook/scanner behavior. Batch
// ownership, locking and approval behavior have their own integration tests.
export async function prepareVlbFixture(db,input={},login='test-admin'){
 const date=input.bookDate||input.date,site=canonicalSiteName(input.location||input.site),shift=vlbRecordShift(input)||'S1';
 if(!date||date<'2026-11-01'||!site)return;
 await db.query('UPDATE mis_vlb_batches SET closed_at=COALESCE(closed_at,NOW()) WHERE site=$1 AND (book_date<>$2 OR shift<>$3)',[site,date,shift]);
 const existing=(await db.query('SELECT id FROM mis_vlb_batches WHERE site=$1 AND book_date=$2 AND shift=$3',[site,date,shift])).rows[0];
 if(existing){await db.query('UPDATE mis_vlb_batches SET closed_at=NULL,amendment_by=NULL,trial_reopened_until=NULL WHERE id=$1',[existing.id]);return;}
 await db.query('INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,creator_login,request_key,continuous_entry,saved_lock_policy) VALUES($1,$2,$3,$4,$5,1,NULL,$6,$7,TRUE,TRUE)',[randomUUID(),'FIXTURE/'+site+'/'+date+'/'+shift,site,date,shift,login,randomUUID()]);
}
export async function extendOperationalScanFixture(db){
 await db.exec(`CREATE TABLE IF NOT EXISTS mis_log_books(id BIGINT PRIMARY KEY,book_date DATE);
 ALTER TABLE mis_scan_batches ADD COLUMN IF NOT EXISTS expected_context JSONB DEFAULT '{"bookDate":"2026-12-01"}';
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS draft JSONB DEFAULT '{}';
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT '2026-12-01T00:00:00Z';
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS logbook_id BIGINT;`);
}
