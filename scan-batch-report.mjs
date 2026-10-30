import {scanCardContextIssues} from './scan-batch-context.mjs';
import {machineLabel} from './trip-card-rules.mjs';
const number=value=>value===null||value===undefined||String(value).trim()===''||!Number.isFinite(Number(value))?null:Number(value);
const round=value=>Math.round(value*1000)/1000;
const difference=(opening,closing)=>{const a=number(opening),b=number(closing);return a!==null&&b!==null&&b>=a?round(b-a):null};
const sum=values=>{const known=values.filter(v=>v!==null);return known.length?round(known.reduce((a,b)=>a+b,0)):null};
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('-'):value||'';
const states={queued:'Waiting for extraction',reading:'Extracting',review:'Pending correction / saving',approved:'Waiting to save',posted:'Saved',rejected:'Rejected',error:'Extraction failed'};

// Batch membership, rather than date, door or the visible card filter, defines
// this report. Saved totals use the current log book values, never OCR drafts.
export function scanBatchReport(batch,cards=[],options=null){
 if(!batch?.id)return null;
 const vehicle=batch.kind==='vehicle',batchMembers=cards.filter(c=>c.batch_id===batch.id&&c.review_note!=='Removed from batch: wrong date, site or shift'),members=batchMembers.filter(c=>(!batch.expected_context||(!['queued','reading'].includes(c.status)&&!scanCardContextIssues(batch.expected_context,{...c,raw_fields:c.raw_fields||{}},{...c.draft,...(c.status==='posted'?c.saved_data:{})}).length))).slice().sort((a,b)=>a.ordinal-b.ordinal);
 const rows=members.map(card=>{
  const saved=card.status==='posted'&&Boolean(card.saved_data)&&card.saved_data.scanCardId===card.id&&card.saved_data.scanBatchId===batch.id&&!card.logbook_deleted_at;
  const deleted=card.status==='posted'&&Boolean(card.logbook_deleted_at);
  const data=saved?card.saved_data:card.draft||{},raw=card.raw_fields||{};
  const employee=(options?.employees||[]).find(row=>String(row.id)===String(data.employeeId||''));
  const totalTrips=vehicle?(number(data.totalTrips)??sum((data.trips||[]).map(t=>number(t.tripCount)))):null;
  return {id:card.id,ordinal:card.ordinal,saved,deleted,status:deleted?'Deleted log book':card.status==='posted'&&!saved?'Saved values unavailable':states[card.status]||card.status,
   bookNo:card.book_no||'',cardNo:(vehicle?data.aFormNo:data.jobCardNo)||'',bookDate:date(data.bookDate),location:data.location||'',door:data.door||data.doorText||raw.door||'',
   employeeCode:data.caliberId||employee?.caliberId||employee?.employeeCode||raw.employeeCode||'',employeeName:data.employeeName||employee?.name||raw.employeeName||'',shift:data.shiftName||data.cardShift||'',shiftHours:number(data.shiftHours),workOrder:data.workOrderContract||'',
   openingKmr:number(data.openingKmr),closingKmr:number(data.closingKmr),kilometres:vehicle?(number(data.totalRunningKmr)??difference(data.openingKmr,data.closingKmr)):null,
   openingHmr:number(data.openingHmr),closingHmr:number(data.closingHmr),hours:number(data.totalWorkingHmr)??difference(data.openingHmr,data.closingHmr),trips:totalTrips,openingTrips:number(data.openingTrips),endingTrips:number(data.endingTrips),
   filename:card.filename||'',remark:data.remark||'',details:saved?data.trips||[]:[]};
 });
 const saved=rows.filter(r=>r.saved),tripRows=saved.flatMap(card=>card.details.map((t,i)=>({card:card.ordinal,cardNo:card.cardNo,bookNo:card.bookNo,door:card.door,trip:i+1,equipment:machineLabel(t.equipmentName||''),loading:t.loadingTime||'',unloading:t.unloadingTime||'',trips:number(t.completedTrips??t.tripCount)})));
 const machines=new Map();for(const trip of tripRows){if(!trip.equipment||trip.trips===null)continue;const group=machines.get(trip.equipment)||{equipment:trip.equipment,trips:0,cards:new Set(),vehicles:new Set()};group.trips+=trip.trips;group.cards.add(trip.card);group.vehicles.add(trip.door);machines.set(trip.equipment,group);}
 const rejectedCards=batchMembers.filter(card=>card.status==='rejected'),visibleIds=new Set(members.map(card=>card.id));
 const counts={cards:rows.length+rejectedCards.filter(card=>!visibleIds.has(card.id)).length,saved:saved.length,rejected:rejectedCards.length,deleted:rows.filter(c=>c.deleted).length};counts.pending=counts.cards-counts.saved-counts.rejected-counts.deleted;
 const totals={trips:vehicle?sum(saved.map(r=>r.trips)):null,kilometres:vehicle?sum(saved.map(r=>r.kilometres)):null,hours:sum(saved.map(r=>r.hours))};
 const title=`${vehicle?'Trip':'Job'} Card batch report · ${batch.id.slice(0,8)}`;
 const summaryRows=[['Batch ID',batch.id],['Batch name',batch.name||''],['Created',batch.created_at||''],['Cards in this batch',counts.cards],['Saved cards',counts.saved],['Pending / unresolved cards',counts.pending],['Rejected cards',counts.rejected],['Deleted log books',counts.deleted],...(vehicle?[['Trips (saved cards)',totals.trips],['Kilometres (saved cards)',totals.kilometres]]:[]),['Working hours (saved cards)',totals.hours]].map(([metric,value])=>({metric,value}));
 return {contextChecked:Boolean(batch.expected_context),title,batchId:batch.id,name:batch.name||'',vehicle,counts,totals,rows,tripRows,summaryRows,machineRows:[...machines.values()].map(r=>({equipment:r.equipment,trips:r.trips,cards:r.cards.size,vehicles:r.vehicles.size})).sort((a,b)=>a.equipment.localeCompare(b.equipment))};
}

const column=(key,label)=>({key,label,value:row=>row[key]});
export function scanBatchReportTables(report){
 const common=[column('ordinal','Card'),column('status','Status'),column('cardNo','Card number'),column('bookNo','Book number'),column('bookDate','Date'),column('location','Location'),column('door','Door / Equipment'),column('employeeCode','Employee ID'),column('employeeName',report.vehicle?'Driver':'Operator'),column('shift','Shift'),column('shiftHours','Shift hours'),column('workOrder','Work order')];
 const meters=[...(report.vehicle?[column('openingKmr','Opening KMR'),column('closingKmr','Closing KMR'),column('kilometres','Kilometres')]:[]),column('openingHmr','Opening HMR'),column('closingHmr','Closing HMR'),column('hours','Working hours'),...(report.vehicle?[column('openingTrips','Opening trips'),column('endingTrips','Ending trips'),column('trips','Completed trips')]:[])];
 return [{name:'Batch summary',title:report.title+' · Summary',columns:[column('metric','Metric'),column('value','Value')],rows:report.summaryRows},
  {name:'Cards',title:report.title+' · Cards',columns:[...common,...meters,column('filename','Source file'),column('remark','Remarks')],rows:report.contextChecked?report.rows.filter(row=>row.saved):report.rows},
  ...(report.vehicle?[{name:'Individual trips',title:report.title+' · Saved trip details',columns:[column('card','Card'),column('cardNo','Card number'),column('bookNo','Book number'),column('door','Vehicle door'),column('trip','Trip row'),column('equipment','Loading equipment'),column('loading','Loading time'),column('unloading','Unloading time'),column('trips','Trips')],rows:report.tripRows},
   {name:'Loading equipment',title:report.title+' · Saved loading equipment summary',columns:[column('equipment','Loading equipment'),column('cards','Cards'),column('vehicles','Vehicles'),column('trips','Trips')],rows:report.machineRows}]:[])];
}

export function scanBatchExportTables(report,{pdf=false}={}){
 return scanBatchReportTables(report).map((table,i)=>{
  const compact=['ordinal','status','cardNo','bookNo','bookDate','location','door','employeeName','shift','trips','kilometres','hours'];
  if(report.contextChecked&&table.name==='Cards')table={...table,rows:table.rows.filter(row=>row.saved)};
  const columns=pdf&&i===1?table.columns.filter(c=>compact.includes(c.key)):table.columns;
  return {...table,columns:columns.map(c=>({key:c.key,label:c.label})),rows:table.rows.map(row=>columns.map(c=>c.value(row)??''))};
 });
}

/** Apply a confirmed log-book response, irrespective of how the card was reviewed. */
export function applySavedScanCard(card,record){
 const data=record?.data;
 if(!data||data.scanCardId!==card.id||data.scanBatchId!==card.batch_id)return card;
 return {...card,status:'posted',logbook_id:record.id,book_no:record.book_no,saved_data:data,logbook_deleted_at:null,checks:{errors:[],warnings:[]}};
}
