import React,{useEffect,useState} from 'react';
import './master-sync.css';

const labels={pending:'Waiting / retrying',review:'Needs MIS review',verified:'MIS verified in Pulse'};
export default function PulseTripVerification({session,logbookId}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[working,setWorking]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  const load=async()=>{try{const response=await fetch('/api/pulse-trip-verification'+(logbookId?'?logbookId='+encodeURIComponent(logbookId):''),{signal:controller.signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token}});const result=await response.json();if(!response.ok)throw Error(result.error||'Verification status unavailable.');if(!controller.signal.aborted){setData(result);setError('');}}catch(e){if(!controller.signal.aborted)setError(e.message)}};
  setData(null);void load();const timer=setInterval(()=>void load(),15000);return()=>{controller.abort();clearInterval(timer)};
 },[session.token,logbookId,working]);
 const retry=async id=>{setWorking(String(id));try{const response=await fetch('/api/pulse-trip-verification/'+id+'/retry',{method:'POST',headers:{Authorization:'Bearer '+session.token}});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not retry this card.');}catch(e){setError(e.message)}finally{setWorking('')}};
 return <section className="pulse-trip-verification" aria-label="Automatic MIS verification"><h2>Automatic MIS verification</h2>
  <p>After a scanned trip card is saved, Pulse II checks the vehicle, site, completed trip times and meter readings, then verifies the matching closed breakdown in Pulse. Unclear matches need MIS review.</p>
  {error&&<p role="alert" className="master-sync-error">{error}</p>}
  {data&&<><p role="status">{!data.enabled?'Automatic sending is disabled in this local scanner environment.':!data.connected?'Sign in to Pulse II normally to connect Pulse automatically. No separate connection password is required.':'Connected to Pulse. Saved trip cards are checked automatically every minute.'}</p>
   {data.error&&<p role="alert">Last check failed: {data.error}</p>}
   {!logbookId&&<p>Verified: {data.counts.verified||0} · Waiting: {data.counts.pending||0} · Needs MIS review: {data.counts.review||0}</p>}
   <div className="master-sync-table"><table><thead><tr><th>Trip card / VLB</th><th>Vehicle / site</th><th>Status</th><th>Pulse request</th><th>Details</th><th/></tr></thead><tbody>{data.jobs.map(job=><tr key={job.logbook_id}><td>{job.card_number||'—'}<small>{job.book_no}</small></td><td>{job.door}<small>{job.site}</small></td><td>{labels[job.status]}</td><td>{job.request_ref||'—'}</td><td>{job.reason}{job.first_trip_at&&<small>First trip: {new Date(job.first_trip_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</small>}{job.verified_at&&<small>Verified: {new Date(job.verified_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</small>}</td><td>{job.status!=='verified'&&<button type="button" disabled={Boolean(working)||!data.connected||!data.enabled} onClick={()=>void retry(job.logbook_id)}>Recheck</button>}</td></tr>)}{!data.jobs.length&&<tr><td colSpan={6}>{logbookId?'This entry has no automatic verification job. Newly saved scanned vehicle trip cards are included.':'No trip cards queued yet. Newly saved scanned vehicle trip cards will appear here.'}</td></tr>}</tbody></table></div></>}
  {!data&&!error&&<p role="status">Loading verification status…</p>}
 </section>;
}
