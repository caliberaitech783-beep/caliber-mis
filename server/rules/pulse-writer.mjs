// Pulse is the only Equipment master. Pulse-II must never hold a transfer or a new asset that
// Pulse does not have, because the master sync replaces every linked record with Pulse's copy
// within a minute. Until Pulse exposes its two integration endpoints, express completion is
// refused with an honest message instead of being recorded local-only.
//
// PULSE_WRITE_MODE: off (default) refuses; live calls the Pulse endpoints once they exist.
export const PULSE_WRITE_MODES=Object.freeze(['off','live']);
export const pulseWriteMode=(env=process.env)=>{const mode=String(env.PULSE_WRITE_MODE||'off').trim().toLowerCase();return PULSE_WRITE_MODES.includes(mode)?mode:'off';};

const refuse=(message,status=409)=>Object.assign(new Error(message),{status,extra:{code:'pulse_write_unavailable'}});
export const PULSE_UNAVAILABLE_MESSAGES={
 transfer:'Pulse cannot be updated from Pulse-II yet. Ask the Pulse administrator to complete this transfer in Pulse; the card stays on hold and clears automatically after the next master sync.',
 equipment:'Pulse cannot be updated from Pulse-II yet. Ask the Pulse administrator to create this asset in Pulse; it appears here after the next master sync and the card can then be saved.',
};

export function createPulseWriter({env=process.env,fetchImpl=fetch}={}){
 const mode=()=>pulseWriteMode(env);
 const assertAvailable=async kind=>{
  if(mode()==='off')throw refuse(PULSE_UNAVAILABLE_MESSAGES[kind]||PULSE_UNAVAILABLE_MESSAGES.transfer);
  const base=String(env.PULSE_INTEGRATION_URL||'').trim(),token=String(env.PULSE_INTEGRATION_TOKEN||'').trim();
  if(!base||!token)throw refuse('Pulse integration is switched on but PULSE_INTEGRATION_URL or PULSE_INTEGRATION_TOKEN is not configured on the server.',503);
  return {base:base.replace(/\/+$/,''),token};
 };
 const post=async(path,body,idempotencyKey)=>{
  const {base,token}=await assertAvailable(path.includes('transfer')?'transfer':'equipment');
  let response;
  try{response=await fetchImpl(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'Idempotency-Key':idempotencyKey},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});}
  catch(error){throw refuse('Pulse did not answer within ten seconds. Nothing was changed in Pulse or Pulse-II; try again in a moment.',503);}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw refuse(data.error||`Pulse refused the update (HTTP ${response.status}). Nothing was changed in Pulse-II.`,response.status===409?409:502);
  return {mode:'pulse',at:new Date().toISOString(),...data};
 };
 return {
  mode,assertAvailable,
  completeTransfer:({transfer,equipment,approvedBy,requester,idempotencyKey})=>post(`/api/integrations/vehicle-transfers/${encodeURIComponent(transfer.transferNo||'')}/complete`,{transfer,equipmentId:equipment?.id,approvedBy,requester},idempotencyKey||transfer.transferNo),
  createEquipment:({equipment,approvedBy,requester,idempotencyKey})=>post('/api/integrations/equipment',{equipment,approvedBy,requester},idempotencyKey||`${equipment.site}|${equipment.door}`),
 };
}
