import React,{useMemo,useState} from 'react';
import {DateShiftGrid,dateShiftGrid,dateShiftExport} from './date-shift-grid.jsx';
import {StepBackButton} from './step-back.jsx';
import {buildAttendanceRegister,batchPeople,batchCategories,registerCategories,personCategories} from './attendance-register-model.mjs';
import './attendance-register.css';

// Attendance Batch-wise and Attendance Month-wise (owner, 15 Nov 2026): the uKnowva-style attendance report built from
// saved log book duties. Caliber ID and Name always sit side by side. The rules are in attendance-register-model.mjs.
const todayIst=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shortDate=date=>date?date.slice(8,10)+'-'+date.slice(5,7)+'-'+date.slice(2,4):'';
const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const weekday=date=>WEEKDAYS[new Date(date+'T00:00:00Z').getUTCDay()];
const shiftName=code=>({S1:'Shift 1',S2:'Shift 2',S3:'Shift 3',D:'Day shift',N:'Night shift'})[code]||code;
const STATUS={locked:'Locked',open:'Batch open',none:'No batch',not_due:'Shift not ended'};
const many=(n,word)=>n+' '+word+(n===1?'':'s');
const blank=v=>v===null||v===undefined||v==='';
const shown=v=>blank(v)?'—':v;
// The OT & Multiple Duties colours, then blue for present with 0 trips.
const COLOURS=[['red','Red','Back-to-back shifts, or all three shifts'],['orange','Orange','Shift 1 and Shift 3 with a gap'],['review','Brown','Shift pattern needs review'],['zero','Blue','Present with 0 trips']];
export const CODE_LEGEND=[['P1 / P2 / P3','Present in Shift 1 / 2 / 3 (saved card)','present'],['P1+3','Two duties in one day; colour as in OT & Multiple Duties','double'],['A','Absent: no card anywhere, every batch of the day locked','absent'],['?','Pending: a batch of the day is open, not created or the shift has not ended','pending'],['TR','Worked at another site that day','away']];
const cols=list=>list.map(([key,label,value])=>({key,label,value:value||(r=>shown(r[key]))}));

function Legend(){
 return <div className="ar-legend" aria-label="Codes">{CODE_LEGEND.map(([code,meaning,kind])=><span key={code} className={'ar-legend-item ar-'+kind}><b>{code}</b> {meaning}</span>)}
  {COLOURS.slice(0,2).map(([id,name,meaning])=><span key={id} className={'ar-legend-item ar-present ar-flag-'+id}><b>{name}</b> {meaning}</span>)}</div>;
}

export default function AttendanceRegister({report,filters,mode='attendance-batch',ReportSection,sites=[],query=''}){
 const [siteKey,setSiteKey]=useState(''),[pick,setPick]=useState({date:'',shift:''}),[personKey,setPersonKey]=useState('');
 // The equipment category opened ('*' for all of them): batch-wise Step 3, month-wise Step 2; kept after the other state.
 const [equipment,setEquipment]=useState('');
 const today=todayIst();
 const model=useMemo(()=>buildAttendanceRegister({duties:report.otDuties||[],presence:report.attendanceEquipment||[],shifts:report.attendanceShifts||[],sites,from:filters.from,to:filters.to,today}),[report,sites,filters.from,filters.to,today]);
 const month=mode==='attendance-month';
 const allowed=new Set(sites.map(s=>s.siteKey));
 const siteRows=model.siteRows.filter(s=>!sites.length||allowed.has(s.siteKey));
 // Only one site: it opens by itself.
 const open=siteRows.length===1?siteRows[0].siteKey:siteRows.some(s=>s.siteKey===siteKey)?siteKey:'';
 const site=siteRows.find(s=>s.siteKey===open);
 const register=open?model.register(open):[];
 // Month-wise: the register of the equipment category opened (a person on two categories is in both).
 const people=month&&equipment&&equipment!=='*'?register.filter(p=>personCategories(p).includes(equipment)):register;
 const dateLabel=filters.from!==filters.to?shortDate(filters.from)+' to '+shortDate(filters.to):shortDate(filters.from);
 const openSite=key=>{setSiteKey(siteKey===key&&siteRows.length>1?'':key);setPick({date:'',shift:''});setPersonKey('');setEquipment('');};
 const closeBatch=()=>{setPick({date:'',shift:''});setPersonKey('');setEquipment('');};
 const level=!open?1:month?(!equipment?2:people.some(p=>p.employeeKey===personKey)?4:3):!(pick.date&&pick.shift)?2:equipment?4:3;
 const back=month?(level===4?()=>setPersonKey(''):level===3?closeBatch:level===2&&siteRows.length>1?()=>openSite(open):null)
  :level===4?()=>setEquipment(''):level===3?closeBatch:level===2&&siteRows.length>1?()=>openSite(open):null;
 const equipmentLabel=equipment==='*'?'All categories':equipment;

 // Step 1: one line per site, then All sites.
 const shiftCols=model.shiftCodes.map(code=>[code,shiftName(code)]);
 const siteColumns=cols([['site','Site'],['people','People'],['duties','Duties'],...shiftCols,['double','Double-duty days'],['present','Days present'],['absent','Absent (A)'],['pending','Pending (?)'],['locked','Batches locked',r=>r.locked+' of '+r.due],['attendance','Attendance %']]);
 const step1=<ReportSection key={'ar-sites-'+query+'-'+mode} title={'Step 1 · All sites · '+dateLabel} category="attendance-sites"
  description="One line per site. People are those with at least one saved duty at the site in these dates. Days present and Absent are person-days; Attendance % = days present ÷ (days present + absent). Press a site to open it."
  rows={siteRows.length>1?[...siteRows,{...model.allSites,id:'all-sites'}]:siteRows} columns={siteColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}
  isTotalRow={r=>r.id==='all-sites'} onRowClick={r=>r.siteKey&&openSite(r.siteKey)} rowClassName={r=>(r.id==='all-sites'?'mp-att-total':'')+(r.siteKey&&r.siteKey===open?' report-row-picked':'')} emptyMessage="No site is available for these selections."/>;

 const trail=open&&<p className="mp-trail" aria-label="Where you are">{back&&<StepBackButton onBack={back}/>}{siteRows.length>1&&<><button type="button" onClick={()=>openSite(open)}>All sites</button><span>›</span></>}<button type="button" onClick={closeBatch}>{site?.site}</button>
  {month?<>
   {level===3&&<><span>›</span><strong>{equipmentLabel}</strong></>}
   {level===4&&<><span>›</span><button type="button" onClick={()=>setPersonKey('')}>{equipmentLabel}</button><span>›</span><strong>{people.find(p=>p.employeeKey===personKey)?.employeeName}</strong></>}
  </>:<>
   {level===3&&<><span>›</span><strong>{shortDate(pick.date)+' · '+shiftName(pick.shift)}</strong></>}
   {level===4&&<><span>›</span><button type="button" onClick={()=>setEquipment('')}>{shortDate(pick.date)+' · '+shiftName(pick.shift)}</button><span>›</span><strong>{equipmentLabel}</strong></>}
  </>}</p>;

 return <div className="ar-register">
  <p className="mp-notice">{month?'Month-wise attendance: site, then its people by equipment category, then one line per person, one column per day.':'Batch-wise attendance: site, then date by shift (one box per batch), then that batch by equipment category, then the people of a category.'} Read from saved VLB, ELB and LMV cards and zero-trip entries. Weekly off, holidays and leave are not in the system yet, so such a day shows as A once the day is locked.</p>
  <Legend/>
  {trail}
  {step1}
  {open&&(month?monthSteps():batchSteps())}
 </div>;

 function batchSteps(){
  const lines=model.batchLines(open);
  const grid=dateShiftGrid(lines.map(r=>({...r,shiftCount:1,lockedCount:r.status==='locked'?1:0})),{sumKeys:['present','double','shiftCount','lockedCount']});
  const day=new Map(model.days.map(date=>{const list=model.dayPeople(open,date),n=kind=>list.filter(x=>x.cell.kind===kind).length;return [date,{present:n('present'),absent:n('absent'),pending:n('pending'),away:n('away')}];}));
  const dayTotal=key=>[...day.values()].reduce((s,d)=>s+d[key],0);
  const dayColumns=[['present','People present'],['absent','Absent (A)'],['pending','Pending (?)'],['away','At another site (TR)']].map(([key,label])=>({key,label,value:(t,line)=>line&&day.has(line.key)?day.get(line.key)[key]:dayTotal(key)}));
  const choose=r=>{setPick(pick.date===r.date&&pick.shift===r.shift?{date:'',shift:''}:{date:r.date,shift:r.shift});setEquipment('');};
  const cell=(list,where)=>{const r=list[0],on=pick.date===r.date&&pick.shift===r.shift;
   return <span className="dsg-cell">
    <button type="button" className={'dsg-count ar-batch ar-batch-'+r.status} aria-pressed={on} aria-label={many(r.present,'person')+' present · '+where+' · '+STATUS[r.status]} onClick={()=>choose(r)}>{r.present}</button>
    {COLOURS.map(([id,name])=>r[id]>0?<button key={id} type="button" className={'dsg-box mp-flag mp-flag-'+id} title={name} aria-label={r[id]+' '+name+' · '+where} onClick={()=>choose(r)}>{r[id]}</button>:null)}
    <small className={'dsg-note ar-state ar-state-'+r.status}>{STATUS[r.status]}</small>
   </span>;};
  const flat=dateShiftExport(grid,{shiftLabel:shiftName,cellText:list=>list[0]?list[0].present+' present · '+STATUS[list[0].status]:'',dayColumns});
  const step2=<ReportSection key={'ar-dates-'+query+'-'+open} title={'Step 2 · '+site.site+' · date by shift · '+dateLabel} category="attendance-dates"
   description="In each box: the people present in that batch, the colours among them, and the batch state. Press a box to see that batch by equipment category."
   rows={flat.rows} columns={flat.columns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
   <DateShiftGrid grid={grid} renderCell={cell} dayColumns={dayColumns} shiftLabel={shiftName} isPicked={r=>r.date===pick.date&&r.shift===pick.shift} ariaLabel="People present by date and shift" emptyMessage="No shift in these dates."/>
  </ReportSection>;
  if(level<3)return <>{step2}<p className="mp-notice">Press a box in the date table to see that batch by equipment category, then a category for the people present, and who was absent or pending that day.</p></>;
  const present=batchPeople(model,{siteKey:open,date:pick.date,shift:pick.shift});
  const batch=lines.find(r=>r.date===pick.date&&r.shift===pick.shift);
  const batchWhere=site.site+' · '+shortDate(pick.date)+' · '+shiftName(pick.shift);
  // Step 3: the batch by equipment category; a line opens its people as Step 4.
  const categories=batchCategories(present);
  const flagBox=(id,name)=>r=>r[id]>0?<span className={'dsg-box mp-flag mp-flag-'+id} title={name}>{r[id]}</span>:r[id];
  const categoryColumns=[...cols([['equipment','Equipment category'],['present','People present'],['double','Double duty (P1+3)']]),
   ...COLOURS.map(([id,name])=>({key:id,label:name,value:r=>r[id],render:flagBox(id,name)}))];
  const step3=<ReportSection key={'ar-categories-'+query+'-'+open+'-'+pick.date+'-'+pick.shift} title={'Step 3 · '+batchWhere+' · by equipment category'} category="attendance-categories"
   description={many(present.length,'person')+' present · Batch '+(batch?.batch||'not created')+' · '+STATUS[batch?.status||'none']+' · One line per equipment category (the machine’s group in the Equipment master); a person on machines of two categories is in both. Press a category for its people.'}
   rows={present.length?[...categories.rows,categories.total]:[]} columns={categoryColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}
   isTotalRow={r=>r.id==='*'} onRowClick={r=>setEquipment(equipment===r.id?'':r.id)} rowClassName={r=>(r.id==='*'?'mp-att-total':'')+(r.id===equipment?' report-row-picked':'')} emptyMessage="Nobody has a saved duty in this batch."/>;
  const listed=level===4?present.filter(p=>equipment==='*'||p.categories.includes(equipment)):[];
  const missing=model.dayPeople(open,pick.date).filter(x=>x.cell.kind!=='present').map(({person,cell})=>{const last=person.lines.filter(l=>l.date<pick.date).map(l=>l.date).sort().at(-1);
   return {id:person.id,caliberCode:person.caliberCode,employeeName:person.employeeName,category:person.category||'—',code:cell.code,meaning:cell.kind==='absent'?'Absent':cell.kind==='pending'?'Pending':'At '+cell.where,last:last?shortDate(last):'—'};});
  const peopleColumns=cols([['caliberCode','Caliber ID'],['employeeName','Name'],['category','Category'],['logBook','Log book'],['doors','Door / equipment'],['equipment','Equipment'],['hours','HMR hours'],['trips','Trips'],['km','KM'],['code','Day code'],['flagLabel','Colour / reason'],['books','Saved cards']]);
  return <>{step2}{step3}
   {level===4?<ReportSection key={'ar-people-'+query+'-'+open+'-'+pick.date+'-'+pick.shift+'-'+equipment} title={'Step 4 · '+batchWhere+' · '+equipmentLabel+' · people'} category="attendance-people"
    description={many(listed.length,'person')+' present · '+equipmentLabel+' · Batch '+(batch?.batch||'not created')+' · '+STATUS[batch?.status||'none']+' · Day code is the whole day: P1+3 means Shift 1 and Shift 3.'}
    rows={listed} columns={peopleColumns} rowKey={r=>r.id} rowClassName={r=>'mp-duty-'+r.flag} showSearch={false} recordDateFilter={false} emptyMessage="Nobody of this category has a saved duty in this batch."/>
    :<p className="mp-notice">Press a category above, or All categories, to list its people.</p>}
   <ReportSection key={'ar-missing-'+query+'-'+open+'-'+pick.date} title={site.site+' · '+shortDate(pick.date)+' · not on any card here that day'} category="attendance-not-present"
    description="People of this site with no duty here on this date: A when every batch of the day is locked, ? while one is open or missing, TR when they worked at another site."
    rows={missing} columns={cols([['caliberCode','Caliber ID'],['employeeName','Name'],['category','Category'],['code','Code'],['meaning','Meaning'],['last','Last duty here before this date']])} rowKey={r=>r.id} recordDateFilter={false} emptyMessage="Everyone of this site worked here that day."/>
  </>;
 }

 function monthSteps(){
  const days=model.days;
  const totals=[['duties','Duties'],...model.shiftCodes.map(code=>[code,shiftName(code).replace('Shift ','S')]),['double','Double'],['present','Days present'],['absent','A'],['pending','?'],['away','TR'],['attendance','Att. %'],['hours','HMR hours'],['trips','Trips'],['km','KM']];
  const valueOf=(p,key)=>model.shiftCodes.includes(key)?p.shiftCounts[key]:p[key];
  const exportColumns=[{key:'caliberCode',label:'Caliber ID',value:p=>p.caliberCode},{key:'employeeName',label:'Name',value:p=>p.employeeName},{key:'category',label:'Category',value:p=>p.category||'—'},
   ...days.map((d,i)=>({key:'d'+d,label:d.slice(8,10)+' '+weekday(d),value:p=>p.cells[i].code})),...totals.map(([key,label])=>({key,label,value:p=>shown(valueOf(p,key))}))];
  const presentOn=i=>people.filter(p=>p.cells[i].kind==='present').length;
  const tip=c=>c.kind==='present'?c.lines.map(l=>shiftName(l.shift)+' · '+[l.doors,l.equipment,l.logBook].filter(Boolean).join(' · ')+(blank(l.hours)?'':' · '+l.hours+' h')+(blank(l.trips)?'':' · '+l.trips+' trips')).join('\n')+(c.lines[0]?.flagLabel&&c.flag!=='normal'?'\n'+[...new Set(c.lines.map(l=>l.flagLabel))].join('; '):''):c.kind==='away'?'Worked at '+c.where:c.kind==='absent'?'Absent: no saved card, day locked':c.kind==='pending'?'Pending: a batch of this day is open, not created or not ended':'';
  const sum=key=>{const values=people.map(p=>valueOf(p,key)).filter(v=>!blank(v)&&typeof v==='number');return values.length?Math.round(values.reduce((a,b)=>a+b,0)*100)/100:'—';};
  // Step 2 (owner, 16 Nov 2026): the site's people by equipment category; a line opens its month-wise register as Step 3.
  const categories=registerCategories(register);
  const categoryColumns=cols([['equipment','Equipment category'],['people','People'],['duties','Duties'],['double','Double-duty days'],['present','Days present'],['absent','Absent (A)'],['pending','Pending (?)'],['attendance','Attendance %']]);
  const shownCategory=equipment==='*'?categories.total:categories.rows.find(c=>c.id===equipment);
  const step2=<ReportSection key={'ar-month-categories-'+query+'-'+open} title={'Step 2 · '+site.site+' · by equipment category · '+dateLabel} category="attendance-month-categories"
   description="One line per equipment category (the machine’s group in the Equipment master). People are those with a duty on that category in these dates; a person on two categories is in both. Duties are on that category; days present, absent and pending are the person’s own days. Press a category for its month-wise register."
   rows={register.length?[...categories.rows,categories.total]:[]} columns={categoryColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}
   isTotalRow={r=>r.id==='*'} onRowClick={r=>{setEquipment(equipment===r.id?'':r.id);setPersonKey('');}} rowClassName={r=>(r.id==='*'?'mp-att-total':'')+(r.id===equipment?' report-row-picked':'')} emptyMessage="No saved duty at this site in these dates."/>;
  if(!equipment)return <>{step2}<p className="mp-notice">Press a category above, or All categories, for its month-wise register.</p></>;
  const step3=<ReportSection key={'ar-month-'+query+'-'+open+'-'+equipment} title={'Step 3 · '+site.site+' · '+equipmentLabel+' · month-wise register · '+dateLabel} category="attendance-month"
   description={many(people.length,'person')+' · Press a name for that person’s duties. Hover a day for the shift, door, hours and trips. Sundays are shaded.'}
   rows={people} columns={exportColumns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
   {people.length?<div className="ar-grid-wrap" role="group" aria-label="Month-wise register">
    <table className="ar-grid">
     <thead><tr><th scope="col" className="ar-sticky ar-id">Caliber ID</th><th scope="col" className="ar-sticky ar-name">Name</th>
      {days.map(d=><th key={d} scope="col" className={'ar-day'+(weekday(d)==='Sun'?' ar-sunday':'')+(d>today?' ar-later':'')}>{d.slice(8,10)}<small>{weekday(d).slice(0,2)}</small></th>)}
      {totals.map(([key,label])=><th key={key} scope="col" className="ar-total-head">{label}</th>)}</tr></thead>
     <tbody>{people.map(p=><tr key={p.id} className={personKey===p.employeeKey?'report-row-picked':undefined}>
      <td className="ar-sticky ar-id">{p.caliberCode}</td>
      <th scope="row" className="ar-sticky ar-name"><button type="button" className="mp-cat-open" aria-pressed={personKey===p.employeeKey} aria-label={'Duties of '+p.employeeName} onClick={()=>setPersonKey(personKey===p.employeeKey?'':p.employeeKey)}>{p.employeeName}</button>{p.category&&<small>{p.category}</small>}</th>
      {p.cells.map((c,i)=><td key={days[i]} className={'ar-code ar-'+c.kind+(c.flag?' ar-flag-'+c.flag:'')+(weekday(days[i])==='Sun'?' ar-sunday':'')} title={tip(c)||undefined}>{c.code}</td>)}
      {totals.map(([key])=><td key={key} className={'ar-total'+(key==='absent'&&p.absent?' ar-total-absent':'')+(key==='double'&&p.double?' ar-total-double':'')}>{shown(valueOf(p,key))}</td>)}
     </tr>)}</tbody>
     <tfoot><tr className="ar-foot"><td className="ar-sticky ar-id"></td><th scope="row" className="ar-sticky ar-name">Present that day</th>{days.map((d,i)=><td key={d} className="ar-code">{d>today?'':presentOn(i)}</td>)}
      {totals.map(([key])=><td key={key} className="ar-total">{key==='attendance'?(shownCategory?.attendance??site.attendance):sum(key)}</td>)}</tr></tfoot>
    </table>
   </div>:<p>No saved duty for this category in these dates.</p>}
  </ReportSection>;
  const person=people.find(p=>p.employeeKey===personKey);
  if(!person)return <>{step2}{step3}</>;
  const dutyColumns=cols([['date','Date',r=>shortDate(r.date)],['shift','Shift',r=>shiftName(r.shift)],['logBook','Log book'],['doors','Door / equipment'],['equipment','Equipment'],['hours','HMR hours'],['trips','Trips'],['km','KM'],['flagLabel','Colour / reason'],['books','Saved cards']]);
  return <>{step2}{step3}
   <ReportSection key={'ar-person-'+query+'-'+open+'-'+person.employeeKey} title={'Step 4 · '+person.caliberCode+' · '+person.employeeName+' · duties at '+site.site} category="attendance-person"
    description={[person.category,person.duties+(person.duties===1?' duty':' duties'),person.present+' days present',person.absent+' absent',person.attendance+' attendance'].filter(Boolean).join(' · ')}
    rows={[...person.lines].sort((a,b)=>a.date.localeCompare(b.date)||a.shift.localeCompare(b.shift))} columns={dutyColumns} rowKey={r=>r.id} rowClassName={r=>'mp-duty-'+r.flag} showSearch={false} recordDateFilter={false} emptyMessage="No duty in these dates."/>
  </>;
 }
}
