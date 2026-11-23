// Caliber ID Re-check (owner, 22 Nov 2026): every saved card since 1 Nov judged again against Employee Master, the
// site names the right driver for each listed card, and one correction run puts those drivers on their cards.
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
import {EVERY,dmy,when,todayInIndia,recheckDates,emptyRecheck,addRecheckAnswer,recheckSiteRows,cardsOfSite,recheckSlotRows,cardsOfSlot,lookAlikeText,reasonCounts,recheckListSheets,recheckRecordSheets,recheckConfirmedSheets} from './caliber-recheck-model.mjs';
import './caliber-recheck.css';

const count=value=>Number(value||0).toLocaleString('en-IN');
const isTotal=row=>Boolean(row.total);

export default function CaliberRecheck({session,ReportSection}){
 const [from,setFrom]=useState(OPERATIONAL_START),[to,setTo]=useState(todayInIndia());
 const [held,setHeld]=useState(emptyRecheck),[progress,setProgress]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [open,setOpen]=useState({site:'',slot:null}),[confirming,setConfirming]=useState(false),[running,setRunning]=useState(false),[refused,setRefused]=useState([]),[record,setRecord]=useState(null);
 // What the last Submit did, said on its own line: the page's notices are far above Step 3.
 const [said,setSaid]=useState(null);
 // "This card is right" (owner, 23 Nov 2026): the line being asked "Yes, … drove this vehicle", the card just
 // settled (said above Step 3 with Undo, because a confirmed line leaves the list), and the confirmed cards for HR.
 const [asking,setAsking]=useState(''),[keeping,setKeeping]=useState(false),[kept,setKept]=useState(null),[confirmedList,setConfirmedList]=useState(null);
 const run=useRef(0);
 const api=async(path,options={})=>{
  const response=await fetch(path,{...options,headers:{Authorization:`Bearer ${session.token}`,...(options.body?{'Content-Type':'application/json'}:{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'The re-check is unavailable.');
  return body;
 };
 // Every date of the period, one after the other. A newer run, or leaving the page, stops an older one.
 // Reading one date again after a Submit (fresh = false) is not a newer run: it must not stop a full read that is
 // still going, or the list would end at the date it had reached.
 const recheck=async(dates=recheckDates(from,to),fresh=true,keepMessages=false)=>{
  const mine=fresh?++run.current:run.current;
  setError('');if(fresh){setSaid(null);setKept(null);setAsking('');setHeld(emptyRecheck());setOpen({site:'',slot:null});if(!keepMessages){setNotice('');setRefused([]);}}
  try{
   for(let i=0;i<dates.length;i++){
    if(run.current!==mine)return;
    if(fresh)setProgress({done:i,total:dates.length});
    const answer=await api('/api/caliber-recheck?from='+dates[i]+'&to='+dates[i]);
    if(run.current!==mine)return;
    setHeld(now=>addRecheckAnswer(now,answer));
   }
  }catch(e){if(run.current===mine)setError(e.message);}
  finally{if(fresh&&run.current===mine)setProgress(null);}
 };
 useEffect(()=>{void recheck();return()=>{run.current++};},[]);

 const loadConfirmed=async()=>{try{setConfirmedList((await api('/api/caliber-recheck/confirmed')).confirmed);}catch(e){setError(e.message);}};
 // A card that leaves the list: said above Step 3, where its line was. Undo is offered for a confirmation.
 const settled=(row,confirmed)=>{
  setKept({id:row.id,date:row.date,undo:confirmed,text:confirmed?'Card '+row.bookNo+' confirmed right: '+row.savedId+' · '+row.savedName+' stays on it. The card has left the list.':'Card '+row.bookNo+' stands now, so it has left the list.'});
  if(confirmedList)void loadConfirmed();
 };
 // Submit on a card's line. A refusal is thrown back to the Fetch box, which says it on that line.
 // The saved driver's own number is the same answer as "This card is right".
 const choose=async(row,employee)=>{
  setError('');setNotice('');setSaid(null);setKept(null);setAsking('');
  const answer=await api('/api/caliber-recheck/pick',{method:'POST',body:JSON.stringify({logbookId:row.id,employeeId:employee.id})});
  if(answer.same&&answer.confirmed)settled(row,true);
  else{
   setNotice(answer.same?employee.name+' is the person already on card '+row.bookNo+'. Nothing to correct on it.':employee.name+' · '+employee.caliberId+' chosen for card '+row.bookNo+'. The card changes when the corrections are run.');
   setSaid({id:row.id,text:answer.same?employee.name+' is the person already on this card. Nothing to correct on it.':'Submitted. The card changes when the corrections are run.'});
  }
  await recheck([row.date],false);
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
 const dayColumns=[{key:'count',label:'Day cards to check',value:sums=>sums.count},{key:'picked',label:'Driver chosen',value:sums=>sums.picked},{key:'open',label:'Still to choose',value:sums=>sums.open}];
 const gridExport=dateShiftExport(grid,{count:row=>row.count,countLabel:'cards to check',dayColumns,shiftLabel:shiftChoiceLabel});
 const cards=slot?cardsOfSlot(siteCards,slot):[];
 const sameSlot=row=>slot&&slot.key!==EVERY&&slot.date===row.date&&slot.shift===row.shift&&(!manySites||slot.siteKey===row.siteKey);
 const go=next=>{setKept(null);setAsking('');setSaid(null);setOpen(next);};
 const openSlot=row=>go({site,slot:row?{key:row.key,date:row.date,shift:row.shift,siteKey:manySites?row.siteKey:'',label:dmy(row.date)+' · '+shiftChoiceLabel(row.shift)+(manySites?' · '+row.site:'')}:{key:EVERY,label:'All dates and shifts'}});
 const crumbs=[['All sites',()=>go({site:'',slot:null})],...(site?[[siteLabel,()=>go({site,slot:null})]]:[]),...(slot?[[slot.label,null]]:[])];
 const back=crumbs.length>1?crumbs.at(-2)[1]:null;
 const level=!site?1:!slot?2:3;

 const siteColumns=[{key:'site',label:'Site',value:row=>row.site},{key:'cards',label:'Cards checked',value:row=>row.cards},{key:'confirmed',label:'Confirmed right',value:row=>row.confirmed},{key:'listed',label:'Cards to check',value:row=>row.listed},
  {key:'picked',label:'Driver chosen',value:row=>row.picked},{key:'open',label:'Still to choose',value:row=>row.open}];
 const right=row=><div className="cr-right">
  {row.pick&&<p className="cr-chosen"><strong>{row.pick.employeeId} · {row.pick.name}</strong><small>chosen by {row.pick.by}</small>{row.pick.note&&<small className="cr-note" role="alert">Not corrected in the last run: {row.pick.note}</small>}
   <button type="button" onClick={()=>unchoose(row)}>Remove</button></p>}
  {said?.id===row.id&&<small className={'cr-said'+(said.bad?' cr-said-bad':'')} role={said.bad?'alert':'status'}>{said.text}</small>}
  <EmployeeIdLookup key={row.id+'|'+(row.pick?.id||'')} submitLabel="Submit" scanMode token={session.token} location={row.site} bookDate={row.date} role={row.kind==='equipment'?'operator':'driver'} card={{door:row.door,cardNo:row.cardNo,book:row.bookNo}} onResolved={employee=>choose(row,employee)}/>
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
  {key:'right',label:'Right driver (from the paper card)',value:row=>row.pick?row.pick.employeeId+' '+row.pick.name:'',render:right}];

 return <section className="caliber-recheck">
  <header className="cr-head">
   <div><h1>Caliber ID Re-check</h1>
    <p>Every saved card is judged again against Employee Master, at its own site and date. A card is listed when its driver or operator is not a working driver or operator of that site on that date. Type the right number from the paper card and press Submit on that line; the cards change together when the corrections are run.</p></div>
   <form className="cr-period" onSubmit={event=>{event.preventDefault();void recheck();}}>
    <label>From<input type="date" min={OPERATIONAL_START} max={to} value={from} disabled={busy} onChange={event=>setFrom(event.target.value)}/></label>
    <label>To<input type="date" min={from} max={todayInIndia()} value={to} disabled={busy} onChange={event=>setTo(event.target.value)}/></label>
    <button disabled={busy||!from||!to}>Re-check</button>
   </form>
  </header>
  {progress&&<p role="status" className="cr-progress">Re-checking day {progress.done+1} of {progress.total}…</p>}
  {error&&<p className="cr-error" role="alert">{error}</p>}
  {notice&&<p className="cr-notice" role="status">{notice}</p>}
  {refused.length>0&&<ul className="cr-refused">{refused.map((row,i)=><li key={i}><strong>{row.bookNo}</strong>: {row.why}</li>)}</ul>}
  <div className="cr-summary" aria-label="Summary">
   <span><strong>{count(held.cards)}</strong> cards checked</span><span><strong>{count(sites.total.listed)}</strong> to check</span><span><strong>{count(held.confirmed)}</strong> confirmed right</span><span><strong>{count(picked)}</strong> with the right driver chosen</span>
   {reasonCounts(held.listed).map(row=><span key={row.reason} className="cr-reason">{row.label}: <strong>{count(row.count)}</strong></span>)}
  </div>
  <div className="cr-actions">
   <button type="button" disabled={busy||!held.listed.length} onClick={()=>downloadBlob(buildXlsxSheetsWorkbook('Caliber ID re-check: cards to check',recheckListSheets(held.listed)),`Caliber-ID-re-check-${from}-to-${to}.xlsx`,{title:'Caliber ID re-check: cards to check'})}>Download the list (Excel)</button>
   {held.canApply&&!confirming&&<button type="button" className="cr-run" disabled={busy||running||!picked} onClick={()=>setConfirming(true)}>Run the corrections ({count(picked)})</button>}
   {held.canApply&&confirming&&<span className="cr-confirm">This puts the chosen driver on {count(picked)} saved card{picked===1?'':'s'}, in closed and locked batches too. Each card keeps who was on it before.
    <button type="button" className="cr-run" disabled={running} onClick={apply}>{running?'Correcting…':'Yes, correct '+count(picked)+' card'+(picked===1?'':'s')+' now'}</button><button type="button" disabled={running} onClick={()=>setConfirming(false)}>Not now</button></span>}
  </div>

  <nav className="tt-crumbs" aria-label="Steps">{back&&<StepBackButton onBack={back} label={'Back to '+crumbs.at(-2)[0]}/>}{crumbs.map(([label,go],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{go&&i<crumbs.length-1?<button type="button" onClick={go}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>
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
  {level>=3&&kept&&<p className="cr-notice cr-kept" role="status"><span>{kept.text}</span>{kept.undo&&<button type="button" onClick={()=>unconfirm(kept.id,kept.date)}>Undo</button>}</p>}
  {level>=3&&<ReportSection key={'cr-cards-'+site+'|'+slot.key} reportKey="Caliber ID re-check cards" title={'Step 3 · Caliber ID re-check · '+siteLabel+' · '+slot.label} category="caliber-recheck-cards" dataReady={!busy} recordDateFilter={false}
   description="One line per card. Type the right Employee ID or Caliber ID from the paper card, see the name shown under it and press Submit on that line; a look-alike ID of the site is the likeliest. A line listed for its FORM A box also has This card is right: press it when the paper card shows the saved driver. The card is not changed here: it changes when the corrections are run."
   rows={cards} columns={cardColumns} rowKey={row=>row.id} rowClassName={row=>row.pick?'cr-picked':''} emptyMessage="No card to check in this date and shift."/>}

  <details className="cr-record" onToggle={event=>{if(event.currentTarget.open&&!record)void loadRecord();}}>
   <summary>Corrections done{record?` (${count(record.length)})`:''}</summary>
   <p>Every card the correction run changed: who it was under, who it is under now, who chose the driver and who ran the correction.</p>
   {record&&!record.length&&<p>No card has been corrected yet.</p>}
   {record&&record.length>0&&<><button type="button" onClick={()=>downloadBlob(buildXlsxSheetsWorkbook('Caliber ID re-check: corrections done',recheckRecordSheets(record)),`Caliber-ID-corrections-${todayInIndia()}.xlsx`,{title:'Caliber ID re-check: corrections done'})}>Download the record (Excel)</button>
    <div className="cr-record-table"><table><thead><tr>{['Site','Date','Book NO','Why','Was under','Now under','Chosen by','Corrected by','Corrected on'].map(label=><th key={label}>{label}</th>)}</tr></thead>
     <tbody>{record.map(row=><tr key={row.id}><td>{row.site}</td><td>{dmy(row.date)}</td><td>{row.bookNo}</td><td>{row.reason}</td><td>{row.from} {row.fromName}</td><td>{row.to} {row.toName}</td><td>{row.pickedBy}</td><td>{row.appliedBy}</td><td>{when(row.appliedAt)}</td></tr>)}</tbody></table></div></>}
  </details>
  <details className="cr-record" onToggle={event=>{if(event.currentTarget.open&&!confirmedList)void loadConfirmed();}}>
   <summary>Cards confirmed right{confirmedList?` (${count(confirmedList.length)})`:held.confirmed?` (${count(held.confirmed)})`:''}</summary>
   <p>Every card a person confirmed from the paper card: the driver it is saved under stays on it. Undo puts the card back on the list.</p>
   {confirmedList&&!confirmedList.length&&<p>No card has been confirmed yet.</p>}
   {confirmedList&&confirmedList.length>0&&<><button type="button" onClick={()=>downloadBlob(buildXlsxSheetsWorkbook('Caliber ID re-check: cards confirmed right',recheckConfirmedSheets(confirmedList)),`Caliber-ID-confirmed-right-${todayInIndia()}.xlsx`,{title:'Caliber ID re-check: cards confirmed right'})}>Download the list (Excel)</button>
    <div className="cr-record-table"><table><thead><tr>{['Site','Date','Book NO','Driver kept on the card','FORM A box names','Confirmed by','Confirmed on','Take back'].map(label=><th key={label}>{label}</th>)}</tr></thead>
     <tbody>{confirmedList.map(row=><tr key={row.id}><td>{row.site}</td><td>{dmy(row.date)}</td><td>{row.bookNo}</td><td>{row.driver} {row.driverName}</td><td>{row.formA?row.formA+': ':''}{row.namedId} {row.namedName}</td><td>{row.by}</td><td>{when(row.at)}</td><td><button type="button" onClick={()=>unconfirm(row.logbookId,row.date)}>Undo</button></td></tr>)}</tbody></table></div></>}
  </details>
 </section>;
}
