// Owner, 17-18 Nov 2026: work the BD hours filled from Pulse out again after the machine match fix (PR 413), on every
// card a save filled from Pulse (ELB, VLB, LMV; machine entry, form and scanned cards), every site, every date.
//   GET  /api/admin/elb-pulse-repair?from=&to=&site=[&kind=]   dry run for one site: every card that would change, old
//        and new, and every card left alone with its reason. Writes nothing.
//   GET  /api/admin/elb-pulse-repair/sites?from=&to=           the sites that have such cards in the dates, with counts.
//   POST /api/admin/elb-pulse-repair {from,to,site,kind,ids}    applies it to the cards listed (by id) that still differ.
// MIS administrators only. Only the repaired fields are merged into a card (its trips, meters and the rest are not read
// or rewritten); each card keeps its old figures under data.pulseRepair.previous and gets a new revision; its batch
// line (machine status) and its two batch copies follow; the batch audit names who did it.
import {isMisAdministrator} from '../../shared/mis-admin-access.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {recomputePulseElb} from '../rules/elb-pulse-repair.mjs';
import {mirrorReadAt} from '../services/pulse-breakdown-mirror.mjs';

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const KINDS=['equipment','vehicle','lmv'];
const text=value=>String(value??'').trim();
const CHUNK=50,PAUSE_EVERY=10,MAX_DAYS=93;
// The card fields the repair reads: never the trips, attachments or scan text that make VLB cards large.
const FIELDS=['breakdownHours','breakdownHoursSource','elbEntryMode','hoursSource','pulseBreakdowns','shiftStatus','statusReason','idleHours','bookDate','location','assetId',
 'shiftId','shiftHours','scheduledHours','openingHmr','closingHmr','totalWorkingHmr','fleetTrips','door','shiftName','bookShiftCode','batchId'];
const SLIM=`jsonb_strip_nulls(jsonb_build_object(${FIELDS.map(f=>`'${f}',data->'${f}'`).join(',')}))`;

export function registerElbPulseRepair(app,{pool,protect,readBreakdownRows}){
 const guard=(req,res,next)=>isMisAdministrator(req.session)?next():res.status(403).json({error:'Only an MIS administrator can repair BD hours.'});
 const dates=source=>{
  const from=text(source.from),to=text(source.to);
  const days=(Date.parse(to)-Date.parse(from))/86400000;
  if(!DATE.test(from)||!DATE.test(to)||!(days>=0)||from<'2025-01-01')throw Object.assign(new Error('Choose real dates, From on or before To.'),{status:400});
  if(days>MAX_DAYS)throw Object.assign(new Error(`Choose at most ${MAX_DAYS} days at a time.`),{status:400});
  return {from,to};
 };
 const params=source=>{
  const site=text(source.site),kind=text(source.kind);
  if(!site)throw Object.assign(new Error('Choose one site.'),{status:400});
  if(kind&&!KINDS.includes(kind))throw Object.assign(new Error('Card type must be equipment, vehicle or lmv.'),{status:400});
  return {...dates(source),site,kind};
 };
 // The site names saved on cards in the dates that are this site (cards keep the name as typed: "Sasti" / "Sasti OC").
 const siteNames=async(db,{from,to,site})=>(await db.query('SELECT DISTINCT site FROM mis_log_books WHERE deleted_at IS NULL AND book_date BETWEEN $1 AND $2',[from,to])).rows
  .map(r=>r.site).filter(name=>canonicalSiteName(name)===canonicalSiteName(site));
 async function plan(db,input,actor,{lock=false,ids=null}={}){
  const rows=await readBreakdownRows(actor);
  if(!Array.isArray(rows))throw Object.assign(new Error('Pulse breakdown list could not be read.'),{status:503});
  const now=Math.min(mirrorReadAt(rows)??Date.now(),Date.now());
  const names=await siteNames(db,input);
  if(!names.length)return [];
  const args=[input.from,input.to,names,input.kind?[input.kind]:KINDS];
  if(ids)args.push(ids);
  const books=(await db.query(`SELECT id,book_no,book_type,book_date::text AS date,revision,${SLIM} AS data FROM mis_log_books
   WHERE deleted_at IS NULL AND book_date BETWEEN $1 AND $2 AND site=ANY($3::text[]) AND book_type=ANY($4::text[]) AND data->>'breakdownHoursSource'='pulse'${ids?' AND id=ANY($5::bigint[])':''}
   ORDER BY book_date,id${lock?' FOR UPDATE':''}`,args)).rows;
  const masters=(await db.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[])",[['Equipment master','Shift Master']])).rows;
  const assets=new Map(masters.filter(r=>r.master_name==='Equipment master').map(r=>[String(r.id),r.record_data]));
  const shifts=new Map(masters.filter(r=>r.master_name==='Shift Master').map(r=>[String(r.id),r.record_data]));
  const by=text(actor),at=new Date().toISOString();
  // 18 Nov 2026: the first live dry run checked every site's Pulse requests for every card (about 55 ms a card) and held
  // the whole server for minutes. Each card now sees only its own site's requests (the same ones the match keeps), and
  // the work pauses every few cards so other people's requests keep moving.
  const siteRows=rows.filter(r=>canonicalSiteName(r.site)===canonicalSiteName(input.site));
  const knownReferences=new Set(rows.map(r=>text(r.ref)).filter(Boolean));
  const planned=[];
  for(const [index,b] of books.entries()){
   if(index&&index%PAUSE_EVERY===0)await new Promise(resolve=>setImmediate(resolve));
   planned.push({book:b,result:recomputePulseElb(b.data,{rows:siteRows,asset:assets.get(text(b.data?.assetId)),shift:shifts.get(text(b.data?.shiftId)),knownReferences,now,at,by})});
  }
  return planned;
 }
 const line=({book,result})=>({id:String(book.id),bookNo:book.book_no,kind:book.book_type,date:book.date,site:text(book.data?.location),shift:text(book.data?.shiftName||book.data?.bookShiftCode),door:text(book.data?.door),
  mode:text(book.data?.elbEntryMode)||'card',breakdownHours:result.change?.breakdownHours,shiftStatus:result.change?.shiftStatus,idleHours:result.change?.idleHours,references:result.change?.references,skip:result.skip||''});
 app.get('/api/admin/elb-pulse-repair/sites',...protect,guard,async(req,res)=>{
  try{
   const input=dates(req.query);
   const {rows}=await pool.query(`SELECT site,book_type,COUNT(*)::int AS cards FROM mis_log_books WHERE deleted_at IS NULL AND book_date BETWEEN $1 AND $2 AND data->>'breakdownHoursSource'='pulse' GROUP BY site,book_type`,[input.from,input.to]);
   const sites={};
   for(const r of rows){const key=canonicalSiteName(r.site)||r.site;const s=sites[key]||={site:key,names:[],cards:0,byKind:{}};if(!s.names.includes(r.site))s.names.push(r.site);s.cards+=r.cards;s.byKind[r.book_type]=(s.byKind[r.book_type]||0)+r.cards;}
   res.set('Cache-Control','no-store').json({...input,sites:Object.values(sites).sort((a,b)=>b.cards-a.cards)});
  }catch(error){res.status(error.status||500).json({error:error.message});}
 });
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
      if(!p.result.patch)continue;
      const {book,result}=p,patch=JSON.stringify(result.patch);
      const revision=(await client.query('UPDATE mis_log_books SET data=data||$1::jsonb,updated_at=NOW(),revision=revision+1 WHERE id=$2 AND deleted_at IS NULL RETURNING revision',[patch,book.id])).rows[0]?.revision??null;
      if(book.book_type==='equipment'&&result.change.shiftStatus[0]!==result.change.shiftStatus[1])await client.query('UPDATE mis_vlb_batch_fleet SET shift_status=$2 WHERE logbook_id=$1',[book.id,result.patch.shiftStatus]);
      // The snapshot carries the card's new revision too, so it never trails the card it copies.
      for(const table of ['mis_elb_batch_entries','mis_vlb_batch_entries'])await client.query(`UPDATE ${table} SET snapshot=jsonb_set(snapshot,'{data}',COALESCE(snapshot->'data','{}'::jsonb)||$2::jsonb)||CASE WHEN $3::int IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('revision',$3::int) END WHERE logbook_id=$1 AND snapshot ? 'data'`,[book.id,patch,revision]);
      if(book.data?.batchId)await client.query('INSERT INTO mis_vlb_batch_audit(batch_id,actor,action,detail) VALUES($1,$2,$3,$4::jsonb)',[book.data.batchId,text(actor),'elb_pulse_bd_repaired',JSON.stringify({logbookId:String(book.id),bookNo:book.book_no,kind:book.book_type,...result.change})]);
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
