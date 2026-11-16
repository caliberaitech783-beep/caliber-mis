// Download History in the top bar (owner, 16 Nov 2026): every file this login downloaded or saved on this PC, newest first,
// with its date and time. Open shows it again straight from the copy kept in the browser: a PDF in a new tab, an Excel or
// CSV file as a table inside the app. Nothing is built or downloaded again; "Save again" gives a fresh copy when wanted.
import React,{useEffect,useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {Download,FileSpreadsheet,FileText,FolderOpen,Trash2,X} from 'lucide-react';
import {formatDisplayDateTime} from '../shared/date-time-format.mjs';
import {DOWNLOAD_HISTORY_EVENT,KEEP_FILES,clearDownloads,downloadBlob,listDownloads,readCsvRows,readXlsxSheets,removeDownload,setDownloadHistoryOwner} from './download-history.mjs';
import './download-history.css';

const sizeText=bytes=>bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';
const whereText=row=>row.where==='folder'?'Folder you chose':'Downloads folder';
const canView=row=>row.kind==='Excel'||row.kind==='CSV';

function FileViewer({row,onClose}){
  const [sheets,setSheets]=useState(null),[error,setError]=useState(''),[active,setActive]=useState(0);
  useEffect(()=>{
    let live=true;
    (row.kind==='CSV'?readCsvRows(row.blob).then(rows=>[{name:'Sheet',rows}]):readXlsxSheets(row.blob))
      .then(list=>{if(live)setSheets(list);}).catch(e=>{if(live)setError(e?.message||'This file could not be opened here.');});
    return ()=>{live=false;};
  },[row]);
  const sheet=sheets?.[active];
  // Our workbooks start with a title line and a record-count line, then the headings.
  const headingAt=sheet?Math.max(0,sheet.rows.findIndex(r=>r.filter(Boolean).length>1)):0;
  const head=sheet?.rows[headingAt]||[],body=sheet?sheet.rows.slice(headingAt+1):[],intro=sheet?sheet.rows.slice(0,headingAt).map(r=>r.filter(Boolean).join(' ')).filter(Boolean):[];
  return <div className="dlh-viewer" role="region" aria-label={'Open file '+row.name}>
    <header><button type="button" className="secondary" onClick={onClose}>← All downloads</button><b title={row.name}>{row.name}</b>
     <button type="button" className="secondary" onClick={()=>downloadBlob(row.blob,row.name,{title:row.title,record:null})}><Download/> Save again</button></header>
    {error&&<p className="dlh-error" role="alert">{error} Use Save again to open it in Excel.</p>}
    {!sheets&&!error&&<p className="dlh-note">Opening…</p>}
    {sheets&&sheets.length>1&&<div className="dlh-sheets" role="tablist">{sheets.map((s,i)=><button key={s.name+i} type="button" role="tab" aria-selected={i===active} className={i===active?'active':''} onClick={()=>setActive(i)}>{s.name}</button>)}</div>}
    {sheet&&<>{intro.map(line=><p key={line} className="dlh-intro">{line}</p>)}
     <div className="dlh-table-wrap"><table><thead><tr>{head.map((h,i)=><th key={i}>{h}</th>)}</tr></thead>
      <tbody>{body.map((r,i)=><tr key={i}>{head.map((_,c)=><td key={c}>{r[c]??''}</td>)}</tr>)}</tbody></table></div>
     {sheet.more&&<p className="dlh-note">The first 5,000 lines are shown here. Use Save again for the whole file in Excel.</p>}</>}
  </div>;
}

export default function DownloadHistoryButton({session}){
  const login=session?.login||session?.name||'';
  useEffect(()=>{setDownloadHistoryOwner(login);},[login]);
  const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[query,setQuery]=useState(''),[viewing,setViewing]=useState(null),[note,setNote]=useState('');
  useEffect(()=>{
    if(!open)return undefined;
    let live=true;const load=()=>listDownloads().then(list=>{if(live)setRows(list);});
    load();window.addEventListener(DOWNLOAD_HISTORY_EVENT,load);
    const escape=event=>{if(event.key==='Escape'){if(viewing)setViewing(null);else setOpen(false);}};
    window.addEventListener('keydown',escape);
    return ()=>{live=false;window.removeEventListener(DOWNLOAD_HISTORY_EVENT,load);window.removeEventListener('keydown',escape);};
  },[open,viewing]);
  const shown=useMemo(()=>{const q=query.trim().toLowerCase();return q?rows.filter(r=>(r.name+' '+r.title+' '+r.kind).toLowerCase().includes(q)):rows;},[rows,query]);
  const openFile=row=>{
    setNote('');
    if(canView(row)){setViewing(row);return;}
    // A PDF opens in the browser's own viewer in a new tab.
    const url=URL.createObjectURL(row.blob.type?row.blob:new Blob([row.blob],{type:row.kind==='PDF'?'application/pdf':''}));
    const tab=window.open(url,'_blank');
    if(tab)try{tab.opener=null;}catch{/* another window */}
    setTimeout(()=>URL.revokeObjectURL(url),300000);
    if(!tab)setNote('The browser stopped the new tab. Allow pop-ups for this site, or use Save again.');
  };
  const remove=async row=>{await removeDownload(row.id);setRows(list=>list.filter(r=>r.id!==row.id));};
  const clear=async()=>{if(!window.confirm('Remove every file from Download History on this PC? Files already in your folders stay where they are.'))return;await clearDownloads();setRows([]);};
  const close=()=>{setOpen(false);setViewing(null);};
  return <>
   <button type="button" className="smart-search-button download-history-button" aria-label="Download History" title="Download History: files you downloaded, to open again" onClick={()=>setOpen(true)}><FolderOpen/></button>
   {open&&createPortal(<div className="dlh-backdrop" onPointerDown={close}>
    <section className="dlh-dialog" role="dialog" aria-modal="true" aria-labelledby="dlh-title" onPointerDown={e=>e.stopPropagation()}>
     <header className="dlh-head"><h2 id="dlh-title"><FolderOpen/> Download History</h2><button type="button" className="mis-popup-close" onClick={close} aria-label="Close Download History"><X/> Close</button></header>
     {viewing?<FileViewer row={viewing} onClose={()=>setViewing(null)}/>:<>
      <p className="dlh-note">Every Excel, PDF and CSV file you downloaded or saved in this browser on this PC, newest first. Open shows it again without downloading it; the newest {KEEP_FILES} files are kept.</p>
      <div className="dlh-tools"><input type="search" data-smart-search value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search file or report name" aria-label="Search Download History"/><span>{shown.length} of {rows.length} files</span>{rows.length>0&&<button type="button" className="secondary" onClick={clear}><Trash2/> Clear all</button>}</div>
      {note&&<p className="dlh-error" role="status">{note}</p>}
      {shown.length?<div className="dlh-table-wrap"><table className="dlh-list"><thead><tr><th>Sr. No.</th><th>File</th><th>Type</th><th>Downloaded on</th><th>Saved in</th><th>Size</th><th>Actions</th></tr></thead>
       <tbody>{shown.map((row,i)=><tr key={row.id}><td>{i+1}</td><td><b>{row.name}</b>{row.title&&<small>{row.title}</small>}</td>
        <td><span className={'dlh-kind dlh-kind-'+row.kind.toLowerCase()}>{row.kind==='PDF'?<FileText/>:<FileSpreadsheet/>}{row.kind}</span></td>
        <td>{formatDisplayDateTime(row.savedAt)}</td><td>{whereText(row)}</td><td>{sizeText(row.size)}</td>
        <td className="dlh-actions"><button type="button" className="primary" onClick={()=>openFile(row)}><FolderOpen/> Open</button>
         <button type="button" className="secondary" onClick={()=>downloadBlob(row.blob,row.name,{title:row.title,record:null})} title="Download a fresh copy"><Download/> Save again</button>
         <button type="button" className="secondary dlh-remove" onClick={()=>void remove(row)} aria-label={'Remove '+row.name+' from Download History'} title="Remove from Download History"><Trash2/></button></td></tr>)}</tbody></table></div>
       :<p className="dlh-empty">{rows.length?'No file matches the search.':'No downloads yet. Files you export with Smart Print (PDF or Excel) appear here.'}</p>}
     </>}
    </section></div>,document.body)}
  </>;
}
