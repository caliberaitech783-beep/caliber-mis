import React,{useState} from 'react';
import VlbCreateBatch from './vlb-create-batch.jsx';

export function rememberVlbEntryBatch(session,batch){if(batch?.id)try{sessionStorage.setItem('vlb-entry-batch:'+String(session.login||session.name||''),batch.id)}catch{}}

// A batch belongs to its site/date/shift and can be continued from either entry mode.
export default function VlbEntryWorkspace({kind,session,mode,ReportSection,children,onExit}){
 const [selected,setSelected]=useState(null),[error,setError]=useState('');
 const key='vlb-entry-batch:'+String(session.login||session.name||'');
 const select=batch=>{setSelected(batch||null);setError('');try{if(batch?.id)sessionStorage.setItem(key,batch.id);else sessionStorage.removeItem(key)}catch{};const url=new URL(window.location.href);for(const name of ['batch','card','scanView','scanGroup','scanEquipment','scanReviewReturn'])url.searchParams.delete(name);window.history.replaceState(null,'',url.pathname+url.search+url.hash);};
 if(kind!=='vehicle')return children;
 if(['manual','scan'].includes(mode))return <section className="logbook-page vlb-entry-workspace">{error&&<p role="alert" className="logbook-message error">{error}</p>}<VlbCreateBatch session={session} ReportSection={ReportSection} entryMode={mode} onSelected={select} onExit={onExit}/>{React.cloneElement(children,{key:selected?.id||mode+'-entry',...(selected&&!selected.closed_at?{vlbBatch:selected}:{})})}</section>;
 return <section className="logbook-page vlb-entry-workspace">{error&&<p role="alert" className="logbook-message error">{error}</p>}{selected&&!selected.closed_at?React.cloneElement(children,{key:selected.id,vlbBatch:selected}):<VlbCreateBatch session={session} ReportSection={ReportSection} entryMode={mode} onSelected={select} onExit={onExit}/>}</section>;
}
