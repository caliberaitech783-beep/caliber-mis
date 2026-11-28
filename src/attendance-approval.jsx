// Masters › Attendance approval (owner, 27 Nov 2026): trip card batches, day by day for every site, approved by
// Level 1 Site HR → Level 2 Office HR → Level 3 RHR → Level 4 Directors, then locked. The same Approve / Send back
// as the Telegram message of that day. Drawn in the owner's report steps: Step 1 one line per site, Step 2 its days
// (one approval per day, so one line per date), Step 3 the day pressed, with its batches, trail and the buttons.
// An administrator sets who approves each site at each level below the steps.
// Rule: shared/attendance-approval.mjs; routes: server/routes/attendance-approval.mjs.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {APPROVAL_LEVELS,LOCKED_LEVEL,ALL_SITES,displayDate,istTime,levelLabel,scopeOptions} from '../shared/attendance-approval.mjs';
import AttendanceUnlock from './attendance-unlock.jsx';
import './caliber-recheck.css';

const count=value=>Number(value||0).toLocaleString('en-IN');
const TONE={waiting:'#854F0B',locked:'#3B6D11',sent_back:'#A32D2D',not_ready:'#5F5E5A'};
const pill=(text,tone)=><span style={{display:'inline-block',padding:'1px 6px',borderRadius:4,fontSize:12,color:tone,border:`1px solid ${tone}`}}>{text}</span>;
function statusText(day){
 if(day.status==='locked'||day.level>=LOCKED_LEVEL)return pill('🔒 Locked','#3B6D11');
 if(day.status==='sent_back')return pill('Sent back','#A32D2D');
 if(day.status==='unlocked')return pill('🔓 Unlocked by RHR OTP','#A32D2D');
 if(day.status==='not_ready')return pill(day.open?`${day.open} batch open`:'Batch reopened','#5F5E5A');
 return pill(`At ${levelLabel(day.level)}${day.corrected?' (corrected)':''}`,'#854F0B');
}
function levelCell(day,level){
 if(day.status==='not_ready')return '—';
 if(day.sentBack&&day.status==='sent_back'&&day.sentBack.level===level)return pill('Sent back','#A32D2D');
 if(day.level>level)return pill('✓','#3B6D11');
 if(day.level===level&&day.status==='waiting')return pill('Waiting','#854F0B');
 return '—';
}
const lastBy=(day,level)=>[...day.trail].reverse().find(t=>t.level===level&&t.action==='approved');

export default function AttendanceApproval({session,ReportSection}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [site,setSite]=useState(''),[date,setDate]=useState(''),[detail,setDetail]=useState(null),[reason,setReason]=useState(''),[acting,setActing]=useState(false);
 const run=useRef(0);
 const headers={Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'};
 const load=async()=>{
  const mine=++run.current;setBusy(true);setError('');
  try{
   const response=await fetch('/api/attendance-approval',{headers});
   const answer=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(answer.error||'Attendance approval is unavailable.');
   if(run.current===mine)setData(answer);
  }catch(e){if(run.current===mine)setError(e.message);}
  finally{if(run.current===mine)setBusy(false);}
 };
 useEffect(()=>{void load();return()=>{run.current++};},[]);
 useEffect(()=>{
  setDetail(null);setReason('');
  if(!site||!date)return;
  let live=true;
  fetch(`/api/attendance-approval/day?site=${encodeURIComponent(site)}&date=${date}`,{headers}).then(r=>r.json().then(a=>({ok:r.ok,a}))).then(({ok,a})=>{if(live)setDetail(ok?a:{error:a.error||'This day could not be read.'});}).catch(()=>{if(live)setDetail({error:'This day could not be read.'});});
  return()=>{live=false};
 },[site,date]);

 const days=data?.days||[];
 const sites=useMemo(()=>{
  const map=new Map();
  for(const day of days){
   const row=map.get(day.siteKey)||{key:day.siteKey,site:day.site,region:day.region,days:0,notReady:0,l1:0,l2:0,l3:0,l4:0,back:0,locked:0,mine:0};
   row.days++;if(day.mine)row.mine++;
   if(day.status==='locked'||day.level>=LOCKED_LEVEL)row.locked++;else if(day.status==='sent_back')row.back++;else if(day.status==='not_ready')row.notReady++;else row['l'+day.level]++;
   map.set(day.siteKey,row);
  }
  return [...map.values()].sort((a,b)=>a.site.localeCompare(b.site));
 },[days]);
 const total=useMemo(()=>sites.length?sites.reduce((t,r)=>{for(const k of ['days','notReady','l1','l2','l3','l4','back','locked','mine'])t[k]+=r[k];return t;},{key:'*total',site:'All sites',total:true,days:0,notReady:0,l1:0,l2:0,l3:0,l4:0,back:0,locked:0,mine:0}):null,[sites]);
 const siteDays=days.filter(d=>d.siteKey===site).sort((a,b)=>a.date.localeCompare(b.date));
 const day=siteDays.find(d=>d.date===date);

 const act=async(action,target=day)=>{
  if(!target)return;
  if(action==='back'&&reason.trim().length<5){setError('Write why this day is sent back.');return;}
  setActing(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/attendance-approval/act',{method:'POST',headers,body:JSON.stringify({site:target.site,date:target.date,action,reason})});
   const answer=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(answer.error||'This could not be saved.');
   setNotice(action==='approve'?(answer.level>=LOCKED_LEVEL?`${target.site} · ${displayDate(target.date)} approved and locked.`:`${target.site} · ${displayDate(target.date)} approved. Sent to ${levelLabel(answer.level)}.`)
    :action==='back'?`${target.site} · ${displayDate(target.date)} sent back. The batch creators and Site HR are told.`:`${target.site} · ${displayDate(target.date)} is back with Site HR.`);
   setReason('');await load();
  }catch(e){setError(e.message);}
  finally{setActing(false);}
 };
 // Owner, 27 Nov 2026: see on one's own Telegram how an approval and the RHR unlock OTP arrive. Changes nothing.
 const sendSample=async()=>{
  setActing(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/attendance-approval/sample',{method:'POST',headers,body:'{}'});
   const answer=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(answer.error||'The sample could not be sent.');
   setNotice(`Sample sent to your Telegram: the approval message for ${answer.site} · ${displayDate(answer.date)}${answer.realDay?'':' (example day)'} and the RHR unlock OTP message. Its buttons change nothing.`);
  }catch(e){setError(e.message);}
  finally{setActing(false);}
 };
 const approveAllMine=async()=>{
  const mine=siteDays.filter(d=>d.mine&&d.status==='waiting');
  if(!mine.length)return;
  if(!window.confirm(`Approve ${mine.length} day(s) of ${mine[0].site} waiting for you?`))return;
  setActing(true);setError('');setNotice('');let done=0;
  try{
   for(const one of mine){
    const response=await fetch('/api/attendance-approval/act',{method:'POST',headers,body:JSON.stringify({site:one.site,date:one.date,action:'approve'})});
    const answer=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(`${displayDate(one.date)}: ${answer.error||'not saved'}`);
    done++;
   }
  }catch(e){setError(e.message);}
  finally{setNotice(`${done} day(s) approved.`);setActing(false);await load();}
 };

 const figure=key=>row=>row[key]>0&&!row.total?<button type="button" className={'cr-figure'+(site===row.key?' cr-figure-picked':'')} onClick={event=>{event.stopPropagation();setSite(row.key);setDate('');}}>{count(row[key])}</button>:count(row[key]);
 const siteColumns=[{key:'site',label:'Site',value:r=>r.site},{key:'region',label:'Region',value:r=>r.region||''},{key:'days',label:'Days',value:r=>r.days},
  {key:'notReady',label:'Batch open',value:r=>r.notReady,render:figure('notReady')},
  ...APPROVAL_LEVELS.map(l=>({key:'l'+l.level,label:`At ${l.level} · ${l.label}`,value:r=>r['l'+l.level],render:figure('l'+l.level)})),
  {key:'back',label:'Sent back',value:r=>r.back,render:figure('back')},{key:'locked',label:'Locked',value:r=>r.locked,render:figure('locked')},
  {key:'mine',label:'Waiting for you',value:r=>r.mine,render:figure('mine')}];
 const dayColumns=[{key:'date',label:'Date',value:d=>d.date,render:d=><strong>{displayDate(d.date)}</strong>},
  {key:'batches',label:'Batches',value:d=>d.batches,render:d=><>{count(d.batches)}<small className="cr-sub">{d.shifts.join(', ')}</small></>},
  ...APPROVAL_LEVELS.map(l=>({key:'lv'+l.level,label:`${l.level} · ${l.label}`,value:d=>d.level>l.level?1:0,render:d=><>{levelCell(d,l.level)}{lastBy(d,l.level)&&<small className="cr-sub">{lastBy(d,l.level).name} · {istTime(lastBy(d,l.level).at)}</small>}</>})),
  {key:'status',label:'Status',value:d=>d.status,render:statusText}];

 return <section className="caliber-recheck">
  <header className="cr-head">
   <div><h1>Attendance approval</h1>
    <p>Trip card batches from {data?displayDate(data.from):'01-11-2026'} to {data?displayDate(data.until):'20-11-2026'}, day by day for every site: Level 1 Site HR verifies attendance, Level 2 Office HR cross-checks and validates, Level 3 RHR reviews, Level 4 Directors give final approval, and the day is locked. A day starts at Site HR when every batch of it is closed. Each approver also gets one Telegram summary per site with every day waiting for them, each day with its own Approve / Send back. A day sent back returns to the batch creators; when they reopen, correct and close the batch it starts again at Site HR. A locked day's batches cannot be reopened and its cards cannot change, unless the RHR of the region gives an OTP: the user writes why, RHR gets the OTP, and the OTP entered unlocks the day, which then goes through the four levels again.</p></div>
   <div className="cr-actions">
    <button type="button" disabled={acting} onClick={()=>void sendSample()}>Send sample to my Telegram</button>
    <button type="button" disabled={busy} onClick={()=>void load()}>{busy?'Reading…':'Refresh'}</button>
   </div>
  </header>
  {error&&<p className="cr-error" role="alert">{error}</p>}
  {notice&&<p className="cr-notice" role="status">{notice}</p>}
  {total&&<div className="cr-summary" aria-label="Summary">
   <span><strong>{count(total.days)}</strong> site days</span><span><strong>{count(total.mine)}</strong> waiting for you</span>
   <span><strong>{count(total.l1+total.l2+total.l3+total.l4)}</strong> in approval</span><span><strong>{count(total.back)}</strong> sent back</span><span><strong>{count(total.locked)}</strong> locked</span>
  </div>}
  <ReportSection key="aa-sites" reportKey="Attendance approval sites" title="Step 1 · Attendance approval · Sites" category="attendance-approval-sites" dataReady={!busy} recordDateFilter={false}
   description="One line per site: its days at each level. Press a line or a figure for its days."
   rows={sites.length&&total?[...sites,total]:[]} columns={siteColumns} rowKey={r=>r.key} isTotalRow={r=>Boolean(r.total)}
   rowClassName={r=>(r.total?'tt-total':'')+(site&&r.key===site?' report-row-picked':'')}
   onRowClick={r=>{if(!r.total){setSite(r.key);setDate('');}}} emptyMessage={busy?'Reading the batches…':'No day of your sites is in attendance approval. An administrator sets the approvers below.'}/>
  {site&&<ReportSection key={'aa-days-'+site} reportKey="Attendance approval days" title={`Step 2 · ${siteDays[0]?.site||''} · Days`} category="attendance-approval-days" dataReady={!busy} recordDateFilter={false}
   description="One approval per day: all batches of that date. Press a day to see it and approve or send it back."
   rows={siteDays} columns={dayColumns} rowKey={d=>d.date} rowClassName={d=>d.date===date?'report-row-picked':''}
   onRowClick={d=>setDate(d.date)} emptyMessage="No day of this site.">
   {siteDays.some(d=>d.mine&&d.status==='waiting')&&<div className="cr-actions"><button type="button" disabled={acting} onClick={()=>void approveAllMine()}>Approve all {siteDays.filter(d=>d.mine&&d.status==='waiting').length} day(s) waiting for me</button></div>}
  </ReportSection>}
  {day&&<ReportSection key={'aa-day-'+site+date} reportKey="Attendance approval day" title={`Step 3 · ${day.site} · ${displayDate(day.date)}`} category="attendance-approval-day" dataReady={Boolean(detail)} recordDateFilter={false}
   description={detail?.summary?`Cards: VLB ${count(detail.summary.vlb)} · ELB ${count(detail.summary.elb)} · LMV ${count(detail.summary.lmv)} · present ${count(detail.summary.present)} duties · ${count(detail.summary.people)} people${detail.summary.training?` · VTC Training ${count(detail.summary.training)}`:''}`:detail?.error||'Reading the day…'}
   rows={day.trail.map((t,i)=>({...t,key:i}))} rowKey={t=>t.key}
   columns={[{key:'level',label:'Level',value:t=>levelLabel(t.level)},{key:'action',label:'What',value:t=>({unlocked:'Unlocked with RHR OTP',approved:'Approved',sent_back:'Sent back',taken_back:'Taken back by Site HR',batch_reopened:'A batch was reopened',batches_changed:'Batches changed, back to Site HR'})[t.action]||t.action},
    {key:'by',label:'By',value:t=>t.name||t.by||''},{key:'at',label:'When',value:t=>istTime(t.at)},{key:'source',label:'From',value:t=>t.source||''},{key:'reason',label:'Reason',value:t=>t.reason||''}]}
   emptyMessage={`Nothing done yet. Waiting for ${levelLabel(day.level)}.`}>
   {detail?.batches&&<p className="cr-note">Batches: {detail.batches.map(b=>`${b.shift}${b.closed?'':' (open)'} by ${b.createdBy||'—'}`).join(' · ')}</p>}
   <p className="cr-note">Approvers: {APPROVAL_LEVELS.map(l=>`${l.label}: ${(day.approvers[l.level]||[]).join(', ')||'not set'}`).join(' · ')}</p>
   {day.mine&&day.status==='waiting'&&<div className="cr-actions">
    <button type="button" disabled={acting} onClick={()=>void act('approve')}>Approve {displayDate(day.date)} as {levelLabel(day.level)}</button>
    <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason to send back" maxLength={500} style={{minWidth:260}}/>
    <button type="button" disabled={acting} onClick={()=>void act('back')}>Send back</button>
   </div>}
   {(day.status==='locked'||day.level>=LOCKED_LEVEL)&&<AttendanceUnlock key={'unlock-'+day.siteKey+day.date} session={session} site={day.site} date={day.date} onUnlocked={load}/>}
   {day.mine&&['sent_back','unlocked'].includes(day.status)&&<div className="cr-actions">
    <span className="cr-note">{day.status==='unlocked'?'Unlocked with the OTP of RHR':'Sent back'} by {day.sentBack?.name}: “{day.sentBack?.reason}”. It starts again at Site HR by itself when a batch is reopened and closed.</span>
    <button type="button" disabled={acting} onClick={()=>void act('resume')}>Take back as it is</button>
   </div>}
  </ReportSection>}
  <Approvers session={session} headers={headers} onSaved={()=>void load()}/>
 </section>;
}

function Approvers({headers,onSaved}){
 const [state,setState]=useState(null),[rows,setRows]=useState([]),[error,setError]=useState(''),[saved,setSaved]=useState(''),[busy,setBusy]=useState(false);
 const scopes=scopeOptions();
 useEffect(()=>{fetch('/api/attendance-approval/approvers',{headers}).then(r=>r.json().then(a=>({ok:r.ok,a}))).then(({ok,a})=>{if(ok){setState(a);setRows(a.approvers);}else setError(a.error||'The approvers could not be read.');}).catch(()=>setError('The approvers could not be read.'));},[]);
 if(!state)return error?<p className="cr-error">{error}</p>:null;
 const save=async()=>{
  setBusy(true);setError('');setSaved('');
  try{
   const response=await fetch('/api/attendance-approval/approvers',{method:'PUT',headers,body:JSON.stringify({approvers:rows})});
   const answer=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(answer.error||'Not saved.');
   setRows(answer.approvers);setSaved('Approvers saved. Days waiting at their level are sent to them on Telegram.');onSaved();
  }catch(e){setError(e.message);}
  finally{setBusy(false);}
 };
 const set=(i,key,value)=>setRows(list=>list.map((r,k)=>k===i?{...r,[key]:key==='level'?Number(value):value}:r));
 const name=login=>state.logins.find(l=>l.login===login)?.name||'';
 return <details className="cr-embedded" open={state.admin&&!rows.length}>
  <summary>Who approves ({rows.length} {rows.length===1?'line':'lines'}){state.admin?'':' · read only'}</summary>
  <p className="cr-note">Site HR and Office HR are usually set per site, RHR per region (WCL or NCL), Directors for All sites. Any one login of a level can approve. A login gets the Telegram messages only after it has connected Telegram (Telegram Integration page).</p>
  <datalist id="aa-logins">{state.logins.map(l=><option key={l.login} value={l.login}>{l.name}</option>)}</datalist>
  <table className="cr-record-table"><thead><tr><th>Level</th><th>Sites</th><th>Login</th><th>Name</th>{state.admin&&<th/>}</tr></thead><tbody>
   {rows.map((r,i)=><tr key={i}>
    <td>{state.admin?<select value={r.level} onChange={e=>set(i,'level',e.target.value)}>{APPROVAL_LEVELS.map(l=><option key={l.level} value={l.level}>{l.level} · {l.label}</option>)}</select>:`${r.level} · ${levelLabel(r.level)}`}</td>
    <td>{state.admin?<select value={r.scope} onChange={e=>set(i,'scope',e.target.value)}>{scopes.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select>:(scopes.find(s=>s.value===r.scope)?.label||r.scope)}</td>
    <td>{state.admin?<input list="aa-logins" value={r.login} onChange={e=>set(i,'login',e.target.value.trim().toLowerCase())}/>:r.login}</td>
    <td>{name(r.login)}</td>
    {state.admin&&<td><button type="button" onClick={()=>setRows(list=>list.filter((_,k)=>k!==i))}>Remove</button></td>}
   </tr>)}
  </tbody></table>
  {state.admin&&<div className="cr-actions">
   <button type="button" onClick={()=>setRows(list=>[...list,{level:1,scope:scopes.find(s=>s.value!==ALL_SITES&&s.value.length>3)?.value||ALL_SITES,login:''}])}>Add approver</button>
   <button type="button" disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Save approvers'}</button>
  </div>}
  {error&&<p className="cr-error" role="alert">{error}</p>}
  {saved&&<p className="cr-notice" role="status">{saved}</p>}
 </details>;
}
