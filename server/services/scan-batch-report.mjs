import {decodeScanJson} from '../rules/scan-text-storage.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {operationalScanSql} from '../../shared/operational-start.mjs';
import {ownerTelegramLogins} from './release-otp-delivery.mjs';
import {displaySiteName} from '../../shared/region-scope.mjs';

// Site-wise batch completion report (owner's request, 14 Nov 2026), sent on the
// MIS Telegram bot to the owner's linked logins (the owner's registered mobile,
// the same rule as the urgent release OTP):
//  1. "read": a scan entry (about 40 cards) has no card left to read.
//     Time, queue wait, reading time per card, auto-check result, model, tokens.
//  2. "closed": a VLB batch (site, date, shift) is closed. All its scan entries
//     together, with accuracy = cards saved without any operator correction.
// Each report is sent once (mis_scan_batch_reports); only entries and batches
// after the first start of this feature are reported, so a deploy does not send
// a report for every old batch. MIS_SCAN_BATCH_REPORT=off switches it off.

export const SCAN_BATCH_REPORT_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_scan_batch_reports(subject TEXT NOT NULL,stage TEXT NOT NULL CHECK(stage IN('read','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(subject,stage));
 CREATE TABLE IF NOT EXISTS mis_scan_batch_report_start(id INTEGER PRIMARY KEY CHECK(id=1),started_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 INSERT INTO mis_scan_batch_report_start(id) VALUES(1) ON CONFLICT DO NOTHING;`;

export const REPORT_HEADER='📋 Site-wise batch completion report';
// Template (owner, 15 Nov 2026): the site name is the header of every message,
// so a chat full of reports reads site by site.
export const siteHeader=site=>`📍 ${(displaySiteName(site)||'Site not set').toUpperCase()}`;
const RULE='━━━━━━━━━━━━━━━━';
// An entry still being uploaded is not "done": wait this long after its last card arrived.
export const SETTLE_MS=2*60000;
const LOOKBACK_DAYS=3;

const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const median=list=>{const v=list.filter(finite).sort((a,b)=>a-b);if(!v.length)return null;const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;};
const average=list=>{const v=list.filter(finite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;};
const pct=(n,d)=>d?Math.round(1000*n/d)/10:null;

export function duration(ms){
 if(!finite(ms))return '-';
 if(ms<60000)return (Math.round(ms/100)/10)+' s';
 const total=Math.round(ms/1000),h=Math.floor(total/3600),m=Math.floor(total%3600/60),s=total%60;
 return h?`${h} h ${m} min`:`${m} min ${s} s`;
}
const clock=ms=>finite(ms)?new Date(ms).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}):'-';
const tokens=n=>!finite(n)?'-':n>=1e6?(Math.round(n/1e5)/10)+'M':n>=1e3?Math.round(n/1e3)+'k':String(n);

// Fields an operator checks against the card. Context fields (site, date) and
// the opening meters (carried over from the previous card) are filled by the
// system, so a change there is not a reading correction.
const FIELD_GROUPS=[
 ['door/machine',d=>d.assetId||d.doorText],
 ['employee',d=>d.employeeId],
 ['card no',d=>d.aFormNo||d.jobCardNo],
 ['shift',d=>d.cardShift],
 ['KMR',d=>d.closingKmr],
 ['HMR',d=>d.closingHmr],
];
const norm=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^0+(?=\d)/,'');
const timeNorm=v=>{const m=String(v??'').match(/(\d{1,2})\D*(\d{2})/);return m?Number(m[1])+':'+m[2]:norm(v);};

export function correctedFields(extraction,draft){
 if(!extraction||typeof extraction!=='object'||!draft||typeof draft!=='object')return null;
 const changed=FIELD_GROUPS.filter(([,pick])=>norm(pick(extraction))!==norm(pick(draft))).map(([name])=>name);
 const read=Array.isArray(extraction.trips)?extraction.trips:[],saved=Array.isArray(draft.trips)?draft.trips:[];
 const tripsChanged=read.length!==saved.length||read.some((row,i)=>{const s=saved[i]||{};
  return norm(row.equipmentName)!==norm(s.equipmentName)||['loadingTime','unloadingTime'].some(k=>row[k]&&timeNorm(row[k])!==timeNorm(s[k]));});
 if(tripsChanged)changed.push('trips');
 return changed;
}

export function cardFacts(row){
 const raw=decodeScanJson(row.raw_fields)||{},draft=decodeScanJson(row.draft)||{};
 const timing=raw.scanTiming||{},gemini=raw.gemini||raw.hybrid||{};
 const recovery=raw.firstScanFieldRecovery;
 const flagged=row.status==='error'||Boolean(recovery?.remaining?.length)||Boolean(draft.extractionReviewFields?.length)||Boolean(draft.meterReviewFields?.length);
 const saved=row.status==='posted'||row.status==='approved';
 return {
  status:row.status,uploadedAt:Date.parse(row.created_at),
  finishedAt:Date.parse(timing.finishedAt)||null,
  queuedMs:timing.queuedMs,totalMs:timing.totalMs,geminiMs:gemini.totalElapsedMs??gemini.elapsedMs,
  model:gemini.model||raw.model||'',tokens:gemini.usage?.totalTokenCount,
  flagged,error:row.status==='error',rechecked:Boolean(recovery?.attempted),
  corrected:saved?correctedFields(raw.extractionDraft,draft):null,
 };
}

export function summarize(cards){
 const read=cards.filter(c=>!['queued','reading'].includes(c.status));
 const uploads=cards.map(c=>c.uploadedAt).filter(finite),finishes=read.map(c=>c.finishedAt).filter(finite);
 const first=uploads.length?Math.min(...uploads):null,last=finishes.length?Math.max(...finishes):null;
 const saved=cards.filter(c=>c.corrected);
 const fieldCounts={};for(const c of saved)for(const f of c.corrected)fieldCounts[f]=(fieldCounts[f]||0)+1;
 const clean=saved.filter(c=>!c.corrected.length).length;
 const models=[...new Set(read.map(c=>c.model).filter(Boolean))];
 const tokenList=read.map(c=>c.tokens).filter(finite);
 return {
  cards:cards.length,read:read.length,errors:read.filter(c=>c.error).length,
  flagged:read.filter(c=>c.flagged).length,rechecked:read.filter(c=>c.rechecked).length,
  rejected:cards.filter(c=>c.status==='rejected').length,
  firstUpload:first,lastRead:last,wallMs:first!==null&&last!==null&&last>=first?last-first:null,
  queueMedianMs:median(read.map(c=>c.queuedMs)),queueMaxMs:read.map(c=>c.queuedMs).filter(finite).reduce((a,b)=>Math.max(a,b),-1),
  readMedianMs:median(read.map(c=>c.totalMs)),readAverageMs:average(read.map(c=>c.totalMs)),geminiMedianMs:median(read.map(c=>c.geminiMs)),
  models,tokens:tokenList.length?tokenList.reduce((s,n)=>s+n,0):null,
  saved:saved.length,clean,accuracy:pct(clean,saved.length),fieldCounts,
 };
}

const kindLabel=entry=>entry.kind==='equipment'?'ELB':entry.context?.logBookKind==='lmv'?'LMV':'VLB';
const line=(label,value)=>`${label}: ${value}`;

export function entryReadMessage(entry,s){
 const ctx=entry.context||{};
 const autoClean=s.read-s.flagged;
 return [
  siteHeader(ctx.location),
  `${REPORT_HEADER} | Scan entry read`,
  [kindLabel(entry),ctx.bookDate,vlbRecordShift(ctx)&&'Shift '+vlbRecordShift(ctx)].filter(Boolean).join(' | '),
  line('Entry',entry.name||'-'),
  RULE,
  line('🗂 Cards',`${s.read} read`+(s.errors?`, ${s.errors} failed`:'')),
  line('⏱ Total time',`${duration(s.wallMs)} (upload ${clock(s.firstUpload)} to last read ${clock(s.lastRead)})`),
  line('⏳ Queue wait',`median ${duration(s.queueMedianMs)}, max ${duration(s.queueMaxMs)}`),
  line('⚡ Time per card',`median ${duration(s.readMedianMs)}, average ${duration(s.readAverageMs)} (Gemini ${duration(s.geminiMedianMs)})`),
  line('✅ Auto-check',`${autoClean} clean (${pct(autoClean,s.read)??'-'}%), ${s.flagged} flagged for review, ${s.rechecked} re-read`),
  line('🤖 Model',`${s.models.join(', ')||'-'} | tokens ${tokens(s.tokens)}`),
  line('🎯 Accuracy','comes in the batch report when the batch is closed (after operator checking)'),
 ].join('\n');
}

export function batchClosedMessage(batch,entries){
 const all=summarize(entries.flatMap(e=>e.facts));
 const fields=Object.entries(all.fieldCounts).sort((a,b)=>b[1]-a[1]).map(([f,n])=>`${f} ${n}`).join(', ');
 const kinds={};for(const e of entries)kinds[kindLabel(e)]=(kinds[kindLabel(e)]||0)+1;
 const closedAt=Date.parse(batch.closed_at);
 return [
  siteHeader(batch.site),
  `${REPORT_HEADER} | Batch complete`,
  [batch.book_date,'Shift '+batch.shift].join(' | '),
  line('Batch',batch.name),
  RULE,
  line('📦 Scan entries',`${entries.length} (${Object.entries(kinds).map(([k,n])=>k+' '+n).join(', ')})`),
  line('🗂 Cards',`${all.cards} scanned, ${all.saved} saved, ${all.rejected} rejected`+(all.errors?`, ${all.errors} failed to read`:'')),
  line('⏱ Scanning time',`${duration(all.wallMs)} (first upload ${clock(all.firstUpload)} to last read ${clock(all.lastRead)}), closed ${clock(closedAt)}`),
  line('⚡ Time per card',`median ${duration(all.readMedianMs)}, queue wait median ${duration(all.queueMedianMs)}`),
  line('🎯 Accuracy',all.saved?`${all.accuracy}% (${all.clean} of ${all.saved} saved cards needed no correction)`:'no saved scan cards'),
  ...(fields?[line('✏️ Corrected',fields)]:[]),
  line('🤖 Model',`${all.models.join(', ')||'-'} | tokens ${tokens(all.tokens)}`),
  ...(entries.length>1?[RULE,'Per scan entry:',...entries.map(e=>{const s=summarize(e.facts);return `- ${e.name}: ${s.cards} cards, ${duration(s.wallMs)}, accuracy ${s.accuracy??'-'}%`;})]:[]),
 ].join('\n');
}

// Cards that count: the same filter as the scan history export (no duplicates,
// no cards removed or deleted by hand).
const CARD_FILTER=alias=>`${operationalScanSql(alias)} AND ${alias}.duplicate_of IS NULL
 AND ${alias}.review_note NOT IN ('Removed from batch: wrong date, site or shift','Exact duplicate upload skipped automatically')
 AND ${alias}.review_note NOT LIKE 'Card deleted manually by user%'`;
const LIVE_ENTRY=`NOT(COALESCE(b.expected_context,'{}'::jsonb) ?| ARRAY['deletedVlbBatch','deletedScanEntry'])`;

export function createScanBatchReporter({pool,telegram,recipients=()=>ownerTelegramLogins(pool),now=()=>Date.now(),log=console}){
 let ready=null,running=false;
 const ensure=()=>ready||=pool.query(SCAN_BATCH_REPORT_SCHEMA).catch(error=>{ready=null;throw error;});
 const cardsOf=async ids=>(await pool.query(`SELECT c.batch_id,c.status,c.created_at,c.raw_fields,c.draft FROM mis_scan_cards c
  WHERE c.batch_id=ANY($1::uuid[]) AND ${CARD_FILTER('c')} ORDER BY c.ordinal`,[ids])).rows;
 const claim=async(subject,stage)=>(await pool.query('INSERT INTO mis_scan_batch_reports(subject,stage) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING subject',[subject,stage])).rows.length>0;
 const deliver=async(key,message)=>{let sent=0;for(const login of await recipients()){try{if(await telegram.send(login,message,`scan-batch-report:${key}:${login}`))sent++;}catch(error){log.error?.('Scan batch report not sent:',error?.message||error);}}return sent;};

 async function reportReadEntries(){
  const cutoff=new Date(now()-SETTLE_MS);
  const {rows}=await pool.query(`SELECT b.id,b.name,b.kind,b.expected_context FROM mis_scan_batches b,mis_scan_batch_report_start s
   WHERE b.created_at>=s.started_at AND b.created_at>NOW()-make_interval(days=>${LOOKBACK_DAYS}) AND ${LIVE_ENTRY}
   AND NOT EXISTS(SELECT 1 FROM mis_scan_batch_reports r WHERE r.subject=b.id::text AND r.stage='read')
   AND EXISTS(SELECT 1 FROM mis_scan_cards c WHERE c.batch_id=b.id AND ${CARD_FILTER('c')})
   AND NOT EXISTS(SELECT 1 FROM mis_scan_cards c WHERE c.batch_id=b.id AND c.status IN('queued','reading') AND ${CARD_FILTER('c')})
   AND NOT EXISTS(SELECT 1 FROM mis_scan_cards c WHERE c.batch_id=b.id AND c.created_at>$1)
   ORDER BY b.created_at LIMIT 20`,[cutoff]);
  let sent=0;
  for(const entry of rows){
   if(!await claim(entry.id,'read'))continue;
   const facts=(await cardsOf([entry.id])).map(cardFacts);
   sent+=await deliver(`read:${entry.id}`,entryReadMessage({name:entry.name,kind:entry.kind,context:entry.expected_context||{}},summarize(facts)));
  }
  return sent;
 }

 async function reportClosedBatches(){
  const {rows}=await pool.query(`SELECT v.id,v.name,v.site,v.book_date::text AS book_date,v.shift,v.closed_at FROM mis_vlb_batches v,mis_scan_batch_report_start s
   WHERE v.closed_at IS NOT NULL AND v.closed_at>=s.started_at AND v.closed_at>NOW()-make_interval(days=>${LOOKBACK_DAYS})
   AND v.deleted_at IS NULL AND v.archived_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM mis_scan_batch_reports r WHERE r.subject=v.id::text AND r.stage='closed')
   ORDER BY v.closed_at LIMIT 20`);
  let sent=0;
  for(const batch of rows){
   const candidates=(await pool.query(`SELECT b.id,b.name,b.kind,b.expected_context,b.created_at FROM mis_scan_batches b
    WHERE b.expected_context->>'bookDate'=$1 AND ${LIVE_ENTRY} ORDER BY b.created_at`,[batch.book_date])).rows;
   const site=canonicalSiteName(batch.site);
   const entries=candidates.filter(b=>canonicalSiteName(b.expected_context?.location)===site&&vlbRecordShift(b.expected_context||{})===batch.shift);
   if(!await claim(batch.id,'closed'))continue;
   if(!entries.length)continue;
   const cards=await cardsOf(entries.map(e=>e.id));
   const withFacts=entries.map(e=>({name:e.name,kind:e.kind,context:e.expected_context||{},facts:cards.filter(c=>c.batch_id===e.id).map(cardFacts)})).filter(e=>e.facts.length);
   if(withFacts.length)sent+=await deliver(`closed:${batch.id}`,batchClosedMessage(batch,withFacts));
  }
  return sent;
 }

 return {
  async tick(){
   if(running)return {skipped:true};running=true;
   try{await ensure();return {read:await reportReadEntries(),closed:await reportClosedBatches()};}
   finally{running=false;}
  },
  start({intervalMs=60000}={}){
   const run=()=>this.tick().catch(error=>log.error?.('Scan batch report failed:',error?.message||error));
   void run();const timer=setInterval(run,intervalMs);timer.unref?.();return ()=>clearInterval(timer);
  },
 };
}

export const scanBatchReportEnabled=(env=process.env)=>!['off','0','false','no'].includes(String(env.MIS_SCAN_BATCH_REPORT??'').trim().toLowerCase());
