import {canonicalSiteName} from './site-location.mjs';
import {displaySiteName} from './region-scope.mjs';
import {vlbRecordShift} from './vlb-batch-format.mjs';
import {fleetDoorKey} from './scan-fleet-door.mjs';
import {matchCardMachine} from './scan-machine-rules.mjs';
import {withEquipmentAliases} from './equipment-aliases.mjs';
import {requireLogBookSite} from './log-book-access.mjs';
import {OPERATIONAL_START} from './operational-start.mjs';

// Meter continuity: a silent cross-check, in reporting only, of each tipper card's opening
// KMR and HMR against the closing readings of the same tipper's previous card. Nothing here
// touches entry or scanning. The previous card is found by date and shift order, never by
// save time, because scans arrive late and corrections are made days later.

export const SHIFT_ORDER={S1:1,S2:2,S3:3,D:4,N:5};
export const DEFAULT_TOLERANCE=Object.freeze({kmTolerance:2,hourTolerance:0.5});
export const CLASS_LABELS={match:'Match',tolerance:'Within tolerance',negative:'Below previous closing',jump:'Jump above tolerance','no-previous':'No previous card','no-reading':'Reading missing'};
const RANK={negative:4,jump:3,tolerance:2,match:1,'no-reading':0,'no-previous':0};

const text=value=>String(value??'').trim();
const num=value=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;};
const round=value=>value===null?null:Math.round(value*1000)/1000;
const shiftRank=code=>SHIFT_ORDER[code]||9;
const classify=(gap,tolerance)=>gap===null?'no-reading':gap<0?'negative':gap===0?'match':gap<=tolerance?'tolerance':'jump';
// The result is the worst of the meters that could be compared. A blank reading on one meter leaves the result
// to the other; when neither meter could be compared the result is "Reading missing", never "Match".
const worst=(...classes)=>classes.reduce((a,b)=>RANK[b]>RANK[a]?b:a,'no-reading');

export function normalizeTolerance(input={}){
 const pick=(value,fallback,max)=>{const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=max?n:fallback;};
 return {kmTolerance:pick(input.kmTolerance,DEFAULT_TOLERANCE.kmTolerance,500),hourTolerance:pick(input.hourTolerance,DEFAULT_TOLERANCE.hourTolerance,24)};
}

export function meterCards(records){
 return (records||[]).filter(r=>r?.data?.bookDate).map(r=>{const d=r.data;return {
  id:String(r.id),bookNo:r.book_no,date:d.bookDate,shift:vlbRecordShift(d),site:displaySiteName(d.location),canonicalSite:canonicalSiteName(d.location),
  door:text(d.door),assetId:text(r.asset_id??d.assetId),driver:text(d.employeeName),driverId:text(d.caliberId||d.employeeId),
  openingKmr:num(d.openingKmr),closingKmr:num(d.closingKmr),openingHmr:num(d.openingHmr),closingHmr:num(d.closingHmr),source:d.scanCardId?'Scan':'Manual'};});
}

export function buildMeterContinuityReport({records=[],from='',to='',kmTolerance=DEFAULT_TOLERANCE.kmTolerance,hourTolerance=DEFAULT_TOLERANCE.hourTolerance,assets=[]}={}){
 // Group by Equipment master id. Text-only cards resolve through the matcher and saved aliases at read time; stored rows are not changed.
 const resolveAsset=card=>card.assetId||(assets.length?String(matchCardMachine(assets,card.door,card.site,'vehicle').match?.id||''):'');
 const groups=new Map();
 for(const card of meterCards(records)){
  const key=card.canonicalSite+'|'+(resolveAsset(card)||fleetDoorKey(card.door));
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(card);
 }
 const rows=[];
 for(const cards of groups.values()){
  cards.sort((a,b)=>a.date.localeCompare(b.date)||shiftRank(a.shift)-shiftRank(b.shift)||a.id.localeCompare(b.id,undefined,{numeric:true}));
  cards.forEach((card,i)=>{
   if(from&&card.date<from||to&&card.date>to)return;
   const prev=i>0?cards[i-1]:null;
   const kmGap=prev&&card.openingKmr!==null&&prev.closingKmr!==null?round(card.openingKmr-prev.closingKmr):null;
   const hourGap=prev&&card.openingHmr!==null&&prev.closingHmr!==null?round(card.openingHmr-prev.closingHmr):null;
   const kmClass=prev?classify(kmGap,kmTolerance):'no-previous',hourClass=prev?classify(hourGap,hourTolerance):'no-previous';
   const status=prev?worst(kmClass,hourClass):'no-previous';
   rows.push({id:card.id,date:card.date,shift:card.shift,site:card.site,door:card.door,driver:card.driver,driverId:card.driverId,source:card.source,bookNo:card.bookNo,
    previousBookNo:prev?.bookNo||'',previousDate:prev?.date||'',previousShift:prev?.shift||'',previousClosingKmr:prev?.closingKmr??null,openingKmr:card.openingKmr,kmGap,kmClass,
    previousClosingHmr:prev?.closingHmr??null,openingHmr:card.openingHmr,hourGap,hourClass,status,statusLabel:CLASS_LABELS[status]});
  });
 }
 rows.sort((a,b)=>a.date.localeCompare(b.date)||shiftRank(a.shift)-shiftRank(b.shift)||a.door.localeCompare(b.door,undefined,{numeric:true}));
 const summarise=(keyOf,labelOf)=>{
  const map=new Map();
  for(const row of rows){
   const key=keyOf(row);if(!key)continue;
   if(!map.has(key))map.set(key,{key,label:labelOf(row),cards:0,compared:0,matches:0,tolerance:0,negatives:0,jumps:0,noReading:0,absKm:0,absHours:0,kmCount:0,hourCount:0});
   const s=map.get(key);s.cards++;
   if(row.status==='no-previous')continue;
   // A card with no reading to compare on either meter was not compared: it is counted on its own.
   if(row.status==='no-reading'){s.noReading++;continue;}
   s.compared++;if(row.status==='match')s.matches++;if(row.status==='tolerance')s.tolerance++;if(row.status==='negative')s.negatives++;if(row.status==='jump')s.jumps++;
   if(row.kmGap!==null){s.absKm+=Math.abs(row.kmGap);s.kmCount++;}if(row.hourGap!==null){s.absHours+=Math.abs(row.hourGap);s.hourCount++;}
  }
  return [...map.values()].map(s=>({key:s.key,label:s.label,cards:s.cards,compared:s.compared,matches:s.matches,tolerance:s.tolerance,negatives:s.negatives,jumps:s.jumps,noReading:s.noReading,
   averageAbsKmGap:s.kmCount?round(s.absKm/s.kmCount):null,averageAbsHourGap:s.hourCount?round(s.absHours/s.hourCount):null,issueRate:s.compared?round((s.negatives+s.jumps)/s.compared*100):null}))
   .sort((a,b)=>(b.negatives+b.jumps)-(a.negatives+a.jumps)||b.compared-a.compared||a.label.localeCompare(b.label,undefined,{numeric:true}));
 };
 const drivers=summarise(row=>row.driverId||row.driver,row=>row.driver?`${row.driver}${row.driverId?' ('+row.driverId+')':''}`:'Unknown driver');
 const tippers=summarise(row=>row.door,row=>row.door||'Unknown tipper');
 const totals={cards:rows.length,compared:0,matches:0,tolerance:0,negatives:0,jumps:0,noReading:0};
 for(const row of rows){if(row.status==='no-previous')continue;if(row.status==='no-reading'){totals.noReading++;continue;}totals.compared++;totals[row.status==='match'?'matches':row.status==='tolerance'?'tolerance':row.status==='negative'?'negatives':'jumps']++;}
 return {rows,drivers,tippers,totals,kmTolerance,hourTolerance};
}

const invalid=(message,status=400)=>Object.assign(new Error(message),{status});
const isoDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&!Number.isNaN(Date.parse(value+'T00:00:00Z'));
const shiftDate=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);

export function registerMeterContinuityReport(app,{pool,protect,ensureBooks}){
 app.get('/api/reports/meter-continuity',...protect,async(req,res,next)=>{
  try{
   const site=text(req.query.site),from=text(req.query.from),to=text(req.query.to);
   if(!site)throw invalid('Select a site.');if(!isoDate(from)||!isoDate(to))throw invalid('Select a valid date range.');if(from>to)throw invalid('The start date must not be after the end date.');
   if(from<OPERATIONAL_START)throw invalid('Reports start from '+OPERATIONAL_START+'.');
   if((Date.parse(to)-Date.parse(from))/86400000>92)throw invalid('Choose a range of at most 92 days.');
   requireLogBookSite(req.logBookScope,site);await ensureBooks();
   const tolerance=normalizeTolerance(req.query);
   const sites=(await pool.query("SELECT DISTINCT site FROM mis_log_books WHERE book_type='vehicle' AND deleted_at IS NULL AND book_date>=$1",[OPERATIONAL_START])).rows.map(r=>r.site).filter(s=>canonicalSiteName(s)===canonicalSiteName(site));
   // Reach back a week so the first cards in the range still find their previous card.
   const records=sites.length?(await pool.query(`SELECT id,book_no,asset_id,data-'manualAttachments' AS data FROM mis_log_books WHERE book_type='vehicle' AND deleted_at IS NULL AND site=ANY($1::text[]) AND book_date BETWEEN $2 AND $3 ORDER BY book_date,id LIMIT 60001`,[sites,shiftDate(from,-7)<OPERATIONAL_START?OPERATIONAL_START:shiftDate(from,-7),to])).rows:[];
   if(records.length>60000)throw invalid('Too many cards for one report. Choose a shorter range.');
   const assets=await withEquipmentAliases(pool,(await pool.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master'")).rows.map(r=>({...r.record_data,id:String(r.id)})));
   const report=buildMeterContinuityReport({records,from,to,...tolerance,assets});
   res.set('Cache-Control','private, no-store').json({...report,site:displaySiteName(site),from,to,generatedAt:new Date().toISOString()});
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}
 });
}
