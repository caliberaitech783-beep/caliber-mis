import React,{useEffect,useState} from 'react';
import ScanBatchReport from './scan-batch-report.jsx';
import SmartSelect from './smart-select.jsx';
import './log-book-form.css';
import './bulk-card-scanning.css';
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||'');
export function initialReportBatch(search){const id=new URLSearchParams(search).get('batch');return uuid(id)?id:'';}
export function reportBatchUrl(href,id){const url=new URL(href);if(id)url.searchParams.set('batch',id);else url.searchParams.delete('batch');for(const key of ['card','filter'])url.searchParams.delete(key);return url.pathname+url.search+url.hash;}

export default function ScanBatchReports({kind,session}){
 const code=kind==='vehicle'?'VLB':'ELB';
 const [batches,setBatches]=useState([]),[selected,setSelected]=useState(()=>initialReportBatch(window.location.search));
 const [batch,setBatch]=useState(null),[cards,setCards]=useState([]),[loading,setLoading]=useState(false),[listed,setListed]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const read=async(url,signal)=>{const response=await fetch(url,{signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token}});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load batch reports.');return data};
 useEffect(()=>{
  const controller=new AbortController();setListed(false);
  read('/api/scan-batches',controller.signal).then(data=>{if(controller.signal.aborted)return;const rows=data.batches.filter(b=>b.kind===kind);setBatches(rows);setSelected(current=>current||rows[0]?.id||'');setListed(true)}).catch(e=>{if(!controller.signal.aborted){setError(e.message);setListed(true)}});
  return()=>controller.abort();
 },[kind,session.token,refresh]);
 useEffect(()=>{
  setBatch(null);setCards([]);setError('');if(!selected){setLoading(false);return;}
  const controller=new AbortController();let inFlight=false;
  const load=async()=>{if(inFlight)return;inFlight=true;try{const data=await read('/api/scan-batches/'+selected,controller.signal);if(controller.signal.aborted)return;if(data.batch.kind!==kind)throw Error('Choose a '+code+' batch to view its report.');setBatch(data.batch);setCards(data.cards);setError('')}catch(e){if(!controller.signal.aborted)setError(e.message)}finally{inFlight=false;if(!controller.signal.aborted)setLoading(false)}};
  setLoading(true);void load();const timer=setInterval(()=>void load(),5000);
  window.history.replaceState(null,'',reportBatchUrl(window.location.href,selected));
  return()=>{controller.abort();clearInterval(timer)};
 },[selected,kind,session.token,refresh]);
 const choose=id=>{setSelected(id);setBatch(null);setCards([]);setError('')};
 return <section className="scan-page logbook-page"><header className="logbook-page-header"><div><h1>{code} Reports</h1><p>Open the report for any of your scan/upload batches. Each report contains only that batch's cards.</p></div></header>
  <section className="logbook-section"><div className="scan-settings"><label>Report batch<SmartSelect aria-label="Report batch" value={selected} onChange={e=>choose(e.target.value)}><option value="">Choose a batch</option>{batch&&!batches.some(b=>b.id===batch.id)&&<option value={batch.id}>{batch.name} · {cards.length} cards</option>}{batches.map(b=><option key={b.id} value={b.id}>{b.name} · {b.cards} cards · {new Date(b.created_at).toLocaleDateString('en-IN')}</option>)}</SmartSelect></label><button type="button" onClick={()=>setRefresh(n=>n+1)} disabled={loading}>Refresh reports</button></div>
   {loading&&<p role="status">Loading batch report…</p>}{error&&<p className="scan-error" role="alert">{error}</p>}
   {listed&&!batches.length&&!selected&&!error&&<p>No scan/upload batches yet. Your batch reports will appear here after you scan or upload cards.</p>}
   {batch&&!cards.length&&<p>This batch has no cards yet. The report will appear as its cards arrive.</p>}
  </section><ScanBatchReport key={batch?.id||'empty'} batch={batch} cards={cards} token={session.token}/>
 </section>;
}
