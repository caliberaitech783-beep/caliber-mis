import SmartSelect from './smart-select.jsx';
import PulseTripVerification from './pulse-trip-verification.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import './log-book-form.css';
import './saved-log-books.css';

export function savedLogBookQuery({search='',location='',from='',to=''},before=''){
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries({search,location,from,to,before}))if(value)query.set(key,value);
  return query.size?'?'+query:'';
}
const display=value=>value===null||value===undefined||value===''?'—':String(value);
const bookDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('-'):display(value);

const reportColumns=[['Date','bookDate'],['Book number','book_no'],['Location','location'],['Door','door'],['Driver','employeeName'],['Running KM','totalRunningKmr'],['Working Hrs','totalWorkingHmr'],['Trips','completedTrips'],['Available Hrs','availabilityHours'],['Running Hrs','runningHours'],['BD Hrs','breakdownHours'],['Idle Hrs','idleHours']];
export function reportNumber(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
export function reportTotals(records){return Object.fromEntries(reportColumns.slice(5).map(([,key])=>{const numbers=records.map(r=>reportNumber(key==='completedTrips'?r.data?.completedTrips??r.data?.totalTrips:r.data?.[key])).filter(n=>n!==null);return [key,numbers.length?Math.round(numbers.reduce((a,b)=>a+b,0)*100)/100:null]}))}
function Signatures(){return <div className="signatures"><span>Driver / Operator</span><span>Checked by</span><span>Approved by</span></div>}
export function SavedLogBookReport({records,filters,kind}){
  const vehicle=kind==='vehicle',totals=reportTotals(records),columns=reportColumns.filter(([,key])=>vehicle||!['totalRunningKmr','completedTrips'].includes(key));
  const value=(r,key)=>key==='book_no'?r.book_no:key==='bookDate'?bookDate(r.data?.bookDate):key==='completedTrips'?r.data?.completedTrips??r.data?.totalTrips:r.data?.[key];
  return <><h1>CALIBER PULSE-II</h1><h2>{vehicle?'Vehicle':'Equipment'} Log Book Report</h2><p>Period: {filters.from?bookDate(filters.from):'All dates'} to {filters.to?bookDate(filters.to):'Present'} · Location: {filters.location||'All assigned locations'}</p>{filters.search&&<p>Search: {filters.search}</p>}<p><strong>{records.length} saved log books</strong> · Missing values: —. Totals include available numeric values only.</p><table><thead><tr><th>No.</th>{columns.map(([label,key])=><th key={key}>{!vehicle&&key==='employeeName'?'Operator':label}</th>)}</tr></thead><tbody>{records.map((r,i)=><tr key={r.id}><td>{i+1}</td>{columns.map(([,key])=><td key={key}>{display(value(r,key))}</td>)}</tr>)}<tr className="totals"><td colSpan={6}>TOTAL — {records.length} books</td>{columns.slice(5).map(([,key])=><td key={key}>{display(totals[key])}</td>)}</tr></tbody></table><Signatures/></>;
}
export function printDocument(content,landscape=false){return '<!doctype html><html><head><meta charset="utf-8"><title>Caliber Pulse-II Log Book Report</title><style>'+`
@page{size:A4 ${landscape?'landscape':'portrait'};margin:12mm}*{box-sizing:border-box}body{margin:0;background:white;color:#172033;font:11px Arial,sans-serif;line-height:1.4}h1{font-size:20px;margin:0;color:#542c83}h2{font-size:15px;margin:5px 0 12px}h3{font-size:12px;margin:16px 0 6px}p{margin:6px 0}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:${landscape?'9':'10'}px}th,td{border:1px solid #b8bec9;padding:6px 4px;text-align:left;overflow-wrap:anywhere;vertical-align:top}th,.totals{background:#eee8f5;font-weight:bold}thead{display:table-header-group}tr{break-inside:avoid}h2,h3{break-after:avoid}.saved-logbook-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid #ccd0d8;border-left:1px solid #ccd0d8;gap:0}.saved-logbook-values>div{padding:7px;border-right:1px solid #ccd0d8;border-bottom:1px solid #ccd0d8;break-inside:avoid}dt{font-size:9px;color:#596277}dd{margin:3px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-weight:bold}.saved-logbook-review>section+section{display:none}.signatures{display:flex;justify-content:space-between;gap:20px;margin-top:40px;break-inside:avoid}.signatures span{border-top:1px solid #6b7280;padding-top:7px;min-width:25%;text-align:center}
`+'</style></head><body>'+content+'</body></html>'}

export function SavedLogBookDetails({record,kind,imageUrl='',imageError='',ReportSection}){
  const data=record.data||{},vehicle=kind==='vehicle';
  const fields=[['Book number',record.book_no],['Book date',bookDate(data.bookDate)],['Location',data.location],
    [vehicle?'Door number':'Equipment / Door number',data.door],['Equipment name',data.assetName],['Employee ID / Caliber ID',data.caliberId],
    [vehicle?'Driver':'Operator',data.employeeName],['Work order / Contract',data.workOrderContract],['Shift hours',data.shiftHours],['Shift',data.shiftName],
    [vehicle?'A Form / Trip Card number':'Job Card number',vehicle?data.aFormNo:data.jobCardNo],
    ...(vehicle?[['Opening KMR',data.openingKmr],['Closing KMR',data.closingKmr],['Total running KMR',data.totalRunningKmr]]:[]),
    ['Opening HMR',data.openingHmr],['Closing HMR',data.closingHmr],['Total working HMR',data.totalWorkingHmr],
    ...(vehicle?[['Opening trips',data.openingTrips],['Ending trips',data.endingTrips],['Completed trips',data.completedTrips??data.totalTrips]]:[]),['Availability hours',data.availabilityHours],['Running hours',data.runningHours],['Breakdown hours',data.breakdownHours],['BD hours source',data.breakdownHoursSource||(data.hoursSource?.source==='manual'?'manual':data.breakdownHours==null?'Unavailable':'Pulse')],['Idle hours',data.idleHours],
    ['Remark',data.remark]];
  const reportTitle=(vehicle?'VLB':'ELB')+' report · '+record.book_no;
  const reportDescription=[bookDate(data.bookDate),data.location,data.door].filter(Boolean).join(' · ');
  const reportRows=fields.map(([field,value])=>({field,value:display(value)}));
  const tripColumns=[{key:'row',label:'Row',value:row=>row.row},{key:'equipmentName',label:'Equipment',value:row=>display(row.equipmentName)},
    ...(data.timeMode!=='without'?[{key:'loadingTime',label:'Loading time',value:row=>display(row.loadingTime)},{key:'unloadingTime',label:'Unloading time',value:row=>display(row.unloadingTime)}]:[]),
    {key:'tripCount',label:'Trips',value:row=>display(row.tripCount)},{key:'handover',label:'Handover',value:row=>[display(row.tripStatus),...(row.handoverLinks||[]).map(link=>(link.role==='loading'?'Unloaded by':'Loaded by')+' '+link.counterpart.driverName+' · '+link.counterpart.bookNo+' · '+link.counterpart.date+' · '+link.loadingTime+' → '+link.unloadingTime)].join('\n')}];
  return <><div id="saved-logbook-details" className="saved-logbook-review"><section className="logbook-section"><h2>Saved {vehicle?'VLB':'ELB'} values</h2>
    <dl className="saved-logbook-values">{fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>)}</dl>
    {vehicle&&<><h3>Individual trips</h3><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Row</th><th>Equipment</th>{data.timeMode!=='without'&&<><th>Loading time</th><th>Unloading time</th></>}<th>Trips</th><th>Handover</th></tr></thead><tbody>{(data.trips||[]).map((trip,index)=><tr key={index}><td>{index+1}</td><td>{display(trip.equipmentName)}</td>{data.timeMode!=='without'&&<><td>{display(trip.loadingTime)}</td><td>{display(trip.unloadingTime)}</td></>}<td>{display(trip.tripCount)}</td><td>{display(trip.tripStatus)}{trip.handoverLinks?.map((link,i)=><div key={i}>{link.role==='loading'?'Unloaded by':'Loaded by'} {link.counterpart.driverName} · {link.counterpart.bookNo} · {link.counterpart.date} · {link.loadingTime} → {link.unloadingTime}</div>)}</td></tr>)}</tbody></table></div>
      {(data.machineSummary||[]).length>0&&<><h3>Machine-wise summary</h3><table className="logbook-table"><thead><tr><th>Equipment</th><th>Trips</th></tr></thead><tbody>{data.machineSummary.map((row,index)=><tr key={index}><td>{display(row.equipmentName)}</td><td>{display(row.tripCount)}</td></tr>)}</tbody></table></>}
    </>}
  </section><section className="logbook-section"><h2>Original scan</h2>{!data.scanCardId?<p>This entry was saved without a source scan.</p>:imageUrl?<><a href={imageUrl} target="_blank" rel="noreferrer">Open full-size scan</a><img className="saved-logbook-image" src={imageUrl} alt={'Original scan for '+record.book_no}/></>:imageError?<p role="alert">{imageError}</p>:<p role="status">Loading source scan…</p>}</section></div>
  {ReportSection&&<section className="saved-logbook-reports" aria-label={reportTitle}><h2>Report</h2>
    <ReportSection title={reportTitle} description={reportDescription} category="saved-logbook" smartPrintAction exportLabel="Print / Export" columns={[{key:'field',label:'Field',value:row=>row.field},{key:'value',label:'Saved value',value:row=>row.value}]} rows={reportRows}/>
    {vehicle&&<ReportSection title={'Individual trips · '+record.book_no} description={reportDescription} category="saved-logbook-trips" smartPrintAction exportLabel="Print / Export" columns={tripColumns} rows={(data.trips||[]).map((trip,index)=>({...trip,row:index+1}))} emptyMessage="No individual trips saved for this log book."/>}
    {vehicle&&data.machineSummary?.length>0&&<ReportSection title={'Machine-wise summary · '+record.book_no} description={reportDescription} category="saved-logbook-machines" smartPrintAction exportLabel="Print / Export" columns={[{key:'equipmentName',label:'Equipment',value:row=>display(row.equipmentName)},{key:'tripCount',label:'Trips',value:row=>display(row.tripCount)}]} rows={data.machineSummary}/>}
  </section>}</>;
}

export default function SavedLogBooks({kind,session,onManual,onScan,onExit,canScan=true,ReportSection}){
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
  const [printPreview,setPrintPreview]=useState(''),[reportBusy,setReportBusy]=useState(false);
  const printFrame=useRef(null);
  const previewBook=()=>setPrintPreview(printDocument(renderToStaticMarkup(<><h1>CALIBER PULSE-II</h1><p>{code} · {selected.book_no}</p><SavedLogBookDetails record={selected} kind={kind}/><Signatures/></>)));
  const previewReport=async()=>{
    setReportBusy(true);setError('');const snapshot={...filters},seen=new Set(),all=[];
    try{let before='';do{const page=await read('/api/log-books/'+kind+savedLogBookQuery(snapshot,before));if(!Array.isArray(page.records))throw Error('The report response is incomplete. Please retry.');all.push(...page.records);before=page.nextCursor;if(before&&seen.has(String(before)))throw Error('Report pagination could not complete. Please retry.');if(before)seen.add(String(before))}while(before);
      const unique=[...new Map(all.map(r=>[String(r.id),r])).values()];if(!unique.length)throw Error('No saved '+code+' entries match these filters.');setPrintPreview(printDocument(renderToStaticMarkup(<SavedLogBookReport records={unique} filters={snapshot} kind={kind}/>),true));
    }catch(e){setError(e.message)}finally{setReportBusy(false)}
  };
  const change=(key,value)=>setFilters(current=>({...current,[key]:value}));
  return <section className="logbook-page saved-logbooks"><header className="logbook-page-header"><div><h1>Saved {code}</h1><p>Check saved log books and their original scans.</p></div><button type="button" onClick={onExit}>Back to {code}</button></header>
    <div className="saved-logbook-print-actions"><button type="button" onClick={()=>void previewReport()} disabled={loading||reportBusy||Boolean(filters.from&&filters.to&&filters.from>filters.to)}>{reportBusy?'Preparing all matching entries…':'Print Report / Save PDF'}</button>{selected&&<button type="button" onClick={previewBook}>Print {code} / Save PDF</button>}<span>Report includes all matching entries. Select a book to print its full details.</span></div>
    {printPreview&&<div className="saved-print-overlay" role="dialog" aria-modal="true" aria-label="Log book print preview"><div className="saved-print-toolbar"><strong>Print preview — A4</strong><span>Choose Save as PDF in the print window to export.</span><button type="button" onClick={()=>printFrame.current?.contentWindow?.print()}>Print / Save PDF</button><button type="button" onClick={()=>setPrintPreview('')}>Close preview</button></div><iframe ref={printFrame} title="Printable log book report" srcDoc={printPreview}/></div>}
    <section className="logbook-section"><div className="saved-logbook-filters"><label>Search<input type="search" aria-label={'Search saved '+code} value={filters.search} onChange={e=>change('search',e.target.value)} placeholder="Book, door, employee or card number"/></label><label>Location<SmartSelect value={filters.location} onChange={e=>change('location',e.target.value)}><option value="">All assigned locations</option>{sites.map(site=><option key={site}>{site}</option>)}</SmartSelect></label><label>From date<input type="date" value={filters.from} onChange={e=>change('from',e.target.value)}/></label><label>To date<input type="date" value={filters.to} onChange={e=>change('to',e.target.value)}/></label><button type="button" onClick={()=>setRefresh(n=>n+1)} disabled={loading}>Refresh</button></div>
      {error&&<p role="alert" className="logbook-message error">{error}</p>}{loading&&<p role="status">Loading saved {code}…</p>}
      <div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Book number</th><th>Date</th><th>Location</th><th>{vehicle?'Door':'Equipment'}</th><th>Employee ID</th><th>{vehicle?'Driver':'Operator'}</th><th/></tr></thead><tbody>{records.map(record=><tr key={record.id} aria-selected={String(selected?.id)===String(record.id)}><td>{record.book_no}</td><td>{bookDate(record.data.bookDate)}</td><td>{display(record.data.location)}</td><td>{display(record.data.door)}</td><td>{display(record.data.caliberId)}</td><td>{display(record.data.employeeName)}</td><td><button type="button" onClick={()=>setSelected(record)}>View {code}</button></td></tr>)}{!records.length&&!loading&&<tr><td colSpan={7}>No saved {code} entries match these filters.</td></tr>}</tbody></table></div>{cursor&&<button type="button" disabled={loading} onClick={()=>void load(cursor)}>Load more saved {code}</button>}
    </section>{vehicle&&selected&&<PulseTripVerification session={session} logbookId={selected.id}/>}
    {selected&&<SavedLogBookDetails key={selected.id} record={selected} kind={kind} ReportSection={ReportSection} imageUrl={String(imageFor)===String(selected.id)?imageUrl:''} imageError={String(imageFor)===String(selected.id)?imageError:''}/>}
  </section>;
}
