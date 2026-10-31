import React,{useEffect,useRef,useState} from 'react';
import {canonicalSiteName} from '../site-location.mjs';
import {displaySiteName} from '../region-scope.mjs';
import {bookShiftCode,systemBookDate} from '../trip-card-rules.mjs';
import {vlbRecordSource} from '../vlb-batch-format.mjs';
import VlbBatchReport from './vlb-batch-report.jsx';
import VlbBatchGovernance from './vlb-batch-governance.jsx';
import './log-book-form.css';
import './vlb-create-batch.css';

export default function VlbCreateBatch({session,onExit,ReportSection,onManual,onScan}){
 const [options,setOptions]=useState(null),[selection,setSelection]=useState({site:'',date:systemBookDate(),shift:''});
 const [preview,setPreview]=useState(null),[batches,setBatches]=useState([]),[openBatch,setOpenBatch]=useState(null),[viewed,setViewed]=useState(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const requestKey=useRef(crypto.randomUUID()),detailRequest=useRef(0),[detailLoading,setDetailLoading]=useState(false);
 const [batchStatusReady,setBatchStatusReady]=useState(false);
 const [actor,setActor]=useState(null);
 const read=async(url,{signal,method='GET',body}={})=>{
  const response=await fetch(url,{method,signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Could not read VLB batches.');return data;
 };
 useEffect(()=>{const controller=new AbortController();
  read('/api/log-books/options',{signal:controller.signal}).then(data=>{
   setOptions(data);const site=data.accountLocation||(data.sites?.length===1?data.sites[0]:'');
   setSelection(current=>({...current,site,shift:''}));
  }).catch(e=>{if(!controller.signal.aborted){setError(e.message);setLoading(false)}});
  return()=>controller.abort();
 },[session.token]);
 useEffect(()=>{const controller=new AbortController();
  read('/api/vlb-batches',{signal:controller.signal}).then(data=>{setBatches(data.batches);setOpenBatch(data.openBatch);setActor(data.actor);setBatchStatusReady(true)}).catch(e=>{if(!controller.signal.aborted){setBatchStatusReady(false);setError(e.message)}});
  return()=>controller.abort();
 },[session.token,refresh]);
 useEffect(()=>{const timer=setInterval(()=>setRefresh(n=>n+1),10000);return()=>clearInterval(timer)},[]);
 useEffect(()=>{if(!viewed?.id)return;const controller=new AbortController();const generation=detailRequest.current;read('/api/vlb-batches/'+viewed.id,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted&&generation===detailRequest.current)setViewed(data)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[viewed?.id,refresh,session.token]);
 useEffect(()=>{const controller=new AbortController();setPreview(null);
  if(!selection.site||!selection.date||!selection.shift){setLoading(false);return()=>controller.abort()}
  setLoading(!viewed);setError('');
  read('/api/vlb-batches/preview?'+new URLSearchParams(selection),{signal:controller.signal}).then(data=>setPreview(data)).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[selection.site,selection.date,selection.shift,session.token,refresh]);
 useEffect(()=>{if(!options||!selection.site)return;
  const shifts=availableShifts(options,selection);
  if(!shifts.some(s=>s.code===selection.shift))setSelection(current=>({...current,shift:shifts[0]?.code||''}));
 },[options,selection.site,selection.date,selection.shift]);
 const change=(key,value)=>{requestKey.current=crypto.randomUUID();setPreview(null);setViewed(null);++detailRequest.current;setDetailLoading(false);setSelection(current=>({...current,[key]:value}));};
 const clearView=()=>{++detailRequest.current;setDetailLoading(false);setViewed(null)};
 const view=async batch=>{const id=++detailRequest.current;setDetailLoading(true);setError('');try{const result=await read('/api/vlb-batches/'+batch.id);if(id===detailRequest.current)setViewed(result)}catch(e){if(id===detailRequest.current)setError(e.message)}finally{if(id===detailRequest.current)setDetailLoading(false)}};
 const create=async()=>{setBusy(true);setError('');try{
  const batch=await read('/api/vlb-batches',{method:'POST',body:{...selection,requestKey:requestKey.current}});
  ++detailRequest.current;setDetailLoading(false);setViewed(batch);requestKey.current=crypto.randomUUID();setOpenBatch(batch.closed_at?null:batch);setRefresh(n=>n+1);
 }catch(e){setError(e.message);setRefresh(n=>n+1)}finally{setBusy(false)}};
 const close=async()=>{if(!openBatch)return;setBusy(true);setError('');try{
  const batch=await read('/api/vlb-batches/'+openBatch.id+'/close',{method:'POST'});
  ++detailRequest.current;setDetailLoading(false);setViewed(batch);setOpenBatch(null);setRefresh(n=>n+1);
 }catch(e){setError(e.message);setRefresh(n=>n+1)}finally{setBusy(false)}};
 const changed=async batch=>{if(batch){setViewed(batch);if(!batch.closed_at)setOpenBatch(batch)}setRefresh(n=>n+1)};
 const records=viewed?.records||preview?.records||[],manual=records.filter(r=>vlbRecordSource(r)==='VLB Manual').length;
 const shifts=options?availableShifts(options,selection):[];
 return <section className="logbook-page vlb-create-batch"><header className="logbook-page-header"><div><h1>Create Batch</h1><p>Combine all saved VLB Manual and VLB Scan cards for one site, date and shift.</p></div><button type="button" onClick={onExit}>Back to VLB</button></header>
  {error&&<p className="logbook-message error" role="alert">{error}</p>}
  {openBatch&&<div className="vlb-batch-notice" role="status"><strong>Open batch: {openBatch.restricted?'Site access changed':openBatch.name}</strong><p>Matching new Manual and Scan cards join this batch automatically. Close it before creating another batch.</p>{openBatch.restricted?<p>Your site assignment has changed. Contact an administrator to restore access before closing this batch.</p>:<div className="vlb-batch-actions"><button type="button" disabled={busy||detailLoading} onClick={()=>view(openBatch)}>View open batch</button>{openBatch.canClose!==false&&<button type="button" disabled={busy} onClick={close}>Close Batch</button>}</div>}</div>}
  <section className="logbook-section vlb-batch-setup"><div className="vlb-batch-fields"><label>Site name<select value={selection.site} disabled={busy||!options} onChange={e=>change('site',e.target.value)}><option value="">Select site</option>{(options?.sites||[]).map(site=><option key={site}>{site}</option>)}</select></label><label>Report date<input type="date" value={selection.date} disabled={busy} onChange={e=>change('date',e.target.value)}/></label><label>Shift<select value={selection.shift} disabled={busy||!selection.site} onChange={e=>change('shift',e.target.value)}><option value="">Select shift</option>{shifts.map(s=><option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}</select></label></div>
   {preview&&<p className="vlb-batch-id">{preview.existingBatch?'Existing batch':'Batch ID preview'}: <strong>{preview.name}</strong></p>}
   {preview?.existingBatch&&<p>A batch already exists for this site/date/shift. <button type="button" disabled={busy||detailLoading} onClick={()=>view(preview.existingBatch)}>Open existing batch</button>{preview.existingBatch.closed_at?' PM approval is required to reopen it.':' New matching saved cards join it automatically.'}</p>}
   <div className="vlb-batch-actions"><button type="button" disabled={busy||loading||detailLoading||!batchStatusReady||actor?.canCreate===false||!preview?.records.length||Boolean(openBatch)||Boolean(preview?.existingBatch)} onClick={create}>Create Batch{preview?' · '+preview.records.length+' cards':''}</button><button type="button" disabled={busy||loading} onClick={()=>{clearView();setRefresh(n=>n+1)}}>Refresh saved entries</button></div>
  </section>
  <section className="logbook-section"><h2>{viewed?viewed.name:'All matching saved entries'}</h2>{viewed&&<p>{viewed.closed_at?'CLOSED':'OPEN'} · {displaySiteName(viewed.site)} · {viewed.report_date} · {viewed.shift} <button type="button" disabled={busy||detailLoading} onClick={clearView}>Show unbatched entries</button></p>}
   {loading||detailLoading?<p role="status">Loading entries…</p>:viewed?<VlbBatchReport key={viewed.id} batch={viewed} ReportSection={ReportSection}/>:<><p>{records.length} cards · {manual} Manual + {records.length-manual} Scan · All included automatically. Each scan entry holds up to 40 cards; this final batch includes all matching saved entries and can exceed 40 cards.</p><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Book number</th><th>Trip card</th><th>Vehicle</th><th>Driver</th><th>Source</th></tr></thead><tbody>{records.map(r=><tr key={r.id}><td>{r.book_no}</td><td>{r.data.aFormNo||'—'}</td><td>{r.data.door||'—'}</td><td>{r.data.employeeName||'—'}</td><td>{vlbRecordSource(r)}</td></tr>)}{!records.length&&<tr><td colSpan={5}>{selection.site&&selection.date&&selection.shift?'No saved, unbatched entries match this selection.':'Select site, date and shift to load saved entries.'}</td></tr>}</tbody></table></div></>}
  </section>
  <section className="logbook-section vlb-batch-list"><h2>Site batches</h2><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Batch ID</th><th>Cards</th><th>Status</th><th/></tr></thead><tbody>{batches.map(b=><tr key={b.id}><td>{b.name}</td><td>{b.entry_count}</td><td>{b.closed_at?'CLOSED':b.amendment_by?'REOPENED':'OPEN'}</td><td><button type="button" disabled={busy||detailLoading} onClick={()=>view(b)}>View batch</button></td></tr>)}{!batches.length&&<tr><td colSpan={4}>No batches created yet.</td></tr>}</tbody></table></div></section>
  <VlbBatchGovernance session={session} batch={viewed} actor={actor} refresh={refresh} onChanged={changed} onManual={onManual} onScan={onScan}/>
 </section>;
}
export function availableShifts(options,selection){
 const found=new Map();
 for(const shift of options.shifts||[]){
  if(canonicalSiteName(shift.site)!==canonicalSiteName(selection.site)||shift.sourceMissing||String(shift.status).toLowerCase()==='inactive'||(shift.effectiveFrom&&shift.effectiveFrom>selection.date)||(shift.effectiveTo&&shift.effectiveTo<selection.date))continue;
  const code=bookShiftCode(shift.shiftCode)||bookShiftCode(shift.name);if(code&&!found.has(code))found.set(code,{code,name:shift.name});
 }
 return [...found.values()];
}
