import {randomUUID,randomInt,createHash,timingSafeEqual} from 'node:crypto';
import {isDeletableScanCard,scanDeletionSelection,scanDeletionApproval} from './src/scan-card-deletion-selection.mjs';
export function registerScanCardGroupDeletion(app,{pool,protect,wrap,getBatch,getCard,sendOtp,now=()=>Date.now()}){
 const requests=new Map(),rates=new Map();
 const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status})};
 const actor=req=>String(req.session.login||req.session.name||'');
 const digest=(id,otp)=>createHash('sha256').update(id+':'+otp).digest();
 const selection=cards=>{
  if(!Array.isArray(cards)||!cards.length||cards.length>500||cards.some(c=>!c||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(c.id)||!Number.isSafeInteger(c.revision)||c.revision<1)||new Set(cards.map(c=>c.id.toLowerCase())).size!==cards.length)fail('Select between 1 and 500 distinct unsaved cards with current revisions.',400);
  return scanDeletionSelection(cards.map(card=>({...card,id:card.id.toLowerCase()})));
 };
 async function check(client,batchId,items,lock=false){
  await getBatch(client,batchId);
  const cards=[];for(const item of items){const card=await getCard(client,item.id,lock);if(card.batch_id!==batchId)fail('Every selected card must belong to this scan entry.',403);if(!isDeletableScanCard(card))fail('A selected card is saved, processing or already deleted. Select again.');if(card.revision!==item.revision)fail('A selected card changed. Review the selection and approve it again.');cards.push(card)}return cards;
 }
 app.post('/api/scan-batches/:id/card-deletions/otp',...protect,wrap(async(req,res)=>{
  const items=selection(req.body.cards),approval=scanDeletionApproval(items),reason=String(req.body.reason||'').trim();
  if(req.body.approval!==approval||!reason||reason.length>2000)fail('Approve the exact selected cards and enter a deletion reason.',400);
  await check(pool,req.params.id,items);
  const time=now(),user=actor(req);for(const [id,row] of requests)if(row.expires<=time)requests.delete(id);
  for(const [key,times] of rates){const recent=times.filter(t=>time-t<3600000);if(recent.length)rates.set(key,recent);else rates.delete(key)}
  const recent=rates.get(user)||[];if(recent.length>=10||recent.some(t=>time-t<60000))fail('Wait one minute between OTP requests; maximum ten per hour.',429);rates.set(user,[...recent,time]);
  for(const [id,row] of requests)if(row.actor===user)requests.delete(id);
  const id=randomUUID(),otp=String(randomInt(100000,1000000));let delivery;try{delivery=await sendOtp({to:'919925565281',otp,requestId:id,count:items.length})}catch{fail('WhatsApp OTP delivery is unavailable. No cards were deleted.',503)}
  if(!delivery?.sent||!delivery.messageId)fail('WhatsApp OTP delivery failed. No cards were deleted.',503);
  requests.set(id,{actor:user,batchId:req.params.id,cards:items,approval,reason,hash:digest(id,otp),expires:time+600000,attempts:0,used:false});
  res.json({requestId:id,recipient:'+91 9925565281',expiresInMinutes:10,count:items.length});
 }));
 app.post('/api/scan-batches/:id/card-deletions/confirm',...protect,wrap(async(req,res)=>{
  const row=requests.get(req.body.requestId);if(!row||row.used||row.actor!==actor(req)||row.batchId!==req.params.id||row.expires<=now()||row.attempts>=5)fail('Deletion OTP expired or unavailable. Request a new code.');
  if(req.body.approval!==row.approval||JSON.stringify(selection(req.body.cards))!==JSON.stringify(row.cards))fail('The selected cards changed. Review and approve the exact selection again.');
  row.attempts++;if(!/^\d{6}$/.test(String(req.body.otp||''))||!timingSafeEqual(row.hash,digest(req.body.requestId,req.body.otp)))fail('Incorrect WhatsApp OTP.',400);
  row.used=true;const client=await pool.connect();try{await client.query('BEGIN');const cards=await check(client,row.batchId,row.cards,true);
   const verifiedAt=new Date(now()).toISOString();
   // Removing access and extracted data is atomic. Storage/backups may retain original scans.
   for(const card of cards){const message='Card deleted manually by user. Upload again if needed.';await client.query("UPDATE mis_scan_cards SET status='rejected',image=NULL,image_blob_key=NULL,image_bytes=0,ocr_text='',raw_fields=$2::jsonb,draft='{}'::jsonb,error=$3,review_note=$3,revision=revision+1 WHERE id=$1",[card.id,JSON.stringify({manualDeletion:{by:row.actor,reason:row.reason,otpVerifiedAt:verifiedAt,requestId:req.body.requestId,count:cards.length,retainedImageBlobKey:card.image_blob_key||null}}),message])}
   await client.query('COMMIT');res.json({deleted:true,count:cards.length,ids:cards.map(card=>card.id)});
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }));
}
