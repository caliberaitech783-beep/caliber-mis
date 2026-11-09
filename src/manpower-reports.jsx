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
const EVERY='*';
const shiftName=code=>({S1:'Shift 1',S2:'Shift 2',S3:'Shift 3',D:'Day shift',N:'Night shift'})[code]||code;
const stageName=state=>({vlb_open:'VLB open',lmv_open:'LMV open',elb_open:'ELB open'})[state]||'Open';
const batchOpen=b=>/_open$/.test(b.state);
const shortDate=date=>date.slice(8,10)+'-'+date.slice(5,7)+'-'+date.slice(2,4);
const monthName=month=>new Date(month+'-01T00:00:00Z').toLocaleString('en-IN',{month:'short',year:'numeric',timeZone:'UTC'});
const many=(n,word)=>n+' '+word+(n===1?'':'s');
const dutyCount=(n,kind)=>n+' '+kind+(n===1?' duty':' duties');
// Colours shared by both reports. Red, orange and brown are the OT patterns; blue is attendance only.
const dutyFlags=[['red','Red','Back-to-back shifts, or all three shifts'],['orange','Orange','Shift 1 and Shift 3 with a gap'],['review','Brown','Shift pattern needs review'],['zero','Blue','Present with 0 trips']];
const otFlags=dutyFlags.slice(0,3);
const logBooks=[['VLB','Vehicle Log Book'],['ELB','Equipment Log Book'],['LMV','LMV Log Book']];
const flagChip=key=>c=>c.key===key?{...c,render:r=><strong className={'mp-flag mp-flag-'+(r.flag||r.severity)}>{r[key]}</strong>}:c;
// The driver's name opens his history; the row carries `driverId` (driver and site).
const driverButton=(opened,openDriver)=>c=>c.key==='employeeName'?{...c,render:r=><button type="button" className="mp-driver-open" aria-pressed={opened===r.driverId} aria-label={'History of '+r.employeeName} onClick={()=>openDriver(opened===r.driverId?'':r.driverId)}>{r.employeeName}</button>}:c;
// Date, site and shift sit in the heading; each returns as a column only when the list covers more than one.
const attendanceColumns=({days,sites,shifts,equipment,month,year,opened,openDriver})=>columns([...(days?[['date','Duty date']]:[]),...(sites?[['site','Site']]:[]),...(shifts?[['shift','Shift']]:[]),...person,['otMonth','OT in '+monthName(month)],['otYear','OT in '+year],['doors','Door / equipment'],...(equipment?[['equipment','Equipment']]:[]),['makeModel','Make / model'],['status','Attendance'],['trips','Completed VLB trips'],['actualLabel','Actual duty'],['flagLabel','Duty flag'],['note','Duty note'],['reason','Zero-trip reason'],['remarks','Remarks']]).map(flagChip('flagLabel')).map(driverButton(opened,openDriver));
const otDriverColumns=({sites,month,year,opened,openDriver})=>columns([...(sites?[['site','Site']]:[]),...person,['category','Driver category'],['red','Red'],['orange','Orange'],['review','Brown'],['total','Cases in selected dates'],['otMonth','OT in '+monthName(month)],['otYear','OT in '+year],['logBook','Log book'],['dutyDates','Duty dates'],['shifts','Shifts worked'],['equipment','Equipment worked']]).map(driverButton(opened,openDriver));
const otColumns=columns([['reason','OT flag / reason'],['logBook','Log book'],...person,['category','Driver category'],['equipment','Equipment worked'],['site','Site'],['dates','Duty dates'],['shifts','Shifts worked'],['shiftHours','Each shift’s HMR hours'],['combinedHours','Combined HMR performance hours'],['schedule','Scheduled start / end (IST)'],['gaps','Scheduled gap between duties'],['batches','Source batches'],['books','Saved cards'],['remarks','Remarks / review']]).map(flagChip('reason'));
const driverHistoryColumns=columns([['date','Duty date'],['reason','OT flag / reason'],['shifts','Shifts worked'],['logBook','Log book'],['equipment','Equipment worked'],['combinedHours','Combined HMR performance hours'],['books','Saved cards']]).map(flagChip('reason'));
const classification=[['category','Category'],['group','Equipment group'],['make','Make'],['model','Model']];
const detailColumns=columns([...context,['door','Door / equipment'],...classification,...person,['assignment','Assignment'],['batches','Source batches'],['batchStatus','Batch status'],['book','Saved card'],['remarks','Remarks / review']]);
const summaryColumns=columns([...context,...classification,['assets','Distinct vehicles / equipment'],['employees','Distinct employees'],['unresolved','Unresolved assignment records'],['doors','Door numbers'],['batches','Source batches']]);
const performanceColumns=columns([...context,...person,['doors','Doors worked'],['equipment','Equipment / make / model'],['hours','HMR performance hours'],['trips','Completed trips'],['km','Kilometres'],['start','Scheduled start (IST)'],['end','Scheduled end (IST)'],['batches','Source batches'],['books','Saved cards'],['remarks','Remarks / review']]);
const exceptionColumns=columns([...context,['door','Door / equipment'],['employeeId','Employee ID'],['employeeName','Driver / operator'],['book','Saved card'],['logBook','Log book'],['batches','Source batches'],['reason','What to correct']]);
const noPick={siteKey:'',shift:'',equipment:'',flag:''},noOtPick={siteKey:'',severity:''};
const remembered=key=>{try{return localStorage.getItem(key)==='true';}catch{return false;}};
const remember=(key,value)=>{try{localStorage.setItem(key,String(value));}catch{}};

// The site that is open in a report: the only site when there is one, else the one picked (or every site).
const openSite=(sites,picked)=>sites.length===1?sites[0].siteKey:picked===EVERY||sites.some(s=>s.siteKey===picked)?picked:'';
// Month and year counts arrive in a separate read for one site. Until then a cell says so instead of showing a zero;
// in a list of every site, pressing a driver's name reads that driver's site.
const tallyReader=(tally,tallyKey,tallySite)=>{
 const counted=tally.key===tallyKey,data=counted?tally.data:null,drivers=new Map((data?.drivers||[]).map(d=>[d.employeeKey+'|'+d.siteKey,d]));
 return {counted,data,error:counted?tally.error:'',record:id=>drivers.get(id),count:(id,siteKey,span)=>siteKey!==tallySite?'Press the name':data?drivers.get(id)?.[span].total||0:counted?'Unavailable':'Checking…'};
};

// One driver's history for the year, opened from his name: duties and OT month by month, then every flagged duty.
// Plain render function: its state lives in ManpowerReports.
function driverHistory({driver,detail,reader,year,close,historyBox,ReportSection,sectionKey}){
 const record=reader.record(driver.driverId),events=record?.events||[],worked=record?.duties||{};
 const months=[...new Set([...events.map(e=>e.date.slice(0,7)),...Object.keys(worked)])].sort().map(month=>{const list=events.filter(e=>e.date.slice(0,7)===month),n=level=>list.filter(e=>e.severity===level).length;return {month,duties:worked[month]||0,red:n('red'),orange:n('orange'),review:n('review'),total:list.length};});
 const sum=key=>months.reduce((total,m)=>total+m[key],0),period=reader.data?shortDate(reader.data.yearFrom)+' to '+shortDate(reader.data.yearTo):'';
 return <>
  <div ref={historyBox} className="mp-category mp-driver-history"><h2>{driver.employeeName} · history {year}</h2>
   <p className="mp-category-hint">{[driver.employeeId,detail,driver.site,period].filter(Boolean).join(' · ')} · Duties are saved VLB and ELB cards, one per shift. Each red, orange or brown case counts as one OT. <button type="button" onClick={close}>Close history</button></p>
   {reader.data?<table><thead><tr><th>Month</th><th>Duties</th><th>Red</th><th>Orange</th><th>Brown</th><th>OT times</th></tr></thead>
    <tbody>{months.map(m=><tr key={m.month}><td>{monthName(m.month)}</td><td>{m.duties}</td><td>{m.red}</td><td>{m.orange}</td><td>{m.review}</td><td>{m.total}</td></tr>)}
    <tr className="mp-total"><td>Year {year}</td><td>{sum('duties')}</td><td>{sum('red')}</td><td>{sum('orange')}</td><td>{sum('review')}</td><td>{sum('total')}</td></tr></tbody></table>
    :<p role={reader.counted?'alert':'status'}>{reader.counted?reader.error||'The history could not be read. Press Refresh reports and try again.':'Reading this driver’s history…'}</p>}
  </div>
  {reader.data&&<ReportSection key={sectionKey} title={driver.employeeName+' · flagged duties in '+year} category="manpower-ot-driver-history" description={driver.site+' · '+period+' · Newest first'} rows={events} columns={driverHistoryColumns} rowKey={r=>r.id} rowClassName={r=>'mp-ot-'+r.severity} recordDateFilter={false} emptyMessage="No red, orange or brown duty for this driver in this year."/>}
 </>;
}

// OT & Multiple Duties: one line per site, then that site's drivers, then one driver's history.
// Plain render function: its state lives in ManpowerReports.
function otOverview({report,filters,query,ReportSection,sites,otPick,setOtPick,logBook,setLogBook,tally,tallyKey,tallySite,driverOpen,setDriverOpen,historyBox}){
 // A duty saved in two log books belongs to both, so it is counted under each.
 const cases=report.ot.filter(r=>!logBook||(r.logBooks||[]).includes(logBook));
 const of=(site,level)=>cases.filter(r=>(site===EVERY||r.siteKey===site)&&(!level||r.severity===level));
 const driversIn=list=>new Set(list.map(r=>r.employeeKey+'|'+r.siteKey)).size;
 const siteKey=openSite(sites,otPick.siteKey),severity=siteKey?otPick.severity:'',chosen=siteKey?of(siteKey,severity):[];
 const colour=otFlags.find(([id])=>id===severity)?.[1]||'',siteLabel=siteKey===EVERY?'All sites':sites.find(s=>s.siteKey===siteKey)?.site||'';
 const reader=tallyReader(tally,tallyKey,tallySite),month=filters.to.slice(0,7),year=filters.to.slice(0,4);
 const dateLabel=filters.from!==filters.to?shortDate(filters.from)+' to '+shortDate(filters.to):shortDate(filters.from);
 const driverRows=(()=>{
  const drivers=new Map();
  for(const r of chosen){const id=r.employeeKey+'|'+r.siteKey,row=drivers.get(id)||{id,driverId:id,siteKey:r.siteKey,site:r.site,employeeId:r.employeeId,caliberCode:r.caliberCode,employeeName:r.employeeName,category:r.category,red:0,orange:0,review:0,total:0,books:new Set(),dates:new Set(),shifts:[],equipment:new Set()};
   row[r.severity]++;row.total++;for(const code of r.logBooks||[])row.books.add(code);for(const date of String(r.dates||'').split('; '))if(date)row.dates.add(date);if(r.shifts)row.shifts.push(r.shifts);for(const item of String(r.equipment||'').split('; '))if(item)row.equipment.add(item);drivers.set(id,row);}
  return [...drivers.values()].map(({books,dates,shifts,equipment,...row})=>({...row,otMonth:reader.count(row.id,row.siteKey,'month'),otYear:reader.count(row.id,row.siteKey,'year'),logBook:logBooks.map(([code])=>code).filter(code=>books.has(code)).join(' + '),dutyDates:[...dates].sort().join('; '),shifts:shifts.join(' | '),equipment:[...equipment].join('; ')}))
   .sort((a,b)=>b.red-a.red||b.orange-a.orange||b.total-a.total||String(a.employeeName).localeCompare(String(b.employeeName)));
 })();
 const opened=driverRows.find(r=>r.id===driverOpen);
 const choose=(site,level)=>setOtPick(siteKey===site&&severity===level?noOtPick:{siteKey:site,severity:level});
 const line=(site,name,total)=><tr key={site} className={[total&&'mp-att-total',siteKey===site&&'mp-on'].filter(Boolean).join(' ')||undefined}>
  <th scope="row">{name}</th>
  {otFlags.map(([id,label])=>{const n=of(site,id).length;return <td key={id}>{n?<button type="button" className={'mp-cat-count mp-flag-'+id} aria-pressed={siteKey===site&&severity===id} aria-label={n+' '+label+' · '+name} onClick={()=>choose(site,id)}>{n}</button>:0}</td>;})}
  <td>{of(site,'').length?<button type="button" className="mp-cat-count" aria-pressed={siteKey===site&&!severity} aria-label={many(driversIn(of(site,'')),'driver')+' · '+name} onClick={()=>choose(site,'')}>{driversIn(of(site,''))}</button>:0}</td>
 </tr>;
 return <>
  <p className="mp-notice">A case is one driver working more than one shift: back to back (red), Shift 1 and Shift 3 on one day (orange), or a pattern that needs checking (brown). {many(cases.length,'case')} and {many(driversIn(cases),'driver')} in the selected dates.</p>
  <div className="mp-book-pick" role="group" aria-label="Log book">{[['','All log books'],...logBooks].map(([code,name])=><button key={code||'all'} type="button" aria-pressed={logBook===code} title={name} onClick={()=>setLogBook(code)}>{code||name}</button>)}</div>
  <div className="mp-category mp-att" role="group" aria-label="Cases by site">
   <h2>All sites · {dateLabel} · {logBook||'VLB, ELB and LMV'}</h2>
   {sites.length?<>
    <p className="mp-category-hint">Press a number to list those drivers, one row each.</p>
    <table><thead><tr><th scope="col">Site</th>{otFlags.map(([id,label,meaning])=><th key={id} scope="col">{label}<small>{meaning}</small></th>)}<th scope="col">Drivers<small>With any colour</small></th></tr></thead>
     <tbody>{sites.map(s=>line(s.siteKey,s.site,false))}{sites.length>1&&line(EVERY,'All sites',true)}</tbody>
    </table>
   </>:<p>No site is available for these selections.</p>}
  </div>
  {siteKey?<>
   <ReportSection key={'drivers-'+query+'-'+siteKey+'-'+logBook+'-'+severity} title={[siteLabel,colour?colour+' only':'All colours','drivers'].join(' · ')} category="manpower-ot-drivers" description={dateLabel+' · '+(logBook||'VLB, ELB and LMV')+' · One row per driver · Press a name for the month-wise history'} rows={driverRows} columns={otDriverColumns({sites:siteKey===EVERY,month,year,opened:opened?.id||'',openDriver:setDriverOpen})} rowKey={r=>r.id} recordDateFilter={false} emptyMessage="No driver with these colours in this selection."/>
   {opened&&driverHistory({driver:opened,detail:opened.category,reader,year,close:()=>setDriverOpen(''),historyBox,ReportSection,sectionKey:'driver-history-'+query+'-'+opened.id})}
   <ReportSection key={'ot-'+query+'-'+siteKey+'-'+logBook+'-'+severity} title={[siteLabel,colour?colour+' only':'All colours','each case'].join(' · ')} category="manpower-ot" description="One row per case: the driver and the shifts worked together. Scheduled times in IST; HMR hours are machine hours, not payable OT." rows={chosen} columns={otColumns} rowKey={r=>r.id} rowClassName={r=>'mp-ot-'+r.severity} recordDateFilter={false} emptyMessage="No case in this selection."/>
  </>:<p className="mp-notice">Press a number above to list the drivers, then a driver’s name for the month-wise history.</p>}
 </>;
}

// Shift Attendance Equipment Wise: every site by shift, then one site and shift by equipment, then its drivers.
// Plain render function: its state lives in ManpowerReports.
function attendanceOverview({report,filters,query,ReportSection,pick,setPick,tally,tallyKey,tallySite,driverOpen,setDriverOpen,historyBox}){
 const rows=report.attendanceEquipment||[],sites=report.attendanceSites||[],batches=report.attendanceShifts||[];
 const shifts=filters.shift?[filters.shift]:[...new Set(['S1','S2','S3',...rows.map(r=>r.shift),...batches.map(b=>b.shift)])].sort();
 const within=(site,code)=>rows.filter(r=>(site===EVERY||r.siteKey===site)&&(!code||r.shift===code));
 // The batch behind a site and shift: missing ("none"), still open, closed, or not yet due.
 const batchesOf=(site,code)=>batches.filter(b=>(site===EVERY||b.siteKey===site)&&(!code||b.shift===code));
 const waiting=list=>({none:list.filter(b=>b.state==='none').length,open:list.filter(batchOpen).length});
 // An actual duty is one driver in one shift on one date; a second machine in the same shift is not another one.
 const actual=list=>list.filter(r=>r.actual).length;
 const siteKey=openSite(sites,pick.siteKey);
 const shift=siteKey&&shifts.includes(pick.shift)?pick.shift:'',chosen=siteKey?within(siteKey,shift):[];
 const equipment=(()=>{const out=new Map();for(const r of chosen){const e=out.get(r.equipment)||{equipment:r.equipment,duties:0,actual:0,red:0,orange:0,review:0,zero:0};e.duties++;if(r.actual)e.actual++;if(dutyFlags.some(([id])=>id===r.flag))e[r.flag]++;out.set(r.equipment,e);}return [...out.values()].sort((a,b)=>b.duties-a.duties||a.equipment.localeCompare(b.equipment));})();
 const open=pick.equipment===EVERY||equipment.some(e=>e.equipment===pick.equipment)?pick.equipment:'',flag=open?pick.flag:'';
 const reader=tallyReader(tally,tallyKey,tallySite),month=filters.to.slice(0,7),year=filters.to.slice(0,4);
 const listed=(open?chosen.filter(r=>(open===EVERY||r.equipment===open)&&(!flag||r.flag===flag)):[]).map(r=>{const driverId=r.employeeKey+'|'+r.siteKey;return {...r,driverId,otMonth:reader.count(driverId,r.siteKey,'month'),otYear:reader.count(driverId,r.siteKey,'year')};});
 const opened=listed.find(r=>r.driverId===driverOpen);
 const days=filters.from!==filters.to,dateLabel=days?shortDate(filters.from)+' to '+shortDate(filters.to):shortDate(filters.from);
 const siteLabel=key=>sites.find(s=>s.siteKey===key)?.site||key;
 const heading=[siteKey===EVERY?'All sites':siteLabel(siteKey),shift?shiftName(shift):'All shifts',dateLabel].join(' · ');
 const openLabel=open===EVERY?'All equipment':open,flagName=dutyFlags.find(([id])=>id===flag)?.[1]||'';
 const choose=(site,code)=>setPick(siteKey===site&&shift===code?noPick:{...noPick,siteKey:site,shift:code});
 const list=(name,colour='')=>setPick(open===name&&flag===colour?{...noPick,siteKey,shift}:{siteKey,shift,equipment:name,flag:colour});
 // One box per site and shift. The whole box is red while its batch is missing and outlined orange while the batch is open;
 // the total boxes only carry the note.
 const box=(site,code,label)=>{
  const n=actual(within(site,code)),held=batchesOf(site,code),w=waiting(held),one=site!==EVERY&&Boolean(code),state=w.none?'none':w.open?'open':'';
  const note=one&&!days?(w.none?'No batch':w.open?stageName(held.find(batchOpen)?.state):''):[w.none&&many(w.none,one?'day':'shift')+' no batch',w.open&&w.open+' open'].filter(Boolean).join(' · ');
  if(!n&&!state)return <span className="mp-zero">0</span>;
  return <button type="button" className={'mp-att-count'+(one&&state?' mp-att-'+state:'')} aria-pressed={siteKey===site&&shift===code} aria-label={[dutyCount(n,'actual'),label,note].filter(Boolean).join(' · ')} onClick={()=>choose(site,code)}>{n}{note&&<small>{note}</small>}</button>;
 };
 const line=(name,label,e,total)=><tr key={name} className={[total&&'mp-att-total',open===name&&'mp-on'].filter(Boolean).join(' ')||undefined}>
  <td><button type="button" className="mp-cat-open" aria-pressed={open===name&&!flag} onClick={()=>list(name)}>{label}</button></td>
  <td><button type="button" className="mp-cat-count" aria-pressed={open===name&&!flag} aria-label={dutyCount(e.duties,'equipment-wise')+' · '+label} onClick={()=>list(name)}>{e.duties}</button></td>
  <td>{e.actual}</td>
  {dutyFlags.map(([id,colour])=><td key={id}>{e[id]?<button type="button" className={'mp-cat-count mp-flag-'+id} aria-pressed={open===name&&flag===id} aria-label={e[id]+' '+colour+' · '+label} onClick={()=>list(name,id)}>{e[id]}</button>:0}</td>)}
 </tr>;
 const totals={duties:chosen.length,actual:actual(chosen),...Object.fromEntries(dutyFlags.map(([id])=>[id,chosen.filter(r=>r.flag===id).length]))},second=totals.duties-totals.actual;
 // Which batches are behind the open site and shift, in words: the missing ones first.
 const all=waiting(batches),here=siteKey?batchesOf(siteKey,shift):[];
 const where=b=>[siteKey===EVERY&&siteLabel(b.siteKey),days&&shortDate(b.date),!shift&&shiftName(b.shift)].filter(Boolean).join(' ');
 const missing=here.filter(b=>b.state==='none'),stillOpen=here.filter(batchOpen);
 return <>
  <p className="mp-notice">{dutyCount(actual(rows),'actual')} · {dutyCount(rows.length,'equipment-wise')}. An actual duty is one driver in one shift on one date. A driver on two equipment types in one shift is counted on both machines and once in actual duties.</p>
  <div className="mp-category mp-att" role="group" aria-label="Actual duties by site and shift">
   <h2>All sites, shift-wise · {dateLabel} · actual duties</h2>
   {sites.length?<>
    <p className="mp-att-status">{all.none>0&&<span className="mp-flag mp-att-none">{many(all.none,'shift')} without a batch</span>}{all.open>0&&<span className="mp-flag mp-att-open">{all.open===1?'1 batch open':all.open+' batches open'}</span>}{!all.none&&!all.open&&<span>Every shift that has ended has a closed batch.</span>}<span>Red box: batch not created. Orange outline: batch not closed. Press a number to see that site and shift by equipment.</span></p>
    <table><thead><tr><th scope="col">Site</th>{shifts.map(code=><th key={code} scope="col">{shiftName(code)}</th>)}<th scope="col">All shifts</th></tr></thead>
     <tbody>{sites.map(s=><tr key={s.siteKey} className={siteKey===s.siteKey?'mp-on':undefined}><th scope="row">{s.site}</th>{shifts.map(code=><td key={code}>{box(s.siteKey,code,s.site+' · '+shiftName(code))}</td>)}<td>{box(s.siteKey,'',s.site+' · All shifts')}</td></tr>)}
     {sites.length>1&&<tr className={'mp-att-total'+(siteKey===EVERY?' mp-on':'')}><th scope="row">All sites</th>{shifts.map(code=><td key={code}>{box(EVERY,code,'All sites · '+shiftName(code))}</td>)}<td>{box(EVERY,'','All sites · All shifts')}</td></tr>}</tbody>
    </table>
   </>:<p>No site is available for these selections.</p>}
  </div>
  {siteKey?<>
   <div className="mp-category mp-att">
    <h2>{heading} · duties by equipment</h2>
    {missing.length>0&&<p className="mp-att-batch mp-att-batch-none"><strong>Batch not created:</strong> {missing.length===1&&!where(missing[0])?'this shift':missing.slice(0,60).map(where).join(' · ')+(missing.length>60?' · and '+(missing.length-60)+' more':'')}</p>}
    {stillOpen.length>0&&<p className="mp-att-batch mp-att-batch-open"><strong>Batch not closed:</strong> {stillOpen.slice(0,60).map(b=>[where(b),b.batch,'('+stageName(b.state)+')'].filter(Boolean).join(' ')).join(' · ')}</p>}
    {equipment.length?<>
     <p className="mp-category-hint">{open?<>Showing <strong>{openLabel}{flagName?' · '+flagName+' only':''}</strong> below. <button type="button" onClick={()=>setPick({...noPick,siteKey,shift})}>Close the driver list</button></>:'Press an equipment or a number to list its drivers below.'}</p>
     <table><thead><tr><th scope="col">Equipment</th><th scope="col">Equipment-wise duties</th><th scope="col">Actual duties</th>{dutyFlags.map(([id,colour,meaning])=><th key={id} scope="col" title={meaning}>{colour}</th>)}</tr></thead>
      <tbody>{equipment.map(e=>line(e.equipment,e.equipment,e,false))}{line(EVERY,'All equipment',totals,true)}</tbody>
     </table>
     {second>0&&<p className="mp-att-foot">{second} {second===1?'duty here is':'duties here are'} a second machine for the driver: counted on each machine, once in actual duties.</p>}
    </>:<p>No duty saved in this selection.</p>}
   </div>
   {open&&<>
    <div className="mp-legend" aria-label="Row colours"><span className="mp-flag mp-flag-normal">White · Normal duty</span>{dutyFlags.map(([id,colour,meaning])=><span key={id} className={'mp-flag mp-flag-'+id}>{colour} · {meaning}</span>)}</div>
    <ReportSection key={'attendance-'+query+'-'+siteKey+'-'+shift+'-'+open+'-'+flag} title={'Shift Attendance Equipment Wise · '+heading+' · '+openLabel+(flagName?' · '+flagName+' only':'')} category="shift-attendance" description={dutyCount(listed.length,'equipment-wise')+' · '+dutyCount(actual(listed),'actual')+' · Saved records only · Press a name for the month-wise history'} rows={listed} columns={attendanceColumns({days,sites:siteKey===EVERY,shifts:!shift,equipment:open===EVERY,month,year,opened:opened?.driverId||'',openDriver:setDriverOpen})} rowKey={r=>r.id} rowClassName={r=>'mp-duty-'+r.flag} recordDateFilter={false} emptyMessage="No duty matches this selection."/>
    {opened&&driverHistory({driver:opened,detail:opened.equipment,reader,year,close:()=>setDriverOpen(''),historyBox,ReportSection,sectionKey:'attendance-history-'+query+'-'+opened.driverId})}
   </>}
  </>:<p className="mp-notice">Press a number above to see the duties by equipment, then the drivers.</p>}
 </>;
}

export default function ManpowerReports({session,reportId='manpower',onSelect,ReportSection}){
 const [filters,setFilters]=useState(()=>{const date=today();return {from:date,to:date,site:'',shift:'',batch:'',employee:'',asset:''};});
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[options,setOptions]=useState({});
 const [autoHide,setAutoHide]=useState(()=>remembered('caliberReportFiltersAutoHide')),[filtersOpen,setFiltersOpen]=useState(false),filterBox=useRef(null),historyBox=useRef(null);
 const [logBook,setLogBook]=useState(''),[tally,setTally]=useState({key:'',data:null,error:''}),[driverOpen,setDriverOpen]=useState('');
 const [pick,setPick]=useState(noPick),[otPick,setOtPick]=useState(noOtPick);
 // The OT view always loads every assigned site; the Site selection there narrows the list of sites.
 const query=useMemo(()=>new URLSearchParams(reportId==='ot'?{...filters,site:''}:filters).toString(),[filters,reportId]);
 const valid=filters.from>=OPERATIONAL_START&&filters.to>=filters.from&&Date.parse(filters.to)-Date.parse(filters.from)<=30*86400000;
 useEffect(()=>{
  const controller=new AbortController();setError('');setData(null);if(!valid){setBusy(false);return ()=>controller.abort();}setBusy(true);
  fetch('/api/reports/manpower?'+query,{headers:{Authorization:`Bearer ${session.token}`},signal:controller.signal}).then(async response=>{const payload=await response.json();if(!response.ok)throw Error(payload.error||'Unable to load saved manpower records.');return payload;}).then(payload=>{if(!controller.signal.aborted){setData({query,payload});setOptions(payload.options);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[query,session.token,refresh,valid]);
 const ready=data?.query===query&&valid&&!busy&&!error,report=ready?data.payload:null;
 const siteKey=canonicalSiteName(filters.site),otSites=!report?[]:siteKey?report.otSites.filter(s=>s.siteKey===siteKey):report.otSites;
 // Month and year counts and a driver's history are read for one site at a time, only while that site's drivers are listed.
 // In a list of every site, the site is the one of the driver whose name was pressed.
 const listSite=!report?'':reportId==='ot'?openSite(otSites,otPick.siteKey):reportId==='attendance'&&pick.equipment?openSite(report.attendanceSites||[],pick.siteKey):'';
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
 return <section className="mp-reports" aria-label="Manpower and OT reports">
  <header className="mp-heading"><div><small>REPORTS / MANPOWER & OT</small><h1>{title}</h1><p>Saved duties, clear assignments and shift-by-shift performance.</p></div><button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh reports</button></header>
  <nav className="mp-tabs" aria-label="Manpower report views">{views.map(([id,label])=><button key={id} type="button" aria-current={reportId===id?'page':undefined} onClick={()=>onSelect(id)}>{label}</button>)}</nav>
  <div ref={filterBox} className="mp-filter-box" onMouseEnter={autoHide?()=>setFiltersOpen(true):undefined} onMouseLeave={autoHide?leaveFilters:undefined} onBlur={autoHide?e=>{if(!e.currentTarget.contains(e.relatedTarget)&&!e.currentTarget.matches(':hover'))setFiltersOpen(false);}:undefined}>
   <div className="mp-filter-bar"><button type="button" className="mp-filter-current" aria-expanded={showFilters} disabled={!autoHide} onClick={()=>setFiltersOpen(open=>!open)}><strong>{filters.from} to {filters.to}</strong><span>{filters.site||'All assigned sites'} · {filters.shift||'All shifts'}{chosen?' · '+chosen+' more selection'+(chosen>1?'s':''):''}</span></button><label className="mp-autohide"><input type="checkbox" checked={autoHide} onChange={e=>{setAutoHide(e.target.checked);setFiltersOpen(false);remember('caliberReportFiltersAutoHide',e.target.checked);}}/>Auto-hide filters</label></div>
   {showFilters&&<div className="mp-filters"><label>From<input type="date" min={OPERATIONAL_START} value={filters.from} onChange={e=>set('from',e.target.value)}/></label><label>To<input type="date" min={OPERATIONAL_START} value={filters.to} onChange={e=>set('to',e.target.value)}/></label>{choice('site','Site',options.sites)}{choice('shift','Shift',options.shifts)}{choice('batch','Saved batch',options.batches)}{choice('employee','Employee',options.employees)}{choice('asset','Door / equipment',options.assets)}<button type="button" onClick={()=>{const date=today();setFilters(f=>({...f,from:date,to:date}));}}>Today</button><button type="button" onClick={()=>setFilters(f=>({...f,site:'',shift:'',batch:'',employee:'',asset:''}))}>Clear selections</button></div>}
  </div>
  {!valid&&<p role="alert">Choose a valid range of up to 31 days, starting on or after 1 November 2026.</p>}{busy&&<p role="status">Loading saved records and checking shift patterns…</p>}{error&&<p role="alert">{error}</p>}
  {report&&<>
   <p className="mp-source">{description} · Updated {new Date(report.generatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST</p>
   {reportId!=='attendance'&&reportId!=='ot'&&<div className="mp-metrics">{[['assets','Distinct assets'],['employees','Distinct employees'],['duties','Employee shift duties'],['exceptions','Review items']].map(([key,label])=><div key={key}><strong>{report.totals[key]}</strong><span>{label}</span></div>)}</div>}
   {reportId==='attendance'?<>
    {attendanceOverview({report,filters,query,ReportSection,pick,setPick,tally,tallyKey,tallySite,driverOpen,setDriverOpen,historyBox})}
   </>:reportId==='ot'?<>
    {otOverview({report,filters,query,ReportSection,sites:otSites,otPick,setOtPick,logBook,setLogBook,tally,tallyKey,tallySite,driverOpen,setDriverOpen,historyBox})}
   </>:reportId==='employee'?<>
    <p className="mp-notice">One row per employee, site, date and shift. Changing vehicles within a shift remains one duty. Vehicle and batch selections show the complete matching duty.</p>
    <ReportSection key={'performance-'+query} title="Shift Performance" category="manpower-performance" description={description+' · Each shift is separate; HMR is machine performance'} rows={report.performance} columns={performanceColumns} rowKey={r=>r.id} recordDateFilter={false} emptyMessage="No saved duties with a resolved employee identity match these selections."/>
   </>:<>
    <ReportSection key={'summary-'+query} title="Manpower by Category, Make & Model" category="manpower-summary" description={description+' · Distinct assets and employees within each category'} rows={report.summary} columns={summaryColumns} recordDateFilter={false} emptyMessage="No saved asset assignments in this selection. An empty batch has no manpower count."/>
    <ReportSection key={'details-'+query} title="Vehicle & Employee Assignments" category="manpower-assignments" description={description} rows={report.details} columns={detailColumns} rowKey={r=>r.id} recordDateFilter={false} emptyMessage="No saved assignments match these selections."/>
   </>}
   {reportId==='attendance'||reportId==='ot'?exceptions.length>0&&<details className="mp-notes mp-review"><summary>{exceptions.length===1?'1 saved card needs':exceptions.length+' saved cards need'} correction (list for the MIS team)</summary>{review}</details>:review}
   <details className="mp-notes"><summary>Sources and calculation rules</summary><ul>{report.notes.map(note=><li key={note}>{note}</li>)}</ul><p>Manpower requirements, shortages and relief availability are reserved for a later phase.</p></details>
  </>}
 </section>;
}
