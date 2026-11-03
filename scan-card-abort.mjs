import {isAbortableScanCard,scanAbortApproval} from './src/scan-card-deletion-selection.mjs';
export function registerSelectedScanAbort(app,{pool,protect,wrap,getBatch,getCard}){
 const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status})};
 app.post('/api/scan-batches/:id/abort-selected',...protect,wrap(async(req,res)=>{
  const input=req.body?.cards;
  if(!Array.isArray(input)||!input.length||input.length>500||input.some(card=>!card||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(card.id))||new Set(input.map(card=>card.id.toLowerCase())).size!==input.length)fail('Select between 1 and 500 distinct queued or processing cards.',400);
  const items=input.map(card=>({id:card.id.toLowerCase()})).sort((a,b)=>a.id.localeCompare(b.id));
  if(req.body.approval!==scanAbortApproval(items))fail('Confirm the exact selected cards before aborting.',400);
  const client=await pool.connect();try{await client.query('BEGIN');await getBatch(client,req.params.id);const cards=[];
   for(const item of items){const card=await getCard(client,item.id,true);if(card.batch_id!==req.params.id)fail('Every selected card must belong to this scan entry.',403);if(!isAbortableScanCard(card))fail('A selected card has finished or is no longer processing. Refresh and select again.');cards.push(card)}
   const detail=JSON.stringify({by:String(req.session.login||req.session.name||''),at:new Date().toISOString()});
   for(const card of cards)await client.query("UPDATE mis_scan_cards SET status='rejected',error='Scanning cancelled by user.',raw_fields=COALESCE(raw_fields,'{}'::jsonb)||jsonb_build_object('manualAbort',$2::jsonb),revision=revision+1 WHERE id=$1",[card.id,detail]);
   await client.query('COMMIT');res.json({cancelled:cards.length,ids:cards.map(card=>card.id)});
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
 }));
}
