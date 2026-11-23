// Site Sheet vs Trip Card (owner, 23 Nov 2026): Reports > Manpower & OT, the tab beside Attendance Sheet Mismatch.
// The attendance Excel a site keeps by hand is uploaded once and saved for this login (server/routes/site-sheets.mjs);
// nothing is downloaded and nothing of the working data changes. Opening a saved sheet compares it with the trip cards of
// that moment, on screen, in the owner's step pattern:
//   Step 1  the saved sheets: site, month, who saved it
//   Step 2  date by shift: in each box the people, a blue box for "trip card present, sheet not P", an orange one for
//           "sheet P, no trip card" (under "Shift not in sheet": the sheet has no shift) and a purple one for a card at
//           another site
//   Step 3  the box pressed, department-wise, designation-wise or category-wise (HR Pulse's Employee Master)
//   Step 4  the people of the line pressed
//   Step 5  one person day by day
// Rules: shared/attendance-sheet-check.mjs and shared/site-sheet-days.mjs.
import React,{useEffect,useMemo,useState} from 'react';
import {RefreshCw,Save,Trash2,Upload} from 'lucide-react';
import {dmy,CORRECTION_KINDS} from '../shared/attendance-sheet-check.mjs';
import {DAY_KINDS,GROUP_BYS,dayShiftRows,groupLines,inGroup,kindLabel,kindTotals,personDays,shiftName} from '../shared/site-sheet-days.mjs';
import {readAttendanceFile,sheetApi} from './attendance-sheet-run.mjs';
import {deleteSiteSheet,listSiteSheets,openSiteSheet,saveSiteSheet} from './site-sheet-run.mjs';
import {DateShiftGrid,dateShiftExport,dateShiftGrid} from './date-shift-grid.jsx';
import './attendance-sheet-check.css';
import './site-sheet-trip-card.css';

const many=(n,one,more=one+'s')=>n+' '+(n===1?one:more);
const TONE=Object.fromEntries(DAY_KINDS.map(k=>[k.key,k.tone]));
const STATE_TONE={duty:'blue',noDuty:'orange',site:'purple',skip:'grey'};
const TONE_COLOUR={blue:'#1d5fd1',orange:'#d46a00',purple:'#6a3fa0'};
const noPick={kind:'',date:'',shift:'',box:'',all:false,by:'department',group:'',person:''};
const col=(key,label,extra={})=>({key,label,value:r=>r[key]===''||r[key]===undefined||r[key]===null?'—':r[key],...extra});
const lineKey=l=>[l.row,l.date,l.shift,l.kind].join('|');
const monthName=month=>/^\d{4}-\d{2}$/.test(month)?new Date(month+'-01T00:00:00Z').toLocaleString('en-IN',{month:'short',year:'numeric',timeZone:'UTC'}):month;
const when=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?'':d.toLocaleString('en-IN',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});};

export default function SiteSheetTripCard({session,ReportSection}){
 const [sites,setSites]=useState({list:null,error:''}),[site,setSite]=useState('');
 const [file,setFile]=useState({busy:false,name:'',sheet:null,error:''});
 const [save,setSave]=useState({busy:false,error:''});
 const [saved,setSaved]=useState({sheets:null,admin:false,error:''});
 const [open,setOpen]=useState({id:'',busy:false,error:'',done:null});
 const [pick,setPick]=useState(noPick);
 const loadList=()=>listSiteSheets(session).then(p=>{setSaved({sheets:p.sheets||[],admin:Boolean(p.admin),error:''});return p.sheets||[];},e=>{setSaved(s=>({...s,sheets:s.sheets||[],error:e.message}));return [];});
 useEffect(()=>{
  let live=true;
  sheetApi('/api/reports/manpower/attendance-sheet/sites',session).then(p=>{if(!live)return;setSites({list:p.sites||[],error:''});if(p.sites?.length===1)setSite(p.sites[0]);},e=>live&&setSites({list:[],error:e.message}));
  loadList();
  return()=>{live=false;};
 },[session.token]);
 const choose=async event=>{
  const picked=event.target.files?.[0];event.target.value='';if(!picked)return;
  setSave({busy:false,error:''});setFile({busy:true,name:picked.name,sheet:null,error:''});
  try{setFile({busy:false,name:picked.name,sheet:await readAttendanceFile(picked),error:''});}
  catch(error){setFile({busy:false,name:picked.name,sheet:null,error:error.message});}
 };
 const openSheet=async id=>{
  setOpen({id,busy:true,error:'',done:null});setPick(noPick);
  try{setOpen({id,busy:false,error:'',done:await openSiteSheet({id,session})});}
  catch(error){setOpen({id,busy:false,error:error.message,done:null});}
 };
 const keep=async()=>{
  setSave({busy:true,error:''});
  try{
   const answer=await saveSiteSheet({sheet:file.sheet,fileName:file.name,site,session});
   setFile({busy:false,name:'',sheet:null,error:''});setSave({busy:false,error:''});
   await loadList();openSheet(answer.id);
  }catch(error){setSave({busy:false,error:error.message});}
 };
 const remove=async row=>{
  if(!window.confirm(`Delete the saved sheet of ${row.site}, ${monthName(row.month)}? Only the saved sheet is deleted; nothing else changes.`))return;
  try{await deleteSiteSheet({id:row.id,session});if(open.id===row.id){setOpen({id:'',busy:false,error:'',done:null});setPick(noPick);}await loadList();}
  catch(error){setSaved(s=>({...s,error:error.message}));}
 };

 const sheet=file.sheet,ready=Boolean(sheet&&site&&!save.busy);
 const done=open.done,result=done?.result;
 const lines=done?.lines||[];
 const totals=useMemo(()=>kindTotals(lines),[lines]);
 const shown=useMemo(()=>pick.kind?lines.filter(l=>l.kind===pick.kind):lines,[lines,pick.kind]);
 const grid=useMemo(()=>dateShiftGrid(dayShiftRows(shown),{sumKeys:['total','card','noCard','away']}),[shown]);
 const findings=result?Object.entries(CORRECTION_KINDS).filter(([kind])=>result.counts[kind]>0&&!['no-duty','duty','other-site'].includes(kind)):[];
 const boxes=pick.kind?[]:DAY_KINDS.filter(k=>totals[k.key]?.lines>0).map(k=>({key:k.key,className:'ssc-'+k.tone,label:k.label}));
 const dayColumns=[{key:'total',label:'Day total',value:s=>s.total}];
 const opened=pick.all||Boolean(pick.date);
 const inBox=opened?shown.filter(l=>(pick.all||(l.date===pick.date&&l.shift===pick.shift))&&(!pick.box||l.kind===pick.box)):[];
 const groups=useMemo(()=>groupLines(inBox,pick.by),[inBox,pick.by]);
 const by=GROUP_BYS.find(g=>g.key===pick.by)||GROUP_BYS[0];
 const group=pick.group?groups.find(g=>g.key===pick.group):null;
 const listed=group?inBox.filter(l=>inGroup(l,pick.by,pick.group)).map(l=>({...l,key:lineKey(l),dateLabel:dmy(l.date),shiftLabel:shiftName(l.shift),kindLabel:kindLabel(l.kind)})):[];
 const person=pick.person&&result?result.rows.find(r=>String(r.row)===String(pick.person)):null;
 const days=person?personDays(person).map(d=>({...d,dateLabel:dmy(d.date)})):[];
 const period=result?.dates.compared.length?dmy(result.dates.compared[0])+' to '+dmy(result.dates.compared.at(-1)):'';
 const way=pick.kind?kindLabel(pick.kind):'both ways';
 const where=pick.all?'All dates':dmy(pick.date)+' · '+shiftName(pick.shift);
 const boxWay=pick.box?kindLabel(pick.box):way;
 const openKind=key=>setPick({...noPick,by:pick.by,kind:pick.kind===key?'':key});
 const title=done?done.saved.site+' · '+monthName(done.saved.month):'';

 const sheetColumns=[col('site','Site'),col('monthLabel','Month'),col('dates','Dates in the sheet'),col('people','Employees in the sheet'),col('fileName','File'),
  ...(saved.admin?[col('savedName','Saved by')]:[]),col('savedAtLabel','Saved at'),
  {key:'delete',label:'Delete',value:()=> '',render:r=><button type="button" className="ssc-delete" aria-label={'Delete the saved sheet of '+r.site+', '+r.monthLabel} onClick={e=>{e.stopPropagation();remove(r);}}><Trash2 size={15}/></button>}];
 const sheetRows=(saved.sheets||[]).map(s=>({...s,monthLabel:monthName(s.month),dates:dmy(s.firstDate)+' to '+dmy(s.lastDate),savedAtLabel:when(s.savedAt)}));
 const exported=dateShiftExport(grid,{count:r=>r.total,countLabel:'people',boxes,shiftLabel:shiftName,dayColumns});
 const kindCell=k=>({key:k.key,label:k.label,value:r=>r[k.key],render:r=>r[k.key]?<span className={'ssc-figure ssc-'+k.tone}>{r[k.key]}<small>{many(r[k.key+'People'],'person','people')}</small></span>:<span className="ssc-zero">0</span>});
 const groupColumns=[col('label',by.heading),...(pick.by==='designation'?[{key:'spellings',label:'Written in HR Pulse as',value:r=>r.spellings.length>1?r.spellings.join(' · '):'—'}]:[]),
  ...DAY_KINDS.filter(k=>inBox.some(l=>l.kind===k.key)).map(kindCell),col('people','People'),col('total','People-days')];
 const step4Columns=[...(pick.all?[col('dateLabel','Date'),col('shiftLabel','Shift')]:[]),...(pick.box||pick.kind?[]:[col('kindLabel','Mismatch')]),col('id','EMP. ID'),col('name','Name in sheet'),col('pulseName','Name in Pulse-II'),
  ...(pick.by==='designation'?[]:[col('designation','Designation')]),...(pick.by==='department'?[]:[col('department','Department')]),...(pick.by==='category'?[]:[col('category','Category')]),
  col('sheetSays','Sheet says'),col('pulseSays','Pulse-II says'),...(listed.some(l=>l.nearest)?[col('nearest','Nearest shift worked here')]:[]),...(listed.some(l=>l.books)?[col('books','Trip cards / log books')]:[])];
 const advice=[...new Set(listed.map(l=>l.correction))];
 const step5Columns=[col('dateLabel','Date'),col('sheetSays','Sheet says'),col('pulseSays','Pulse-II says'),col('result','Result'),col('books','Trip cards / log books'),col('equipment','Equipment')];

 return <div className="asc-page ssc-page">
  <p className="asc-intro">Upload the attendance Excel the site keeps by hand once: one line per employee with EMP. ID, NAME and DESIGNATION, and one column per date marked P or A. It is saved for your login, so you can open it again at any time without uploading. Each time it is opened it is compared with the Pulse-II trip cards, log books and zero-trip entries of the locked dates, date by shift, both ways: <b>trip card present, sheet not P</b>, and <b>sheet P, no trip card</b>; then department-wise, designation-wise or category-wise from HR Pulse's Employee Master. Nothing of the working data is changed and nothing is downloaded.</p>
  <div className="asc-steps">
   <section className="asc-step"><h2>1 · Attendance Excel of the site</h2>
    <label className={'asc-upload'+(file.busy?' busy':'')}><Upload size={16}/>{file.busy?'Reading the file…':sheet?'Choose another file':'Choose the Excel file'}<input type="file" accept=".xlsx,.xlsm,.xlk" disabled={file.busy||save.busy} onChange={choose}/></label>
    {sheet&&<p className="asc-note" role="status"><strong>{file.name}</strong> · sheet “{sheet.sheetName}” · {many(sheet.people.length,'employee')} · {sheet.filledDates.length?'marks from '+dmy(sheet.filledDates[0])+' to '+dmy(sheet.filledDates.at(-1)):'no date is marked'}{sheet.missingDates.length?' · no column for '+sheet.missingDates.map(dmy).join(', '):''}</p>}
    {file.error&&<p className="asc-error" role="alert">{file.name}: {file.error}</p>}
   </section>
   <section className="asc-step"><h2>2 · Site of this sheet</h2>
    <select aria-label="Site of this attendance sheet" value={site} disabled={save.busy||!sites.list} onChange={e=>setSite(e.target.value)}>
     <option value="">{sites.list?'Select the site':'Reading your sites…'}</option>{(sites.list||[]).map(name=><option key={name} value={name}>{name}</option>)}
    </select>
    {sites.error&&<p className="asc-error" role="alert">{sites.error}</p>}
    {sites.list&&!sites.list.length&&!sites.error&&<p className="asc-error" role="alert">No site is assigned to your login.</p>}
   </section>
   <section className="asc-step"><h2>3 · Save</h2>
    <button type="button" className="asc-run" disabled={!ready} onClick={keep}><Save size={16}/>{save.busy?'Saving…':'Save the sheet'}</button>
    <p className="asc-hint">{!sheet?'Choose the Excel file first.':!site?'Select the site.':'The same site and month saved again replaces your older sheet.'}</p>
    {save.error&&<p className="asc-error" role="alert">{save.error}</p>}
   </section>
  </div>
  <ReportSection key={'ssc-sheets-'+(saved.sheets||[]).map(s=>s.id+s.savedAt).join(',')} title="Step 1 · Saved site sheets" category="site-sheet-trip-card-sheets" description={(saved.admin?'Every saved sheet, with who saved it.':'The sheets saved with your login.')+' Press a sheet to compare it with the trip cards now.'} rows={sheetRows} columns={sheetColumns} rowKey={r=>r.id} rowClassName={r=>open.id===r.id?'report-row-picked':''} onRowClick={r=>openSheet(r.id)} recordDateFilter={false} emptyMessage={saved.sheets?'No sheet is saved yet. Upload the site Excel above and press Save the sheet.':'Reading the saved sheets…'}/>
  {saved.error&&<p className="asc-error" role="alert">{saved.error}</p>}
  {open.busy&&<p className="asc-note" role="status">Comparing the saved sheet with the Pulse-II trip cards of these dates. A full month takes up to a minute.</p>}
  {open.error&&<p className="asc-error" role="alert">{open.error}</p>}
  {result&&<>
   <section className="asc-result" aria-label="The opened sheet">
    <h2>{title} · {period||'no date to compare'}</h2>
    <p className="asc-note" role="status">{done.saved.fileName} · saved by {done.saved.savedName} at {when(done.saved.savedAt)} · compared with the trip cards at {when(done.readAt)} <button type="button" className="asc-again" onClick={()=>openSheet(done.saved.id)}><RefreshCw size={13}/> Compare again</button></p>
    <table className="asc-counts"><tbody>
     <tr><th scope="row">Employees in the sheet</th><td>{result.totals.people}</td></tr>
     <tr><th scope="row">Compared day by day (drivers and operators, or a duty in Pulse-II)</th><td>{result.totals.judged}</td></tr>
     <tr><th scope="row">Dates compared (locked in Pulse-II)</th><td>{result.dates.judged.length}</td></tr>
     {DAY_KINDS.map(k=><tr key={k.key}><th scope="row">{k.label} (people-days)</th><td>{totals[k.key]?.lines||0}</td></tr>)}
     {findings.map(([kind,label])=><tr key={kind}><th scope="row">{label}</th><td>{result.counts[kind]}</td></tr>)}
     {result.dates.pending.length>0&&<tr><th scope="row">Dates not locked in Pulse-II yet (not compared)</th><td>{result.dates.pending.length}</td></tr>}
    </tbody></table>
    {done.range.cut&&<p className="asc-hint">The sheet covers more than 31 days: only the first 31 are compared.</p>}
   </section>
   <ReportSection key={'ssc-dates-'+done.readAt+'-'+pick.kind} title={'Step 2 · '+title+' · date by shift · '+way} category="site-sheet-trip-card-dates" description="In each box: the people of that date and shift, then a coloured box for each way. The site sheet has dates only, no shift: a person the sheet marks P with no trip card at all is under Shift not in sheet. Press a box, or All dates, to see it department-wise, designation-wise or category-wise." rows={exported.rows} columns={exported.columns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="ssc-kinds" role="group" aria-label="Ways shown">
     <button type="button" aria-pressed={!pick.kind} onClick={()=>setPick({...noPick,by:pick.by})}>Both ways <small>{lines.length}</small></button>
     {DAY_KINDS.map(k=><button key={k.key} type="button" className={'ssc-'+k.tone} aria-pressed={pick.kind===k.key} disabled={!totals[k.key]?.lines} onClick={()=>openKind(k.key)}>{k.label} <small>{totals[k.key]?.lines||0}</small></button>)}
    </div>
    <p className="ssc-legend">{DAY_KINDS.map(k=><span key={k.key} style={{'--ssc-tone':TONE_COLOUR[k.tone]}}>{k.label}</span>)}</p>
    <DateShiftGrid grid={grid} count={r=>r.total} countLabel="people" boxes={boxes} dayColumns={dayColumns} shiftLabel={shiftName}
     onOpen={(r,box)=>setPick(p=>({...p,date:r.date,shift:r.shift,box,all:false,group:'',person:''}))} onOpenAll={()=>setPick(p=>({...p,date:'',shift:'',box:'',all:true,group:'',person:''}))}
     isPicked={r=>!pick.all&&pick.date===r.date&&pick.shift===r.shift} pickedBox={pick.box} allPicked={pick.all} ariaLabel="Trip card against the sheet by date and shift"
     emptyMessage={lines.length?'Nothing this way.':'No date of this sheet differs from Pulse-II trip cards.'}/>
   </ReportSection>
   {opened?<ReportSection key={'ssc-groups-'+done.readAt+'-'+pick.kind+'-'+where+'-'+pick.box+'-'+pick.by} title={'Step 3 · '+title+' · '+where+' · '+boxWay+' · '+by.label} category="site-sheet-trip-card-groups" description={'From HR Pulse\'s Employee Master. '+(pick.by==='designation'?'A designation written in several ways (word order, dashes, brackets) is one line; a misspelling stays its own line for HR to correct. ':'')+'Press a line for its people.'} rows={groups} columns={groupColumns} rowKey={r=>r.id} rowClassName={r=>pick.group===r.key?'report-row-picked':''} onRowClick={r=>setPick(p=>({...p,group:r.key,person:''}))} showSearch={false} recordDateFilter={false} emptyMessage="Nobody in this box.">
    <div className="ssc-kinds" role="group" aria-label="Group by">{GROUP_BYS.map(g=><button key={g.key} type="button" aria-pressed={pick.by===g.key} onClick={()=>setPick(p=>({...p,by:g.key,group:'',person:''}))}>{g.label}</button>)}</div>
   </ReportSection>
    :lines.length?<p className="ssc-notice">Press a box in the date by shift table, or All dates, to see it department-wise, designation-wise or category-wise, then a line for its people, then a person for his days.</p>:null}
   {group&&<ReportSection key={'ssc-people-'+done.readAt+'-'+where+'-'+pick.box+'-'+pick.by+'-'+pick.group} title={'Step 4 · '+title+' · '+where+' · '+group.label+' · people'} category="site-sheet-trip-card-people" description={many(listed.length,'line')+' · '+many(new Set(listed.map(l=>l.id)).size,'person','people')+' · Press a line for that person day by day.'+(advice.length===1?' Correction: '+advice[0]:'')} rows={listed} columns={step4Columns} rowKey={r=>r.key} rowClassName={r=>'ssc-row-'+TONE[r.kind]+(String(pick.person)===String(r.row)?' report-row-picked':'')} onRowClick={r=>setPick(p=>({...p,person:String(r.row)}))} recordDateFilter={false} emptyMessage="Nobody in this line."/>}
   {person&&<ReportSection key={'ssc-person-'+done.readAt+'-'+person.row} title={'Step 5 · '+(person.name||person.id)+' · '+person.id+' · day by day'} category="site-sheet-trip-card-person" description={[person.pulse?.designation||person.designation,person.pulse?.department,person.pulse?.category,'Row '+person.row+' of the sheet'].filter(Boolean).join(' · ')+' · every date of the sheet, the mark beside Pulse-II.'} rows={days} columns={step5Columns} rowKey={r=>r.id} rowClassName={r=>STATE_TONE[r.state]?'ssc-row-'+STATE_TONE[r.state]:''} recordDateFilter={false}/>}
  </>}
 </div>;
}
