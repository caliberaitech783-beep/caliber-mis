// Machine Category Re-check (owner, 24 Nov 2026): Masters, under Caliber Punch Re-check. The saved VLB, ELB and LMV
// cards, scanned or entered by hand, whose machine is of another category in the Equipment master than the book takes
// (a VLB takes a Vehicle, an ELB an Equipment, an LMV an LMV), or whose trip names a loading machine that is not an
// Equipment. A new card with such a machine cannot be saved; these are the cards saved before, or whose machine Pulse
// has moved since. Read only: the card is corrected on its own page, or the category in Pulse, and leaves the list.
//
// Drawn in the owner's report steps: Step 1 one line per site, Step 2 that site date by shift, Step 3 the cards of the
// date and shift opened. The screen asks the server day by day. Rule: shared/machine-category-recheck.mjs.
import React,{useEffect,useRef,useState} from 'react';
import {DateShiftGrid,dateShiftGrid,dateShiftExport,dateLine,siteDateLine} from './date-shift-grid.jsx';
import {StepBackButton} from './step-back.jsx';
import {shiftChoiceLabel} from '../shared/report-filter-options.mjs';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {dmy,todayInIndia,recheckDates} from './caliber-recheck-model.mjs';
import {punchDefaultRange} from './caliber-punch-recheck-model.mjs';
import {EVERY,emptyMachineRecheck,addMachineAnswer,machineSiteRows,cardsOfSite,machineSlotRows,cardsOfSlot} from './machine-category-recheck-model.mjs';
import './caliber-recheck.css';

const count=value=>Number(value||0).toLocaleString('en-IN');
const isTotal=row=>Boolean(row.total);

export default function MachineCategoryRecheck({session,ReportSection}){
 const [range,setRange]=useState(()=>punchDefaultRange(todayInIndia()));
 const [held,setHeld]=useState(emptyMachineRecheck),[progress,setProgress]=useState(null),[error,setError]=useState('');
 const [open,setOpen]=useState({site:'',slot:null});
 const run=useRef(0);
 const recheck=async()=>{
  const mine=++run.current,dates=recheckDates(range.from,range.to);
  setError('');setHeld(emptyMachineRecheck());setOpen({site:'',slot:null});
  try{
   for(let i=0;i<dates.length;i++){
    if(run.current!==mine)return;
    setProgress({done:i,total:dates.length});
    const response=await fetch('/api/caliber-recheck/machines?from='+dates[i]+'&to='+dates[i],{headers:{Authorization:`Bearer ${session.token}`}});
    const answer=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(answer.error||'The machine category re-check is unavailable.');
    if(run.current!==mine)return;
    setHeld(now=>addMachineAnswer(now,answer));
   }
  }catch(e){if(run.current===mine)setError(e.message);}
  finally{if(run.current===mine)setProgress(null);}
 };
 useEffect(()=>{void recheck();return()=>{run.current++};},[]);

 const period=dmy(range.from)+' to '+dmy(range.to),busy=Boolean(progress);
 const sites=machineSiteRows(held);
 const {site,slot}=open,manySites=site===EVERY;
 const siteCards=site?cardsOfSite(held,site):[],siteLabel=manySites?'All sites':sites.rows.find(row=>row.key===site)?.site||'';
 const grid=dateShiftGrid(machineSlotRows(siteCards,{manySites}),{sumKeys:['count','machine','trip'],lineOf:row=>manySites?siteDateLine(row):dateLine(row)});
 const dayColumns=[{key:'count',label:'Day cards to fix',value:sums=>sums.count},{key:'machine',label:'Machine of another category',value:sums=>sums.machine},{key:'trip',label:'Trip loading machine not Equipment',value:sums=>sums.trip}];
 const gridExport=dateShiftExport(grid,{count:row=>row.count,countLabel:'cards to fix',dayColumns,shiftLabel:shiftChoiceLabel});
 const cards=slot?cardsOfSlot(siteCards,slot):[];
 const sameSlot=row=>slot&&slot.key!==EVERY&&slot.date===row.date&&slot.shift===row.shift&&(!manySites||slot.siteKey===row.siteKey);
 const openSlot=row=>setOpen({site,slot:row?{key:row.key,date:row.date,shift:row.shift,siteKey:manySites?row.siteKey:'',label:dmy(row.date)+' · '+shiftChoiceLabel(row.shift)+(manySites?' · '+row.site:'')}:{key:EVERY,label:'All dates and shifts'}});
 const crumbs=[['All sites',()=>setOpen({site:'',slot:null})],...(site?[[siteLabel,()=>setOpen({site,slot:null})]]:[]),...(slot?[[slot.label,null]]:[])];
 const back=crumbs.length>1?crumbs.at(-2)[1]:null;
 const level=!site?1:!slot?2:3;

 const siteColumns=[{key:'site',label:'Site',value:row=>row.site},{key:'cards',label:'Cards checked',value:row=>row.cards},{key:'listed',label:'Cards to fix',value:row=>row.listed},
  {key:'machine',label:'Machine of another category',value:row=>row.machine},{key:'trip',label:'Trip loading machine not Equipment',value:row=>row.trip}];
 const cardColumns=[...(manySites||slot?.key===EVERY?[{key:'where',label:'Site · date · shift',value:card=>(manySites?card.site+' · ':'')+dmy(card.date)+' · '+shiftChoiceLabel(card.shift)}]:[]),
  {key:'card',label:'Card',value:card=>card.book+' '+card.bookNo,render:card=><><strong>{card.book} · {card.bookNo}</strong><small className="cr-sub">{card.scanned?'Scanned':'Manual entry'}{card.cardNo?' · card '+card.cardNo:''}</small></>},
  {key:'door',label:'Door on the card',value:card=>card.door},
  {key:'driver',label:'Driver / operator',value:card=>[card.savedId,card.savedName].filter(Boolean).join(' ')},
  {key:'category',label:'Category in the master',value:card=>card.issues.map(one=>one.label+': '+one.category).join('; ')},
  {key:'why',label:'What is wrong',value:card=>card.issues.map(one=>one.line).join(' '),render:card=>card.issues.map((one,i)=><small key={i} className="cr-sub">{one.line}</small>)}];

 return <section className="caliber-recheck">
  <header className="cr-head">
   <div><h1>Machine Category Re-check</h1>
    <p>The saved VLB, ELB and LMV cards, scanned or entered by hand, whose machine does not fit the book in the Equipment Master: a VLB takes a Vehicle, an ELB an Equipment, an LMV an LMV, and a trip is loaded by an Equipment. A new card with such a machine is stopped on save; these were saved before, or Pulse has moved the machine to another category since. Correct the card, or the category in Pulse, and it leaves the list.</p></div>
   <form className="cr-period" onSubmit={event=>{event.preventDefault();void recheck();}}>
    <label>From<input type="date" min={OPERATIONAL_START} max={range.to} value={range.from} disabled={busy} onChange={event=>setRange(now=>({...now,from:event.target.value}))}/></label>
    <label>To<input type="date" min={range.from} max={todayInIndia()} value={range.to} disabled={busy} onChange={event=>setRange(now=>({...now,to:event.target.value}))}/></label>
    <button disabled={busy||!range.from||!range.to}>Re-check</button>
   </form>
  </header>
  {progress&&<p role="status" className="cr-progress">Re-checking day {progress.done+1} of {progress.total}…</p>}
  {error&&<p className="cr-error" role="alert">{error}</p>}
  <div className="cr-summary" aria-label="Summary">
   <span><strong>{count(held.cards)}</strong> cards checked</span><span><strong>{count(sites.total.listed)}</strong> cards to fix</span>
   <span><strong>{count(sites.total.machine)}</strong> machine of another category</span><span><strong>{count(sites.total.trip)}</strong> trip loading machine not Equipment</span>
  </div>
  {level>1&&<nav className="tt-crumbs" aria-label="Steps">{back&&<StepBackButton onBack={back} label={'Back to '+crumbs.at(-2)[0]}/>}{crumbs.map(([label,move],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{move&&i<crumbs.length-1?<button type="button" onClick={move}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>}
  <ReportSection key="mcr-sites" reportKey="Machine category re-check sites" title={'Step 1 · Machine category re-check · All sites · '+period} category="machine-category-recheck-sites" dataReady={!busy} recordDateFilter={false}
   description="One line per site: the cards checked and those whose machine, or a trip's loading machine, is of another category in the Equipment Master. Press a site to see it date by date and shift by shift; press All sites for every site together."
   rows={sites.rows.length?[...sites.rows,sites.total]:[]} columns={siteColumns} rowKey={row=>row.id} rowClassName={row=>(row.total?'tt-total':'')+(site&&row.key===site?' report-row-picked':'')} isTotalRow={isTotal}
   onRowClick={row=>setOpen({site:row.key,slot:null})} emptyMessage={busy?'Re-checking…':'No saved card in these dates.'}/>
  {level>=2&&<ReportSection key={'mcr-slots-'+site} reportKey="Machine category re-check date by shift" title={'Step 2 · Machine category re-check · '+siteLabel+' · date by shift · '+period} category="machine-category-recheck-shifts" dataReady={!busy}
   description="The cards to fix of each date and shift. Press a box for the cards of that shift, or the All dates line for every date and shift together."
   rows={gridExport.rows} columns={gridExport.columns} rowKey={row=>row.id} showSearch={false} recordDateFilter={false}>
   <DateShiftGrid grid={grid} count={row=>row.count} countLabel="cards to fix" dayColumns={dayColumns} shiftLabel={shiftChoiceLabel} onOpen={row=>openSlot(row)} onOpenAll={()=>openSlot(null)}
    isPicked={sameSlot} allPicked={slot?.key===EVERY} ariaLabel="Cards to fix by date and shift" emptyMessage="No card to fix at this site in these dates."/>
  </ReportSection>}
  {level>=3&&<ReportSection key={'mcr-cards-'+site+'|'+slot.key} reportKey="Machine category re-check cards" title={'Step 3 · Machine category re-check · '+siteLabel+' · '+slot.label} category="machine-category-recheck-cards" dataReady={!busy} recordDateFilter={false}
   description="One line per card: the door on the card, the category the Equipment Master gives the machine and what is wrong. Correct the machine on the card, or the category in Pulse."
   rows={cards} columns={cardColumns} rowKey={card=>card.id} emptyMessage="No card to fix in this date and shift."/>}
 </section>;
}
