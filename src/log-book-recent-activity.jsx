import React,{useEffect,useState} from 'react';
import {Clock} from 'lucide-react';
import {RECENT_WINDOWS,SHIFT_KINDS,completedIn} from '../shared/recent-activity.mjs';

// MIS dashboard · Completed in the last 6, 12 and 24 hours.
// One line for the log books saved, then the shifts completed for VLB, LMV and ELB. Every figure opens its list.
const number=n=>Number(n||0).toLocaleString('en-IN');
const RECENT_REFRESH_MS=120000;
const timeLabel=at=>new Date(at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
export const agoLabel=minutes=>minutes<1?'just now':minutes<60?`${minutes} min ago`:`${Math.floor(minutes/60)} h ${minutes%60} min ago`;
export const windowLabel=hours=>`Last ${hours} hours`;
const CARD_LABELS={vehicle:'VLB',lmv:'LMV',equipment:'ELB'};
const SHIFT_NOTES={vlb:'trip cards locked',lmv:'LMV log books locked',elb:'batch closed'};

// Reads the figures when the dashboard opens or reloads, then every two minutes while the page is on screen.
export function useRecentActivity({session,fetcher=fetch,refresh=0}){
 const [state,setState]=useState({recent:null,error:''});
 useEffect(()=>{
  let stopped=false;const abort=new AbortController();
  const load=()=>fetcher('/api/dashboard/log-books/recent',{signal:abort.signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token}})
   .then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'The last 24 hours could not be read.');if(!stopped)setState({recent:body,error:''});})
   .catch(e=>{if(!stopped&&!abort.signal.aborted)setState(s=>({...s,error:e.message}));});
  void load();
  const timer=setInterval(()=>{if(!document.hidden)void load();},RECENT_REFRESH_MS);
  return ()=>{stopped=true;abort.abort();clearInterval(timer);};
 },[session.token,fetcher,refresh]);
 return state;
}

export default function RecentActivityPanel({recent,error,Dialog}){
 const [open,setOpen]=useState(null);
 if(!recent)return <article className="lb-panel lb-recent"><div className="lb-panel-heading"><div><h3>Completed in the last 6, 12 and 24 hours</h3><p role={error?'alert':'status'}>{error||'Reading the last 24 hours…'}</p></div></div></article>;
 const shiftKinds=SHIFT_KINDS.filter(([key])=>recent.shiftKinds.includes(key));
 const cell=(value,target,label)=><td key={target.hours}><button type="button" className="lb-recent-figure" disabled={!value} onClick={()=>setOpen(target)} aria-label={`${label}, ${windowLabel(target.hours).toLowerCase()}: ${value}`}>{number(value)}</button></td>;
 const sites=open?.row==='logs'?recent.bySite[open.hours]:[],list=open&&open.row!=='logs'?completedIn(recent,open.row,open.hours):[];
 const openLabel=open&&(open.row==='logs'?'Log books saved':SHIFT_KINDS.find(([key])=>key===open.row)[1]+' shifts completed')+' · '+windowLabel(open.hours).toLowerCase();
 return <article className="lb-panel lb-recent">
  <div className="lb-panel-heading"><div><h3><Clock size={17}/> Completed in the last 6, 12 and 24 hours</h3><p>Counted by the time of saving and locking, whatever the date on the card<span data-print-hide=""> · click a figure to see the list</span></p></div>
   <span className="lb-recent-asof">As of {timeLabel(recent.asOf)}{error?' · latest read failed, showing the earlier figures':''}</span></div>
  <div className="lb-table-wrap lb-recent-table"><table>
   <thead><tr><th>Completed</th>{recent.windows.map(hours=><th key={hours}>{windowLabel(hours)}</th>)}</tr></thead>
   <tbody>
    <tr><th scope="row">Log books saved<small>{recent.cardKinds.map(kind=>CARD_LABELS[kind]).join(' + ')} cards</small></th>{recent.windows.map(hours=>cell(recent.logs[hours].total,{row:'logs',hours},'Log books saved'))}</tr>
    {shiftKinds.map(([key,label])=><tr key={key}><th scope="row">{label} shifts completed<small>{SHIFT_NOTES[key]}</small></th>{recent.windows.map(hours=>cell(recent.shifts[hours][key],{row:key,hours},label+' shifts completed'))}</tr>)}
   </tbody>
  </table></div>
  {open&&<Dialog title={openLabel} close={()=>setOpen(null)}>
   <p className="lb-muted">As of {timeLabel(recent.asOf)}. <span className="lb-recent-switch">{RECENT_WINDOWS.map(hours=><button key={hours} type="button" aria-pressed={open.hours===hours} onClick={()=>setOpen({...open,hours})}>{windowLabel(hours)}</button>)}</span></p>
   {open.row==='logs'?<div className="lb-table-wrap"><table><thead><tr><th>Site</th>{recent.cardKinds.map(kind=><th key={kind}>{CARD_LABELS[kind]} cards</th>)}<th>Total</th></tr></thead>
     <tbody>{sites.map(site=><tr key={site.site}><td>{site.site}</td>{recent.cardKinds.map(kind=><td key={kind}>{number(site[kind])}</td>)}<td><b>{number(site.total)}</b></td></tr>)}
      {sites.length>0&&<tr><td><b>All sites</b></td>{recent.cardKinds.map(kind=><td key={kind}><b>{number(recent.logs[open.hours][kind])}</b></td>)}<td><b>{number(recent.logs[open.hours].total)}</b></td></tr>}</tbody></table></div>
    :<div className="lb-table-wrap"><table><thead><tr><th>Site</th><th>Card date</th><th>Shift</th><th>Batch</th><th>Completed at</th><th>How long ago</th></tr></thead>
     <tbody>{list.map(row=><tr key={row.kind+row.batchId+row.at}><td>{row.site}</td><td>{row.dateLabel}</td><td>{row.shiftLabel}</td><td>{row.batchName||'—'}</td><td>{timeLabel(row.at)}</td><td>{agoLabel(row.minutesAgo)}</td></tr>)}</tbody></table></div>}
   {(open.row==='logs'?!sites.length:!list.length)&&<p>Nothing was completed in this time.</p>}
  </Dialog>}
 </article>;
}
