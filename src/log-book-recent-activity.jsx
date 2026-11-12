import React,{useEffect,useState} from 'react';
import {Clock} from 'lucide-react';
import {StepBackButton} from './step-back.jsx';
import {RECENT_WINDOWS,SHIFT_KINDS,SHIFT_CARD_NOUNS,completedIn,completedBySite,cardsInside,logShiftsFor} from '../shared/recent-activity.mjs';

// MIS dashboard · Completed in the last 6, 12 and 24 hours.
// One line for the log books saved, then the shifts completed for VLB, LMV and ELB with the cards inside them.
// Every figure opens its sites, the highest on top; a site opens its shifts.
const number=n=>Number(n||0).toLocaleString('en-IN');
const RECENT_REFRESH_MS=120000;
const BATCH_NAMES_SHOWN=12;
const timeLabel=at=>new Date(at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
export const agoLabel=minutes=>minutes<1?'just now':minutes<60?`${minutes} min ago`:`${Math.floor(minutes/60)} h ${minutes%60} min ago`;
export const windowLabel=hours=>`Last ${hours} hours`;
const CARD_LABELS={vehicle:'VLB',lmv:'LMV',equipment:'ELB'};
const SHIFT_NOTES={vlb:'trip cards locked',lmv:'LMV log books locked',elb:'batch closed'};
const capital=text=>text.charAt(0).toUpperCase()+text.slice(1);

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
 // open: {row: logs|vlb|lmv|elb, hours, site}. Without a site the list shows the sites; with one, that site's shifts.
 const [open,setOpen]=useState(null);
 if(!recent)return <article className="lb-panel lb-recent"><div className="lb-panel-heading"><div><h3>Completed in the last 6, 12 and 24 hours</h3><p role={error?'alert':'status'}>{error||'Reading the last 24 hours…'}</p></div></div></article>;
 const shiftKinds=SHIFT_KINDS.filter(([key])=>recent.shiftKinds.includes(key));
 // Under each shift figure: the cards inside those shifts, then the batch numbers counted in it, newest first, each with its cards.
 const cell=(value,target,label)=>{
  const rows=target.row==='logs'?[]:completedIn(recent,target.row,target.hours).filter(row=>row.batchName),shown=rows.slice(0,BATCH_NAMES_SHOWN),inside=recent.shiftCards?.[target.hours]?.[target.row];
  return <td key={target.hours}><button type="button" className="lb-recent-figure" disabled={!value} onClick={()=>setOpen(target)} aria-label={`${label}, ${windowLabel(target.hours).toLowerCase()}: ${value}`}>{number(value)}</button>
   {target.row!=='logs'&&value>0&&inside!==undefined&&<div className="lb-recent-cards">{number(inside)} {SHIFT_CARD_NOUNS[target.row]}</div>}
   {shown.length>0&&<small className="lb-recent-batches" aria-label="Batch numbers and the cards in each">{shown.map((row,i)=><span key={i}>{row.batchName}{row.cards!==undefined&&<> · <b>{number(row.cards)}</b></>}</span>)}{rows.length>shown.length&&<span>+{rows.length-shown.length} more</span>}</small>}</td>;};
 const logs=open?.row==='logs',kind=open&&!logs?SHIFT_KINDS.find(([key])=>key===open.row)[1]:'',noun=open&&!logs?capital(SHIFT_CARD_NOUNS[open.row]):'';
 // Step 1: the sites, the highest on top. Step 2: one site's shifts.
 const logSites=logs?[...(recent.bySite[open.hours]||[])].sort((a,b)=>b.total-a.total||a.site.localeCompare(b.site)):[];
 const logShifts=logs&&open.site?logShiftsFor(recent,open.site,open.hours):[];
 const shiftSites=open&&!logs?completedBySite(recent,open.row,open.hours):[];
 const siteShifts=open&&!logs&&open.site?completedIn(recent,open.row,open.hours,open.site):[];
 const empty=open&&(logs?(open.site?!logShifts.length:!logSites.length):(open.site?!siteShifts.length:!shiftSites.length));
 const openLabel=open&&[logs?'Log books saved':kind+' shifts completed',open.site,windowLabel(open.hours).toLowerCase()].filter(Boolean).join(' · ');
 const siteButton=site=><button type="button" className="lb-recent-site" onClick={()=>setOpen({...open,site})}>{site}</button>;
 const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row.counts[open.hours][key]||0),0);
 return <article className="lb-panel lb-recent">
  <div className="lb-panel-heading"><div><h3><Clock size={17}/> Completed in the last 6, 12 and 24 hours</h3><p>Counted by the time of saving and locking, whatever the date on the card<span data-print-hide=""> · click a figure to see it site by site</span></p></div>
   <span className="lb-recent-asof">As of {timeLabel(recent.asOf)}{error?' · latest read failed, showing the earlier figures':''}</span></div>
  <div className="lb-table-wrap lb-recent-table"><table>
   <thead><tr><th>Completed</th>{recent.windows.map(hours=><th key={hours}>{windowLabel(hours)}</th>)}</tr></thead>
   <tbody>
    <tr><th scope="row">Log books saved<small>{recent.cardKinds.map(kind=>CARD_LABELS[kind]).join(' + ')} cards</small></th>{recent.windows.map(hours=>cell(recent.logs[hours].total,{row:'logs',hours},'Log books saved'))}</tr>
    {shiftKinds.map(([key,label])=><tr key={key}><th scope="row">{label} shifts completed<small>{SHIFT_NOTES[key]}</small></th>{recent.windows.map(hours=>cell(recent.shifts[hours][key],{row:key,hours},label+' shifts completed'))}</tr>)}
   </tbody>
  </table></div>
  {open&&<Dialog title={openLabel} close={()=>setOpen(null)}>
   <div className="lb-recent-steps">{open.site&&<StepBackButton onBack={()=>setOpen({row:open.row,hours:open.hours})} label="Back to sites"/>}
    <span className="lb-recent-switch">{RECENT_WINDOWS.map(hours=><button key={hours} type="button" aria-pressed={open.hours===hours} onClick={()=>setOpen({...open,hours})}>{windowLabel(hours)}</button>)}</span></div>
   <p className="lb-muted">As of {timeLabel(recent.asOf)}. {open.site?(logs?'Cards saved for this site, by the date and shift written on the card.':'Shifts completed at this site, the latest on top.'):'Highest on top. Click a site to see its shifts.'}</p>
   {!empty&&logs&&!open.site&&<div className="lb-table-wrap"><table><thead><tr><th>Site</th>{recent.cardKinds.map(kind=><th key={kind}>{CARD_LABELS[kind]} cards</th>)}<th>Total</th></tr></thead>
     <tbody>{logSites.map(site=><tr key={site.site}><td>{siteButton(site.site)}</td>{recent.cardKinds.map(kind=><td key={kind}>{number(site[kind])}</td>)}<td><b>{number(site.total)}</b></td></tr>)}
      <tr><td><b>All sites</b></td>{recent.cardKinds.map(kind=><td key={kind}><b>{number(recent.logs[open.hours][kind])}</b></td>)}<td><b>{number(recent.logs[open.hours].total)}</b></td></tr></tbody></table></div>}
   {!empty&&logs&&open.site&&<div className="lb-table-wrap"><table><thead><tr><th>Card date</th><th>Shift</th>{recent.cardKinds.map(kind=><th key={kind}>{CARD_LABELS[kind]} cards</th>)}<th>Total</th></tr></thead>
     <tbody>{logShifts.map(row=><tr key={row.date+row.shift}><td>{row.dateLabel||'—'}</td><td>{row.shiftLabel||'—'}</td>{recent.cardKinds.map(kind=><td key={kind}>{number(row.counts[open.hours][kind])}</td>)}<td><b>{number(row.counts[open.hours].total)}</b></td></tr>)}
      <tr><td colSpan={2}><b>{open.site}</b></td>{recent.cardKinds.map(kind=><td key={kind}><b>{number(sum(logShifts,kind))}</b></td>)}<td><b>{number(sum(logShifts,'total'))}</b></td></tr></tbody></table></div>}
   {!empty&&!logs&&!open.site&&<div className="lb-table-wrap"><table><thead><tr><th>Site</th><th>{kind} shifts completed</th><th>{noun}</th></tr></thead>
     <tbody>{shiftSites.map(site=><tr key={site.site}><td>{siteButton(site.site)}</td><td><b>{number(site.shifts)}</b></td><td>{number(site.cards)}</td></tr>)}
      <tr><td><b>All sites</b></td><td><b>{number(recent.shifts[open.hours][open.row])}</b></td><td><b>{number(cardsInside(completedIn(recent,open.row,open.hours)))}</b></td></tr></tbody></table></div>}
   {!empty&&!logs&&open.site&&<div className="lb-table-wrap"><table><thead><tr><th>Card date</th><th>Shift</th><th>Batch</th><th>{noun}</th><th>Completed at</th><th>How long ago</th></tr></thead>
     <tbody>{siteShifts.map(row=><tr key={row.kind+row.batchId+row.at}><td>{row.dateLabel}</td><td>{row.shiftLabel}</td><td>{row.batchName||'—'}</td><td><b>{number(row.cards)}</b></td><td>{timeLabel(row.at)}</td><td>{agoLabel(row.minutesAgo)}</td></tr>)}</tbody></table></div>}
   {empty&&<p>Nothing was completed in this time.</p>}
  </Dialog>}
 </article>;
}
