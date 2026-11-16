import {decodeScanJson} from '../rules/scan-text-storage.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {operationalScanSql} from '../../shared/operational-start.mjs';
import {ownerTelegramLogins} from './release-otp-delivery.mjs';
import {displaySiteName} from '../../shared/region-scope.mjs';

// Site-wise batch completion report (owner's request, 14 Nov 2026), sent on the
// MIS Telegram bot to the owner's linked logins (the owner's registered mobile,
// the same rule as the urgent release OTP). One message per site batch, when the
// VLB batch (site, date, shift) is closed: all its scan entries together, with
// accuracy = cards saved without any operator correction. Since 16 Nov 2026
// (owner) there is no separate message when a scan entry has been read.
// Each report is sent once (mis_scan_batch_reports); only batches
// after the first start of this feature are reported, so a deploy does not send
// a report for every old batch. MIS_SCAN_BATCH_REPORT=off switches it off.

export const SCAN_BATCH_REPORT_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_scan_batch_reports(subject TEXT NOT NULL,stage TEXT NOT NULL CHECK(stage IN('read','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(subject,stage));
 CREATE TABLE IF NOT EXISTS mis_scan_batch_report_start(id INTEGER PRIMARY KEY CHECK(id=1),started_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 INSERT INTO mis_scan_batch_report_start(id) VALUES(1) ON CONFLICT DO NOTHING;`;

export const REPORT_TITLE='SITE-WISE BATCH COMPLETION REPORT';
// Template (owner, 15 Nov 2026): the site picture first, then the site name,
// the bold title, the batch and four figure lines (reportLines below).
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
  // Trip rows on the card: as saved by the operator, else as read.
  trips:Array.isArray(draft.trips)&&(saved||draft.trips.length)?draft.trips.length:Array.isArray(raw.extractionDraft?.trips)?raw.extractionDraft.trips.length:0,
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
  flagged:read.filter(c=>c.flagged).length,autoCleared:read.filter(c=>!c.flagged).length,
  trips:cards.reduce((sum,c)=>sum+(c.trips||0),0),rechecked:read.filter(c=>c.rechecked).length,
  rejected:cards.filter(c=>c.status==='rejected').length,
  firstUpload:first,lastRead:last,wallMs:first!==null&&last!==null&&last>=first?last-first:null,
  queueMedianMs:median(read.map(c=>c.queuedMs)),queueMaxMs:read.map(c=>c.queuedMs).filter(finite).reduce((a,b)=>Math.max(a,b),-1),
  readMedianMs:median(read.map(c=>c.totalMs)),readAverageMs:average(read.map(c=>c.totalMs)),geminiMedianMs:median(read.map(c=>c.geminiMs)),
  models,tokens:tokenList.length?tokenList.reduce((s,n)=>s+n,0):null,
  saved:saved.length,clean,accuracy:pct(clean,saved.length),fieldCounts,
 };
}

const kindLabel=entry=>entry.kind==='equipment'?'ELB':entry.context?.logBookKind==='lmv'?'LMV':'VLB';
// Telegram HTML: only the heading is bold, everything else is plain text.
export const escapeHtml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// "CMLL/2026-11-09/GAURI PAUNI OB 2ND/S1/TEKLALMAHTO/B02" -> "B02 TEKLALMAHTO": site, date and shift are already in the batch name.
export const subBatchLabel=name=>{const parts=String(name||'').split('/').map(p=>p.trim()).filter(Boolean);
 return parts.length>=5?`${parts.at(-1)} ${parts.at(-2)}`:parts.join('/')||'-';};
// Total · ✅ auto-cleared · ❌ error. Error = not auto-cleared (failed to read or
// flagged for a person to check), so the two add up to the total.
const clearedLine=s=>`${s.cards} · ✅${s.autoCleared} · ❌${s.cards-s.autoCleared}`;
// The full batch name "CMLL/GAURI PAUNI OC (2ND)/9TH -NOV-26/S1/B01" is too wide for one phone line,
// so the picture shows it in full and the text line leaves out "CMLL" (the same on every batch)
// and the site (printed on the picture just above it), then adds the user who made the batch
// (owner, 16 Nov 2026): "9TH -NOV-26/S1/B01 · teklalmahto".
export const batchLineName=(name,user='')=>{const parts=String(name||'').split('/');
 const short=parts.length>=4&&parts[0]==='CMLL'?parts.slice(2).join('/'):String(name||'-');
 const login=String(user||'').trim().toLowerCase();
 return login?`${short} · ${login}`:short;};
// A Telegram photo caption holds 1024 characters; a batch with very many sub batches lists the first ones.
const MAX_SUB_BATCH_LINES=12;

// One message per closed batch (owner, 15-16 Nov 2026), sent as the caption of the
// site picture (site-report-banner.mjs), which carries the site name (not repeated
// here). Every line is short enough to stay on one line of a phone screen (owner,
// 16 Nov 2026): bold title, full batch name, cards and trips, extracted and
// processed, every sub batch with total, auto-cleared and error, time, average per
// card with accuracy (after operator check), model.
export function batchClosedMessage(batch,entries){
 const all=summarize(entries.flatMap(e=>e.facts));
 const kinds=[...new Set(entries.map(kindLabel))].join('+')||'VLB';
 const subs=entries.map(e=>({name:subBatchLabel(e.name),s:summarize(e.facts)}));
 const shown=subs.slice(0,MAX_SUB_BATCH_LINES);
 return [
  `<b>${REPORT_TITLE}</b>`,
  `📋 ${escapeHtml(`${kinds} · ${batchLineName(batch.name,batch.creator)}`)}`,
  `🗂 Scanned ${all.cards} · Trips ${all.trips}`,
  `🔍 Extracted ${all.read-all.errors} · Processed ${all.saved}`,
  `📦 ${subs.length} sub ${subs.length===1?'batch':'batches'} · ✅ auto · ❌ error`,
  ...shown.map(({name,s})=>`• ${escapeHtml(name)} · ${clearedLine(s)}`),
  ...(subs.length>shown.length?[`• +${subs.length-shown.length} more`]:[]),
  `▸ All · ${clearedLine(all)}`,
  `⏱ ${clock(all.firstUpload)} → ${clock(all.lastRead)} · ${duration(all.wallMs)}`,
  `⚡ ${duration(all.readAverageMs)}/card · Accuracy ${all.saved?`${all.accuracy}%`:'-'}`,
  `🤖 ${escapeHtml(all.models.join(', ')||'-')}`,
 ].join('\n');
}

// The report as one picture (batch-report-card.mjs; owner, 16 Nov 2026): the same
// figures as the text above, with the sub batches in a table. The text above stays
// as the fallback when the picture cannot be sent.
const subBatchParts=name=>{const parts=String(name||'').split('/').map(p=>p.trim()).filter(Boolean);
 return parts.length>=5?{code:parts.at(-1),operator:parts.at(-2)}:{code:parts.join('/')||'-',operator:''};};
export function batchReportCardData(batch,entries){
 const all=summarize(entries.flatMap(e=>e.facts));
 const kinds=[...new Set(entries.map(kindLabel))].join('+')||'VLB';
 const subs=entries.map(e=>{const s=summarize(e.facts);return {...subBatchParts(e.name),total:s.cards,auto:s.autoCleared,error:s.cards-s.autoCleared};});
 return {site:displaySiteName(batch.site)||'',kind:kinds,batchName:batch.name||'',
  batchLine:`${kinds} · ${batchLineName(batch.name,batch.creator)}`,
  scanned:all.cards,trips:all.trips,extracted:all.read-all.errors,processed:all.saved,
  subs:subs.slice(0,MAX_SUB_BATCH_LINES),more:Math.max(0,subs.length-MAX_SUB_BATCH_LINES),
  all:{total:all.cards,auto:all.autoCleared,error:all.cards-all.autoCleared},
  time:`${clock(all.firstUpload)} → ${clock(all.lastRead)} · ${duration(all.wallMs)}`,
  perCard:duration(all.readAverageMs),accuracy:all.saved?`${all.accuracy}%`:'-',model:all.models.join(', ')||'-'};
}
// The short text under the picture, so the chat list and notifications name the batch.
export const batchReportCaption=card=>`<b>${REPORT_TITLE}</b>\n📋 ${escapeHtml(card.batchLine)}`;

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
 const deliver=async(key,message,photo)=>{let sent=0;for(const login of await recipients()){try{if(await telegram.send(login,message,`scan-batch-report:${key}:${login}`,{html:true,photo}))sent++;}catch(error){log.error?.('Scan batch report not sent:',error?.message||error);}}return sent;};

 const BATCH_COLUMNS='v.id,v.name,v.site,v.book_date::text AS book_date,v.shift,v.closed_at,COALESCE(v.creator_login,v.created_by) AS creator';
 // The scan entries (sub batches) of a VLB batch's site, date and shift, with their cards.
 async function subBatches(batch){
  const candidates=(await pool.query(`SELECT b.id,b.name,b.kind,b.expected_context,b.created_at FROM mis_scan_batches b
   WHERE b.expected_context->>'bookDate'=$1 AND ${LIVE_ENTRY} ORDER BY b.created_at`,[batch.book_date])).rows;
  const site=canonicalSiteName(batch.site);
  const entries=candidates.filter(b=>canonicalSiteName(b.expected_context?.location)===site&&vlbRecordShift(b.expected_context||{})===batch.shift);
  if(!entries.length)return [];
  const cards=await cardsOf(entries.map(e=>e.id));
  return entries.map(e=>({name:e.name,kind:e.kind,context:e.expected_context||{},facts:cards.filter(c=>c.batch_id===e.id).map(cardFacts)})).filter(e=>e.facts.length);
 }
 // The report picture with a short caption; the full text goes only if the picture cannot be sent.
 const deliverBatch=(key,batch,withFacts)=>{const card=batchReportCardData(batch,withFacts);
  return deliver(key,batchClosedMessage(batch,withFacts),{card,caption:batchReportCaption(card)});};

 async function reportClosedBatches(){
  const {rows}=await pool.query(`SELECT ${BATCH_COLUMNS} FROM mis_vlb_batches v,mis_scan_batch_report_start s
   WHERE v.closed_at IS NOT NULL AND v.closed_at>=s.started_at AND v.closed_at>NOW()-make_interval(days=>${LOOKBACK_DAYS})
   AND v.deleted_at IS NULL AND v.archived_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM mis_scan_batch_reports r WHERE r.subject=v.id::text AND r.stage='closed')
   ORDER BY v.closed_at LIMIT 20`);
  let sent=0;
  for(const batch of rows){
   const withFacts=await subBatches(batch);
   if(!await claim(batch.id,'closed'))continue;
   if(withFacts.length)sent+=await deliverBatch(`closed:${batch.id}`,batch,withFacts);
  }
  return sent;
 }

 // "Send sample to Telegram" on the Automation Centre (owner, 16 Nov 2026): the report of the most
 // recently closed batch that has scanned cards, to the same people as the real report. It is not
 // recorded as reported, so it never stops or repeats the real message of a batch.
 async function sendSample(){
  await ensure();
  const {rows}=await pool.query(`SELECT ${BATCH_COLUMNS} FROM mis_vlb_batches v
   WHERE v.closed_at IS NOT NULL AND v.deleted_at IS NULL AND v.archived_at IS NULL ORDER BY v.closed_at DESC LIMIT 15`);
  for(const batch of rows){
   const withFacts=await subBatches(batch);
   if(!withFacts.length)continue;
   const people=(await recipients()).length;
   const sent=await deliverBatch(`sample:${batch.id}:${now()}`,batch,withFacts);
   return {batch:batch.name,people,sent};
  }
  return {batch:null,people:0,sent:0};
 }

 return {
  sendSample,
  async tick(){
   if(running)return {skipped:true};running=true;
   try{await ensure();return {closed:await reportClosedBatches()};}
   finally{running=false;}
  },
  start({intervalMs=60000}={}){
   const run=()=>this.tick().catch(error=>log.error?.('Scan batch report failed:',error?.message||error));
   void run();const timer=setInterval(run,intervalMs);timer.unref?.();return ()=>clearInterval(timer);
  },
 };
}

export const scanBatchReportEnabled=(env=process.env)=>!['off','0','false','no'].includes(String(env.MIS_SCAN_BATCH_REPORT??'').trim().toLowerCase());
