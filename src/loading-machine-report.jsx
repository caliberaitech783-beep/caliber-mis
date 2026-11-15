import React,{useLayoutEffect,useMemo,useRef,useState} from 'react';
import {StepBackButton} from './step-back.jsx';
import {DateShiftGrid,dateShiftGrid,dateShiftExport} from './date-shift-grid.jsx';
import {BANDS,BAND_LABELS,IDLE_LIMIT,RED_AFTER,WAIT_LIMIT,STATES,TONE_LABELS,machineShifts,summarise,loadingLines,shiftTimeline,clockTags,shiftsNotWorked,idleText,groupKey,clockAt,breakdownText} from '../shared/loading-machine-report.mjs';
import {tripEntries} from '../shared/trip-timing-report.mjs';
import './trip-timing-report.css';
import './loading-machine-report.css';

// Loading Equipment-wise Report: every loading machine of a site in a shift, with its trips, the share of the shift it
// worked and its idle stops between loadings. A machine in BD is a red line; a machine with no hours and not in BD is brown.
// It drills down like the Trip Timing & Gap Report: all sites; one site date by date and shift by shift, with its machines
// under the grid (every date and shift until a box is pressed); one machine as an 8-hour strip per shift, one under the
// other; one shift full width with the clock time of every change of colour and every loading; the full trip card.
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
// Minutes the machines were in breakdown in Pulse, by the clock of the shift: taken out of the idle time.
const inBd=column('bdMinutes','In BD (Pulse)',r=>r.bdMinutes>0?idleText(r.bdMinutes):'—',r=>r.bdMinutes>0?<span className="lm-count lm-bdcount">{idleText(r.bdMinutes)}</span>:'—',r=>r.bdMinutes||0);
const idle=onPick=>[...BANDS.map(b=>banded(b,onPick)),column('stops','Total idle stops'),column('idleMinutes','Total idle time',r=>r.running?idleText(r.idleMinutes):'—',null,r=>r.running?r.idleMinutes:-1),column('longest','Longest idle (min)'),inBd];
export function summaryColumns(group,onPick){
 return [...identity[group],column('running',STATES.running),counted('breakdown',STATES.breakdown,'lm-count lm-breakdown',onPick),counted('nohours',STATES.nohours,'lm-count lm-nohours',onPick),...work,...idle(onPick),...more];
}
// Owner, 15 Nov 2026: Step 3 fits the screen; First and Last loading, Shift hours, Hours in BD and Not judged are left off
// the screen and kept in Smart Print, PDF and Excel (`printOnly`).
const printOnly=c=>({...c,printOnly:true});
// Over many shifts a machine has had many operators: the screen names the first and counts the rest (all of them in the
// pop-up), so that the line stays one line high; Smart Print, PDF and Excel carry every name.
const operatorShort=r=>{const names=String(r.operator||'').split(', ').filter(Boolean);return names.length>2?<span title={r.operator}>{names[0]} +{names.length-1} more</span>:r.operator||'—';};
export function machineColumns(onPick,manyShifts=false){
 return [column('door','Door no.'),column('machineName','Machine'),column('operator','Operator',null,manyShifts?operatorShort:null),...(manyShifts?[column('machineShifts','Shifts')]:[]),column('statusLabel','Status',null,stateBadge),
  ...work,...idle(onPick),...(manyShifts?[]:[column('firstLoading','First loading'),column('lastLoading','Last loading')].map(printOnly)),column('tipperCount','Tippers loaded'),...more.map(printOnly),column('reason','Remark')];
}
// One line per loading: when the machine loaded, how long after the loading before, in which colour, and for an idle stop
// the tipper trips delayed in it. `many` adds the date, shift and machine, for a list across shifts or machines.
const colourText=l=>l.band==='first'?'First loading':TONE_LABELS[l.tone]+' · '+BAND_LABELS[l.band];
const waitingText=l=>l.delayed.map(d=>d.door+' · '+d.waited+' min').join(', ')||'—';
export function tripColumns(many=false){
 return [...(many?[column('date','Date',l=>day(l.date)),column('shift','Shift'),column('machine','Loading machine')]:[]),
  column('fromClock','Loading before at',l=>l.from?.clock||'—'),column('toClock','Loaded at',l=>l.to.clock),
  column('gapAll','Gap from loading before (min)',l=>l.band==='first'?'—':l.gap??l.minutes,null,l=>l.gap??-1),
  column('bdIn','Of it in BD (min)',l=>l.bdMinutes>0?l.bdMinutes:'—',l=>l.bdMinutes>0?<span className="lm-count lm-bdcount">{l.bdMinutes}</span>:'—',l=>l.bdMinutes||0),
  column('minutes','Idle (min)',l=>l.band==='first'?'—':l.minutes,l=>l.band==='first'?'—':<span className={'tt-band lm-'+l.band}>{l.minutes}</span>,l=>l.minutes??-1),
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

// The shift as a strip over all its hours. Every piece is the time from one loading to the next; it starts green and
// turns orange at its 5th minute and red at its 20th, so the strip shows at what clock time the machine went orange and
// red. The grey before the first loading and after the last is named; the report does not judge it.
const place=(t,from,to)=>({left:((from-t.lo)/(t.hi-t.lo)*100).toFixed(3)+'%',...(to===undefined?{}:{width:((to-from)/(t.hi-t.lo)*100).toFixed(3)+'%'})});
// Inside a piece, each colour part is placed as a share of the piece itself.
const within=(p,part)=>({left:((part.from-p.from)/(p.to-p.from)*100).toFixed(3)+'%',width:((part.to-part.from)/(p.to-p.from)*100).toFixed(3)+'%'});
// The wording of a piece, for its pop-up and for the line under the strip when it is pressed.
// A breakdown inside the gap is named in its place among the turns; its minutes are not idle.
export function pieceText(p){
 const bd=p.bdMinutes>0?` · ${p.gap} min between loadings, ${p.bdMinutes} min of it in breakdown`:'';
 if(p.band==='ok'&&!bd)return `${p.fromClock} loading (${p.fromDoor}) to ${p.toClock} loading (${p.door}) · ${p.minutes} min · green`;
 return [`${p.fromClock} loading (${p.fromDoor})`,...p.events.map(e=>`${e.clock} ${e.words}`),`${p.toClock} next loading (${p.door})`].join(' → ')
  +bd+` · ${p.minutes} min idle · ${BAND_LABELS[p.band]}`+(p.delayed?' · '+plural(p.delayed,'tipper trip')+' delayed':'')+(p.breakdown?' · Breakdown in Pulse: '+p.breakdown:'');
}
// Wide enough for its text: a share of the strip (single view of one shift, many shifts one under the other).
const roomy=(t,from,to,share)=>(to-from)/(t.hi-t.lo)>=share;
// A machine shift is drawn when it has a timed loading, or when Pulse shows it in breakdown during the shift.
const canDraw=e=>e.lines.length>0||e.bdPeriods.length>0&&e.axis.known;
const bdLength=m=>m>=120?Math.floor(m/60)+' h '+String(Math.round(m%60)).padStart(2,'0')+' min':Math.round(m)+' min';
function Strip({entry,label,single,onPick,onOpen,picked=false}){
 const t=shiftTimeline(entry);
 const [chosen,setChosen]=useState('');
 // The tags are placed by the real width of the strip on this screen: about 7.4 px a letter and 16 px of padding and edge,
 // so that on a narrow screen a tag near the end of the shift reads leftwards instead of running off the strip.
 const track=useRef(null),[trackPx,setTrackPx]=useState(1000);
 useLayoutEffect(()=>{const el=track.current;if(!el)return;const measure=()=>{if(el.clientWidth>0)setTrackPx(el.clientWidth);};measure();
  if(typeof ResizeObserver==='undefined')return;const watch=new ResizeObserver(measure);watch.observe(el);return()=>watch.disconnect();},[]);
 const perPx=(t.hi-t.lo)/trackPx,tags=single?clockTags(t,{width:7.4*perPx,pad:16*perPx,lanes:3}):[];
 const said=t.pieces.find(p=>p.id===chosen),saidBd=t.breakdowns.find(b=>b.id===chosen);
 const press=p=>{if(onOpen)return onOpen(entry);setChosen(p.id);onPick(p.band);};
 // Pressing a breakdown gives its time, Pulse reference and reason; it changes no list below.
 const pressBd=b=>{if(onOpen)return onOpen(entry);setChosen(b.id);};
 const rest=(part,words)=>part&&<span className="lm-tl-restzone" style={place(t,part.from,part.to)} title={words}>{roomy(t,part.from,part.to,single?0.1:0.16)?words:''}</span>;
 const bdWords=t.bdMinutes>0?`; ${bdLength(t.bdMinutes)} in breakdown`:'';
 return <div className={'lm-tl-row'+(single?' lm-tl-single':'')+(onOpen?' lm-tl-openable':'')+(picked?' lm-tl-picked':'')} onClick={onOpen?()=>onOpen(entry):undefined} role={onOpen?'button':undefined} tabIndex={onOpen?0:undefined} onKeyDown={onOpen?e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(entry);}}:undefined}
  title={onOpen?'Open this shift full width with its clock times':undefined}>
  {label&&<div className="lm-tl-label" title={label}>{label}</div>}
  <div className="lm-tl-body">
   <div ref={track} className="lm-tl-track" role="img" aria-label={entry.loadings?`${entry.door}, ${day(entry.date)}, ${entry.shift}: ${entry.loadings} loadings from ${t.firstClock} to ${t.lastClock}; ${entry.ok} within ${IDLE_LIMIT} minutes, ${entry.b1+entry.b2+entry.b3} after ${IDLE_LIMIT} to 20 minutes, ${entry.b4} after more than 20 minutes${bdWords}`:`${entry.door}, ${day(entry.date)}, ${entry.shift}: no timed loading${bdWords}`}>
    {rest(t.lead,'No loading till '+t.lead?.clock)}
    {rest(t.tail,'No loading after '+t.tail?.clock)}
    {rest(t.empty,'No loading with a time')}
    {t.pieces.map(p=><span key={p.id} className={'lm-seg lm-seg-'+p.band+(p.id===chosen?' lm-seg-chosen':'')} style={place(t,p.from,p.to)} onClick={e=>{e.stopPropagation();press(p);}} title={pieceText(p)}>
     {p.parts.map((part,i)=><i key={i} className={'lm-part lm-part-'+part.tone} style={within(p,part)}/>)}
     {p.band!=='ok'&&roomy(t,p.from,p.to,single?0.026:0.045)&&<b>{Math.round(p.minutes)}</b>}
    </span>)}
    {t.pieces.flatMap(p=>p.turns.map(turn=><span key={p.id+turn.tone+turn.at} className={'lm-turn lm-turn-'+turn.tone} style={place(t,turn.at)} aria-hidden="true"/>))}
    {/* Owner, 15 Nov 2026: the machine in breakdown is black on the strip, whatever the colour under it; press it for the reason. */}
    {t.breakdowns.map(b=><span key={b.id} className={'lm-bd'+(b.id===chosen?' lm-seg-chosen':'')} style={place(t,b.from,b.to)} onClick={e=>{e.stopPropagation();pressBd(b);}} title={breakdownText(b)}>
     {roomy(t,b.from,b.to,single?0.05:0.08)?'BD '+bdLength(b.minutes):roomy(t,b.from,b.to,single?0.018:0.03)?'BD':''}
    </span>)}
    {t.last!==null&&<span className="lm-seg lm-seg-end" style={place(t,t.last)} aria-hidden="true"/>}
   </div>
   {tags.length>0&&<div className="lm-tl-tags" style={{height:(Math.max(...tags.map(g=>g.lane))+1)*20+'px'}}>{tags.map(g=>{
    const piece=g.piece&&t.pieces.find(x=>x.id===g.piece),bd=g.breakdown&&t.breakdowns.find(x=>x.id===g.breakdown);
    return <span key={g.id} className={'lm-tag lm-tag-'+g.tone+(g.end?' lm-tag-end':'')} style={{...place(t,g.at),top:g.lane*20+'px'}}
     onClick={()=>{if(piece)press(piece);else if(bd)pressBd(bd);}} title={piece?pieceText(piece):bd?breakdownText(bd):''}>{g.text}</span>;})}</div>}
   <div className="lm-tl-axis" aria-hidden="true">{single&&t.ticks.map(m=><i key={m} className={'lm-tick'+(m%30?'':' lm-tick-half')} style={place(t,m)}/>)}{t.marks.map(m=><span key={m.at} className={m.edge?'lm-edge':undefined} style={place(t,m.at)}>{m.clock}</span>)}</div>
   {single&&said&&<p className={'lm-tl-chosen lm-tl-chosen-'+said.tone} role="status">{pieceText(said)}</p>}
   {single&&saidBd&&<p className="lm-tl-chosen lm-tl-chosen-bd" role="status">{breakdownText(saidBd)}</p>}
   {single&&<div className="lm-tl-hours">{t.hours.map(h=><div key={h.id} className={'lm-hour lm-hour-'+h.worst} style={place(t,h.from,h.to)}
     title={`${h.label}: ${plural(h.loadings,'loading')} (${h.count.green} green, ${h.count.orange} orange, ${h.count.red} red) · minutes of the hour in green ${h.green}, in orange ${h.orange}, in red ${h.red}, in breakdown ${h.bd}, before the first or after the last loading ${h.rest}`}>
     <b>{h.loadings}</b> {h.loadings===1?'trip':'trips'}
     <span className="lm-hour-counts">{h.loadings>0?['green','orange','red'].filter(tone=>h.count[tone]>0).map(tone=><i key={tone} className={'lm-pill lm-pill-'+tone}>{h.count[tone]}</i>):<em>{h.worst==='rest'?'Not judged':h.worst==='bd'?'':'No loading'}</em>}
      {h.bd>0&&<i className="lm-pill lm-pill-bd" title={Math.round(h.bd)+' minutes of this hour in breakdown'}>BD {Math.round(h.bd)}m</i>}</span>
    </div>)}</div>}
  </div>
 </div>;
}
const stripOrder=(a,b)=>String(b.date).localeCompare(String(a.date))||a.shift.localeCompare(b.shift,undefined,{numeric:true})||a.door.localeCompare(b.door,undefined,{numeric:true});
// One strip: the shift full width with its clock times. Many strips (a machine over many shifts, or many machines): one
// under the other, newest shift on top; pressing a strip opens that shift on its own (`onOpen`).
export function ShiftTimelines({entries=[],title='',step='',onPick=()=>{},onOpen=null,pickedId=''}){
 const drawn=entries.filter(canDraw).sort(stripOrder);
 if(!drawn.length)return null;
 const shown=drawn.slice(0,MAX_STRIPS),single=drawn.length===1,manyShifts=new Set(drawn.map(e=>e.slotKey)).size>1,manyMachines=new Set(drawn.map(e=>e.machineKey)).size>1;
 const label=e=>single?'':[manyShifts&&day(e.date)+' · '+e.shift,(manyMachines||!manyShifts)&&e.door].filter(Boolean).join(' · ');
 // One shift names itself in full, with its hours; many shifts carry the name of what was opened.
 const one=drawn[0],heading=single?'Machine '+one.door+' · '+one.site+' · '+day(one.date)+' · '+one.shift+(one.axis.known?' · '+clockAt(one.axis.start)+' to '+clockAt(one.axis.start,one.axis.minutes):''):title;
 return <section className="lm-timeline" aria-label="Shift time-line">
  <h3>{step}{single?'Shift time-line':'Shift time-lines'} · {heading}</h3>
  <p className="lm-tl-legend"><span><i className="lm-part-green"/>Green · first {IDLE_LIMIT} min after a loading</span><span><i className="lm-part-orange"/>Orange · from the {IDLE_LIMIT}th minute</span><span><i className="lm-part-red"/>Red · from the {RED_AFTER}th minute, till the next loading</span><span><i className="lm-part-bd"/>Black · breakdown in Pulse, not idle</span><span><i className="lm-tl-rest"/>Before the first or after the last loading</span></p>
  <div className="lm-tl-scroll"><div className="lm-tl-inner">{shown.map(e=><Strip key={e.id} entry={e} label={label(e)} single={single} onPick={onPick} onOpen={single?null:onOpen} picked={e.id===pickedId}/>)}</div></div>
  <p className="lm-tl-foot">{single
   ?`Every dark line inside the strip is one loading; the number on a piece is its idle minutes. Black is the time the machine was in breakdown in Pulse: it is not idle, and the idle clock stops while it lasts. Under the strip: when each breakdown began and ended, the clock time each stop turned orange and red, and when a red stop ended with the next loading. Below each hour: the trips loaded in it, by the colour of the gap before each, and its minutes in breakdown. Press a piece, a black breakdown or a clock time to read it in full.`
   :`Every strip is one shift of 8 hours, newest on top; black is a breakdown in Pulse. Press a strip to open that shift full width with the clock time of every change of colour.`}
   {drawn.length>shown.length?` The newest ${shown.length} of ${drawn.length} shifts are drawn; the list below has all of them.`:''}</p>
 </section>;
}

export default function LoadingMachineReport({records=[],assets=[],fleet=[],batches=[],pulseBreakdowns=null,pulseBreakdownsError='',filters={},loading='',period='',ReportSection,dataReady=true,rowsView=null}){
 const [mode,setMode]=useState('idle'),[site,setSite]=useState(''),[slot,setSlot]=useState(null),[item,setItem]=useState(null),[strip,setStrip]=useState(''),[only,setOnly]=useState(''),[card,setCard]=useState('');
 const entries=useMemo(()=>machineShifts(records,{assets,fleet,batches,filters,pulseBreakdowns}),[records,assets,fleet,batches,filters,pulseBreakdowns]);
 const visible=useMemo(()=>loading?entries.filter(e=>e.names.includes(loading)||e.door===loading):entries,[entries,loading]);
 const cardRows=useMemo(()=>card?tripEntries(records).filter(e=>e.recordId===card):[],[records,card]),cardHead=cardRows[0];
 const reset=()=>{setSite('');setSlot(null);setItem(null);setStrip('');setOnly('');setCard('');};
 const tabs=<nav className="production-tabs tt-tabs" aria-label="Report view">{[['idle','Machine working and idle time'],['rows','All machines list']].map(([key,label])=><button key={key} type="button" aria-current={mode===key?'page':undefined} onClick={()=>{setMode(key);reset();}}>{label}</button>)}</nav>;
 if(mode==='rows')return <div className="tt-report lm-report">{tabs}{rowsView}</div>;
 const band=isBand(only)?only:'';
 // Steps stay one below the other. The green chip belongs to the time-line of Step 4 only, so the steps above it read
 // the colour chosen without it.
 const upper=only==='ok'?'':only;
 const sites=summarise(visible,'site');
 const siteEntries=!site?[]:site===EVERY?visible:visible.filter(e=>e.site===site),siteLabel=site===EVERY?'All sites':site;
 const shifts=summarise(siteEntries,'shift'),shiftsListed=upper?shifts.rows.filter(r=>r[upper]>0):shifts.rows;
 // Step 3 sits under the grid as soon as a site is open: every date and shift of the site until a box narrows it to one.
 const slotEntries=!site?[]:!slot?siteEntries:siteEntries.filter(e=>groupKey('shift',e)===slot.key),allShifts=!slot;
 const machines=summarise(slotEntries,'machine'),machinesListed=upper?machines.rows.filter(r=>r[upper]>0):machines.rows;
 const itemEntries=!item?[]:item.key===EVERY?slotEntries:slotEntries.filter(e=>groupKey('machine',e)===item.key);
 // A machine over many shifts (or many machines) is drawn as one 8-hour strip per shift; pressing a strip opens that
 // shift on its own. With one shift to draw, that shift is open at once.
 const drawable=itemEntries.filter(canDraw).sort(stripOrder),stacked=drawable.length>1;
 const focus=strip?itemEntries.find(e=>e.id===strip)||null:null;
 const shownEntries=focus?[focus]:itemEntries;
 const level=!site?1:!item?2:3;
 // The list of loadings follows the strip: one shift, or every shift drawn; a colour chip or a coloured number keeps one colour only.
 // A machine that did not run in the lines opened has no loading to list: only what its ELB says is shown.
 const pick=band||(only==='ok'?'ok':''),ran=shownEntries.some(e=>e.state==='running'),notWorked=focus?[]:shiftsNotWorked(itemEntries);
 const lines=item?loadingLines(shownEntries,pick):[],opened=summarise(shownEntries,'machine').total,manyLines=shownEntries.length>1;
 const manyDates=new Set(shownEntries.map(e=>e.date)).size>1;
 // Step 3 with a band chosen also lists the stops of that band for all its machines, each with the tipper trips delayed in it.
 const bandStops=site&&band?loadingLines(slotEntries,band):[];
 const openSite=(row,pick='')=>{setSite(row.total?EVERY:row.key);setSlot(null);setItem(null);setStrip('');setOnly(pick);setCard('');};
 const openSlot=(row,pick=only)=>{setSlot(row.total?null:{key:row.key,label:day(row.date)+' · '+row.shift});setItem(null);setStrip('');setOnly(pick);setCard('');};
 const openItem=(row,pick=only)=>{setItem(row.total?{key:EVERY,label:'All machines'}:{key:row.key,label:'Machine '+row.door});setStrip('');setOnly(pick);setCard('');};
 const openStrip=e=>{setStrip(e.id);setOnly(o=>o==='ok'||isBand(o)?'':o);setCard('');};
 // The green chip belongs to the time-line of a machine only; the steps above it do not know it.
 const upward=()=>setOnly(o=>o==='ok'?'':o);
 const crumbs=[['All sites',reset],...(site?[[siteLabel,()=>{setSlot(null);setItem(null);setStrip('');setCard('');upward();}]]:[]),...(slot?[[slot.label,()=>{setItem(null);setStrip('');setCard('');upward();}]]:[]),
  ...(item?[[item.label,()=>{setStrip('');setCard('');}]]:[]),...(focus&&stacked?[[day(focus.date)+' · '+focus.shift+(item.key===EVERY?' · '+focus.door:''),()=>setCard('')]]:[]),...(card?[[cardHead?.book||'Trip card',null]]:[])];
 const chips=(total,withStates)=><nav className="tt-chips" aria-label="Show only">{[['','All machines',total.machineShifts,''],...(withStates?[['breakdown',STATES.breakdown,total.breakdown,'lm-breakdown'],['nohours',STATES.nohours,total.nohours,'lm-nohours']]:[]),...BANDS.map(b=>[b.key,'Idle '+b.label,total[b.key],'lm-'+b.key])].map(([key,label,n,tone])=><button key={key||'all'} type="button" className={tone} aria-current={upper===key?'page':undefined} onClick={()=>setOnly(key)}>{label} · {n}</button>)}</nav>;
 const tripChips=<nav className="tt-chips" aria-label="Show only">{[['','All trips',opened.loadings,''],['ok','Green · '+BAND_LABELS.ok,opened.ok,'lm-ok'],...BANDS.map(b=>[b.key,(b.key==='b4'?'Red · ':'Orange · ')+b.label,opened[b.key],'lm-'+b.key])].map(([key,label,n,tone])=><button key={key||'all'} type="button" className={tone} aria-current={pick===key?'page':undefined} onClick={()=>setOnly(key)}>{label} · {n}</button>)}</nav>;
 const summaryLine=t=>t.machineShifts?`${t.running} of ${t.machineShifts} machine shifts ran, ${t.breakdown} were in BD and ${t.nohours} had no hours without BD. `
  +(t.percent===null?'':`The machines with an ELB worked ${t.percent}% of their shift hours (${t.hours} of ${t.shiftHours} hours). `)
  +`${t.trips} trips loaded. `+(t.gaps?`Out of ${t.gaps} timed gaps between two loadings, ${t.stops} were idle stops of more than ${IDLE_LIMIT} minutes (${idleText(t.idleMinutes)} in all): ${BANDS.map(b=>`${t[b.key]} in ${b.label} (${t[b.key+'Share']}%)`).join(', ')}.`:'No gap between two loadings could be timed.')+(t.bdMinutes>0?` ${idleText(t.bdMinutes)} in breakdown in Pulse is taken out of the idle time.`:''):'No loading machine in these dates and filters.';
 // What the time-line says in words; with a band chosen, also the stops of that band and the tipper trips delayed in them.
 const stopWords=l=>`${l.minutes} minutes from ${l.from.clock} to ${l.to.clock}`+(manyLines?` (${l.machine}, ${day(l.date)})`:'')+`, ${plural(l.delayed.length,'tipper trip')} delayed`;
 const timelineLine=t=>{
  if(!t.loadings)return 'No loading with a time here: the tipper cards were saved without times, or no tipper card names the machine.'+(t.bdMinutes>0?` ${idleText(t.bdMinutes)} in breakdown in Pulse.`:'');
  const delayedHere=new Set(lines.flatMap(l=>l.delayed.map(d=>d.key))).size;
  return `${plural(t.loadings,'loading')} with a time. ${t.ok} came within ${IDLE_LIMIT} minutes of the loading before (green), ${t.b1+t.b2+t.b3} after ${IDLE_LIMIT} to 20 minutes (orange) and ${t.b4} after more than 20 minutes (red). `
   +`The idle stops add up to ${idleText(t.idleMinutes)}`+(t.longest===null?'':`; the longest gap was ${t.longest} minutes`)+`. ${plural(t.delayed,'tipper trip')} delayed during the idle stops.`+(t.bdMinutes>0?` ${idleText(t.bdMinutes)} in breakdown in Pulse is black on the strip and not counted as idle.`:'')
   +(band?` ${BAND_LABELS[band]}: ${plural(lines.length,'stop')}`+(lines.length?`, ${idleText(lines.reduce((s,l)=>s+l.minutes,0))} in all, ${plural(delayedHere,'tipper trip')} delayed in ${lines.length===1?'it':'them'}`:'')+(lines.length&&lines.length<=3?': '+lines.map(stopWords).join('; '):'')+'.':'');
 };
 const withTotal=(rows,total)=>rows.length?[...rows,total]:[];
 // Step 2 is the date by shift table of the OT report: a colour chosen above it keeps only that colour in the boxes.
 const gridBoxes=[{key:'breakdown',label:STATES.breakdown,className:'lm-count lm-breakdown'},{key:'nohours',label:STATES.nohours,className:'lm-count lm-nohours'},...BANDS.map(b=>({key:b.key,label:'Idle '+b.label,className:'tt-band lm-'+b.key}))].filter(b=>!upper||b.key===upper);
 // The share worked counts only the machine shifts whose ELB gives both hours, as on the lines themselves.
 const shiftGrid=dateShiftGrid(shiftsListed.map(r=>({...r,judgedHours:r.percent===null?0:r.percent*r.shiftHours/100})),{sumKeys:['machineShifts','running','breakdown','nohours','trips','judgedHours','shiftHours','stops','idleMinutes',...BANDS.map(b=>b.key)]});
 const shiftDay=[{key:'machines',label:'Machine shifts',value:t=>t.machineShifts},{key:'trips',label:'Trips loaded',value:t=>t.trips},
  {key:'percent',label:'% of shift worked',value:t=>t.shiftHours?Math.round(t.judgedHours/t.shiftHours*1000)/10+'%':'—'},{key:'stops',label:'Idle stops',value:t=>t.stops}];
 const shiftExport=dateShiftExport(shiftGrid,{count:r=>r.machineShifts,countLabel:'machines',boxes:gridBoxes,dayColumns:shiftDay});
 const where=siteLabel+' · '+(slot?slot.label:'all dates and shifts');
 // Step 4 is the machine: one strip per shift when it has many, or its one shift full width. A strip pressed opens its
 // shift full width as Step 5. The list of loadings and the trip card come after whichever is open.
 const listStep=stacked&&focus?5:4,cardStep=listStep+1;
 const listWhere=!item?'':item.label+' · '+(focus?day(focus.date)+' · '+focus.shift+(item.key===EVERY?' · '+focus.door:''):where);
 // One step back: the step before the one on screen, as in the line of steps above the table.
 const back=crumbs.length>1?crumbs.at(-2)[1]:null,backTo=crumbs.length>1?'Back to '+crumbs.at(-2)[0]:'';
 const filtered=upper?' · '+FILTERS[upper]:'';
 const picked=(r,key)=>key&&(r.total?key===EVERY:r.key===key)?' report-row-picked':'';
 return <div className="tt-report lm-report">{tabs}
  <nav className="tt-crumbs" aria-label="Steps">{back&&<StepBackButton onBack={back} label={backTo}/>}{crumbs.map(([label,go],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{go&&i<crumbs.length-1?<button type="button" onClick={go}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>
  {<>
   {pulseBreakdownsError&&<p className="tt-insight lm-pulse-note" role="status">Pulse could not be read just now ({pulseBreakdownsError}). The breakdowns shown are the ones copied onto the ELB cards when they were saved; press Refresh to read Pulse again.</p>}
   <p className="tt-insight">{summaryLine(sites.total)}</p>
   <ReportSection key="lm-sites" reportKey="Loading machines sites" dataReady={dataReady} title={'Step 1 · Loading machines · All sites · '+period} category="operations-loading-sites" description="One line per site. Press a site to see it date by date and shift by shift. Press a coloured number to see only the shifts behind it."
    rows={withTotal(sites.rows,sites.total)} columns={summaryColumns('site',openSite)} rowKey={r=>r.id} rowClassName={r=>rowClass(r)+picked(r,site)} isTotalRow={isTotal} onRowClick={r=>openSite(r)} emptyMessage="No loading machine in these dates and filters."/>
  </>}
  {level>=2&&<>
   <p className="tt-insight">{summaryLine(shifts.total)}</p>
   {chips(shifts.total,true)}
   <ReportSection key={'lm-shifts-'+site+upper} reportKey="Loading machines shifts" dataReady={dataReady} title={'Step 2 · Loading machines · '+siteLabel+' · date by shift · '+period+filtered} category="operations-loading-shifts" description="In each box: the machines of that shift, then the machines in BD (red), with no hours (brown) and the idle stops of each band, with the entry stage under them. Press a box for the machines of that shift; press a colour for only those. Idle time is complete only after the VLB of the shift is locked."
    rows={shiftExport.rows} columns={shiftExport.columns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <DateShiftGrid grid={shiftGrid} count={r=>r.machineShifts} countLabel="Machines" boxes={gridBoxes} dayColumns={shiftDay} cellNote={r=>r.stageLabel} onOpen={(r,b)=>openSlot(r,b||upper)} onOpenAll={()=>openSlot(shifts.total)}
     isPicked={r=>slot?.key===r.key} pickedBox={upper} allPicked={allShifts} ariaLabel="Loading machines by date and shift" emptyMessage="No shift with such a machine here."/>
   </ReportSection>
   <p className="tt-insight">{summaryLine(machines.total)}</p>
   <ReportSection key={'lm-machines-'+site+(slot?.key||EVERY)+upper} reportKey={'Loading machines of a shift'+(allShifts?' together':'')} dataReady={dataReady} title={'Step 3 · Loading machines · '+where+filtered} category="operations-loading-machines" description={(allShifts?'Every loading machine of the site over all the dates and shifts above; press a box above for one shift only. ':'')+'One line per loading machine: the running machines first with the most idle on top, then the machines in BD in red, then the machines with no hours in brown. Press a line to see the machine as an 8-hour strip per shift: where it was green, where it turned orange and where red, by the clock. Press a coloured number to see only those stops.'}
    rows={withTotal(machinesListed,upper?{...machines.total,id:'shown-total'}:machines.total)} columns={machineColumns(openItem,allShifts)} rowKey={r=>r.id} rowClassName={r=>rowClass(r)+picked(r,item?.key)} isTotalRow={isTotal} onRowClick={r=>openItem(r)} emptyMessage="No such machine in this shift."/>
   {band&&<ReportSection key={'lm-bandstops-'+site+(slot?.key||EVERY)+band} reportKey="Loading machines stops of a band" dataReady={dataReady} title={'Idle stops of '+BAND_LABELS[band]+' · every machine · '+where} category="operations-loading-bandstops" description={'Every stop of '+BAND_LABELS[band]+' of the machines above, with the tipper trips delayed in it. Press a line to see the shift time-line of that machine.'}
    recordDateFilter={allShifts?null:false} rows={bandStops} columns={tripColumns(true)} rowKey={l=>l.id} rowClassName={lineClass} onRowClick={l=>openItem({key:l.machineKey,door:l.machine},band)} emptyMessage={'No stop of '+BAND_LABELS[band]+' here.'}/>}
  </>}
  {level>=3&&<>
   {stacked&&!focus&&<p className="tt-insight">{timelineLine(opened)}</p>}
   {stacked&&<ShiftTimelines entries={itemEntries} step="Step 4 · " title={item.label+' · '+where} onOpen={openStrip} pickedId={strip}/>}
   {(focus||!stacked)&&ran&&<p className="tt-insight">{timelineLine(opened)}</p>}
   {(focus||!stacked)&&ran&&<ShiftTimelines entries={shownEntries} step={'Step '+listStep+' · '} onPick={setOnly}/>}
   {ran&&tripChips}
   {ran&&<ReportSection key={'lm-trips-'+item.key+(slot?.key||EVERY)+strip+pick} reportKey={'Loading machine loadings'+(manyLines?' together':'')} dataReady={dataReady} title={'Step '+listStep+' · Every loading · '+listWhere+(pick?' · '+BAND_LABELS[pick]:'')} category="operations-loading-stops" description={'One line per loading in the order of the shift, with the minutes since the loading before: green up to '+IDLE_LIMIT+' minutes, orange up to '+RED_AFTER+', red above '+RED_AFTER+'. An idle stop shows the tipper trips delayed in it. Press a line to see the trip card of the tipper loaded.'}
    recordDateFilter={manyDates?null:false} rows={lines} columns={tripColumns(manyLines)} rowKey={l=>l.id} rowClassName={l=>lineClass(l)+(card&&l.to?.recordId===card?' report-row-picked':'')} onRowClick={l=>setCard(l.to.recordId)} emptyMessage={pick?'No loading of '+BAND_LABELS[pick]+' here.':'No loading with a time here.'}/>}
   {notWorked.length>0&&<ReportSection key={'lm-notworked-'+item.key+(slot?.key||EVERY)} reportKey="Loading machine shifts not worked" dataReady={dataReady} title={(ran?'':'Step 4 · ')+'Shifts not worked · '+item.label+' · '+where} category="operations-loading-notworked" description="The shifts in which the machine did not run: in BD in red, no hours and not in BD in brown, with the reason on its ELB and the breakdown recorded in Pulse."
    rows={notWorked} columns={notWorkedColumns} rowKey={e=>e.id} rowClassName={rowClass} emptyMessage="The machine ran in every shift."/>}
  </>}
  {level>=3&&card&&cardHead&&<ReportSection key={'lm-card-'+card} reportKey="Loading machine trip card" dataReady={dataReady} showSearch={false} title={'Step '+cardStep+' · Trip card '+cardHead.book} category="operations-loading-card" description={`${cardHead.site} · ${day(cardHead.date)} · ${cardHead.shift} · Door ${cardHead.door} · ${cardHead.driver||'Name not recorded'} · ${cardHead.caliberId||'ID not recorded'} · every trip row of this card`}
   rows={cardRows} columns={cardColumns} rowKey={e=>e.id} emptyMessage="No trip rows on this card."/>}
  <details className="tt-notes"><summary>How this report counts</summary><ul>
   <li>Trips loaded are the trips of every tipper card row that names the machine. A row with only an unloading time belongs to the shift that loaded it.</li>
   <li>An idle stop is the time from one loading to the next loading by the same machine, across all the tippers it loaded in the shift, less any time the machine was in breakdown. {IDLE_LIMIT} minutes or less is normal working. The bands are more than 5 and up to 10 minutes, up to 15, up to 20, and more than 20. Total idle time adds up every stop of more than {IDLE_LIMIT} minutes in full.</li>
   <li>The shift time-line of a machine is a strip over all the hours of the shift with every loading that has a time. After each loading the strip is green; if the next loading has not come in {IDLE_LIMIT} minutes it turns orange, and after {RED_AFTER} minutes red, until the next loading. The clock time of each turn is printed under the strip. A loading in the list is coloured by the whole gap before it: green within {IDLE_LIMIT} minutes, orange up to {RED_AFTER}, red above {RED_AFTER}. The first loading of the shift has no loading before it and no colour.</li>
   <li>Tipper trips delayed in an idle stop: the tipper was loaded by this machine at the end of the stop or after it, took more than {WAIT_LIMIT} minutes from its unloading to that loading (a delay in the Trip Timing &amp; Gap Report), and stood empty for more than {IDLE_LIMIT} minutes of the stop. The minutes beside each tipper are its time from unloading to loading. The cards cannot tell whether the tippers waited for the machine or the machine for the tippers: a stop with no tipper trip delayed means no tipper was waiting.</li>
   <li>Breakdowns are read from Pulse when the report opens (start, end, Pulse reference and reason), matched to the machine by its door number or chassis. A breakdown ends when Pulse closes it or moves the machine to idle; one still open runs to now. If Pulse cannot be read, the breakdowns copied onto the machine's ELB when it was saved are used.</li>
   <li>Minutes in breakdown are black on the strip and are not idle: a stop is judged on the minutes between two loadings less the minutes in breakdown, and the idle clock (green, then orange from the 5th minute, red from the 20th) stops while the breakdown lasts and goes on after it. Tipper trips are not counted as delayed for the minutes the machine was in breakdown. In BD (Pulse) gives the minutes of breakdown inside the shift.</li>
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
