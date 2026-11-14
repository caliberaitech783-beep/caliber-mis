import {randomUUID} from 'node:crypto';

// Telegram "Approve" for production releases (owner's request, 15 Nov 2026).
// A release workflow asks Pulse-II for an approval; Pulse-II sends Mr Anoop and
// Mr Mohit Chadda a Telegram message with Approve and Reject buttons, naming who
// asked, from which computer and IP, and what will go live. The first answer of
// either of them decides. The workflow waits for that answer:
//   POST /api/release-approval/request     {kind, pr..., requester...}  -> {id}
//   POST /api/release-approval/:id/status   -> {status, decidedBy, ...}
//   POST /api/release-approval/:id/use      production release only, once
// kind "merge-release" comes from merge-and-release.yml: Approve merges that pull
// request into main and starts the production release with this approval.
// kind "release" comes from the production workflow itself (Urgent): Approve
// releases main as it is.
// Every call carries the run's GitHub OIDC identity; the workflow decides nothing
// a person did not approve. The requester's name, computer and IP are what the
// person or session that started the run typed in, so the message says so.
export const RELEASE_APPROVAL_MINUTES=10;
// How long an approved request stays usable by the release it starts.
const USE_WITHIN_MINUTES=30;
export const RELEASE_APPROVAL_PREFIX='rapp';
export const RELEASE_APPROVAL_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_release_approvals(
  id UUID PRIMARY KEY,kind TEXT NOT NULL,pr_number INTEGER,pr_title TEXT NOT NULL DEFAULT '',pr_head_sha TEXT NOT NULL DEFAULT '',main_sha TEXT NOT NULL DEFAULT '',
  changes TEXT NOT NULL DEFAULT '',actor TEXT NOT NULL DEFAULT '',run_id TEXT NOT NULL DEFAULT '',run_url TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL DEFAULT '',computer TEXT NOT NULL DEFAULT '',requester_ip TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL,
  decided_login TEXT,decided_name TEXT,decided_at TIMESTAMPTZ,used_at TIMESTAMPTZ,used_by_run TEXT,
  message_text TEXT NOT NULL DEFAULT '',messages JSONB NOT NULL DEFAULT '[]'::jsonb);
`;
const text=(value,max=200)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,max);
const istTime=date=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)+' IST';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{40}$/;

export function releaseApprovalMessage(row){
 const pr=row.kind==='merge-release';
 return [
  pr?'Pulse-II: approve MERGE + RELEASE to production?':'Pulse-II: approve URGENT RELEASE to production?',
  ...(pr?[`PR #${row.pr_number}: ${row.pr_title}`]:[`Main: ${String(row.main_sha||'').slice(0,7)||'latest'}`]),
  ...(row.changes?[`Changes: ${row.changes}`]:[]),
  '',
  `Requested by: ${row.requested_by||'(name not given)'}`,
  `Computer: ${row.computer||'(not given)'}`,
  `IP address: ${row.requester_ip||'(not given)'}`,
  '(name, computer and IP as given by the requester)',
  `GitHub account: ${row.actor||'unknown'} (checked by GitHub)`,
  ...(row.run_url?[`Run: ${row.run_url}`]:[]),
  '',
  pr?`Approve = merge PR #${row.pr_number} into main and make it live now.`:'Approve = make main live now.',
  `Valid for ${RELEASE_APPROVAL_MINUTES} minutes. Mr Anoop or Mr Mohit Chadda can answer; the first answer decides.`,
 ].join('\n').slice(0,3900);
}
export const releaseApprovalButtons=id=>({inline_keyboard:[[
 {text:'✅ Approve',callback_data:`${RELEASE_APPROVAL_PREFIX}:${id}:a`},
 {text:'❌ Reject',callback_data:`${RELEASE_APPROVAL_PREFIX}:${id}:r`},
]]});

// telegram: {sendNow(chatId,text,replyMarkup)->messageId, editText(chatId,messageId,text), onCallback(prefix,handler)}
// verifyIdentity(token)->claims (either release workflow); approverLogins()->MIS logins allowed to answer.
export function registerReleaseApproval(app,{pool,telegram,verifyIdentity,approverLogins,now=()=>new Date(),audit=()=>{}}){
 const identity=async req=>verifyIdentity(String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim());
 const workflowOf=claims=>/merge-and-release\.yml@/.test(String(claims.workflow_ref||''))?'merge':'production';
 const send=(res,error)=>res.status(error.status||500).json({error:error.status?error.message:'The release approval could not be processed.'});
 const approvers=async()=>[...new Set((await approverLogins()).map(login=>String(login||'').trim().toLowerCase()).filter(Boolean))];
 const nameOf=async login=>{try{return text((await pool.query("SELECT record_data->>'employee' AS name FROM master_records WHERE master_name='Users & employees' AND lower(trim(record_data->>'login'))=$1 ORDER BY id DESC LIMIT 1",[login])).rows[0]?.name)||login;}catch{return login;}};
 const closeMessages=async(row,line)=>{for(const m of row.messages||[])await telegram.editText(m.chatId,m.messageId,`${row.message_text}\n\n${line}`).catch(()=>{});};
 // A pending request past its time is closed when anyone looks at it.
 const expireIfDue=async(client,row)=>{
  if(row.status!=='pending'||new Date(row.expires_at)>now())return row;
  const {rows}=await client.query("UPDATE mis_release_approvals SET status='expired' WHERE id=$1 AND status='pending' RETURNING *",[row.id]);
  if(rows[0])await closeMessages(rows[0],'⌛ EXPIRED: nobody answered in time. Nothing was merged or released.');
  return rows[0]||row;
 };
 const view=row=>({id:row.id,kind:row.kind,status:row.status,prNumber:row.pr_number,decidedBy:row.decided_name||row.decided_login||'',decidedAt:row.decided_at,expiresAt:row.expires_at});

 app.post('/api/release-approval/request',async(req,res)=>{
  req.audit=false;res.set('Cache-Control','no-store');
  try{
   const claims=await identity(req),body=req.body||{},from=workflowOf(claims);
   const kind=from==='merge'?'merge-release':'release';
   if(body.kind&&body.kind!==kind)fail('This workflow cannot ask for that kind of approval.');
   const prNumber=kind==='merge-release'?Number(body.prNumber):null;
   if(kind==='merge-release'&&!(Number.isSafeInteger(prNumber)&&prNumber>0))fail('A pull request number is required.');
   const prHeadSha=text(body.prHeadSha,40).toLowerCase(),mainSha=text(body.mainSha||claims.sha,40).toLowerCase();
   if(kind==='merge-release'&&!SHA.test(prHeadSha))fail('The pull request head commit is required.');
   const row={id:randomUUID(),kind,pr_number:prNumber,pr_title:text(body.prTitle,200),pr_head_sha:prHeadSha,main_sha:SHA.test(mainSha)?mainSha:'',changes:text(body.changes,200),
    actor:text(claims.triggering_actor||claims.actor,80),run_id:text(claims.run_id,40),run_url:text(body.runUrl,300).startsWith('https://github.com/')?text(body.runUrl,300):'',
    requested_by:text(body.requestedBy,80),computer:text(body.computer,80),requester_ip:text(body.ip,64)};
   row.message_text=releaseApprovalMessage(row);
   const logins=await approvers();
   const chats=logins.length?(await pool.query('SELECT DISTINCT chat_id FROM mis_telegram_links WHERE login_name=ANY($1::text[])',[logins])).rows.map(r=>String(r.chat_id)):[];
   if(!chats.length)fail('Neither Mr Anoop nor Mr Mohit Chadda has linked Telegram in Pulse-II MIS, so nobody can approve.',503);
   // A newer request replaces any still waiting, so only one Approve button is live at a time.
   const {rows:replaced}=await pool.query("UPDATE mis_release_approvals SET status='replaced' WHERE status='pending' RETURNING *");
   for(const old of replaced)await closeMessages(old,'↪ REPLACED by a newer request. These buttons no longer work.');
   await pool.query(`INSERT INTO mis_release_approvals(id,kind,pr_number,pr_title,pr_head_sha,main_sha,changes,actor,run_id,run_url,requested_by,computer,requester_ip,expires_at,message_text)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [row.id,row.kind,row.pr_number,row.pr_title,row.pr_head_sha,row.main_sha,row.changes,row.actor,row.run_id,row.run_url,row.requested_by,row.computer,row.requester_ip,new Date(now().getTime()+RELEASE_APPROVAL_MINUTES*60000),row.message_text]);
   const messages=[];
   for(const chatId of chats){try{const messageId=await telegram.sendNow(chatId,row.message_text,releaseApprovalButtons(row.id));if(messageId)messages.push({chatId,messageId});}catch{}}
   if(!messages.length){await pool.query("UPDATE mis_release_approvals SET status='failed' WHERE id=$1",[row.id]);fail('Telegram did not deliver the approval request. Retry in a minute.',503);}
   await pool.query('UPDATE mis_release_approvals SET messages=$2::jsonb WHERE id=$1',[row.id,JSON.stringify(messages)]);
   audit(req,{action:'Release approval requested',reference:row.run_id,details:{kind,prNumber,actor:row.actor,requestedBy:row.requested_by,computer:row.computer,ip:row.requester_ip,sentTo:messages.length}});
   res.json({id:row.id,sentTo:messages.length,expiresInMinutes:RELEASE_APPROVAL_MINUTES});
  }catch(error){send(res,error)}
 });

 app.post('/api/release-approval/:id/status',async(req,res)=>{
  req.audit=false;res.set('Cache-Control','no-store');
  try{
   await identity(req);if(!UUID.test(req.params.id))fail('Unknown approval request.',404);
   let row=(await pool.query('SELECT * FROM mis_release_approvals WHERE id=$1',[req.params.id])).rows[0];if(!row)fail('Unknown approval request.',404);
   row=await expireIfDue(pool,row);
   res.json(view(row));
  }catch(error){send(res,error)}
 });

 // The production release spends an approval once. A merge-release approval is spent by the release
 // the merge workflow starts; an urgent-release approval only by the run that asked for it.
 app.post('/api/release-approval/:id/use',async(req,res)=>{
  req.audit=false;res.set('Cache-Control','no-store');
  const client=await pool.connect();
  try{
   const claims=await identity(req);if(workflowOf(claims)!=='production')fail('Only the production release can use an approval.',403);
   if(!UUID.test(req.params.id))fail('Unknown approval request.',404);
   await client.query('BEGIN');
   const row=(await client.query('SELECT * FROM mis_release_approvals WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
   if(!row)fail('Unknown approval request.',404);
   if(row.status==='used')fail('This approval was already used for a release.',409);
   if(row.status!=='approved')fail(row.status==='pending'?'Not approved yet.':`This request was ${row.status}.`,409);
   if(now().getTime()-new Date(row.decided_at).getTime()>USE_WITHIN_MINUTES*60000)fail(`The approval is older than ${USE_WITHIN_MINUTES} minutes. Ask again.`,409);
   if(row.kind==='release'&&String(claims.run_id)!==row.run_id)fail('This approval belongs to another run.',403);
   await client.query("UPDATE mis_release_approvals SET status='used',used_at=$3,used_by_run=$2 WHERE id=$1",[row.id,text(claims.run_id,40),now()]);
   await client.query('COMMIT');
   audit(req,{action:'Release approval used',reference:text(claims.run_id,40),details:{id:row.id,kind:row.kind,prNumber:row.pr_number,approvedBy:row.decided_login}});
   res.json({approved:true,kind:row.kind,prNumber:row.pr_number,decidedBy:row.decided_name||row.decided_login});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});send(res,error)}finally{client.release()}
 });

 // A tap on Approve or Reject. Only a linked Telegram of an approver counts, and only the first answer.
 telegram.onCallback(RELEASE_APPROVAL_PREFIX,async({fromId,data})=>{
  const [,id,choice]=String(data).split(':');
  if(!UUID.test(id||'')||!['a','r'].includes(choice))return 'This button is no longer active.';
  const login=(await pool.query('SELECT login_name FROM mis_telegram_links WHERE chat_id=$1',[String(fromId)])).rows[0]?.login_name;
  if(!login||!(await approvers()).includes(login))return 'Only Mr Anoop or Mr Mohit Chadda can answer this request.';
  const client=await pool.connect();let row,decided=false;
  try{
   await client.query('BEGIN');
   row=(await client.query('SELECT * FROM mis_release_approvals WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(row&&row.status==='pending'&&new Date(row.expires_at)>now()){
    const name=await nameOf(login);
    row=(await client.query('UPDATE mis_release_approvals SET status=$2,decided_login=$3,decided_name=$4,decided_at=$5 WHERE id=$1 RETURNING *',[id,choice==='a'?'approved':'rejected',login,name,now()])).rows[0];
    decided=true;
   }
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
  if(!row)return 'This request is no longer available.';
  if(!decided){row=await expireIfDue(pool,row);return row.status==='expired'?'This request expired. Nothing was merged or released.':`Already ${row.status}${row.decided_name?` by ${row.decided_name}`:''}.`;}
  const when=istTime(new Date(row.decided_at));
  await closeMessages(row,row.status==='approved'
   ?`✅ APPROVED by ${row.decided_name} (${row.decided_login}) at ${when}. ${row.kind==='merge-release'?`Merging PR #${row.pr_number} and releasing now.`:'Releasing now.'}`
   :`❌ REJECTED by ${row.decided_name} (${row.decided_login}) at ${when}. Nothing was merged or released.`);
  return row.status==='approved'?'Approved. The release starts now; you will get a message when it is live.':'Rejected. Nothing will be merged or released.';
 });

 return {async initialize(){await pool.query(RELEASE_APPROVAL_SCHEMA);}};
}
