import React,{useCallback,useEffect,useMemo,useState} from 'react';
import './automation-centre.css';

const TABS=['Overview','Rules','Messages sent','Equipment mismatch settings'];
const stamp=value=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)).replace(/\//g,'-').replace(',',''):'';
const day=value=>value?stamp(value).slice(0,10):'';
const number=value=>value===null||value===undefined?'—':Number(value).toLocaleString('en-IN');
const Channel=({state})=>state===null?<span className="automation-channel is-none">Not used</span>:<span className={'automation-channel '+(state==='on'?'is-on':'is-off')}>{state==='on'?'ON':'OFF'}</span>;

export default function AutomationCentre({session,onOpenPage}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[tab,setTab]=useState(TABS[0]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[form,setForm]=useState(null),[category,setCategory]=useState('All');
 const request=useCallback(async(route='',method='GET',body)=>{
  const response=await fetch('/api/automation-centre'+route,{method,cache:'no-store',headers:{Authorization:'Bearer '+session.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'Could not load the Automation Centre.');
  return result;
 },[session.token]);
 const accept=result=>{setData(result);setForm({...result.mismatchSettings,logins:result.mismatchSettings.logins.join(', ')})};
 const load=useCallback(()=>{setError('');return request().then(accept).catch(e=>setError(e.message))},[request]);
 useEffect(()=>{void load()},[load]);
 const save=async event=>{event.preventDefault();setBusy(true);setError('');setNotice('');
  try{accept(await request('/equipment-mismatch','PUT',{...form,intervalHours:Number(form.intervalHours)}));setNotice('Equipment list mismatch automation saved.')}catch(e){setError(e.message)}finally{setBusy(false)}};
 const categories=useMemo(()=>['All',...new Set((data?.rows||[]).map(row=>row.category))],[data]);
 const rows=(data?.rows||[]).filter(row=>category==='All'||row.category===category);
 const totals=data?.totals;
 return <section className="panel automation-centre">
  <header className="automation-head"><div><h1>Telegram/WhatsApp Automation Centre</h1>
   <p>One place to see every automatic message: its rule, its channels, who receives it and how many have been sent to date.</p></div>
   <div><button type="button" onClick={()=>void load()}>Refresh current view</button>{data&&<small>Updated {stamp(data.generatedAt)} IST</small>}</div></header>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!data&&!error&&<p role="status">Loading automations…</p>}
  {data&&<>
   <div className="automation-tabs" role="tablist" aria-label="Automation Centre sections">{TABS.map(name=><button key={name} type="button" role="tab" aria-selected={tab===name} className={tab===name?'is-active':''} onClick={()=>setTab(name)}>{name}</button>)}</div>
   <dl className="automation-totals">
    <div><dt>Automations made to date</dt><dd>{totals.automations}</dd></div>
    <div><dt>Active now</dt><dd>{totals.active}</dd></div>
    <div><dt>Telegram ON</dt><dd>{totals.telegramOn}</dd></div>
    <div><dt>WhatsApp ON</dt><dd>{totals.whatsappOn}</dd></div>
    <div><dt>Messages sent to date</dt><dd>{number(totals.sentToDate)}</dd></div>
   </dl>
   {tab!=='Equipment mismatch settings'&&<label className="automation-filter">Category<select value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(name=><option key={name}>{name}</option>)}</select></label>}
   {tab==='Overview'&&<div className="automation-table"><table>
    <thead><tr><th>#</th><th>Automation</th><th>Category</th><th>State</th><th>Telegram</th><th>WhatsApp</th><th>Pop-up</th><th>Email</th><th>Sent to date</th><th>People</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.code}>
     <td>{row.number}</td>
     <td><span className="automation-code">{row.code}</span> <b>{row.name}</b><small>{row.rule}</small>{row.editable&&<button type="button" className="automation-link" onClick={()=>setTab('Equipment mismatch settings')}>Change settings</button>}</td>
     <td>{row.category}</td><td><span className={'automation-channel '+(row.active?'is-on':'is-off')}>{row.active?'ACTIVE':'OFF'}</span></td>
     <td><Channel state={row.channels.telegram}/></td><td><Channel state={row.channels.whatsapp}/></td><td><Channel state={row.channels.popup}/></td><td><Channel state={row.channels.email}/></td>
     <td className="automation-number">{number(row.sent)}{row.countNote&&<small>{row.countNote}</small>}</td><td>{row.people}</td></tr>)}</tbody>
   </table></div>}
   {tab==='Rules'&&<div className="automation-table"><table>
    <thead><tr><th>#</th><th>Automation</th><th>Rule</th><th>When it runs</th><th>Message format</th><th>People</th><th>Switched on / off in</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.code}><td>{row.number}</td><td><span className="automation-code">{row.code}</span> <b>{row.name}</b></td><td>{row.rule}</td><td>{row.trigger}</td><td>{row.format}</td><td>{row.people}</td><td>{row.controlledIn}</td></tr>)}</tbody>
   </table></div>}
   {tab==='Messages sent'&&<><div className="automation-table"><table>
    <thead><tr><th>#</th><th>Automation</th><th>Telegram</th><th>WhatsApp</th><th>Email</th><th>Total to date</th><th>Counted from</th><th>Last sent</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.code}><td>{row.number}</td><td><span className="automation-code">{row.code}</span> <b>{row.name}</b>{row.countNote&&<small>{row.countNote}</small>}</td>
     <td className="automation-number">{number(row.sentTelegram)}</td><td className="automation-number">{number(row.sentWhatsApp)}</td><td className="automation-number">{number(row.sentEmail)}</td>
     <td className="automation-number"><b>{number(row.sent)}</b></td><td>{day(row.countedFrom)}</td><td>{stamp(row.lastSentAt)}</td></tr>)}
     <tr className="automation-total-row"><td></td><td><b>Total</b></td><td className="automation-number">{number(totals.sentTelegram)}</td><td className="automation-number">{number(totals.sentWhatsApp)}</td><td className="automation-number">{number(totals.sentEmail)}</td><td className="automation-number"><b>{number(totals.sentToDate)}</b></td><td></td><td></td></tr></tbody>
   </table></div>
   <p className="automation-note">Pulse-II Telegram messages are counted from the first message ever sent. WhatsApp and Pulse Telegram messages are counted from the day shown, because the older delivery history had already been cleared before this page was made; from now on every day is kept.</p></>}
   {tab==='Equipment mismatch settings'&&form&&<form className="automation-form" onSubmit={save}>
    <h2><span className="automation-code">A01</span> Equipment list mismatch</h2>
    <p>Compares the Equipment Deployment report with the Pulse equipment list. When they differ, a notice pops up in Pulse-II and a message goes out; both repeat at every check until the lists match.</p>
    <label className="automation-check"><input type="checkbox" checked={form.enabled} onChange={event=>setForm({...form,enabled:event.target.checked})}/>Automation switched on</label>
    <label>Check every<select value={form.intervalHours} onChange={event=>setForm({...form,intervalHours:event.target.value})}>{[1,2,3,4,6,8,12,24].map(hours=><option key={hours} value={hours}>{hours} hour{hours===1?'':'s'}</option>)}</select></label>
    <label className="automation-check"><input type="checkbox" checked={form.popup} onChange={event=>setForm({...form,popup:event.target.checked})}/>Pop-up notice in Pulse-II (administrators and the people below)</label>
    <label className="automation-check"><input type="checkbox" checked={form.telegram} onChange={event=>setForm({...form,telegram:event.target.checked})}/>Telegram message</label>
    <label className="automation-check"><input type="checkbox" checked={form.whatsapp} onChange={event=>setForm({...form,whatsapp:event.target.checked})}/>WhatsApp message</label>
    <p className="automation-note">WhatsApp delivers a plain message only to a number that has written to the Caliber WhatsApp number in the last 24 hours. For guaranteed delivery a message template has to be approved by Meta first; until then Telegram is the dependable channel.</p>
    <label>People (Pulse-II login or mobile number, separated by commas)<input value={form.logins} onChange={event=>setForm({...form,logins:event.target.value})} placeholder="Leave blank to send to the MIS managers"/></label>
    {data.recipientCheck?.length>0&&<ul className="automation-people">{data.recipientCheck.map(person=><li key={person.entry} className={person.telegramLinked?'is-ready':'is-waiting'}><b>{person.entry}</b>: {person.note}</li>)}</ul>}
    <p className="automation-note">A mobile number is matched with the mobile number in the person's Users &amp; employees record. Telegram cannot write to a phone number by itself: each person must once press Connect my Telegram on the Telegram Integration page, signed in with their own login.</p>
    <div className="automation-actions"><button type="submit" disabled={busy}>{busy?'Saving…':'Save'}</button><button type="button" onClick={()=>onOpenPage?.('Equipment Deployment')}>Open Equipment Deployment</button><button type="button" onClick={()=>onOpenPage?.('Telegram Integration')}>Open Telegram Integration</button></div>
   </form>}
  </>}
 </section>;
}
