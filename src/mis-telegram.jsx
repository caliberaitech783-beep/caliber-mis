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
 </section>;
}
