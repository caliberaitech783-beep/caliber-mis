import React,{useEffect,useRef,useState} from 'react';

// Telegram channel of one automation (16 Nov 2026). Telegram does not let a bot create a channel, so the
// dialog walks through the three steps in Telegram and waits for the one-time code to be posted in the
// channel; once linked it shows the join link to share, a test post and unlink.
const copy=async value=>{try{await navigator.clipboard.writeText(value);return true;}catch{return false;}};
const stamp=value=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)).replace(/\//g,'-').replace(',',''):'';

export default function AutomationChannelDialog({row,request,onClose,onChanged}){
 const [view,setView]=useState(null),[setup,setSetup]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const closeButton=useRef(null),changed=useRef(false);
 const query='/channel?key='+encodeURIComponent(row.key);
 useEffect(()=>{closeButton.current?.focus();request(query).then(setView).catch(e=>setError(e.message));},[query,request]);
 useEffect(()=>{const onKey=event=>{if(event.key==='Escape')close();};window.addEventListener('keydown',onKey);return ()=>window.removeEventListener('keydown',onKey);});
 // While a code is shown, look every 4 seconds whether it has been posted in a channel.
 useEffect(()=>{
  if(!setup)return undefined;
  const started=Date.now(),timer=setInterval(()=>{
   if(Date.now()-started>setup.expiresInMinutes*60000){clearInterval(timer);setSetup(null);setError('The code has expired. Press "Start" again for a new code.');return;}
   request(query).then(result=>{if(result.linked&&result.linked.linkedAt!==setup.before){clearInterval(timer);setSetup(null);setView(result);changed.current=true;setNotice(`Linked to the channel "${result.linked.title}".`);}}).catch(()=>{});
  },4000);
  return ()=>clearInterval(timer);
 },[setup,query,request]);
 const close=()=>{if(changed.current)onChanged?.();onClose();};
 const run=async(task,done)=>{setBusy(true);setError('');setNotice('');try{const result=await task();done?.(result);}catch(e){setError(e.message);}finally{setBusy(false);}};
 const start=()=>run(()=>request('/channel/code','POST',{key:row.key}),result=>{setSetup({...result,before:result.linked?.linkedAt||''});setView(result);});
 const test=()=>run(()=>request('/channel/test','POST',{key:row.key}),result=>{setView(result);setNotice('Test post sent. Open the channel in Telegram to see it.');});
 const unlink=()=>{if(!window.confirm(`Unlink "${view.linked.title}" from ${row.code} ${row.name}?\n\nNothing more of this automation will be posted in the channel. The channel itself stays in Telegram; delete it there if it is not needed.`))return;
  run(()=>request('/channel','DELETE',{key:row.key}),result=>{setView(result);changed.current=true;setNotice('Channel unlinked.');});};
 const copyText=async(value,label)=>{setNotice(await copy(value)?label+' copied.':'Copy did not work here: select the text and copy it by hand.');};
 const linked=view?.linked;
 const share=linked?.inviteLink?`Join the Caliber Pulse-II channel "${linked.title}" on Telegram for ${row.code} ${row.name}: ${linked.inviteLink}`:'';
 return <div className="automation-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}>
  <section className="automation-dialog" role="dialog" aria-modal="true" aria-labelledby="automation-channel-title">
   <header><h2 id="automation-channel-title"><span className="automation-code">{row.code}</span> {row.name}: Telegram channel</h2>
    <button type="button" ref={closeButton} onClick={close} aria-label="Close">Close</button></header>
   {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
   {!view&&!error&&<p role="status">Loading…</p>}
   {view&&linked&&!setup&&<>
    {linked.lost&&<p role="alert">The Pulse-II bot was removed from this channel or can no longer post in it{linked.lostAt?' ('+stamp(linked.lostAt)+' IST)':''}. Nothing is being posted. Make the bot an administrator again, or link another channel.</p>}
    <dl className="automation-dialog-facts">
     <div><dt>Channel</dt><dd>{linked.title}</dd></div>
     <div><dt>Linked</dt><dd>{stamp(linked.linkedAt)} IST{linked.linkedBy?' by '+linked.linkedBy:''}</dd></div>
     <div><dt>Join link</dt><dd>{linked.inviteLink?<a href={linked.inviteLink} target="_blank" rel="noreferrer">{linked.inviteLink}</a>:'No join link: give the Pulse-II bot "Invite users via link" in the channel and link it again, or share the channel from Telegram.'}</dd></div>
    </dl>
    <p>Share the join link with the people who should follow this automation. Each person chooses in Telegram how it appears for them: sound, mute, pin or a folder. The personal Telegram messages of this automation continue as before.</p>
    <div className="automation-actions">
     {linked.inviteLink&&<button type="button" onClick={()=>void copyText(linked.inviteLink,'Join link')}>Copy join link</button>}
     {linked.inviteLink&&<a className="automation-button-link" href={'https://wa.me/?text='+encodeURIComponent(share)} target="_blank" rel="noreferrer">Share on WhatsApp</a>}
     <button type="button" disabled={busy} onClick={()=>void test()}>Send test post</button>
     <button type="button" disabled={busy} onClick={()=>void start()}>Link another channel</button>
     <button type="button" disabled={busy} onClick={unlink}>Unlink channel</button>
    </div></>}
   {view&&!linked&&!setup&&<>
    <p>Every {row.code} message is also posted once in a Telegram channel, and anyone you give the join link to can follow it. Telegram does not let a bot create a channel, so it is made once in Telegram; Pulse-II does the rest.</p>
    <div className="automation-actions"><button type="submit" disabled={busy} onClick={()=>void start()}>{busy?'Starting…':'Start'}</button></div></>}
   {setup&&<ol className="automation-steps">
    <li><b>Create the channel in Telegram.</b> Menu (or pencil) → New Channel. Name it <code>{setup.suggestedName}</code> <button type="button" className="automation-inline" onClick={()=>void copyText(setup.suggestedName,'Name')}>Copy name</button>. Private or public, as you like.</li>
    <li><b>Make the Pulse-II bot an administrator.</b> Channel → Administrators → Add Admin → search <code>@{setup.botUsername}</code>. Keep <i>Post messages</i>, <i>Delete messages</i> and <i>Invite users via link</i> on, then Save.</li>
    <li><b>Post this code in the channel:</b> <code className="automation-link-code">{setup.linkCode}</code> <button type="button" className="automation-inline" onClick={()=>void copyText(setup.linkCode,'Code')}>Copy code</button><br/>Pulse-II links the channel within a few seconds, removes the code and posts a welcome line. The code works once, for {setup.expiresInMinutes} minutes.</li>
    <li role="status" className="automation-waiting">Waiting for the code to be posted in the channel…</li>
   </ol>}
  </section>
 </div>;
}
