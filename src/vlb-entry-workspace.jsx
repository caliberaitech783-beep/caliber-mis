import React,{useEffect,useState} from 'react';
import VlbCreateBatch from './vlb-create-batch.jsx';

export function rememberVlbEntryBatch(session,batch){if(batch?.id)try{sessionStorage.setItem('vlb-entry-batch:'+String(session.login||session.name||''),batch.id)}catch{}}

// A batch belongs to its site/date/shift and can be continued from either entry mode.
export default function VlbEntryWorkspace({kind,session,mode,ReportSection,children,onExit}){
 const [selected,setSelected]=useState(null),[entering,setEntering]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const key='vlb-entry-batch:'+String(session.login||session.name||'');
 const read=async(id,method='GET')=>{const r=await fetch('/api/vlb-batches/'+id,{method,cache:'no-store',headers:{Authorization:'Bearer '+session.token}});const d=await r.json();if(!r.ok)throw Error(d.error||'Batch unavailable');return d;};
 useEffect(()=>{if(kind!=='vehicle')return;const controller=new AbortController();let id;try{id=sessionStorage.getItem(key)}catch{}if(id)read(id).then(b=>{if(!controller.signal.aborted&&!b.closed_at)setSelected(b)}).catch(()=>{});return()=>controller.abort();},[kind,session.token]);
 const select=batch=>{setSelected(batch);setEntering(false);setError('');try{sessionStorage.setItem(key,batch.id)}catch{};const url=new URL(window.location.href);for(const name of ['batch','card','scanView','scanGroup','scanEquipment','scanReviewReturn'])url.searchParams.delete(name);window.history.replaceState(null,'',url.pathname+url.search+url.hash);};
 const proceed=async()=>{setBusy(true);setError('');try{const current=await read(selected.id);if(current.closed_at){setSelected(null);throw Error('This batch has been locked. Select another open batch or request reopening.')}if(current.canContinue===false)throw Error('This reopened batch is reserved for its approved MIS user.');setSelected(current);setEntering(true)}catch(e){setError(e.message)}finally{setBusy(false)}};
 const close=async()=>{setBusy(true);setError('');try{const current=await read(selected.id+'/close','POST');setSelected(current);setEntering(false)}catch(e){setError(e.message)}finally{setBusy(false)}};
 if(kind!=='vehicle')return children;
 return <section className="logbook-page vlb-entry-workspace">{error&&<p role="alert" className="logbook-message error">{error}</p>}{selected&&!selected.closed_at?<><section className="logbook-section"><h2>{selected.name}</h2><p>{selected.site} · {selected.report_date} · {selected.shift} · OPEN</p><p>Manual entries, scans and uploads continue in this batch. Its location, date and shift are fixed.</p><div className="vlb-batch-actions">{!entering&&<button type="button" disabled={busy} onClick={proceed}>{mode==='manual'?'Manual entry':'Scan / Upload files'}</button>}<button type="button" disabled={busy} onClick={()=>{setEntering(false);setSelected(null)}}>Search / change batch</button>{!entering&&selected.canClose&&<button type="button" disabled={busy} onClick={close}>Save &amp; lock batch</button>}</div></section>{entering&&React.cloneElement(children,{key:selected.id,vlbBatch:selected})}</>:<VlbCreateBatch session={session} ReportSection={ReportSection} entryMode={mode} onSelected={select} onExit={onExit}/>}</section>;
}
