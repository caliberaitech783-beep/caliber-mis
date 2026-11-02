import {registerVlbBatchDeletions} from './vlb-batch-deletions.mjs';
import {withVlbTripHandovers} from './vlb-trip-handover.mjs';
import {operationalDate} from './operational-start.mjs';
import {activateVlbPmTrial,vlbPmTrial,VLB_PM_TRIAL_ID} from './vlb-pm-trial.mjs';
import {randomUUID} from 'node:crypto';
import {canonicalSiteName} from './site-location.mjs';
import {requireLogBookSite,siteAllowed} from './log-book-access.mjs';
import {vlbBatchSelection,vlbBatchName,vlbRecordShift} from './vlb-batch-format.mjs';
import {VLB_BATCH_SCHEMA,batchLogin,batchFail,lockVlbBatchWrites,auditVlbBatch,matchingVlbBatch,syncVlbBatchRecord} from './vlb-batch-policy.mjs';
import {vlbBatchActor,batchPmAtSite} from './vlb-batch-access.mjs';
import {stageDetails,lockVlb,unlockVlb,assertCloseAllowed,saveFleetDraft,saveFleetEntry,equipmentAssets} from './vlb-batch-stages.mjs';
import {twoStageEnabled,batchStage,FLEET_STATUSES} from './vlb-two-stage.mjs';
import {APPROVAL_PURPOSES,issueApprovalOtp,consumeApprovalOtp,liveApprovalOtps,publicApprovalOtp} from './vlb-approval-otp.mjs';
export {VLB_BATCH_SCHEMA} from './vlb-batch-policy.mjs';
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
const fail=batchFail;
const creator=batch=>batch.creator_login||batch.created_by;
const isOwner=(batch,actor)=>batchLogin(batch.amendment_by||creator(batch))===actor.login;
async function eligible(client,selection){
 const {rows}=await client.query(`SELECT l.id,l.book_no,l.book_type,l.site,l.book_date::text,l.data,l.revision,l.created_by,l.created_at
 FROM mis_log_books l WHERE l.book_type='vehicle' AND l.deleted_at IS NULL AND l.book_date=$1
 AND NOT EXISTS(SELECT 1 FROM mis_vlb_batch_entries e WHERE e.logbook_id=l.id) ORDER BY l.id FOR UPDATE OF l`,[selection.date]);
 return rows.filter(r=>canonicalSiteName(r.site)===selection.site&&vlbRecordShift(r.data)===selection.shift);
}
async function openSiteBatch(client,site,excludeId){
 const rows=(await client.query("SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE book_date>=$$2026-11-01$$ AND closed_at IS NULL AND archived_at IS NULL AND ($1::uuid IS NULL OR id<>$1) ORDER BY created_at,id",[excludeId||null])).rows;
 return rows.find(batch=>canonicalSiteName(batch.site)===canonicalSiteName(site))||null;
}
async function visible(client,id,req){
 if(!uuid(id))fail('Invalid batch ID.',400);
 const batch=(await client.query('SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE id=$1 AND archived_at IS NULL AND book_date>=$$2026-11-01$$',[id])).rows[0];
 if(!batch||!siteAllowed(req.logBookScope,batch.site))fail('Batch is unavailable.',404);
 return batch;
}
async function details(client,batch,req){
 let records=(await client.query('SELECT snapshot FROM mis_vlb_batch_entries WHERE batch_id=$1 ORDER BY logbook_id',[batch.id])).rows.map(r=>r.snapshot).filter(r=>operationalDate(r.data?.bookDate));
 records=await withVlbTripHandovers(client,records);
 const requests=(await client.query('SELECT * FROM mis_vlb_reopen_requests WHERE batch_id=$1 AND withdrawn_at IS NULL ORDER BY requested_at DESC',[batch.id])).rows.filter(r=>r.requested_by===req.batchActor.login||batchPmAtSite(req.batchActor,batch.site));
 const audit=(await client.query('SELECT * FROM mis_vlb_batch_audit WHERE batch_id=$1 ORDER BY id DESC LIMIT 200',[batch.id])).rows;
 const pmApprovalTrial=await vlbPmTrial(client);
 const approvalOtps=(await liveApprovalOtps(client,batch.id,req.batchActor.login)).map(publicApprovalOtp);
 const trialExpired=Boolean(batch.trial_reopened_until&&(await client.query('SELECT $1::timestamptz<=clock_timestamp() AS expired',[batch.trial_reopened_until])).rows[0].expired);
 const grant=requests.find(r=>r.requested_by===req.batchActor.login&&r.status==='approved'&&r.closure_revision===batch.closure_revision);
 const grantValid=grant?batchPmAtSite(await req.batchGetActor({login:grant.decided_by},client),batch.site):false;
 const stageInfo=await stageDetails(client,batch);
 const owner=isOwner(batch,req.batchActor);
 return {...batch,created_by:creator(batch),pmApprovalTrial,trialExpired,records,entry_count:records.length,requests,audit,approvalOtps,...stageInfo,canLockVlb:stageInfo.twoStage&&stageInfo.stage==='vlb_open'&&(owner||req.batchActor.admin)&&!trialExpired&&!stageInfo.lockBlockers.length,canUnlockVlb:stageInfo.twoStage&&stageInfo.stage==='elb_open'&&(batchPmAtSite(req.batchActor,batch.site)||req.batchActor.admin),canRequestUnlockOtp:stageInfo.twoStage&&stageInfo.stage==='elb_open'&&!(batchPmAtSite(req.batchActor,batch.site)||req.batchActor.admin)&&(owner||req.batchActor.mis),canEnterFleet:stageInfo.twoStage&&stageInfo.stage==='elb_open'&&!trialExpired&&(owner||req.batchActor.admin),canContinue:!trialExpired&&!batch.closed_at&&(!batch.amendment_by||owner)&&(!stageInfo.twoStage||stageInfo.stage==='vlb_open'),canClose:!batch.closed_at&&owner&&(!stageInfo.twoStage||stageInfo.stage==='elb_open'),canRequestReopen:Boolean(batch.closed_at&&req.batchActor.mis),canReopen:Boolean(batch.closed_at&&req.batchActor.mis&&(grantValid||pmApprovalTrial.active)),approvalExpired:Boolean(grant&&!grantValid&&!pmApprovalTrial.active)};
}
export function registerVlbBatches(app,{pool,protect,recoveryProtect=protect,ensureBooks,sendOtp,imageStorage,logBookOps=null,approvalOtp={},getActor=(session,client)=>vlbBatchActor(client,session)}){
 let ready;
 // Site PMs who may approve by OTP: injected from the server (shared with Vehicle transfers), else derived from the Users master.
 const defaultPmLogins=async(client,site)=>{const {rows}=await client.query("SELECT DISTINCT lower(trim(record_data->>'login')) AS login FROM master_records WHERE master_name='Users & employees' AND COALESCE(trim(record_data->>'login'),'')<>''");const out=[];for(const {login} of rows){if(batchPmAtSite(await getActor({login},client),site))out.push(login)}return out};
 const pmLogins=approvalOtp.pmLogins||defaultPmLogins,deliver=approvalOtp.deliver;
 const ensure=async()=>{await ensureBooks();await(ready??=(async()=>{await pool.query(VLB_BATCH_SCHEMA);if(process.env.VLB_PM_APPROVAL_TRIAL===VLB_PM_TRIAL_ID)await activateVlbPmTrial(pool)})().catch(e=>{ready=null;throw e}))};
 const handle=fn=>async(req,res,next)=>{try{
  await ensure();req.batchGetActor=getActor;req.batchActor=await getActor(req.session,pool);
  const admin=req.session.role==='super'&&['admin','super admin'].includes(String(req.session.permissions?.adminLevel||'').toLowerCase());
  req.batchActor.admin=admin;req.batchActor.canCreate=req.batchActor.mis||admin;
  if(!req.batchActor.login||!req.batchActor.mis&&!req.batchActor.pm&&!admin)fail('Only authorized MIS users and site Project Managers can use VLB batches.',403);
  res.set('Cache-Control','no-store');await fn(req,res);
 }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}};
 const transaction=async fn=>{const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(709224102)');await lockVlbBatchWrites(client);const result=await fn(client);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}};
 const recovery=registerVlbBatchDeletions(app,{pool,protect:recoveryProtect,handle,ensure,sendOtp,imageStorage});
 app.get('/api/vlb-batches',...protect,handle(async(req,res)=>{
  const rows=(await pool.query(`SELECT b.*,b.book_date::text AS report_date,(SELECT count(*)::int FROM mis_vlb_batch_entries e WHERE e.batch_id=b.id) AS entry_count FROM mis_vlb_batches b WHERE b.archived_at IS NULL AND b.book_date>=$$2026-11-01$$ ORDER BY (b.closed_at IS NULL) DESC,b.created_at DESC`)).rows;
  const twoStage=twoStageEnabled();
  const batches=rows.filter(b=>siteAllowed(req.logBookScope,b.site)).map(b=>({...b,created_by:creator(b),stage:twoStage?batchStage(b):(b.closed_at?'closed':'open')}));
  const open=rows.find(b=>!b.closed_at&&(isOwner(b,req.batchActor)||batchLogin(creator(b))===req.batchActor.login));
  const openBatch=open?(siteAllowed(req.logBookScope,open.site)?{...open,created_by:creator(open),canClose:isOwner(open,req.batchActor)}:{id:open.id,restricted:true}):null;
  res.json({pmApprovalTrial:await vlbPmTrial(pool),twoStage,batches,openBatch:openBatch&&!openBatch.restricted?{...openBatch,stage:twoStage?batchStage(openBatch):(openBatch.closed_at?'closed':'open')}:openBatch,actor:{login:req.batchActor.login,mis:req.batchActor.mis,pm:req.batchActor.pm,canCreate:req.batchActor.canCreate,admin:req.batchActor.admin}});
 }));
 app.get('/api/vlb-batches/approvals',...protect,handle(async(req,res)=>{
  const rows=(await pool.query('SELECT r.*,b.name,b.site,b.book_date::text AS report_date,b.shift,b.closed_at,b.closure_revision AS current_revision FROM mis_vlb_reopen_requests r JOIN mis_vlb_batches b ON b.id=r.batch_id WHERE b.archived_at IS NULL AND b.book_date>=$$2026-11-01$$ AND r.withdrawn_at IS NULL ORDER BY r.requested_at DESC')).rows;
  res.json({requests:rows.filter(r=>siteAllowed(req.logBookScope,r.site)&&(r.requested_by===req.batchActor.login||batchPmAtSite(req.batchActor,r.site))).map(r=>({...r,canDecide:r.status==='pending'&&r.closure_revision===r.current_revision&&Boolean(r.closed_at)&&batchPmAtSite(req.batchActor,r.site)&&r.requested_by!==req.batchActor.login}))});
 }));
 app.get('/api/vlb-batches/preview',...protect,handle(async(req,res)=>{
  const selection=vlbBatchSelection(req.query);requireLogBookSite(req.logBookScope,selection.site);
  const existingBatch=await matchingVlbBatch(pool,{location:selection.site,bookDate:selection.date,bookShiftCode:selection.shift});
  const siteOpenBatch=await openSiteBatch(pool,selection.site);
  const records=await eligible(pool,selection);
  const sequence=Number((await pool.query('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM mis_vlb_batches WHERE site=$1 AND book_date=$2 AND shift=$3',[selection.site,selection.date,selection.shift])).rows[0].n);
  res.json({selection,records,name:existingBatch?.name||vlbBatchName(selection,sequence),existingBatch,siteOpenBatch});
 }));
 app.get('/api/vlb-batches/:id',...protect,handle(async(req,res)=>res.json(await details(pool,await visible(pool,req.params.id,req),req))));
 app.post('/api/vlb-batches/:id/archive',...protect,handle(async()=>fail('Removing only the batch is discontinued. Use Delete batch with a 10-day restore window.',410)));
 app.post('/api/vlb-batches',...protect,handle(async(req,res)=>{
  if(!req.batchActor.canCreate)fail('Only an authorized MIS user can create a batch.',403);
  const user=req.batchActor.login,selection=vlbBatchSelection(req.body);requireLogBookSite(req.logBookScope,selection.site);
  if(!uuid(req.body.requestKey))fail('Invalid batch save reference.',400);
  let repeated=false;
  const result=await transaction(async client=>{
   const prior=(await client.query('SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE request_key=$1',[req.body.requestKey])).rows[0];
   if(prior){if(batchLogin(creator(prior))!==user||prior.site!==selection.site||prior.report_date!==selection.date||prior.shift!==selection.shift)fail('Batch save reference already used.');repeated=true;return details(client,await visible(client,prior.id,req),req)}
   const existing=await matchingVlbBatch(client,{location:selection.site,bookDate:selection.date,bookShiftCode:selection.shift});
   if(existing)fail('A batch already exists for this site, date and shift. Open that batch; closed batches require site PM approval to reopen.');
   const siteOpen=await openSiteBatch(client,selection.site);
   if(siteOpen)fail('Close the open batch '+siteOpen.name+' before creating another batch for this site, regardless of date or shift.');
   if(!req.batchActor.admin&&(await client.query('SELECT id FROM mis_vlb_batches WHERE (lower(COALESCE(creator_login,created_by))=$1 OR lower(amendment_by)=$1) AND book_date>=$$2026-11-01$$ AND closed_at IS NULL AND archived_at IS NULL',[user])).rows.length)fail('Close the previous batch before creating a new batch.');
   const records=await eligible(client,selection);
   const archivedRows=(await client.query('SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE book_date=$1 AND shift=$2 AND archived_at IS NOT NULL AND deleted_at IS NULL FOR UPDATE',[selection.date,selection.shift])).rows;
   const archived=archivedRows.find(batch=>canonicalSiteName(batch.site)===selection.site);
   if(archived){
    const restored=(await client.query("UPDATE mis_vlb_batches SET archived_at=NULL,closed_at=NULL,amendment_by=NULL,request_key=$1,creator_login=$2,created_by=$3,stage='vlb_open',vlb_locked_at=NULL,vlb_locked_by=NULL WHERE id=$4 RETURNING *,book_date::text AS report_date",[req.body.requestKey,user,null,archived.id])).rows[0];
    await client.query('INSERT INTO mis_vlb_batch_entries(batch_id,logbook_id,snapshot) SELECT $1,(r->>\'id\')::bigint,r FROM jsonb_array_elements($2::jsonb) r ON CONFLICT(logbook_id) DO NOTHING',[restored.id,JSON.stringify(records)]);
    await auditVlbBatch(client,restored,user,'restored_to_batch_list',{logbookIdsAdded:records.map(r=>r.id)});
    return details(client,restored,req);
   }
   const sequence=Number((await client.query('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM mis_vlb_batches WHERE site=$1 AND book_date=$2 AND shift=$3',[selection.site,selection.date,selection.shift])).rows[0].n);
   const batch=(await client.query('INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,request_key,closed_at,closure_revision,saved_lock_policy,continuous_entry,creator_login) VALUES($1,$2,$3,$4,$5,$9,$6,$7,NULL,0,TRUE,TRUE,$8) RETURNING *,book_date::text AS report_date',[randomUUID(),vlbBatchName(selection,sequence),selection.site,selection.date,selection.shift,null,req.body.requestKey,user,sequence])).rows[0];
   await client.query('INSERT INTO mis_vlb_batch_scopes(site,book_date,shift,batch_id) VALUES($1,$2,$3,$4)',[selection.site,selection.date,selection.shift,batch.id]);
   await client.query('INSERT INTO mis_vlb_batch_entries(batch_id,logbook_id,snapshot) SELECT $1,(r->>\'id\')::bigint,r FROM jsonb_array_elements($2::jsonb) r',[batch.id,JSON.stringify(records)]);
   await auditVlbBatch(client,batch,user,'created',{logbookIds:records.map(r=>r.id)});
   return details(client,batch,req);
  });res.status(repeated?200:201).json(result);
 }));
 app.post('/api/vlb-batches/:id/close',...protect,handle(async(req,res)=>res.json(await transaction(async client=>{
  const batch=await visible(client,req.params.id,req);if(!isOwner(batch,req.batchActor))fail('Only the active batch owner can close this batch.',403);
  if(batch.closed_at)return details(client,batch,req);
  await assertCloseAllowed(client,batch);
  const closed=(await client.query("UPDATE mis_vlb_batches SET closed_at=NOW(),amendment_by=NULL,closure_revision=closure_revision+1,stage='closed' WHERE id=$1 RETURNING *,book_date::text AS report_date",[batch.id])).rows[0];
  await auditVlbBatch(client,batch,req.batchActor.login,'saved_and_locked',{closureRevision:closed.closure_revision,savedWithoutChanges:true,twoStage:twoStageEnabled()});return details(client,closed,req);
 }))));
 app.post('/api/vlb-batches/:id/lock-vlb',...protect,handle(async(req,res)=>res.json(await transaction(async client=>{
  const batch=await visible(client,req.params.id,req);if(!isOwner(batch,req.batchActor)&&!req.batchActor.admin)fail('Only the active batch owner can lock VLB for this batch.',403);
  if(batch.trial_reopened_until&&(await client.query('SELECT $1::timestamptz<=clock_timestamp() AS expired',[batch.trial_reopened_until])).rows[0].expired)fail('The VLB reopening trial has expired for this batch.',403);
  return details(client,await lockVlb(client,batch,req.batchActor.login),req);
 }))));
 app.post('/api/vlb-batches/:id/unlock-vlb',...protect,handle(async(req,res)=>res.json(await transaction(async client=>{
  const batch=await visible(client,req.params.id,req);
  if(!batchPmAtSite(req.batchActor,batch.site)&&!req.batchActor.admin)fail('Only the site Project Manager or an MIS administrator can unlock VLB.',403);
  const reason=String(req.body?.reason||'').trim();if(reason.length<5||reason.length>2000)fail('Enter an unlock reason of 5 to 2000 characters.',400);
  return details(client,await unlockVlb(client,batch,req.batchActor.login,{reason}),req);
 }))));
 app.get('/api/vlb-batches/:id/fleet',...protect,handle(async(req,res)=>{
  const batch=await visible(pool,req.params.id,req);const info=await stageDetails(pool,batch);
  res.json({stage:info.stage,fleet:info.fleet||[],fleetProgress:info.fleetProgress||null,machines:info.machines||[],holds:info.holds||[],closeBlockers:info.closeBlockers||[],statuses:FLEET_STATUSES,machineReport:info.machineReport||null});
 }));
 app.put('/api/vlb-batches/:id/fleet/:assetId/draft',...protect,handle(async(req,res)=>{
  if(!/^\d+$/.test(req.params.assetId))fail('Invalid machine.',400);
  res.json(await transaction(async client=>{const batch=await visible(client,req.params.id,req);if(!isOwner(batch,req.batchActor)&&!req.batchActor.admin)fail('Only the active batch owner can enter machines for this batch.',403);const row=await saveFleetDraft(client,batch,req.params.assetId,req.body?.draft||{},req.batchActor.login);return {assetId:String(row.asset_id),draft:row.draft,skipped:row.skipped};}));
 }));
 app.post('/api/vlb-batches/:id/fleet/:assetId',...protect,handle(async(req,res)=>{
  if(!/^\d+$/.test(req.params.assetId))fail('Invalid machine.',400);
  if(!logBookOps)fail('Machine entry is unavailable on this server.',503);
  res.json(await transaction(async client=>{
   const batch=await visible(client,req.params.id,req);if(!isOwner(batch,req.batchActor)&&!req.batchActor.admin)fail('Only the active batch owner can enter machines for this batch.',403);
   const record=await saveFleetEntry(client,batch,req.params.assetId,req.body||{},req.batchActor.login,{resolve:logBookOps.resolve,insert:logBookOps.insert,applyHours:data=>logBookOps.applyHours(data,req.batchActor.login)});
   const info=await stageDetails(client,batch);
   return {record,fleet:info.fleet,fleetProgress:info.fleetProgress,closeBlockers:info.closeBlockers,machineReport:info.machineReport};
  }));
 }));
 const ensureReopenRequest=async(client,batch,req,reason)=>{
   if(!batch.closed_at)fail('This batch is already open.');
   await matchingVlbBatch(client,{location:batch.site,bookDate:batch.report_date,bookShiftCode:batch.shift});
   const pending=(await client.query("SELECT * FROM mis_vlb_reopen_requests WHERE batch_id=$1 AND requested_by=$2 AND closure_revision=$3 AND status IN ('pending','approved') ORDER BY requested_at DESC LIMIT 1",[batch.id,req.batchActor.login,batch.closure_revision])).rows[0];
   if(pending){
    if(pending.status==='pending'||batchPmAtSite(await getActor({login:pending.decided_by},client),batch.site))return pending;
    await client.query("UPDATE mis_vlb_reopen_requests SET status='rejected',decision_note=COALESCE(decision_note,'')||' Approval invalidated: approver no longer has the current site PM assignment.' WHERE id=$1",[pending.id]);
    await auditVlbBatch(client,batch,req.batchActor.login,'approval_invalidated',{requestId:pending.id,reason:'Approver no longer has the current site PM assignment.'});
   }
   const request=(await client.query('INSERT INTO mis_vlb_reopen_requests(id,batch_id,closure_revision,requested_by,reason) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),batch.id,batch.closure_revision,req.batchActor.login,reason])).rows[0];
   await auditVlbBatch(client,batch,req.batchActor.login,'reopen_requested',{requestId:request.id,reason});return request;
 };
 app.post('/api/vlb-batches/:id/reopen-request',...protect,handle(async(req,res)=>{
  if(!req.batchActor.mis)fail('Only an MIS user can request batch reopening.',403);
  const reason=String(req.body.reason||'').trim();if(reason.length<5||reason.length>2000)fail('Enter a reopening reason of 5 to 2000 characters.',400);
  res.json(await transaction(async client=>ensureReopenRequest(client,await visible(client,req.params.id,req),req,reason)));
 }));
 app.post('/api/vlb-batches/:id/reopen-decision',...protect,handle(async(req,res)=>{
  if(!uuid(req.body.requestId)||!['approve','reject'].includes(req.body.decision))fail('Select a valid reopening request and decision.',400);
  res.json(await transaction(async client=>{
   const batch=await visible(client,req.params.id,req);
   if(!batchPmAtSite(req.batchActor,batch.site))fail('Only the current Project Manager assigned to this site can approve or reject reopening.',403);
   const request=(await client.query('SELECT * FROM mis_vlb_reopen_requests WHERE id=$1 AND batch_id=$2 FOR UPDATE',[req.body.requestId,batch.id])).rows[0];
   if(!request)fail('Reopening request is unavailable.',404);
   if(!batch.closed_at||request.closure_revision!==batch.closure_revision||request.status!=='pending')fail('This request is no longer pending for the current closure.');
   const status=req.body.decision==='approve'?'approved':'rejected',note=String(req.body.note||'').trim();
   if(note.length>2000||status==='rejected'&&!note)fail('Enter a PM review remark of up to 2000 characters. A reason is required for rejection.',400);
   const result=(await client.query('UPDATE mis_vlb_reopen_requests SET status=$1,decided_by=$2,decision_note=$3,decided_at=NOW() WHERE id=$4 RETURNING *',[status,req.batchActor.login,note,request.id])).rows[0];
   await auditVlbBatch(client,batch,req.batchActor.login,'reopen_'+status,{requestId:request.id,requestedBy:request.requested_by,note});return result;
  }));
 }));
 const performReopen=async(client,batch,req)=>{
   if(!batch.closed_at)fail('This batch is already open.');
   await matchingVlbBatch(client,{location:batch.site,bookDate:batch.report_date,bookShiftCode:batch.shift});
   const siteOpen=await openSiteBatch(client,batch.site,batch.id);if(siteOpen)fail('Close the open batch '+siteOpen.name+' before reopening another batch for this site.');
   const request=(await client.query("SELECT * FROM mis_vlb_reopen_requests WHERE batch_id=$1 AND requested_by=$2 AND closure_revision=$3 AND status='approved' ORDER BY decided_at DESC LIMIT 1 FOR UPDATE",[batch.id,req.batchActor.login,batch.closure_revision])).rows[0];
   const pmApprovalTrial=await vlbPmTrial(client);
   if(!pmApprovalTrial.active&&!request)fail('Site PM approval is required for this MIS user and the current batch closure.',403);
   if(!pmApprovalTrial.active){const approver=await getActor({login:request.decided_by},client);if(!batchPmAtSite(approver,batch.site))fail('The approving PM is no longer assigned to this site. Request approval from the current site PM.',403);}
   if(!req.batchActor.admin&&(await client.query('SELECT id FROM mis_vlb_batches WHERE book_date>=$$2026-11-01$$ AND closed_at IS NULL AND (lower(COALESCE(creator_login,created_by))=ANY($1::text[]) OR lower(amendment_by)=$2)',[[req.batchActor.login,batchLogin(creator(batch))],req.batchActor.login])).rows.length)fail('Close the existing open batch before reopening this batch.');
   const opened=(await client.query("UPDATE mis_vlb_batches SET closed_at=NULL,amendment_by=$1,trial_reopened_until=$3,creator_login=COALESCE(creator_login,created_by),created_by=NULL,stage=CASE WHEN vlb_locked_at IS NOT NULL THEN 'elb_open' ELSE 'vlb_open' END WHERE id=$2 RETURNING *,book_date::text AS report_date",[req.batchActor.login,batch.id,pmApprovalTrial.active?pmApprovalTrial.endsAt:null])).rows[0];
   if(request)await client.query("UPDATE mis_vlb_reopen_requests SET status='used',used_at=NOW() WHERE id=$1",[request.id]);
   await auditVlbBatch(client,batch,req.batchActor.login,'reopened',{requestId:request?.id||null,approvedBy:pmApprovalTrial.active?null:request.decided_by,...(pmApprovalTrial.active?{trialId:VLB_PM_TRIAL_ID,trialEndsAt:pmApprovalTrial.endsAt}:{})});
   const records=await eligible(client,{site:canonicalSiteName(batch.site),date:batch.report_date,shift:batch.shift});for(const record of records)await syncVlbBatchRecord(client,record,req.batchActor.login,{relock:false});
   return details(client,opened,req);
 };
 app.post('/api/vlb-batches/:id/reopen',...protect,handle(async(req,res)=>{
  if(!req.batchActor.mis)fail('Only the MIS user approved by the site PM can reopen this batch.',403);
  res.json(await transaction(async client=>performReopen(client,await visible(client,req.params.id,req),req)));
 }));
 app.get('/api/vlb-batches/:id/approval-otp',...protect,handle(async(req,res)=>{const batch=await visible(pool,req.params.id,req);res.json({otps:(await liveApprovalOtps(pool,batch.id,req.batchActor.login)).map(publicApprovalOtp)})}));
 app.post('/api/vlb-batches/:id/approval-otp',...protect,handle(async(req,res)=>{
  const purpose=String(req.body?.purpose||'').trim();if(!APPROVAL_PURPOSES[purpose])fail('Select what the Project Manager should approve.',400);
  const reason=String(req.body?.reason||'').trim();if(reason.length<5||reason.length>2000)fail('Enter '+(purpose==='reopen'?'a reopening':'an unlock')+' reason of 5 to 2000 characters.',400);
  res.json(await transaction(async client=>{
   const batch=await visible(client,req.params.id,req);let requestId=null;
   if(purpose==='reopen'){
    if(!req.batchActor.mis)fail('Only an MIS user can request batch reopening.',403);
    if((await vlbPmTrial(client)).active)fail('PM approval is paused during the VLB trial. Reopen the batch directly.',409);
    requestId=(await ensureReopenRequest(client,batch,req,reason)).id;
   }else{
    if(!twoStageEnabled()||batchStage(batch)!=='elb_open')fail(batch.closed_at?'Reopen the batch before unlocking VLB.':'VLB is not locked for this batch.',409);
    if(!isOwner(batch,req.batchActor)&&!req.batchActor.mis&&!req.batchActor.admin)fail('Only the batch owner or an MIS user can ask the site PM to unlock VLB.',403);
   }
   const row=await issueApprovalOtp(client,{batch,purpose,reason,requestId,requestedBy:req.batchActor.login,requesterName:req.session?.name||req.batchActor.login,pmLogins,deliver});
   await auditVlbBatch(client,batch,req.batchActor.login,'approval_otp_sent',{purpose,otpId:row.id,requestId,sentTo:row.sent_to,channels:row.channels,reason});
   return {otp:publicApprovalOtp(row),requestId};
  }));
 }));
 app.post('/api/vlb-batches/:id/approval-otp/:otpId/verify',...protect,handle(async(req,res)=>{
  const outcome=await transaction(async client=>{
   const batch=await visible(client,req.params.id,req);
   const row=await consumeApprovalOtp(client,{otpId:req.params.otpId,batchId:batch.id,login:req.batchActor.login,otp:req.body?.otp});
   const note='Approved by OTP sent to '+row.sent_to.join(', ');
   if(row.purpose==='reopen'){
    const request=(await client.query('SELECT * FROM mis_vlb_reopen_requests WHERE id=$1 AND batch_id=$2 FOR UPDATE',[row.request_id,batch.id])).rows[0];
    if(!request||!batch.closed_at||request.closure_revision!==batch.closure_revision)fail('This reopening request is no longer pending for the current closure. Request a new OTP.',409);
    if(request.status==='pending')await client.query("UPDATE mis_vlb_reopen_requests SET status='approved',decided_by=$2,decision_note=$3,decided_at=NOW() WHERE id=$1",[request.id,row.sent_to[0],note]);
    else if(request.status!=='approved')fail('This reopening request was already decided. Request a new OTP.',409);
    await auditVlbBatch(client,batch,req.batchActor.login,'reopen_approved',{requestId:request.id,requestedBy:request.requested_by,via:'otp',otpId:row.id,sentTo:row.sent_to,note});
    return {purpose:'reopen'};
   }
   if(batchStage(batch)!=='elb_open')fail(batch.closed_at?'Reopen the batch before unlocking VLB.':'VLB is not locked for this batch.',409);
   const opened=await unlockVlb(client,batch,req.batchActor.login,{reason:row.reason,approvedBy:row.sent_to,via:'otp'});
   return {purpose:'unlock_vlb',batch:await details(client,opened,req)};
  });
  if(outcome.purpose!=='reopen')return res.json({approved:true,unlocked:true,batch:outcome.batch});
  try{const batch=await transaction(async client=>performReopen(client,await visible(client,req.params.id,req),req));return res.json({approved:true,reopened:true,batch});}
  catch(error){if(!error.status)throw error;const batch=await details(pool,await visible(pool,req.params.id,req),req);return res.json({approved:true,reopened:false,error:error.message,batch});}
 }));
 return recovery;
}
