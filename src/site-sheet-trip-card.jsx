// Site Sheet vs Trip Card (owner, 23 Nov 2026): Reports > Manpower & OT, the tab beside Attendance Month-wise.
// The attendance Excel a site keeps by hand is uploaded (file, site, Check) and compared with Pulse-II trip cards of the
// locked dates. On screen, in the owner's step pattern:
//   Step 1  the site, with the people-days found each way
//   Step 2  date by shift: in each box the people, a blue box for "trip card present, sheet not P", an orange one for
//           "sheet P, no trip card" (under "Shift not in sheet": the sheet has no shift) and a purple one for a card at
//           another site
//   Step 3  the people of the box pressed
//   Step 4  one person day by day
// The Excel has the site's sheet coloured, the date by shift counts, the lines of each way, and the corrections.
// Nothing is saved in Pulse-II. Rules: shared/attendance-sheet-check.mjs and shared/site-sheet-days.mjs.
// Owner, 24 Nov 2026 (morning): a batch and From / To choose what is seen, at once, without reading Pulse-II again; every
// trip card of the selection is judged against the sheet: the OK ones are only counted ("need no attention") and only
// the ones that need attention are listed, each with its problem (TripCardVerdict).
// Owner, 24 Nov 2026 (same morning, PR 517): the three steps stand one under the other; Step 2 holds the site with
// "Select by" Date to date / Batch wise / Batch + dates; Check is the last step, with the download of a selection.
// Owner, 24 Nov 2026 (later): "3 tabs to select the VLB, ELB and LMV sheets, process and upload differently; the user
// selects the category of file to upload and the same way it fetches the result". The log book is now chosen BEFORE the
// upload: three tabs (SHEET_BOOKS), each with its own file, its own Check and its own result, compared with the trip
// cards of that log book only. One upload seen through a log book could not say which log book a "sheet P, no trip
// card" belongs to; a sheet uploaded as VLB can. A P whose trip card is in another log book is listed apart (teal).
import React,{useEffect,useMemo,useState} from 'react';
import {Download,Upload} from 'lucide-react';
import {TripCardFilters,TripCardVerdict} from './trip-card-verdict.jsx';
import {dmy,CORRECTION_KINDS} from '../shared/attendance-sheet-check.mjs';
import {DAY_KINDS,SHEET_BOOKS,dayShiftRows,kindLabel,kindTotals,otherBookRows,personDays,shiftName,wrongTab} from '../shared/site-sheet-days.mjs';
import {readAttendanceFile,sheetApi} from './attendance-sheet-run.mjs';
import {SELECT_BY,readSiteSheetData,selectionOf,siteSheetView,siteSheetWorkbook} from './site-sheet-run.mjs';
import {DateShiftGrid,dateShiftExport,dateShiftGrid} from './date-shift-grid.jsx';
import {downloadBlob} from './download-history.mjs';
import './attendance-sheet-check.css';
import './site-sheet-trip-card.css';

const many=(n,one,more=one+'s')=>n+' '+(n===1?one:more);
const TONE=Object.fromEntries(DAY_KINDS.map(k=>[k.key,k.tone]));
const STATE_TONE={duty:'blue',noDuty:'orange',site:'purple',book:'teal',skip:'grey'};
const TONE_COLOUR={blue:'#1d5fd1',orange:'#d46a00',purple:'#6a3fa0'};
const noPick={kind:'',date:'',shift:'',box:'',all:false,person:'',others:false};
const col=(key,label,extra={})=>({key,label,value:r=>r[key]===''||r[key]===undefined||r[key]===null?'—':r[key],...extra});
const lineKey=l=>[l.row,l.date,l.shift,l.kind].join('|');
// What one log book tab holds: its file, its check, what is opened in its result and its batch and dates.
const blankTab=()=>({file:{busy:false,name:'',sheet:null,error:''},run:{busy:false,error:'',done:null},pick:noPick,filter:{by:'dates',from:'',to:'',batch:''}});
const viewOfTab=(tab,book)=>tab.run.done?.data&&tab.file.sheet?siteSheetView({sheet:tab.file.sheet,data:tab.run.done.data,site:tab.run.done.site,...selectionOf(tab.filter),sheetBook:book}):null;

export default function SiteSheetTripCard({session,ReportSection}){
 const [sites,setSites]=useState({list:null,error:''}),[site,setSite]=useState('');
 const [book,setBook]=useState(SHEET_BOOKS[0].key);
 const [tabs,setTabs]=useState(()=>Object.fromEntries(SHEET_BOOKS.map(b=>[b.key,blankTab()])));
 useEffect(()=>{
  let live=true;
  sheetApi('/api/reports/manpower/attendance-sheet/sites',session).then(p=>{if(!live)return;setSites({list:p.sites||[],error:''});if(p.sites?.length===1)setSite(p.sites[0]);},e=>live&&setSites({list:[],error:e.message}));
  return()=>{live=false;};
 },[session.token]);
 // A change always names its log book: a file read or a check that ends after the user moved to another tab still lands
 // in its own tab.
 const patch=(key,change)=>setTabs(all=>({...all,[key]:{...all[key],...(typeof change==='function'?change(all[key]):change)}}));
 const tab=tabs[book],{file,run,pick,filter}=tab,active=SHEET_BOOKS.find(b=>b.key===book);
 const setPick=next=>patch(book,t=>({pick:typeof next==='function'?next(t.pick):next}));
 const choose=async event=>{
  const key=book,picked=event.target.files?.[0];event.target.value='';if(!picked)return;
  patch(key,{run:{busy:false,error:'',done:null},pick:noPick,file:{busy:true,name:picked.name,sheet:null,error:''}});
  try{const read=await readAttendanceFile(picked);patch(key,t=>({file:{busy:false,name:picked.name,sheet:read,error:''},filter:{...t.filter,from:read.filledDates[0]||'',to:read.filledDates.at(-1)||'',batch:''}}));}
  catch(error){patch(key,{file:{busy:false,name:picked.name,sheet:null,error:error.message}});}
 };
 const check=async()=>{
  const key=book,at=site,held=tabs[key];
  patch(key,{run:{busy:true,error:'',done:null},pick:noPick});
  try{
   const data=await readSiteSheetData({sheet:held.file.sheet,site:at,session});
   const from=held.filter.from&&held.filter.from>=data.range.from&&held.filter.from<=data.range.to?held.filter.from:data.range.from;
   const to=held.filter.to&&held.filter.to<=data.range.to&&held.filter.to>=from?held.filter.to:data.range.to;
   const first=siteSheetView({sheet:held.file.sheet,data,site:at,...selectionOf({...held.filter,from,to,batch:''}),sheetBook:key});
   const made=siteSheetWorkbook(first,{fileName:held.file.name});
   downloadBlob(made.blob,made.name,{title:made.title});
   patch(key,t=>({filter:{...t.filter,from,to,batch:''},run:{busy:false,error:'',done:{data,site:at,name:made.name}}}));
  }catch(error){patch(key,{run:{busy:false,error:error.message,done:null}});}
 };
 // One site for the three sheets: another site clears the three results (the files stay; Check again).
 const chooseSite=value=>{setSite(value);setTabs(all=>Object.fromEntries(Object.entries(all).map(([key,t])=>[key,{...t,run:{busy:false,error:'',done:null},pick:noPick,filter:{...t.filter,batch:''}}])));};
 // Each tab's result is worked out from what that tab read; only its own batch and dates work it out again.
 const vlb=useMemo(()=>viewOfTab(tabs.VLB,'VLB'),[tabs.VLB.run.done?.data,tabs.VLB.file.sheet,tabs.VLB.filter]);
 const elb=useMemo(()=>viewOfTab(tabs.ELB,'ELB'),[tabs.ELB.run.done?.data,tabs.ELB.file.sheet,tabs.ELB.filter]);
 const lmv=useMemo(()=>viewOfTab(tabs.LMV,'LMV'),[tabs.LMV.run.done?.data,tabs.LMV.file.sheet,tabs.LMV.filter]);
 const views={VLB:vlb,ELB:elb,LMV:lmv},view=views[book];
 const anyBusy=Object.values(tabs).some(t=>t.file.busy||t.run.busy),anyResult=Object.values(views).some(Boolean);
 const sheet=file.sheet,ready=Boolean(sheet&&site&&!run.busy);
 const data=run.done?.data;
 const done=view?{...view,name:run.done.name}:null,result=view?.result;
 const lines=view?.lines||[];
 const setChoice=change=>patch(book,t=>({filter:{...t.filter,...change},pick:noPick}));
 const download=()=>{const made=siteSheetWorkbook(view,{fileName:file.name});downloadBlob(made.blob,made.name,{title:made.title});patch(book,t=>({run:{...t.run,done:{...t.run.done,name:made.name}}}));};
 const totals=useMemo(()=>kindTotals(lines),[lines]);
 const shown=useMemo(()=>pick.kind?lines.filter(l=>l.kind===pick.kind):lines,[lines,pick.kind]);
 const grid=useMemo(()=>dateShiftGrid(dayShiftRows(shown),{sumKeys:['total','card','noCard','away']}),[shown]);
 const others=useMemo(()=>otherBookRows(result),[result]),misplaced=useMemo(()=>wrongTab(result),[result]);
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
 // What a tab says about itself before it is opened.
 const noteOf=key=>{
  const t=tabs[key],v=views[key];
  if(t.file.busy)return {tone:'wait',text:'Reading the file…'};
  if(t.run.busy)return {tone:'wait',text:'Comparing with Pulse-II…'};
  if(v){const cards=v.summary.attention,missing=v.lines.filter(l=>l.kind==='noCard').length;
   return {tone:cards||missing?'bad':'ok',text:cards||missing?cards+(cards===1?' trip card needs':' trip cards need')+' attention · '+missing+' sheet P, no trip card':'Checked: nothing needs attention'};}
  if(t.file.error||t.run.error)return {tone:'bad',text:'Could not be checked: open this tab'};
  return t.file.sheet?{tone:'wait',text:'File chosen: press Check'}:{tone:'none',text:'No file yet'};
 };

 const siteRow=result?{id:'site',site:result.site,dates:result.dates.judged.length,people:result.totals.judged,...Object.fromEntries(DAY_KINDS.map(k=>[k.key,totals[k.key]?.lines||0])),book:others.length}:null;
 const siteColumns=[col('site','Site'),col('dates','Dates compared (locked)'),col('people','People compared day by day'),
  ...DAY_KINDS.map(k=>({key:k.key,label:k.label,value:r=>r[k.key],render:r=><button type="button" className={'ssc-num ssc-'+k.tone} disabled={!r[k.key]} aria-pressed={pick.kind===k.key} aria-label={k.label+' · '+r[k.key]} onClick={()=>openKind(k.key)}>{r[k.key]}<small>{many(totals[k.key]?.people||0,'person','people')}</small></button>})),
  {key:'book',label:'Sheet P, trip card in another log book',value:r=>r.book,render:r=><button type="button" className="ssc-num ssc-teal" disabled={!r.book} aria-pressed={pick.others} aria-label={'Sheet P, trip card in another log book · '+many(r.book,'person','people')} onClick={()=>setPick(p=>({...p,others:!p.others}))}>{r.book}<small>{r.book===1?'person':'people'}</small></button>}];
 const exported=dateShiftExport(grid,{count:r=>r.total,countLabel:'people',boxes,shiftLabel:shiftName,dayColumns});
 // A box is one date and shift: those two columns show only when every date is open.
 const step3Columns=[...(pick.all?[col('dateLabel','Date'),col('shiftLabel','Shift')]:[]),...(pick.box||pick.kind?[]:[col('kindLabel','Mismatch')]),col('id','EMP. ID'),col('name','Name in sheet'),col('pulseName','Name in Pulse-II'),col('designation','Designation'),
  col('sheetSays','Sheet says'),col('pulseSays','Pulse-II says'),...(listed.some(l=>l.nearest)?[col('nearest','Nearest shift worked here')]:[]),...(listed.some(l=>l.books)?[col('books','Trip cards / log books')]:[])];
 // The correction is one sentence per way: said once above the table (the Excel keeps it on every line).
 const advice=[...new Set(listed.map(l=>l.correction))];
 const step4Columns=[col('dateLabel','Date'),col('sheetSays','Sheet says'),col('pulseSays','Pulse-II says'),col('result','Result'),col('books','Trip cards / log books'),col('equipment','Equipment')];
 const otherColumns=[col('id','EMP. ID'),col('name','Name in sheet'),col('pulseName','Name in Pulse-II'),col('designation','Designation'),col('books','Trip cards are in'),col('which','Which days'),
  col('days','P days in the sheet'),col('cardDays','With a trip card there'),col('noCardDays','With no trip card'),col('datesLabel','Dates')];
 const where=pick.all?'All dates':dmy(pick.date)+' · '+shiftName(pick.shift);

 return <div className="asc-page ssc-page">
  <p className="asc-intro">The site's attendance Excel is checked one log book at a time. Choose <b>VLB</b>, <b>ELB</b> or <b>LMV</b>, upload the sheet of that log book (one line per employee with EMP. ID, NAME and DESIGNATION, and one column per date marked P or A), choose the site and press Check. Pulse-II compares it with the trip cards, log books and zero-trip entries of that log book only, on the locked dates, both ways: <b>trip card present, sheet not P</b>, and <b>sheet P, no trip card</b>. Each log book keeps its own file and its own result: press its tab to see it. Nothing is changed in Pulse-II.</p>
  <section className="ssc-books" aria-label="Log book of the sheet">
   <h2>Which sheet are you uploading?</h2>
   <div className="ssc-book-tabs" role="tablist" aria-label="Log book of the sheet">
    {SHEET_BOOKS.map(b=>{const note=noteOf(b.key);return <button key={b.key} type="button" role="tab" aria-selected={book===b.key} onClick={()=>setBook(b.key)}>
     <b>{b.label}</b><span>{b.about}</span>{tabs[b.key].file.name&&<em>{tabs[b.key].file.name}</em>}<small className={'ssc-book-'+note.tone}>{note.text}</small></button>;})}
   </div>
  </section>
  <div className="asc-steps ssc-steps" role="tabpanel" aria-label={active.label}>
   <section className="asc-step"><h2>1 · {book} attendance Excel of the site</h2>
    <label className={'asc-upload'+(file.busy?' busy':'')}><Upload size={16}/>{file.busy?'Reading the file…':sheet?'Choose another '+book+' file':'Choose the '+book+' Excel file'}<input type="file" accept=".xlsx,.xlsm,.xlk" disabled={file.busy||run.busy} onChange={choose}/></label>
    {sheet&&<p className="asc-note" role="status"><strong>{file.name}</strong> · sheet “{sheet.sheetName}” · {many(sheet.people.length,'employee')} · {sheet.filledDates.length?'marks from '+dmy(sheet.filledDates[0])+' to '+dmy(sheet.filledDates.at(-1)):'no date is marked'}{sheet.missingDates.length?' · no column for '+sheet.missingDates.map(dmy).join(', '):''}</p>}
    {file.error&&<p className="asc-error" role="alert">{file.name}: {file.error}</p>}
    {!sheet&&!file.busy&&!file.error&&<p className="asc-hint">Only the people of the {active.about.split(' · ')[0]} belong in this file. If the site keeps one sheet for everyone, upload that same file here: the people whose trip cards are in another log book are listed apart.</p>}
   </section>
   {/* Owner, 24 Nov 2026: the batch and dates sit in Step 2 with the site, so Check is the last step. The log book is not
       chosen here any more: it is the tab chosen above, before the upload. */}
   <section className="asc-step"><h2>2 · Site, batch and dates</h2>
    <TripCardFilters tabs={false} filter={filter} onChange={setChoice} min={data?.range.from||sheet?.filledDates[0]} max={data?.range.to||sheet?.filledDates.at(-1)}
     batches={view?.batches} disabled={run.busy||!sheet} checked={Boolean(view)} ways={SELECT_BY}>
     <label>Site<select aria-label="Site of this attendance sheet" value={site} disabled={anyBusy||!sites.list} onChange={e=>chooseSite(e.target.value)}>
      <option value="">{sites.list?'Select the site':'Reading your sites…'}</option>{(sites.list||[]).map(name=><option key={name} value={name}>{name}</option>)}
     </select></label>
    </TripCardFilters>
    {sites.error&&<p className="asc-error" role="alert">{sites.error}</p>}
    {sites.list&&!sites.list.length&&!sites.error&&<p className="asc-error" role="alert">No site is assigned to your login.</p>}
    {!sheet&&<p className="asc-hint">The dates open once the {book} Excel file is chosen in Step 1.</p>}
    {sheet&&filter.by==='batch'&&<p className="asc-hint">Batch wise: every date of the sheet{period?' ('+period+')':''}.{view?'':' The batches are listed after Check.'}</p>}
    {sheet&&filter.by==='both'&&!view&&<p className="asc-hint">The batches are listed after Check.</p>}
    {anyResult&&<p className="asc-hint">One site for the VLB, ELB and LMV sheets. Another site clears the three results; the files stay.</p>}
   </section>
   <section className="asc-step"><h2>3 · Check</h2>
    <div className="ssc-run-row">
     <button type="button" className="asc-run" disabled={!ready} onClick={check}><Download size={16}/>{run.busy?'Comparing with Pulse-II…':'Check '+book+' and download Excel'}</button>
     {view&&<button type="button" className="asc-run light" disabled={run.busy} onClick={download}><Download size={16}/>Download Excel of this selection</button>}
    </div>
    {run.busy&&<p className="asc-note" role="status">Reading Pulse-II attendance of these dates. A full month takes up to a minute.</p>}
    {!sheet&&!file.busy&&<p className="asc-hint">Choose the {book} Excel file first.</p>}{sheet&&!site&&<p className="asc-hint">Select the site.</p>}
   </section>
  </div>
  {run.error&&<p className="asc-error" role="alert">{run.error}</p>}
  {misplaced&&<p className="ssc-wrong-tab" role="alert">Is this the {misplaced.book} sheet? {misplaced.whole} of the {result.totals.people} people in this file have every trip card in another log book ({misplaced.book}: {misplaced.people}), and only {result.totals.judged} can be compared with {book} trip cards. Open the <b>{misplaced.book} sheet</b> tab and upload this file there.</p>}
  {result&&<TripCardVerdict key={'ssc-verdict-'+book+'-'+done.name} view={view} ReportSection={ReportSection} withSheet against={'the '+book+' sheet'} site={result.site} period={period}/>}
  {result&&<>
   <section className="asc-result" aria-label={'Result of the '+book+' check'}>
    <h2>{result.site} · {book} sheet · {period||'no date to compare'} · {many(result.totals.corrections,'correction')} for {many(result.totals.peopleWithCorrections,'employee')}</h2>
    <p className="asc-note" role="status">The Excel <strong>{done.name}</strong> is in your Downloads folder and in Download History (the folder button at the top). <button type="button" className="asc-again" onClick={download}>Download again</button></p>
    {view.batch&&<p className="asc-hint">These counts are the whole {book} sheet from {dmy(view.from)} to {dmy(view.to)}, every batch. The trip card lines and the date by shift below are batch {view.batch} only; "Sheet P, no trip card" has no card, so no batch: it shows under All batches.</p>}
    <table className="asc-counts"><tbody>
     <tr><th scope="row">Employees in the {book} sheet</th><td>{result.totals.people}</td></tr>
     <tr><th scope="row">Compared day by day with {book} trip cards (drivers and operators, or anyone with a duty on {book} in Pulse-II)</th><td>{result.totals.judged}</td></tr>
     <tr><th scope="row">Dates compared (locked in Pulse-II)</th><td>{result.dates.judged.length}</td></tr>
     <tr><th scope="row">Dates not locked in Pulse-II yet</th><td>{result.dates.pending.length}</td></tr>
     {kinds.map(([kind,label])=><tr key={kind}><th scope="row">{label}</th><td>{result.counts[kind]}</td></tr>)}
     <tr><th scope="row">Marked P in this sheet, trip card in another log book (people, listed apart, not a correction)</th><td>{others.length}</td></tr>
    </tbody></table>
    {done.range.cut&&<p className="asc-hint">The sheet covers more than 31 days: only the first 31 are compared.</p>}
   </section>
   <ReportSection key={'ssc-site-'+book+'-'+done.name} title={'Step 1 · '+result.site+' · '+book+' trip card against the '+book+' sheet · '+period} category="site-sheet-trip-card-site" description="People-days each way: one person on one date. Press a number to see only that way in the date by shift table. The last column counts people: marked P in this sheet, with the trip card in another log book." rows={[siteRow]} columns={siteColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}/>
   {pick.others&&<ReportSection key={'ssc-others-'+book+'-'+done.name} title={'In the '+book+' sheet, trip card in another log book · '+many(others.length,'person','people')} category="site-sheet-trip-card-other-book" description={'Marked P in the '+book+' sheet, but the trip card of that date is in another log book. They are present: nothing is counted against '+book+' and nothing is listed as a missing card. "Every trip card" = no '+book+' trip card on any compared date: check that person under the tab of his own log book. Press a line for that person day by day.'} rows={others} columns={otherColumns} rowKey={r=>r.key} rowClassName={r=>'ssc-row-teal'+(String(pick.person)===String(r.row)?' report-row-picked':'')} onRowClick={r=>setPick(p=>({...p,person:String(r.row)}))} recordDateFilter={false} emptyMessage="Nobody."/>}
   <ReportSection key={'ssc-dates-'+book+'-'+done.name+'-'+pick.kind} title={'Step 2 · '+result.site+' · '+book+' · date by shift · '+way} category="site-sheet-trip-card-dates" description="In each box: the people of that date and shift, then a coloured box for each way. The site sheet has dates only, no shift: a person the sheet marks P with no trip card at all is under Shift not in sheet. Press a box for its people, All dates for everyone." rows={exported.rows} columns={exported.columns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="ssc-kinds" role="group" aria-label="Ways shown">
     <button type="button" aria-pressed={!pick.kind} onClick={()=>setPick(p=>({...noPick,others:p.others}))}>Both ways <small>{lines.length}</small></button>
     {DAY_KINDS.map(k=><button key={k.key} type="button" className={'ssc-'+k.tone} aria-pressed={pick.kind===k.key} disabled={!totals[k.key]?.lines} onClick={()=>openKind(k.key)}>{k.label} <small>{totals[k.key]?.lines||0}</small></button>)}
    </div>
    <p className="ssc-legend">{DAY_KINDS.map(k=><span key={k.key} style={{'--ssc-tone':TONE_COLOUR[k.tone]}}>{k.label}</span>)}</p>
    <DateShiftGrid grid={grid} count={r=>r.total} countLabel="people" boxes={boxes} dayColumns={dayColumns} shiftLabel={shiftName}
     onOpen={(r,box)=>setPick(p=>({...p,date:r.date,shift:r.shift,box,all:false,person:''}))} onOpenAll={()=>setPick(p=>({...p,date:'',shift:'',box:'',all:true,person:''}))}
     isPicked={r=>!pick.all&&pick.date===r.date&&pick.shift===r.shift} pickedBox={pick.box} allPicked={pick.all} ariaLabel={book+' trip card against the sheet by date and shift'}
     emptyMessage={lines.length?'Nothing this way.':'No date of this sheet differs from Pulse-II '+book+' trip cards.'}/>
   </ReportSection>
   {opened?<ReportSection key={'ssc-people-'+book+'-'+done.name+'-'+pick.kind+'-'+where+'-'+pick.box} title={'Step 3 · '+result.site+' · '+book+' · '+where+' · '+(pick.box?kindLabel(pick.box):way)+' · people'} category="site-sheet-trip-card-people" description={many(listed.length,'line')+' · '+many(new Set(listed.map(l=>l.id)).size,'person','people')+' · Press a line for that person day by day.'+(advice.length===1?' Correction: '+advice[0]:'')} rows={listed} columns={step3Columns} rowKey={r=>r.key} rowClassName={r=>'ssc-row-'+TONE[r.kind]+(String(pick.person)===String(r.row)?' report-row-picked':'')} onRowClick={r=>setPick(p=>({...p,person:String(r.row)}))} recordDateFilter={false} emptyMessage="Nobody in this box."/>
    :lines.length?<p className="ssc-notice">Press a box in the date by shift table to see its people, then a person for his days.</p>:null}
   {person&&<ReportSection key={'ssc-person-'+book+'-'+done.name+'-'+person.row} title={'Step 4 · '+(person.name||person.id)+' · '+person.id+' · day by day'} category="site-sheet-trip-card-person" description={(person.designation||'')+' · Row '+person.row+' of the '+book+' sheet · every date of the sheet, the mark beside Pulse-II.'} rows={days} columns={step4Columns} rowKey={r=>r.id} rowClassName={r=>STATE_TONE[r.state]?'ssc-row-'+STATE_TONE[r.state]:''} recordDateFilter={false}/>}
  </>}
 </div>;
}
