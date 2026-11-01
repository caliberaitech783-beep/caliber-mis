import {canonicalSiteName} from './site-location.mjs';
import {manpowerFilters,buildManpowerReport} from './manpower-report.mjs';
import {siteAllowed,filterLogBookSites,requireLogBookSite} from './log-book-access.mjs';

export function registerManpowerReports(app,{pool,protect,ensureBooks,withHandovers=async(_,rows)=>rows}){
 app.get('/api/reports/manpower',...protect,async(req,res,next)=>{
  let client;
  try{
   const filters=manpowerFilters(req.query);
   if(filters.site)requireLogBookSite(req.logBookScope,filters.site);
   await ensureBooks();client=await pool.connect();
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   let sites=await filterLogBookSites(client,req.logBookScope);
   if(filters.site){if(sites===null)sites=(await client.query('SELECT DISTINCT site FROM mis_log_books WHERE book_date BETWEEN $1 AND $2',[filters.contextFrom,filters.contextTo])).rows.map(r=>r.site);sites=sites.filter(site=>canonicalSiteName(site)===canonicalSiteName(filters.site));}
   const {rows}=await client.query(`SELECT l.id,l.book_no,l.book_type,l.book_date::text,l.site,l.asset_id,
    l.data-'manualAttachments' AS data,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'closed_at',b.closed_at))
     FROM mis_vlb_batch_entries e JOIN mis_vlb_batches b ON b.id=e.batch_id
     WHERE e.logbook_id=l.id AND b.archived_at IS NULL AND b.deleted_at IS NULL),'[]'::jsonb) AS batches
    FROM mis_log_books l WHERE l.deleted_at IS NULL AND l.book_date>=$$2026-11-01$$
    AND l.book_date BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR l.site=ANY($3::text[]))
    ORDER BY l.book_date,l.id LIMIT 50001`,[filters.contextFrom,filters.contextTo,sites]);
   if(rows.length>50000)throw Object.assign(new Error('This range contains too many saved cards. Select a shorter date range.'),{status:400});
   const visible=rows.filter(r=>siteAllowed(req.logBookScope,r.site));
   const linked=await withHandovers(client,visible.filter(r=>r.book_type==='vehicle'),sites);
   const masters=(await client.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY id",[['Equipment master','Shift Master','Employee master','ERP Employee master','C-Dir Employee master','Users & employees']])).rows;
   const fromMaster=names=>masters.filter(r=>names.includes(r.master_name)).map(r=>({...r.record_data,id:String(r.id)}));
   const batches=(await client.query(`SELECT id,name,site,book_date::text AS report_date,closed_at FROM mis_vlb_batches
    WHERE deleted_at IS NULL AND archived_at IS NULL AND book_date BETWEEN $1 AND $2`,[filters.from,filters.to])).rows.filter(b=>siteAllowed(req.logBookScope,b.site));
   const report=buildManpowerReport({records:[...linked,...visible.filter(r=>r.book_type!=='vehicle')],assets:fromMaster(['Equipment master']),employees:fromMaster(['Employee master','ERP Employee master','C-Dir Employee master','Users & employees']),shifts:fromMaster(['Shift Master']),batches,filters});
   await client.query('COMMIT');
   res.set('Cache-Control','private, no-store').json({...report,generatedAt:new Date().toISOString()});
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});if(error.status)return res.status(error.status).json({error:error.message});next(error);}
  finally{client?.release();}
 });
}
