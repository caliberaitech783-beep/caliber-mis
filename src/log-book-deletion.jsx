import React,{useEffect,useState} from 'react';
import './log-book-deletion.css';

const source=row=>row.data?.scanCardId?'Scanned':'Manual';
const type=row=>row.book_type==='vehicle'?'VLB':'ELB';
const contains=(value,text)=>String(value??'').toLowerCase().includes(text.trim().toLowerCase());
const choices=(rows,value,current)=>[...new Set([...rows.map(value),current].filter(Boolean))].sort();
const label=row=>`${row.book_no} · ID ${row.id} · ${type(row)} · ${source(row)} · ${row.data?.bookDate||''} · ${row.data?.location||row.site||''} · ${row.data?.door||''}`;

export default function LogBookDeletion({session,context}){
 const [rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[history,setHistory]=useState([]),[view,setView]=useState('Entries');
 const [selected,setSelected]=useState(()=>new Set(context?.record?[String(context.record.id)]:[]));
 const [kind,setKind]=useState(context?.kind||''),[origin,setOrigin]=useState(context?.source||''),[search,setSearch]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [columnSelect,setColumnSelect]=useState(''),[columnBook,setColumnBook]=useState(''),[columnDate,setColumnDate]=useState(''),[columnLocation,setColumnLocation]=useState(''),[columnDoor,setColumnDoor]=useState('');
 const [reason,setReason]=useState(''),[preview,setPreview]=useState(null),[approval,setApproval]=useState(''),[otp,setOtp]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const api=async(path,body)=>{const r=await fetch('/api/log-book-deletions/'+path,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||'Deletion service unavailable.');return data;};
 const load=async(before)=>{const result=await api('entries'+(before?'?before='+encodeURIComponent(before):''));if(!before&&context?.record&&!result.records.some(r=>String(r.id)===String(context.record.id))){const target=await api('entries?id='+encodeURIComponent(context.record.id));result.records.push(...target.records);}setRows(current=>before?[...new Map([...current,...result.records].map(r=>[String(r.id),r])).values()]:result.records);setCursor(result.nextCursor);};
 const run=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
 useEffect(()=>{void run(()=>load());},[session.token]);
 const filtered=rows.filter(r=>(!kind||r.book_type===kind)&&(!origin||source(r)===origin)&&(!from||r.data.bookDate>=from)&&(!to||r.data.bookDate<=to)&&label(r).toLowerCase().includes(search.toLowerCase())&&(!columnSelect||selected.has(String(r.id))===(columnSelect==='Selected'))&&contains(`${r.book_no} ${r.id}`,columnBook)&&(!columnDate||r.data.bookDate===columnDate)&&(!columnLocation||r.data.location===columnLocation)&&contains(r.data.door,columnDoor));
 const chosen=rows.filter(r=>selected.has(String(r.id)));
 const toggle=(id,checked)=>setSelected(current=>{const next=new Set(current);checked?next.add(String(id)):next.delete(String(id));return next;});
 const reset=()=>{setPreview(null);setSent(false);setApproval('');setOtp('');setError('');};
 const review=()=>run(async()=>{const p=await api('preview',{records:chosen.map(r=>({id:r.id,revision:r.revision})),reason});setPreview(p);setApproval('');setOtp('');setSent(false);setNotice('');});
 const send=()=>run(async()=>{await api(preview.id+'/otp',{approval});setSent(true);});
 const confirm=()=>run(async()=>{const result=await api(preview.id+'/confirm',{approval,otp});setNotice(`${result.deleted} entries removed from the active register. Audit reference: ${result.requestId}.`);reset();setSelected(new Set());setReason('');await load();});
 return <section className="logbook-deletion">
  <header><div><small>PULSE-II / MIS</small><h1>Deletion</h1><p>Bulk deletion for scanned and manually entered VLB and ELB records.</p></div><button disabled={busy||!!preview} onClick={()=>run(async()=>{setSelected(new Set());await load();})}>Refresh entries</button></header>
  <p>Every deletion requires approval of the exact selection and a WhatsApp OTP sent to <strong>+91 9925565281</strong>. Records leave the active register and reports; source scans and recovery snapshots are retained.</p>
  {error&&<p role="alert" className="deletion-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!preview&&<>
   <nav aria-label="Deletion views">{['Entries','History'].map(tab=><button key={tab} disabled={busy} aria-pressed={view===tab} onClick={()=>{setView(tab);if(tab==='History')void run(async()=>setHistory((await api('history')).records));}}>{tab}</button>)}</nav>
   {view==='Entries'?<>
    <fieldset disabled={busy}><legend>Find entries</legend><div className="deletion-filters">
     <label>Type<select value={kind} onChange={e=>setKind(e.target.value)}><option value="">All VLB / ELB</option><option value="vehicle">VLB</option><option value="equipment">ELB</option></select></label>
     <label>Entry source<select value={origin} onChange={e=>setOrigin(e.target.value)}><option value="">All sources</option><option>Scanned</option><option>Manual</option></select></label>
     <label>Search<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Book number, ID, location or door"/></label>
     <label>From date<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To date<input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)}/></label>
    </div></fieldset>
    <div className="deletion-actions"><button disabled={busy||!filtered.length} onClick={()=>setSelected(current=>new Set([...current,...filtered.map(r=>String(r.id))]))}>Select all displayed ({filtered.length})</button><button disabled={busy||!selected.size} onClick={()=>setSelected(new Set())}>Clear selection</button><span>{chosen.length} selected across filters · {rows.length} loaded{cursor?' · More entries available':''}</span></div>
    <div className="deletion-scroll"><table><thead><tr><th>Select</th><th>Book number / ID</th><th>Type</th><th>Source</th><th>Date</th><th>Location</th><th>Door</th></tr><tr className="deletion-column-filters"><th><select aria-label="Filter by selection" disabled={busy} value={columnSelect} onChange={e=>setColumnSelect(e.target.value)}><option value="">All</option><option>Selected</option><option>Not selected</option></select></th><th><input type="search" aria-label="Filter by book number or ID" disabled={busy} placeholder="Filter" value={columnBook} onChange={e=>setColumnBook(e.target.value)}/></th><th><select aria-label="Filter by type" disabled={busy} value={kind} onChange={e=>setKind(e.target.value)}><option value="">All</option><option value="vehicle">VLB</option><option value="equipment">ELB</option></select></th><th><select aria-label="Filter by source" disabled={busy} value={origin} onChange={e=>setOrigin(e.target.value)}><option value="">All</option><option>Scanned</option><option>Manual</option></select></th><th><select aria-label="Filter by date" disabled={busy} value={columnDate} onChange={e=>setColumnDate(e.target.value)}><option value="">All</option>{choices(rows,r=>r.data.bookDate,columnDate).map(v=><option key={v}>{v}</option>)}</select></th><th><select aria-label="Filter by location" disabled={busy} value={columnLocation} onChange={e=>setColumnLocation(e.target.value)}><option value="">All</option>{choices(rows,r=>r.data.location,columnLocation).map(v=><option key={v}>{v}</option>)}</select></th><th><input type="search" aria-label="Filter by door" disabled={busy} placeholder="Filter" value={columnDoor} onChange={e=>setColumnDoor(e.target.value)}/></th></tr></thead><tbody>{filtered.map(row=><tr key={row.id}><td><input type="checkbox" aria-label={`Select ${row.book_no}`} checked={selected.has(String(row.id))} disabled={busy} onChange={e=>toggle(row.id,e.target.checked)}/></td><td>{row.book_no}<small>ID {row.id}</small></td><td>{type(row)}</td><td>{source(row)}</td><td>{row.data.bookDate}</td><td>{row.data.location}</td><td>{row.data.door}</td></tr>)}</tbody></table></div>
    {!filtered.length&&!busy&&<p>No matching entries.</p>}{cursor&&<button disabled={busy} onClick={()=>run(()=>load(cursor))}>Load more entries</button>}
    <label>Reason for deletion<textarea maxLength={2000} rows={3} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
    <button disabled={busy||!chosen.length||chosen.length>500||!reason.trim()} onClick={review}>Preview deletion ({chosen.length})</button><small>Up to 500 records per approved request.</small>
   </>:<><p>Latest 100 completed deletions. Recovery requires an administrator using the retained database records and snapshots.</p>{history.map(h=><details key={h.id}><summary>{new Date(h.completed_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} · {h.snapshot.length} entries · {h.actor}</summary><p>Request: {h.id}</p><p>Reason: {h.reason}</p><p>Approved: {h.approved_at} · WhatsApp accepted: {h.delivered_at} · OTP verified at completion.</p><ul>{h.snapshot.map(r=><li key={r.id}>{label(r)}</li>)}</ul></details>)}</>}
  </>}
  {preview&&<section className="deletion-review" aria-label="Exact deletion approval">
   <h2>Review {preview.records.length} exact records</h2><p>Request: {preview.id}</p><p><strong>Reason:</strong> {preview.reason}</p><p><strong>Impact and recovery:</strong> {preview.impact}</p>
   <ul>{preview.records.map(row=><li key={row.id}>{label(row)} · Revision {row.revision}</li>)}</ul>
   <p>Approval applies only to these IDs and revisions. This request expires within {preview.expiresInMinutes} minutes. Changes require a fresh preview and approval.</p>
   <label>Type this exact approval phrase:<code>{preview.approval}</code><input value={approval} disabled={busy||sent} onChange={e=>setApproval(e.target.value)} autoComplete="off"/></label>
   {!sent?<button disabled={busy||approval!==preview.approval} onClick={send}>Approve selection and send WhatsApp OTP</button>:<><p>OTP sent to {preview.recipient}. Enter it to complete this approved deletion.</p><label>WhatsApp OTP<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} disabled={busy} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))}/></label><button className="deletion-danger" disabled={busy||otp.length!==6} onClick={confirm}>Verify OTP and delete {preview.records.length} entries</button></>}
   <button disabled={busy} onClick={reset}>Cancel / change selection</button>
  </section>}
  {busy&&<p role="status">Working…</p>}
 </section>;
}
