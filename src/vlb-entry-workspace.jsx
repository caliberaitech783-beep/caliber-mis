import React,{useState} from 'react';
import VlbCreateBatch from './vlb-create-batch.jsx';
import ElbBatchManual from './elb-batch-manual.jsx';
import FleetReconciliation from './fleet-reconciliation.jsx';
import ShiftAttendance from './shift-attendance.jsx';

// A batch belongs to its site/date/shift and can be continued from either entry mode.
// ELB manual and scan use the same picker: with two-stage batches the editor opens only once VLB is locked.
export const elbEntryBlocker=(kind,batch)=>{
 if(!batch)return '';
 if(kind==='vehicle')return batch.closed_at||(batch.twoStage===true&&batch.stage!=='vlb_open')?'VLB batch '+batch.name+' is locked. Unlock or reopen the batch before adding Manual, Scan or Upload entries.':'';
 if(kind==='equipment'&&batch.closed_at&&batch.lmv_locked_at)return 'Reopen this batch before entering ELB cards.';
 if(kind==='lmv')return batch.closed_at||(batch.twoStage===true&&!['vlb_open','lmv_open'].includes(batch.stage))?'Select a batch with LMV open.':'';
 return batch.twoStage!==true||['elb_open','closed'].includes(batch.stage)?'':'Lock VLB and LMV in batch '+batch.name+' before entering ELB cards.';
};
export default function VlbEntryWorkspace({kind,session,mode,ReportSection,ExportMenu,children,onExit,canDeleteElb}){
 const [selected,setSelected]=useState(null),[error,setError]=useState('');
 const [attendanceOpen,setAttendanceOpen]=useState(false);
 const blocker=elbEntryBlocker(kind,selected);
 const attendanceEntry=kind!=='lmv'&&mode==='manual'&&(attendanceOpen?<ShiftAttendance kind={kind} session={session} batch={selected} onClose={()=>setAttendanceOpen(false)}/>:<button type="button" onClick={()=>setAttendanceOpen(true)}>Present — 0 trips</button>);
 const roster=selected&&!blocker?<FleetReconciliation key={selected.id+':fleet:'+kind} session={session} context={selected} kind={kind}/>:null;
 const siteFleet=roster&&<details open className="scan-fleet-reconciliation"><summary>Site fleet · VLB / LMV / ELB, breakdown and idle details</summary>{roster}</details>;
 const key='vlb-entry-batch:'+String(session.login||session.name||'');
 // Scan entry, card and view stay in the address when the same batch is picked
 // again (a refresh, a crash recovery, a server update); they are cleared only
 // when the operator moves to another batch, because they belong to the old one.
 const select=batch=>{setSelected(batch||null);setError('');let previous='';try{previous=sessionStorage.getItem(key)||''}catch{}try{if(batch?.id)sessionStorage.setItem(key,batch.id);else sessionStorage.removeItem(key)}catch{};if(batch?.id&&batch.id===previous)return;const url=new URL(window.location.href);for(const name of ['batch','card','scanView','scanGroup','scanEquipment','scanReviewReturn'])url.searchParams.delete(name);window.history.replaceState(null,'',url.pathname+url.search+url.hash);};
 if(['manual','scan'].includes(mode))return <section className="logbook-page vlb-entry-workspace">{error&&<p role="alert" className="logbook-message error">{error}</p>}{attendanceEntry}<VlbCreateBatch session={session} ReportSection={ReportSection} entryMode={mode} entryKind={kind} onSelected={select} onExit={onExit}/>{selected&&!blocker?(kind==='equipment'&&mode==='manual'&&selected.twoStage===true&&selected.stage==='elb_open'?<ElbBatchManual canDeleteElb={canDeleteElb} ExportMenu={ExportMenu} key={selected.id} session={session} batch={selected} onExit={()=>select(null)}/>:React.cloneElement(children,{key:selected.id,vlbBatch:selected,...(kind==='vehicle'?{fleetReconciliation:roster}:{})})):<p role="status">{blocker||(kind==='vehicle'?'Select or create a site batch to enter VLB cards.':kind==='lmv'?'Select an existing Vehicle Log Book batch for LMV entry.':'Select a site batch with ELB open.')}</p>}{kind==='equipment'&&siteFleet}</section>;
 return <section className="logbook-page vlb-entry-workspace">{error&&<p role="alert" className="logbook-message error">{error}</p>}{selected?React.cloneElement(children,{key:selected.id,vlbBatch:selected}):<VlbCreateBatch session={session} ReportSection={ReportSection} entryMode={mode} onSelected={select} onExit={onExit}/>}</section>;
}
