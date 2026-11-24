// Trip cards view of Caliber Punch Re-check (owner, 24 Nov 2026: "make this for trip card punch (VLB, ELB & LMV) ...
// create the mechanism for trip cards"; "dono rakho": the Bio-punch view stays, behind the button beside this one).
// Step 1 one line per site: VLB, ELB, LMV, all cards, attendance marked, card error (fixed here), attendance with and
// without a bio-punch, and cards with nobody that did not work. Every figure opens Step 2 (date by shift) and Step 3
// (the cards) for that list. A card with an error is put right on its line as on Caliber ID Re-check: Submit with the
// right person from the paper card, Save shift, Refresh (HR Pulse) or This card is right. Rule:
// shared/caliber-card-recheck.mjs; the server: GET /api/caliber-recheck/cards.
import React,{useEffect,useRef,useState} from 'react';
import EmployeeIdLookup from './employee-id-lookup.jsx';
import {DateShiftGrid,dateShiftGrid,dateShiftExport,dateLine,siteDateLine} from './date-shift-grid.jsx';
import {StepBackButton} from './step-back.jsx';
import {shiftChoiceLabel} from '../shared/report-filter-options.mjs';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {REFRESH_HINT} from '../shared/caliber-id-check.mjs';
import {CARD_VIEWS,CARD_FIGURES,cardsOfView} from '../shared/caliber-card-recheck.mjs';
import {dmy,todayInIndia,recheckDates} from './caliber-recheck-model.mjs';
import {EVERY,punchDefaultRange} from './caliber-punch-recheck-model.mjs';

const count=value=>Number(value||0).toLocaleString('en-IN');
const SHIFT_OPTIONS=[['S1','Shift I'],['S2','Shift II'],['S3','Shift III'],['D','Day (12 Hrs)'],['N','Night (12 Hrs)']];
const STATUS={counted:'Attendance marked',error:'Card error',idle:'No driver, did not work'};
const SOURCE={machine:'Machine','imported':'Imported','machine+imported':'Machine + imported'};
const isTotal=row=>Boolean(row.total);

// The days read so far, added up. A date asked again (after a card is put right) replaces its earlier answer.
export const emptyCardRecheck=()=>({answers:new Map(),lines:[],sites:new Map(),hrSites:[],machineErrors:[]});
export function addCardAnswer(held,answer){
 const answers=new Map(held.answers);answers.set(answer.from,answer);
 const lines=[],sites=new Map(),hr=new Map(),errors=new Set();
 for(const one of [...answers.values()].sort((a,b)=>a.from<b.from?-1:1)){
  lines.push(...(one.lines||[]));
  if(one.machine?.error)errors.add(one.machine.error);
  for(const site of one.machine?.sites||[])hr.set(site.site,(hr.get(site.site)||0)+site.days);
  for(const site of one.sites||[]){const now=sites.get(site.key)||{key:site.key,site:site.site,...Object.fromEntries(CARD_FIGURES.map(name=>[name,0]))};sites.set(site.key,{...now,...Object.fromEntries(CARD_FIGURES.map(name=>[name,now[name]+(site[name]||0)]))});}
 }
 return {answers,lines,sites,hrSites:[...hr].map(([site,days])=>({site,days})).sort((a,b)=>b.days-a.days),machineErrors:[...errors]};
}
export function cardSiteRows(held){
 const rows=[...held.sites.values()].map(site=>({id:site.key,...site})).sort((a,b)=>b.error-a.error||b.cards-a.cards||a.site.localeCompare(b.site));
 return {rows,total:{id:EVERY,key:EVERY,total:true,site:'All sites',...Object.fromEntries(CARD_FIGURES.map(name=>[name,rows.reduce((sum,row)=>sum+row[name],0)]))}};
}
export function cardSlotRows(lines,{manySites=false}={}){
 const slots=new Map();
 for(const line of lines){
  const key=line.date+'|'+(line.shift||'—')+(manySites?'|'+line.siteKey:'');
  if(!slots.has(key))slots.set(key,{key,date:line.date,shift:line.shift||'—',site:line.site,siteKey:line.siteKey,count:0,error:0});
  const slot=slots.get(key);slot.count++;if(line.status==='error')slot.error++;
 }
 return [...slots.values()];
}

export default function CardRecheckView({session,ReportSection}){
 const [range,setRange]=useState(()=>punchDefaultRange(todayInIndia()));
 const [held,setHeld]=useState(emptyCardRecheck),[progress,setProgress]=useState(null),[error,setError]=useState('');
 const [open,setOpen]=useState({site:'',slot:null,view:'error'});
 const [shiftPicks,setShiftPicks]=useState({}),[working,setWorking]=useState(''),[said,setSaid]=useState(null),[kept,setKept]=useState(null);
 const run=useRef(0);
 const api=async(path,options={})=>{
  const response=await fetch(path,{...options,headers:{Authorization:`Bearer ${session.token}`,...(options.body?{'Content-Type':'application/json'}:{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(body.error||'The trip card re-check is unavailable.'),{status:response.status});
  return body;
 };
 const recheck=async(dates=recheckDates(range.from,range.to),fresh=true)=>{
  const mine=fresh?++run.current:run.current;
  setError('');if(fresh){setHeld(emptyCardRecheck());setOpen(now=>({site:'',slot:null,view:now.view}));setSaid(null);setKept(null);}
  try{
   for(let i=0;i<dates.length;i++){
    if(run.current!==mine)return;
    if(fresh)setProgress({done:i,total:dates.length});
    const answer=await api('/api/caliber-recheck/cards?from='+dates[i]+'&to='+dates[i]);
    if(run.current!==mine)return;
    setHeld(now=>addCardAnswer(now,answer));
   }
  }catch(e){if(run.current===mine)setError(e.message);}
  finally{if(fresh&&run.current===mine)setProgress(null);}
 };
 useEffect(()=>{void recheck();return()=>{run.current++};},[]);

 const act=async(line,fn)=>{setWorking(line.id);setError('');setSaid(null);setKept(null);try{await fn();}catch(e){setSaid({id:line.id,text:e.message,bad:true});}finally{setWorking('');}};
 // Submit: the person typed from the paper card goes on the card at once; Undo puts the earlier person back.
 const choose=async(line,employee)=>{
  setSaid(null);setKept(null);
  const answer=await api('/api/caliber-recheck/pick',{method:'POST',body:JSON.stringify({logbookId:line.id,employeeId:employee.id,anyCard:line.status!=='error'})});
  await recheck([line.date],false);
  if(answer.corrected){const made=answer.correction;setKept({date:line.date,correctionId:made.id,text:'Card '+made.bookNo+' is now under '+made.to+' · '+made.toName+(made.from?' (was under '+[made.from,made.fromName].filter(Boolean).join(' · ')+')':'')+'.'+(answer.still?' It is still listed: '+answer.still:' Its attendance is marked.')});}
  else setKept({date:line.date,text:employee.name+' is already on card '+line.bookNo+'.'+(answer.confirmed?' The card was confirmed right.':'')});
 };
 const saveShift=line=>{
  const code=shiftPicks[line.id];
  if(!code){setSaid({id:line.id,text:'Choose the shift from the paper card first.',bad:true});return;}
  return act(line,async()=>{await api('/api/caliber-recheck/shift',{method:'POST',body:JSON.stringify({logbookId:line.id,shift:code})});await recheck([line.date],false);setKept({date:line.date,text:'Card '+line.bookNo+' now names '+(SHIFT_OPTIONS.find(([value])=>value===code)?.[1]||code)+'; its attendance is marked.'});});
 };
 const refresh=line=>act(line,async()=>{const person=await api('/api/log-books/employee-refresh',{method:'POST',body:JSON.stringify({caliberId:line.savedId,location:line.site,bookDate:line.date,kind:line.kind})});await recheck([line.date],false);setKept({date:line.date,text:'HR Pulse has '+[person.caliberId||line.savedId,person.name||line.savedName].filter(Boolean).join(' · ')+' now; the cards of this date were checked again.'});});
 const confirm=line=>act(line,async()=>{const answer=await api('/api/caliber-recheck/confirm',{method:'POST',body:JSON.stringify({logbookId:line.id})});await recheck([line.date],false);setKept({date:line.date,text:answer.confirmed?'Card '+line.bookNo+' confirmed right: '+line.savedId+' · '+line.savedName+' stays on it.':'Card '+line.bookNo+' stands now.'});});
 const undo=async()=>{
  const {correctionId,date}=kept;setKept(null);setError('');
  try{const answer=await api('/api/caliber-recheck/correction/'+correctionId,{method:'DELETE'});await recheck([date],false);setKept({date,text:answer.removed?'Taken back: card '+answer.card.bookNo+' is under '+([answer.card.employeeId,answer.card.name].filter(Boolean).join(' · ')||'nobody')+' again.':'This change was already taken back.'});}
  catch(e){setError(e.message);}
 };

 const period=dmy(range.from)+' to '+dmy(range.to),busy=Boolean(progress);
 const sites=cardSiteRows(held);
 const {site,slot}=open,manySites=site===EVERY,view=open.view||'error',viewInfo=CARD_VIEWS.find(one=>one.key===view);
 const siteLines=site?cardsOfView(manySites?held.lines:held.lines.filter(line=>line.siteKey===site),view):[];
 const siteLabel=manySites?'All sites':sites.rows.find(row=>row.key===site)?.site||'';
 const grid=dateShiftGrid(cardSlotRows(siteLines,{manySites}),{sumKeys:['count','error'],lineOf:row=>manySites?siteDateLine(row):dateLine(row)});
 const dayColumns=[{key:'count',label:'Day cards',value:sums=>sums.count},...(['cards','vlb','elb','lmv'].includes(view)?[{key:'error',label:'With an error',value:sums=>sums.error}]:[])];
 const gridExport=dateShiftExport(grid,{count:row=>row.count,countLabel:'cards',dayColumns,shiftLabel:shiftChoiceLabel});
 const lines=slot?(slot.key===EVERY?siteLines:siteLines.filter(line=>line.date===slot.date&&(line.shift||'—')===slot.shift&&(!slot.siteKey||line.siteKey===slot.siteKey))):[];
 const sameSlot=row=>slot&&slot.key!==EVERY&&slot.date===row.date&&slot.shift===row.shift&&(!manySites||slot.siteKey===row.siteKey);
 const go=next=>{setKept(null);setSaid(null);setOpen(next);};
 const openSlot=row=>go({site,view,slot:row?{key:row.key,date:row.date,shift:row.shift,siteKey:manySites?row.siteKey:'',label:dmy(row.date)+' · '+shiftChoiceLabel(row.shift)+(manySites?' · '+row.site:'')}:{key:EVERY,label:'All dates and shifts'}});
 const crumbs=[['All sites',()=>go({site:'',slot:null,view})],...(site?[[siteLabel+' · '+viewInfo.short,()=>go({site,slot:null,view})]]:[]),...(slot?[[slot.label,null]]:[])];
 const back=crumbs.length>1?crumbs.at(-2)[1]:null;
 const level=!site?1:!slot?2:3;
 const figure=key=>row=>row[key]>0?<button type="button" className={'cr-figure'+(site===row.key&&view===key?' cr-figure-picked':'')} title={'Open: '+CARD_VIEWS.find(one=>one.key===key).label}
  onClick={event=>{event.stopPropagation();go({site:row.key,slot:null,view:key});}}>{count(row[key])}</button>:row[key];
 const siteColumns=[{key:'site',label:'Site',value:row=>row.site},...CARD_VIEWS.map(one=>({key:one.key,label:one.label,value:row=>row[one.key],render:figure(one.key)}))];

 const fix=line=>{
  // Every card can be put right here (owner, 24 Nov 2026: "correction section not showing"): a card with an error as on
  // Caliber ID Re-check; any other card takes another driver from the paper card (anyCard), with Undo.
  const e=line.error||{},busyLine=working===line.id;
  if(line.status!=='error')return <div className="cr-right">
   {said?.id===line.id&&<small className={'cr-said'+(said.bad?' cr-said-bad':'')} role={said.bad?'alert':'status'}>{said.text}</small>}
   <EmployeeIdLookup key={line.id} submitLabel={line.status==='idle'?'Submit':'Change driver'} scanMode submitHint={line.status==='idle'?'to put this person on the card':'when the paper card shows another person'} token={session.token} location={line.site} bookDate={line.date} role={line.kind==='equipment'?'operator':'driver'} card={{door:line.door,book:line.bookNo}} onResolved={employee=>choose(line,employee)}/>
  </div>;
  return <div className="cr-right">
   {said?.id===line.id&&<small className={'cr-said'+(said.bad?' cr-said-bad':'')} role={said.bad?'alert':'status'}>{said.text}</small>}
   {e.canRefresh&&<div className="employee-id-refresh cr-refresh"><button type="button" className="employee-id-refresh-button" disabled={Boolean(working)||busy} onClick={()=>refresh(line)}>{busyLine?'Checking HR Pulse…':'Refresh'}</button><small>{REFRESH_HINT}</small></div>}
   {e.pickShift?<div className="cr-shift" role="group" aria-label={'Shift of card '+line.bookNo}>
    <select aria-label="Shift from the paper card" value={shiftPicks[line.id]||''} disabled={busyLine} onChange={event=>setShiftPicks(now=>({...now,[line.id]:event.target.value}))}><option value="">Select shift</option>{SHIFT_OPTIONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
    <button type="button" className="cr-keep-yes" disabled={Boolean(working)||busy} onClick={()=>saveShift(line)}>{busyLine?'Saving…':'Save shift'}</button></div>
   :<EmployeeIdLookup key={line.id} submitLabel="Submit" scanMode submitHint="to put this person on the card" token={session.token} location={line.site} bookDate={line.date} role={line.kind==='equipment'?'operator':'driver'} card={{door:line.door,cardNo:e.cardNo,book:line.bookNo}} onResolved={employee=>choose(line,employee)}/>}
   {e.canConfirm&&<button type="button" className="cr-keep" disabled={Boolean(working)||busy} onClick={()=>confirm(line)}>This card is right ({line.savedId})</button>}
  </div>;
 };
 const cardColumns=[...(manySites||slot?.key===EVERY?[{key:'where',label:'Site · date · shift',value:line=>(manySites?line.site+' · ':'')+dmy(line.date)+' · '+shiftChoiceLabel(line.shift)}]:[]),
  {key:'book',label:'Card',value:line=>line.book+' '+line.bookNo,render:line=><><strong>{line.book} · {line.bookNo}</strong><small className="cr-sub">{line.door}</small></>},
  {key:'saved',label:'Saved under',value:line=>[line.savedId,line.savedName].filter(Boolean).join(' '),render:line=>line.savedId||line.savedName?<><strong>{line.savedId}</strong><small className="cr-sub">{line.savedName}</small></>:<small className="cr-sub">Nobody</small>},
  {key:'status',label:'Attendance',value:line=>STATUS[line.status],render:line=><><strong>{STATUS[line.status]}</strong>{line.status==='error'&&<small className="cr-sub">{line.error?.reasonLabel}. {line.error?.line}</small>}</>},
  {key:'punch',label:'Bio-punch In / Out',value:line=>line.punch?(line.punch.inTime||'—')+' / '+(line.punch.outTime||'—'):'No punch',render:line=>line.punch?<><strong>{(line.punch.inTime||'—')+' / '+(line.punch.outTime||'—')}</strong><small className="cr-sub">{[SOURCE[line.punch.source]||line.punch.source,line.punch.site].filter(Boolean).join(' · ')}</small></>:<small className="cr-sub">{line.number?'No punch this day':'—'}</small>},
  {key:'fix',label:'Put it right (from the paper card)',value:()=> '',render:fix}];

 return <>
  <header className="cr-head">
   <div><h1>Caliber Punch Re-check · Trip cards</h1>
    <p>Every saved VLB, ELB and LMV card of each site, whether it marks attendance, and whether the person on it punched on the biometric machine that day. A card with an error (a wrong or unknown ID, no driver, Employee ID and Caliber ID that differ, no shift or two) marks no attendance: type the right person from the paper card and press Submit, or choose its shift and press Save shift, on the card's own line. Press any figure of Step 1 to see those cards.</p></div>
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
   <span><strong>{count(sites.total.cards)}</strong> trip cards</span><span><strong>{count(sites.total.counted)}</strong> attendance marked</span><span><strong>{count(sites.total.error)}</strong> card error</span>
   <span><strong>{count(sites.total.punch)}</strong> with bio-punch</span><span><strong>{count(sites.total.noPunch)}</strong> no bio-punch</span>
  </div>
  {!busy&&held.answers.size>0&&<p className="cr-notice" role="status">Bio-punch from HR Pulse (site machines and Manual Biometric logs): {held.hrSites.length?held.hrSites.map(one=>one.site+' ('+count(one.days)+')').join(', '):'no site'}. A site with neither a machine sending to HR Pulse nor Manual Biometric logs saved in HR shows its cards with no bio-punch.</p>}
  {level>1&&<nav className="tt-crumbs" aria-label="Steps">{back&&<StepBackButton onBack={back} label={'Back to '+crumbs.at(-2)[0]}/>}{crumbs.map(([label,move],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{move&&i<crumbs.length-1?<button type="button" onClick={move}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>}
  <ReportSection key="ccr-sites" reportKey="Trip card re-check sites" title={'Step 1 · Trip card re-check · All sites · '+period} category="trip-card-recheck-sites" dataReady={!busy} recordDateFilter={false}
   description="One line per site: its VLB, ELB and LMV cards, those that mark attendance, those with an error (fixed here), attendance with and without a bio-punch, and cards with nobody on them that did not work. Press any figure to see those cards date by date and shift by shift; the line of All sites opens every site together."
   rows={sites.rows.length?[...sites.rows,sites.total]:[]} columns={siteColumns} rowKey={row=>row.id} rowClassName={row=>(row.total?'tt-total':'')+(site&&row.key===site?' report-row-picked':'')} isTotalRow={isTotal}
   onRowClick={row=>go({site:row.key,slot:null,view})} emptyMessage={busy?'Re-checking…':'No saved card in these dates.'}/>
  {level>=2&&<ReportSection key={'ccr-slots-'+site+view} reportKey="Trip card re-check date by shift" title={'Step 2 · Trip card re-check · '+siteLabel+' · '+viewInfo.short+' · date by shift · '+period} category="trip-card-recheck-shifts" dataReady={!busy}
   description="The cards of each date and shift. Press a box for the cards of that shift, or the All dates line for every date and shift together."
   rows={gridExport.rows} columns={gridExport.columns} rowKey={row=>row.id} showSearch={false} recordDateFilter={false}>
   <DateShiftGrid grid={grid} count={row=>row.count} countLabel="cards" dayColumns={dayColumns} shiftLabel={shiftChoiceLabel} onOpen={row=>openSlot(row)} onOpenAll={()=>openSlot(null)}
    isPicked={sameSlot} allPicked={slot?.key===EVERY} ariaLabel={'Cards by date and shift: '+viewInfo.label} emptyMessage="No card in this list at this site in these dates."/>
  </ReportSection>}
  {level>=3&&kept&&<p className="cr-notice cr-kept" role="status"><span>{kept.text}</span>{kept.correctionId&&<button type="button" onClick={undo}>Undo</button>}</p>}
  {level>=3&&<ReportSection key={'ccr-cards-'+site+view+'|'+slot.key} reportKey="Trip card re-check cards" title={'Step 3 · Trip card re-check · '+siteLabel+' · '+viewInfo.short+' · '+slot.label} category="trip-card-recheck-cards" dataReady={!busy} recordDateFilter={false}
   description="One line per card: who it is saved under, whether it marks attendance (and why not), and the bio-punch of that person that day. On a card with an error, type the right person from the paper card and press Submit, or choose the shift and press Save shift; Undo, above this table, takes a Submit back."
   rows={lines} columns={cardColumns} rowKey={line=>line.id} emptyMessage="No card in this list in this date and shift."/>}
 </>;
}
