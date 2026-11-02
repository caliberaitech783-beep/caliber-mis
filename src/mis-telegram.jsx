import React,{useEffect,useState} from 'react';
import {isMisAdministrator} from '../mis-admin-access.mjs';
import './mis-admin.css';
export default function MisTelegram({session}){
 const admin=isMisAdministrator(session);
 const [me,setMe]=useState(null),[settings,setSettings]=useState(null),[botToken,setBotToken]=useState(''),[chat,setChat]=useState(''),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[link,setLink]=useState('');
 const request=async(path,method='GET',body)=>{const response=await fetch('/api/mis-telegram/'+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+session.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error||'Telegram request failed.');return result};
 useEffect(()=>{let active=true;setMe(null);setSettings(null);setBotToken('');setLink('');setError('');
  const check=()=>request('me').then(result=>{if(active)setMe(result)}).catch(e=>{if(active)setError(e.message)});
  void check();if(admin)request('settings').then(result=>{if(active){setSettings(result);setChat(result.adminChatId);setEnabled(result.enabled)}}).catch(e=>{if(active)setError(e.message)});
  const timer=setInterval(check,5000);return()=>{active=false;clearInterval(timer)};
 },[session.token,admin]);
 const action=async task=>{setBusy(true);setError('');setNotice('');try{await task()}catch(e){setError(e.message)}finally{setBusy(false)}};
 const save=event=>{event.preventDefault();void action(async()=>{try{const result=await request('settings','PUT',{botToken,adminChatId:chat,enabled});setSettings(result);setMe(await request('me'));setNotice('Telegram settings saved privately on the MIS server.')}finally{setBotToken('')}})};
 return <section className="panel mis-admin-page"><h1>Telegram Integration</h1>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {me&&<section><h2>My Telegram connection</h2><p>{me.linked?'Your MIS account is connected.':'Connect your Telegram account to receive your ticket resolution updates.'}</p>{me.chatId&&<p>Your private chat ID: <code>{me.chatId}</code></p>}
   <button type="button" disabled={busy||!me.enabled} onClick={()=>void action(async()=>{const result=await request('link','POST');setLink(result.url)})}>{me.linked?'Create a new connection link':'Connect my Telegram'}</button>
   {link&&<p><a href={link} target="_blank" rel="noreferrer">Open Telegram and press Start</a> · Link expires in 10 minutes.</p>}
   {!me.enabled&&<p>Telegram is not enabled yet. Your MIS administrator can complete setup.</p>}
  </section>}
  {admin&&settings&&<section><h2>MIS bot setup</h2><p>Use a dedicated MIS bot from <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">BotFather</a>. The token is encrypted on the MIS server and is never displayed again.</p>
   <form onSubmit={save} autoComplete="off"><label>Bot token {settings.configured?'(leave blank to keep the saved token)':''}<input type="password" value={botToken} onChange={e=>setBotToken(e.target.value)} autoComplete="new-password" required={!settings.configured}/></label>
    <label>Admin chat ID<input value={chat} onChange={e=>setChat(e.target.value)} placeholder="Link your own Telegram first, or enter the MIS admin group ID"/></label>
    <label className="mis-check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Enable MIS ticket notifications</label>
    <div className="mis-admin-actions"><button type="submit" disabled={busy}>Save privately</button><button type="button" disabled={busy||!settings.enabled||!settings.adminChatId} onClick={()=>void action(async()=>{await request('test','POST');setNotice('Test message sent to the configured MIS admin chat.')})}>Send test message</button></div>
   </form><p>Bot: {settings.botUsername?'@'+settings.botUsername:'Not configured'} · Webhook: {settings.webhookReady?'Ready':'Setup needed'}</p>
   {settings.delivery?.length>0&&<p>Delivery: {settings.delivery.map(row=>row.status+': '+row.count).join(' · ')}</p>}
  </section>}
  {admin&&<VlbBatchAlertSettings session={session}/>}
 </section>;
}

// Late VLB batch alerts: who is told, and how many hours after shift end.
export function VlbBatchAlertSettings({session}){
 const [form,setForm]=useState(null),[state,setState]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const call=async(path,method='GET',body)=>{const response=await fetch('/api/vlb-batch-alerts/'+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+session.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw Error(result.error||'Alert settings request failed.');return result};
 const load=()=>Promise.all([call('settings'),call('state')]).then(([settings,status])=>{setForm({...settings,productionHeadLogins:settings.productionHeadLogins.join(', '),pulseAdminLogins:(settings.pulseAdminLogins||[]).join(', ')});setState(status.alerts||[])}).catch(e=>setError(e.message));
 useEffect(()=>{void load()},[session.token]);
 const save=async event=>{event.preventDefault();setBusy(true);setError('');setNotice('');try{const saved=await call('settings','PUT',{...form,productionHeadLogins:String(form.productionHeadLogins||''),pulseAdminLogins:String(form.pulseAdminLogins||'')});setForm({...saved,productionHeadLogins:saved.productionHeadLogins.join(', '),pulseAdminLogins:(saved.pulseAdminLogins||[]).join(', ')});setNotice('VLB batch alert settings saved.')}catch(e){setError(e.message)}finally{setBusy(false)}};
 const runNow=async()=>{setBusy(true);setError('');setNotice('');try{const result=await call('run','POST');setNotice(`Checked now: ${result.due??0} due, ${result.sent??0} sent, ${result.cleared??0} cleared.`);await load()}catch(e){setError(e.message)}finally{setBusy(false)}};
 if(!form)return <section><h2>VLB batch alerts</h2>{error?<p role="alert">{error}</p>:<p role="status">Loading alert settings…</p>}</section>;
 const open=state.filter(row=>!row.cleared_at);
 return <section className="vlb-batch-alert-settings"><h2>VLB batch alerts</h2>
  <p>Telegram message to the site Project Managers and the production head when a shift's VLB batch is not created, or is still open, after the shift ends. Recipients must have connected their Telegram above. When no PM or production head is configured for a site, the site's MIS users are told instead.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <form onSubmit={save} autoComplete="off">
   <label className="mis-check"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>Send late batch alerts</label>
   <label>Batch not created: hours after shift end<input type="number" min="0.25" max="48" step="0.25" value={form.createdByHours} onChange={e=>setForm({...form,createdByHours:e.target.value})}/></label>
   <label>Batch still open: hours after shift end<input type="number" min="0.25" max="72" step="0.25" value={form.closedByHours} onChange={e=>setForm({...form,closedByHours:e.target.value})}/></label>
   <label>Reminder every (hours)<input type="number" min="0.5" max="24" step="0.5" value={form.reminderHours} onChange={e=>setForm({...form,reminderHours:e.target.value})}/></label>
   <label>Production head logins (comma separated)<input value={form.productionHeadLogins} onChange={e=>setForm({...form,productionHeadLogins:e.target.value})} placeholder="e.g. production.head"/></label>
   <label>Pulse administrator logins for the daily "Pending in Pulse" reminder (comma separated)<input value={form.pulseAdminLogins} onChange={e=>setForm({...form,pulseAdminLogins:e.target.value})} placeholder="e.g. pulse.admin"/></label>
   <div className="mis-admin-actions"><button type="submit" disabled={busy}>Save alert settings</button><button type="button" disabled={busy} onClick={()=>void runNow()}>Check now</button></div>
  </form>
  <h3>Open alerts ({open.length})</h3>
  {open.length?<div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Site</th><th>Date</th><th>Shift</th><th>Alert</th><th>Sent</th><th>Last sent</th><th>Recipients</th><th>Note</th></tr></thead><tbody>
   {open.map(row=><tr key={row.alert_key}><td>{row.site}</td><td>{row.date}</td><td>{row.shift}</td><td>{row.type==='not_created'?'Batch not created':'Batch still open'}</td><td>{row.sent_count}</td><td>{row.last_sent_at?new Date(row.last_sent_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'—'}</td><td>{(row.recipients||[]).join(', ')||'—'}</td><td>{row.last_error||''}</td></tr>)}
  </tbody></table></div>:<p>No shift is late right now.</p>}
 </section>;
}
