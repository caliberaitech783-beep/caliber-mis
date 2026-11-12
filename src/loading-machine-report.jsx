import React,{useMemo,useState} from 'react';
import {StepBackButton} from './step-back.jsx';
import {BANDS,BAND_LABELS,IDLE_LIMIT,WAIT_LIMIT,STATES,TONE_LABELS,machineShifts,summarise,loadingLines,shiftTimeline,shiftsNotWorked,idleText,groupKey,clockAt} from '../shared/loading-machine-report.mjs';
import {tripEntries} from '../shared/trip-timing-report.mjs';
import './trip-timing-report.css';
import './loading-machine-report.css';

// Loading Equipment-wise Report: every loading machine of a site in a shift, with its trips, the share of the shift it
// worked and its idle stops between loadings. A machine in BD is a red line; a machine with no hours and not in BD is brown.
// It drills in five steps like the Trip Timing & Gap Report: all sites, one site date by date and shift by shift, the
// machines of one shift, the shift time-line of one machine (every loading in green, orange or red), the full trip card.
// A report only: it reads the saved log books already loaded by the shared operations screen.
const EVERY='*';
// More shifts than this are not drawn one under the other; the list below them still carries every loading.
const MAX_STRIPS=31;
const blank=v=>v===null||v===undefined||v==='';
// `sortBy` gives the number behind a text such as "56.6%" or "3 h 05 min", so that the column sorts in the order of the figure.
const column=(key,label,value,render,sortBy)=>({key,label,value:value||(r=>blank(r[key])?'—':r[key]),...(render?{render}:{}),...(sortBy?{sortValue:sortBy}:{})});
const day=date=>/^\d{4}-\d{2}-\d{2}/.test(String(date))?date.slice(8,10)+'-'+date.slice(5,7)+'-'+date.slice(2,4):date;
const share=r=>blank(r.percent)?'—':r.percent+'%';
const plural=(n,one,many=one+'s')=>n+' '+(n===1?one:many);
const FILTERS={...BAND_LABELS,breakdown:STATES.breakdown,nohours:STATES.nohours};
const isBand=key=>BANDS.some(b=>b.key===key);
// A coloured number: pressing it opens the next step with only the lines behind it.
const counted=(key,label,className,onPick)=>column(key,label,null,r=>r[key]>0?(onPick?<button type="button" className={className} title={'Show only '+label} onClick={e=>{e.stopPropagation();onPick(r,key);}}>{r[key]}</button>:<span className={className}>{r[key]}</span>):r[key]);
// An idle band: the coloured number of stops with, just beside it, its own share of all the timed gaps between two loadings
// on the line. The printed and downloaded report carries both as "269 (5.9%)"; the column still sorts by the number of stops.
const banded=(b,onPick)=>{
 const key=b.key,className='tt-band lm-'+key,share=r=>r[key+'Share']+'%';
 return column(key,b.label,r=>r[key]>0?r[key]+' ('+share(r)+')':r[key],r=>r[key]>0?<span className="lm-banded">
  {onPick?<button type="button" className={className} title={'Show only '+b.label} onClick={e=>{e.stopPropagation();onPick(r,key);}}>{r[key]}</button>:<span className={className}>{r[key]}</span>}
  <span className="lm-share" title={r[key]+' of '+r.gaps+' timed gaps between two loadings'}>{share(r)}</span></span>:r[key],r=>r[key]);
};
const stateBadge=r=>r.state&&r.state!=='mixed'?<span className={'lm-status lm-status-'+r.state}>{r.statusLabel}</span>:r.statusLabel||'—';

const identity={
 site:[column('site','Site'),column('machineShifts','Machine shifts')],
 shift:[column('date','Date',r=>r.total?'ALL DATES':day(r.date)),column('shift','Shift'),column('stageLabel','Entry stage'),column('machineShifts','Machines')]
};
// The table sorts itself by any column it takes for a duration (a key such as `hours`, a heading such as "BD hours"). The lines
// here have their own order, so these keys and headings are chosen to stay clear of that rule.
const work=[column('trips','Trips loaded'),column('percent','% of shift worked',share,null,r=>r.percent??-1),column('hoursWorked','Hours worked',r=>blank(r.hours)?'—':r.hours)];
const more=[column('shiftHours','Shift hours',r=>r.shiftHours||'—'),column('bdHours','Hours in BD'),column('notJudged','Not judged')];
const idle=onPick=>[...BANDS.map(b=>banded(b,onPick)),column('stops','Total idle stops'),column('idleMinutes','Total idle time',r=>r.running?idleText(r.idleMinutes):'—',null,r=>r.running?r.idleMinutes:-1),column('longest','Longest idle (min)')];
export function summaryColumns(group,onPick){
 return [...identity[group],column('running',STATES.running),counted('breakdown',STATES.breakdown,'lm-count lm-breakdown',onPick),counted('nohours',STATES.nohours,'lm-count lm-nohours',onPick),...work,...idle(onPick),...more];
}
export function machineColumns(onPick,manyShifts=false){
 return [column('door','Door no.'),column('machineName','Machine'),column('operator','Operator'),...(manyShifts?[column('machineShifts','Shifts')]:[]),column('statusLabel','Status',null,stateBadge),
  ...work,...idle(onPick),...(manyShifts?[]:[column('firstLoading','First loading'),column('lastLoading','Last loading')]),column('tipperCount','Tippers loaded'),...more,column('reason','Remark')];
}
// One line per loading: when the machine loaded, how long after the loading before, in which colour, and for an idle stop
// the tipper trips delayed in it. `many` adds the date, shift and machine, for a list across shifts or machines.
const colourText=l=>l.band==='first'?'First loading':TONE_LABELS[l.tone]+' · '+BAND_LABELS[l.band];
const waitingText=l=>l.delayed.map(d=>d.door+' · '+d.waited+' min').join(', ')||'—';
export function tripColumns(many=false){
 return [...(many?[column('date','Date',l=>day(l.date)),column('shift','Shift'),column('machine','Loading machine')]:[]),
  column('fromClock','Loading before at',l=>l.from?.clock||'—'),column('toClock','Loaded at',l=>l.to.clock),
  column('minutes','Gap from loading before (min)',l=>l.band==='first'?'—':l.minutes,l=>l.band==='first'?'—':<span className={'tt-band lm-'+l.band}>{l.minutes}</span>,l=>l.minutes??-1),
  column('band','Colour',colourText),column('toDoor','Tipper loaded',l=>l.to.door),column('toDriver','Driver',l=>l.to.driver||'—'),
  column('delayedCount','Tipper trips delayed',l=>l.band==='first'||l.band==='ok'?'—':l.delayed.length,l=>l.delayed.length>0?<span className="lm-count lm-delayed">{l.delayed.length}</span>:l.band==='first'||l.band==='ok'?'—':0,l=>l.delayed.length),
  column('waiting','Tippers delayed · unloading to loading',waitingText),column('breakdown','Breakdown in Pulse',l=>l.breakdown||'—'),column('book','Book no.',l=>l.to.book)];
}
export const notWorkedColumns=[column('date','Date',e=>day(e.date)),column('shift','Shift'),column('door','Door no.'),column('machineName','Machine'),column('statusLabel','Status',null,stateBadge),column('reason','Reason'),
 column('hoursWorked','Hours worked',e=>blank(e.hours)?'—':e.hours),column('bdHours','Hours in BD'),column('elbBooks','ELB book no.'),column('breakdowns','Breakdown in Pulse')];
export const cardColumns=[column('sr','Tr.Sr.No'),column('machine','Loading machine'),column('trips','Trips'),column('loadingTime','Loading time'),column('unloadingTime','Unloading time')];
// The line for all of them stays at the foot of the table, whatever the table is sorted by.
const isTotal=r=>Boolean(r.total);
const rowClass=r=>r.total?'tt-total':r.state==='breakdown'?'lm-row-breakdown':r.state==='nohours'?'lm-row-nohours':'';
const lineClass=l=>'lm-line lm-line-'+l.tone;

// The shift as a strip from its first hour to its last. Every piece is the time from one loading to the next, in the
// colour of its band; the grey before the first piece and after the last is the time the report does not judge.
const place=(t,from,to)=>({left:((from-t.lo)/(t.hi-t.lo)*100).toFixed(3)+'%',...(to===undefined?{}:{width:((to-from)/(t.hi-t.lo)*100).toFixed(3)+'%'})});
function Strip({entry,label,single,onPick}){
 const t=shiftTimeline(entry);
 const wide=single?0.026:0.045;
 return <div className={'lm-tl-row'+(single?' lm-tl-single':'')}>
  {label&&<div className="lm-tl-label" title={label}>{label}</div>}
  <div className="lm-tl-body">
   <div className="lm-tl-track" role="img" aria-label={`${entry.door}, ${day(entry.date)}, ${entry.shift}: ${entry.loadings} loadings from ${t.firstClock} to ${t.lastClock}; ${entry.ok} within ${IDLE_LIMIT} minutes, ${entry.b1+entry.b2+entry.b3} after ${IDLE_LIMIT} to 20 minutes, ${entry.b4} after more than 20 minutes`}>
    {t.pieces.map(p=><span key={p.id} className={'lm-seg lm-seg-'+p.band} style={place(t,p.from,p.to)} onClick={()=>onPick(p.band)}
     title={`${p.fromClock} to ${p.toClock} · ${p.minutes} min · ${BAND_LABELS[p.band]} · next tipper ${p.door}`+(p.delayed?' · '+plural(p.delayed,'tipper trip')+' delayed':'')+(p.breakdown?' · Breakdown in Pulse: '+p.breakdown:'')}>{p.band!=='ok'&&(p.to-p.from)/(t.hi-t.lo)>=wide?Math.round(p.minutes):''}</span>)}
    <span className="lm-seg lm-seg-end" style={place(t,t.last)} aria-hidden="true"/>
   </div>
   {t.breakdowns.length>0&&<div className="lm-tl-bd">{t.breakdowns.map((b,i)=><span key={i} style={place(t,b.from,b.to)} title={'Breakdown in Pulse · '+b.label}/>)}</div>}
   <div className="lm-tl-axis" aria-hidden="true">{t.marks.map(m=><span key={m.at} className={m.edge?'lm-edge':undefined} style={place(t,m.at)}>{m.clock}</span>)}</div>
   {single&&<div className="lm-tl-hours">{t.hours.map(h=><div key={h.id} className={'lm-hour lm-hour-'+h.worst} style={place(t,h.from,h.to)}
     title={`${h.label}: ${plural(h.loadings,'loading')} (${h.count.green} green, ${h.count.orange} orange, ${h.count.red} red) · minutes of the hour in green ${h.green}, in orange ${h.orange}, in red ${h.red}, before the first or after the last loading ${h.rest}`}>
     <b>{h.loadings}</b> {h.loadings===1?'trip':'trips'}
     <span className="lm-hour-counts">{h.loadings>0?['green','orange','red'].filter(tone=>h.count[tone]>0).map(tone=><i key={tone} className={'lm-pill lm-pill-'+tone}>{h.count[tone]}</i>):<em>{h.worst==='rest'?'Not judged':'No loading'}</em>}</span>
    </div>)}</div>}
  </div>
 </div>;
}
export function ShiftTimelines({entries=[],title='',onPick=()=>{}}){
 const drawn=entries.filter(e=>e.lines.length).sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.shift.localeCompare(b.shift,undefined,{numeric:true})||a.door.localeCompare(b.door,undefined,{numeric:true}));
 if(!drawn.length)return null;
 const shown=drawn.slice(0,MAX_STRIPS),single=drawn.length===1,manyShifts=new Set(drawn.map(e=>e.slotKey)).size>1,manyMachines=new Set(drawn.map(e=>e.machineKey)).size>1;
 const label=e=>single?'':[manyShifts&&day(e.date)+' · '+e.shift,(manyMachines||!manyShifts)&&e.door].filter(Boolean).join(' · ');
 // One shift names itself in full, with its hours; many shifts carry the name of what was opened.
 const one=drawn[0],heading=single?'Machine '+one.door+' · '+one.site+' · '+day(one.date)+' · '+one.shift+(one.axis.known?' · '+clockAt(one.axis.start)+' to '+clockAt(one.axis.start,one.axis.minutes):''):title;
 return <section className="lm-timeline" aria-label="Shift time-line">
  <h3>Shift time-line · {heading}</h3>
  <p className="lm-tl-legend"><span><i className="lm-seg-ok"/>Green · up to {IDLE_LIMIT} min after the loading before</span><span><i className="lm-seg-b1"/><i className="lm-seg-b2"/><i className="lm-seg-b3"/>Orange · 5 to 10, 10 to 15, 15 to 20 min</span><span><i className="lm-seg-b4"/>Red · more than 20 min</span><span><i className="lm-tl-rest"/>Before the first or after the last loading</span>{shown.some(e=>e.bdPeriods.length>0)&&<span><i className="lm-tl-bdkey"/>Breakdown recorded in Pulse</span>}</p>
  <div className="lm-tl-scroll"><div className="lm-tl-inner">{shown.map(e=><Strip key={e.id} entry={e} label={label(e)} single={single} onPick={onPick}/>)}</div></div>
  <p className="lm-tl-foot">Every line inside the strip is one loading; the number on a piece is its minutes. {single?'Below each hour: the trips loaded in it, and how many of them came in green, orange and red. ':''}Press a colour to list only those loadings.{drawn.length>shown.length?` The newest ${shown.length} of ${drawn.length} shifts are drawn; the list below has all of them.`:''}</p>
 </section>;
}

export default function LoadingMachineReport({records=[],assets=[],fleet=[],batches=[],filters={},loading='',period='',ReportSection,dataReady=true,rowsView=null}){
 const [mode,setMode]=useState('idle'),[site,setSite]=useState(''),[slot,setSlot]=useState(null),[item,setItem]=useState(null),[only,setOnly]=useState(''),[card,setCard]=useState('');
 const entries=useMemo(()=>machineShifts(records,{assets,fleet,batches,filters}),[records,assets,fleet,batches,filters]);
 const visible=useMemo(()=>loading?entries.filter(e=>e.names.includes(loading)||e.door===loading):entries,[entries,loading]);
 const cardRows=useMemo(()=>card?tripEntries(records).filter(e=>e.recordId===card):[],[records,card]),cardHead=cardRows[0];
 const reset=()=>{setSite('');setSlot(null);setItem(null);setOnly('');setCard('');};
 const tabs=<nav className="production-tabs tt-tabs" aria-label="Report view">{[['idle','Machine working and idle time'],['rows','All machines list']].map(([key,label])=><button key={key} type="button" aria-current={mode===key?'page':undefined} onClick={()=>{setMode(key);reset();}}>{label}</button>)}</nav>;
 if(mode==='rows')return <div className="tt-report lm-report">{tabs}{rowsView}</div>;
 const band=isBand(only)?only:'';
 const sites=summarise(visible,'site');
 const siteEntries=!site?[]:site===EVERY?visible:visible.filter(e=>e.site===site),siteLabel=site===EVERY?'All sites':site;
 const shifts=summarise(siteEntries,'shift'),shiftsListed=only?shifts.rows.filter(r=>r[only]>0):shifts.rows;
 const slotEntries=!slot?[]:slot.key===EVERY?siteEntries:siteEntries.filter(e=>groupKey('shift',e)===slot.key);
 const machines=summarise(slotEntries,'machine'),machinesListed=only?machines.rows.filter(r=>r[only]>0):machines.rows;
 const itemEntries=!item?[]:item.key===EVERY?slotEntries:slotEntries.filter(e=>groupKey('machine',e)===item.key);
 const level=!site?1:!slot?2:!item?3:!card?4:5;
 // Step 4 lists every loading of the machine; a colour chip or a coloured number keeps one colour only.
 // A machine that did not run in the lines opened has no loading to list: only what its ELB says is shown.
 const pick=band||(only==='ok'?'ok':''),ran=itemEntries.some(e=>e.state==='running'),notWorked=shiftsNotWorked(itemEntries);
 const lines=level===4?loadingLines(itemEntries,pick):[],opened=summarise(itemEntries,'machine').total,manyLines=itemEntries.length>1;
 // Step 3 with a band chosen also lists the stops of that band for all its machines, each with the tipper trips delayed in it.
 const bandStops=level===3&&band?loadingLines(slotEntries,band):[];
 const openSite=(row,pick='')=>{setSite(row.total?EVERY:row.key);setSlot(null);setItem(null);setOnly(pick);setCard('');};
 const openSlot=(row,pick=only)=>{setSlot(row.total?{key:EVERY,label:'All dates and shifts'}:{key:row.key,label:day(row.date)+' · '+row.shift});setItem(null);setOnly(pick);setCard('');};
 const openItem=(row,pick=only)=>{setItem(row.total?{key:EVERY,label:'All machines'}:{key:row.key,label:'Machine '+row.door});setOnly(pick);setCard('');};
 // The green chip belongs to the time-line of a machine only; the steps above it do not know it.
 const upward=()=>setOnly(o=>o==='ok'?'':o);
 const crumbs=[['All sites',reset],...(site?[[siteLabel,()=>{setSlot(null);setItem(null);setCard('');upward();}]]:[]),...(slot?[[slot.label,()=>{setItem(null);setCard('');upward();}]]:[]),...(item?[[item.label,()=>setCard('')]]:[]),...(card?[[cardHead?.book||'Trip card',null]]:[])];
 const chips=(total,withStates)=><nav className="tt-chips" aria-label="Show only">{[['','All machines',total.machineShifts,''],...(withStates?[['breakdown',STATES.breakdown,total.breakdown,'lm-breakdown'],['nohours',STATES.nohours,total.nohours,'lm-nohours']]:[]),...BANDS.map(b=>[b.key,'Idle '+b.label,total[b.key],'lm-'+b.key])].map(([key,label,n,tone])=><button key={key||'all'} type="button" className={tone} aria-current={only===key?'page':undefined} onClick={()=>setOnly(key)}>{label} · {n}</button>)}</nav>;
 const tripChips=<nav className="tt-chips" aria-label="Show only">{[['','All trips',opened.loadings,''],['ok','Green · '+BAND_LABELS.ok,opened.ok,'lm-ok'],...BANDS.map(b=>[b.key,(b.key==='b4'?'Red · ':'Orange · ')+b.label,opened[b.key],'lm-'+b.key])].map(([key,label,n,tone])=><button key={key||'all'} type="button" className={tone} aria-current={pick===key?'page':undefined} onClick={()=>setOnly(key)}>{label} · {n}</button>)}</nav>;
 const summaryLine=t=>t.machineShifts?`${t.running} of ${t.machineShifts} machine shifts ran, ${t.breakdown} were in BD and ${t.nohours} had no hours without BD. `
  +(t.percent===null?'':`The machines with an ELB worked ${t.percent}% of their shift hours (${t.hours} of ${t.shiftHours} hours). `)
  +`${t.trips} trips loaded. `+(t.gaps?`Out of ${t.gaps} timed gaps between two loadings, ${t.stops} were idle stops of more than ${IDLE_LIMIT} minutes (${idleText(t.idleMinutes)} in all): ${BANDS.map(b=>`${t[b.key]} in ${b.label} (${t[b.key+'Share']}%)`).join(', ')}.`:'No gap between two loadings could be timed.'):'No loading machine in these dates and filters.';
 // What the time-line says in words; with a band chosen, also the stops of that band and the tipper trips delayed in them.
 const stopWords=l=>`${l.minutes} minutes from ${l.from.clock} to ${l.to.clock}`+(manyLines?` (${l.machine}, ${day(l.date)})`:'')+`, ${plural(l.delayed.length,'tipper trip')} delayed`;
 const timelineLine=t=>{
  if(!t.loadings)return 'No loading with a time here: the tipper cards were saved without times, or no tipper card names the machine.';
  const delayedHere=new Set(lines.flatMap(l=>l.delayed.map(d=>d.key))).size;
  return `${plural(t.loadings,'loading')} with a time. ${t.ok} came within ${IDLE_LIMIT} minutes of the loading before (green), ${t.b1+t.b2+t.b3} after ${IDLE_LIMIT} to 20 minutes (orange) and ${t.b4} after more than 20 minutes (red). `
   +`The idle stops add up to ${idleText(t.idleMinutes)}`+(t.longest===null?'':`; the longest gap was ${t.longest} minutes`)+`. ${plural(t.delayed,'tipper trip')} delayed during the idle stops.`
   +(band?` ${BAND_LABELS[band]}: ${plural(lines.length,'stop')}`+(lines.length?`, ${idleText(lines.reduce((s,l)=>s+l.minutes,0))} in all, ${plural(delayedHere,'tipper trip')} delayed in ${lines.length===1?'it':'them'}`:'')+(lines.length&&lines.length<=3?': '+lines.map(stopWords).join('; '):'')+'.':'');
 };
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
    rows={withTotal(sites.rows,sites.total)} columns={summaryColumns('site',openSite)} rowKey={r=>r.id} rowClassName={rowClass} isTotalRow={isTotal} onRowClick={r=>openSite(r)} emptyMessage="No loading machine in these dates and filters."/>
  </>}
  {level===2&&<>
   <p className="tt-insight">{summaryLine(shifts.total)}</p>
   {chips(shifts.total,true)}
   <ReportSection key={'lm-shifts-'+site+only} reportKey="Loading machines shifts" dataReady={dataReady} title={'Step 2 · Loading machines · '+siteLabel+' · date-wise and shift-wise · '+period+filtered} category="operations-loading-shifts" description="One line per date and shift, newest first. Press a line to see the machines of that shift. Press the last line to see the machines for all the dates together. Idle time is complete only after the VLB of the shift is locked."
    rows={withTotal(shiftsListed,only?{...shifts.total,id:'shown-total'}:shifts.total)} columns={summaryColumns('shift',openSlot)} rowKey={r=>r.id} rowClassName={rowClass} isTotalRow={isTotal} onRowClick={r=>openSlot(r)} emptyMessage="No shift with such a machine here."/>
  </>}
  {level===3&&<>
   <p className="tt-insight">{summaryLine(machines.total)}</p>
   {chips(machines.total,true)}
   <ReportSection key={'lm-machines-'+site+slot.key+only} reportKey={'Loading machines of a shift'+(slot.key===EVERY?' together':'')} dataReady={dataReady} title={'Step 3 · Loading machines · '+where+filtered} category="operations-loading-machines" description="One line per loading machine: the running machines first with the most idle on top, then the machines in BD in red, then the machines with no hours in brown. Press a line to see the shift time-line of the machine: every loading in green, orange or red. Press a coloured number to see only those stops."
    rows={withTotal(machinesListed,only?{...machines.total,id:'shown-total'}:machines.total)} columns={machineColumns(openItem,slot.key===EVERY)} rowKey={r=>r.id} rowClassName={rowClass} isTotalRow={isTotal} onRowClick={r=>openItem(r)} emptyMessage="No such machine in this shift."/>
   {band&&<ReportSection key={'lm-bandstops-'+site+slot.key+band} reportKey="Loading machines stops of a band" dataReady={dataReady} title={'Idle stops of '+BAND_LABELS[band]+' · every machine · '+where} category="operations-loading-bandstops" description={'Every stop of '+BAND_LABELS[band]+' of the machines above, with the tipper trips delayed in it. Press a line to see the shift time-line of that machine.'}
    recordDateFilter={slot.key===EVERY?null:false} rows={bandStops} columns={tripColumns(true)} rowKey={l=>l.id} rowClassName={lineClass} onRowClick={l=>openItem({key:l.machineKey,door:l.machine},band)} emptyMessage={'No stop of '+BAND_LABELS[band]+' here.'}/>}
  </>}
  {level===4&&<>
   {ran&&<p className="tt-insight">{timelineLine(opened)}</p>}
   {ran&&<ShiftTimelines entries={itemEntries} title={item.label+' · '+where} onPick={setOnly}/>}
   {ran&&tripChips}
   {ran&&<ReportSection key={'lm-trips-'+item.key+slot.key+pick} reportKey={'Loading machine loadings'+(manyLines?' together':'')} dataReady={dataReady} title={'Step 4 · Every loading · '+item.label+' · '+where+(pick?' · '+BAND_LABELS[pick]:'')} category="operations-loading-stops" description={'One line per loading in the order of the shift, with the minutes since the loading before: green up to '+IDLE_LIMIT+' minutes, orange up to 20, red above 20. An idle stop shows the tipper trips delayed in it. Press a line to see the trip card of the tipper loaded.'}
    recordDateFilter={slot.key===EVERY?null:false} rows={lines} columns={tripColumns(manyLines)} rowKey={l=>l.id} rowClassName={lineClass} onRowClick={l=>setCard(l.to.recordId)} emptyMessage={pick?'No loading of '+BAND_LABELS[pick]+' here.':'No loading with a time here.'}/>}
   {notWorked.length>0&&<ReportSection key={'lm-notworked-'+item.key+slot.key} reportKey="Loading machine shifts not worked" dataReady={dataReady} title={(ran?'':'Step 4 · ')+'Shifts not worked · '+item.label+' · '+where} category="operations-loading-notworked" description="The shifts in which the machine did not run: in BD in red, no hours and not in BD in brown, with the reason on its ELB and the breakdown recorded in Pulse."
    rows={notWorked} columns={notWorkedColumns} rowKey={e=>e.id} rowClassName={rowClass} emptyMessage="The machine ran in every shift."/>}
  </>}
  {level===5&&cardHead&&<ReportSection key={'lm-card-'+card} reportKey="Loading machine trip card" dataReady={dataReady} showSearch={false} title={'Step 5 · Trip card '+cardHead.book} category="operations-loading-card" description={`${cardHead.site} · ${day(cardHead.date)} · ${cardHead.shift} · Door ${cardHead.door} · ${cardHead.driver||'Name not recorded'} · ${cardHead.caliberId||'ID not recorded'} · every trip row of this card`}
   rows={cardRows} columns={cardColumns} rowKey={e=>e.id} emptyMessage="No trip rows on this card."/>}
  <details className="tt-notes"><summary>How this report counts</summary><ul>
   <li>Trips loaded are the trips of every tipper card row that names the machine. A row with only an unloading time belongs to the shift that loaded it.</li>
   <li>An idle stop is the time from one loading to the next loading by the same machine, across all the tippers it loaded in the shift. {IDLE_LIMIT} minutes or less is normal working. The bands are more than 5 and up to 10 minutes, up to 15, up to 20, and more than 20. Total idle time adds up every stop of more than {IDLE_LIMIT} minutes in full.</li>
   <li>The shift time-line of a machine shows every loading that has a time, in the order of the shift. Green: it came within {IDLE_LIMIT} minutes of the loading before. Orange: after more than {IDLE_LIMIT} and up to 20 minutes. Red: after more than 20 minutes. The first loading of the shift has no loading before it and no colour.</li>
   <li>Tipper trips delayed in an idle stop: the tipper was loaded by this machine at the end of the stop or after it, took more than {WAIT_LIMIT} minutes from its unloading to that loading (a delay in the Trip Timing &amp; Gap Report), and stood empty for more than {IDLE_LIMIT} minutes of the stop. The minutes beside each tipper are its time from unloading to loading. The cards cannot tell whether the tippers waited for the machine or the machine for the tippers: a stop with no tipper trip delayed means no tipper was waiting.</li>
   <li>Breakdown in Pulse is shown against a stop when a breakdown of the machine recorded in Pulse falls inside it. It needs the ELB of the machine to be saved.</li>
   <li>The % beside each idle count is that band's own share of all the timed gaps between one loading and the next on the same line, the normal gaps of {IDLE_LIMIT} minutes or less included: 50 stops out of 1,000 timed gaps is 5%. Each band has its own %; together with normal working they add up to 100%.</li>
   <li>% of shift worked is the hours worked on the machine's ELB out of the hours of the shift: 8 hours in an 8-hour shift is 100%. On a line for many machines it is their hours together out of their shift hours together. A machine with no ELB is left out of it.</li>
   <li>Running: the machine loaded a trip or its ELB shows hours. In BD (red line): it did not run and its ELB is saved as Breakdown or Maintenance, or Pulse shows breakdown for the whole shift. No hours, not in BD (brown): it did not run and was not in BD, such as No operator, Not in use, or no ELB entered.</li>
   <li>Only loading machines are listed: excavators, loaders and shovels of the site, and any machine named on a tipper card in the chosen dates.</li>
   <li>Tea and meal breaks are not removed. The wait before the first loading and after the last loading of the shift is not counted; the first and last loading times are shown.</li>
   <li>Not judged: the card was saved without times, the loading time is not written, or it falls far outside the shift. These trips are counted as loaded but make no idle stop and are not on the time-line.</li>
   <li>Until every tipper card of a shift is entered, a machine looks more idle than it was. Entry stage shows whether the VLB of the shift is locked.</li>
  </ul></details>
 </div>;
}
