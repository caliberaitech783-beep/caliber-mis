import React,{useEffect,useState} from 'react';
import {vlbRecordShift} from '../shared/vlb-batch-format.mjs';
import {bookShiftCode} from '../shared/trip-card-rules.mjs';
import LogBookDeletion from './log-book-deletion.jsx';
import TableSmartPrint from './table-smart-print.jsx';

export default function PreviousElbEntries({session,batch,assetId,canDelete,onDeleted}){
 const [result,setResult]=useState({records:[],loading:true,error:''});
 const [revision,setRevision]=useState(0),[selected,setSelected]=useState(null);
 useEffect(()=>{
  const controller=new AbortController();
  const load=async()=>{
   const query=new URLSearchParams({assetId,location:batch.site,from:batch.report_date,to:batch.report_date});
   const records=[];
   const shift=bookShiftCode(batch.shift);
   let cursor=null;
   do{
    if(cursor)query.set('before',cursor);
    const response=await fetch('/api/log-books/equipment?'+query,{signal:controller.signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token}});
    const page=await response.json();
    if(!response.ok)throw Error(page.error||'Could not load previous ELB entries.');
    records.push(...page.records.filter(record=>vlbRecordShift(record.data)===shift));
    cursor=page.nextCursor;
   }while(cursor);
   if(!controller.signal.aborted)setResult({records,loading:false,error:''});
  };
  setResult({records:[],loading:true,error:''});
  void load().catch(error=>{if(!controller.signal.aborted)setResult({records:[],loading:false,error:error.message});});
  return()=>controller.abort();
 },[assetId,batch.site,batch.report_date,batch.shift,session.token,revision]);
 return <>
  <p>Saved ELBs for this equipment, site, date and shift.</p>
  {result.loading&&<p role="status">Loading previous ELB entries…</p>}
  {result.error&&<p role="alert">{result.error} <button type="button" onClick={()=>setRevision(n=>n+1)}>Retry</button></p>}
  {!result.loading&&!result.error&&!result.records.length&&<p>No previous ELB entries found for this shift.</p>}
  {result.records.length>0&&<><TableSmartPrint row title={['Previous ELB entries',batch.site,batch.report_date,batch.shift].filter(Boolean).join(' · ')}/><div className="logbook-table-wrap"><table className="logbook-table">
   <thead><tr><th>Book number</th><th>Source</th><th>Operator</th><th>Opening HMR</th><th>Closing HMR</th><th>Working HMR</th>{canDelete&&<th>Action</th>}</tr></thead>
   <tbody>{result.records.map(record=><tr key={record.id}><td>{record.book_no}</td><td>{record.data.scanCardId?'Scanned':'Manual'}</td><td>{record.data.employeeName||'—'}</td><td>{record.data.openingHmr??'—'}</td><td>{record.data.closingHmr??'—'}</td><td>{record.data.totalWorkingHmr??'—'}</td>{canDelete&&<td><button type="button" disabled={!!selected} onClick={()=>setSelected(record)}>Delete ELB</button></td>}</tr>)}</tbody>
  </table></div></>}
  {selected&&canDelete&&<section aria-label={'Delete ELB '+selected.book_no}>
   <button type="button" onClick={()=>setSelected(null)}>Close deletion</button>
   <LogBookDeletion key={selected.id} session={session} context={{kind:'equipment',record:selected,recordOnly:true}} onDeleted={()=>{setRevision(n=>n+1);void onDeleted?.(selected);}}/>
  </section>}
 </>;
}
