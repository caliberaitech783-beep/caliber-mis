import React,{useEffect,useMemo,useState} from 'react';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {STAGE_LABELS,PENDING_STAGES,TARGET_HOURS,GOOD_PERCENT,POOR_PERCENT,MAX_DAYS,displayDate,sitesInsights,shiftsInsight} from '../shared/batch-status-report.mjs';
import './production-reports.css';
import './batch-status-report.css';

// Batch Status & Turnaround, four steps: every site, one site shift by shift, one batch, and every action in that batch.
// A report only: it reads batches and their history and changes nothing.
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const monthStart=date=>{const first=date.slice(0,8)+'01';return first<OPERATIONAL_START?OPERATIONAL_START:first;};
const request=async(url,token,signal)=>{const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load report.');return data;};
const blank=v=>v===null||v===undefined||v==='';
const column=(key,label,value,render)=>({key,label,value:value||(r=>blank(r[key])?'—':r[key]),...(render?{render}:{})});
const when=iso=>iso?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)).replaceAll('/','-').replace(',',''):'—';
const EVERY='*';
const stageBadge=r=><span className={'bs-stage bs-stage-'+r.stage}>{r.stageLabel}</span>;
const flagged=(text,bad)=>bad?<span className="bs-late">{text}</span>:text;

const rated=(r,text)=>r.rating?<span className={'bs-rating bs-rating-'+r.rating}>{text}</span>:text;
export const siteColumns=[column('rank','Rank',null,r=>blank(r.rank)?'—':rated(r,r.rank)),column('site','Site'),column('due','Shifts due'),
 column('todayCounted',"Of which today's shifts",r=>blank(r.todayShifts)?'—':`${r.todayCounted} of ${r.todayShifts}`),column('locked','Locked'),
 column('percentDone','Done (% of shifts due)',r=>blank(r.percentDone)?'—':r.percentDone+'%',r=>blank(r.percentDone)?'—':rated(r,r.percentDone+'%')),
 column('ratingLabel','Performance',null,r=>r.ratingLabel?rated(r,r.ratingLabel):'—'),column('balance','Balance'),column('notCreated','Batch not created'),column('vlbOpen','VLB open'),column('lmvOpen','LMV open'),column('elbOpen','ELB open'),
 column('oldestPending','Oldest pending shift'),
 column('withinTargetPercent','Locked within '+TARGET_HOURS+' hours',r=>blank(r.withinTargetPercent)?'—':r.withinTargetPercent+'%'),
 column('averageLockHours','Average hours, shift end to locked',null,r=>blank(r.averageLockHours)?'—':flagged(r.averageLockHours,r.averageLockHours>TARGET_HOURS)),
 column('slowestStage','Slowest stage',r=>r.slowestStage?`${r.slowestStage} (${r.slowestStageHours} h)`:'—'),column('rework','Unlocked or reopened (times)')];
export const shiftColumns=allSites=>[...(allSites?[column('site','Site')]:[]),column('date','Date',r=>displayDate(r.date)),column('shiftLabel','Shift'),column('stageLabel','Stage now',null,stageBadge),
 column('pendingHours','Pending for (hours since shift ended)'),column('waitHours','Wait before batch created (hours)'),column('vlbHours','VLB stage (hours)'),column('lmvHours','LMV stage (hours)'),column('elbHours','ELB stage (hours)'),
 column('lockHours','Shift end to locked (hours)',null,r=>blank(r.lockHours)?'—':flagged(r.lockHours,r.lockHours>TARGET_HOURS)),column('workHours','Work on website (hours)'),
 column('cards','Trip cards saved'),column('lmvBooks','LMV log books saved'),column('machines','Machines saved',r=>blank(r.machinesTotal)?'—':`${r.machinesSaved} of ${r.machinesTotal}`),column('rework','Unlocked or reopened (times)'),column('enteredBy','Entered by')];
export const timelineColumns=[column('label','Milestone'),column('at','When',r=>when(r.at)),column('by','Done by'),column('sincePrevious','Hours since previous milestone'),column('sinceShiftEnd','Hours since shift ended')];
export const stageColumns=[column('stage','Stage'),column('clockHours','Clock time (hours)'),column('workMinutes','Work on website (minutes)'),column('waitHours','Waiting (hours)'),column('items','Items saved'),column('minutesPerItem','Minutes of work per item')];
export const reworkColumns=[column('label','Rework in this batch'),column('count','Count')];
export const actionColumns=[column('sr','Sr'),column('at','Time',r=>when(r.at)),column('stage','Stage'),column('action','Action'),column('item','Item'),column('by','Done by'),column('gapMinutes','Gap from previous action (minutes)'),column('workMinutes','Working time (minutes)'),column('remark','Remark')];

export default function BatchStatusReport({session,ReportSection}){
 const [filters,setFilters]=useState(()=>({from:monthStart(today()),to:today()})),[result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [run,setRun]=useState(()=>({query:new URLSearchParams({from:monthStart(today()),to:today()}).toString(),at:0}));
 const [siteKey,setSiteKey]=useState(''),[stage,setStage]=useState(''),[batchId,setBatchId]=useState(''),[detail,setDetail]=useState(null),[detailError,setDetailError]=useState(''),[actionStage,setActionStage]=useState('');
 const query=useMemo(()=>new URLSearchParams(filters).toString(),[filters]);
 useEffect(()=>{
  setResult(null);setBusy(false);if(!run||run.query!==query)return;
  const c=new AbortController();setBusy(true);setError('');
  request('/api/reports/batch-status?'+query,session.token,c.signal).then(data=>{if(!c.signal.aborted)setResult({query,data});}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});
  return()=>c.abort();
 },[run,query,session.token]);
 useEffect(()=>{
  setDetail(null);setDetailError('');if(!batchId)return;
  const c=new AbortController();
  request('/api/reports/batch-status/batch?id='+encodeURIComponent(batchId),session.token,c.signal).then(data=>{if(!c.signal.aborted)setDetail(data);}).catch(e=>{if(!c.signal.aborted)setDetailError(e.message);});
  return()=>c.abort();
 },[batchId,session.token]);
 const set=(key,value)=>{setFilters(f=>({...f,[key]:value}));setError('');setBatchId('');setActionStage('');};
 const report=result?.query===query&&!busy?result.data:null;
 const valid=filters.from>=OPERATIONAL_START&&filters.to>=filters.from&&(Date.parse(filters.to)-Date.parse(filters.from))/86400000<MAX_DAYS;
 const period=displayDate(filters.from)+' to '+displayDate(filters.to),asOf=report?' · as on '+when(report.asOf):'';
 const site=report&&siteKey&&siteKey!==EVERY?report.sites.find(s=>s.siteKey===siteKey):null,siteLabel=siteKey===EVERY?'All sites':site?.site||'';
 const siteShifts=report&&siteKey?report.shifts.filter(r=>siteKey===EVERY||r.siteKey===siteKey):[];
 const listed=stage?siteShifts.filter(r=>r.stage===stage):siteShifts;
 const openSite=key=>{setSiteKey(key);setStage('');setBatchId('');setActionStage('');};
 const openBatch=row=>{if(row.batchId){setBatchId(row.batchId);setActionStage('');}};
 const level=!siteKey?1:!batchId?2:!actionStage?3:4;
 const crumbs=[['All sites',()=>openSite('')],...(siteKey?[[siteLabel,()=>{setBatchId('');setActionStage('');}]]:[]),...(batchId?[[detail?detail.batch.name:'Batch',()=>setActionStage('')]]:[]),...(actionStage?[[actionStage===EVERY?'All actions':actionStage+' actions',null]]:[])];
 const actions=detail?detail.actions.filter(a=>actionStage===EVERY||a.stage===actionStage):[];
 const batchLine=detail?`${detail.batch.site} · ${displayDate(detail.batch.date)} · ${detail.batch.shiftLabel} · ${detail.batch.stageLabel}${detail.batch.enteredBy?' · entered by '+detail.batch.enteredBy:''}`:'';
 return <section className="production-reports batch-status-report"><header><small>REPORTS / OPERATIONS</small><h1>Batch Status & Turnaround</h1><p>Where every shift stands, how long each stage took, and how much of that was actual work on the website.</p></header>
  <form className="production-filters" onSubmit={e=>{e.preventDefault();if(valid){setRun({query,at:Date.now()});}}}>
   <label>1. From<input type="date" required min={OPERATIONAL_START} value={filters.from} onChange={e=>set('from',e.target.value)}/></label>
   <label>2. To<input type="date" required min={filters.from||OPERATIONAL_START} value={filters.to} onChange={e=>set('to',e.target.value)}/></label>
   <button type="submit" disabled={!valid||busy}>{busy?'Reading batches…':'Show report'}</button>
  </form>
  {!valid&&<p role="status">Choose a range of at most {MAX_DAYS} days, on or after 01-11-26.</p>}
  {error&&<p role="alert" className="production-error">{error}</p>}
  {report&&<nav className="bs-crumbs" aria-label="Steps">{crumbs.map(([label,go],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{go&&i<crumbs.length-1?<button type="button" onClick={go}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>}
  {report&&level===1&&<>
   {report.sites.length>0&&<ul className="bs-insight">{sitesInsights(report.sites,report.total).map(line=><li key={line}>{line}</li>)}</ul>}
   <ReportSection key={'bs-sites-'+query} title={'Step 1 · All sites · '+period} category="batch-status-sites" description={'One line per site, best first'+asOf+'. Done = Locked out of Shifts due. Green = '+GOOD_PERCENT+'% or more done, orange = '+POOR_PERCENT+'% to '+(GOOD_PERCENT-1)+'%, red = below '+POOR_PERCENT+'%. Balance = Batch not created + VLB open + LMV open + ELB open; each shift is counted once, at the stage where it stands now. Press a site to see it shift by shift.'}
    rows={report.sites.length?[...report.sites,report.total]:[]} columns={siteColumns} rowKey={r=>r.id} rowClassName={r=>(r.id==='all-sites'?'bs-total ':'')+(r.rating?'bs-band-'+r.rating:'')} onRowClick={r=>openSite(r.siteKey||EVERY)} emptyMessage="No batch has been created at your sites up to this date."/>
   <details className="bs-notes"><summary>How this report counts</summary><ul>
    <li>A site is counted from the date of its first batch. A shift is counted once its end time (from the Shift Master) has passed, so Shifts due grows during the day: each shift of today is added the moment it ends. Of which today's shifts shows how many of today's shifts are already counted.</li>
    <li>Done is Locked as a percentage of Shifts due. Rank 1 is the site with the highest Done; sites with the same percentage share a rank. Performance: Good (green) from {GOOD_PERCENT}%, Average (orange) from {POOR_PERCENT}% to {GOOD_PERCENT-1}%, Poor (red) below {POOR_PERCENT}%.</li>
    <li>Locked within {TARGET_HOURS} hours and the average are measured from the end of the shift to the time the batch was locked.</li>
    <li>Slowest stage is the stage with the highest average clock time among the locked batches of the site.</li>
    <li>If a batch was unlocked or reopened, the times shown are its final lock times; the last column counts how often that happened.</li>
   </ul></details>
  </>}
  {report&&level===2&&<>
   <p className="bs-insight">{shiftsInsight(siteShifts)}</p>
   <nav className="production-tabs" aria-label="Stage">{[['','All shifts',siteShifts.length],...['locked',...PENDING_STAGES].map(key=>[key,STAGE_LABELS[key],siteShifts.filter(r=>r.stage===key).length])].map(([key,label,count])=><button key={key||'all'} type="button" aria-current={stage===key?'page':undefined} onClick={()=>setStage(key)}>{label} · {count}</button>)}</nav>
   <ReportSection key={'bs-shifts-'+query+'-'+siteKey+'-'+stage} title={'Step 2 · '+siteLabel+' · shift by shift · '+period+(stage?' · '+STAGE_LABELS[stage]:'')} category="batch-status-shifts" description={'One line per shift'+asOf+'. Hours in each stage are by the clock. Red = more than '+TARGET_HOURS+' hours from shift end to locked. Press a line to open its batch.'}
    rows={listed} columns={shiftColumns(siteKey===EVERY)} rowKey={r=>r.id} rowClassName={r=>'bs-row-'+r.stage} onRowClick={openBatch} emptyMessage="No shifts at this stage."/>
  </>}
  {report&&level>=3&&detailError&&<p role="alert" className="production-error">{detailError}</p>}
  {report&&level>=3&&!detail&&!detailError&&<p role="status">Reading the batch…</p>}
  {report&&level===3&&detail&&<>
   <p className="bs-insight">{detail.insight}</p>
   <ReportSection key={'bs-timeline-'+batchId} title={'Step 3 · '+detail.batch.name+' · timeline'} category="batch-status-timeline" description={batchLine} rows={detail.timeline} columns={timelineColumns} rowKey={r=>r.id} showSearch={false} emptyMessage="No milestones."/>
   <ReportSection key={'bs-stages-'+batchId} title="Time taken in each stage" category="batch-status-stages" description={'Clock time is from one lock to the next. Work on website counts the gaps between saves up to '+detail.idleLimitMinutes+' minutes; longer gaps are waiting. Press a stage to see its actions.'} rows={detail.stages} columns={stageColumns} rowKey={r=>r.id} rowClassName={r=>r.stage==='Whole batch'?'bs-total':''} onRowClick={r=>setActionStage(r.stage==='Whole batch'?EVERY:r.stage)} showSearch={false} emptyMessage="No stages."/>
   <ReportSection key={'bs-rework-'+batchId} title="Rework in this batch" category="batch-status-rework" description="Counted from the batch history." rows={detail.rework} columns={reworkColumns} rowKey={r=>r.id} showSearch={false} emptyMessage="No rework."/>
  </>}
  {report&&level===4&&detail&&<ReportSection key={'bs-actions-'+batchId+'-'+actionStage} title={'Step 4 · '+detail.batch.name+' · '+(actionStage===EVERY?'every action':actionStage+' actions')} category="batch-status-actions" description={batchLine+' · A gap of more than '+detail.idleLimitMinutes+' minutes between two actions is counted as waiting, not as work.'} rows={actions} columns={actionColumns} rowKey={r=>r.id} rowClassName={r=>r.waiting?'bs-waiting':''} emptyMessage="No actions recorded in this stage."/>}
 </section>;
}
