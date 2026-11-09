import TabSelectionDialog from './tab-selection-dialog.jsx';
import './log-book-readability.css';
import {compactLogBookLabel} from '../shared/log-book-labels.mjs';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import './manpower-reports.css';

const views=[['manpower','Manpower by Category'],['employee','Shift Performance'],['attendance','Shift Attendance Equipment Wise'],['ot','OT & Multiple Duties']];
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const columns=entries=>entries.map(([key,label])=>({key,label:compactLogBookLabel(label),value:r=>r[key]??'—'}));
const context=[['date','Duty date'],['site','Site'],['shift','Shift']];
const person=[['employeeId','Employee ID'],['caliberCode','Caliber ID'],['employeeName','Driver / operator']];
// Date, site and shift sit in the heading; each returns as a column only when the list covers more than one.
const attendanceColumns=({days,sites,shifts,equipment})=>columns([...(days?[['date','Duty date']]:[]),...(sites?[['site','Site']]:[]),...(shifts?[['shift','Shift']]:[]),...person,['doors','Door / equipment'],...(equipment?[['equipment','Equipment']]:[]),['makeModel','Make / model'],['status','Attendance'],['trips','Completed VLB trips'],['actualLabel','Actual duty'],['flagLabel','Duty flag'],['note','Duty note'],['reason','Zero-trip reason'],['remarks','Remarks']]).map(c=>c.key==='flagLabel'?{...c,render:r=><strong className={'mp-flag mp-flag-'+r.flag}>{r.flagLabel}</strong>}:c);
const dutyFlags=[['red','Red','Back-to-back shifts, or all three shifts'],['orange','Orange','Shift 1 and Shift 3 with a gap'],['review','Brown','Shift pattern needs review'],['zero','Blue','Present with 0 trips']];
const noPick={siteKey:'',shift:'',equipment:'',flag:''},EVERY='*';
const shiftName=code=>({S1:'Shift 1',S2:'Shift 2',S3:'Shift 3',D:'Day shift',N:'Night shift'})[code]||code;
const shortDate=date=>date.slice(8,10)+'-'+date.slice(5,7)+'-'+date.slice(2,4);
const dutyCount=(n,kind)=>n+' '+kind+(n===1?' duty':' duties');
const classification=[['category','Category'],['group','Equipment group'],['make','Make'],['model','Model']];
const detailColumns=columns([...context,['door','Door / equipment'],...classification,...person,['assignment','Assignment'],['batches','Source batches'],['batchStatus','Batch status'],['book','Saved card'],['remarks','Remarks / review']]);
const summaryColumns=columns([...context,...classification,['assets','Distinct vehicles / equipment'],['employees','Distinct employees'],['unresolved','Unresolved assignment records'],['doors','Door numbers'],['batches','Source batches']]);
const performanceColumns=columns([...context,...person,['doors','Doors worked'],['equipment','Equipment / make / model'],['hours','HMR performance hours'],['trips','Completed trips'],['km','Kilometres'],['start','Scheduled start (IST)'],['end','Scheduled end (IST)'],['batches','Source batches'],['books','Saved cards'],['remarks','Remarks / review']]);
const otColumns=columns([['reason','OT flag / reason'],['logBook','Log book'],...person,['category','Driver category'],['equipment','Equipment worked'],['site','Site'],['dates','Duty dates'],['shifts','Shifts worked'],['shiftHours','Each shift’s HMR hours'],['combinedHours','Combined HMR performance hours'],['schedule','Scheduled start / end (IST)'],['gaps','Scheduled gap between duties'],['batches','Source batches'],['books','Saved cards'],['remarks','Remarks / review']]).map(c=>c.key==='reason'?{...c,render:r=><strong className={`mp-flag mp-flag-${r.severity}`}>{r.reason}</strong>}:c);
const exceptionColumns=columns([...context,['door','Door / equipment'],['employeeId','Employee ID'],['employeeName','Driver / operator'],['book','Saved card'],['logBook','Log book'],['batches','Source batches'],['reason','Review reason']]);

const historyColumns=(label,since)=>columns([...person,['site','Site'],['logBook','Log book'],['category','Driver category'],['now',label+' in selected dates'],['nowDates','Selected duty dates'],['pastRed','Earlier RED'+since],['pastOrange','Earlier ORANGE'+since],['total','Total '+label+' so far'],['pastDates','Earlier dates']]);
const driverColumns=columns([...person,['category','Driver category'],['logBook','Log book'],['red','RED duties'],['orange','ORANGE duties'],['review','REVIEW duties'],['total','Flagged duties'],['dutyDates','Duty dates'],['shifts','Shifts worked'],['equipment','Equipment worked']]);
const noDrill={category:'',severity:''};
const severities=[['red','RED','Consecutive shifts / all three shifts'],['orange','ORANGE','Shift 1 + Shift 3 with a gap'],['review','REVIEW','Missing or inconsistent schedule']];
const logBooks=[['VLB','Vehicle Log Book'],['ELB','Equipment Log Book'],['LMV','LMV Log Book']];
const remembered=key=>{try{return localStorage.getItem(key)==='true';}catch{return false;}};
const remember=(key,value)=>{try{localStorage.setItem(key,String(value));}catch{}};

// Sites first, then one site's drivers, each split by log book (VLB, ELB, LMV).
// Plain render function: its state lives in ManpowerReports.
function otOverview({report,filters,query,selectSite,description,ReportSection,severity,setSeverity,logBook,setLogBook,drill,setDrill,history,historyKey}){
 const siteKey=canonicalSiteName(filters.site),site=report.otSites.find(s=>s.siteKey===siteKey);
 const siteRows=siteKey?report.ot.filter(r=>r.siteKey===siteKey):report.ot;
 // A duty saved in two log books belongs to both, so it is listed under each.
 const inBook=(r,code)=>!code||(r.logBooks||[]).includes(code);
 const rows=siteRows.filter(r=>inBook(r,logBook));
 const count=(code,level)=>siteRows.filter(r=>inBook(r,code)&&r.severity===level).length;
 const loaded=history.key===historyKey,past=loaded?history.data:null;
 const label=severities.find(([id])=>id===severity)?.[1]||'';
 const historyRows=(()=>{
  if(!severity)return [];
  const earlier=new Map((past?.drivers||[]).map(d=>[d.employeeKey+'|'+d.siteKey,d])),drivers=new Map(),pending=loaded?'Unavailable':'Checking…';
  for(const r of rows.filter(r=>r.severity===severity)){const id=r.employeeKey+'|'+r.siteKey,row=drivers.get(id)||{id,employeeId:r.employeeId,caliberCode:r.caliberCode,employeeName:r.employeeName,site:r.site,category:r.category,now:0,dates:[],books:new Set()};row.now++;row.dates.push(r.dates);for(const code of r.logBooks||[])row.books.add(code);drivers.set(id,row);}
  return [...drivers.values()].map(({dates,books,...row})=>{const p=earlier.get(row.id);
   return {...row,logBook:logBooks.map(([code])=>code).filter(code=>books.has(code)).join(' + '),nowDates:dates.join('; '),pastRed:past?p?.red||0:pending,pastOrange:past?p?.orange||0:pending,total:past?row.now+(p?.[severity]||0):pending,pastDates:past?[...(p?.redDates||[]).map(d=>d+' RED'),...(p?.orangeDates||[]).map(d=>d+' ORANGE')].sort().join('; ')||'None':pending};
  }).sort((a,b)=>(Number(b.total)||b.now)-(Number(a.total)||a.now)||a.employeeName.localeCompare(b.employeeName));
 })();
 const categories=(()=>{const out=new Map();for(const r of rows){const c=out.get(r.category)||{category:r.category,red:0,orange:0,review:0,drivers:new Set()};c[r.severity]++;c.drivers.add(r.employeeKey);out.set(r.category,c);}return [...out.values()].sort((a,b)=>b.red-a.red||b.orange-a.orange||a.category.localeCompare(b.category));})();
 const since=past?.historyFrom?' (since '+past.historyFrom+')':'';
 // Drill-down from the driver category table: a category, or one colour within it. It narrows only what is listed below that table.
 const active=categories.some(c=>c.category===drill.category)?drill.category:'',drillSeverity=active?drill.severity:'',listSeverity=drillSeverity||severity;
 const listLabel=severities.find(([id])=>id===listSeverity)?.[1]||'';
 const dutyRows=rows.filter(r=>(!active||r.category===active)&&(!listSeverity||r.severity===listSeverity));
 const driverRows=(()=>{
  if(!active)return [];
  const drivers=new Map();
  for(const r of dutyRows){const row=drivers.get(r.employeeKey)||{id:r.employeeKey,employeeId:r.employeeId,caliberCode:r.caliberCode,employeeName:r.employeeName,category:r.category,red:0,orange:0,review:0,total:0,books:new Set(),dates:new Set(),shifts:[],equipment:new Set()};
   row[r.severity]++;row.total++;for(const code of r.logBooks||[])row.books.add(code);for(const date of String(r.dates||'').split('; '))if(date)row.dates.add(date);if(r.shifts)row.shifts.push(r.shifts);for(const item of String(r.equipment||'').split('; '))if(item)row.equipment.add(item);drivers.set(r.employeeKey,row);}
  return [...drivers.values()].map(({books,dates,shifts,equipment,...row})=>({...row,logBook:logBooks.map(([code])=>code).filter(code=>books.has(code)).join(' + '),dutyDates:[...dates].sort().join('; '),shifts:shifts.join(' | '),equipment:[...equipment].join('; ')}))
   .sort((a,b)=>b.red-a.red||b.orange-a.orange||b.total-a.total||String(a.employeeName).localeCompare(String(b.employeeName)));
 })();
 const pick=(category,level)=>setDrill(active===category&&drillSeverity===level?noDrill:{category,severity:level});
 return <>
  <div className="mp-ot-summary" role="group" aria-label="Flag summary by log book">
   <div><small>{site?'SITE':'ALL SITES'}</small><strong>{site?site.site:report.otSites.length+' sites'}</strong>{site&&<button type="button" onClick={()=>selectSite('')}>← All sites</button>}</div>
   <table className="mp-ot-matrix">
    <thead><tr><th scope="col">Log book</th>{severities.map(([id,name,meaning])=><th key={id} scope="col">{name}<small>{meaning}</small></th>)}</tr></thead>
    <tbody>{[['','All log books'],...logBooks].map(([code,name])=><tr key={code||'all'} className={logBook===code?'mp-on':undefined}>
     <th scope="row"><button type="button" className="mp-ot-book" aria-pressed={logBook===code} onClick={()=>setLogBook(code)}><b>{code||'All'}</b><small>{name}</small></button></th>
     {severities.map(([id,label])=><td key={id}><button type="button" className={'mp-ot-count mp-flag-'+id} aria-pressed={logBook===code&&severity===id} aria-label={count(code,id)+' '+label+' · '+name} onClick={()=>{const open=logBook===code&&severity===id;setLogBook(code);setSeverity(open?'':id);}}><strong>{count(code,id)}</strong></button></td>)}
    </tr>)}</tbody>
   </table>
  </div>
  <div className="mp-site-cards" aria-label="Sites">{report.otSites.map(s=><button key={s.siteKey} type="button" className="mp-site-card" aria-pressed={s.siteKey===siteKey} onClick={()=>selectSite(s.siteKey===siteKey?'':s.site)}><strong>{s.site}</strong>
   <span className="mp-site-books"><span className="mp-site-head"><i>Log book</i><i>Red</i><i>Orange</i><i>Review</i></span>{logBooks.map(([code])=>{const n=s.books?.[code]||{red:0,orange:0,review:0};return <span key={code} className={logBook===code?'mp-on':undefined}><b>{code}</b>{severities.map(([id])=><b key={id} className={n[id]?'mp-flag mp-flag-'+id:'mp-zero'}>{n[id]}</b>)}</span>;})}</span>
  </button>)}{!report.otSites.length&&<p className="mp-notice">No site is available for these selections.</p>}</div>
  {severity&&<>
   {!loaded&&<p role="status">Checking earlier duties of these drivers…</p>}{loaded&&history.error&&<p role="alert">{history.error}</p>}
   {past&&<p className="mp-notice">{past.historyFrom?'Earlier duties checked from '+past.historyFrom+' to '+past.historyTo+' (up to '+past.historyDays+' days before the selected dates).':'The selected dates start on the first day of records, so there are no earlier duties to compare.'}</p>}
   <ReportSection key={'history-'+severity+'-'+logBook+'-'+query+'-'+siteKey+'-'+(past?'ready':'wait')} title={label+' drivers'+(logBook?' on '+logBook:'')+' and their earlier repeats'} category="manpower-ot-history" description={description+' · '+(site?site.site:'All sites')+' · '+(logBook||'VLB, ELB and LMV')+' · Earlier counts cover all three log books'} rows={historyRows} columns={historyColumns(label,since)} rowKey={r=>r.id} emptyMessage={'No '+label+' driver in this selection.'}/>
  </>}
  {site?<>
   <div className="mp-category"><h2>{site.site}{logBook?' · '+logBook:''} · flagged drivers by driver category</h2>{categories.length?<>
    <p className="mp-category-hint">{active?<>Showing <strong>{active}{drillSeverity?' · '+listLabel:''}</strong> below. <button type="button" onClick={()=>setDrill(noDrill)}>Show all categories</button></>:'Press a category or a number to list its drivers and their duties below.'}</p>
    <table><thead><tr><th>Driver category</th><th>Red</th><th>Orange</th><th>Review</th><th>Drivers</th></tr></thead><tbody>{categories.map(c=><tr key={c.category} className={active===c.category?'mp-on':undefined}>
     <td><button type="button" className="mp-cat-open" aria-pressed={active===c.category&&!drillSeverity} onClick={()=>pick(c.category,'')}>{c.category}</button></td>
     {severities.map(([id,name])=><td key={id}>{c[id]?<button type="button" className={'mp-cat-count mp-flag-'+id} aria-pressed={active===c.category&&drillSeverity===id} aria-label={c[id]+' '+name+' · '+c.category} onClick={()=>pick(c.category,id)}>{c[id]}</button>:0}</td>)}
     <td><button type="button" className="mp-cat-count" aria-pressed={active===c.category&&!drillSeverity} aria-label={c.drivers.size+' drivers · '+c.category} onClick={()=>pick(c.category,'')}>{c.drivers.size}</button></td>
    </tr>)}</tbody></table></>:<p>No flagged driver at this site{logBook?' on '+logBook:''} in the selected dates.</p>}</div>
   {active&&<ReportSection key={'drivers-'+query+'-'+siteKey+'-'+logBook+'-'+active+'-'+listSeverity} title={site.site+' · '+active+(listLabel?' · '+listLabel+' only':'')+' · drivers'} category="manpower-ot-drivers" description={description+' · '+(logBook||'VLB, ELB and LMV')+' · One row per driver'} rows={driverRows} columns={driverColumns} rowKey={r=>r.id} emptyMessage="No flagged driver in this selection."/>}
   <ReportSection key={'ot-'+query+'-'+siteKey+'-'+logBook+'-'+active+'-'+listSeverity} title={'OT & Multiple Duties · '+site.site+(logBook?' · '+logBook:'')+(active?' · '+active:'')+(listLabel?' · '+listLabel+' only':'')} category="manpower-ot" description={description+' · Scheduled times in IST; HMR performance hours, not payable OT'} rows={dutyRows} columns={otColumns} rowKey={r=>r.id} rowClassName={r=>'mp-ot-'+r.severity} emptyMessage="No matching multiple-duty pattern in the saved records."/>
  </>:<p className="mp-notice">Select a site above to see its drivers, their categories and the duty details.</p>}
 </>;
}

// Shift Attendance Equipment Wise: every site by shift, then one site and shift by equipment, then its drivers.
// Plain render function: its state lives in ManpowerReports.
function attendanceOverview({report,filters,query,ReportSection,pick,setPick}){
 const rows=report.attendanceEquipment||[],sites=report.attendanceSites||[];
 const shifts=filters.shift?[filters.shift]:[...new Set(['S1','S2','S3',...rows.map(r=>r.shift)])].sort();
 const within=(site,code)=>rows.filter(r=>(site===EVERY||r.siteKey===site)&&(!code||r.shift===code));
 // An actual duty is one driver in one shift on one date; a second machine in the same shift is not another one.
 const actual=list=>list.filter(r=>r.actual).length;
 // A report holding one site opens that site by itself.
 const siteKey=sites.length===1?sites[0].siteKey:pick.siteKey===EVERY||sites.some(s=>s.siteKey===pick.siteKey)?pick.siteKey:'';
 const shift=siteKey&&shifts.includes(pick.shift)?pick.shift:'',chosen=siteKey?within(siteKey,shift):[];
 const equipment=(()=>{const out=new Map();for(const r of chosen){const e=out.get(r.equipment)||{equipment:r.equipment,duties:0,actual:0,red:0,orange:0,review:0,zero:0};e.duties++;if(r.actual)e.actual++;if(dutyFlags.some(([id])=>id===r.flag))e[r.flag]++;out.set(r.equipment,e);}return [...out.values()].sort((a,b)=>b.duties-a.duties||a.equipment.localeCompare(b.equipment));})();
 const open=pick.equipment===EVERY||equipment.some(e=>e.equipment===pick.equipment)?pick.equipment:'',flag=open?pick.flag:'';
 const listed=open?chosen.filter(r=>(open===EVERY||r.equipment===open)&&(!flag||r.flag===flag)):[];
 const days=filters.from!==filters.to,dateLabel=days?shortDate(filters.from)+' to '+shortDate(filters.to):shortDate(filters.from);
 const heading=[siteKey===EVERY?'All sites':sites.find(s=>s.siteKey===siteKey)?.site||'',shift?shiftName(shift):'All shifts',dateLabel].join(' · ');
 const openLabel=open===EVERY?'All equipment':open,flagName=dutyFlags.find(([id])=>id===flag)?.[1]||'';
 const choose=(site,code)=>setPick(siteKey===site&&shift===code?noPick:{...noPick,siteKey:site,shift:code});
 const list=(name,colour='')=>setPick(open===name&&flag===colour?{...noPick,siteKey,shift}:{siteKey,shift,equipment:name,flag:colour});
 const count=(site,code,label)=>{const n=actual(within(site,code));return n?<button type="button" className="mp-att-count" aria-pressed={siteKey===site&&shift===code} aria-label={dutyCount(n,'actual')+' · '+label} onClick={()=>choose(site,code)}>{n}</button>:<span className="mp-zero">0</span>;};
 const line=(name,label,e,total)=><tr key={name} className={[total&&'mp-att-total',open===name&&'mp-on'].filter(Boolean).join(' ')||undefined}>
  <td><button type="button" className="mp-cat-open" aria-pressed={open===name&&!flag} onClick={()=>list(name)}>{label}</button></td>
  <td><button type="button" className="mp-cat-count" aria-pressed={open===name&&!flag} aria-label={dutyCount(e.duties,'equipment-wise')+' · '+label} onClick={()=>list(name)}>{e.duties}</button></td>
  <td>{e.actual}</td>
  {dutyFlags.map(([id,colour])=><td key={id}>{e[id]?<button type="button" className={'mp-cat-count mp-flag-'+id} aria-pressed={open===name&&flag===id} aria-label={e[id]+' '+colour+' · '+label} onClick={()=>list(name,id)}>{e[id]}</button>:0}</td>)}
 </tr>;
 const totals={duties:chosen.length,actual:actual(chosen),...Object.fromEntries(dutyFlags.map(([id])=>[id,chosen.filter(r=>r.flag===id).length]))},second=totals.duties-totals.actual;
 return <>
  <p className="mp-notice">{dutyCount(actual(rows),'actual')} · {dutyCount(rows.length,'equipment-wise')}. An actual duty is one driver in one shift on one date. A driver on two equipment types in one shift is counted on both machines and once in actual duties.</p>
  <div className="mp-category mp-att" role="group" aria-label="Actual duties by site and shift">
   <h2>All sites, shift-wise · {dateLabel} · actual duties</h2>
   {sites.length?<>
    <p className="mp-category-hint">Press a number to see that site and shift by equipment.</p>
    <table><thead><tr><th scope="col">Site</th>{shifts.map(code=><th key={code} scope="col">{shiftName(code)}</th>)}<th scope="col">All shifts</th></tr></thead>
     <tbody>{sites.map(s=><tr key={s.siteKey} className={siteKey===s.siteKey?'mp-on':undefined}><th scope="row">{s.site}</th>{shifts.map(code=><td key={code}>{count(s.siteKey,code,s.site+' · '+shiftName(code))}</td>)}<td>{count(s.siteKey,'',s.site+' · All shifts')}</td></tr>)}
     {sites.length>1&&<tr className={'mp-att-total'+(siteKey===EVERY?' mp-on':'')}><th scope="row">All sites</th>{shifts.map(code=><td key={code}>{count(EVERY,code,'All sites · '+shiftName(code))}</td>)}<td>{count(EVERY,'','All sites · All shifts')}</td></tr>}</tbody>
    </table>
   </>:<p>No site is available for these selections.</p>}
  </div>
  {siteKey?<>
   <div className="mp-category mp-att">
    <h2>{heading} · duties by equipment</h2>
    {equipment.length?<>
     <p className="mp-category-hint">{open?<>Showing <strong>{openLabel}{flagName?' · '+flagName+' only':''}</strong> below. <button type="button" onClick={()=>setPick({...noPick,siteKey,shift})}>Close the driver list</button></>:'Press an equipment or a number to list its drivers below.'}</p>
     <table><thead><tr><th scope="col">Equipment</th><th scope="col">Equipment-wise duties</th><th scope="col">Actual duties</th>{dutyFlags.map(([id,colour,meaning])=><th key={id} scope="col" title={meaning}>{colour}</th>)}</tr></thead>
      <tbody>{equipment.map(e=>line(e.equipment,e.equipment,e,false))}{line(EVERY,'All equipment',totals,true)}</tbody>
     </table>
     {second>0&&<p className="mp-att-foot">{second} {second===1?'duty here is':'duties here are'} a second machine for the driver: counted on each machine, once in actual duties.</p>}
    </>:<p>No duty in this selection.</p>}
   </div>
   {open&&<>
    <div className="mp-legend" aria-label="Row colours"><span className="mp-flag mp-flag-normal">White · Normal duty</span>{dutyFlags.map(([id,colour,meaning])=><span key={id} className={'mp-flag mp-flag-'+id}>{colour} · {meaning}</span>)}</div>
    <ReportSection key={'attendance-'+query+'-'+siteKey+'-'+shift+'-'+open+'-'+flag} title={'Shift Attendance Equipment Wise · '+heading+' · '+openLabel+(flagName?' · '+flagName+' only':'')} category="shift-attendance" description={dutyCount(listed.length,'equipment-wise')+' · '+dutyCount(actual(listed),'actual')+' · Saved records only'} rows={listed} columns={attendanceColumns({days,sites:siteKey===EVERY,shifts:!shift,equipment:open===EVERY})} rowKey={r=>r.id} rowClassName={r=>'mp-duty-'+r.flag} emptyMessage="No duty matches this selection."/>
   </>}
  </>:<p className="mp-notice">Press a number above to see the duties by equipment, then the drivers.</p>}
 </>;
}

export default function ManpowerReports({session,reportId='manpower',onSelect,ReportSection}){
 const [filters,setFilters]=useState(()=>{const date=today();return {from:date,to:date,site:'',shift:'',batch:'',employee:'',asset:''};});
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[options,setOptions]=useState({});
 const [autoHide,setAutoHide]=useState(()=>remembered('caliberReportFiltersAutoHide')),[filtersOpen,setFiltersOpen]=useState(false),filterBox=useRef(null);
 const [severity,setSeverity]=useState(''),[history,setHistory]=useState({key:'',data:null,error:''}),[logBook,setLogBook]=useState(''),[drill,setDrill]=useState(noDrill),[pick,setPick]=useState(noPick);
 // The OT view always loads every assigned site; the Site selection there opens one site.
 const query=useMemo(()=>new URLSearchParams(reportId==='ot'?{...filters,site:''}:filters).toString(),[filters,reportId]);
 const valid=filters.from>=OPERATIONAL_START&&filters.to>=filters.from&&Date.parse(filters.to)-Date.parse(filters.from)<=30*86400000;
 useEffect(()=>{
  const controller=new AbortController();setError('');setData(null);if(!valid){setBusy(false);return ()=>controller.abort();}setBusy(true);
  fetch('/api/reports/manpower?'+query,{headers:{Authorization:`Bearer ${session.token}`},signal:controller.signal}).then(async response=>{const payload=await response.json();if(!response.ok)throw Error(payload.error||'Unable to load saved manpower records.');return payload;}).then(payload=>{if(!controller.signal.aborted){setData({query,payload});setOptions(payload.options);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[query,session.token,refresh,valid]);
 // Earlier repeats are fetched only while a colour is open on the OT view.
 const historyKey=filters.from+'|'+filters.to+'|'+canonicalSiteName(filters.site),wanted=reportId==='ot'&&Boolean(severity);
 useEffect(()=>{
  if(!wanted)return;
  const controller=new AbortController();setHistory({key:'',data:null,error:''});
  fetch('/api/reports/manpower/ot-history?'+new URLSearchParams({from:filters.from,to:filters.to,site:filters.site}),{headers:{Authorization:'Bearer '+session.token},signal:controller.signal})
   .then(async response=>{const payload=await response.json();if(!response.ok)throw Error(payload.error||'Unable to load earlier duties.');return payload;})
   .then(data=>{if(!controller.signal.aborted)setHistory({key:historyKey,data,error:''});})
   .catch(e=>{if(!controller.signal.aborted)setHistory({key:historyKey,data:null,error:e.message});});
  return()=>controller.abort();
 },[wanted,historyKey,session.token]);
 const ready=data?.query===query&&valid&&!busy&&!error,report=ready?data.payload:null;
 const set=(field,value)=>setFilters(current=>({...current,[field]:value,...(field==='site'?{batch:'',asset:''}:{})}));
 const title=views.find(([id])=>id===reportId)?.[1]||views[0][1];
 const choice=(field,label,items)=><label>{label}<select value={filters[field]} onChange={e=>{set(field,e.target.value);if(autoHide)e.target.blur();}}><option value="">All</option>{(items||[]).map(item=>{const value=typeof item==='string'?item:item.value;return <option key={value} value={value}>{typeof item==='string'?item:item.label}</option>;})}</select></label>;
 const description=`${filters.from} to ${filters.to} · ${filters.site||'All assigned sites'} · ${filters.shift||'All shifts'} · Saved records only`;
 const showFilters=!autoHide||filtersOpen,chosen=['batch','employee','asset'].filter(field=>filters[field]).length;
 const leaveFilters=()=>{if(!filterBox.current?.contains(document.activeElement))setFiltersOpen(false);};
 // LMV cards are part of the OT view only, so their review items stay off the other views.
 const siteKey=canonicalSiteName(filters.site),exceptions=!report?undefined:reportId!=='ot'?report.exceptions.filter(e=>e.logBook!=='LMV'):siteKey?report.exceptions.filter(e=>e.siteKey===siteKey):report.exceptions;
 return <section className="mp-reports" aria-label="Manpower and OT reports">
  <header className="mp-heading"><div><small>REPORTS / MANPOWER & OT</small><h1>{title}</h1><p>Saved duties, clear assignments and shift-by-shift performance.</p></div><button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh reports</button></header>
  <nav className="mp-tabs" aria-label="Manpower report views">{views.map(([id,label])=><button key={id} type="button" aria-current={reportId===id?'page':undefined} onClick={()=>onSelect(id)}>{label}</button>)}</nav>
  <TabSelectionDialog title={title} openKey={reportId} onSubmit={()=>Boolean(valid)}>
   <form><div className="mp-filters"><label>From<input type="date" min={OPERATIONAL_START} value={filters.from} onChange={e=>set('from',e.target.value)}/></label><label>To<input type="date" min={OPERATIONAL_START} value={filters.to} onChange={e=>set('to',e.target.value)}/></label>{choice('site','Site',options.sites)}{choice('shift','Shift',options.shifts)}{choice('batch','Saved batch',options.batches)}{choice('employee','Employee',options.employees)}{choice('asset','Door / equipment',options.assets)}<button type="button" onClick={()=>{const date=today();setFilters(f=>({...f,from:date,to:date}));}}>Today</button><button type="button" onClick={()=>setFilters(f=>({...f,site:'',shift:'',batch:'',employee:'',asset:''}))}>Clear selections</button></div><button type="submit" disabled={!valid}>Show report</button></form>
   {!valid&&<p role="alert">Choose a valid range of up to 31 days, starting on or after 1 November 2026.</p>}
  </TabSelectionDialog>
  <div ref={filterBox} className="mp-filter-box" onMouseEnter={autoHide?()=>setFiltersOpen(true):undefined} onMouseLeave={autoHide?leaveFilters:undefined} onBlur={autoHide?e=>{if(!e.currentTarget.contains(e.relatedTarget)&&!e.currentTarget.matches(':hover'))setFiltersOpen(false);}:undefined}>
   <div className="mp-filter-bar"><button type="button" className="mp-filter-current" aria-expanded={showFilters} disabled={!autoHide} onClick={()=>setFiltersOpen(open=>!open)}><strong>{filters.from} to {filters.to}</strong><span>{filters.site||'All assigned sites'} · {filters.shift||'All shifts'}{chosen?' · '+chosen+' more selection'+(chosen>1?'s':''):''}</span></button><label className="mp-autohide"><input type="checkbox" checked={autoHide} onChange={e=>{setAutoHide(e.target.checked);setFiltersOpen(false);remember('caliberReportFiltersAutoHide',e.target.checked);}}/>Auto-hide filters</label></div>
   {showFilters&&<div className="mp-filters"><label>From<input type="date" min={OPERATIONAL_START} value={filters.from} onChange={e=>set('from',e.target.value)}/></label><label>To<input type="date" min={OPERATIONAL_START} value={filters.to} onChange={e=>set('to',e.target.value)}/></label>{choice('site','Site',options.sites)}{choice('shift','Shift',options.shifts)}{choice('batch','Saved batch',options.batches)}{choice('employee','Employee',options.employees)}{choice('asset','Door / equipment',options.assets)}<button type="button" onClick={()=>{const date=today();setFilters(f=>({...f,from:date,to:date}));}}>Today</button><button type="button" onClick={()=>setFilters(f=>({...f,site:'',shift:'',batch:'',employee:'',asset:''}))}>Clear selections</button></div>}
  </div>
  {!valid&&<p role="alert">Choose a valid range of up to 31 days, starting on or after 1 November 2026.</p>}{busy&&<p role="status">Loading saved records and checking shift patterns…</p>}{error&&<p role="alert">{error}</p>}
  {report&&<>
   <p className="mp-source">{description} · Updated {new Date(report.generatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST</p>
   {reportId!=='attendance'&&reportId!=='ot'&&<div className="mp-metrics">{[['assets','Distinct assets'],['employees','Distinct employees'],['duties','Employee shift duties'],['exceptions','Review items']].map(([key,label])=><div key={key}><strong>{report.totals[key]}</strong><span>{label}</span></div>)}</div>}
   {reportId==='attendance'?<>
    {attendanceOverview({report,filters,query,ReportSection,pick,setPick})}
   </>:reportId==='ot'?<>
    {otOverview({report,filters,query,selectSite:site=>set('site',site),description,ReportSection,severity,setSeverity,logBook,setLogBook,drill,setDrill,history,historyKey})}
   </>:reportId==='employee'?<>
    <p className="mp-notice">One row per employee, site, date and shift. Changing vehicles within a shift remains one duty. Vehicle and batch selections show the complete matching duty.</p>
    <ReportSection key={'performance-'+query} title="Shift Performance" category="manpower-performance" description={description+' · Each shift is separate; HMR is machine performance'} rows={report.performance} columns={performanceColumns} rowKey={r=>r.id} emptyMessage="No saved duties with a resolved employee identity match these selections."/>
   </>:<>
    <ReportSection key={'summary-'+query} title="Manpower by Category, Make & Model" category="manpower-summary" description={description+' · Distinct assets and employees within each category'} rows={report.summary} columns={summaryColumns} emptyMessage="No saved asset assignments in this selection. An empty batch has no manpower count."/>
    <ReportSection key={'details-'+query} title="Vehicle & Employee Assignments" category="manpower-assignments" description={description} rows={report.details} columns={detailColumns} rowKey={r=>r.id} emptyMessage="No saved assignments match these selections."/>
   </>}
   <ReportSection key={'exceptions-'+query} title="Manpower Data Review" category="manpower-review" description="Unresolved IDs, duplicate candidates, meter conflicts and missing master data remain visible for correction." rows={exceptions} columns={exceptionColumns} rowKey={r=>r.id} emptyMessage="No data-review items for these selections."/>
   <details className="mp-notes"><summary>Sources and calculation rules</summary><ul>{report.notes.map(note=><li key={note}>{note}</li>)}</ul><p>Manpower requirements, shortages and relief availability are reserved for a later phase.</p></details>
  </>}
 </section>;
}

