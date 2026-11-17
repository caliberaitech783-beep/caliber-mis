import React,{useState} from 'react';
import {StepBackButton} from './step-back.jsx';
import {DateShiftGrid,dateShiftGrid,dateShiftExport,dateLine} from './date-shift-grid.jsx';
import {groupKey} from '../shared/loading-machine-report.mjs';
import {bdLines,summariseBd,machineShiftLines,MISMATCH_KINDS,KIND_LABELS,BD_TOLERANCE_MINUTES,hoursText,differenceText} from '../shared/bd-hours-report.mjs';
import './bd-hours-report.css';

// Owner, 17 Nov 2026: two tabs of the Loading machines report.
// - BD hours (Pulse + ELB): the breakdown hours of every loading machine, high to low, from Pulse (start and end of each
//   breakdown, only the part inside the shift) and from the ELB as the site typed it, side by side with the difference.
// - BD mismatch: the same machine shifts sorted by where Pulse and the ELB do not agree (more than 30 minutes apart, or a
//   breakdown on one side only, or no ELB entered), the biggest difference on top.
// Both drill down as every report does (owner's rule, 15 Nov 2026): Step 1 sites, Step 2 date by shift, Step 3 equipment
// category, Step 4 machines, Step 5 the machine's shifts, Step 6 the Pulse breakdowns of one shift with its strip.
const EVERY='*';
const blank=v=>v===null||v===undefined||v==='';
const day=date=>/^\d{4}-\d{2}-\d{2}/.test(String(date))?date.slice(8,10)+'-'+date.slice(5,7)+'-'+date.slice(2,4):date;
const column=(key,label,value,render,sortBy)=>({key,label,value:value||(r=>blank(r[key])?'—':r[key]),...(render?{render}:{}),...(sortBy?{sortValue:sortBy}:{})});
const plural=(n,one,many=one+'s')=>n+' '+(n===1?one:many);
// The keys and headings stay clear of the table's duration rule (src/duration-sort.mjs), so the lines keep their own order.
const pulseCol=column('pulseBd','Pulse BD hours',r=>hoursText(r.pulseMinutes),r=><b className="bd-hours bd-hours-pulse">{hoursText(r.pulseMinutes)}</b>,r=>r.pulseMinutes??-1);
const elbCol=column('elbBd','ELB BD hours',r=>r.elbEntered===false&&!r.total?'No ELB':hoursText(r.elbMinutes),r=>r.elbEntered===false&&!r.total?<span className="bd-kind bd-kind-brown">No ELB</span>:<b className="bd-hours">{hoursText(r.elbMinutes)}</b>,r=>r.elbMinutes??-1);
const diffCol=column('bdDifference','Difference (ELB − Pulse, h)',r=>differenceText(r.diffMinutes),r=>{const t=differenceText(r.diffMinutes);return <span className={'bd-diff'+(Math.abs(r.diffMinutes||0)>BD_TOLERANCE_MINUTES?' bd-diff-off':'')}>{t}</span>;},r=>Math.abs(r.diffMinutes??0));
const kindBadge=r=>r.kind?<span className={'bd-kind bd-kind-'+r.tone}>{r.kindLabel}</span>:'—';
const kindCol=column('kindLabel','Pulse vs ELB',r=>r.kindLabel||'—',kindBadge);
const siteColumn=manySites=>manySites?[column('site','Site')]:[];
// A coloured count of one kind: pressing it opens the next step with only those machine shifts.
const kindCount=(k,onPick)=>column(k.key,k.label,null,r=>r[k.key]>0?(onPick?<button type="button" className={'bd-count bd-'+k.tone} title={'Show only '+k.label} onClick={e=>{e.stopPropagation();onPick(r,k.key);}}>{r[k.key]}</button>:<span className={'bd-count bd-'+k.tone}>{r[k.key]}</span>):r[k.key]);
const figures=(mode,onPick)=>[pulseCol,elbCol,diffCol,column('breakdownCount','Breakdowns in Pulse'),column('mismatches','Mismatches'),...(mode==='mismatch'?MISMATCH_KINDS.map(k=>kindCount(k,onPick)):[])];
const identity={
 site:[column('site','Site'),column('bdMachineCount','Machines with BD'),column('machineShifts','Machine shifts with BD')],
 category:[column('category','Equipment category'),column('bdMachineCount','Machines with BD'),column('machineShifts','Machine shifts with BD')]
};
export const bdSummaryColumns=(group,mode,onPick)=>[...identity[group],...figures(mode,onPick)];
export function bdMachineColumns(mode,manyShifts=false,manySites=false){
 return [...(manySites?[column('sites','Site')]:[]),column('door','Door no.'),column('machineName','Machine'),column('operator','Operator'),...(manyShifts?[column('machineShifts','Shifts with BD')]:[column('statusLabel','ELB status')]),
  pulseCol,elbCol,diffCol,kindCol,column('breakdownCount','Breakdowns in Pulse'),column('pulseReasons','Reason in Pulse'),column('pulseRefs','Pulse request'),
  column('stillOpen','Still open in Pulse',r=>r.stillOpen?'Yes':'—'),column('elbBooks','ELB book no.')];
}
export const bdShiftColumns=manySites=>[column('date','Date',r=>day(r.date)),column('shift','Shift'),...siteColumn(manySites),column('statusLabel','ELB status'),
 pulseCol,elbCol,diffCol,kindCol,column('breakdownCount','Breakdowns in Pulse'),column('pulseReasons','Reason in Pulse'),column('pulseRefs','Pulse request'),
 column('stillOpen','Still open in Pulse',r=>r.stillOpen?'Yes':'—'),column('elbBooks','ELB book no.'),column('reason','ELB remark')];
const isTotal=r=>Boolean(r.total);
const lineClass=r=>r.total?'tt-total':'bd-row-'+(r.tone||'none');

// The Loading machines report hands over its strip (ShiftTimelines) and its Pulse breakdown columns, so the two files
// do not import each other.
export default function BdHoursReport({entries=[],mode='bd',period='',ReportSection,dataReady=true,pulseBreakdownsError='',ShiftTimelines=()=>null,breakdownDetailColumns=[]}){
 const [site,setSite]=useState(''),[slot,setSlot]=useState(null),[category,setCategory]=useState(null),[item,setItem]=useState(null),[line,setLine]=useState(''),[only,setOnly]=useState('');
 const mismatch=mode==='mismatch';
 const all=bdLines(entries);
 // A kind chosen (mismatch tab) keeps only those machine shifts in every step.
 const lines=only?all.filter(l=>l.kind===only):all;
 const sites=summariseBd(lines,'site',mode);
 const siteLines=!site?[]:site===EVERY?lines:lines.filter(l=>l.site===site),siteLabel=site===EVERY?'All sites':site,manySites=site===EVERY;
 const shifts=summariseBd(siteLines,'shift',mode);
 const slotLines=!site?[]:!slot?siteLines:siteLines.filter(l=>groupKey('shift',l)===slot.key);
 const categories=summariseBd(slotLines,'category',mode);
 const categoryLines=!category?[]:category.key===EVERY?slotLines:slotLines.filter(l=>groupKey('category',l)===category.key);
 const machines=summariseBd(categoryLines,'machine',mode);
 const itemLines=!item?[]:item.key===EVERY?categoryLines:categoryLines.filter(l=>groupKey('machine',l)===item.key);
 const shiftLines=machineShiftLines(itemLines,mode),opened=line?itemLines.find(l=>l.id===line)||null:null;
 const reset=()=>{setSite('');setSlot(null);setCategory(null);setItem(null);setLine('');};
 const openSite=(row,pick)=>{setSite(row.total?EVERY:row.key);setSlot(null);setCategory(null);setItem(null);setLine('');if(pick)setOnly(pick);};
 const openSlot=(row,pick)=>{setSlot(row.total?null:{key:row.key,label:day(row.date)+' · '+row.shift});setCategory(null);setItem(null);setLine('');if(pick)setOnly(pick);};
 const openCategory=(row,pick)=>{setCategory(row.total?{key:EVERY,label:'All categories'}:{key:row.key,label:row.category});setItem(null);setLine('');if(pick)setOnly(pick);};
 const openItem=row=>{setItem(row.total?{key:EVERY,label:'All machines'}:{key:row.key,label:'Machine '+row.door});setLine('');};
 const level=!site?1:!category?2:!item?3:4;
 const crumbs=[['All sites',reset],...(site?[[siteLabel,()=>{setSlot(null);setCategory(null);setItem(null);setLine('');}]]:[]),...(slot?[[slot.label,()=>{setCategory(null);setItem(null);setLine('');}]]:[]),
  ...(category?[[category.label,()=>{setItem(null);setLine('');}]]:[]),...(item?[[item.label,()=>setLine('')]]:[]),...(opened?[[day(opened.date)+' · '+opened.shift,null]]:[])];
 const back=crumbs.length>1?crumbs.at(-2)[1]:null,backTo=crumbs.length>1?'Back to '+crumbs.at(-2)[0]:'';
 const picked=(r,key)=>key&&(r.total?key===EVERY:r.key===key)?' report-row-picked':'';
 const withTotal=(rows,total)=>rows.length?[...rows,total]:[];
 const filtered=only?' · '+KIND_LABELS[only]:'';
 const slotWhere=siteLabel+' · '+(slot?slot.label:'all dates and shifts'),where=slotWhere+(category?' · '+category.label:'');
 const summaryLine=t=>t.machineShifts?`${plural(t.machineShifts,'machine shift')} of ${plural(t.bdMachineCount,'machine')} had a breakdown in Pulse or on the ELB: ${hoursText(t.pulseMinutes)} hours in Pulse, ${hoursText(t.elbMinutes)} hours on the ELB (difference ${differenceText(t.diffMinutes)} h). `
  +`${plural(t.mismatches,'machine shift')} do not agree (more than ${BD_TOLERANCE_MINUTES} minutes apart, BD on one side only, or no ELB): `+MISMATCH_KINDS.filter(k=>k.key!=='match').map(k=>`${t[k.key]} ${k.label}`).join(', ')+`; ${t.match} match.`
  :'No breakdown in Pulse or on the ELB of a loading machine in these dates and filters.';
 const chips=mismatch&&<nav className="tt-chips bd-chips" aria-label="Show only">{[['','All',all.length,''],...MISMATCH_KINDS.map(k=>[k.key,k.label,all.filter(l=>l.kind===k.key).length,'bd-'+k.tone])].map(([key,label,n,tone])=><button key={key||'all'} type="button" className={tone} aria-current={only===key?'page':undefined} onClick={()=>setOnly(key)}>{label} · {n}</button>)}</nav>;
 // Step 2: one line per date, the shifts side by side. BD hours: Pulse hours in the box, the ELB hours beside it.
 // Mismatch: the mismatches in the box, each kind as a coloured box beside it.
 const gridBoxes=mismatch?MISMATCH_KINDS.filter(k=>k.key!=='match').map(k=>({key:k.key,label:k.label,className:'bd-count bd-'+k.tone})):[{key:'elbTenths',label:'ELB BD hours',className:'bd-count bd-elbbox'}];
 const gridRows=shifts.rows.map(r=>({...r,elbTenths:Math.round(r.elbMinutes/6)/10}));
 const grid=dateShiftGrid(gridRows,{sumKeys:['machineShifts','pulseMinutes','elbMinutes','elbTenths','mismatches',...MISMATCH_KINDS.map(k=>k.key)],
  lineOf:r=>manySites?{...dateLine(r),key:r.date+'|'+r.site,label:dateLine(r).label+' · '+r.site}:dateLine(r)});
 const count=mismatch?r=>r.mismatches:r=>hoursText(r.pulseMinutes);
 const countLabel=mismatch?'Mismatches':'Pulse BD h';
 const dayColumns=[{key:'pulse',label:'Pulse BD h',value:t=>hoursText(t.pulseMinutes)},{key:'elb',label:'ELB BD h',value:t=>hoursText(t.elbMinutes)},{key:'diff',label:'Difference (h)',value:t=>differenceText(round1(t.elbMinutes-t.pulseMinutes))},{key:'mismatches',label:'Mismatches',value:t=>t.mismatches}];
 const gridExport=dateShiftExport(grid,{count,countLabel,boxes:gridBoxes,dayColumns});
 const name=mismatch?'BD mismatch':'BD hours';
 const sortWords=mismatch?'the machine shifts where Pulse and the ELB do not agree first, the biggest difference on top':'the most BD hours in Pulse on top';
 const bdRows=opened?(opened.bdRequests||[]).map((r,i)=>({...r,id:opened.id+'|bd|'+i,site:opened.site,date:opened.date,shift:opened.shift,door:opened.door,machineName:opened.machineName})):[];
 return <div className="bd-report">
  <p className="tt-insight bd-rule">{mismatch
   ?`Pulse BD hours: from the start and end of each breakdown in Pulse, only the part inside the shift (a breakdown still open counts to the end of the shift). ELB BD hours: as typed by the site. They agree when they are within ${BD_TOLERANCE_MINUTES} minutes.`
   :'Pulse BD hours: from the start and end of each breakdown in Pulse, only the part inside the shift (a breakdown still open counts to the end of the shift). ELB BD hours: “Hours in BD” as typed by the site. Difference = ELB − Pulse.'}</p>
  {pulseBreakdownsError&&<p className="tt-insight lm-pulse-note" role="status">Pulse could not be read just now ({pulseBreakdownsError}). The Pulse hours shown are the breakdowns copied onto the ELB cards when they were saved; press Refresh to read Pulse again.</p>}
  {chips}
  <nav className="tt-crumbs" aria-label="Steps">{back&&<StepBackButton onBack={back} label={backTo}/>}{crumbs.map(([label,go],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{go&&i<crumbs.length-1?<button type="button" onClick={go}>{label}</button>:<strong aria-current="step">{label}</strong>}</React.Fragment>)}</nav>
  <p className="tt-insight">{summaryLine(sites.total)}</p>
  <ReportSection key={'bd-sites-'+mode+only} reportKey={name+' sites'} dataReady={dataReady} title={'Step 1 · '+name+' · All sites · '+period+filtered} category="operations-bd-sites" description={'One line per site, '+sortWords+'. Press a site to see it date by date and shift by shift.'+(mismatch?' Press a coloured number to see only those machine shifts.':'')}
   rows={withTotal(sites.rows,sites.total)} columns={bdSummaryColumns('site',mode,mismatch?(r,k)=>openSite(r,k):null)} rowKey={r=>r.id} rowClassName={r=>(r.total?'tt-total':'')+picked(r,site)} isTotalRow={isTotal} onRowClick={r=>openSite(r)} emptyMessage="No breakdown in Pulse or on the ELB in these dates and filters."/>
  {level>=2&&<>
   <p className="tt-insight">{summaryLine(shifts.total)}</p>
   <ReportSection key={'bd-shifts-'+mode+site+only} reportKey={name+' shifts'} dataReady={dataReady} title={'Step 2 · '+name+' · '+siteLabel+' · date by shift · '+period+filtered} category="operations-bd-shifts" description={mismatch?'In each box: the machine shifts where Pulse and the ELB do not agree, then each kind in its colour (red: BD on one side only; orange: more than '+BD_TOLERANCE_MINUTES+' minutes apart; brown: no ELB). Press a box for that shift.':'In each box: the BD hours in Pulse, then the BD hours on the ELB in grey. Press a box for that shift by equipment category.'}
    rows={gridExport.rows} columns={gridExport.columns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
    <DateShiftGrid grid={grid} count={count} countLabel={countLabel} boxes={gridBoxes} dayColumns={dayColumns} onOpen={(r,b)=>openSlot(r,b)} onOpenAll={()=>openSlot(shifts.total)}
     isPicked={r=>slot?.key===r.key} pickedBox={only} allPicked={!slot} ariaLabel={name+' by date and shift'} emptyMessage="No shift with a breakdown here."/>
   </ReportSection>
   <p className="tt-insight">{summaryLine(categories.total)}</p>
   <ReportSection key={'bd-categories-'+mode+site+(slot?.key||EVERY)+only} reportKey={name+' by category'} dataReady={dataReady} title={'Step 3 · '+name+' · '+slotWhere+' · by equipment category'+filtered} category="operations-bd-categories" description={(slot?'':'Every date and shift above; press a box above for one shift only. ')+'One line per equipment category, '+sortWords+'. Press a category for its machines.'}
    rows={withTotal(categories.rows,categories.total)} columns={bdSummaryColumns('category',mode,mismatch?(r,k)=>openCategory(r,k):null)} rowKey={r=>r.id} rowClassName={r=>(r.total?'tt-total':'')+picked(r,category?.key)} isTotalRow={isTotal} onRowClick={r=>openCategory(r)} emptyMessage="No breakdown in this shift."/>
  </>}
  {level>=3&&<>
   <p className="tt-insight">{summaryLine(machines.total)}</p>
   <ReportSection key={'bd-machines-'+mode+site+(slot?.key||EVERY)+category.key+only} reportKey={name+' machines'} dataReady={dataReady} title={'Step 4 · '+name+' · '+where+filtered} category="operations-bd-machines" description={'One line per loading machine, '+sortWords+'. Pulse vs ELB: green Match, red BD on one side only, orange more than '+BD_TOLERANCE_MINUTES+' minutes apart, brown no ELB. Press a machine for its shifts.'}
    rows={withTotal(machines.rows,machines.total)} columns={bdMachineColumns(mode,!slot,manySites)} rowKey={r=>r.id} rowClassName={r=>lineClass(r)+picked(r,item?.key)} isTotalRow={isTotal} onRowClick={r=>openItem(r)} emptyMessage="No such machine here."/>
  </>}
  {level>=4&&<ReportSection key={'bd-machine-shifts-'+mode+item.key+(slot?.key||EVERY)+only} reportKey={name+' machine shifts'} dataReady={dataReady} title={'Step 5 · '+name+' · '+item.label+' · '+where+filtered} category="operations-bd-machine-shifts" description="One line per shift of the machine with a breakdown in Pulse or on the ELB. Press a line for its breakdowns in Pulse and its shift time-line."
   rows={shiftLines} columns={bdShiftColumns(manySites||item.key===EVERY)} rowKey={r=>r.id} rowClassName={r=>lineClass(r)+(opened?.id===r.id?' report-row-picked':'')} onRowClick={r=>setLine(line===r.id?'':r.id)} emptyMessage="No shift with a breakdown here."/>}
  {opened&&<>
   <ReportSection key={'bd-pulse-'+opened.id} reportKey={name+' breakdowns in Pulse'} dataReady={dataReady} showSearch={false} recordDateFilter={false} title={'Step 6 · Breakdowns in Pulse · '+opened.door+' · '+day(opened.date)+' · '+opened.shift+' · '+opened.site} category="operations-bd-pulse"
    description={`Pulse: ${hoursText(opened.pulseMinutes)} hours in this shift. ELB: ${opened.elbEntered?hoursText(opened.elbMinutes)+' hours (book '+(opened.elbBooks||'—')+', '+(opened.statusLabel||'—')+(opened.reason?', '+opened.reason:'')+')':'not entered'}. ${KIND_LABELS[opened.kind]}.`}
    rows={bdRows} columns={breakdownDetailColumns} rowKey={r=>r.id} emptyMessage="No breakdown recorded in Pulse for this shift: the hours come from the ELB only."/>
   <ShiftTimelines entries={[opened]} step="Step 6 · "/>
  </>}
 </div>;
}
const round1=n=>Math.round(n*10)/10;
