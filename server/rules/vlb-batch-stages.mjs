import {assignmentWindows,logBookAssignment} from '../../shared/log-book-transfers.mjs';
import {transferForAsset} from '../../shared/equipment-transfer-history.mjs';
import {idleShiftHours} from '../../shared/breakdown-hours-source.mjs';
import {validShiftHours,isJayantSite} from '../../shared/site-shift-hours.mjs';
import {cardWorkingHmr,shareCardOperator} from '../../shared/log-book-shared-shift.mjs';
import {assertCombinedShiftMeters} from './log-book-shift-hmr.mjs';
import {manualShiftHours,manualShiftWindow} from '../../shared/manual-shift.mjs';
import {manualEntryShiftIssue} from '../../shared/duty-shift.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {withEquipmentAliases} from '../../shared/equipment-aliases.mjs';
import {displaySiteName} from '../../shared/region-scope.mjs';
import {bookShiftCode} from '../../shared/trip-card-rules.mjs';
import {splitEquipmentOperatorHmr} from '../../shared/surface-miner-hmr.mjs';
import {batchFail,auditVlbBatch,batchLogin,matchingVlbBatch,lockVlbBatchScope,vlbRecordScope} from './vlb-batch-policy.mjs';
import {twoStageEnabled,batchStage,activeSiteHolds,holdSummary,buildMachineSnapshot,buildFleetList,isLdmDrill,elbTripCount,validateFleetEntry,closureBlockers,lockBlockers,fleetProgress,machineReportRows,FLEET_STATUSES,NON_WORKING_STATUSES} from './vlb-two-stage.mjs';
import {pendingTransferFor} from '../routes/vehicle-transfer-express.mjs';

import {readBatchStageWait} from './vlb-batch-queue.mjs';
import {multiDayBatches} from '../../shared/multi-day-batches.mjs';
import {batchLocksPaused} from '../../shared/batch-lock-pause.mjs';
import {batchFleetCoverage} from '../../shared/batch-fleet-coverage.mjs';
import {coverageStop,coverageBlockers} from '../../shared/batch-coverage-stop.mjs';
import {machineRosterShown} from '../../shared/batch-roster-show.mjs';
import {readBatchMachineAnswers} from './batch-machine-answers.mjs';
import {shiftWindow} from '../../shared/pulse-shift-status.mjs';
import {mirrorReadAt} from '../services/pulse-breakdown-mirror.mjs';
import {ACTIVE_VLB_ENTRY_FROM,ACTIVE_VLB_ENTRY_FILTER} from './vlb-card-counts.mjs';
import {readWaitingScans,vlbLockScanBlocker,lmvLockScanBlocker,closeScanBlocker} from './vlb-waiting-scans.mjs';
import {isDrillMachine} from '../../shared/drill-log-book.mjs';
const batchWaitingScans=(client,batch)=>readWaitingScans(client,{site:batch.site,date:batch.report_date,shift:batch.shift});

const fail=batchFail;
async function requireStageTurn(client,batch){
 const wait=await readBatchStageWait(client,batch);
 if(wait)fail(wait,409);
}
const text=value=>String(value??'').trim();
const num=value=>{if(value===''||value===undefined||value===null)return null;const n=Number(value);return Number.isFinite(n)?n:null};

export async function equipmentAssets(client){
 const {rows}=await client.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master'");
 return withEquipmentAliases(client,rows.map(r=>({...r.record_data,id:String(r.id)})));
}
async function shiftMasterFor(client,site,shiftCode){
 const {rows}=await client.query("SELECT id,record_data FROM master_records WHERE master_name='Shift Master'");
 const canonical=canonicalSiteName(site);
 const matches=rows.filter(r=>{const s=r.record_data||{};return canonicalSiteName(s.site||s.siteName)===canonical&&!s.sourceMissing&&String(s.status||'').toLowerCase()!=='inactive'&&(bookShiftCode(s.shiftCode)||bookShiftCode(s.shiftName||s.name))===shiftCode;});
 return matches[0]?{id:String(matches[0].id),...matches[0].record_data}:null;
}
export async function batchVlbRecords(client,batch){
 return (await client.query('SELECT snapshot FROM mis_vlb_batch_entries WHERE batch_id=$1 ORDER BY logbook_id',[batch.id])).rows.map(r=>r.snapshot);
}
export async function batchElbRecords(client,batch){
 const {rows}=await client.query(`SELECT l.id,l.book_no,l.book_type,l.site,l.book_date::text,l.asset_id,l.data,l.revision,l.created_by,l.created_at FROM mis_elb_batch_entries e JOIN mis_log_books l ON l.id=e.logbook_id WHERE e.batch_id=$1 AND l.deleted_at IS NULL ORDER BY l.id`,[batch.id]);
 return rows;
}
export async function fleetRows(client,batch){
 const {rows}=await client.query(`SELECT f.*,f.asset_id::text AS "assetId",f.equipment_name AS "equipmentName",f.equipment_group AS "equipmentGroup",f.source_cards AS "sourceCards",f.shift_status AS "shiftStatus",
  l.book_no,l.data AS logbook,l.revision AS logbook_revision FROM mis_vlb_batch_fleet f LEFT JOIN mis_log_books l ON l.id=f.logbook_id AND l.deleted_at IS NULL WHERE f.batch_id=$1 ORDER BY f.trips DESC,f.door`,[batch.id]);
 return rows.map(row=>({...row,trips:elbTripCount(row),tripExempt:isLdmDrill(row),source_cards:row.sourceCards,saved_at:row.logbook_id&&!row.book_no?null:row.saved_at}));
}
// The batch's saved LMV cards: LMV cards of its site, date and shift.
export async function batchLmvRecords(client,batch){
 const {rows}=await client.query("SELECT id,book_no,book_type,data,revision FROM mis_log_books WHERE book_type='lmv' AND book_date=$1 AND deleted_at IS NULL ORDER BY id",[batch.report_date]);
 return rows.filter(record=>canonicalSiteName(record.data?.location)===canonicalSiteName(batch.site)&&vlbRecordScope(record.data).shift===batch.shift);
}
export async function batchDlbRecords(client,batch){
 const {rows}=await client.query(`SELECT l.id,l.book_no,l.book_type,l.data,l.revision,l.created_at,l.updated_at
  FROM mis_dlb_batch_entries e JOIN mis_log_books l ON l.id=e.logbook_id
  WHERE e.batch_id=$1 AND l.deleted_at IS NULL ORDER BY l.id`,[batch.id]);
 return rows;
}
async function activeVlbCards(client,batch){
 return (await client.query(`SELECT l.id,l.book_no,l.asset_id,l.data FROM ${ACTIVE_VLB_ENTRY_FROM} WHERE e.batch_id=$1 AND ${ACTIVE_VLB_ENTRY_FILTER}`,[batch.id])).rows;
}
// Every machine of the site and its answer for the shift (owner, 25 Nov 2026: shared/batch-fleet-coverage.mjs), with
// whether the batch is stopped until all are answered (shared/batch-coverage-stop.mjs).
// pulseRows: Pulse-II's copy of Pulse's breakdown list as the route read it before the batch lock ({rows} or {error});
// a VLB or LMV machine with a whole-shift breakdown or an idle request in Pulse-1 is answered by it.
export async function machineCoverage(client,batch,{assets,vlbRecords,lmvRecords,fleet,elbRecords,pulseRows}={}){
 assets??=await equipmentAssets(client);
 vlbRecords??=await activeVlbCards(client,batch);
 lmvRecords??=await batchLmvRecords(client,batch);
 fleet??=batchStage(batch)==='vlb_open'?[]:await fleetRows(client,batch);
 elbRecords??=await batchElbRecords(client,batch);
 let pulse={error:pulseRows?.error?String(pulseRows.error.message||pulseRows.error):'Pulse-1 was not read for this page.'};
 if(Array.isArray(pulseRows?.rows)){
  const shift=await shiftMasterFor(client,batch.site,batch.shift);
  let hours=null;try{hours=shift?fleetShiftHours(shift):null;}catch{hours=null;}
  pulse={rows:pulseRows.rows,window:shift&&hours?shiftWindow(batch.report_date,shift.startTime||shift.start,hours):null,readAt:mirrorReadAt(pulseRows.rows)};
 }
 const coverage=batchFleetCoverage({assets,site:batch.site,vlbRecords,lmvRecords,elbFleet:fleet,elbRecords,answers:await readBatchMachineAnswers(client,batch),pulse});
 const stop=coverageStop(batch);
 return {...coverage,mode:stop.active?'stop':'warning',stop};
}
async function machineRows(client,batch){
 return (await client.query('SELECT asset_id::text AS "assetId",machine_label AS label,door,trips,source_cards AS "sourceCards" FROM mis_vlb_batch_machines WHERE batch_id=$1 ORDER BY trips DESC,machine_label',[batch.id])).rows;
}

// Everything the batch page needs for the two-stage view. Holds are re-evaluated here against
// the current Equipment master, so a completed transfer clears them on the next read.
export async function stageDetails(client,batch,{assets,tripCardRecords,vlbCards,lmvRecords,pulseRows}={}){
 if(!twoStageEnabled())return {twoStage:false,stage:batch.closed_at?'closed':'open'};
 assets??=await equipmentAssets(client);
 const stage=batchStage(batch),vlb=await batchVlbRecords(client,batch),elb=await batchElbRecords(client,batch),dlb=await batchDlbRecords(client,batch);
 const holds=[];for(const hold of holdSummary([...vlb,...elb],assets))holds.push({...hold,pendingTransfer:await pendingTransferFor(client,hold.assetId).catch(()=>null)});
 const machines=stage==='vlb_open'?buildMachineSnapshot(vlb,assets,batch.site).machines:await machineRows(client,batch);
 let fleet=stage==='vlb_open'?[]:await fleetRows(client,batch);
 // Extend existing open batches too, without changing any saved ELB or closed snapshot. The batch
 // page reads this every 10 s and each read used to send one INSERT per machine, which did nothing
 // once the machine was listed. The list is now written only for machines the batch does not have
 // yet, in one statement, so the usual read writes nothing.
 if(stage==='elb_open'){
  const listed=new Set(fleet.map(row=>String(row.assetId)));
  const missing=buildFleetList(assets,batch.site,machines).filter(row=>!listed.has(String(row.assetId)));
  if(missing.length){
   await client.query(`INSERT INTO mis_vlb_batch_fleet(batch_id,asset_id,door,equipment_name,equipment_group,trips,source_cards)
    SELECT $1,(r->>'assetId')::bigint,r->>'door',r->>'equipmentName',r->>'equipmentGroup',(r->>'trips')::integer,(r->>'sourceCards')::integer
    FROM jsonb_array_elements($2::jsonb) r ON CONFLICT(batch_id,asset_id) DO NOTHING`,[batch.id,JSON.stringify(missing.map(row=>({assetId:row.assetId,door:row.door,equipmentName:row.equipmentName,equipmentGroup:row.equipmentGroup,trips:row.trips,sourceCards:row.sourceCards})))]);
   fleet=await fleetRows(client,batch);
  }
 }
 const report=stage==='vlb_open'?null:machineReportRows(fleet,elb);
 const shiftSummaries=new Map([...(report?.loaders||[]),...(report?.others||[])].map(row=>[row.assetId,row]));
 for(const row of fleet)row.shiftSummary=shiftSummaries.get(row.assetId);
 const progress=fleetProgress(fleet);
 const duplicates=duplicateElb(elb);
 const elbTripCardRows={};
 if(tripCardRecords&&elb.length){
  const elbAssets=new Set(elb.map(record=>String(record.asset_id||record.data?.assetId)));
  buildMachineSnapshot(tripCardRecords,assets,batch.site,(assetId,record,index)=>{
   if(!elbAssets.has(assetId))return;
   const cards=elbTripCardRows[assetId]??={};
   (cards[record.id]??=[]).push(index);
  });
 }
 const waitingScans=stage==='closed'?[]:await batchWaitingScans(client,batch);
 const lmvWaiting=stage==='lmv_open'?lmvLockScanBlocker(waitingScans):'';
 // The sentence this stage's next step is refused with; the page shows it once, as the waiting list.
 const waitingScanMessage=stage==='vlb_open'?vlbLockScanBlocker(waitingScans):stage==='lmv_open'?lmvWaiting:stage==='elb_open'?closeScanBlocker(waitingScans):'';
 // Every machine of the site needs an answer; from the stop date (shared/batch-coverage-stop.mjs) it stops Lock VLB,
 // Lock LMV and Close batch, before that it only warns.
 // The panel is shown from 27 Nov 2026 (shared/batch-roster-show.mjs); before that it is read only when the stop applies.
 const rosterShown=machineRosterShown();
 const coverage=rosterShown||coverageStop(batch).active?await machineCoverage(client,batch,{assets,vlbRecords:vlbCards,lmvRecords,fleet,elbRecords:elb,pulseRows}):null;
 const fleetCoverage=rosterShown?coverage:null,stop=coverage?.stop;
 return {twoStage:true,stage,stageWait:await readBatchStageWait(client,batch),holds,machines,fleet,fleetProgress:progress,elbRecords:elb,dlbRecords:dlb,elbTripCardRows,waitingScans,waitingScanMessage,fleetCoverage,
  lockBlockers:stage==='vlb_open'?[...lockBlockers({stage,records:vlb,holds,unresolved:buildMachineSnapshot(vlb,assets,batch.site).unresolved,waitingScans}),...coverageBlockers(coverage,['vlb'],stop)]:[],
  lmvLockBlockers:stage==='lmv_open'?[...(lmvWaiting?[lmvWaiting]:[]),...coverageBlockers(coverage,['lmv'],stop)]:[],
  closeBlockers:stage==='elb_open'?[...closureBlockers({stage,fleet,holds,duplicates,waitingScans}),...coverageBlockers(coverage,['vlb','elb','lmv'],stop)]:[],machineReport:report,statuses:FLEET_STATUSES};
}
function duplicateElb(records){
 const byAsset=new Map(),duplicates=new Set();
 for(const record of records){
  const data=record.data||{},key=String(record.asset_id||data.assetId);
  const peers=byAsset.get(key)||[];
  if(peers.some(peer=>shareCardOperator(data,peer)))duplicates.add(data.door||key);
  peers.push(data);
  byAsset.set(key,peers);
 }
 return [...duplicates];
}

// Late cards update derived trip totals without reopening batches or editing saved cards.
export async function refreshLateVlbTrips(client,batch){
 const assets=await equipmentAssets(client),records=await batchVlbRecords(client,batch);
 const {machines}=buildMachineSnapshot(records,assets,batch.site);
 if(machines.length)await client.query(`INSERT INTO mis_vlb_batch_machines(batch_id,asset_id,machine_label,door,trips,source_cards)
  SELECT $1,(r->>'assetId')::bigint,r->>'label',r->>'door',(r->>'trips')::integer,(r->>'sourceCards')::integer
  FROM jsonb_array_elements($2::jsonb) r
  ON CONFLICT(batch_id,asset_id) DO UPDATE SET trips=EXCLUDED.trips,source_cards=EXCLUDED.source_cards`,[batch.id,JSON.stringify(machines)]);
 const fleet=buildFleetList(assets,batch.site,machines);
 if(fleet.length)await client.query(`INSERT INTO mis_vlb_batch_fleet(batch_id,asset_id,door,equipment_name,equipment_group,trips,source_cards)
  SELECT $1,(r->>'assetId')::bigint,r->>'door',r->>'equipmentName',r->>'equipmentGroup',(r->>'trips')::integer,(r->>'sourceCards')::integer
  FROM jsonb_array_elements($2::jsonb) r
  ON CONFLICT(batch_id,asset_id) DO UPDATE SET trips=EXCLUDED.trips,source_cards=EXCLUDED.source_cards`,[batch.id,JSON.stringify(fleet)]);
 // A machine no card loads any more (a VLB card changed while locking is paused) keeps its line at 0 trips,
 // so Close batch does not ask for an ELB of trips that are gone.
 const loading=machines.map(machine=>Number(machine.assetId));
 await client.query('UPDATE mis_vlb_batch_machines SET trips=0,source_cards=0 WHERE batch_id=$1 AND NOT (asset_id=ANY($2::bigint[]))',[batch.id,loading]);
 await client.query('UPDATE mis_vlb_batch_fleet SET trips=0,source_cards=0 WHERE batch_id=$1 AND trips>0 AND NOT (asset_id=ANY($2::bigint[]))',[batch.id,loading]);
}

export async function lockVlb(client,batch,actor,{assets,pulseRows}={}){
 if(!twoStageEnabled())fail('Two-stage batches are not enabled on this platform.',409);
 assets??=await equipmentAssets(client);
 const stage=batchStage(batch),records=await batchVlbRecords(client,batch),holds=holdSummary(records,assets);
 const snapshot=buildMachineSnapshot(records,assets,batch.site);
 const blockers=lockBlockers({stage,records,holds,unresolved:snapshot.unresolved,waitingScans:stage==='vlb_open'?await batchWaitingScans(client,batch):[]});
 // From the stop date every VLB machine of the site needs an answer first (shared/batch-coverage-stop.mjs).
 if(!blockers.length&&coverageStop(batch).active){const coverage=await machineCoverage(client,batch,{assets,fleet:[],pulseRows});blockers.push(...coverageBlockers(coverage,['vlb'],coverage.stop));}
 if(blockers.length)fail(blockers.join(' '),409);
 await client.query('DELETE FROM mis_vlb_batch_machines WHERE batch_id=$1',[batch.id]);
 // The machine list and the site's fleet list are each written in one statement. Until 23 Nov 2026
 // every line was a statement of its own (a site lists 150 to 300 machines), all inside the site,
 // date and shift lock, while the card saves of that shift waited.
 if(snapshot.machines.length)await client.query(`INSERT INTO mis_vlb_batch_machines(batch_id,asset_id,machine_label,door,trips,source_cards)
  SELECT $1,(r->>'assetId')::bigint,r->>'label',r->>'door',(r->>'trips')::integer,(r->>'sourceCards')::integer
  FROM jsonb_array_elements($2::jsonb) r`,[batch.id,JSON.stringify(snapshot.machines.map(m=>({assetId:m.assetId,label:m.label,door:m.door,trips:m.trips,sourceCards:m.sourceCards})))]);
 const fleet=buildFleetList(assets,batch.site,snapshot.machines);
 // One line per machine: a statement may not write the same machine twice, and the last line for a
 // machine is the one the line-by-line write left in place.
 const fleetLines=[...new Map(fleet.map(row=>[String(row.assetId),{assetId:row.assetId,door:row.door,equipmentName:row.equipmentName,equipmentGroup:row.equipmentGroup,trips:row.trips,sourceCards:row.sourceCards}])).values()];
 if(fleetLines.length)await client.query(`INSERT INTO mis_vlb_batch_fleet(batch_id,asset_id,door,equipment_name,equipment_group,trips,source_cards,draft)
  SELECT $1,(r->>'assetId')::bigint,r->>'door',r->>'equipmentName',r->>'equipmentGroup',(r->>'trips')::integer,(r->>'sourceCards')::integer,NULL
  FROM jsonb_array_elements($2::jsonb) r
  ON CONFLICT(batch_id,asset_id) DO UPDATE SET door=EXCLUDED.door,equipment_name=EXCLUDED.equipment_name,equipment_group=EXCLUDED.equipment_group,trips=EXCLUDED.trips,source_cards=EXCLUDED.source_cards,draft=NULL`,[batch.id,JSON.stringify(fleetLines)]);
 await client.query('DELETE FROM mis_vlb_batch_fleet WHERE batch_id=$1 AND logbook_id IS NULL AND NOT (asset_id=ANY($2::bigint[]))',[batch.id,fleet.map(r=>Number(r.assetId))]);
 const locked=(await client.query("UPDATE mis_vlb_batches SET stage='lmv_open',lmv_locked_at=NULL,dlb_locked_at=NULL,vlb_locked_at=NOW(),vlb_locked_by=$2 WHERE id=$1 RETURNING *,book_date::text AS report_date",[batch.id,batchLogin(actor)])).rows[0];
 await auditVlbBatch(client,batch,actor,'vlb_locked',{machines:snapshot.machines,fleetCount:fleet.length,linkedElbEntries:fleet.filter(row=>Number(row.trips)>0).length,cards:records.length});
 return locked;
}

export async function unlockVlb(client,batch,actor,{reason='',approvedBy=null,via='screen'}={}){
 if(!['lmv_open','dlb_open','elb_open'].includes(batchStage(batch)))fail(batch.closed_at?'Reopen the batch before unlocking VLB.':'VLB is not locked for this batch.',409);
 // Unlock routes hold the exclusive batch write lock because this can make a later stage wait again.
 const {rows}=await client.query("SELECT site,name FROM mis_vlb_batches WHERE id<>$1 AND book_date=$2 AND stage='vlb_open' AND closed_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL AND book_date>=$$2026-11-01$$",[batch.id,batch.report_date||batch.book_date]);
 // While several shifts of a date may be open together (shared/multi-day-batches.mjs) another VLB-open batch does not stop it.
 const active=!multiDayBatches()&&rows.find(row=>canonicalSiteName(row.site)===canonicalSiteName(batch.site));
 if(active)fail('Lock VLB in '+active.name+' before unlocking VLB for this batch.',409);
 await client.query('DELETE FROM mis_vlb_batch_machines WHERE batch_id=$1',[batch.id]);
 const opened=(await client.query("UPDATE mis_vlb_batches SET stage='vlb_open',lmv_locked_at=NULL,dlb_locked_at=NULL,vlb_locked_at=NULL,vlb_locked_by=NULL WHERE id=$1 RETURNING *,book_date::text AS report_date",[batch.id])).rows[0];
 await auditVlbBatch(client,batch,actor,'vlb_unlocked',{reason,via,...(approvedBy?{approvedBy}:{})});
 return opened;
}

export async function assertCloseAllowed(client,batch,{assets,pulseRows}={}){
 if(!twoStageEnabled())return;
 if(batchStage(batch)!=='elb_open')fail('Lock VLB, LMV and DLB before closing the batch.',409);
 const details=await stageDetails(client,batch,{assets,pulseRows});
 if(details.stageWait)fail(details.stageWait,409);
 if(details.closeBlockers.length)fail(details.closeBlockers.join(' '),409);
}

export async function saveFleetDraft(client,batch,assetId,draft,actor){
 if(batchStage(batch)!=='elb_open')fail('Machine entry is available only while ELB is open for this batch.',409);
 await requireStageTurn(client,batch);
 const row=(await client.query('UPDATE mis_vlb_batch_fleet SET draft=NULL,skipped=COALESCE($3,skipped) WHERE batch_id=$1 AND asset_id=$2 RETURNING *',[batch.id,assetId,typeof draft?.skipped==='boolean'?draft.skipped:null])).rows[0];
 if(!row)fail('This machine is not in the batch fleet list.',404);
 return row;
}

export function fleetShiftHours(shift){
 const minutes=value=>{const m=text(value).match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
 const a=minutes(shift.startTime||shift.start),b=minutes(shift.endTime||shift.end),hours=a!==null&&b!==null?((b-a+1440)%1440)/60:null;
 if(!validShiftHours(hours,shift))fail('The batch Shift Master must have a valid 8- or 12-hour start/end time.',409);
 return hours;
}
export async function readFleetBreakdowns(client,batch,assetId,readHours,actor,input={}){
 if(typeof readHours!=='function')fail('Pulse breakdown lookup is unavailable.',503);
 const row=(await client.query('SELECT asset_id FROM mis_vlb_batch_fleet WHERE batch_id=$1 AND asset_id=$2',[batch.id,assetId])).rows[0];
 if(!row)fail('This machine is not in the batch fleet list.',404);
 return readBatchShiftBreakdowns(client,batch,assetId,readHours,actor,input);
}
// Pulse-1 breakdown hours of one ELB fleet machine for the batch's date, site and shift.
async function readBatchShiftBreakdowns(client,batch,assetId,readHours,actor,input={}){
 if(typeof readHours!=='function')fail('Pulse breakdown lookup is unavailable.',503);
 const shift=await shiftMasterFor(client,batch.site,batch.shift);
 if(!shift)fail('No active Shift Master entry matches this batch.',409);
 const shiftHours=input.shiftHours!==undefined&&input.shiftHours!==''?manualShiftHours({...input,location:batch.site,bookShiftCode:batch.shift}):fleetShiftHours(shift);
 const pulse=await readHours({bookDate:batch.report_date,location:displaySiteName(batch.site),assetId:String(assetId),shiftId:shift.id,bookShiftCode:batch.shift,shiftHours,manualEntry:input.shiftHours!==undefined,manualShift:input.manualShift,actor});
 if(pulse?.breakdownHours===null||pulse?.breakdownHours===undefined||!Number.isFinite(Number(pulse.breakdownHours))||Number(pulse.breakdownHours)<0||Number(pulse.breakdownHours)>shiftHours)fail('Pulse returned invalid breakdown hours for this shift.',502);
 return {...pulse,assetId:String(assetId),bookDate:batch.report_date,location:displaySiteName(batch.site),shift:batch.shift,shiftHours};
}

// Save one machine from the stepper dialog as a real equipment log book, linked to the batch.
export async function saveFleetEntry(client,batch,assetId,input,actor,ops){
 if(batchStage(batch)!=='elb_open')fail('Machine entry is available only while ELB is open for this batch.',409);
 await requireStageTurn(client,batch);
 const row=(await client.query('SELECT * FROM mis_vlb_batch_fleet WHERE batch_id=$1 AND asset_id=$2 FOR UPDATE',[batch.id,assetId])).rows[0];
 if(!row)fail('This machine is not in the batch fleet list.',404);
 const additional=input.additionalCard===true;
 if(additional&&!row.logbook_id)fail('Save the first ELB card before adding a relief operator.',409);
 if(row.logbook_id&&!additional){
  if(!ops.allowEditSaved)fail('Only an MIS user or MIS administrator can edit a saved ELB.',403);
  const prior=(await client.query('SELECT revision FROM mis_log_books WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[row.logbook_id])).rows[0];
  if(!prior)fail('This ELB is unavailable. Reload the batch.',409);
  if(Number(input.revision)!==Number(prior.revision))fail('This ELB changed. Reload the batch before editing.',409);
 }
 // Shift and Shift Hrs are mandatory on every manual ELB (owner, 24 Nov 2026; shared/duty-shift.mjs): the user picks the
 // batch shift, Day or Night, and 8 or 12 Hrs; Day and Night are 12 hours. 'batch' is saved as no override ('').
 const shiftIssue=manualEntryShiftIssue({choice:text(input.manualShift),shiftHours:input.shiftHours,flexibleHours:isJayantSite({site:batch.site}),batchShift:batch.shift});
 if(shiftIssue)throw Object.assign(new Error(shiftIssue),{status:400,fields:{manualShift:shiftIssue}});
 input={...input,manualShift:input.manualShift==='batch'?'':input.manualShift};
 let operatorSplit;
 if(text(input.secondOperatorId)||text(input.handoverHmr)){
  if(input.entryMode!=='working-only')fail('Two operators can share a shift only in ELB Manual working entry.',400);
  operatorSplit=splitEquipmentOperatorHmr(input);
  if(operatorSplit.error)fail(operatorSplit.error,400);
 }
 const shiftHours=input.shiftHours!==undefined&&input.shiftHours!==''?manualShiftHours({...input,location:batch.site,bookShiftCode:batch.shift}):null;
 const shift=await shiftMasterFor(client,batch.site,batch.shift);
 if(!shift)fail('No active Shift Master entry matches this batch shift at this site. Correct the Shift Master first.',409);
 const hours=isJayantSite({site:batch.site})?fleetShiftHours(shift):input.entryMode==='working-only'?(shiftHours||fleetShiftHours(shift)):shiftHours||(()=>{const start=text(shift.startTime||shift.start),end=text(shift.endTime||shift.end);const m=v=>{const p=v.match(/^(\d{1,2}):(\d{2})/);return p?Number(p[1])*60+Number(p[2]):null};const a=m(start),b=m(end);const span=a!==null&&b!==null?((b-a+1440)%1440)/60:8;return span===12?12:8;})();
 const asset=(await client.query("SELECT record_data FROM master_records WHERE master_name='Equipment master' AND id=$1",[assetId])).rows[0]?.record_data;
 const transfers=asset?(await client.query("SELECT record_data FROM master_records WHERE master_name='Vehicle transfers'")).rows.map(row=>row.record_data).filter(move=>transferForAsset(move,{...asset,id:assetId})):[];
 const shiftMasters=['day','night'].includes(input.manualShift)?(await client.query("SELECT id,record_data FROM master_records WHERE master_name='Shift Master'")).rows.map(row=>({...row.record_data,id:String(row.id)})):[];
 const window=manualShiftWindow({...input,location:batch.site,shiftHours:hours},shift,shiftMasters)||shift;
 const portion=logBookAssignment(assignmentWindows({...asset,id:assetId},transfers),batch.site,batch.report_date,window.startTime||window.start,hours);
 const scheduled=portion?.partial?Math.round((portion.end-portion.start)/3600)/1000:hours;
 let pulse=null;
 if(input.entryMode==='working-only'){
  pulse=await readFleetBreakdowns(client,batch,assetId,ops.readHours,actor,{...input,shiftHours:hours});
  const actualHours=num(input.openingHmr)!==null&&num(input.closingHmr)!==null?num(input.closingHmr)-num(input.openingHmr):null;
  const bd=Number(pulse.breakdownHours),zero=actualHours===0&&elbTripCount(row)===0;
  const shiftStatus=zero?(bd>=scheduled?'breakdown':'not_in_use'):bd>0&&bd<scheduled?'working_partial_breakdown':'working';
  const breakdownReason=(pulse.breakdowns||[]).map(item=>text(item.description)||text(item.reference)).filter(Boolean).join('; ').slice(0,2000);
  input={...input,shiftStatus,manualBreakdownHours:bd,statusReason:text(input.statusReason)||breakdownReason||(bd>0?'Breakdown recorded in Pulse':'')};
 }
 const {errors,status,hours:workingHours,breakdownHours}=validateFleetEntry(input,{trips:elbTripCount(row),shiftHours:scheduled});
 if(Object.keys(errors).length)throw Object.assign(new Error(Object.values(errors).join(' ')),{status:400,fields:errors});
 const nonWorking=NON_WORKING_STATUSES.includes(status);
 const opening=num(input.openingHmr),closing=num(input.closingHmr);
 const body={bookDate:batch.report_date,bookDateSource:'batch',location:displaySiteName(batch.site),assetId:String(assetId),employeeId:nonWorking&&!text(input.employeeId)?null:text(input.employeeId),shiftId:shift.id,shiftHours:hours,manualShift:input.manualShift,
  workOrderId:batch.work_order_id,jobDetails:input.jobDetails,openingHmr:opening??(nonWorking?0:''),closingHmr:closing??(nonWorking?(opening??0):''),jobCardNo:text(input.jobCardNo),remark:text(input.remark),timeMode:'without',
  manualBreakdownHours:(status==='breakdown'&&!pulse?input.manualBreakdownHours:breakdownHours)??'',shiftStatus:status,statusReason:text(input.statusReason),breakdownDetails:Array.isArray(input.breakdownDetails)?input.breakdownDetails:undefined,
  idleHoursEntered:num(input.idleHours),batchId:batch.id,fleetTrips:elbTripCount(row),bookShiftCode:batch.shift};
 const data=await ops.resolve(client,'equipment',body,{...(operatorSplit?{operatorSplit,enforceEmployeeSite:true}:{}),manualEntry:true});
 Object.assign(data,{shiftStatus:status,statusReason:body.statusReason,fleetTrips:elbTripCount(row),batchId:batch.id,bookShiftCode:batch.shift,entrySource:'batch-fleet'});
 if(workingHours!==null)data.totalWorkingHmr=workingHours;
 if(pulse){
  const remainingHours=idleShiftHours(data.scheduledHours??hours,data.totalWorkingHmr,pulse.breakdownHours);
  data.idleHours=remainingHours!==null&&remainingHours>=0?remainingHours:null;
  Object.assign(data,{breakdownHours:Number(pulse.breakdownHours),breakdownHoursSource:'pulse',manualBreakdownHours:null,hoursSource:pulse,pulseBreakdowns:pulse.breakdowns||[],elbEntryMode:'working-only'});
 }else if(ops.applyHours)await ops.applyHours(data);
 if(nonWorking){data.availabilityHours=0;data.runningHours=0;data.idleHours=idleShiftHours(data.scheduledHours??hours,0,data.breakdownHours);}
 if(additional){
  const cards=(await batchElbRecords(client,batch)).filter(record=>String(record.asset_id)===String(assetId));
  const retry=input.requestKey&&(await client.query('SELECT id FROM mis_log_books WHERE request_key=$1',[input.requestKey])).rows[0];
  if(retry){
   const prior=cards.find(card=>String(card.id)===String(retry.id));
   if(prior)return prior;
   fail('This save reference already belongs to another card.',409);
  }
  if(!(cardWorkingHmr(data)>0)||cards.some(card=>shareCardOperator(data,card.data)))fail('Enter positive working HMR and an operator who has no card for this machine and shift.',409);
  const previous=cards.find(card=>String(card.id)===String(row.logbook_id))?.data;
  if(previous&&(text(previous.manualShift)!==text(data.manualShift)||Number(previous.shiftHours)!==hours))fail('Use the same shift and shift hours as the saved ELB card.',409);
 }
 let record;
 if(row.logbook_id&&!additional){
  await assertCombinedShiftMeters(client,'equipment',data,row.logbook_id,batch);
  const result=await client.query('UPDATE mis_log_books SET data=$1::jsonb,updated_at=NOW(),revision=revision+1 WHERE id=$2 AND deleted_at IS NULL RETURNING id,book_no,book_type,book_date::text,site,asset_id,data,revision,created_at,updated_at',[JSON.stringify(data),row.logbook_id]);
  record=result.rows[0];
 }
 if(!record)record=await ops.insert(client,'equipment',data,input.requestKey||crypto.randomUUID(),batchLogin(actor));
 await client.query('INSERT INTO mis_elb_batch_entries(batch_id,logbook_id,snapshot) VALUES($1,$2,$3::jsonb) ON CONFLICT(logbook_id) DO UPDATE SET snapshot=EXCLUDED.snapshot',[batch.id,record.id,JSON.stringify(record)]);
 await client.query('UPDATE mis_vlb_batch_fleet SET shift_status=$3,logbook_id=$4,saved_at=NOW(),saved_by=$5,draft=NULL,skipped=FALSE WHERE batch_id=$1 AND asset_id=$2',[batch.id,assetId,status,record.id,batchLogin(actor)]);
 await auditVlbBatch(client,batch,actor,row.logbook_id&&!additional?'machine_updated':'machine_saved',{assetId:String(assetId),door:row.door,status,trips:row.trips,logbookId:record.id});
 return record;
}

export async function lockLmv(client,batch,actor,{pulseRows}={}){
 if(!twoStageEnabled()||batchStage(batch)!=='lmv_open')fail('LMV must be open before it can be locked.',409);
 await requireStageTurn(client,batch);
 const waiting=lmvLockScanBlocker(await batchWaitingScans(client,batch));
 if(waiting)fail(waiting,409);
 // From the stop date every LMV machine of the site needs an answer first (shared/batch-coverage-stop.mjs).
 if(coverageStop(batch).active){const coverage=await machineCoverage(client,batch,{pulseRows});const blockers=coverageBlockers(coverage,['lmv'],coverage.stop);if(blockers.length)fail(blockers.join(' '),409);}
 const locked=(await client.query("UPDATE mis_vlb_batches SET stage='dlb_open',lmv_locked_at=NOW(),dlb_locked_at=NULL WHERE id=$1 RETURNING *,book_date::text AS report_date",[batch.id])).rows[0];
 await auditVlbBatch(client,batch,actor,'lmv_locked');
 return locked;
}

export async function lockDlb(client,batch,actor){
 if(!twoStageEnabled()||batchStage(batch)!=='dlb_open')fail('DLB must be open before it can be locked.',409);
 await requireStageTurn(client,batch);
 const assets=await equipmentAssets(client);
 const drills=assets.filter(asset=>isDrillMachine(asset)&&canonicalSiteName(asset.currentLocation||asset.site||asset.location)===canonicalSiteName(batch.site));
 const saved=await batchDlbRecords(client,batch);
 const locked=(await client.query("UPDATE mis_vlb_batches SET stage='elb_open',dlb_locked_at=NOW() WHERE id=$1 RETURNING *,book_date::text AS report_date",[batch.id])).rows[0];
 await auditVlbBatch(client,batch,actor,'dlb_locked',{cards:saved.length,siteDrills:drills.length});
 return locked;
}

export async function assertLmvBatchWrite(client,data){
 if(!twoStageEnabled())return null;
 await lockVlbBatchScope(client,vlbRecordScope(data));
 const batch=await matchingVlbBatch(client,data);
 // While locking is paused LMV cards are saved in every open stage (shared/batch-lock-pause.mjs).
 const lmvStage=batch&&(batchLocksPaused()?batchStage(batch)!=='closed':batchStage(batch)==='lmv_open');
 if(!batch||batch.deleted_at||batch.archived_at||!lmvStage)fail('Select an existing Vehicle Log Book batch open for LMV entry before saving or changing LMV cards.',409);
 await requireStageTurn(client,batch);
 return batch;
}

// ELB cards exist only inside the site/date/shift batch, and only after its VLB is locked.
// Closed batches accept new cards while existing cards still require reopening.
export async function assertElbBatchWrite(client,data,{adding=false}={}){
 if(!twoStageEnabled())return null;
 await lockVlbBatchScope(client,vlbRecordScope(data));
 const batch=await matchingVlbBatch(client,{location:data.location,bookDate:data.bookDate,bookShiftCode:data.bookShiftCode,cardShift:data.cardShift,shiftName:data.shiftName});
 if(!batch)fail('Create the VLB batch for this site, date and shift and lock VLB before saving ELB cards. Standalone ELB saving is discontinued.',409);
 if(batch.archived_at||batch.deleted_at)fail('This batch is unavailable. Open an active site/date/shift batch before saving.',409);
 const stage=batchStage(batch);
 // While locking is paused ELB cards are saved before VLB and LMV are locked too; Lock VLB keeps them.
 if((stage==='vlb_open'||stage==='lmv_open'||stage==='dlb_open')&&!batchLocksPaused())fail('Lock VLB, LMV and DLB for batch '+batch.name+' before saving ELB cards.',409);
 if(stage==='closed'&&batch.lmv_locked_at)fail('This batch is locked. Reopen it before saving ELB cards.',409);
 if(stage==='closed'&&!adding)fail('Batch '+batch.name+' is closed. Reopen it before changing existing ELB cards.',409);
 await requireStageTurn(client,batch);
 return batch;
}

// An equipment log book saved through the normal form, scan, upload or the fleet stepper joins the
// ELB stage or closed batch and marks that machine's fleet row as saved.
export async function syncElbBatchRecord(client,record,actor){
 if(!twoStageEnabled()||record.book_type!=='equipment')return null;
 const data=record.data||{};
 const linked=(await client.query('SELECT logbook_id FROM mis_elb_batch_entries WHERE logbook_id=$1',[record.id])).rows[0];
 const batch=await assertElbBatchWrite(client,data,{adding:!linked});
 await client.query('INSERT INTO mis_elb_batch_entries(batch_id,logbook_id,snapshot) VALUES($1,$2,$3::jsonb) ON CONFLICT(logbook_id) DO UPDATE SET snapshot=EXCLUDED.snapshot',[batch.id,record.id,JSON.stringify(record)]);
 if(linked)await client.query(`UPDATE mis_vlb_batch_fleet f SET (logbook_id,shift_status,saved_at,saved_by)=(
  SELECT l.id,COALESCE(NULLIF(l.data->>'shiftStatus',''),'working'),l.updated_at,l.created_by
  FROM mis_elb_batch_entries e JOIN mis_log_books l ON l.id=e.logbook_id
  WHERE e.batch_id=f.batch_id AND l.asset_id=f.asset_id AND l.deleted_at IS NULL ORDER BY l.id DESC LIMIT 1
 ) WHERE f.batch_id=$1 AND f.logbook_id=$2 AND f.asset_id<>$3`,[batch.id,record.id,record.asset_id||data.assetId]);
 const status=FLEET_STATUSES[data.shiftStatus]?data.shiftStatus:'working';
 const updated=await client.query('UPDATE mis_vlb_batch_fleet SET shift_status=$3,logbook_id=$4,saved_at=NOW(),saved_by=$5,draft=NULL,skipped=FALSE WHERE batch_id=$1 AND asset_id=$2 RETURNING asset_id',[batch.id,record.asset_id||data.assetId,status,record.id,batchLogin(actor)]);
 if(!updated.rowCount)await client.query(`INSERT INTO mis_vlb_batch_fleet(batch_id,asset_id,door,equipment_name,equipment_group,trips,source_cards,shift_status,logbook_id,saved_at,saved_by) VALUES($1,$2,$3,$4,'',0,0,$5,$6,NOW(),$7) ON CONFLICT DO NOTHING`,[batch.id,record.asset_id||data.assetId,text(data.door),text(data.assetName),status,record.id,batchLogin(actor)]);
 await auditVlbBatch(client,batch,actor,'elb_card_linked',{logbookId:record.id,bookNo:record.book_no,door:data.door});
 return batch;
}

export const stageHoldsFor=(records,assets)=>records.map(record=>({id:record.id,holds:activeSiteHolds(record,assets)})).filter(entry=>entry.holds.length);
