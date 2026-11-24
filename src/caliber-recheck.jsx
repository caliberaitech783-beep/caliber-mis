// Caliber ID Re-check (owner, 22 Nov 2026): every saved card since 1 Nov judged again against Employee Master, and
// the site names the right driver for each listed card. Submit on a line corrects that card at once and the line
// leaves the list (owner, 23 Nov 2026: "build one step submit"; before that a choice waited for a separate
// "Run the corrections" at the top of the page, which the sites could not find). Undo puts the earlier person back.
// The rule is shared/caliber-recheck.mjs; the server is server/routes/caliber-recheck.mjs.
//
// Drawn in the owner's report steps: Step 1 one line per site, Step 2 that site date by shift, Step 3 the cards of the
// date and shift opened. Each step stays on screen under the one before.
// The screen asks the server day by day (a day is about 3,700 cards), so the live server never reads every card at once.
import React,{useEffect,useRef,useState} from 'react';
import EmployeeIdLookup from './employee-id-lookup.jsx';
import {DateShiftGrid,dateShiftGrid,dateShiftExport,dateLine,siteDateLine} from './date-shift-grid.jsx';
import {StepBackButton} from './step-back.jsx';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {downloadBlob} from './download-history.mjs';
import {shiftChoiceLabel} from '../shared/report-filter-options.mjs';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {REFRESH_HINT} from '../shared/caliber-id-check.mjs';
import {EVERY,dmy,when,todayInIndia,recheckDates,emptyRecheck,addRecheckAnswer,recheckSiteRows,cardsOfSite,recheckSlotRows,cardsOfSlot,lookAlikeText,reasonCounts,recheckListSheets,recheckRecordSheets,recheckConfirmedSheets,keepRecheckAnswer,keptRecheckAnswer} from './caliber-recheck-model.mjs';
import './caliber-recheck.css';

const count=value=>Number(value||0).toLocaleString('en-IN');
// Save shift (owner, 24 Nov 2026): a card that names no shift, or two, takes the shift chosen from the paper card.
const SHIFT_OPTIONS=[['S1','Shift I'],['S2','Shift II'],['S3','Shift III'],['D','Day (12 Hrs)'],['N','Night (12 Hrs)']];
const isTotal=row=>Boolean(row.total);

function OriginalCardPreview({card,token,onClose}){
 const [src,setSrc]=useState(''),[error,setError]=useState(''),[zoom,setZoom]=useState(1),[rotation,setRotation]=useState(0);
 useEffect(()=>{const controller=new AbortController();let url;setSrc('');setError('');fetch('/api/scan-cards/'+card.scanCardId+'/image',{signal:controller.signal,cache:'no-store',headers:{Authorization:'Bearer '+token}}).then(response=>{if(!response.ok)throw Error('The original scanned card is not available.');return response.blob()}).then(blob=>{if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setSrc(url)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>{controller.abort();if(url)URL.revokeObjectURL(url)}},[card.scanCardId,token]);
 useEffect(()=>{const close=event=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[onClose]);
 return <div className="cr-card-preview" role="dialog" aria-modal="true" aria-label={'Original scanned card '+card.bookNo} onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
  <section className="cr-card-preview-panel">
   <header><div><h2>Original Trip Card</h2><p>{card.bookNo} · {card.door}</p></div><button type="button" className="cr-card-preview-close" onClick={onClose} aria-label="Close original card preview">×</button></header>
   <nav aria-label="Original card preview controls"><button type="button" disabled={!src||zoom<=.5} onClick={()=>setZoom(value=>Math.max(.5,value-.25))}>Zoom out</button><button type="button" disabled={!src||zoom>=3} onClick={()=>setZoom(value=>Math.min(3,value+.25))}>Zoom in</button><button type="button" disabled={!src} onClick={()=>setRotation(value=>(value+90)%360)}>Rotate</button>{src&&<a href={src} target="_blank" rel="noreferrer">Open full size</a>}</nav>
   <div className="cr-card-preview-image">{src?<img src={src} alt={'Original scanned trip card '+card.bookNo} style={{transform:`rotate(${rotation}deg) scale(${zoom})`}}/>:error?<p role="alert">{error}</p>:<p role="status">Loading original card…</p>}</div>
  </section>
 </div>;
}

// embedded (owner, 24 Nov 2026: "add this in serial number one dashboard"): the same steps inside Sr 1 of the
// dashboard, under the last 6, 12 and 24 hours. Kept short there: no page heading, dates, summary, Excel or the two
// lists at the foot (those stay on the page, which onOpenPage opens); Step 1 with its figures, and Step 2 and Step 3
// under it when a site is pressed, work as on the page. Its first reading takes the days read in the last few minutes
// from the browser (src/caliber-recheck-model.mjs), and a login that may not open the page sees nothing.
export default function CaliberRecheck({session,ReportSection,embedded=false,onOpenPage}){
 const [from,setFrom]=useState(OPERATIONAL_START),[to,setTo]=useState(todayInIndia());
 const [held,setHeld]=useState(emptyRecheck),[progress,setProgress]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [open,setOpen]=useState({site:'',slot:null}),[confirming,setConfirming]=useState(false),[running,setRunning]=useState(false),[refused,setRefused]=useState([]),[record,setRecord]=useState(null);
 // What the last Submit did, said on its own line: the page's notices are far above Step 3.
 const [said,setSaid]=useState(null);
 // "This card is right" (owner, 23 Nov 2026): the line being asked "Yes, … drove this vehicle", the card just
 // settled (said above Step 3 with Undo, because a confirmed line leaves the list), and the confirmed cards for HR.
 const [asking,setAsking]=useState(''),[keeping,setKeeping]=useState(false),[kept,setKept]=useState(null),[confirmedList,setConfirmedList]=useState(null);
 const [previewCard,setPreviewCard]=useState(null);
 // Refresh (owner, 23 Nov 2026): the line whose saved number HR Pulse is being asked about.
 const [refreshing,setRefreshing]=useState('');
 // Save shift: the shift chosen on each 'no-shift' line, and the line being saved.
 const [shiftPicks,setShiftPicks]=useState({}),[savingShift,setSavingShift]=useState('');
 // On the dashboard: when the oldest day on screen was read, and whether this login was refused the re-check.
 const [asOf,setAsOf]=useState(0),[refusedAccess,setRefusedAccess]=useState(false);
 const run=useRef(0);
 const api=async(path,options={})=>{
  const response=await fetch(path,{...options,headers:{Authorization:`Bearer ${session.token}`,...(options.body?{'Content-Type':'application/json'}:{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(body.error||'The re-check is unavailable.'),{status:response.status});
  return body;
 };
 // Every date of the period, one after the other. A newer run, or leaving the page, stops an older one.
 // Reading one date again after a Submit (fresh = false) is not a newer run: it must not stop a full read that is
 // still going, or the list would end at the date it had reached.
 // reuse (the dashboard's first reading only): a day read in the last few minutes is taken from the browser.
 const recheck=async(dates=recheckDates(from,to),fresh=true,keepMessages=false,reuse=false)=>{
  const mine=fresh?++run.current:run.current;
  setError('');if(fresh){setSaid(null);setKept(null);setAsking('');setHeld(emptyRecheck());setOpen({site:'',slot:null});if(!keepMessages){setNotice('');setRefused([]);}}
  let oldest=Date.now();
  try{
   for(let i=0;i<dates.length;i++){
    if(run.current!==mine)return;
    if(fresh)setProgress({done:i,total:dates.length});
    const kept=reuse?keptRecheckAnswer(session.token,dates[i]):null;
    const answer=kept?kept.answer:await api('/api/caliber-recheck?from='+dates[i]+'&to='+dates[i]);
    if(kept)oldest=Math.min(oldest,kept.at);else keepRecheckAnswer(session.token,answer);
    if(run.current!==mine)return;
    setHeld(now=>addRecheckAnswer(now,answer));
   }
   if(fresh&&run.current===mine)setAsOf(oldest);
  }catch(e){if(run.current===mine){if(embedded&&e.status===403)setRefusedAccess(true);else setError(e.message);}}
  finally{if(fresh&&run.current===mine)setProgress(null);}
 };
 useEffect(()=>{void recheck(undefined,true,false,embedded);return()=>{run.current++};},[]);

 const loadConfirmed=async()=>{try{setConfirmedList((await api('/api/caliber-recheck/confirmed')).confirmed);}catch(e){setError(e.message);}};
 // A card that leaves the list: said above Step 3, where its line was. Undo is offered for a confirmation.
 const settled=(row,confirmed)=>{
  setKept({id:row.id,date:row.date,undo:confirmed?'confirm':'',text:confirmed?'Card '+row.bookNo+' confirmed right: '+row.savedId+' · '+row.savedName+' stays on it. The card has left the list.':'Card '+row.bookNo+' stands now, so it has left the list.'});
  if(confirmedList)void loadConfirmed();
 };
 // A card Submit has corrected: its line leaves the list, so what changed is said above Step 3, with Undo. A card
 // that is still listed afterwards (its number is on two people of the site) keeps its line and is told there.
 const corrected=(row,answer)=>{
  const made=answer.correction,now=made.to+' · '+made.toName,was=[made.from,made.fromName].filter(Boolean).join(' · ');
  if(answer.still)setSaid({id:row.id,text:'Corrected: this card is now under '+now+'. It is still listed: '+answer.still});
  else setKept({id:row.id,date:row.date,undo:'correction',correctionId:made.id,text:'Card '+row.bookNo+' corrected: now under '+now+(was?' (was under '+was+')':'')+'. The card has left the list.'});
  if(record)void loadRecord();
 };
 // Submit on a card's line corrects the card at once. A refusal is thrown back to the Fetch box, which says it on
 // that line. The saved driver's own number is the same answer as "This card is right".
 const choose=async(row,employee)=>{
  setError('');setNotice('');setSaid(null);setAsking('');
  const answer=await api('/api/caliber-recheck/pick',{method:'POST',body:JSON.stringify({logbookId:row.id,employeeId:employee.id})});
  // The line of the card done before, with its Undo, stays through a refusal; a Submit that goes through replaces it.
  setKept(null);
  if(answer.same&&answer.confirmed)settled(row,true);
  else if(answer.corrected)corrected(row,answer);
  else setSaid({id:row.id,text:employee.name+' is the person already on this card. Nothing to correct on it.'});
  await recheck([row.date],false);
 };
 // Undo of a correction: the earlier person goes back on the card, which is judged afresh and listed again. What it
 // did is said on the card's own line, back in the list.
 const uncorrect=async(correctionId,date,logbookId)=>{
  setError('');setNotice('');setSaid(null);setKept(null);
  try{
   const answer=await api('/api/caliber-recheck/correction/'+correctionId,{method:'DELETE'});
   const text=answer.removed?'Taken back: card '+answer.card.bookNo+' is under '+([answer.card.employeeId,answer.card.name].filter(Boolean).join(' · ')||'nobody')+' again.':'This correction was already taken back.';
   if(record)await loadRecord();
   await recheck([date],false);
   setNotice(text);setSaid({id:logbookId,text});
  }catch(e){setError(e.message);}
 };
 // "This card is right": the paper card shows the driver the card is saved under. A refusal is said on the line.
 const confirmRight=async row=>{
  setKeeping(true);setError('');setNotice('');setSaid(null);setKept(null);
  try{
   const answer=await api('/api/caliber-recheck/confirm',{method:'POST',body:JSON.stringify({logbookId:row.id})});
   settled(row,Boolean(answer.confirmed));setAsking('');
   await recheck([row.date],false);
  }catch(e){setAsking('');setSaid({id:row.id,text:e.message,bad:true});}
  finally{setKeeping(false);}
 };
 const unconfirm=async(logbookId,date)=>{
  setError('');setKept(null);
  try{await api('/api/caliber-recheck/confirm/'+logbookId,{method:'DELETE'});if(confirmedList)await loadConfirmed();await recheck([date],false);}catch(e){setError(e.message);}
 };
 // Refresh on a line HR settles ("ID not found. Please contact your HR team."): HR Pulse is asked for the saved number
 // now. When HR has added or corrected the person, every card saved under that number is judged again and leaves the
 // list by itself; nothing on a card is changed. Any other answer is said on the card's own line.
 const refreshRow=async row=>{
  setRefreshing(row.id);setError('');setNotice('');setSaid(null);setAsking('');
  try{
   const person=await api('/api/log-books/employee-refresh',{method:'POST',body:JSON.stringify({caliberId:row.savedId,location:row.site,bookDate:row.date,kind:row.kind})});
   const dates=[...new Set(held.listed.filter(card=>card.savedId===row.savedId&&card.siteKey===row.siteKey).map(card=>card.date))].sort();
   await recheck(dates.length?dates:[row.date],false);
   setKept({id:row.id,date:row.date,undo:'',text:'HR Pulse has '+[person.caliberId||row.savedId,person.name||row.savedName].filter(Boolean).join(' · ')+' now. The cards saved under this ID were checked again; the ones that stand have left the list.'});
  }catch(e){setSaid({id:row.id,text:e.message,bad:true});}
  finally{setRefreshing('');}
 };
 const saveShift=async row=>{
  const code=shiftPicks[row.id];
  if(!code){setSaid({id:row.id,text:'Choose the shift from the paper card first.',bad:true});return;}
  setSavingShift(row.id);setError('');setNotice('');setSaid(null);
  try{
   await api('/api/caliber-recheck/shift',{method:'POST',body:JSON.stringify({logbookId:row.id,shift:code})});
   await recheck([row.date],false);
   setKept({id:row.id,date:row.date,undo:'',text:'Card '+row.bookNo+' now names '+(SHIFT_OPTIONS.find(([value])=>value===code)?.[1]||code)+'; its attendance is counted.'});
  }catch(e){setSaid({id:row.id,text:e.message,bad:true});}
  finally{setSavingShift('');}
 };
 const unchoose=async row=>{
  setError('');setNotice('');setSaid(null);
  try{await api('/api/caliber-recheck/pick/'+row.id,{method:'DELETE'});await recheck([row.date],false);}catch(e){setError(e.message);}
 };
 const apply=async()=>{
  setRunning(true);setError('');setNotice('');setRefused([]);
  try{
   const answer=await api('/api/caliber-recheck/apply',{method:'POST',body:'{}'});
   setNotice(count(answer.applied)+' card'+(answer.applied===1?'':'s')+' corrected.'+(answer.refused.length?' '+count(answer.refused.length)+' could not be corrected and still wait; the reason is on each card.':''));
   setRefused(answer.refused);setConfirming(false);setRecord(null);
   // The list is read again; what the run did stays on screen.
   await recheck(recheckDates(from,to),true,true);
  }catch(e){setError(e.message);}
  finally{setRunning(false);}
 };
 const loadRecord=async()=>{try{setRecord((await api('/api/caliber-recheck/record')).corrections);}catch(e){setError(e.message);}};

 const period=dmy(from)+' to '+dmy(to),busy=Boolean(progress);
 const sites=recheckSiteRows(held),picked=sites.total.picked;
 const {site,slot}=open,manySites=site===EVERY;
 const siteCards=site?cardsOfSite(held,site):[],siteLabel=manySites?'All sites':sites.rows.find(row=>row.key===site)?.site||'';
 const slotRows=recheckSlotRows(siteCards,{manySites});
 const grid=dateShiftGrid(slotRows,{sumKeys:['count','picked','open'],lineOf:row=>manySites?siteDateLine(row):dateLine(row)});
 // "Driver chosen" and "Still to choose" belong to the choices that waited for a run. Submit corrects at once now, so
 // these columns, and the run itself, show only while such an earlier choice still waits.
 const dayColumns=[{key:'count',label:'Day cards to check',value:sums=>sums.count},...(picked>0?[{key:'picked',label:'Chosen earlier, waiting',value:sums=>sums.picked},{key:'open',label:'Still to choose',value:sums=>sums.open}]:[])];
 const gridExport=dateShiftExport(grid,{count:row=>row.count,countLabel:'cards to check',dayColumns,shiftLabel:shiftChoiceLabel});
 const cards=slot?cardsOfSlot(siteCards,slot):[];
 const sameSlot=row=>slot&&slot.key!==EVERY&&slot.date===row.date&&slot.shift===row.shift&&(!manySites||slot.siteKey===row.siteKey);
 const go=next=>{setKept(null);setAsking('');setSaid(null);setOpen(next);};
 const openSlot=row=>go({site,slot:row?{key:row.key,date:row.date,shift:row.shift,siteKey:manySites?row.siteKey:'',label:dmy(row.date)+' · '+shiftChoiceLabel(row.shift)+(manySites?' · '+row.site:'')}:{key:EVERY,label:'All dates and shifts'}});
 const crumbs=[['All sites',()=>go({site:'',slot:null})],...(site?[[siteLabel,()=>go({site,slot:null})]]:[]),...(slot?[[slot.label,null]]:[])];
 const back=crumbs.length>1?crumbs.at(-2)[1]:null;
 const level=!site?1:!slot?2:3;

 const siteColumns=[{key:'site',label:'Site',value:row=>row.site},{key:'cards',label:'Cards checked',value:row=>row.cards},{key:'confirmed',label:'Confirmed right (done)',value:row=>row.confirmed},{key:'corrected',label:'Corrected',value:row=>row.corrected},{key:'listed',label:'Cards to check',value:row=>row.listed},
  ...(picked>0?[{key:'picked',label:'Chosen earlier, waiting',value:row=>row.picked},{key:'open',label:'Still to choose',value:row=>row.open}]:[])];
 const right=row=><div className="cr-right">
  {row.pick&&<p className="cr-chosen"><strong>{row.pick.employeeId} · {row.pick.name}</strong><small>chosen earlier by {row.pick.by}, not on the card yet</small>{row.pick.note&&<small className="cr-note" role="alert">Not corrected in the last run: {row.pick.note}</small>}
   <button type="button" onClick={()=>unchoose(row)}>Remove</button></p>}
  {said?.id===row.id&&<small className={'cr-said'+(said.bad?' cr-said-bad':'')} role={said.bad?'alert':'status'}>{said.text}</small>}
  {row.canRefresh&&<div className="employee-id-refresh cr-refresh"><button type="button" className="employee-id-refresh-button" disabled={Boolean(refreshing)||busy} onClick={()=>refreshRow(row)}>{refreshing===row.id?'Checking HR Pulse…':'Refresh'}</button><small>{REFRESH_HINT}</small></div>}
  {row.pickShift&&<div className="cr-shift" role="group" aria-label={'Shift of card '+row.bookNo}>
   <select aria-label="Shift from the paper card" value={shiftPicks[row.id]||''} disabled={savingShift===row.id} onChange={event=>setShiftPicks(current=>({...current,[row.id]:event.target.value}))}><option value="">Select shift</option>{SHIFT_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
   <button type="button" className="cr-keep-yes" disabled={Boolean(savingShift)||busy} onClick={()=>saveShift(row)}>{savingShift===row.id?'Saving…':'Save shift'}</button>
  </div>}
  {!row.pickShift&&<EmployeeIdLookup key={row.id+'|'+(row.pick?.id||'')} submitLabel="Submit" scanMode submitHint="to put this person on the card" token={session.token} location={row.site} bookDate={row.date} role={row.kind==='equipment'?'operator':'driver'} card={{door:row.door,cardNo:row.cardNo,book:row.bookNo}} onResolved={employee=>choose(row,employee)}/>}
  {row.canConfirm&&(asking===row.id
   ?<div className="cr-keep-ask" role="group" aria-label="Confirm that this card is right"><small>Does the paper card show {row.savedId} · {row.savedName}?</small>
     <button type="button" className="cr-keep-yes" disabled={keeping} onClick={()=>confirmRight(row)}>{keeping?'Saving…':'Yes, '+(row.savedName||row.savedId)+(row.kind==='equipment'?' operated this machine':' drove this vehicle')}</button>
     <button type="button" disabled={keeping} onClick={()=>setAsking('')}>No</button></div>
   :<button type="button" className="cr-keep" onClick={()=>{setSaid(null);setAsking(row.id);}}>This card is right</button>)}
 </div>;
 const cardColumns=[...(manySites||slot?.key===EVERY?[{key:'where',label:'Site · date · shift',value:row=>(manySites?row.site+' · ':'')+dmy(row.date)+' · '+shiftChoiceLabel(row.shift)}]:[]),
  {key:'bookNo',label:'Book NO',value:row=>row.bookNo},{key:'door',label:'Vehicle / machine',value:row=>row.door},{key:'cardNo',label:'Card NO',value:row=>row.cardNo},
  {key:'saved',label:'Saved under',value:row=>row.savedId+' '+row.savedName,render:row=><><strong>{row.savedId}</strong><small className="cr-sub">{row.savedName}</small></>},
  {key:'why',label:'Why it is listed',value:row=>row.reasonLabel+'. '+row.line,render:row=><><strong>{row.reasonLabel}</strong><small className="cr-sub">{row.line}</small></>},
  {key:'alike',label:'Look-alike IDs at the site',value:lookAlikeText},
  {key:'right',label:'Right driver (from the paper card)',value:row=>row.pick?row.pick.employeeId+' '+row.pick.name:'',render:right},
  {key:'scan',label:'Trip Card Scanned',value:row=>row.scanCardId?'Original card available':'Not available',render:row=>row.scanCardId?<button type="button" className="cr-view-card" onClick={()=>setPreviewCard(row)}>View Original Card</button>:<span className="cr-card-unavailable">Not available</span>}];

 if(embedded&&refusedAccess)return null;
 return <section className={'caliber-recheck'+(embedded?' cr-embedded':'')} {...(embedded?{'aria-label':'Caliber ID re-check','data-print-title':'Caliber ID Re-check','data-print-subtitle':'Cards checked, confirmed right, corrected and still to check, site by site','data-print-note':period}:{})}>
  {embedded&&<div className="cr-compact" data-print-hide="">
   <h2>Caliber ID Re-check</h2>
   <span className="cr-asof">{busy?'':asOf?'As on '+when(asOf):''}</span>
   <button type="button" disabled={busy} onClick={()=>void recheck()} title="Read every day again from the server">Refresh</button>
   {onOpenPage&&<button type="button" className="cr-open-page" onClick={onOpenPage} title="The full page: dates, the Excel list, Corrections done and Cards confirmed right">Open Caliber ID Re-check</button>}
  </div>}
  {!embedded&&<header className="cr-head">
   <div><h1>Caliber ID Re-check</h1>
    <p>Every saved card is judged again against Employee Master, at its own site and date. A card is listed when its driver or operator is not a working driver or operator of that site on that date. Type the right number from the paper card and press Submit on that line: the card is corrected at once and leaves the list. A line that says ID not found is for HR: contact your HR team, and press Refresh on that line once HR has added the ID in HR Pulse.</p></div>
   <form className="cr-period" onSubmit={event=>{event.preventDefault();void recheck();}}>
    <label>From<input type="date" min={OPERATIONAL_START} max={to} value={from} disabled={busy} onChange={event=>setFrom(event.target.value)}/></label>
    <label>To<input type="date" min={from} max={todayInIndia()} value={to} disabled={busy} onChange={event=>setTo(event.target.value)}/></label>
    <button disabled={busy||!from||!to}>Re-check</button>
   </form>
  </header>}
  {/* On the dashboard the line starts with "Reading": All in the Sr No strip waits for a report that says so. */}
  {progress&&<p role="status" className="cr-progress">{embedded?'Reading the Caliber ID re-check: day ':'Re-checking day '}{progress.done+1} of {progress.total}…</p>}
  {error&&<p className="cr-error" role="alert">{error}</p>}
  {notice&&<p className="cr-notice" role="status">{notice}</p>}
  {refused.length>0&&<ul className="cr-refused">{refused.map((row,i)=><li key={i}><strong>{row.bookNo}</strong>: {row.why}</li>)}</ul>}
  {!embedded&&<><div className="cr-summary" aria-label="Summary">
   <span><strong>{count(held.cards)}</strong> cards checked</span><span><strong>{count(sites.total.listed)}</strong> to check</span><span><strong>{count(held.confirmed)}</strong> confirmed right</span><span><strong>{count(held.corrected)}</strong> corrected</span>{picked>0&&<span><strong>{count(picked)}</strong> chosen earlier, waiting for the run</span>}
   {reasonCounts(held.listed).map(row=><span key={row.reason} className="cr-reason">{row.label}: <strong>{count(row.count)}</strong></span>)}
  </div>
  <div className="cr-actions">
   <button type="button" disabled={busy||!held.listed.length} onClick={()=>downloadBlob(buildXlsxSheetsWorkbook('Caliber ID re-check: cards to check',recheckListSheets(held.listed)),`Caliber-ID-re-check-${from}-to-${to}.xlsx`,{title:'Caliber ID re-check: cards to check'})}>Download the list (Excel)</button>
   {held.canApply&&picked>0&&!confirming&&<button type="button" className="cr-run" disabled={busy||running} onClick={()=>setConfirming(true)}>Run the corrections ({count(picked)})</button>}
   {held.canApply&&picked>0&&confirming&&<span className="cr-confirm">This puts the chosen driver on {count(picked)} saved card{picked===1?'':'s'}, in closed and locked batches too. Each card keeps who was on it before.
    <button type="button" className="cr-run" disabled={running} onClick={apply}>{running?'Correcting…':'Yes, correct '+count(picked)+' card'+(picked===1?'':'s')+' now'}</button><button type="button" disabled={running} onClick={()=>setConfirming(false)}>Not now</button></span>}
  </div></>}

  {(!embedded||level>1)&&<nav className="tt-crumbs" aria-label="Steps" {...(embedded?{'data-print-hide':''}:{})}>{back&&<StepBackButton onBack={back} label={'Back to '+crumbs.at(-2)[0]}/>}{crumbs.map(([label,go],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{go&&i<crumbs.length-1?<button type="button" onClick={go}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>}
  <ReportSection key="cr-sites" reportKey="Caliber ID re-check sites" title={'Step 1 · Caliber ID re-check · All sites · '+period} category="caliber-recheck-sites" dataReady={!busy} recordDateFilter={false}
   description="One line per site: the cards checked and the cards whose driver or operator does not stand. Press a site to see it date by date and shift by shift; press All sites for every site together."
   rows={sites.rows.length?[...sites.rows,sites.total]:[]} columns={siteColumns} rowKey={row=>row.id} rowClassName={row=>(row.total?'tt-total':'')+(site&&row.key===site?' report-row-picked':'')} isTotalRow={isTotal}
   onRowClick={row=>go({site:row.key,slot:null})} emptyMessage={busy?'Re-checking…':'No saved card in these dates.'}/>
  {level>=2&&<ReportSection key={'cr-slots-'+site} reportKey="Caliber ID re-check date by shift" title={'Step 2 · Caliber ID re-check · '+siteLabel+' · date by shift · '+period} category="caliber-recheck-shifts" dataReady={!busy}
   description="The cards to check of each date and shift. Press a box for the cards of that shift, or the All dates line for every date and shift together."
   rows={gridExport.rows} columns={gridExport.columns} rowKey={row=>row.id} showSearch={false} recordDateFilter={false}>
   <DateShiftGrid grid={grid} count={row=>row.count} countLabel="cards to check" dayColumns={dayColumns} shiftLabel={shiftChoiceLabel} onOpen={row=>openSlot(row)} onOpenAll={()=>openSlot(null)}
    isPicked={sameSlot} allPicked={slot?.key===EVERY} ariaLabel="Cards to check by date and shift" emptyMessage="No card to check at this site in these dates."/>
  </ReportSection>}
  {level>=3&&kept&&<p className="cr-notice cr-kept" role="status"><span>{kept.text}</span>{kept.undo&&<button type="button" onClick={()=>kept.undo==='correction'?uncorrect(kept.correctionId,kept.date,kept.id):unconfirm(kept.id,kept.date)}>Undo</button>}</p>}
  {level>=3&&<ReportSection key={'cr-cards-'+site+'|'+slot.key} reportKey="Caliber ID re-check cards" title={'Step 3 · Caliber ID re-check · '+siteLabel+' · '+slot.label} category="caliber-recheck-cards" dataReady={!busy} recordDateFilter={false}
   description="One line per card. Type the right Employee ID or Caliber ID from the paper card, see the name shown under it and press Submit on that line; a look-alike ID of the site is the likeliest. A line listed for its FORM A box also has This card is right: press it when the paper card shows the saved driver. A line that says ID not found, or that the person has left, has Refresh: it asks HR Pulse for that ID now, and the card leaves the list once HR has it as working. Submit corrects the card at once and its line leaves the list; Undo, on the line shown above this table, puts the earlier person back. Manual and scanned cards that mark no attendance are listed too: a card with no driver, or whose Employee ID and Caliber ID differ, takes the right person by Submit; a card with no shift (or two) takes its shift by Save shift."
   rows={cards} columns={cardColumns} rowKey={row=>row.id} rowClassName={row=>row.pick?'cr-picked':''} emptyMessage="No card to check in this date and shift."/>}
  {previewCard&&<OriginalCardPreview card={previewCard} token={session.token} onClose={()=>setPreviewCard(null)}/>}

  {!embedded&&<><details className="cr-record" onToggle={event=>{if(event.currentTarget.open&&!record)void loadRecord();}}>
   <summary>Corrections done{record?` (${count(record.length)})`:''}</summary>
   <p>Every card that was corrected: who it was under, who it is under now, who corrected it and when. Undo puts the earlier person back on the card, and the card is listed again.</p>
   {record&&!record.length&&<p>No card has been corrected yet.</p>}
   {record&&record.length>0&&<><button type="button" onClick={()=>downloadBlob(buildXlsxSheetsWorkbook('Caliber ID re-check: corrections done',recheckRecordSheets(record)),`Caliber-ID-corrections-${todayInIndia()}.xlsx`,{title:'Caliber ID re-check: corrections done'})}>Download the record (Excel)</button>
    <div className="cr-record-table"><table><thead><tr>{['Site','Date','Book NO','Why','Was under','Now under','Chosen by','Corrected by','Corrected on','Take back'].map(label=><th key={label}>{label}</th>)}</tr></thead>
     <tbody>{record.map(row=><tr key={row.id}><td>{row.site}</td><td>{dmy(row.date)}</td><td>{row.bookNo}</td><td>{row.reason}</td><td>{row.from} {row.fromName}</td><td>{row.to} {row.toName}</td><td>{row.pickedBy}</td><td>{row.appliedBy}</td><td>{when(row.appliedAt)}</td><td><button type="button" onClick={()=>uncorrect(row.id,row.date,row.logbookId)}>Undo</button></td></tr>)}</tbody></table></div></>}
  </details>
  <details className="cr-record" onToggle={event=>{if(event.currentTarget.open&&!confirmedList)void loadConfirmed();}}>
   <summary>Cards confirmed right{confirmedList?` (${count(confirmedList.length)})`:held.confirmed?` (${count(held.confirmed)})`:''}</summary>
   <p>Every card a person confirmed from the paper card: the driver it is saved under stays on it. Undo puts the card back on the list.</p>
   {confirmedList&&!confirmedList.length&&<p>No card has been confirmed yet.</p>}
   {confirmedList&&confirmedList.length>0&&<><button type="button" onClick={()=>downloadBlob(buildXlsxSheetsWorkbook('Caliber ID re-check: cards confirmed right',recheckConfirmedSheets(confirmedList)),`Caliber-ID-confirmed-right-${todayInIndia()}.xlsx`,{title:'Caliber ID re-check: cards confirmed right'})}>Download the list (Excel)</button>
    <div className="cr-record-table"><table><thead><tr>{['Site','Date','Book NO','Driver kept on the card','FORM A box names','Confirmed by','Confirmed on','Take back'].map(label=><th key={label}>{label}</th>)}</tr></thead>
     <tbody>{confirmedList.map(row=><tr key={row.id}><td>{row.site}</td><td>{dmy(row.date)}</td><td>{row.bookNo}</td><td>{row.driver} {row.driverName}</td><td>{row.formA?row.formA+': ':''}{row.namedId} {row.namedName}</td><td>{row.by}</td><td>{when(row.at)}</td><td><button type="button" onClick={()=>unconfirm(row.logbookId,row.date)}>Undo</button></td></tr>)}</tbody></table></div></>}
  </details></>}
 </section>;
}
