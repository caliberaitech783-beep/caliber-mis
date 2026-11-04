import {randomUUID,randomInt,createHash,timingSafeEqual} from 'node:crypto';
export const SCAN_DELETION_OTP_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_scan_deletion_otps(id TEXT PRIMARY KEY,actor TEXT NOT NULL,card_id TEXT NOT NULL,revision INTEGER NOT NULL,reason TEXT NOT NULL,otp_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ,consumed_at TIMESTAMPTZ);CREATE INDEX IF NOT EXISTS mis_scan_deletion_otps_actor_time ON mis_scan_deletion_otps(actor,created_at);`;
const digest=(id,otp)=>createHash('sha256').update(id+':'+otp).digest('hex');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export async function issueScanDeletionOtp(pool,{actor,card,reason,send,to}){
 const c=await pool.connect();let result,error;try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(709224104,hashtext($1))',[actor]);
 const rate=(await c.query("SELECT count(*)::int AS count,COALESCE(bool_or(created_at>NOW()-INTERVAL '1 minute'),false) AS recent FROM mis_scan_deletion_otps WHERE actor=$1 AND created_at>NOW()-INTERVAL '1 hour'",[actor])).rows[0];
 if(rate.count>=10||rate.recent)throw fail('Wait one minute between OTP requests; maximum ten per hour.',429);
 const id=randomUUID(),otp=String(randomInt(100000,1000000));await c.query('INSERT INTO mis_scan_deletion_otps(id,actor,card_id,revision,reason,otp_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,actor,String(card.id),card.revision,String(reason).trim().slice(0,2000),digest(id,otp)]);
 let delivery;try{delivery=await send({to,otp,requestId:id,count:1})}catch{}
 if(!delivery?.sent||!delivery.messageId){await c.query("UPDATE mis_scan_deletion_otps SET status='delivery_failed' WHERE id=$1",[id]);error=fail('WhatsApp OTP delivery failed. No card was deleted. Request a new code after one minute.',503)}else{
 await c.query("UPDATE mis_scan_deletion_otps SET status='superseded' WHERE actor=$1 AND card_id=$2 AND status='sent'",[actor,String(card.id)]);
 const saved=(await c.query("UPDATE mis_scan_deletion_otps SET status='sent',expires_at=clock_timestamp()+INTERVAL '10 minutes' WHERE id=$1 RETURNING expires_at",[id])).rows[0];result={requestId:id,recipient:'+91 9925565281',expiresInMinutes:10,expiresAt:saved.expires_at};}
 await c.query('COMMIT');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}if(error)throw error;return result;
}
export async function consumeScanDeletionOtp(pool,{actor,cardId,requestId,otp}){
 const c=await pool.connect();let result,error;try{await c.query('BEGIN');const row=(await c.query('SELECT *,expires_at<=clock_timestamp() AS expired FROM mis_scan_deletion_otps WHERE id=$1 FOR UPDATE',[String(requestId||'')])).rows[0];
 if(!row||row.actor!==actor||row.card_id!==String(cardId))error=fail('Deletion approval is unavailable for this card and user. Click Delete card to request a new WhatsApp code.');
 else if(row.status==='consumed')error=fail('This deletion code was already used. Reload the card before trying again.');
 else if(row.status==='superseded')error=fail('A newer code was requested for this card. Use the latest WhatsApp code and its approval request.');
 else if(row.status!=='sent')error=fail('WhatsApp OTP was not delivered. Click Delete card to request a new code.');
 else if(row.expired)error=fail('The deletion OTP expired after 10 minutes. Click Delete card to request a new code.');
 else if(row.attempts>=5)error=fail('Five incorrect OTP attempts. Click Delete card to request a new code.');
 else{await c.query('UPDATE mis_scan_deletion_otps SET attempts=attempts+1 WHERE id=$1',[row.id]);const hash=digest(row.id,String(otp||''));if(!/^\d{6}$/.test(String(otp||''))||!timingSafeEqual(Buffer.from(row.otp_hash,'hex'),Buffer.from(hash,'hex')))error=fail(row.attempts===4?'Five incorrect OTP attempts. Click Delete card to request a new code.':'Incorrect WhatsApp OTP. Enter the latest six-digit code.',400);else{await c.query("UPDATE mis_scan_deletion_otps SET status='consumed',consumed_at=clock_timestamp() WHERE id=$1",[row.id]);result={actor:row.actor,cardId:row.card_id,revision:row.revision,reason:row.reason};}}
 await c.query('COMMIT');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}if(error)throw error;return result;
}
