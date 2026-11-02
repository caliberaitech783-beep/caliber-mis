import React,{useEffect,useMemo,useState} from 'react';
import {OPERATIONAL_START} from '../operational-start.mjs';
import {productionShifts} from '../production-report.mjs';
import './production-reports.css';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const labels={S1:'Shift 1',S2:'Shift 2',S3:'Shift 3',D:'Day shift',N:'Night shift'};
const column=(key,label)=>({key,label,value:r=>r[key]??'—'});
const request=async(url,token,signal)=>{const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load report.');return data;};
export default function ProductionReports({session,reportId,onSelect,ReportSection}){
 const [filters,setFilters]=useState({site:'',date:today(),mode:'shift',shift:'',schedule:''}),[options,setOptions]=useState({sites:[],shifts:[]}),[result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[run,setRun]=useState(null);
 const query=useMemo(()=>new URLSearchParams(filters).toString(),[filters]);
 useEffect(()=>{const c=new AbortController();setOptions({sites:[],shifts:[]});request('/api/reports/production/options',session.token,c.signal).then(setOptions).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[session.token]);
 useEffect(()=>{
  setResult(null);setBusy(false);if(!run||run.query!==query)return;
  const c=new AbortController();setBusy(true);setError('');request('/api/reports/production?'+query,session.token,c.signal).then(data=>{if(!c.signal.aborted)setResult({query,data});}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});return()=>c.abort();
 },[run,query,session.token]);
 const shifts=productionShifts(options.shifts,filters.site,filters.date),mixed=shifts.some(s=>s.startsWith('S'))&&shifts.some(s=>['D','N'].includes(s)),machine=reportId==='machine-production';
 const report=result?.query===query&&!busy?result.data:null,title=machine?'Day-wise Machine Number Report':'Day-wise Door Number Report';
 const set=(key,value)=>{setFilters(f=>({...f,[key]:value,...(['site','date'].includes(key)?{shift:'',schedule:''}:{})}));setError('');};
 const valid=filters.site&&filters.date>=OPERATIONAL_START&&(filters.mode==='shift'?shifts.includes(filters.shift):shifts.length&&(!mixed||filters.schedule));
 const columns=[column('sr','Sr. No.'),column('door',machine?'Machine / M No.':'Door No.'),...(!machine?[column('make','Make'),column('model','Model')]:[]),...(report?.shifts||[]).flatMap(s=>[column(s+'Driver',`${labels[s]} ${machine?'operator':'driver'}`),...(machine?[column(s+'Hours',`${labels[s]} hours`)]:[]),column(s+'Trips',`${labels[s]} trips`),...(machine?[column(s+'Quantity',`${labels[s]} quantity (CUM)`)]:[])]),...(machine?[column('totalHours','Total machine hours')]:[column('capacity','Capacity (CUM/trip)')]),column('totalTrips','Total trips'),column('totalQuantity','Quantity (CUM)'),column('coverage','Card coverage')];
 const description=report?`${filters.site} · ${filters.date} · ${report.shifts.map(s=>labels[s]).join(', ')} · Processed batches: ${report.status.map(s=>`${s.batch} (revision ${s.revision})`).join('; ')} · Generated ${new Date(report.generatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST`:'';
 const rows=report?.ready?(machine?report.machineRows:report.doorRows):[],totals={id:'selection-total',door:'TOTAL (complete selection)',sr:'',coverage:''};
 if(report?.ready)for(const key of ['totalTrips','totalQuantity',...(machine?['totalHours']:[]),...report.shifts.flatMap(s=>[s+'Trips',...(machine?[s+'Hours',s+'Quantity']:[])])]){const values=rows.map(r=>r[key]).filter(v=>v!==null&&v!==undefined);totals[key]=values.length?Math.round(values.reduce((n,v)=>n+v,0)*1000)/1000:null;}
 return <section className="production-reports"><header><small>REPORTS / TRIPS & PRODUCTIVITY</small><h1>{title}</h1><p>Completed trips, approved capacities and saved machine hours.</p></header>
  <nav className="production-tabs" aria-label="Production reports">{[['door-production','Door number'],['machine-production','Machine number']].map(([id,label])=><button key={id} type="button" aria-current={reportId===id?'page':undefined} onClick={()=>onSelect(id)}>{label}</button>)}</nav>
  <form className="production-filters" onSubmit={e=>{e.preventDefault();if(valid)setRun({query,at:Date.now()});}}>
   <label>1. Site<select value={filters.site} required onChange={e=>set('site',e.target.value)}><option value="">Select site</option>{options.sites.map(s=><option key={s}>{s}</option>)}</select></label>
   <label>2. Date<input type="date" required min={OPERATIONAL_START} value={filters.date} onChange={e=>set('date',e.target.value)}/></label>
   <label>3. Report type<select value={filters.mode} onChange={e=>set('mode',e.target.value)}><option value="shift">Shift-wise</option><option value="day">Day-wise</option></select></label>
   {filters.mode==='shift'?<label>Shift<select required value={filters.shift} onChange={e=>set('shift',e.target.value)}><option value="">Select shift</option>{shifts.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>:mixed&&<label>Applicable schedule<select required value={filters.schedule} onChange={e=>set('schedule',e.target.value)}><option value="">Select schedule</option><option value="three">Shift 1 / 2 / 3</option><option value="daynight">Day / Night</option></select></label>}
   <button type="submit" disabled={!valid||busy}>{busy?'Checking batches…':'Show report'}</button>
  </form>
  {error&&<p className="production-error" role="alert">{error}</p>}
  {filters.site&&!shifts.length&&<p role="status">No active, unambiguous Shift Master schedule is available for this site and date.</p>}
  {report&&<><div className="production-checkpoints">{report.status.map(s=><div key={s.shift} className={s.state==='Processed'?'processed':'pending'}><strong>{labels[s.shift]} · {s.state}</strong><span>{s.cards} saved VLB cards</span><small>{s.batch||'Batch not created'}</small></div>)}</div>
   {!report.ready?<div className="production-blocked" role="status"><h2>Report not generated</h2><p>Complete the checks below, then select Show report again. Print and export become available only after these checks pass.</p><ul>{report.issues.map((v,i)=><li key={i}>{v.message}{v.reference&&<small> — {v.reference}</small>}</li>)}</ul></div>:<>
    <div className="production-totals"><div><strong>{report.totalTrips.toLocaleString('en-IN')}</strong><span>Completed trips</span></div><div><strong>{report.totalQuantity.toLocaleString('en-IN',{maximumFractionDigits:3})}</strong><span>Quantity (CUM)</span></div><div><strong>Matched</strong><span>Door and machine trip / quantity totals</span></div></div>
    {report.warnings.length>0&&<div className="production-warning"><strong>Source data review</strong><ul>{report.warnings.map((w,i)=><li key={i}>{w.reference}: {w.message}</li>)}</ul></div>}
    <ReportSection key={reportId+query+report.generatedAt} title={title} category="production" description={description} rows={[...rows,totals]} columns={columns} rowKey={r=>r.id} rowClassName={r=>r.id==='selection-total'?'production-summary':''} emptyMessage="No matching assets."/>
    <details><summary>Sources, capacity versions and calculation rules</summary><ul>{report.notes.map(n=><li key={n}>{n}</li>)}</ul><p>Capacity approvals used: {report.capacityVersions.map(v=>`${v.location?`${v.location} · `:''}${v.jobType?`${v.jobType} · `:''}${v.make} / ${v.model}: ${v.capacity} CUM/trip from ${v.effectiveFrom} (#${v.id})`).join('; ')}.</p><p>To refresh after a correction, process the batch again and select Show report. Earlier downloaded reports retain their generation timestamp.</p></details>
   </>}
  </>}
 </section>;
}
