import {meterCorrectionReport} from '../shared/scan-meter-history.mjs';
import './meter-correction-report.css';
import React,{useState} from 'react';
import TableSmartPrint from './table-smart-print.jsx';
import {vlbRecordEntryType,vlbRecordSource,vlbRecordTrips} from '../shared/vlb-batch-format.mjs';
import {displaySiteName} from '../shared/region-scope.mjs';

function equipmentUsed({data}){
 const entries=Array.isArray(data.trips)?data.trips:data.machineSummary||[];
 const equipment=entries.map(entry=>String(entry?.equipmentName??'').trim()).filter(Boolean);
 return [...new Set(equipment)].join(', ')||'—';
}

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
 {key:'equipmentUsed',label:'Equipment used',value:equipmentUsed},
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
 const section=<><div className="vlb-batch-report-totals" aria-label={bookLabel+' batch totals'}><strong>Total Cards: {records.length}</strong><strong>Total Trips: {totalTrips}</strong></div><ReportSection title={'Batch report · '+batch.name} category="vlb-saved-batch" recordDateFilter={false} description={`${batch.closed_at?'CLOSED':'OPEN'} · ${records.length} saved cards · ${displaySiteName(batch.site)} · ${batch.report_date} · ${batch.shift}`} rowAction={rowAction} rowEditor={rowEditor} onRowClick={onRowClick} columns={onView?[...displayColumns,{key:'details',label:'Details',render:record=><button type="button" onClick={()=>onView(record)}>View {bookLabel}</button>}]:displayColumns} rows={records} rowKey={r=>r.id} showSearch={false} query={search} onResetSearch={()=>setSearch('')} smartPrintAction emptyMessage="No cards match this search in the opened batch." headingControl={<div className="generated-report-search"><label>Smart Search<input type="search" data-smart-search aria-label="Smart Search opened batch" placeholder="Card ID, vehicle, driver or equipment" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>}/></>;
 if(!batch.machineReport)return section;
 return <>{section}<MachineReport report={batch.machineReport} statuses={batch.statuses}/></>;
}
const elbMeter=value=>{const text=String(value??'').trim();const number=Number(text);return text&&Number.isFinite(number)?number:'';};
// Saved ELB cards on the opened batch: the same report table as VLB (Smart Search, column filters, sort, Smart Print).
// `field` is the name the inline editor focuses when the cell is pressed; `blanksLast` makes the report table
// keep cards with no job card at the bottom in both sort directions.
export const elbSavedCardColumns=[
 {key:'bookNo',label:'Book number',value:r=>r.book_no},
 {key:'door',label:'Equipment / Door',field:'Equipment',value:r=>r.data?.door||r.data?.assetName},
 {key:'operator',label:'Operator',field:'Operator name',value:r=>r.data?.employeeName},
 {key:'openingHmr',label:'Opening HMR',field:'Opening HMR',value:r=>r.data?.openingHmr,sortValue:r=>elbMeter(r.data?.openingHmr)},
 {key:'closingHmr',label:'Closing HMR',field:'Closing HMR',value:r=>r.data?.closingHmr,sortValue:r=>elbMeter(r.data?.closingHmr)},
 {key:'jobCard',label:'Job card',field:'Job Card no.',blanksLast:true,value:r=>r.data?.jobCardNo},
];
export function ElbSavedCardsReport({batch,ReportSection,onView,rowAction,rowEditor,renderField}){
 const [search,setSearch]=useState('');
 const records=batch.elbRecords||[];
 const columns=elbSavedCardColumns.map(column=>renderField&&column.field?{...column,render:record=>renderField(record,column.field,column.value(record))}:column);
 return <ReportSection title={'Saved ELB cards · '+batch.name} category="elb-saved-batch" recordDateFilter={false} description={`${records.length} saved ELB card${records.length===1?'':'s'} · ${displaySiteName(batch.site)} · ${batch.report_date} · ${batch.shift}`} rowAction={rowAction} rowEditor={rowEditor} columns={onView?[...columns,{key:'details',label:'Details',render:record=><button type="button" onClick={()=>onView(record)}>View ELB</button>}]:columns} rows={records} rowKey={r=>r.id} showSearch={false} query={search} onResetSearch={()=>setSearch('')} smartPrintAction emptyMessage="No ELB cards match this search in the opened batch." headingControl={<div className="generated-report-search"><label>Smart Search<input type="search" data-smart-search aria-label="Smart Search saved ELB cards" placeholder="Book number, equipment, operator or job card" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>}/>;
}
const drillJob=(record,name)=>(record.data?.jobs||[]).find(row=>row.jobType===name)||{};
const breakdownText=record=>(record.data?.breakdowns||[]).map(row=>[row.detail,row.startTime&&row.endTime?row.startTime+'–'+row.endTime:'',row.actionTaken,row.mechanic,row.tmExecution,row.remark].filter(Boolean).join(' · ')).filter(Boolean).join(' | ');
export const dlbSavedCardColumns=[
 {key:'bookNo',label:'Book number',value:r=>r.book_no},
 {key:'rig',label:'Rig / Door',value:r=>r.data?.rigNo||r.data?.rigName},
 {key:'operator',label:'Operator',value:r=>r.data?.operatorName},
 {key:'caliberId',label:'Caliber ID',value:r=>r.data?.caliberId},
 {key:'shift',label:'Shift',value:r=>r.data?.shiftName},
 {key:'drillCard',label:'Drill card NO',value:r=>r.data?.drillCardNo},
 {key:'compressorOpening',label:'Compressor opening HMR',value:r=>r.data?.compressorOpening,sortValue:r=>elbMeter(r.data?.compressorOpening)},
 {key:'compressorClosing',label:'Compressor closing HMR',value:r=>r.data?.compressorClosing,sortValue:r=>elbMeter(r.data?.compressorClosing)},
 {key:'compressorRunning',label:'Compressor running HMR',value:r=>r.data?.compressorRunning,sortValue:r=>elbMeter(r.data?.compressorRunning)},
 {key:'machineOpening',label:'Machine opening HMR',value:r=>r.data?.machineOpening,sortValue:r=>elbMeter(r.data?.machineOpening)},
 {key:'machineClosing',label:'Machine closing HMR',value:r=>r.data?.machineClosing,sortValue:r=>elbMeter(r.data?.machineClosing)},
 {key:'machineRunning',label:'Machine running HMR',value:r=>r.data?.machineRunning,sortValue:r=>elbMeter(r.data?.machineRunning)},
 ...['Clay Area','Hard Bench','Coal'].flatMap(name=>{const key=name.toLowerCase().replaceAll(' ','');return [
  {key:key+'Holes',label:name+' holes',value:r=>drillJob(r,name).holes},
  {key:key+'Length',label:name+' hole length',value:r=>drillJob(r,name).holeLength},
  {key:key+'Metrage',label:name+' total metrage',value:r=>drillJob(r,name).totalMetrage},
  {key:key+'HolesHour',label:name+' holes/hr',value:r=>drillJob(r,name).holesPerHour},
  {key:key+'MeterHour',label:name+' meter/hr',value:r=>drillJob(r,name).metersPerHour},
 ]}),
 {key:'workOrder',label:'WO / Contract',value:r=>r.data?.workOrderContract},
 {key:'breakdowns',label:'Breakdown details',value:breakdownText},
];
export function DlbSavedCardsReport({batch,ReportSection,onView,rowAction,rowEditor}){
 const [search,setSearch]=useState('');const records=batch.dlbRecords||[];
 const columns=onView?[...dlbSavedCardColumns,{key:'details',label:'Details',render:record=><button type="button" onClick={()=>onView(record)}>View DLB</button>}]:dlbSavedCardColumns;
 return <ReportSection title={'Saved DLB cards · '+batch.name} category="dlb-saved-batch" recordDateFilter={false} description={`${records.length} saved DLB card${records.length===1?'':'s'} · ${displaySiteName(batch.site)} · ${batch.report_date} · ${batch.shift}`} rowAction={rowAction} rowEditor={rowEditor} columns={columns} rows={records} rowKey={r=>r.id} showSearch={false} query={search} onResetSearch={()=>setSearch('')} smartPrintAction emptyMessage="No DLB cards match this search in the opened batch." headingControl={<div className="generated-report-search"><label>Smart Search<input type="search" data-smart-search aria-label="Smart Search saved DLB cards" placeholder="Book number, rig, operator, shift or HMR" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>}/>;
}
export function DlbCardDetails({record,onClose}){
 const data=record?.data||{},jobs=data.jobs||[],breakdowns=data.breakdowns||[];
 return <section className="logbook-section dlb-saved" aria-label={'Saved DLB '+record.book_no}><div className="dlb-section-title"><h2>DLB details · {record.book_no}</h2><button type="button" onClick={onClose}>Back to DLB report</button></div>
  <div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Rig / Door</th><th>Operator</th><th>Caliber ID</th><th>Shift</th><th>Drill card</th><th>WO / Contract</th></tr></thead><tbody><tr><td>{cell(data.rigNo||data.rigName)}</td><td>{cell(data.operatorName)}</td><td>{cell(data.caliberId)}</td><td>{cell(data.shiftName)}</td><td>{cell(data.drillCardNo)}</td><td>{cell(data.workOrderContract)}</td></tr></tbody></table></div>
  <h3>HMR readings</h3><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th></th><th>Opening HMR</th><th>Closing HMR</th><th>Running HMR</th></tr></thead><tbody><tr><th>Compressor</th><td>{cell(data.compressorOpening)}</td><td>{cell(data.compressorClosing)}</td><td>{cell(data.compressorRunning)}</td></tr><tr><th>Machine</th><td>{cell(data.machineOpening)}</td><td>{cell(data.machineClosing)}</td><td>{cell(data.machineRunning)}</td></tr></tbody></table></div>
  <h3>Drill job details</h3><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Job type</th><th>No. of holes</th><th>Length of hole</th><th>Total metrage</th><th>Holes/hr</th><th>Meter/hr</th></tr></thead><tbody>{jobs.map(row=><tr key={row.jobType}><td>{row.jobType}</td><td>{cell(row.holes)}</td><td>{cell(row.holeLength)}</td><td>{cell(row.totalMetrage)}</td><td>{cell(row.holesPerHour)}</td><td>{cell(row.metersPerHour)}</td></tr>)}</tbody></table></div>
  <h3>Breakdown details</h3><div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Breakdown</th><th>Start</th><th>End</th><th>Action taken</th><th>Mechanic</th><th>TM execution</th><th>Remark</th></tr></thead><tbody>{breakdowns.length?breakdowns.map((row,index)=><tr key={index}><td>{cell(row.detail)}</td><td>{cell(row.startTime)}</td><td>{cell(row.endTime)}</td><td>{cell(row.actionTaken)}</td><td>{cell(row.mechanic)}</td><td>{cell(row.tmExecution)}</td><td>{cell(row.remark)}</td></tr>):<tr><td colSpan={7}>No breakdown details.</td></tr>}</tbody></table></div>
 </section>;
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
  <TableSmartPrint row title="ELB -- Machine-wise shift report"/>
  <div className="logbook-table-wrap"><table className="logbook-table"><thead><tr>{columns.map(([key,title])=><th key={key} aria-sort={sort.key===key?(sort.direction==='asc'?'ascending':'descending'):'none'}><button type="button" className={'sort-header'+(sort.key===key?' active':'')} onClick={()=>changeSort(key)}><span>{title}</span><span aria-hidden="true">{sort.key===key?(sort.direction==='asc'?'↑':'↓'):'↕'}</span></button></th>)}</tr></thead><tbody>
   {loaders.map(row=><tr key={row.assetId}><td>{row.door}</td><td>{cell(row.equipmentName)}</td><td>{row.trips}</td><td>{cell(row.sourceCards)}</td><td>{cell(row.operator)}</td><td>{cell(row.openingHmr)}</td><td>{cell(row.closingHmr)}</td><td>{cell(row.hours)}</td><td>{cell(row.tripsPerHour)}</td><td>{cell(row.breakdownHours)}</td><td>{label(row)}</td><td>{cell(row.bookNo)}</td></tr>)}
   {!loaders.length&&<tr><td colSpan={12}>No machine loaded trips in this batch.</td></tr>}
   {others.length>0&&<tr className="vlb-machine-report-group"><th colSpan={12}>Other equipment</th></tr>}
   {others.map(row=><tr key={row.assetId}><td>{row.door}</td><td>{cell(row.equipmentName)}</td><td colSpan={5}>{label(row)}</td><td>{cell(row.hours)}</td><td colSpan={2}>{cell(row.idleHours!=null&&row.idleHours!==''?'Idle '+row.idleHours:'')}</td><td colSpan={2}>{cell(row.remark)}</td></tr>)}
  </tbody><tfoot><tr><th colSpan={2}>Totals · {totals.machines??loaders.length+others.length} machines</th><th>{totals.trips??loaders.reduce((sum,row)=>sum+(Number(row.trips)||0),0)}</th><th colSpan={4}/><th>{cell(totals.hours)}</th><th colSpan={4}/></tr></tfoot></table></div>
  <p className="vlb-machine-report-summary">Fleet summary: {totals.machines??loaders.length+others.length} machines · {totals.working??0} working · {totals.down??0} down · {totals.idle??0} idle</p>
 </details>;
}

