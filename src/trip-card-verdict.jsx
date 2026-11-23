// Trip card attendance, card by card (owner, 24 Nov 2026): the filter bar and the verdict shared by Site Sheet vs Trip Card
// (src/site-sheet-trip-card.jsx) and Trip Card vs Bio-punch (src/trip-card-biopunch.jsx). Rules: shared/trip-card-attendance.mjs.
//   TripCardFilters  log book tabs (All / VLB / ELB / LMV), the batch, From and To
//   TripCardVerdict  "100 trip cards: 85 OK, need no attention · 15 need attention", then only the 15 with their problems;
//                    the 85 are listed only when asked for.
import React,{useState} from 'react';
import {CheckCircle2,AlertTriangle,Download} from 'lucide-react';
import {LOG_BOOK_TABS,CARD_ISSUES,SOURCES} from '../shared/trip-card-attendance.mjs';
import './trip-card-verdict.css';

const many=(n,one,more=one+'s')=>n+' '+(n===1?one:more);
const col=(key,label,extra={})=>({key,label,value:r=>r[key]===''||r[key]===undefined||r[key]===null?'—':r[key],...extra});

// tabs={false}: no log book tabs. Site Sheet vs Trip Card chooses the log book before the upload (its own tabs), so here
// only the batch, From and To are left to choose.
export function TripCardFilters({filter,onChange,min,max,logBooks,batches,disabled,checked,onDownload,children,tabs=true}){
 return <section className="tcv-filters" aria-label="What to see">
  {tabs&&<div className="tcv-tabs" role="tablist" aria-label="Log book">
   {LOG_BOOK_TABS.map(t=><button key={t.key||'all'} type="button" role="tab" aria-selected={filter.logBook===t.key} disabled={disabled}
    onClick={()=>onChange({logBook:t.key,batch:''})}>{t.label}{logBooks&&<small>{logBooks[t.key]||0}</small>}</button>)}
  </div>}
  <div className="tcv-fields">
   {children}
   <label>Batch<select value={filter.batch} disabled={disabled||!checked} onChange={e=>onChange({batch:e.target.value})}>
    <option value="">{checked?'All batches'+(batches?' ('+batches.length+')':''):'Press Check to list the batches'}</option>
    {(batches||[]).map(b=><option key={b.value} value={b.value}>{b.value} · {many(b.count,'card')}</option>)}
   </select></label>
   <label>From<input type="date" value={filter.from} min={min||undefined} max={filter.to||max||undefined} disabled={disabled} onChange={e=>onChange({from:e.target.value})}/></label>
   <label>To<input type="date" value={filter.to} min={filter.from||min||undefined} max={max||undefined} disabled={disabled} onChange={e=>onChange({to:e.target.value})}/></label>
   {onDownload&&<button type="button" className="asc-run light tcv-download" disabled={disabled} onClick={onDownload}><Download size={16}/>Download Excel of this selection</button>}
  </div>
 </section>;
}

export function TripCardVerdict({view,ReportSection,withSheet=false,withBio=false,against,site,period}){
 const [show,setShow]=useState({ok:false,issue:''});
 const {judged,summary}=view;
 const choice=[view.logBook||'All log books',view.batch?'batch '+view.batch:''].filter(Boolean).join(' · ');
 const bad=judged.filter(c=>!c.ok&&(!show.issue||c.issues.includes(show.issue))),good=judged.filter(c=>c.ok);
 const issues=CARD_ISSUES.filter(i=>summary.issues[i.key]>0);
 const columns=[col('dateLabel','Date'),col('shiftLabel','Shift'),col('employeeId','EMP. ID'),col('name','Name'),col('logBook','Log book'),col('batch','Batch'),
  col('books','Trip card / log book no.'),col('doors','Equipment'),col('sourceLabel','How it came in'),
  ...(withSheet?[col('sheetSays','Sheet says')]:[]),...(withBio?[col('bioIn','Bio IN'),col('bioOut','Bio OUT'),col('bioSite','Punch site')]:[])];
 return <section className="tcv" aria-label="Trip cards of this selection">
  <h2>Trip cards against {against} · {site} · {choice} · {period}</h2>
  {!summary.total?<p className="ssc-notice">No trip card of {choice} on the compared dates.</p>:<>
   <div className="tcv-tiles">
    <button type="button" className="tcv-tile ok" aria-pressed={show.ok} onClick={()=>setShow(s=>({ok:!s.ok,issue:''}))}>
     <CheckCircle2 size={22}/><b>{summary.ok}</b><span>OK · need no attention</span><small>{show.ok?'Hide them':'Show them'}</small></button>
    <button type="button" className="tcv-tile bad" aria-pressed={!show.ok} onClick={()=>setShow({ok:false,issue:''})}>
     <AlertTriangle size={22}/><b>{summary.attention}</b><span>Need attention</span><small>{many(summary.peopleAttention,'person','people')}</small></button>
    <div className="tcv-tile all"><b>{summary.total}</b><span>Trip card attendances</span><small>{many(summary.people,'person','people')} · one per person per shift</small></div>
   </div>
   <p className="tcv-sources">{SOURCES.filter(s=>summary.sources[s.key]).map(s=><span key={s.key}>{s.label} <b>{summary.sources[s.key]}</b></span>)}
    {withBio&&<span>Attendance with biometric (IN and OUT) <b>{summary.fullPunch}</b></span>}</p>
   {!show.ok&&issues.length>0&&<div className="ssc-kinds" role="group" aria-label="Problems">
    <button type="button" aria-pressed={!show.issue} onClick={()=>setShow({ok:false,issue:''})}>Every problem <small>{summary.attention}</small></button>
    {issues.map(i=><button key={i.key} type="button" aria-pressed={show.issue===i.key} onClick={()=>setShow({ok:false,issue:show.issue===i.key?'':i.key})}>{i.label} <small>{summary.issues[i.key]}</small></button>)}
   </div>}
   {show.ok
    ?<ReportSection key={'tcv-ok-'+choice} title={'OK trip cards · '+choice+' · '+good.length} category="trip-card-ok" description={'These trip cards agree with '+against+'. Nothing to do.'}
      rows={good} columns={columns} rowKey={r=>r.key} recordDateFilter={false} emptyMessage="No trip card is OK yet."/>
    :summary.attention
     ?<ReportSection key={'tcv-bad-'+choice+'-'+show.issue} title={'Trip cards that need attention · '+choice+' · '+bad.length} category="trip-card-attention"
       description={'Only the cards that do not agree with '+against+', each with its problem and the correction. The '+summary.ok+' OK cards are not listed.'}
       rows={bad} columns={[...columns,col('problem','Problem'),col('correction','Correction required')]} rowKey={r=>r.key} rowClassName={()=>'tcv-row-bad'} recordDateFilter={false}/>
     :<p className="tcv-allok"><CheckCircle2 size={18}/>All {summary.total} trip cards agree with {against}. Nothing needs attention.</p>}
  </>}
 </section>;
}
