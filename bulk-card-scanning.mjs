import {SCAN_BATCH_NAMING_SCHEMA,createScanBatch} from './scan-batch-naming.mjs';
import {SCAN_QUEUE_SCHEMA,claimNextScanCard,requestScanBatch} from './scan-extraction-queue.mjs';
import {recoverMissingEquipmentNumbers} from './scan-machine-number-recovery.mjs';
import {scanValidationClient} from './scan-validation-cache.mjs';
import {scanFleetAssignment,scanFleetIssues,scanFleetSignature,scanFleetBlockingMessage} from './scan-fleet-assignment.mjs';
import {parseScanContext,scanCardContextIssues,scanContextIssues,scanContextGate,requireScanUploadContext,scanContextError} from './scan-batch-context.mjs';
import {normalizeScanEquipmentRows,scanEquipmentMatchIssues} from './scan-machine-rules.mjs';
import {applyBreakdownHours} from './breakdown-hours-source.mjs';
import {withVlbTripHandovers} from './vlb-trip-handover.mjs';
import {scanImageDimensions,scanImageMime} from './scan-image-format.mjs';
import {allowedScanBatches,requireLogBookSite,filterLogBookSites} from './log-book-access.mjs';
import {completeScanTripDetails} from './scan-trip-completion.mjs';
import {canAutoSaveScanCard} from './scan-auto-save.mjs';
import {scanBatchReport,scanBatchExportTables} from './scan-batch-report.mjs';
import {buildTableBundlePdf} from './table-export-pdf.mjs';
import {manualScanIssues} from './src/scan-manual-fields.mjs';
import {raw as rawBody} from 'express';
import {parseCaptureTiming} from './public/scan-timing.mjs';
import {geminiEnabled,MODEL} from './gemini-card-reader.mjs';
import {encodeScanJson as encodeLocalScanJson,encodeScanText as encodeLocalScanText,decodeScanRow} from './scan-text-storage.mjs';
import {createPaddleEvidence,validatePaddleEvidence,paddleEvidenceResult} from './paddle-evidence.mjs';
import {mergeReextractedDraft} from './scan-reextract.mjs';
import {CARD_SHIFTS,machineDiscrepancies} from './trip-card-rules.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {resolveLogBookData,insertLogBook} from './log-book.mjs';
import {responseReviewNeeded,recoveredTripNumberIssues} from './scan-response-recovery.mjs';
import {extractCard,scanEquipmentMasters} from './scan-extraction.mjs';
import {tripCardLocation} from './scan-site-match.mjs';
import {localCardOcr} from './local-card-ocr.mjs';
const encodeScanJson=value=>process.env.MIS_LOCAL_SCANNER_DATABASE==='true'?encodeLocalScanJson(value):value;
const encodeScanText=value=>process.env.MIS_LOCAL_SCANNER_DATABASE==='true'?encodeLocalScanText(value):value;
export const SCAN_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_scan_batches(id UUID PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN('vehicle','equipment')),name TEXT NOT NULL,created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 ALTER TABLE mis_scan_batches ADD COLUMN IF NOT EXISTS expected_context JSONB;
 ${SCAN_BATCH_NAMING_SCHEMA}
 ${SCAN_QUEUE_SCHEMA}
 CREATE TABLE IF NOT EXISTS mis_scan_cards(id UUID PRIMARY KEY,batch_id UUID NOT NULL REFERENCES mis_scan_batches(id),ordinal INTEGER NOT NULL,filename TEXT NOT NULL,image BYTEA NOT NULL,image_hash TEXT NOT NULL,ocr_text TEXT NOT NULL DEFAULT '',confidence REAL,raw_fields JSONB NOT NULL DEFAULT '{}',draft JSONB NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','reading','review','approved','rejected','posted','error')),revision INTEGER NOT NULL DEFAULT 1,checked_by TEXT,checked_at TIMESTAMPTZ,logbook_id BIGINT REFERENCES mis_log_books(id),error TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(batch_id,ordinal));
 ALTER TABLE mis_scan_cards ALTER COLUMN image DROP NOT NULL;
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS image_blob_key TEXT;ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS image_bytes BIGINT;ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS blob_uploaded_at TIMESTAMPTZ;
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 1;ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS expected_pages INTEGER NOT NULL DEFAULT 1;
 CREATE INDEX IF NOT EXISTS mis_scan_cards_hash ON mis_scan_cards(image_hash);CREATE INDEX IF NOT EXISTS mis_scan_cards_queue ON mis_scan_cards(status,created_at);
 CREATE UNIQUE INDEX IF NOT EXISTS mis_log_books_scanned_card ON mis_log_books(book_type,book_date,asset_id,(data->>'scanCardNumber')) WHERE data ? 'scanCardNumber' AND deleted_at IS NULL;`;
const uuid=v=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(v||''));
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const cardKey=v=>String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const publicCard=row=>{decodeScanRow(row);const {image,image_hash,...r}=row;return r};
const matchingPublicCard=(card,batch,session)=>{
 if(!batch.expected_context)return card;
 // The PC connector transports originals to the online reader; this is not an accepted entry.
 if(card.raw_fields?.connectorCaptureOnly&&String(session.login||'').startsWith('pc-scanner:'))return card;
 if(['queued','reading'].includes(card.status))return {...card,draft:{},raw_fields:{scanProgress:card.raw_fields?.scanProgress,captureTiming:card.raw_fields?.captureTiming}};
 if(['error','rejected'].includes(card.status))return card;
 const contextMismatch=scanCardContextIssues(batch.expected_context,card);
 return contextMismatch.length?{...card,context_mismatch:contextMismatch}:card;
};
const MASTER_SQL="SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY id";
const MASTER_NAMES=['Equipment master','C-Dir Employee master','ERP Employee master','Employee master','Shift Master','Work Order master'];
export async function checkScanCard(client,kind,card,input=card.draft){
 if(kind==='vehicle'&&card.raw_fields?.tripLocationRuleVersion===1)input={...input,location:tripCardLocation(input.location),tripLocationRuleVersion:1};
 // OCR notes describe the original extraction; current values determine review issues.
 const errors=[],warnings=[];let data;
 if(card.raw_fields?.fleetBlock)errors.push(card.raw_fields.fleetBlock.message||'Review the restored card before saving.');
 const context=(await client.query('SELECT expected_context FROM mis_scan_batches WHERE id=$1',[card.batch_id])).rows[0]?.expected_context;
 errors.push(...scanCardContextIssues(context,card,input));
 errors.push(...Object.values(recoveredTripNumberIssues(card.raw_fields,input)));
 if(responseReviewNeeded(card.raw_fields,input))errors.push('Check the flagged extraction response issues against the original scan and confirm the corrections.');
 if(kind==='vehicle'&&card.raw_fields?.shiftRuleVersion===1){const hours=CARD_SHIFTS[input.cardShift]?.hours;if(!hours)errors.push('Select one clearly marked Trip Card shift: I, II, III, Day or Night.');else if(Number(input.shiftHours)!==hours)errors.push('The marked shift requires '+hours+' hours.');}
 if(kind==='vehicle'&&(input.machineNotationRuleVersion===1||card.raw_fields?.machineNotation?.version===1)){const equipment=scanEquipmentMasters((await client.query(MASTER_SQL,[['Equipment master']])).rows);input=normalizeScanEquipmentRows({...input,machineNotationRuleVersion:1,tripBodyRuleVersion:card.raw_fields?.tripBodyRuleVersion||input.tripBodyRuleVersion||1},equipment);errors.push(...new Set(Object.values(scanEquipmentMatchIssues(input,equipment))));}if(card.page_count<card.expected_pages)errors.push('The back page is missing. Reject this card and rescan both sides.');
 for(const [key,label] of [['bookDate','Book date'],['location','Location'],['assetId','Door number'],['employeeId',kind==='vehicle'?'Driver':'Operator'],['shiftId','Shift'],['shiftHours','Shift hours'],['openingHmr','Opening HMR'],['closingHmr','Closing HMR'],...(kind==='vehicle'?[['openingKmr','Opening KMR'],['closingKmr','Closing KMR']]:[])])if(input[key]===undefined||input[key]===null||input[key]==='')errors.push(label+' is missing or unreadable.');
 try{data=await resolveLogBookData(client,kind,input);}catch(e){errors.push(e.message)}
 const number=cardKey(kind==='vehicle'?input.aFormNo:input.jobCardNo);if(!number)errors.push(kind==='vehicle'?'Trip Card / A Form number is required.':'Job Card number is required.');
 const duplicateImage=(await client.query("SELECT id FROM mis_scan_cards WHERE image_hash=$1 AND id<>$2 AND status NOT IN('rejected') AND (created_at<$3 OR (created_at=$3 AND id<$2)) LIMIT 1",[card.image_hash,card.id,card.created_at])).rows[0];if(duplicateImage)errors.push('This scan duplicates an earlier card. Reject this duplicate or reject the earlier copy first.');
 if(data&&number){const sibling=(await client.query("SELECT ordinal FROM mis_scan_cards WHERE id<>$1 AND batch_id=$2 AND status NOT IN('rejected','posted') AND draft->>'bookDate'=$3 AND draft->>'assetId'=$4 AND regexp_replace(upper(COALESCE(NULLIF(draft->>'aFormNo',''),draft->>'jobCardNo','')),'[^A-Z0-9]','','g')=$5 AND (created_at<$6 OR (created_at=$6 AND id<$1)) LIMIT 1",[card.id,card.batch_id,data.bookDate,String(data.assetId),number,card.created_at])).rows[0];if(sibling)errors.push('Same card number, door and date already appear on card '+sibling.ordinal+'. Review the duplicate.');const duplicate=(await client.query("SELECT book_no FROM mis_log_books WHERE book_type=$1 AND book_date=$2 AND asset_id=$3 AND deleted_at IS NULL AND regexp_replace(upper(COALESCE(data->>'scanCardNumber',NULLIF(data->>'aFormNo',''),data->>'jobCardNo','')),'[^A-Z0-9]','','g')=$4 LIMIT 1",[kind,data.bookDate,data.assetId,number])).rows[0];if(duplicate)errors.push('Card already exists in '+duplicate.book_no+'.');}
 for(const mismatch of machineDiscrepancies(input.trips||[],input.scanMachineSummary||[]))errors.push('Machine-wise summary mismatch — '+mismatch);
 for(const row of input.scanMachineSummary||[])if(!String(row.equipmentName||'').trim()||!Number.isSafeInteger(Number(row.tripCount))||Number(row.tripCount)<1)errors.push('Check the equipment name and positive trip count on every machine-summary row.');
 if(!input.bookDate&&input.bookDateSource==='scan-unreadable')warnings.push('Book Date could not be read. Enter the date printed on the scanned card; today is not substituted.');
 if(input.bookDateSource==='system-fallback')warnings.push('Book date was not read from the scan; system date used. Confirm or enter the card date.');
 if(input.cardShift&&!input.shiftId)warnings.push('Marked shift '+input.cardShift+' does not match a unique Shift Master time. Check the marked shift and location.');
 if(kind==='vehicle'&&!input.scanMachineSummary?.length)warnings.push('Printed machine-wise summary was not read. Compare the calculated totals with the paper summary.');
 if(kind==='vehicle'&&!(input.trips||[]).length)warnings.push('No trip rows extracted. Add all trip rows, or explicitly confirm the card has no trips.');
 if(data&&data.totalWorkingHmr>data.shiftHours)warnings.push('Working HMR exceeds the selected shift hours. Confirm these readings.');
 if(!input.workOrderId)warnings.push('No Work Order selected. Confirm whether this card requires a contract.');
 return {errors,warnings,data,number};
}
export function registerBulkCardScanning(app,{pool,requireSession,requireAdministrator,getGroqConfig,ocr=localCardOcr({getGroqConfig}),readHours,readPulseFleet=null,refreshPulseFleet=null,archiveSavedBatch=null,archiveTarget=null,imageStorage=null,localDrafts=false,scanConcurrency=geminiEnabled(process.env)?5:1,getSiteScope=async()=>({sites:null})}){
 if(!Number.isInteger(scanConcurrency)||scanConcurrency<1||scanConcurrency>5)throw Error('Scan concurrency must be between 1 and 5.');
 let workers=0,timer,stopped=false;const protect=[requireSession,requireAdministrator,async(req,res,next)=>{try{
 req.logBookScope=await getSiteScope(req.session);
 if(req.logBookScope.sites!==null&&!req.logBookScope.sites.length)return res.status(403).json({error:'Assign a site or region to this MIS login before scanning.'});
 req.allowedSiteBatches=await allowedScanBatches(pool,req.logBookScope,req.session.login||req.session.name);
 if(req.allowedSiteBatches!==null&&req.params.id){
  let batchId=req.params.id;
  if(req.path.startsWith('/api/scan-cards/'))batchId=(await pool.query('SELECT batch_id FROM mis_scan_cards WHERE id=$1',[req.params.id])).rows[0]?.batch_id;
  if(!req.allowedSiteBatches.includes(batchId))return res.status(403).json({error:'This scan batch is not assigned to your site or region.'});
 }
 if(req.body?.draft?.location&&req.body.action!=='reject')requireLogBookSite(req.logBookScope,req.body.draft.location);
 next();
 }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}}];
 const wrap=fn=>async(req,res,next)=>{try{await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}};
 const getBatch=async(client,id)=>{if(!uuid(id))fail('Invalid scan batch.');const b=(await client.query('SELECT * FROM mis_scan_batches WHERE id=$1',[id])).rows[0];if(!b)fail('Batch not found.',404);return b};
 const getCard=async(client,id,lock=false)=>{if(!uuid(id))fail('Invalid scan card.');const row=(await client.query('SELECT * FROM mis_scan_cards WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];if(!row)fail('Card not found.',404);return decodeScanRow(row)};
 const readBatchReport=async req=>{
  const batch=await getBatch(pool,req.params.id);
  const rows=(await pool.query('SELECT c.id,c.batch_id,c.ordinal,c.filename,c.raw_fields,c.draft,c.status,c.page_count,l.id AS saved_logbook_id,l.book_no,l.data AS saved_data,l.deleted_at AS logbook_deleted_at FROM mis_scan_cards c LEFT JOIN mis_log_books l ON l.id=c.logbook_id WHERE c.batch_id=$1 ORDER BY c.ordinal',[batch.id])).rows;
  const reportGate=scanContextGate(batch.expected_context,rows.map(decodeScanRow));if(reportGate?.blocked)fail('Excel/PDF is paused. Remove wrong cards or cancel the batch before proceeding.',409);
  for(const row of rows){decodeScanRow(row);if(row.saved_data&&!row.logbook_deleted_at)requireLogBookSite(req.logBookScope,row.saved_data.location);}
  if(batch.kind==='vehicle'){const saved=rows.filter(row=>row.status==='posted'&&row.saved_data&&!row.logbook_deleted_at);const linked=await withVlbTripHandovers(pool,saved.map(row=>({id:row.saved_logbook_id,book_no:row.book_no,data:row.saved_data})),await filterLogBookSites(pool,req.logBookScope));const byId=new Map(linked.map(row=>[String(row.id),row.data]));for(const row of saved)row.saved_data=byId.get(String(row.saved_logbook_id));}
  return scanBatchReport(batch,rows);
 };
 app.get('/api/scan-batches/:id/report',...protect,wrap(async(req,res)=>{
  const report=await readBatchReport(req);res.set('Cache-Control','no-store').json({title:report.title,batchId:report.batchId,counts:report.counts,totals:report.totals,tables:scanBatchExportTables(report)});
 }));
 app.get('/api/scan-batches/:id/report.pdf',...protect,wrap(async(req,res)=>{
  const report=await readBatchReport(req),tables=scanBatchExportTables(report,{pdf:true});
  if(tables.reduce((n,t)=>n+t.rows.length,0)>5000||JSON.stringify(tables).length>1000000)fail('This batch has too much detail for PDF. Download batch Excel for the complete report.',413);
  const pdf=await buildTableBundlePdf({title:report.title,subtitle:report.name+' · Batch ID: '+report.batchId+' · Totals include saved cards only',tables});
  res.set('Cache-Control','no-store').type('pdf').attachment((report.vehicle?'VLB':'ELB')+'-batch-'+report.batchId+'.pdf').send(pdf);
 }));
 const fleetChecksInFlight=new Set();
 async function enforceFleet(card,draft=card.draft,raw=card.raw_fields,actor){
  if(!readPulseFleet||['posted','rejected','queued','reading'].includes(card.status)||card.raw_fields?.fleetRejection)return null;
  const expected=(await pool.query('SELECT expected_context FROM mis_scan_batches WHERE id=$1',[card.batch_id])).rows[0]?.expected_context;
  // Header mismatches belong to the user's mismatch queue, not fleet deletion.
  if(expected&&scanCardContextIssues(expected,{...card,raw_fields:raw},draft).length)return null;
  draft={...draft,location:expected?.location||draft.location};
  const signature=scanFleetSignature(draft);let issues=[],error='';
  try{const fleet=await readPulseFleet(actor);const equipment=(await pool.query("SELECT record_data FROM master_records WHERE master_name='Equipment master' AND id=$1",[Number(draft.assetId)||0])).rows[0]?.record_data;issues=scanFleetIssues(fleet,draft,raw,equipment?.door||equipment?.doorNo||'');}catch(e){error=e.message;}
  const prior=raw?.fleetReview;
  const review={signature,issues,error,checkedAt:new Date().toISOString(),decision:issues.length&&prior?.signature===signature&&prior.decision==='transfer-pending'?'transfer-pending':'unresolved'};
  await pool.query("UPDATE mis_scan_cards SET raw_fields=raw_fields||jsonb_build_object('fleetReview',$2::jsonb) WHERE id=$1 AND revision=$3 AND status IN('review','approved','error')",[card.id,JSON.stringify(encodeScanJson(review)),card.revision]);
  return review;
 }
 function queueFleetCheck(card,actor){
  const key=card.id+':'+scanFleetSignature(card.draft);if(fleetChecksInFlight.has(key))return;fleetChecksInFlight.add(key);
  void enforceFleet(card,card.draft,card.raw_fields,actor).catch(error=>console.error('Fleet review unavailable:',error.message)).finally(()=>fleetChecksInFlight.delete(key));
 }
 async function requireFleet(card,draft,actor){
  if(card.raw_fields?.fleetRejection)fail(card.raw_fields.fleetRejection.message,409);
  const review=await enforceFleet(card,draft,card.raw_fields,actor);
  if(review?.error||review?.issues.length)fail(review.error||'Equipment is not assigned to this site. Choose Reject card or complete the existing transfer in Pulse.',409);
  if(card.raw_fields?.fleetBlock&&review&&!review.error&&!review.issues.length)await pool.query("UPDATE mis_scan_cards SET raw_fields=raw_fields-'fleetBlock' WHERE id=$1 AND revision=$2 AND status IN('review','approved','error')",[card.id,card.revision]);
 }
 app.post('/api/scan-cards/:id/fleet-review',...protect,wrap(async(req,res)=>{
  if(!readPulseFleet)fail('Pulse fleet verification is not configured.',503);
  if(!['reject','delete','transfer-pending','recheck'].includes(req.body.action))fail('Choose reject, existing transfer or recheck.');
  const initial=await getCard(pool,req.params.id);if(!['review','approved','error'].includes(initial.status))fail('Only unsaved review cards can be changed here.',409);
  if(initial.revision!==req.body.revision)fail('Card changed. Reload and retry.',409);
  if(req.body.action==='delete'){
   if(!initial.raw_fields?.fleetReview)fail('Recheck the fleet status before deleting.',409);
   const c=await pool.connect();try{await c.query('BEGIN');const card=await getCard(c,initial.id,true);
    if(card.revision!==req.body.revision||card.logbook_id||!['review','approved','error'].includes(card.status))fail('Card changed. Reload before deleting.',409);
    if(card.image_blob_key){if(!imageStorage?.remove)fail('Image deletion is unavailable.',503);await imageStorage.remove(card.image_blob_key);}
    const message='Card deleted manually by user. Upload again if needed.';
    await c.query("UPDATE mis_scan_cards SET status='rejected',image=NULL,image_blob_key=NULL,image_bytes=0,ocr_text='',raw_fields=$2::jsonb,draft='{}'::jsonb,error=$3,review_note=$3,revision=revision+1 WHERE id=$1",[card.id,JSON.stringify({fleetRejection:{message,deletedBy:req.session.login||req.session.name}}),message]);
    await c.query('COMMIT');return res.json({deleted:true});
   }catch(error){await c.query('ROLLBACK');throw error}finally{c.release()}
  }
  const review=await enforceFleet(initial,initial.draft,initial.raw_fields,req.session.login||req.session.name);
  if(!review)fail('Resolve this card\'s date, site and shift mismatch before equipment review.',409);
  if(review.error)fail(review.error,409);
  if(req.body.action==='recheck'){if(!review.issues.length&&refreshPulseFleet)await refreshPulseFleet(req.session.login||req.session.name);return res.json({review,ready:!review.issues.length});}
  if(!review.issues.length)fail('Equipment now matches the site. Recheck and continue.',409);
  const c=await pool.connect();try{await c.query('BEGIN');const card=await getCard(c,initial.id,true);if(card.revision!==req.body.revision||!['review','approved','error'].includes(card.status))fail('Card changed. Reload and retry.',409);
   const rejected=req.body.action==='reject';const next={...review,decision:rejected?'rejected':'transfer-pending',decidedBy:req.session.login||req.session.name,decidedAt:new Date().toISOString()};
   await c.query("UPDATE mis_scan_cards SET raw_fields=raw_fields||jsonb_build_object('fleetReview',$2::jsonb),status=$3,review_note=$4,revision=revision+1 WHERE id=$1",[card.id,JSON.stringify(encodeScanJson(next)),rejected?'rejected':'review',rejected?'Rejected by user: equipment not present at selected site':'Awaiting completion of existing equipment transfer in Pulse']);await c.query('COMMIT');res.json({review:next,rejected,pulseUrl:'https://pulse.cmll.in/'});
  }catch(error){await c.query('ROLLBACK');throw error}finally{c.release()}
 }));
 app.get('/api/scan-batches',...protect,wrap(async(req,res)=>{const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0)fail('Invalid batch history offset.');const {rows}=await pool.query("SELECT b.*,count(c.id) FILTER(WHERE c.review_note<>'Removed from batch: wrong date, site or shift')::int AS cards,count(c.id) FILTER(WHERE c.status='approved')::int AS approved,count(c.id) FILTER(WHERE c.status='posted')::int AS posted FROM mis_scan_batches b LEFT JOIN mis_scan_cards c ON c.batch_id=b.id WHERE b.kind=ANY($1::text[]) AND ($2::uuid[] IS NULL OR b.id=ANY($2::uuid[])) GROUP BY b.id ORDER BY b.created_at DESC,b.id DESC LIMIT 100 OFFSET $3",[req.misAllowedScanKinds||['vehicle','equipment'],req.allowedSiteBatches,offset]);res.set('Cache-Control','no-store').json({batches:rows,nextOffset:rows.length===100?offset+rows.length:null});}));
 app.post('/api/scan-batches',...protect,wrap(async(req,res)=>{if(!['vehicle','equipment'].includes(req.body.kind))fail('Choose Trip Cards or Job Cards.');let context;try{context=requireScanUploadContext(req.body.kind,req.body.expectedContext)}catch(e){fail(e.message)}if(context)requireLogBookSite(req.logBookScope,context.location);const batch=await createScanBatch(pool,{id:randomUUID(),kind:req.body.kind,name:req.body.name,user:req.session.login||req.session.name,expectedContext:context||undefined});res.status(201).json(batch);}));
 app.post('/api/scan-batches/:id/remove',...protect,wrap(async(req,res)=>{const batch=await getBatch(pool,req.params.id);const c=await pool.connect();let blobs=[];try{await c.query('BEGIN');await c.query('SELECT id FROM mis_scan_batches WHERE id=$1 FOR UPDATE',[batch.id]);const cards=(await c.query('SELECT status,image_blob_key FROM mis_scan_cards WHERE batch_id=$1 FOR UPDATE',[batch.id])).rows;if(cards.some(card=>card.status==='posted'))fail('This batch contains saved log-book records and cannot be removed here.',409);blobs=cards.map(card=>card.image_blob_key).filter(Boolean);await c.query('DELETE FROM mis_scan_cards WHERE batch_id=$1',[batch.id]);await c.query('DELETE FROM mis_scan_batches WHERE id=$1',[batch.id]);await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error}finally{c.release()}if(imageStorage?.remove)for(const key of blobs)try{await imageStorage.remove(key)}catch{}res.json({removed:true});}));
 app.get('/api/scan-batches/:id',...protect,wrap(async(req,res)=>{const batch=await getBatch(pool,req.params.id);await requestScanBatch(pool,batch.id);void pump();const rows=(await pool.query('SELECT c.id,c.batch_id,c.ordinal,c.filename,c.image_hash,c.ocr_text,c.confidence,c.raw_fields,c.draft,c.status,c.revision,c.checked_by,c.checked_at,c.logbook_id,c.error,c.created_at,c.page_count,c.expected_pages,c.review_note,l.book_no,l.data AS saved_data,l.deleted_at AS logbook_deleted_at FROM mis_scan_cards c LEFT JOIN mis_log_books l ON l.id=c.logbook_id WHERE c.batch_id=$1 AND c.review_note<>\'Removed from batch: wrong date, site or shift\' ORDER BY ordinal',[batch.id])).rows;const cards=[],validationClient=scanValidationClient(pool);for(const row of rows){decodeScanRow(row);if(row.saved_data&&!row.logbook_deleted_at)requireLogBookSite(req.logBookScope,row.saved_data.location);const check=['review','approved','error'].includes(row.status)?await checkScanCard(validationClient,batch.kind,row):{errors:[],warnings:[]};if(readPulseFleet&&['review','approved','error'].includes(row.status)){const message=scanFleetBlockingMessage(row);if(message)check.errors.push(message);if(!row.raw_fields?.fleetReview||row.raw_fields.fleetReview.signature!==scanFleetSignature(row.draft))queueFleetCheck(row,req.session.login||req.session.name);}cards.push({...publicCard(row),checks:{errors:check.errors,warnings:check.warnings}});}res.set('Cache-Control','no-store').json({batch,cards:cards.map(card=>matchingPublicCard(card,batch,req.session)).filter(Boolean),contextGate:scanContextGate(batch.expected_context,cards),storage:{localDrafts,archiveEnabled:Boolean(archiveSavedBatch),target:imageStorage?'hot-blob':archiveTarget,azureUploadEnabled:Boolean(imageStorage)||archiveTarget==='azure'},reader:geminiEnabled(process.env)?{provider:'gemini',model:MODEL}:null});}));
 const contextGate=async(client,batch)=>scanContextGate(batch.expected_context,(await client.query('SELECT id,ordinal,filename,status,revision,draft,raw_fields FROM mis_scan_cards WHERE batch_id=$1 ORDER BY ordinal FOR UPDATE',[batch.id])).rows.map(decodeScanRow));
 const requireContextReady=async(client,batch)=>{const gate=await contextGate(client,batch);if(gate?.blocked)fail(scanContextError(gate),409);};
 app.post('/api/scan-batches/:id/validate-context',...protect,wrap(async(req,res)=>{
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.params.id]);
   const batch=await getBatch(c,req.params.id),gate=await contextGate(c,batch);if(!gate)fail('This batch has no scan selection.');
   const action=req.body.action;if(!['proceed','discard','cancel'].includes(action))fail('Choose Delete from batch, Cancel or Proceed.');
   if(action!=='cancel'){
    if(gate.context.cancelled)fail('This batch was cancelled. Start a new batch.',409);
    if(gate.waiting)fail('Wait until all cards have been read.',409);
    if(action==='proceed'&&gate.mismatches.length)fail(scanContextError(gate),409);
    if(action==='discard'){
     const shown=req.body.cards;if(!Array.isArray(shown)||shown.length!==gate.mismatches.length||gate.mismatches.some(card=>!shown.some(v=>v.id===card.id&&v.revision===card.revision)))fail('The cards changed. Review the mismatch list again.',409);
     for(const card of gate.mismatches)await c.query("UPDATE mis_scan_cards SET status='rejected',review_note='Removed from batch: wrong date, site or shift',checked_by=$2,checked_at=NOW(),revision=revision+1 WHERE id=$1 AND revision=$3 AND status IN('review','error','approved')",[card.id,req.session.login||req.session.name,card.revision]);
    }
   }
   const context={...batch.expected_context,confirmed:action!=='cancel',cancelled:action==='cancel'};
   await c.query('UPDATE mis_scan_batches SET expected_context=$2::jsonb WHERE id=$1',[batch.id,JSON.stringify(context)]);const remaining=Number((await c.query("SELECT count(*) AS n FROM mis_scan_cards WHERE batch_id=$1 AND status<>'rejected'",[batch.id])).rows[0].n);await c.query('COMMIT');res.json({cancelled:context.cancelled,removed:action==='discard'?gate.mismatches.length:0,remaining});
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }));
 app.post('/api/scan-batches/:id/cards',...protect,rawBody({type:['image/png','image/jpeg'],limit:12000000}),wrap(async(req,res)=>{const batch=await getBatch(pool,req.params.id);if(batch.kind==='vehicle'&&!batch.expected_context)fail('Enter the card date, site and marked shift in a new batch before uploading.',400);const binary=Buffer.isBuffer(req.body);let payload=req.body;if(binary){try{payload=JSON.parse(decodeURIComponent(req.get('X-Scan-Metadata')||''));}catch{fail('Invalid scan metadata.');}if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('Invalid scan metadata.');}const {base64,filename,uploadKey}=payload;const pageCount=payload.pageCount||1,expectedPages=payload.expectedPages||1;if(![1,2].includes(pageCount)||![1,2].includes(expectedPages))fail('Invalid pages per card.');if(!uuid(uploadKey))fail('Invalid upload reference.');if(!binary&&(typeof base64!=='string'||base64.length>16000000||(base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))))fail('Upload a PNG or JPEG scan up to 12 MB.');const image=binary?req.body:Buffer.from(base64,'base64');try{scanImageDimensions(image);}catch(error){fail(error.message);}const captureTiming=payload.captureTiming===undefined?null:parseCaptureTiming(payload.captureTiming);if(payload.captureTiming!==undefined&&!captureTiming)fail('Invalid scan timing.');const paddleEvidence=payload.paddleEvidence?validatePaddleEvidence(payload.paddleEvidence,image):null;const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[batch.id]);const previous=(await c.query('SELECT id FROM mis_scan_cards WHERE id=$1 AND batch_id=$2',[uploadKey,batch.id])).rows[0];if(previous){await c.query('COMMIT');return res.json(previous)}const n=Number((await c.query('SELECT count(*) AS n FROM mis_scan_cards WHERE batch_id=$1',[batch.id])).rows[0].n);if(n>=120)fail('A batch supports up to 120 cards.');if(batch.expected_context){if(batch.expected_context.cancelled)fail('This batch was cancelled.',409);await c.query("UPDATE mis_scan_batches SET expected_context=expected_context||'{\"confirmed\":false}'::jsonb WHERE id=$1",[batch.id]);}const blob=imageStorage?await imageStorage.put({id:uploadKey,batchId:batch.id,kind:batch.kind,image}):null;await c.query('INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,page_count,expected_pages,raw_fields,image_blob_key,image_bytes,blob_uploaded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)',[uploadKey,batch.id,n+1,String(filename||'Scan').slice(0,240),blob?null:image,createHash('sha256').update(image).digest('hex'),pageCount,expectedPages,JSON.stringify({...(paddleEvidence?{paddleEvidence}:{}),...(captureTiming?{captureTiming}:{})}),blob?.key||null,blob?.bytes||null,blob?.uploadedAt||null]);await c.query('COMMIT');res.status(201).json({id:uploadKey});}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}void pump();}));
 app.get('/api/scan-cards/:id/image',...protect,wrap(async(req,res)=>{const row=await getCard(pool,req.params.id);if(row.raw_fields?.fleetRejection)fail(row.raw_fields.fleetRejection.message,410);const card=imageStorage?await imageStorage.hydrate(row):row;res.set('Cache-Control','no-store').type(scanImageMime(card.image)).send(card.image);}));
 app.put('/api/scan-cards/:id',...protect,wrap(async(req,res)=>{if(req.body.action==='approve')await requireFleet(await getCard(pool,req.params.id),req.body.draft,req.session.login||req.session.name);const c=await pool.connect();try{await c.query('BEGIN');const card=await getCard(c,req.params.id,true),batch=await getBatch(c,card.batch_id);if(['queued','reading','posted'].includes(card.status))fail('This card cannot be changed in its current state.',409);if(req.body.revision!==card.revision)fail('Card changed. Reload before saving.',409);if(!req.body.draft||typeof req.body.draft!=='object'||Array.isArray(req.body.draft))fail('Invalid card form.');const action=req.body.action||'save';const draft={...req.body.draft,...(action==='approve'&&req.body.checked===true?{meterReviewFields:[],extractionReviewFields:[]}: {})};if(batch.kind==='vehicle'&&card.raw_fields?.tripLocationRuleVersion===1)draft.location=tripCardLocation(draft.location);const check=await checkScanCard(c,batch.kind,card,draft);if(!['save','approve','reject'].includes(action))fail('Invalid review action.');if(action==='approve'){if(check.errors.length)fail(check.errors.join(' '));if(req.body.checked!==true)fail('Confirm that every field and trip row has been checked against the scan.');if(batch.kind==='vehicle'&&!(draft.trips||[]).length&&req.body.noTripsConfirmed!==true)fail('Add trip rows or confirm that this card contains no trips.');}
 const next=action==='approve'?'approved':action==='reject'?'rejected':'review';await c.query('UPDATE mis_scan_cards SET draft=$1::jsonb,status=$2,revision=revision+1,checked_by=$3,checked_at=$4,error=\'\' WHERE id=$5',[JSON.stringify(encodeScanJson(draft)),next,action==='approve'?(req.session.login||req.session.name):null,action==='approve'?new Date():null,card.id]);if(action==='save'&&card.raw_fields?.fleetRestoration&&card.raw_fields?.fleetBlock)await c.query("UPDATE mis_scan_cards SET raw_fields=raw_fields-'fleetBlock' WHERE id=$1",[card.id]);await c.query('COMMIT');res.json({status:next,revision:card.revision+1,checks:{errors:check.errors,warnings:check.warnings}});if(readPulseFleet&&action==='save')void getCard(pool,card.id).then(row=>queueFleetCheck(row,req.session.login||req.session.name)).catch(()=>{});}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}));
 const archiveBatch=async batch=>{if(!archiveSavedBatch)return {status:'disabled',azureUploadEnabled:false};const rows=(await pool.query('SELECT c.*,l.book_no FROM mis_scan_cards c LEFT JOIN mis_log_books l ON l.id=c.logbook_id WHERE c.batch_id=$1 ORDER BY c.ordinal',[batch.id])).rows.map(decodeScanRow);const legacy=rows.filter(card=>!card.image_blob_key);if(!legacy.length)return {status:'saved',target:'hot-blob',azureUploadEnabled:true,folders:[]};return archiveSavedBatch(batch,legacy);};
 app.post('/api/scan-cards/:id/auto-save',...protect,wrap(async(req,res)=>{
  if(!Number.isSafeInteger(req.body.revision))fail('Reload the card before automatic saving.',409);
  const initial=await getCard(pool,req.params.id);if(initial.raw_fields?.fleetRestoration&&initial.raw_fields?.fleetBlock)fail('Review this restored card and save corrections before automatic saving.',409);await requireFleet(initial,initial.draft,req.session.login||req.session.name);const c=await pool.connect();let batch,record;
  try{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(709224102)');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[initial.batch_id]);
   batch=await getBatch(c,initial.batch_id);const card=await getCard(c,initial.id,true);
   if(card.status==='posted'){record=(await c.query('SELECT id,book_no,data FROM mis_log_books WHERE id=$1 AND deleted_at IS NULL',[card.logbook_id])).rows[0];if(!record)fail('The saved log book is unavailable. Reload this batch.',409);}
   else{
    await requireContextReady(c,batch);
    if(card.revision!==req.body.revision)fail('Card changed. Reload before automatic saving.',409);
    requireLogBookSite(req.logBookScope,card.draft.location);
    const check=await checkScanCard(c,batch.kind,card);
    if(!canAutoSaveScanCard({...card,checks:check},batch.kind))fail('Correct the card before saving: '+[...check.errors,...check.warnings,...Object.values(manualScanIssues(card.draft,batch.kind,card.raw_fields))].join(' '),409);
    const actor=req.session.login||req.session.name;
    if(req.logBookScope.sites!==null)await resolveLogBookData(c,batch.kind,card.draft,{enforceEmployeeSite:true});const data={...check.data,scanCardNumber:check.number,scanCardId:card.id,scanBatchId:batch.id,scanSaveMode:'automatic-validation',autoSavedBy:actor,autoSavedAt:new Date().toISOString()};
    await applyBreakdownHours(data,{readHours,actor:req.session.login||req.session.name});
    if(data.breakdownHours===null)fail('Pulse BD hours unavailable. Enter BD hours manually to finish automatic saving.',409);
    record=await insertLogBook(c,batch.kind,data,card.id,actor);
    await c.query("UPDATE mis_scan_cards SET status='posted',logbook_id=$1,revision=revision+1,checked_by=$2,checked_at=NOW(),draft=$4::jsonb WHERE id=$3",[record.id,actor,card.id,JSON.stringify(encodeScanJson({...card.draft,scanSaveMode:'automatic-validation',meterReviewFields:[],extractionReviewFields:[]}))]);
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');if(e.code==='23505')fail('Duplicate card detected. This card was not saved.',409);throw e}finally{c.release()}
  let archive=null;
  const remaining=(await pool.query("SELECT id FROM mis_scan_cards WHERE batch_id=$1 AND status<>'posted' AND review_note<>$2 LIMIT 1",[batch.id,'Removed from batch: wrong date, site or shift'])).rows.length;
  if(!remaining){try{archive=await archiveBatch(batch);}catch{archive={status:'pending',target:archiveTarget||'local',azureUploadEnabled:archiveTarget==='azure',message:'The log book was saved. Folder archiving needs a retry.'};}}
  res.json({status:'posted',record,archive});
 }));
 app.post('/api/scan-batches/:id/archive',...protect,wrap(async(req,res)=>{if(!archiveSavedBatch)fail('Local folder archiving is not enabled.',409);const batch=await getBatch(pool,req.params.id);res.json(await archiveBatch(batch));}));
 app.post('/api/scan-batches/:id/post',...protect,wrap(async(req,res)=>{const ids=req.body.cards;if(!Array.isArray(ids)||!ids.length||ids.length>120||ids.some(v=>!uuid(v.id)||!Number.isSafeInteger(v.revision))||new Set(ids.map(v=>v.id)).size!==ids.length)fail('Select approved cards to save.');for(const selected of ids){const card=await getCard(pool,selected.id);if(card.batch_id!==req.params.id)fail('Card belongs to another batch.',400);await requireFleet(card,card.draft,req.session.login||req.session.name);}const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(709224102)');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.params.id]);const batch=await getBatch(c,req.params.id);await requireContextReady(c,batch);const all=(await c.query('SELECT id,status,checked_by FROM mis_scan_cards WHERE batch_id=$1 AND review_note<>\'Removed from batch: wrong date, site or shift\' ORDER BY ordinal FOR UPDATE',[batch.id])).rows;if(all.length!==ids.length||all.some(row=>!ids.some(v=>v.id===row.id)))fail('Save all requires every card in this batch. No cards were saved.',409);if(all.some(row=>!['approved','posted'].includes(row.status)||(row.status==='approved'&&!row.checked_by)))fail('Resolve all brown/red cards and approve every card before saving the batch.',409);const results=[];for(const item of ids){const card=await getCard(c,item.id,true);if(card.batch_id!==batch.id)fail('Card belongs to a different batch.');if(card.status==='posted'){const existing=(await c.query('SELECT id,book_no FROM mis_log_books WHERE id=$1',[card.logbook_id])).rows[0];results.push(existing);continue}if(card.status!=='approved'||card.revision!==item.revision||!card.checked_by)fail('An approved card has changed. Reload and check it again.',409);requireLogBookSite(req.logBookScope,card.draft.location);const check=await checkScanCard(c,batch.kind,card);if(check.errors.length)fail(`Card ${card.ordinal}: ${check.errors.join(' ')}`,409);if(req.logBookScope.sites!==null)await resolveLogBookData(c,batch.kind,card.draft,{enforceEmployeeSite:true});const data={...check.data,scanCardNumber:check.number,scanCardId:card.id,scanBatchId:batch.id,reviewedBy:card.checked_by,reviewedAt:card.checked_at};await applyBreakdownHours(data,{readHours,actor:req.session.login||req.session.name});const log=await insertLogBook(c,batch.kind,data,card.id,req.session.login||req.session.name);await c.query("UPDATE mis_scan_cards SET status='posted',logbook_id=$1,revision=revision+1 WHERE id=$2",[log.id,card.id]);results.push({id:log.id,book_no:log.book_no});}await c.query('COMMIT');let archive;try{archive=await archiveBatch(batch);}catch{archive={status:'pending',target:archiveTarget||'local',azureUploadEnabled:archiveTarget==='azure',message:'Log books were saved, but folder archiving needs a retry.'};}res.json({records:results,count:results.length,archive});}catch(e){await c.query('ROLLBACK');if(e.code==='23505')fail('Duplicate card detected. No cards in this save were posted.',409);throw e}finally{c.release()}}));
 app.post('/api/scan-batches/:id/reextract',...protect,wrap(async(req,res)=>{await getBatch(pool,req.params.id);const r=await pool.query("UPDATE mis_scan_cards SET raw_fields=raw_fields||jsonb_build_object('reextractPrevious',draft,'scanQueueOrigin','user'),status='queued',revision=revision+1,error='' WHERE batch_id=$1 AND status IN('review','error') AND checked_by IS NULL RETURNING id",[req.params.id]);res.json({queued:r.rowCount});void pump();}));
 app.post('/api/scan-batches/:id/abort',...protect,wrap(async(req,res)=>{await getBatch(pool,req.params.id);const r=await pool.query("UPDATE mis_scan_cards SET status='rejected',error='Scanning cancelled by user.',revision=revision+1 WHERE batch_id=$1 AND status IN('queued','reading') RETURNING id",[req.params.id]);res.json({cancelled:r.rowCount});}));
 app.post('/api/scan-cards/:id/retry',...protect,wrap(async(req,res)=>{const card=await getCard(pool,req.params.id);if(card.status!=='error')fail('Only failed OCR cards can be retried.');await pool.query("UPDATE mis_scan_cards SET status='queued',raw_fields=raw_fields||jsonb_build_object('scanQueueOrigin','user'),error='',revision=revision+1 WHERE id=$1 AND status='error'",[card.id]);res.json({queued:true});void pump();}));
 async function readQueuedCards(){let current;try{while(!stopped){current=(await claimNextScanCard(pool)).rows[0];if(!current)break;decodeScanRow(current);try{if(imageStorage)await imageStorage.hydrate(current);const batch=await getBatch(pool,current.batch_id);if(process.env.MIS_LOCAL_SCANNER_DATABASE==='true'&&String(batch.created_by).startsWith('pc-scanner:')){await pool.query("UPDATE mis_scan_cards SET status='review',raw_fields=raw_fields||'{\"connectorCaptureOnly\":true}'::jsonb,revision=revision+1 WHERE id=$1",[current.id]);continue;}const result=!geminiEnabled(process.env)&&current.raw_fields?.paddleEvidence?paddleEvidenceResult(current.raw_fields.paddleEvidence,current.image,batch.kind):await ocr.recognize(current.image,{kind:batch.kind,onProgress:async (stage,details={})=>{await pool.query("UPDATE mis_scan_cards SET raw_fields=raw_fields||jsonb_build_object('scanProgress',$1::jsonb),revision=revision+1 WHERE id=$2 AND status='reading'",[JSON.stringify({stage,provider:'gemini',...details}),current.id]);}});const masters=(await pool.query(MASTER_SQL,[MASTER_NAMES])).rows;const extracted=extractCard(result.text,batch.kind,masters,result);const geminiData=result.extraction||result.hybrid;if(geminiData){if(result.extraction)extracted.raw.gemini=result.extraction;else extracted.raw.hybrid=result.hybrid;extracted.raw.tripGridIssues=geminiData.issues;extracted.draft.trips=geminiData.rows;extracted.draft.scanMachineSummary=geminiData.summary;extracted.draft.timeMode=geminiData.rows.some(r=>r.loadingTime||r.unloadingTime)?'with':'without';extracted.draft.extractionReviewFields.push(...(batch.kind==='vehicle'?['trips','scanMachineSummary']:[]));if(batch.kind==='equipment'){extracted.draft.openingKmr='';extracted.draft.closingKmr='';}if(batch.kind==='equipment')extracted.draft.shiftHours=result.handwrittenFields.shiftHours||'';}if(current.raw_fields?.scanQueueOrigin)extracted.raw.scanQueueOrigin=current.raw_fields.scanQueueOrigin;if(current.raw_fields?.equipmentNumberRecoveryVersion)extracted.raw.equipmentNumberRecoveryVersion=current.raw_fields.equipmentNumberRecoveryVersion;if(current.raw_fields?.captureTiming)extracted.raw.captureTiming=current.raw_fields.captureTiming;if(batch.kind==='vehicle')extracted.draft=normalizeScanEquipmentRows(extracted.draft,scanEquipmentMasters(masters));const detectionDraft=extracted.draft;const baseline=current.raw_fields?.extractionDraft||{};if(!current.raw_fields?.extractionDraft){const p=current.raw_fields?.reextractPrevious||{};for(const k of ['openingKmr','closingKmr','openingHmr','closingHmr'])if(p[k]===current.raw_fields?.meterReadings?.[k]?.value)baseline[k]=p[k];if(p.location===current.raw_fields?.location)baseline.location=p.location;if(p.aFormNo===current.raw_fields?.cardNo)baseline.aFormNo=p.aFormNo;}if(current.raw_fields?.reextractPrevious)extracted.draft=mergeReextractedDraft(current.raw_fields.reextractPrevious,baseline,extracted.draft);if(batch.kind==='vehicle')extracted.draft=completeScanTripDetails(extracted.draft,extracted.raw);if(result.provider==='paddleocr'&&result.pages)extracted.raw.paddleEvidence=createPaddleEvidence(result,current.image);extracted.raw.extractionDraft=detectionDraft;await pool.query("UPDATE mis_scan_cards SET status='review',ocr_text=$1,confidence=$2,raw_fields=$3::jsonb,draft=$4::jsonb,revision=revision+1,error='' WHERE id=$5",[encodeScanText(String(result.text||'').slice(0,100000)),Number.isFinite(result.confidence)?result.confidence:null,JSON.stringify(encodeScanJson(extracted.raw)),JSON.stringify(encodeScanJson(extracted.draft)),current.id]);if(readPulseFleet)await enforceFleet(await getCard(pool,current.id),extracted.draft,extracted.raw,batch.created_by);}catch(ocrError){console.error('Local card OCR failed:',ocrError?.message||String(ocrError));await pool.query("UPDATE mis_scan_cards SET status='error',error=$2,revision=revision+1 WHERE id=$1",[current.id,(ocrError?.status===409||['groq','gemini-hybrid','gemini'].includes(ocrError?.provider))?String(ocrError.message).slice(0,500):'OCR could not read this scan. Retry OCR or enter the card manually.']);}}}catch(e){console.error('Scan queue failed:',e?.code||e?.name||'Error');}}
 async function pump(){if(stopped)return;const tasks=[];while(workers<scanConcurrency){workers++;tasks.push(readQueuedCards().finally(()=>workers--));}await Promise.all(tasks);}
 return {async start(){await pool.query(SCAN_SCHEMA);await pool.query("UPDATE mis_scan_cards SET status='queued' WHERE status='reading'");if(geminiEnabled(process.env)&&!localDrafts)await recoverMissingEquipmentNumbers(pool);timer=setInterval(()=>void pump(),2000);timer.unref?.();void pump();},pump,async stop(){stopped=true;clearInterval(timer);await ocr.close?.()}};
}


