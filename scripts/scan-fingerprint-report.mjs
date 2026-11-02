// Measures how far apart scan fingerprints sit on real cards, so the duplicate
// thresholds (SCAN_DUPLICATE_SKIP_PERCENT, SCAN_DUPLICATE_SUSPECT_PERCENT) are
// set from evidence before fingerprint skipping is enabled.
//
//   node scripts/scan-fingerprint-report.mjs [--since 2026-11-01] [--compute]
//
// --compute fingerprints cards that have none yet (reads images from the
// database or blob storage). Output: for every scan entry context (date, site,
// shift), the distance of each card to its nearest other card, split into
// "same card" pairs (same date, door and card number read) and "different card"
// pairs. A clear gap between the two groups is what the thresholds rely on.
import pg from 'pg';
import {fingerprintScanImage,fingerprintDistance,scanFingerprintSettings} from '../scan-fingerprint.mjs';
import {cardNumberKey} from '../scan-duplicates.mjs';
import {canonicalSiteName} from '../site-location.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined};
const since=option('--since')||'2026-11-01',compute=args.includes('--compute');
const url=process.env.DATABASE_URL;if(!url){console.error('Set DATABASE_URL.');process.exit(1);}
const pool=new pg.Pool({connectionString:url,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false}});
try{
 if(compute){
  const rows=(await pool.query("SELECT id,image FROM mis_scan_cards WHERE fingerprint IS NULL AND created_at>=$1 AND image IS NOT NULL",[since])).rows;
  for(const row of rows){try{await pool.query('UPDATE mis_scan_cards SET fingerprint=$2::jsonb WHERE id=$1',[row.id,JSON.stringify(await fingerprintScanImage(row.image))]);}catch(error){console.error('card '+row.id+': '+error.message);}}
  console.log('Fingerprinted '+rows.length+' card(s) stored in the database. Cards held only in blob storage are fingerprinted by the server backfill.');
 }
 const cards=(await pool.query("SELECT c.id,c.batch_id,c.ordinal,c.status,c.fingerprint,c.draft,b.name,b.kind,b.expected_context FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id WHERE c.created_at>=$1 AND c.fingerprint IS NOT NULL AND (c.fingerprint->>'version')::int>0 ORDER BY b.created_at,c.ordinal",[since])).rows;
 const groups=new Map();
 for(const card of cards){const ctx=card.expected_context||{};const key=[card.kind,ctx.bookDate||'',canonicalSiteName(ctx.location||''),ctx.cardShift||''].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(card);}
 const same=[],different=[],settings=scanFingerprintSettings();
 for(const [key,list] of groups){
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
   const a=list[i],b=list[j],distance=fingerprintDistance(a.fingerprint,b.fingerprint).max;
   const da=a.draft||{},db=b.draft||{};
   const identical=da.bookDate&&da.bookDate===db.bookDate&&da.assetId&&da.assetId===db.assetId&&cardNumberKey(da.aFormNo||da.jobCardNo)&&cardNumberKey(da.aFormNo||da.jobCardNo)===cardNumberKey(db.aFormNo||db.jobCardNo);
   (identical?same:different).push({key,a:a.name+' #'+a.ordinal,b:b.name+' #'+b.ordinal,distance});
  }
 }
 const summarise=(label,rows)=>{if(!rows.length){console.log(label+': no pairs');return;}const sorted=rows.map(r=>r.distance).sort((x,y)=>x-y),pick=q=>sorted[Math.min(sorted.length-1,Math.floor(q*sorted.length))];console.log(label+': '+rows.length+' pairs · min '+sorted[0]+' · p10 '+pick(.1)+' · median '+pick(.5)+' · p90 '+pick(.9)+' · max '+sorted[sorted.length-1]);};
 console.log('Contexts: '+groups.size+' · cards: '+cards.length+' · thresholds in force: skip <= '+settings.skipPercent+', suspect <= '+settings.suspectPercent+(settings.enabled?'':' (fingerprint skipping is OFF)'));
 summarise('Same card (same date, door, card number)',same);
 summarise('Different cards, same date/site/shift',different);
 const risky=different.filter(r=>r.distance<=settings.suspectPercent).sort((x,y)=>x.distance-y.distance).slice(0,20);
 if(risky.length){console.log('Closest DIFFERENT pairs (would be suspect or skipped at current thresholds):');for(const r of risky)console.log('  '+r.distance+'%  '+r.a+'  vs  '+r.b+'  ['+r.key+']');}
 const missed=same.filter(r=>r.distance>settings.skipPercent).sort((x,y)=>y.distance-x.distance).slice(0,20);
 if(missed.length){console.log('SAME-card pairs above the skip threshold (would be read, then caught by content):');for(const r of missed)console.log('  '+r.distance+'%  '+r.a+'  vs  '+r.b+'  ['+r.key+']');}
}finally{await pool.end();}
