import React,{useMemo,useState} from 'react';
import {BANDS,BAND_LABELS,MODES,GROUPS,DELAY_LIMIT,tripEntries,summarise,delayedEntries,entryRemark,groupKey} from '../shared/trip-timing-report.mjs';
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

const identity={
 site:[column('site','Site'),column('driversLate','Drivers with a delay')],
 shift:[column('date','Date',r=>r.total?'ALL DATES':day(r.date)),column('shift','Shift'),column('driversLate','Drivers with a delay')],
 driver:[column('caliberId','Caliber ID'),column('driver','Driver'),column('doors','Door no.')],
 door:[column('door','Door no.'),column('driverCount','Drivers on it')],
 machine:[column('machine','Loading machine'),column('vehicleCount','Vehicles loaded')]
};
export function summaryColumns(group,mode,onBand){
 const number=band=>column(band,BAND_LABELS[band],null,r=>r[band]>0?(onBand?<button type="button" className={'tt-band tt-'+band} title={'Show only '+BAND_LABELS[band]} onClick={e=>{e.stopPropagation();onBand(r,band);}}>{r[band]}</button>:pill(band,r[band])):r[band]);
 return [...identity[group],column('timed',MODES[mode].unit),column('ok',BAND_LABELS.ok),...BANDS.map(b=>number(b.key)),column('over','Total over '+DELAY_LIMIT+' min'),
  column('percent','% over '+DELAY_LIMIT+' min',r=>blank(r.percent)?'—':r.percent+'%'),column('longest','Longest (min)'),
  // The same driver's (or shift's) delays in the other timing, so that everything against a name is on one line.
  column('otherOver','Also over '+DELAY_LIMIT+' min in '+MODES[OTHER[mode]].label),column('notJudged','Not judged')];
}
export function delayedColumns(mode,withDriver){
 const who=withDriver?[column('caliberId','Caliber ID'),column('driver','Driver')]:[];
 const start=[column('date','Date',e=>day(e.date)),column('shift','Shift'),column('book','Book no.'),column('door','Door no.'),...who,column('sr','Tr.Sr.No')];
 const band=column('band','Band',e=>BAND_LABELS[e[mode].band],e=>pill(e[mode].band,BAND_LABELS[e[mode].band]));
 return mode==='load-unload'
  ?[...start,column('machine','Loading machine'),column('trips','Trips'),column('loadingTime','Loading time'),column('unloadingTime','Unloading time'),column('minutes','Minutes taken',e=>minutes(e,mode),e=>pill(e[mode].band,minutes(e,mode))),band]
  :[...start,column('previousUnloadingTime','Unloaded at (previous trip)'),column('loadingTime','Loaded again at'),column('machine','Loading machine'),column('minutes','Gap minutes',e=>minutes(e,mode),e=>pill(e[mode].band,minutes(e,mode))),band];
}
export const cardColumns=[column('sr','Tr.Sr.No'),column('machine','Loading machine'),column('trips','Trips'),column('loadingTime','Loading time'),column('unloadingTime','Unloading time'),
 column('taken','Loading → Unloading (min)',e=>minutes(e,'load-unload'),e=>pill(e['load-unload'].band,minutes(e,'load-unload'))),
 column('gap','Unloading → this loading (min)',e=>e.first?'—':minutes(e,'unload-load'),e=>e.first?'—':pill(e['unload-load'].band,minutes(e,'unload-load'))),
 column('remark','Remark',e=>entryRemark(e)||'—')];
const itemLabel=(group,row)=>group==='driver'?`${row.driver} · ${row.caliberId}`:group==='door'?'Door '+row.door:'Loading machine '+row.machine;

export default function TripTimingReport({records=[],loading='',period='',ReportSection,dataReady=true,rowsView=null}){
 const [mode,setMode]=useState('load-unload'),[group,setGroup]=useState('driver'),[site,setSite]=useState(''),[item,setItem]=useState(null),[band,setBand]=useState(''),[card,setCard]=useState(''),[slot,setSlot]=useState(null);
 const entries=useMemo(()=>tripEntries(records),[records]);
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
 const chips=(total,count)=><nav className="tt-chips" aria-label="Delay band">{[['','All over '+DELAY_LIMIT+' min',total],...BANDS.map(b=>[b.key,b.label,count(b.key)])].map(([key,label,n])=><button key={key||'all'} type="button" className={key?'tt-'+key:''} aria-current={band===key?'page':undefined} onClick={()=>setBand(key)}>{label} · {n}</button>)}</nav>;
 const summaryLine=t=>t.timed?`${t.over} of ${t.timed} timed ${m.noun}s (${t.percent}%) took more than ${DELAY_LIMIT} minutes ${what}: ${BANDS.map(b=>t[b.key]+' in '+b.label).join(', ')}.${t.notJudged?' '+t.notJudged+' could not be judged.':''}`:`No ${m.noun} with both times written in these dates and filters.`;
 const withTotal=(rows,total)=>rows.length?[...rows,total]:[];
 const rowClass=r=>r.total?'tt-total':'';
 const where=siteLabel+(slot?' · '+slot.label:'');
 return <div className="tt-report">{tabs}
  <nav className="tt-crumbs" aria-label="Steps">{crumbs.map(([label,go],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{go&&i<crumbs.length-1?<button type="button" onClick={go}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>
  {level===1&&<>
   <p className="tt-insight">{summaryLine(sites.total)}</p>
   <ReportSection key={'tt-sites-'+mode} reportKey={'Trip timing sites '+mode} dataReady={dataReady} title={'Step 1 · '+m.label+' · All sites · '+period} category="operations-timing-sites" description={'One line per site. Press a site to see it date by date and shift by shift. Press a coloured number to see only the shifts behind it.'}
    rows={withTotal(sites.rows,sites.total)} columns={summaryColumns('site',mode,openSite)} rowKey={r=>r.id} rowClassName={rowClass} onRowClick={r=>openSite(r)} emptyMessage="No trip rows in these dates and filters."/>
  </>}
  {level===2&&<>
   <p className="tt-insight">{summaryLine(shifts.total)}</p>
   {chips(shifts.total.over,key=>shifts.total[key])}
   <ReportSection key={'tt-shifts-'+mode+site+band} reportKey={'Trip timing shifts '+mode} dataReady={dataReady} title={'Step 2 · '+m.label+' · '+siteLabel+' · date-wise and shift-wise · '+period+(band?' · '+BAND_LABELS[band]:'')} category="operations-timing-shifts" description={'One line per date and shift, newest first. Press a line to see the drivers of that shift. Press the last line to see the drivers for all the dates together.'}
    rows={withTotal(shiftsListed,band?{...shifts.total,id:'shown-total'}:shifts.total)} columns={summaryColumns('shift',mode,openSlot)} rowKey={r=>r.id} rowClassName={rowClass} onRowClick={r=>openSlot(r)} emptyMessage={'No '+m.noun+' over '+DELAY_LIMIT+' minutes here.'}/>
  </>}
  {level===3&&<>
   <nav className="tt-subtabs" aria-label="Count by">{Object.entries(GROUPS).map(([key,label])=><button key={key} type="button" aria-current={group===key?'page':undefined} onClick={()=>setGroup(key)}>{label}</button>)}</nav>
   <p className="tt-insight">{summaryLine(lines.total)}</p>
   {chips(lines.total.over,key=>lines.total[key])}
   <ReportSection key={'tt-lines-'+mode+group+site+slot.key+band} reportKey={'Trip timing '+group+' '+mode} dataReady={dataReady} title={'Step 3 · '+m.label+' · '+where+' · '+GROUPS[group]+(band?' · '+BAND_LABELS[band]:'')} category={'operations-timing-'+group} description={'One line per '+(group==='driver'?'driver':group==='door'?'door number':'loading machine')+', worst first, with every band against the name. Press a line to see its delayed '+m.noun+'s.'}
    rows={withTotal(listed,band?{...lines.total,id:'shown-total'}:lines.total)} columns={summaryColumns(group,mode,openItem)} rowKey={r=>r.id} rowClassName={rowClass} onRowClick={r=>openItem(r)} emptyMessage={'No '+m.noun+' over '+DELAY_LIMIT+' minutes here.'}/>
  </>}
  {level===4&&<>
   {chips(allDelayed.length,key=>allDelayed.filter(e=>e[mode].band===key).length)}
   <ReportSection key={'tt-delayed-'+mode+item.group+item.key+slot.key+band} reportKey={'Trip timing delayed '+mode+(item.group==='driver'&&item.key!==EVERY?'':' with driver')} dataReady={dataReady} title={'Step 4 · '+m.label+' · '+item.label+' · '+where+(band?' · '+BAND_LABELS[band]:'')} category="operations-timing-delayed" description={'Every '+m.noun+' over '+DELAY_LIMIT+' minutes, newest first. Press a line to see the full trip card.'}
    rows={delayed} columns={delayedColumns(mode,item.group!=='driver'||item.key===EVERY)} rowKey={e=>e.id} onRowClick={e=>setCard(e.recordId)} emptyMessage={'No '+m.noun+' in this band.'}/>
  </>}
  {level===5&&cardHead&&<ReportSection key={'tt-card-'+card} reportKey="Trip timing card" dataReady={dataReady} showSearch={false} title={'Step 5 · Trip card '+cardHead.book} category="operations-timing-card" description={`${cardHead.site} · ${day(cardHead.date)} · ${cardHead.shift} · Door ${cardHead.door} · ${cardHead.driver||'Name not recorded'} · ${cardHead.caliberId||'ID not recorded'} · every trip row of this card with both timings`}
   rows={cardEntries} columns={cardColumns} rowKey={e=>e.id} emptyMessage="No trip rows on this card."/>}
  <details className="tt-notes"><summary>How this report counts</summary><ul>
   <li>Loading → Unloading is the unloading time minus the loading time of the same trip row.</li>
   <li>Unloading → next Loading is the loading time of a trip row minus the unloading time of the row above it on the same card. The first trip of a card has no gap and is not counted.</li>
   <li>{DELAY_LIMIT} minutes or less is not a delay. Yellow is more than {DELAY_LIMIT} and up to 20 minutes, orange is more than 20 and up to 30, red is more than 30.</li>
   <li>Date and shift are the Book Date and the shift saved on the card.</li>
   <li>Not judged: a time is not written, the card was saved without times, or the time works out longer than a shift. These are never counted as delays.</li>
   <li>Times that cross 12 at night are counted forward. Tea and meal breaks are not removed. A row that carries several trips is counted once.</li>
   <li>A delay is counted against the driver named on the card and the loading machine written on the row being loaded.</li>
  </ul></details>
 </div>;
}
