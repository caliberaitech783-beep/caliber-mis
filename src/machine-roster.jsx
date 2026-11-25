// Machine Roster (owner, 25 Nov 2026): Masters, under Machine Category Re-check. The site-wise list of every vehicle and
// equipment the Equipment Master puts at a site, by book: VLB (Vehicle), ELB (Equipment) and LMV. The figures are the
// machines a batch of the site has to answer for (the batch page's machine coverage reads the same rule).
//
// Drawn in the owner's report steps: Step 1 one line per site, every figure opens Step 2 under it with those machines.
// The roster has no dates, so there is no date by shift step. Read only: a machine is changed in Pulse.
// Rule: shared/machine-roster.mjs; route GET /api/caliber-recheck/roster.
import React,{useEffect,useRef,useState} from 'react';
import {ROSTER_VIEWS,machinesOf} from '../shared/machine-roster.mjs';
import './caliber-recheck.css';

const count=value=>Number(value||0).toLocaleString('en-IN');
const isTotal=row=>Boolean(row.total);
const EVERY='*';

export default function MachineRoster({session,ReportSection}){
 const [roster,setRoster]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [open,setOpen]=useState({site:'',view:''});
 const run=useRef(0);
 const load=async()=>{
  const mine=++run.current;setBusy(true);setError('');
  try{
   const response=await fetch('/api/caliber-recheck/roster',{headers:{Authorization:`Bearer ${session.token}`}});
   const answer=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(answer.error||'The machine roster is unavailable.');
   if(run.current===mine)setRoster(answer);
  }catch(e){if(run.current===mine)setError(e.message);}
  finally{if(run.current===mine)setBusy(false);}
 };
 useEffect(()=>{void load();return()=>{run.current++};},[]);

 const sites=roster?.sites||[],total=roster?.total,machines=roster?.machines||[];
 const {site,view}=open,viewInfo=ROSTER_VIEWS.find(one=>one.key===view);
 const siteLabel=site===EVERY?'All sites':sites.find(row=>row.key===site)?.site||'';
 const listed=site?machinesOf(machines,site,view):[];
 const figure=key=>row=>row[key]>0?<button type="button" className={'cr-figure'+(site===row.key&&view===key?' cr-figure-picked':'')} title={'Open: '+ROSTER_VIEWS.find(one=>one.key===key).label}
  onClick={event=>{event.stopPropagation();setOpen({site:row.key,view:key});}}>{count(row[key])}</button>:count(row[key]);
 const siteColumns=[{key:'site',label:'Site',value:row=>row.site},...ROSTER_VIEWS.map(one=>({key:one.key,label:one.label,value:row=>row[one.key],render:figure(one.key)}))];
 const machineColumns=[...(site===EVERY?[{key:'site',label:'Site',value:m=>m.site}]:[]),
  {key:'door',label:'Door / registration',value:m=>m.door,render:m=><><strong>{m.door}</strong>{m.registration&&m.registration!==m.door&&<small className="cr-sub">{m.registration}</small>}</>},
  {key:'book',label:'Book',value:m=>m.bookLabel},
  {key:'name',label:'Equipment name',value:m=>m.name},
  {key:'category',label:'Equipment category',value:m=>m.category||'Not set',render:m=>m.categorySet?m.category:<small className="cr-sub">{m.category||'Not set'} · judged {m.bookLabel} by group</small>},
  {key:'group',label:'Equipment group',value:m=>m.group},
  {key:'make',label:'Make · model',value:m=>[m.make,m.model].filter(Boolean).join(' · ')},
  {key:'status',label:'Equipment status',value:m=>m.status}];

 return <section className="caliber-recheck">
  <header className="cr-head">
   <div><h1>Machine Roster</h1>
    <p>Every vehicle and equipment the Equipment Master puts at each site, by book: a VLB takes a Vehicle, an ELB an Equipment, an LMV an LMV. These are the machines every batch of the site has to answer for (a card, Pulse-1 breakdown or an idle reason). A machine is moved or changed in Pulse; this page only reads.</p></div>
   <button type="button" disabled={busy} onClick={()=>void load()}>{busy?'Reading…':'Refresh'}</button>
  </header>
  {error&&<p className="cr-error" role="alert">{error}</p>}
  {total&&<div className="cr-summary" aria-label="Summary">
   <span><strong>{count(total.all)}</strong> active machines</span><span><strong>{count(total.vlb)}</strong> VLB</span><span><strong>{count(total.elb)}</strong> ELB</span>
   <span><strong>{count(total.lmv)}</strong> LMV</span><span><strong>{count(total.unset)}</strong> category not set</span><span><strong>{count(total.inactive)}</strong> not active</span>
  </div>}
  <ReportSection key="roster-sites" reportKey="Machine roster sites" title="Step 1 · Machine roster · All sites" category="machine-roster-sites" dataReady={!busy} recordDateFilter={false}
   description="One line per site: its active VLB, ELB and LMV machines in the Equipment Master. Press a figure for those machines; the All sites line opens every site together."
   rows={sites.length&&total?[...sites,total]:[]} columns={siteColumns} rowKey={row=>row.key} rowClassName={row=>(row.total?'tt-total':'')+(site&&row.key===site?' report-row-picked':'')} isTotalRow={isTotal}
   onRowClick={row=>setOpen({site:row.key,view:'all'})} emptyMessage={busy?'Reading the Equipment Master…':'No machine at your sites in the Equipment Master.'}/>
  {site&&viewInfo&&<ReportSection key={'roster-machines-'+site+'|'+view} reportKey="Machine roster machines" title={'Step 2 · Machine roster · '+siteLabel+' · '+viewInfo.label} category="machine-roster-machines" dataReady={!busy} recordDateFilter={false}
   description="One line per machine, as the Equipment Master holds it."
   rows={listed} columns={machineColumns} rowKey={m=>m.assetId} emptyMessage="No machine here."/>}
 </section>;
}
