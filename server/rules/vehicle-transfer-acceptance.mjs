// Destination PM acceptance of a vehicle transfer, with Pulse first (16 Nov 2026).
//
// Pulse keeps the Equipment master and Pulse-II copies it every hour, so a vehicle moved only in
// Pulse-II jumped back at the next copy. Acceptance now runs in two parts:
//  1. Pulse completes the transfer (pulse-writer.mjs, MIS bridge). No Pulse-II lock is held while
//     Pulse is asked, so card saves and the hourly copy never wait on Pulse.
//  2. Only after Pulse answers, one transaction moves the vehicle in Pulse-II and completes the
//     transfer (completeAcceptance).
// If Pulse refuses (vehicle at another site in Pulse, a Pulse transfer still open, unknown site),
// nothing changes and the PM sees Pulse's reason. If Pulse cannot be reached, the acceptance is
// kept on the transfer (pulseQueue) and the queue below finishes it as soon as Pulse answers.
import {VEHICLE_TRANSFER_STATUS,applyAcceptedVehicleTransfer,transferMatchesEquipment,vehicleTransferStatus} from '../../shared/vehicle-transfer-workflow.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
export const PULSE_QUEUE_FIRST_RETRY_MS=2*60_000;
export const PULSE_QUEUE_MAX_RETRY_MS=15*60_000;
/** 2, 4, 6 ... minutes between tries, never more than 15. */
export const nextPulseRetryDelay=attempts=>Math.min(PULSE_QUEUE_FIRST_RETRY_MS*Math.max(1,attempts),PULSE_QUEUE_MAX_RETRY_MS);

export const acceptancePeople=acceptance=>({destinationAcceptedBy:acceptance.acceptedBy,destinationAcceptedLogin:acceptance.acceptedLogin,destinationAcceptedAt:acceptance.acceptedAt});

/** The vehicle a transfer moves, read without a lock. */
export async function findTransferEquipment(db,transfer){
 const {rows}=await db.query(`SELECT id,record_data FROM master_records WHERE master_name='Equipment master' ORDER BY id`);
 return rows.find(row=>transferMatchesEquipment(transfer,{id:row.id,...row.record_data}))||null;
}

/** Part 2: move the vehicle in Pulse-II and complete the transfer. Runs inside the caller's transaction. */
export async function completeAcceptance(client,{id,acceptance,pulse,now=Date.now}){
 const {rows}=await client.query(`SELECT record_data FROM master_records WHERE id=$1 AND master_name='Vehicle transfers' FOR UPDATE`,[id]);
 const before=rows[0]?.record_data;
 if(!before)throw fail(404,'Vehicle transfer not found.');
 if(vehicleTransferStatus(before)!==VEHICLE_TRANSFER_STATUS.DESTINATION_ACCEPTANCE)throw fail(409,'This transfer is not awaiting destination PM acceptance.');
 const match=await findTransferEquipment(client,before);
 if(!match)throw fail(409,'The matching vehicle was not found in Vehicle Master. Update the master identity before accepting.');
 // Only this vehicle's row is locked, not the whole Equipment master.
 const row=(await client.query(`SELECT id,record_data FROM master_records WHERE id=$1 AND master_name='Equipment master' FOR UPDATE`,[match.id])).rows[0];
 if(!row)throw fail(409,'The vehicle changed in Vehicle Master while it was accepted. Try again.');
 const at=new Date(now()).toISOString();
 const updatedEquipment=applyAcceptedVehicleTransfer(row.record_data,before,{acceptedAt:acceptance.acceptedAt,acceptedBy:acceptance.acceptedBy});
 const {pulseQueue,pulseRefused,...rest}=before;
 const updated={...rest,status:VEHICLE_TRANSFER_STATUS.COMPLETED,...acceptancePeople(acceptance),vehicleMasterUpdatedAt:at,vehicleMasterRecordId:row.id,pulseWrite:pulse,
  ...(pulseQueue?{pulseWaited:{queuedAt:pulseQueue.queuedAt,attempts:pulseQueue.attempts,firstError:pulseQueue.firstError}}:{})};
 await client.query(`UPDATE master_records SET record_data=$1::jsonb WHERE id=$2 AND master_name='Equipment master'`,[JSON.stringify(updatedEquipment),row.id]);
 await client.query(`UPDATE master_records SET record_data=$1::jsonb WHERE id=$2 AND master_name='Vehicle transfers'`,[JSON.stringify(updated),id]);
 return {before,updated,equipmentId:row.id};
}

/** Pulse could not be reached: keep the acceptance on the transfer for the queue. */
export async function queueAcceptance(client,{id,acceptance,error,now=Date.now}){
 const {rows}=await client.query(`SELECT record_data FROM master_records WHERE id=$1 AND master_name='Vehicle transfers' FOR UPDATE`,[id]);
 const before=rows[0]?.record_data;
 if(!before)throw fail(404,'Vehicle transfer not found.');
 if(vehicleTransferStatus(before)!==VEHICLE_TRANSFER_STATUS.DESTINATION_ACCEPTANCE)throw fail(409,'This transfer is not awaiting destination PM acceptance.');
 if(before.pulseQueue)throw fail(409,`${before.pulseQueue.acceptedBy||'The destination PM'} already accepted this vehicle; it moves as soon as Pulse confirms.`);
 const at=now(),message=String(error?.message||'Pulse did not answer.').slice(0,300);
 const {pulseRefused,...rest}=before;
 const updated={...rest,pulseQueue:{...acceptance,queuedAt:new Date(at).toISOString(),attempts:1,firstError:message,lastError:message,
  lastTriedAt:new Date(at).toISOString(),nextAt:new Date(at+nextPulseRetryDelay(1)).toISOString()}};
 await client.query(`UPDATE master_records SET record_data=$1::jsonb WHERE id=$2 AND master_name='Vehicle transfers'`,[JSON.stringify(updated),id]);
 return updated;
}

const transaction=async(pool,fn)=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}};

/**
 * Finishes acceptances that waited for Pulse. Each due transfer is sent to Pulse again; Pulse
 * answers a repeated transfer number with its first answer, so a lost reply never moves a vehicle twice.
 */
export function createTransferPulseQueue({pool,writer,onCompleted=async()=>{},onRefused=async()=>{},now=Date.now,intervalMs=60_000,log=console}){
 let timer=null,running=null,lastRun=null,lastResult=null;
 const save=(client,id,record)=>client.query(`UPDATE master_records SET record_data=$1::jsonb WHERE id=$2 AND master_name='Vehicle transfers'`,[JSON.stringify(record),id]);
 const one=async(id)=>{
  // Re-read under a lock: a second server or a PM may have acted meanwhile.
  const current=await transaction(pool,async client=>(await client.query(`SELECT record_data FROM master_records WHERE id=$1 AND master_name='Vehicle transfers' FOR UPDATE`,[id])).rows[0]?.record_data);
  const queue=current?.pulseQueue;
  if(!queue||Date.parse(queue.nextAt||0)>now())return 'skipped';
  if(vehicleTransferStatus(current)!==VEHICLE_TRANSFER_STATUS.DESTINATION_ACCEPTANCE){
   await transaction(pool,async client=>{const {pulseQueue,...rest}=current;await save(client,id,rest);});
   return 'dropped';
  }
  const acceptance={acceptedAt:queue.acceptedAt,acceptedBy:queue.acceptedBy,acceptedLogin:queue.acceptedLogin};
  let pulse;
  if(await writer.transferMode()==='off')pulse={mode:'local-only',note:'Sending vehicle transfers to Pulse was switched off while this acceptance waited for Pulse.'};
  else{
   const vehicle=await findTransferEquipment(pool,current);
   try{
    if(!vehicle)throw Object.assign(new Error('The matching vehicle was not found in Vehicle Master.'),{retryable:false});
    pulse=await writer.completeTransfer({transfer:current,equipment:{id:vehicle.id,...vehicle.record_data},people:acceptancePeople(acceptance),route:'workflow'});
   }catch(error){
    const message=String(error?.message||'Pulse did not answer.').slice(0,300);
    if(error?.retryable===false||error?.extra?.code==='pulse_refused'){
     const refused=await transaction(pool,async client=>{
      const latest=(await client.query(`SELECT record_data FROM master_records WHERE id=$1 AND master_name='Vehicle transfers' FOR UPDATE`,[id])).rows[0]?.record_data;
      if(!latest?.pulseQueue)return null;
      const {pulseQueue,...rest}=latest;
      const record={...rest,pulseRefused:{error:message,at:new Date(now()).toISOString(),acceptedBy:pulseQueue.acceptedBy,acceptedLogin:pulseQueue.acceptedLogin}};
      await save(client,id,record);return record;
     });
     if(refused)await onRefused({id,transfer:refused,error:message}).catch(e=>log.error?.('[transfer-pulse-queue] refusal notice failed:',e?.message||e));
     return 'refused';
    }
    await transaction(pool,async client=>{
     const latest=(await client.query(`SELECT record_data FROM master_records WHERE id=$1 AND master_name='Vehicle transfers' FOR UPDATE`,[id])).rows[0]?.record_data;
     if(!latest?.pulseQueue)return;
     const attempts=Number(latest.pulseQueue.attempts||1)+1;
     await save(client,id,{...latest,pulseQueue:{...latest.pulseQueue,attempts,lastError:message,lastTriedAt:new Date(now()).toISOString(),nextAt:new Date(now()+nextPulseRetryDelay(attempts)).toISOString()}});
    });
    return 'waiting';
   }
  }
  const result=await transaction(pool,client=>completeAcceptance(client,{id,acceptance,pulse,now}));
  await onCompleted(result).catch(e=>log.error?.('[transfer-pulse-queue] completion notice failed:',e?.message||e));
  return 'completed';
 };
 const runOnce=()=>{
  if(running)return running;
  running=(async()=>{
   const counts={completed:0,waiting:0,refused:0,dropped:0,skipped:0,failed:0};
   const {rows}=await pool.query(`SELECT id FROM master_records WHERE master_name='Vehicle transfers' AND record_data ? 'pulseQueue' AND COALESCE(record_data->'pulseQueue'->>'nextAt','')<=$1 ORDER BY id`,[new Date(now()).toISOString()]);
   for(const {id} of rows){
    try{counts[await one(id)]++;}
    catch(error){counts.failed++;log.error?.('[transfer-pulse-queue] transfer',id,error?.message||error);}
   }
   lastRun=new Date(now()).toISOString();lastResult=counts;
   return counts;
  })().finally(()=>{running=null;});
  return running;
 };
 return {
  runOnce,
  async waiting(){const {rows}=await pool.query(`SELECT count(*)::int AS n FROM master_records WHERE master_name='Vehicle transfers' AND record_data ? 'pulseQueue'`);return rows[0]?.n||0;},
  status:()=>({lastRun,lastResult,intervalSeconds:intervalMs/1000}),
  start(){if(timer)return;void runOnce().catch(()=>{});timer=setInterval(()=>void runOnce().catch(()=>{}),intervalMs);timer.unref?.();},
  stop(){clearInterval(timer);timer=null;},
 };
}
