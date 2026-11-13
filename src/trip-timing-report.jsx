import React,{useMemo,useState} from 'react';
import {StepBackButton} from './step-back.jsx';
import {tableLayoutAccount} from './table-layouts.mjs';
import {BANDS,BAND_LABELS,MODES,GROUPS,DELAY_LIMIT,EXCEPTION_KEY,EXCEPTION_LABEL,tripEntries,summarise,delayedEntries,entryRemark,groupKey,
 withExceptionTime,addExceptionRule,exceptionRulesFor,exceptionSiteKey,exceptionStorageKey,readExceptionView,storeExceptionView} from '../shared/trip-timing-report.mjs';
import './trip-timing-report.css';

// Trip Timing & Gap Report: two delay sub-tabs (Loading → Unloading, Unloading → next Loading) and the plain trip rows.
// Each delay sub-tab drills in five steps: all sites, one site date by date and shift by shift, the drivers (or doors, or
// loading machines) of one shift, the delayed trips of one line, the full card.
// A report only: it reads the saved Vehicle Log Books already loaded by the shared operations screen.
const EVERY='*';
const OTHER={'load-unload':'unload-load','unload-load':'load-unload'};
const blank=v=>v===null||v===undefined||v==='';
const column=(key,label,value,render)=>({key,label,value:value||(r=>blank(r[key])?'—':r[key]),...(render?{render}:{})});
const pill=(band,text)=>band&&band!=='ok'?<span className={'tt-band tt-'+band}>{text}</span>:text;
const day=date=>/^\d{4}-\d{2}-\d{2}/.test(String(date))?date.slice(8,10)+'-'+date.slice(5,7)+'-'+date.slice(2,4):date;
const minutes=(e,mode)=>blank(e[mode].minutes)?'—':e[mode].minutes;
// The clock minutes as written on the card; they differ from the counted minutes only where an exception time took some out.
const written=(e,mode)=>blank(e[mode].rawMinutes)?'—':e[mode].rawMinutes;
const LABELS={...BAND_LABELS,[EXCEPTION_KEY]:EXCEPTION_LABEL};
const NO_VIEW={on:false,rules:[]};
const browserStorage=()=>typeof localStorage==='undefined'?null:localStorage;

const identity={
 site:[column('site','Site'),column('driversLate','Drivers with a delay')],
 shift:[column('date','Date',r=>r.total?'ALL DATES':day(r.date)),column('shift','Shift'),column('driversLate','Drivers with a delay')],
 driver:[column('caliberId','Caliber ID'),column('driver','Driver'),column('doors','Door no.')],
 door:[column('door','Door no.'),column('driverCount','Drivers on it')],
 machine:[column('machine','Loading machine'),column('vehicleCount','Vehicles loaded')]
};
// `exception`: the personalised view is on, so one more column counts the trips its exception time moved to a lower band.
export function summaryColumns(group,mode,onBand,exception=false){
 const number=band=>column(band,LABELS[band],null,r=>r[band]>0?(onBand?<button type="button" className={'tt-band tt-'+band} title={'Show only '+LABELS[band]} onClick={e=>{e.stopPropagation();onBand(r,band);}}>{r[band]}</button>:pill(band,r[band])):r[band]);
 return [...identity[group],column('timed',MODES[mode].unit),column('ok',BAND_LABELS.ok),...BANDS.map(b=>number(b.key)),column('over','Total over '+DELAY_LIMIT+' min'),
  column('percent','% over '+DELAY_LIMIT+' min',r=>blank(r.percent)?'—':r.percent+'%'),...(exception?[number(EXCEPTION_KEY)]:[]),column('longest','Longest (min)'),
  // The same driver's (or shift's) delays in the other timing, so that everything against a name is on one line.
  column('otherOver','Also over '+DELAY_LIMIT+' min in '+MODES[OTHER[mode]].label),column('notJudged','Not judged')];
}
// `exception`: the personalised view is on, so the minutes as written, the minutes inside the exception time and the
// minutes counted are three columns.
export function delayedColumns(mode,withDriver,exception=false){
 const who=withDriver?[column('caliberId','Caliber ID'),column('driver','Driver')]:[];
 const start=[column('date','Date',e=>day(e.date)),column('shift','Shift'),column('book','Book no.'),column('door','Door no.'),...who,column('sr','Tr.Sr.No')];
 const band=column('band','Band',e=>BAND_LABELS[e[mode].band],e=>pill(e[mode].band,BAND_LABELS[e[mode].band]));
 const counted=label=>exception
  ?[column('rawMinutes',label,e=>written(e,mode)),column('excepted','In exception time (min)',e=>e[mode].excepted||0),column('minutes','Counted (min)',e=>minutes(e,mode),e=>pill(e[mode].band,minutes(e,mode)))]
  :[column('minutes',label,e=>minutes(e,mode),e=>pill(e[mode].band,minutes(e,mode)))];
 const before=exception?[column('rawBand','Band without exception',e=>BAND_LABELS[e[mode].rawBand])]:[];
 return mode==='load-unload'
  ?[...start,column('machine','Loading machine'),column('trips','Trips'),column('loadingTime','Loading time'),column('unloadingTime','Unloading time'),...counted('Minutes taken'),band,...before]
  :[...start,column('previousUnloadingTime','Unloaded at (previous trip)'),column('loadingTime','Loaded again at'),column('machine','Loading machine'),...counted('Gap minutes'),band,...before];
}
// The card shows the minutes as written; the colour follows the band counted, and the Remark says what an exception time took out.
export const cardColumns=[column('sr','Tr.Sr.No'),column('machine','Loading machine'),column('trips','Trips'),column('loadingTime','Loading time'),column('unloadingTime','Unloading time'),
 column('taken','Loading → Unloading (min)',e=>written(e,'load-unload'),e=>pill(e['load-unload'].band,written(e,'load-unload'))),
 column('gap','Unloading → this loading (min)',e=>e.first?'—':written(e,'unload-load'),e=>e.first?'—':pill(e['unload-load'].band,written(e,'unload-load'))),
 column('remark','Remark',e=>entryRemark(e)||'—')];
const itemLabel=(group,row)=>group==='driver'?`${row.driver} · ${row.caliberId}`:group==='door'?'Door '+row.door:'Loading machine '+row.machine;

export default function TripTimingReport({records=[],loading='',period='',ReportSection,dataReady=true,rowsView=null}){
 const [mode,setMode]=useState('load-unload'),[group,setGroup]=useState('driver'),[site,setSite]=useState(''),[item,setItem]=useState(null),[band,setBand]=useState(''),[card,setCard]=useState(''),[slot,setSlot]=useState(null);
 // Exception time: the signed-in user's own periods (blasting, breakfast) and whether his personalised view is open.
 // Kept on this device for each login, as the table layouts are; nobody else's report changes.
 const viewKey=useMemo(()=>{try{return exceptionStorageKey(tableLayoutAccount());}catch{return '';}},[]);
 const [personal,setPersonal]=useState(()=>viewKey&&browserStorage()?readExceptionView(browserStorage(),viewKey):NO_VIEW);
 const [draft,setDraft]=useState({from:'',to:'',reason:''}),[problem,setProblem]=useState('');
 const savePersonal=next=>{setPersonal(next);if(viewKey&&browserStorage())storeExceptionView(browserStorage(),viewKey,next);};
 const exception=personal.on;
 const rawEntries=useMemo(()=>tripEntries(records),[records]);
 const entries=useMemo(()=>exception?withExceptionTime(rawEntries,personal.rules):rawEntries,[rawEntries,exception,personal.rules]);
 const visible=useMemo(()=>loading?entries.filter(e=>e.machine===loading):entries,[entries,loading]);
 const tabs=<nav className="production-tabs tt-tabs" aria-label="Report view">{[...Object.entries(MODES).map(([key,m])=>[key,m.label]),['rows','All trip rows']].map(([key,label])=><button key={key} type="button" aria-current={mode===key?'page':undefined} onClick={()=>{setMode(key);setSite('');setSlot(null);setItem(null);setBand('');setCard('');}}>{label}</button>)}</nav>;
 if(mode==='rows')return <div className="tt-report">{tabs}{rowsView}</div>;
 const m=MODES[mode],what=mode==='load-unload'?'from loading to unloading':'from unloading to the next loading';
 const sites=summarise(visible,mode,'site');
 const siteEntries=!site?[]:site===EVERY?visible:visible.filter(e=>e.site===site),siteLabel=site===EVERY?'All sites':site;
 const shifts=summarise(siteEntries,mode,'shift'),shiftsListed=band?shifts.rows.filter(r=>r[band]>0):shifts.rows;
 const slotEntries=!slot?[]:slot.key===EVERY?siteEntries:siteEntries.filter(e=>groupKey('shift',e)===slot.key);
 const lines=summarise(slotEntries,mode,group),listed=band?lines.rows.filter(r=>r[band]>0):lines.rows;
 const itemEntries=!item?[]:item.key===EVERY?slotEntries:slotEntries.filter(e=>groupKey(item.group,e)===item.key);
 const delayed=delayedEntries(itemEntries,mode,band),allDelayed=band?delayedEntries(itemEntries,mode):delayed;
 const cardEntries=card?entries.filter(e=>e.recordId===card):[],cardHead=cardEntries[0];
 const level=!site?1:!slot?2:!item?3:!card?4:5;
 const openSite=(row,only='')=>{setSite(row.total?EVERY:row.key);setSlot(null);setItem(null);setBand(only);setCard('');};
 const openSlot=(row,only=band)=>{setSlot(row.total?{key:EVERY,label:'All dates and shifts'}:{key:row.key,label:day(row.date)+' · '+row.shift});setItem(null);setBand(only);setCard('');};
 const openItem=(row,only=band)=>{setItem(row.total?{group,key:EVERY,label:'All delays'}:{group,key:row.key,label:itemLabel(group,row)});setBand(only);setCard('');};
 const crumbs=[['All sites',()=>{setSite('');setSlot(null);setItem(null);setBand('');setCard('');}],...(site?[[siteLabel,()=>{setSlot(null);setItem(null);setCard('');}]]:[]),...(slot?[[slot.label,()=>{setItem(null);setCard('');}]]:[]),...(item?[[item.label,()=>setCard('')]]:[]),...(card?[[cardHead?.book||'Trip card',null]]:[])];
 const chips=(total,count)=><nav className="tt-chips" aria-label="Delay band">{[['','All over '+DELAY_LIMIT+' min',total],...BANDS.map(b=>[b.key,b.label,count(b.key)]),...(exception?[[EXCEPTION_KEY,EXCEPTION_LABEL,count(EXCEPTION_KEY)]]:[])].map(([key,label,n])=><button key={key||'all'} type="button" className={key?'tt-'+key:''} aria-current={band===key?'page':undefined} onClick={()=>setBand(key)}>{label} · {n}</button>)}</nav>;
 const exceptionLine=t=>!exception?'':t[EXCEPTION_KEY]?` Personalised view: your exception time moved ${t[EXCEPTION_KEY]} ${m.noun}${t[EXCEPTION_KEY]===1?'':'s'} to a lower band.`:` Personalised view: no ${m.noun} here falls in your exception time.`;
 const summaryLine=t=>(t.timed?`${t.over} of ${t.timed} timed ${m.noun}s (${t.percent}%) took more than ${DELAY_LIMIT} minutes ${what}: ${BANDS.map(b=>t[b.key]+' in '+b.label).join(', ')}.${t.notJudged?' '+t.notJudged+' could not be judged.':''}`:`No ${m.noun} with both times written in these dates and filters.`)+exceptionLine(t);
 const withTotal=(rows,total)=>rows.length?[...rows,total]:[];
 const rowClass=r=>r.total?'tt-total':'';
 const where=siteLabel+(slot?' · '+slot.label:'');
 // An exception time is saved for what is on the screen: all sites, one site, or one date and shift.
 const scopeSite=site&&site!==EVERY?exceptionSiteKey(site):'',scopeSlot=slot&&slot.key!==EVERY?slot.key:'';
 const scopeLabel=(scopeSite?site:'All sites')+' · '+(scopeSlot?slot.label:'every date and shift');
 const rulesHere=exceptionRulesFor(personal.rules,scopeSite,scopeSlot);
 const ruleText=r=>r.from+' to '+r.to+(r.reason?' ('+r.reason+')':'');
 const viewTitle=exception?' · Personalised view':'';
 const viewNote=exception?' Personalised view: minutes inside your exception time'+(rulesHere.length?' ('+rulesHere.map(ruleText).join(', ')+')':'')+' are not counted.':'';
 const showView=on=>{savePersonal({...personal,on:on&&personal.rules.length>0});if(!on&&band===EXCEPTION_KEY)setBand('');};
 const addException=event=>{
  event.preventDefault();
  const result=addExceptionRule(personal.rules,{...draft,site:scopeSite,slot:scopeSlot,where:scopeLabel});
  setProblem(result.problem);if(result.problem)return;
  setDraft({from:'',to:'',reason:''});savePersonal({on:true,rules:result.rules});
 };
 const removeException=id=>{const rules=personal.rules.filter(r=>r.id!==id),on=personal.on&&rules.length>0;savePersonal({on,rules});if(!on&&band===EXCEPTION_KEY)setBand('');};
 const exceptionPanel=<section className="tt-exception" aria-label="Exception time">
  <form className="tt-exception-form" onSubmit={addException}>
   <strong title="Blasting, breakfast or any other stop. Minutes of a trip that fall inside this time are not counted as delay. This is your own view; the standard report stays as it is for everyone.">Exception time</strong>
   <label>From<input type="time" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
   <label>To<input type="time" value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
   <label>Reason<input type="text" maxLength={40} placeholder="Blasting, breakfast" value={draft.reason} onChange={e=>setDraft({...draft,reason:e.target.value})}/></label>
   <button type="submit">Add exception time</button>
   <span className="tt-exception-scope">For: <b>{scopeLabel}</b></span>
  </form>
  {problem&&<p className="tt-exception-problem" role="alert">{problem}</p>}
  <div className="tt-exception-foot">
   <div className="tt-view" role="group" aria-label="View">
    <button type="button" aria-pressed={!exception} onClick={()=>showView(false)}>Standard view</button>
    <button type="button" aria-pressed={exception} disabled={!personal.rules.length} title={personal.rules.length?'Count the trips with your exception time left out':'Add an exception time first'} onClick={()=>showView(true)}>Personalised view · exception time left out</button>
   </div>
   {rulesHere.length>0&&<ul className="tt-exception-list" aria-label="Saved exception times">{rulesHere.map(r=><li key={r.id}><span><b>{r.from} to {r.to}</b>{r.reason?' · '+r.reason:''} · {r.where}</span><button type="button" title="Remove this exception time" aria-label={'Remove exception time '+r.from+' to '+r.to+', '+r.where} onClick={()=>removeException(r.id)}>Remove</button></li>)}</ul>}
   <span className="tt-exception-hint">{exception?'Minutes inside your exception time are not counted. Only you see this view.':personal.rules.length?'Showing every trip as written. Press Personalised view to leave your exception time out.':'Enter the time of blasting, breakfast or any stop, so those trips do not show as delays.'}</span>
  </div>
 </section>;
 // One step back: the step before the one on screen, as in the line of steps above the table.
 const back=level>1?crumbs[level-2][1]:null,backTo=level>1?'Back to '+crumbs[level-2][0]:'';
 return <div className="tt-report">{tabs}
  <nav className="tt-crumbs" aria-label="Steps">{back&&<StepBackButton onBack={back} label={backTo}/>}{crumbs.map(([label,go],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{go&&i<crumbs.length-1?<button type="button" onClick={go}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>
  {level<5&&exceptionPanel}
  {level===1&&<>
   <p className="tt-insight">{summaryLine(sites.total)}</p>
   <ReportSection key={'tt-sites-'+mode+exception} reportKey={'Trip timing sites '+mode} dataReady={dataReady} title={'Step 1 · '+m.label+' · All sites · '+period+viewTitle} category="operations-timing-sites" description={'One line per site. Press a site to see it date by date and shift by shift. Press a coloured number to see only the shifts behind it.'+viewNote}
    rows={withTotal(sites.rows,sites.total)} columns={summaryColumns('site',mode,openSite,exception)} rowKey={r=>r.id} rowClassName={rowClass} onRowClick={r=>openSite(r)} emptyMessage="No trip rows in these dates and filters."/>
  </>}
  {level===2&&<>
   <p className="tt-insight">{summaryLine(shifts.total)}</p>
   {chips(shifts.total.over,key=>shifts.total[key])}
   <ReportSection key={'tt-shifts-'+mode+site+band+exception} reportKey={'Trip timing shifts '+mode} dataReady={dataReady} title={'Step 2 · '+m.label+' · '+siteLabel+' · date-wise and shift-wise · '+period+(band?' · '+LABELS[band]:'')+viewTitle} category="operations-timing-shifts" description={'One line per date and shift, newest first. Press a line to see the drivers of that shift. Press the last line to see the drivers for all the dates together.'+viewNote}
    rows={withTotal(shiftsListed,band?{...shifts.total,id:'shown-total'}:shifts.total)} columns={summaryColumns('shift',mode,openSlot,exception)} rowKey={r=>r.id} rowClassName={rowClass} onRowClick={r=>openSlot(r)} emptyMessage={'No '+m.noun+' over '+DELAY_LIMIT+' minutes here.'}/>
  </>}
  {level===3&&<>
   <nav className="tt-subtabs" aria-label="Count by">{Object.entries(GROUPS).map(([key,label])=><button key={key} type="button" aria-current={group===key?'page':undefined} onClick={()=>setGroup(key)}>{label}</button>)}</nav>
   <p className="tt-insight">{summaryLine(lines.total)}</p>
   {chips(lines.total.over,key=>lines.total[key])}
   <ReportSection key={'tt-lines-'+mode+group+site+slot.key+band+exception} reportKey={'Trip timing '+group+' '+mode} dataReady={dataReady} title={'Step 3 · '+m.label+' · '+where+' · '+GROUPS[group]+(band?' · '+LABELS[band]:'')+viewTitle} category={'operations-timing-'+group} description={'One line per '+(group==='driver'?'driver':group==='door'?'door number':'loading machine')+', worst first, with every band against the name. Press a line to see its delayed '+m.noun+'s.'+viewNote}
    rows={withTotal(listed,band?{...lines.total,id:'shown-total'}:lines.total)} columns={summaryColumns(group,mode,openItem,exception)} rowKey={r=>r.id} rowClassName={rowClass} onRowClick={r=>openItem(r)} emptyMessage={'No '+m.noun+' over '+DELAY_LIMIT+' minutes here.'}/>
  </>}
  {level===4&&<>
   {chips(allDelayed.length,key=>key===EXCEPTION_KEY?delayedEntries(itemEntries,mode,EXCEPTION_KEY).length:allDelayed.filter(e=>e[mode].band===key).length)}
   <ReportSection key={'tt-delayed-'+mode+item.group+item.key+slot.key+band+exception} reportKey={'Trip timing delayed '+mode+(item.group==='driver'&&item.key!==EVERY?'':' with driver')} dataReady={dataReady} title={'Step 4 · '+m.label+' · '+item.label+' · '+where+(band?' · '+LABELS[band]:'')+viewTitle} category="operations-timing-delayed" description={(band===EXCEPTION_KEY?'Every '+m.noun+' your exception time moved to a lower band, newest first.':'Every '+m.noun+' over '+DELAY_LIMIT+' minutes, newest first.')+' Press a line to see the full trip card.'+viewNote}
    rows={delayed} columns={delayedColumns(mode,item.group!=='driver'||item.key===EVERY,exception)} rowKey={e=>e.id} onRowClick={e=>setCard(e.recordId)} emptyMessage={'No '+m.noun+' in this band.'}/>
  </>}
  {level===5&&cardHead&&<ReportSection key={'tt-card-'+card+exception} reportKey="Trip timing card" dataReady={dataReady} showSearch={false} title={'Step 5 · Trip card '+cardHead.book+viewTitle} category="operations-timing-card" description={`${cardHead.site} · ${day(cardHead.date)} · ${cardHead.shift} · Door ${cardHead.door} · ${cardHead.driver||'Name not recorded'} · ${cardHead.caliberId||'ID not recorded'} · every trip row of this card with both timings`}
   rows={cardEntries} columns={cardColumns} rowKey={e=>e.id} emptyMessage="No trip rows on this card."/>}
  <details className="tt-notes"><summary>How this report counts</summary><ul>
   <li>Loading → Unloading is the unloading time minus the loading time of the same trip row.</li>
   <li>Unloading → next Loading is the loading time of a trip row minus the unloading time of the row above it on the same card. The first trip of a card has no gap and is not counted.</li>
   <li>{DELAY_LIMIT} minutes or less is not a delay. Yellow is more than {DELAY_LIMIT} and up to 20 minutes, orange is more than 20 and up to 30, red is more than 30.</li>
   <li>Date and shift are the Book Date and the shift saved on the card.</li>
   <li>Not judged: a time is not written, the card was saved without times, or the time works out longer than a shift. These are never counted as delays.</li>
   <li>Times that cross 12 at night are counted forward. Tea and meal breaks are not removed in the Standard view. A row that carries several trips is counted once.</li>
   <li>Exception time (Personalised view): enter the time of blasting, breakfast or any other stop. The minutes of a trip or gap that fall inside that time are not counted, and the band is judged on the minutes left. Example: exception time 06:00 to 07:00; a trip loaded at 05:50 and unloaded at 06:45 is 55 minutes as written, 45 of them inside the exception time, so it counts as 10 minutes. “Exception given” is the number of {m.noun}s that moved to a lower band this way.</li>
   <li>An exception time applies to what was on the screen when it was added: all sites, one site, or one date and shift. It is kept for your login on this device. Other users, and the Standard view, always show every trip as written.</li>
   <li>A delay is counted against the driver named on the card and the loading machine written on the row being loaded.</li>
  </ul></details>
 </div>;
}
