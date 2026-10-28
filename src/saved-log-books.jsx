import React,{useEffect,useRef,useState} from 'react';
import {LogBookSectionTabs} from './log-book-mode-choice.jsx';
import './log-book-form.css';
import './saved-log-books.css';

export function savedLogBookQuery({search='',location='',from='',to=''},before=''){
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries({search,location,from,to,before}))if(value)query.set(key,value);
  return query.size?'?'+query:'';
}
const display=value=>value===null||value===undefined||value===''?'—':String(value);
const bookDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('-'):display(value);

export function SavedLogBookDetails({record,kind,imageUrl='',imageError=''}){
  const data=record.data||{},vehicle=kind==='vehicle';
  const fields=[['Book number',record.book_no],['Book date',bookDate(data.bookDate)],['Location',data.location],
    [vehicle?'Door number':'Equipment / Door number',data.door],['Equipment name',data.assetName],['Employee ID / Caliber ID',data.caliberId],
    [vehicle?'Driver':'Operator',data.employeeName],['Work order / Contract',data.workOrderContract],['Shift hours',data.shiftHours],['Shift',data.shiftName],
    [vehicle?'A Form / Trip Card number':'Job Card number',vehicle?data.aFormNo:data.jobCardNo],
    ...(vehicle?[['Opening KMR',data.openingKmr],['Closing KMR',data.closingKmr],['Total running KMR',data.totalRunningKmr]]:[]),
    ['Opening HMR',data.openingHmr],['Closing HMR',data.closingHmr],['Total working HMR',data.totalWorkingHmr],
    ...(vehicle?[['Opening trips',data.openingTrips],['Ending trips',data.endingTrips],['Completed trips',data.completedTrips??data.totalTrips]]:[]),['Availability hours',data.availabilityHours],['Running hours',data.runningHours],['Breakdown hours',data.breakdownHours],['BD hours source',data.breakdownHoursSource||(data.hoursSource?.source==='manual'?'manual':data.breakdownHours==null?'Unavailable':'Pulse')],['Idle hours',data.idleHours],
    ['Remark',data.remark]];
  return <div id="saved-logbook-details" className="saved-logbook-review"><section className="logbook-section"><h2>Saved {vehicle?'VLB':'ELB'} values</h2>
    <dl className="saved-logbook-values">{fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>)}</dl>
    {vehicle&&<><h3>Individual trips</h3><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Row</th><th>Equipment</th>{data.timeMode!=='without'&&<><th>Loading time</th><th>Unloading time</th></>}<th>Trips</th><th>Handover</th></tr></thead><tbody>{(data.trips||[]).map((trip,index)=><tr key={index}><td>{index+1}</td><td>{display(trip.equipmentName)}</td>{data.timeMode!=='without'&&<><td>{display(trip.loadingTime)}</td><td>{display(trip.unloadingTime)}</td></>}<td>{display(trip.tripCount)}</td><td>{display(trip.tripStatus)}{trip.handoverLinks?.map((link,i)=><div key={i}>{link.role==='loading'?'Unloaded by':'Loaded by'} {link.counterpart.driverName} · {link.counterpart.bookNo} · {link.counterpart.date} · {link.loadingTime} → {link.unloadingTime}</div>)}</td></tr>)}</tbody></table></div>
      {(data.machineSummary||[]).length>0&&<><h3>Machine-wise summary</h3><table className="logbook-table"><thead><tr><th>Equipment</th><th>Trips</th></tr></thead><tbody>{data.machineSummary.map((row,index)=><tr key={index}><td>{display(row.equipmentName)}</td><td>{display(row.tripCount)}</td></tr>)}</tbody></table></>}
    </>}
  </section><section className="logbook-section"><h2>Original scan</h2>{!data.scanCardId?<p>This entry was saved without a source scan.</p>:imageUrl?<><a href={imageUrl} target="_blank" rel="noreferrer">Open full-size scan</a><img className="saved-logbook-image" src={imageUrl} alt={'Original scan for '+record.book_no}/></>:imageError?<p role="alert">{imageError}</p>:<p role="status">Loading source scan…</p>}</section></div>;
}

export default function SavedLogBooks({kind,session,onManual,onScan,onExit,canScan=true}){
  const vehicle=kind==='vehicle',code=vehicle?'VLB':'ELB';
  const [filters,setFilters]=useState({search:'',location:'',from:'',to:''}),[sites,setSites]=useState([]),[records,setRecords]=useState([]),[cursor,setCursor]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(null),[imageUrl,setImageUrl]=useState(''),[imageError,setImageError]=useState(''),[refresh,setRefresh]=useState(0),[imageFor,setImageFor]=useState(null);
  const requestId=useRef(0);
  const read=async(url,signal)=>{
    const response=await fetch(url,{signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token}});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Could not read saved log books.');return data;
  };
  useEffect(()=>{const controller=new AbortController();read('/api/log-books/options',controller.signal).then(data=>setSites(data.sites||[])).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[kind,session.token]);
  const load=async(before='',signal)=>{
    const id=++requestId.current;setLoading(true);setError('');
    try{const data=await read('/api/log-books/'+kind+savedLogBookQuery(filters,before),signal);if(id===requestId.current&&!signal?.aborted){setRecords(current=>before?[...current,...data.records]:data.records);setCursor(data.nextCursor)}}catch(e){if(id===requestId.current&&!signal?.aborted)setError(e.message)}finally{if(id===requestId.current&&!signal?.aborted)setLoading(false)}
  };
  useEffect(()=>{
    ++requestId.current;setRecords([]);setCursor(null);setSelected(null);setLoading(false);
    if(filters.from&&filters.to&&filters.from>filters.to){setError('Start date must be on or before end date.');return;}
    const controller=new AbortController(),timer=setTimeout(()=>void load('',controller.signal),250);
    return()=>{clearTimeout(timer);controller.abort();++requestId.current};
  },[kind,session.token,filters.search,filters.location,filters.from,filters.to,refresh]);
  useEffect(()=>{
    setImageUrl('');setImageError('');setImageFor(null);if(!selected?.data.scanCardId)return;
    const controller=new AbortController();let url;
    (async()=>{try{const response=await fetch('/api/log-books/'+kind+'/'+selected.id+'/source-image',{signal:controller.signal,headers:{Authorization:'Bearer '+session.token}});if(!response.ok)throw Error('The original scan is unavailable for this saved entry.');const blob=await response.blob();if(!controller.signal.aborted){url=URL.createObjectURL(blob);setImageFor(selected.id);setImageUrl(url)}}catch(e){if(!controller.signal.aborted){setImageFor(selected.id);setImageError(e.message)}}})();
    return()=>{controller.abort();if(url)URL.revokeObjectURL(url)};
  },[kind,session.token,selected?.id]);
  useEffect(()=>{if(selected)document.getElementById('saved-logbook-details')?.scrollIntoView({behavior:'smooth',block:'start'})},[selected?.id]);
  const change=(key,value)=>setFilters(current=>({...current,[key]:value}));
  return <section className="logbook-page saved-logbooks"><header className="logbook-page-header"><div><h1>Saved {code}</h1><p>Check saved log books and their original scans.</p></div><button type="button" onClick={onExit}>Back to {code}</button></header>
    <LogBookSectionTabs kind={kind} active="saved" onManual={onManual} onScan={onScan} canScan={canScan}/>
    <section className="logbook-section"><div className="saved-logbook-filters"><label>Search<input type="search" aria-label={'Search saved '+code} value={filters.search} onChange={e=>change('search',e.target.value)} placeholder="Book, door, employee or card number"/></label><label>Location<select value={filters.location} onChange={e=>change('location',e.target.value)}><option value="">All assigned locations</option>{sites.map(site=><option key={site}>{site}</option>)}</select></label><label>From date<input type="date" value={filters.from} onChange={e=>change('from',e.target.value)}/></label><label>To date<input type="date" value={filters.to} onChange={e=>change('to',e.target.value)}/></label><button type="button" onClick={()=>setRefresh(n=>n+1)} disabled={loading}>Refresh</button></div>
      {error&&<p role="alert" className="logbook-message error">{error}</p>}{loading&&<p role="status">Loading saved {code}…</p>}
      <div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Book number</th><th>Date</th><th>Location</th><th>{vehicle?'Door':'Equipment'}</th><th>Employee ID</th><th>{vehicle?'Driver':'Operator'}</th><th/></tr></thead><tbody>{records.map(record=><tr key={record.id} aria-selected={String(selected?.id)===String(record.id)}><td>{record.book_no}</td><td>{bookDate(record.data.bookDate)}</td><td>{display(record.data.location)}</td><td>{display(record.data.door)}</td><td>{display(record.data.caliberId)}</td><td>{display(record.data.employeeName)}</td><td><button type="button" onClick={()=>setSelected(record)}>View {code}</button></td></tr>)}{!records.length&&!loading&&<tr><td colSpan={7}>No saved {code} entries match these filters.</td></tr>}</tbody></table></div>{cursor&&<button type="button" disabled={loading} onClick={()=>void load(cursor)}>Load more saved {code}</button>}
    </section>{selected&&<SavedLogBookDetails key={selected.id} record={selected} kind={kind} imageUrl={String(imageFor)===String(selected.id)?imageUrl:''} imageError={String(imageFor)===String(selected.id)?imageError:''}/>}
  </section>;
}
