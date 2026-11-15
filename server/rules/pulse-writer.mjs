// Pulse is the only Equipment master. Pulse-II must never hold a transfer or a new asset that
// Pulse does not have, because the master sync replaces every linked record with Pulse's copy.
//
// Vehicle transfers (16 Nov 2026): Pulse completes them through its MIS bridge
// ('vehicle-transfer-complete', Pulse Master Sync channel), so no token or address has to be set
// on the server. The "Send vehicle transfers to Pulse" switch (pulse-transfer-switch.mjs) turns it
// on and off; ON is the default.
// New assets: still refused with an honest message until Pulse can create them from Pulse-II.
//
// PULSE_WRITE_MODE=live keeps the older token design (PULSE_INTEGRATION_URL/TOKEN) for both.
export const PULSE_WRITE_MODES=Object.freeze(['off','live']);
export const pulseWriteMode=(env=process.env)=>{const mode=String(env.PULSE_WRITE_MODE||'off').trim().toLowerCase();return PULSE_WRITE_MODES.includes(mode)?mode:'off';};

const refuse=(message,status=409)=>Object.assign(new Error(message),{status,extra:{code:'pulse_write_unavailable'}});
// Pulse did not answer, or could not take the transfer now (sign-in, access, Pulse update not
// live yet): trying again later can succeed, so an acceptance waits in the queue.
const unavailable=message=>Object.assign(new Error(message),{status:503,retryable:true,extra:{code:'pulse_unavailable'}});
// Pulse answered and said no (vehicle at another site, transfer open in Pulse, unknown site):
// trying again cannot succeed until someone changes something.
const refused=(message,status)=>Object.assign(new Error(message),{status,retryable:false,extra:{code:'pulse_refused'}});
export const PULSE_UNAVAILABLE_MESSAGES={
 transfer:'Sending vehicle transfers to Pulse is switched off on the Pulse Master Sync page. Ask the Pulse administrator to complete this transfer in Pulse; the card stays on hold and clears automatically after the next master sync.',
 equipment:'Pulse cannot be updated from Pulse-II yet. Ask the Pulse administrator to create this asset in Pulse; it appears here after the next master sync and the card can then be saved.',
};
const DEFINITE_REFUSALS=new Set([400,404,409,422]);
const BRIDGE_TIMEOUT_MS=15_000;
const TRANSFER_FIELDS=['transferNo','transferDate','transferTime','source','destination','equipment','door','reg','modelNo','manufacturerSerialNo','chassisNo','driver','dieselQty','kmr','hmr','remarks'];
const PEOPLE_FIELDS=['submittedBy','submittedLogin','submittedAt','sourceApprovedBy','sourceApprovedLogin','sourceApprovedAt',
 'destinationMisVerifiedBy','destinationMisVerifiedLogin','destinationMisVerifiedAt','destinationAcceptedBy','destinationAcceptedLogin','destinationAcceptedAt'];
const pick=(record,fields)=>Object.fromEntries(fields.map(key=>[key,record?.[key]]).filter(([,value])=>value!==undefined&&value!==null&&String(value).trim()!==''));

/** Pulse's answer to a bridge error, as a queue (retryable) or a final (refused) error. */
export function classifyPulseTransferError(error){
 const status=Number(error?.status)||0;
 if(DEFINITE_REFUSALS.has(status))return refused(error.message||'Pulse refused the transfer. Nothing was changed.',409);
 if(status===403&&/MIS menus do not allow/i.test(error.message||''))
  return unavailable('Pulse is not ready to receive vehicle transfers yet: either the Pulse update is not live, or the Pulse login connected for Pulse Master Sync has lost that menu.');
 if(status===401)return unavailable('No Pulse Master Sync login has signed in to Pulse II in the last seven days, so Pulse cannot be reached. An administrator with Pulse Master Sync should sign in to Pulse II once.');
 return unavailable(error?.message?`Pulse did not complete the transfer: ${error.message}`:'Pulse did not answer.');
}

export function createPulseWriter({env=process.env,fetchImpl=fetch,sharedSignIn=null,transferSwitch=null,pool=null}={}){
 const mode=()=>pulseWriteMode(env);
 /** 'live' (token design), 'bridge' (MIS bridge, switch ON) or 'off'. */
 const transferMode=async()=>{
  if(mode()==='live')return 'live';
  if(sharedSignIn&&transferSwitch&&await transferSwitch.on())return 'bridge';
  return 'off';
 };
 const liveConfig=kind=>{
  const base=String(env.PULSE_INTEGRATION_URL||'').trim(),token=String(env.PULSE_INTEGRATION_TOKEN||'').trim();
  if(!base||!token)throw refuse('Pulse integration is switched on but PULSE_INTEGRATION_URL or PULSE_INTEGRATION_TOKEN is not configured on the server.',503);
  return {base:base.replace(/\/+$/,''),token,kind};
 };
 const assertAvailable=async kind=>{
  if(kind==='transfer'){const current=await transferMode();if(current==='off')throw refuse(PULSE_UNAVAILABLE_MESSAGES.transfer);return current==='live'?liveConfig(kind):{mode:'bridge'};}
  if(mode()==='off')throw refuse(PULSE_UNAVAILABLE_MESSAGES[kind]||PULSE_UNAVAILABLE_MESSAGES.equipment);
  return liveConfig(kind);
 };
 const post=async(path,body,idempotencyKey)=>{
  const {base,token}=liveConfig(path.includes('transfer')?'transfer':'equipment');
  let response;
  try{response=await fetchImpl(base+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'Idempotency-Key':idempotencyKey},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});}
  catch(error){throw refuse('Pulse did not answer within ten seconds. Nothing was changed in Pulse or Pulse-II; try again in a moment.',503);}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw refuse(data.error||`Pulse refused the update (HTTP ${response.status}). Nothing was changed in Pulse-II.`,response.status===409?409:502);
  return {mode:'pulse',at:new Date().toISOString(),...data};
 };
 // Pulse knows its own record ids; Pulse-II's ids are local. The hourly copy keeps the pairs.
 const pulseLink=async localId=>{
  if(!pool||!/^\d+$/.test(String(localId??'')))return null;
  const {rows}=await pool.query(`SELECT master_name,source_id FROM pulse_master_links WHERE local_id=$1 AND master_name IN ('Equipment master','LMV master') LIMIT 1`,[localId]);
  return rows[0]||null;
 };
 const completeThroughBridge=async({transfer,equipment,approvedBy=[],requester='',people={},route})=>{
  const express=route==='express';
  const merged={...pick(transfer,PEOPLE_FIELDS),...(express?{
   sourceApprovedBy:approvedBy.join(', '),sourceApprovedLogin:approvedBy[0]||'',destinationMisVerifiedBy:requester,destinationMisVerifiedLogin:requester,
   destinationAcceptedBy:`Express OTP transfer (${requester})`,destinationAcceptedLogin:requester}:{}),...pick(people,PEOPLE_FIELDS)};
  const link=await pulseLink(equipment?.id).catch(()=>null);
  const body={transfer:pick(transfer,TRANSFER_FIELDS),equipmentId:link?.source_id||null,master:link?.master_name||'Equipment master',people:merged,route:express?'express':'workflow'};
  let data;
  try{data=await sharedSignIn.request('vehicle-transfer-complete',body,null,{menu:'Pulse Master Sync',timeoutMs:BRIDGE_TIMEOUT_MS});}
  catch(error){throw classifyPulseTransferError(error);}
  if(!data?.pulseTransferId)throw unavailable('Pulse answered without a transfer reference.');
  return {mode:'pulse',via:'bridge',at:new Date().toISOString(),pulseTransferId:String(data.pulseTransferId),pulseEquipmentId:String(data.equipmentId||''),
   pulseSite:String(data.site||''),replay:data.replay===true,alreadyAtDestination:data.alreadyAtDestination===true};
 };
 return {
  mode,transferMode,assertAvailable,
  async completeTransfer({transfer,equipment,approvedBy=[],requester='',idempotencyKey,people={},route='express'}){
   const current=await transferMode();
   if(current==='off')throw refuse(PULSE_UNAVAILABLE_MESSAGES.transfer);
   if(current==='bridge')return completeThroughBridge({transfer,equipment,approvedBy,requester,people,route});
   return post(`/api/integrations/vehicle-transfers/${encodeURIComponent(transfer.transferNo||'')}/complete`,{transfer,equipmentId:equipment?.id,approvedBy,requester},idempotencyKey||transfer.transferNo);
  },
  createEquipment:async({equipment,approvedBy,requester,idempotencyKey})=>{await assertAvailable('equipment');return post('/api/integrations/equipment',{equipment,approvedBy,requester},idempotencyKey||`${equipment.site}|${equipment.door}`);},
 };
}
