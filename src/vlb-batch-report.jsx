import {meterCorrectionReport} from '../shared/scan-meter-history.mjs';
import './meter-correction-report.css';
import React,{useState} from 'react';
import {vlbRecordEntryType,vlbRecordSource,vlbRecordTrips} from '../shared/vlb-batch-format.mjs';
import {displaySiteName} from '../shared/region-scope.mjs';

export const vlbBatchColumns=[
 {key:'book',label:'Card ID',value:r=>r.book_no},
 {key:'card',label:'Trip card NO',value:r=>r.data.aFormNo||'—'},
 {key:'source',label:'Source',value:vlbRecordSource},
 {key:'date',label:'Date',value:r=>r.data.bookDate},
 {key:'site',label:'Site',value:r=>displaySiteName(r.data.location)},
 {key:'shift',label:'Shift',value:r=>r.data.bookShiftCode||r.data.cardShift||r.data.shiftName},
 {key:'door',label:'Vehicle',value:r=>r.data.door},
 {key:'driver',label:'Driver',value:r=>r.data.employeeName},
 {key:'employee',label:'Employee ID',value:r=>r.data.caliberId},
 {key:'trips',label:'Trips',value:r=>r.data.completedTrips??r.data.totalTrips},
 {key:'km',label:'Total KMR',value:r=>r.data.totalRunningKmr},
 {key:'hours',label:'Total HMR',value:r=>r.data.totalWorkingHmr},
 {key:'remark',label:'Remark',value:r=>r.data.remark},
 {key:'meterErrors',label:'HMR / KMR errors',tone:'error',value:r=>meterCorrectionReport(r.data).original,render:r=><span className="meter-report-error">{meterCorrectionReport(r.data).original||'—'}</span>},
 {key:'meterCorrections',label:'Corrected HMR / KMR readings',tone:'corrected',value:r=>meterCorrectionReport(r.data).corrected,render:r=><span className="meter-report-corrected">{meterCorrectionReport(r.data).corrected||'—'}</span>},
 {key:'additionalCard',label:'Additional card',when:r=>Boolean(r.data?.duplicateReason),value:r=>r.data?.duplicateReason?`Yes, also ${(r.data.duplicateOf||[]).join(', ')||'another card'}: ${r.data.duplicateReason}`:'—'},
];
// Optional columns appear only when at least one card in the batch has something to show.
export const visibleVlbBatchColumns=records=>vlbBatchColumns.filter(column=>(!column.tone||records.some(record=>meterCorrectionReport(record.data).original))&&(!column.when||records.some(column.when)));
export default function VlbBatchReport({batch,bookLabel='VLB',ReportSection,onView,onRowClick,rowAction,rowEditor,renderField,entryType=''}){
 const [search,setSearch]=useState('');
 const records=entryType?batch.records.filter(record=>vlbRecordEntryType(record)===entryType):batch.records;
 const totalTrips=records.reduce((sum,record)=>sum+vlbRecordTrips(record),0);
 const editFields={card:'A Form no. (Trip Card)',door:'Door no.',driver:'Driver name',employee:'Employee ID / Caliber ID',trips:'trips',remark:'Remark',openingKmr:'Opening KMR',closingKmr:'Closing KMR',openingHmr:'Opening HMR',closingHmr:'Closing HMR'};
 const columns=visibleVlbBatchColumns(records);
 if(renderField){
  columns.splice(columns.findIndex(column=>column.key==='trips'),0,...['openingKmr','closingKmr','openingHmr','closingHmr'].map(key=>({key,label:editFields[key],value:record=>record.data[key]})));
 }
 const displayColumns=renderField?columns.map(column=>editFields[column.key]?{...column,render:record=>renderField(record,editFields[column.key],column.value(record))}:column):columns;
 const section=<><div className="vlb-batch-report-totals" aria-label={bookLabel+' batch totals'}><strong>Total Cards: {records.length}</strong><strong>Total Trips: {totalTrips}</strong></div><ReportSection title={'Batch report · '+batch.name} category="vlb-saved-batch" recordDateFilter={false} description={`${batch.closed_at?'CLOSED':'OPEN'} · ${records.length} saved cards · ${displaySiteName(batch.site)} · ${batch.report_date} · ${batch.shift}`} rowAction={rowAction} rowEditor={rowEditor} onRowClick={onRowClick} columns={onView?[...displayColumns,{key:'details',label:'Details',render:record=><button type="button" onClick={()=>onView(record)}>View {bookLabel}</button>}]:displayColumns} rows={records} rowKey={r=>r.id} showSearch={false} query={search} onResetSearch={()=>setSearch('')} smartPrintAction exportLabel="Generate" emptyMessage="No cards match this search in the opened batch." headingControl={<div className="generated-report-search"><label>Smart Search<input type="search" data-smart-search aria-label="Smart Search opened batch" placeholder="Card ID, vehicle, driver, source or any report value" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>}/></>;
 if(!batch.machineReport)return section;
 return <>{section}<MachineReport report={batch.machineReport} statuses={batch.statuses}/></>;
}
const cell=value=>value===null||value===undefined||value===''?'—':value;
// Machine-wise shift report: loaders with trips and HMR first, then every other machine by status.
export function MachineReport({report,statuses}){
 const [sort,setSort]=useState({key:'',direction:'asc'});
 const totals=report?.totals||{};
 const label=row=>row.statusLabel||statuses?.[row.status]?.label||row.status||'Not saved';
 const columns=[['door','Door'],['equipmentName','Equipment'],['trips','Trips'],['sourceCards','Cards'],['operator','Operator'],['openingHmr','Opening HMR'],['closingHmr','Closing HMR'],['hours','Hours'],['tripsPerHour','Trips/hour'],['breakdownHours','BD hours'],['status','Status'],['bookNo','ELB no.']];
 const numeric=new Set(['trips','sourceCards','openingHmr','closingHmr','hours','tripsPerHour','breakdownHours']);
 const sorted=rows=>!sort.key?rows:[...rows].sort((a,b)=>{
  const value=row=>sort.key==='status'?label(row):row[sort.key];
  const av=value(a),bv=value(b),missing=v=>v==null||v===''||v==='—';
  if(missing(av)||missing(bv))return Number(missing(av))-Number(missing(bv));
  const result=numeric.has(sort.key)?Number(av)-Number(bv):String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'});
  return sort.direction==='asc'?result:-result;
 });
 const loaders=sorted(report?.loaders||[]),others=sorted(report?.others||[]);
 const changeSort=key=>setSort(current=>({key,direction:current.key===key&&current.direction==='asc'?'desc':'asc'}));
 return <details className="logbook-section vlb-machine-report" aria-label="ELB -- Machine-wise shift report"><summary>ELB -- Machine-wise shift report</summary>
  <div className="logbook-table-wrap"><table className="logbook-table"><thead><tr>{columns.map(([key,title])=><th key={key} aria-sort={sort.key===key?(sort.direction==='asc'?'ascending':'descending'):'none'}><button type="button" className={'sort-header'+(sort.key===key?' active':'')} onClick={()=>changeSort(key)}><span>{title}</span><span aria-hidden="true">{sort.key===key?(sort.direction==='asc'?'↑':'↓'):'↕'}</span></button></th>)}</tr></thead><tbody>
   {loaders.map(row=><tr key={row.assetId}><td>{row.door}</td><td>{cell(row.equipmentName)}</td><td>{row.trips}</td><td>{cell(row.sourceCards)}</td><td>{cell(row.operator)}</td><td>{cell(row.openingHmr)}</td><td>{cell(row.closingHmr)}</td><td>{cell(row.hours)}</td><td>{cell(row.tripsPerHour)}</td><td>{cell(row.breakdownHours)}</td><td>{label(row)}</td><td>{cell(row.bookNo)}</td></tr>)}
   {!loaders.length&&<tr><td colSpan={12}>No machine loaded trips in this batch.</td></tr>}
   {others.length>0&&<tr className="vlb-machine-report-group"><th colSpan={12}>Other equipment</th></tr>}
   {others.map(row=><tr key={row.assetId}><td>{row.door}</td><td>{cell(row.equipmentName)}</td><td colSpan={5}>{label(row)}</td><td>{cell(row.hours)}</td><td colSpan={2}>{cell(row.idleHours!=null&&row.idleHours!==''?'Idle '+row.idleHours:'')}</td><td colSpan={2}>{cell(row.remark)}</td></tr>)}
  </tbody><tfoot><tr><th colSpan={2}>Totals · {totals.machines??loaders.length+others.length} machines</th><th>{totals.trips??loaders.reduce((sum,row)=>sum+(Number(row.trips)||0),0)}</th><th colSpan={4}/><th>{cell(totals.hours)}</th><th colSpan={4}/></tr></tfoot></table></div>
  <p className="vlb-machine-report-summary">Fleet summary: {totals.machines??loaders.length+others.length} machines · {totals.working??0} working · {totals.down??0} down · {totals.idle??0} idle</p>
 </details>;
}

