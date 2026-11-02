import {randomUUID} from 'node:crypto';
import {canonicalSiteName} from './site-location.mjs';
import {displaySiteName,normalizeOperationalSiteFields,reportScopeIncludesSite} from './region-scope.mjs';
import {fleetDoorKey} from './scan-fleet-door.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {generateOtp,hashOtp,otpExpiresAt,checkOtpAttempt,resendTooSoon,otpFail,OTP_TTL_MINUTES} from './otp-approval.mjs';

const text=(value,max=200)=>String(value??'').trim().slice(0,max);
const key=value=>text(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
export const EQUIPMENT_CATEGORIES=['Vehicle','Equipment'];

// A new purchase must carry a chassis or registration: that is the key the Pulse master
// sync later uses to link the record instead of creating a duplicate.
export function normalizeEquipmentDraft(input={},site){
 const draft={door:text(input.door,80),category:EQUIPMENT_CATEGORIES.find(c=>c.toLowerCase()===text(input.category).toLowerCase())||'',equipmentName:text(input.equipmentName),group:text(input.group||input.equipmentGroup),make:text(input.make),model:text(input.model),
  reg:text(input.registration||input.reg,80),chassisNo:text(input.chassis||input.chassisNo,80),manufacturerSerialNo:text(input.manufacturerSerialNo,80),engineNo:text(input.engineNo,80),openingHmr:text(input.openingHmr,20),openingKmr:text(input.openingKmr,20),remarks:text(input.remarks,1000)};
 if(!draft.door||!/\d/.test(draft.door))otpFail('Enter the door number as painted on the asset.');
 if(!draft.category)otpFail('Select whether this is a tipper (Vehicle) or a machine (Equipment).');
 if(!draft.chassisNo&&!draft.reg)otpFail('Enter the chassis number or the registration number. Pulse links the asset by one of them.');
 if(!draft.equipmentName)draft.equipmentName=draft.door;
 if(!site)otpFail('Select the site for the new asset.');
 return {...draft,site:displaySiteName(site),currentLocation:displaySiteName(site)};
}

// Same chassis, registration or door anywhere means a transfer, not a new asset.
export function findExistingEquipment(draft,assets=[]){
 const chassis=key(draft.chassisNo),reg=key(draft.reg),door=fleetDoorKey(draft.door);
 const byChassis=asset=>[asset.chassisNo,asset.chassis,asset.manufacturerSerialNo].map(key).filter(Boolean).includes(chassis);
 const byReg=asset=>[asset.reg,asset.registration,asset.registrationNumber].map(key).filter(Boolean).includes(reg);
 const byDoor=asset=>fleetDoorKey(asset.door||asset.doorNo||equipmentDoorNumber(asset))===door;
 for(const [matchedOn,enabled,predicate] of [['chassis',Boolean(chassis),byChassis],['registration',Boolean(reg),byReg],['door',Boolean(door),byDoor]]){
  if(!enabled)continue;const asset=assets.find(predicate);if(asset)return {asset,matchedOn};
 }
 return null;
}

export function newEquipmentMessage({draft,requestedBy,batchName,otp}){
 const identity=[draft.make,draft.model].filter(Boolean).join(' '),ids=[draft.chassisNo?'chassis '+draft.chassisNo:'',draft.reg?'reg '+draft.reg:''].filter(Boolean).join(', ');
 return ['Caliber Pulse: new equipment approval',`${requestedBy} wants to add ${draft.door}${identity?' ('+identity+(ids?', '+ids:'')+')':ids?' ('+ids+')':''} to ${draft.site}.`,
  batchName?`Reason: card in batch ${batchName}.`:'Reason: card entered at the site.',`OTP ${otp}, valid ${OTP_TTL_MINUTES} minutes. Share it only if this is a genuine new asset at your site.`].join('\n');
}

export function registerEquipmentCreateExpress(app,{pool,requireSession,accessContext,pmLogins,deliver,pulseWriter=null,ensureSchema=async()=>{},auditEvent=()=>{}}){
 const transaction=async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}};
 const wrap=fn=>async(req,res,next)=>{try{await ensureSchema();res.set('Cache-Control','no-store');await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message,...(e.extra||{})});next(e)}};
 const login=req=>text(req.session.login||req.session.name).toLowerCase();
 const publicRequest=row=>({id:row.id,site:row.site,door:row.door,expiresAt:row.expires_at,sentTo:row.sent_to,channels:row.channels,attempts:row.attempts,status:row.status,draft:row.draft});

 app.post('/api/equipment/express',requireSession,wrap(async(req,res)=>{
  const context=await accessContext(req.session,pool);
  if(!context.canSubmit)otpFail('Only an MIS User or MIS Manager can create equipment from an entry screen.',403);
  if(pulseWriter?.assertAvailable)await pulseWriter.assertAvailable('equipment');
  const batchId=text(req.body?.batchId)||null;if(!batchId||!uuid(batchId))otpFail('New equipment can be created only from an open VLB/ELB batch.');
  const result=await transaction(async client=>{
   const batch=(await client.query('SELECT id,name,site,closed_at FROM mis_vlb_batches WHERE id=$1 AND archived_at IS NULL',[batchId])).rows[0];
   if(!batch)otpFail('Batch is unavailable.',404);if(batch.closed_at)otpFail('This batch is closed. Reopen it before adding equipment.',409);
   if(!reportScopeIncludesSite(context.scope,batch.site))otpFail('You can add equipment only at your assigned sites.',403);
   const draft=normalizeEquipmentDraft(req.body?.draft||{},batch.site);
   const assets=(await client.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master'")).rows.map(r=>({id:String(r.id),...r.record_data}));
   const existing=findExistingEquipment(draft,assets);
   if(existing){const site=displaySiteName(existing.asset.currentLocation||existing.asset.site||existing.asset.location||'');throw Object.assign(new Error(`${draft.door} already exists in the Equipment master${site?' at '+site:''} (matched on ${existing.matchedOn}). ${canonicalSiteName(site)===canonicalSiteName(batch.site)?'Refresh the masters and select it.':'Use Express transfer instead of creating a new asset.'}`),{status:409,extra:{existing:{id:existing.asset.id,door:existing.asset.door,site,matchedOn:existing.matchedOn},transferRequired:canonicalSiteName(site)!==canonicalSiteName(batch.site)}});}
   const live=(await client.query("SELECT * FROM mis_equipment_create_requests WHERE site=$1 AND door=$2 AND status='sent' FOR UPDATE",[canonicalSiteName(batch.site),fleetDoorKey(draft.door)])).rows[0];
   if(live&&resendTooSoon(live.requested_at))otpFail('An OTP was sent less than a minute ago. Wait before requesting again.',429);
   if(live)await client.query("UPDATE mis_equipment_create_requests SET status='cancelled' WHERE id=$1",[live.id]);
   const logins=await pmLogins(client,batch.site);
   if(!logins.length)otpFail(`No Project Manager is assigned to ${displaySiteName(batch.site)}. Ask an administrator to create the asset in Masters.`,409);
   const id=randomUUID(),otp=generateOtp(),expiresAt=otpExpiresAt();
   const delivery=await deliver({logins,message:newEquipmentMessage({draft,requestedBy:req.session.name||login(req),batchName:batch.name,otp}),otp,eventKey:`equipment-otp:${id}`});
   if(!delivery.sentTo.length)otpFail(`${displaySiteName(batch.site)} PM has no Telegram or mobile registered. ${delivery.failures.join(' ')}`.trim(),409);
   const row=(await client.query('INSERT INTO mis_equipment_create_requests(id,batch_id,site,door,draft,card_draft,requested_by,sent_to,channels,otp_hash,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11) RETURNING *',[id,batch.id,canonicalSiteName(batch.site),fleetDoorKey(draft.door),JSON.stringify(draft),req.body?.cardDraft?JSON.stringify(req.body.cardDraft):null,login(req),delivery.sentTo,delivery.channels,hashOtp(id,otp),expiresAt])).rows[0];
   auditEvent(req,{action:'Request new equipment OTP',reference:draft.door,details:{site:draft.site,sentTo:delivery.sentTo,channels:delivery.channels}});
   return {request:publicRequest(row)};
  });
  res.status(201).json(result);
 }));

 app.post('/api/equipment/express/:id/verify',requireSession,wrap(async(req,res)=>{
  if(!uuid(req.params.id))otpFail('Invalid request reference.');
  const context=await accessContext(req.session,pool);
  if(!context.canSubmit)otpFail('Only an MIS User or MIS Manager can enter this OTP.',403);
  const result=await transaction(async client=>{
   const row=(await client.query('SELECT * FROM mis_equipment_create_requests WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
   const check=checkOtpAttempt(row,req.body?.otp);
   if(!check.ok){
    if(row&&(check.status!==row.status||check.attempts!==undefined&&check.attempts!==row.attempts))await client.query('UPDATE mis_equipment_create_requests SET status=$2,attempts=$3 WHERE id=$1',[row.id,check.status==='missing'?row.status:check.status,check.attempts??row.attempts]);
    otpFail(check.message,400);
   }
   const assets=(await client.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master'")).rows.map(r=>({id:String(r.id),...r.record_data}));
   const existing=findExistingEquipment(row.draft,assets);
   if(existing)otpFail(`${row.draft.door} was created in the Equipment master while this OTP was pending. Refresh the masters and select it.`,409);
   const at=new Date().toISOString(),approvedBy=row.sent_to.join(', ');
   const record=normalizeOperationalSiteFields({...row.draft,door:row.draft.door,status:'Active',createdVia:'express-otp',createdBy:login(req),createdAt:at,approvedBy,approvedAt:at,expressBatchId:row.batch_id});
   const pulse=pulseWriter?await pulseWriter.createEquipment({equipment:record,approvedBy:row.sent_to,requester:login(req)}):{mode:'local-only'};
   record.pulseWrite=pulse;
   const inserted=(await client.query(`INSERT INTO master_records (master_name,record_data) VALUES ('Equipment master',$1::jsonb) RETURNING id`,[JSON.stringify(record)])).rows[0];
   await client.query("UPDATE mis_equipment_create_requests SET status='used',used_at=NOW(),approved_by=$2,equipment_id=$3 WHERE id=$1",[row.id,approvedBy,inserted.id]);
   auditEvent(req,{action:'Create equipment by OTP',reference:record.door,details:{site:record.site,approvedBy,equipmentId:inserted.id,pulseWrite:pulse}});
   return {equipment:{id:String(inserted.id),...record},cardDraft:row.card_draft||null,batchId:row.batch_id};
  });
  res.json(result);
 }));
}
