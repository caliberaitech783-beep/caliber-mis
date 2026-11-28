// VTC Master and OD Master (owner, 28 Nov 2026): Masters, after Attendance approval. One page for each, drawn in the
// owner's report steps: Step 1 one line per site for the month, Step 2 the people of the site, Step 3 the person's days
// in the month with the record's details, Change and Remove. "Add VTC" / "Add OD" saves one record for every ticked
// driver or operator; every day of it that has arrived is present in attendance (purple P for VTC, teal OD).
// Rule: shared/attendance-masters.mjs; routes server/routes/attendance-masters.mjs.
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {MASTER_KINDS,VTC_COURSES,VTC_STATUSES,OD_TYPES,OD_DAY_PARTS,MASTER_MAX_PEOPLE,monthRange,daysBetween} from '../shared/attendance-masters.mjs';
import VtcTrainingPeople from './vtc-training-people.jsx';
import './caliber-recheck.css';
import './attendance-masters.css';

const count=value=>Number(value||0).toLocaleString('en-IN');
const shortDate=date=>date?date.slice(8,10)+'-'+date.slice(5,7)+'-'+date.slice(2,4):'';
const monthName=month=>{const range=monthRange(month);return range?new Date(range.from+'T00:00:00Z').toLocaleDateString('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}):month;};
const EVERY='*';
const blankVtc={course:'',courseOther:'',institute:'',trainer:'',certificate:'',status:'Ongoing',remarks:''};
const blankOd={odType:'',typeOther:'',dayPart:'Full day',place:'',sentBy:'',reason:''};
const courseOf=r=>r.details.course==='Other'?r.details.courseOther:r.details.course;
const typeOf=r=>r.details.odType==='Other'?r.details.typeOther:r.details.odType;

function DetailFields({kind,value,onChange}){
 const set=key=>event=>onChange({...value,[key]:event.target.value});
 const select=(key,list,label)=><label>{label}<select required value={value[key]} onChange={set(key)}><option value="">Choose…</option>{list.map(x=><option key={x}>{x}</option>)}</select></label>;
 const input=(key,label,props={})=><label>{label}<input value={value[key]} onChange={set(key)} {...props}/></label>;
 return kind==='vtc'?<>
  {select('course',VTC_COURSES,'VTC course')}
  {value.course==='Other'&&input('courseOther','Course name',{required:true,maxLength:200})}
  {input('institute','Institute / place',{required:true,maxLength:200,placeholder:'WCL VTC Majri'})}
  {input('trainer','Trainer',{maxLength:200})}
  {input('certificate','Certificate no.',{maxLength:100,placeholder:'After completion'})}
  <label>Status<select value={value.status} onChange={set('status')}>{VTC_STATUSES.map(x=><option key={x}>{x}</option>)}</select></label>
  {input('remarks','Remarks',{maxLength:1000})}
 </>:<>
  {select('odType',OD_TYPES,'OD type')}
  {value.odType==='Other'&&input('typeOther','OD for',{required:true,maxLength:200})}
  <label>Full or half day<select value={value.dayPart} onChange={set('dayPart')}>{OD_DAY_PARTS.map(x=><option key={x}>{x}</option>)}</select></label>
  {input('place','Place',{required:true,maxLength:200,placeholder:'Nagpur HO'})}
  {input('sentBy','Sent by (in-charge)',{maxLength:200})}
  {input('reason','Reason',{required:true,maxLength:1000,placeholder:'Why the person is on duty away'})}
 </>;
}

export default function AttendanceMasters({session,ReportSection,kind='vtc'}){
 const info=MASTER_KINDS[kind];
 const headers=useMemo(()=>({Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'}),[session.token]);
 const [month,setMonth]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7));
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [open,setOpen]=useState({site:'',record:''});
 const [adding,setAdding]=useState(false),[notice,setNotice]=useState('');
 const run=useRef(0);
 const load=async()=>{
  const mine=++run.current;setBusy(true);setError('');
  try{
   const response=await fetch(`/api/attendance-masters?kind=${kind}&month=${month}`,{headers});
   const answer=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(answer.error||`The ${info.title} is unavailable.`);
   if(run.current===mine)setData(answer);
  }catch(e){if(run.current===mine)setError(e.message);}
  finally{if(run.current===mine)setBusy(false);}
 };
 useEffect(()=>{void load();return()=>{run.current++};},[kind,month]);

 const records=data?.records||[],sites=data?.sites||[],total=data?.total;
 const {site}=open,siteLabel=site===EVERY?'All sites':sites.find(row=>row.key===site)?.site||'';
 const listed=site?records.filter(r=>site===EVERY||r.siteKey===site):[];
 const chosen=records.find(r=>r.id===open.record);
 const siteColumns=[{key:'site',label:'Site',value:r=>r.site},{key:'people',label:'People',value:r=>r.people},{key:'drivers',label:'Drivers',value:r=>r.drivers},{key:'operators',label:'Operators',value:r=>r.operators},
  ...(kind==='vtc'?[{key:'ongoing',label:'Ongoing / planned',value:r=>r.ongoing},{key:'completed',label:'Completed / left',value:r=>r.completed}]
   :[{key:'entries',label:'OD entries',value:r=>r.entries},{key:'half',label:'Half days',value:r=>r.half}]),
  {key:'present',label:`${info.short} present days`,value:r=>r.present},{key:'coming',label:'Days still to come',value:r=>r.coming}];
 const recordColumns=[...(site===EVERY?[{key:'site',label:'Site',value:r=>r.site}]:[]),
  {key:'caliberCode',label:'Caliber ID',value:r=>r.caliberCode},{key:'name',label:'Name',value:r=>r.name},{key:'role',label:'Driver / operator',value:r=>r.role},
  ...(kind==='vtc'?[{key:'course',label:'Course',value:courseOf},{key:'institute',label:'Institute / place',value:r=>r.details.institute}]
   :[{key:'type',label:'OD type',value:typeOf},{key:'place',label:'Place',value:r=>r.details.place},{key:'dayPart',label:'Day',value:r=>r.details.dayPart}]),
  {key:'from',label:'From',value:r=>shortDate(r.from)},{key:'to',label:'To',value:r=>shortDate(r.to)},
  {key:'status',label:'Status',value:r=>r.status,render:r=><span className={'am-status am-'+kind}>{r.status}</span>},
  {key:'present',label:'Present days this month',value:r=>r.month.present}];

 return <section className="caliber-recheck attendance-masters">
  <header className="cr-head">
   <div><h1>{info.title}</h1>
    <p>{kind==='vtc'
     ?'Every driver and operator who has done VTC or is doing it in the month. Each VTC day that has arrived is present in the attendance muster as VTC Training (purple P), and goes to HR Pulse with the attendance. A course still running may end after today: each later day turns present on its own date.'
     :'Every driver and operator sent away on duty (OD) in the month: office or HO work, medical exam, court, a statutory exam, work at another site. Each OD day that has arrived is present in the attendance muster as OD (teal), and goes to HR Pulse with the attendance.'}
     {' '}A day on which the person also has a VLB, ELB or LMV card counts once, as that duty.</p></div>
   <div className="am-head-tools">
    <label>Month<input type="month" value={month} min="2026-11" onChange={e=>e.target.value&&setMonth(e.target.value)}/></label>
    <button type="button" onClick={()=>{setAdding(!adding);setNotice('');}}>{adding?'Close':'Add '+info.short}</button>
    <button type="button" disabled={busy} onClick={()=>void load()}>{busy?'Reading…':'Refresh'}</button>
   </div>
  </header>
  {error&&<p className="cr-error" role="alert">{error}</p>}
  {notice&&<p className="am-notice" role="status">{notice}</p>}
  {adding&&<AddForm kind={kind} headers={headers} siteOptions={data?.siteOptions||[]} onSaved={answer=>{setNotice(`${info.short} saved for ${answer.saved} ${answer.saved===1?'person':'people'}: ${answer.presentDays} present day${answer.presentDays===1?'':'s'} written to attendance so far.`);setAdding(false);void load();}}/>}
  {total&&<div className="cr-summary" aria-label="Summary">
   <span><strong>{count(total.people)}</strong> people on {info.short} in {monthName(month)}</span><span><strong>{count(total.drivers)}</strong> drivers</span><span><strong>{count(total.operators)}</strong> operators</span>
   <span><strong>{count(total.present)}</strong> present days so far</span><span><strong>{count(total.coming)}</strong> days still to come</span>
  </div>}
  <ReportSection key={'am-sites-'+kind} reportKey={info.title+' sites'} title={`Step 1 · ${info.title} · ${monthName(month)}`} category={'attendance-master-'+kind} dataReady={!busy} recordDateFilter={false}
   description={`One line per site: the people on ${info.short} in the month. Press a line for its people; the All sites line opens every site together.`}
   rows={sites.length&&total?[...sites,total]:[]} columns={siteColumns} rowKey={row=>row.key} rowClassName={row=>(row.total?'tt-total':'')+(site&&row.key===site?' report-row-picked':'')} isTotalRow={row=>Boolean(row.total)}
   onRowClick={row=>setOpen({site:row.key,record:''})} emptyMessage={busy?'Reading…':`No one on ${info.short} in ${monthName(month)} at your sites. Press Add ${info.short} to enter one.`}/>
  {site&&<ReportSection key={'am-people-'+kind+site} reportKey={info.title+' people'} title={`Step 2 · ${info.title} · ${siteLabel}`} category={'attendance-master-people-'+kind} dataReady={!busy} recordDateFilter={false}
   description="One line per person and entry. Press a line for the days of the month, to change or remove it."
   rows={listed} columns={recordColumns} rowKey={r=>r.id} rowClassName={r=>r.id===open.record?'report-row-picked':''} onRowClick={r=>setOpen({site,record:r.id})} emptyMessage="No one here."/>}
  {chosen&&<RecordDays key={chosen.id} kind={kind} record={chosen} month={month} today={data.today} headers={headers} onChanged={message=>{setNotice(message);void load();}}/>}
 </section>;
}

function AddForm({kind,headers,siteOptions,onSaved}){
 const info=MASTER_KINDS[kind];
 const [site,setSite]=useState(siteOptions.length===1?siteOptions[0]:'');
 const [people,setPeople]=useState([]),[chosen,setChosen]=useState([]),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [details,setDetails]=useState(kind==='vtc'?blankVtc:blankOd),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  setPeople([]);setChosen([]);if(!site)return;let live=true;
  fetch('/api/attendance-masters/people?site='+encodeURIComponent(site),{headers}).then(r=>r.json().then(a=>({ok:r.ok,a}))).then(({ok,a})=>{
   if(!live)return;if(!ok)return setError(a.error||'The people of the site could not be read.');
   setPeople((a.people||[]).map(p=>({...p,caliberId:p.caliberCode,name:p.name+' · '+p.role})));
  }).catch(()=>live&&setError('The people of the site could not be read.'));
  return()=>{live=false};
 },[site]);
 const submit=async event=>{
  event.preventDefault();setError('');
  if(!chosen.length)return setError('Tick at least one driver or operator.');
  setBusy(true);
  try{
   const response=await fetch('/api/attendance-masters',{method:'POST',headers,body:JSON.stringify({kind,site,employeeIds:chosen,fromDate:from,toDate:to,...details})});
   const answer=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(answer.error||'Not saved.');
   onSaved(answer);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 return <form className="am-form" onSubmit={submit}>
  <h2>Add {info.short}</h2>
  <div className="am-grid">
   <label>Site<select required value={site} onChange={e=>setSite(e.target.value)}><option value="">Choose…</option>{siteOptions.map(s=><option key={s}>{s}</option>)}</select></label>
   <label>From date<input type="date" required min="2026-11-01" value={from} onChange={e=>{setFrom(e.target.value);if(!to||to<e.target.value)setTo(e.target.value);}}/></label>
   <label>To date{kind==='vtc'?' (may be after today)':''}<input type="date" required min={from||'2026-11-01'} value={to} onChange={e=>setTo(e.target.value)}/></label>
   <DetailFields kind={kind} value={details} onChange={setDetails}/>
  </div>
  {site&&<VtcTrainingPeople label="Drivers and operators" people={people} chosen={chosen} onChange={setChosen}/>}
  <p className="am-note">Every ticked person (up to {MASTER_MAX_PEOPLE}) is present on every day from From to To as {kind==='vtc'?'VTC Training (purple P)':'OD (teal)'}; days after today turn present on their own date.</p>
  {error&&<p className="cr-error" role="alert">{error}</p>}
  <button type="submit" disabled={busy}>{busy?'Saving…':'Save '+info.short}</button>
 </form>;
}

function RecordDays({kind,record,month,today,headers,onChanged}){
 const info=MASTER_KINDS[kind],range=monthRange(month);
 const [editing,setEditing]=useState(false),[removing,setRemoving]=useState(false);
 const [from,setFrom]=useState(record.from),[to,setTo]=useState(record.to),[details,setDetails]=useState({...(kind==='vtc'?blankVtc:blankOd),...record.details});
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 // Step 3 opens below the screen: bring its title into view, as ReportSection does for its steps.
 const box=useRef(null);
 useEffect(()=>{box.current?.scrollIntoView?.({behavior:'smooth',block:'start'});},[]);
 const days=range?daysBetween(range.from,range.to):[];
 const mark=day=>day<record.from||day>record.to?'':day>today?'coming':'present';
 const send=async(method,body)=>{
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/attendance-masters/'+record.id,{method,headers,body:JSON.stringify(body)});
   const answer=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(answer.error||'Not saved.');
   onChanged(method==='DELETE'?`${info.short} of ${record.name} removed; its days left attendance.`:`${info.short} of ${record.name} changed.`);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 return <div ref={box} className="am-days report-step">
  <h2>{`Step 3 · ${record.caliberCode} ${record.name} · ${monthName(month)}`}</h2>
  <p className="am-note">{kind==='vtc'?`${courseOf(record)} at ${record.details.institute}`:`${typeOf(record)} at ${record.details.place} · ${record.details.dayPart}`} · {shortDate(record.from)} to {shortDate(record.to)} · {record.status}
   {' '}· entered by {record.createdBy}{record.updatedBy?`, changed by ${record.updatedBy}`:''}.</p>
  <div className="am-legend"><span className={'am-cell am-'+kind}>{info.mark}</span> present ({info.title.replace(' Master','')}) <span className="am-cell am-coming">·</span> still to come</div>
  <div className="am-grid-days" role="table" aria-label="Days of the month">
   {days.map(day=>{const m=mark(day);return <div key={day} role="cell" className="am-day"><small>{day.slice(8)}</small>
    <span className={'am-cell'+(m==='present'?' am-'+kind:m==='coming'?' am-coming':'')}>{m==='present'?info.mark:m==='coming'?'·':''}</span></div>;})}
  </div>
  <p className="am-note">{record.month.present} day{record.month.present===1?'':'s'} present this month so far{record.month.coming?`, ${record.month.coming} still to come`:''}. The attendance muster shows the same days; a day with a trip card shows that duty instead.</p>
  {!editing&&!removing&&<div className="am-actions"><button type="button" onClick={()=>setEditing(true)}>Change</button><button type="button" onClick={()=>setRemoving(true)}>Remove</button></div>}
  {editing&&<form className="am-form" onSubmit={e=>{e.preventDefault();void send('PUT',{fromDate:from,toDate:to,...details});}}>
   <div className="am-grid">
    <label>From date<input type="date" required min="2026-11-01" value={from} onChange={e=>setFrom(e.target.value)}/></label>
    <label>To date<input type="date" required min={from} value={to} onChange={e=>setTo(e.target.value)}/></label>
    <DetailFields kind={kind} value={details} onChange={setDetails}/>
   </div>
   <div className="am-actions"><button type="submit" disabled={busy}>{busy?'Saving…':'Save change'}</button><button type="button" onClick={()=>setEditing(false)}>Cancel</button></div>
  </form>}
  {removing&&<form className="am-form" onSubmit={e=>{e.preventDefault();void send('DELETE',{reason});}}>
   <label>Why is this entry removed?<input required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <p className="am-note">Its days leave attendance. A day the Directors have locked cannot change until RHR unlocks it.</p>
   <div className="am-actions"><button type="submit" disabled={busy}>{busy?'Removing…':'Remove '+info.short}</button><button type="button" onClick={()=>setRemoving(false)}>Cancel</button></div>
  </form>}
  {error&&<p className="cr-error" role="alert">{error}</p>}
 </div>;
}
