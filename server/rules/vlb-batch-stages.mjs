import {cardWorkingHmr,shareCardOperator} from '../../shared/log-book-shared-shift.mjs';
import {assertCombinedShiftMeters} from './log-book-shift-hmr.mjs';
import {manualShiftHours} from '../../shared/manual-shift.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {withEquipmentAliases} from '../../shared/equipment-aliases.mjs';
import {displaySiteName} from '../../shared/region-scope.mjs';
import {bookShiftCode} from '../../shared/trip-card-rules.mjs';
import {isSurfaceMiner,splitSurfaceMinerHmr} from '../../shared/surface-miner-hmr.mjs';
import {batchFail,auditVlbBatch,batchLogin,matchingVlbBatch,lockVlbBatchScope,vlbRecordScope} from './vlb-batch-policy.mjs';
import {twoStageEnabled,batchStage,activeSiteHolds,holdSummary,buildMachineSnapshot,buildFleetList,isLdmDrill,elbTripCount,validateFleetEntry,closureBlockers,lockBlockers,fleetProgress,machineReportRows,FLEET_STATUSES,NON_WORKING_STATUSES} from './vlb-two-stage.mjs';
import {pendingTransferFor} from '../routes/vehicle-transfer-express.mjs';

const fail=batchFail;
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
async function machineRows(client,batch){
 return (await client.query('SELECT asset_id::text AS "assetId",machine_label AS label,door,trips,source_cards AS "sourceCards" FROM mis_vlb_batch_machines WHERE batch_id=$1 ORDER BY trips DESC,machine_label',[batch.id])).rows;
}

// Everything the batch page needs for the two-stage view. Holds are re-evaluated here against
// the current Equipment master, so a completed transfer clears them on the next read.
export async function stageDetails(client,batch,{assets}={}){
 if(!twoStageEnabled())return {twoStage:false,stage:batch.closed_at?'closed':'open'};
 assets??=await equipmentAssets(client);
 const stage=batchStage(batch),vlb=await batchVlbRecords(client,batch),elb=await batchElbRecords(client,batch);
 const holds=[];for(const hold of holdSummary([...vlb,...elb],assets))holds.push({...hold,pendingTransfer:await pendingTransferFor(client,hold.assetId).catch(()=>null)});
 const machines=stage==='vlb_open'?buildMachineSnapshot(vlb,assets,batch.site).machines:await machineRows(client,batch);
 // Extend existing open batches too, without changing any saved ELB or closed snapshot.
 if(stage==='elb_open')for(const row of buildFleetList(assets,batch.site,machines))await client.query('INSERT INTO mis_vlb_batch_fleet(batch_id,asset_id,door,equipment_name,equipment_group,trips,source_cards) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(batch_id,asset_id) DO NOTHING',[batch.id,row.assetId,row.door,row.equipmentName,row.equipmentGroup,row.trips,row.sourceCards]);
 const fleet=stage==='vlb_open'?[]:await fleetRows(client,batch);
 const report=stage==='vlb_open'?null:machineReportRows(fleet,elb);
 const shiftSummaries=new Map([...(report?.loaders||[]),...(report?.others||[])].map(row=>[row.assetId,row]));
 for(const row of fleet)row.shiftSummary=shiftSummaries.get(row.assetId);
 const progress=fleetProgress(fleet);
 const duplicates=duplicateElb(elb);
 return {twoStage:true,stage,holds,machines,fleet,fleetProgress:progress,elbRecords:elb,lockBlockers:stage==='vlb_open'?lockBlockers({stage,records:vlb,holds,unresolved:buildMachineSnapshot(vlb,assets,batch.site).unresolved}):[],closeBlockers:stage==='elb_open'?closureBlockers({stage,fleet,holds,duplicates}):[],machineReport:report,statuses:FLEET_STATUSES};
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
 for(const m of machines){
  await client.query('INSERT INTO mis_vlb_batch_machines(batch_id,asset_id,machine_label,door,trips,source_cards) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(batch_id,asset_id) DO UPDATE SET trips=EXCLUDED.trips,source_cards=EXCLUDED.source_cards',[batch.id,m.assetId,m.label,m.door,m.trips,m.sourceCards]);
 }
 for(const row of buildFleetList(assets,batch.site,machines))await client.query('INSERT INTO mis_vlb_batch_fleet(batch_id,asset_id,door,equipment_name,equipment_group,trips,source_cards) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(batch_id,asset_id) DO UPDATE SET trips=EXCLUDED.trips,source_cards=EXCLUDED.source_cards',[batch.id,row.assetId,row.door,row.equipmentName,row.equipmentGroup,row.trips,row.sourceCards]);
}

export async function lockVlb(client,batch,actor,{assets}={}){
 if(!twoStageEnabled())fail('Two-stage batches are not enabled on this platform.',409);
 assets??=await equipmentAssets(client);
 const stage=batchStage(batch),records=await batchVlbRecords(client,batch),holds=holdSummary(records,assets);
 const snapshot=buildMachineSnapshot(records,assets,batch.site);
 const blockers=lockBlockers({stage,records,holds,unresolved:snapshot.unresolved});
 if(blockers.length)fail(blockers.join(' '),409);
 await client.query('DELETE FROM mis_vlb_batch_machines WHERE batch_id=$1',[batch.id]);
 for(const m of snapshot.machines)await client.query('INSERT INTO mis_vlb_batch_machines(batch_id,asset_id,machine_label,door,trips,source_cards) VALUES($1,$2,$3,$4,$5,$6)',[batch.id,m.assetId,m.label,m.door,m.trips,m.sourceCards]);
 const fleet=buildFleetList(assets,batch.site,snapshot.machines);
 for(const row of fleet)await client.query(`INSERT INTO mis_vlb_batch_fleet(batch_id,asset_id,door,equipment_name,equipment_group,trips,source_cards,draft) VALUES($1,$2,$3,$4,$5,$6,$7,NULL)
  ON CONFLICT(batch_id,asset_id) DO UPDATE SET door=EXCLUDED.door,equipment_name=EXCLUDED.equipment_name,equipment_group=EXCLUDED.equipment_group,trips=EXCLUDED.trips,source_cards=EXCLUDED.source_cards,draft=NULL`,[batch.id,row.assetId,row.door,row.equipmentName,row.equipmentGroup,row.trips,row.sourceCards]);
 await client.query('DELETE FROM mis_vlb_batch_fleet WHERE batch_id=$1 AND logbook_id IS NULL AND NOT (asset_id=ANY($2::bigint[]))',[batch.id,fleet.map(r=>Number(r.assetId))]);
 const locked=(await client.query("UPDATE mis_vlb_batches SET stage='lmv_open',lmv_locked_at=NULL,vlb_locked_at=NOW(),vlb_locked_by=$2 WHERE id=$1 RETURNING *,book_date::text AS report_date",[batch.id,batchLogin(actor)])).rows[0];
 await auditVlbBatch(client,batch,actor,'vlb_locked',{machines:snapshot.machines,fleetCount:fleet.length,linkedElbEntries:fleet.filter(row=>Number(row.trips)>0).length,cards:records.length});
 return locked;
}

export async function unlockVlb(client,batch,actor,{reason='',approvedBy=null,via='screen'}={}){
 if(!['lmv_open','elb_open'].includes(batchStage(batch)))fail(batch.closed_at?'Reopen the batch before unlocking VLB.':'VLB is not locked for this batch.',409);
 await client.query('DELETE FROM mis_vlb_batch_machines WHERE batch_id=$1',[batch.id]);
 const opened=(await client.query("UPDATE mis_vlb_batches SET stage='vlb_open',lmv_locked_at=NULL,vlb_locked_at=NULL,vlb_locked_by=NULL WHERE id=$1 RETURNING *,book_date::text AS report_date",[batch.id])).rows[0];
 await auditVlbBatch(client,batch,actor,'vlb_unlocked',{reason,via,...(approvedBy?{approvedBy}:{})});
 return opened;
}

export async function assertCloseAllowed(client,batch,{assets}={}){
 if(!twoStageEnabled())return;
 if(batchStage(batch)!=='elb_open')fail('Lock VLB and LMV before closing the batch.',409);
 const details=await stageDetails(client,batch,{assets});
 if(details.closeBlockers.length)fail(details.closeBlockers.join(' '),409);
}

export async function saveFleetDraft(client,batch,assetId,draft,actor){
 if(batchStage(batch)!=='elb_open')fail('Machine entry is available only while ELB is open for this batch.',409);
 const row=(await client.query('UPDATE mis_vlb_batch_fleet SET draft=NULL,skipped=COALESCE($3,skipped) WHERE batch_id=$1 AND asset_id=$2 RETURNING *',[batch.id,assetId,typeof draft?.skipped==='boolean'?draft.skipped:null])).rows[0];
 if(!row)fail('This machine is not in the batch fleet list.',404);
 return row;
}

export function fleetShiftHours(shift){
 const minutes=value=>{const m=text(value).match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
 const a=minutes(shift.startTime||shift.start),b=minutes(shift.endTime||shift.end),hours=a!==null&&b!==null?((b-a+1440)%1440)/60:null;
 if(![8,12].includes(hours))fail('The batch Shift Master must have a valid 8- or 12-hour start/end time.',409);
 return hours;
}
export async function readFleetBreakdowns(client,batch,assetId,readHours,actor,input={}){
 if(typeof readHours!=='function')fail('Pulse breakdown lookup is unavailable.',503);
 const row=(await client.query('SELECT asset_id FROM mis_vlb_batch_fleet WHERE batch_id=$1 AND asset_id=$2',[batch.id,assetId])).rows[0];
 if(!row)fail('This machine is not in the batch fleet list.',404);
 const shift=await shiftMasterFor(client,batch.site,batch.shift);
 if(!shift)fail('No active Shift Master entry matches this batch.',409);
 const shiftHours=input.shiftHours!==undefined&&input.shiftHours!==''?manualShiftHours(input):fleetShiftHours(shift);
 const pulse=await readHours({bookDate:batch.report_date,location:displaySiteName(batch.site),assetId:String(assetId),shiftId:shift.id,shiftHours,manualEntry:input.shiftHours!==undefined,manualShift:input.manualShift,actor});
 if(pulse?.breakdownHours===null||pulse?.breakdownHours===undefined||!Number.isFinite(Number(pulse.breakdownHours))||Number(pulse.breakdownHours)<0||Number(pulse.breakdownHours)>shiftHours)fail('Pulse returned invalid breakdown hours for this shift.',502);
 return {...pulse,assetId:String(assetId),bookDate:batch.report_date,location:displaySiteName(batch.site),shift:batch.shift,shiftHours};
}

// Save one machine from the stepper dialog as a real equipment log book, linked to the batch.
export async function saveFleetEntry(client,batch,assetId,input,actor,ops){
 if(batchStage(batch)!=='elb_open')fail('Machine entry is available only while ELB is open for this batch.',409);
 const row=(await client.query('SELECT * FROM mis_vlb_batch_fleet WHERE batch_id=$1 AND asset_id=$2 FOR UPDATE',[batch.id,assetId])).rows[0];
 if(!row)fail('This machine is not in the batch fleet list.',404);
 const additional=input.additionalCard===true;
 if(additional&&!row.logbook_id)fail('Save the first ELB card before adding a relief operator.',409);
 if(row.logbook_id&&!additional){
  if(!ops.allowEditSaved)fail('Only an MIS administrator can edit a saved ELB.',403);
  const prior=(await client.query('SELECT revision FROM mis_log_books WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[row.logbook_id])).rows[0];
  if(!prior)fail('This ELB is unavailable. Reload the batch.',409);
  if(Number(input.revision)!==Number(prior.revision))fail('This ELB changed. Reload the batch before editing.',409);
 }
 let operatorSplit;
 if(text(input.secondOperatorId)||text(input.handoverHmr)){
  if(input.entryMode!=='working-only'||!isSurfaceMiner({door:row.door,equipmentGroup:row.equipment_group,equipmentName:row.equipment_name}))fail('Two operators can share an ELB shift only for a Surface Miner.',400);
  operatorSplit=splitSurfaceMinerHmr(input);
  if(operatorSplit.error)fail(operatorSplit.error,400);
 }
 const shiftHours=input.shiftHours!==undefined&&input.shiftHours!==''?manualShiftHours(input):null;
 const shift=await shiftMasterFor(client,batch.site,batch.shift);
 if(!shift)fail('No active Shift Master entry matches this batch shift at this site. Correct the Shift Master first.',409);
 const hours=input.entryMode==='working-only'?(shiftHours||fleetShiftHours(shift)):shiftHours||(()=>{const start=text(shift.startTime||shift.start),end=text(shift.endTime||shift.end);const m=v=>{const p=v.match(/^(\d{1,2}):(\d{2})/);return p?Number(p[1])*60+Number(p[2]):null};const a=m(start),b=m(end);const span=a!==null&&b!==null?((b-a+1440)%1440)/60:8;return span===12?12:8;})();
 let pulse=null;
 if(input.entryMode==='working-only'){
  pulse=await readFleetBreakdowns(client,batch,assetId,ops.readHours,actor,{...input,shiftHours:hours});
  const actualHours=num(input.openingHmr)!==null&&num(input.closingHmr)!==null?num(input.closingHmr)-num(input.openingHmr):null;
  const bd=Number(pulse.breakdownHours),zero=actualHours===0&&elbTripCount(row)===0;
  const shiftStatus=zero?(bd>=hours?'breakdown':'not_in_use'):bd>0&&bd<hours?'working_partial_breakdown':'working';
  input={...input,shiftStatus,manualBreakdownHours:bd,statusReason:text(input.statusReason)||(pulse.breakdowns||[]).map(item=>item.description).filter(Boolean).join('; ').slice(0,2000)};
 }
 const {errors,status,hours:workingHours,breakdownHours}=validateFleetEntry(input,{trips:elbTripCount(row),shiftHours:hours});
 if(Object.keys(errors).length)throw Object.assign(new Error(Object.values(errors).join(' ')),{status:400,fields:errors});
 const nonWorking=NON_WORKING_STATUSES.includes(status);
 const opening=num(input.openingHmr),closing=num(input.closingHmr);
 const body={bookDate:batch.report_date,bookDateSource:'batch',location:displaySiteName(batch.site),assetId:String(assetId),employeeId:nonWorking&&!text(input.employeeId)?null:text(input.employeeId),shiftId:shift.id,shiftHours:hours,manualShift:input.manualShift,
  openingHmr:opening??(nonWorking?0:''),closingHmr:closing??(nonWorking?(opening??0):''),jobCardNo:text(input.jobCardNo),remark:text(input.remark),timeMode:'without',
  manualBreakdownHours:breakdownHours??'',shiftStatus:status,statusReason:text(input.statusReason),breakdownDetails:Array.isArray(input.breakdownDetails)?input.breakdownDetails:undefined,
  idleHoursEntered:num(input.idleHours),batchId:batch.id,fleetTrips:elbTripCount(row),bookShiftCode:batch.shift};
 const data=await ops.resolve(client,'equipment',body,{...(operatorSplit?{operatorSplit,enforceEmployeeSite:true}:{}),manualEntry:true});
 Object.assign(data,{shiftStatus:status,statusReason:body.statusReason,fleetTrips:elbTripCount(row),batchId:batch.id,bookShiftCode:batch.shift,entrySource:'batch-fleet'});
 if(workingHours!==null)data.totalWorkingHmr=workingHours;
 if(pulse){Object.assign(data,{breakdownHours:Number(pulse.breakdownHours),breakdownHoursSource:'pulse',manualBreakdownHours:null,hoursSource:pulse,pulseBreakdowns:pulse.breakdowns||[],elbEntryMode:'working-only'});}else if(ops.applyHours)await ops.applyHours(data);
 if(nonWorking){data.breakdownHours=status==='breakdown'?hours:data.breakdownHours;data.availabilityHours=0;data.runningHours=0;data.idleHours=status==='breakdown'?0:hours-(Number(data.breakdownHours)||0);}
 if(additional){
  const cards=(await batchElbRecords(client,batch)).filter(record=>String(record.asset_id)===String(assetId));
  const retry=input.requestKey&&(await client.query('SELECT id FROM mis_log_books WHERE request_key=$1',[input.requestKey])).rows[0];
  if(retry){
   const prior=cards.find(card=>String(card.id)===String(retry.id));
   if(prior)return prior;
   fail('This save reference already belongs to another card.',409);
  }
  if(!(cardWorkingHmr(data)>0)||cards.some(card=>shareCardOperator(data,card.data)))fail('Enter positive working HMR and an operator who has no card for this machine and shift.',409);
 }
 let record;
 if(row.logbook_id&&!additional){
  await assertCombinedShiftMeters(client,'equipment',data,row.logbook_id);
  const result=await client.query('UPDATE mis_log_books SET data=$1::jsonb,updated_at=NOW(),revision=revision+1 WHERE id=$2 AND deleted_at IS NULL RETURNING id,book_no,book_type,book_date::text,site,asset_id,data,revision,created_at,updated_at',[JSON.stringify(data),row.logbook_id]);
  record=result.rows[0];
 }
 if(!record)record=await ops.insert(client,'equipment',data,input.requestKey||crypto.randomUUID(),batchLogin(actor));
 await client.query('INSERT INTO mis_elb_batch_entries(batch_id,logbook_id,snapshot) VALUES($1,$2,$3::jsonb) ON CONFLICT(logbook_id) DO UPDATE SET snapshot=EXCLUDED.snapshot',[batch.id,record.id,JSON.stringify(record)]);
 await client.query('UPDATE mis_vlb_batch_fleet SET shift_status=$3,logbook_id=$4,saved_at=NOW(),saved_by=$5,draft=NULL,skipped=FALSE WHERE batch_id=$1 AND asset_id=$2',[batch.id,assetId,status,record.id,batchLogin(actor)]);
 await auditVlbBatch(client,batch,actor,row.logbook_id&&!additional?'machine_updated':'machine_saved',{assetId:String(assetId),door:row.door,status,trips:row.trips,logbookId:record.id});
 return record;
}

export async function lockLmv(client,batch,actor){
 if(!twoStageEnabled()||batchStage(batch)!=='lmv_open')fail('LMV must be open before it can be locked.',409);
 const locked=(await client.query("UPDATE mis_vlb_batches SET stage='elb_open',lmv_locked_at=NOW() WHERE id=$1 RETURNING *,book_date::text AS report_date",[batch.id])).rows[0];
 await auditVlbBatch(client,batch,actor,'lmv_locked');
 return locked;
}

export async function assertLmvBatchWrite(client,data){
 if(!twoStageEnabled())return null;
 await lockVlbBatchScope(client,vlbRecordScope(data));
 const batch=await matchingVlbBatch(client,data);
 if(!batch||batch.deleted_at||batchStage(batch)!=='lmv_open')fail('Select a batch with VLB locked and LMV open before saving or changing LMV cards.',409);
 if(batch.trial_reopened_until&&(await client.query('SELECT $1::timestamptz<=clock_timestamp() AS expired',[batch.trial_reopened_until])).rows[0].expired)fail('The batch reopening trial has expired.',409);
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
 if(stage==='vlb_open'||stage==='lmv_open')fail('Lock VLB and LMV for batch '+batch.name+' before saving ELB cards.',409);
 if(stage==='closed'&&batch.lmv_locked_at)fail('This batch is locked. Reopen it before saving ELB cards.',409);
 if(stage==='closed'&&!adding)fail('Batch '+batch.name+' is closed. Reopen it with site PM approval before changing existing ELB cards.',409);
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
