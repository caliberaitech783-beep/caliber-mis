import {ACTIVE_VLB_ENTRY_FROM,ACTIVE_VLB_ENTRY_FILTER,readVlbCardCounts} from '../rules/vlb-card-counts.mjs';
import {isMisAdministrator} from '../../shared/mis-admin-access.mjs';
import {registerVlbBatchDeletions} from './vlb-batch-deletions.mjs';
import {withVlbTripHandovers} from '../../shared/vlb-trip-handover.mjs';
import {operationalDate} from '../../shared/operational-start.mjs';
import {activeWorkOrders,WORK_ORDER_MASTERS} from '../../shared/trip-card-rules.mjs';
import {randomUUID} from 'node:crypto';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {requireLogBookSite,siteAllowed} from '../../shared/log-book-access.mjs';
import {vlbBatchSelection,vlbBatchName,vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {VLB_BATCH_SCHEMA,batchLogin,batchFail,lockVlbBatchWrites,lockVlbBatchScope,lockVlbBatchSite,vlbRecordScope,auditVlbBatch,matchingVlbBatch,syncVlbBatchRecord} from '../rules/vlb-batch-policy.mjs';
import {createBreakdownRowsPrefetchCache,lockedReadHours} from '../../shared/breakdown-hours-source.mjs';
import {jsonEntityTag,requestEtagMatches} from '../services/response-etag.mjs';
import {withoutRowSecurityRequest} from '../services/row-security.mjs';
import {vlbBatchActor,batchPmAtSite} from '../rules/vlb-batch-access.mjs';
import {readFleetBreakdowns,stageDetails,lockVlb,lockLmv,unlockVlb,assertCloseAllowed,saveFleetDraft,saveFleetEntry,equipmentAssets} from '../rules/vlb-batch-stages.mjs';
import {twoStageEnabled,batchStage,FLEET_STATUSES} from '../rules/vlb-two-stage.mjs';
import {consumeApprovalOtp,liveApprovalOtps,publicApprovalOtp} from '../services/vlb-approval-otp.mjs';
import {batchStageWaits} from '../rules/vlb-batch-queue.mjs';
import {previousBatchScope,batchOrderBlock} from '../../shared/vlb-batch-order.mjs';
export {VLB_BATCH_SCHEMA} from '../rules/vlb-batch-policy.mjs';
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
const fail=batchFail;
const creator=batch=>batch.creator_login||batch.created_by;
const isOwner=(batch,actor)=>batchLogin(batch.amendment_by||creator(batch))===actor.login;
const mayClose=(batch,actor,twoStage=twoStageEnabled())=>isOwner(batch,actor)||(twoStage&&actor.admin);
// Machines of an open batch are entered and corrected by any MIS user of the site, not only its owner.
const mayEnterFleet=(batch,actor)=>isOwner(batch,actor)||Boolean(actor.mis||actor.admin);
// Owner, 18 Nov 2026: reopening a saved batch and Unlock VLB no longer need the site PM's approval.
const mayUnlockVlb=(batch,actor)=>actor.admin||actor.mis||isOwner(batch,actor)||batchPmAtSite(actor,batch.site);
const canClose=(batch,actor,twoStage)=>!batch.closed_at&&(!twoStage||batchStage(batch)==='elb_open')&&mayClose(batch,actor,twoStage);
async function eligible(client,selection){
 const {rows}=await client.query(`SELECT l.id,l.book_no,l.book_type,l.site,l.book_date::text,l.data,l.revision,l.created_by,l.created_at
 FROM mis_log_books l WHERE l.book_type='vehicle' AND l.deleted_at IS NULL AND l.book_date=$1
 AND NOT EXISTS(SELECT 1 FROM mis_vlb_batch_entries e WHERE e.logbook_id=l.id) ORDER BY l.id FOR UPDATE OF l`,[selection.date]);
 return rows.filter(r=>canonicalSiteName(r.site)===selection.site&&vlbRecordShift(r.data)===selection.shift);
}
async function openSiteBatch(client,site,{excludeId,creationDate=null}={}){
 const rows=(await client.query("SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE book_date>=$$2026-11-01$$ AND closed_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL AND ($1::uuid IS NULL OR id<>$1) AND ($2::date IS NULL OR book_date<$2 OR (book_date=$2 AND stage='vlb_open')) ORDER BY book_date,created_at,id",[excludeId||null,creationDate])).rows;
 return rows.find(batch=>canonicalSiteName(batch.site)===canonicalSiteName(site))||null;
}
async function openBatchCreationBlock(client,selection){
 const twoStage=twoStageEnabled();
 const siteOpenBatch=await openSiteBatch(client,selection.site,{creationDate:twoStage?selection.date:null});
 if(!siteOpenBatch)return {siteOpenBatch:null,creationBlocker:null};
 const creationBlocker=twoStage&&siteOpenBatch.report_date===selection.date
  ?'Lock VLB in '+siteOpenBatch.name+' before creating another shift for this report date.'
  :'Fully close '+siteOpenBatch.name+' before creating this batch.';
 return {siteOpenBatch,creationBlocker};
}
// Batches of a site open in shift order: the shift before this one must exist with its VLB locked.
async function previousShiftBlock(client,selection){
 const scope=previousBatchScope(selection);if(!scope)return null;
 const rows=(await client.query('SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE book_date=$1 AND shift=$2 AND archived_at IS NULL AND deleted_at IS NULL ORDER BY created_at DESC,id DESC',[scope.date,scope.shift])).rows;
 const previous=rows.find(batch=>canonicalSiteName(batch.site)===selection.site)||null;
 const locked=Boolean(previous)&&(twoStageEnabled()?batchStage(previous)!=='vlb_open':Boolean(previous.closed_at));
 const message=batchOrderBlock(scope,previous,locked);
 return message?{...scope,batchId:previous?.id||null,name:previous?.name||null,message}:null;
}
async function visible(client,id,req){
 if(!uuid(id))fail('Invalid batch ID.',400);
 const batch=(await client.query('SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE id=$1 AND archived_at IS NULL AND book_date>=$$2026-11-01$$',[id])).rows[0];
 if(!batch||!siteAllowed(req.logBookScope,batch.site))fail('Batch is unavailable.',404);
 return batch;
}
async function details(client,batch,req){
 // The card's revision is read from the card itself, not from the stored snapshot. A change that
 // does not pass through the card form (Pulse BD hours repair, 18 Nov 2026) raised the card's
 // revision and left the snapshot's behind, so every later save from the batch was refused with
 // "This log book changed or is unavailable" however often the user reloaded.
 let records=(await client.query(`SELECT e.snapshot,l.revision FROM ${ACTIVE_VLB_ENTRY_FROM} WHERE e.batch_id=$1 AND ${ACTIVE_VLB_ENTRY_FILTER} ORDER BY e.logbook_id`,[batch.id])).rows.map(r=>({...r.snapshot,revision:r.revision})).filter(r=>operationalDate(r.data?.bookDate));
 const scanIds=records.map(record=>record.data?.scanCardId).filter(id=>uuid(id));
 const scanTable=scanIds.length&&(await client.query("SELECT to_regclass('mis_scan_cards') AS name")).rows[0]?.name;
 if(scanTable){
  const scans=(await client.query('SELECT id,filename,raw_fields FROM mis_scan_cards WHERE id=ANY($1::uuid[])',[scanIds])).rows;
  const sources=new Map(scans.map(scan=>[String(scan.id),scan.raw_fields?.entrySource||(/scanner|page-\d+\.png/i.test(scan.filename||'')?'scan':'upload')]));
  records=records.map(record=>record.data?.scanCardId?{...record,data:{...record.data,scanEntrySource:record.data.scanEntrySource||sources.get(String(record.data.scanCardId))||'upload'}}:record);
 }
 records=await withVlbTripHandovers(client,records);
 const requests=(await client.query('SELECT * FROM mis_vlb_reopen_requests WHERE batch_id=$1 AND withdrawn_at IS NULL ORDER BY requested_at DESC',[batch.id])).rows.filter(r=>r.requested_by===req.batchActor.login||batchPmAtSite(req.batchActor,batch.site));
 const audit=(await client.query('SELECT * FROM mis_vlb_batch_audit WHERE batch_id=$1 ORDER BY id DESC LIMIT 200',[batch.id])).rows;
 const approvalOtps=(await liveApprovalOtps(client,batch.id,req.batchActor.login)).map(publicApprovalOtp);
 // An open batch never freezes by itself (owner, 19 Nov 2026): a batch reopened under the
 // retired PM-approval pause stays open until it is closed.
 const trialExpired=false;
 const stageInfo=await stageDetails(client,batch,{tripCardRecords:records.filter(record=>siteAllowed(req.logBookScope,record.site||record.data?.location))});
 const owner=isOwner(batch,req.batchActor);
 const lmvRecords=stageInfo.stage==='lmv_open'?(await client.query(
  "SELECT id,book_no,book_type,data,revision FROM mis_log_books WHERE book_type='lmv' AND book_date=$1 AND deleted_at IS NULL ORDER BY id",
  [batch.report_date])).rows.filter(record=>canonicalSiteName(record.data.location)===canonicalSiteName(batch.site)&&vlbRecordScope(record.data).shift===batch.shift):[];
 return {...batch,canEditSavedFleet:Boolean(req.batchActor.mis||req.batchActor.admin),created_by:creator(batch),trialExpired,records,lmvRecords,canLockLmv:!stageInfo.stageWait&&stageInfo.stage==='lmv_open'&&(owner||req.batchActor.admin)&&!trialExpired&&!stageInfo.lmvLockBlockers?.length,entry_count:records.length,requests,audit,approvalOtps,...stageInfo,canLockVlb:stageInfo.twoStage&&stageInfo.stage==='vlb_open'&&(owner||req.batchActor.admin)&&!trialExpired&&!stageInfo.lockBlockers.length,canUnlockVlb:stageInfo.twoStage&&['lmv_open','elb_open'].includes(stageInfo.stage)&&mayUnlockVlb(batch,req.batchActor),canEnterFleet:!stageInfo.stageWait&&stageInfo.twoStage&&stageInfo.stage==='elb_open'&&!trialExpired&&mayEnterFleet(batch,req.batchActor),canContinue:!trialExpired&&!batch.closed_at&&(!stageInfo.twoStage||stageInfo.stage==='vlb_open'),canClose:!stageInfo.stageWait&&canClose(batch,req.batchActor,stageInfo.twoStage),canRequestReopen:Boolean(batch.closed_at),canReopen:Boolean(batch.closed_at),approvalExpired:false};
}
// One read shared by callers that arrive together and reused for ttlMs. clear() drops the
// copy, and a read already running when clear() is called is not handed to later callers.
export function createSharedRead({ttlMs=3000,now=()=>Date.now()}={}){
 let value=null,until=0,running=null,runningGeneration=-1,generation=0;
 const shared=read=>{
  if(ttlMs<=0)return read();
  if(value&&until>now())return Promise.resolve(value);
  if(running&&runningGeneration===generation)return running;
  const started=generation;
  const job=Promise.resolve().then(read).then(result=>{if(started===generation){value=result;until=now()+ttlMs;}return result;}).finally(()=>{if(running===job)running=null;});
  running=job;runningGeneration=started;
  return job;
 };
 shared.clear=()=>{value=null;until=0;generation++;};
 return shared;
}

export function registerVlbBatches(app,{pool,protect,recoveryProtect=protect,ensureBooks,sendOtp,imageStorage,logBookOps=null,approvalOtp={},getActor=(session,client)=>vlbBatchActor(client,session),listCacheMs=3000}){
 let ready;
 const prefetchFleetBreakdownRows=createBreakdownRowsPrefetchCache(logBookOps?.readBreakdownRows);
 // Every open batch board asks for the batch list every 4 s, and on 11 Nov 2026 those reads
 // alone kept the 10-connection pool full. Until 15 Nov 2026 the list was read once per
 // site scope, and each read ran the row-security site check on every log book since
 // 1 Nov: that day it held 73,000 connection-seconds in 2.6 h (more than every other
 // route together), so automatic card saves waited 18 s each for a connection.
 // The list is now one trusted read shared by every login. It holds no log-book
 // content, only per-batch card counts, and each caller still receives only the
 // batches of its own sites (siteAllowed below).
 const sharedBatchRows=createSharedRead({ttlMs:listCacheMs});
 app.use('/api/vlb-batches',(req,res,next)=>{if(req.method!=='GET'&&req.method!=='HEAD')res.on('finish',()=>sharedBatchRows.clear());if(req.method!=='GET'&&req.method!=='HEAD')res.on('finish',()=>actorCache.clear());next();});
 // Every open batch board asks every 10 to 15 s, and each ask looked the actor up in the
 // Users master. The lookup is reused for ACTOR_CACHE_MS per login (a copy each time,
 // because handle() adds fields to it) and dropped on any batch write.
 const actorCache=new Map(),ACTOR_CACHE_MS=10000;
 const readActor=async session=>{
  const key=String(session?.login||session?.name||'').trim().toLowerCase(),hit=actorCache.get(key);
  if(hit&&hit.until>Date.now())return structuredClone(hit.value);
  const value=await getActor(session,pool);
  if(actorCache.size>=500)actorCache.delete(actorCache.keys().next().value);
  actorCache.set(key,{value:structuredClone(value),until:Date.now()+ACTOR_CACHE_MS});
  return value;
 };
 const ensure=async()=>{
  await ensureBooks();
  await(ready??=(async()=>{
   await pool.query(VLB_BATCH_SCHEMA);
  })().catch(e=>{ready=null;throw e}));
 };
 const handle=fn=>async(req,res,next)=>{try{
  await ensure();req.batchGetActor=getActor;req.batchActor=await readActor(req.session);
  const admin=isMisAdministrator(req.session);
  req.batchActor.admin=admin;req.batchActor.canCreate=req.batchActor.mis||admin;
  if(!req.batchActor.login||!req.batchActor.mis&&!req.batchActor.pm&&!admin)fail('Only authorized MIS users and site Project Managers can use VLB batches.',403);
  res.set('Cache-Control','no-store');await fn(req,res);
 }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}};
 // With a scope, the transaction locks only that site, date and shift; without one it
 // takes the whole-table lock, so unscoped actions still wait for every batch writer.
 const transaction=async(fn,scope)=>{const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(709224102)');if(scope)await lockVlbBatchScope(client,scope);else await lockVlbBatchWrites(client);const result=await fn(client);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}};
 // A batch's site, date and shift never change, so they are read before its lock is
 // taken; the batch state itself is read again inside the lock.
 const batchScope=batch=>({site:batch.site,bookDate:batch.report_date,shift:batch.shift});
 const batchTransaction=async(req,fn,{exclusive=false}={})=>{
  const scope=exclusive?null:batchScope(await visible(pool,req.params.id,req));
  return transaction(async client=>fn(client,await visible(client,req.params.id,req)),scope);
 };
 const recovery=registerVlbBatchDeletions(app,{pool,protect:recoveryProtect,handle,ensure,sendOtp,imageStorage});
 app.get('/api/vlb-batches',...protect,handle(async(req,res)=>{
  const rows=await sharedBatchRows(()=>withoutRowSecurityRequest(async()=>(await pool.query(`
   WITH visible_batches AS (
    SELECT * FROM mis_vlb_batches WHERE archived_at IS NULL AND book_date>=$$2026-11-01$$
   ), vlb_counts AS (
    SELECT e.batch_id,count(*)::int AS total
    FROM ${ACTIVE_VLB_ENTRY_FROM} JOIN visible_batches b ON b.id=e.batch_id
    WHERE ${ACTIVE_VLB_ENTRY_FILTER}
    GROUP BY e.batch_id
   ), elb_counts AS (
    SELECT e.batch_id,count(*)::int AS total
    FROM mis_elb_batch_entries e
    JOIN mis_log_books l ON l.id=e.logbook_id
    JOIN visible_batches b ON b.id=e.batch_id
    WHERE l.deleted_at IS NULL
    GROUP BY e.batch_id
   )
   SELECT b.*,b.book_date::text AS report_date,
    COALESCE(v.total,0) AS entry_count,COALESCE(e.total,0) AS elb_entry_count
   FROM visible_batches b
   LEFT JOIN vlb_counts v ON v.batch_id=b.id
   LEFT JOIN elb_counts e ON e.batch_id=b.id
   ORDER BY (b.closed_at IS NULL) DESC,b.created_at DESC,b.id DESC
  `)).rows));
  const twoStage=twoStageEnabled();
  const waits=twoStage?batchStageWaits([...rows].reverse()):new Map();
  const batches=rows.filter(b=>siteAllowed(req.logBookScope,b.site)).map(b=>({...b,created_by:creator(b),stageWait:waits.get(b.id)||'',twoStage,canClose:!waits.has(b.id)&&canClose(b,req.batchActor,twoStage),stage:twoStage?batchStage(b):(b.closed_at?'closed':'open')}));
  const openBatchStatuses=req.batchActor.mis?rows.filter(b=>!b.closed_at).map(b=>({
   site:b.site,date:b.report_date,shift:b.shift,stage:twoStage?batchStage(b):'vlb_open'
  })):undefined;
  const open=rows.find(b=>!b.closed_at&&(isOwner(b,req.batchActor)||batchLogin(creator(b))===req.batchActor.login));
  const openBatch=open?(siteAllowed(req.logBookScope,open.site)?{...open,created_by:creator(open),stageWait:waits.get(open.id)||'',canClose:!waits.has(open.id)&&canClose(open,req.batchActor,twoStage)}:{id:open.id,restricted:true}):null;
  res.json({twoStage,batches,openBatchStatuses,openBatch:openBatch&&!openBatch.restricted?{...openBatch,stage:twoStage?batchStage(openBatch):(openBatch.closed_at?'closed':'open')}:openBatch,actor:{login:req.batchActor.login,mis:req.batchActor.mis,pm:req.batchActor.pm,canCreate:req.batchActor.canCreate,admin:req.batchActor.admin}});
 }));
 app.get('/api/vlb-batches/approvals',...protect,handle(async(req,res)=>{
  const rows=(await pool.query('SELECT r.*,b.name,b.site,b.book_date::text AS report_date,b.shift,b.closed_at,b.closure_revision AS current_revision FROM mis_vlb_reopen_requests r JOIN mis_vlb_batches b ON b.id=r.batch_id WHERE b.archived_at IS NULL AND b.book_date>=$$2026-11-01$$ AND r.withdrawn_at IS NULL ORDER BY r.requested_at DESC')).rows;
  res.json({requests:rows.filter(r=>siteAllowed(req.logBookScope,r.site)&&(r.requested_by===req.batchActor.login||batchPmAtSite(req.batchActor,r.site))).map(r=>({...r,canDecide:r.status==='pending'&&r.closure_revision===r.current_revision&&Boolean(r.closed_at)&&batchPmAtSite(req.batchActor,r.site)&&r.requested_by!==req.batchActor.login}))});
 }));
 app.get('/api/vlb-batches/preview',...protect,handle(async(req,res)=>{
  const selection=vlbBatchSelection(req.query);requireLogBookSite(req.logBookScope,selection.site);
  const existingBatch=await matchingVlbBatch(pool,{location:selection.site,bookDate:selection.date,bookShiftCode:selection.shift});
  const blocker=await openBatchCreationBlock(pool,selection);
  const previousShift=await previousShiftBlock(pool,selection);
  const records=await eligible(pool,selection);
  const sequence=Number((await pool.query('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM mis_vlb_batches WHERE site=$1 AND book_date=$2 AND shift=$3',[selection.site,selection.date,selection.shift])).rows[0].n);
  res.json({selection,records,name:existingBatch?.name||vlbBatchName(selection,sequence),existingBatch,...blocker,previousShift});
 }));
 app.get('/api/vlb-batches/:id/card-counts',...protect,handle(async(req,res)=>{
  const batch=await visible(pool,req.params.id,req);
  res.json(await readVlbCardCounts(pool,batch.id));
 }));
 // The batch board asks every 10 s. An unchanged batch answers 304 to the board's
 // If-None-Match instead of resending its records and audit history again.
 app.get('/api/vlb-batches/:id',...protect,handle(async(req,res)=>{
  // The details are several dozen small queries. On one connection they wait in the pool queue
  // once; sent one by one through the pool, each waited its own turn (about 44 turns a request
  // on 12 Nov 2026).
  const db=await pool.connect();let body;
  try{body=JSON.stringify(await details(db,await visible(db,req.params.id,req),req));}finally{db.release();}
  const etag=jsonEntityTag('vlb-batch',body);
  res.set('ETag',etag);res.vary('Authorization');
  if(requestEtagMatches(req.get('If-None-Match'),etag))return res.status(304).end();
  res.type('application/json').send(body);
 }));
 app.post('/api/vlb-batches/:id/archive',...protect,handle(async()=>fail('Removing only the batch is discontinued. Use Delete batch with a 10-day restore window.',410)));
 app.post('/api/vlb-batches',...protect,handle(async(req,res)=>{
  if(!req.batchActor.canCreate)fail('Only an authorized MIS user can create a batch.',403);
  const user=req.batchActor.login,selection=vlbBatchSelection(req.body);requireLogBookSite(req.logBookScope,selection.site);
  if(!uuid(req.body.requestKey))fail('Invalid batch save reference.',400);
  let repeated=false;
  const result=await transaction(async client=>{
   await lockVlbBatchSite(client,selection.site);
   const prior=(await client.query('SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE request_key=$1',[req.body.requestKey])).rows[0];
   if(prior){if(batchLogin(creator(prior))!==user||prior.site!==selection.site||prior.report_date!==selection.date||prior.shift!==selection.shift)fail('Batch save reference already used.');repeated=true;return details(client,await visible(client,prior.id,req),req)}
   const existing=await matchingVlbBatch(client,{location:selection.site,bookDate:selection.date,bookShiftCode:selection.shift});
   if(existing)fail('A batch already exists for this site, date and shift. Open that batch; reopen a closed batch from its batch page.');
   const {creationBlocker}=await openBatchCreationBlock(client,selection);
   if(creationBlocker)fail(creationBlocker);
   const previousShift=await previousShiftBlock(client,selection);
   if(previousShift)fail(previousShift.message);
   if(!twoStageEnabled()&&!req.batchActor.admin&&(await client.query('SELECT id FROM mis_vlb_batches WHERE (lower(COALESCE(creator_login,created_by))=$1 OR lower(amendment_by)=$1) AND book_date>=$$2026-11-01$$ AND closed_at IS NULL AND archived_at IS NULL',[user])).rows.length)fail('Close the previous batch before creating a new batch.');
   const workOrderId=String(req.body.workOrderId||'');
   if(workOrderId){
    const {rows}=await client.query('SELECT record_data FROM master_records WHERE master_name=ANY($1::text[]) AND id::text=$2',[WORK_ORDER_MASTERS,workOrderId]);
    if(!activeWorkOrders(rows.map(row=>row.record_data),selection.site,selection.date).length)fail('Select an active work contract for this site and report date.');
   }
   const records=await eligible(client,selection);
   const archivedRows=(await client.query('SELECT *,book_date::text AS report_date FROM mis_vlb_batches WHERE book_date=$1 AND shift=$2 AND archived_at IS NOT NULL AND deleted_at IS NULL FOR UPDATE',[selection.date,selection.shift])).rows;
   const archived=archivedRows.find(batch=>canonicalSiteName(batch.site)===selection.site);
   if(archived){
    if(await openSiteBatch(client,selection.site))fail('Close the active batches for this site before restoring an archived batch.');
    const restored=(await client.query("UPDATE mis_vlb_batches SET archived_at=NULL,closed_at=NULL,amendment_by=NULL,request_key=$1,creator_login=$2,created_by=$3,stage='vlb_open',lmv_locked_at=NULL,vlb_locked_at=NULL,vlb_locked_by=NULL,work_order_id=COALESCE($5,work_order_id) WHERE id=$4 RETURNING *,book_date::text AS report_date",[req.body.requestKey,user,null,archived.id,workOrderId||null])).rows[0];
    await client.query('INSERT INTO mis_vlb_batch_entries(batch_id,logbook_id,snapshot) SELECT $1,(r->>\'id\')::bigint,r FROM jsonb_array_elements($2::jsonb) r ON CONFLICT(logbook_id) DO NOTHING',[restored.id,JSON.stringify(records)]);
    await auditVlbBatch(client,restored,user,'restored_to_batch_list',{logbookIdsAdded:records.map(r=>r.id)});
    return details(client,restored,req);
   }
   const sequence=Number((await client.query('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM mis_vlb_batches WHERE site=$1 AND book_date=$2 AND shift=$3',[selection.site,selection.date,selection.shift])).rows[0].n);
   const batch=(await client.query('INSERT INTO mis_vlb_batches(id,name,site,book_date,shift,sequence,created_by,request_key,closed_at,closure_revision,saved_lock_policy,continuous_entry,creator_login,work_order_id,created_at) VALUES($1,$2,$3,$4,$5,$9,$6,$7,NULL,0,TRUE,TRUE,$8,$10,clock_timestamp()) RETURNING *,book_date::text AS report_date',[randomUUID(),vlbBatchName(selection,sequence),selection.site,selection.date,selection.shift,null,req.body.requestKey,user,sequence,workOrderId||null])).rows[0];
   await client.query('INSERT INTO mis_vlb_batch_scopes(site,book_date,shift,batch_id) VALUES($1,$2,$3,$4)',[selection.site,selection.date,selection.shift,batch.id]);
   await client.query('INSERT INTO mis_vlb_batch_entries(batch_id,logbook_id,snapshot) SELECT $1,(r->>\'id\')::bigint,r FROM jsonb_array_elements($2::jsonb) r',[batch.id,JSON.stringify(records)]);
   await auditVlbBatch(client,batch,user,'created',{logbookIds:records.map(r=>r.id)});
   return details(client,batch,req);
  },{site:selection.site,bookDate:selection.date,shift:selection.shift});res.status(repeated?200:201).json(result);
 }));
 app.post('/api/vlb-batches/:id/close',...protect,handle(async(req,res)=>res.json(await batchTransaction(req,async(client,batch)=>{
  if(!mayClose(batch,req.batchActor))fail(twoStageEnabled()?'Only the active batch owner or an MIS administrator can close this batch.':'Only the active batch owner can close this batch.',403);
  if(batch.closed_at)return details(client,batch,req);
  await assertCloseAllowed(client,batch);
  const closed=(await client.query("UPDATE mis_vlb_batches SET closed_at=NOW(),amendment_by=NULL,closure_revision=closure_revision+1,stage='closed' WHERE id=$1 RETURNING *,book_date::text AS report_date",[batch.id])).rows[0];
  await auditVlbBatch(client,batch,req.batchActor.login,'saved_and_locked',{closureRevision:closed.closure_revision,savedWithoutChanges:true,twoStage:twoStageEnabled()});return details(client,closed,req);
 }))));
 app.post('/api/vlb-batches/:id/lock-vlb',...protect,handle(async(req,res)=>res.json(await batchTransaction(req,async(client,batch)=>{
  if(!isOwner(batch,req.batchActor)&&!req.batchActor.admin)fail('Only the active batch owner can lock VLB for this batch.',403);
  return details(client,await lockVlb(client,batch,req.batchActor.login),req);
 }))));
 app.post('/api/vlb-batches/:id/lock-lmv',...protect,handle(async(req,res)=>res.json(await batchTransaction(req,async(client,batch)=>{
  if(!isOwner(batch,req.batchActor)&&!req.batchActor.admin)fail('Only the active batch owner or an MIS administrator can lock LMV.',403);
  return details(client,await lockLmv(client,batch,req.batchActor.login),req);
 }))));
 app.post('/api/vlb-batches/:id/unlock-vlb',...protect,handle(async(req,res)=>res.json(await batchTransaction(req,async(client,batch)=>{
  if(!mayUnlockVlb(batch,req.batchActor))fail('Only the batch owner, an MIS user, an MIS administrator or the site Project Manager can unlock VLB.',403);
  const reason=String(req.body?.reason||'').trim();if(reason.length<5||reason.length>2000)fail('Enter an unlock reason of 5 to 2000 characters.',400);
  return details(client,await unlockVlb(client,batch,req.batchActor.login,{reason}),req);
 },{exclusive:true}))));
 app.get('/api/vlb-batches/:id/fleet',...protect,handle(async(req,res)=>{
  const db=await pool.connect();let info;
  try{info=await stageDetails(db,await visible(db,req.params.id,req));}finally{db.release();}
  void prefetchFleetBreakdownRows(req.batchActor.login);
  res.json({stage:info.stage,fleet:info.fleet||[],fleetProgress:info.fleetProgress||null,machines:info.machines||[],holds:info.holds||[],closeBlockers:info.closeBlockers||[],statuses:FLEET_STATUSES,machineReport:info.machineReport||null});
 }));
 app.get('/api/vlb-batches/:id/fleet/:assetId/breakdowns',...protect,handle(async(req,res)=>{
  if(!/^\d+$/.test(req.params.assetId))fail('Invalid machine.',400);
  const batch=await visible(pool,req.params.id,req);
  const prefetched=await prefetchFleetBreakdownRows(req.batchActor.login);
  const readHours=lockedReadHours(logBookOps?.readHours,prefetched);
  res.set('Cache-Control','no-store').json(await readFleetBreakdowns(pool,batch,req.params.assetId,readHours,req.batchActor.login,req.query));
 }));
 app.put('/api/vlb-batches/:id/fleet/:assetId/draft',...protect,handle(async(req,res)=>{
  if(!/^\d+$/.test(req.params.assetId))fail('Invalid machine.',400);
  res.json(await batchTransaction(req,async(client,batch)=>{if(!mayEnterFleet(batch,req.batchActor))fail('Only an MIS user or MIS administrator can enter machines for this batch.',403);const row=await saveFleetDraft(client,batch,req.params.assetId,req.body?.draft||{},req.batchActor.login);return {assetId:String(row.asset_id),draft:row.draft,skipped:row.skipped};}));
 }));
 app.post('/api/vlb-batches/:id/fleet/:assetId',...protect,handle(async(req,res)=>{
  if(!/^\d+$/.test(req.params.assetId))fail('Invalid machine.',400);
  if(!logBookOps)fail('Machine entry is unavailable on this server.',503);
  // Pulse is read before the batch lock; inside it, the saved rows answer without a remote call.
  const prefetched=await prefetchFleetBreakdownRows(req.batchActor.login);
  res.json(await batchTransaction(req,async(client,batch)=>{
   if(!mayEnterFleet(batch,req.batchActor))fail('Only an MIS user or MIS administrator can enter machines for this batch.',403);
   const readHours=lockedReadHours(logBookOps.readHours&& (input=>logBookOps.readHours({...input,client})),prefetched);
   const record=await saveFleetEntry(client,batch,req.params.assetId,req.body||{},req.batchActor.login,{allowEditSaved:Boolean(req.batchActor.mis||req.batchActor.admin),resolve:logBookOps.resolve,insert:logBookOps.insert,applyHours:data=>logBookOps.applyHours(data,req.batchActor.login,readHours),readHours});
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
  res.json(await batchTransaction(req,(client,batch)=>ensureReopenRequest(client,batch,req,reason)));
 }));
 app.post('/api/vlb-batches/:id/reopen-decision',...protect,handle(async(req,res)=>{
  if(!uuid(req.body.requestId)||!['approve','reject'].includes(req.body.decision))fail('Select a valid reopening request and decision.',400);
  res.json(await batchTransaction(req,async(client,batch)=>{
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
   await lockVlbBatchSite(client,batch.site);
   const siteOpen=await openSiteBatch(client,batch.site,{excludeId:batch.id});if(siteOpen)fail('Close the open batch '+siteOpen.name+' before reopening another batch for this site.');
   const request=(await client.query("SELECT * FROM mis_vlb_reopen_requests WHERE batch_id=$1 AND requested_by=$2 AND closure_revision=$3 AND status='approved' ORDER BY decided_at DESC LIMIT 1 FOR UPDATE",[batch.id,req.batchActor.login,batch.closure_revision])).rows[0];
   if(!req.batchActor.admin&&(await client.query('SELECT id FROM mis_vlb_batches WHERE book_date>=$$2026-11-01$$ AND closed_at IS NULL AND (lower(COALESCE(creator_login,created_by))=ANY($1::text[]) OR lower(amendment_by)=$2)',[[req.batchActor.login,batchLogin(creator(batch))],req.batchActor.login])).rows.length)fail('Close the existing open batch before reopening this batch.');
   const opened=(await client.query("UPDATE mis_vlb_batches SET closed_at=NULL,amendment_by=$1,trial_reopened_until=NULL,creator_login=COALESCE(creator_login,created_by),created_by=NULL,stage=CASE WHEN vlb_locked_at IS NOT NULL THEN 'elb_open' ELSE 'vlb_open' END WHERE id=$2 RETURNING *,book_date::text AS report_date",[req.batchActor.login,batch.id])).rows[0];
   if(request)await client.query("UPDATE mis_vlb_reopen_requests SET status='used',used_at=NOW() WHERE id=$1",[request.id]);
   await auditVlbBatch(client,batch,req.batchActor.login,'reopened',{requestId:request?.id||null,approvedBy:request?.decided_by||null,pmApproval:request?'approved':'not required'});
   const records=await eligible(client,{site:canonicalSiteName(batch.site),date:batch.report_date,shift:batch.shift});for(const record of records)await syncVlbBatchRecord(client,record,req.batchActor.login,{relock:false});
   return details(client,opened,req);
 };
 app.post('/api/vlb-batches/:id/reopen',...protect,handle(async(req,res)=>{
  // Owner, 19 Nov 2026: every login that may use VLB batches reopens a saved batch, whatever its role.
  res.json(await batchTransaction(req,(client,batch)=>performReopen(client,batch,req)));
 }));
 app.get('/api/vlb-batches/:id/approval-otp',...protect,handle(async(req,res)=>{const batch=await visible(pool,req.params.id,req);res.json({otps:(await liveApprovalOtps(pool,batch.id,req.batchActor.login)).map(publicApprovalOtp)})}));
 // PM approval by OTP is no longer needed (owner, 18 Nov 2026): reopen and Unlock VLB act directly.
 app.post('/api/vlb-batches/:id/approval-otp',...protect,handle(async(req,res)=>{
  const purpose=String(req.body?.purpose||'').trim();if(purpose!=='reopen')fail('PM OTP is only available for reopening a closed batch.',400);
  fail('PM approval is no longer needed. Reopen the batch directly.',409);
 }));
 app.post('/api/vlb-batches/:id/approval-otp/:otpId/verify',...protect,handle(async(req,res)=>{
  await batchTransaction(req,async(client,batch)=>{
   const row=await consumeApprovalOtp(client,{otpId:req.params.otpId,batchId:batch.id,login:req.batchActor.login,otp:req.body?.otp});
   const note='Approved by OTP sent to '+row.sent_to.join(', ');
   const request=(await client.query('SELECT * FROM mis_vlb_reopen_requests WHERE id=$1 AND batch_id=$2 FOR UPDATE',[row.request_id,batch.id])).rows[0];
   if(!request||!batch.closed_at||request.closure_revision!==batch.closure_revision)fail('This reopening request is no longer pending for the current closure. Request a new OTP.',409);
   if(request.status==='pending')await client.query("UPDATE mis_vlb_reopen_requests SET status='approved',decided_by=$2,decision_note=$3,decided_at=NOW() WHERE id=$1",[request.id,row.sent_to[0],note]);
   else if(request.status!=='approved')fail('This reopening request was already decided. Request a new OTP.',409);
   await auditVlbBatch(client,batch,req.batchActor.login,'reopen_approved',{requestId:request.id,requestedBy:request.requested_by,via:'otp',otpId:row.id,sentTo:row.sent_to,note});
  },{exclusive:true});
  try{const batch=await batchTransaction(req,(client,current)=>performReopen(client,current,req));return res.json({approved:true,reopened:true,batch});}
  catch(error){if(!error.status)throw error;const batch=await details(pool,await visible(pool,req.params.id,req),req);return res.json({approved:true,reopened:false,error:error.message,batch});}
 }));
 return recovery;
}
