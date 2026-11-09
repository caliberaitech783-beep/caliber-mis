import React,{useEffect,useMemo,useState} from 'react';
import ScanBatchReports from './scan-batch-reports.jsx';
import VlbBatchReport from './vlb-batch-report.jsx';
import VlbBatchCardDetails from './vlb-batch-card-details.jsx';
import SmartSelect from './smart-select.jsx';
import './log-book-form.css';
import './bulk-card-scanning.css';

export const vlbBatchStatus=batch=>batch?.closed_at?'Batch closed':batch?.stage==='elb_open'?'VLB locked · ELB open':'VLB open';
// Open on the newest shift batch that already has saved cards, so the page never starts on an empty report.
export const defaultVlbReportBatch=batches=>(batches.find(batch=>Number(batch.entry_count)>0)||batches[0])?.id||'';

// VLB Reports: every site, date and shift batch with all its saved cards (scanned, uploaded or typed in),
// plus the older scan/upload batch view with the original card images.
export default function VlbBatchReports({session,ReportSection}){
 const [view,setView]=useState('shift'),[notice,setNotice]=useState('');
 const [batches,setBatches]=useState([]),[selected,setSelected]=useState(''),[batch,setBatch]=useState(null),[search,setSearch]=useState(''),[listed,setListed]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const [selectedCard,setSelectedCard]=useState(null);
 const read=async(url,signal)=>{const response=await fetch(url,{signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token}}),data=await response.json();if(!response.ok)throw Error(data.error||'Could not load VLB batch report.');return data};
 useEffect(()=>{
  const controller=new AbortController();setError('');
  read('/api/vlb-batches',controller.signal).then(data=>{if(controller.signal.aborted)return;const rows=data.batches||[];setBatches(rows);setSelected(current=>current||defaultVlbReportBatch(rows));setListed(true)})
   // Users who may only scan cards cannot read shift batches; they keep the scan/upload report they had before.
   .catch(e=>{if(controller.signal.aborted)return;setListed(true);setNotice('Shift batch reports are not available for this login ('+e.message+'). Showing scan / upload batches.');setView('scan')});
  return()=>controller.abort();
 },[session.token,refresh]);
 useEffect(()=>{
  setBatch(null);if(!selected)return;
  const controller=new AbortController();setLoading(true);setError('');
  read('/api/vlb-batches/'+selected,controller.signal).then(data=>{if(!controller.signal.aborted)setBatch(data)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[selected,session.token,refresh]);
 const visible=useMemo(()=>{const term=search.trim().toLowerCase();return term?batches.filter(row=>[row.name,row.site,row.report_date,row.shift,vlbBatchStatus(row)].join(' ').toLowerCase().includes(term)):batches},[batches,search]);
 const tabs=<nav className="scan-workflow-tabs" aria-label="VLB report source"><button type="button" className={view==='shift'?'selected':''} aria-pressed={view==='shift'} onClick={()=>{setNotice('');setView('shift')}}>Shift batches</button><button type="button" className={view==='scan'?'selected':''} aria-pressed={view==='scan'} onClick={()=>setView('scan')}>Scan / upload batches</button></nav>;
 if(view==='scan')return <>{tabs}{notice&&<p role="status">{notice}</p>}<ScanBatchReports kind="vehicle" session={session} ReportSection={ReportSection}/></>;
 const record=batch?.records?.find(row=>row.id===selectedCard?.id);
 // Clicking anywhere on a row opens that card's details, the same as its View VLB button.
 const openCard=row=>setSelectedCard({id:row.id,viewKey:crypto.randomUUID()});
 return <section className="logbook-page scan-page"><header className="logbook-page-header"><div><h1>VLB Reports</h1><p>Every VLB card saved in a site, date and shift batch, whether it was scanned, uploaded or entered by hand. Click a card to see its details.</p></div></header>
  {tabs}
  <section className="logbook-section"><div className="scan-settings"><label>Find batch<input type="search" placeholder="Batch, site, date or shift" value={search} onChange={event=>setSearch(event.target.value)}/></label><label>Shift batch<SmartSelect aria-label="Shift batch" value={selected} onChange={event=>{setSelectedCard(null);setSelected(event.target.value)}}><option value="">Choose a batch</option>{batch&&!visible.some(row=>row.id===batch.id)&&<option value={batch.id}>{batch.name}</option>}{visible.map(row=><option key={row.id} value={row.id}>{row.name} · {row.entry_count||0} VLB · {vlbBatchStatus(row)}</option>)}</SmartSelect></label><button type="button" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>Refresh reports</button></div>
   {loading&&<p role="status">Loading VLB batch report…</p>}{error&&<p className="scan-error" role="alert">{error}</p>}
   {listed&&!batches.length&&!error&&<p>No shift batches yet. A report appears here as soon as a VLB batch is created for a site, date and shift.</p>}
   {batch&&!batch.records?.length&&<p>No VLB card has been saved in this batch yet.</p>}
  </section>
  {batch&&<VlbBatchReport key={batch.id} batch={batch} ReportSection={ReportSection} onView={openCard} onRowClick={openCard}/>}
  {record&&<VlbBatchCardDetails key={selectedCard.viewKey} kind="vehicle" session={session} batch={batch} record={selectedCard} ReportSection={ReportSection} canEdit={false} onClose={()=>setSelectedCard(null)}/>}
 </section>;
}
