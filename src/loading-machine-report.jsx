import React,{useMemo,useState} from 'react';
import {StepBackButton} from './step-back.jsx';
import {BANDS,BAND_LABELS,IDLE_LIMIT,STATES,machineShifts,summarise,idleStops,shiftsNotWorked,idleText,groupKey} from '../shared/loading-machine-report.mjs';
import {tripEntries} from '../shared/trip-timing-report.mjs';
import './trip-timing-report.css';
import './loading-machine-report.css';

// Loading Equipment-wise Report: every loading machine of a site in a shift, with its trips, the share of the shift it
// worked and its idle stops between loadings. A machine in BD is a red line; a machine with no hours and not in BD is brown.
// It drills in five steps like the Trip Timing & Gap Report: all sites, one site date by date and shift by shift, the
// machines of one shift, the idle stops of one machine, the full trip card.
// A report only: it reads the saved log books already loaded by the shared operations screen.
const EVERY='*';
const blank=v=>v===null||v===undefined||v==='';
const column=(key,label,value,render)=>({key,label,value:value||(r=>blank(r[key])?'—':r[key]),...(render?{render}:{})});
const day=date=>/^\d{4}-\d{2}-\d{2}/.test(String(date))?date.slice(8,10)+'-'+date.slice(5,7)+'-'+date.slice(2,4):date;
const share=r=>blank(r.percent)?'—':r.percent+'%';
const FILTERS={...BAND_LABELS,breakdown:STATES.breakdown,nohours:STATES.nohours};
// A coloured number: pressing it opens the next step with only the lines behind it.
const counted=(key,label,className,onPick)=>column(key,label,null,r=>r[key]>0?(onPick?<button type="button" className={className} title={'Show only '+label} onClick={e=>{e.stopPropagation();onPick(r,key);}}>{r[key]}</button>:<span className={className}>{r[key]}</span>):r[key]);
const stateBadge=r=>r.state&&r.state!=='mixed'?<span className={'lm-status lm-status-'+r.state}>{r.statusLabel}</span>:r.statusLabel||'—';

const identity={
 site:[column('site','Site'),column('machineShifts','Machine shifts')],
 shift:[column('date','Date',r=>r.total?'ALL DATES':day(r.date)),column('shift','Shift'),column('stageLabel','Entry stage'),column('machineShifts','Machines')]
};
const work=[column('trips','Trips loaded'),column('percent','% of shift worked',share),column('hours','Hours worked'),column('shiftHours','Shift hours',r=>r.shiftHours||'—'),column('bdHours','BD hours')];
const idle=onPick=>[...BANDS.map(b=>counted(b.key,b.label,'tt-band lm-'+b.key,onPick)),column('stops','Total idle stops'),column('idleMinutes','Total idle time',r=>idleText(r.idleMinutes)),column('longest','Longest idle (min)'),column('notJudged','Not judged')];
export function summaryColumns(group,onPick){
 return [...identity[group],column('running',STATES.running),counted('breakdown',STATES.breakdown,'lm-count lm-breakdown',onPick),counted('nohours',STATES.nohours,'lm-count lm-nohours',onPick),...work,...idle(onPick)];
}
export function machineColumns(onPick,manyShifts=false){
 return [column('door','Door no.'),column('machineName','Machine'),column('operator','Operator'),...(manyShifts?[column('machineShifts','Shifts')]:[]),column('statusLabel','Status',null,stateBadge),
  ...work,column('tipperCount','Tippers loaded'),...(manyShifts?[]:[column('firstLoading','First loading'),column('lastLoading','Last loading')]),...idle(onPick),column('reason','Remark')];
}
export const stopColumns=[column('date','Date',s=>day(s.date)),column('shift','Shift'),column('machine','Loading machine'),column('fromClock','Loaded at',s=>s.from.clock),column('fromDoor','Tipper',s=>s.from.door),column('fromDriver','Driver',s=>s.from.driver||'—'),
 column('toClock','Next loading at',s=>s.to.clock),column('toDoor','Next tipper',s=>s.to.door),column('toDriver','Driver of next tipper',s=>s.to.driver||'—'),
 column('minutes','Idle minutes',null,s=><span className={'tt-band lm-'+s.band}>{s.minutes}</span>),column('band','Band',s=>BAND_LABELS[s.band]),column('book','Book no. of next tipper',s=>s.to.book)];
export const notWorkedColumns=[column('date','Date',e=>day(e.date)),column('shift','Shift'),column('door','Door no.'),column('machineName','Machine'),column('statusLabel','Status',null,stateBadge),column('reason','Reason'),
 column('hours','Hours worked'),column('bdHours','BD hours'),column('elbBooks','ELB book no.'),column('breakdowns','Breakdown in Pulse')];
export const cardColumns=[column('sr','Tr.Sr.No'),column('machine','Loading machine'),column('trips','Trips'),column('loadingTime','Loading time'),column('unloadingTime','Unloading time')];
const rowClass=r=>r.total?'tt-total':r.state==='breakdown'?'lm-row-breakdown':r.state==='nohours'?'lm-row-nohours':'';

export default function LoadingMachineReport({records=[],assets=[],fleet=[],batches=[],filters={},loading='',period='',ReportSection,dataReady=true,rowsView=null}){
 const [mode,setMode]=useState('idle'),[site,setSite]=useState(''),[slot,setSlot]=useState(null),[item,setItem]=useState(null),[only,setOnly]=useState(''),[card,setCard]=useState('');
 const entries=useMemo(()=>machineShifts(records,{assets,fleet,batches,filters}),[records,assets,fleet,batches,filters]);
 const visible=useMemo(()=>loading?entries.filter(e=>e.names.includes(loading)||e.door===loading):entries,[entries,loading]);
 const cardRows=useMemo(()=>card?tripEntries(records).filter(e=>e.recordId===card):[],[records,card]),cardHead=cardRows[0];
 const reset=()=>{setSite('');setSlot(null);setItem(null);setOnly('');setCard('');};
 const tabs=<nav className="production-tabs tt-tabs" aria-label="Report view">{[['idle','Machine working and idle time'],['rows','All machines list']].map(([key,label])=><button key={key} type="button" aria-current={mode===key?'page':undefined} onClick={()=>{setMode(key);reset();}}>{label}</button>)}</nav>;
 if(mode==='rows')return <div className="tt-report lm-report">{tabs}{rowsView}</div>;
 const band=BAND_LABELS[only]&&only!=='ok'?only:'';
 const sites=summarise(visible,'site');
 const siteEntries=!site?[]:site===EVERY?visible:visible.filter(e=>e.site===site),siteLabel=site===EVERY?'All sites':site;
 const shifts=summarise(siteEntries,'shift'),shiftsListed=only?shifts.rows.filter(r=>r[only]>0):shifts.rows;
 const slotEntries=!slot?[]:slot.key===EVERY?siteEntries:siteEntries.filter(e=>groupKey('shift',e)===slot.key);
 const machines=summarise(slotEntries,'machine'),machinesListed=only?machines.rows.filter(r=>r[only]>0):machines.rows;
 const itemEntries=!item?[]:item.key===EVERY?slotEntries:slotEntries.filter(e=>groupKey('machine',e)===item.key);
 const stops=idleStops(itemEntries,band),allStops=band?idleStops(itemEntries):stops,notWorked=shiftsNotWorked(itemEntries);
 const level=!site?1:!slot?2:!item?3:!card?4:5;
 const openSite=(row,pick='')=>{setSite(row.total?EVERY:row.key);setSlot(null);setItem(null);setOnly(pick);setCard('');};
 const openSlot=(row,pick=only)=>{setSlot(row.total?{key:EVERY,label:'All dates and shifts'}:{key:row.key,label:day(row.date)+' · '+row.shift});setItem(null);setOnly(pick);setCard('');};
 const openItem=(row,pick=only)=>{setItem(row.total?{key:EVERY,label:'All machines'}:{key:row.key,label:'Machine '+row.door});setOnly(pick);setCard('');};
 const crumbs=[['All sites',reset],...(site?[[siteLabel,()=>{setSlot(null);setItem(null);setCard('');}]]:[]),...(slot?[[slot.label,()=>{setItem(null);setCard('');}]]:[]),...(item?[[item.label,()=>setCard('')]]:[]),...(card?[[cardHead?.book||'Trip card',null]]:[])];
 const chips=(total,withStates)=><nav className="tt-chips" aria-label="Show only">{[['','All machines',total.machineShifts,''],...(withStates?[['breakdown',STATES.breakdown,total.breakdown,'lm-breakdown'],['nohours',STATES.nohours,total.nohours,'lm-nohours']]:[]),...BANDS.map(b=>[b.key,'Idle '+b.label,total[b.key],'lm-'+b.key])].map(([key,label,n,tone])=><button key={key||'all'} type="button" className={tone} aria-current={only===key?'page':undefined} onClick={()=>setOnly(key)}>{label} · {n}</button>)}</nav>;
 const stopChips=<nav className="tt-chips" aria-label="Idle band">{[['','All stops over '+IDLE_LIMIT+' min',allStops.length,''],...BANDS.map(b=>[b.key,b.label,allStops.filter(s=>s.band===b.key).length,'lm-'+b.key])].map(([key,label,n,tone])=><button key={key||'all'} type="button" className={tone} aria-current={band===key?'page':undefined} onClick={()=>setOnly(key)}>{label} · {n}</button>)}</nav>;
 const summaryLine=t=>t.machineShifts?`${t.running} of ${t.machineShifts} machine shifts ran, ${t.breakdown} were in BD and ${t.nohours} had no hours without BD. `
  +(t.percent===null?'':`The machines with an ELB worked ${t.percent}% of their shift hours (${t.hours} of ${t.shiftHours} hours). `)
  +`${t.trips} trips loaded. ${t.stops} idle stops of more than ${IDLE_LIMIT} minutes between loadings (${idleText(t.idleMinutes)} in all): ${BANDS.map(b=>t[b.key]+' in '+b.label).join(', ')}.`:'No loading machine in these dates and filters.';
 const withTotal=(rows,total)=>rows.length?[...rows,total]:[];
 const where=siteLabel+(slot?' · '+slot.label:'');
 // One step back: the step before the one on screen, as in the line of steps above the table.
 const back=level>1?crumbs[level-2][1]:null,backTo=level>1?'Back to '+crumbs[level-2][0]:'';
 const filtered=only?' · '+FILTERS[only]:'';
 return <div className="tt-report lm-report">{tabs}
  <nav className="tt-crumbs" aria-label="Steps">{back&&<StepBackButton onBack={back} label={backTo}/>}{crumbs.map(([label,go],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{go&&i<crumbs.length-1?<button type="button" onClick={go}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>
  {level===1&&<>
   <p className="tt-insight">{summaryLine(sites.total)}</p>
   <ReportSection key="lm-sites" reportKey="Loading machines sites" dataReady={dataReady} title={'Step 1 · Loading machines · All sites · '+period} category="operations-loading-sites" description="One line per site. Press a site to see it date by date and shift by shift. Press a coloured number to see only the shifts behind it."
    rows={withTotal(sites.rows,sites.total)} columns={summaryColumns('site',openSite)} rowKey={r=>r.id} rowClassName={rowClass} onRowClick={r=>openSite(r)} emptyMessage="No loading machine in these dates and filters."/>
  </>}
  {level===2&&<>
   <p className="tt-insight">{summaryLine(shifts.total)}</p>
   {chips(shifts.total,true)}
   <ReportSection key={'lm-shifts-'+site+only} reportKey="Loading machines shifts" dataReady={dataReady} title={'Step 2 · Loading machines · '+siteLabel+' · date-wise and shift-wise · '+period+filtered} category="operations-loading-shifts" description="One line per date and shift, newest first. Press a line to see the machines of that shift. Press the last line to see the machines for all the dates together. Idle time is complete only after the VLB of the shift is locked."
    rows={withTotal(shiftsListed,only?{...shifts.total,id:'shown-total'}:shifts.total)} columns={summaryColumns('shift',openSlot)} rowKey={r=>r.id} rowClassName={rowClass} onRowClick={r=>openSlot(r)} emptyMessage="No shift with such a machine here."/>
  </>}
  {level===3&&<>
   <p className="tt-insight">{summaryLine(machines.total)}</p>
   {chips(machines.total,true)}
   <ReportSection key={'lm-machines-'+site+slot.key+only} reportKey={'Loading machines of a shift'+(slot.key===EVERY?' together':'')} dataReady={dataReady} title={'Step 3 · Loading machines · '+where+filtered} category="operations-loading-machines" description="One line per loading machine: the running machines first with the most idle on top, then the machines in BD in red, then the machines with no hours in brown. Press a line to see its idle stops."
    rows={withTotal(machinesListed,only?{...machines.total,id:'shown-total'}:machines.total)} columns={machineColumns(openItem,slot.key===EVERY)} rowKey={r=>r.id} rowClassName={rowClass} onRowClick={r=>openItem(r)} emptyMessage="No such machine in this shift."/>
  </>}
  {level===4&&<>
   {stopChips}
   <ReportSection key={'lm-stops-'+item.key+slot.key+band} reportKey="Loading machine idle stops" dataReady={dataReady} title={'Step 4 · Idle stops · '+item.label+' · '+where+(band?' · '+BAND_LABELS[band]:'')} category="operations-loading-stops" description={'Every time the machine waited more than '+IDLE_LIMIT+' minutes between one loading and the next, in the order of the shift. Press a line to see the trip card of the tipper loaded after the stop.'}
    rows={stops} columns={stopColumns} rowKey={s=>s.id} onRowClick={s=>setCard(s.to.recordId)} emptyMessage={'No idle stop of more than '+IDLE_LIMIT+' minutes here.'}/>
   {notWorked.length>0&&<ReportSection key={'lm-notworked-'+item.key+slot.key} reportKey="Loading machine shifts not worked" dataReady={dataReady} title={'Shifts not worked · '+item.label+' · '+where} category="operations-loading-notworked" description="The shifts in which the machine did not run: in BD in red, no hours and not in BD in brown, with the reason on its ELB and the breakdown recorded in Pulse."
    rows={notWorked} columns={notWorkedColumns} rowKey={e=>e.id} rowClassName={rowClass} emptyMessage="The machine ran in every shift."/>}
  </>}
  {level===5&&cardHead&&<ReportSection key={'lm-card-'+card} reportKey="Loading machine trip card" dataReady={dataReady} showSearch={false} title={'Step 5 · Trip card '+cardHead.book} category="operations-loading-card" description={`${cardHead.site} · ${day(cardHead.date)} · ${cardHead.shift} · Door ${cardHead.door} · ${cardHead.driver||'Name not recorded'} · ${cardHead.caliberId||'ID not recorded'} · every trip row of this card`}
   rows={cardRows} columns={cardColumns} rowKey={e=>e.id} emptyMessage="No trip rows on this card."/>}
  <details className="tt-notes"><summary>How this report counts</summary><ul>
   <li>Trips loaded are the trips of every tipper card row that names the machine. A row with only an unloading time belongs to the shift that loaded it.</li>
   <li>An idle stop is the time from one loading to the next loading by the same machine, across all the tippers it loaded in the shift. {IDLE_LIMIT} minutes or less is normal working. The bands are more than 5 and up to 10 minutes, up to 15, up to 20, and more than 20. Total idle time adds up every stop of more than {IDLE_LIMIT} minutes in full.</li>
   <li>% of shift worked is the hours worked on the machine's ELB out of the hours of the shift: 8 hours in an 8-hour shift is 100%. On a line for many machines it is their hours together out of their shift hours together. A machine with no ELB is left out of it.</li>
   <li>Running: the machine loaded a trip or its ELB shows hours. In BD (red): it did not run and its ELB is saved as Breakdown or Maintenance, or Pulse shows breakdown for the whole shift. No hours, not in BD (brown): it did not run and was not in BD, such as No operator, Not in use, or no ELB entered.</li>
   <li>Only loading machines are listed: excavators, loaders and shovels of the site, and any machine named on a tipper card in the chosen dates.</li>
   <li>Tea and meal breaks are not removed. The wait before the first loading and after the last loading of the shift is not counted; the first and last loading times are shown.</li>
   <li>Not judged: the card was saved without times, the loading time is not written, or it falls far outside the shift. These trips are counted as loaded but make no idle stop.</li>
   <li>Until every tipper card of a shift is entered, a machine looks more idle than it was. Entry stage shows whether the VLB of the shift is locked.</li>
  </ul></details>
 </div>;
}
