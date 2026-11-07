import React,{useEffect,useState} from 'react';
import {SavedLogBookDetails} from './saved-log-books.jsx';
import LogBookForm from './log-book-form.jsx';
import PulseTripVerification from './pulse-trip-verification.jsx';

export default function VlbBatchCardDetails({session,batch,record,ReportSection,canEdit,onChanged,onClose,kind="vehicle"}){
 const [image,setImage]=useState(''),[error,setError]=useState(''),[editing,setEditing]=useState(false);
 const vehicle=kind==="vehicle",label=vehicle?"VLB":"ELB";
 const current=(vehicle?batch.records:batch.elbRecords||[]).find(row=>String(row.id)===String(record.id));
 useEffect(()=>{const node=document.getElementById('vlb-selected-card-details');node?.scrollIntoView({block:'start'});node?.focus({preventScroll:true});},[current?.id,record.viewKey]);
 useEffect(()=>{
  setImage('');setError('');if(!current?.data?.scanCardId)return;
  const controller=new AbortController();let url;
  (async()=>{try{const response=await fetch('/api/log-books/'+kind+'/'+current.id+'/source-image',{signal:controller.signal,headers:{Authorization:'Bearer '+session.token}});if(!response.ok)throw Error('The original scan is unavailable.');const blob=await response.blob();if(!controller.signal.aborted){url=URL.createObjectURL(blob);setImage(url)}}catch(e){if(!controller.signal.aborted)setError(e.message)}})();
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url)};
 },[kind,current?.id,current?.data?.scanCardId,session.token]);
 if(!current)return null;
 return <section id="vlb-selected-card-details" className="logbook-section vlb-selected-card-details" tabIndex={-1} aria-label={'Saved '+label+' '+current.book_no}><h2>Batch {batch.name} · {current.book_no}</h2>
  {onClose&&<button type="button" onClick={onClose}>Back to batch report</button>}
  {canEdit&&<button type="button" onClick={()=>setEditing(value=>!value)}>{editing?'Back to saved details':'Edit this '+label}</button>}
  {editing&&canEdit?<LogBookForm key={current.id} kind={kind} session={session} vlbBatch={batch} initialRecord={current} onExit={()=>setEditing(false)} onSaved={()=>{setEditing(false);onChanged?.()}}/>:<><SavedLogBookDetails record={current} kind={kind} imageUrl={image} imageError={error} ReportSection={ReportSection}/>{vehicle&&<PulseTripVerification session={session} logbookId={current.id}/>}</>}
 </section>;
}
