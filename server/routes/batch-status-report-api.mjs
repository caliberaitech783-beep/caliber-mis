import {canonicalSiteName} from '../../shared/site-location.mjs';
import {siteAllowed,requireLogBookSite} from '../../shared/log-book-access.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {OPERATIONAL_START} from '../../shared/operational-start.mjs';
import {batchStatusFilters,buildBatchStatusReport,buildBatchDetail} from '../../shared/batch-status-report.mjs';
import {directLane,reportKey} from '../services/report-lane.mjs';

const BATCH_COLUMNS=`b.id,b.name,b.site,b.book_date::text AS date,b.shift,b.stage,b.created_at,b.vlb_locked_at,b.lmv_locked_at,b.closed_at,COALESCE(b.creator_login,b.created_by,'') AS created_by`;
const shiftMaster=async client=>(await client.query("SELECT id,record_data FROM master_records WHERE master_name='Shift Master' ORDER BY id")).rows.map(r=>({...r.record_data,id:String(r.id)}));
// LMV log books are kept by site, date and shift, not by batch. Only what the report needs is read.
async function lmvBooks(client,from,to){
 const {rows}=await client.query(`SELECT book_no,site,book_date::text AS date,created_at AS at,created_by AS by,
  jsonb_build_object('location',data->'location','bookShiftCode',data->'bookShiftCode','cardShift',data->'cardShift','shiftName',data->'shiftName') AS data
  FROM mis_log_books WHERE book_type='lmv' AND deleted_at IS NULL AND book_date BETWEEN $1 AND $2 ORDER BY id LIMIT 50001`,[from,to]);
 if(rows.length>50000)throw Object.assign(new Error('This range contains too many LMV log books. Select a shorter date range.'),{status:400});
 return rows.map(r=>({book_no:r.book_no,site:r.data.location||r.site,date:r.date,shift:vlbRecordShift(r.data),at:r.at,by:r.by}));
}

export function registerBatchStatusReport(app,{pool,protect,ensureBooks,now=()=>Date.now(),lane=directLane}){
 // Steps 1 and 2: every permitted site, every due shift in the range.
 app.get('/api/reports/batch-status',...protect,async(req,res,next)=>{
  try{
   const filters=batchStatusFilters(req.query);
   await ensureBooks();
   const report=await lane.run(reportKey('batch-status',req),async()=>{
   let client;
   try{
   client=await pool.connect();
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const allowed=row=>siteAllowed(req.logBookScope,row.site);
   // A site is counted from the date of its first batch, so a site that started later is not shown as behind before that.
   const siteStarts=(await client.query(`SELECT site,min(book_date)::text AS "firstDate" FROM mis_vlb_batches
    WHERE deleted_at IS NULL AND archived_at IS NULL AND book_date>=$1 AND book_date<=$2 GROUP BY site`,[OPERATIONAL_START,filters.to])).rows.filter(allowed);
   const batches=(await client.query(`SELECT ${BATCH_COLUMNS},
    (SELECT count(*)::int FROM mis_vlb_batch_entries e JOIN mis_log_books l ON l.id=e.logbook_id AND l.deleted_at IS NULL WHERE e.batch_id=b.id) AS cards,
    (SELECT count(*)::int FROM mis_vlb_batch_fleet f WHERE f.batch_id=b.id) AS machines_total,
    (SELECT count(*)::int FROM mis_vlb_batch_fleet f JOIN mis_log_books l ON l.id=f.logbook_id AND l.deleted_at IS NULL WHERE f.batch_id=b.id) AS machines_saved
    FROM mis_vlb_batches b WHERE b.deleted_at IS NULL AND b.archived_at IS NULL AND b.book_date BETWEEN $1 AND $2 ORDER BY b.book_date,b.id`,[filters.from,filters.to])).rows.filter(allowed);
   const events=batches.length?(await client.query(`SELECT batch_id,action,actor,occurred_at AS at FROM mis_vlb_batch_audit WHERE batch_id=ANY($1::uuid[]) ORDER BY occurred_at,id LIMIT 300001`,[batches.map(b=>b.id)])).rows:[];
   if(events.length>300000)throw Object.assign(new Error('This range contains too much batch history. Select a shorter date range.'),{status:400});
   const books=(await lmvBooks(client,filters.from,filters.to)).filter(allowed);
   const shifts=await shiftMaster(client);
   await client.query('COMMIT');
   // The connection goes back to the pool before the report is put together.
   client.release();client=null;
   return buildBatchStatusReport({...filters,now:now(),siteStarts,shifts,batches,events,lmvBooks:books});
   }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});throw error;}
   finally{client?.release();}
   });
   res.set('Cache-Control','private, no-store').json(report);
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
 });
 // Steps 3 and 4: one batch, its milestones and every recorded action.
 app.get('/api/reports/batch-status/batch',...protect,async(req,res,next)=>{
  let client;
  try{
   const id=String(req.query.id||'');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return res.status(400).json({error:'Open a batch from the list.'});
   await ensureBooks();client=await pool.connect();
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const batch=(await client.query(`SELECT ${BATCH_COLUMNS} FROM mis_vlb_batches b WHERE b.id=$1 AND b.deleted_at IS NULL AND b.archived_at IS NULL AND b.book_date>=$2`,[id,OPERATIONAL_START])).rows[0];
   if(!batch){await client.query('ROLLBACK');return res.status(404).json({error:'This batch is no longer in the batch list.'});}
   requireLogBookSite(req.logBookScope,batch.site);
   const events=(await client.query(`SELECT action,actor,occurred_at AS at,
    COALESCE(NULLIF(concat_ws(' · ',NULLIF(detail->'after'->>'book_no',''),NULLIF(detail->'after'->'data'->>'door','')),''),NULLIF(detail->>'bookNo',''),NULLIF(detail->>'door',''),'') AS item
    FROM mis_vlb_batch_audit WHERE batch_id=$1 ORDER BY occurred_at,id LIMIT 5000`,[id])).rows;
   const books=(await lmvBooks(client,batch.date,batch.date)).filter(b=>canonicalSiteName(b.site)===canonicalSiteName(batch.site)&&b.shift===batch.shift);
   const detail=buildBatchDetail({batch,shifts:await shiftMaster(client),events,lmvBooks:books,now:now()});
   await client.query('COMMIT');
   res.set('Cache-Control','private, no-store').json({...detail,asOf:new Date(now()).toISOString()});
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});if(error.status)return res.status(error.status).json({error:error.message});next(error);}
  finally{client?.release();}
 });
}
