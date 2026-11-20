import React,{useEffect,useState} from 'react';
import TableSmartPrint from './table-smart-print.jsx';
import {SortableHeader,sortRowsBlanksLast} from './sortable-table.jsx';

// Every heading sorts the list: BD cases as a number, the scheduled, attempt and accepted times by date and time.
const deliveryColumns=[['scheduled','Scheduled (IST)'],['oem','OEM / Level'],['email','Recipient'],['cases','BD cases'],['status','Status'],['files','PDF / Excel'],['attempt','Last attempt (IST)'],['accepted','Accepted (IST)'],['messageId','Message ID'],['acknowledgement','Acknowledgement'],['error','Error / Retry']];
const scheduledSlot=row=>{const key=String(row.recipient_key||'');return key.includes(':test-1100')?'11:00':key.includes(':test-1300')?'13:00':key.includes(':extra-1900')?'19:00':'17:00';};
const timeValue=value=>{const time=Date.parse(value||'');return Number.isNaN(time)?'':time;};
function deliveryValue(row={},key){
  if(key==='scheduled')return row.day?row.day+' '+scheduledSlot(row):'';
  if(key==='oem')return [row.oem,row.level].filter(Boolean).join(' / ');
  if(key==='email')return row.email||'';
  if(key==='cases'){const count=Number(row.case_count);return row.case_count===null||row.case_count===undefined||row.case_count===''||!Number.isFinite(count)?'':count;}
  if(key==='status')return row.status||'';
  if(key==='files')return (row.attachments||[]).map(file=>file.filename).join(', ');
  if(key==='attempt')return timeValue(row.last_attempt_at);
  if(key==='accepted')return timeValue(row.sent_at);
  if(key==='messageId')return row.message_id||'';
  if(key==='acknowledgement')return row.acknowledgement_status||'';
  if(key==='error')return row.error||'';
  return '';
}

// What a cell shows and what its column filter lists: the same words as the plain table below.
const slotLabel=row=>{const key=String(row.recipient_key||'');return key.includes(':test-1300')?'1:00 PM':key.includes(':test-1100')?'11:00 AM':key.includes(':extra-1900')?'7:00 PM':'5:00 PM';};
function deliveryText(row,key,time){
  if(key==='scheduled')return row.day+' '+slotLabel(row);
  if(key==='oem')return row.oem+' / '+row.level;
  if(key==='cases')return row.case_count;
  if(key==='files')return row.attachments?.length?row.attachments.map(file=>file.filename+' ('+file.bytes+' bytes)').join(', '):'Not recorded for this attempt';
  if(key==='attempt')return time(row.last_attempt_at);
  if(key==='accepted')return time(row.sent_at);
  if(key==='messageId')return row.message_id||'Not recorded';
  if(key==='acknowledgement')return row.acknowledgement_status||'Not recorded / not requested';
  if(key==='error')return row.error||'—';
  return deliveryValue(row,key);
}
function deliveryCell(row,key,{time,busy,retry}){
  if(key==='files')return row.attachments?.length?row.attachments.map(file=><div key={file.filename}>{file.filename} ({file.bytes} bytes)</div>):'Not recorded for this attempt';
  return <>{row.error||'—'}{row.retry_safe&&row.status==='Failed / review required'&&!row.message_id?<button data-print-hide="" disabled={busy} onClick={()=>retry(row)}>Retry failed email</button>:row.status==='Failed / review required'?<p>Manual review required; retry blocked to prevent duplicates.</p>:null}
    {!!row.attempts?.length&&<details><summary>Retry history</summary>{row.attempts.map((attempt,index)=><p key={index}>{time(attempt.at)} · {attempt.actor} · {attempt.reason} · Previous: {attempt.previousError}</p>)}</details>}</>;
}
export default function OemEmailDeliveryStatus({session,ReportSection}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
  const [sort,setSort]=useState({key:'',direction:'asc'});const changeSort=key=>setSort(current=>({key,direction:current.key===key&&current.direction==='asc'?'desc':'asc'}));
  const headers={Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'};
  const load=async()=>{
    try{const response=await fetch('/api/oem-email-deliveries',{headers,cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not load delivery status.');setData(result);setError('');}
    catch(e){setError(e.message);}
  };
  useEffect(()=>{void load();},[session.token]);
  const action=async(path,body)=>{
    setBusy(true);setNotice('');setError('');
    try{const response=await fetch(`/api/oem-email-deliveries/${path}`,{method:'POST',headers,body:JSON.stringify(body||{})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Operation failed.');await load();setNotice(result.message);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const retry=row=>{
    const reason=window.prompt(`Retry only this failed email to ${row.email}? The report will use current active BD cases. Enter a reason:`);
    if(!reason?.trim())return;
    void action('retry',{day:row.day,recipientKey:row.recipient_key,reason:reason.trim()});
  };
  const time=value=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Not recorded';
  const rows=(data?.deliveries||[]).filter(row=>[row.oem,row.email,row.status,row.day,row.level].some(value=>String(value||'').toLowerCase().includes(query.toLowerCase())));
  return <section className="panel pagepanel">
    <header><h1>OEM Email Delivery Status</h1><div><button disabled={busy} onClick={()=>load()}>Refresh</button> <button disabled={busy} onClick={()=>action('check')}>Check email connection</button></div></header>
    <p>SMTP accepted means the mail server accepted the email—not proof of inbox delivery or that the OEM read it.</p>
    {data&&<p>Sender: {data.sender} · Scheduler: {data.schedulerEnabled?'Enabled':'Disabled'} · Credentials: {data.configured?'Configured (not verified)':'Missing'}<br/>{data.schedule}<br/>{data.note}</p>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <input type="search" aria-label="Search OEM email deliveries" placeholder="Search OEM, recipient, date or status" value={query} onChange={event=>setQuery(event.target.value)}/>
    {/* With the shared report table (the MIS page) the list has the VLB look: a filter and sort menu on every heading,
        Rows, Actions and Smart Print. The search box above still narrows it first. */}
    {ReportSection?<ReportSection title={'OEM Email Delivery Status'+(query.trim()?' · '+query.trim():'')} category="oem-email-deliveries" description={rows.length+' recorded attempt'+(rows.length===1?'':'s')} showSearch={false} recordDateFilter={false} smartPrintAction
      columns={deliveryColumns.map(([key,label])=>({key,label,blanksLast:true,duration:false,value:row=>deliveryText(row,key,time),sortValue:row=>deliveryValue(row,key),render:key==='files'||key==='error'?row=>deliveryCell(row,key,{time,busy,retry}):undefined}))}
      rows={rows} rowKey={row=>row.day+':'+row.recipient_key} emptyMessage={data?'No recorded attempts match this view.':'Loading…'}/>:<>
    {rows.length>0&&<TableSmartPrint row title={'OEM Email Delivery Status'+(query.trim()?' · '+query.trim():'')}/>}
    <div style={{overflowX:'auto',marginTop:16}}><table><thead><tr>{deliveryColumns.map(([key,label])=><SortableHeader key={key} label={label} sortKey={key} sort={sort} onSort={changeSort} filterIcon={false}/>)}</tr></thead>
      <tbody>{sortRowsBlanksLast(rows,sort,deliveryValue).map(row=><tr key={`${row.day}:${row.recipient_key}`}>
        <td>{row.day} {row.recipient_key.includes(':test-1300')?'1:00 PM':row.recipient_key.includes(':test-1100')?'11:00 AM':row.recipient_key.includes(':extra-1900')?'7:00 PM':'5:00 PM'}</td>
        <td>{row.oem} / {row.level}</td><td>{row.email}</td><td>{row.case_count}</td><td>{row.status}</td>
        <td>{row.attachments?.length?row.attachments.map(file=><div key={file.filename}>{file.filename} ({file.bytes} bytes)</div>):'Not recorded for this attempt'}</td>
        <td>{time(row.last_attempt_at)}</td><td>{time(row.sent_at)}</td><td>{row.message_id||'Not recorded'}</td><td>{row.acknowledgement_status||'Not recorded / not requested'}</td>
        <td>{row.error||'—'}{row.retry_safe&&row.status==='Failed / review required'&&!row.message_id?<button data-print-hide="" disabled={busy} onClick={()=>retry(row)}>Retry failed email</button>:row.status==='Failed / review required'?<p>Manual review required; retry blocked to prevent duplicates.</p>:null}
          {!!row.attempts?.length&&<details><summary>Retry history</summary>{row.attempts.map((attempt,index)=><p key={index}>{time(attempt.at)} · {attempt.actor} · {attempt.reason} · Previous: {attempt.previousError}</p>)}</details>}
        </td></tr>)}{!rows.length&&<tr><td colSpan={11}>{data?'No recorded attempts match this view.':'Loading…'}</td></tr>}</tbody></table></div>
    </>}
  </section>;
}
