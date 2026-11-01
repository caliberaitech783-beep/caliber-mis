import React,{useEffect,useState} from 'react';
import {SavedLogBookDetails} from './saved-log-books.jsx';
import LogBookForm from './log-book-form.jsx';
import PulseTripVerification from './pulse-trip-verification.jsx';

export default function VlbBatchCardDetails({session,batch,record,ReportSection,canEdit,onChanged}){
 const [image,setImage]=useState(''),[error,setError]=useState(''),[editing,setEditing]=useState(false);
 const current=batch.records.find(row=>String(row.id)===String(record.id));
 useEffect(()=>{
  setImage('');setError('');if(!current?.data?.scanCardId)return;
  const controller=new AbortController();let url;
  (async()=>{try{const response=await fetch('/api/log-books/vehicle/'+current.id+'/source-image',{signal:controller.signal,headers:{Authorization:'Bearer '+session.token}});if(!response.ok)throw Error('The original scan is unavailable.');const blob=await response.blob();if(!controller.signal.aborted){url=URL.createObjectURL(blob);setImage(url)}}catch(e){if(!controller.signal.aborted)setError(e.message)}})();
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url)};
 },[current?.id,current?.data?.scanCardId,session.token]);
 if(!current)return null;
 return <section className="logbook-section"><h2>Batch {batch.name} · {current.book_no}</h2>
  {canEdit&&<button type="button" onClick={()=>setEditing(value=>!value)}>{editing?'Back to saved details':'Edit this VLB'}</button>}
  {editing&&canEdit?<LogBookForm key={current.id} kind="vehicle" session={session} vlbBatch={batch} initialRecord={current} onExit={()=>setEditing(false)} onSaved={()=>{setEditing(false);onChanged?.()}}/>:<><SavedLogBookDetails record={current} kind="vehicle" imageUrl={image} imageError={error} ReportSection={ReportSection}/><PulseTripVerification session={session} logbookId={current.id}/></>}
 </section>;
}
