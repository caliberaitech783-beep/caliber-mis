import {AUTOMATIONS,automationRows} from '../rules/automation-catalogue.mjs';
import {readMismatchSettings,writeMismatchSettings} from './equipment-pulse-mismatch.mjs';

// Telegram/WhatsApp Automation Centre: one list of every automatic message rule with its channels,
// recipients and the number of messages sent to date.
//
// Counting. MIS Telegram messages are counted straight from the MIS Telegram outbox, which is kept
// for good. Pulse messages (WhatsApp and the Pulse Telegram bot) are logged in a history that is
// cleared after some days, so their daily totals are copied into mis_automation_daily_counts before
// that happens; a day's total only ever grows. Counts therefore start from the oldest day on record.

export const AUTOMATION_CENTRE_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_automation_daily_counts(
  source_key TEXT NOT NULL,channel TEXT NOT NULL,day DATE NOT NULL,sent INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(source_key,channel,day));`;
const ROLLUP=`INSERT INTO mis_automation_daily_counts(source_key,channel,day,sent)
 SELECT report_type,CASE WHEN recipient_phone='Telegram' OR recipient_name='Telegram group' OR status LIKE 'Sent by Telegram%' THEN 'telegram' ELSE 'whatsapp' END,
  (created_at AT TIME ZONE 'Asia/Kolkata')::date,count(*)::int
 FROM whatsapp_alert_history WHERE status LIKE 'Sent%' GROUP BY 1,2,3
 ON CONFLICT(source_key,channel,day) DO UPDATE SET sent=GREATEST(mis_automation_daily_counts.sent,EXCLUDED.sent)`;
const OUTBOX=`SELECT split_part(event_key,':',1) AS prefix,
  CASE WHEN event_key LIKE '%|not_created:%' THEN 'not_created' WHEN event_key LIKE '%|not_closed:%' THEN 'not_closed' ELSE '' END AS kind,
  count(*) FILTER (WHERE status='sent')::int AS sent,max(created_at) FILTER (WHERE status='sent') AS last,min(created_at) AS first
 FROM mis_telegram_outbox GROUP BY 1,2`;

const later=(a,b)=>!a?b:!b?a:new Date(a)>new Date(b)?a:b;
const earlier=(a,b)=>!a?b:!b?a:new Date(a)<new Date(b)?a:b;
const optional=async query=>{try{return (await query).rows;}catch(error){if(['42P01','42703'].includes(error.code))return [];throw error;}};

export function createAutomationCentre({pool,context,ensureSchema=async()=>{},log=console}){
 let ready,timer;
 const ensure=()=>ready??=(async()=>{await ensureSchema();await pool.query(AUTOMATION_CENTRE_SCHEMA);})().catch(e=>{ready=null;throw e;});
 const rollUp=async()=>{await ensure();await optional(pool.query(ROLLUP));};
 async function counts(){
  const outbox=new Map((await optional(pool.query(OUTBOX))).map(row=>[row.kind?row.prefix+'/'+row.kind:row.prefix,row]));
  const history=new Map();
  for(const row of await optional(pool.query('SELECT source_key,channel,sum(sent)::int AS sent,min(day)::text AS first,max(day)::text AS last FROM mis_automation_daily_counts GROUP BY 1,2'))){
   const entry=history.get(row.source_key)||{};entry[row.channel]=row;history.set(row.source_key,entry);
  }
  const oem=(await optional(pool.query('SELECT count(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent,max(sent_at) AS last,min(sent_at) AS first FROM oem_email_deliveries')))[0];
  const result={},claimed=new Set();
  for(const item of AUTOMATIONS){
   const source=item.count||{};
   if(source.outbox){
    const rows=source.outbox.flatMap(key=>key.includes('/')?[outbox.get(key)]:[...outbox].filter(([name])=>name===key||name.startsWith(key+'/')).map(([,row])=>row)).filter(Boolean);
    const telegram=rows.reduce((sum,row)=>sum+row.sent,0);
    result[item.key]={sent:telegram,telegram,lastSentAt:rows.reduce((last,row)=>later(last,row.last),null),from:rows.reduce((first,row)=>earlier(first,row.first),null)};
   }else if(source.history){
    // Rules that share one history type share one total; it is shown once, on the first of them.
    const signature=source.history.join('|');
    if(claimed.has(signature))continue;claimed.add(signature);
    const entries=source.history.map(type=>history.get(type)).filter(Boolean);
    const sum=channel=>entries.reduce((total,entry)=>total+(entry[channel]?.sent||0),0);
    const days=entries.flatMap(entry=>Object.values(entry));
    result[item.key]={sent:sum('telegram')+sum('whatsapp'),telegram:sum('telegram'),whatsapp:sum('whatsapp'),
     lastSentAt:days.reduce((last,row)=>later(last,row.last),null),from:days.reduce((first,row)=>earlier(first,row.first),null)};
   }else if(source.oem&&oem){
    result[item.key]={sent:oem.sent,email:oem.sent,lastSentAt:oem.last,from:oem.first};
   }
  }
  return result;
 }
 async function overview(){
  await rollUp();
  const rows=automationRows({...await context(),mismatch:await readMismatchSettings(pool)},await counts());
  return {rows,generatedAt:new Date().toISOString(),totals:{automations:rows.length,active:rows.filter(row=>row.active).length,
   telegramOn:rows.filter(row=>row.channels.telegram==='on').length,whatsappOn:rows.filter(row=>row.channels.whatsapp==='on').length,
   sentToDate:rows.reduce((sum,row)=>sum+(row.sent||0),0),sentTelegram:rows.reduce((sum,row)=>sum+(row.sentTelegram||0),0),
   sentWhatsApp:rows.reduce((sum,row)=>sum+(row.sentWhatsApp||0),0),sentEmail:rows.reduce((sum,row)=>sum+(row.sentEmail||0),0)}};
 }
 const start=()=>{if(timer)return;const tick=()=>void rollUp().catch(e=>log.error?.('Automation counts:',e.code||e.message));tick();timer=setInterval(tick,6*3600000);timer.unref?.();};
 const stop=()=>{if(timer)clearInterval(timer);timer=undefined;};
 return {overview,rollUp,counts,start,stop,ensure};
}

export function registerAutomationCentre(app,{pool,requireSession,requireAdministrator,centre}){
 const guard=[requireSession,requireAdministrator];
 app.get('/api/automation-centre',...guard,async(req,res,next)=>{try{req.audit=false;res.set('Cache-Control','private, no-store').json({...await centre.overview(),mismatchSettings:await readMismatchSettings(pool)});}catch(e){next(e);}});
 app.put('/api/automation-centre/equipment-mismatch',...guard,async(req,res,next)=>{try{
  const input=req.body||{};
  if(input.intervalHours!==undefined&&![1,2,3,4,6,8,12,24].includes(Number(input.intervalHours)))return res.status(400).json({error:'Choose how often to check: 1, 2, 3, 4, 6, 8, 12 or 24 hours.'});
  if(input.logins!==undefined&&!Array.isArray(input.logins)&&typeof input.logins!=='string')return res.status(400).json({error:'Enter the logins separated by commas.'});
  const saved=await writeMismatchSettings(pool,{...await readMismatchSettings(pool),...input});
  req.audit={eventType:'Administration',module:'Automation Centre',action:'Change equipment list mismatch automation',targetReference:'equipment-mismatch',details:saved};
  res.set('Cache-Control','private, no-store').json({...await centre.overview(),mismatchSettings:saved});
 }catch(e){next(e);}});
}
