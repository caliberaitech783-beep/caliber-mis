import {deletionPhone,deletionRecipient} from '../rules/deletion-otp-routing.mjs';
import {randomUUID,randomInt,createHash,timingSafeEqual} from 'node:crypto';
import {isDeletableScanCard,scanDeletionSelection,scanDeletionApproval} from '../../src/scan-card-deletion-selection.mjs';
export const SCAN_CARD_GROUP_DELETION_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_scan_card_group_deletions(id UUID PRIMARY KEY,batch_id UUID NOT NULL,actor TEXT NOT NULL,cards JSONB NOT NULL,approval TEXT NOT NULL,reason TEXT NOT NULL,otp_hash TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,permanent BOOLEAN NOT NULL DEFAULT FALSE);ALTER TABLE mis_scan_card_group_deletions ADD COLUMN IF NOT EXISTS permanent BOOLEAN NOT NULL DEFAULT FALSE;CREATE INDEX IF NOT EXISTS mis_scan_card_group_deletions_actor ON mis_scan_card_group_deletions(actor,created_at);`;
export function registerScanCardGroupDeletion(app,{pool,protect,wrap,getBatch,getCard,sendOtp,openDeletion,lockOpenDeletion,imageStorage,checkEntryDeletion,now=()=>Date.now()}){
 const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status})};
 const actor=req=>String(req.session.login||req.session.name||'');
 const entryApproval=' · entire scan entry';
 const digest=(id,otp)=>createHash('sha256').update(id+':'+otp).digest('hex');
 const selection=cards=>{
  if(!Array.isArray(cards)||!cards.length||cards.length>500||cards.some(c=>!c||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(c.id)||!Number.isSafeInteger(c.revision)||c.revision<1)||new Set(cards.map(c=>c.id.toLowerCase())).size!==cards.length)fail('Select between 1 and 500 distinct cards with current revisions.',400);
  return scanDeletionSelection(cards.map(card=>({...card,id:card.id.toLowerCase()})));
 };
 async function check(client,batchId,items,lock=false,permanent=false){
  await getBatch(client,batchId);const cards=[];for(const item of items){const card=await getCard(client,item.id,lock);if(card.batch_id!==batchId)fail('Every selected card must belong to this scan entry.',403);if(permanent?(card.raw_fields?.manualDeletion||['queued','reading'].includes(card.status)):!isDeletableScanCard(card))fail(permanent?'A selected PDF card is processing or already deleted. Select again.':'A selected card is saved, processing or already deleted. Select again.');if(card.revision!==item.revision)fail('A selected card changed. Review the selection and approve it again.');cards.push(card)}return cards;
 }
 app.post('/api/scan-batches/:id/card-deletions/otp',...protect,wrap(async(req,res)=>{
  const items=selection(req.body.cards),entry=req.body.entry===true,approval=scanDeletionApproval(items)+(entry?entryApproval:''),reason=String(req.body.reason||'').trim(),permanent=req.body.permanent===true;
  if(req.body.approval!==approval||!reason||reason.length>2000)fail('Approve the exact selected cards and enter a deletion reason.',400);
  if(entry){if(!permanent||!checkEntryDeletion)fail('Scan entry deletion is unavailable.');await checkEntryDeletion(pool,req.params.id,items,req);}
  const cards=await check(pool,req.params.id,items,false,permanent),batch=await getBatch(pool,req.params.id);
  const sites=cards.map(card=>batch?.expected_context?.location||card.draft?.location),to=deletionPhone(sites);
  const time=now(),user=actor(req),id=randomUUID(),otp=String(randomInt(100000,1000000)),client=await pool.connect();
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['scan-card-group-deletion:'+user]);const recent=(await client.query('SELECT created_at FROM mis_scan_card_group_deletions WHERE actor=$1 AND created_at>$2 ORDER BY created_at DESC',[user,new Date(time-3600000)])).rows;if(recent.length>=10||recent.some(row=>time-new Date(row.created_at).getTime()<60000))fail('Wait one minute between OTP requests; maximum ten per hour.',429);
   await client.query("UPDATE mis_scan_card_group_deletions SET state='superseded' WHERE actor=$1 AND state IN('pending','delivered')",[user]);
   await client.query('INSERT INTO mis_scan_card_group_deletions(id,batch_id,actor,cards,approval,reason,otp_hash,created_at,expires_at,permanent) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)',[id,req.params.id,user,JSON.stringify(items),approval,reason,digest(id,otp),new Date(time),new Date(time+600000),permanent]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  let delivery;try{delivery=await sendOtp({to,sites,otp,requestId:id,count:items.length})}catch{}
  if(!delivery?.sent||!delivery.messageId){await pool.query("UPDATE mis_scan_card_group_deletions SET state='failed' WHERE id=$1",[id]);fail('WhatsApp OTP delivery failed. No cards were deleted.',503)}
  await pool.query("UPDATE mis_scan_card_group_deletions SET state='delivered' WHERE id=$1 AND state='pending'",[id]);res.json({requestId:id,recipient:deletionRecipient(to),expiresInMinutes:10,count:items.length});
 }));
 app.post('/api/scan-batches/:id/card-deletions/confirm',...protect,wrap(async(req,res)=>{
  if(req.body.requestId&&!/^[a-f0-9-]{36}$/i.test(String(req.body.requestId)))fail('Deletion OTP expired or unavailable. Request a new code.');
  const client=await pool.connect();let consumed=false;try{await client.query('BEGIN');
   let row;
   if(!req.body.requestId){
    if(req.body.permanent===true||req.body.entry===true)fail('Permanent PDF deletion requires WhatsApp OTP approval.',403);
    await lockOpenDeletion(client);
    if(!await openDeletion(client,await getBatch(client,req.params.id),req))fail('The batch stage is unavailable for deletion without OTP. Reload before deleting.');
    const items=selection(req.body.cards),reason=String(req.body.reason||'').trim();
    if(req.body.approval!==scanDeletionApproval(items)||!reason||reason.length>2000)fail('Approve the exact selected cards and enter a deletion reason.',400);
    row={batch_id:req.params.id,cards:items,actor:actor(req),reason};
   }else{
    row=(await client.query('SELECT * FROM mis_scan_card_group_deletions WHERE id=$1 FOR UPDATE',[req.body.requestId])).rows[0];
    if(!row||row.state!=='delivered'||row.actor!==actor(req)||row.batch_id!==req.params.id||new Date(row.expires_at).getTime()<=now()||row.attempts>=5)fail('Deletion OTP expired or unavailable. Request a new code.');
    if(req.body.approval!==row.approval||JSON.stringify(selection(req.body.cards))!==JSON.stringify(row.cards)||Boolean(req.body.permanent)!==Boolean(row.permanent)||Boolean(req.body.entry)!==row.approval.endsWith(entryApproval))fail('The selected cards changed. Review and approve the exact selection again.');
    if(!/^\d{6}$/.test(String(req.body.otp||''))||!timingSafeEqual(Buffer.from(row.otp_hash,'hex'),Buffer.from(digest(req.body.requestId,req.body.otp),'hex'))){await client.query('UPDATE mis_scan_card_group_deletions SET attempts=attempts+1 WHERE id=$1',[row.id]);await client.query('COMMIT');fail('Incorrect WhatsApp OTP.',400)}
    consumed=true;
   }
   if(req.body.entry===true){
    if(!checkEntryDeletion)fail('Scan entry deletion is unavailable.');
    await lockOpenDeletion(client);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[row.batch_id]);
    await checkEntryDeletion(client,row.batch_id,row.cards,req);
   }
   const cards=await check(client,row.batch_id,row.cards,true,Boolean(row.permanent)),deletedAt=new Date(now()).toISOString(),blobKeys=cards.map(card=>card.image_blob_key).filter(Boolean);
   if(row.permanent){
    const cardIds=cards.map(card=>card.id),logbookIds=[...new Set(cards.map(card=>card.logbook_id).filter(Boolean).map(String))];
    if(logbookIds.length){
     const outside=(await client.query('SELECT id FROM mis_scan_cards WHERE logbook_id=ANY($1::bigint[]) AND NOT(id=ANY($2::uuid[])) LIMIT 1',[logbookIds,cardIds])).rows[0];
     if(outside)fail('A saved card is linked to another scan copy. Delete that exact linked record through permanent deletion first.');
     if((await client.query("SELECT to_regclass('mis_vlb_batch_entries') AS entries,to_regclass('mis_pulse_trip_verifications') AS verification")).rows[0].entries)await client.query('DELETE FROM mis_vlb_batch_entries WHERE logbook_id=ANY($1::bigint[])',[logbookIds]);
     if((await client.query("SELECT to_regclass('mis_pulse_trip_verifications') AS name")).rows[0].name)await client.query('DELETE FROM mis_pulse_trip_verifications WHERE logbook_id=ANY($1::bigint[])',[logbookIds]);
    }
    if((await client.query("SELECT to_regclass('mis_scan_backup_items') AS name")).rows[0].name)await client.query("UPDATE mis_scan_backup_items SET metadata=jsonb_build_object('permanentlyDeleted',true,'cardId',card_id) WHERE card_id=ANY($1::uuid[])",[cardIds]);
    const removed=await client.query('DELETE FROM mis_scan_cards WHERE id=ANY($1::uuid[]) RETURNING id',[cardIds]);if(removed.rowCount!==cards.length)fail('The selected PDF changed. Nothing was deleted.');
    if(logbookIds.length){const removedBooks=await client.query('DELETE FROM mis_log_books WHERE id=ANY($1::bigint[]) AND deleted_at IS NULL RETURNING id',[logbookIds]);if(removedBooks.rowCount!==logbookIds.length)fail('A saved VLB card changed. Nothing was deleted.');}
   }else{
    // Entry removal is atomic; storage/backups may retain original scans.
    for(const card of cards){const vehicle=String(card.draft?.door||card.draft?.doorText||card.raw_fields?.door||card.saved_data?.door||'').trim(),message='Card deleted manually by user'+(vehicle?' · Vehicle '+vehicle:'')+'. Upload again if needed.';await client.query("UPDATE mis_scan_cards SET status='rejected',image=NULL,image_blob_key=NULL,image_bytes=0,ocr_text='',raw_fields=$2::jsonb,draft='{}'::jsonb,error=$3,review_note=$3,revision=revision+1 WHERE id=$1",[card.id,JSON.stringify({manualDeletion:{by:row.actor,reason:row.reason,deletedAt,vehicle,...(consumed?{otpVerifiedAt:deletedAt,requestId:row.id}:{}),count:cards.length,retainedImageBlobKey:card.image_blob_key||null}}),message])}
   }
   if(req.body.entry===true){
    await client.query("UPDATE mis_scan_batches SET expected_context=COALESCE(expected_context,'{}'::jsonb)||jsonb_build_object('deletedScanEntry',true,'cancelled',true) WHERE id=$1",[row.batch_id]);
   }
   if(consumed)await client.query("UPDATE mis_scan_card_group_deletions SET state='used' WHERE id=$1",[row.id]);
   await client.query('COMMIT');if(row.permanent&&imageStorage?.remove)for(const key of blobKeys)try{await imageStorage.remove(key)}catch{}res.json({deleted:true,permanent:Boolean(row.permanent),count:cards.length,ids:cards.map(card=>card.id)});
  }catch(error){await client.query('ROLLBACK');if(consumed)await client.query("UPDATE mis_scan_card_group_deletions SET state='invalidated' WHERE id=$1 AND state='delivered'",[req.body.requestId]);throw error}finally{client.release()}
 }));
}
