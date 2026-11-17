// Owner, 17 Nov 2026: work the ELB BD hours filled from Pulse out again after the machine match fix (PR 413).
//   GET  /api/admin/elb-pulse-repair?from=&to=&site=   dry run: every card that would change, old and new. Writes nothing.
//   POST /api/admin/elb-pulse-repair {from,to,site,ids} applies it to the cards listed (by id) that still differ.
// MIS administrators only. Each card keeps its old figures under data.pulseRepair.previous, gets a new revision, and its
// batch line (machine status) and ELB batch copy follow; the batch audit names who did it.
import {isMisAdministrator} from '../../shared/mis-admin-access.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {recomputePulseElb} from '../rules/elb-pulse-repair.mjs';
import {mirrorReadAt} from '../services/pulse-breakdown-mirror.mjs';

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const text=value=>String(value??'').trim();
const CHUNK=50;

export function registerElbPulseRepair(app,{pool,protect,readBreakdownRows}){
 const guard=(req,res,next)=>isMisAdministrator(req.session)?next():res.status(403).json({error:'Only an MIS administrator can repair ELB BD hours.'});
 const params=source=>{
  const from=text(source.from),to=text(source.to),site=text(source.site);
  if(!DATE.test(from)||!DATE.test(to)||to<from||from<'2026-11-01')throw Object.assign(new Error('Choose dates from 01-11-2026 onwards, From on or before To.'),{status:400});
  return {from,to,site};
 };
 async function plan(db,{from,to,site},actor,{lock=false,ids=null}={}){
  const rows=await readBreakdownRows(actor);
  if(!Array.isArray(rows))throw Object.assign(new Error('Pulse breakdown list could not be read.'),{status:503});
  const now=Math.min(mirrorReadAt(rows)??Date.now(),Date.now());
  const books=(await db.query(`SELECT id,book_no,book_date::text AS date,data,revision FROM mis_log_books WHERE deleted_at IS NULL AND book_type='equipment' AND book_date>=$$2026-11-01$$ AND book_date BETWEEN $1 AND $2 AND data->>'breakdownHoursSource'='pulse'${ids?' AND id=ANY($3::bigint[])':''} ORDER BY book_date,id${lock?' FOR UPDATE':''}`,ids?[from,to,ids]:[from,to])).rows
   .filter(b=>!site||canonicalSiteName(b.data?.location)===canonicalSiteName(site));
  const masters=(await db.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[])",[['Equipment master','Shift Master']])).rows;
  const assets=new Map(masters.filter(r=>r.master_name==='Equipment master').map(r=>[String(r.id),r.record_data]));
  const shifts=new Map(masters.filter(r=>r.master_name==='Shift Master').map(r=>[String(r.id),r.record_data]));
  const by=text(actor),at=new Date().toISOString();
  return books.map(b=>({book:b,result:recomputePulseElb(b.data,{rows,asset:assets.get(text(b.data?.assetId)),shift:shifts.get(text(b.data?.shiftId)),now,at,by})}));
 }
 const line=({book,result})=>({id:String(book.id),bookNo:book.book_no,date:book.date,site:text(book.data?.location),shift:text(book.data?.shiftName||book.data?.bookShiftCode),door:text(book.data?.door),
  breakdownHours:result.change?.breakdownHours,shiftStatus:result.change?.shiftStatus,idleHours:result.change?.idleHours,references:result.change?.references,skip:result.skip||''});
 app.get('/api/admin/elb-pulse-repair',...protect,guard,async(req,res)=>{
  try{
   const input=params(req.query),actor=req.session.login||req.session.name;
   const planned=await plan(pool,input,actor);
   const changes=planned.filter(p=>p.result.data).map(line),skipped=planned.filter(p=>p.result.skip).map(line);
   const sum=(list,i)=>Math.round(list.reduce((s,l)=>s+(Number(l.breakdownHours?.[i])||0),0)*10)/10;
   res.set('Cache-Control','no-store').json({dryRun:true,...input,cards:planned.length,toChange:changes.length,unchanged:planned.filter(p=>p.result.unchanged).length,skipped:skipped.length,
    bdHoursBefore:sum(changes,0),bdHoursAfter:sum(changes,1),changes,skippedCards:skipped});
  }catch(error){res.status(error.status||500).json({error:error.message});}
 });
 app.post('/api/admin/elb-pulse-repair',...protect,guard,async(req,res)=>{
  try{
   const input=params(req.body||{}),actor=req.session.login||req.session.name;
   const ids=[...new Set((Array.isArray(req.body?.ids)?req.body.ids:[]).map(text).filter(id=>/^\d+$/.test(id)))];
   if(!ids.length)return res.status(400).json({error:'List the cards to repair (ids from the dry run).'});
   let applied=0;const done=[];
   for(let i=0;i<ids.length;i+=CHUNK){
    const client=await pool.connect();
    try{
     await client.query('BEGIN');
     const planned=await plan(client,input,actor,{lock:true,ids:ids.slice(i,i+CHUNK)});
     for(const p of planned){
      if(!p.result.data)continue;
      const {book,result}=p;
      await client.query('UPDATE mis_log_books SET data=$1::jsonb,updated_at=NOW(),revision=revision+1 WHERE id=$2 AND deleted_at IS NULL',[JSON.stringify(result.data),book.id]);
      await client.query('UPDATE mis_vlb_batch_fleet SET shift_status=$2 WHERE logbook_id=$1',[book.id,result.data.shiftStatus]);
      await client.query("UPDATE mis_elb_batch_entries SET snapshot=jsonb_set(snapshot,'{data}',$2::jsonb) WHERE logbook_id=$1",[book.id,JSON.stringify(result.data)]);
      if(result.data.batchId)await client.query('INSERT INTO mis_vlb_batch_audit(batch_id,actor,action,detail) VALUES($1,$2,$3,$4::jsonb)',[result.data.batchId,text(actor),'elb_pulse_bd_repaired',JSON.stringify({logbookId:String(book.id),bookNo:book.book_no,...result.change})]);
      applied++;done.push(line(p));
     }
     await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
   }
   res.json({applied,asked:ids.length,changes:done});
  }catch(error){res.status(error.status||500).json({error:error.message});}
 });
}
