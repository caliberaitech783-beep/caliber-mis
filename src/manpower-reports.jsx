import {compareShiftLabels,isSiteName,shiftChoiceLabel,siteChoices} from '../shared/report-filter-options.mjs';
import './log-book-readability.css';
import {compactLogBookLabel} from '../shared/log-book-labels.mjs';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {StepBackButton} from './step-back.jsx';
import TableSmartPrint from './table-smart-print.jsx';
import {SortableHeader,sortRowsBlanksLast} from './sortable-table.jsx';
import {DateShiftGrid,dateShiftGrid} from './date-shift-grid.jsx';
import AttendanceRegister from './attendance-register.jsx';
import {canonicalSiteName} from '../shared/site-location.mjs';
import {OPERATIONAL_START,monthStartDate} from '../shared/operational-start.mjs';
import './manpower-reports.css';

const views=[['manpower','Manpower by Category'],['manpower-reconciliation','Manpower by Category Reconciliation'],['employee','Shift Performance'],['attendance','Shift Attendance Equipment Wise'],['ot','OT & Multiple Duties'],['attendance-batch','Attendance Batch-wise'],['attendance-month','Attendance Month-wise']];
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const columns=entries=>entries.map(([key,label])=>({key,label:compactLogBookLabel(label),value:r=>r[key]??'—'}));
const context=[['date','Duty date'],['site','Site'],['shift','Shift']];
const person=[['employeeId','Employee ID'],['caliberCode','Caliber ID'],['employeeName','Driver / operator']];
const EVERY='*';
// Shift A, B and C everywhere (S1, S2, S3 on the cards), as the Shift Master names them; Day and Night at Dudhichua East.
const shiftName=code=>shiftChoiceLabel(code)||code;
const stageName=state=>({vlb_open:'VLB open',lmv_open:'LMV open',elb_open:'ELB open'})[state]||'Open';
const batchOpen=b=>/_open$/.test(b.state);
const shortDate=date=>date.slice(8,10)+'-'+date.slice(5,7)+'-'+date.slice(2,4);
const weekday=date=>new Date(date+'T00:00:00Z').toLocaleString('en-IN',{weekday:'short',timeZone:'UTC'});
const nextDay=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const monthName=month=>new Date(month+'-01T00:00:00Z').toLocaleString('en-IN',{month:'short',year:'numeric',timeZone:'UTC'});
const many=(n,word)=>n+' '+word+(n===1?'':'s');
const duties=n=>n+(n===1?' duty':' duties');
const percent=(part,whole)=>whole?Math.round(part*1000/whole)/10+'%':'—';
const FLAG_ORDER={red:0,orange:1,review:2,normal:3};
const dutyCount=(n,kind)=>n+' '+kind+(n===1?' duty':' duties');
// Colours shared by both reports. Red, orange and brown are the OT patterns; blue is attendance only.
const dutyFlags=[['red','Red','Back-to-back shifts, or all three shifts'],['orange','Orange','Shift A and Shift C with a gap'],['review','Brown','Shift pattern needs review'],['zero','Blue','Present with 0 trips']];
const otFlags=dutyFlags.slice(0,3);
// Step 1 (sites) and Step 3 (equipment categories) sort by any heading; the All sites / All categories line stays last.
// Percentages are stored as text ("12.5%") and sort as numbers; "—" and empty values go to the bottom.
const stepValue=(row,key)=>{const value=row[key];return typeof value==='string'&&/^\d+(?:\.\d+)?%$/.test(value)?parseFloat(value):value;};
export function stepSorter(sorts={},setSorts=()=>{},id){
 const sort=sorts[id]||{key:'',direction:'asc'};
 const onSort=key=>setSorts(all=>{const now=all[id]||{};return {...all,[id]:{key,direction:now.key===key&&now.direction==='asc'?'desc':'asc'}};});
 const head=(key,label,small,extra={})=><SortableHeader key={key} scope="col" label={small?<>{label}<small>{small}</small></>:label} labelText={label} sortKey={key} sort={sort} onSort={onSort} filterIcon={false} {...extra}/>;
 const rows=(list,isTotal=()=>false)=>[...sortRowsBlanksLast(list.filter(row=>!isTotal(row)),sort,stepValue),...list.filter(isTotal)];
 return {head,rows};
}
const logBooks=[['VLB','Vehicle Log Book'],['ELB','Equipment Log Book'],['LMV','LMV Log Book']];
const flagChip=key=>c=>c.key===key?{...c,render:r=><strong className={'mp-flag mp-flag-'+(r.flag||r.severity)}>{r[key]}</strong>}:c;
// The driver's name opens his history; the row carries `driverId` (driver and site).
const driverButton=(opened,openDriver)=>c=>c.key==='employeeName'?{...c,render:r=><button type="button" className="mp-driver-open" aria-pressed={opened===r.driverId} aria-label={'History of '+r.employeeName} onClick={()=>openDriver(opened===r.driverId?'':r.driverId)}>{r.employeeName}</button>}:c;
// Date, site and shift sit in the heading; each returns as a column only when the list covers more than one.
const attendanceColumns=({days,sites,shifts,equipment,month,year,opened,openDriver})=>columns([...(days?[['date','Duty date']]:[]),...(sites?[['site','Site']]:[]),...(shifts?[['shift','Shift']]:[]),...person,['otMonth','OT in '+monthName(month)],['otYear','OT in '+year],['doors','Door / equipment'],...(equipment?[['equipment','Equipment']]:[]),['makeModel','Make / model'],['status','Attendance'],['trips','Completed VLB trips'],['actualLabel','Actual duty'],['flagLabel','Duty flag'],['note','Duty note'],['reason','Zero-trip reason'],['remarks','Remarks']]).map(flagChip('flagLabel')).map(driverButton(opened,openDriver));
// Step 4 of OT & Multiple Duties: one row per duty. Date, shift, site and category return as columns only when the list covers more than one.
const otDutyColumns=({days,shifts,sites,equipment,month,year,opened,openDriver})=>columns([...(days?[['date','Duty date']]:[]),...(shifts?[['shift','Shift']]:[]),...(sites?[['site','Site']]:[]),...person,['category','Driver category'],...(equipment?[['equipment','Equipment category']]:[]),['doors','Door / equipment'],['makeModel','Make / model'],['logBook','Log book'],['others','Other shift worked'],['flagLabel','OT colour / reason'],['hours','HMR hours (this shift)'],['trips','Completed VLB trips'],['otMonthRed','Red in '+monthName(month)],['otMonthOrange','Orange in '+monthName(month)],['otYearRed','Red in '+year],['otYearOrange','Orange in '+year],['books','Saved cards']]).map(flagChip('flagLabel')).map(driverButton(opened,openDriver));
const otColumns=columns([['reason','OT flag / reason'],['logBook','Log book'],...person,['category','Driver category'],['equipment','Equipment worked'],['site','Site'],['dates','Duty dates'],['shifts','Shifts worked'],['shiftHours','Each shift’s HMR hours'],['combinedHours','Combined HMR performance hours'],['schedule','Scheduled start / end (IST)'],['gaps','Scheduled gap between duties'],['batches','Source batches'],['books','Saved cards'],['remarks','Remarks / review']]).map(flagChip('reason'));
const driverHistoryColumns=columns([['date','Duty date'],['reason','OT flag / reason'],['shifts','Shifts worked'],['logBook','Log book'],['equipment','Equipment worked'],['combinedHours','Combined HMR performance hours'],['books','Saved cards']]).map(flagChip('reason'));
const classification=[['category','Category'],['group','Equipment group'],['make','Make'],['model','Model']];
const detailColumns=columns([...context,['door','Door / equipment'],...classification,...person,['assignment','Assignment'],['batches','Source batches'],['batchStatus','Batch status'],['book','Saved card'],['remarks','Remarks / review']]);
const summaryColumns=columns([...context,...classification,['assets','Distinct vehicles / equipment'],['employees','Distinct employees'],['unresolved','Unresolved assignment records'],['doors','Door numbers'],['batches','Source batches']]);
const exceptionColumns=columns([...context,['door','Door / equipment'],['employeeId','Employee ID'],['employeeName','Driver / operator'],['book','Saved card'],['logBook','Log book'],['batches','Source batches'],['reason','What to correct']]);
const noPick={siteKey:'',mark:'',scope:false,at:'',date:'',shift:'',equipment:'',flag:''},noOtPick={siteKey:'',filter:'',scope:false,date:'',shift:'',equipment:'',flag:''};
const noRcPick={siteKey:'',scope:false,date:'',shift:'',equipment:'',status:''};
const noMpPick={siteKey:'',scope:false,date:'',shift:'',equipment:''};
const noPfPick={siteKey:'',scope:false,date:'',shift:'',equipment:''};
const remembered=key=>{try{return localStorage.getItem(key)==='true';}catch{return false;}};
const remember=(key,value)=>{try{localStorage.setItem(key,String(value));}catch{}};

// The register's lighter read sends no selection lists, so its Site list is the sites that read reports on: each once,
// by its OC name. Without it the Site box of Attendance Batch-wise and Month-wise offered only All (owner, 23 Nov 2026).
const registerSites=payload=>siteChoices([...(payload.otSites||[]),...(payload.attendanceSites||[])].map(s=>s.site));
// The site that is open in a report: the only site when there is one, else the one picked (or every site).
const openSite=(sites,picked)=>sites.length===1?sites[0].siteKey:picked===EVERY||sites.some(s=>s.siteKey===picked)?picked:'';
// Month and year counts arrive in a separate read for one site. Until then a cell says so instead of showing a zero;
// in a list of every site, pressing a driver's name reads that driver's site.
const tallyReader=(tally,tallyKey,tallySite)=>{
 const counted=tally.key===tallyKey,data=counted?tally.data:null,drivers=new Map((data?.drivers||[]).map(d=>[d.employeeKey+'|'+d.siteKey,d]));
 return {counted,data,error:counted?tally.error:'',record:id=>drivers.get(id),count:(id,siteKey,span,level='total')=>siteKey!==tallySite?'Press the name':data?drivers.get(id)?.[span][level]||0:counted?'Unavailable':'Checking…'};
};

// One driver's history for the year, opened from his name: duties and OT month by month, then every flagged duty.
// Plain render function: its state lives in ManpowerReports.
function driverHistory({driver,detail,reader,year,close,historyBox,ReportSection,sectionKey}){
 const record=reader.record(driver.driverId),events=record?.events||[],worked=record?.duties||{};
 const months=[...new Set([...events.map(e=>e.date.slice(0,7)),...Object.keys(worked)])].sort().map(month=>{const list=events.filter(e=>e.date.slice(0,7)===month),n=level=>list.filter(e=>e.severity===level).length;return {month,duties:worked[month]||0,red:n('red'),orange:n('orange'),review:n('review'),total:list.length,otDuties:new Set(list.flatMap(e=>String(e.shifts||'').split('; ').filter(Boolean))).size};});
 // OT % of duties: the duties that were part of a case, out of the duties worked. Never above the duties counted.
 const share=m=>percent(Math.min(m.otDuties,m.duties),m.duties);
 const sum=key=>months.reduce((total,m)=>total+m[key],0),period=reader.data?shortDate(reader.data.yearFrom)+' to '+shortDate(reader.data.yearTo):'';
 return <>
  <div ref={historyBox} className="mp-category mp-driver-history"><h2>{driver.employeeName} · history {year}</h2>
   <p className="mp-category-hint">{[driver.employeeId,detail,driver.site,period].filter(Boolean).join(' · ')} · Duties are saved VLB and ELB cards, one per shift. Each red, orange or brown case counts as one OT. <button type="button" onClick={close}>Close history</button></p>
   {reader.data?<><TableSmartPrint row title={driver.employeeName+' · history '+year+' · month by month'}/><table><thead><tr><th>Month</th><th>Duties</th><th>Red</th><th>Orange</th><th>Brown</th><th>OT times</th><th>OT % of duties</th></tr></thead>
    <tbody>{months.map(m=><tr key={m.month}><td>{monthName(m.month)}</td><td>{m.duties}</td><td>{m.red}</td><td>{m.orange}</td><td>{m.review}</td><td>{m.total}</td><td>{share(m)}</td></tr>)}
    <tr className="mp-total"><td>Year {year}</td><td>{sum('duties')}</td><td>{sum('red')}</td><td>{sum('orange')}</td><td>{sum('review')}</td><td>{sum('total')}</td><td>{share({otDuties:sum('otDuties'),duties:sum('duties')})}</td></tr></tbody></table></>
    :<p role={reader.counted?'alert':'status'}>{reader.counted?reader.error||'The history could not be read. Press Refresh reports and try again.':'Reading this driver’s history…'}</p>}
  </div>
  {reader.data&&<ReportSection key={sectionKey} title={driver.employeeName+' · flagged duties in '+year} category="manpower-ot-driver-history" description={driver.site+' · '+period+' · Newest first'} rows={events} columns={driverHistoryColumns} rowKey={r=>r.id} rowClassName={r=>'mp-ot-'+r.severity} recordDateFilter={false} emptyMessage="No red, orange or brown duty for this driver in this year."/>}
 </>;
}

// OT & Multiple Duties, five steps: every site, one site date by shift, one date and shift by equipment category,
// the drivers of a category, one driver's history. Plain render function: its state lives in ManpowerReports.
// Cases (one driver, several shifts) are counted on the site lines; from the date table down every number is a duty
// (one driver, one shift, one date) and a duty carries the colour of the case it is part of.
function otOverview({stepSorts,setStepSorts,report,filters,query,ReportSection,sites,otPick,setOtPick,logBook,setLogBook,tally,tallyKey,tallySite,driverOpen,setDriverOpen,historyBox}){
 // A duty saved in two log books belongs to both, so it is counted under each.
 const inBook=r=>!logBook||(r.logBooks||[]).includes(logBook);
 const cases=report.ot.filter(inBook),lines=(report.otDuties||[]).filter(inBook);
 const of=(site,level)=>cases.filter(r=>(site===EVERY||r.siteKey===site)&&(!level||r.severity===level));
 const worked=site=>lines.filter(r=>site===EVERY||r.siteKey===site);
 const flagged=(list,level)=>list.filter(r=>level?r.flag===level:r.flag!=='normal').length;
 const driversIn=list=>new Set(list.map(r=>r.employeeKey+'|'+r.siteKey)).size;
 const groups=list=>{const out=new Map();for(const r of list){if(!out.has(r.equipment))out.set(r.equipment,[]);out.get(r.equipment).push(r);}return [...out].map(([equipment,held])=>({equipment,list:held})).sort((a,b)=>b.list.length-a.list.length||String(a.equipment).localeCompare(String(b.equipment)));};
 const siteKey=openSite(sites,otPick.siteKey),inSite=siteKey?worked(siteKey):[];
 // Step 2: the open site date by shift, for every equipment category or the one picked on the strip above the table.
 const strip=groups(inSite),filter=strip.some(g=>g.equipment===otPick.filter)?otPick.filter:'',shown=filter?inSite.filter(r=>r.equipment===filter):inSite;
 const span=[];for(let day=filters.from;day<=filters.to&&span.length<32;day=nextDay(day))span.push(day);
 const gridDates=[...new Set([...span,...shown.map(r=>r.date)])].sort(),gridShifts=[...new Set(['S1','S2','S3',...inSite.map(r=>r.shift).filter(Boolean)])].sort();
 // Step 3: a date and shift (or a whole day, or every date) by equipment category.
 const scope=Boolean(siteKey&&otPick.scope),date=scope&&gridDates.includes(otPick.date)?otPick.date:'',shift=scope&&gridShifts.includes(otPick.shift)?otPick.shift:'';
 const at=(day,code)=>shown.filter(r=>(!day||r.date===day)&&(!code||r.shift===code)),scoped=scope?at(date,shift):[];
 const tallyOf=list=>({people:new Set(list.map(r=>r.employeeKey)).size,duties:list.length,machines:new Set(list.flatMap(r=>String(r.doors||'').split('; ').filter(Boolean))).size,red:flagged(list,'red'),orange:flagged(list,'orange'),review:flagged(list,'review'),ot:flagged(list,'')});
 const withShare=t=>({...t,redPct:percent(t.red,t.duties),orangePct:percent(t.orange,t.duties),otPct:percent(t.ot,t.duties)});
 const categories=groups(scoped).map(g=>({id:g.equipment,equipment:g.equipment,...withShare(tallyOf(g.list))})),everyCategory={id:EVERY,equipment:'All categories',...withShare(tallyOf(scoped))};
 // Step 4: the drivers of one category (or of all), OT duties first.
 const open=scope&&(otPick.equipment===EVERY||categories.some(c=>c.equipment===otPick.equipment))?otPick.equipment:'',flag=open?otPick.flag:'';
 const reader=tallyReader(tally,tallyKey,tallySite),month=filters.to.slice(0,7),year=filters.to.slice(0,4);
 const listed=(open?scoped.filter(r=>(open===EVERY||r.equipment===open)&&(!flag||r.flag===flag)):[]).map(r=>{const driverId=r.employeeKey+'|'+r.siteKey;return {...r,driverId,otMonthRed:reader.count(driverId,r.siteKey,'month','red'),otMonthOrange:reader.count(driverId,r.siteKey,'month','orange'),otYearRed:reader.count(driverId,r.siteKey,'year','red'),otYearOrange:reader.count(driverId,r.siteKey,'year','orange')};})
  .sort((a,b)=>FLAG_ORDER[a.flag]-FLAG_ORDER[b.flag]||a.date.localeCompare(b.date)||String(a.shift).localeCompare(String(b.shift))||String(a.employeeName).localeCompare(String(b.employeeName)));
 const opened=listed.find(r=>r.driverId===driverOpen);
 // The cases behind the listed OT duties: a case names every duty in it as "date shift".
 const held=new Set(listed.filter(r=>r.flag!=='normal').map(r=>r.employeeKey+'|'+r.siteKey+'|'+r.date+' '+r.shift));
 const listedCases=open?of(siteKey,'').filter(c=>String(c.shifts||'').split('; ').some(part=>held.has(c.employeeKey+'|'+c.siteKey+'|'+part))):[];
 const books=logBook||'VLB, ELB and LMV',colour=otFlags.find(([id])=>id===flag)?.[1]||'',siteLabel=siteKey===EVERY?'All sites':sites.find(s=>s.siteKey===siteKey)?.site||'';
 const dateLabel=filters.from!==filters.to?shortDate(filters.from)+' to '+shortDate(filters.to):shortDate(filters.from);
 const oneDate=gridDates.length===1,wide=!shift||!(date||oneDate);
 const scopeLabel=[date?shortDate(date):oneDate?shortDate(gridDates[0]):'All dates',shift?shiftName(shift):'All shifts'].join(' · ');
 const openLabel=open===EVERY?'All categories':open,base={...noOtPick,siteKey,filter};
 const openSiteAt=site=>setOtPick(siteKey===site&&sites.length>1?noOtPick:{...noOtPick,siteKey:site});
 const show=(day,code,level)=>setOtPick(scope&&date===day&&shift===code&&(level?open===EVERY&&flag===level:!open)?base:{...base,scope:true,date:day,shift:code,equipment:level?EVERY:'',flag:level});
 const list=(name,level)=>setOtPick(open===name&&flag===level?{...base,scope:true,date,shift}:{...base,scope:true,date,shift,equipment:name,flag:level});
 const zero=<span className="mp-zero">0</span>;
 // Step 1: one line per site. Every number opens that site.
 const siteTally=(site,name)=>{const all=worked(site);return {id:site,siteKey:site,site:name,duties:all.length,red:of(site,'red').length,orange:of(site,'orange').length,review:of(site,'review').length,redPct:percent(flagged(all,'red'),all.length),orangePct:percent(flagged(all,'orange'),all.length),drivers:driversIn(of(site,''))};};
 // Sites run from the highest Red OT % to the lowest; equal percentages by more red cases, then by name. A site with no duty comes last.
 const redShare=s=>{const all=worked(s.siteKey);return all.length?flagged(all,'red')/all.length:-1;};
 const byRedShare=sites.map(s=>({s,share:redShare(s)})).sort((a,b)=>b.share-a.share||of(b.s.siteKey,'red').length-of(a.s.siteKey,'red').length||a.s.site.localeCompare(b.s.site)).map(x=>x.s);
 const siteRows=[...byRedShare.map(s=>siteTally(s.siteKey,s.site)),...(sites.length>1?[siteTally(EVERY,'All sites')]:[])];
 const s1=stepSorter(stepSorts,setStepSorts,'ot-sites'),s3=stepSorter(stepSorts,setStepSorts,'ot-categories'),sortedSites=s1.rows(siteRows,row=>row.siteKey===EVERY),sortedCategories=s3.rows(categories);
 const line=s=>{const total=s.siteKey===EVERY&&sites.length>1,pressed=siteKey===s.siteKey;return <tr key={s.siteKey} className={[total&&'mp-att-total',pressed&&'mp-on'].filter(Boolean).join(' ')||undefined}>
  <th scope="row">{s.site}</th>
  <td>{s.duties?<button type="button" className="mp-cat-count mp-ot-duties" aria-pressed={pressed} aria-label={duties(s.duties)+' · '+s.site} onClick={()=>openSiteAt(s.siteKey)}>{s.duties}</button>:0}</td>
  {otFlags.map(([id,label])=><td key={id}>{s[id]?<button type="button" className={'mp-cat-count mp-flag-'+id} aria-pressed={pressed} aria-label={s[id]+' '+label+' · '+s.site} onClick={()=>openSiteAt(s.siteKey)}>{s[id]}</button>:0}</td>)}
  <td>{s.redPct}</td><td>{s.orangePct}</td>
  <td>{s.drivers?<button type="button" className="mp-cat-count" aria-pressed={pressed} aria-label={many(s.drivers,'driver')+' · '+s.site} onClick={()=>openSiteAt(s.siteKey)}>{s.drivers}</button>:0}</td>
 </tr>;};
 // One box of the date-by-shift table: the duties, then a number for every colour found there.
 const cell=(day,code,label)=>{const here=at(day,code),on=scope&&date===day&&shift===code;if(!here.length)return zero;
  return <span className="mp-ot-cell"><button type="button" className="mp-cat-count mp-ot-duties" aria-pressed={on&&!flag} aria-label={duties(here.length)+' · '+label} onClick={()=>show(day,code,'')}>{here.length}</button>
   {otFlags.map(([id,name])=>{const n=flagged(here,id);return n?<button key={id} type="button" className={'mp-cat-count mp-flag-'+id} aria-pressed={on&&open===EVERY&&flag===id} aria-label={n+' '+name+' · '+label} onClick={()=>show(day,code,id)}>{n}</button>:null;})}</span>;};
 const dayTally=(day,name)=>{const all=at(day,''),row={id:day||'all',day,date:name,duties:all.length,ot:flagged(all,''),redPct:percent(flagged(all,'red'),all.length),orangePct:percent(flagged(all,'orange'),all.length)};
  for(const code of gridShifts){const here=at(day,code);row[code+'_duties']=here.length;for(const [id] of otFlags)row[code+'_'+id]=flagged(here,id);}return row;};
 const dateRows=[...gridDates.map(day=>dayTally(day,shortDate(day))),...(oneDate?[]:[dayTally('','All dates')])];
 const gridLine=row=>{const total=!row.day&&!oneDate;return <tr key={row.id} className={[total&&'mp-att-total',!total&&scope&&date===row.day&&'mp-on'].filter(Boolean).join(' ')||undefined}>
  <th scope="row">{row.date}{row.day&&<small>{weekday(row.day)}</small>}</th>
  {gridShifts.map(code=><td key={code}>{cell(row.day,code,row.date+' · '+shiftName(code))}</td>)}
  <td>{row.duties?<button type="button" className="mp-cat-count mp-ot-duties" aria-pressed={scope&&date===row.day&&!shift&&!flag} aria-label={duties(row.duties)+' · '+row.date} onClick={()=>show(row.day,'','')}>{row.duties}</button>:zero}</td>
  <td>{row.ot}</td><td>{row.redPct}</td><td>{row.orangePct}</td>
 </tr>;};
 const categoryLine=c=>{const total=c.id===EVERY;return <tr key={c.id} className={[total&&'mp-att-total',open===c.id&&'mp-on'].filter(Boolean).join(' ')||undefined}>
  <td><button type="button" className="mp-cat-open" aria-pressed={open===c.id&&!flag} onClick={()=>list(c.id,'')}>{c.equipment}</button></td>
  <td><button type="button" className="mp-cat-count mp-ot-duties" aria-pressed={open===c.id&&!flag} aria-label={many(c.people,'person')+' · '+c.equipment} onClick={()=>list(c.id,'')}>{c.people}</button></td>
  {wide&&<td>{c.duties}</td>}
  <td>{c.machines}</td>
  {otFlags.map(([id,name])=><React.Fragment key={id}><td>{c[id]?<button type="button" className={'mp-cat-count mp-flag-'+id} aria-pressed={open===c.id&&flag===id} aria-label={c[id]+' '+name+' · '+c.equipment} onClick={()=>list(c.id,id)}>{c[id]}</button>:0}</td>{id!=='review'&&<td>{c[id+'Pct']}</td>}</React.Fragment>)}
  <td>{c.ot}</td><td>{c.otPct}</td>
 </tr>;};
 const siteColumns=columns([['site','Site'],['duties','Total duties'],['red','Red cases'],['orange','Orange cases'],['review','Brown cases'],['redPct','Red OT %'],['orangePct','Orange OT %'],['drivers','Drivers with OT']]);
 const dateColumns=columns([['date','Date'],...gridShifts.flatMap(code=>[[code+'_duties',shiftName(code)+' duties'],[code+'_red',shiftName(code)+' red'],[code+'_orange',shiftName(code)+' orange'],[code+'_review',shiftName(code)+' brown']]),['duties','Day duties'],['ot','OT duties'],['redPct','Red OT %'],['orangePct','Orange OT %']]);
 const categoryColumns=columns([['equipment','Equipment category'],['people','People'],...(wide?[['duties','Duties']]:[]),['machines','Equipment worked (nos.)'],['red','Red OT'],['redPct','Red OT %'],['orange','Orange OT'],['orangePct','Orange OT %'],['review','Brown'],['ot','Total OT'],['otPct','Total OT %']]);
 return <>
  <p className="mp-notice">A case is one driver working more than one shift: back to back (red), Shift A and Shift C on one day (orange), or a pattern that needs checking (brown). {many(cases.length,'case')} and {many(driversIn(cases),'driver')} in the selected dates, out of {duties(lines.length)}.</p>
  <div className="mp-book-pick" role="group" aria-label="Log book">{[['','All log books'],...logBooks].map(([code,name])=><button key={code||'all'} type="button" aria-pressed={logBook===code} title={name} onClick={()=>setLogBook(code)}>{code||name}</button>)}</div>
  {siteKey&&<p className="mp-trail" aria-label="Where you are">{(open||scope||sites.length>1)&&<StepBackButton onBack={()=>setOtPick(open?{...base,scope:true,date,shift}:scope?base:noOtPick)}/>}{sites.length>1&&<><button type="button" onClick={()=>setOtPick(noOtPick)}>All sites</button><span>›</span></>}<button type="button" onClick={()=>setOtPick(base)}>{siteLabel}</button>{scope&&<><span>›</span><button type="button" onClick={()=>setOtPick({...base,scope:true,date,shift})}>{scopeLabel}</button></>}{open&&<><span>›</span><strong>{openLabel}{colour?' · '+colour+' only':''}</strong></>}</p>}
  <ReportSection key={'ot-sites-'+query+'-'+logBook} title={'Step 1 · All sites · '+dateLabel+' · '+books} category="manpower-ot-sites" description="One line per site. Red, Orange and Brown are cases; the percentages are OT duties out of total duties. Press a number to open that site date by shift." rows={sortedSites} columns={siteColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
   <div className="mp-category mp-att" role="group" aria-label="Cases by site">
    {sites.length?<table><thead><tr>{s1.head('site','Site')}{s1.head('duties','Total duties','One driver, one shift')}{otFlags.map(([id,label,meaning])=>s1.head(id,label,meaning))}{s1.head('redPct','Red OT %','Of total duties')}{s1.head('orangePct','Orange OT %','Of total duties')}{s1.head('drivers','Drivers','With any colour')}</tr></thead>
     <tbody>{sortedSites.map(line)}</tbody>
    </table>:<p>No site is available for these selections.</p>}
   </div>
  </ReportSection>
  {siteKey?<>
   <ReportSection key={'ot-dates-'+query+'-'+siteKey+'-'+logBook+'-'+filter} title={'Step 2 · '+siteLabel+' · date by shift · '+dateLabel+(filter?' · '+filter:'')} category="manpower-ot-dates" description="In each box: duties worked, then the red, orange and brown duties among them. Press a box for its equipment categories; press a colour for those drivers." rows={dateRows} columns={dateColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="mp-category mp-att mp-ot-grid" role="group" aria-label="Duties by date and shift">
     {strip.length>0&&<div className="mp-book-pick mp-ot-filter" role="group" aria-label="Equipment category">{[['','All categories',inSite.length],...strip.map(g=>[g.equipment,g.equipment,g.list.length])].map(([id,name,n])=><button key={id||'all'} type="button" aria-pressed={filter===id} aria-label={name+' · '+duties(n)} onClick={()=>setOtPick({...noOtPick,siteKey,filter:id})}>{name} <small>{n}</small></button>)}</div>}
     <p className="mp-category-hint">A driver who worked two shifts is counted in both, so the colours here add up to more than the cases on the site line.{scope&&<> Showing <strong>{scopeLabel}</strong> below. <button type="button" onClick={()=>setOtPick(base)}>Close</button></>}</p>
     <table><thead><tr><th scope="col">Date</th>{gridShifts.map(code=><th key={code} scope="col">{shiftName(code)}<small>Duties · colours</small></th>)}<th scope="col">Day duties</th><th scope="col">OT duties<small>Any colour</small></th><th scope="col">Red OT %</th><th scope="col">Orange OT %</th></tr></thead>
      <tbody>{dateRows.map(gridLine)}</tbody>
     </table>
    </div>
   </ReportSection>
   {scope?<ReportSection key={'ot-categories-'+query+'-'+siteKey+'-'+logBook+'-'+filter+'-'+date+'-'+shift} title={'Step 3 · '+siteLabel+' · '+scopeLabel+' · by equipment category'} category="manpower-ot-categories" description={(wide?'People are different persons; the percentages are on duties. ':'')+'Press a category or its People number for all its drivers; press a colour for only those drivers.'} rows={[...sortedCategories,everyCategory]} columns={categoryColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="mp-category mp-att mp-ot-categories" role="group" aria-label="Duties by equipment category">
     {categories.length?<table><thead><tr>{s3.head('equipment','Equipment category')}{s3.head('people','People','Drivers / operators')}{wide&&s3.head('duties','Duties')}{s3.head('machines','Equipment worked','Nos.')}{s3.head('red','Red OT')}{s3.head('redPct','Red OT %')}{s3.head('orange','Orange OT')}{s3.head('orangePct','Orange OT %')}{s3.head('review','Brown')}{s3.head('ot','Total OT')}{s3.head('otPct','Total OT %')}</tr></thead>
      <tbody>{sortedCategories.map(categoryLine)}{categoryLine(everyCategory)}</tbody>
     </table>:<p>No duty saved in this selection.</p>}
    </div>
   </ReportSection>:<p className="mp-notice">Press a box in the date table to see that date and shift by equipment category, then a category for its drivers, then a driver’s name for the month-wise history.</p>}
   {open&&<>
    <div className="mp-legend" aria-label="Row colours"><span className="mp-flag mp-flag-normal">White · Normal duty</span>{otFlags.map(([id,name,meaning])=><span key={id} className={'mp-flag mp-flag-'+id}>{name} · {meaning}</span>)}</div>
    <ReportSection key={'drivers-'+query+'-'+siteKey+'-'+logBook+'-'+filter+'-'+date+'-'+shift+'-'+open+'-'+flag} title={['Step 4',siteLabel,scopeLabel,openLabel,colour?colour+' only':'','drivers'].filter(Boolean).join(' · ')} category="manpower-ot-drivers" description={duties(listed.length)+' · '+many(driversIn(listed),'driver')+' · '+books+' · OT duties first · Press a name for the month-wise history'} rows={listed} columns={otDutyColumns({days:!(date||oneDate),shifts:!shift,sites:siteKey===EVERY,equipment:open===EVERY,month,year,opened:opened?.driverId||'',openDriver:setDriverOpen})} rowKey={r=>r.id} rowClassName={r=>'mp-duty-'+r.flag} recordDateFilter={false} emptyMessage="No duty matches this selection."/>
    {opened&&driverHistory({driver:opened,detail:opened.category,reader,year,close:()=>setDriverOpen(''),historyBox,ReportSection,sectionKey:'driver-history-'+query+'-'+opened.driverId})}
    <ReportSection key={'ot-'+query+'-'+siteKey+'-'+logBook+'-'+filter+'-'+date+'-'+shift+'-'+open+'-'+flag} title={[siteLabel,scopeLabel,openLabel,colour?colour+' only':'','each case'].filter(Boolean).join(' · ')} category="manpower-ot" description="One row per case behind the OT duties listed above: the driver and the shifts worked together. Scheduled times in IST; HMR hours are machine hours, not payable OT." rows={listedCases} columns={otColumns} rowKey={r=>r.id} rowClassName={r=>'mp-ot-'+r.severity} recordDateFilter={false} emptyMessage="No OT case among these duties."/>
   </>}
  </>:<p className="mp-notice">Press a number above to open a site date by shift, then a box there for its equipment categories, then a category for its drivers.</p>}
 </>;
}

// Shift Attendance Equipment Wise in five steps (owner, 16 Nov 2026): every site; one site date by shift, each box red while
// its batch is missing and outlined orange while the batch is open; one date and shift by equipment; its drivers; a driver's
// month-wise history. Plain render function: its state lives in ManpowerReports.
function attendanceOverview({stepSorts,setStepSorts,report,filters,query,ReportSection,pick,setPick,tally,tallyKey,tallySite,driverOpen,setDriverOpen,historyBox}){
 const rows=report.attendanceEquipment||[],sites=report.attendanceSites||[],held=report.attendanceShifts||[];
 // Every Shift Master shift is shown, Day and Night too, even with 0 duties and no batch (owner, 16 Nov 2026).
 const batches=held;
 const siteLabel=key=>key===EVERY?'All sites':sites.find(s=>s.siteKey===key)?.site||key;
 // An actual duty is one driver in one shift on one date; a second machine in the same shift is not another one.
 const actual=list=>list.filter(r=>r.actual).length;
 const days=filters.from!==filters.to,dateLabel=days?shortDate(filters.from)+' to '+shortDate(filters.to):shortDate(filters.from);
 const zero=<span className="mp-zero">0</span>;

 // Step 1: one line per site, then All sites. Every number opens that site date by shift.
 const siteTally=(site,name)=>{const list=rows.filter(r=>site===EVERY||r.siteKey===site),mine=batches.filter(b=>site===EVERY||b.siteKey===site);
  return {id:site,siteKey:site,site:name,actual:actual(list),duties:list.length,due:mine.filter(b=>b.state!=='not_due').length,closed:mine.filter(b=>b.state==='closed').length,none:mine.filter(b=>b.state==='none').length,open:mine.filter(batchOpen).length};};
 const siteRows=[...sites.map(s=>siteTally(s.siteKey,s.site)),...(sites.length>1?[siteTally(EVERY,'All sites')]:[])],all=siteRows.at(-1)||siteTally(EVERY,'All sites');
 const siteKey=openSite(sites,pick.siteKey),mark=siteKey&&['none','open'].includes(pick.mark)?pick.mark:'';
 const openSiteAt=(site,which='')=>setPick(siteKey===site&&mark===which&&sites.length>1?noPick:{...noPick,siteKey:site,mark:which});

 // Step 2: the open site date by shift. One box per site, date and shift: the actual duties, red while no batch was
 // created, outlined orange while the batch is open. With every site open, each line is one site on one date.
 const slots=new Map(),slotOf=(site,date,code)=>site+'|'+date+'|'+code;
 if(siteKey){
  for(const b of batches)if(siteKey===EVERY||b.siteKey===siteKey)slots.set(slotOf(b.siteKey,b.date,b.shift),{siteKey:b.siteKey,date:b.date,shift:b.shift,state:b.state,batch:b.batch,list:[]});
  for(const r of rows)if(siteKey===EVERY||r.siteKey===siteKey){const k=slotOf(r.siteKey,r.date,r.shift);if(!slots.has(k))slots.set(k,{siteKey:r.siteKey,date:r.date,shift:r.shift,state:'',batch:'',list:[]});slots.get(k).list.push(r);}
 }
 const stateLabel=s=>s.state==='none'?'Batch not created':s.state==='not_due'?'Not due yet':s.state==='closed'?'Closed':batchOpen(s)?stageName(s.state):'—';
 const slotRows=[...slots.values()].map(s=>({...s,id:slotOf(s.siteKey,s.date,s.shift),site:siteLabel(s.siteKey),shiftLabel:shiftName(s.shift),dateLabel:shortDate(s.date),stateLabel:stateLabel(s),actual:actual(s.list),duties:s.list.length,none:s.state==='none'?1:0,open:batchOpen(s)?1:0}));
 const lineOf=r=>siteKey===EVERY?{key:r.date+'|'+r.site,label:r.site,sub:shortDate(r.date)+' '+weekday(r.date).toUpperCase()}:{key:r.date,label:shortDate(r.date),sub:weekday(r.date).toUpperCase()};
 // Batch not created or Batch open on the strip keeps only the dates where that happened.
 const marked=new Set(slotRows.filter(r=>mark&&r[mark]).map(r=>lineOf(r).key));
 const shown=mark?slotRows.filter(r=>marked.has(lineOf(r).key)):slotRows;
 const shiftGrid=siteKey?dateShiftGrid(shown,{sumKeys:['actual','duties','none','open'],lineOf}):null;

 // Step 3: a box (one site, date and shift), a whole day, or every date, by equipment.
 const at=siteKey&&pick.scope&&(pick.at===siteKey||siteKey===EVERY&&sites.some(s=>s.siteKey===pick.at))?pick.at:'',scope=Boolean(at);
 const date=scope&&pick.date>=filters.from&&pick.date<=filters.to?pick.date:'',shift=scope?pick.shift||'':'';
 const inScope=r=>(at===EVERY||r.siteKey===at)&&(!date||r.date===date)&&(!shift||r.shift===shift);
 const chosen=scope?rows.filter(inScope):[],here=scope?batches.filter(inScope):[];
 const equipment=(()=>{const out=new Map();for(const r of chosen){const e=out.get(r.equipment)||{id:r.equipment,equipment:r.equipment,duties:0,actual:0,red:0,orange:0,review:0,zero:0};e.duties++;if(r.actual)e.actual++;if(dutyFlags.some(([id])=>id===r.flag))e[r.flag]++;out.set(r.equipment,e);}return [...out.values()].map(e=>({...e,second:e.duties-e.actual})).sort((a,b)=>b.duties-a.duties||a.equipment.localeCompare(b.equipment));})();
 const totals={id:EVERY,equipment:'All equipment',duties:chosen.length,actual:actual(chosen),second:chosen.length-actual(chosen),...Object.fromEntries(dutyFlags.map(([id])=>[id,chosen.filter(r=>r.flag===id).length]))};
 const heading=[siteLabel(at||siteKey),date?shortDate(date):dateLabel,shift?shiftName(shift):'All shifts'].join(' · ');
 const where=b=>[at===EVERY&&siteLabel(b.siteKey),!date&&days&&shortDate(b.date),!shift&&shiftName(b.shift)].filter(Boolean).join(' ');
 const missing=here.filter(b=>b.state==='none'),stillOpen=here.filter(batchOpen),closedHere=here.filter(b=>b.state==='closed');

 // Step 4: the drivers of one equipment (or of all), or of one colour.
 const open=scope&&(pick.equipment===EVERY||equipment.some(e=>e.equipment===pick.equipment))?pick.equipment:'',flag=open?pick.flag:'';
 const reader=tallyReader(tally,tallyKey,tallySite),month=filters.to.slice(0,7),year=filters.to.slice(0,4);
 const listed=(open?chosen.filter(r=>(open===EVERY||r.equipment===open)&&(!flag||(flag==='second'?!r.actual:r.flag===flag))):[]).map(r=>{const driverId=r.employeeKey+'|'+r.siteKey;return {...r,driverId,otMonth:reader.count(driverId,r.siteKey,'month'),otYear:reader.count(driverId,r.siteKey,'year')};});
 const opened=listed.find(r=>r.driverId===driverOpen);
 const openLabel=open===EVERY?'All equipment':open,flagName=flag==='second'?'Second machine':dutyFlags.find(([id])=>id===flag)?.[1]||'';

 const base={...noPick,siteKey,mark},scoped={...base,scope:true,at,date,shift};
 const show=(site,day,code)=>setPick(scope&&at===site&&date===day&&shift===code&&!open?base:{...base,scope:true,at:site,date:day,shift:code});
 const list=(name,colour='')=>setPick(open===name&&flag===colour?scoped:{...scoped,equipment:name,flag:colour});
 const back=open?()=>setPick(scoped):scope?()=>setPick(base):siteKey&&sites.length>1?()=>setPick(noPick):null;

 // A number of Step 1: red for shifts without a batch, orange for batches open.
 const siteNumber=(s,key,which,said,className='mp-cat-count mp-ot-duties')=>{const pressed=siteKey===s.siteKey&&mark===which;
  return s[key]?<button type="button" className={className} aria-pressed={pressed} aria-label={said(s[key])+' · '+s.site} onClick={()=>openSiteAt(s.siteKey,which)}>{s[key]}</button>:zero;};
 const a1=stepSorter(stepSorts,setStepSorts,'attendance-sites'),a3=stepSorter(stepSorts,setStepSorts,'attendance-equipment'),sortedSites=a1.rows(siteRows,row=>row.siteKey===EVERY),sortedEquipment=a3.rows(equipment);
 const siteLine=s=>{const total=s.siteKey===EVERY&&sites.length>1;return <tr key={s.siteKey} className={[total&&'mp-att-total',siteKey===s.siteKey&&'mp-on'].filter(Boolean).join(' ')||undefined}>
  <th scope="row"><button type="button" className="mp-cat-open" aria-pressed={siteKey===s.siteKey&&!mark} onClick={()=>openSiteAt(s.siteKey)}>{s.site}</button></th>
  <td>{siteNumber(s,'actual','',n=>dutyCount(n,'actual'))}</td>
  <td>{s.duties}</td><td>{s.due}</td><td>{s.closed}</td>
  <td>{siteNumber(s,'none','none',n=>many(n,'shift')+' without a batch','mp-att-count mp-att-none')}</td>
  <td>{siteNumber(s,'open','open',n=>n===1?'1 batch open':n+' batches open','mp-att-count mp-att-open')}</td>
 </tr>;};
 const siteColumns=columns([['site','Site'],['actual','Actual duties'],['duties','Equipment-wise duties'],['due','Shifts due'],['closed','Batch closed'],['none','Batch not created'],['open','Batch open']]);

 // One box of Step 2. A shift still running shows Not due unless duties are already saved in it.
 const slotName=r=>[siteKey===EVERY&&r.site,shortDate(r.date),shiftName(r.shift)].filter(Boolean).join(' · ');
 const cell=list=>{const r=list[0],note=r.state==='none'?'No batch':batchOpen(r)?stageName(r.state):r.state==='not_due'?'Not due':'';
  if(r.state==='not_due'&&!r.duties)return <span className="mp-zero" title="The shift has not ended yet">Not due</span>;
  return <button type="button" className={'mp-att-count'+(r.state==='none'?' mp-att-none':batchOpen(r)?' mp-att-open':'')} aria-pressed={scope&&at===r.siteKey&&date===r.date&&shift===r.shift} aria-label={[dutyCount(r.actual,'actual'),slotName(r),note].filter(Boolean).join(' · ')} onClick={()=>show(r.siteKey,r.date,r.shift)}>{r.actual}{note&&<small>{note}</small>}</button>;};
 // The All dates line: each shift over every date, with the shifts in it without a batch or with one open.
 const shiftTotal=(t,code)=>{const note=[t.none&&t.none+' no batch',t.open&&t.open+' open'].filter(Boolean).join(' · ');
  return <button type="button" className="mp-att-count" aria-pressed={scope&&at===siteKey&&!date&&shift===code} aria-label={[dutyCount(t.actual,'actual'),siteLabel(siteKey),'All dates',shiftName(code),note].filter(Boolean).join(' · ')} onClick={()=>show(siteKey,'',code)}>{t.actual}{note&&<small>{note}</small>}</button>;};
 const dayColumns=[
  {key:'actual',label:'Day actual duties',sub:'All shifts',value:t=>t.actual,render:(t,line)=>{const r=line?.list[0],site=r?r.siteKey:siteKey,day=r?r.date:'',name=r?[siteKey===EVERY&&r.site,shortDate(r.date)].filter(Boolean).join(' · '):'All dates';
   return <button type="button" className="mp-cat-count mp-ot-duties" aria-pressed={scope&&at===site&&date===day&&!shift} aria-label={dutyCount(t.actual,'actual')+' · '+name+' · All shifts'} onClick={()=>show(site,day,'')}>{t.actual}</button>;}},
  {key:'none',label:'Batch not created',value:t=>t.none,render:t=>t.none?<span className="mp-flag mp-att-none">{t.none}</span>:zero},
  {key:'open',label:'Batch open',value:t=>t.open,render:t=>t.open?<span className="mp-flag mp-att-open">{t.open}</span>:zero}];
 const dateColumns=columns([['dateLabel','Date'],...(siteKey===EVERY?[['site','Site']]:[]),['shiftLabel','Shift'],['stateLabel','Batch'],['batch','Batch name'],['actual','Actual duties'],['duties','Equipment-wise duties']]);
 const step2Title='Step 2 · '+siteLabel(siteKey)+' · date by shift · '+dateLabel+(mark==='none'?' · Batch not created':mark==='open'?' · Batch open':'');

 const line=(e,total)=><tr key={e.id} className={[total&&'mp-att-total',open===e.id&&'mp-on'].filter(Boolean).join(' ')||undefined}>
  <td><button type="button" className="mp-cat-open" aria-pressed={open===e.id&&!flag} onClick={()=>list(e.id)}>{e.equipment}</button></td>
  <td><button type="button" className="mp-cat-count" aria-pressed={open===e.id&&!flag} aria-label={dutyCount(e.duties,'equipment-wise')+' · '+e.equipment} onClick={()=>list(e.id)}>{e.duties}</button></td>
  <td>{e.actual}</td>
  {/* Equipment-wise duties minus actual duties: the rows where this equipment was the driver's second machine in the shift. */}
  <td>{e.second?<button type="button" className="mp-cat-count" aria-pressed={open===e.id&&flag==='second'} aria-label={e.second+' second machine · '+e.equipment} onClick={()=>list(e.id,'second')}>{e.second}</button>:0}</td>
  {dutyFlags.map(([id,colour])=><td key={id}>{e[id]?<button type="button" className={'mp-cat-count mp-flag-'+id} aria-pressed={open===e.id&&flag===id} aria-label={e[id]+' '+colour+' · '+e.equipment} onClick={()=>list(e.id,id)}>{e[id]}</button>:0}</td>)}
 </tr>;
 const equipmentColumns=columns([['equipment','Equipment'],['duties','Equipment-wise duties'],['actual','Actual duties'],['second','Second machine'],...dutyFlags.map(([id,colour])=>[id,colour])]);
 const trail=[siteKey&&sites.length>1&&['All sites',()=>setPick(noPick)],siteKey&&[siteKey===EVERY?'Date by shift':siteLabel(siteKey),()=>setPick(base)],scope&&[[siteKey===EVERY?siteLabel(at):'',date?shortDate(date):'All dates',shift?shiftName(shift):'All shifts'].filter(Boolean).join(' · '),()=>setPick(scoped)],open&&[openLabel+(flagName?' · '+flagName+' only':''),null]].filter(Boolean);

 return <>
  <p className="mp-notice">{dutyCount(actual(rows),'actual')} · {dutyCount(rows.length,'equipment-wise')}. An actual duty is one driver in one shift on one date. A driver on two equipment types in one shift is counted on both machines and once in actual duties.</p>
  {siteKey&&<p className="mp-trail" aria-label="Where you are">{back&&<StepBackButton onBack={back}/>}{trail.map(([label,go],i)=><React.Fragment key={i}>{i>0&&<span>›</span>}{go&&i<trail.length-1?<button type="button" onClick={go}>{label}</button>:<strong>{label}</strong>}</React.Fragment>)}</p>}
  <ReportSection key={'att-sites-'+query} title={'Step 1 · All sites · '+dateLabel+' · actual duties'} category="shift-attendance-sites" description="One line per site. Shifts due are the shifts that have ended by the Shift Master times. Press a site or a number to open it date by shift; the red or orange number opens only the dates with a shift without a batch, or with a batch still open." rows={sortedSites} columns={siteColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
   <div className="mp-category mp-att mp-att-sites" role="group" aria-label="Actual duties and batches by site">
    {sites.length?<>
     <p className="mp-att-status">{all.none>0&&<span className="mp-flag mp-att-none">{many(all.none,'shift')} without a batch</span>}{all.open>0&&<span className="mp-flag mp-att-open">{all.open===1?'1 batch open':all.open+' batches open'}</span>}{!all.none&&!all.open&&<span>Every shift that has ended has a closed batch.</span>}<span>Red: batch not created. Orange outline: batch not closed.</span></p>
     <table><thead><tr>{a1.head('site','Site')}{a1.head('actual','Actual duties','One driver, one shift')}{a1.head('duties','Equipment-wise duties','Each machine worked')}{a1.head('due','Shifts due','Ended by Shift Master times')}{a1.head('closed','Batch closed')}{a1.head('none','Batch not created')}{a1.head('open','Batch open','VLB, LMV or ELB open')}</tr></thead>
      <tbody>{sortedSites.map(siteLine)}</tbody>
     </table>
    </>:<p>No site is available for these selections.</p>}
   </div>
  </ReportSection>
  {siteKey?<>
   <ReportSection key={'att-dates-'+query+'-'+siteKey+'-'+mark} title={step2Title} category="shift-attendance-dates" description="In each box: the actual duties of that shift. Red = batch not created (no card can be saved without a batch, so it shows 0). Orange outline = batch created but not closed, with the stage it waits in. Not due = the shift has not ended yet. Press a box for its equipment, a day total for the whole day." rows={shown} columns={dateColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="mp-category mp-att mp-att-grid">
     <div className="mp-book-pick" role="group" aria-label="Dates shown">{[['','All dates',slotRows.length?new Set(slotRows.map(r=>lineOf(r).key)).size:0],['none','Batch not created',slotRows.reduce((n,r)=>n+r.none,0)],['open','Batch open',slotRows.reduce((n,r)=>n+r.open,0)]].map(([id,name,n])=><button key={id||'all'} type="button" aria-pressed={mark===id} aria-label={name+' · '+n} onClick={()=>setPick({...noPick,siteKey,mark:id})}>{name} <small>{n}</small></button>)}</div>
     <DateShiftGrid grid={shiftGrid} renderCell={cell} renderTotal={shiftTotal} dayColumns={dayColumns} shiftLabel={shiftName} label={siteKey===EVERY?'Site · date':'Date'}
      isPicked={r=>scope&&at===r.siteKey&&date===r.date} onOpenAll={()=>show(siteKey,'','')} allPicked={scope&&at===siteKey&&!date&&!shift} ariaLabel="Actual duties by date and shift" emptyMessage={mark?'No date matches this choice.':'No shift in these dates.'}/>
    </div>
   </ReportSection>
   {scope?<ReportSection key={'att-equipment-'+query+'-'+siteKey+'-'+at+'-'+date+'-'+shift} title={'Step 3 · '+heading+' · by equipment'} category="shift-attendance-equipment" description="Equipment-wise duties count the driver on every machine worked; actual duties once per shift. Press an equipment or a number for its drivers." rows={equipment.length?[...sortedEquipment,totals]:[]} columns={equipmentColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="mp-category mp-att">
     {missing.length>0&&<p className="mp-att-batch mp-att-batch-none"><strong>Batch not created:</strong> {missing.length===1&&!where(missing[0])?'this shift':missing.slice(0,60).map(where).join(' · ')+(missing.length>60?' · and '+(missing.length-60)+' more':'')}</p>}
     {stillOpen.length>0&&<p className="mp-att-batch mp-att-batch-open"><strong>Batch not closed:</strong> {stillOpen.slice(0,60).map(b=>[where(b),b.batch,'('+stageName(b.state)+')'].filter(Boolean).join(' ')).join(' · ')}</p>}
     {closedHere.length===1&&!missing.length&&!stillOpen.length&&closedHere[0].batch&&<p className="mp-category-hint">Batch {closedHere[0].batch} · closed.</p>}
     {equipment.length?<>
      <p className="mp-category-hint">{open?<>Showing <strong>{openLabel}{flagName?' · '+flagName+' only':''}</strong> below. <button type="button" onClick={()=>setPick(scoped)}>Close the driver list</button></>:'Press an equipment or a number to list its drivers below.'}</p>
      <table><thead><tr>{a3.head('equipment','Equipment')}{a3.head('duties','Equipment-wise duties')}{a3.head('actual','Actual duties')}{a3.head('second','Second machine','',{title:'Equipment-wise duties minus actual duties: drivers for whom this equipment was a second machine in the shift'})}{dutyFlags.map(([id,colour,meaning])=>a3.head(id,colour,'',{title:meaning}))}</tr></thead>
       <tbody>{sortedEquipment.map(e=>line(e,false))}{line(totals,true)}</tbody>
      </table>
      {totals.second>0&&<p className="mp-att-foot">{totals.second} {totals.second===1?'duty here is':'duties here are'} a second machine for the driver: counted on each machine, once in actual duties. Press a number under Second machine to list those drivers.</p>}
     </>:<p>No duty saved in this selection.</p>}
    </div>
   </ReportSection>:<p className="mp-notice">Press a box in the date table to see that date and shift by equipment, then an equipment for its drivers, then a driver’s name for the month-wise history.</p>}
   {open&&<>
    <div className="mp-legend" aria-label="Row colours"><span className="mp-flag mp-flag-normal">White · Normal duty</span>{dutyFlags.map(([id,colour,meaning])=><span key={id} className={'mp-flag mp-flag-'+id}>{colour} · {meaning}</span>)}</div>
    <ReportSection key={'attendance-'+query+'-'+siteKey+'-'+at+'-'+date+'-'+shift+'-'+open+'-'+flag} title={'Step 4 · '+heading+' · '+openLabel+(flagName?' · '+flagName+' only':'')+' · drivers'} category="shift-attendance" description={dutyCount(listed.length,'equipment-wise')+' · '+dutyCount(actual(listed),'actual')+' · Saved records only · Press a name for the month-wise history'} rows={listed} columns={attendanceColumns({days:!date&&days,sites:at===EVERY,shifts:!shift,equipment:open===EVERY,month,year,opened:opened?.driverId||'',openDriver:setDriverOpen})} rowKey={r=>r.id} rowClassName={r=>'mp-duty-'+r.flag} recordDateFilter={false} emptyMessage="No duty matches this selection."/>
    {opened&&driverHistory({driver:opened,detail:opened.equipment,reader,year,close:()=>setDriverOpen(''),historyBox,ReportSection,sectionKey:'attendance-history-'+query+'-'+opened.driverId})}
   </>}
  </>:<p className="mp-notice">Press a site above to see it date by shift, then a box for its equipment, then an equipment for its drivers.</p>}
 </>;
}

// Manpower by Category in steps: every site, one site date by shift, one date and shift by equipment category,
// then the two lists (category, make and model; saved cards) for what is open. Plain render function: its state lives in ManpowerReports.
// Machines, employees and duties are counted on the server from the keys on the saved cards (manpowerCategoryCells): one line per
// site, date, shift and equipment category and for every total of them ('*'), so every table agrees with the count cards on top.
// A month of every site is too many cards to send, so the saved card list is read for one opened date (cards, from ManpowerReports).
function manpowerOverview({stepSorts,setStepSorts,report,filters,query,description,ReportSection,sites,mpPick,setMpPick,cards={rows:null,error:''}}){
 const lines=report.cells||[],cells=new Map(lines.map(c=>[c.slice(0,4).join('\u0001'),c]));
 const tallyOf=(site,day,code,group)=>{const c=cells.get([site,day||EVERY,code||EVERY,group||EVERY].join('\u0001'));return {machines:c?.[4]||0,employees:c?.[5]||0,duties:c?.[6]||0,cards:c?.[7]||0};};
 const siteKey=openSite(sites,mpPick.siteKey),inSite=siteKey?lines.filter(c=>c[0]===siteKey):[];
 const span=[];for(let day=filters.from;day<=filters.to&&span.length<32;day=nextDay(day))span.push(day);
 const gridDates=[...new Set([...span,...inSite.filter(c=>c[1]!==EVERY).map(c=>c[1])])].sort(),gridShifts=[...new Set(['S1','S2','S3',...inSite.filter(c=>c[2]!==EVERY).map(c=>c[2])])].sort();
 const scope=Boolean(siteKey&&mpPick.scope),date=scope&&gridDates.includes(mpPick.date)?mpPick.date:'',shift=scope&&gridShifts.includes(mpPick.shift)?mpPick.shift:'';
 const at=(day,code)=>tallyOf(siteKey,day,code,'');
 const categories=(scope?inSite.filter(c=>c[1]===(date||EVERY)&&c[2]===(shift||EVERY)&&c[3]!==EVERY):[]).map(c=>({id:c[3],equipment:c[3],machines:c[4],employees:c[5],duties:c[6],cards:c[7]})).sort((a,b)=>b.machines-a.machines||b.cards-a.cards||a.equipment.localeCompare(b.equipment));
 const everyCategory={id:EVERY,equipment:'All categories',...(scope?at(date,shift):tallyOf('-','-','-','-'))};
 const open=scope&&(mpPick.equipment===EVERY||categories.some(c=>c.id===mpPick.equipment))?mpPick.equipment:'';
 // The two lists at the bottom follow whatever is open: nothing, a site, a date and shift, a category.
 const chosen=r=>(!siteKey||siteKey===EVERY||r.siteKey===siteKey)&&(!scope||(!date||r.date===date)&&(!shift||r.shift===shift))&&(!open||open===EVERY||(r.equipment||'Group missing in master')===open);
 const oneDay=Boolean(scope&&(date||gridDates.length===1)),listedCards=oneDay&&cards.rows?cards.rows.filter(chosen):[],listedSummary=siteKey?(report.summary||[]).filter(chosen):report.summary||[];
 const siteLabel=siteKey===EVERY?'All sites':sites.find(s=>s.siteKey===siteKey)?.site||'',oneDate=gridDates.length===1;
 const dateLabel=filters.from!==filters.to?shortDate(filters.from)+' to '+shortDate(filters.to):shortDate(filters.from);
 const scopeLabel=[date?shortDate(date):oneDate?shortDate(gridDates[0]):'All dates',shift?shiftName(shift):'All shifts'].join(' · ');
 const openLabel=open===EVERY?'All categories':open,where=[siteLabel,scope&&scopeLabel,open&&openLabel].filter(Boolean).join(' · ');
 const base={...noMpPick,siteKey};
 const openSiteAt=site=>setMpPick(siteKey===site&&sites.length>1?noMpPick:{...noMpPick,siteKey:site});
 const show=(day,code)=>setMpPick(scope&&date===day&&shift===code&&!open?base:{...base,scope:true,date:day,shift:code});
 const list=name=>setMpPick(open===name?{...base,scope:true,date,shift}:{...base,scope:true,date,shift,equipment:name});
 const zero=<span className="mp-zero">0</span>,measures=[['machines','Vehicles / equipment','vehicle or machine'],['employees','Employees','employee'],['duties','Duties','duty'],['cards','Saved cards','saved card']];
 const said=(n,word)=>word==='duty'?duties(n):many(n,word);
 const siteRows=[...sites.map(s=>({id:s.siteKey,siteKey:s.siteKey,site:s.site,...tallyOf(s.siteKey)})),...(sites.length>1?[{id:EVERY,siteKey:EVERY,site:'All sites',...tallyOf(EVERY)}]:[])];
 const dayRows=[...gridDates.map(day=>({id:day,day,date:shortDate(day)})),...(oneDate?[]:[{id:'all',day:'',date:'All dates'}])].map(row=>{const out={...row,...at(row.day,'')};for(const code of gridShifts){const t=at(row.day,code);out[code+'_duties']=t.duties;out[code+'_machines']=t.machines;out[code+'_cards']=t.cards;}return out;});
 const numbers=(row,label,press,pressed)=>measures.map(([key,,word])=><td key={key}>{row[key]?<button type="button" className="mp-cat-count mp-ot-duties" aria-pressed={pressed} aria-label={said(row[key],word)+' · '+label} onClick={press}>{row[key]}</button>:0}</td>);
 const box=(row,code)=>{const label=row.date+' · '+shiftName(code);if(!row[code+'_cards'])return zero;
  return <button type="button" className="mp-att-count" aria-pressed={scope&&date===row.day&&shift===code} aria-label={duties(row[code+'_duties'])+' · '+many(row[code+'_machines'],'machine')+' · '+label} onClick={()=>show(row.day,code)}>{row[code+'_duties']}<small>{many(row[code+'_machines'],'machine')}</small></button>;};
 const m1=stepSorter(stepSorts,setStepSorts,'manpower-sites'),m3=stepSorter(stepSorts,setStepSorts,'manpower-categories'),sortedSites=m1.rows(siteRows,row=>row.siteKey===EVERY),sortedCategories=m3.rows(categories);
 const siteColumns=columns([['site','Site'],...measures.map(([key,label])=>[key,label])]);
 const dayColumns=columns([['date','Date'],...gridShifts.flatMap(code=>[[code+'_duties',shiftName(code)+' duties'],[code+'_machines',shiftName(code)+' vehicles / equipment']]),['duties','Day duties'],['machines','Day vehicles / equipment'],['employees','Day employees'],['cards','Saved cards']]);
 const categoryColumns=columns([['equipment','Equipment category'],...measures.map(([key,label])=>[key,label])]);
 return <>
  {siteKey&&<p className="mp-trail" aria-label="Where you are">{(open||scope||sites.length>1)&&<StepBackButton onBack={()=>setMpPick(open?{...base,scope:true,date,shift}:scope?base:noMpPick)}/>}{sites.length>1&&<><button type="button" onClick={()=>setMpPick(noMpPick)}>All sites</button><span>›</span></>}<button type="button" onClick={()=>setMpPick(base)}>{siteLabel}</button>{scope&&<><span>›</span><button type="button" onClick={()=>setMpPick({...base,scope:true,date,shift})}>{scopeLabel}</button></>}{open&&<><span>›</span><strong>{openLabel}</strong></>}</p>}
  <ReportSection key={'mp-sites-'+query} title={'Step 1 · All sites · '+dateLabel} category="manpower-sites" description="One line per site: different vehicles and machines, different employees, duties (one employee, one shift, one date) and saved cards. Press a number to open that site date by shift." rows={sortedSites} columns={siteColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
   <div className="mp-category mp-att" role="group" aria-label="Manpower by site">
    {sites.length?<table><thead><tr>{m1.head('site','Site')}{measures.map(([key,label])=>m1.head(key,label))}</tr></thead>
     <tbody>{sortedSites.map(s=><tr key={s.id} className={[s.siteKey===EVERY&&sites.length>1&&'mp-att-total',siteKey===s.siteKey&&'mp-on'].filter(Boolean).join(' ')||undefined}><th scope="row">{s.site}</th>{numbers(s,s.site,()=>openSiteAt(s.siteKey),siteKey===s.siteKey)}</tr>)}</tbody>
    </table>:<p>No site is available for these selections.</p>}
   </div>
  </ReportSection>
  {siteKey?<>
   <ReportSection key={'mp-dates-'+query+'-'+siteKey} title={'Step 2 · '+siteLabel+' · date by shift · '+dateLabel} category="manpower-dates" description="In each box: the duties of that shift, and under it the vehicles and machines that worked. Press a box to see it by equipment category." rows={dayRows} columns={dayColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="mp-category mp-att mp-ot-grid" role="group" aria-label="Manpower by date and shift">
     {scope&&<p className="mp-category-hint">Showing <strong>{scopeLabel}</strong> below. <button type="button" onClick={()=>setMpPick(base)}>Close</button></p>}
     <table><thead><tr><th scope="col">Date</th>{gridShifts.map(code=><th key={code} scope="col">{shiftName(code)}<small>Duties · machines</small></th>)}<th scope="col">Day duties</th><th scope="col">Vehicles / equipment</th><th scope="col">Employees</th><th scope="col">Saved cards</th></tr></thead>
      <tbody>{dayRows.map(row=>{const total=!row.day&&!oneDate,label=row.date;return <tr key={row.id} className={[total&&'mp-att-total',!total&&scope&&date===row.day&&'mp-on'].filter(Boolean).join(' ')||undefined}>
       <th scope="row">{row.date}{row.day&&<small>{weekday(row.day)}</small>}</th>
       {gridShifts.map(code=><td key={code}>{box(row,code)}</td>)}
       <td>{row.cards?<button type="button" className="mp-cat-count mp-ot-duties" aria-pressed={scope&&date===row.day&&!shift} aria-label={duties(row.duties)+' · '+label} onClick={()=>show(row.day,'')}>{row.duties}</button>:zero}</td>
       <td>{row.machines}</td><td>{row.employees}</td><td>{row.cards}</td>
      </tr>;})}</tbody>
     </table>
    </div>
   </ReportSection>
   {scope?<ReportSection key={'mp-categories-'+query+'-'+siteKey+'-'+date+'-'+shift} title={'Step 3 · '+siteLabel+' · '+scopeLabel+' · by equipment category'} category="manpower-categories" description="One line per equipment category. Press a category or a number to list its makes, models and saved cards below." rows={[...sortedCategories,everyCategory]} columns={categoryColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="mp-category mp-att mp-ot-categories" role="group" aria-label="Manpower by equipment category">
     {categories.length?<table><thead><tr>{m3.head('equipment','Equipment category')}{measures.map(([key,label])=>m3.head(key,label))}</tr></thead>
      <tbody>{[...sortedCategories,everyCategory].map(c=><tr key={c.id} className={[c.id===EVERY&&'mp-att-total',open===c.id&&'mp-on'].filter(Boolean).join(' ')||undefined}><td><button type="button" className="mp-cat-open" aria-pressed={open===c.id} onClick={()=>list(c.id)}>{c.equipment}</button></td>{numbers(c,c.equipment,()=>list(c.id),open===c.id)}</tr>)}</tbody>
     </table>:<p>No saved card in this selection.</p>}
    </div>
   </ReportSection>:<p className="mp-notice">Press a box in the date table to see that date and shift by equipment category and list its saved cards. The make and model list below shows the whole site until then.</p>}
  </>:<p className="mp-notice">Press a number above to open a site date by shift. The make and model list below shows every site until then.</p>}
  <ReportSection key={'summary-'+query+'-'+where} title={'Manpower by Category, Make & Model'+(where?' · '+where:'')} category="manpower-summary" description={description+' · Distinct assets and employees within each category'} rows={listedSummary} columns={summaryColumns} recordDateFilter={false} emptyMessage="No saved asset assignments in this selection. An empty batch has no manpower count."/>
  {!oneDay?<p className="mp-notice">The saved cards (Vehicle & Employee Assignments) are listed for one date: open a site, then a date in the date table.</p>
   :cards.error?<p role="alert">{cards.error}</p>
   :!cards.rows?<p role="status">Loading the saved cards of {scopeLabel}…</p>
   :<ReportSection key={'details-'+query+'-'+where} title={'Vehicle & Employee Assignments'+(where?' · '+where:'')} category="manpower-assignments" description={description} rows={listedCards} columns={detailColumns} rowKey={r=>r.id} recordDateFilter={false} emptyMessage="No saved assignments match these selections."/>}
 </>;
}

// Manpower by Category Reconciliation: machines available at the site (Equipment master, as on Fleet reconciliation) against
// what the saved cards show, shift by shift: card saved, active production, zero trips, zero km, no card.
// Steps: every site, one site by date and shift, one date and shift by equipment category, then the machines.
// Plain render function: its state lives in ManpowerReports. Totals over several shifts are machine-shifts.
const rcMeasures=[['available','Available','As per fleet list'],['carded','Card saved','VLB or ELB'],['active','Active production','Trips or running hours'],['zero','Zero trips','Card saved, no work'],['zeroKm','Zero km','VLB with 0 km'],['none','No card','Available, not deployed']];
const rcStatus={active:'Active production',zero:'Zero trips',none:'No card',outside:'Not in fleet list'};
function reconciliationOverview({stepSorts,setStepSorts,report,filters,query,ReportSection,sites,rcPick,setRcPick}){
 const fleet=report.fleet||[],work=report.fleetWork||[];
 const span=[];for(let day=filters.from;day<=filters.to&&span.length<32;day=nextDay(day))span.push(day);
 const shifts=filters.shift?[filters.shift]:[...new Set(['S1','S2','S3',...work.map(w=>w.shift)])].sort();
 const roster=(site,category)=>fleet.filter(m=>(site===EVERY||m.siteKey===site)&&(!category||m.equipment===category));
 const done=(site,day,code,category)=>work.filter(w=>(site===EVERY||w.siteKey===site)&&(!day||w.date===day)&&(!code||w.shift===code)&&(!category||w.equipment===category));
 // Counts for a site over some dates and shifts. Available is the fleet once for every date and shift covered.
 const tallyOf=(site,day,code,category)=>{
  const cells=(day?1:span.length)*(code?1:shifts.length),list=done(site,day,code,category),inFleet=list.filter(w=>w.inFleet);
  const available=roster(site,category).length*cells,carded=inFleet.length,active=inFleet.filter(w=>w.active).length;
  return {available,carded,active,zero:carded-active,zeroKm:inFleet.filter(w=>w.zeroKm).length,none:Math.max(available-carded,0),outside:list.length-carded,share:percent(carded,available)};
 };
 const siteKey=openSite(sites,rcPick.siteKey),scope=Boolean(siteKey&&rcPick.scope),date=scope&&span.includes(rcPick.date)?rcPick.date:'',shift=scope&&shifts.includes(rcPick.shift)?rcPick.shift:'';
 const names=scope?[...new Set([...roster(siteKey,'').map(m=>m.equipment),...done(siteKey,date,shift,'').map(w=>w.equipment)])]:[];
 const categories=names.map(equipment=>({id:equipment,equipment,...tallyOf(siteKey,date,shift,equipment)})).sort((a,b)=>b.available-a.available||b.carded-a.carded||a.equipment.localeCompare(b.equipment)),everyCategory={id:EVERY,equipment:'All categories',...(scope?tallyOf(siteKey,date,shift,''):{})};
 const open=scope&&(rcPick.equipment===EVERY||names.includes(rcPick.equipment))?rcPick.equipment:'',status=open?rcPick.status:'';
 // Step 4: one line per machine, date and shift: every fleet machine with what it did, then cards of machines outside the fleet list.
 const machines=(()=>{
  if(!open)return [];
  const category=open===EVERY?'':open,out=[],index=new Map(done(siteKey,date,shift,category).filter(w=>w.inFleet).map(w=>[[w.siteKey,w.date,w.shift,w.key].join('|'),w]));
  const siteName=key=>sites.find(s=>s.siteKey===key)?.site||key;
  for(const day of date?[date]:span)for(const code of shift?[shift]:shifts){
   for(const m of roster(siteKey,category)){const w=index.get([m.siteKey,day,code,m.key].join('|')),state=!w?'none':w.active?'active':'zero';
    out.push({id:[m.siteKey,day,code,m.key].join('|'),site:siteName(m.siteKey),date:day,shift:code,door:m.door,equipment:m.equipment,makeModel:m.makeModel,state,zeroKm:Boolean(w?.zeroKm),statusLabel:rcStatus[state]+(w?.zeroKm?' · Zero km':''),logBook:w?.logBook||'',trips:w?.trips,km:w?.km,hours:w?.hours,employees:w?.employees||'',books:w?.books||''});}
   for(const w of done(siteKey,day,code,category).filter(w=>!w.inFleet))out.push({id:'x'+[w.siteKey,day,code,w.books].join('|'),site:siteName(w.siteKey),date:day,shift:code,door:w.door,equipment:w.equipment,makeModel:w.makeModel,state:'outside',zeroKm:w.zeroKm,statusLabel:rcStatus.outside+(w.active?' · worked':' · zero trips'),logBook:w.logBook,trips:w.trips,km:w.km,hours:w.hours,employees:w.employees,books:w.books});
  }
  const keep={carded:r=>r.state==='active'||r.state==='zero',active:r=>r.state==='active',zero:r=>r.state==='zero',zeroKm:r=>r.zeroKm&&r.state!=='outside',none:r=>r.state==='none',outside:r=>r.state==='outside'}[status];
  return keep?out.filter(keep):out;
 })();
 const siteLabel=siteKey===EVERY?'All sites':sites.find(s=>s.siteKey===siteKey)?.site||'',oneCell=span.length===1&&shifts.length===1;
 const dateLabel=filters.from!==filters.to?shortDate(filters.from)+' to '+shortDate(filters.to):shortDate(filters.from);
 const scopeLabel=[date?shortDate(date):span.length===1?shortDate(span[0]):'All dates',shift?shiftName(shift):shifts.length===1?shiftName(shifts[0]):'All shifts'].join(' · ');
 const openLabel=open===EVERY?'All categories':open,statusLabel=[...rcMeasures,['outside','Not in fleet list']].find(([key])=>key===status)?.[1]||'';
 const base={...noRcPick,siteKey};
 const openSiteAt=site=>setRcPick(siteKey===site&&sites.length>1?noRcPick:{...noRcPick,siteKey:site});
 const show=(day,code)=>setRcPick(scope&&date===day&&shift===code&&!open?base:{...base,scope:true,date:day,shift:code});
 const list=(name,level)=>setRcPick(open===name&&status===level?{...base,scope:true,date,shift}:{...base,scope:true,date,shift,equipment:name,status:level});
 const siteRows=[...sites.map(s=>({id:s.siteKey,siteKey:s.siteKey,site:s.site,machines:roster(s.siteKey,'').length,...tallyOf(s.siteKey,'','','')})),...(sites.length>1?[{id:EVERY,siteKey:EVERY,site:'All sites',machines:fleet.length,...tallyOf(EVERY,'','','')}]:[])];
 const r1=stepSorter(stepSorts,setStepSorts,'rc-sites'),r3=stepSorter(stepSorts,setStepSorts,'rc-categories'),sortedSites=r1.rows(siteRows,row=>row.siteKey===EVERY),sortedCategories=r3.rows(categories);
 const sortHeads=h=>[...rcMeasures.map(([key,name,meaning])=>h.head(key,name,meaning)),h.head('share','Deployed %','Card saved of available'),h.head('outside','Not in fleet list','Card of a machine listed elsewhere')];
 const shiftRows=siteKey?[...span.flatMap(day=>shifts.map(code=>({id:day+code,day,code,date:shortDate(day),shift:shiftName(code),...tallyOf(siteKey,day,code,'')}))),...(oneCell?[]:[{id:'all',day:'',code:'',date:'All dates',shift:'All shifts',...tallyOf(siteKey,'','','')}])]:[];
 // The numbers of one line. With `press`, each becomes a button; otherwise plain figures.
 const figures=(row,label,press,pressed)=>[...rcMeasures.map(([key,name])=><td key={key}>{row[key]&&press?<button type="button" className={'mp-cat-count mp-ot-duties mp-rc-'+key} aria-pressed={pressed(key)} aria-label={row[key]+' '+name+' · '+label} onClick={()=>press(key)}>{row[key]}</button>:row[key]||0}</td>),
  <td key="share">{row.share}</td>,<td key="outside">{row.outside&&press?<button type="button" className="mp-cat-count mp-ot-duties" aria-pressed={pressed('outside')} aria-label={row.outside+' Not in fleet list · '+label} onClick={()=>press('outside')}>{row.outside}</button>:row.outside||0}</td>];
 const heads=[...rcMeasures.map(([key,name,meaning])=><th key={key} scope="col">{name}<small>{meaning}</small></th>),<th key="share" scope="col">Deployed %<small>Card saved of available</small></th>,<th key="outside" scope="col">Not in fleet list<small>Card of a machine listed elsewhere</small></th>];
 const measureColumns=[...rcMeasures.map(([key,name])=>[key,name]),['share','Deployed %'],['outside','Not in fleet list']];
 const machineColumns=columns([...(date||span.length===1?[]:[['date','Duty date']]),...(shift||shifts.length===1?[]:[['shift','Shift']]),...(siteKey===EVERY?[['site','Site']]:[]),['door','Door / equipment'],...(open===EVERY?[['equipment','Equipment category']]:[]),['makeModel','Make / model'],['statusLabel','Status'],['logBook','Log book'],['trips','Completed VLB trips'],['km','Kilometres'],['hours','HMR hours'],['employees','Driver / operator'],['books','Saved cards']]);
 return <>
  <p className="mp-notice">Available is the machines the Equipment master places at the site today, as on the Fleet reconciliation screen (LMVs left out); the list for an earlier date is not kept. Each line then shows how many had a card saved in the shift, how many did active production, how many had zero trips or zero km, and how many had no card. Over several shifts the numbers are machine-shifts: one machine in three shifts counts three times.</p>
  {siteKey&&<p className="mp-trail" aria-label="Where you are">{(open||scope||sites.length>1)&&<StepBackButton onBack={()=>setRcPick(open?{...base,scope:true,date,shift}:scope?base:noRcPick)}/>}{sites.length>1&&<><button type="button" onClick={()=>setRcPick(noRcPick)}>All sites</button><span>›</span></>}<button type="button" onClick={()=>setRcPick(base)}>{siteLabel}</button>{scope&&<><span>›</span><button type="button" onClick={()=>setRcPick({...base,scope:true,date,shift})}>{scopeLabel}</button></>}{open&&<><span>›</span><strong>{openLabel}{statusLabel?' · '+statusLabel:''}</strong></>}</p>}
  <ReportSection key={'rc-sites-'+query} title={'Step 1 · All sites · '+dateLabel} category="manpower-rc-sites" description="One line per site, all the selected dates and shifts together. Press a number to open that site shift by shift." rows={sortedSites} columns={columns([['site','Site'],['machines','Machines in fleet'],...measureColumns])} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
   <div className="mp-category mp-att mp-rc" role="group" aria-label="Reconciliation by site">
    {sites.length?<table><thead><tr>{r1.head('site','Site')}{r1.head('machines','Machines in fleet','Today')}{sortHeads(r1)}</tr></thead>
     <tbody>{sortedSites.map(s=><tr key={s.id} className={[s.siteKey===EVERY&&sites.length>1&&'mp-att-total',siteKey===s.siteKey&&'mp-on'].filter(Boolean).join(' ')||undefined}><th scope="row">{s.site}</th>
      <td>{s.machines?<button type="button" className="mp-cat-count mp-ot-duties" aria-pressed={siteKey===s.siteKey} aria-label={many(s.machines,'machine')+' · '+s.site} onClick={()=>openSiteAt(s.siteKey)}>{s.machines}</button>:0}</td>{figures(s,s.site,()=>openSiteAt(s.siteKey),()=>siteKey===s.siteKey)}</tr>)}</tbody>
    </table>:<p>No site is available for these selections.</p>}
   </div>
  </ReportSection>
  {siteKey?<>
   <ReportSection key={'rc-shifts-'+query+'-'+siteKey} title={'Step 2 · '+siteLabel+' · shift by shift · '+dateLabel} category="manpower-rc-shifts" description="One line per date and shift. Press a line’s number to see that shift by equipment category." rows={shiftRows} columns={columns([['date','Date'],['shift','Shift'],...measureColumns])} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="mp-category mp-att mp-rc mp-ot-grid" role="group" aria-label="Reconciliation by date and shift">
     {scope&&<p className="mp-category-hint">Showing <strong>{scopeLabel}</strong> below. <button type="button" onClick={()=>setRcPick(base)}>Close</button></p>}
     <table><thead><tr><th scope="col">Date</th><th scope="col">Shift</th>{heads}</tr></thead>
      <tbody>{shiftRows.map(row=>{const total=row.id==='all',label=row.date+' · '+row.shift,on=scope&&date===row.day&&shift===row.code;return <tr key={row.id} className={[total&&'mp-att-total',on&&'mp-on'].filter(Boolean).join(' ')||undefined}>
       <th scope="row">{row.date}{row.day&&<small>{weekday(row.day)}</small>}</th><td>{row.shift}</td>{figures(row,label,()=>show(row.day,row.code),()=>on&&!open)}</tr>;})}</tbody>
     </table>
    </div>
   </ReportSection>
   {scope?<ReportSection key={'rc-categories-'+query+'-'+siteKey+'-'+date+'-'+shift} title={'Step 3 · '+siteLabel+' · '+scopeLabel+' · by equipment category'} category="manpower-rc-categories" description="One line per equipment category. Press a category for all its machines, or a number for only those machines." rows={[...sortedCategories,everyCategory]} columns={columns([['equipment','Equipment category'],...measureColumns])} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="mp-category mp-att mp-rc mp-ot-categories" role="group" aria-label="Reconciliation by equipment category">
     {categories.length?<table><thead><tr>{r3.head('equipment','Equipment category')}{sortHeads(r3)}</tr></thead>
      <tbody>{[...sortedCategories,everyCategory].map(c=><tr key={c.id} className={[c.id===EVERY&&'mp-att-total',open===c.id&&'mp-on'].filter(Boolean).join(' ')||undefined}><td><button type="button" className="mp-cat-open" aria-pressed={open===c.id&&!status} onClick={()=>list(c.id,'')}>{c.equipment}</button></td>{figures(c,c.equipment,key=>list(c.id,key==='available'?'':key),key=>open===c.id&&status===(key==='available'?'':key))}</tr>)}</tbody>
     </table>:<p>No machine in the fleet list and no saved card in this selection.</p>}
    </div>
   </ReportSection>:<p className="mp-notice">Press a number on a line of the shift table to see that date and shift by equipment category, then a number there for the machines.</p>}
   {open&&<ReportSection key={'rc-machines-'+query+'-'+siteKey+'-'+date+'-'+shift+'-'+open+'-'+status} title={['Step 4',siteLabel,scopeLabel,openLabel,statusLabel,'machines'].filter(Boolean).join(' · ')} category="manpower-rc-machines" description={many(machines.length,'line')+' · One line per machine, date and shift · Trips, kilometres and hours are from the saved cards'} rows={machines} columns={machineColumns} rowKey={r=>r.id} rowClassName={r=>'mp-rc-row-'+r.state} recordDateFilter={false} emptyMessage="No machine matches this selection."/>}
  </>:<p className="mp-notice">Press a number above to open a site shift by shift.</p>}
 </>;
}

// Shift Performance in steps (owner, 16 Nov 2026), as OT & Multiple Duties: every site, one site date by shift, one date and
// shift by equipment category, then the duties of a category. A duty on machines of two categories is in both lines and once
// in All categories. Plain render function: its state lives in ManpowerReports.
const pfMeasures=[['duties','Duties','One driver, one shift'],['employees','Drivers / operators','Different persons'],['hours','HMR hours','Machine performance'],['trips','Completed trips','VLB'],['km','Kilometres','VLB']];
function performanceOverview({stepSorts,setStepSorts,report,filters,query,description,ReportSection,sites,pfPick,setPfPick}){
 const lines=report.performance||[],sum=(list,key)=>{const values=list.map(r=>r[key]).filter(v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v)));return values.length?Math.round(values.reduce((a,b)=>a+Number(b),0)*100)/100:0;};
 const tallyOf=list=>({duties:list.length,employees:new Set(list.map(r=>r.employeeKey||r.employeeId)).size,hours:sum(list,'hours'),trips:sum(list,'trips'),km:sum(list,'km')});
 const within=site=>lines.filter(r=>site===EVERY||r.siteKey===site);
 const siteKey=openSite(sites,pfPick.siteKey),inSite=siteKey?within(siteKey):[];
 const span=[];for(let day=filters.from;day<=filters.to&&span.length<32;day=nextDay(day))span.push(day);
 const gridDates=[...new Set([...span,...inSite.map(r=>r.date)])].sort(),gridShifts=[...new Set(['S1','S2','S3',...inSite.map(r=>r.shift).filter(Boolean)])].sort();
 const scope=Boolean(siteKey&&pfPick.scope),date=scope&&gridDates.includes(pfPick.date)?pfPick.date:'',shift=scope&&gridShifts.includes(pfPick.shift)?pfPick.shift:'';
 const at=(day,code)=>inSite.filter(r=>(!day||r.date===day)&&(!code||r.shift===code)),scoped=scope?at(date,shift):[];
 const categoriesOf=r=>r.categories?.length?r.categories:['Group missing in master'];
 const groups=new Map();for(const r of scoped)for(const name of categoriesOf(r)){if(!groups.has(name))groups.set(name,[]);groups.get(name).push(r);}
 const categories=[...groups].map(([equipment,list])=>({id:equipment,equipment,...tallyOf(list)})).sort((a,b)=>b.duties-a.duties||a.equipment.localeCompare(b.equipment)),everyCategory={id:EVERY,equipment:'All categories',...tallyOf(scoped)};
 const open=scope&&(pfPick.equipment===EVERY||groups.has(pfPick.equipment))?pfPick.equipment:'';
 const listed=open?scoped.filter(r=>open===EVERY||categoriesOf(r).includes(open)):[];
 const siteLabel=siteKey===EVERY?'All sites':sites.find(s=>s.siteKey===siteKey)?.site||'',oneDate=gridDates.length===1;
 const dateLabel=filters.from!==filters.to?shortDate(filters.from)+' to '+shortDate(filters.to):shortDate(filters.from);
 const scopeLabel=[date?shortDate(date):oneDate?shortDate(gridDates[0]):'All dates',shift?shiftName(shift):'All shifts'].join(' · ');
 const openLabel=open===EVERY?'All categories':open;
 const base={...noPfPick,siteKey};
 const openSiteAt=site=>setPfPick(siteKey===site&&sites.length>1?noPfPick:{...noPfPick,siteKey:site});
 const show=(day,code)=>setPfPick(scope&&date===day&&shift===code&&!open?base:{...base,scope:true,date:day,shift:code});
 const list=name=>setPfPick(open===name?{...base,scope:true,date,shift}:{...base,scope:true,date,shift,equipment:name});
 const zero=<span className="mp-zero">0</span>;
 const siteRows=[...sites.map(s=>({id:s.siteKey,siteKey:s.siteKey,site:s.site,...tallyOf(within(s.siteKey))})),...(sites.length>1?[{id:EVERY,siteKey:EVERY,site:'All sites',...tallyOf(lines)}]:[])];
 const p1=stepSorter(stepSorts,setStepSorts,'performance-sites'),p3=stepSorter(stepSorts,setStepSorts,'performance-categories'),sortedSites=p1.rows(siteRows,row=>row.siteKey===EVERY),sortedCategories=p3.rows(categories);
 const sortHeads=h=>pfMeasures.map(([key,label,meaning])=>h.head(key,label,meaning));
 const dayRows=[...gridDates.map(day=>({id:day,day,date:shortDate(day)})),...(oneDate?[]:[{id:'all',day:'',date:'All dates'}])].map(row=>{const out={...row,...tallyOf(at(row.day,''))};for(const code of gridShifts){const t=tallyOf(at(row.day,code));out[code+'_duties']=t.duties;out[code+'_hours']=t.hours;}return out;});
 // The figures of one line; the duty count opens what is below it.
 const figures=(row,label,press,pressed)=>pfMeasures.map(([key],i)=><td key={key}>{i===0&&row.duties?<button type="button" className="mp-cat-count mp-ot-duties" aria-pressed={pressed} aria-label={duties(row.duties)+' · '+label} onClick={press}>{row.duties}</button>:row[key]||0}</td>);
 const heads=pfMeasures.map(([key,label,meaning])=><th key={key} scope="col">{label}<small>{meaning}</small></th>);
 const box=(row,code)=>{const label=row.date+' · '+shiftName(code);if(!row[code+'_duties'])return zero;
  return <button type="button" className="mp-att-count" aria-pressed={scope&&date===row.day&&shift===code} aria-label={duties(row[code+'_duties'])+' · '+label} onClick={()=>show(row.day,code)}>{row[code+'_duties']}<small>{row[code+'_hours']} HMR h</small></button>;};
 const measureColumns=pfMeasures.map(([key,label])=>[key,label]);
 const dayColumns=columns([['date','Date'],...gridShifts.flatMap(code=>[[code+'_duties',shiftName(code)+' duties'],[code+'_hours',shiftName(code)+' HMR hours']]),...measureColumns]);
 const dutyColumns=columns([...(date||oneDate?[]:[['date','Duty date']]),...(siteKey===EVERY?[['site','Site']]:[]),...(shift?[]:[['shift','Shift']]),...person,['doors','Doors worked'],['equipment','Equipment / make / model'],['hours','HMR performance hours'],['trips','Completed trips'],['km','Kilometres'],['start','Scheduled start (IST)'],['end','Scheduled end (IST)'],['batches','Source batches'],['books','Saved cards'],['remarks','Remarks / review']]);
 return <>
  <p className="mp-notice">One duty is one employee, one site, one date and one shift. Changing vehicles within a shift remains one duty. HMR hours are machine performance.</p>
  {siteKey&&<p className="mp-trail" aria-label="Where you are">{(open||scope||sites.length>1)&&<StepBackButton onBack={()=>setPfPick(open?{...base,scope:true,date,shift}:scope?base:noPfPick)}/>}{sites.length>1&&<><button type="button" onClick={()=>setPfPick(noPfPick)}>All sites</button><span>›</span></>}<button type="button" onClick={()=>setPfPick(base)}>{siteLabel}</button>{scope&&<><span>›</span><button type="button" onClick={()=>setPfPick({...base,scope:true,date,shift})}>{scopeLabel}</button></>}{open&&<><span>›</span><strong>{openLabel}</strong></>}</p>}
  <ReportSection key={'pf-sites-'+query} title={'Step 1 · All sites · '+dateLabel} category="manpower-performance-sites" description="One line per site: duties, different drivers and operators, HMR hours, completed trips and kilometres. Press the duties to open that site date by shift." rows={sortedSites} columns={columns([['site','Site'],...measureColumns])} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
   <div className="mp-category mp-att" role="group" aria-label="Shift performance by site">
    {sites.length?<table><thead><tr>{p1.head('site','Site')}{sortHeads(p1)}</tr></thead>
     <tbody>{sortedSites.map(s=><tr key={s.id} className={[s.siteKey===EVERY&&sites.length>1&&'mp-att-total',siteKey===s.siteKey&&'mp-on'].filter(Boolean).join(' ')||undefined}><th scope="row">{s.site}</th>{figures(s,s.site,()=>openSiteAt(s.siteKey),siteKey===s.siteKey)}</tr>)}</tbody>
    </table>:<p>No site is available for these selections.</p>}
   </div>
  </ReportSection>
  {siteKey?<>
   <ReportSection key={'pf-dates-'+query+'-'+siteKey} title={'Step 2 · '+siteLabel+' · date by shift · '+dateLabel} category="manpower-performance-dates" description="In each box: the duties of that shift, and under it their HMR hours. Press a box to see it by equipment category." rows={dayRows} columns={dayColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="mp-category mp-att mp-ot-grid" role="group" aria-label="Shift performance by date and shift">
     {scope&&<p className="mp-category-hint">Showing <strong>{scopeLabel}</strong> below. <button type="button" onClick={()=>setPfPick(base)}>Close</button></p>}
     <table><thead><tr><th scope="col">Date</th>{gridShifts.map(code=><th key={code} scope="col">{shiftName(code)}<small>Duties · HMR hours</small></th>)}{heads}</tr></thead>
      <tbody>{dayRows.map(row=>{const total=!row.day&&!oneDate;return <tr key={row.id} className={[total&&'mp-att-total',!total&&scope&&date===row.day&&'mp-on'].filter(Boolean).join(' ')||undefined}>
       <th scope="row">{row.date}{row.day&&<small>{weekday(row.day)}</small>}</th>
       {gridShifts.map(code=><td key={code}>{box(row,code)}</td>)}
       {figures(row,row.date,()=>show(row.day,''),scope&&date===row.day&&!shift)}
      </tr>;})}</tbody>
     </table>
    </div>
   </ReportSection>
   {scope?<ReportSection key={'pf-categories-'+query+'-'+siteKey+'-'+date+'-'+shift} title={'Step 3 · '+siteLabel+' · '+scopeLabel+' · by equipment category'} category="manpower-performance-categories" description="One line per equipment category (the machine’s group in the Equipment master); a duty on machines of two categories is in both lines. Press a category or its duties for the duties below." rows={[...sortedCategories,everyCategory]} columns={columns([['equipment','Equipment category'],...measureColumns])} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <div className="mp-category mp-att mp-ot-categories" role="group" aria-label="Shift performance by equipment category">
     {categories.length?<table><thead><tr>{p3.head('equipment','Equipment category')}{sortHeads(p3)}</tr></thead>
      <tbody>{[...sortedCategories,everyCategory].map(c=><tr key={c.id} className={[c.id===EVERY&&'mp-att-total',open===c.id&&'mp-on'].filter(Boolean).join(' ')||undefined}><td><button type="button" className="mp-cat-open" aria-pressed={open===c.id} onClick={()=>list(c.id)}>{c.equipment}</button></td>{figures(c,c.equipment,()=>list(c.id),open===c.id)}</tr>)}</tbody>
     </table>:<p>No duty in this selection.</p>}
    </div>
   </ReportSection>:<p className="mp-notice">Press a box in the date table to see that date and shift by equipment category, then a category for its duties.</p>}
   {open&&<ReportSection key={'pf-duties-'+query+'-'+siteKey+'-'+date+'-'+shift+'-'+open} title={['Step 4',siteLabel,scopeLabel,openLabel,'duties'].join(' · ')} category="manpower-performance" description={description+' · '+duties(listed.length)+' · Each shift is separate; HMR is machine performance'} rows={listed} columns={dutyColumns} rowKey={r=>r.id} recordDateFilter={false} emptyMessage="No duty matches this selection."/>}
  </>:<p className="mp-notice">Press the duties of a site above to open it date by shift.</p>}
 </>;
}

// On the dashboard (embedded) the report stands alone: it opens on the dates given and shows no tabs for the other views.
// Each tab reads only its own tables, a week of cards at a time (server/rules/manpower-report.mjs MANPOWER_VIEWS).
const REPORT_VIEWS={manpower:'category-counts','manpower-reconciliation':'reconciliation',employee:'performance',attendance:'equipment'};
export default function ManpowerReports({session,reportId='manpower',onSelect,ReportSection,embedded=false,initialFrom=''}){
 const [filters,setFilters]=useState(()=>{const date=today();return {from:initialFrom||monthStartDate(date),to:date,site:'',shift:'',batch:'',employee:'',asset:''};});
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[options,setOptions]=useState({});
 const [autoHide,setAutoHide]=useState(()=>remembered('caliberReportFiltersAutoHide')),[filtersOpen,setFiltersOpen]=useState(false),filterBox=useRef(null),historyBox=useRef(null);
 const [logBook,setLogBook]=useState(''),[tally,setTally]=useState({key:'',data:null,error:''}),[driverOpen,setDriverOpen]=useState('');
 const [pick,setPick]=useState(noPick),[otPick,setOtPick]=useState(noOtPick),[mpPick,setMpPick]=useState(noMpPick),[rcPick,setRcPick]=useState(noRcPick);
 // Shift Performance steps; kept after the other state.
 const [pfPick,setPfPick]=useState(noPfPick);
 // Manpower by Category: the saved cards of the opened date, read on their own (kept after the other state).
 const [mpCards,setMpCards]=useState({key:'',rows:null,error:''});
 // Step 1 / Step 3 heading sorts, by table (kept after the other state).
 const [stepSorts,setStepSorts]=useState({});
 // The OT view always loads every assigned site; the Site selection there narrows the list of sites.
 // The attendance register reads every shift of every site: a day is coded from all its shifts and a person's other sites.
 const register=['attendance-batch','attendance-month'].includes(reportId);
 const query=useMemo(()=>new URLSearchParams(register?{from:filters.from,to:filters.to,view:'attendance'}:reportId==='ot'?{...filters,site:'',view:'ot'}:{...filters,view:REPORT_VIEWS[reportId]||'category'}).toString(),[filters,reportId,register]);
 // The register has its own lighter read (only its duties, presence and batches); `view` keeps its result apart from the full report's.
 const source=(register?'/api/reports/manpower/attendance?':'/api/reports/manpower?')+query;
 const valid=filters.from>=OPERATIONAL_START&&filters.to>=filters.from&&Date.parse(filters.to)-Date.parse(filters.from)<=30*86400000;
 useEffect(()=>{
  const controller=new AbortController();setError('');setData(null);if(!valid){setBusy(false);return ()=>controller.abort();}setBusy(true);
  fetch(source,{headers:{Authorization:`Bearer ${session.token}`},signal:controller.signal}).then(async response=>{const payload=await response.json();if(!response.ok)throw Error(payload.error||'Unable to load saved manpower records.');return payload;}).then(payload=>{if(!controller.signal.aborted){setData({query,payload});if(register)setOptions(current=>({...current,sites:registerSites(payload)}));else setOptions(payload.options);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[query,register,session.token,refresh,valid]);
 const ready=data?.query===query&&valid&&!busy&&!error,report=ready?data.payload:null;
 const siteKey=canonicalSiteName(filters.site),otSites=!report?[]:siteKey?report.otSites.filter(s=>s.siteKey===siteKey):report.otSites;
 // Month and year counts and a driver's history are read for one site at a time, only while that site's drivers are listed.
 // In a list of every site, the site is the one of the driver whose name was pressed.
 const listSite=!report?'':reportId==='ot'?openSite(otSites,otPick.siteKey):reportId==='attendance'&&pick.equipment?(pick.at&&pick.at!==EVERY?pick.at:openSite(report.attendanceSites||[],pick.siteKey)):'';
 const tallySite=listSite===EVERY?driverOpen.split('|')[1]||'':listSite;
 const tallyKey=tallySite+'|'+filters.to.slice(0,7)+'|'+refresh,tallyWanted=valid&&Boolean(tallySite);
 useEffect(()=>{
  if(!tallyWanted||tally.key===tallyKey&&tally.data)return;
  const controller=new AbortController();setTally({key:'',data:null,error:''});
  fetch('/api/reports/manpower/ot-drivers?'+new URLSearchParams({site:tallySite,to:filters.to}),{headers:{Authorization:'Bearer '+session.token},signal:controller.signal})
   .then(async response=>{const payload=await response.json();if(!response.ok)throw Error(payload.error||'Unable to load the month and year counts.');return payload;})
   .then(data=>{if(!controller.signal.aborted)setTally({key:tallyKey,data,error:''});})
   .catch(e=>{if(!controller.signal.aborted)setTally({key:tallyKey,data:null,error:e.message});});
  return()=>controller.abort();
 },[tallyWanted,tallyKey,session.token]);
 // Manpower by Category lists the saved cards of one opened date only (a month of every site is about 59,000 cards):
 // they are read when a site and a date are open, for that site (or every site), that date and that shift.
 const mpSite=reportId==='manpower'&&report?openSite(otSites,mpPick.siteKey):'';
 const mpDay=mpSite&&mpPick.scope?mpPick.date||(filters.from===filters.to?filters.from:''):'';
 const mpCardsQuery=mpDay?new URLSearchParams({...filters,from:mpDay,to:mpDay,site:mpSite===EVERY?filters.site:otSites.find(s=>s.siteKey===mpSite)?.site||filters.site,shift:mpPick.shift||filters.shift,view:'category-cards'}).toString():'';
 const mpCardsKey=mpCardsQuery&&mpCardsQuery+'|'+refresh;
 useEffect(()=>{
  if(!mpCardsKey||mpCards.key===mpCardsKey&&(mpCards.rows||mpCards.error))return;
  const controller=new AbortController();setMpCards({key:mpCardsKey,rows:null,error:''});
  fetch('/api/reports/manpower?'+mpCardsQuery,{headers:{Authorization:'Bearer '+session.token},signal:controller.signal})
   .then(async response=>{const payload=await response.json();if(!response.ok)throw Error(payload.error||'Unable to load the saved cards of this date.');return payload;})
   .then(payload=>{if(!controller.signal.aborted)setMpCards({key:mpCardsKey,rows:payload.details||[],error:''});})
   .catch(e=>{if(!controller.signal.aborted)setMpCards({key:mpCardsKey,rows:null,error:e.message});});
  return()=>controller.abort();
 },[mpCardsKey,session.token]);
 // A history opened in one report does not follow into the other.
 useEffect(()=>setDriverOpen(''),[reportId]);
 // An opened history sits below a long list, so bring it into view.
 useEffect(()=>{if(driverOpen)historyBox.current?.scrollIntoView?.({behavior:'smooth',block:'nearest'});},[driverOpen,tally.key]);
 const set=(field,value)=>setFilters(current=>({...current,[field]:value,...(field==='site'?{batch:'',asset:''}:{})}));
 const title=views.find(([id])=>id===reportId)?.[1]||views[0][1];
 const choice=(field,label,items)=><label>{label}<select value={filters[field]} onChange={e=>{set(field,e.target.value);if(autoHide)e.target.blur();}}><option value="">All</option>{(items||[]).map(item=>{const value=typeof item==='string'?item:item.value;return <option key={value} value={value}>{typeof item==='string'?item:item.label}</option>;})}</select></label>;
 const description=`${filters.from} to ${filters.to} · ${filters.site||'All assigned sites'} · ${filters.shift||'All shifts'} · Saved records only`;
 const showFilters=!autoHide||filtersOpen,chosen=['batch','employee','asset'].filter(field=>filters[field]).length;
 const leaveFilters=()=>{if(!filterBox.current?.contains(document.activeElement))setFiltersOpen(false);};
 // LMV cards are part of the OT view only, so their review items stay off the other views.
 const exceptions=!report?[]:reportId!=='ot'?report.exceptions.filter(e=>e.logBook!=='LMV'):siteKey?report.exceptions.filter(e=>e.siteKey===siteKey):report.exceptions;
 // Cards with a data problem are for the MIS team to correct. The attendance and OT pages keep them behind one line.
 const review=report&&<ReportSection key={'exceptions-'+query} title="Manpower Data Review" category="manpower-review" description="Saved cards with a data problem that affects the counts: an employee ID that matches nobody, a machine missing from the Equipment master, the same card saved twice, a shift written two ways or impossible meter hours. Correct the card or the master and the row disappears." rows={exceptions} columns={exceptionColumns} rowKey={r=>r.id} recordDateFilter={false} emptyMessage="No card needs correction in these selections."/>;
 const selectors=<><label>From<input type="date" min={OPERATIONAL_START} value={filters.from} onChange={e=>set('from',e.target.value)}/></label><label>To<input type="date" min={OPERATIONAL_START} value={filters.to} onChange={e=>set('to',e.target.value)}/></label>{choice('site','Site',(options.sites||[]).filter(isSiteName))}{choice('shift','Shift',(options.shifts||[]).map(code=>({value:code,label:shiftName(code)})).sort((x,y)=>compareShiftLabels(x.label,y.label)))}{choice('batch','Saved batch',options.batches)}{choice('employee','Employee',options.employees)}{choice('asset','Door / equipment',options.assets)}<button type="button" onClick={()=>{const date=today();setFilters(f=>({...f,from:date,to:date}));}}>Today</button><button type="button" onClick={()=>setFilters(f=>({...f,site:'',shift:'',batch:'',employee:'',asset:''}))}>Clear selections</button></>;
 // On the dashboard the heading and the selectors share one row; the list for the MIS team and the rules stay on the Reports page.
 return <section className="mp-reports" aria-label="Manpower and OT reports">
  {embedded?<div className="mp-compact">
   <header className="mp-heading"><div><h1>{title}</h1><p>Saved duties, clear assignments and shift-by-shift performance.</p></div></header>
   <div className="mp-filter-box"><div className="mp-filters">{selectors}<button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh</button></div></div>
  </div>:<>
  <header className="mp-heading"><div><small>REPORTS / MANPOWER & OT</small><h1>{title}</h1><p>Saved duties, clear assignments and shift-by-shift performance.</p></div><button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh reports</button></header>
  {!embedded&&<nav className="mp-tabs" aria-label="Manpower report views">{views.map(([id,label])=><button key={id} type="button" aria-current={reportId===id?'page':undefined} onClick={()=>onSelect(id)}>{label}</button>)}</nav>}
  <div ref={filterBox} className="mp-filter-box" onMouseEnter={autoHide?()=>setFiltersOpen(true):undefined} onMouseLeave={autoHide?leaveFilters:undefined} onBlur={autoHide?e=>{if(!e.currentTarget.contains(e.relatedTarget)&&!e.currentTarget.matches(':hover'))setFiltersOpen(false);}:undefined}>
   <div className="mp-filter-bar"><button type="button" className="mp-filter-current" aria-expanded={showFilters} disabled={!autoHide} onClick={()=>setFiltersOpen(open=>!open)}><strong>{filters.from} to {filters.to}</strong><span>{filters.site||'All assigned sites'} · {filters.shift||'All shifts'}{chosen?' · '+chosen+' more selection'+(chosen>1?'s':''):''}</span></button><label className="mp-autohide"><input type="checkbox" checked={autoHide} onChange={e=>{setAutoHide(e.target.checked);setFiltersOpen(false);remember('caliberReportFiltersAutoHide',e.target.checked);}}/>Auto-hide filters</label></div>
   {showFilters&&<div className="mp-filters">{selectors}</div>}
  </div>
  </>}
  {!valid&&<p role="alert">Choose a valid range of up to 31 days, starting on or after 1 November 2026.</p>}{busy&&<p role="status">Loading saved records and checking shift patterns…</p>}{error&&<p role="alert">{error}</p>}
  {report&&<>
   <p className="mp-source">{description} · Updated {new Date(report.generatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST</p>
   {!register&&!['attendance','ot','manpower-reconciliation'].includes(reportId)&&<div className="mp-metrics">{[['assets','Distinct assets'],['employees','Distinct employees'],['duties','Employee shift duties'],['exceptions','Review items']].map(([key,label])=><div key={key}><strong>{report.totals[key]}</strong><span>{label}</span></div>)}</div>}
   {register?<AttendanceRegister report={report} filters={filters} mode={reportId} ReportSection={ReportSection} sites={otSites} query={query}/>:reportId==='attendance'?<>
    {attendanceOverview({stepSorts,setStepSorts,report,filters,query,ReportSection,pick,setPick,tally,tallyKey,tallySite,driverOpen,setDriverOpen,historyBox})}
   </>:reportId==='ot'?<>
    {otOverview({stepSorts,setStepSorts,report,filters,query,ReportSection,sites:otSites,otPick,setOtPick,logBook,setLogBook,tally,tallyKey,tallySite,driverOpen,setDriverOpen,historyBox})}
   </>:reportId==='manpower-reconciliation'?<>
    {reconciliationOverview({stepSorts,setStepSorts,report,filters,query,ReportSection,sites:otSites,rcPick,setRcPick})}
   </>:reportId==='employee'?<>
    {performanceOverview({stepSorts,setStepSorts,report,filters,query,description,ReportSection,sites:otSites,pfPick,setPfPick})}
   </>:<>
    {manpowerOverview({stepSorts,setStepSorts,report,filters,query,description,ReportSection,sites:otSites,mpPick,setMpPick,cards:mpCards.key===mpCardsKey?mpCards:{rows:null,error:''}})}
   </>}
   {embedded?null:register||['attendance','ot','manpower-reconciliation'].includes(reportId)?exceptions.length>0&&<details className="mp-notes mp-review"><summary>{exceptions.length===1?'1 saved card needs':exceptions.length+' saved cards need'} correction (list for the MIS team)</summary>{review}</details>:review}
   {!embedded&&<details className="mp-notes"><summary>Sources and calculation rules</summary><ul>{report.notes.map(note=><li key={note}>{note}</li>)}</ul><p>Manpower requirements, shortages and relief availability are reserved for a later phase.</p></details>}
  </>}
 </section>;
}
