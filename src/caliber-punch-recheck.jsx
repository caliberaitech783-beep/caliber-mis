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
import {EVERY,punchDefaultRange,emptyPunchRecheck,addPunchAnswer,punchSiteRows,linesOfSite,punchSlotRows,linesOfSlot,firstCard,cardAction,cardOption,PUNCH_VIEWS,STATUS_LABEL} from './caliber-punch-recheck-model.mjs';
import CardRecheckView from './caliber-card-recheck.jsx';
import './caliber-recheck.css';

const count=value=>Number(value||0).toLocaleString('en-IN');
const SHIFT_OPTIONS=[['S1','Shift I'],['S2','Shift II'],['S3','Shift III'],['D','Day (12 Hrs)'],['N','Night (12 Hrs)']];
const SOURCE={machine:'Machine','imported':'Imported','machine+imported':'Machine + imported'};
const isTotal=row=>Boolean(row.total);

// The two views (owner, 24 Nov 2026: "dono rakho"): Trip cards first (src/caliber-card-recheck.jsx), Bio-punch beside it.
export default function CaliberPunchRecheck({session,ReportSection}){
 const [tab,setTab]=useState('cards');
 return <section className="caliber-recheck">
  <nav className="am-chips cr-views" aria-label="View">
   <button type="button" aria-current={tab==='cards'?'page':undefined} onClick={()=>setTab('cards')}>Trip cards (VLB · ELB · LMV)</button>
   <button type="button" aria-current={tab==='punch'?'page':undefined} onClick={()=>setTab('punch')}>Bio-punch</button>
  </nav>
  {tab==='cards'?<CardRecheckView session={session} ReportSection={ReportSection}/>:<PunchView session={session} ReportSection={ReportSection}/>}
 </section>;
}

function PunchView({session,ReportSection}){
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
 const {site,slot}=open,manySites=site===EVERY,view=open.view||'toFix',viewInfo=PUNCH_VIEWS.find(one=>one.key===view),fixing=view==='toFix';
 const siteLines=site?linesOfSite(held,site,view):[],siteLabel=manySites?'All sites':sites.rows.find(row=>row.key===site)?.site||'';
 const what=fixing?'people to fix':'people';
 const grid=dateShiftGrid(punchSlotRows(siteLines,{manySites}),{sumKeys:['count','own'],lineOf:row=>manySites?siteDateLine(row):dateLine(row)});
 const dayColumns=[{key:'count',label:'Day '+what,value:sums=>sums.count},...(fixing?[{key:'own',label:'With their own card',value:sums=>sums.own}]:[])];
 const gridExport=dateShiftExport(grid,{count:row=>row.count,countLabel:what,dayColumns,shiftLabel:shiftChoiceLabel});
 const lines=slot?linesOfSlot(siteLines,slot):[];
 const sameSlot=row=>slot&&slot.key!==EVERY&&slot.date===row.date&&slot.shift===row.shift&&(!manySites||slot.siteKey===row.siteKey);
 const go=next=>{setKept(null);setSaid(null);setOpen(next);};
 const openSlot=row=>go({site,view,slot:row?{key:row.key,date:row.date,shift:row.shift,siteKey:manySites?row.siteKey:'',label:dmy(row.date)+' · '+shiftChoiceLabel(row.shift)+(manySites?' · '+row.site:'')}:{key:EVERY,label:'All dates and shifts'}});
 const crumbs=[['All sites',()=>go({site:'',slot:null,view})],...(site?[[siteLabel+' · '+viewInfo.short,()=>go({site,slot:null,view})]]:[]),...(slot?[[slot.label,null]]:[])];
 // Each figure of Step 1 opens its own list; pressing elsewhere on a line opens the list already chosen.
 const openSite=(row,next=view)=>go({site:row.key,slot:null,view:next});
 const figure=key=>row=>row[key]>0?<button type="button" className={'cr-figure'+(site===row.key&&view===key?' cr-figure-picked':'')} title={'Open: '+PUNCH_VIEWS.find(one=>one.key===key).label}
  onClick={event=>{event.stopPropagation();openSite(row,key);}}>{count(row[key])}</button>:row[key];
 const back=crumbs.length>1?crumbs.at(-2)[1]:null;
 const level=!site?1:!slot?2:3;

 // Punches received (owner, 24 Nov 2026): every punch day that reached Pulse-II for the site, before the driver filter,
 // and those whose number is in no employee list: a site at 0 has no machine sending, a high "not recognised" an ID mismatch.
 const siteColumns=[{key:'site',label:'Site',value:row=>row.site},{key:'received',label:'Punches received (all staff)',value:row=>row.received},{key:'unknown',label:'Not recognised (ID in no employee list)',value:row=>row.unknown},
  ...PUNCH_VIEWS.map(one=>({key:one.key,label:one.label,value:row=>row[one.key],render:figure(one.key)}))];
 // The card(s) of a line that is not one to fix: the counted cards, or none.
 const cardsText=line=>line.status==='counted'?(line.countedCards||[]).map(card=>card.book+' · '+card.bookNo+(card.door?' · '+card.door:'')).join(', ')||'Card counts':'No VLB, ELB or LMV card of this person on this date';
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
 // A line to fix carries its card with an error and the fix; any other line says which card counts it, or that none does.
 const fixable=line=>line.status==='toFix';
 const cardCell=line=>{
  if(!fixable(line))return <span className={line.status==='noCard'?'cr-sub':''}><strong>{STATUS_LABEL[line.status]}</strong><small className="cr-sub">{cardsText(line)}</small></span>;
  const card=cardOf(line);
  return <><strong>{card.book} · {card.bookNo}</strong><small className="cr-sub">{card.door}{card.own?' · own card':''} · {card.savedId?'saved under '+card.savedId+' '+card.savedName:'no driver saved'}{line.cards.length>1?' · '+line.cards.length+' cards with an error here':''}</small></>;
 };
 const whyCell=line=>{const card=fixable(line)?cardOf(line):null;return card?<><strong>{card.reasonLabel}</strong><small className="cr-sub">{card.line}</small></>:line.status==='counted'?'—':<small className="cr-sub">No card at the site on this date to put right here. Enter the card, or check the punch.</small>;};
 const lineColumns=[...(manySites||slot?.key===EVERY?[{key:'where',label:'Site · date · shift',value:line=>(manySites?line.site+' · ':'')+dmy(line.date)+' · '+shiftChoiceLabel(line.shift)}]:[]),
  {key:'person',label:'Punched by',value:line=>line.caliberId+' '+line.name,render:line=><><strong>{line.caliberId}</strong><small className="cr-sub">{line.name}{line.designation?' · '+line.designation:''}</small></>},
  {key:'punch',label:'Bio-punch In / Out',value:line=>(line.inTime||'—')+' / '+(line.outTime||'—'),render:line=><><strong>{(line.inTime||'—')+' / '+(line.outTime||'—')}</strong><small className="cr-sub">{SOURCE[line.source]||line.source}</small></>},
  {key:'card',label:fixing?'Card with an error':'Card',value:line=>fixable(line)?cardOption(cardOf(line)):STATUS_LABEL[line.status]+': '+cardsText(line),render:cardCell},
  ...(view==='counted'?[]:[{key:'why',label:'Why no attendance',value:line=>{const card=fixable(line)?cardOf(line):null;return card?card.reasonLabel+'. '+card.line:line.status==='counted'?'':'No card';},render:whyCell}]),
  ...(view==='toFix'||view==='punched'?[{key:'fix',label:'Put it right',value:()=> '',render:line=>fixable(line)?action(line):''}]:[])];

 return <>
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
  {!busy&&held.answers.size>0&&<p className="cr-notice" role="status">HR Pulse sent machine punches for: {held.hrSites.length?held.hrSites.map(one=>one.site+' ('+count(one.days)+')').join(', '):'no site'}. Uploaded in Pulse-II: {count(held.imported)} punch days.{held.unplaced?' '+count(held.unplaced)+' punch days name no site and an unknown ID, so they are on no site.':''} A site with no punches received has no machine sending to HR Pulse.</p>}
  {level>1&&<nav className="tt-crumbs" aria-label="Steps">{back&&<StepBackButton onBack={back} label={'Back to '+crumbs.at(-2)[0]}/>}{crumbs.map(([label,move],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{move&&i<crumbs.length-1?<button type="button" onClick={move}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>}
  <ReportSection key="cpr-sites" reportKey="Caliber punch re-check sites" title={'Step 1 · Caliber punch re-check · All sites · '+period} category="caliber-punch-recheck-sites" dataReady={!busy} recordDateFilter={false}
   description="One line per site: the drivers and operators who punched, those a card gives attendance, those whose card has an error (fixed here) and those with no card at all. Press any figure to see those people date by date and shift by shift; the line of All sites opens every site together."
   rows={sites.rows.length?[...sites.rows,sites.total]:[]} columns={siteColumns} rowKey={row=>row.id} rowClassName={row=>(row.total?'tt-total':'')+(site&&row.key===site?' report-row-picked':'')} isTotalRow={isTotal}
   onRowClick={row=>openSite(row)} emptyMessage={busy?'Re-checking…':'No biometric punch of a driver or operator in these dates.'}/>
  {level>=2&&<ReportSection key={'cpr-slots-'+site+view} reportKey="Caliber punch re-check date by shift" title={'Step 2 · Caliber punch re-check · '+siteLabel+' · '+viewInfo.short+' · date by shift · '+period} category="caliber-punch-recheck-shifts" dataReady={!busy}
   description={'The '+what+' of each date and shift (the shift of their card; — when no card says it). Press a box for the people of that shift, or the All dates line for every date and shift together.'}
   rows={gridExport.rows} columns={gridExport.columns} rowKey={row=>row.id} showSearch={false} recordDateFilter={false}>
   <DateShiftGrid grid={grid} count={row=>row.count} countLabel={what} dayColumns={dayColumns} shiftLabel={shiftChoiceLabel} onOpen={row=>openSlot(row)} onOpenAll={()=>openSlot(null)}
    isPicked={sameSlot} allPicked={slot?.key===EVERY} ariaLabel={'People by date and shift: '+viewInfo.label} emptyMessage="Nobody in this list at this site in these dates."/>
  </ReportSection>}
  {level>=3&&kept&&<p className="cr-notice cr-kept" role="status"><span>{kept.text}</span>{kept.correctionId&&<button type="button" onClick={undo}>Undo</button>}</p>}
  {level>=3&&<ReportSection key={'cpr-lines-'+site+view+'|'+slot.key} reportKey="Caliber punch re-check people" title={'Step 3 · Caliber punch re-check · '+siteLabel+' · '+viewInfo.short+' · '+slot.label} category="caliber-punch-recheck-people" dataReady={!busy} recordDateFilter={false}
   description="One line per person who punched: the bio-punch, the card with an error at the site on that date (their own card first; pick another when there are several) and why it gives no attendance. Check the paper card and press Submit to put the person on the card, Save shift to write the shift of their own card, or Refresh when HR Pulse must add the ID. The line leaves the list once the card counts. Opened from another figure, the lines say which card gives attendance, or that the person has no card on that date."
   rows={lines} columns={lineColumns} rowKey={line=>line.id} emptyMessage="Nobody in this list in this date and shift."/>}
 </>;
}
