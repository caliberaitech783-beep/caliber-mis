import ManualLogBookDetails from './manual-log-book-details.jsx';
import {blankJob,blankBreakdown,padManualRows} from '../manual-log-book-details.mjs';
import {shiftMeterIssues} from '../trip-card-rules.mjs';
import BreakdownHoursField from './breakdown-hours-field.jsx';
import {employeeAtLocation} from '../log-book-access.mjs';
import {blankTrip,nextTripEntry} from '../trip-entry.mjs';
import SmartSelect from './smart-select.jsx';
import DoorCombobox from './door-combobox.jsx';
import {missingAssetMessage} from './log-book-asset-options.mjs';
import {matchingWorkOrders,machineSummary,machineTripTotal,CARD_SHIFTS,machineLabel,latestWorkOrder,interTripGap} from '../trip-card-rules.mjs';
import EmployeeIdLookup from './employee-id-lookup.jsx';
import ManualBookDate from './manual-book-date.jsx';
import {continueManualRemark,advanceLogBookField,focusNextLogBookField,isEmptyTripPlaceholder} from './log-book-enter-navigation.mjs';
import React,{useEffect,useState,useRef} from 'react';

import {Plus,Save,Trash2,RotateCcw,BookOpen,Search,ChevronsLeft,ChevronsRight,Pencil,Printer,X,LogOut,Info,ListFilter} from 'lucide-react';

import {canonicalSiteName} from '../site-location.mjs';

import './log-book-form.css';



const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

const fresh=()=>({bookDate:today(),bookDateSource:'system',location:'',assetId:'',workOrderId:'',employeeId:'',shiftId:'',shiftHours:8,openingKmr:'',closingKmr:'',openingHmr:'',closingHmr:'',aFormNo:'',remark:'',timeMode:'with',trips:Array.from({length:5},blankTrip),jobDetails:Array.from({length:2},blankJob),breakdownDetails:Array.from({length:2},blankBreakdown),manualAttributes:[],manualAttachments:[],openingEngineHmr:'',closingEngineHmr:'',requestKey:crypto.randomUUID()});

const delta=(opening,closing)=>opening!==''&&closing!==''&&Number(closing)>=Number(opening)?Math.round((Number(closing)-Number(opening))*1000)/1000:null;

const fixed=value=>value==null?'—':Number(value).toFixed(2);
const display=value=>value===null||value===undefined?'—':Number(value).toLocaleString('en-IN',{maximumFractionDigits:3});

const gap=(start,end)=>{if(!/^\d{2}:\d{2}(?::\d{2})?$/.test(start)||!/^\d{2}:\d{2}(?::\d{2})?$/.test(end))return null;const seconds=t=>t.split(':').reduce((sum,v,i)=>sum+Number(v)*[3600,60,1][i],0);return Math.round(((seconds(end)-seconds(start)+86400)%86400)/60*1000)/1000;};

function Field({label,children,hint,wide=false,skipEnter=false,enterOrder,issue}){return <label data-enter-order={enterOrder} data-enter-skip={skipEnter||undefined} className={`logbook-field${wide?' wide':''}${issue?' logbook-meter-invalid':''}`}><span>{label}</span>{issue?React.Children.map(children,child=>React.isValidElement(child)?React.cloneElement(child,{'aria-invalid':true}):child):children}{hint&&<small>{hint}</small>}{issue&&<small role="alert">{issue}</small>}</label>}



export default function LogBookForm({kind,session,onExit,onBulkScan}){

 const vehicle=kind==='vehicle',title=vehicle?'Vehicle Log Book':'Equipment Log Book';

 const [form,setForm]=useState(fresh),[saved,setSaved]=useState(null),[options,setOptions]=useState(null),[records,setRecords]=useState([]),[nextCursor,setNextCursor]=useState(null),[query,setQuery]=useState(''),[error,setError]=useState(''),[success,setSuccess]=useState(''),[working,setWorking]=useState(false),[loading,setLoading]=useState(true);

 const [hours,setHours]=useState(null),[hoursError,setHoursError]=useState(''),[hoursLoading,setHoursLoading]=useState(false);
 const [editing,setEditing]=useState(true),[showDelete,setShowDelete]=useState(false),[showStatus,setShowStatus]=useState(false);
 const initialLocationFocused=useRef(false);
 const [registerOpen,setRegisterOpen]=useState(false);

 useEffect(()=>{
   const saveShortcut=event=>{
     if(!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='s'||event.altKey)return;
     event.preventDefault();
     if(event.repeat||event.isComposing||!editing||working||loading||showDelete)return;
     document.getElementById('logbook-entry-form')?.requestSubmit();
   };
   window.addEventListener('keydown',saveShortcut);
   return()=>window.removeEventListener('keydown',saveShortcut);
 },[editing,working,loading,showDelete]);

 const api=async(url,config={})=>{const response=await fetch(url,{...config,headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json',...config.headers}});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Could not reach the log book service.');return body;};

 const loadRegister=async(before)=>{const data=await api(`/api/log-books/${kind}${before?'?before='+encodeURIComponent(before):''}`);setRecords(current=>before?[...current,...data.records]:data.records);setNextCursor(data.nextCursor);};

 const load=async()=>{setLoading(true);setError('');try{const [masters,list]=await Promise.all([api('/api/log-books/options'),api(`/api/log-books/${kind}`)]);setOptions(masters);setRecords(list.records);setNextCursor(list.nextCursor);}catch(e){setError(e.message)}finally{setLoading(false)}};

 useEffect(()=>{void load()},[kind,session.token]);

 useEffect(()=>{
   if(loading||!options||!editing||saved||initialLocationFocused.current)return;
   const frame=requestAnimationFrame(()=>{
     const location=document.getElementById('logbook-entry-form')?.querySelector('.logbook-fields .logbook-field input:not([type="hidden"]):not([readonly]), .logbook-fields .logbook-field select');
     if(location&&!location.matches(':disabled')){
       location.focus();
       initialLocationFocused.current=true;
     }
   });
   return()=>cancelAnimationFrame(frame);
 },[vehicle,loading,options,editing,saved]);

 const update=(key,value)=>{setForm(current=>({...current,[key]:value,...(key==='bookDate'?{bookDateSource:'manual'}:{}),...(['bookDate','assetId','location','shiftId','shiftHours'].includes(key)?{manualBreakdownHours:''}:{})}));setSuccess('');};

 const assetMessage=missingAssetMessage(options,kind,form.location);
 const reloadDoors=async()=>{setWorking(true);setError('');try{setOptions(await api('/api/log-books/options'));setSuccess('Equipment Master reloaded. Your entry has been kept.')}catch(e){setError(e.message)}finally{setWorking(false)}};

 const shifts=(options?.shifts||[]).filter(shift=>!form.location||!shift.site||canonicalSiteName(shift.site)===canonicalSiteName(form.location));

 const eligibleWorkOrders=matchingWorkOrders(options?.workOrders||[],form.location,form.bookDate);
 useEffect(()=>{if(!editing)return;setForm(current=>{const latest=latestWorkOrder(options?.workOrders||[],current.location,current.bookDate);const id=latest?latest.id:eligibleWorkOrders.some(r=>r.id===String(current.workOrderId))?current.workOrderId:'';return id===current.workOrderId?current:{...current,workOrderId:id};});},[form.location,form.bookDate,options,editing,vehicle]);
 const employee=options?.employees.find(row=>row.id===String(form.employeeId));

 const asset=options?.assets.find(row=>row.id===String(form.assetId));

 const meterIssues=shiftMeterIssues(form,kind);
 const kmr=delta(form.openingKmr,form.closingKmr),hmr=delta(form.openingHmr,form.closingHmr);

 useEffect(()=>{let stale=false;setHours(null);setHoursError('');if(!form.bookDate||!form.assetId||!form.shiftId||!form.location){setHoursLoading(false);return;}setHoursLoading(true);const timer=setTimeout(()=>{api('/api/log-books/hours',{method:'POST',body:JSON.stringify({bookDate:form.bookDate,assetId:form.assetId,shiftId:form.shiftId,location:form.location,shiftHours:form.shiftHours,runningHours:hmr})}).then(value=>{if(!stale)setHours(value)}).catch(e=>{if(!stale)setHoursError(e.message)}).finally(()=>{if(!stale)setHoursLoading(false)});},500);return ()=>{stale=true;clearTimeout(timer)};},[vehicle,form.bookDate,form.assetId,form.shiftId,form.location,form.shiftHours,hmr,session.token]);

 useEffect(()=>{if(saved)return;const location=options?.accountLocation||'';setForm(current=>current.location===location?current:{...current,location,assetId:'',employeeId:'',shiftId:'',workOrderId:'',manualBreakdownHours:''});},[vehicle,saved,options?.accountLocation]);


 const selectAsset=id=>{const row=options?.assets.find(asset=>asset.id===id);setForm(current=>({...current,assetId:id,manualBreakdownHours:'',...(!current.location&&row?.site?{location:row.site,shiftId:''}:{})}));setSuccess('');};

 const addTrip=()=>{const index=form.trips.length;if(index>=300)return;update('trips',[...form.trips,blankTrip()]);requestAnimationFrame(()=>document.getElementById('logbook-entry-form')?.querySelector('[data-trip-equipment="'+index+'"]')?.focus());};
 const continueTrip=(event,index)=>{if(event.key!=='Enter'||event.isComposing||event.nativeEvent?.isComposing||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey)return;event.preventDefault();if(event.repeat)return;const next=nextTripEntry(form.trips,index,form.timeMode);if(next.error){setError(next.error);const inputs=[...event.currentTarget.closest('tr').querySelectorAll('input')];inputs.find(input=>!input.checkValidity())?.reportValidity();return;}const root=event.currentTarget.closest('.logbook-table-wrap');update('trips',next.trips);requestAnimationFrame(()=>root.querySelector('[data-trip-equipment="'+next.nextIndex+'"]')?.focus());};
 const setTrip=(index,key,value)=>setForm(current=>({...current,trips:current.trips.map((row,i)=>i===index?{...row,[key]:value}:row)}));

 const viewSource=async()=>{try{const r=await fetch('/api/scan-cards/'+saved.data.scanCardId+'/image',{headers:{Authorization:`Bearer ${session.token}`}});if(!r.ok)throw new Error('Source scan unavailable.');const url=URL.createObjectURL(await r.blob());window.open(url,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){setError(e.message)}};
 const newEntry=()=>{setForm({...fresh(),location:options?.accountLocation||''});setSaved(null);setEditing(true);setSuccess('');setError('');};

 const openEntry=async row=>{if(row.data.manualAttachments?.some(file=>!file.data)){setWorking(true);try{const result=await api(`/api/log-books/${kind}/${row.id}/manual-attachments`);row={...row,data:{...row.data,manualAttachments:result.attachments}};}catch(error){setError(error.message);return;}finally{setWorking(false)}}setEditing(false);setSaved(row);setForm({...fresh(),...row.data,assetId:String(row.data.assetId),employeeId:String(row.data.employeeId),shiftId:String(row.data.shiftId),openingKmr:row.data.openingKmr??'',closingKmr:row.data.closingKmr??'',trips:padManualRows(row.data.trips,5,blankTrip),jobDetails:padManualRows(row.data.jobDetails,2,blankJob),breakdownDetails:padManualRows(row.data.breakdownDetails,2,blankBreakdown)});setSuccess('');setError('');document.querySelector('.logbook-form')?.scrollIntoView({behavior:'smooth',block:'start'});};

 const save=async event=>{event.preventDefault();if(Object.keys(meterIssues).length){setError(Object.values(meterIssues).join(' '));return;}setWorking(true);setError('');setSuccess('');try{const result=await api(`/api/log-books/${kind}${saved?'/'+saved.id:''}`,{method:saved?'PUT':'POST',body:JSON.stringify({...form,...(vehicle?{trips:form.trips.filter(row=>!isEmptyTripPlaceholder(row))}:{}),revision:saved?.revision})});setSaved(result);setForm(current=>({...current,manualBreakdownHours:result.data?.manualBreakdownHours??''}));setEditing(false);setSuccess(`${result.book_no} saved successfully.`);await loadRegister();}catch(e){setError(e.message)}finally{setWorking(false)}};

 const filtered=records.filter(row=>`${row.book_no} ${row.data.door} ${row.data.employeeName} ${row.data.location} ${row.data.bookDate}`.toLowerCase().includes(query.toLowerCase()));

 const findRecords=()=>{setRegisterOpen(true);requestAnimationFrame(()=>{document.querySelector('.logbook-register')?.scrollIntoView({behavior:'smooth',block:'start'});document.querySelector('[aria-label="Search saved log books"]')?.focus();});};

 const firstRecord=async()=>{try{const result=await api(`/api/log-books/${kind}?first=1`);if(result.records[0])openEntry(result.records[0]);else setSuccess('No saved records yet.');}catch(e){setError(e.message)}};

 const lastRecord=async()=>{try{const result=await api(`/api/log-books/${kind}?last=1`);if(result.records[0])openEntry(result.records[0]);else setSuccess('No saved records yet.');}catch(e){setError(e.message)}};
 const deleteRecord=async()=>{setWorking(true);try{await api(`/api/log-books/${kind}/${saved.id}`,{method:'DELETE',body:JSON.stringify({revision:saved.revision})});setShowDelete(false);newEntry();setSuccess('Record deleted from the active register.');await loadRegister();}catch(e){setError(e.message)}finally{setWorking(false)}};

 const printRecord=()=>{document.body.classList.add('printing-logbook');window.addEventListener('afterprint',()=>document.body.classList.remove('printing-logbook'),{once:true});window.print();};

 return <section className="logbook-page logbook-compact logbook-single-sheet">



   <header className="logbook-page-header"><div><span className="logbook-eyebrow">MIS / DAILY OPERATIONS</span><h1><BookOpen size={26}/>{title}</h1><p>{vehicle?'Vehicle readings, driver assignment and trip details.':'Equipment readings, shift and operator assignment.'}</p></div><div className="logbook-header-actions" role="toolbar" aria-label="Log book actions"><button type="button" onClick={()=>void load()} disabled={working||loading} title="Refresh masters"><RotateCcw size={15}/><span>Refresh</span></button><button type="button" onClick={newEntry} disabled={working}><Plus size={16}/>New entry</button>{onBulkScan&&<button type="button" onClick={onBulkScan}>Bulk scan cards</button>}{saved?.data.scanCardId&&<button type="button" onClick={viewSource}>View source scan</button>}<><button type="button" onClick={findRecords}><ListFilter size={16}/>Query</button><button type="button" onClick={firstRecord} disabled={working}><ChevronsLeft size={16}/>First record</button><button type="button" onClick={lastRecord} disabled={working}><ChevronsRight size={16}/>Last record</button><button type="button" onClick={()=>setEditing(true)} disabled={!saved||editing||working}><Pencil size={16}/>Edit</button><button type="submit" form="logbook-entry-form" disabled={!editing||working||loading}><Save size={16}/>Save</button><button type="button" onClick={()=>setShowDelete(true)} disabled={!saved||working}><Trash2 size={16}/>Delete</button><button type="button" onClick={findRecords}><Search size={16}/>Search</button><button type="button" onClick={printRecord}><Printer size={16}/>Print</button><button type="button" onClick={()=>saved?openEntry(saved):newEntry()} disabled={working}><X size={16}/>Cancel</button><button type="button" onClick={onExit} disabled={working}><LogOut size={16}/>Exit</button><button type="button" onClick={()=>setShowStatus(!showStatus)} aria-expanded={showStatus}><Info size={16}/>Status</button></></div></header>

   {loading&&<p role="status">Loading log books and synced masters…</p>}

   {error&&<div className="logbook-message error" role="alert">{error}</div>}

   {Object.keys(meterIssues).length>0&&<div className="logbook-message error" role="alert"><strong>Need Attention</strong>{Object.values(meterIssues).map(message=><p key={message}>{message}</p>)}</div>}
   {success&&<div className="logbook-message success" role="status">{success}</div>}

   {showStatus&&<div className="logbook-message" role="status">{saved?`${saved.book_no} · Saved · Revision ${saved.revision} · ${editing?'Editing':'View only'}`:'New entry · Not saved'} · {working?'Saving…':loading?'Loading masters…':'Ready'}</div>}

   {showDelete&&<div className="logbook-dialog-backdrop"><section className="logbook-dialog" role="alertdialog" aria-modal="true" aria-label="Delete log book"><h2>Delete this log book?</h2><p>{saved?.book_no} will be removed from the active register.</p><button type="button" onClick={deleteRecord} disabled={working}>Delete record</button><button type="button" onClick={()=>setShowDelete(false)} disabled={working}>Keep record</button></section></div>}

   <form id="logbook-entry-form" className="logbook-form" onSubmit={save} onKeyDown={advanceLogBookField}>

    <fieldset className="logbook-edit-fields" disabled={!editing||working}>

     <section className="logbook-section"><div className="logbook-section-title"><h2>Book details</h2><span>{saved?.book_no||'New log book'}</span></div><div className="logbook-fields">

<Field label="Location" hint={options?.accountLocation?'From your account':'Assign one location to your account to enter this log book'}><input name="location" readOnly required value={form.location} aria-label="Location"/></Field>
<Field label="Doc type"><input readOnly value={vehicle?'VLB':'Equipment Log Book'}/></Field>
<Field label="Book date"><ManualBookDate value={form.bookDate} onChange={value=>update('bookDate',value)}/></Field>
<Field label="Book no." hint={vehicle?'VLB_M/DDTH-MMMYY/{S1|S2|S3|D|N}/001 · Assigned on save':'CAL/ELB/DD-MM-YY/001 · Assigned on save'}><input readOnly value={saved?.book_no||'AUTO'}/></Field>
<Field label="Project name"><input maxLength={500} value={form.projectName||form.location} onChange={e=>update('projectName',e.target.value)}/></Field>
<Field label={vehicle?'Door no.':'Equipment'} hint={asset?`${asset.name}${asset.registration?' · '+asset.registration:''}`:assetMessage||'Select from Equipment Master'}><DoorCombobox key={kind+':'+form.location} records={options?.assets||[]} kind={kind} location={form.location} value={form.assetId} onSelect={selectAsset} disabled={!editing||working} loading={loading}/></Field>
<Field label="Wo.Cont." hint={eligibleWorkOrders.length===1?'Latest work order for this location/date':eligibleWorkOrders.length>1?'Latest eligible work order selected; equal-date ties require selection':'No matching Work Order available'}><SmartSelect disabled={!editing||working} value={form.workOrderId||''} onChange={e=>update('workOrderId',e.target.value)}><option value="">Select Work Order / Contract</option>{eligibleWorkOrders.map(row=><option key={row.id} value={row.id}>{row.number}</option>)}</SmartSelect></Field>
<Field label="Employee ID / Caliber ID" hint="Enter either ID to fetch the employee name"><SmartSelect searchable name="employeeId" aria-label="Employee ID / Caliber ID" disabled={!editing||working||!form.location} required value={form.employeeId} onChange={e=>{update('employeeId',e.target.value);const row=options?.employees.find(r=>r.id===e.target.value);if(row)setSuccess((vehicle?'Driver':'Operator')+' found: '+row.name+' · '+row.caliberId);}}><option value="">Select employee at this location</option>{(options?.employees||[]).filter(row=>employeeAtLocation(row,form.location)).map(row=><option key={row.id} value={row.id}>{row.caliberId||row.employeeCode}{row.caliberCode?' / '+row.caliberCode:''} · {row.name}</option>)}</SmartSelect></Field>
<Field label="Shift" hint={form.cardShift?'Marked on card: '+(CARD_SHIFTS[form.cardShift]?.label||form.cardShift):'Location-specific Shift Master'}><SmartSelect name="shiftId" searchable disabled={!editing||working} required value={form.shiftId} onChange={e=>{update('shiftId',e.target.value);}}><option value="">Select shift</option>{shifts.map(shift=><option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}–{shift.endTime}</option>)}</SmartSelect></Field>
<Field label={vehicle?'Driver name':'Operator name'} skipEnter><SmartSelect disabled={!editing||working} required value={form.employeeId} onChange={e=>update('employeeId',e.target.value)}><option value="">Select {vehicle?'driver':'operator'}</option>{options?.employees.filter(row=>employeeAtLocation(row,form.location)).map(row=><option key={row.id} value={row.id}>{row.name}{row.caliberId?' · '+row.caliberId:''}</option>)}</SmartSelect></Field>
<Field label="Shift hour"><SmartSelect name="shiftHours" disabled={!editing||working} required value={form.shiftHours} onChange={e=>{update('shiftHours',Number(e.target.value));}}><option value={8}>8 Hour</option><option value={12}>12 Hour</option></SmartSelect></Field>
<Field label={vehicle?'A Form no. (Trip Card)':'Job Card no.'}><input maxLength={200} value={(vehicle?form.aFormNo:form.jobCardNo)||''} onChange={e=>update(vehicle?'aFormNo':'jobCardNo',e.target.value)} placeholder={vehicle?'Enter A Form number':'Enter Job Card number'}/></Field>
{vehicle&&<><Field label="Opening reading (KMR)"><input type="number" min="0" step="0.001" required value={form.openingKmr} onChange={e=>update('openingKmr',e.target.value)}/></Field>
<Field label="Closing reading (KMR)" issue={meterIssues.closingKmr}><input type="number" min="0" step="0.001" required value={form.closingKmr} onChange={e=>update('closingKmr',e.target.value)}/></Field>
</>}<Field label="Opening reading (HMR)"><input type="number" min="0" step="0.001" required value={form.openingHmr} onChange={e=>update('openingHmr',e.target.value)}/></Field>
<Field label="Closing reading (HMR)" issue={meterIssues.closingHmr}><input type="number" min="0" step="0.001" required value={form.closingHmr} onChange={e=>update('closingHmr',e.target.value)}/></Field>
{vehicle&&<><Field label="R engine opening (HMR)"><input type="number" min="0" step="0.001" value={form.openingEngineHmr??''} onChange={e=>update('openingEngineHmr',e.target.value)}/></Field><Field label="R engine closing (HMR)"><input type="number" min="0" step="0.001" value={form.closingEngineHmr??''} onChange={e=>update('closingEngineHmr',e.target.value)}/></Field></>}<Field label="Remark"><textarea rows={2} maxLength={4000} value={form.remark} onChange={e=>update('remark',e.target.value)}/></Field>{vehicle&&<><Field label="Total running KMR" issue={meterIssues.closingKmr}><output>{fixed(kmr)}</output></Field><div className="logbook-sheet-spacer"/></>}<Field label="Total working HMR" issue={meterIssues.closingHmr}><output>{fixed(hmr)}</output></Field>
     </div></section>

     <div className="logbook-message logbook-master-help" role="status">{assetMessage&&<p>{assetMessage}</p>}<button type="button" disabled={loading||working} onClick={()=>void reloadDoors()}>Reload doors</button>{assetMessage&&<> <a href="?page=master-sync" target="_blank" rel="noopener noreferrer">Open master sync</a></>}</div>
     {vehicle&&<section className="logbook-section"><div className="logbook-section-title"><h2>Detail · vehicle trips</h2><div className="logbook-trip-actions"><label>With time / Without time<SmartSelect disabled={!editing||working} aria-label="Trip time entry" value={form.timeMode} onChange={e=>update('timeMode',e.target.value)}><option value="with">With time</option><option value="without">Without time</option></SmartSelect></label><button type="button" data-enter-action="add-trip" onClick={addTrip} disabled={form.trips.length>=300}><Plus size={15}/>Add trip</button></div></div>


       <div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Equipment name</th><th>Job type name</th>{form.timeMode==='with'&&<><th>Loading time</th><th>Unloading time</th></>}<th>No. of trips</th>{form.timeMode==='with'&&<th>GAP to previous trip (minutes)</th>}<th>Remark</th><th/></tr></thead><tbody>

         {form.trips.map((row,index)=><tr key={index}><td><SmartSelect searchable aria-label={`Equipment name row ${index+1}`} required={!isEmptyTripPlaceholder(row)} data-enter-empty-trip={isEmptyTripPlaceholder(row)||undefined} data-trip-equipment={index} disabled={!editing||working||!form.location} value={row.equipmentName} onChange={e=>setTrip(index,'equipmentName',e.target.value)}><option value="">Select equipment name</option>{(options?.assets||[]).filter(asset=>asset.kind==='equipment'&&form.location&&canonicalSiteName(asset.site)===canonicalSiteName(form.location)).map(asset=><option key={asset.id} value={machineLabel(asset.door||asset.name)}>{asset.name}{asset.door?' · '+asset.door:''}</option>)}</SmartSelect>{!editing&&row.tripStatus&&<small>{row.tripStatus==='closed'?'Closed':row.tripStatus==='open'?'Open · awaiting unloading':row.tripStatus==='partly-closed'?'Partly closed':'Awaiting loading card'}{row.handoverLinks?.map((link,n)=><span key={n}><br/>{link.role==='loading'?'Unloaded by ':'Loaded by '}{link.counterpart.driverName} · {link.counterpart.bookNo} · {link.counterpart.date} · {link.loadingTime} → {link.unloadingTime} · {display(link.durationMinutes)} min · {link.tripCount} trip(s)</span>)}</small>}</td><td><input aria-label={`Trip job type row ${index+1}`} maxLength={500} value={row.jobType||''} onChange={e=>setTrip(index,'jobType',e.target.value)}/></td>{form.timeMode==='with'&&<><td><input type="time" step="1" aria-label={`Loading time row ${index+1}`} required={!isEmptyTripPlaceholder(row)&&!row.unloadingTime} value={row.loadingTime} onInput={e=>setTrip(index,'loadingTime',e.currentTarget.value)}/></td><td><input type="time" step="1" aria-label={`Unloading time row ${index+1}`} required={!isEmptyTripPlaceholder(row)&&!row.loadingTime} value={row.unloadingTime} onInput={e=>setTrip(index,'unloadingTime',e.currentTarget.value)}/></td></>}<td><input type="number" min="1" step="1" aria-label={`No. of trips row ${index+1}`} required value={row.tripCount} onChange={e=>setTrip(index,'tripCount',e.target.value)}/></td>{form.timeMode==='with'&&<td>{display(interTripGap(form.trips,index))}</td>}<td><input aria-label={`Trip remark row ${index+1}`} maxLength={2000} value={row.remark||''} onChange={e=>setTrip(index,'remark',e.target.value)} onKeyDown={e=>continueManualRemark(e,form.trips,index,blankTrip,rows=>update('trips',rows),'data-trip-equipment')}/></td><td><button type="button" className="logbook-remove" aria-label={`Remove trip row ${index+1}`} onClick={()=>update('trips',form.trips.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></td></tr>)}

         {!form.trips.length&&<tr><td colSpan={form.timeMode==='with'?8:5} className="logbook-empty">No trip rows added. Use Add trip to enter loading and unloading details.</td></tr>}

       </tbody></table></div><div className="logbook-trip-totals"><span>Total records / trips · Records: <strong>{form.trips.filter(row=>!isEmptyTripPlaceholder(row)).length}</strong></span><span>Completed trips: <strong>{!editing&&saved?saved.data.completedTrips??saved.data.totalTrips:form.trips.filter(row=>!isEmptyTripPlaceholder(row)&&(form.timeMode==='without'||row.loadingTime&&row.unloadingTime)).reduce((sum,row)=>sum+(Number(row.tripCount)||0),0)}</strong></span>{form.timeMode==='with'&&<small>GAP = this loading time − previous unloading time. First row has no previous trip; overnight gaps continue into the next day.</small>}</div>

     </section>}


     {vehicle&&!editing&&saved&&<div className="logbook-trip-totals"><span>Opening trips (loaded): <strong>{saved.data.openingTrips??0}</strong></span><span>Ending trips (unloaded): <strong>{saved.data.endingTrips??0}</strong></span><span>Completed trips: <strong>{saved.data.completedTrips??saved.data.totalTrips}</strong></span></div>}
     {vehicle&&<details className="logbook-section logbook-machine-details"><summary>Machine-wise summary · {machineTripTotal(form.trips)} trips</summary><div className="logbook-section-title"><h2>Machine-wise summary</h2><span>Calculated from trip details</span></div><table className="logbook-table"><thead><tr><th>Equipment name</th><th>Total trips</th></tr></thead><tbody>{machineSummary(form.trips).map(row=><tr key={row.equipmentName}><td>{row.equipmentName}</td><td>{row.tripCount}</td></tr>)}</tbody><tfoot><tr><th scope="row">Total trips</th><td>{machineTripTotal(form.trips)}</td></tr></tfoot></table></details>}
     <ManualLogBookDetails form={form} update={update} vehicle={vehicle} editing={editing&&!working} setWorking={setWorking} onError={setError}/>
     {<section className="logbook-section logbook-hours-summary"><div className="logbook-section-title"><h2>Hours summary</h2><span>{hoursLoading?'Fetching Pulse BD hours…':hours?.breakdownHours!=null?'Source: Pulse · selected location / door / date / shift':hoursError||hours?'Pulse unavailable · manual BD entry available':`Select ${vehicle?'vehicle':'equipment'}, date and shift`}</span></div><div className="logbook-fields"><Field label="Availability HRS" hint="Closing HMR − opening HMR"><output>{fixed(hmr)}</output></Field><Field label="Running HRS" hint="Closing HMR − opening HMR"><output>{fixed(hmr)}</output></Field><Field label="BD HRS"><BreakdownHoursField pulse={hours} loading={hoursLoading} error={hoursError} ready={Boolean(form.assetId&&form.shiftId&&form.bookDate&&form.location)} manualValue={form.manualBreakdownHours} savedValue={saved?.data.breakdownHours} shiftHours={form.shiftHours} disabled={!editing||working} readOnly={!editing} onChange={value=>update('manualBreakdownHours',value)}/></Field><Field label="Idle HRS" hint="Shift hours − working HMR"><output>{fixed(hmr==null?null:Number(form.shiftHours)-hmr)}</output></Field></div>{hoursError&&<p className="logbook-message">{hoursError} Enter BD hours manually in the field above if needed. Availability and idle calculations still use the meter readings.</p>}{hours?.warnings?.map(w=><p key={w} className="logbook-message error">{w}</p>)}<p className="logbook-note">Breakdown intervals are restricted to the selected shift and overlapping requests are counted once. If Pulse is unavailable, BD hours can be entered manually. A zero returned by Pulse is kept as zero.</p></section>}


     </fieldset><footer className="logbook-save-bar"><span>{saved?`${saved.book_no} · Revision ${saved.revision}`:'Book number will be generated on save.'}</span><button className="primary" data-enter-action="save" type="submit" disabled={!editing||working||loading||!options}><Save size={16}/>{working?'Saving…':saved?'Save changes':'Save log book'}</button></footer>

   </form>

   <section hidden={!registerOpen} className="logbook-section logbook-register"><div className="logbook-section-title"><h2>Saved log books</h2><input aria-label="Search saved log books" placeholder="Search book, door, employee or site…" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Book no.</th><th>Date</th><th>Location</th><th>Door no.</th><th>Shift</th><th>{vehicle?'Driver':'Operator'}</th><th>Work HMR</th>{vehicle&&<><th>Opening trips</th><th>Ending trips</th><th>Completed trips</th></>}<th/></tr></thead><tbody>{filtered.map(row=><tr key={row.id}><td>{row.book_no}</td><td>{row.data.bookDate}</td><td>{row.data.location}</td><td>{row.data.door}</td><td>{row.data.shiftName}</td><td>{row.data.employeeName}</td><td>{display(row.data.totalWorkingHmr)}</td>{vehicle&&<><td>{display(row.data.openingTrips)}</td><td>{display(row.data.endingTrips)}</td><td>{display(row.data.completedTrips??row.data.totalTrips)}</td></>}<td><button type="button" onClick={()=>openEntry(row)}>Open</button></td></tr>)}{!filtered.length&&<tr><td colSpan={vehicle?11:8} className="logbook-empty">No saved entries found.</td></tr>}</tbody></table></div>{nextCursor&&<button type="button" onClick={()=>void loadRegister(nextCursor).catch(e=>setError(e.message))}>Load older entries</button>}</section>

 </section>;

}


