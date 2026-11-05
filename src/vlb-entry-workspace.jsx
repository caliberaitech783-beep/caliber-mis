import React,{useState} from 'react';
import VlbCreateBatch from './vlb-create-batch.jsx';
import ElbBatchManual from './elb-batch-manual.jsx';
import FleetReconciliation from './fleet-reconciliation.jsx';

export function rememberVlbEntryBatch(session,batch){if(batch?.id)try{const user=String(session.login||session.name||'');sessionStorage.setItem('vlb-entry-batch:'+user,batch.id);sessionStorage.setItem('vlb-entry-handoff:'+user,batch.id)}catch{}}

// A batch belongs to its site/date/shift and can be continued from either entry mode.
// ELB manual and scan use the same picker: with two-stage batches the editor opens only once VLB is locked.
export const elbEntryBlocker=(kind,batch)=>{
 if(!batch)return '';
 if(kind==='vehicle')return batch.closed_at||(batch.twoStage===true&&batch.stage!=='vlb_open')?'VLB batch '+batch.name+' is locked. Unlock or reopen the batch before adding Manual, Scan or Upload entries.':'';
 return batch.twoStage!==true||['elb_open','closed'].includes(batch.stage)?'':'Lock VLB in batch '+batch.name+' before entering ELB cards. The ELB stage opens once every tipper card is saved and VLB is locked.';
};
export default function VlbEntryWorkspace({kind,session,mode,ReportSection,children,onExit}){
 const [selected,setSelected]=useState(null),[error,setError]=useState('');
 const blocker=elbEntryBlocker(kind,selected);
 const roster=selected&&!blocker?<FleetReconciliation key={selected.id+':fleet:'+kind} session={session} context={selected} kind={kind}/>:null;
 const siteFleet=roster&&<details open className="scan-fleet-reconciliation"><summary>Site fleet · VLB / ELB, breakdown and idle details</summary>{roster}</details>;
 const key='vlb-entry-batch:'+String(session.login||session.name||'');
 // Scan entry, card and view stay in the address when the same batch is picked
 // again (a refresh, a crash recovery, a server update); they are cleared only
 // when the operator moves to another batch, because they belong to the old one.
 const select=batch=>{setSelected(batch||null);setError('');let previous='';try{previous=sessionStorage.getItem(key)||''}catch{}try{if(batch?.id)sessionStorage.setItem(key,batch.id);else sessionStorage.removeItem(key)}catch{};if(batch?.id&&batch.id===previous)return;const url=new URL(window.location.href);for(const name of ['batch','card','scanView','scanGroup','scanEquipment','scanReviewReturn'])url.searchParams.delete(name);window.history.replaceState(null,'',url.pathname+url.search+url.hash);};
 if(['manual','scan'].includes(mode))return <section className="logbook-page vlb-entry-workspace">{error&&<p role="alert" className="logbook-message error">{error}</p>}<VlbCreateBatch session={session} ReportSection={ReportSection} entryMode={mode} entryKind={kind} onSelected={select} onExit={onExit}/>{kind!=='equipment'&&mode!=='scan'&&siteFleet}{selected&&!blocker?(kind==='equipment'&&mode==='manual'&&selected.twoStage===true&&selected.stage==='elb_open'?<ElbBatchManual key={selected.id} session={session} batch={selected} onExit={()=>select(null)}/>:React.cloneElement(children,{key:selected.id,vlbBatch:selected,...(kind==='vehicle'&&mode==='scan'?{fleetReconciliation:roster}:{})})):<p role="status">{blocker||(kind==='vehicle'?'Select or create a site batch to enter VLB cards.':'Select a site batch to enter ELB cards. ELB opens after VLB is locked in that batch.')}</p>}{kind==='equipment'&&siteFleet}</section>;
 return <section className="logbook-page vlb-entry-workspace">{error&&<p role="alert" className="logbook-message error">{error}</p>}{selected?React.cloneElement(children,{key:selected.id,vlbBatch:selected}):<VlbCreateBatch session={session} ReportSection={ReportSection} entryMode={mode} onSelected={select} onExit={onExit}/>}</section>;
}
