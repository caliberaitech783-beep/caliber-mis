// Site Sheet vs Trip Card (owner, 23 Nov 2026): Reports > Manpower & OT, the tab beside Attendance Sheet Mismatch.
// The attendance Excel a site keeps by hand is uploaded the same way as before (file, site, Check) and compared with
// Pulse-II trip cards of the locked dates. On screen, in the owner's step pattern:
//   Step 1  the site, with the people-days found each way
//   Step 2  date by shift: in each box the people, a blue box for "trip card present, sheet not P", an orange one for
//           "sheet P, no trip card" (under "Shift not in sheet": the sheet has no shift) and a purple one for a card at
//           another site
//   Step 3  the people of the box pressed
//   Step 4  one person day by day
// The Excel has the site's sheet coloured, the date by shift counts, the lines of each way, and the corrections.
// Nothing is saved in Pulse-II. Rules: shared/attendance-sheet-check.mjs and shared/site-sheet-days.mjs.
// Owner, 24 Nov 2026: a log book tab (VLB / ELB / LMV), a batch and From / To choose what is seen, at once, without
// reading Pulse-II again; every trip card of the selection is judged against the sheet: the OK ones are only counted
// ("need no attention") and only the ones that need attention are listed, each with its problem (TripCardVerdict).
import React,{useEffect,useMemo,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {TripCardFilters,TripCardVerdict} from './trip-card-verdict.jsx';
import {dmy,CORRECTION_KINDS} from '../shared/attendance-sheet-check.mjs';
import {DAY_KINDS,dayShiftRows,kindLabel,kindTotals,personDays,shiftName} from '../shared/site-sheet-days.mjs';
import {readAttendanceFile,sheetApi} from './attendance-sheet-run.mjs';
import {readSiteSheetData,siteSheetView,siteSheetWorkbook} from './site-sheet-run.mjs';
import {DateShiftGrid,dateShiftExport,dateShiftGrid} from './date-shift-grid.jsx';
import {downloadBlob} from './download-history.mjs';
import './attendance-sheet-check.css';
import './site-sheet-trip-card.css';

const many=(n,one,more=one+'s')=>n+' '+(n===1?one:more);
const TONE=Object.fromEntries(DAY_KINDS.map(k=>[k.key,k.tone]));
const STATE_TONE={duty:'blue',noDuty:'orange',site:'purple',skip:'grey'};
const TONE_COLOUR={blue:'#1d5fd1',orange:'#d46a00',purple:'#6a3fa0'};
const noPick={kind:'',date:'',shift:'',box:'',all:false,person:''};
const col=(key,label,extra={})=>({key,label,value:r=>r[key]===''||r[key]===undefined||r[key]===null?'—':r[key],...extra});
const lineKey=l=>[l.row,l.date,l.shift,l.kind].join('|');

export default function SiteSheetTripCard({session,ReportSection}){
 const [sites,setSites]=useState({list:null,error:''}),[site,setSite]=useState('');
 const [file,setFile]=useState({busy:false,name:'',sheet:null,error:''});
 const [run,setRun]=useState({busy:false,error:'',done:null});
 const [pick,setPick]=useState(noPick);
 const [filter,setFilter]=useState({from:'',to:'',logBook:'',batch:''});
 useEffect(()=>{
  let live=true;
  sheetApi('/api/reports/manpower/attendance-sheet/sites',session).then(p=>{if(!live)return;setSites({list:p.sites||[],error:''});if(p.sites?.length===1)setSite(p.sites[0]);},e=>live&&setSites({list:[],error:e.message}));
  return()=>{live=false;};
 },[session.token]);
 const choose=async event=>{
  const picked=event.target.files?.[0];event.target.value='';if(!picked)return;
  setRun({busy:false,error:'',done:null});setPick(noPick);setFile({busy:true,name:picked.name,sheet:null,error:''});
  try{const read=await readAttendanceFile(picked);setFile({busy:false,name:picked.name,sheet:read,error:''});setFilter(f=>({...f,from:read.filledDates[0]||'',to:read.filledDates.at(-1)||'',batch:''}));}
  catch(error){setFile({busy:false,name:picked.name,sheet:null,error:error.message});}
 };
 const check=async()=>{
  setRun({busy:true,error:'',done:null});setPick(noPick);
  try{
   const data=await readSiteSheetData({sheet:file.sheet,site,session});
   const from=filter.from&&filter.from>=data.range.from&&filter.from<=data.range.to?filter.from:data.range.from;
   const to=filter.to&&filter.to<=data.range.to&&filter.to>=from?filter.to:data.range.to;
   const first=siteSheetView({sheet:file.sheet,data,site,from,to,logBook:filter.logBook,batch:''});
   const book=siteSheetWorkbook(first,{fileName:file.name});
   downloadBlob(book.blob,book.name,{title:book.title});
   setFilter(f=>({...f,from,to,batch:''}));
   setRun({busy:false,error:'',done:{data,name:book.name}});
  }catch(error){setRun({busy:false,error:error.message,done:null});}
 };
 const sheet=file.sheet,ready=Boolean(sheet&&site&&!run.busy);
 const data=run.done?.data;
 const view=useMemo(()=>data&&sheet?siteSheetView({sheet,data,site,...filter}):null,[data,sheet,site,filter]);
 const done=view?{...view,name:run.done.name}:null,result=view?.result;
 const lines=view?.lines||[];
 const setChoice=change=>{setFilter(f=>({...f,...change}));setPick(noPick);};
 const download=()=>{const book=siteSheetWorkbook(view,{fileName:file.name});downloadBlob(book.blob,book.name,{title:book.title});setRun(r=>({...r,done:{...r.done,name:book.name}}));};
 const totals=useMemo(()=>kindTotals(lines),[lines]);
 const shown=useMemo(()=>pick.kind?lines.filter(l=>l.kind===pick.kind):lines,[lines,pick.kind]);
 const grid=useMemo(()=>dateShiftGrid(dayShiftRows(shown),{sumKeys:['total','card','noCard','away']}),[shown]);
 const kinds=result?Object.entries(CORRECTION_KINDS).filter(([kind])=>result.counts[kind]>0):[];
 const boxes=pick.kind?[]:DAY_KINDS.filter(k=>totals[k.key]?.lines>0).map(k=>({key:k.key,className:'ssc-'+k.tone,label:k.label}));
 const dayColumns=[{key:'total',label:'Day total',value:s=>s.total}];
 const opened=pick.all||Boolean(pick.date);
 const listed=opened?shown.filter(l=>(pick.all||(l.date===pick.date&&l.shift===pick.shift))&&(!pick.box||l.kind===pick.box))
  .map(l=>({...l,key:lineKey(l),dateLabel:dmy(l.date),shiftLabel:shiftName(l.shift),kindLabel:kindLabel(l.kind)})):[];
 const person=pick.person&&result?result.rows.find(r=>String(r.row)===String(pick.person)):null;
 const days=person?personDays(person).map(d=>({...d,dateLabel:dmy(d.date)})):[];
 const period=result?.dates.compared.length?dmy(result.dates.compared[0])+' to '+dmy(result.dates.compared.at(-1)):'';
 const way=pick.kind?kindLabel(pick.kind):'both ways';
 const openKind=key=>setPick({...noPick,kind:pick.kind===key?'':key});

 const siteRow=result?{id:'site',site:result.site,dates:result.dates.judged.length,people:result.totals.judged,...Object.fromEntries(DAY_KINDS.map(k=>[k.key,totals[k.key]?.lines||0]))}:null;
 const siteColumns=[col('site','Site'),col('dates','Dates compared (locked)'),col('people','People compared day by day'),
  ...DAY_KINDS.map(k=>({key:k.key,label:k.label,value:r=>r[k.key],render:r=><button type="button" className={'ssc-num ssc-'+k.tone} disabled={!r[k.key]} aria-pressed={pick.kind===k.key} aria-label={k.label+' · '+r[k.key]} onClick={()=>openKind(k.key)}>{r[k.key]}<small>{many(totals[k.key]?.people||0,'person','people')}</small></button>}))];
 const exported=dateShiftExport(grid,{count:r=>r.total,countLabel:'people',boxes,shiftLabel:shiftName,dayColumns});
 // A box is one date and shift: those two columns show only when every date is open.
 const step3Columns=[...(pick.all?[col('dateLabel','Date'),col('shiftLabel','Shift')]:[]),...(pick.box||pick.kind?[]:[col('kindLabel','Mismatch')]),col('id','EMP. ID'),col('name','Name in sheet'),col('pulseName','Name in Pulse-II'),col('designation','Designation'),
  col('sheetSays','Sheet says'),col('pulseSays','Pulse-II says'),...(listed.some(l=>l.nearest)?[col('nearest','Nearest shift worked here')]:[]),...(listed.some(l=>l.books)?[col('books','Trip cards / log books')]:[])];
 // The correction is one sentence per way: said once above the table (the Excel keeps it on every line).
 const advice=[...new Set(listed.map(l=>l.correction))];
 const step4Columns=[col('dateLabel','Date'),col('sheetSays','Sheet says'),col('pulseSays','Pulse-II says'),col('result','Result'),col('books','Trip cards / log books'),col('equipment','Equipment')];
 const where=pick.all?'All dates':dmy(pick.date)+' · '+shiftName(pick.shift);

 return <div className="asc-page ssc-page">
  <p className="asc-intro">Upload the attendance Excel the site keeps by hand: one line per employee with EMP. ID, NAME and DESIGNATION, and one column per date marked P or A. Choose the site and press Check. Pulse-II compares it with its trip cards, log books and zero-trip entries of the locked dates and shows, date by shift, both ways: <b>trip card present, sheet not P</b>, and <b>sheet P, no trip card</b>. Press a box for its people and a person for his days. The Excel has the same, with every mismatch coloured and the corrections required. Nothing is changed in Pulse-II.</p>
  <div className="asc-steps">
   <section className="asc-step"><h2>1 · Attendance Excel of the site</h2>
    <label className={'asc-upload'+(file.busy?' busy':'')}><Upload size={16}/>{file.busy?'Reading the file…':sheet?'Choose another file':'Choose the Excel file'}<input type="file" accept=".xlsx,.xlsm,.xlk" disabled={file.busy||run.busy} onChange={choose}/></label>
    {sheet&&<p className="asc-note" role="status"><strong>{file.name}</strong> · sheet “{sheet.sheetName}” · {many(sheet.people.length,'employee')} · {sheet.filledDates.length?'marks from '+dmy(sheet.filledDates[0])+' to '+dmy(sheet.filledDates.at(-1)):'no date is marked'}{sheet.missingDates.length?' · no column for '+sheet.missingDates.map(dmy).join(', '):''}</p>}
    {file.error&&<p className="asc-error" role="alert">{file.name}: {file.error}</p>}
   </section>
   <section className="asc-step"><h2>2 · Site of this sheet</h2>
    <select aria-label="Site of this attendance sheet" value={site} disabled={run.busy||!sites.list} onChange={e=>{setSite(e.target.value);setRun({busy:false,error:'',done:null});setPick(noPick);setFilter(f=>({...f,batch:''}));}}>
     <option value="">{sites.list?'Select the site':'Reading your sites…'}</option>{(sites.list||[]).map(name=><option key={name} value={name}>{name}</option>)}
    </select>
    {sites.error&&<p className="asc-error" role="alert">{sites.error}</p>}
    {sites.list&&!sites.list.length&&!sites.error&&<p className="asc-error" role="alert">No site is assigned to your login.</p>}
   </section>
   <section className="asc-step"><h2>3 · Check</h2>
    <button type="button" className="asc-run" disabled={!ready} onClick={check}><Download size={16}/>{run.busy?'Comparing with Pulse-II…':'Check and download Excel'}</button>
    {run.busy&&<p className="asc-note" role="status">Reading Pulse-II attendance of these dates. A full month takes up to a minute.</p>}
    {!sheet&&!file.busy&&<p className="asc-hint">Choose the Excel file first.</p>}{sheet&&!site&&<p className="asc-hint">Select the site.</p>}
   </section>
  </div>
  {sheet&&<TripCardFilters filter={filter} onChange={setChoice} min={data?.range.from||sheet.filledDates[0]} max={data?.range.to||sheet.filledDates.at(-1)}
   logBooks={view?.logBooks} batches={view?.batches} disabled={run.busy} checked={Boolean(view)} onDownload={view?download:null}/>}
  {run.error&&<p className="asc-error" role="alert">{run.error}</p>}
  {result&&<TripCardVerdict key={'ssc-verdict-'+done.name} view={view} ReportSection={ReportSection} withSheet against="the site sheet" site={result.site} period={period}/>}
  {result&&<>
   <section className="asc-result" aria-label="Result of the check">
    <h2>{result.site} · {period||'no date to compare'} · {many(result.totals.corrections,'correction')} for {many(result.totals.peopleWithCorrections,'employee')}</h2>
    <p className="asc-note" role="status">The Excel <strong>{done.name}</strong> is in your Downloads folder and in Download History (the folder button at the top). <button type="button" className="asc-again" onClick={download}>Download again</button></p>
    {(filter.logBook||filter.batch)&&<p className="asc-hint">These counts are the whole sheet from {dmy(view.from)} to {dmy(view.to)}, every log book. The trip card lines and the date by shift below are {filter.logBook||'every log book'}{filter.batch?' · batch '+filter.batch:''} only; "Sheet P, no trip card" has no card, so it shows under All log books.</p>}
    <table className="asc-counts"><tbody>
     <tr><th scope="row">Employees in the sheet</th><td>{result.totals.people}</td></tr>
     <tr><th scope="row">Compared day by day (drivers and operators, or a duty in Pulse-II)</th><td>{result.totals.judged}</td></tr>
     <tr><th scope="row">Dates compared (locked in Pulse-II)</th><td>{result.dates.judged.length}</td></tr>
     <tr><th scope="row">Dates not locked in Pulse-II yet</th><td>{result.dates.pending.length}</td></tr>
     {kinds.map(([kind,label])=><tr key={kind}><th scope="row">{label}</th><td>{result.counts[kind]}</td></tr>)}
     <tr><th scope="row">On Pulse-II Employee Master at this site, not in the sheet</th><td>{result.listedOnly.length}</td></tr>
    </tbody></table>
    {done.range.cut&&<p className="asc-hint">The sheet covers more than 31 days: only the first 31 are compared.</p>}
   </section>
   <ReportSection key={'ssc-site-'+done.name} title={'Step 1 · '+result.site+' · trip card against the sheet · '+period} category="site-sheet-trip-card-site" description="People-days each way: one person on one date. Press a number to see only that way in the date by shift table." rows={[siteRow]} columns={siteColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}/>
   <ReportSection key={'ssc-dates-'+done.name+'-'+pick.kind} title={'Step 2 · '+result.site+' · date by shift · '+way} category="site-sheet-trip-card-dates" description="In each box: the people of that date and shift, then a coloured box for each way. The site sheet has dates only, no shift: a person the sheet marks P with no trip card at all is under Shift not in sheet. Press a box for its people, All dates for everyone." rows={exported.rows} columns={exported.columns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="ssc-kinds" role="group" aria-label="Ways shown">
     <button type="button" aria-pressed={!pick.kind} onClick={()=>setPick(noPick)}>Both ways <small>{lines.length}</small></button>
     {DAY_KINDS.map(k=><button key={k.key} type="button" className={'ssc-'+k.tone} aria-pressed={pick.kind===k.key} disabled={!totals[k.key]?.lines} onClick={()=>openKind(k.key)}>{k.label} <small>{totals[k.key]?.lines||0}</small></button>)}
    </div>
    <p className="ssc-legend">{DAY_KINDS.map(k=><span key={k.key} style={{'--ssc-tone':TONE_COLOUR[k.tone]}}>{k.label}</span>)}</p>
    <DateShiftGrid grid={grid} count={r=>r.total} countLabel="people" boxes={boxes} dayColumns={dayColumns} shiftLabel={shiftName}
     onOpen={(r,box)=>setPick(p=>({...p,date:r.date,shift:r.shift,box,all:false,person:''}))} onOpenAll={()=>setPick(p=>({...p,date:'',shift:'',box:'',all:true,person:''}))}
     isPicked={r=>!pick.all&&pick.date===r.date&&pick.shift===r.shift} pickedBox={pick.box} allPicked={pick.all} ariaLabel="Trip card against the sheet by date and shift"
     emptyMessage={lines.length?'Nothing this way.':'No date of this sheet differs from Pulse-II trip cards.'}/>
   </ReportSection>
   {opened?<ReportSection key={'ssc-people-'+done.name+'-'+pick.kind+'-'+where+'-'+pick.box} title={'Step 3 · '+result.site+' · '+where+' · '+(pick.box?kindLabel(pick.box):way)+' · people'} category="site-sheet-trip-card-people" description={many(listed.length,'line')+' · '+many(new Set(listed.map(l=>l.id)).size,'person','people')+' · Press a line for that person day by day.'+(advice.length===1?' Correction: '+advice[0]:'')} rows={listed} columns={step3Columns} rowKey={r=>r.key} rowClassName={r=>'ssc-row-'+TONE[r.kind]+(String(pick.person)===String(r.row)?' report-row-picked':'')} onRowClick={r=>setPick(p=>({...p,person:String(r.row)}))} recordDateFilter={false} emptyMessage="Nobody in this box."/>
    :lines.length?<p className="ssc-notice">Press a box in the date by shift table to see its people, then a person for his days.</p>:null}
   {person&&<ReportSection key={'ssc-person-'+done.name+'-'+person.row} title={'Step 4 · '+(person.name||person.id)+' · '+person.id+' · day by day'} category="site-sheet-trip-card-person" description={(person.designation||'')+' · Row '+person.row+' of the sheet · every date of the sheet, the mark beside Pulse-II.'} rows={days} columns={step4Columns} rowKey={r=>r.id} rowClassName={r=>STATE_TONE[r.state]?'ssc-row-'+STATE_TONE[r.state]:''} recordDateFilter={false}/>}
  </>}
 </div>;
}
