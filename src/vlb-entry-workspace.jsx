import React,{useState} from 'react';
import VlbCreateBatch from './vlb-create-batch.jsx';

export function rememberVlbEntryBatch(session,batch){if(batch?.id)try{sessionStorage.setItem('vlb-entry-batch:'+String(session.login||session.name||''),batch.id)}catch{}}

// A batch belongs to its site/date/shift and can be continued from either entry mode.
// ELB manual and scan use the same picker: with two-stage batches the editor opens only once VLB is locked.
export const elbEntryBlocker=(kind,batch)=>kind==='vehicle'||!batch||batch.twoStage!==true||batch.stage==='elb_open'?'':'Lock VLB in batch '+batch.name+' before entering ELB cards. The ELB stage opens once every tipper card is saved and VLB is locked.';
export default function VlbEntryWorkspace({kind,session,mode,ReportSection,children,onExit}){
 const [selected,setSelected]=useState(null),[error,setError]=useState('');
 const blocker=elbEntryBlocker(kind,selected);
 const key='vlb-entry-batch:'+String(session.login||session.name||'');
 // Scan entry, card and view stay in the address when the same batch is picked
 // again (a refresh, a crash recovery, a server update); they are cleared only
 // when the operator moves to another batch, because they belong to the old one.
 const select=batch=>{setSelected(batch||null);setError('');let previous='';try{previous=sessionStorage.getItem(key)||''}catch{}try{if(batch?.id)sessionStorage.setItem(key,batch.id);else sessionStorage.removeItem(key)}catch{};if(batch?.id&&batch.id===previous)return;const url=new URL(window.location.href);for(const name of ['batch','card','scanView','scanGroup','scanEquipment','scanReviewReturn'])url.searchParams.delete(name);window.history.replaceState(null,'',url.pathname+url.search+url.hash);};
 if(['manual','scan'].includes(mode))return <section className="logbook-page vlb-entry-workspace">{error&&<p role="alert" className="logbook-message error">{error}</p>}<VlbCreateBatch session={session} ReportSection={ReportSection} entryMode={mode} onSelected={select} onExit={onExit}/>{selected&&!selected.closed_at&&!blocker?React.cloneElement(children,{key:selected.id,vlbBatch:selected}):<p role="status">{blocker||(kind==='vehicle'?'Select or create an open site batch to enter VLB cards.':'Select the open site batch to enter ELB cards. ELB opens after VLB is locked in that batch.')}</p>}</section>;
 return <section className="logbook-page vlb-entry-workspace">{error&&<p role="alert" className="logbook-message error">{error}</p>}{selected&&!selected.closed_at?React.cloneElement(children,{key:selected.id,vlbBatch:selected}):<VlbCreateBatch session={session} ReportSection={ReportSection} entryMode={mode} onSelected={select} onExit={onExit}/>}</section>;
}
