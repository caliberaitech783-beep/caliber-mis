// Attendance Sheet Mismatch (owner, 25 Nov 2026): two checks on one tab, chosen by two buttons at the top.
//   HR sheet vs Biometric (first): the attendance Excel HR makes by hand against the biometric HR Pulse holds after the
//     device upload (or a device file uploaded here), the same process as Site Sheet vs Trip Card: 1 · the HR Excel,
//     2 · the biometric, 3 · the site, Check. Then, in the owner's step pattern:
//       Step 1  the site: the HR sheet's P days, days punched, same in both, each mismatch, ID / name, punched not in sheet
//       Step 2  date by shift (the HR sheet has dates only, so one column): mismatches with a coloured box per kind,
//               the day's P, punched and same
//       Step 3  the people of the box pressed (trip card shown beside a driver or operator, never counted)
//       Step 4  one person day by day
//   Trip card vs Biometric: the earlier check of this tab (src/attendance-sheet-check.jsx), unchanged.
// Nothing is changed in Pulse-II. Rules: shared/hr-sheet-biometric.mjs; reads: src/hr-sheet-biometric-run.mjs.
import React,{useEffect,useMemo,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {dmy} from '../shared/attendance-sheet-check.mjs';
import {HR_KINDS,hrKindLabel,hrPersonDays} from '../shared/hr-sheet-biometric.mjs';
import {readAttendanceFile,sheetApi} from './attendance-sheet-run.mjs';
import {readBiometricFile,SOURCE_CHOICES} from './trip-biometric-run.mjs';
import {runHrSheetBiometricCheck} from './hr-sheet-biometric-run.mjs';
import {DateShiftGrid,dateShiftExport,dateShiftGrid} from './date-shift-grid.jsx';
import {downloadBlob} from './download-history.mjs';
import AttendanceSheetCheck from './attendance-sheet-check.jsx';
import './attendance-sheet-check.css';
import './hr-sheet-biometric.css';

const many=(n,one,more=one+'s')=>n.toLocaleString('en-IN')+' '+(n===1?one:more);
const col=(key,label,extra={})=>({key,label,value:r=>r[key]===''||r[key]===undefined||r[key]===null?'—':r[key],...extra});
const TONE=Object.fromEntries(HR_KINDS.map(k=>[k.key,k.tone]));
const KIND_KEYS=HR_KINDS.map(k=>k.key);
const noPick={kind:'',date:'',box:'',all:false,person:'',list:''};
const NO_SHIFT='all';
const shiftLabel=()=>'Mismatches';
export const MODES=[{key:'hr',label:'HR sheet vs Biometric',about:'The HR attendance Excel against the punches'},{key:'trip',label:'Trip card vs Biometric',about:'Drivers and operators: trip cards against the punches'}];

// The tab: two buttons, then the check chosen. Each keeps its own state while the other is open.
export function AttendanceSheetMismatch({session,ReportSection}){
 const [mode,setMode]=useState('hr');
 return <div className="asc-page">
  <div className="hsb-modes" role="tablist" aria-label="Which check">
   {MODES.map(m=><button key={m.key} type="button" role="tab" aria-selected={mode===m.key} onClick={()=>setMode(m.key)}><b>{m.label}</b><span>{m.about}</span></button>)}
  </div>
  <div hidden={mode!=='hr'}><HrSheetBiometric session={session} ReportSection={ReportSection}/></div>
  <div hidden={mode!=='trip'}><AttendanceSheetCheck session={session}/></div>
 </div>;
}

export default function HrSheetBiometric({session,ReportSection}){
 const [sites,setSites]=useState({list:null,error:''}),[site,setSite]=useState('');
 const [file,setFile]=useState({busy:false,name:'',sheet:null,error:''});
 const [bioWay,setBioWay]=useState('held'),[source,setSource]=useState('both');
 const [bioFile,setBioFile]=useState({busy:false,name:'',bio:null,error:''});
 const [run,setRun]=useState({busy:false,error:'',done:null});
 const [pick,setPick]=useState(noPick);
 useEffect(()=>{
  let live=true;
  sheetApi('/api/reports/manpower/attendance-sheet/sites',session).then(p=>{if(!live)return;setSites({list:p.sites||[],error:''});if(p.sites?.length===1)setSite(p.sites[0]);},e=>live&&setSites({list:[],error:e.message}));
  return()=>{live=false;};
 },[session.token]);
 const clear=()=>{setRun({busy:false,error:'',done:null});setPick(noPick);};
 const chooseSheet=async event=>{
  const picked=event.target.files?.[0];event.target.value='';if(!picked)return;
  clear();setFile({busy:true,name:picked.name,sheet:null,error:''});
  try{setFile({busy:false,name:picked.name,sheet:await readAttendanceFile(picked),error:''});}
  catch(error){setFile({busy:false,name:picked.name,sheet:null,error:error.message});}
 };
 const chooseBio=async event=>{
  const picked=event.target.files?.[0];event.target.value='';if(!picked)return;
  clear();setBioFile({busy:true,name:picked.name,bio:null,error:''});
  try{setBioFile({busy:false,name:picked.name,bio:await readBiometricFile(picked),error:''});}
  catch(error){setBioFile({busy:false,name:picked.name,bio:null,error:error.message});}
 };
 const sheet=file.sheet,useFile=bioWay==='file';
 const ready=Boolean(sheet&&site&&!run.busy&&!file.busy&&!bioFile.busy&&(!useFile||bioFile.bio));
 const check=async()=>{
  setRun({busy:true,error:'',done:null});setPick(noPick);
  try{
   const done=await runHrSheetBiometricCheck({sheet,fileName:file.name,site,source,session,...(useFile?{bio:bioFile.bio,bioName:bioFile.name}:{})});
   downloadBlob(done.blob,done.name,{title:done.title});
   setRun({busy:false,error:'',done});
  }catch(error){setRun({busy:false,error:error.message,done:null});}
 };
 const done=run.done,result=done?.result,bioRead=done?.biometric;
 const period=result?.dates.compared.length?dmy(result.dates.compared[0])+' to '+dmy(result.dates.compared.at(-1)):'';
 const way=pick.kind?hrKindLabel(pick.kind):'every mismatch';
 const rows=useMemo(()=>!result?[]:result.byDate.map(d=>pick.kind?{...d,total:d[pick.kind],...Object.fromEntries(KIND_KEYS.filter(k=>k!==pick.kind).map(k=>[k,0]))}:d),[result,pick.kind]);
 const grid=useMemo(()=>dateShiftGrid(rows,{sumKeys:['total','sheetP','punched','same',...KIND_KEYS],shiftOf:()=>NO_SHIFT}),[rows]);
 const boxes=pick.kind?[]:HR_KINDS.filter(k=>result?.counts[k.key]>0).map(k=>({key:k.key,className:'hsb-'+k.tone,label:k.label}));
 const dayColumns=[{key:'sheetP',label:'HR sheet P',value:s=>s.sheetP},{key:'punched',label:'Punched here',value:s=>s.punched},{key:'same',label:'P and punched',value:s=>s.same}];
 const exported=dateShiftExport(grid,{count:r=>r.total,countLabel:'mismatches',boxes,shiftLabel,dayColumns});
 const opened=pick.all||Boolean(pick.date);
 const listed=!opened||!result?[]:result.lines.filter(l=>(pick.all||l.date===pick.date)&&(pick.box?l.kind===pick.box:!pick.kind||l.kind===pick.kind))
  .map(l=>({...l,dateLabel:dmy(l.date),kindLabel:hrKindLabel(l.kind),markText:l.mark||'(blank)'}));
 const person=pick.person&&result?result.rows.find(r=>String(r.row)===String(pick.person)):null;
 const days=person?hrPersonDays(person).map(d=>({...d,dateLabel:dmy(d.date),markText:d.mark||'(blank)'})):[];
 const openKind=key=>setPick(p=>({...noPick,list:p.list,kind:p.kind===key?'':key}));
 const openList=key=>setPick(p=>({...p,list:p.list===key?'':key}));
 const numButton=(key,n,label,tone,pressed,onClick,unit='day')=><button type="button" className={'hsb-num hsb-'+tone} disabled={!n} aria-pressed={pressed} aria-label={label+' · '+n} onClick={onClick}>{n.toLocaleString('en-IN')}<small>{unit}{n===1?'':'s'}</small></button>;
 const siteRow=result?{id:'site',site:result.site,dates:result.dates.compared.length,people:result.totals.people,sheetP:result.totals.sheetP,punched:result.totals.punched,same:result.totals.same,...result.counts,issues:result.totals.issues,notInSheet:result.totals.notInSheet}:null;
 const siteColumns=[col('site','Site'),col('dates','Dates compared'),col('people','People in HR sheet'),col('sheetP','HR sheet P days'),col('punched','Days punched here'),col('same','P and punched'),
  ...HR_KINDS.map(k=>({key:k.key,label:k.label,value:r=>r[k.key],render:r=>numButton(k.key,r[k.key],k.label,k.tone,pick.kind===k.key,()=>openKind(k.key))})),
  {key:'issues',label:'EMP. ID / name to correct',value:r=>r.issues,render:r=>numButton('issues',r.issues,'EMP. ID / name to correct','orange',pick.list==='ids',()=>openList('ids'),'line')},
  {key:'notInSheet',label:'Punched here, not in HR sheet',value:r=>r.notInSheet,render:r=>numButton('notInSheet',r.notInSheet,'Punched here, not in HR sheet','teal',pick.list==='notInSheet',()=>openList('notInSheet'),'person')}];
 const where=pick.all?'All dates':dmy(pick.date);
 const step3Columns=[...(pick.all?[col('dateLabel','Date')]:[]),...(pick.box||pick.kind?[]:[col('kindLabel','Mismatch')]),col('empId','EMP. ID'),col('name','Name in HR sheet'),col('pulseName','Name in Pulse-II'),col('designation','Designation'),
  col('markText','HR sheet'),col('inTime','Punch IN'),col('outTime','Punch OUT'),col('punchSite','Punch site'),col('source','Biometric source'),
  ...(listed.some(l=>l.hrCorrection)?[col('hrCorrection','HR correction')]:[]),...(listed.some(l=>l.card)?[col('card','Trip card (shown only)')]:[])];
 const step4Columns=[col('dateLabel','Date'),col('markText','HR sheet'),col('inTime','Punch IN'),col('outTime','Punch OUT'),col('punchSite','Punch site'),col('source','Biometric source'),col('hrCorrection','HR correction'),col('card','Trip card (shown only)'),col('result','Result')];
 const idColumns=[col('row','Row in sheet'),col('id','EMP. ID'),col('name','Name in HR sheet'),col('pulseName','Name in Pulse-II'),col('designation','Designation'),col('label','Problem'),col('sheetSays','HR sheet says'),col('pulseSays','Pulse-II says')];
 const missColumns=[col('id','EMP. ID'),col('name','Name in Pulse-II'),col('designation','Designation'),col('days','Days punched'),col('datesLabel','Dates')];
 const download=()=>downloadBlob(done.blob,done.name,{title:done.title});

 return <div className="asc-page hsb-page">
  <p className="asc-intro">The attendance Excel HR makes by hand is set beside the biometric. Upload the HR sheet (one line per employee with EMP. ID, NAME and DESIGNATION, and one column per date marked P, A, WO, L …), choose where the punches come from and the site, and press Check. Everyone on the sheet is compared, staff and helpers too, on every marked date: <b>HR sheet P, no punch</b>, <b>miss punch</b>, <b>punch at another site</b>, and <b>punch, HR sheet not P</b>. A, WO, L, CO, H or blank with no punch is the same in both. Trip cards are shown beside a driver or operator, never counted. Nothing is changed in Pulse-II.</p>
  <div className="asc-steps hsb-steps">
   <section className="asc-step"><h2>1 · HR attendance Excel</h2>
    <label className={'asc-upload'+(file.busy?' busy':'')}><Upload size={16}/>{file.busy?'Reading the file…':sheet?'Choose another HR file':'Choose the HR Excel file'}<input type="file" accept=".xlsx,.xlsm" disabled={file.busy||run.busy} onChange={chooseSheet}/></label>
    {sheet&&<p className="asc-note" role="status"><strong>{file.name}</strong> · sheet “{sheet.sheetName}” · {many(sheet.people.length,'employee')} · {sheet.filledDates.length?'marks from '+dmy(sheet.filledDates[0])+' to '+dmy(sheet.filledDates.at(-1)):'no date is marked'}{sheet.noId.length?' · '+many(sheet.noId.length,'line')+' with no EMP. ID':''}</p>}
    {file.error&&<p className="asc-error" role="alert">{file.name}: {file.error}</p>}
   </section>
   <section className="asc-step"><h2>2 · Biometric</h2>
    <div className="hsb-ways" role="radiogroup" aria-label="Where the punches come from">
     <label><input type="radio" name="hsb-bio" checked={!useFile} disabled={run.busy} onChange={()=>{setBioWay('held');clear();}}/>Punches HR Pulse holds (machine, with HR's corrections) and those imported in Pulse-II</label>
     <label><input type="radio" name="hsb-bio" checked={useFile} disabled={run.busy} onChange={()=>{setBioWay('file');clear();}}/>Upload the biometric file taken from HR or the device</label>
    </div>
    {!useFile&&<label className="hsb-field">Biometric source<select value={source} disabled={run.busy} onChange={e=>{setSource(e.target.value);clear();}}>{SOURCE_CHOICES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label>}
    {useFile&&<label className={'asc-upload'+(bioFile.busy?' busy':'')}><Upload size={16}/>{bioFile.busy?'Reading the file…':bioFile.bio?'Choose another biometric file':'Choose the biometric file'}<input type="file" accept=".dat,.txt,.csv,.xlsx,.xlsm" disabled={bioFile.busy||run.busy} onChange={chooseBio}/></label>}
    {useFile&&bioFile.bio&&<p className="asc-note" role="status"><strong>{bioFile.name}</strong> · {many(bioFile.bio.punches,'punch','punches')} · {many(new Set(bioFile.bio.days.map(d=>d.caliberCode)).size,'employee no.','employee nos.')}. Every punch of the file is taken as a punch at the chosen site.</p>}
    {useFile&&bioFile.error&&<p className="asc-error" role="alert">{bioFile.name}: {bioFile.error}</p>}
   </section>
   <section className="asc-step"><h2>3 · Site and Check</h2>
    <label className="hsb-field">Site<select aria-label="Site of the HR sheet" value={site} disabled={run.busy||!sites.list} onChange={e=>{setSite(e.target.value);clear();}}>
     <option value="">{sites.list?'Select the site':'Reading your sites…'}</option>{(sites.list||[]).map(name=><option key={name} value={name}>{name}</option>)}
    </select></label>
    <button type="button" className="asc-run" disabled={!ready} onClick={check}><Download size={16}/>{run.busy?'Comparing…':'Check and download Excel'}</button>
    {sites.error&&<p className="asc-error" role="alert">{sites.error}</p>}
    {sites.list&&!sites.list.length&&!sites.error&&<p className="asc-error" role="alert">No site is assigned to your login.</p>}
    {!sheet&&!file.busy&&<p className="asc-hint">Choose the HR Excel file first.</p>}{sheet&&!site&&<p className="asc-hint">Select the site.</p>}
    {sheet&&useFile&&!bioFile.bio&&<p className="asc-hint">Choose the biometric file in Step 2.</p>}
    <p className="asc-hint">The dates are the marked dates of the HR sheet, up to today, at most 31 days.</p>
   </section>
  </div>
  {run.busy&&<p className="asc-note" role="status">Reading the punches and Employee Master for these dates. A full month takes up to a minute.</p>}
  {run.error&&<p className="asc-error" role="alert">{run.error}</p>}
  {result&&<>
   <section className="asc-result" aria-label="Result of the check">
    <h2>{result.site} · HR sheet vs biometric · {period||'no date to compare'} · {many(result.totals.mismatches,'mismatch','mismatches')} for {many(result.totals.peopleWithMismatch,'employee')}</h2>
    <p className="asc-note" role="status">The Excel <strong>{done.name}</strong> is in your Downloads folder and in Download History (the folder button at the top). <button type="button" className="asc-again" onClick={download}>Download again</button></p>
    {bioRead&&!bioRead.file&&<p className="asc-hint">Biometric read: {bioRead.machine?.asked?(bioRead.machine.connected?many(bioRead.machine.punches,'machine punch','machine punches')+' from HR Pulse':'machine punches not read'):'machine punches not asked'}{bioRead.imported?.asked?' · '+many(bioRead.imported.lines,'imported day'):''}.</p>}
    {bioRead?.machine?.error&&<p className="asc-error" role="alert">{bioRead.machine.error} The imported punches are compared.</p>}
    {done.cardsError&&<p className="asc-hint">Trip cards could not be read ({done.cardsError}); the check does not need them, the trip card column is empty.</p>}
    {done.range.cut&&<p className="asc-hint">The HR sheet covers more than 31 days: only the first 31 are compared.</p>}
    {result.dates.skipped.length>0&&<p className="asc-hint">Not compared (after today or past 31 days): {result.dates.skipped.map(dmy).join(', ')}.</p>}
   </section>
   <ReportSection key={'hsb-site-'+done.name} title={'Step 1 · '+result.site+' · HR sheet against the biometric · '+period} category="hr-sheet-biometric-site" description="People-days: one person on one date. Press a coloured number to see only that mismatch in the date by shift table; ID / name and punched-not-in-sheet open their lists below." rows={[siteRow]} columns={siteColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}/>
   {pick.list==='ids'&&<ReportSection key={'hsb-ids-'+done.name} title={'EMP. ID and name to correct · '+many(result.issues.length,'line')} category="hr-sheet-biometric-ids" description="Correct these in the HR sheet, or ask HR to correct Employee Master. A line whose EMP. ID cannot be read is not compared day by day." rows={result.issues.map((i,n)=>({...i,key:n}))} columns={idColumns} rowKey={r=>r.key} recordDateFilter={false} emptyMessage="Nothing to correct."/>}
   {pick.list==='notInSheet'&&<ReportSection key={'hsb-miss-'+done.name} title={'Punched at '+result.site+', not in the HR sheet · '+many(result.notInSheet.length,'person','people')} category="hr-sheet-biometric-not-in-sheet" description="These people punched at this site on the dates of the HR sheet, but the HR sheet has no line for them." rows={result.notInSheet} columns={missColumns} rowKey={r=>r.number} recordDateFilter={false} emptyMessage="Nobody."/>}
   <ReportSection key={'hsb-dates-'+done.name+'-'+pick.kind} title={'Step 2 · '+result.site+' · HR sheet vs biometric · date by shift · '+way} category="hr-sheet-biometric-dates" description="The HR sheet has dates only, no shift, so each date is one box: the mismatches, then a coloured box for each kind. Press a box for its people, All dates for everyone." rows={exported.rows} columns={exported.columns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="hsb-kinds" role="group" aria-label="Mismatches shown">
     <button type="button" aria-pressed={!pick.kind} onClick={()=>setPick(p=>({...noPick,list:p.list}))}>Every mismatch <small>{result.totals.mismatches}</small></button>
     {HR_KINDS.map(k=><button key={k.key} type="button" className={'hsb-'+k.tone} aria-pressed={pick.kind===k.key} disabled={!result.counts[k.key]} onClick={()=>openKind(k.key)}>{k.label} <small>{result.counts[k.key]}</small></button>)}
    </div>
    <DateShiftGrid grid={grid} count={r=>r.total} countLabel="mismatches" boxes={boxes} dayColumns={dayColumns} shiftLabel={shiftLabel}
     onOpen={(r,box)=>setPick(p=>({...p,date:r.date,box,all:false,person:''}))} onOpenAll={()=>setPick(p=>({...p,date:'',box:'',all:true,person:''}))}
     isPicked={r=>!pick.all&&pick.date===r.date} pickedBox={pick.box} allPicked={pick.all} ariaLabel="HR sheet against the biometric by date"
     emptyMessage="No date of the HR sheet could be compared."/>
   </ReportSection>
   {opened?<ReportSection key={'hsb-people-'+done.name+'-'+pick.kind+'-'+where+'-'+pick.box} title={'Step 3 · '+result.site+' · '+where+' · '+(pick.box?hrKindLabel(pick.box):way)+' · people'} category="hr-sheet-biometric-people" description={many(listed.length,'line')+' · '+many(new Set(listed.map(l=>l.row)).size,'person','people')+' · Press a line for that person day by day.'} rows={listed} columns={step3Columns} rowKey={r=>r.id} rowClassName={r=>'hsb-row-'+TONE[r.kind]+(String(pick.person)===String(r.row)?' report-row-picked':'')} onRowClick={r=>setPick(p=>({...p,person:String(r.row)}))} recordDateFilter={false} emptyMessage="Nobody in this box."/>
    :result.totals.mismatches?<p className="hsb-notice">Press a box in the date table to see its people, then a person for every day.</p>:null}
   {person&&<ReportSection key={'hsb-person-'+done.name+'-'+person.row} title={'Step 4 · '+(person.name||person.id)+' · '+person.id+' · day by day'} category="hr-sheet-biometric-person" description={(person.designation||'')+' · Row '+person.row+' of the HR sheet · every compared date, the HR mark beside the punch.'} rows={days} columns={step4Columns} rowKey={r=>r.id} rowClassName={r=>TONE[r.kind]?'hsb-row-'+TONE[r.kind]:r.kind==='skip'?'hsb-row-grey':''} recordDateFilter={false}/>}
  </>}
 </div>;
}
