import React,{useState} from 'react';
import {buildXlsxSheetsWorkbook} from '../report-xlsx.mjs';
import {scanBatchReport,scanBatchReportTables} from '../scan-batch-report.mjs';
import './scan-batch-report.css';
const display=value=>value===null||value===undefined||value===''?'—':String(value);
export default function ScanBatchReport({batch,cards,token}){
 const [downloading,setDownloading]=useState(''),[error,setError]=useState('');
 const report=scanBatchReport(batch,cards);if(!report?.counts.cards)return null;
 const tables=scanBatchReportTables(report),cardTable=tables[1];
 const download=async format=>{setDownloading(format);setError('');try{
  const response=await fetch('/api/scan-batches/'+batch.id+'/report'+(format==='pdf'?'.pdf':''),{cache:'no-store',headers:{Authorization:'Bearer '+token}});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||'The batch report could not be downloaded.');}
  let blob;if(format==='pdf')blob=await response.blob();else{const data=await response.json();blob=buildXlsxSheetsWorkbook(data.title,data.tables);}
  const url=URL.createObjectURL(blob instanceof Blob?blob:new Blob([blob],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download=(report.vehicle?'VLB':'ELB')+'-batch-'+batch.id+'.'+format;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }catch(e){setError(e.message)}finally{setDownloading('')}};
 return <section className="scan-batch-report" aria-label="Current batch report">
  <header><div><h2>{report.title}</h2><p>{report.name} · {report.counts.cards} specific cards in this batch</p></div><div className="scan-actions"><button type="button" disabled={Boolean(downloading)} onClick={()=>download('xlsx')}>Download batch Excel</button><button type="button" disabled={Boolean(downloading)} onClick={()=>download('pdf')}>Download batch PDF</button></div></header>
  {downloading&&<p role="status">Preparing this batch's {downloading==='pdf'?'PDF':'Excel'} report…</p>}{error&&<p role="alert" className="scan-error">{error}</p>}
  <p className="scan-batch-report-scope">Batch ID: {report.batchId}. This report covers every card in this batch, regardless of the card filters below. Totals count saved cards only and refresh as cards save.</p>
  <dl>{[['Cards',report.counts.cards],['Saved',report.counts.saved],['Pending',report.counts.pending],['Rejected',report.counts.rejected],...(report.vehicle?[['Trips',report.totals.trips],['Kilometres',report.totals.kilometres]]:[]),['Working hours',report.totals.hours]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{display(value)}</dd></div>)}</dl>
  {report.counts.pending>0&&<p role="status">{report.counts.pending} card(s) are still pending. Their draft values are listed separately from saved totals.</p>}
  <details><summary>View card-wise report ({report.counts.cards} cards)</summary><div className="scan-batch-report-table"><table><thead><tr>{cardTable.columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{report.rows.map(r=><tr key={r.id}>{cardTable.columns.map(c=><td key={c.key}>{display(c.value(r))}</td>)}</tr>)}</tbody></table></div></details>
  {report.vehicle&&tables.slice(2).map(table=><details key={table.name}><summary>{table.name} · saved cards only</summary><div className="scan-batch-report-table"><table><thead><tr>{table.columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{table.rows.map((r,i)=><tr key={i}>{table.columns.map(c=><td key={c.key}>{display(c.value(r))}</td>)}</tr>)}{!table.rows.length&&<tr><td colSpan={table.columns.length}>No saved trip details in this batch yet.</td></tr>}</tbody></table></div></details>)}
 </section>;
}
