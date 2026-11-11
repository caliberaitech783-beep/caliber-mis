import {MANUAL_SHIFTS,manualShiftWindow} from '../shared/manual-shift.mjs';
import './log-book-readability.css';
import {compactLogBookLabel,tripSerialNumber} from '../shared/log-book-labels.mjs';
import {resolveTripEquipment,validateTripEquipment} from '../shared/trip-equipment-validation.mjs';
import {vlbEntryFields,sameVlbEntryContext,withLmvEntrySite} from './vlb-entry-context.mjs';
import WorkOrderJobSelect from './work-order-job-select.jsx';
import ManualLogBookDetails from './manual-log-book-details.jsx';
import {blankJob,blankBreakdown,padManualRows} from '../shared/manual-log-book-details.mjs';
import BreakdownHoursField from './breakdown-hours-field.jsx';
import {employeeAtLocation} from '../shared/log-book-access.mjs';
import {blankTrip,nextTripEntry} from '../shared/trip-entry.mjs';
import SmartSelect from './smart-select.jsx';
import DoorCombobox from './door-combobox.jsx';
import ManualAliasDialog from './manual-alias-dialog.jsx';
import {missingAssetMessage} from './log-book-asset-options.mjs';
import {vlbCountedTrips} from '../shared/vlb-trip-handover.mjs';
import {activeWorkOrders,matchingWorkOrders,machineSummary,machineTripTotal,CARD_SHIFTS,machineLabel,latestWorkOrder,interTripGap,tripEquipmentRequired,kmrMeterReplaced,shiftMeterIssues,normalizeCardShift} from '../shared/trip-card-rules.mjs';
import {fixedMinuteInput,manualTimeValue,resolveShiftTime,shiftTimeInputValue,timeWithinShift} from '../shared/manual-trip-time.mjs';
import EmployeeIdLookup from './employee-id-lookup.jsx';
import ManualBookDate from './manual-book-date.jsx';
import {continueManualRemark,advanceLogBookField,focusNextLogBookField,isEmptyTripPlaceholder} from './log-book-enter-navigation.mjs';
import React,{useEffect,useState,useRef} from 'react';

import {Plus,Save,Trash2,RotateCcw,BookOpen,Search,ChevronsLeft,ChevronsRight,Pencil,Printer,X,LogOut,Info,ListFilter} from 'lucide-react';

import {canonicalSiteName} from '../shared/site-location.mjs';

import './log-book-form.css';



const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

const fresh=()=>({bookDate:today(),bookDateSource:'system',location:'',assetId:'',workOrderId:'',employeeId:'',shiftId:'',shiftHours:8,openingKmr:'',closingKmr:'',openingHmr:'',closingHmr:'',aFormNo:'',remark:'',timeMode:'with',trips:Array.from({length:5},blankTrip),jobDetails:Array.from({length:2},blankJob),breakdownDetails:Array.from({length:2},blankBreakdown),manualAttributes:[],manualAttachments:[],openingEngineHmr:'',closingEngineHmr:'',requestKey:crypto.randomUUID()});

const delta=(opening,closing)=>opening!==''&&closing!==''&&Number(closing)>=Number(opening)?Math.round((Number(closing)-Number(opening))*1000)/1000:null;

const fixed=value=>value==null?'—':Number(value).toFixed(2);
const display=value=>value===null||value===undefined?'—':Number(value).toLocaleString('en-IN',{maximumFractionDigits:3});

const gap=(start,end)=>{if(!/^\d{2}:\d{2}(?::\d{2})?$/.test(start)||!/^\d{2}:\d{2}(?::\d{2})?$/.test(end))return null;const seconds=t=>t.split(':').reduce((sum,v,i)=>sum+Number(v)*[3600,60,1][i],0);return Math.round(((seconds(end)-seconds(start)+86400)%86400)/60*1000)/1000;};

function Field({label,children,hint,wide=false,skipEnter=false,enterOrder,issue}){return <label data-enter-order={enterOrder} data-enter-skip={skipEnter||undefined} className={`logbook-field${wide?' wide':''}${issue?' logbook-meter-invalid':''}`}><span title={label}>{compactLogBookLabel(label)}</span>{issue?React.Children.map(children,child=>React.isValidElement(child)?React.cloneElement(child,{'aria-invalid':true}):child):children}{hint&&<small>{hint}</small>}{issue&&<small role="alert">{issue}</small>}</label>}



export default function LogBookForm({kind,session,onExit,onBulkScan,vlbBatch,initialRecord,onSaved,inlineEdit=false,focusField,fleetReconciliation=null}){

 const lmv=kind==='lmv',vehicle=kind==='vehicle'||lmv,title=lmv?'LMV Log Book':vehicle?'Vehicle Log Book':'Equipment Log Book';

 const [form,setForm]=useState(fresh),[saved,setSaved]=useState(null),[options,setOptions]=useState(null),[records,setRecords]=useState([]),[nextCursor,setNextCursor]=useState(null),[query,setQuery]=useState(''),[error,setError]=useState(''),[success,setSuccess]=useState(''),[working,setWorking]=useState(false),[loading,setLoading]=useState(true);

 const [hours,setHours]=useState(null),[hoursError,setHoursError]=useState(''),[hoursLoading,setHoursLoading]=useState(false);
 const [hoursRefresh,setHoursRefresh]=useState(0);
 const [editing,setEditing]=useState(true),[showDelete,setShowDelete]=useState(false),[showStatus,setShowStatus]=useState(false);
 const initialLocationFocused=useRef(false);
 const [registerOpen,setRegisterOpen]=useState(false);
 const formRef=useRef(null);
 // Manual entry: a machine written on the card that no Pulse door matches is paired to a Pulse record here (same alias rules and OTP as scanning).
 const [aliasWritten,setAliasWritten]=useState('');
 const [showSaveConfirm,setShowSaveConfirm]=useState(false);

 useEffect(()=>{
   const saveShortcut=event=>{
     if(!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='s'||event.altKey)return;
     event.preventDefault();
     if(event.repeat||event.isComposing||!editing||working||loading||showDelete||showSaveConfirm)return;
     document.getElementById('logbook-entry-form')?.requestSubmit();
   };
   window.addEventListener('keydown',saveShortcut);
   return()=>window.removeEventListener('keydown',saveShortcut);
 },[editing,working,loading,showDelete||showSaveConfirm]);

 const api=async(url,config={})=>{const response=await fetch(url,{...config,headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json',...config.headers}});const body=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(body.error||'Could not reach the log book service.'),{details:body});return body;};

 const loadOptions=async()=>{
  const masters=await api('/api/log-books/options');
  return lmv?withLmvEntrySite(masters,session,api):masters;
 };

 const loadRegister=async(before)=>{if(vlbBatch){const batch=await api('/api/vlb-batches/'+vlbBatch.id);setRecords((kind==='lmv'?batch.lmvRecords:batch.records)||[]);setNextCursor(null);return;}const data=await api(`/api/log-books/${kind}${before?'?before='+encodeURIComponent(before):''}`);setRecords(current=>before?[...current,...data.records]:data.records);setNextCursor(data.nextCursor);};

 const load=async()=>{setLoading(true);setError('');try{const [masters,list]=await Promise.all([loadOptions(),initialRecord?null:api(vlbBatch?'/api/vlb-batches/'+vlbBatch.id:`/api/log-books/${kind}`)]);setOptions(masters);if(list){setRecords((vlbBatch&&kind==='lmv'?list.lmvRecords:list.records)||[]);setNextCursor(list.nextCursor);}}catch(e){setError(e.message)}finally{setLoading(false)}};

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

 useEffect(()=>{
   if(!inlineEdit||!editing||loading||!options)return;
   const formNode=formRef.current;
   const field=focusField==='trips'?formNode?.querySelector('.logbook-vehicle-trips'):
     [...(formNode?.querySelectorAll('.logbook-field > span[title]')||[])].find(label=>label.title===focusField)?.parentElement;
   const target=field?.querySelector('input:not([readonly]):not([type="hidden"]),select,textarea,[role="combobox"]')||formNode;
   target?.focus();
 },[inlineEdit,editing,loading,options,focusField]);

 const update=(key,value)=>{if(vlbBatch&&['location','bookDate'].includes(key))return;setForm(current=>({...current,[key]:value,...(key==='manualShift'&&['day','night'].includes(value)?{shiftHours:12}:{}),...(key==='bookDate'?{bookDateSource:'manual'}:{}),...(['bookDate','assetId','location','shiftId','shiftHours','manualShift'].includes(key)?{manualBreakdownHours:''}:{})}));setSuccess('');};

 const assetMessage=missingAssetMessage(options,kind,form.location);
 const reloadDoors=async()=>{setWorking(true);setError('');try{setOptions(await loadOptions());setSuccess('Equipment Master reloaded. Your entry has been kept.')}catch(e){setError(e.message)}finally{setWorking(false)}};

 const shifts=(options?.shifts||[]).filter(shift=>!form.location||!shift.site||canonicalSiteName(shift.site)===canonicalSiteName(form.location));
 const baseShift=shifts.find(shift=>String(shift.id)===String(form.shiftId));
 let selectedShift=baseShift,manualShiftError='';try{if(baseShift)selectedShift=manualShiftWindow({...form,shiftHours:form.shiftHours||CARD_SHIFTS[form.cardShift]?.hours||8},baseShift,shifts);}catch(error){manualShiftError=error.message;}
 const shiftTimeHint=selectedShift?manualTimeValue(selectedShift.startTime)+'–'+manualTimeValue(selectedShift.endTime):'';

 const selectLocation=location=>setForm(current=>({...current,location,assetId:'',employeeId:'',shiftId:'',workOrderId:'',manualShift:'',manualBreakdownHours:''}));
 const tripContracts=activeWorkOrders(options?.workOrders||[],form.location,form.bookDate);
 const eligibleWorkOrders=matchingWorkOrders(options?.workOrders||[],form.location,form.bookDate);
 useEffect(()=>{if(!editing||inlineEdit)return;setForm(current=>{const latest=latestWorkOrder(options?.workOrders||[],current.location,current.bookDate);const id=eligibleWorkOrders.some(r=>r.id===String(current.workOrderId))?current.workOrderId:latest?latest.id:'';return id===current.workOrderId?current:{...current,workOrderId:id};});},[form.location,form.bookDate,options,editing,vehicle,inlineEdit]);
 const employee=options?.employees.find(row=>row.id===String(form.employeeId));

 const asset=options?.assets.find(row=>row.id===String(form.assetId));

 const tripEquipmentOptions=(options?.assets||[]).filter(asset=>asset.kind==='equipment'&&form.location&&canonicalSiteName(asset.site)===canonicalSiteName(form.location));
 const tripEquipmentValues=new Set(tripEquipmentOptions.map(asset=>machineLabel(asset.door||asset.name)));
 const equipmentValidation=vehicle?validateTripEquipment({...form,trips:form.trips.filter(row=>!isEmptyTripPlaceholder(row))},options?.assets||[]):{draft:form,issues:{}};
 const replacedKmr=vehicle&&kmrMeterReplaced(form);
 const meterIssues=vehicle?shiftMeterIssues(form,kind):{};
 const kmr=replacedKmr?delta(0,form.replacementKmr??''):delta(form.openingKmr,form.closingKmr),hmr=delta(form.openingHmr,form.closingHmr);

 useEffect(()=>{let stale=false;setHours(null);setHoursError('');if(!form.bookDate||!form.assetId||!form.shiftId||!form.location){setHoursLoading(false);return;}setHoursLoading(true);const timer=setTimeout(()=>{api('/api/log-books/hours',{method:'POST',body:JSON.stringify({bookDate:form.bookDate,assetId:form.assetId,shiftId:form.shiftId,location:form.location,shiftHours:form.shiftHours||CARD_SHIFTS[form.cardShift]?.hours||8,manualEntry:true,manualShift:form.manualShift,runningHours:hmr})}).then(value=>{if(!stale)setHours(value)}).catch(e=>{if(!stale)setHoursError(e.message)}).finally(()=>{if(!stale)setHoursLoading(false)});},500);return ()=>{stale=true;clearTimeout(timer)};},[vehicle,form.bookDate,form.assetId,form.shiftId,form.location,form.shiftHours,form.manualShift,hmr,session.token,hoursRefresh]);

 const entryLocation=(lmv&&options?.lmvEntrySite)||options?.accountLocation||'';
 useEffect(()=>{if(saved)return;if(vlbBatch){setForm(current=>({...current,...vlbEntryFields(vlbBatch,options)}));return;}setForm(current=>current.location===entryLocation||lmv&&options?.canSelectSite&&current.location?current:{...current,location:entryLocation,assetId:'',employeeId:'',shiftId:'',workOrderId:'',manualBreakdownHours:''});},[vehicle,saved,options,vlbBatch?.id]);


 const selectAsset=id=>{const row=options?.assets.find(asset=>asset.id===id);setForm(current=>({...current,assetId:id,manualBreakdownHours:'',...(!current.location&&row?.site?{location:row.site,shiftId:''}:{})}));setSuccess('');};

 const addTrip=()=>{const index=form.trips.length;if(index>=300)return;update('trips',[...form.trips,blankTrip()]);requestAnimationFrame(()=>document.getElementById('logbook-entry-form')?.querySelector('[data-trip-equipment="'+index+'"]')?.focus());};
 const continueTrip=(event,index)=>{if(event.key!=='Enter'||event.isComposing||event.nativeEvent?.isComposing||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey)return;event.preventDefault();if(event.repeat)return;const next=nextTripEntry(form.trips,index,form.timeMode);if(next.error){setError(next.error);const inputs=[...event.currentTarget.closest('tr').querySelectorAll('input')];inputs.find(input=>!input.checkValidity())?.reportValidity();return;}const root=event.currentTarget.closest('.logbook-table-wrap');update('trips',next.trips);requestAnimationFrame(()=>root.querySelector('[data-trip-equipment="'+next.nextIndex+'"]')?.focus());};
 const setTrip=(index,key,value)=>setForm(current=>({...current,trips:current.trips.map((row,i)=>i===index?{...row,[key]:value}:row)}));

 const viewSource=async()=>{try{const r=await fetch('/api/scan-cards/'+saved.data.scanCardId+'/image',{headers:{Authorization:`Bearer ${session.token}`}});if(!r.ok)throw new Error('Source scan unavailable.');const url=URL.createObjectURL(await r.blob());window.open(url,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){setError(e.message)}};
 const newEntry=()=>{setForm({...fresh(),location:entryLocation,...(vlbBatch?vlbEntryFields(vlbBatch,options):{})});setSaved(null);setEditing(true);setShowSaveConfirm(false);setSuccess('');setError('');};

 const startHandover=keepDriver=>{
  const {bookDate,bookDateSource,location,shiftId,shiftHours,manualShift,cardShift,bookShiftCode,assetId,employeeId}=saved.data;
  setForm({...fresh(),bookDate,bookDateSource,location,shiftId:String(shiftId??''),shiftHours,manualShift,cardShift,bookShiftCode,
   ...(keepDriver?{employeeId:String(employeeId)}:{assetId:String(assetId)})});
  setHours(null);
  setSaved(null);
  setEditing(true);
  setError('');
  setSuccess(keepDriver?'Select the replacement vehicle and record its trips on this new card.':'Select the next driver and record their trips on this new card.');
 };

 const pulseBreakdowns=hours?.breakdowns||[];
 const vehicleInMaintenance=pulseBreakdowns.some(request=>request.ongoing);

 const openEntry=async (row,edit=false)=>{if(row.data.manualAttachments?.some(file=>!file.data)){setWorking(true);try{const result=await api(`/api/log-books/${kind}/${row.id}/manual-attachments`);row={...row,data:{...row.data,manualAttachments:result.attachments}};}catch(error){setError(error.message);return;}finally{setWorking(false)}}setEditing(edit);setSaved(row);setForm({...fresh(),...row.data,assetId:String(row.data.assetId),employeeId:String(row.data.employeeId),shiftId:String(row.data.shiftId??''),openingKmr:row.data.openingKmr??'',closingKmr:row.data.closingKmr??'',trips:padManualRows(row.data.trips,5,blankTrip),jobDetails:padManualRows(row.data.jobDetails,2,blankJob),breakdownDetails:padManualRows(row.data.breakdownDetails,2,blankBreakdown)});setSuccess('');setError('');if(!inlineEdit)document.querySelector('.logbook-form')?.scrollIntoView({behavior:'smooth',block:'start'});};

 useEffect(()=>{if(initialRecord)void openEntry(initialRecord,true)},[initialRecord?.id]);
 // A second manual card for the same tipper in the same shift is refused by the server
 // (409, code duplicate_card) until a reason is given. The reason travels with the card.
 const submit=async(duplicateReason='')=>{setWorking(true);setError('');setSuccess('');try{const result=await api(`/api/log-books/${kind}${saved?'/'+saved.id:''}`,{method:saved?'PUT':'POST',body:JSON.stringify({...equipmentValidation.draft,revision:saved?.revision,...(duplicateReason?{duplicateReason}:{})})});setSaved(result);setForm(current=>({...current,manualBreakdownHours:result.data?.manualBreakdownHours??''}));setEditing(false);setSuccess(`${result.book_no} saved successfully.`);if(!initialRecord)await loadRegister();onSaved?.(result);}catch(e){
  if(e.details?.code==='duplicate_card'&&!duplicateReason){setWorking(false);const reason=window.prompt(e.message+'\n\nTo save an additional card for this tipper, enter the reason (at least 10 characters). Leave empty to cancel.','');if(reason&&reason.trim().length>=10)return submit(reason.trim());setError(e.message);return;}
  setError(e.message)}finally{setWorking(false)}};
 const save=async event=>{event.preventDefault();if(initialRecord&&(!saved||!editing||working||loading||!options))return;if(manualShiftError){setError(manualShiftError);return;}if(vlbBatch&&!sameVlbEntryContext(vlbBatch,form)){setError('This entry must use the selected batch site, date and shift.');return;}if(Object.keys(equipmentValidation.issues).length){setError(Object.values(equipmentValidation.issues).join(' '));return;}if(vehicle){const limits=Object.values(meterIssues);if(limits.length){setError(limits.join(' '));return;}setShowSaveConfirm(true);return;}await submit();};
 const confirmSave=async()=>{setShowSaveConfirm(false);await submit();};

 const filtered=records.filter(row=>`${row.book_no} ${row.data.door} ${row.data.employeeName} ${row.data.location} ${row.data.bookDate}`.toLowerCase().includes(query.toLowerCase()));

 const findRecords=()=>{setRegisterOpen(true);requestAnimationFrame(()=>{document.querySelector('.logbook-register')?.scrollIntoView({behavior:'smooth',block:'start'});document.querySelector('[aria-label="Search saved log books"]')?.focus();});};

 const firstRecord=async()=>{try{const result=await api(`/api/log-books/${kind}?first=1`);if(result.records[0])openEntry(result.records[0]);else setSuccess('No saved records yet.');}catch(e){setError(e.message)}};

 const lastRecord=async()=>{try{const result=await api(`/api/log-books/${kind}?last=1`);if(result.records[0])openEntry(result.records[0]);else setSuccess('No saved records yet.');}catch(e){setError(e.message)}};
 const deleteRecord=async()=>{setWorking(true);try{await api(`/api/log-books/${kind}/${saved.id}`,{method:'DELETE',body:JSON.stringify({revision:saved.revision})});setShowDelete(false);newEntry();setSuccess('Record deleted from the active register.');await loadRegister();}catch(e){setError(e.message)}finally{setWorking(false)}};

 const printRecord=()=>{document.body.classList.add('printing-logbook');window.addEventListener('afterprint',()=>document.body.classList.remove('printing-logbook'),{once:true});window.print();};

 return <section className={`logbook-page logbook-compact logbook-single-sheet${vehicle?' logbook-vehicle':''}`}>



   <header className="logbook-page-header"><div><span className="logbook-eyebrow">MIS / DAILY OPERATIONS</span><h1><BookOpen size={26}/>{initialRecord?(lmv?"Edit LMV ":vehicle?"Edit VLB ":"Edit ELB ")+initialRecord.book_no:title}</h1><p>{vehicle?'Vehicle readings, driver assignment and trip details.':'Equipment readings, shift and operator assignment.'}</p></div>{!initialRecord&&<div className="logbook-header-actions" role="toolbar" aria-label="Log book actions"><button type="button" onClick={()=>void load()} disabled={working||loading} title="Refresh masters"><RotateCcw size={15}/><span>Refresh</span></button><button type="button" onClick={newEntry} disabled={working}><Plus size={16}/>New entry</button>{onBulkScan&&<button type="button" onClick={onBulkScan}>Bulk scan cards</button>}{saved?.data.scanCardId&&<button type="button" onClick={viewSource}>View source scan</button>}<><button type="button" onClick={findRecords}><ListFilter size={16}/>Query</button><button type="button" onClick={firstRecord} disabled={working}><ChevronsLeft size={16}/>First record</button><button type="button" onClick={lastRecord} disabled={working}><ChevronsRight size={16}/>Last record</button><button type="button" onClick={()=>setEditing(true)} disabled={!saved||editing||working}><Pencil size={16}/>Edit</button><button type="submit" form="logbook-entry-form" disabled={!editing||working||loading}><Save size={16}/>Save</button><button type="button" onClick={()=>setShowDelete(true)} disabled={!saved||working}><Trash2 size={16}/>Delete</button><button type="button" onClick={findRecords}><Search size={16}/>Search</button><button type="button" onClick={printRecord}><Printer size={16}/>Print</button><button type="button" onClick={()=>saved?openEntry(saved):newEntry()} disabled={working}><X size={16}/>Cancel</button><button type="button" onClick={onExit} disabled={working}><LogOut size={16}/>Exit</button><button type="button" onClick={()=>setShowStatus(!showStatus)} aria-expanded={showStatus}><Info size={16}/>Status</button></></div>}</header>

   {loading&&<p role="status">Loading log books and synced masters…</p>}

   {error&&<div className="logbook-message error" role="alert">{error}</div>}

   {editing&&Object.values(equipmentValidation.issues).map((message,i)=><div key={i} className="logbook-message error" role="alert">{message}</div>)}
   {success&&<div className="logbook-message success" role="status">{success}</div>}

   {showStatus&&<div className="logbook-message" role="status">{saved?`${saved.book_no} · Saved · Revision ${saved.revision} · ${editing?'Editing':'View only'}`:'New entry · Not saved'} · {working?'Saving…':loading?'Loading masters…':'Ready'}</div>}

   {showDelete&&<div className="logbook-dialog-backdrop"><section className="logbook-dialog" role="alertdialog" aria-modal="true" aria-label="Delete log book"><div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={()=>setShowDelete(false)} disabled={working} aria-label="Close window">× Close</button></div><h2>Delete this log book?</h2><p>{saved?.book_no} will be removed from the active register.</p><button type="button" onClick={deleteRecord} disabled={working}>Delete record</button><button type="button" onClick={()=>setShowDelete(false)} disabled={working}>Keep record</button></section></div>}

   {showSaveConfirm&&<div className="logbook-dialog-backdrop"><section className="logbook-dialog" role="alertdialog" aria-modal="true" aria-label={lmv?'Save LMV entry':'Save VLB entry'}><div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={()=>setShowSaveConfirm(false)} disabled={working} aria-label="Close window">× Close</button></div><h2>Save this entry?</h2><p>Confirm that the {lmv?'LMV':'VLB'} details are complete and correct.</p><button type="button" className="primary" onClick={confirmSave} disabled={working}>Save entry</button><button type="button" onClick={()=>setShowSaveConfirm(false)} disabled={working}>Cancel</button></section></div>}

   <form ref={formRef} tabIndex={inlineEdit?-1:undefined} id="logbook-entry-form" className="logbook-form" data-enter-confirm-save={vehicle||undefined} onSubmit={save} onKeyDown={advanceLogBookField}>

    <fieldset className="logbook-edit-fields" disabled={!editing||working}>

     <section className="logbook-section"><div className="logbook-section-title"><h2>Book details</h2><span>{saved?.book_no||'New log book'}</span></div><div className="logbook-fields">

<Field label="Location" hint={vlbBatch?'Fixed by the selected VLB batch':lmv&&options?.canSelectSite?'Choose a site':options?.accountLocation?'From your account':lmv&&entryLocation?'Site filled automatically':'Assign one location to your account to enter this log book'}>{!vlbBatch&&lmv&&options?.canSelectSite?<SmartSelect searchable name="location" required value={form.location} onChange={e=>selectLocation(e.target.value)}><option value="">Select a site</option>{options.sites.map(site=><option key={site}>{site}</option>)}</SmartSelect>:<input name="location" readOnly required value={form.location} aria-label="Location"/>}</Field>
<Field label="Doc type"><input readOnly value={lmv?'LMV':vehicle?'VLB':'Equipment Log Book'}/></Field>
<Field label="Book date">{vlbBatch?<input aria-label="Book date" readOnly value={form.bookDate}/>:<ManualBookDate value={form.bookDate} onChange={value=>update('bookDate',value)}/>}</Field>
<Field label="Book no." hint={lmv?'CAL/LMV/DD-MM-YY/001 · Assigned on save':vehicle?'VLB_M/DDTH-MMMYY/{S1|S2|S3|D|N}/001 · Assigned on save':'CAL/ELB/DD-MM-YY/001 · Assigned on save'}><output className="logbook-book-number">{saved?.book_no||'AUTO'}</output></Field>
<Field label="Project name"><input maxLength={500} value={form.projectName||form.location} onChange={e=>update('projectName',e.target.value)}/></Field>
<Field label={vehicle?'Door no.':'Equipment'} hint={asset?`${asset.name}${asset.registration?' · '+asset.registration:''}`:assetMessage||'Select from Equipment Master'}><DoorCombobox key={kind+':'+form.location} records={options?.assets||[]} kind={kind} location={form.location} value={form.assetId} onSelect={selectAsset} disabled={!editing||working} loading={loading} onUnmatched={lmv?null:written=>setAliasWritten(written)}/>{aliasWritten&&<ManualAliasDialog session={session} kind={kind} written={aliasWritten} site={form.location} assets={options?.assets||[]} otpEnabled={Boolean(options?.equipmentAliasOtp)} onPaired={async asset=>{selectAsset(String(asset.id));setAliasWritten('');try{setOptions(await api('/api/log-books/options'));}catch{}}} onDismiss={()=>setAliasWritten('')}/>}</Field>
<Field label="Wo.Cont." hint={eligibleWorkOrders.length===1?'Latest work order for this location/date':eligibleWorkOrders.length>1?'Latest eligible work order selected; equal-date ties require selection':'No matching Work Order available'}><SmartSelect showOverflowValue disabled={!editing||working} value={form.workOrderId||''} onChange={e=>update('workOrderId',e.target.value)}><option value="">Select Work Order / Contract</option>{eligibleWorkOrders.map(row=><option key={row.id} value={row.id}>{row.number}</option>)}</SmartSelect></Field>
<Field label="Employee ID / Caliber ID" hint="Enter either ID to fetch the employee name"><SmartSelect searchable showOverflowValue name="employeeId" aria-label="Employee ID / Caliber ID" disabled={!editing||working||!form.location} required value={form.employeeId} onChange={e=>{update('employeeId',e.target.value);const row=options?.employees.find(r=>r.id===e.target.value);if(row)setSuccess((vehicle?'Driver':'Operator')+' found: '+row.name+' · '+row.caliberId);}}><option value="">Select employee at this location</option>{(options?.employees||[]).filter(row=>employeeAtLocation(row,form.location)).map(row=><option key={row.id} value={row.id}>{row.caliberId||row.employeeCode}{row.caliberCode?' / '+row.caliberCode:''} · {row.name}</option>)}</SmartSelect></Field>
<Field label="Shift" hint={manualShiftError||(form.cardShift?'Batch shift: '+(CARD_SHIFTS[form.cardShift]?.label||form.cardShift):'Location-specific Shift Master')}><SmartSelect showOverflowValue name="shiftId" searchable disabled={!editing||working} required={!vehicle||Boolean(form.scanCardId)} value={form.manualShift?'manual:'+form.manualShift:form.shiftId} onChange={e=>{if(e.target.value.startsWith('manual:')){update('manualShift',e.target.value.slice(7));return;}update('manualShift','');update('shiftId',e.target.value);}}><option value="">Select shift</option>{MANUAL_SHIFTS.map(shift=><option key={shift.value} value={'manual:'+shift.value}>{shift.label}</option>)}{shifts.map(shift=><option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}–{shift.endTime}</option>)}</SmartSelect></Field>
<Field label={vehicle?'Driver name':'Operator name'} skipEnter><SmartSelect showOverflowValue disabled={!editing||working} required value={form.employeeId} onChange={e=>update('employeeId',e.target.value)}><option value="">Select {vehicle?'driver':'operator'}</option>{options?.employees.filter(row=>employeeAtLocation(row,form.location)&&(!vehicle||(/\b(?:driver|operator)\b/i.test(row.designation)&&!/\bhelpers?\b/i.test(row.designation)))).map(row=><option key={row.id} value={row.id}>{row.name}{row.caliberId?' · '+row.caliberId:''}</option>)}</SmartSelect></Field>
<Field label="Shift Hrs"><SmartSelect showOverflowValue name="shiftHours" disabled={!editing||working} required={kind!=='vehicle'} value={form.shiftHours} onChange={e=>{update('shiftHours',e.target.value?Number(e.target.value):'');}}>{kind==='vehicle'&&<option value="">Use batch hours</option>}<option value={8}>8 Hrs</option><option value={12}>12 Hrs</option></SmartSelect></Field>
<Field label={vehicle?'A Form no. (Trip Card)':'Job Card no.'}><input maxLength={200} value={(vehicle?form.aFormNo:form.jobCardNo)||''} onChange={e=>update(vehicle?'aFormNo':'jobCardNo',e.target.value)} placeholder={vehicle?'Enter A Form number':'Enter Job Card number'}/></Field>
{vehicle&&<><Field label="Opening KMR"><input type="number" step="0.001" required value={form.openingKmr} onChange={e=>update('openingKmr',e.target.value)}/></Field>
<Field label="Closing KMR"><input type="number" step="0.001" required value={form.closingKmr} onChange={e=>update('closingKmr',e.target.value)}/></Field>
{replacedKmr&&<Field label="Actual distance (km)" hint="KMR meter replaced during the shift"><input type="number" min="0" max="250" step="0.001" required value={form.replacementKmr??''} onChange={e=>update('replacementKmr',e.target.value)}/></Field>}
</>}<Field label="Opening HMR"><input type="number" step="0.001" required={!lmv} value={form.openingHmr} onChange={e=>update('openingHmr',e.target.value)}/></Field>
<Field label="Closing HMR"><input type="number" step="0.001" required={!lmv} value={form.closingHmr} onChange={e=>update('closingHmr',e.target.value)}/></Field>
<Field label="Remark"><textarea rows={2} maxLength={4000} value={form.remark} onChange={e=>update('remark',e.target.value)}/></Field>{vehicle&&<><Field label="Total running KMR"><output>{fixed(kmr)}</output></Field><div className="logbook-sheet-spacer"/></>}<Field label="Total working HMR"><output>{fixed(hmr)}</output></Field>
     </div></section>

     {assetMessage&&<div className="logbook-message logbook-master-help" role="status"><p>{assetMessage}</p><a href="?page=master-sync" target="_blank" rel="noopener noreferrer">Open master sync</a></div>}
     {vehicle&&<section className="logbook-section logbook-vehicle-trips"><div className="logbook-section-title"><h2>Detail · vehicle trips</h2><div className="logbook-trip-actions"><label>With time / Without time<SmartSelect showOverflowValue disabled={!editing||working} aria-label="Trip time entry" value={form.timeMode} onChange={e=>update('timeMode',e.target.value)}><option value="with">With time</option><option value="without">Without time</option></SmartSelect></label><button type="button" data-enter-action="add-trip" onClick={addTrip} disabled={form.trips.length>=300}><Plus size={15}/>Add trip</button></div></div>


       <div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Tr.Sr.No</th><th>Equipment</th><th>Job type / Work Contract</th>{form.timeMode==='with'&&<><th title="Loading time">L. time</th><th title="Unloading time">U. time</th></>}<th>Trips</th>{form.timeMode==='with'&&<th title="Gap to previous trip in minutes">GAP (min)</th>}<th>Remark</th><th/></tr></thead><tbody>

         {form.trips.map((row,index)=><tr key={index}><td className="logbook-trip-serial">{tripSerialNumber(row,index)}</td><td><SmartSelect searchable aria-label={`Equipment name row ${index+1}`} required={!isEmptyTripPlaceholder(row)&&tripEquipmentRequired(row,form.timeMode)} data-enter-empty-trip={isEmptyTripPlaceholder(row)||undefined} data-trip-equipment={index} disabled={!editing||working||!form.location} value={row.equipmentName} onChange={e=>setTrip(index,'equipmentName',e.target.value)}><option value="">Select equipment name</option>{row.equipmentName&&!tripEquipmentValues.has(row.equipmentName)&&<option value={row.equipmentName}>{row.equipmentName}</option>}{tripEquipmentOptions.map(asset=><option key={asset.id} value={machineLabel(asset.door||asset.name)} data-display-label={asset.door?machineLabel(asset.door):asset.name}>{asset.name}{asset.door?' · '+asset.door:''}</option>)}</SmartSelect>{!editing&&row.tripStatus&&<small>{row.tripStatus==='closed'?'Closed':row.tripStatus==='open'?'Open · awaiting unloading':row.tripStatus==='partly-closed'?'Partly closed':'Unloading carry-over'}{row.handoverLinks?.map((link,n)=><span key={n}><br/>{link.role==='loading'?'Unloaded by ':'Loaded by '}{link.counterpart.driverName} · {link.counterpart.bookNo} · {link.counterpart.date} · {link.loadingTime} → {link.unloadingTime} · {display(link.durationMinutes)} min · {link.tripCount} trip(s)</span>)}</small>}</td><td><WorkOrderJobSelect row={row} contracts={tripContracts} label={`Trip job type row ${index+1}`} disabled={!editing||working} onChange={job=>update("trips",form.trips.map((trip,i)=>i===index?{...trip,...job}:trip))}/></td>{form.timeMode==='with'&&<><td><input type="text" inputMode="numeric" placeholder="HH:MM" maxLength="5" pattern="\d{1,2}:\d{2}" aria-label={`Loading time row ${index+1}`} title={shiftTimeHint&&`Allowed shift time: ${shiftTimeHint}`} required={!isEmptyTripPlaceholder(row)&&!row.unloadingTime} value={shiftTimeInputValue(row.loadingTime)} onChange={e=>setTrip(index,'loadingTime',fixedMinuteInput(e.target.value))} onBlur={e=>{const value=resolveShiftTime(e.currentTarget.value,selectedShift);e.currentTarget.setCustomValidity(!value||timeWithinShift(value,selectedShift)?'':`Enter a time within the selected shift (${shiftTimeHint}).`);setTrip(index,'loadingTime',value)}}/></td><td><input type="text" inputMode="numeric" placeholder="HH:MM" maxLength="5" pattern="\d{1,2}:\d{2}" aria-label={`Unloading time row ${index+1}`} title={shiftTimeHint&&`Allowed shift time: ${shiftTimeHint}`} required={!isEmptyTripPlaceholder(row)&&!row.loadingTime} value={shiftTimeInputValue(row.unloadingTime)} onChange={e=>setTrip(index,'unloadingTime',fixedMinuteInput(e.target.value))} onBlur={e=>{const value=resolveShiftTime(e.currentTarget.value,selectedShift);e.currentTarget.setCustomValidity(!value||timeWithinShift(value,selectedShift)?'':`Enter a time within the selected shift (${shiftTimeHint}).`);setTrip(index,'unloadingTime',value)}}/></td></>}<td><input type="number" min="1" step="1" aria-label={`No. of trips row ${index+1}`} required value={row.tripCount} onChange={e=>setTrip(index,'tripCount',e.target.value)}/></td>{form.timeMode==='with'&&<td>{display(interTripGap(form.trips,index))}</td>}<td><input aria-label={`Trip remark row ${index+1}`} maxLength={2000} value={row.remark||''} onChange={e=>setTrip(index,'remark',e.target.value)} onKeyDown={e=>continueManualRemark(e,form.trips,index,blankTrip,rows=>update('trips',rows),'data-trip-equipment')}/></td><td><button type="button" className="logbook-remove" aria-label={`Remove trip row ${index+1}`} onClick={()=>update('trips',form.trips.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></td></tr>)}

         {!form.trips.length&&<tr><td colSpan={form.timeMode==='with'?9:6} className="logbook-empty">No trip rows added. Use Add trip to enter loading and unloading details.</td></tr>}

       </tbody></table></div><div className="logbook-trip-totals"><span>Total records / trips · Records: <strong>{form.trips.filter(row=>!isEmptyTripPlaceholder(row)).length}</strong></span><span>Counted trips: <strong>{!editing&&saved?saved.data.completedTrips??saved.data.totalTrips:form.trips.filter(row=>!isEmptyTripPlaceholder(row)).reduce((sum,row)=>sum+vlbCountedTrips(row,form.timeMode),0)}</strong></span>{form.timeMode==='with'&&<small>GAP = this loading time − previous unloading time. First row has no previous trip; overnight gaps continue into the next day.</small>}</div>

     </section>}


     {vehicle&&!editing&&saved&&<div className="logbook-trip-totals"><span>Opening trips (loaded): <strong>{saved.data.openingTrips??0}</strong></span><span>Ending trips (unloaded): <strong>{saved.data.endingTrips??0}</strong></span><span>Counted trips: <strong>{saved.data.completedTrips??saved.data.totalTrips}</strong></span></div>}
     {vehicle&&<details className="logbook-section logbook-machine-details"><summary>Machine-wise summary · {machineTripTotal(form.trips)} trips</summary><div className="logbook-section-title"><h2>Machine-wise summary</h2><span>Calculated from trip details</span></div><table className="logbook-table"><thead><tr><th>Equipment name</th><th>Total trips</th></tr></thead><tbody>{machineSummary(equipmentValidation.draft.trips).map(row=><tr key={row.equipmentName}><td>{row.equipmentName}</td><td>{row.tripCount}</td></tr>)}</tbody><tfoot><tr><th scope="row">Total trips</th><td>{machineTripTotal(form.trips)}</td></tr></tfoot></table></details>}
     <ManualLogBookDetails contracts={tripContracts} form={form} update={update} vehicle={vehicle} editing={editing&&!working} setWorking={setWorking} onError={setError}/>
     {vehicle&&form.assetId&&form.location&&form.bookDate&&form.shiftId&&<section className="logbook-section" aria-label="Pulse maintenance">
      <div className="logbook-section-title"><h2>Pulse maintenance</h2><button type="button" disabled={working||hoursLoading} onClick={()=>setHoursRefresh(value=>value+1)}>Refresh Pulse status</button></div>
      <p role="status">{hoursLoading?'Checking Pulse maintenance status…':!hours?'Pulse maintenance status unavailable.':vehicleInMaintenance?'Vehicle in maintenance in Pulse.':pulseBreakdowns.length?'Pulse shows the vehicle was restored.':'Pulse shows no downtime for this vehicle in the selected shift.'}</p>
      {!hoursLoading&&pulseBreakdowns.length>0&&<ul>{pulseBreakdowns.map(request=><li key={request.reference||request.start}>{request.reference&&<strong>{request.reference} · </strong>}{request.description} · {request.ongoing?'Open':'Restored'}</li>)}</ul>}
      {!hoursLoading&&pulseBreakdowns.length>0&&(!saved||editing?<p>Save the trips and meter readings for this driver and vehicle before starting another card.</p>:<div className="logbook-header-actions">
       <button type="button" disabled={working} onClick={()=>startHandover(true)}>New card for same driver</button>
       {!vehicleInMaintenance&&<button type="button" disabled={working} onClick={()=>startHandover(false)}>New card for next driver</button>}
      </div>)}
     </section>}
     {<section className="logbook-section logbook-hours-summary"><div className="logbook-section-title"><h2>Hours summary</h2><span>{hoursLoading?'Fetching Pulse BD hours…':hours?.breakdownHours!=null?'Source: Pulse · selected location / door / date / shift':hoursError||hours?'Pulse unavailable · manual BD entry available':`Select ${vehicle?'vehicle':'equipment'}, date and shift`}</span></div><div className="logbook-fields"><Field label="Availability HRS" hint="Closing HMR − opening HMR"><output>{fixed(hmr)}</output></Field><Field label="Running HRS" hint="Closing HMR − opening HMR"><output>{fixed(hmr)}</output></Field><Field label="BD HRS"><BreakdownHoursField pulse={hours} loading={hoursLoading} error={hoursError} ready={Boolean(form.assetId&&form.shiftId&&form.bookDate&&form.location)} manualValue={form.manualBreakdownHours} savedValue={saved?.data.breakdownHours} shiftHours={form.shiftHours} disabled={!editing||working} readOnly={!editing} onChange={value=>update('manualBreakdownHours',value)}/></Field><Field label="Idle HRS" hint="Shift hours − working HMR"><output>{fixed(hmr==null?null:Number(form.shiftHours)-hmr)}</output></Field></div>{hoursError&&<p className="logbook-message">{hoursError} Enter BD hours manually in the field above if needed. Availability and idle calculations still use the meter readings.</p>}{hours?.warnings?.filter(w=>!/Working hours exceed the selected shift/.test(w)).map(w=><p key={w} className="logbook-message error">{w}</p>)}<p className="logbook-note">Breakdown intervals are restricted to the selected shift and overlapping requests are counted once. If Pulse is unavailable, BD hours can be entered manually. A zero returned by Pulse is kept as zero.</p></section>}
     {vehicle&&fleetReconciliation&&<details className="scan-fleet-reconciliation"><summary>Site fleet · VLB, breakdown and idle details</summary>{fleetReconciliation}</details>}


     </fieldset><footer className="logbook-save-bar"><span>{saved?`${saved.book_no} · Revision ${saved.revision}`:'Book number will be generated on save.'}</span>{inlineEdit&&<button type="button" disabled={working} onClick={onExit}>Cancel</button>}<button className="primary" data-enter-action="save" type="submit" disabled={!editing||working||loading||!options}><Save size={16}/>{working?'Saving…':saved?'Save changes':'Save log book'}</button></footer>

   </form>

   <section hidden={!registerOpen} className="logbook-section logbook-register"><div className="logbook-section-title"><h2>Saved log books</h2><input aria-label="Search saved log books" placeholder="Search book, door, employee or site…" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Book NO</th><th>Date</th><th>Location</th><th>Door NO</th><th>Shift</th><th>{vehicle?'Driver':'Operator'}</th><th>Work HMR</th>{vehicle&&<><th>Opening trips</th><th>Ending trips</th><th>Counted trips</th></>}<th/></tr></thead><tbody>{filtered.map(row=><tr key={row.id}><td>{row.book_no}</td><td>{row.data.bookDate}</td><td>{row.data.location}</td><td>{row.data.door}</td><td>{row.data.shiftName}</td><td>{row.data.employeeName}</td><td>{display(row.data.totalWorkingHmr)}</td>{vehicle&&<><td>{display(row.data.openingTrips)}</td><td>{display(row.data.endingTrips)}</td><td>{display(row.data.completedTrips??row.data.totalTrips)}</td></>}<td><button type="button" onClick={()=>openEntry(row)}>Open</button></td></tr>)}{!filtered.length&&<tr><td colSpan={vehicle?11:8} className="logbook-empty">No saved entries found.</td></tr>}</tbody></table></div>{nextCursor&&<button type="button" onClick={()=>void loadRegister(nextCursor).catch(e=>setError(e.message))}>Load older entries</button>}</section>

 </section>;

}



