// Attendance Management and Attendance Regularization (owner, 20 Nov 2026).
//  - Biometric integration: upload the biometric device export, see the punches kept.
//  - Mismatch attendance: biometric punches against trip card / log book attendance.
//  - Late come / early going and Miss punch (Attendance Regularization): read from the same punches.
// The comparing rules are in shared/attendance-mismatch.mjs.
import React,{useEffect,useMemo,useState} from 'react';
import {Upload} from 'lucide-react';
import {DateShiftGrid,dateShiftGrid,dateShiftExport} from './date-shift-grid.jsx';
import {shiftChoiceLabel} from '../shared/report-filter-options.mjs';
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {compareAttendance,mismatchShifts,mismatchSites,parseBiometricSheet,MISMATCH_TYPES,REGULARIZATION_TYPES,GRACE_MINUTES,SHIFT_WINDOW_MINUTES} from '../shared/attendance-mismatch.mjs';
import './attendance-management.css';

export const ATTENDANCE_PAGES={
 'Biometric integration':{group:'Attendance Management'},
 'Mismatch attendance':{group:'Attendance Management',types:MISMATCH_TYPES,name:'Mismatch attendance'},
 'Late come / early going':{group:'Attendance Regularization',types:REGULARIZATION_TYPES['late-early'],name:'Late come / early going'},
 'Miss punch':{group:'Attendance Regularization',types:REGULARIZATION_TYPES['miss-punch'],name:'Miss punch'},
};

const MAX_DAYS=31;
const todayIst=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10);
const monthStart=d=>{const s=d.slice(0,8)+'01';return s<OPERATIONAL_START?OPERATIONAL_START:s;};
const dmy=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d))?d.slice(8,10)+'-'+d.slice(5,7)+'-'+d.slice(0,4):String(d||'');
const shiftName=code=>shiftChoiceLabel(code)||code||'—';
const blank=v=>v===null||v===undefined||v==='';
const column=(key,label,value,render)=>({key,label,value:value||(r=>blank(r[key])?'—':r[key]),...(render?{render}:{})});
const rangeValid=({from,to})=>from>=OPERATIONAL_START&&to>=from&&(Date.parse(to)-Date.parse(from))/86400000<=MAX_DAYS-1;

async function readJson(url,session,options={}){
 const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+session.token,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw Object.assign(Error(payload.error||'Unable to read attendance.'),{payload});
 return payload;
}

function DateRange({filters,setFilters,busy,onRefresh}){
 const set=(k,v)=>setFilters(f=>({...f,[k]:v}));
 return <div className="production-filters am-filters">
  <label>From<input type="date" min={OPERATIONAL_START} max={todayIst()} value={filters.from} onChange={e=>set('from',e.target.value)}/></label>
  <label>To<input type="date" min={filters.from||OPERATIONAL_START} max={todayIst()} value={filters.to} onChange={e=>set('to',e.target.value)}/></label>
  <button type="button" disabled={busy||!rangeValid(filters)} onClick={onRefresh}>{busy?'Reading…':'Refresh'}</button>
  {!rangeValid(filters)&&<p className="am-error" role="alert">Select dates from {dmy(OPERATIONAL_START)}, up to {MAX_DAYS} days.</p>}
 </div>;
}

const punchColumns=[column('date','Date',r=>dmy(r.date)),column('caliberCode','Employee code'),column('aFormNo','A Form no.'),column('employeeName','Name'),column('site','Site'),column('inTime','In'),column('outTime','Out'),column('sourceFile','File'),column('uploadedBy','Uploaded by')];

export function BiometricIntegration({session,ReportSection}){
 const [filters,setFilters]=useState(()=>({from:monthStart(todayIst()),to:todayIst()}));
 const [state,setState]=useState({rows:null,error:'',busy:false}),[refresh,setRefresh]=useState(0);
 const [upload,setUpload]=useState({busy:false,notice:'',error:'',refused:[]});
 // What the code column of the device file is. 'auto' lets the server find it per site from Employee Master and A Form Master.
 const [codeKind,setCodeKind]=useState('auto');
 useEffect(()=>{
  if(!rangeValid(filters))return;
  let live=true;setState(s=>({...s,busy:true,error:''}));
  readJson('/api/reports/biometric-punches?'+new URLSearchParams(filters),session).then(p=>live&&setState({rows:p.punches,error:'',busy:false}),e=>live&&setState({rows:null,error:e.message,busy:false}));
  return()=>{live=false};
 },[filters.from,filters.to,refresh,session.token]);
 const choose=async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  setUpload({busy:true,notice:'',error:'',refused:[]});
  try{
   let sheet;
   if(/\.csv$/i.test(file.name))sheet=csvRows(await file.text());
   else{const {default:readXlsxFile}=await import('read-excel-file');sheet=await readXlsxFile(file);}
   const {punches,errors}=parseBiometricSheet(sheet);
   if(!punches.length)throw Error('No punch line was found in '+file.name+'.');
   const saved=await readJson('/api/reports/biometric-punches',session,{method:'POST',body:JSON.stringify({fileName:file.name,rows:punches,codeKind})});
   const dates=punches.map(p=>p.date).sort();
   const changed=(saved.sites||[]).filter(row=>row.kind==='aform').map(row=>`${row.site}: ${row.converted} A Form no. changed to the CMLL id`).join('; ');
   setUpload({busy:false,error:'',refused:[...errors.slice(0,20),...(saved.leftOutLines||[])],notice:`${saved.saved} punch line(s) saved from ${file.name} (${dmy(dates[0])} to ${dmy(dates.at(-1))}).`+(changed?` ${changed}.`:'')+(saved.leftOut?` ${saved.leftOut} line(s) left out: their A Form no. is not one person in A Form Master.`:'')+(errors.length?` ${errors.length} line(s) skipped.`:'')});
   setRefresh(n=>n+1);
  }catch(error){setUpload({busy:false,notice:'',error:error.message,refused:error.payload?.refused||[]});}
 };
 return <section className="production-reports am-page">
  <header><small>ATTENDANCE MANAGEMENT / ATTENDANCE FETCH</small><h1>Biometric integration</h1>
   <p>Upload the attendance export of the biometric device (Excel or CSV). Columns read: Employee code, Date, In time, Out time, Site and Name; or one line per punch with Employee code and Punch time (first punch In, last punch Out). Uploading the same employee and date again replaces the earlier punch. If the device gives the A Form no. instead of the CMLL id, it is changed to the CMLL id of that site from A Form Master; the file then needs the Site column.</p></header>
  <div className="am-upload">
   <label className={'am-upload-button'+(upload.busy?' busy':'')}><Upload size={16}/>{upload.busy?'Uploading…':'Upload biometric file'}<input type="file" accept=".xlsx,.csv" disabled={upload.busy} onChange={choose}/></label>
   <label className="am-code-kind">Employee code in the file<select value={codeKind} disabled={upload.busy} onChange={e=>setCodeKind(e.target.value)}><option value="auto">Find by itself</option><option value="caliber">CMLL id (Caliber ID)</option><option value="aform">A Form no.</option></select></label>
   {upload.notice&&<p className="am-notice" role="status">{upload.notice}</p>}
   {upload.error&&<p className="am-error" role="alert">{upload.error}</p>}
   {upload.refused.length>0&&<ul className="am-refused">{upload.refused.map(l=><li key={l}>{l}</li>)}</ul>}
  </div>
  <DateRange filters={filters} setFilters={setFilters} busy={state.busy} onRefresh={()=>setRefresh(n=>n+1)}/>
  {state.error&&<p className="am-error" role="alert">{state.error}</p>}
  <ReportSection key={'bio-'+filters.from+filters.to} reportKey="Biometric punches" title={'Biometric punches · '+dmy(filters.from)+' to '+dmy(filters.to)} category="attendance-biometric"
   description="One line per employee and date as kept from the uploaded files." rows={state.rows||[]} dataReady={Boolean(state.rows)} columns={punchColumns}
   rowKey={r=>r.caliberCode+'|'+r.date} emptyMessage={state.busy?'Reading punches…':'No biometric punch uploaded for these dates.'}/>
 </section>;
}

// A simple CSV reader: commas, quoted cells with "" inside.
export function csvRows(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;continue;}
  if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;
 }
 if(cell!==''||row.length){row.push(cell);rows.push(row);}
 return rows;
}

const RULES={
 'Mismatch attendance':`Trip card / log book attendance (locked site-days only, as in the Attendance register) against the biometric punches, by employee code and date. No biometric punch: on duty on the trip card, no punch. No trip card: punched, no trip card, log book or zero-trip entry. Different site: punched at another site. Different shift: the In punch is more than ${SHIFT_WINDOW_MINUTES/60} hours from the trip card shift start.`,
 'Late come / early going':`Shift times from the Shift Master of the trip card's site. Late come: In punch more than ${GRACE_MINUTES} minutes after the shift start. Early going: Out punch more than ${GRACE_MINUTES} minutes before the shift end.`,
 'Miss punch':'A day with an In punch and no Out punch, or an Out punch and no In punch, on the biometric device.',
};
const EVERY='*';

export function AttendanceComparison({session,ReportSection,page}){
 const {types,name}=ATTENDANCE_PAGES[page];
 const [filters,setFilters]=useState(()=>({from:monthStart(todayIst()),to:todayIst()}));
 const [state,setState]=useState({data:null,error:'',busy:false}),[refresh,setRefresh]=useState(0);
 const [site,setSite]=useState(''),[slot,setSlot]=useState(null),[only,setOnly]=useState('');
 useEffect(()=>{
  if(!rangeValid(filters))return;
  let live=true;setState(s=>({...s,busy:true,error:''}));setSite('');setSlot(null);
  const q=new URLSearchParams({...filters,shiftDates:'1'});
  Promise.all([readJson('/api/reports/biometric-punches?'+q,session),readJson('/api/reports/manpower/attendance?'+new URLSearchParams({...filters,view:'attendance'}),session)])
   .then(([bio,att])=>live&&setState({busy:false,error:'',data:{punches:bio.punches,masters:bio.masters,duties:[...(att.otDuties||[]),...(att.attendanceEquipment||[])],lockedDays:att.lockedDays||[]}}),
    e=>live&&setState({busy:false,error:e.message,data:null}));
  return()=>{live=false};
 },[filters.from,filters.to,refresh,session.token]);
 const result=useMemo(()=>state.data?compareAttendance({...state.data,...filters}):{lines:[],noCode:0},[state.data]);
 const shown=types.filter(t=>!only||t.key===only),lines=result.lines.filter(l=>shown.some(t=>t.key===l.type));
 const sites=mismatchSites(lines,shown),siteLines=site===EVERY?lines:lines.filter(l=>(l.siteKey)===site);
 const total={id:'total',key:EVERY,site:'All sites',total:lines.length,...Object.fromEntries(shown.map(t=>[t.key,lines.filter(l=>l.type===t.key).length])),isTotal:true};
 const grid=dateShiftGrid(mismatchShifts(siteLines,shown),{sumKeys:['total',...shown.map(t=>t.key)]});
 const boxes=shown.map(t=>({key:t.key,label:t.label,className:'am-box am-'+t.tone}));
 const dayColumns=[{key:'total',label:'Total',value:t=>t.total}];
 const gridExport=dateShiftExport(grid,{count:r=>r.total,countLabel:'Findings',boxes,dayColumns,shiftLabel:shiftName});
 const stepLines=slot?siteLines.filter(l=>l.date===slot.date&&(l.shift||'—')===slot.shift&&(!slot.type||l.type===slot.type)):siteLines;
 const siteLabel=site===EVERY?'All sites':sites.find(s=>s.key===site)?.site||site;
 const period=dmy(filters.from)+' to '+dmy(filters.to);
 const openSite=(r,type)=>{setSite(r.isTotal?EVERY:r.key);setSlot(null);if(type)setOnly(type);};
 const count=t=>(r=>r[t.key]>0?<span className={'am-count am-'+t.tone}>{r[t.key]}</span>:r[t.key]);
 const siteColumns=[column('site','Site'),column('total','Findings'),...shown.map(t=>column(t.key,t.label,r=>r[t.key],count(t)))];
 const typeBadge=r=>{const t=types.find(x=>x.key===r.type);return <span className={'am-count am-'+(t?.tone||'')}>{r.label}</span>;};
 const lineColumns=[column('date','Date',r=>dmy(r.date)),column('shift','Shift',r=>shiftName(r.shift)),...(site===EVERY?[column('site','Site')]:[]),column('caliberCode','Employee code'),column('employeeName','Name'),
  column('label','Finding',r=>r.label,typeBadge),column('inTime','Biometric In'),column('outTime','Biometric Out'),column('punchSite','Punch site'),column('tripSite','Trip card site'),column('tripShift','Trip card shift',r=>r.tripShift?r.tripShift.split(', ').map(shiftName).join(', '):'—'),
  column('doors','Door / equipment',r=>[r.doors,r.equipment].filter(Boolean).join(' · ')||'—'),column('books','Trip cards'),column('detail','Detail')];
 return <section className="production-reports am-page">
  <header><small>{ATTENDANCE_PAGES[page].group.toUpperCase()}</small><h1>{name}</h1><p>{RULES[page]}</p></header>
  <DateRange filters={filters} setFilters={setFilters} busy={state.busy} onRefresh={()=>setRefresh(n=>n+1)}/>
  {state.error&&<p className="am-error" role="alert">{state.error}</p>}
  {state.busy&&<p role="status">Reading biometric punches and trip card attendance…</p>}
  {state.data&&<>
   {!state.data.punches.length&&<p className="am-notice" role="status">No biometric punch is uploaded for these dates. Upload the device export on Attendance Management › Biometric integration.</p>}
   {result.noCode>0&&<p className="am-notice" role="status">{result.noCode} trip card line(s) have no employee code and cannot be matched with the biometric punches.</p>}
   {types.length>1&&<nav className="am-chips" aria-label="Show only">{[{key:'',label:'All',tone:''},...types].map(t=><button key={t.key||'all'} type="button" className={t.tone?'am-'+t.tone:''} aria-current={only===t.key?'page':undefined} onClick={()=>{setOnly(t.key);setSlot(null);}}>{t.label} · {t.key?result.lines.filter(l=>l.type===t.key).length:result.lines.filter(l=>types.some(x=>x.key===l.type)).length}</button>)}</nav>}
   <ReportSection key={'am-sites-'+page+only} reportKey={name+' sites'} title={'Step 1 · '+name+' · All sites · '+period} category="attendance-mismatch-sites"
    description="One line per site, the most findings on top. Press a site to see it date by date and shift by shift." rows={sites.length?[...sites,total]:[]} columns={siteColumns}
    rowKey={r=>r.id} rowClassName={r=>(r.isTotal?'tt-total':'')+((r.isTotal?site===EVERY:site===r.key)?' report-row-picked':'')} isTotalRow={r=>r.isTotal} onRowClick={r=>openSite(r)} emptyMessage="Nothing found in these dates."/>
   {site&&<ReportSection key={'am-grid-'+page+site+only} reportKey={name+' shifts'} title={'Step 2 · '+name+' · '+siteLabel+' · date by shift · '+period} category="attendance-mismatch-shifts"
    description="In each box: the findings, then each kind in its colour. Press a number or a colour to see those people below." rows={gridExport.rows} columns={gridExport.columns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <DateShiftGrid grid={grid} count={r=>r.total} countLabel="Findings" boxes={boxes} dayColumns={dayColumns} shiftLabel={shiftName}
     onOpen={(r,type)=>setSlot({date:r.date,shift:r.shift,type})} onOpenAll={()=>setSlot(null)} isPicked={r=>slot?.date===r.date&&slot?.shift===r.shift} pickedBox={slot?.type||''} allPicked={!slot}
     ariaLabel={name+' by date and shift'} emptyMessage="Nothing found here."/>
   </ReportSection>}
   {site&&<ReportSection key={'am-lines-'+page+site+(slot?slot.date+slot.shift+slot.type:EVERY)+only} reportKey={name+' people'} title={'Step 3 · '+name+' · '+siteLabel+' · '+(slot?dmy(slot.date)+' · '+shiftName(slot.shift):'all dates and shifts')}
    category="attendance-mismatch-people" description="One line per finding: the biometric punch beside the trip card attendance." rows={stepLines} columns={lineColumns} rowKey={r=>r.id} emptyMessage="Nothing found here."/>}
  </>}
 </section>;
}
