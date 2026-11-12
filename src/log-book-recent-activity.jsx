import React,{useEffect,useState} from 'react';
import {Clock} from 'lucide-react';
import {StepBackButton} from './step-back.jsx';
import {RECENT_WINDOWS,SHIFT_KINDS,SHIFT_CARD_NOUNS,LOCK_CARD_NOUNS,LOCK_STAGES,completedIn,completedBySite,cardsInside,logShiftsFor,locksIn,locksBySite,lockCards,averageLockMinutes,durationLabel} from '../shared/recent-activity.mjs';

// MIS dashboard · Completed in the last 6, 12 and 24 hours.
// One line for the log books saved, the shifts completed for VLB, LMV and ELB, then the batches locked: figures only.
// Every figure opens its sites, the highest on top, each with the batches locked there and the cards in them;
// a site name opens that site alone. A locked batch shows its batch start to close time, and that time opens
// into the time taken by VLB, LMV and ELB, which add up to it.
const number=n=>Number(n||0).toLocaleString('en-IN');
const RECENT_REFRESH_MS=120000;
const timeLabel=at=>new Date(at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
export const agoLabel=minutes=>minutes<1?'just now':minutes<60?`${minutes} min ago`:`${Math.floor(minutes/60)} h ${minutes%60} min ago`;
export const windowLabel=hours=>`Last ${hours} hours`;
const CARD_LABELS={vehicle:'VLB',lmv:'LMV',equipment:'ELB'};
const SHIFT_NOTES={vlb:'trip cards locked',lmv:'LMV log books locked',elb:'ELB cards locked'};
const capital=text=>text.charAt(0).toUpperCase()+text.slice(1);
const shiftCount=count=>`${number(count)} shift${Number(count)===1?'':'s'}`;
const batchCount=count=>`${number(count)} batch${Number(count)===1?'':'es'}`;

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
 // open: {row: logs|vlb|lmv|elb|batch, hours, site, batch}. Without a site the list shows the sites; with one, that site alone.
 // With a batch (Batches locked only): that batch's start to close time, divided into VLB, LMV and ELB.
 const [open,setOpen]=useState(null);
 if(!recent)return <article className="lb-panel lb-recent"><div className="lb-panel-heading"><div><h3>Completed in the last 6, 12 and 24 hours</h3><p role={error?'alert':'status'}>{error||'Reading the last 24 hours…'}</p></div></div></article>;
 const shiftKinds=SHIFT_KINDS.filter(([key])=>recent.shiftKinds.includes(key));
 // The front shows the figure alone; the batch numbers and the cards inside them are in the list a figure opens.
 const cell=(value,target,label)=><td key={target.hours}><button type="button" className="lb-recent-figure" disabled={!value} onClick={()=>setOpen(target)} aria-label={`${label}, ${windowLabel(target.hours).toLowerCase()}: ${value}`}>{number(value)}</button></td>;
 const logs=open?.row==='logs',locks=open?.row==='batch',shiftRow=Boolean(open)&&!logs&&!locks;
 const kind=shiftRow?SHIFT_KINDS.find(([key])=>key===open.row)[1]:'',noun=shiftRow?capital(SHIFT_CARD_NOUNS[open.row]):'';
 // Step 1: the sites, the highest on top; under each site of a shift row, the batches locked there. Step 2: one site alone.
 const logSites=logs?[...(recent.bySite[open.hours]||[])].sort((a,b)=>b.total-a.total||a.site.localeCompare(b.site)):[];
 const logShifts=logs&&open.site?logShiftsFor(recent,open.site,open.hours):[];
 const shiftSites=shiftRow?completedBySite(recent,open.row,open.hours):[];
 const siteShifts=shiftRow&&open.site?completedIn(recent,open.row,open.hours,open.site):[];
 // Batches locked: the whole batch saved and locked, with every card inside it and who locked it.
 const lockSites=locks?locksBySite(recent,open.hours):[];
 const lockRows=locks?locksIn(recent,open.hours,open.site||''):[];
 const lockTotal=lockCards(lockRows);
 // One locked batch opened from its time. If the latest read no longer holds it, the list shows again.
 const timed=locks&&open.batch?(recent.locked||[]).find(row=>row.batchId===open.batch)||null:null;
 const empty=open&&(logs?(open.site?!logShifts.length:!logSites.length):locks?!lockRows.length:(open.site?!siteShifts.length:!shiftSites.length));
 const openLabel=open&&(timed?'Batch start to close · '+(timed.batchName||'batch'):[logs?'Log books saved':locks?'Batches locked':kind+' shifts completed',open.site,windowLabel(open.hours).toLowerCase()].filter(Boolean).join(' · '));
 const siteButton=site=><button type="button" className="lb-recent-site" onClick={()=>setOpen({...open,site})}>{site}</button>;
 const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row.counts[open.hours][key]||0),0);
 // One locked batch: its number, the card date and shift, the cards inside it and when it was locked.
 const allShifts=shiftRow?completedIn(recent,open.row,open.hours):[];
 const lockHead=first=><thead><tr><th>{first}</th><th>Card date</th><th>Shift</th><th>{noun}</th><th>Locked at</th><th>How long ago</th></tr></thead>;
 const lockRow=row=><tr key={row.kind+row.batchId+row.at}><td className="lb-recent-batch">{row.batchName||'—'}</td><td>{row.dateLabel}</td><td>{row.shiftLabel}</td><td>{number(row.cards)}</td><td>{timeLabel(row.at)}</td><td>{agoLabel(row.minutesAgo)}</td></tr>;
 // Six cells, never a joined one: a phone hides three of the columns, and every line must lose the same three.
 const totalRow=(name,shifts,cards)=><tr className="lb-recent-site-row"><td>{name}<span>{shiftCount(shifts)}</span></td><td/><td/><td><b>{number(cards)}</b></td><td/><td/></tr>;
 // The same list for whole batches: one column for each kind of card inside the batch, the batch start to close time
 // (it opens the time taken by VLB, LMV and ELB), then the lock time and who locked it.
 const hasTime=row=>row.totalMinutes!==null&&row.totalMinutes!==undefined;
 const batchHead=first=><thead><tr><th>{first}</th><th>Card date</th><th>Shift</th>{recent.cardKinds.map(card=><th key={card}>{capital(LOCK_CARD_NOUNS[card])}</th>)}<th>Batch start to close</th><th>Locked at</th><th className="lb-recent-wide">Locked by</th></tr></thead>;
 const batchRow=row=><tr key={row.batchId+row.at}><td className="lb-recent-batch">{row.batchName||'—'}</td><td>{row.dateLabel}</td><td>{row.shiftLabel}</td>{recent.cardKinds.map(card=><td key={card}>{number(row[card])}</td>)}
  <td className="lb-recent-time">{hasTime(row)?<><button type="button" className="lb-recent-site" onClick={()=>setOpen({...open,batch:row.batchId})} aria-label={`Batch start to close, ${row.batchName}: ${durationLabel(row.totalMinutes)}. Show VLB, LMV and ELB time`}>{durationLabel(row.totalMinutes)}</button><small>started {timeLabel(row.startedAt)}</small></>:'—'}</td>
  <td>{timeLabel(row.at)}<small>{agoLabel(row.minutesAgo)}</small></td><td className="lb-recent-wide">{row.lockedBy||'—'}</td></tr>;
 // On a site's line and the last line: the cards added up, and the average batch start to close time of its batches.
 const batchTotalRow=(name,rows,cards)=>{const average=averageLockMinutes(rows);return <tr className="lb-recent-site-row"><td>{name}<span>{batchCount(rows.length)}</span></td><td/><td/>{recent.cardKinds.map(card=><td key={card}><b>{number(cards[card])}</b></td>)}<td className="lb-recent-time">{average!==null&&<><b>{durationLabel(average)}</b><small>average</small></>}</td><td/><td className="lb-recent-wide"/></tr>;};
 // One batch's time: VLB, LMV and ELB each from one lock to the next, and the batch start to close time they add up to.
 const stageCards=card=>recent.cardKinds.includes(card)?`${number(timed[card])} ${LOCK_CARD_NOUNS[card]}`:'—';
 const by=name=>name?' by '+name:'';
 return <article className="lb-panel lb-recent">
  <div className="lb-panel-heading"><div><h3><Clock size={17}/> Completed in the last 6, 12 and 24 hours</h3><p>Counted by the time of saving and locking, whatever the date on the card<span data-print-hide=""> · click a figure for its sites and batch numbers</span></p></div>
   <span className="lb-recent-asof">As of {timeLabel(recent.asOf)}{error?' · latest read failed, showing the earlier figures':''}</span></div>
  <div className="lb-table-wrap lb-recent-table"><table>
   <thead><tr><th>Completed</th>{recent.windows.map(hours=><th key={hours}>{windowLabel(hours)}</th>)}</tr></thead>
   <tbody>
    <tr><th scope="row">Log books saved<small>{recent.cardKinds.map(kind=>CARD_LABELS[kind]).join(' + ')} cards</small></th>{recent.windows.map(hours=>cell(recent.logs[hours].total,{row:'logs',hours},'Log books saved'))}</tr>
    {shiftKinds.map(([key,label])=><tr key={key}><th scope="row">{label} shifts completed<small>{SHIFT_NOTES[key]}</small></th>{recent.windows.map(hours=>cell(recent.shifts[hours][key],{row:key,hours},label+' shifts completed'))}</tr>)}
    {recent.batchLocks&&shiftKinds.length>0&&<tr><th scope="row">Batches locked<small>whole batch saved and locked</small></th>{recent.windows.map(hours=>cell(recent.batchLocks[hours],{row:'batch',hours},'Batches locked'))}</tr>}
   </tbody>
  </table></div>
  {open&&<Dialog title={openLabel} close={()=>setOpen(null)}>
   {timed&&<>
    <div className="lb-recent-steps"><StepBackButton onBack={()=>setOpen({row:open.row,hours:open.hours,site:open.site})} label="Back to batches"/></div>
    <p className="lb-muted">{timed.site} · card date {timed.dateLabel} · {timed.shiftLabel}. The time is by the clock, from the moment the batch was started on the website to the moment it was saved and locked.</p>
    <p className="lb-recent-total">Batch start to close: <b>{durationLabel(timed.totalMinutes)}</b> · started {timeLabel(timed.startedAt)}{by(timed.startedBy)} · locked {timeLabel(timed.closedAt)}{by(timed.lockedBy)}</p>
    {timed.stages.length>0?<div className="lb-table-wrap lb-recent-locks lb-recent-stages"><table>
      <thead><tr><th>Stage</th><th>From</th><th>To</th><th>Time taken</th><th>Cards</th></tr></thead>
      <tbody>{LOCK_STAGES.map(([key,label,card,span])=>{const stage=timed.stages.find(item=>item.key===key);return <tr key={key}><td><b>{label}</b><small>{span}</small></td><td>{timeLabel(stage.from)}</td><td>{timeLabel(stage.to)}</td><td><b>{durationLabel(stage.minutes)}</b></td><td>{stageCards(card)}</td></tr>;})}
       <tr className="lb-recent-site-row"><td>Batch start to close<span>VLB + LMV + ELB</span></td><td>{timeLabel(timed.startedAt)}</td><td>{timeLabel(timed.closedAt)}</td><td><b>{durationLabel(timed.totalMinutes)}</b></td><td/></tr></tbody></table></div>
     :<p>This batch was saved and locked in one step, so the VLB and LMV lock times were not recorded and its time cannot be divided.</p>}
    {timed.stages.length>0&&<p className="lb-muted">VLB is from the batch start to the VLB lock, LMV from the VLB lock to the LMV lock, and ELB from the LMV lock to the batch lock. The three add up to the batch start to close time.</p>}
   </>}
   {!timed&&<><div className="lb-recent-steps">{open.site&&<StepBackButton onBack={()=>setOpen({row:open.row,hours:open.hours})} label="Back to sites"/>}
    <span className="lb-recent-switch">{RECENT_WINDOWS.map(hours=><button key={hours} type="button" aria-pressed={open.hours===hours} onClick={()=>setOpen({...open,hours})}>{windowLabel(hours)}</button>)}</span></div>
   <p className="lb-muted">As of {timeLabel(recent.asOf)}. {open.site?(logs?'Cards saved for this site, by the date and shift written on the card.':locks?'Batches locked at this site, the latest on top. Click a time to see how much of it was VLB, LMV and ELB.':'Batches locked at this site, the latest on top.'):logs?'Highest on top. Click a site to see its shifts.':locks?'Highest on top. Under each site are the batches locked there, the latest first. Click a site to see it alone, or a time to see how much of it was VLB, LMV and ELB.':'Highest on top. Under each site are the batches locked there, the latest first. Click a site to see it alone.'}</p>
   {!empty&&shiftRow&&<p className="lb-recent-total"><b>{number(open.site?siteShifts.length:recent.shifts[open.hours][open.row])}</b> {kind} shifts completed · <b>{number(cardsInside(open.site?siteShifts:allShifts))}</b> {SHIFT_CARD_NOUNS[open.row]}</p>}
   {!empty&&locks&&<p className="lb-recent-total"><b>{number(lockRows.length)}</b> {lockRows.length===1?'batch':'batches'} locked{recent.cardKinds.map(card=><React.Fragment key={card}> · <b>{number(lockTotal[card])}</b> {LOCK_CARD_NOUNS[card]}</React.Fragment>)}</p>}
   {!empty&&logs&&!open.site&&<div className="lb-table-wrap"><table><thead><tr><th>Site</th>{recent.cardKinds.map(kind=><th key={kind}>{CARD_LABELS[kind]} cards</th>)}<th>Total</th></tr></thead>
     <tbody>{logSites.map(site=><tr key={site.site}><td>{siteButton(site.site)}</td>{recent.cardKinds.map(kind=><td key={kind}>{number(site[kind])}</td>)}<td><b>{number(site.total)}</b></td></tr>)}
      <tr><td><b>All sites</b></td>{recent.cardKinds.map(kind=><td key={kind}><b>{number(recent.logs[open.hours][kind])}</b></td>)}<td><b>{number(recent.logs[open.hours].total)}</b></td></tr></tbody></table></div>}
   {!empty&&logs&&open.site&&<div className="lb-table-wrap"><table><thead><tr><th>Card date</th><th>Shift</th>{recent.cardKinds.map(kind=><th key={kind}>{CARD_LABELS[kind]} cards</th>)}<th>Total</th></tr></thead>
     <tbody>{logShifts.map(row=><tr key={row.date+row.shift}><td>{row.dateLabel||'—'}</td><td>{row.shiftLabel||'—'}</td>{recent.cardKinds.map(kind=><td key={kind}>{number(row.counts[open.hours][kind])}</td>)}<td><b>{number(row.counts[open.hours].total)}</b></td></tr>)}
      <tr><td colSpan={2}><b>{open.site}</b></td>{recent.cardKinds.map(kind=><td key={kind}><b>{number(sum(logShifts,kind))}</b></td>)}<td><b>{number(sum(logShifts,'total'))}</b></td></tr></tbody></table></div>}
   {!empty&&shiftRow&&!open.site&&<div className="lb-table-wrap lb-recent-locks"><table>{lockHead('Site and batch number')}
     <tbody>{shiftSites.map(site=><React.Fragment key={site.site}>{totalRow(siteButton(site.site),site.shifts,site.cards)}{completedIn(recent,open.row,open.hours,site.site).map(lockRow)}</React.Fragment>)}
      {totalRow(<b>All sites</b>,recent.shifts[open.hours][open.row],cardsInside(allShifts))}</tbody></table></div>}
   {!empty&&shiftRow&&open.site&&<div className="lb-table-wrap lb-recent-locks"><table>{lockHead('Batch number')}
     <tbody>{siteShifts.map(lockRow)}{totalRow(<b>{open.site}</b>,siteShifts.length,cardsInside(siteShifts))}</tbody></table></div>}
   {!empty&&locks&&!open.site&&<div className="lb-table-wrap lb-recent-locks lb-recent-batchlocks"><table>{batchHead('Site and batch number')}
     <tbody>{lockSites.map(site=>{const rows=locksIn(recent,open.hours,site.site);return <React.Fragment key={site.site}>{batchTotalRow(siteButton(site.site),rows,site.cards)}{rows.map(batchRow)}</React.Fragment>;})}
      {batchTotalRow(<b>All sites</b>,lockRows,lockTotal)}</tbody></table></div>}
   {!empty&&locks&&open.site&&<div className="lb-table-wrap lb-recent-locks lb-recent-batchlocks"><table>{batchHead('Batch number')}
     <tbody>{lockRows.map(batchRow)}{batchTotalRow(<b>{open.site}</b>,lockRows,lockTotal)}</tbody></table></div>}
   {empty&&<p>Nothing was completed in this time.</p>}</>}
  </Dialog>}
 </article>;
}
