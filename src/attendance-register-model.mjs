// Attendance register (owner's request, 15 Nov 2026, from a uKnowva HRMS "Attendance Report" photo): who came, day by day
// and shift by shift, read from saved log book duties. Two views share these rules:
//  - Batch-wise: Step 1 sites, Step 2 one site date by shift (one box per batch), Step 3 that batch by equipment category
//    (owner, 16 Nov 2026, as OT & Multiple Duties), Step 4 the people of a category.
//  - Month-wise: Step 1 sites, Step 2 one site as a month grid (people down the side, days across), Step 3 one person.
// A day's code for a person at a site:
//  P1 / P2 / P3   present in Shift 1 / 2 / 3 (a saved VLB, ELB or LMV card, or a zero-trip entry, with his Employee ID)
//  P1+3, P1+2 …   two or more duties that day; the colour is the OT & Multiple Duties colour of those duties
//  TR             no duty here, but a duty at another site that day
//  A              no duty anywhere, and every shift of the site that day is locked (batch closed)
//  ?              no duty yet, and a batch of that day is still open, not created, or the shift has not ended
//  (blank)        a date after today
// The register has no weekly-off, holiday or leave list yet, so such a day shows as A once the day is locked.

export const REGISTER_VIEWS=['attendance-batch','attendance-month'];
const DIGITS={S1:'1',S2:'2',S3:'3'};
export const shiftDigit=code=>DIGITS[code]||String(code||'').replace(/^S/,'')||'?';
const byText=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true});
const nextDay=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const round=n=>Math.round(n*100)/100;
const total=values=>{const list=values.filter(v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v)));return list.length?round(list.reduce((a,b)=>a+Number(b),0)):null;};
export const percent=(part,whole)=>whole?Math.round(part*1000/whole)/10+'%':'—';
// Strongest colour first: the OT colours, then blue (present with 0 trips), then a normal duty.
const FLAG_RANK={red:0,orange:1,review:2,zero:3,normal:4};
export const strongest=flags=>flags.reduce((best,f)=>(FLAG_RANK[f]??4)<(FLAG_RANK[best]??4)?f:best,'normal');
const dutyKey=d=>[d.employeeKey,d.siteKey,d.date,d.shift].join('|');

export function registerDays(from,to){const days=[];for(let day=from;day&&day<=to&&days.length<32;day=nextDay(day))days.push(day);return days;}

// Batch state of one site, date and shift, from the server's batch list: locked, open (any stage), none (not created after
// the shift ended) or not_due (the shift has not ended yet).
const batchState=state=>state==='closed'?'locked':/_open$/.test(String(state))?'open':state==='not_due'?'not_due':'none';

// `duties`: the OT report's duty lines (all three log books). `presence`: Shift Attendance lines; an actual duty there that
// is not a duty line (a zero-trip entry without a card, or the second operator of a split card) also counts as present.
// `shifts`: the server's batch list per site, date and shift. `today` (YYYY-MM-DD, IST) blanks later dates.
export function buildAttendanceRegister({duties=[],presence=[],shifts=[],sites=[],from,to,today}){
 const lines=duties.map(d=>({...d,source:'card'})),held=new Set(lines.map(dutyKey));
 for(const p of presence){
  if(!p.actual||!p.employeeKey||!p.shift)continue;const k=dutyKey(p);if(held.has(k))continue;held.add(k);
  lines.push({id:'presence:'+k,date:p.date,shift:p.shift,site:p.site,siteKey:p.siteKey,employeeKey:p.employeeKey,employeeId:p.employeeId,caliberCode:p.caliberCode,employeeName:p.employeeName,category:'',equipment:p.equipment,doors:p.doors,makeModel:p.makeModel,logBook:'Zero-trip entry',flag:p.flag==='zero'?'zero':'normal',flagLabel:p.flagLabel||'',hours:null,trips:p.trips??0,km:null,books:'',source:'presence'});
 }
 const days=registerDays(from,to);
 const siteList=[...new Map([...sites.map(s=>[s.siteKey,s.site]),...lines.map(l=>[l.siteKey,l.site])]).entries()].map(([siteKey,site])=>({siteKey,site})).sort((a,b)=>byText(a.site,b.site));
 const batchRows=shifts.map(s=>({...s,status:batchState(s.state)}));
 const batchIndex=new Map();for(const b of batchRows){const k=b.siteKey+'|'+b.date;(batchIndex.get(k)||batchIndex.set(k,[]).get(k)).push(b);}
 // A day at a site is locked when every shift it runs that day has a closed batch.
 const dayState=(siteKey,date)=>{
  if(today&&date>today)return 'future';
  const list=batchIndex.get(siteKey+'|'+date)||[];
  return list.length&&list.every(b=>b.status==='locked')?'locked':'pending';
 };
 const linesBy=new Map();for(const l of lines){const k=l.employeeKey+'|'+l.date;(linesBy.get(k)||linesBy.set(k,[]).get(k)).push(l);}
 // One person's day at one site.
 const dayOf=(person,siteKey,date)=>{
  const all=linesBy.get(person.employeeKey+'|'+date)||[],here=all.filter(l=>l.siteKey===siteKey).sort((a,b)=>byText(a.shift,b.shift));
  if(here.length)return {date,code:'P'+here.map(l=>shiftDigit(l.shift)).join('+'),kind:'present',flag:strongest(here.map(l=>l.flag)),lines:here,shifts:here.map(l=>l.shift)};
  const away=all.filter(l=>l.siteKey!==siteKey);
  if(away.length)return {date,code:'TR',kind:'away',flag:'',lines:away,where:[...new Set(away.map(l=>l.site))].join(', ')};
  const state=dayState(siteKey,date);
  return state==='future'?{date,code:'',kind:'future',flag:'',lines:[]}:state==='locked'?{date,code:'A',kind:'absent',flag:'',lines:[]}:{date,code:'?',kind:'pending',flag:'',lines:[]};
 };
 const shiftCodes=[...new Set(['S1','S2','S3',...lines.map(l=>l.shift)])].sort(byText);
 const register=siteKey=>{
  const here=lines.filter(l=>l.siteKey===siteKey);
  const people=[...new Map(here.map(l=>[l.employeeKey,l])).values()].map(l=>{
   const latest=here.filter(x=>x.employeeKey===l.employeeKey).sort((a,b)=>byText(b.date,a.date))[0];
   const person={employeeKey:l.employeeKey,employeeId:latest.employeeId,caliberCode:latest.caliberCode||latest.employeeId,employeeName:latest.employeeName,category:here.find(x=>x.employeeKey===l.employeeKey&&x.category)?.category||''};
   const cells=days.map(date=>dayOf(person,siteKey,date)),mine=cells.flatMap(c=>c.kind==='present'?c.lines:[]);
   const count=kind=>cells.filter(c=>c.kind===kind).length,present=count('present'),absent=count('absent');
   return {...person,id:siteKey+'|'+l.employeeKey,cells,duties:mine.length,shiftCounts:Object.fromEntries(shiftCodes.map(s=>[s,mine.filter(m=>m.shift===s).length])),
    double:cells.filter(c=>c.kind==='present'&&c.lines.length>1).length,present,absent,pending:count('pending'),away:count('away'),
    attendance:percent(present,present+absent),hours:total(mine.map(m=>m.hours)),trips:total(mine.map(m=>m.trips)),km:total(mine.map(m=>m.km)),lines:mine};
  }).sort((a,b)=>byText(a.employeeName,b.employeeName)||byText(a.caliberCode,b.caliberCode));
  return people;
 };
 const registers=new Map(siteList.map(s=>[s.siteKey,register(s.siteKey)]));
 const tally=(people,siteKeys)=>{
  const batches=batchRows.filter(b=>siteKeys.includes(b.siteKey)),due=batches.filter(b=>b.status!=='not_due'&&(!today||b.date<=today));
  const sum=key=>people.reduce((n,p)=>n+p[key],0),present=sum('present'),absent=sum('absent');
  return {people:people.length,duties:sum('duties'),...Object.fromEntries(shiftCodes.map(s=>[s,people.reduce((n,p)=>n+p.shiftCounts[s],0)])),double:sum('double'),present,absent,pending:sum('pending'),
   locked:due.filter(b=>b.status==='locked').length,due:due.length,attendance:percent(present,present+absent)};
 };
 const siteRows=siteList.map(s=>({id:s.siteKey,siteKey:s.siteKey,site:s.site,...tally(registers.get(s.siteKey),[s.siteKey])}));
 // People are counted once per site, so a person who worked at two sites is in both lines and twice in All sites.
 const allSites={id:'all-sites',siteKey:'',site:'All sites',...tally([...registers.values()].flat(),siteList.map(s=>s.siteKey))};
 // Step 2 of the batch-wise view: one line per batch (site, date and shift) with the people present and the colours.
 const batchLines=siteKey=>{
  const people=registers.get(siteKey)||[],here=lines.filter(l=>l.siteKey===siteKey);
  const rows=batchRows.filter(b=>b.siteKey===siteKey).map(b=>({...b}));
  for(const l of here)if(!rows.some(r=>r.date===l.date&&r.shift===l.shift))rows.push({siteKey,date:l.date,shift:l.shift,state:'',status:'none',batch:''});
  return rows.map(r=>{
   const list=here.filter(l=>l.date===r.date&&l.shift===r.shift),who=new Set(list.map(l=>l.employeeKey));
   const cellOf=p=>p.cells[days.indexOf(r.date)];
   const marked=people.filter(p=>who.has(p.employeeKey)).map(cellOf).filter(Boolean);
   return {id:siteKey+'|'+r.date+'|'+r.shift,siteKey,date:r.date,shift:r.shift,status:r.status,batch:r.batch,present:who.size,
    double:marked.filter(c=>c.lines.length>1).length,red:marked.filter(c=>c.flag==='red').length,orange:marked.filter(c=>c.flag==='orange').length,review:marked.filter(c=>c.flag==='review').length,zero:marked.filter(c=>c.flag==='zero').length};
  }).sort((a,b)=>byText(a.date,b.date)||byText(a.shift,b.shift));
 };
 // The people of one site on one date: day totals for the date by shift table and the list under Step 3.
 const dayPeople=(siteKey,date)=>{const i=days.indexOf(date);return (registers.get(siteKey)||[]).map(p=>({person:p,cell:p.cells[i]})).filter(x=>x.cell);};
 return {days,sites:siteList,siteRows,allSites,shiftCodes,register:siteKey=>registers.get(siteKey)||[],batchLines,dayPeople,dayState};
}

// The equipment category of a duty: its machine's group in the Equipment master, as OT & Multiple Duties names it.
export const NO_CATEGORY='Group missing in master';
// Step 4 of the batch-wise view: the people present in one shift, one line each (a person on two machines is one line).
// `categories`: the equipment categories the person worked in that shift.
export function batchPeople(register,{siteKey,date,shift}){
 const i=register.days.indexOf(date);
 return register.register(siteKey).flatMap(p=>{const cell=p.cells[i];if(!cell||cell.kind!=='present'||!cell.shifts.includes(shift))return [];
  const list=cell.lines.filter(l=>l.shift===shift);
  return [{id:p.id+'|'+date+'|'+shift,employeeKey:p.employeeKey,caliberCode:p.caliberCode,employeeName:p.employeeName,category:p.category||'—',categories:[...new Set(list.map(l=>String(l.equipment||'').trim()||NO_CATEGORY))],logBook:[...new Set(list.map(l=>l.logBook))].join(' + '),doors:[...new Set(list.map(l=>l.doors).filter(Boolean))].join('; '),equipment:[...new Set(list.map(l=>l.equipment).filter(Boolean))].join('; '),
   hours:total(list.map(l=>l.hours)),trips:total(list.map(l=>l.trips)),km:total(list.map(l=>l.km)),code:cell.code,flag:cell.flag,flagLabel:cell.lines.length>1?[...new Set(cell.lines.map(l=>l.flagLabel).filter(Boolean))].join('; ')||'Two duties this day':list[0].flagLabel||'Normal duty',books:list.map(l=>l.books).filter(Boolean).join('; ')}];});
}

// Step 3 of the batch-wise view: the people of one shift (from batchPeople) by equipment category, most people first, then
// All categories. A person who worked machines of two categories in the shift is in both lines and once in All categories.
// The colours are the person's day colour, as in the Step 2 boxes.
export function batchCategories(people){
 const groups=new Map();
 for(const p of people)for(const name of p.categories){if(!groups.has(name))groups.set(name,[]);groups.get(name).push(p);}
 const line=(id,equipment,list)=>({id,equipment,present:list.length,double:list.filter(p=>p.code.includes('+')).length,
  red:list.filter(p=>p.flag==='red').length,orange:list.filter(p=>p.flag==='orange').length,review:list.filter(p=>p.flag==='review').length,zero:list.filter(p=>p.flag==='zero').length});
 const rows=[...groups].map(([name,list])=>line(name,name,list)).sort((a,b)=>b.present-a.present||byText(a.equipment,b.equipment));
 return {rows,total:line('*','All categories',people)};
}

// Month-wise Step 2 (owner, 16 Nov 2026): the people of a site's register by equipment category. A person belongs to every
// category of the machines they worked in these dates, so they are in each of those lines and once in All categories. Duties are
// the duties on that category; days present, absent and pending are the person's own days, as in the register.
const categoryOf=line=>String(line.equipment||'').trim()||NO_CATEGORY;
export const personCategories=person=>[...new Set(person.lines.map(categoryOf))];
export function registerCategories(people){
 const groups=new Map();
 for(const p of people)for(const name of personCategories(p)){if(!groups.has(name))groups.set(name,[]);groups.get(name).push(p);}
 const line=(id,equipment,list,duties)=>{const sum=key=>list.reduce((n,p)=>n+p[key],0),present=sum('present'),absent=sum('absent');
  return {id,equipment,people:list.length,duties,double:sum('double'),present,absent,pending:sum('pending'),attendance:percent(present,present+absent)};};
 const rows=[...groups].map(([name,list])=>line(name,name,list,list.reduce((n,p)=>n+p.lines.filter(l=>categoryOf(l)===name).length,0)))
  .sort((a,b)=>b.people-a.people||byText(a.equipment,b.equipment));
 return {rows,total:line('*','All categories',people,people.reduce((n,p)=>n+p.duties,0))};
}
