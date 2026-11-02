import {meterCorrectionReport} from '../scan-meter-history.mjs';
import './meter-correction-report.css';
import React,{useState} from 'react';
import {vlbRecordSource} from '../vlb-batch-format.mjs';
import {displaySiteName} from '../region-scope.mjs';

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
export default function VlbBatchReport({batch,ReportSection,onView}){
 const [search,setSearch]=useState('');
 const section=<ReportSection title={'Batch report · '+batch.name} category="vlb-saved-batch" description={`${batch.closed_at?'CLOSED':'OPEN'} · ${batch.records.length} saved cards · ${displaySiteName(batch.site)} · ${batch.report_date} · ${batch.shift}`} columns={onView?[...visibleVlbBatchColumns(batch.records),{key:'details',label:'Details',render:record=><button type="button" onClick={()=>onView(record)}>View VLB</button>}]:visibleVlbBatchColumns(batch.records)} rows={batch.records} rowKey={r=>r.id} showSearch={false} query={search} onResetSearch={()=>setSearch('')} smartPrintAction exportLabel="Generate" emptyMessage="No cards match this search in the opened batch." controls={<div className="generated-report-search"><label>Smart Search<input type="search" data-smart-search aria-label="Smart Search opened batch" placeholder="Card ID, vehicle, driver, source or any report value" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>}/>;
 if(!batch.machineReport)return section;
 return <>{section}<MachineReport report={batch.machineReport} statuses={batch.statuses}/></>;
}
const cell=value=>value===null||value===undefined||value===''?'—':value;
// Machine-wise shift report: loaders with trips and HMR first, then every other machine by status.
export function MachineReport({report,statuses}){
 const loaders=report?.loaders||[],others=report?.others||[],totals=report?.totals||{};
 const label=row=>row.statusLabel||statuses?.[row.status]?.label||row.status||'Not saved';
 return <section className="logbook-section vlb-machine-report" aria-label="Machine-wise shift report"><h2>Machine-wise shift report</h2>
  <div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Door</th><th>Equipment</th><th>Trips</th><th>Cards</th><th>Operator</th><th>Opening HMR</th><th>Closing HMR</th><th>Hours</th><th>Trips/hour</th><th>BD hours</th><th>Status</th><th>ELB no.</th></tr></thead><tbody>
   {loaders.map(row=><tr key={row.assetId}><td>{row.door}</td><td>{cell(row.equipmentName)}</td><td>{row.trips}</td><td>{cell(row.sourceCards)}</td><td>{cell(row.operator)}</td><td>{cell(row.openingHmr)}</td><td>{cell(row.closingHmr)}</td><td>{cell(row.hours)}</td><td>{cell(row.tripsPerHour)}</td><td>{cell(row.breakdownHours)}</td><td>{label(row)}</td><td>{cell(row.bookNo)}</td></tr>)}
   {!loaders.length&&<tr><td colSpan={12}>No machine loaded trips in this batch.</td></tr>}
   {others.length>0&&<tr className="vlb-machine-report-group"><th colSpan={12}>Other equipment</th></tr>}
   {others.map(row=><tr key={row.assetId}><td>{row.door}</td><td>{cell(row.equipmentName)}</td><td colSpan={5}>{label(row)}</td><td>{cell(row.hours)}</td><td colSpan={2}>{cell(row.idleHours!=null&&row.idleHours!==''?'Idle '+row.idleHours:'')}</td><td colSpan={2}>{cell(row.remark)}</td></tr>)}
  </tbody><tfoot><tr><th colSpan={2}>Totals · {totals.machines??loaders.length+others.length} machines</th><th>{totals.trips??loaders.reduce((sum,row)=>sum+(Number(row.trips)||0),0)}</th><th colSpan={4}/><th>{cell(totals.hours)}</th><th colSpan={4}/></tr></tfoot></table></div>
  <p className="vlb-machine-report-summary">Fleet summary: {totals.machines??loaders.length+others.length} machines · {totals.working??0} working · {totals.down??0} down · {totals.idle??0} idle</p>
 </section>;
}

