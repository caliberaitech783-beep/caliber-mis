import {canonicalSiteName} from './site-location.mjs';
import {withEquipmentAliases} from './equipment-aliases.mjs';
import {displaySiteName} from './region-scope.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
import {batchFail,auditVlbBatch,batchLogin,matchingVlbBatch} from './vlb-batch-policy.mjs';
import {twoStageEnabled,batchStage,activeSiteHolds,holdSummary,buildMachineSnapshot,buildFleetList,validateFleetEntry,closureBlockers,lockBlockers,fleetProgress,machineReportRows,FLEET_STATUSES,NON_WORKING_STATUSES} from './vlb-two-stage.mjs';
import {pendingTransferFor} from './vehicle-transfer-express.mjs';

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
 return rows.map(row=>({...row,source_cards:row.sourceCards,saved_at:row.logbook_id&&!row.book_no?null:row.saved_at}));
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
 const fleet=stage==='vlb_open'?[]:await fleetRows(client,batch);
 const machines=stage==='vlb_open'?buildMachineSnapshot(vlb,assets,batch.site).machines:await machineRows(client,batch);
 const progress=fleetProgress(fleet);
 const duplicates=duplicateElb(elb);
 return {twoStage:true,stage,holds,machines,fleet,fleetProgress:progress,elbRecords:elb,lockBlockers:stage==='vlb_open'?lockBlockers({stage,records:vlb,holds,unresolved:buildMachineSnapshot(vlb,assets,batch.site).unresolved}):[],closeBlockers:stage==='elb_open'?closureBlockers({stage,fleet,holds,duplicates}):[],machineReport:stage==='vlb_open'?null:machineReportRows(fleet,elb),statuses:FLEET_STATUSES};
}
const duplicateElb=records=>{const seen=new Map();for(const r of records){const key=String(r.asset_id||r.data?.assetId);seen.set(key,(seen.get(key)||0)+1);}return [...seen].filter(([,n])=>n>1).map(([key])=>records.find(r=>String(r.asset_id||r.data?.assetId)===key)?.data?.door||key);};

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
 for(const row of fleet)await client.query(`INSERT INTO mis_vlb_batch_fleet(batch_id,asset_id,door,equipment_name,equipment_group,trips,source_cards) VALUES($1,$2,$3,$4,$5,$6,$7)
  ON CONFLICT(batch_id,asset_id) DO UPDATE SET door=EXCLUDED.door,equipment_name=EXCLUDED.equipment_name,equipment_group=EXCLUDED.equipment_group,trips=EXCLUDED.trips,source_cards=EXCLUDED.source_cards`,[batch.id,row.assetId,row.door,row.equipmentName,row.equipmentGroup,row.trips,row.sourceCards]);
 await client.query('DELETE FROM mis_vlb_batch_fleet WHERE batch_id=$1 AND logbook_id IS NULL AND NOT (asset_id=ANY($2::bigint[]))',[batch.id,fleet.map(r=>Number(r.assetId))]);
 const locked=(await client.query("UPDATE mis_vlb_batches SET stage='elb_open',vlb_locked_at=NOW(),vlb_locked_by=$2 WHERE id=$1 RETURNING *,book_date::text AS report_date",[batch.id,batchLogin(actor)])).rows[0];
 await auditVlbBatch(client,batch,actor,'vlb_locked',{machines:snapshot.machines,fleetCount:fleet.length,cards:records.length});
 return locked;
}

export async function unlockVlb(client,batch,actor,{reason='',approvedBy=null,via='screen'}={}){
 if(batchStage(batch)!=='elb_open')fail(batch.closed_at?'Reopen the batch before unlocking VLB.':'VLB is not locked for this batch.',409);
 await client.query('DELETE FROM mis_vlb_batch_machines WHERE batch_id=$1',[batch.id]);
 const opened=(await client.query("UPDATE mis_vlb_batches SET stage='vlb_open',vlb_locked_at=NULL,vlb_locked_by=NULL WHERE id=$1 RETURNING *,book_date::text AS report_date",[batch.id])).rows[0];
 await auditVlbBatch(client,batch,actor,'vlb_unlocked',{reason,via,...(approvedBy?{approvedBy}:{})});
 return opened;
}

export async function assertCloseAllowed(client,batch,{assets}={}){
 if(!twoStageEnabled())return;
 const details=await stageDetails(client,batch,{assets});
 if(details.closeBlockers.length)fail(details.closeBlockers.join(' '),409);
}

export async function saveFleetDraft(client,batch,assetId,draft,actor){
 if(batchStage(batch)!=='elb_open')fail('Machine entry is available only while ELB is open for this batch.',409);
 const row=(await client.query('UPDATE mis_vlb_batch_fleet SET draft=$3::jsonb,skipped=COALESCE($4,skipped) WHERE batch_id=$1 AND asset_id=$2 RETURNING *',[batch.id,assetId,JSON.stringify({...draft,savedBy:batchLogin(actor),savedAt:new Date().toISOString()}),typeof draft?.skipped==='boolean'?draft.skipped:null])).rows[0];
 if(!row)fail('This machine is not in the batch fleet list.',404);
 return row;
}

// Save one machine from the stepper dialog as a real equipment log book, linked to the batch.
export async function saveFleetEntry(client,batch,assetId,input,actor,ops){
 if(batchStage(batch)!=='elb_open')fail('Machine entry is available only while ELB is open for this batch.',409);
 const row=(await client.query('SELECT * FROM mis_vlb_batch_fleet WHERE batch_id=$1 AND asset_id=$2 FOR UPDATE',[batch.id,assetId])).rows[0];
 if(!row)fail('This machine is not in the batch fleet list.',404);
 const shiftHours=[8,12].includes(Number(input.shiftHours))?Number(input.shiftHours):null;
 const shift=await shiftMasterFor(client,batch.site,batch.shift);
 if(!shift)fail('No active Shift Master entry matches this batch shift at this site. Correct the Shift Master first.',409);
 const hours=shiftHours||(()=>{const start=text(shift.startTime||shift.start),end=text(shift.endTime||shift.end);const m=v=>{const p=v.match(/^(\d{1,2}):(\d{2})/);return p?Number(p[1])*60+Number(p[2]):null};const a=m(start),b=m(end);const span=a!==null&&b!==null?((b-a+1440)%1440)/60:8;return span===12?12:8;})();
 const {errors,status,hours:workingHours,breakdownHours}=validateFleetEntry(input,{trips:row.trips,shiftHours:hours});
 if(Object.keys(errors).length)throw Object.assign(new Error(Object.values(errors).join(' ')),{status:400,fields:errors});
 const nonWorking=NON_WORKING_STATUSES.includes(status);
 const opening=num(input.openingHmr),closing=num(input.closingHmr);
 const body={bookDate:batch.report_date,bookDateSource:'batch',location:displaySiteName(batch.site),assetId:String(assetId),employeeId:nonWorking&&!text(input.employeeId)?null:text(input.employeeId),shiftId:shift.id,shiftHours:hours,
  openingHmr:opening??(nonWorking?0:''),closingHmr:closing??(nonWorking?(opening??0):''),jobCardNo:text(input.jobCardNo),remark:text(input.remark),timeMode:'without',
  manualBreakdownHours:breakdownHours??'',shiftStatus:status,statusReason:text(input.statusReason),breakdownDetails:Array.isArray(input.breakdownDetails)?input.breakdownDetails:undefined,
  idleHoursEntered:num(input.idleHours),batchId:batch.id,fleetTrips:row.trips,bookShiftCode:batch.shift};
 const data=await ops.resolve(client,'equipment',body);
 Object.assign(data,{shiftStatus:status,statusReason:body.statusReason,fleetTrips:row.trips,batchId:batch.id,bookShiftCode:batch.shift,entrySource:'batch-fleet'});
 if(workingHours!==null)data.totalWorkingHmr=workingHours;
 if(ops.applyHours)await ops.applyHours(data);
 if(nonWorking){data.breakdownHours=status==='breakdown'?hours:data.breakdownHours;data.availabilityHours=0;data.runningHours=0;data.idleHours=status==='breakdown'?0:hours-(Number(data.breakdownHours)||0);}
 let record;
 if(row.logbook_id){
  const result=await client.query('UPDATE mis_log_books SET data=$1::jsonb,updated_at=NOW(),revision=revision+1 WHERE id=$2 AND deleted_at IS NULL RETURNING id,book_no,book_type,book_date::text,site,asset_id,data,revision,created_at,updated_at',[JSON.stringify(data),row.logbook_id]);
  record=result.rows[0];
 }
 if(!record)record=await ops.insert(client,'equipment',data,input.requestKey||crypto.randomUUID(),batchLogin(actor));
 await client.query('INSERT INTO mis_elb_batch_entries(batch_id,logbook_id,snapshot) VALUES($1,$2,$3::jsonb) ON CONFLICT(logbook_id) DO UPDATE SET snapshot=EXCLUDED.snapshot',[batch.id,record.id,JSON.stringify(record)]);
 await client.query('UPDATE mis_vlb_batch_fleet SET shift_status=$3,logbook_id=$4,saved_at=NOW(),saved_by=$5,draft=NULL,skipped=FALSE WHERE batch_id=$1 AND asset_id=$2',[batch.id,assetId,status,record.id,batchLogin(actor)]);
 await auditVlbBatch(client,batch,actor,row.logbook_id?'machine_updated':'machine_saved',{assetId:String(assetId),door:row.door,status,trips:row.trips,logbookId:record.id});
 return record;
}

// ELB cards exist only inside the site/date/shift batch, and only after its VLB is locked.
// No batch, VLB still open and a closed batch all refuse the save; standalone ELB saving is discontinued.
export async function assertElbBatchWrite(client,data){
 if(!twoStageEnabled())return null;
 const batch=await matchingVlbBatch(client,{location:data.location,bookDate:data.bookDate,bookShiftCode:data.bookShiftCode,cardShift:data.cardShift,shiftName:data.shiftName});
 if(!batch)fail('Create the VLB batch for this site, date and shift and lock VLB before saving ELB cards. Standalone ELB saving is discontinued.',409);
 const stage=batchStage(batch);
 if(stage==='vlb_open')fail('Lock VLB for batch '+batch.name+' before saving ELB cards for this site, date and shift.',409);
 if(stage==='closed')fail('Batch '+batch.name+' is closed. Reopen it with site PM approval before saving or changing ELB cards.',409);
 return batch;
}

// An equipment log book saved through the normal form, scan, upload or the fleet stepper joins the
// open ELB stage of its batch and marks that machine's fleet row as saved.
export async function syncElbBatchRecord(client,record,actor){
 if(!twoStageEnabled()||record.book_type!=='equipment')return null;
 const data=record.data||{};
 const batch=await assertElbBatchWrite(client,data);
 await client.query('INSERT INTO mis_elb_batch_entries(batch_id,logbook_id,snapshot) VALUES($1,$2,$3::jsonb) ON CONFLICT(logbook_id) DO UPDATE SET snapshot=EXCLUDED.snapshot',[batch.id,record.id,JSON.stringify(record)]);
 const status=FLEET_STATUSES[data.shiftStatus]?data.shiftStatus:'working';
 const updated=await client.query('UPDATE mis_vlb_batch_fleet SET shift_status=$3,logbook_id=$4,saved_at=NOW(),saved_by=$5,draft=NULL,skipped=FALSE WHERE batch_id=$1 AND asset_id=$2 RETURNING asset_id',[batch.id,record.asset_id||data.assetId,status,record.id,batchLogin(actor)]);
 if(!updated.rowCount)await client.query(`INSERT INTO mis_vlb_batch_fleet(batch_id,asset_id,door,equipment_name,equipment_group,trips,source_cards,shift_status,logbook_id,saved_at,saved_by) VALUES($1,$2,$3,$4,'',0,0,$5,$6,NOW(),$7) ON CONFLICT DO NOTHING`,[batch.id,record.asset_id||data.assetId,text(data.door),text(data.assetName),status,record.id,batchLogin(actor)]);
 await auditVlbBatch(client,batch,actor,'elb_card_linked',{logbookId:record.id,bookNo:record.book_no,door:data.door});
 return batch;
}

export const stageHoldsFor=(records,assets)=>records.map(record=>({id:record.id,holds:activeSiteHolds(record,assets)})).filter(entry=>entry.holds.length);
