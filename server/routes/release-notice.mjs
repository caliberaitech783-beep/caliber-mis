// Off-schedule release notice. Production releases at 12:00, 15:00, 18:00 and 00:00 IST.
// When a release goes live at any other time (Run workflow), the release workflow posts here
// once the new commit is live, and the named people get a Telegram message through the MIS
// Telegram outbox. The workflow signs the request with a key derived from this server's
// integration key file, which only the release (through Azure) can read.
//
// The phone numbers come from the workflow's private secret, never from this public code.
// The answer names no number, only how many people were told, because release logs are public.
import {timingSafeEqual} from 'node:crypto';

export const RELEASE_NOTICE_PURPOSE='release-notice';
const MAX_AGE_MS=15*60*1000;
const text=value=>String(value??'').trim();
const digits=value=>text(value).replace(/\D/g,'').slice(-10);

// The exact bytes the workflow signs. Field order is fixed.
export function releaseNoticePayload({commit,subject,trigger,actor,runUrl,sentAt,mobiles}){
 return [commit,subject,trigger,actor,runUrl,sentAt,(mobiles||[]).join(',')].map(text).join('\n');
}

const istTime=date=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)+' IST';

export function releaseNoticeMessage({commit,subject,actor,runUrl,liveAt}){
 return [
  'Pulse-II MIS: released OUTSIDE the release schedule',
  'Schedule: 12:00, 15:00, 18:00 and 00:00 IST',
  `Live at: ${istTime(liveAt)}`,
  `Version: ${text(commit).slice(0,7)}${subject?` - ${text(subject).slice(0,200)}`:''}`,
  `Started by: ${text(actor)||'unknown'} (Run workflow)`,
  ...(runUrl?[runUrl]:[]),
 ].join('\n').slice(0,4000);
}

// Logins of the people whose mobile in the Users & employees master ends with one of the numbers.
async function loginsForMobile(pool,mobile){
 const {rows}=await pool.query(
  `SELECT DISTINCT lower(trim(record_data->>'login')) AS login FROM master_records
    WHERE master_name='Users & employees' AND coalesce(trim(record_data->>'login'),'')<>''
      AND (right(regexp_replace(coalesce(record_data->>'mobile',''),'[^0-9]','','g'),10)=$1
        OR right(regexp_replace(coalesce(record_data->>'whatsapp',''),'[^0-9]','','g'),10)=$1
        OR right(regexp_replace(coalesce(record_data->>'phone',''),'[^0-9]','','g'),10)=$1
        OR right(regexp_replace(coalesce(record_data->>'contact',''),'[^0-9]','','g'),10)=$1)`,[mobile]);
 return rows.map(row=>row.login).filter(Boolean);
}

export function registerReleaseNotice(app,{pool,sign,drain=()=>{},now=()=>new Date()}){
 app.post('/api/release-notice',async(req,res)=>{
  req.audit=false;res.set('Cache-Control','no-store');
  try{
   const body=req.body||{},commit=text(body.commit).toLowerCase(),trigger=text(body.trigger),sentAt=text(body.sentAt);
   const mobiles=Array.isArray(body.mobiles)?body.mobiles.map(digits).filter(value=>value.length===10):[];
   const expected=Buffer.from(sign(releaseNoticePayload({...body,mobiles:Array.isArray(body.mobiles)?body.mobiles:[]})),'hex');
   const given=Buffer.from(text(req.get('X-Release-Signature')),'hex');
   if(!given.length||given.length!==expected.length||!timingSafeEqual(given,expected))return res.status(403).json({error:'Invalid release notice signature.'});
   const age=now().getTime()-Date.parse(sentAt);
   if(!Number.isFinite(age)||Math.abs(age)>MAX_AGE_MS)return res.status(403).json({error:'Release notice is too old.'});
   if(!/^[0-9a-f]{40}$/.test(commit))return res.status(400).json({error:'A full release commit is required.'});
   if(trigger==='schedule')return res.json({told:0,skipped:'scheduled release'});
   if(!mobiles.length)return res.status(400).json({error:'No phone numbers were given.'});
   const message=releaseNoticeMessage({...body,commit,liveAt:now()});
   let told=0,noLogin=0,noTelegram=0;
   for(const mobile of [...new Set(mobiles)]){
    const logins=await loginsForMobile(pool,mobile);
    if(!logins.length){noLogin++;continue;}
    const {rows}=await pool.query('SELECT DISTINCT chat_id FROM mis_telegram_links WHERE login_name=ANY($1::text[])',[logins]);
    if(!rows.length){noTelegram++;continue;}
    for(const row of rows)await pool.query('INSERT INTO mis_telegram_outbox(event_key,chat_id,message) VALUES($1,$2,$3) ON CONFLICT(event_key) DO NOTHING',[`release:${commit}:${row.chat_id}`,row.chat_id,message]);
    told++;
   }
   void Promise.resolve().then(()=>drain()).catch(()=>{});
   res.json({told,noLogin,noTelegram});
  }catch{res.status(503).json({error:'The release notice could not be queued.'});}
 });
}
