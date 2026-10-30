import React,{useState} from 'react';
import {vlbRecordSource} from '../vlb-batch-format.mjs';
import {displaySiteName} from '../region-scope.mjs';

export const vlbBatchColumns=[
 {key:'book',label:'Card ID',value:r=>r.book_no},
 {key:'card',label:'Trip card',value:r=>r.data.aFormNo||'—'},
 {key:'source',label:'Source',value:vlbRecordSource},
 {key:'date',label:'Date',value:r=>r.data.bookDate},
 {key:'site',label:'Site',value:r=>displaySiteName(r.data.location)},
 {key:'shift',label:'Shift',value:r=>r.data.bookShiftCode||r.data.cardShift||r.data.shiftName},
 {key:'door',label:'Vehicle',value:r=>r.data.door},
 {key:'driver',label:'Driver',value:r=>r.data.employeeName},
 {key:'employee',label:'Employee ID',value:r=>r.data.caliberId},
 {key:'trips',label:'Trips',value:r=>r.data.completedTrips??r.data.totalTrips},
 {key:'km',label:'Running KMR',value:r=>r.data.totalRunningKmr},
 {key:'hours',label:'Working HMR',value:r=>r.data.totalWorkingHmr},
 {key:'remark',label:'Remark',value:r=>r.data.remark},
];
export default function VlbBatchReport({batch,ReportSection}){
 const [search,setSearch]=useState('');
 return <ReportSection title={'Batch report · '+batch.name} category="vlb-saved-batch" description={`${batch.closed_at?'CLOSED':'OPEN'} · ${batch.records.length} saved cards · ${displaySiteName(batch.site)} · ${batch.report_date} · ${batch.shift}`} columns={vlbBatchColumns} rows={batch.records} rowKey={r=>r.id} showSearch={false} query={search} onResetSearch={()=>setSearch('')} smartPrintAction exportLabel="Generate" emptyMessage="No cards match this search in the opened batch." controls={<div className="generated-report-search"><label>Smart Search<input type="search" data-smart-search aria-label="Smart Search opened batch" placeholder="Card ID, vehicle, driver, source or any report value" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>}/>;
}
