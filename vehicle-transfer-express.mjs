import {randomUUID} from 'node:crypto';
import {canonicalSiteName} from './site-location.mjs';
import {displaySiteName,normalizeOperationalSiteFields,reportScopeIncludesSite} from './region-scope.mjs';
import {VEHICLE_TRANSFER_STATUS,vehicleTransferStatus,vehicleTransferValidationError,transferMatchesEquipment,applyAcceptedVehicleTransfer,vehicleTransferAuditDetails} from './vehicle-transfer-workflow.mjs';
import {generateOtp,hashOtp,otpExpiresAt,checkOtpAttempt,resendTooSoon,otpFail,OTP_TTL_MINUTES} from './otp-approval.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';

const text=value=>String(value??'').trim();
const PENDING=[VEHICLE_TRANSFER_STATUS.SOURCE_APPROVAL,VEHICLE_TRANSFER_STATUS.MIS_VERIFICATION,VEHICLE_TRANSFER_STATUS.DESTINATION_ACCEPTANCE];
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
const formatDate=value=>{const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:String(value||'')};

export function expressTransferMessage({transfer,equipment,requestedBy,batchName,otp}){
 return [
  'Caliber Pulse: vehicle transfer approval',
  `${equipment.door||equipment.equipmentName} is being logged at ${displaySiteName(transfer.destination)} but is assigned to ${displaySiteName(transfer.source)}.`,
  `Transfer ${transfer.transferNo}: ${displaySiteName(transfer.source)} -> ${displaySiteName(transfer.destination)}, date ${formatDate(transfer.transferDate)}`,
  `Requested by ${requestedBy}${batchName?', batch '+batchName:''}`,
  `OTP ${otp}, valid ${OTP_TTL_MINUTES} minutes. Share it only if you release ${equipment.door||equipment.equipmentName} to ${displaySiteName(transfer.destination)}.`,
  'Raise the site transfer in Pulse so this stops being asked.',
 ].join('\n');
}

// Completes the three workflow steps in one transaction after the source PM's OTP.
// The requesting MIS user stands for destination verification; destination acceptance
// is recorded as implied because the destination is the site asking for the asset.
export async function completeExpressTransfer(client,{transferId,approvedBy,requester,pulseWriter}){
 const {rows}=await client.query(`SELECT id,record_data FROM master_records WHERE id=$1 AND master_name='Vehicle transfers' FOR UPDATE`,[transferId]);
 const before=rows[0]?.record_data;if(!before)otpFail('Vehicle transfer not found.',404);
 if(!PENDING.includes(vehicleTransferStatus(before)))otpFail('This transfer is no longer pending.',409);
 const equipmentRows=await client.query(`SELECT id,record_data FROM master_records WHERE master_name='Equipment master' FOR UPDATE`);
 const equipmentRow=equipmentRows.rows.find(row=>transferMatchesEquipment(before,{id:row.id,...row.record_data}));
 if(!equipmentRow)otpFail('The matching asset was not found in the Equipment master. Correct the master identity before transferring.',409);
 const at=new Date().toISOString();
 const pulse=pulseWriter?await pulseWriter.completeTransfer({transfer:before,equipment:{id:equipmentRow.id,...equipmentRow.record_data},approvedBy,requester}):{mode:'local-only'};
 const updatedEquipment=applyAcceptedVehicleTransfer(equipmentRow.record_data,before,{acceptedAt:at,acceptedBy:`Express OTP transfer (${requester})`});
 const updated={...before,status:VEHICLE_TRANSFER_STATUS.COMPLETED,expressOtp:true,
  sourceApprovedBy:approvedBy.join(', '),sourceApprovedLogin:approvedBy[0]||'',sourceApprovedAt:at,sourceApprovedVia:'otp',
  destinationMisVerifiedBy:requester,destinationMisVerifiedLogin:requester,destinationMisVerifiedAt:at,
  destinationAcceptedBy:`Express OTP transfer (${requester})`,destinationAcceptedLogin:requester,destinationAcceptedAt:at,destinationAcceptanceImplied:true,
  vehicleMasterUpdatedAt:at,vehicleMasterRecordId:equipmentRow.id,pulseWrite:pulse};
 await client.query(`UPDATE master_records SET record_data=$1::jsonb WHERE id=$2 AND master_name='Equipment master'`,[JSON.stringify(updatedEquipment),equipmentRow.id]);
 await client.query(`UPDATE master_records SET record_data=$1::jsonb WHERE id=$2 AND master_name='Vehicle transfers'`,[JSON.stringify(updated),transferId]);
 return {before,updated,equipment:{id:equipmentRow.id,...updatedEquipment}};
}

export function registerVehicleTransferExpress(app,{pool,requireSession,accessContext,pmLogins,deliver,pulseWriter=null,notify=async()=>{},ensureSchema=async()=>{},auditEvent=()=>{}}){
 const transaction=async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}};
 const wrap=fn=>async(req,res,next)=>{try{await ensureSchema();res.set('Cache-Control','no-store');await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message,...(e.extra||{})});next(e)}};
 const login=req=>text(req.session.login||req.session.name).toLowerCase();
 const publicTransfer=(id,record)=>({id,transferNo:record.transferNo,source:record.source,destination:record.destination,status:vehicleTransferStatus(record),equipment:record.equipment,door:record.door,expressOtp:Boolean(record.expressOtp)});
 const publicOtp=row=>({id:row.id,expiresAt:row.expires_at,sentTo:row.sent_to,channels:row.channels,attempts:row.attempts,status:row.status});

 app.post('/api/vehicle-transfers/express',requireSession,wrap(async(req,res)=>{
  const context=await accessContext(req.session,pool);
  if(!context.canSubmit)otpFail('Only an MIS User or MIS Manager can request an express transfer.',403);
  if(pulseWriter?.assertAvailable)await pulseWriter.assertAvailable('transfer');
  const assetId=Number(req.body?.assetId);if(!Number.isInteger(assetId)||assetId<=0)otpFail('Select the asset to transfer.');
  const batchId=text(req.body?.batchId)||null;if(batchId&&!uuid(batchId))otpFail('Invalid batch reference.');
  const result=await transaction(async client=>{
   const batch=batchId?(await client.query('SELECT id,name,site,book_date::text AS report_date,closed_at FROM mis_vlb_batches WHERE id=$1 AND archived_at IS NULL',[batchId])).rows[0]:null;
   if(batchId&&!batch)otpFail('Batch is unavailable.',404);
   const destination=displaySiteName(batch?batch.site:text(req.body?.destination));
   if(!destination)otpFail('Select the destination site.');
   if(!reportScopeIncludesSite(context.scope,destination))otpFail('You can request express transfers only for your assigned sites.',403);
   const equipmentRow=(await client.query(`SELECT id,record_data FROM master_records WHERE master_name='Equipment master' AND id=$1 FOR UPDATE`,[assetId])).rows[0];
   if(!equipmentRow)otpFail('The asset is no longer in the Equipment master.',404);
   const equipment={id:equipmentRow.id,...equipmentRow.record_data},source=displaySiteName(equipment.currentLocation||equipment.location||equipment.site||'');
   if(canonicalSiteName(source)===canonicalSiteName(destination))otpFail('This asset is already assigned to '+destination+'. Refresh the batch.',409);
   const pending=(await client.query(`SELECT id,record_data FROM master_records WHERE master_name='Vehicle transfers' AND record_data->>'equipmentMasterId'=$1 AND record_data->>'status'=ANY($2::text[]) ORDER BY id DESC LIMIT 1`,[String(assetId),PENDING])).rows[0];
   let transferId,record;
   if(pending){
    if(canonicalSiteName(pending.record_data.destination)!==canonicalSiteName(destination))otpFail(`Transfer ${pending.record_data.transferNo} for this asset is already in progress to ${pending.record_data.destination}. Complete or cancel it first.`,409);
    transferId=pending.id;record=pending.record_data;
   }else{
    record=normalizeOperationalSiteFields({transferNo:`VT-${Date.now()}-${randomUUID().slice(0,4).toUpperCase()}`,transferDate:batch?.report_date||new Date().toISOString().slice(0,10),source,destination,equipmentMasterId:equipmentRow.id,
     equipment:equipment.door||equipment.reg||equipment.equipmentName||equipment.itemName||equipmentDoorNumber(equipment)||'',door:equipment.door||'',reg:equipment.reg||'',modelNo:equipment.modelNo||equipment.model||'',manufacturerSerialNo:equipment.manufacturerSerialNo||'',chassisNo:equipment.chassisNo||equipment.chassis||'',
     driver:'',dieselQty:'',kmr:'',hmr:'',remarks:`Express transfer requested from VLB/ELB batch ${batch?.name||''}`.trim(),status:VEHICLE_TRANSFER_STATUS.SOURCE_APPROVAL,expressOtp:true,expressBatchId:batch?.id||null,
     submittedBy:req.session.name||req.session.login||'MIS',submittedLogin:login(req),submittedAt:new Date().toISOString()});
    const validationError=vehicleTransferValidationError(record);if(validationError)otpFail(validationError);
    transferId=(await client.query(`INSERT INTO master_records (master_name,record_data) VALUES ('Vehicle transfers',$1::jsonb) RETURNING id`,[JSON.stringify(record)])).rows[0].id;
   }
   const live=(await client.query("SELECT * FROM mis_vehicle_transfer_otps WHERE transfer_id=$1 AND status='sent' FOR UPDATE",[transferId])).rows[0];
   if(live&&resendTooSoon(live.requested_at))otpFail('An OTP was sent less than a minute ago. Wait before requesting again.',429);
   if(live)await client.query("UPDATE mis_vehicle_transfer_otps SET status='cancelled' WHERE id=$1",[live.id]);
   const logins=await pmLogins(client,record.source);
   if(!logins.length)otpFail(`No Project Manager is assigned to ${displaySiteName(record.source)}. Raise the transfer in the normal workflow.`,409);
   const id=randomUUID(),otp=generateOtp(),expiresAt=otpExpiresAt();
   const message=expressTransferMessage({transfer:record,equipment,requestedBy:req.session.name||login(req),batchName:batch?.name,otp});
   const delivery=await deliver({logins,message,otp,eventKey:`transfer-otp:${id}`});
   if(!delivery.sentTo.length)otpFail(`${displaySiteName(record.source)} PM has no Telegram or mobile registered. ${delivery.failures.join(' ')}`.trim(),409);
   const row=(await client.query('INSERT INTO mis_vehicle_transfer_otps(id,transfer_id,batch_id,asset_id,requested_by,sent_to,channels,otp_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[id,transferId,batch?.id||null,assetId,login(req),delivery.sentTo,delivery.channels,hashOtp(id,otp),expiresAt])).rows[0];
   auditEvent(req,{action:'Request express transfer OTP',reference:record.transferNo,details:{sentTo:delivery.sentTo,channels:delivery.channels,source:record.source,destination:record.destination}});
   return {transfer:publicTransfer(transferId,record),otp:publicOtp(row),reused:Boolean(pending)};
  });
  res.status(201).json(result);
 }));

 app.post('/api/vehicle-transfers/express/:otpId/verify',requireSession,wrap(async(req,res)=>{
  if(!uuid(req.params.otpId))otpFail('Invalid OTP reference.');
  const context=await accessContext(req.session,pool);
  if(!context.canSubmit)otpFail('Only an MIS User or MIS Manager can enter an express transfer OTP.',403);
  const result=await transaction(async client=>{
   const row=(await client.query('SELECT * FROM mis_vehicle_transfer_otps WHERE id=$1 FOR UPDATE',[req.params.otpId])).rows[0];
   const check=checkOtpAttempt(row,req.body?.otp);
   if(!check.ok){
    if(row&&check.status!==row.status||row&&check.attempts!==undefined&&check.attempts!==row.attempts)await client.query('UPDATE mis_vehicle_transfer_otps SET status=$2,attempts=$3 WHERE id=$1',[row.id,check.status==='missing'?row.status:check.status,check.attempts??row.attempts]);
    otpFail(check.message,400);
   }
   const outcome=await completeExpressTransfer(client,{transferId:row.transfer_id,approvedBy:row.sent_to,requester:login(req),pulseWriter});
   await client.query("UPDATE mis_vehicle_transfer_otps SET status='used',used_at=NOW(),approved_by=$2 WHERE id=$1",[row.id,row.sent_to.join(', ')]);
   const audit=vehicleTransferAuditDetails(outcome.updated,{previousStatus:outcome.before.status});
   audit.changedFields.push({field:'Vehicle Master location',before:outcome.before.source,after:outcome.before.destination},{field:'Approval',before:'Pending',after:'Source PM OTP; destination acceptance implied'});
   auditEvent(req,{action:'Complete express transfer by OTP',reference:outcome.updated.transferNo,details:audit});
   return {transfer:publicTransfer(row.transfer_id,outcome.updated),equipment:{id:outcome.equipment.id,door:outcome.equipment.door,currentLocation:outcome.equipment.currentLocation},completed:true,pulseWrite:outcome.updated.pulseWrite};
  });
  void notify(pool,result.transfer).catch(()=>{});
  res.json(result);
 }));

 app.get('/api/vehicle-transfers/express/:otpId',requireSession,wrap(async(req,res)=>{
  if(!uuid(req.params.otpId))otpFail('Invalid OTP reference.');
  const row=(await pool.query('SELECT * FROM mis_vehicle_transfer_otps WHERE id=$1',[req.params.otpId])).rows[0];
  if(!row)otpFail('OTP request not found.',404);
  const transfer=(await pool.query(`SELECT id,record_data FROM master_records WHERE id=$1 AND master_name='Vehicle transfers'`,[row.transfer_id])).rows[0];
  res.json({otp:publicOtp(row),transfer:transfer?publicTransfer(transfer.id,transfer.record_data):null});
 }));
}

// Pending transfer for an asset, shown on the batch holds panel.
export async function pendingTransferFor(client,assetId){
 const {rows}=await client.query(`SELECT id,record_data FROM master_records WHERE master_name='Vehicle transfers' AND record_data->>'equipmentMasterId'=$1 AND record_data->>'status'=ANY($2::text[]) ORDER BY id DESC LIMIT 1`,[String(assetId),PENDING]);
 if(!rows[0])return null;
 const otp=(await client.query("SELECT id,expires_at,sent_to,channels,status FROM mis_vehicle_transfer_otps WHERE transfer_id=$1 ORDER BY requested_at DESC LIMIT 1",[rows[0].id])).rows[0]||null;
 return {id:rows[0].id,transferNo:rows[0].record_data.transferNo,status:vehicleTransferStatus(rows[0].record_data),source:rows[0].record_data.source,destination:rows[0].record_data.destination,otp:otp?{id:otp.id,expiresAt:otp.expires_at,sentTo:otp.sent_to,channels:otp.channels,status:otp.status}:null};
}
