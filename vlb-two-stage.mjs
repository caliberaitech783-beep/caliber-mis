import {canonicalSiteName,equipmentSiteName} from './site-location.mjs';
import {assetBookKind} from './equipment-kind.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {resolveTripEquipment} from './trip-equipment-validation.mjs';
import {isUnloadingOnlyTrip} from './trip-card-rules.mjs';

// Two-stage VLB + ELB batches. The switch is read per request so it can be turned off without a redeploy.
// Live for all users. Set VLB_TWO_STAGE_BATCHES=0 (or off/false/no) to fall back to single-step batches.
export const twoStageEnabled=(env=process.env)=>!['0','false','off','no'].includes(String(env.VLB_TWO_STAGE_BATCHES||'').trim().toLowerCase());

export const BATCH_STAGES=Object.freeze(['vlb_open','elb_open','closed']);
export const batchStage=batch=>batch?.closed_at?'closed':batch?.stage==='elb_open'?'elb_open':'vlb_open';
export const stageLabel=stage=>({vlb_open:'VLB open',elb_open:'ELB open',closed:'Closed'})[stage]||stage;

export const FLEET_STATUSES=Object.freeze({
 working:{label:'Working',allowsTrips:true,needsOperator:true,needsHours:true},
 working_partial_breakdown:{label:'Working, partial breakdown',allowsTrips:true,needsOperator:true,needsHours:false,needsBreakdown:'partial'},
 breakdown:{label:'Breakdown',allowsTrips:false,needsOperator:false,needsBreakdown:'full'},
 maintenance:{label:'Maintenance',allowsTrips:false,needsOperator:false,needsReasonOrJobCard:true},
 no_operator:{label:'No operator',allowsTrips:false,needsOperator:false},
 not_in_use:{label:'Not in use',allowsTrips:false,needsOperator:false},
});
export const NON_WORKING_STATUSES=Object.freeze(Object.keys(FLEET_STATUSES).filter(key=>!FLEET_STATUSES[key].allowsTrips));

export const VLB_TWO_STAGE_SCHEMA=`
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'vlb_open';
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS vlb_locked_at TIMESTAMPTZ;
 ALTER TABLE mis_vlb_batches ADD COLUMN IF NOT EXISTS vlb_locked_by TEXT;
 UPDATE mis_vlb_batches SET stage='closed' WHERE closed_at IS NOT NULL AND stage<>'closed';
 CREATE TABLE IF NOT EXISTS mis_vlb_batch_machines(
  batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),asset_id BIGINT NOT NULL,machine_label TEXT NOT NULL,door TEXT NOT NULL DEFAULT '',
  trips INTEGER NOT NULL,source_cards INTEGER NOT NULL,PRIMARY KEY(batch_id,asset_id));
 CREATE TABLE IF NOT EXISTS mis_vlb_batch_fleet(
  batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),asset_id BIGINT NOT NULL,door TEXT NOT NULL,equipment_name TEXT NOT NULL DEFAULT '',equipment_group TEXT NOT NULL DEFAULT '',
  trips INTEGER NOT NULL DEFAULT 0,source_cards INTEGER NOT NULL DEFAULT 0,shift_status TEXT CHECK(shift_status IN ('working','working_partial_breakdown','breakdown','maintenance','no_operator','not_in_use')),
  draft JSONB,logbook_id BIGINT REFERENCES mis_log_books(id),saved_at TIMESTAMPTZ,saved_by TEXT,skipped BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(batch_id,asset_id));
 CREATE TABLE IF NOT EXISTS mis_elb_batch_entries(
  batch_id UUID NOT NULL REFERENCES mis_vlb_batches(id),logbook_id BIGINT PRIMARY KEY REFERENCES mis_log_books(id),snapshot JSONB NOT NULL);
 CREATE INDEX IF NOT EXISTS mis_elb_batch_entries_batch ON mis_elb_batch_entries(batch_id);
 CREATE TABLE IF NOT EXISTS mis_vehicle_transfer_otps(
  id UUID PRIMARY KEY,transfer_id BIGINT NOT NULL,batch_id UUID REFERENCES mis_vlb_batches(id),asset_id BIGINT NOT NULL,
  requested_by TEXT NOT NULL,requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),sent_to TEXT[] NOT NULL,channels TEXT[] NOT NULL DEFAULT '{}',
  otp_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','used','expired','cancelled')),used_at TIMESTAMPTZ,approved_by TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS mis_vehicle_transfer_one_live_otp ON mis_vehicle_transfer_otps(transfer_id) WHERE status='sent';
 CREATE TABLE IF NOT EXISTS mis_equipment_create_requests(
  id UUID PRIMARY KEY,batch_id UUID REFERENCES mis_vlb_batches(id),site TEXT NOT NULL,door TEXT NOT NULL,draft JSONB NOT NULL,card_draft JSONB,
  requested_by TEXT NOT NULL,requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),sent_to TEXT[] NOT NULL,channels TEXT[] NOT NULL DEFAULT '{}',
  otp_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','used','expired','cancelled')),approved_by TEXT,used_at TIMESTAMPTZ,equipment_id BIGINT);
 CREATE UNIQUE INDEX IF NOT EXISTS mis_equipment_create_one_live ON mis_equipment_create_requests(site,door) WHERE status='sent';`;

const text=value=>String(value??'').trim();
const num=value=>{if(value===''||value===undefined||value===null)return null;const n=Number(value);return Number.isFinite(n)?n:null};
const round=value=>Math.round((value+Number.EPSILON)*1000)/1000;
export const assetSite=asset=>text(equipmentSiteName(asset)||asset?.currentLocation||asset?.site||asset?.location);
export const assetDoor=asset=>text(asset?.door||asset?.doorNo||equipmentDoorNumber(asset||{}));
export const assetLabel=asset=>assetDoor(asset)||text(asset?.equipmentName||asset?.equipment||asset?.name);
export const machineKey=asset=>String(asset?.id??'');

// Holds recorded on a card at save time are re-evaluated against the current Equipment
// master, so a completed transfer clears every card naming the asset without any action.
export function activeSiteHolds(record,assets){
 const data=record?.data||record||{},holds=Array.isArray(data.siteHolds)?data.siteHolds:[];
 if(!holds.length)return [];
 const site=canonicalSiteName(data.location),index=new Map(assets.map(asset=>[machineKey(asset),asset]));
 return holds.filter(hold=>{const asset=index.get(String(hold.assetId));if(!asset)return true;const current=assetSite(asset);return !current||canonicalSiteName(current)!==site;})
  .map(hold=>{const asset=index.get(String(hold.assetId));return {...hold,label:assetLabel(asset)||hold.label||'',currentSite:assetSite(asset)||hold.assetSite||''};});
}

export function holdSummary(records,assets){
 const byAsset=new Map();
 for(const record of records){
  for(const hold of activeSiteHolds(record,assets)){
   const key=String(hold.assetId);
   if(!byAsset.has(key))byAsset.set(key,{assetId:key,label:hold.label||'',assetSite:hold.currentSite||hold.assetSite||'',roles:new Set(),cards:new Set(),trips:0});
   const entry=byAsset.get(key);entry.roles.add(hold.role);entry.cards.add(String(record.id));
   if(hold.role==='vlb_loader')entry.trips+=Number(hold.trips)||0;
   if(hold.label&&!entry.label)entry.label=hold.label;
  }
 }
 return [...byAsset.values()].map(entry=>({...entry,roles:[...entry.roles],cards:[...entry.cards],cardCount:entry.cards.size})).sort((a,b)=>b.trips-a.trips||a.label.localeCompare(b.label));
}
export const describeHolds=holds=>holds.map(h=>`${h.label||'Asset '+h.assetId} from ${h.assetSite||'another site'} (${h.cardCount} card${h.cardCount===1?'':'s'}${h.trips?', '+h.trips+' trips':''})`).join(', ');

// Every loading machine named on a tipper card, resolved to its Equipment master id.
// V19, VL19 and VPC 019 reconcile to one machine because the id, not the label, is the key.
export function buildMachineSnapshot(records,assets,site){
 const equipment=assets.filter(asset=>assetBookKind(asset)==='equipment'),index=new Map(equipment.map(asset=>[machineKey(asset),asset]));
 const machines=new Map(),unresolved=[];
 for(const record of records){
  const data=record.data||{};
  if(activeSiteHolds(record,assets).length)continue;
  const seen=new Set();
  (data.trips||[]).forEach((row,i)=>{
   if(isUnloadingOnlyTrip(row))return;
   let asset=row.equipmentId?index.get(String(row.equipmentId)):null;
   if(!asset){const match=resolveTripEquipment(row,equipment,data.location||site);if(match.error){unresolved.push({bookNo:record.book_no,row:i+1,label:text(row.equipmentName),error:match.error});return;}asset=index.get(String(match.equipmentId));}
   if(!asset){unresolved.push({bookNo:record.book_no,row:i+1,label:text(row.equipmentName),error:'Loading machine is missing from the Equipment master.'});return;}
   const key=machineKey(asset);
   if(!machines.has(key))machines.set(key,{assetId:key,label:assetLabel(asset)||text(row.equipmentName),door:assetDoor(asset),trips:0,sourceCards:0});
   const machine=machines.get(key);machine.trips+=Number(row.tripCount)||0;
   if(!seen.has(key)){seen.add(key);machine.sourceCards+=1;}
  });
 }
 return {machines:[...machines.values()].sort((a,b)=>b.trips-a.trips||a.label.localeCompare(b.label,undefined,{numeric:true})),unresolved};
}

// The whole site fleet at lock time: loaders first by trips, then everything else by door.
export function buildFleetList(assets,site,machines=[]){
 const canonical=canonicalSiteName(site),byId=new Map(machines.map(m=>[String(m.assetId),m]));
 const rows=new Map();
 for(const asset of assets){
  if(assetBookKind(asset)!=='equipment'||asset.sourceMissing)continue;
  const atSite=canonicalSiteName(assetSite(asset))===canonical,machine=byId.get(machineKey(asset));
  if(!atSite&&!machine)continue;
  rows.set(machineKey(asset),{assetId:machineKey(asset),door:assetDoor(asset)||assetLabel(asset),equipmentName:text(asset.equipmentName||asset.equipment||asset.name),equipmentGroup:text(asset.group||asset.equipmentGroup||asset.category),trips:machine?.trips||0,sourceCards:machine?.sourceCards||0,atSite});
 }
 return [...rows.values()].sort((a,b)=>b.trips-a.trips||a.door.localeCompare(b.door,undefined,{numeric:true}));
}

// Shift status rules for the one-machine dialog. Trips loaded can only belong to a working
// machine, and a working machine with zero trips must still show working hours.
export function validateFleetEntry(input={},{trips=0,shiftHours=8}={}){
 const errors={},status=text(input.shiftStatus),rule=FLEET_STATUSES[status];
 const opening=num(input.openingHmr),closing=num(input.closingHmr),breakdown=num(input.manualBreakdownHours),hours=opening!==null&&closing!==null?round(closing-opening):null;
 const reason=text(input.statusReason||input.remark),jobCard=text(input.jobCardNo),operator=text(input.employeeId);
 if(!rule){errors.shiftStatus='Select the shift status for this machine.';return {errors,status,hours};}
 if(trips>0&&!rule.allowsTrips)errors.shiftStatus=`This machine loaded ${trips} trip${trips===1?'':'s'} this shift, so it must be saved as Working or Working, partial breakdown.`;
 if(rule.needsOperator&&!operator)errors.employeeId='Select the operator for a working machine.';
 if(rule.allowsTrips){
  if(opening===null)errors.openingHmr='Enter the opening HMR.';
  if(closing===null)errors.closingHmr='Enter the closing HMR.';
  if(hours!==null&&hours<0)errors.closingHmr='Closing HMR cannot be below opening HMR.';
  if(rule.needsHours&&hours!==null&&hours<=0)errors.closingHmr=trips>0?'A machine that loaded trips must show working hours greater than zero.':'Zero trips and zero hours is not a working machine. Choose maintenance, no operator, breakdown or not in use.';
  if(hours!==null&&hours>Number(shiftHours))errors.closingHmr=`Working hours cannot exceed the ${shiftHours}-hour shift.`;
 }else if(opening!==null&&closing!==null&&hours<0)errors.closingHmr='Closing HMR cannot be below opening HMR.';
 if(rule.needsBreakdown==='partial'){
  if(breakdown===null||breakdown<=0)errors.manualBreakdownHours='Enter the breakdown hours for a partial breakdown.';
  else if(breakdown>=Number(shiftHours))errors.manualBreakdownHours='A full-shift breakdown must be saved as Breakdown, not partial.';
  if(!reason)errors.statusReason='Enter the breakdown reason.';
 }
 if(rule.needsBreakdown==='full'&&!reason)errors.statusReason='Enter the breakdown reason.';
 if(rule.needsReasonOrJobCard&&!reason&&!jobCard)errors.statusReason='Enter the maintenance reason or the job card number.';
 return {errors,status,hours,breakdownHours:rule.needsBreakdown==='full'?Number(shiftHours):breakdown};
}

// Closure needs a saved status for every machine in the fleet list and no cards still awaiting a transfer.
export function closureBlockers({stage,fleet=[],holds=[],duplicates=[]}){
 const blockers=[];
 if(stage!=='elb_open')blockers.push(stage==='closed'?'This batch is already closed.':'Lock VLB before closing the batch.');
 if(holds.length)blockers.push('Awaiting transfer: '+describeHolds(holds)+'.');
 const missing=fleet.filter(row=>!row.saved_at||!row.shift_status).sort((a,b)=>b.trips-a.trips||String(a.door).localeCompare(String(b.door),undefined,{numeric:true}));
 if(missing.length)blockers.push('Machines without a saved ELB: '+missing.map(row=>row.trips?`${row.door} loaded ${row.trips} trips, no ELB saved`:`${row.door} no ELB saved`).join('; ')+'.');
 if(duplicates.length)blockers.push('Duplicate ELB cards for the same machine: '+duplicates.join(', ')+'. Review before closing.');
 return blockers;
}

export function lockBlockers({stage,records=[],holds=[],unresolved=[]}){
 const blockers=[];
 if(stage!=='vlb_open')blockers.push(stage==='closed'?'This batch is already closed.':'VLB is already locked for this batch.');
 if(!records.length)blockers.push('Add at least one VLB card before locking VLB.');
 if(holds.length)blockers.push('Awaiting transfer: '+describeHolds(holds)+'.');
 if(unresolved.length)blockers.push('Loading machines that do not resolve to one Equipment master record: '+unresolved.map(u=>`${u.bookNo} row ${u.row} (${u.label||'blank'})`).join(', ')+'.');
 return blockers;
}

export function fleetProgress(fleet=[]){
 const saved=fleet.filter(row=>row.saved_at&&row.shift_status).length,skipped=fleet.filter(row=>row.skipped&&!row.saved_at).length,drafts=fleet.filter(row=>row.draft&&!row.saved_at).length;
 return {total:fleet.length,saved,remaining:fleet.length-saved,skipped,drafts,loaders:fleet.filter(row=>row.trips>0).length};
}

// Machine-wise shift report: trips from VLB, hours from ELB, trips per hour.
export function machineReportRows(fleet=[],elbRecords=[]){
 const byAsset=new Map(elbRecords.map(record=>[String(record.asset_id||record.data?.assetId),record]));
 const rows=fleet.map(row=>{
  const record=byAsset.get(String(row.assetId||row.asset_id)),data=record?.data||{};
  const opening=num(data.openingHmr),closing=num(data.closingHmr),hours=opening!==null&&closing!==null&&closing>=opening?round(closing-opening):null;
  const trips=Number(row.trips)||0;
  return {assetId:String(row.assetId||row.asset_id),door:row.door,equipmentName:row.equipmentName||row.equipment_name||'',status:row.shift_status||row.shiftStatus||'',statusLabel:FLEET_STATUSES[row.shift_status||row.shiftStatus]?.label||'',trips,sourceCards:Number(row.sourceCards||row.source_cards)||0,
   operator:text(data.employeeName),openingHmr:opening,closingHmr:closing,hours,tripsPerHour:hours?round(trips/hours):null,breakdownHours:num(data.breakdownHours),idleHours:num(data.idleHours),bookNo:record?.book_no||'',remark:text(data.statusReason||data.remark),transferred:Boolean(data.transferredThisShift)};
 });
 const loaders=rows.filter(r=>r.trips>0),others=rows.filter(r=>!r.trips);
 const totals={machines:rows.length,trips:rows.reduce((s,r)=>s+r.trips,0),hours:round(rows.reduce((s,r)=>s+(r.hours||0),0)),working:rows.filter(r=>FLEET_STATUSES[r.status]?.allowsTrips).length,down:rows.filter(r=>['breakdown','maintenance'].includes(r.status)).length,idle:rows.filter(r=>['no_operator','not_in_use'].includes(r.status)).length};
 return {loaders,others,totals};
}

