import React,{useState} from 'react';
import {buildXlsxSheetsWorkbook} from '../report-xlsx.mjs';
import {scanBatchReport,scanBatchReportTables} from '../scan-batch-report.mjs';
import './scan-batch-report.css';
const display=value=>value===null||value===undefined||value===''?'—':String(value);
export default function ScanBatchReport({batch,cards,token,ReportSection,contextBlocked=false}){
 const [downloading,setDownloading]=useState(''),[error,setError]=useState(''),[savedOnly,setSavedOnly]=useState(false),[search,setSearch]=useState('');
 const report=scanBatchReport(batch,cards);if(contextBlocked||!report?.counts.cards)return null;
 const tables=scanBatchReportTables(report);
 const cardTable=tables.find(table=>table.name==='Cards');
 const visibleCards=report.rows.filter(row=>(!savedOnly||row.saved)&&(!search.trim()||cardTable.columns.some(column=>display(column.value(row)).toLowerCase().includes(search.trim().toLowerCase()))));
 const download=async format=>{setDownloading(format);setError('');try{
  const response=await fetch('/api/scan-batches/'+batch.id+'/report'+(format==='pdf'?'.pdf':''),{cache:'no-store',headers:{Authorization:'Bearer '+token}});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||'The batch report could not be downloaded.');}
  let blob;if(format==='pdf')blob=await response.blob();else{const data=await response.json();blob=buildXlsxSheetsWorkbook(data.title,data.tables);}
  const url=URL.createObjectURL(blob instanceof Blob?blob:new Blob([blob],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download=(report.vehicle?'VLB':'ELB')+'-batch-'+batch.id+'.'+format;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }catch(e){setError(e.message)}finally{setDownloading('')}};
 return <section className="scan-batch-report" aria-label="Current batch report">
  <header><div><h2>{report.title}</h2><p>{report.name} · {report.counts.cards} specific cards in this batch</p></div><label className="scan-batch-report-search"><input type="search" aria-label="Search batch report" placeholder="Search this report" value={search} onChange={event=>setSearch(event.target.value)}/></label><div className="scan-actions"><button type="button" disabled={Boolean(downloading)||contextBlocked||(report.contextChecked&&!report.counts.saved)} onClick={()=>download('xlsx')}>Download batch Excel</button><button type="button" disabled={Boolean(downloading)||contextBlocked||(report.contextChecked&&!report.counts.saved)} onClick={()=>download('pdf')}>Download batch PDF</button></div></header>
  {downloading&&<p role="status">Preparing this batch's {downloading==='pdf'?'PDF':'Excel'} report…</p>}{error&&<p role="alert" className="scan-error">{error}</p>}
  <p className="scan-batch-report-scope">Batch ID: {report.batchId}. {report.contextChecked?'Only cards matching the selected date, site and shift are shown. Excel/PDF contain saved matching cards only.':'This report covers every card in this batch, regardless of the card filters below. Totals count saved cards only and refresh as cards save.'}</p>
  <dl>{[['Cards',report.counts.cards],['Saved',report.counts.saved],['Pending',report.counts.pending],['Rejected',report.counts.rejected],...(report.vehicle?[['Trips',report.totals.trips],['Kilometres',report.totals.kilometres]]:[]),['Working hours',report.totals.hours]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{['Cards','Saved'].includes(label)?<button type="button" className="scan-report-count" aria-label={label==='Saved'?'Show all saved cards':'Show all batch cards'} aria-pressed={label==='Saved'?savedOnly:!savedOnly} onClick={()=>setSavedOnly(label==='Saved')}>{display(value)}</button>:display(value)}</dd></div>)}</dl>
  {report.counts.pending>0&&<p role="status">{report.counts.pending} {report.contextChecked?'matching card(s) still need correction. They are excluded from Excel/PDF until saved.':'card(s) are still pending. Their draft values are listed separately from saved totals.'}</p>}
  {ReportSection&&tables.filter(table=>table.name!=='Individual trips'&&table.name!=='Loading equipment').map(table=><details key={table.name} open={table.name==='Cards'}><summary>{table.name==='Cards'&&savedOnly?'Saved cards':table.name}</summary>{table.name==='Cards'&&report.contextChecked?<div className="scan-batch-report-table"><table aria-label="Scanned card summary"><thead><tr>{table.columns.map(column=><th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{visibleCards.length?visibleCards.map(row=><tr key={row.id}>{table.columns.map(column=><td key={column.key}>{display(column.value(row))}</td>)}</tr>):<tr><td colSpan={table.columns.length}>{savedOnly?'No saved cards match this search.':'No matching cards found.'}</td></tr>}</tbody></table></div>:<ReportSection title={table.title} showSearch={false} query={search} category="scan-batch" description={report.name+' · Batch ID: '+report.batchId} columns={table.columns} rows={table.name==='Cards'&&savedOnly?table.rows.filter(row=>row.saved):table.rows} emptyMessage={savedOnly&&table.name==='Cards'?'No cards have been saved to the log book yet.':'No matching data in this batch yet.'}/>}</details>)}

 </section>;
}
