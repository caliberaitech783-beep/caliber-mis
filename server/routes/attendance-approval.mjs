// Attendance approval of trip card batches, day by day for every site (owner, 27 Nov 2026). Rules: shared/attendance-approval.mjs.
//   GET  /api/attendance-approval                 the days of the window for the sites the login may see, with levels;
//   GET  /api/attendance-approval/day?site=&date= one day: its batches, cards and trail;
//   POST /api/attendance-approval/act             {site,date,action:'approve'|'back'|'resume',reason} from the screen;
//   GET  /api/attendance-approval/approvers       the approver list (administrators change it);
//   PUT  /api/attendance-approval/approvers       {approvers:[{level,scope,login}]} replaces the list.
// Telegram: one message per site, day and approver with Approve / Send back (callback att:<id>:a|b). Send back asks
// for the reason as the next message in that chat. A timer (one server at a time) moves days whose batches are all
// closed to Level 1 and sends the messages that are due.
// A locked day: its raw site spellings and date go into mis_attendance_locked_sites, and database triggers on
// mis_log_books, mis_shift_attendance and mis_vlb_batches refuse every change of that day (SQLSTATE CA423).
import {randomBytes,randomUUID} from 'node:crypto';
import {generateOtp,hashOtp,otpExpiresAt,checkOtpAttempt,resendTooSoon,OTP_TTL_MINUTES} from '../../shared/otp-approval.mjs';
import {APPROVAL_FROM,APPROVAL_LEVELS,LOCKED_LEVEL,ALL_SITES,ATTENDANCE_LOCKED_SQLSTATE,approvalUntil,levelInfo,levelLabel,siteKey,siteLabel,siteRegion,normalScope,scopeCovers,
 approversFor,canApprove,groupDays,reconcileDay,approveDay,sendBackDay,resumeDay,approvalMessage,lockedMessage,sentBackMessage,callbackData,parseCallback,displayDate,
 UNLOCK_REASON_MIN,unlockDay,unlockOtpMessage,unlockedMessage} from '../../shared/attendance-approval.mjs';
import {VTC_TRAINING_REASON} from '../../shared/vtc-training.mjs';

const LOCK_GUARD=`
 CREATE OR REPLACE FUNCTION mis_attendance_day_locked(p_site TEXT,p_date DATE) RETURNS BOOLEAN LANGUAGE sql STABLE AS
  $f$SELECT EXISTS(SELECT 1 FROM mis_attendance_locked_sites WHERE site=lower(btrim(p_site)) AND book_date=p_date)$f$;
 CREATE OR REPLACE FUNCTION mis_attendance_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $g$
 BEGIN
  -- A card's own content, site, date, machine or deletion is what a lock keeps; housekeeping columns (a search key
  -- filled in later, a counter) may still be written.
  -- Nested: the inner test names card columns, so it must only be planned for mis_log_books.
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='mis_log_books' THEN
   IF NEW.data IS NOT DISTINCT FROM OLD.data AND NEW.site IS NOT DISTINCT FROM OLD.site AND NEW.book_date IS NOT DISTINCT FROM OLD.book_date
      AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
    RETURN NEW;
   END IF;
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND mis_attendance_day_locked(OLD.site,OLD.book_date) THEN
   RAISE EXCEPTION 'Attendance of % on % is locked after the Directors approved it. Nothing of this day can change.',OLD.site,to_char(OLD.book_date,'DD-MM-YYYY') USING ERRCODE='${ATTENDANCE_LOCKED_SQLSTATE}';
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND mis_attendance_day_locked(NEW.site,NEW.book_date) THEN
   RAISE EXCEPTION 'Attendance of % on % is locked after the Directors approved it. Nothing of this day can change.',NEW.site,to_char(NEW.book_date,'DD-MM-YYYY') USING ERRCODE='${ATTENDANCE_LOCKED_SQLSTATE}';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
 END $g$;
 CREATE OR REPLACE FUNCTION mis_attendance_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $g$
 BEGIN
  IF TG_OP='INSERT' AND mis_attendance_day_locked(NEW.site,NEW.book_date) THEN
   RAISE EXCEPTION 'Attendance of % on % is locked after the Directors approved it. No batch can be added for this day.',NEW.site,to_char(NEW.book_date,'DD-MM-YYYY') USING ERRCODE='${ATTENDANCE_LOCKED_SQLSTATE}';
  END IF;
  IF TG_OP='DELETE' AND mis_attendance_day_locked(OLD.site,OLD.book_date) THEN
   RAISE EXCEPTION 'Attendance of % on % is locked after the Directors approved it. Its batches cannot be deleted.',OLD.site,to_char(OLD.book_date,'DD-MM-YYYY') USING ERRCODE='${ATTENDANCE_LOCKED_SQLSTATE}';
  END IF;
  IF TG_OP='UPDATE' AND (mis_attendance_day_locked(OLD.site,OLD.book_date) OR mis_attendance_day_locked(NEW.site,NEW.book_date)) AND (
     (OLD.closed_at IS NOT NULL AND NEW.closed_at IS NULL) OR NEW.site IS DISTINCT FROM OLD.site OR NEW.book_date IS DISTINCT FROM OLD.book_date
     OR NEW.shift IS DISTINCT FROM OLD.shift OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.archived_at IS DISTINCT FROM OLD.archived_at) THEN
   RAISE EXCEPTION 'Attendance of % on % is locked after the Directors approved it. Its batches cannot be reopened, moved or deleted.',OLD.site,to_char(OLD.book_date,'DD-MM-YYYY') USING ERRCODE='${ATTENDANCE_LOCKED_SQLSTATE}';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
 END $g$;
 -- A trigger is made once; its function is replaced above, so no table is locked again at each start.
 DO $t$ BEGIN
  IF to_regclass('mis_log_books') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='mis_attendance_lock_cards' AND tgrelid=to_regclass('mis_log_books')) THEN
   CREATE TRIGGER mis_attendance_lock_cards BEFORE INSERT OR UPDATE OR DELETE ON mis_log_books FOR EACH ROW EXECUTE FUNCTION mis_attendance_lock_guard();
  END IF;
  IF to_regclass('mis_shift_attendance') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='mis_attendance_lock_present' AND tgrelid=to_regclass('mis_shift_attendance')) THEN
   CREATE TRIGGER mis_attendance_lock_present BEFORE INSERT OR UPDATE OR DELETE ON mis_shift_attendance FOR EACH ROW EXECUTE FUNCTION mis_attendance_lock_guard();
  END IF;
  IF to_regclass('mis_vlb_batches') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='mis_attendance_lock_batches' AND tgrelid=to_regclass('mis_vlb_batches')) THEN
   CREATE TRIGGER mis_attendance_lock_batches BEFORE INSERT OR UPDATE OR DELETE ON mis_vlb_batches FOR EACH ROW EXECUTE FUNCTION mis_attendance_batch_guard();
  END IF;
 END $t$;`;

export const ATTENDANCE_APPROVAL_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_attendance_approvers(level SMALLINT NOT NULL CHECK(level BETWEEN 1 AND 4),scope TEXT NOT NULL,login TEXT NOT NULL,
  added_by TEXT,added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(level,scope,login));
 CREATE TABLE IF NOT EXISTS mis_attendance_days(site_key TEXT NOT NULL,book_date DATE NOT NULL,site TEXT NOT NULL,level SMALLINT NOT NULL DEFAULT 1,
  status TEXT NOT NULL,signature TEXT NOT NULL DEFAULT '',corrected BOOLEAN NOT NULL DEFAULT FALSE,sent_back JSONB,trail JSONB NOT NULL DEFAULT '[]'::jsonb,
  creators JSONB NOT NULL DEFAULT '[]'::jsonb,locked_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(site_key,book_date));
 CREATE TABLE IF NOT EXISTS mis_attendance_locked_sites(site TEXT NOT NULL,book_date DATE NOT NULL,locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(site,book_date));
 CREATE TABLE IF NOT EXISTS mis_attendance_messages(id TEXT PRIMARY KEY,site_key TEXT NOT NULL,book_date DATE NOT NULL,level SMALLINT NOT NULL,signature TEXT NOT NULL,
  login TEXT NOT NULL,chat_id TEXT NOT NULL,sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(site_key,book_date,level,signature,login));
 CREATE TABLE IF NOT EXISTS mis_attendance_reason_waits(chat_id TEXT PRIMARY KEY,message_id TEXT NOT NULL,login TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
 CREATE TABLE IF NOT EXISTS mis_attendance_unlock_otps(id UUID PRIMARY KEY,site_key TEXT NOT NULL,book_date DATE NOT NULL,site TEXT NOT NULL,reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,requested_name TEXT,sent_to TEXT[] NOT NULL,channels TEXT[] NOT NULL DEFAULT '{}',otp_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'sent',requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),used_at TIMESTAMPTZ,used_by TEXT);
 CREATE INDEX IF NOT EXISTS mis_attendance_unlock_otps_day ON mis_attendance_unlock_otps(site_key,book_date,requested_at DESC);
 ${LOCK_GUARD}`;

const REASON_WAIT_MINUTES=30;
const SEND_PER_RUN=300;
const fail=(status,message)=>Object.assign(new Error(message),{status});
const lower=value=>String(value||'').trim().toLowerCase();
const clean=(value,max)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,max);
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));
const asState=row=>row&&{level:Number(row.level),status:row.status,signature:row.signature,corrected:Boolean(row.corrected),sentBack:row.sent_back||null,trail:row.trail||[],lockedAt:row.locked_at||null};

// deliverOtp({logins,message,otp,eventKey}) → {sentTo,channels,failures}: Telegram, WhatsApp when Telegram is not connected.
export function createAttendanceApproval({pool,sendButtons=null,sendText=null,deliverOtp=null,now=()=>Date.now(),env=process.env,log=console.error}){
 let schema=null;
 const ensure=()=>schema??=pool.query(ATTENDANCE_APPROVAL_SCHEMA).catch(error=>{schema=null;throw error;});
 const iso=()=>new Date(now()).toISOString();
 const until=()=>approvalUntil(env);

 async function approvers(db=pool){await ensure();return (await db.query('SELECT level,scope,login FROM mis_attendance_approvers ORDER BY level,scope,login')).rows.map(r=>({level:Number(r.level),scope:r.scope,login:r.login}));}
 async function loginNames(db=pool){
  const {rows}=await db.query("SELECT record_data FROM master_records WHERE master_name='Users & employees'").catch(()=>({rows:[]}));
  const names=new Map();for(const {record_data:u} of rows){const login=lower(u?.login);if(login)names.set(login,String(u.name||u.employeeName||u.login||'').trim()||login);}
  return names;
 }
 async function readBatches(db,{site=null,date=null}={}){
  const params=[APPROVAL_FROM,until()];let extra='';
  if(date){params.push(date);extra=` AND book_date=$${params.length}`;}
  const {rows}=await db.query(`SELECT id,site,book_date::text AS report_date,shift,closed_at,closure_revision,lower(COALESCE(creator_login,created_by,amendment_by,'')) AS created_by
   FROM mis_vlb_batches WHERE deleted_at IS NULL AND archived_at IS NULL AND book_date BETWEEN $1::date AND $2::date${extra}`,params);
  const batches=rows.map(r=>({id:r.id,site:r.site,reportDate:r.report_date,shift:r.shift,closedAt:r.closed_at,closureRevision:Number(r.closure_revision||0),createdBy:r.created_by}));
  return site?batches.filter(b=>siteKey(b.site)===siteKey(site)):batches;
 }
 async function saveDay(db,day,state,at){
  await db.query(`INSERT INTO mis_attendance_days(site_key,book_date,site,level,status,signature,corrected,sent_back,trail,creators,locked_at,updated_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
   ON CONFLICT(site_key,book_date) DO UPDATE SET site=EXCLUDED.site,level=EXCLUDED.level,status=EXCLUDED.status,signature=EXCLUDED.signature,corrected=EXCLUDED.corrected,
    sent_back=EXCLUDED.sent_back,trail=EXCLUDED.trail,creators=EXCLUDED.creators,locked_at=EXCLUDED.locked_at,updated_at=EXCLUDED.updated_at`,
   [day.siteKey,day.date,day.site,state.level,state.status,state.signature||'',Boolean(state.corrected),JSON.stringify(state.sentBack||null),JSON.stringify(state.trail||[]),JSON.stringify(day.creators||[]),state.lockedAt||null,at]);
 }
 async function savedDays(db){return new Map((await db.query('SELECT *,book_date::text AS date FROM mis_attendance_days WHERE book_date BETWEEN $1::date AND $2::date',[APPROVAL_FROM,until()])).rows.map(r=>[r.site_key+'|'+r.date,r]));}

 // Every closed day of the window gets its line; a changed day drops back to Level 1 (shared rule).
 async function reconcile(){
  await ensure();
  const at=iso(),days=groupDays(await readBatches(pool)),saved=await savedDays(pool);
  let changed=0;
  for(const day of days){
   const row=saved.get(day.siteKey+'|'+day.date);
   const result=reconcileDay(asState(row),day,{at});
   if(result.changed&&result.state){await saveDay(pool,day,result.state,at);changed++;}
  }
  return {days:days.length,changed};
 }

 async function chatsOf(db,logins){
  if(!logins.length)return [];
  return (await db.query('SELECT login_name,chat_id FROM mis_telegram_links WHERE lower(login_name)=ANY($1::text[])',[logins])).rows.map(r=>({login:lower(r.login_name),chatId:String(r.chat_id)}));
 }
 // The day's cards and Present entries under every spelling of the site ("Sasti OB" is Sasti OC).
 async function daySummary(db,day){
  const ours=row=>siteKey(row.site)===day.siteKey;
  const cards=(await db.query(`SELECT site,book_type,NULLIF(COALESCE(data->>'employeeRecordId',data->>'employeeId',data->>'caliberId',''),'') AS person
   FROM mis_log_books WHERE deleted_at IS NULL AND book_date=$1::date`,[day.date]).catch(()=>({rows:[]}))).rows.filter(ours);
  const present=(await db.query('SELECT site,employee_id::text AS id,reason FROM mis_shift_attendance WHERE book_date=$1::date',[day.date]).catch(()=>({rows:[]}))).rows.filter(ours);
  const by=type=>cards.filter(c=>c.book_type===type).length;
  const withPerson=cards.filter(c=>c.person);
  const people=new Set([...withPerson.map(c=>c.person),...present.map(p=>p.id)]);
  return {cards:cards.length,vlb:by('vehicle'),elb:by('equipment'),lmv:by('lmv'),present:withPerson.length+present.length,people:people.size,
   training:present.filter(p=>p.reason===VTC_TRAINING_REASON).length};
 }

 // One message per site, day, level and approver (owner, 27 Nov 2026). Sent once per batch signature.
 async function notifyDue(){
  if(!sendButtons)return {sent:0};
  await ensure();
  const list=await approvers(),saved=[...(await savedDays(pool)).values()].filter(r=>r.status==='waiting'&&Number(r.level)<LOCKED_LEVEL);
  if(!saved.length||!list.length)return {sent:0};
  const already=new Set((await pool.query('SELECT site_key,book_date::text AS date,level,signature,login FROM mis_attendance_messages WHERE book_date BETWEEN $1::date AND $2::date',[APPROVAL_FROM,until()])).rows
   .map(r=>[r.site_key,r.date,r.level,r.signature,r.login].join('|')));
  const batchesByDay=new Map(groupDays(await readBatches(pool)).map(d=>[d.siteKey+'|'+d.date,d]));
  let sent=0;
  for(const row of saved.sort((a,b)=>a.date.localeCompare(b.date))){
   if(sent>=SEND_PER_RUN)break;
   const day=batchesByDay.get(row.site_key+'|'+row.date);if(!day||day.signature!==row.signature)continue;
   const due=approversFor(list,row.site,row.level).filter(login=>!already.has([row.site_key,row.date,row.level,row.signature,login].join('|')));
   if(!due.length)continue;
   const chats=await chatsOf(pool,due);if(!chats.length)continue;
   const text=approvalMessage({site:day.site,region:siteRegion(day.site),date:day.date,level:Number(row.level),batches:day.batches,summary:await daySummary(pool,day),trail:row.trail||[],corrected:row.corrected});
   for(const chat of chats){
    const id=randomBytes(8).toString('hex');
    const claimed=(await pool.query('INSERT INTO mis_attendance_messages(id,site_key,book_date,level,signature,login,chat_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id',[id,row.site_key,row.date,row.level,row.signature,chat.login,chat.chatId])).rows[0];
    if(!claimed)continue;
    try{
     const ok=await sendButtons(chat.chatId,text,[[{text:`✅ Approve ${displayDate(day.date).slice(0,5)}`,callback_data:callbackData(id,'a')},{text:`↩ Send back ${displayDate(day.date).slice(0,5)}`,callback_data:callbackData(id,'b')}]],{parse_mode:'HTML'});
     if(ok)sent++;else await pool.query('DELETE FROM mis_attendance_messages WHERE id=$1',[id]);
    }catch(error){await pool.query('DELETE FROM mis_attendance_messages WHERE id=$1',[id]).catch(()=>{});log('Attendance approval message failed:',error?.message);}
   }
  }
  return {sent};
 }

 async function tell(logins,text){
  if(!sendText)return;
  for(const chat of await chatsOf(pool,[...new Set(logins.map(lower).filter(Boolean))])){try{await sendText(chat.chatId,text,{parse_mode:'HTML'});}catch{/* the next one is tried */}}
 }

 // Approve, send back or take back one day. Checked again under the day's row lock.
 async function act({site,date,action,login,name,source,reason}){
  if(!validDate(date))throw fail(400,'Choose a date.');
  if(date<APPROVAL_FROM||date>until())throw fail(400,`Only days from ${displayDate(APPROVAL_FROM)} to ${displayDate(until())} go through attendance approval.`);
  if(!['approve','back','resume'].includes(action))throw fail(400,'Choose Approve or Send back.');
  await ensure();
  const who=lower(login),key=siteKey(site),at=iso();
  // A day whose batches were closed since the last run has no line yet: make it first.
  if(!(await pool.query('SELECT 1 FROM mis_attendance_days WHERE site_key=$1 AND book_date=$2::date',[key,date])).rows[0])await reconcile();
  const client=await pool.connect();let after=null,day=null,before=null;
  try{
   await client.query('BEGIN');
   const row=(await client.query('SELECT *,book_date::text AS date FROM mis_attendance_days WHERE site_key=$1 AND book_date=$2::date FOR UPDATE',[key,date])).rows[0];
   if(!row)throw fail(409,'This day is not waiting for approval: not every batch of it is closed.');
   before=asState(row);
   day=groupDays(await readBatches(client,{site:row.site,date}))[0];
   if(!day||!day.ready)throw fail(409,'A batch of this day is open again. It comes back to Site HR once every batch is closed.');
   if(day.signature!==before.signature)throw fail(409,'The batches of this day changed. It starts again at Site HR; refresh.');
   const list=await approvers(client);
   const level=action==='resume'?1:before.level;
   if(!canApprove(list,who,row.site,level))throw fail(403,`Only ${levelLabel(level)} of ${row.site} can ${action==='back'?'send this day back':'approve this day'} now.`);
   after=action==='approve'?approveDay(before,{login:who,name,at,source}):action==='back'?sendBackDay(before,{login:who,name,at,source,reason}):resumeDay(before,{login:who,name,at,source});
   await saveDay(client,{...day,site:row.site},after,at);
   if(after.level>=LOCKED_LEVEL){
    const raws=new Set(day.rawSites);
    for(const table of ['mis_log_books','mis_shift_attendance']){
     const {rows}=await client.query(`SELECT DISTINCT lower(btrim(site)) AS site FROM ${table} WHERE book_date=$1::date`,[date]).catch(()=>({rows:[]}));
     for(const r of rows)if(siteKey(r.site)===key)raws.add(r.site);
    }
    for(const raw of raws)await client.query('INSERT INTO mis_attendance_locked_sites(site,book_date) VALUES($1,$2::date) ON CONFLICT DO NOTHING',[raw,date]);
   }
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
  const list=await approvers();
  if(after.level>=LOCKED_LEVEL){
   const chain=APPROVAL_LEVELS.flatMap(l=>approversFor(list,day.site,l.level));
   await tell([...chain,...day.creators],lockedMessage({site:day.site,date}));
  }else if(action==='back'){
   await tell([...day.creators,...approversFor(list,day.site,1)],sentBackMessage({site:day.site,date,level:before.level,by:name||who,reason:after.sentBack.reason}));
  }else await notifyDue().catch(error=>log("Attendance approval send failed:",error?.message));
  return {site:day.site,date,level:after.level,status:after.status};
 }

 async function handleTelegramCallback({data,logins,chatId}){
  const parsed=parseCallback(data);if(!parsed)return null;
  await ensure();
  const message=(await pool.query('SELECT *,book_date::text AS date FROM mis_attendance_messages WHERE id=$1',[parsed.id])).rows[0];
  if(!message)return {answer:'This button is no longer active.',done:true};
  const mine=(logins||[]).map(lower);
  if(!mine.includes(lower(message.login)))return {answer:'This approval was sent to another login.'};
  const row=(await pool.query('SELECT level,status,signature FROM mis_attendance_days WHERE site_key=$1 AND book_date=$2::date',[message.site_key,message.date])).rows[0];
  if(!row||Number(row.level)!==Number(message.level)||row.signature!==message.signature||row.status!=='waiting'){
   return {answer:Number(row?.level)>=LOCKED_LEVEL?'This day is already locked.':'This day has moved on. See Masters › Attendance approval.',done:true};
  }
  const names=await loginNames();
  if(parsed.action==='back'){
   await pool.query(`INSERT INTO mis_attendance_reason_waits(chat_id,message_id,login,expires_at) VALUES($1,$2,$3,$4)
    ON CONFLICT(chat_id) DO UPDATE SET message_id=EXCLUDED.message_id,login=EXCLUDED.login,expires_at=EXCLUDED.expires_at`,[String(chatId||message.chat_id),message.id,lower(message.login),new Date(now()+REASON_WAIT_MINUTES*60000).toISOString()]);
   if(sendText)await sendText(String(chatId||message.chat_id),`Write why ${siteLabel(message.site_key)} · ${displayDate(message.date)} is sent back, as your next message (within ${REASON_WAIT_MINUTES} minutes).`,{reply_markup:{force_reply:true}}).catch(()=>{});
   return {answer:'Write the reason as your next message.'};
  }
  try{
   const result=await act({site:message.site_key,date:message.date,action:'approve',login:message.login,name:names.get(lower(message.login)),source:'Telegram'});
   return {answer:result.level>=LOCKED_LEVEL?'✅ Approved. The day is locked.':`✅ Approved. Sent to ${levelLabel(result.level)}.`,done:true};
  }catch(error){if(error.status)return {answer:error.message,done:true};throw error;}
 }

 // The next text in a chat after Send back is the reason. null = not ours.
 async function handleTelegramText({chatId,text,logins}){
  await ensure();
  const wait=(await pool.query('DELETE FROM mis_attendance_reason_waits WHERE chat_id=$1 RETURNING *',[String(chatId)])).rows[0];
  if(!wait)return null;
  if(new Date(wait.expires_at).getTime()<now())return {reply:'The time to write the reason has passed. Tap Send back again.'};
  if(!(logins||[]).map(lower).includes(lower(wait.login)))return {reply:'This chat is not linked to the login the approval was sent to.'};
  const message=(await pool.query('SELECT *,book_date::text AS date FROM mis_attendance_messages WHERE id=$1',[wait.message_id])).rows[0];
  if(!message)return {reply:'This approval is no longer active.'};
  const names=await loginNames();
  try{
   await act({site:message.site_key,date:message.date,action:'back',login:wait.login,name:names.get(lower(wait.login)),source:'Telegram',reason:text});
   return {reply:`↩ ${siteLabel(message.site_key)} · ${displayDate(message.date)} sent back. The batch creators and Site HR are told.`};
  }catch(error){if(error.status)return {reply:error.message};throw error;}
 }

 // The days for the screen: the sites the login approves (any level) or, for an administrator, every site.
 async function overview({login,admin}){
  await ensure();
  const who=lower(login),list=await approvers(),saved=await savedDays(pool),days=groupDays(await readBatches(pool));
  const visible=day=>admin||APPROVAL_LEVELS.some(l=>canApprove(list,who,day.site,l.level));
  return {from:APPROVAL_FROM,until:until(),levels:APPROVAL_LEVELS,
   days:days.filter(visible).map(day=>{
    const state=asState(saved.get(day.siteKey+'|'+day.date));
    const level=state?.level||1,status=state?.status||(day.ready?'waiting':'not_ready');
    return {site:day.site,siteKey:day.siteKey,region:siteRegion(day.site),date:day.date,batches:day.batches.length,open:day.open,shifts:day.batches.map(b=>b.shift),
     level,status,corrected:Boolean(state?.corrected),sentBack:state?.sentBack||null,trail:state?.trail||[],lockedAt:state?.lockedAt||null,
     mine:status==='waiting'&&level<LOCKED_LEVEL&&canApprove(list,who,day.site,level)||['sent_back','unlocked'].includes(status)&&canApprove(list,who,day.site,1),
     approvers:Object.fromEntries(APPROVAL_LEVELS.map(l=>[l.level,approversFor(list,day.site,l.level)]))};
   })};
 }
 async function dayDetail({site,date}){
  if(!validDate(date))throw fail(400,'Choose a date.');
  await ensure();
  const day=groupDays(await readBatches(pool,{site,date}))[0];
  if(!day)throw fail(404,'No batch of this site on this date.');
  return {site:day.site,date,batches:day.batches.map(b=>({id:b.id,shift:b.shift,closed:Boolean(b.closedAt),createdBy:b.createdBy})),summary:await daySummary(pool,day)};
 }
 async function saveApprovers({list,login}){
  if(!Array.isArray(list)||list.length>500)throw fail(400,'Send the approver list.');
  const names=await loginNames(),rows=[];
  for(const item of list){
   const level=Number(item?.level),scope=normalScope(item?.scope),who=lower(item?.login);
   if(!levelInfo(level))throw fail(400,'Choose a level from 1 to 4.');
   if(!scope)throw fail(400,`"${clean(item?.scope,40)}" is not a site, a region or All sites.`);
   if(!/^[a-z0-9._@-]{2,80}$/.test(who))throw fail(400,`"${clean(item?.login,80)}" is not a login.`);
   if(names.size&&!names.has(who))throw fail(400,`No MIS login "${who}" in Login Details.`);
   rows.push([level,scope,who]);
  }
  await ensure();
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('DELETE FROM mis_attendance_approvers');
   for(const [level,scope,who] of rows)await client.query('INSERT INTO mis_attendance_approvers(level,scope,login,added_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[level,scope,who,lower(login)]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
  void notifyDue().catch(error=>log('Attendance approval send failed:',error?.message));
  return approvers();
 }

 let timer=null,running=false;
 async function tick(){
  if(running)return;running=true;
  const client=await pool.connect().catch(()=>null);
  try{
   if(!client)return;
   // One server at a time (both Pulse-II slots run this timer).
   const got=(await client.query('SELECT pg_try_advisory_lock(709224127) AS ok')).rows[0]?.ok;
   if(!got)return;
   try{await reconcile();await notifyDue();}
   finally{await client.query('SELECT pg_advisory_unlock(709224127)').catch(()=>{});}
  }catch(error){log('Attendance approval run failed:',error?.message);}
  finally{client?.release();running=false;}
 }
 // ---- RHR unlock with OTP (owner, 27 Nov 2026) ----
 const publicUnlock=row=>row&&{id:row.id,status:row.status,sentTo:row.sent_to||[],channels:row.channels||[],expiresAt:row.expires_at,requestedAt:row.requested_at,requestedBy:row.requested_name||row.requested_by,reason:row.reason};
 // Whether a site's day is locked, and the OTP request waiting for it, for the reopen window and the screen.
 async function lockStatus({site,date}){
  if(!validDate(date))throw fail(400,'Choose a date.');
  await ensure();
  const key=siteKey(site);
  const row=(await pool.query('SELECT level,status,trail FROM mis_attendance_days WHERE site_key=$1 AND book_date=$2::date',[key,date])).rows[0];
  const locked=Number(row?.level)>=LOCKED_LEVEL;
  const live=locked?(await pool.query("SELECT * FROM mis_attendance_unlock_otps WHERE site_key=$1 AND book_date=$2::date AND status='sent' AND expires_at>$3 ORDER BY requested_at DESC LIMIT 1",[key,date,iso()])).rows[0]:null;
  const list=await approvers();
  return {site:siteLabel(site),date,locked,status:row?.status||null,level:row?Number(row.level):null,rhr:approversFor(list,site,3),request:publicUnlock(live)};
 }
 // A user who needs to reopen a batch of a locked day asks; the RHR of the region gets the OTP.
 async function requestUnlock({site,date,reason,login,name}){
  if(!validDate(date))throw fail(400,'Choose a date.');
  const why=clean(reason,500);
  if(why.length<UNLOCK_REASON_MIN)throw fail(400,'Write why this locked day has to be reopened (at least '+UNLOCK_REASON_MIN+' letters).');
  if(!deliverOtp)throw fail(503,'OTP delivery is not set up on this server.');
  await ensure();
  const key=siteKey(site),label=siteLabel(site);
  const row=(await pool.query('SELECT level FROM mis_attendance_days WHERE site_key=$1 AND book_date=$2::date',[key,date])).rows[0];
  if(!(Number(row?.level)>=LOCKED_LEVEL))throw fail(409,'This day is not locked. Reopen the batch as usual.');
  const rhr=approversFor(await approvers(),label,3);
  if(!rhr.length)throw fail(409,'No RHR is set for '+label+' on Masters › Attendance approval, so the OTP cannot be sent.');
  const live=(await pool.query("SELECT * FROM mis_attendance_unlock_otps WHERE site_key=$1 AND book_date=$2::date AND status='sent' ORDER BY requested_at DESC LIMIT 1",[key,date])).rows[0];
  if(live&&resendTooSoon(live.requested_at,{now:now()}))throw fail(429,'An OTP was sent to RHR less than a minute ago. Wait before asking again.');
  const id=randomUUID(),otp=generateOtp(),requestedName=clean(name,80)||lower(login);
  const message=unlockOtpMessage({site:label,region:siteRegion(label),date,requestedBy:requestedName,reason:why,otp,minutes:OTP_TTL_MINUTES});
  const delivery=await deliverOtp({logins:rhr,message,otp,eventKey:'attendance-unlock-otp:'+id});
  if(!delivery?.sentTo?.length)throw fail(409,('RHR of '+label+' has no Telegram or mobile registered. '+(delivery?.failures||[]).join(' ')).trim());
  if(live)await pool.query("UPDATE mis_attendance_unlock_otps SET status='cancelled' WHERE id=$1 AND status='sent'",[live.id]);
  const saved=(await pool.query(`INSERT INTO mis_attendance_unlock_otps(id,site_key,book_date,site,reason,requested_by,requested_name,sent_to,channels,otp_hash,expires_at,requested_at)
   VALUES($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[id,key,date,label,why,lower(login),requestedName,delivery.sentTo,delivery.channels||[],hashOtp(id,otp),otpExpiresAt(now()),iso()])).rows[0];
  return publicUnlock(saved);
 }
 // The OTP entered by the person who asked (or by the RHR). Right: the day is unlocked; wrong: counted, five at most.
 async function verifyUnlock({id,otp,login,name}){
  if(!/^[0-9a-f-]{36}$/i.test(String(id||'')))throw fail(400,'Invalid OTP reference.');
  await ensure();
  const who=lower(login),at=iso();
  const client=await pool.connect();let result=null;
  try{
   await client.query('BEGIN');
   const row=(await client.query('SELECT *,book_date::text AS date FROM mis_attendance_unlock_otps WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(row&&who!==row.requested_by&&!(row.sent_to||[]).includes(who))throw fail(403,'Only the person who asked, or the RHR, can enter this OTP.');
   const check=checkOtpAttempt(row,otp,{now:now()});
   if(!check.ok){
    if(row&&check.status!=='missing'&&(check.status!==row.status||(check.attempts??row.attempts)!==row.attempts))await client.query('UPDATE mis_attendance_unlock_otps SET status=$2,attempts=$3 WHERE id=$1',[row.id,check.status,check.attempts??row.attempts]);
    await client.query('COMMIT');
    throw fail(400,check.message);
   }
   const day=(await client.query('SELECT *,book_date::text AS date FROM mis_attendance_days WHERE site_key=$1 AND book_date=$2::date FOR UPDATE',[row.site_key,row.date])).rows[0];
   if(!(Number(day?.level)>=LOCKED_LEVEL)){await client.query("UPDATE mis_attendance_unlock_otps SET status='cancelled' WHERE id=$1",[row.id]);await client.query('COMMIT');throw fail(409,'This day is not locked any more.');}
   const state=unlockDay(asState(day),{login:row.requested_by,name:row.requested_name,at,reason:row.reason,approvedBy:row.sent_to,otpId:row.id});
   await saveDay(client,{siteKey:row.site_key,date:row.date,site:day.site,creators:day.creators||[]},state,at);
   const raws=(await client.query('SELECT site FROM mis_attendance_locked_sites WHERE book_date=$1::date',[row.date])).rows.map(r=>r.site).filter(raw=>siteKey(raw)===row.site_key);
   if(raws.length)await client.query('DELETE FROM mis_attendance_locked_sites WHERE book_date=$1::date AND site=ANY($2::text[])',[row.date,raws]);
   await client.query("UPDATE mis_attendance_unlock_otps SET status='used',used_at=$2,used_by=$3,attempts=$4 WHERE id=$1",[row.id,at,who,check.attempts]);
   await client.query('COMMIT');
   result={row,day};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
  const {row,day}=result,list=await approvers();
  await tell([row.requested_by,...row.sent_to,...approversFor(list,day.site,1),...(day.creators||[])],unlockedMessage({site:day.site,date:row.date,by:row.requested_name||row.requested_by,reason:row.reason,rhr:(row.sent_to||[]).join(', ')}));
  return {site:day.site,date:row.date,unlocked:true,status:'unlocked'};
 }
 return {ensure,reconcile,notifyDue,act,lockStatus,requestUnlock,verifyUnlock,handleTelegramCallback,handleTelegramText,overview,dayDetail,approvers,saveApprovers,loginNames,
  start({everyMs=120000,firstMs=45000}={}){if(timer)return;setTimeout(()=>void tick(),firstMs).unref?.();timer=setInterval(()=>void tick(),everyMs);timer.unref?.();},
  stop(){clearInterval(timer);timer=null;}};
}

export function registerAttendanceApproval(app,{approval,requireSession,isAdministrator,siteAllowed=null}){
 const wrap=handler=>async(req,res,next)=>{
  try{await handler(req,res);}
  catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
 };
 const who=req=>({login:lower(req.session?.login),name:req.session?.name||req.session?.login||''});
 const admin=req=>Boolean(isAdministrator?.(req.session));
 app.get('/api/attendance-approval',requireSession,wrap(async(req,res)=>{res.set('Cache-Control','no-store').json({...await approval.overview({...who(req),admin:admin(req)}),admin:admin(req)});}));
 app.get('/api/attendance-approval/day',requireSession,wrap(async(req,res)=>{
  const {days}=await approval.overview({...who(req),admin:admin(req)});
  if(!days.some(d=>d.siteKey===siteKey(req.query.site)&&d.date===req.query.date))throw fail(404,'This day is not one of yours.');
  res.set('Cache-Control','no-store').json(await approval.dayDetail({site:req.query.site,date:req.query.date}));
 }));
 app.post('/api/attendance-approval/act',requireSession,wrap(async(req,res)=>{
  const {site,date,action,reason}=req.body||{};
  const result=await approval.act({site,date,action,reason,...who(req),source:'MIS'});
  req.audit={eventType:'Approval',module:'Attendance approval',action:action==='approve'?(result.level>=LOCKED_LEVEL?'Approve and lock attendance day':'Approve attendance day'):action==='back'?'Send attendance day back':'Take attendance day back',
   targetType:'Site day',targetReference:`${result.site} ${date}`,details:{level:result.level,status:result.status,reason:clean(reason,500)||undefined}};
  res.json(result);
 }));
 // RHR unlock with OTP: any login that may reopen batches of the site (siteAllowed), an approver of the site or an administrator.
 const mayAsk=async(req,site)=>admin(req)||Boolean(await siteAllowed?.(req.session,site))||(await approval.approvers()).some(a=>lower(a.login)===who(req).login&&scopeCovers(a.scope,site));
 app.get('/api/attendance-approval/lock',requireSession,wrap(async(req,res)=>{res.set('Cache-Control','no-store').json(await approval.lockStatus({site:req.query.site,date:req.query.date}));}));
 app.post('/api/attendance-approval/unlock',requireSession,wrap(async(req,res)=>{
  const {site,date,reason}=req.body||{};
  if(!await mayAsk(req,site))throw fail(403,'This site is not assigned to your login.');
  const request=await approval.requestUnlock({site,date,reason,...who(req)});
  req.audit={eventType:'Approval',module:'Attendance approval',action:'Ask RHR for the unlock OTP',targetType:'Site day',targetReference:siteLabel(site)+' '+date,details:{reason:clean(reason,500),sentTo:request.sentTo,channels:request.channels}};
  res.status(201).json({request});
 }));
 app.post('/api/attendance-approval/unlock/verify',requireSession,wrap(async(req,res)=>{
  const result=await approval.verifyUnlock({id:req.body?.id,otp:req.body?.otp,...who(req)});
  req.audit={eventType:'Approval',module:'Attendance approval',action:'Unlock attendance day with RHR OTP',targetType:'Site day',targetReference:result.site+' '+result.date,details:{}};
  res.json(result);
 }));
 app.get('/api/attendance-approval/approvers',requireSession,wrap(async(req,res)=>{
  const names=await approval.loginNames();
  res.set('Cache-Control','no-store').json({approvers:await approval.approvers(),admin:admin(req),logins:[...names].map(([login,name])=>({login,name})).sort((a,b)=>a.login.localeCompare(b.login))});
 }));
 app.put('/api/attendance-approval/approvers',requireSession,wrap(async(req,res)=>{
  if(!admin(req))throw fail(403,'Only an administrator can change the attendance approvers.');
  const list=await approval.saveApprovers({list:req.body?.approvers,login:who(req).login});
  req.audit={eventType:'Master data',module:'Attendance approval',action:'Change attendance approvers',targetType:'Approver list',targetReference:'Attendance approval',details:{count:list.length}};
  res.json({approvers:list});
 }));
}
export {ALL_SITES,scopeCovers};
