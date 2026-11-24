// Caliber Punch Re-check (owner, 24 Nov 2026: "caliber punch recheck mis me hi, caliber id recheck ke niche"):
// Masters, under Caliber ID Re-check. The drivers and operators who punched on the biometric machine but get no
// attendance from a card, because a VLB, ELB or LMV card of their site and date has an error. Each person is set
// beside those cards, their own card first, and the card is put right on the same line: Submit puts the person on
// the card, Save shift writes the shift of the person's own card, Refresh asks HR Pulse about the person's ID. Undo
// takes a Submit back. Everything goes through the Caliber ID Re-check routes (server/routes/caliber-recheck.mjs).
//
// Drawn in the owner's report steps: Step 1 one line per site, Step 2 that site date by shift, Step 3 the people of
// the date and shift opened. The screen asks the server day by day. Rule: shared/caliber-punch-recheck.mjs.
import React,{useEffect,useRef,useState} from 'react';
import {DateShiftGrid,dateShiftGrid,dateShiftExport,dateLine,siteDateLine} from './date-shift-grid.jsx';
import {StepBackButton} from './step-back.jsx';
import {shiftChoiceLabel} from '../shared/report-filter-options.mjs';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {REFRESH_HINT} from '../shared/caliber-id-check.mjs';
import {dmy,todayInIndia,recheckDates} from './caliber-recheck-model.mjs';
import {EVERY,punchDefaultRange,emptyPunchRecheck,addPunchAnswer,punchSiteRows,linesOfSite,punchSlotRows,linesOfSlot,firstCard,cardAction,cardOption} from './caliber-punch-recheck-model.mjs';
import './caliber-recheck.css';

const count=value=>Number(value||0).toLocaleString('en-IN');
const SHIFT_OPTIONS=[['S1','Shift I'],['S2','Shift II'],['S3','Shift III'],['D','Day (12 Hrs)'],['N','Night (12 Hrs)']];
const SOURCE={machine:'Machine','imported':'Imported','machine+imported':'Machine + imported'};
const isTotal=row=>Boolean(row.total);

export default function CaliberPunchRecheck({session,ReportSection}){
 const [range,setRange]=useState(()=>punchDefaultRange(todayInIndia()));
 const [held,setHeld]=useState(emptyPunchRecheck),[progress,setProgress]=useState(null),[error,setError]=useState('');
 const [open,setOpen]=useState({site:'',slot:null});
 // Per line: the card chosen, the shift chosen; the line being saved; what the last action said, on its line or above Step 3.
 const [chosen,setChosen]=useState({}),[shiftPicks,setShiftPicks]=useState({}),[working,setWorking]=useState(''),[said,setSaid]=useState(null),[kept,setKept]=useState(null);
 const run=useRef(0);
 const api=async(path,options={})=>{
  const response=await fetch(path,{...options,headers:{Authorization:`Bearer ${session.token}`,...(options.body?{'Content-Type':'application/json'}:{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(body.error||'The punch re-check is unavailable.'),{status:response.status});
  return body;
 };
 // Every date of the period, one after the other. Reading one date again after a change (fresh = false) does not
 // stop a full read that is still going.
 const recheck=async(dates=recheckDates(range.from,range.to),fresh=true)=>{
  const mine=fresh?++run.current:run.current;
  setError('');if(fresh){setHeld(emptyPunchRecheck());setOpen({site:'',slot:null});setSaid(null);setKept(null);}
  try{
   for(let i=0;i<dates.length;i++){
    if(run.current!==mine)return;
    if(fresh)setProgress({done:i,total:dates.length});
    const answer=await api('/api/caliber-recheck/punches?from='+dates[i]+'&to='+dates[i]);
    if(run.current!==mine)return;
    setHeld(now=>addPunchAnswer(now,answer));
   }
  }catch(e){if(run.current===mine)setError(e.message);}
  finally{if(fresh&&run.current===mine)setProgress(null);}
 };
 useEffect(()=>{void recheck();return()=>{run.current++};},[]);

 const cardOf=line=>line.cards.find(card=>card.id===(chosen[line.id]||firstCard(line)))||line.cards[0];
 const act=async(line,fn)=>{
  setWorking(line.id);setError('');setSaid(null);setKept(null);
  try{await fn();}catch(e){setSaid({id:line.id,text:e.message,bad:true});}
  finally{setWorking('');}
 };
 // Submit: this person goes on the chosen card at once; the card keeps who was on it before, and Undo puts them back.
 const submit=line=>act(line,async()=>{
  const card=cardOf(line);
  const answer=await api('/api/caliber-recheck/pick',{method:'POST',body:JSON.stringify({logbookId:card.id,employeeId:line.rowId})});
  await recheck([line.date],false);
  if(answer.corrected){
   const made=answer.correction;
   setKept({id:line.id,date:line.date,correctionId:made.id,logbookId:card.id,text:'Card '+made.bookNo+' is now under '+made.to+' · '+made.toName+(made.from?' (was under '+[made.from,made.fromName].filter(Boolean).join(' · ')+')':'')+'.'+(answer.still?' It is still listed: '+answer.still:' Its attendance is counted.')});
  }else setKept({id:line.id,date:line.date,text:line.name+' is already on card '+card.bookNo+'.'+(answer.confirmed?' The card was confirmed right.':'')});
 });
 const saveShift=line=>{
  const code=shiftPicks[line.id];
  if(!code){setSaid({id:line.id,text:'Choose the shift from the paper card first.',bad:true});return;}
  return act(line,async()=>{
   const card=cardOf(line);
   await api('/api/caliber-recheck/shift',{method:'POST',body:JSON.stringify({logbookId:card.id,shift:code})});
   await recheck([line.date],false);
   setKept({id:line.id,date:line.date,text:'Card '+card.bookNo+' now names '+(SHIFT_OPTIONS.find(([value])=>value===code)?.[1]||code)+'; the attendance of '+line.name+' is counted.'});
  });
 };
 const refresh=line=>act(line,async()=>{
  const card=cardOf(line);
  const person=await api('/api/log-books/employee-refresh',{method:'POST',body:JSON.stringify({caliberId:card.savedId,location:card.site,bookDate:card.date,kind:card.kind})});
  await recheck([line.date],false);
  setKept({id:line.id,date:line.date,text:'HR Pulse has '+[person.caliberId||card.savedId,person.name||card.savedName].filter(Boolean).join(' · ')+' now; the cards of this date were checked again.'});
 });
 const undo=async()=>{
  const {correctionId,date}=kept;setKept(null);setError('');
  try{
   const answer=await api('/api/caliber-recheck/correction/'+correctionId,{method:'DELETE'});
   await recheck([date],false);
   setKept({id:'',date,text:answer.removed?'Taken back: card '+answer.card.bookNo+' is under '+([answer.card.employeeId,answer.card.name].filter(Boolean).join(' · ')||'nobody')+' again.':'This change was already taken back.'});
  }catch(e){setError(e.message);}
 };

 const period=dmy(range.from)+' to '+dmy(range.to),busy=Boolean(progress);
 const sites=punchSiteRows(held);
 const {site,slot}=open,manySites=site===EVERY;
 const siteLines=site?linesOfSite(held,site):[],siteLabel=manySites?'All sites':sites.rows.find(row=>row.key===site)?.site||'';
 const grid=dateShiftGrid(punchSlotRows(siteLines,{manySites}),{sumKeys:['count','own'],lineOf:row=>manySites?siteDateLine(row):dateLine(row)});
 const dayColumns=[{key:'count',label:'Day people to fix',value:sums=>sums.count},{key:'own',label:'With their own card',value:sums=>sums.own}];
 const gridExport=dateShiftExport(grid,{count:row=>row.count,countLabel:'people to fix',dayColumns,shiftLabel:shiftChoiceLabel});
 const lines=slot?linesOfSlot(siteLines,slot):[];
 const sameSlot=row=>slot&&slot.key!==EVERY&&slot.date===row.date&&slot.shift===row.shift&&(!manySites||slot.siteKey===row.siteKey);
 const go=next=>{setKept(null);setSaid(null);setOpen(next);};
 const openSlot=row=>go({site,slot:row?{key:row.key,date:row.date,shift:row.shift,siteKey:manySites?row.siteKey:'',label:dmy(row.date)+' · '+shiftChoiceLabel(row.shift)+(manySites?' · '+row.site:'')}:{key:EVERY,label:'All dates and shifts'}});
 const crumbs=[['All sites',()=>go({site:'',slot:null})],...(site?[[siteLabel,()=>go({site,slot:null})]]:[]),...(slot?[[slot.label,null]]:[])];
 const back=crumbs.length>1?crumbs.at(-2)[1]:null;
 const level=!site?1:!slot?2:3;

 const siteColumns=[{key:'site',label:'Site',value:row=>row.site},{key:'punched',label:'Drivers / operators punched',value:row=>row.punched},{key:'counted',label:'Attendance from a card',value:row=>row.counted},
  {key:'toFix',label:'To fix here (a card has an error)',value:row=>row.toFix},{key:'noCard',label:'Punched, no card at all',value:row=>row.noCard}];
 const action=line=>{
  const card=cardOf(line),kind=cardAction(line,card),busyLine=working===line.id;
  return <div className="cr-right">
   {line.cards.length>1&&<select style={{width:'100%',maxWidth:'20rem'}} aria-label={'Card for '+line.name} value={card?.id||''} disabled={busyLine} onChange={event=>{setSaid(null);setChosen(now=>({...now,[line.id]:event.target.value}));}}>
    {line.cards.map(one=><option key={one.id} value={one.id}>{cardOption(one)}</option>)}</select>}
   {said?.id===line.id&&<small className={'cr-said'+(said.bad?' cr-said-bad':'')} role={said.bad?'alert':'status'}>{said.text}</small>}
   {kind==='submit'&&<button type="button" className="cr-keep-yes" disabled={Boolean(working)||busy} onClick={()=>submit(line)}>{busyLine?'Saving…':'Submit: put '+(line.name||line.caliberId)+' on card '+card.bookNo}</button>}
   {kind==='shift'&&<div className="cr-shift" role="group" aria-label={'Shift of card '+card.bookNo}>
    <select aria-label="Shift from the paper card" value={shiftPicks[line.id]||''} disabled={busyLine} onChange={event=>setShiftPicks(now=>({...now,[line.id]:event.target.value}))}><option value="">Select shift</option>{SHIFT_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
    <button type="button" className="cr-keep-yes" disabled={Boolean(working)||busy} onClick={()=>saveShift(line)}>{busyLine?'Saving…':'Save shift'}</button>
   </div>}
   {kind==='refresh'&&<div className="employee-id-refresh cr-refresh"><button type="button" className="employee-id-refresh-button" disabled={Boolean(working)||busy} onClick={()=>refresh(line)}>{busyLine?'Checking HR Pulse…':'Refresh'}</button><small>{REFRESH_HINT}</small></div>}
   {kind==='other'&&<small className="cr-sub">This card is saved under {card.savedId} {card.savedName}, who stands; only its shift is missing. Choose the card of {line.name}, or fix this one on Caliber ID Re-check.</small>}
  </div>;
 };
 const lineColumns=[...(manySites||slot?.key===EVERY?[{key:'where',label:'Site · date · shift',value:line=>(manySites?line.site+' · ':'')+dmy(line.date)+' · '+shiftChoiceLabel(line.shift)}]:[]),
  {key:'person',label:'Punched by',value:line=>line.caliberId+' '+line.name,render:line=><><strong>{line.caliberId}</strong><small className="cr-sub">{line.name}{line.designation?' · '+line.designation:''}</small></>},
  {key:'punch',label:'Bio-punch In / Out',value:line=>(line.inTime||'—')+' / '+(line.outTime||'—'),render:line=><><strong>{(line.inTime||'—')+' / '+(line.outTime||'—')}</strong><small className="cr-sub">{SOURCE[line.source]||line.source}</small></>},
  {key:'card',label:'Card with an error',value:line=>cardOption(cardOf(line)),render:line=>{const card=cardOf(line);return <><strong>{card.book} · {card.bookNo}</strong><small className="cr-sub">{card.door}{card.own?' · own card':''} · {card.savedId?'saved under '+card.savedId+' '+card.savedName:'no driver saved'}{line.cards.length>1?' · '+line.cards.length+' cards with an error here':''}</small></>;}},
  {key:'why',label:'Why no attendance',value:line=>{const card=cardOf(line);return card.reasonLabel+'. '+card.line;},render:line=>{const card=cardOf(line);return <><strong>{card.reasonLabel}</strong><small className="cr-sub">{card.line}</small></>;}},
  {key:'fix',label:'Put it right',value:()=> '',render:action}];

 return <section className="caliber-recheck">
  <header className="cr-head">
   <div><h1>Caliber Punch Re-check</h1>
    <p>The drivers and operators who punched on the biometric machine but get no attendance from a VLB, ELB or LMV card, because a card of their site on that date has an error (a wrong or unknown ID, no driver, Employee ID and Caliber ID that differ, no shift or two). Each person is shown beside those cards, their own card first. Check the paper card and put it right on the same line: Submit puts the person on the card, Save shift writes the shift of their own card, Refresh asks HR Pulse about their ID. Undo takes a Submit back. The same changes show on Caliber ID Re-check.</p></div>
   <form className="cr-period" onSubmit={event=>{event.preventDefault();void recheck();}}>
    <label>From<input type="date" min={OPERATIONAL_START} max={range.to} value={range.from} disabled={busy} onChange={event=>setRange(now=>({...now,from:event.target.value}))}/></label>
    <label>To<input type="date" min={range.from} max={todayInIndia()} value={range.to} disabled={busy} onChange={event=>setRange(now=>({...now,to:event.target.value}))}/></label>
    <button disabled={busy||!range.from||!range.to}>Re-check</button>
   </form>
  </header>
  {progress&&<p role="status" className="cr-progress">Re-checking day {progress.done+1} of {progress.total}…</p>}
  {error&&<p className="cr-error" role="alert">{error}</p>}
  {held.machineErrors.map(text=><p key={text} className="cr-error" role="alert">{text} The imported punches are used.</p>)}
  <div className="cr-summary" aria-label="Summary">
   <span><strong>{count(held.punches)}</strong> punch days read</span><span><strong>{count(sites.total.punched)}</strong> drivers / operators punched</span><span><strong>{count(sites.total.counted)}</strong> attendance from a card</span>
   <span><strong>{count(sites.total.toFix)}</strong> to fix here</span><span><strong>{count(sites.total.noCard)}</strong> punched, no card at all</span>
  </div>
  {level>1&&<nav className="tt-crumbs" aria-label="Steps">{back&&<StepBackButton onBack={back} label={'Back to '+crumbs.at(-2)[0]}/>}{crumbs.map(([label,move],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{move&&i<crumbs.length-1?<button type="button" onClick={move}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>}
  <ReportSection key="cpr-sites" reportKey="Caliber punch re-check sites" title={'Step 1 · Caliber punch re-check · All sites · '+period} category="caliber-punch-recheck-sites" dataReady={!busy} recordDateFilter={false}
   description="One line per site: the drivers and operators who punched, those a card gives attendance, those whose card has an error (fixed here) and those with no card at all. Press a site to see it date by date and shift by shift; press All sites for every site together."
   rows={sites.rows.length?[...sites.rows,sites.total]:[]} columns={siteColumns} rowKey={row=>row.id} rowClassName={row=>(row.total?'tt-total':'')+(site&&row.key===site?' report-row-picked':'')} isTotalRow={isTotal}
   onRowClick={row=>go({site:row.key,slot:null})} emptyMessage={busy?'Re-checking…':'No biometric punch of a driver or operator in these dates.'}/>
  {level>=2&&<ReportSection key={'cpr-slots-'+site} reportKey="Caliber punch re-check date by shift" title={'Step 2 · Caliber punch re-check · '+siteLabel+' · date by shift · '+period} category="caliber-punch-recheck-shifts" dataReady={!busy}
   description="The people to fix of each date and shift (the shift of their own card). Press a box for the people of that shift, or the All dates line for every date and shift together."
   rows={gridExport.rows} columns={gridExport.columns} rowKey={row=>row.id} showSearch={false} recordDateFilter={false}>
   <DateShiftGrid grid={grid} count={row=>row.count} countLabel="people to fix" dayColumns={dayColumns} shiftLabel={shiftChoiceLabel} onOpen={row=>openSlot(row)} onOpenAll={()=>openSlot(null)}
    isPicked={sameSlot} allPicked={slot?.key===EVERY} ariaLabel="People to fix by date and shift" emptyMessage="Nobody to fix at this site in these dates."/>
  </ReportSection>}
  {level>=3&&kept&&<p className="cr-notice cr-kept" role="status"><span>{kept.text}</span>{kept.correctionId&&<button type="button" onClick={undo}>Undo</button>}</p>}
  {level>=3&&<ReportSection key={'cpr-lines-'+site+'|'+slot.key} reportKey="Caliber punch re-check people" title={'Step 3 · Caliber punch re-check · '+siteLabel+' · '+slot.label} category="caliber-punch-recheck-people" dataReady={!busy} recordDateFilter={false}
   description="One line per person who punched: the bio-punch, the card with an error at the site on that date (their own card first; pick another when there are several) and why it gives no attendance. Check the paper card and press Submit to put the person on the card, Save shift to write the shift of their own card, or Refresh when HR Pulse must add the ID. The line leaves the list once the card counts."
   rows={lines} columns={lineColumns} rowKey={line=>line.id} emptyMessage="Nobody to fix in this date and shift."/>}
 </section>;
}
