import {scanHistoryCsv} from '../services/scan-history-csv.mjs';
import {scanTripsOptional} from '../../shared/scan-trip-requirement.mjs';
import {readScanMasters} from '../services/scan-master-cache.mjs';
import {recoverFirstScanFields,readScanWithRecovery} from '../services/scan-first-field-recovery.mjs';
import {SCAN_DELETION_OTP_SCHEMA,issueScanDeletionOtp,consumeScanDeletionOtp} from '../services/scan-deletion-otp-store.mjs';
import {registerSelectedScanAbort} from './scan-card-abort.mjs';
import {registerScanCardGroupDeletion,SCAN_CARD_GROUP_DELETION_SCHEMA} from './scan-card-group-deletion.mjs';
import {recordMeterCorrection} from '../../shared/scan-meter-history.mjs';
import {requireOperationalDate,operationalScanSql} from '../../shared/operational-start.mjs';
import {EXACT_DUPLICATE_NOTE,REMOVED_FROM_BATCH_NOTE,fingerprintForUpload,findExactDuplicate,findVisualDuplicate,insertDuplicateCard,listDuplicateCards,restoreDuplicateCard,findContentDuplicate,findEarlierImageDuplicate,preloadDuplicateChecks,contentIdentityCertain,contentDuplicateMessage,applyContentDuplicate,backfillScanFingerprints,contentRejectEnabled} from '../services/scan-duplicates.mjs';
import {scanFingerprintSettings} from '../services/scan-fingerprint.mjs';
import {isDeletableScanCard} from '../../src/scan-card-deletion-selection.mjs';
import {lockSavedVlbBatches,lockVlbBatchWrites,matchingVlbBatch,isOpenBatchForDeletion} from '../rules/vlb-batch-policy.mjs';
import {requireScanEntrySpace} from '../../public/scan-entry-limit.mjs';
import {SCAN_BATCH_NAMING_SCHEMA,createScanBatch} from '../rules/scan-batch-naming.mjs';
import {SCAN_QUEUE_SCHEMA,SCAN_LEASE_SCHEMA,claimNextScanCard,requestScanBatch,queuedScanBatches,renewReadLeases,requeueExpiredReads,scanReadTiming,releaseReadLeases,beatScanEngine,removeScanEngine,pruneScanEngines,liveScanEngines,processLeaseOwner} from '../services/scan-extraction-queue.mjs';
import {scanLanesEnabled,scanEnginesExternal,laneConcurrency,groupBatchesByLane,engineCovers,OTHER_LANE} from '../rules/scan-lanes.mjs';
import {READER_OUTAGE_SCHEMA,OUTAGE_PROBE_MS,readerOutage,outageLaneKey,noteReaderOutage,clearReaderOutage,liveReaderOutages,readerOutageFor,claimOutageAlerts,requeueOutageFailures} from '../rules/scan-reader-outage.mjs';
import {readerOutageAlert} from '../../shared/scan-reader-outage-text.mjs';
import {recoverMissingEquipmentNumbers} from '../services/scan-machine-number-recovery.mjs';
import {scanValidationClient} from '../rules/scan-validation-cache.mjs';
import {createScanFleetQueue} from '../rules/scan-fleet-queue.mjs';
import {scanFleetAssignment,scanFleetIssues,scanFleetSignature,scanFleetBlockingMessage} from '../../shared/scan-fleet-assignment.mjs';
import {parseScanContext,scanContextNotes,scanContextIssues,scanCardSaveContextBlocked,scanContextGate,requireScanUploadContext,scanContextError,applyScanContext} from '../../shared/scan-batch-context.mjs';
import {normalizeScanEquipmentRows,scanEquipmentMatchIssues} from '../../shared/scan-machine-rules.mjs';
import {withEquipmentAliases,loadEquipmentAliases,attachEquipmentAliases,scanBatchMismatches,createEquipmentAlias,aliasOtpEnabled,publicAlias,requeueHeldScanCards as requeueHeldScanCardsFor} from '../../shared/equipment-aliases.mjs';
import {selectTripEquipment,resolvedMachineName,cardMachineKey} from '../../shared/scan-machine-rules.mjs';
import {assetBookKind,isLmv} from '../../shared/equipment-kind.mjs';
import {applyBreakdownHours,prefetchBreakdownRows,createBreakdownRowsPrefetchCache,lockedReadHours} from '../../shared/breakdown-hours-source.mjs';
import {withVlbTripHandovers} from '../../shared/vlb-trip-handover.mjs';
import {SCAN_IMAGE_TYPES,scanImageDimensions,scanImageMime} from '../rules/scan-image-format.mjs';
import {scanBlobKey} from '../services/scan-blob-storage.mjs';
import {allowedScanBatches,requireLogBookSite,filterLogBookSites,scanDeletionAllowed} from '../../shared/log-book-access.mjs';
import {fillVlbScanOpeningMeters,readVlbOpeningMeterRows,preloadVlbOpeningMeterRows} from '../rules/vlb-scan-opening-meters.mjs';
import {createScanCheckMemo,memoKey} from '../rules/scan-check-memo.mjs';
import {stableJson} from '../services/log-book-deletion-scope.mjs';
import {fillScanTripEstimates} from '../../shared/scan-trip-estimates.mjs';
import {completeScanTripDetails} from '../../shared/scan-trip-completion.mjs';
import {canAutoSaveScanCard} from '../../shared/scan-auto-save.mjs';
import {scanBatchReport,scanBatchExportTables} from '../../shared/scan-batch-report.mjs';
import {buildTableBundlePdf} from '../services/table-export-pdf.mjs';
import {manualScanIssues} from '../../src/scan-manual-fields.mjs';
import {raw as rawBody} from 'express';
import {parseCaptureTiming} from '../../public/scan-timing.mjs';
import {geminiEnabled,geminiKeySource,MODEL,MAX_GEMINI_CONCURRENCY} from '../services/gemini-card-reader.mjs';
import {encodeScanJson as encodeLocalScanJson,encodeScanText as encodeLocalScanText,decodeScanRow as decodeStoredScanRow,decodeScanJson} from '../rules/scan-text-storage.mjs';
import {createPaddleEvidence,validatePaddleEvidence,paddleEvidenceResult} from '../services/paddle-evidence.mjs';
import {mergeReextractedDraft} from '../rules/scan-reextract.mjs';
import {createReportLane} from '../services/report-lane.mjs';
import {ignoreScanLoadingWithoutEquipment,CARD_SHIFTS,machineDiscrepancies,bookShiftCode,machineTripTotal} from '../../shared/trip-card-rules.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {randomUUID,randomInt,createHash,timingSafeEqual} from 'node:crypto';
import {sendDeletionOtp} from '../services/deletion-whatsapp.mjs';
import {deletionPhone} from '../rules/deletion-otp-routing.mjs';
import {resolveLogBookData,insertLogBook} from './log-book.mjs';
import {responseReviewNeeded,recoveredTripNumberIssues} from '../../shared/scan-response-recovery.mjs';
import {extractCard,extractScanResult,scanEquipmentMasters,matchScanDraft} from '../rules/scan-extraction.mjs';
import {tripCardLocation} from '../../shared/scan-site-match.mjs';
import {localCardOcr} from '../services/local-card-ocr.mjs';
import {SCAN_PARTIAL_REFRESH_MAX} from '../../shared/scan-progress-poll.mjs';
const encodeScanJson=value=>process.env.MIS_LOCAL_SCANNER_DATABASE==='true'?encodeLocalScanJson(value):value;
const encodeScanText=value=>process.env.MIS_LOCAL_SCANNER_DATABASE==='true'?encodeLocalScanText(value):value;
export const SCAN_SCHEMA=`${SCAN_DELETION_OTP_SCHEMA}
${SCAN_CARD_GROUP_DELETION_SCHEMA}
CREATE TABLE IF NOT EXISTS mis_scan_batches(id UUID PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN('vehicle','equipment')),name TEXT NOT NULL,created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 ALTER TABLE mis_scan_batches ADD COLUMN IF NOT EXISTS expected_context JSONB;
 ${SCAN_BATCH_NAMING_SCHEMA}
 ${SCAN_QUEUE_SCHEMA}
 CREATE TABLE IF NOT EXISTS mis_scan_cards(id UUID PRIMARY KEY,batch_id UUID NOT NULL REFERENCES mis_scan_batches(id),ordinal INTEGER NOT NULL,filename TEXT NOT NULL,image BYTEA NOT NULL,image_hash TEXT NOT NULL,ocr_text TEXT NOT NULL DEFAULT '',confidence REAL,raw_fields JSONB NOT NULL DEFAULT '{}',draft JSONB NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','reading','review','approved','rejected','posted','error')),revision INTEGER NOT NULL DEFAULT 1,checked_by TEXT,checked_at TIMESTAMPTZ,logbook_id BIGINT REFERENCES mis_log_books(id),error TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(batch_id,ordinal));
 ALTER TABLE mis_scan_cards ALTER COLUMN image DROP NOT NULL;
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS image_blob_key TEXT;ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS image_bytes BIGINT;ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS blob_uploaded_at TIMESTAMPTZ;
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS fingerprint JSONB;ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS duplicate_of UUID;
 CREATE INDEX IF NOT EXISTS mis_scan_cards_duplicate_of ON mis_scan_cards(duplicate_of) WHERE duplicate_of IS NOT NULL;
 ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 1;ALTER TABLE mis_scan_cards ADD COLUMN IF NOT EXISTS expected_pages INTEGER NOT NULL DEFAULT 1;
 CREATE INDEX IF NOT EXISTS mis_scan_cards_hash ON mis_scan_cards(image_hash);CREATE INDEX IF NOT EXISTS mis_scan_cards_queue ON mis_scan_cards(status,created_at);
 CREATE UNIQUE INDEX IF NOT EXISTS mis_log_books_scanned_card ON mis_log_books(book_type,book_date,asset_id,(data->>'scanCardNumber')) WHERE data ? 'scanCardNumber' AND deleted_at IS NULL;
 ${SCAN_LEASE_SCHEMA}
 ${READER_OUTAGE_SCHEMA}`;
const uuid=v=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(v||''));
// How many whole or partial scan entry reads run at once on this server (MIS_SCAN_READ_SLOTS).
// Each holds one of the pool's connections while it runs; the rest of the pool stays free for
// saves, approvals and every other screen.
export const scanReadSlots=(env=process.env)=>{const n=Number(String(env.MIS_SCAN_READ_SLOTS??'').trim());return Number.isInteger(n)&&n>=1&&n<=50?n:4;};
// The same for the scan screen's progress poll (MIS_SCAN_PROGRESS_SLOTS): every open scan tab asks
// every 4 s while cards are being read, and tabs showing the same entry share one read.
export const scanProgressSlots=(env=process.env)=>{const n=Number(String(env.MIS_SCAN_PROGRESS_SLOTS??'').trim());return Number.isInteger(n)&&n>=1&&n<=50?n:4;};
export const SCAN_PROGRESS_SHARE_MS=2000;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const cardKey=v=>String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
function decodeScanRow(row){
 decodeStoredScanRow(row);
 if(row?.draft&&['review','approved','error'].includes(row.status))row.draft=ignoreScanLoadingWithoutEquipment(row.draft);
 return row;
}
const publicCard=row=>{decodeScanRow(row);const {image,image_hash,...r}=row;return r};
const matchingPublicCard=(card,batch,session)=>{
 if(!batch.expected_context)return batch.kind==='vehicle'&&!['posted','rejected'].includes(card.status)?{...card,context_mismatch:['Choose the card date, site and shift in Scan setup.']}:card;
 // The PC connector transports originals to the online reader; this is not an accepted entry.
 if(card.raw_fields?.connectorCaptureOnly&&String(session.login||'').startsWith('pc-scanner:'))return card;
 if(['queued','reading'].includes(card.status))return {...card,draft:{},raw_fields:{scanProgress:card.raw_fields?.scanProgress,captureTiming:card.raw_fields?.captureTiming}};
 if(['error','rejected'].includes(card.status))return card;
 return card.status==='posted'?card:{...card,draft:applyScanContext(batch.expected_context,card.draft)};
};
const MASTER_SQL="SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY id";
// Stamp the batch selection onto a card draft and, when the shift changed, pick the site's Shift Master row for it.
export async function applyBatchContext(client,context,draft){
 const next=applyScanContext(context,draft);
 if(!context||!next||next===draft||next.shiftId||!next.cardShift)return next;
 const rows=(await client.query(MASTER_SQL,[['Shift Master']])).rows.map(r=>({...r.record_data,id:String(r.id)}));
 const shift=rows.find(s=>canonicalSiteName(s.site||s.siteName)===canonicalSiteName(next.location)&&String(s.status||'').toLowerCase()!=='inactive'&&(!s.effectiveFrom||s.effectiveFrom<=context.bookDate)&&(!s.effectiveTo||s.effectiveTo>=context.bookDate)&&[s.shiftCode,s.shiftName,s.name].some(v=>bookShiftCode(v)&&bookShiftCode(v)===bookShiftCode(next.cardShift)));
 return shift?{...next,shiftId:shift.id}:next;
}
const MASTER_NAMES=['Equipment master','C-Dir Employee master','ERP Employee master','Employee master','Shift Master','Work Order master'];
const isLmvScan=batch=>batch.kind==='vehicle'&&batch.expected_context?.logBookKind==='lmv';
const scanBookKind=batch=>isLmvScan(batch)?'lmv':batch.kind;
function scanMastersForBook(masters,batch){
 if(!batch||!isLmvScan(batch))return masters;
 return masters.flatMap(row=>{
  if(row.master_name!=='Equipment master')return [row];
  if(isLmv(row.record_data))return [{...row,record_data:{...row.record_data,category:'Vehicle'}}];
  return assetBookKind(row.record_data)==='equipment'?[row]:[];
 });
}
// context and duplicates let a caller that checks many cards of one entry supply what it has already
// read (the entry's selection, and preloadDuplicateChecks) instead of one query per card for each.
export async function checkScanCard(client,kind,card,input=card.draft,{enforceEmployeeSite=false,context:knownContext,duplicates=null}={}){
 if(kind==='vehicle')input=ignoreScanLoadingWithoutEquipment(input);
 if(kind==='vehicle'&&card.raw_fields?.tripLocationRuleVersion===1)input={...input,location:tripCardLocation(input.location),tripLocationRuleVersion:1};
 // OCR notes describe the original extraction; current values determine review issues.
 const errors=[],warnings=[];let data;
 if(card.raw_fields?.fleetBlock)errors.push(card.raw_fields.fleetBlock.message||'Review the restored card before saving.');
 const context=knownContext!==undefined?knownContext:(await client.query('SELECT expected_context FROM mis_scan_batches WHERE id=$1',[card.batch_id])).rows[0]?.expected_context;
 // The batch date, site and shift are final: a different handwritten header is noted, never a block.
 const lmv=isLmvScan({kind,expected_context:context});
 warnings.push(...scanContextNotes(context,card,input));
 input=await applyBatchContext(client,context,input);
 errors.push(...Object.values(recoveredTripNumberIssues(card.raw_fields,input)));
 if(responseReviewNeeded(card.raw_fields,input))errors.push('Check the flagged extraction response issues against the original scan and confirm the corrections.');
 if(kind==='vehicle'&&card.raw_fields?.shiftRuleVersion===1){const hours=CARD_SHIFTS[input.cardShift]?.hours;if(!hours)errors.push('Select one clearly marked Trip Card shift: I, II, III, Day or Night.');}
 if(kind==='vehicle'&&(input.machineNotationRuleVersion===1||card.raw_fields?.machineNotation?.version===1)){const equipment=await withEquipmentAliases(client,scanEquipmentMasters((await client.query(MASTER_SQL,[['Equipment master']])).rows));input=normalizeScanEquipmentRows({...input,machineNotationRuleVersion:1,tripBodyRuleVersion:card.raw_fields?.tripBodyRuleVersion||input.tripBodyRuleVersion||1},equipment);errors.push(...new Set(Object.values(scanEquipmentMatchIssues(input,equipment))));}if(card.page_count<card.expected_pages)errors.push('The back page is missing. Reject this card and rescan both sides.');
 for(const [key,label] of [['bookDate','Book date'],['location','Location'],['assetId','Door number'],['employeeId',kind==='vehicle'?'Driver':'Operator'],['shiftHours','Shift hours'],...(lmv?[]:[['shiftId','Shift'],['openingHmr','Opening HMR'],['closingHmr','Closing HMR']]),...(kind==='vehicle'?[['openingKmr','Opening KMR'],['closingKmr','Closing KMR']]:[])])if(input[key]===undefined||input[key]===null||input[key]==='')errors.push(label+' is missing or unreadable.');
 try{data=await resolveLogBookData(client,scanBookKind({kind,expected_context:context}),input,{enforceEmployeeSite});}catch(e){errors.push(e.message)}
 const number=cardKey(kind==='vehicle'?input.aFormNo:input.jobCardNo);
 const duplicateImage=duplicates?await duplicates.image(card):await findEarlierImageDuplicate(client,card);if(duplicateImage)errors.push('Duplicate card.');
 if(data)requireOperationalDate(data.bookDate);
 if(data&&number){
  // The same card number, door and date on a live card in any entry for this date, site and shift, or in a saved log book, is a duplicate. A certain identity blocks with the original named; an uncertain one asks the operator to confirm first.
  const batch={id:card.batch_id,kind,expected_context:context};
  const identity={bookDate:data.bookDate,door:input.doorTextWritten||card.raw_fields?.door||input.doorText||data.door,number};
  const original=duplicates?await duplicates.content(card,identity):await findContentDuplicate(client,kind,card,batch,identity);
  if(original){const duplicateError=original.kind==='logbook'&&!original.ordinal?'Card already exists in '+original.bookNo+'.':contentDuplicateMessage(original,contentIdentityCertain({...card,draft:input},kind,context));if(duplicateError)errors.push(duplicateError);}
 }
 if(card.raw_fields?.duplicateSuspect?.ordinal&&!errors.some(e=>/duplicate/i.test(e)))warnings.push('This scan looks like card '+card.raw_fields.duplicateSuspect.ordinal+' in entry '+(card.raw_fields.duplicateSuspect.entryName||'')+'. Confirm it is a different card before saving.');
 for(const mismatch of machineDiscrepancies(input.trips||[],input.scanMachineSummary||[]))errors.push('Machine-wise summary mismatch — '+mismatch);
 for(const row of input.scanMachineSummary||[])if(!String(row.equipmentName||'').trim()||!Number.isSafeInteger(Number(row.tripCount))||Number(row.tripCount)<1)errors.push('Check the equipment name and positive trip count on every machine-summary row.');
 if(!input.bookDate&&input.bookDateSource==='scan-unreadable')warnings.push('Book Date could not be read. Enter the date printed on the scanned card; today is not substituted.');
 if(input.bookDateSource==='system-fallback')warnings.push('Book date was not read from the scan; system date used. Confirm or enter the card date.');
 if(!lmv&&input.cardShift&&!input.shiftId)warnings.push('Marked shift '+input.cardShift+' does not match a unique Shift Master time. Check the marked shift and location.');
 if(kind==='vehicle'&&!input.scanMachineSummary?.length&&machineTripTotal(input.trips||[])>0)warnings.push('Printed machine-wise summary was not read. Compare the calculated totals with the paper summary.');
 if(kind==='vehicle'&&!scanTripsOptional(data?.door||input.doorText)&&!(input.trips||[]).length)warnings.push('No trip rows extracted. Add all trip rows, or explicitly confirm the card has no trips.');


 return {errors,warnings,data,number};
}
export function registerBulkCardScanning(app,{trackJob=(name,task)=>task(),pool,requireSession,requireAdministrator,getGroqConfig,ocr=localCardOcr({getGroqConfig}),readHours,readBreakdownRows=null,sendCardDeletionOtp=request=>sendDeletionOtp({pool,...request}),readPulseFleet=null,refreshPulseFleet=null,archiveSavedBatch=null,archiveTarget=null,imageStorage=null,localDrafts=false,scanConcurrency=geminiEnabled(process.env)?5:1,getSiteScope=async()=>({sites:null}),fingerprintBackfill=!process.env.NODE_TEST_CONTEXT,
 readLane=createReportLane({slots:scanReadSlots(process.env),cacheMs:0}),
 progressLane=createReportLane({slots:scanProgressSlots(process.env),cacheMs:SCAN_PROGRESS_SHARE_MS}),
 // Tells the administrators when the reading account stops reading (no credit, key refused, quota).
 alertAdministrators=null,outageProbeMs=OUTAGE_PROBE_MS,
 // role 'engine' = the separate scan engine process: reads cards for its own
 // lane only and serves no pages. engineLane is a canonical site, or null for
 // the engine that reads every site not in engineExcluded.
 role='app',engineLane=null,engineExcluded=[],engineVersion='',scanLanes=scanLanesEnabled(process.env),enginesExternal=role==='app'&&scanEnginesExternal(process.env),
 lanePerSite=laneConcurrency(process.env,role==='engine'?8:5,MAX_GEMINI_CONCURRENCY),
 ocrForLane=lane=>localCardOcr({getGroqConfig,site:lane||'',concurrency:lanePerSite,shareGateByKey:true})}){
 if(!Number.isInteger(scanConcurrency)||scanConcurrency<1||scanConcurrency>MAX_GEMINI_CONCURRENCY)throw Error(`Scan concurrency must be between 1 and ${MAX_GEMINI_CONCURRENCY}.`);
 const prefetchAutoSaveBreakdownRows=createBreakdownRowsPrefetchCache(readBreakdownRows);
 // Pulse fleet rows carry the saved card aliases of their linked local record, so an aliased written label is not held as "not registered".
 if(readPulseFleet){const readSourceFleet=readPulseFleet;readPulseFleet=async (actor,site)=>withEquipmentAliases(pool,await readSourceFleet(actor,site),{by:'source'});}
 let workers=0,timer,leaseTimer,stopped=false,readTotal=0,liveEngineCount=0;const activeReads=new Set();const lanes=new Map(),singleLane={name:null,ocr,concurrency:scanConcurrency,workers:0,batchIds:null};const protect=[requireSession,requireAdministrator,async(req,res,next)=>{try{
 req.logBookScope=await getSiteScope(req.session);
 if(req.logBookScope.sites!==null&&!req.logBookScope.sites.length)return res.status(403).json({error:'Assign a site or region to this MIS login before scanning.'});
 const imageRequest=req.method==='GET'&&/^\/api\/scan-cards\/[^/]+\/image\/?$/i.test(req.path);
 if(imageRequest&&req.logBookScope.sites!==null){
  const denied=()=>res.status(403).json({error:'This scan batch is not assigned to your site or region.'});
  if(!uuid(req.params.id))return denied();
  const batchId=(await pool.query('SELECT batch_id FROM mis_scan_cards WHERE id=$1',[req.params.id])).rows[0]?.batch_id;
  if(!batchId)return denied();
  const allowed=await allowedScanBatches(pool,req.logBookScope,req.session.login||req.session.name,batchId);
  if(!allowed.includes(batchId))return denied();
  return next();
 }
 // A request about one entry or card checks that entry alone. Only the list (no id) needs every entry
 // the login may see; that read covers the whole card table, so it must not run on each poll and save.
 if(req.logBookScope.sites!==null&&req.params.id){
  let batchId=req.params.id;
  if(req.path.startsWith('/api/scan-cards/'))batchId=uuid(req.params.id)?(await pool.query('SELECT batch_id FROM mis_scan_cards WHERE id=$1',[req.params.id])).rows[0]?.batch_id:undefined;
  req.allowedSiteBatches=uuid(batchId)?await allowedScanBatches(pool,req.logBookScope,req.session.login||req.session.name,batchId):[];
  if(!req.allowedSiteBatches.includes(batchId)){
   const deletionRequest=/(?:\/deletion-otp|\/delete|\/card-deletions\/(?:otp|confirm))$/.test(req.path);
   const batch=deletionRequest?(await pool.query('SELECT expected_context FROM mis_scan_batches WHERE id=$1',[batchId])).rows[0]:null;
   if(!deletionRequest||!scanDeletionAllowed(req.logBookScope,batch))return res.status(403).json({error:'This scan batch is not assigned to your site or region.'});
  }
 }else req.allowedSiteBatches=await allowedScanBatches(pool,req.logBookScope,req.session.login||req.session.name);
 if(req.body?.draft?.location&&req.body.action!=='reject')requireLogBookSite(req.logBookScope,req.body.draft.location);
 next();
 }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}}];
 const wrap=fn=>async(req,res,next)=>{try{await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}};
 const getBatch=async(client,id)=>{if(!uuid(id))fail('Invalid scan batch.');const b=(await client.query('SELECT * FROM mis_scan_batches WHERE id=$1',[id])).rows[0];if(!b||b.expected_context?.deletedVlbBatch||b.expected_context?.deletedScanEntry)fail('Batch not found or deleted.',404);requireOperationalDate(b.expected_context?.bookDate||new Date(b.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}));return b};
 const getCard=async(client,id,lock=false)=>{if(!uuid(id))fail('Invalid scan card.');const row=(await client.query('SELECT * FROM mis_scan_cards WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];if(!row)fail('Card not found.',404);decodeScanRow(row);requireOperationalDate((await getBatch(client,row.batch_id)).expected_context?.bookDate||row.draft?.bookDate||new Date(row.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}));return row};
 const readBatchReport=async req=>{
  const batch=await getBatch(pool,req.params.id);
  if(batch.kind==='vehicle'&&!batch.expected_context)fail('Choose the card date, site and shift in Scan setup before downloading.',409);
  const rows=(await pool.query(`SELECT c.id,c.batch_id,c.ordinal,c.filename,c.raw_fields,c.draft,c.status,c.page_count,l.id AS saved_logbook_id,l.book_no,l.data AS saved_data,l.deleted_at AS logbook_deleted_at FROM mis_scan_cards c LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.book_date>=$$2026-11-01$$ WHERE ${operationalScanSql('c')} AND c.batch_id=$1 ORDER BY c.ordinal`,[batch.id])).rows;
  const reportGate=scanContextGate(batch.expected_context,rows.map(decodeScanRow));if(reportGate?.blocked)fail('Excel/PDF is paused. Remove wrong cards or cancel the batch before proceeding.',409);
  for(const row of rows){decodeScanRow(row);if(row.saved_data&&!row.logbook_deleted_at)requireLogBookSite(req.logBookScope,row.saved_data.location);}
  if(batch.kind==='vehicle'&&!isLmvScan(batch)){const saved=rows.filter(row=>row.status==='posted'&&row.saved_data&&!row.logbook_deleted_at);const linked=await withVlbTripHandovers(pool,saved.map(row=>({id:row.saved_logbook_id,book_no:row.book_no,data:row.saved_data})),await filterLogBookSites(pool,req.logBookScope));const byId=new Map(linked.map(row=>[String(row.id),row.data]));for(const row of saved)row.saved_data=byId.get(String(row.saved_logbook_id));}
  return scanBatchReport(batch,rows,{assets:await batchAssets(pool)});
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
 const fleetChecks=createScanFleetQueue({concurrency:2,onError:error=>console.error('Fleet review unavailable:',error.message)});
 // fresh makes the fleet read go to Pulse now instead of reusing a recent snapshot (recheck).
 async function enforceFleet(card,draft=card.draft,raw=card.raw_fields,actor,{fresh=false,readFleet=readPulseFleet}={}){
  if(!readPulseFleet||['posted','rejected','queued','reading'].includes(card.status)||card.raw_fields?.fleetRejection)return null;
  const expected=(await pool.query('SELECT expected_context FROM mis_scan_batches WHERE id=$1',[card.batch_id])).rows[0]?.expected_context;
  // The batch site is the card's site: the fleet check always runs against it.
  draft={...draft,location:expected?.location||draft.location};
  const signature=scanFleetSignature(draft);let issues=[],error='';
  try{const fleet=expected?.logBookKind==='lmv'
    ?(await pool.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master'")).rows
      .filter(row=>isLmv(row.record_data)||assetBookKind(row.record_data)==='equipment')
      .map(row=>({...row.record_data,id:row.id,...(isLmv(row.record_data)?{category:'Vehicle'}:{})}))
    :await readFleet(actor,draft.location,{fresh});const equipment=(await pool.query("SELECT record_data FROM master_records WHERE master_name='Equipment master' AND id=$1",[Number(draft.assetId)||0])).rows[0]?.record_data;issues=scanFleetIssues(fleet,draft,raw,equipment?.door||equipment?.doorNo||'');}catch(e){error=e.message;}
  const prior=raw?.fleetReview;
  const review={signature,issues,error,checkedAt:new Date().toISOString(),decision:issues.length&&prior?.signature===signature&&prior.decision==='transfer-pending'?'transfer-pending':'unresolved'};
  await pool.query("UPDATE mis_scan_cards SET raw_fields=raw_fields||jsonb_build_object('fleetReview',$2::jsonb) WHERE id=$1 AND revision=$3 AND status IN('review','approved','error')",[card.id,JSON.stringify(encodeScanJson(review)),card.revision]);
  return review;
 }
 function queueFleetCheck(card,actor){
  const key=card.id+':'+card.revision+':'+String(actor||'')+':'+scanFleetSignature(card.draft);
  const {image,...pendingCard}=card;
  fleetChecks.queue(key,()=>enforceFleet(pendingCard,pendingCard.draft,pendingCard.raw_fields,actor));
 }
 async function requireFleet(card,draft,actor,readFleet){
  if(card.raw_fields?.fleetRejection)fail(card.raw_fields.fleetRejection.message,409);
  // The card reached automatic save only after its current draft passed the Pulse
  // fleet review. Reuse that signed result instead of downloading the same fleet
  // again for every card in the entry. A changed draft has a different signature
  // and still performs a fresh check before it can save.
  const prior=card.raw_fields?.fleetReview;
  const review=prior?.signature===scanFleetSignature(draft)&&!prior.error&&!prior.issues?.length
   ?prior
   :await enforceFleet(card,draft,card.raw_fields,actor,{readFleet});
  if(review?.error||review?.issues.length)fail(review.error||'Equipment is not assigned to this site. Choose Reject card or complete the existing transfer in Pulse.',409);
  if(card.raw_fields?.fleetBlock&&review&&!review.error&&!review.issues.length)await pool.query("UPDATE mis_scan_cards SET raw_fields=raw_fields-'fleetBlock' WHERE id=$1 AND revision=$2 AND status IN('review','approved','error')",[card.id,card.revision]);
 }
 registerSelectedScanAbort(app,{pool,protect,wrap,getBatch,getCard});
 const openDeletion=async(client,batch,req)=>{
  const context=batch.expected_context;
  if(isLmvScan(batch)||!context?.bookDate||!context.location||!context.cardShift)return false;
  requireLogBookSite(req.logBookScope,context.location);
  return isOpenBatchForDeletion(client,await matchingVlbBatch(client,context),batch.kind,deletionActor(req));
 };
 const lockOpenDeletion=async client=>{
  await client.query('SELECT pg_advisory_xact_lock_shared(709224102)');
  await lockVlbBatchWrites(client);
 };
 const checkEntryDeletion=async(client,batchId,items,req)=>{
  const entry=await getBatch(client,batchId);
  if(entry.kind!=='vehicle'||!await openDeletion(client,entry,req))fail('Open or unlock the VLB batch before deleting this scan entry.',409);
  const {rows}=await client.query(`SELECT c.id FROM mis_scan_cards c WHERE ${operationalScanSql('c')} AND c.batch_id=$1 AND c.duplicate_of IS NULL AND c.review_note NOT IN($2,$3) AND c.review_note NOT LIKE 'Card deleted manually by user%' AND NOT(c.raw_fields ? 'manualDeletion')`,[batchId,REMOVED_FROM_BATCH_NOTE,EXACT_DUPLICATE_NOTE]);
  const ids=new Set(items.map(item=>item.id));
  if(rows.length!==ids.size||rows.some(card=>!ids.has(card.id)))fail('The scan entry changed. Refresh it and approve the current card list.',409);
 };
 registerScanCardGroupDeletion(app,{pool,protect,wrap,getBatch,getCard,sendOtp:sendCardDeletionOtp,openDeletion,lockOpenDeletion,imageStorage,checkEntryDeletion});
 const deletable=card=>{if(!isDeletableScanCard(card))fail('Only unsaved cards can be deleted here.',409);};
 const deletionActor=req=>String(req.session.login||req.session.name||'');
 const deletionPhrase=card=>`Approve deletion of card ${card.id} revision ${card.revision}`;

 app.post('/api/scan-cards/:id/deletion-otp',...protect,wrap(async(req,res)=>{
  const card=await getCard(pool,req.params.id);deletable(card);
  if(card.revision!==req.body.revision)fail('Card changed. Reload before deleting.',409);
  if(req.body.approval!==deletionPhrase(card)||!String(req.body.reason||'').trim())fail('Enter the exact card approval and a deletion reason.',400);
  const batch=await getBatch(pool,card.batch_id),sites=[batch.expected_context?.location||card.draft?.location];
  res.json(await issueScanDeletionOtp(pool,{actor:deletionActor(req),card,reason:req.body.reason,send:sendCardDeletionOtp,to:deletionPhone(sites),sites}));
 }));
 app.post('/api/scan-cards/:id/delete',...protect,wrap(async(req,res)=>{
  const row=req.body.requestId?await consumeScanDeletionOtp(pool,{actor:deletionActor(req),cardId:req.params.id,requestId:req.body.requestId,otp:req.body.otp}):null;
  const c=await pool.connect();try{await c.query('BEGIN');
   if(!row)await lockOpenDeletion(c);
   const card=await getCard(c,req.params.id,true);deletable(card);
   const reason=row?.reason||String(req.body.reason||'').trim();
   if(!row&&!(await openDeletion(c,await getBatch(c,card.batch_id),req)))fail('The batch stage is unavailable for deletion without OTP. Reload before deleting.',409);
   if(!reason||reason.length>2000)fail('Enter a deletion reason of up to 2000 characters.',400);
   if(card.revision!==(row?.revision??req.body.revision)||req.body.approval!==deletionPhrase(card))fail('Card changed. Prepare a fresh deletion approval.',409);
   if(card.image_blob_key){
    if(!imageStorage?.remove)fail('Image deletion is unavailable.',503);
    await c.query('SELECT pg_advisory_xact_lock(709224103,hashtext($1))',[card.image_blob_key]);
    if((await c.query('SELECT id FROM mis_scan_cards WHERE image_blob_key=$1 AND id<>$2 LIMIT 1',[card.image_blob_key,card.id])).rows.length)fail('The source image is shared. Deletion requires separate review.',409);
    await imageStorage.remove(card.image_blob_key);
   }
   const vehicle=String(card.draft?.door||card.draft?.doorText||card.raw_fields?.door||card.saved_data?.door||'').trim();
   const message='Card deleted manually by user'+(vehicle?' · Vehicle '+vehicle:'')+'. Upload again if needed.';
   await c.query("UPDATE mis_scan_cards SET status='rejected',image=NULL,image_blob_key=NULL,image_bytes=0,ocr_text='',raw_fields=$2::jsonb,draft='{}'::jsonb,error=$3,review_note=$3,revision=revision+1 WHERE id=$1",[card.id,JSON.stringify({manualDeletion:{by:deletionActor(req),reason,deletedAt:new Date().toISOString(),vehicle,...(row?{otpVerifiedAt:new Date().toISOString()}: {})}}),message]);
   await c.query('COMMIT');res.json({deleted:true});
  }catch(error){await c.query('ROLLBACK');throw error}finally{c.release()}
 }));
 app.post('/api/scan-cards/:id/fleet-review',...protect,wrap(async(req,res)=>{
  if(!readPulseFleet)fail('Pulse fleet verification is not configured.',503);
  if(!['reject','delete','transfer-pending','recheck'].includes(req.body.action))fail('Choose reject, existing transfer or recheck.');
  const initial=await getCard(pool,req.params.id);if(!['review','approved','error'].includes(initial.status))fail('Only unsaved review cards can be changed here.',409);
  if(initial.revision!==req.body.revision)fail('Card changed. Reload and retry.',409);
  if(req.body.action==='delete')fail('Use the Delete card button in card review.',409);
  const review=await enforceFleet(initial,initial.draft,initial.raw_fields,req.session.login||req.session.name,{fresh:req.body.action==='recheck'});
  if(!review)fail('Resolve this card\'s date, site and shift mismatch before equipment review.',409);
  if(review.error)fail(review.error,409);
  if(req.body.action==='recheck'){if(!review.issues.length&&refreshPulseFleet)await refreshPulseFleet(req.session.login||req.session.name);return res.json({review,ready:!review.issues.length});}
  if(!review.issues.length)fail('Equipment now matches the site. Recheck and continue.',409);
  const c=await pool.connect();try{await c.query('BEGIN');const card=await getCard(c,initial.id,true);if(card.revision!==req.body.revision||!['review','approved','error'].includes(card.status))fail('Card changed. Reload and retry.',409);
   const rejected=req.body.action==='reject';const next={...review,decision:rejected?'rejected':'transfer-pending',decidedBy:req.session.login||req.session.name,decidedAt:new Date().toISOString()};
   await c.query("UPDATE mis_scan_cards SET raw_fields=raw_fields||jsonb_build_object('fleetReview',$2::jsonb),status=$3,review_note=$4,revision=revision+1 WHERE id=$1",[card.id,JSON.stringify(encodeScanJson(next)),rejected?'rejected':'review',rejected?'Rejected by user: equipment not present at selected site':'Awaiting completion of existing equipment transfer in Pulse']);await c.query('COMMIT');res.json({review:next,rejected,pulseUrl:'https://pulse.cmll.in/'});
  }catch(error){await c.query('ROLLBACK');throw error}finally{c.release()}
 }));
 app.get('/api/scan-batches',...protect,wrap(async(req,res)=>{const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0)fail('Invalid batch history offset.');const {rows}=await pool.query(`SELECT b.*,count(c.id) FILTER(WHERE c.review_note<>'Removed from batch: wrong date, site or shift' AND c.review_note NOT LIKE 'Card deleted manually by user%' AND c.duplicate_of IS NULL)::int AS cards,count(c.id) FILTER(WHERE c.duplicate_of IS NOT NULL)::int AS duplicates,count(c.id) FILTER(WHERE c.status='approved')::int AS approved,count(c.id) FILTER(WHERE c.status='posted' AND c.review_note NOT LIKE 'Card deleted manually by user%')::int AS posted FROM mis_scan_batches b LEFT JOIN mis_scan_cards c ON c.batch_id=b.id AND ${operationalScanSql('c')} WHERE COALESCE(NULLIF(b.expected_context->>'bookDate',''),to_char(b.created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD'))>=$$2026-11-01$$ AND NOT(COALESCE(b.expected_context,'{}'::jsonb) ?| ARRAY['deletedVlbBatch','deletedScanEntry']) AND b.kind=ANY($1::text[]) AND (COALESCE(b.expected_context->>'logBookKind','')='lmv')=$4 AND ($2::uuid[] IS NULL OR b.id=ANY($2::uuid[])) GROUP BY b.id ORDER BY b.created_at DESC,b.id DESC LIMIT 100 OFFSET $3`,[req.misAllowedScanKinds||['vehicle','equipment'],req.allowedSiteBatches,offset,req.query.logBookKind==='lmv']);const tripTotals=await scanEntryTripTotals(pool,rows.map(b=>b.id));res.set('Cache-Control','no-store').json({batches:rows.map(b=>({...b,trip_total:tripTotals.get(b.id)??0})),nextOffset:rows.length===100?offset+rows.length:null});}));
 app.get('/api/scan-history.csv',...protect,wrap(async(req,res)=>{
  const {from,to,bookKind}=req.query;
  const kind={vlb:'vehicle',lmv:'vehicle',elb:'equipment'}[bookKind];
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  if(!['vlb','lmv','elb'].includes(bookKind)||!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>=31*86400000)fail('Choose a valid date range of up to 31 days.');
  if(req.misAllowedScanKinds&&!req.misAllowedScanKinds.includes(kind))fail('This scan history is outside your access.',403);
  const {rows}=await pool.query(`SELECT c.id,c.batch_id,c.created_at,c.status,c.raw_fields,
   $5::text AS book_kind,b.expected_context->>'location' AS site
   FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id
   WHERE b.kind=$1 AND ($2::uuid[] IS NULL OR b.id=ANY($2::uuid[]))
   AND (COALESCE(b.expected_context->>'logBookKind','')='lmv')=($5='lmv')
   AND NOT(COALESCE(b.expected_context,'{}'::jsonb) ?| ARRAY['deletedVlbBatch','deletedScanEntry'])
   AND COALESCE(NULLIF(b.expected_context->>'bookDate',''),to_char(b.created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD'))>='2026-11-01'
   AND ${operationalScanSql('c')} AND c.duplicate_of IS NULL
   AND c.review_note NOT IN ('Removed from batch: wrong date, site or shift','Exact duplicate upload skipped automatically')
   AND c.review_note NOT LIKE 'Card deleted manually by user%'
   AND c.created_at>=($3::date::timestamp AT TIME ZONE 'Asia/Kolkata')
   AND c.created_at<(($4::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata')
   ORDER BY c.created_at,c.id LIMIT 25001`,[kind,req.allowedSiteBatches,from,to,bookKind]);
  if(rows.length>25000)fail('Choose a shorter date range to export at most 25,000 cards.');
  res.set('Cache-Control','no-store').attachment('scan-history-'+bookKind+'-'+from+'-to-'+to+'.csv').type('text/csv').send(scanHistoryCsv(rows));
 }));
 app.post('/api/scan-batches',...protect,wrap(async(req,res)=>{if(!['vehicle','equipment'].includes(req.body.kind))fail('Choose Trip Cards or Job Cards.');let context;try{context=requireScanUploadContext(req.body.kind,req.body.expectedContext)}catch(e){fail(e.message)}if(context)requireLogBookSite(req.logBookScope,context.location);const batch=await createScanBatch(pool,{id:randomUUID(),kind:req.body.kind,name:req.body.name,user:req.session.login||req.session.name,expectedContext:context||undefined});res.status(201).json(batch);}));
 app.post('/api/scan-batches/:id/remove',...protect,wrap(async(req,res)=>{const batch=await getBatch(pool,req.params.id);const c=await pool.connect();let blobs=[];try{await c.query('BEGIN');await c.query('SELECT id FROM mis_scan_batches WHERE id=$1 FOR UPDATE',[batch.id]);const cards=(await c.query('SELECT status,image_blob_key FROM mis_scan_cards WHERE batch_id=$1 FOR UPDATE',[batch.id])).rows;if(cards.some(card=>card.status==='posted'))fail('This batch contains saved log-book records and cannot be removed here.',409);blobs=cards.map(card=>card.image_blob_key).filter(Boolean);await c.query('DELETE FROM mis_scan_cards WHERE batch_id=$1',[batch.id]);await c.query('DELETE FROM mis_scan_batches WHERE id=$1',[batch.id]);await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error}finally{c.release()}if(imageStorage?.remove)for(const key of blobs)try{await imageStorage.remove(key)}catch{}res.json({removed:true});}));
 // Section 3 of the equipment alias spec: written machines no Pulse door answers, beside the Pulse
 // equipment at the site that no card names, category by category. Pairing applies the choice to the
 // batch's unsaved cards at once as a card-only selection; permanence waits for the OTP.
 const batchAssets=async(client,batch)=>withEquipmentAliases(client,scanMastersForBook((await client.query(MASTER_SQL,[['Equipment master']])).rows,batch).map(r=>({...r.record_data,id:String(r.id),kind:assetBookKind(r.record_data),site:r.record_data.currentLocation||r.record_data.site||r.record_data.location||''})));
 // The browser judges completeness with the master lists (/api/log-books/options). Automatic saving must
 // judge with the same lists, or it refuses a card whose dropdown-selected loading equipment the browser
 // already matched to the printed summary, and the operator finds nothing to correct.
 // Auto-save judges every card against the master lists. The employee lists are about 44 MB, so they
 // come from the copy kept in memory per master-data revision (the one card reading uses), read before
 // the save transaction starts: the copy's revision check must not run inside a transaction.
 const readScanIssueMasters=async()=>{
  const rows=(await readScanMasters(pool,MASTER_NAMES)).rows;
  if(!rows.some(r=>r.master_name==='C-Dir Employee master'))rows.push(...(await readScanMasters(pool,['Users & employees'])).rows);
  return rows;
 };
 const scanIssueOptions=async(client,batch,masters)=>{
  const rows=scanMastersForBook(masters,batch);
  const hasEmployees=rows.some(r=>r.master_name==='C-Dir Employee master');
  return {assets:await withEquipmentAliases(client,rows.filter(r=>r.master_name==='Equipment master').map(r=>({...r.record_data,id:String(r.id),kind:assetBookKind(r.record_data),site:r.record_data.currentLocation||r.record_data.site||r.record_data.location||''}))),
   employees:rows.filter(r=>['Employee master','ERP Employee master','C-Dir Employee master'].includes(r.master_name)||(!hasEmployees&&r.master_name==='Users & employees')).map(r=>({id:String(r.id)})),
   shifts:rows.filter(r=>r.master_name==='Shift Master').map(r=>({id:String(r.id)}))};
 };
 const liveCards=async(client,batchId)=>(await client.query("SELECT id,ordinal,filename,status,revision,draft,raw_fields FROM mis_scan_cards WHERE batch_id=$1 AND status IN('review','approved','error') AND review_note NOT IN('Removed from batch: wrong date, site or shift','Exact duplicate upload skipped automatically') ORDER BY ordinal",[batchId])).rows.map(row=>{decodeScanRow(row);return row});
 app.get('/api/scan-batches/:id/mismatches',...protect,wrap(async(req,res)=>{
  const batch=await getBatch(pool,req.params.id),cards=await liveCards(pool,batch.id),site=batch.expected_context?.location||cards.find(c=>c.draft?.location)?.draft?.location||'';
  const assets=await batchAssets(pool,batch),aliases=await loadEquipmentAliases(pool,{statuses:['pending','suspended']});
  const result=scanBatchMismatches({cards,assets,site,kind:batch.kind,aliases});
  res.set('Cache-Control','no-store').json({...result,otpEnabled:aliasOtpEnabled(),extracting:(await pool.query("SELECT count(*)::int AS n FROM mis_scan_cards WHERE batch_id=$1 AND status IN('queued','reading')",[batch.id])).rows[0].n>0,batchName:batch.name||'',context:batch.expected_context||null});
 }));
 app.post('/api/scan-batches/:id/apply-pair',...protect,wrap(async(req,res)=>{
  const batch=await getBatch(pool,req.params.id);const kind=req.body?.kind==='vehicle'?'vehicle':'equipment';
  const writtenKey=String(req.body?.writtenKey||'').trim(),equipmentId=String(req.body?.equipmentId||'').trim();
  if(!writtenKey||!/^\d+$/.test(equipmentId))fail('Choose one written machine and one Pulse record to pair.');
  const site=batch.expected_context?.location||'';const assets=await batchAssets(pool,batch);const asset=assets.find(a=>a.id===equipmentId&&a.kind===kind);
  if(!asset)fail('The Pulse record is not available for this pair.',404);
  const c=await pool.connect();let rows=0,touched=new Set();
  try{await c.query('BEGIN');
   for(const card of await liveCards(c,batch.id)){
    const draft=structuredClone(card.draft||{});let changed=false;
    if(kind==='vehicle'||batch.kind==='equipment'){if(cardMachineKey(draft.doorText||card.raw_fields?.door||'',kind)===writtenKey){draft.doorText=resolvedMachineName(asset);draft.assetId=asset.id;draft.doorTextWritten=card.raw_fields?.door||card.draft?.doorText||'';changed=true;rows++;}}
    else{for(const field of ['trips','scanMachineSummary'])draft[field]=(draft[field]||[]).map(row=>{const written=row.equipmentSource==='master-selection'?'':row.equipmentNotation?.original||row.equipmentName||'';if(!written||cardMachineKey(written,'equipment')!==writtenKey)return row;changed=true;rows++;return field==='trips'?selectTripEquipment({...row,originalEquipmentName:row.originalEquipmentName||written},asset.id,assets,site||draft.location):{...row,equipmentName:resolvedMachineName(asset),equipmentNotation:{original:written,resolved:resolvedMachineName(asset)}};});}
    if(!changed)continue;
    const updated=await c.query("UPDATE mis_scan_cards SET draft=$1::jsonb,revision=revision+1,status=CASE WHEN status='approved' THEN 'review' ELSE status END WHERE id=$2 AND revision=$3 RETURNING id",[JSON.stringify(encodeScanJson(draft)),card.id,card.revision]);
    if(updated.rows.length)touched.add(card.id);
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  let alias=null,otpRequired=false;
  const writtenText=String(req.body?.writtenText||writtenKey).trim();
  try{const created=await createEquipmentAlias(pool,{equipmentId,kind,writtenText,site,book:batch.kind==='vehicle'?'vlb':'elb',batchId:batch.id,requestedBy:req.session.login||req.session.name,otp:aliasOtpEnabled()});alias=created.alias?publicAlias(created.alias):null;otpRequired=Boolean(created.alias&&created.alias.status==='pending');if(created.alias?.status==='active')await requeueHeldScanCardsFor(pool);}
  catch(e){if(e.status!==409)throw e;alias=null;res.set('Cache-Control','no-store');return res.status(409).json({error:e.message,applied:{rows,cards:touched.size}});}
  res.set('Cache-Control','no-store').json({applied:{rows,cards:touched.size},alias,otpRequired,counts:{rows,cards:touched.size,batch:batch.name||'',context:batch.expected_context?[batch.expected_context.bookDate,batch.expected_context.location,'Shift '+batch.expected_context.cardShift].filter(Boolean).join(', '):''}});
 }));
 // The 4 s poll reads identity, status, revision and the fleet check of each card: a few KB
 // instead of every draft, with no re-validation, draft rewrite or duplicate scan. The browser
 // reloads the full entry only when this differs from the cards it shows.
 // Until 14 November 2026 each poll took five or six pool connections one after another (the
 // batch, the request mark, the cards, the open deletion, the reader), each waiting its turn
 // behind every other request, and every tab showing the same entry asked separately. Now one
 // held connection serves a poll, polls run through their own lane, and tabs asking for the same
 // entry with the same site access share one read for SCAN_PROGRESS_SHARE_MS.
 const sendScanProgress=async(req,res)=>{
  const key=JSON.stringify(['scan-progress',req.params.id,deletionActor(req),req.logBookScope?.sites??null]);
  const payload=await progressLane.run(key,async()=>{
   const db=await pool.connect();
   try{
    const batch=await getBatch(db,req.params.id);
    const requested=await requestScanBatch(db,batch.id);if(requested.rowCount!==0)void pump();
    const rows=(await db.query(`SELECT c.id,c.batch_id,c.ordinal,c.filename,c.status,c.revision,c.checked_by,c.checked_at,c.logbook_id,c.error,c.created_at,c.page_count,c.expected_pages,c.review_note,CASE WHEN c.raw_fields ? '__caliberUtf8JsonV1' THEN c.raw_fields ELSE jsonb_build_object('fleetReview',c.raw_fields->'fleetReview','scanProgress',c.raw_fields->'scanProgress','manualDeletion',c.raw_fields->'manualDeletion') END AS raw_fields,CASE WHEN c.draft ? '__caliberUtf8JsonV1' THEN c.draft ELSE jsonb_build_object('trips',c.draft->'trips') END AS draft,l.book_no,l.site AS saved_site,l.data->'trips' AS saved_trips,l.deleted_at AS logbook_deleted_at FROM mis_scan_cards c LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.book_date>=$$2026-11-01$$ WHERE ${operationalScanSql('c')} AND c.batch_id=$1 AND c.duplicate_of IS NULL AND c.review_note NOT IN('${REMOVED_FROM_BATCH_NOTE}','${EXACT_DUPLICATE_NOTE}') ORDER BY ordinal`,[batch.id])).rows;
    const cards=[],deletedCards=[];
    for(const {raw_fields,draft,saved_site,saved_trips,logbook_deleted_at,...card} of rows){
     const fields=decodeScanJson(raw_fields)||{};
     if(fields.manualDeletion||card.review_note.startsWith('Card deleted manually by user')){deletedCards.push({id:card.id,ordinal:card.ordinal,vehicle:fields.manualDeletion?.vehicle||''});continue;}
     if(saved_site&&!logbook_deleted_at)requireLogBookSite(req.logBookScope,saved_site);
     const fleetReview=fields.fleetReview&&fields.fleetReview.error!=='Your Pulse account is not authorised to sync all four masters.'?fields.fleetReview:null;
     const trips=Array.isArray(saved_trips)?saved_trips:decodeScanJson(draft)?.trips;
     cards.push({...card,raw_fields:{...(fleetReview?{fleetReview}:{}),...(fields.scanProgress?{scanProgress:fields.scanProgress}:{})},trip_total:machineTripTotal(Array.isArray(trips)?trips:[]),validationPending:false,checks:null});
    }
    return {batch:{...batch,deletedCards,openDeletion:await openDeletion(db,batch,req)},cards,duplicates:[],progress:true,storage:{localDrafts,archiveEnabled:Boolean(archiveSavedBatch),target:imageStorage?'hot-blob':archiveTarget,azureUploadEnabled:Boolean(imageStorage)||archiveTarget==='azure'},reader:await readerInfo(db,batch)};
   }finally{db.release();}
  });
  res.set('Cache-Control','no-store').json(payload);
 };
 // The entry list carries every listed entry's trip total from this one query. Until 14 November
 // 2026 the screen asked for each entry's progress separately to add the totals up: with the
 // entries of two weeks that was up to 100 requests at once, which by themselves filled the
 // 10-connection pool every time the list refreshed. The counting is the one sendScanProgress does.
 const scanEntryTripTotals=async(client,batchIds)=>{
  const totals=new Map(batchIds.map(id=>[id,0]));
  if(!batchIds.length)return totals;
  const {rows}=await client.query(`SELECT c.batch_id,c.review_note,CASE WHEN c.raw_fields ? '__caliberUtf8JsonV1' THEN c.raw_fields ELSE jsonb_build_object('manualDeletion',c.raw_fields->'manualDeletion') END AS raw_fields,CASE WHEN c.draft ? '__caliberUtf8JsonV1' THEN c.draft ELSE jsonb_build_object('trips',c.draft->'trips') END AS draft,l.data->'trips' AS saved_trips FROM mis_scan_cards c LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.book_date>=$$2026-11-01$$ WHERE ${operationalScanSql('c')} AND c.batch_id=ANY($1::uuid[]) AND c.duplicate_of IS NULL AND c.review_note NOT IN('${REMOVED_FROM_BATCH_NOTE}','${EXACT_DUPLICATE_NOTE}')`,[batchIds]);
  for(const row of rows){
   const fields=decodeScanJson(row.raw_fields)||{};
   if(fields.manualDeletion||row.review_note.startsWith('Card deleted manually by user'))continue;
   const trips=Array.isArray(row.saved_trips)?row.saved_trips:decodeScanJson(row.draft)?.trips;
   totals.set(row.batch_id,(totals.get(row.batch_id)||0)+machineTripTotal(Array.isArray(trips)?trips:[]));
  }
  return totals;
 };
 // ?cards=id,id limits the full read to the cards the screen saw change, so a
 // card that finishes reading no longer re-validates every other card in the
 // entry. The answer carries partial:true; its batch.deletedCards covers the
 // selected cards only, so the screen keeps the list from its progress poll.
 const selectedScanCards=value=>{
  if(value===undefined)return null;
  const ids=[...new Set(String(value).split(',').filter(Boolean))];
  if(!ids.length||ids.length>SCAN_PARTIAL_REFRESH_MAX||ids.some(id=>!/^[a-f0-9-]{36}$/i.test(id)))fail('Invalid card selection.',400);
  return ids;
 };
 // A full read takes one connection for the whole read: one wait in the pool queue instead of one per
 // query. It no longer works through every card on every read. The duplicate and meter lookups of all
 // cards are read together, and a card's draft fill and checks are reused while nothing they were
 // worked out from has changed (scan-check-memo.mjs). This covers the whole reads the screen still
 // makes while cards are being read; the ?cards= reads above cover the cards it saw change.
 const fillMemo=createScanCheckMemo(),checkMemo=createScanCheckMemo();
 const scanCheckWorld=async client=>{
  if(process.env.MIS_SCAN_CHECK_MEMO==='false')return null;
  // Every change to master_records raises this revision (trigger). Without it (older databases,
  // tests) there is nothing to hold a result against, so every card is worked out on every read.
  let revision=null;try{revision=(await client.query("SELECT revision FROM data_revisions WHERE revision_key='master-data'")).rows[0]?.revision??null;}catch{revision=null;}
  if(revision===null)return null;
  // The half hour keeps a result from outliving the change of day (Asia/Kolkata is UTC+05:30).
  return memoKey(String(revision),await loadEquipmentAliases(client),Math.floor(Date.now()/1800000));
 };
 app.get('/api/scan-batches/:id',...protect,wrap(async(req,res)=>{
  if(req.query.progress==='1')return sendScanProgress(req,res);
  const batch=await getBatch(pool,req.params.id);
  // A whole or partial entry read holds one connection for as long as it runs (every card's fill
  // and checks). The lane keeps these reads to a few connections at a time, so saves, approvals
  // and other screens still find a free one when several entries are opened together.
  const payload=await readLane.run({},async()=>{
  const db=await pool.connect();
  try{
   const only=selectedScanCards(req.query.cards);
   {const earlierSameHash=`FROM mis_scan_cards earlier LEFT JOIN mis_log_books l ON l.id=earlier.logbook_id WHERE ${operationalScanSql('earlier')} AND earlier.image_hash=current.image_hash AND earlier.id<>current.id AND earlier.duplicate_of IS NULL AND earlier.status NOT IN('rejected') AND (earlier.status<>'posted' OR (l.id IS NOT NULL AND l.deleted_at IS NULL)) AND (earlier.created_at<current.created_at OR (earlier.created_at=current.created_at AND earlier.id<current.id))`;await db.query(`UPDATE mis_scan_cards current SET status='rejected',review_note='${EXACT_DUPLICATE_NOTE}',duplicate_of=COALESCE(current.duplicate_of,(SELECT earlier.id ${earlierSameHash} ORDER BY earlier.created_at,earlier.id LIMIT 1)),checked_by=COALESCE(checked_by,'system'),checked_at=COALESCE(checked_at,NOW()),revision=revision+1,error='' WHERE ${operationalScanSql('current')} AND current.batch_id=$1 AND current.status IN('queued','reading','review','approved','error') AND EXISTS(SELECT 1 ${earlierSameHash})`,[batch.id]);}
   const requested=await requestScanBatch(db,batch.id);if(requested.rowCount!==0)void pump();
   const rows=(await db.query(`SELECT c.id,c.batch_id,c.ordinal,c.filename,c.image_hash,c.ocr_text,c.confidence,c.raw_fields,c.draft,c.status,c.revision,c.checked_by,c.checked_at,c.logbook_id,c.error,c.created_at,c.page_count,c.expected_pages,c.review_note,l.book_no,l.data AS saved_data,l.revision AS saved_revision,l.deleted_at AS logbook_deleted_at FROM mis_scan_cards c LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.book_date>=$$2026-11-01$$ WHERE ${operationalScanSql('c')} AND c.batch_id=$1 AND c.duplicate_of IS NULL AND c.review_note NOT IN('${REMOVED_FROM_BATCH_NOTE}','${EXACT_DUPLICATE_NOTE}') AND ($2::text[] IS NULL OR c.id::text=ANY($2::text[])) ORDER BY ordinal`,[batch.id,only])).rows;
   const duplicates=await listDuplicateCards(db,batch.id);
   const cards=[],deletedCards=[],validationClient=scanValidationClient(db);
   for(const row of rows)decodeScanRow(row);
   const removed=row=>row.raw_fields?.manualDeletion||row.review_note.startsWith('Card deleted manually by user');
   const checked=row=>['review','approved','error'].includes(row.status);
   const fillable=row=>batch.kind==='vehicle'&&row.status==='review'&&!row.checked_at;
   const live=rows.filter(row=>!removed(row)&&checked(row)),toFill=rows.filter(row=>!removed(row)&&fillable(row));
   const context=batch.expected_context??null,fillMeters=Boolean(context)&&!isLmvScan(batch);
   const world=live.length?await scanCheckWorld(validationClient):null;
   const duplicateChecks=live.length?await preloadDuplicateChecks(db,batch,live):null;
   const meterSites=toFill.length&&fillMeters?await filterLogBookSites(db,req.logBookScope):null;
   let matchingMasters,meterRows;
   // Earlier meter readings of every vehicle in the entry come from one query, read on first use.
   const readMeterRows=async({assetId,date})=>{
    if(date===context?.bookDate){meterRows??=await preloadVlbOpeningMeterRows(db,toFill.map(row=>row.draft?.assetId).filter(Boolean),date,meterSites);const loaded=meterRows.get(String(assetId));if(loaded)return loaded;}
    return readVlbOpeningMeterRows(db,assetId,date,meterSites);
   };
   const fillDraft=(row,rawKey)=>{
    const questions={records:async({sql,args})=>({rows:(await validationClient.query(sql,args)).rows}),meters:readMeterRows};
    const compute=async ask=>{
     matchingMasters??=scanMastersForBook((await readScanMasters(db,MASTER_NAMES)).rows,batch);
     const matched=matchScanDraft(applyScanContext(batch.expected_context,row.draft),row.raw_fields,batch.kind,matchingMasters);
     const linked={...row.draft};for(const key of ['assetId','employeeId'])if(matched[key]&&!linked[key])linked[key]=matched[key];
     let draft=await fillScanTripEstimates({query:(sql,args)=>ask.records({sql,args})},linked,row.raw_fields);
     if(fillMeters&&(draft.assetId||draft.openingMeterCarryover))draft=await fillVlbScanOpeningMeters(db,draft,{sites:meterSites,extraction:row.raw_fields?.extractionDraft,context:applyScanContext(batch.expected_context,draft),readRows:(client,assetId,date)=>ask.meters({assetId:String(assetId),date})});
     return stableJson(draft)===stableJson(row.draft)?{changed:false}:{changed:true,draft:completeScanTripDetails(draft,row.raw_fields)};
    };
    return world?fillMemo(row.id,memoKey('fill',world,batch.kind,context,meterSites,row.draft,rawKey),questions,compute):compute(questions);
   };
   const checkCard=(row,rawKey)=>{
    const questions={image:()=>duplicateChecks.image(row),content:identity=>duplicateChecks.content(row,identity)};
    const compute=async ask=>{const result=await checkScanCard(validationClient,batch.kind,row,row.draft,{context,duplicates:{image:()=>ask.image(),content:(card,identity)=>ask.content(identity)}});return {errors:result.errors,warnings:result.warnings};};
    return world?checkMemo(row.id,memoKey('check',world,batch.kind,context,row.batch_id,row.page_count,row.expected_pages,row.image_hash,row.created_at,row.draft,rawKey),questions,compute):compute(questions);
   };
   for(const row of rows){
    if(removed(row)){deletedCards.push({id:row.id,ordinal:row.ordinal,vehicle:row.raw_fields?.manualDeletion?.vehicle||''});continue;}
    const rawKey=world&&checked(row)?memoKey(row.raw_fields):'';
    if(fillable(row)){
     const filled=await fillDraft(row,rawKey);
     if(filled.changed){const updated=await db.query("UPDATE mis_scan_cards SET draft=$1::jsonb,revision=revision+1 WHERE id=$2 AND revision=$3 AND status='review' AND checked_at IS NULL RETURNING revision",[JSON.stringify(encodeScanJson(filled.draft)),row.id,row.revision]);if(updated.rows.length){row.draft=filled.draft;row.revision=updated.rows[0].revision;}}
    }
    if(row.saved_data&&!row.logbook_deleted_at)requireLogBookSite(req.logBookScope,row.saved_data.location);
    const check=checked(row)?await checkCard(row,rawKey):{errors:[],warnings:[]};
    if(readPulseFleet&&checked(row)){if(row.raw_fields?.fleetReview?.error==='Your Pulse account is not authorised to sync all four masters.')delete row.raw_fields.fleetReview;const message=scanFleetBlockingMessage(row);if(message==='Pulse equipment site verification pending.'&&batch.kind==='vehicle')row.validationPending=row.status!=='error';else if(message)check.errors.push(message);if(!row.raw_fields?.fleetReview||row.raw_fields.fleetReview.signature!==scanFleetSignature(row.draft))queueFleetCheck(row,req.session.login||req.session.name);}
    cards.push({...publicCard(row),validationPending:Boolean(row.validationPending),checks:row.validationPending?null:{errors:check.errors,warnings:check.warnings}});
   }
   const gateCards=only?(await db.query(`SELECT c.status FROM mis_scan_cards c WHERE ${operationalScanSql('c')} AND c.batch_id=$1 AND c.duplicate_of IS NULL AND c.review_note NOT IN('${REMOVED_FROM_BATCH_NOTE}','${EXACT_DUPLICATE_NOTE}') AND NOT (c.raw_fields ? 'manualDeletion') AND c.review_note NOT LIKE 'Card deleted manually by user%'`,[batch.id])).rows:cards;
   return {batch:{...batch,deletedCards,openDeletion:await openDeletion(db,batch,req)},...(only?{partial:true}:{}),cards:cards.map(card=>matchingPublicCard(card,batch,req.session)).filter(Boolean),duplicates,contextGate:scanContextGate(batch.expected_context,gateCards),storage:{localDrafts,archiveEnabled:Boolean(archiveSavedBatch),target:imageStorage?'hot-blob':archiveTarget,azureUploadEnabled:Boolean(imageStorage)||archiveTarget==='azure'},reader:await readerInfo(db,batch)};
  }finally{db.release();}
  });
  res.set('Cache-Control','no-store').json(payload);
 }));
 const contextGate=async(client,batch)=>scanContextGate(batch.expected_context,(await client.query('SELECT id,ordinal,filename,status,revision,draft,raw_fields FROM mis_scan_cards WHERE batch_id=$1 ORDER BY ordinal FOR UPDATE',[batch.id])).rows.map(decodeScanRow));
 const requireContextReady=async(client,batch,{individualCard=false}={})=>{
  if(batch.kind==='vehicle'&&!batch.expected_context)fail('Choose the card date, site and shift in Scan setup before saving or downloading.',409);
  // Individual VLB saves allow other cards to keep reading. The batch advisory
  // lock protects the selection, and the caller already locks the target card.
  const canSaveDuringReading=individualCard&&batch.kind==='vehicle'&&!isLmvScan(batch);
  const gate=canSaveDuringReading?scanContextGate(batch.expected_context):await contextGate(client,batch);
  if(individualCard?scanCardSaveContextBlocked(gate,batch.kind):gate?.blocked)fail(scanContextError(gate),409);
 };
 app.post('/api/scan-batches/:id/context',...protect,wrap(async(req,res)=>{
  let selected;try{selected=parseScanContext(req.body.expectedContext);delete selected.logBookKind}catch(error){fail(error.message)}
  requireLogBookSite(req.logBookScope,selected.location);
  const c=await pool.connect();try{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.params.id]);
   const batch=await getBatch(c,req.params.id);
   if(batch.expected_context){if(scanContextIssues(batch.expected_context,selected).length)fail('This entry has a different scan selection. Start a new scan entry.',409);}
   else{await c.query('UPDATE mis_scan_batches SET expected_context=$2::jsonb WHERE id=$1',[batch.id,JSON.stringify(selected)]);}
   await c.query('COMMIT');res.json({expectedContext:batch.expected_context||selected});
  }catch(error){await c.query('ROLLBACK');throw error}finally{c.release()}
 }));
 app.post('/api/scan-batches/:id/validate-context',...protect,wrap(async(req,res)=>{
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.params.id]);
   const batch=await getBatch(c,req.params.id),gate=await contextGate(c,batch);if(!gate)fail('This batch has no scan selection.');
   const action=req.body.action;if(!['proceed','discard','cancel'].includes(action))fail('Choose Delete from batch, Cancel or Proceed.');
   if(action!=='cancel'){
    if(gate.context.cancelled)fail('This batch was cancelled. Start a new batch.',409);
    if(gate.waiting&&(action!=='proceed'||batch.kind!=='vehicle'||isLmvScan(batch)))fail('Wait until all cards have been read.',409);
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
 app.post('/api/scan-batches/:id/cards',...protect,rawBody({type:SCAN_IMAGE_TYPES,limit:12000000}),wrap(async(req,res)=>{const batch=await getBatch(pool,req.params.id);if(batch.kind==='vehicle'&&!batch.expected_context)fail('Enter the card date, site and marked shift in a new batch before uploading.',400);const binary=Buffer.isBuffer(req.body);let payload=req.body;if(binary){try{payload=JSON.parse(decodeURIComponent(req.get('X-Scan-Metadata')||''));}catch{fail('Invalid scan metadata.');}if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('Invalid scan metadata.');}const {base64,filename,uploadKey}=payload,entrySource=['scan','upload'].includes(payload.entrySource)?payload.entrySource:null;const pageCount=payload.pageCount||1,expectedPages=payload.expectedPages||1;if(![1,2].includes(pageCount)||![1,2].includes(expectedPages))fail('Invalid pages per card.');if(!uuid(uploadKey))fail('Invalid upload reference.');const requestedOrdinal=payload.ordinal;if(requestedOrdinal!==undefined&&(!Number.isInteger(requestedOrdinal)||requestedOrdinal<1||requestedOrdinal>100000))fail('Invalid card order.');if(!binary&&(typeof base64!=='string'||base64.length>16000000||(base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))))fail('Upload a PNG, JPEG or WebP scan up to 12 MB.');const image=binary?req.body:Buffer.from(base64,'base64');try{scanImageDimensions(image);}catch(error){fail(error.message);}const imageHash=createHash('sha256').update(image).digest('hex');const captureTiming=payload.captureTiming===undefined?null:parseCaptureTiming(payload.captureTiming);if(payload.captureTiming!==undefined&&!captureTiming)fail('Invalid scan timing.');const paddleEvidence=payload.paddleEvidence?validatePaddleEvidence(payload.paddleEvidence,image):null;const fingerprintSettings=scanFingerprintSettings(),fingerprint=await fingerprintForUpload(image);const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[batch.id]);await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[imageHash]);if(batch.expected_context?.bookDate)await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['scan-duplicates:'+batch.kind+'|'+batch.expected_context.bookDate+'|'+String(batch.expected_context.location||'').trim().toLowerCase()+'|'+(batch.expected_context.cardShift||'')]);await c.query('SELECT pg_advisory_xact_lock_shared(709224102)');await getBatch(c,batch.id);const previous=(await c.query('SELECT id FROM mis_scan_cards WHERE id=$1 AND batch_id=$2',[uploadKey,batch.id])).rows[0];if(previous){const decided=(await c.query('SELECT duplicate_of,raw_fields FROM mis_scan_cards WHERE id=$1',[previous.id])).rows[0];await c.query('COMMIT');if(decided)decodeScanRow(decided);return res.json(decided?.duplicate_of?{id:previous.id,duplicateSkipped:true,original:decided.raw_fields?.duplicate?.original||{cardId:decided.duplicate_of}}:{id:previous.id})}
 // Duplicate decision: exact bytes first, then the visual fingerprint against live cards for this date, site and shift. A duplicate keeps its slot as a rejected row (never read) so the operator can compare both scans and restore it.
 const exact=await findExactDuplicate(c,imageHash);const visual=exact?null:await findVisualDuplicate(c,batch,fingerprint,fingerprintSettings);const skipped=exact?{original:{cardId:exact.id,batchId:exact.batch_id,entryName:exact.batch_name||null,ordinal:exact.ordinal,bookNo:exact.book_no||null},reason:'exact',distance:null}:visual?.match==='duplicate'?{original:visual.original,reason:'fingerprint',distance:visual.distance}:null;
 const duplicatePdfPreflight=entrySource==='upload'&&/\.pdf\s*·\s*page 1\b/i.test(String(filename||''));
 if(entrySource==='upload'&&payload.resumeInEntry===true&&exact?.batch_id===batch.id){
  await c.query('COMMIT');
  return res.json({id:exact.id,existingCardId:exact.id,duplicateSkipped:true,original:skipped.original});
 }
 if(skipped&&(payload.rejectDuplicatePdf===true||duplicatePdfPreflight)){const source=skipped.original.bookNo||skipped.original.entryName||'an earlier scan entry';fail(`This PDF was already uploaded. Its first card matches ${source}. The PDF upload was cancelled before the remaining cards were sent.`,409);}
 const allocation=(await c.query('SELECT count(*) AS n,(SELECT COALESCE(MAX(ordinal),0) FROM mis_scan_cards WHERE batch_id=$1) AS last_ordinal FROM mis_scan_cards WHERE batch_id=$1 AND duplicate_of IS NULL',[batch.id])).rows[0];const n=Number(allocation.n),ordinal=requestedOrdinal??Number(allocation.last_ordinal??allocation.n)+1;if(!skipped)requireScanEntrySpace(n);if(requestedOrdinal!==undefined&&(await c.query('SELECT 1 FROM mis_scan_cards WHERE batch_id=$1 AND ordinal=$2',[batch.id,ordinal])).rowCount)fail('Card order conflict. Retry the upload.',409);if(batch.expected_context){if(batch.expected_context.cancelled)fail('This batch was cancelled.',409);if(!skipped)await c.query("UPDATE mis_scan_batches SET expected_context=expected_context||'{\"confirmed\":false}'::jsonb WHERE id=$1",[batch.id]);}if(imageStorage)await c.query('SELECT pg_advisory_xact_lock_shared(709224103,hashtext($1))',[scanBlobKey(batch.kind,batch.id,uploadKey,image)]);const blob=imageStorage?await imageStorage.put({id:uploadKey,batchId:batch.id,kind:batch.kind,image}):null;
 if(skipped){await insertDuplicateCard(c,{id:uploadKey,batch,ordinal,filename,image,imageHash,pageCount,expectedPages,fingerprint,blob,original:skipped.original,reason:skipped.reason,distance:skipped.distance});await c.query('COMMIT');return res.json({id:uploadKey,duplicateSkipped:true,reason:skipped.reason,original:skipped.original});}
 const suspect=visual?.match==='suspect'?{...visual.original,distance:visual.distance}:null;
 await c.query('INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,page_count,expected_pages,raw_fields,image_blob_key,image_bytes,blob_uploaded_at,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb)',[uploadKey,batch.id,ordinal,String(filename||'Scan').slice(0,240),blob?null:image,imageHash,pageCount,expectedPages,JSON.stringify({...(entrySource?{entrySource}:{}),...(paddleEvidence?{paddleEvidence}:{}),...(captureTiming?{captureTiming}:{}),...(suspect?{duplicateSuspect:suspect}:{})}),blob?.key||null,blob?.bytes||null,blob?.uploadedAt||null,fingerprint?JSON.stringify(fingerprint):null]);await c.query('COMMIT');res.status(201).json({id:uploadKey,...(suspect?{duplicateSuspect:suspect}:{})});}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}void pump();}));
 // The preview is read for every card opened in review. One round trip reads the card's
 // image columns and its batch together, without the OCR text, raw fields and draft that
 // getCard carries; the deletion, batch and operational-date checks are the same as getCard's.
 const getCardImage=async(client,id)=>{
  if(!uuid(id))fail('Invalid scan card.');
  const tag='__caliberUtf8JsonV1',image=imageStorage?"CASE WHEN NULLIF(c.image_blob_key,'') IS NULL THEN c.image END":'c.image';
  const row=(await client.query(`SELECT c.id,c.batch_id,c.image_hash,c.image_blob_key,c.created_at,${image} AS image,CASE WHEN c.raw_fields ? '${tag}' THEN c.raw_fields ELSE jsonb_strip_nulls(jsonb_build_object('manualDeletion',c.raw_fields->'manualDeletion','fleetRejection',c.raw_fields->'fleetRejection')) END AS raw_fields,CASE WHEN c.draft ? '${tag}' THEN c.draft ELSE jsonb_strip_nulls(jsonb_build_object('bookDate',c.draft->'bookDate')) END AS draft,to_jsonb(b)->'expected_context' AS batch_context,b.created_at AS batch_created_at FROM mis_scan_cards c LEFT JOIN mis_scan_batches b ON b.id=c.batch_id WHERE c.id=$1`,[id])).rows[0];
  if(!row)fail('Card not found.',404);
  decodeScanRow(row);
  const context=row.batch_context;
  if(!row.batch_created_at||context?.deletedVlbBatch||context?.deletedScanEntry)fail('Batch not found or deleted.',404);
  requireOperationalDate(context?.bookDate||new Date(row.batch_created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}));
  requireOperationalDate(context?.bookDate||row.draft?.bookDate||new Date(row.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}));
  return row;
 };
 app.get('/api/scan-cards/:id/image',...protect,wrap(async(req,res)=>{const row=await getCardImage(pool,req.params.id);if(row.raw_fields?.manualDeletion)fail('This card was deleted and its scan is no longer available.',410);if(row.raw_fields?.fleetRejection)fail(row.raw_fields.fleetRejection.message,410);const card=imageStorage?await imageStorage.hydrate(row):row;res.set('Cache-Control','no-store').type(scanImageMime(card.image)).send(card.image);}));
 app.put('/api/scan-cards/:id',...protect,wrap(async(req,res)=>{if(req.body.action==='approve')await requireFleet(await getCard(pool,req.params.id),ignoreScanLoadingWithoutEquipment(req.body.draft),req.session.login||req.session.name);const c=await pool.connect();try{await c.query('BEGIN');const card=await getCard(c,req.params.id,true),batch=await getBatch(c,card.batch_id);if(['queued','reading','posted'].includes(card.status))fail('This card cannot be changed in its current state.',409);if(req.body.revision!==card.revision)fail('Card changed. Reload before saving.',409);if(req.body.action==='reject'){
 await c.query("UPDATE mis_scan_cards SET status='rejected',revision=revision+1,checked_by=$2,checked_at=NOW(),review_note='Rejected manually by user',error='' WHERE id=$1",[card.id,req.session.login||req.session.name]);
 await c.query('COMMIT');return res.json({status:'rejected',revision:card.revision+1,checks:{errors:[],warnings:[]}});
 }if(!req.body.draft||typeof req.body.draft!=='object'||Array.isArray(req.body.draft))fail('Invalid card form.');const action=req.body.action||'save';let draft={...(batch.kind==='vehicle'?ignoreScanLoadingWithoutEquipment(req.body.draft):req.body.draft),...(action==='approve'&&req.body.checked===true?{meterReviewFields:[],extractionReviewFields:[]}: {})};if(batch.kind==='vehicle'&&card.raw_fields?.tripLocationRuleVersion===1)draft.location=tripCardLocation(draft.location);draft=await applyBatchContext(c,batch.expected_context,draft);
 if(batch.kind==='vehicle'&&batch.expected_context&&!isLmvScan(batch)){
  const extraction={...card.raw_fields?.extractionDraft};
  for(const field of ['openingKmr','openingHmr']){
   if(String(draft[field]??'')!==String(card.draft[field]??''))delete extraction[field];
  }
  draft=await fillVlbScanOpeningMeters(c,draft,{sites:await filterLogBookSites(c,req.logBookScope),extraction});
 }
 const check=await checkScanCard(c,batch.kind,card,draft);if(!['save','approve','reject'].includes(action))fail('Invalid review action.');if(action==='approve'){if(batch.kind==='vehicle'&&!batch.expected_context)fail('Choose the card date, site and shift in Scan setup before approving.',409);if(check.errors.length)fail(check.errors.join(' '));if(req.body.checked!==true)fail('Confirm that every field and trip row has been checked against the scan.');if(batch.kind==='vehicle'&&!scanTripsOptional(check.data?.door)&&!(draft.trips||[]).length&&req.body.noTripsConfirmed!==true)fail('Add trip rows or confirm that this card contains no trips.');}
 const meterCorrectionHistory=recordMeterCorrection(card.raw_fields?.meterCorrectionHistory,card.draft,draft,batch.kind,req.session.login||req.session.name);const next=action==='approve'?'approved':action==='reject'?'rejected':'review';await c.query('UPDATE mis_scan_cards SET draft=$1::jsonb,status=$2,revision=revision+1,checked_by=$3,checked_at=$4,error=\'\',raw_fields=(raw_fields||jsonb_build_object(\'meterCorrectionHistory\',$6::jsonb))-CASE WHEN $7::boolean THEN ARRAY[\'fleetBlock\'] ELSE ARRAY[]::text[] END WHERE id=$5',[JSON.stringify(encodeScanJson(draft)),next,action==='approve'?(req.session.login||req.session.name):null,action==='approve'?new Date():null,card.id,JSON.stringify(encodeScanJson(meterCorrectionHistory)),Boolean(action==='save'&&card.raw_fields?.fleetRestoration&&card.raw_fields?.fleetBlock)]);await c.query('COMMIT');res.json({status:next,revision:card.revision+1,...(batch.kind==='vehicle'&&!isLmvScan(batch)?{draft}:{}),checks:{errors:check.errors,warnings:check.warnings}});if(readPulseFleet&&action==='save')void getCard(pool,card.id).then(row=>queueFleetCheck(row,req.session.login||req.session.name)).catch(()=>{});}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}));
 const archiveBatch=async batch=>{if(!archiveSavedBatch)return {status:'disabled',azureUploadEnabled:false};const legacy=(await pool.query(`SELECT c.*,l.book_no FROM mis_scan_cards c LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.book_date>=$$2026-11-01$$ WHERE ${operationalScanSql('c')} AND c.batch_id=$1 AND NULLIF(c.image_blob_key,'') IS NULL ORDER BY c.ordinal`,[batch.id])).rows.map(decodeScanRow);if(!legacy.length)return {status:'saved',target:'hot-blob',azureUploadEnabled:true,folders:[]};return archiveSavedBatch(batch,legacy);};
 // A refused automatic save answers 409 to the browser; it is also written to the
 // server log so support can see why a card stayed unsaved without a screen recording.
 const logAutoSaveRefusal=fn=>async(req,res)=>{try{await fn(req,res)}catch(e){if(e?.status)console.warn('[scan] automatic save refused for card '+req.params.id+' by '+(req.session?.login||req.session?.name||'?')+': '+e.message);throw e}};
 app.post('/api/scan-cards/:id/auto-save',...protect,wrap(logAutoSaveRefusal(async(req,res)=>{
  if(!Number.isSafeInteger(req.body.revision))fail('Reload the card before automatic saving.',409);
  const initial=await getCard(pool,req.params.id);if(initial.raw_fields?.fleetRestoration&&initial.raw_fields?.fleetBlock)fail('Review this restored card and save corrections before automatic saving.',409);await requireFleet(initial,initial.draft,req.session.login||req.session.name);
  // Pulse is read before any lock; inside the transaction the saved feed answers without a remote call.
  const actor=req.session.login||req.session.name,prefetched=await prefetchAutoSaveBreakdownRows(actor),issueMasters=await readScanIssueMasters();const c=await pool.connect();let batch,record;
  try{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock_shared(709224102)');await c.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))',[initial.batch_id]);
   batch=await getBatch(c,initial.batch_id);const card=await getCard(c,initial.id,true);
   if(card.status==='posted'){record=(await c.query('SELECT id,book_no,data FROM mis_log_books WHERE id=$1 AND deleted_at IS NULL',[card.logbook_id])).rows[0];if(!record)fail('The saved log book is unavailable. Reload this batch.',409);}
   else{
    await requireContextReady(c,batch,{individualCard:true});
    if(card.revision!==req.body.revision)fail('Card changed. Reload before automatic saving.',409);
    card.draft=await applyBatchContext(c,batch.expected_context,card.draft);
    requireLogBookSite(req.logBookScope,card.draft.location);
    const check=await checkScanCard(c,batch.kind,card,undefined,{enforceEmployeeSite:req.logBookScope.sites!==null});
    const issueOptions=await scanIssueOptions(c,batch,issueMasters);
    if(!canAutoSaveScanCard({...card,checks:check},batch.kind,issueOptions,isLmvScan(batch)))fail('Correct the card before saving: '+[...new Set([...check.errors,...check.warnings,...Object.values(manualScanIssues(card.draft,batch.kind,card.raw_fields,issueOptions,isLmvScan(batch)))])].join(' '),409);
    const data={...check.data,meterCorrectionHistory:card.raw_fields?.meterCorrectionHistory||[],scanCardNumber:check.number||null,scanCardId:card.id,scanBatchId:batch.id,scanEntrySource:card.raw_fields?.entrySource||undefined,scanSaveMode:'automatic-validation',autoSavedBy:actor,autoSavedAt:new Date().toISOString()};
    await applyBreakdownHours(data,{readHours:lockedReadHours(input=>readHours({...input,client:c}),prefetched),actor});
    if(data.breakdownHours===null)fail('Pulse BD hours unavailable. Enter BD hours manually to finish automatic saving.',409);
    record=await insertLogBook(c,scanBookKind(batch),data,card.id,actor);
    await c.query("UPDATE mis_scan_cards SET status='posted',logbook_id=$1,revision=revision+1,checked_by=$2,checked_at=NOW(),draft=$4::jsonb WHERE id=$3",[record.id,actor,card.id,JSON.stringify(encodeScanJson({...card.draft,scanSaveMode:'automatic-validation',meterReviewFields:[],extractionReviewFields:[]}))]);
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');if(e.code==='23505')fail('Duplicate card detected. This card was not saved.',409);throw e}finally{c.release()}
  let archive=null;
  const remaining=(await pool.query("SELECT id FROM mis_scan_cards WHERE batch_id=$1 AND status<>'posted' AND review_note<>$2 LIMIT 1",[batch.id,'Removed from batch: wrong date, site or shift'])).rows.length;
  if(!remaining){try{archive=await archiveBatch(batch);}catch{archive={status:'pending',target:archiveTarget||'local',azureUploadEnabled:archiveTarget==='azure',message:'The log book was saved. Folder archiving needs a retry.'};}}
  res.json({status:'posted',record,archive});
 })));
 app.post('/api/scan-batches/:id/archive',...protect,wrap(async(req,res)=>{if(!archiveSavedBatch)fail('Local folder archiving is not enabled.',409);const batch=await getBatch(pool,req.params.id);res.json(await archiveBatch(batch));}));
 app.post('/api/scan-batches/:id/post',...protect,wrap(async(req,res)=>{const ids=req.body.cards;if(!Array.isArray(ids)||!ids.length||ids.length>120||ids.some(v=>!uuid(v.id)||!Number.isSafeInteger(v.revision))||new Set(ids.map(v=>v.id)).size!==ids.length)fail('Select approved cards to save.');
 const fleetBySite=new Map();
 const readBatchFleet=(actor,site,options)=>{
  if(!fleetBySite.has(site))fleetBySite.set(site,readPulseFleet(actor,site,options));
  return fleetBySite.get(site);
 };
 for(const selected of ids){const card=await getCard(pool,selected.id);if(card.batch_id!==req.params.id)fail('Card belongs to another batch.',400);await requireFleet(card,card.draft,req.session.login||req.session.name,readBatchFleet);}const actor=req.session.login||req.session.name,prefetched=await prefetchBreakdownRows(readBreakdownRows,actor);const c=await pool.connect();let batch;const results=[],newRecordIds=[];try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock_shared(709224102)');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.params.id]);batch=await getBatch(c,req.params.id);await requireContextReady(c,batch);const all=(await c.query('SELECT id,status,checked_by FROM mis_scan_cards WHERE batch_id=$1 AND review_note<>\'Removed from batch: wrong date, site or shift\' ORDER BY ordinal FOR UPDATE',[batch.id])).rows;if(all.length!==ids.length||all.some(row=>!ids.some(v=>v.id===row.id)))fail('Save all requires every card in this batch. No cards were saved.',409);if(all.some(row=>!['approved','posted'].includes(row.status)||(row.status==='approved'&&!row.checked_by)))fail('Resolve all brown/red cards and approve every card before saving the batch.',409);for(const item of ids){const card=await getCard(c,item.id,true);if(card.batch_id!==batch.id)fail('Card belongs to a different batch.');if(card.status==='posted'){const existing=(await c.query('SELECT id,book_no FROM mis_log_books WHERE id=$1',[card.logbook_id])).rows[0];results.push(existing);continue}if(card.status!=='approved'||card.revision!==item.revision||!card.checked_by)fail('An approved card has changed. Reload and check it again.',409);card.draft=await applyBatchContext(c,batch.expected_context,card.draft);requireLogBookSite(req.logBookScope,card.draft.location);const check=await checkScanCard(c,batch.kind,card,undefined,{enforceEmployeeSite:req.logBookScope.sites!==null});if(check.errors.length)fail(`Card ${card.ordinal}: ${check.errors.join(' ')}`,409);const data={...check.data,meterCorrectionHistory:card.raw_fields?.meterCorrectionHistory||[],scanCardNumber:check.number||null,scanCardId:card.id,scanBatchId:batch.id,scanEntrySource:card.raw_fields?.entrySource||undefined,reviewedBy:card.checked_by,reviewedAt:card.checked_at};await applyBreakdownHours(data,{readHours:lockedReadHours(input=>readHours({...input,client:c}),prefetched),actor});const log=await insertLogBook(c,scanBookKind(batch),data,card.id,req.session.login||req.session.name,{relock:false});await c.query("UPDATE mis_scan_cards SET status='posted',logbook_id=$1,revision=revision+1 WHERE id=$2",[log.id,card.id]);results.push({id:log.id,book_no:log.book_no});newRecordIds.push(log.id);}await lockSavedVlbBatches(c,req.session.login||req.session.name,newRecordIds);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');if(e.code==='23505')fail('Duplicate card detected. No cards in this save were posted.',409);throw e}finally{c.release()}
 // Archiving reads through the pool. Return the transaction connection before checking the archive.
 let archive;try{archive=await archiveBatch(batch);}catch{archive={status:'pending',target:archiveTarget||'local',azureUploadEnabled:archiveTarget==='azure',message:'Log books were saved, but folder archiving needs a retry.'};}
 res.json({records:results,count:results.length,archive});}));
 app.post('/api/scan-batches/:id/reextract',...protect,wrap(async(req,res)=>{await getBatch(pool,req.params.id);const r=await pool.query("UPDATE mis_scan_cards SET raw_fields=raw_fields||jsonb_build_object('reextractPrevious',draft,'scanQueueOrigin','user'),status='queued',revision=revision+1,error='' WHERE batch_id=$1 AND status IN('review','error') AND checked_by IS NULL RETURNING id",[req.params.id]);res.json({queued:r.rowCount});void pump();}));
 // Card status tile → right-click → "Reject all cards in this group". The reviewer then enters those
 // cards by hand, so the rest of the batch can lock. Each card is checked for batch, state and revision;
 // a stale or saved card fails the whole request so nothing is rejected behind the reviewer's back.
 app.post('/api/scan-batches/:id/reject-group',...protect,wrap(async(req,res)=>{
  const group=String(req.body?.group||'').trim(),requested=Array.isArray(req.body?.cards)?req.body.cards:[];
  if(!group||!requested.length)fail('Choose a card status group with at least one card to reject.');
  if(requested.some(row=>!row||typeof row.id!=='string'||!Number.isInteger(row.revision)))fail('Each card needs an id and revision.');
  const c=await pool.connect();try{await c.query('BEGIN');const batch=await getBatch(c,req.params.id);
   const ids=requested.map(row=>row.id);const {rows}=await c.query('SELECT id,status,revision FROM mis_scan_cards WHERE batch_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE',[batch.id,ids]);
   if(rows.length!==ids.length)fail('Some cards are not in this batch. Reload and try again.',409);
   for(const row of rows){const wanted=requested.find(item=>item.id===row.id);if(row.status==='posted')fail('A card in this group is already saved to the log book. Reload and try again.',409);if(row.status==='rejected')continue;if(wanted.revision!==row.revision)fail('A card in this group changed. Reload before rejecting.',409);}
   const pending=rows.filter(row=>row.status!=='rejected').map(row=>row.id);const note='Rejected with group "'+group+'" for manual entry';
   if(pending.length)await c.query("UPDATE mis_scan_cards SET status='rejected',revision=revision+1,checked_by=$2,checked_at=NOW(),review_note=$3,error='' WHERE id=ANY($1::uuid[])",[pending,req.session.login||req.session.name,note]);
   const remaining=Number((await c.query("SELECT count(*) AS n FROM mis_scan_cards WHERE batch_id=$1 AND status NOT IN('rejected','posted')",[batch.id])).rows[0].n);
   await c.query('COMMIT');res.json({rejected:pending.length,remaining});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
 }));
 app.post('/api/scan-batches/:id/abort',...protect,wrap(async(req,res)=>{await getBatch(pool,req.params.id);const r=await pool.query("UPDATE mis_scan_cards SET status='rejected',error='Scanning cancelled by user.',revision=revision+1 WHERE batch_id=$1 AND status IN('queued','reading') RETURNING id",[req.params.id]);res.json({cancelled:r.rowCount});}));
 app.post('/api/scan-cards/:id/restore-duplicate',...protect,wrap(async(req,res)=>{const c=await pool.connect();try{await c.query('BEGIN');const card=await getCard(c,req.params.id,true);const batch=await getBatch(c,card.batch_id);if(batch.expected_context?.cancelled)fail('This batch was cancelled.',409);const revision=await restoreDuplicateCard(c,card,req.session.login||req.session.name);if(batch.expected_context)await c.query("UPDATE mis_scan_batches SET expected_context=expected_context||'{\"confirmed\":false}'::jsonb WHERE id=$1",[batch.id]);await c.query('COMMIT');res.json({restored:true,revision});}catch(error){await c.query('ROLLBACK');throw error}finally{c.release()}void pump();}));
 app.post('/api/scan-cards/:id/retry',...protect,wrap(async(req,res)=>{const card=await getCard(pool,req.params.id);if(card.status!=='error')fail('Only failed OCR cards can be retried.');await pool.query("UPDATE mis_scan_cards SET status='queued',raw_fields=raw_fields||jsonb_build_object('scanQueueOrigin','user'),error='',revision=revision+1 WHERE id=$1 AND status='error'",[card.id]);res.json({queued:true});void pump();}));
 // Reader outage (rules/scan-reader-outage.mjs): the reading account failed,
 // not the card. The card returns to the queue, this lane stops, and one card
 // is tried every outageProbeMs until Google answers again.
 let knownOutages=[];
 async function holdForOutage(lane,card,outage){
  await pool.query("UPDATE mis_scan_cards SET status='queued',read_lease_owner=NULL,read_lease_until=NULL,raw_fields=raw_fields-'scanProgress' WHERE id=$1 AND status='reading' AND raw_fields->>'scanReadToken'=$2",[card.id,card.raw_fields.scanReadToken]);
  if(!lane.outage)console.error(`Scan reading paused (${lane.name||'all sites'}): ${outage.reason}, HTTP ${outage.status}. Cards stay in the queue; one card is tried every ${Math.round(outageProbeMs/1000)} s.`);
  lane.outage={...outage,since:lane.outage?.since||new Date().toISOString(),retryAt:Date.now()+outageProbeMs};
  try{await noteReaderOutage(pool,lane.name,outage,processLeaseOwner);}catch(error){console.error('Scan reader outage not recorded:',error?.code||error?.message||'Error');}
  if(role==='app')void watchOutages();
 }
 // Google answered: lift the hold and queue again the cards that an earlier
 // version marked failed for the same account reason. Checked on the first
 // answer after a start as well, so an outage that ended while this process
 // was down is cleared too.
 async function readerAnswered(lane){
  if(lane.readerAnswered&&!lane.outage)return;
  const recovered=Boolean(lane.outage);lane.readerAnswered=true;lane.outage=null;
  try{
   await clearReaderOutage(pool,lane.name);const again=await requeueOutageFailures(pool);
   if(recovered||again.rowCount)console.log(`Scan reading ${recovered?'resumed':'confirmed'} (${lane.name||'all sites'}); ${again.rowCount} card(s) that failed for an account reason are queued again.`);
   if(again.rowCount)setTimeout(()=>void pump(),0);
  }catch(error){console.error('Scan reader recovery not recorded:',error?.code||error?.message||'Error');}
  if(role==='app'&&recovered)void watchOutages();
 }
 const readerInfo=async(client,batch)=>{
  if(!geminiEnabled(process.env))return null;
  let outage=null;try{outage=await readerOutageFor(client,batch.expected_context?.location);}catch{}
  return {provider:'gemini',model:MODEL,...(outage?{outage}:{})};
 };
 // Pulse-II keeps the list for /api/health and tells the administrators once per outage.
 async function watchOutages(){
  try{
   knownOutages=await liveReaderOutages(pool);
   if(alertAdministrators&&knownOutages.length)for(const outage of await claimOutageAlerts(pool))await alertAdministrators(readerOutageAlert(outage),outage);
  }catch(error){console.error('Scan reader outage watch failed:',error?.code||error?.message||'Error');}
 }
 async function readQueuedCards(lane=singleLane){const ocr=lane.ocr;let current;try{while(!stopped){if(current)activeReads.delete(String(current.id));current=(await claimNextScanCard(pool,{batchIds:lane.batchIds})).rows[0];if(!current)break;activeReads.add(String(current.id));decodeScanRow(current);const timing={claimedAt:Date.now()};try{if(imageStorage)await imageStorage.hydrate(current);const batch=await getBatch(pool,current.batch_id);if(process.env.MIS_LOCAL_SCANNER_DATABASE==='true'&&String(batch.created_by).startsWith('pc-scanner:')){await pool.query("UPDATE mis_scan_cards SET status='review',raw_fields=raw_fields||'{\"connectorCaptureOnly\":true}'::jsonb,revision=revision+1 WHERE id=$1 AND status='reading' AND raw_fields->>'scanReadToken'=$2",[current.id,current.raw_fields.scanReadToken]);continue;}const result=!geminiEnabled(process.env)&&current.raw_fields?.paddleEvidence?paddleEvidenceResult(current.raw_fields.paddleEvidence,current.image,batch.kind):await readScanWithRecovery(options=>ocr.recognize(current.image,{...options,kind:batch.kind,onProgress:async (stage,details={})=>{await pool.query("UPDATE mis_scan_cards SET raw_fields=raw_fields||jsonb_build_object('scanProgress',$1::jsonb),revision=revision+1 WHERE id=$2 AND status='reading' AND raw_fields->>'scanReadToken'=$3",[JSON.stringify({stage,provider:'gemini',...details}),current.id,current.raw_fields.scanReadToken]);}}),async()=>{const active=await pool.query("SELECT id FROM mis_scan_cards WHERE id=$1 AND status='reading' AND raw_fields->>'scanReadToken'=$2",[current.id,current.raw_fields.scanReadToken]);return active.rows.length>0;});timing.firstReadAt=Date.now();await readerAnswered(lane);const masters=scanMastersForBook((await readScanMasters(pool,MASTER_NAMES)).rows,batch);const equipmentMasters=masters.filter(r=>r.master_name==='Equipment master'),withAliases=await withEquipmentAliases(pool,equipmentMasters.map(r=>({...r.record_data,id:String(r.id)})));equipmentMasters.forEach((r,i)=>{const a=withAliases[i];if(a?.cardAliases||a?.cardRuleAliases)r.record_data={...r.record_data,...(a.cardAliases?{cardAliases:a.cardAliases}:{}),...(a.cardRuleAliases?{cardRuleAliases:a.cardRuleAliases}:{})};});const extracted=await recoverFirstScanFields({kind:batch.kind,extracted:extractScanResult(result,batch.kind,masters),context:batch.expected_context||{},allowMissingSite:Boolean(result.provider),alreadyRetried:Boolean(result.firstScanReadRecovery),readAgain:options=>current.raw_fields?.paddleEvidence&&!geminiEnabled(process.env)?Promise.reject(Error('Retained PC evidence requires local OCR review')):ocr.recognize(current.image,{kind:batch.kind,...options}),extract:retry=>extractScanResult(retry,batch.kind,masters),onProgress:async(stage,details)=>{const active=await pool.query("UPDATE mis_scan_cards SET raw_fields=raw_fields||jsonb_build_object('scanProgress',$1::jsonb) WHERE id=$2 AND status='reading' AND raw_fields->>'scanReadToken'=$3 RETURNING id",[JSON.stringify({stage,...details}),current.id,current.raw_fields.scanReadToken]);return active.rows.length>0;}});timing.recheckedAt=Date.now();extracted.raw.scanReadToken=current.raw_fields.scanReadToken;if(current.raw_fields?.scanQueueOrigin)extracted.raw.scanQueueOrigin=current.raw_fields.scanQueueOrigin;if(current.raw_fields?.equipmentNumberRecoveryVersion)extracted.raw.equipmentNumberRecoveryVersion=current.raw_fields.equipmentNumberRecoveryVersion;if(current.raw_fields?.captureTiming)extracted.raw.captureTiming=current.raw_fields.captureTiming;if(batch.kind==='vehicle')extracted.draft=normalizeScanEquipmentRows(extracted.draft,scanEquipmentMasters(masters));const detectionDraft=extracted.draft;const baseline=current.raw_fields?.extractionDraft||{};if(!current.raw_fields?.extractionDraft){const p=current.raw_fields?.reextractPrevious||{};for(const k of ['openingKmr','closingKmr','openingHmr','closingHmr'])if(p[k]===current.raw_fields?.meterReadings?.[k]?.value)baseline[k]=p[k];if(p.location===current.raw_fields?.location)baseline.location=p.location;if(p.aFormNo===current.raw_fields?.cardNo)baseline.aFormNo=p.aFormNo;}if(current.raw_fields?.reextractPrevious)extracted.draft=mergeReextractedDraft(current.raw_fields.reextractPrevious,baseline,extracted.draft);extracted.draft=await applyBatchContext(pool,batch.expected_context,extracted.draft);if(batch.kind==='vehicle')extracted.draft=matchScanDraft(extracted.draft,extracted.raw,batch.kind,masters);if(batch.kind==='vehicle')extracted.draft=completeScanTripDetails(await fillScanTripEstimates(pool,completeScanTripDetails(extracted.draft,extracted.raw),extracted.raw),extracted.raw);if(result.provider==='paddleocr'&&result.pages)extracted.raw.paddleEvidence=createPaddleEvidence(result,current.image);extracted.raw.extractionDraft=detectionDraft;extracted.raw.scanTiming=scanReadTiming(current.created_at,timing,Date.now(),{workers:lane.workers,engine:role==='engine'});if(current.raw_fields?.meterCorrectionHistory)extracted.raw.meterCorrectionHistory=current.raw_fields.meterCorrectionHistory;const completed=await pool.query("UPDATE mis_scan_cards SET status='review',ocr_text=$1,confidence=$2,raw_fields=$3::jsonb,draft=$4::jsonb,revision=revision+1,error='' WHERE id=$5 AND status='reading' AND raw_fields->>'scanReadToken'=$6 RETURNING id",[encodeScanText(String(result.text||'').slice(0,100000)),Number.isFinite(result.confidence)?result.confidence:null,JSON.stringify(encodeScanJson(extracted.raw)),JSON.stringify(encodeScanJson(extracted.draft)),current.id,current.raw_fields.scanReadToken]);if(!completed.rows.length)continue;readTotal++;const readCard=await getCard(pool,current.id);if(contentRejectEnabled()&&await applyContentDuplicate(pool,batch.kind,readCard,batch))continue;if(readPulseFleet)queueFleetCheck(readCard,batch.created_by);}catch(ocrError){const outage=readerOutage(ocrError);if(!outage||!lane.outage)console.error('Local card OCR failed:',ocrError?.message||String(ocrError),outage?.detail?'Google: '+outage.detail:'');if(outage){await holdForOutage(lane,current,outage);break;}await pool.query("UPDATE mis_scan_cards SET status='error',error=$2,revision=revision+1 WHERE id=$1 AND status='reading' AND raw_fields->>'scanReadToken'=$3",[current.id,(ocrError?.status===409||['groq','gemini-hybrid','gemini'].includes(ocrError?.provider))?String(ocrError.message).slice(0,500):'OCR could not read this scan. Retry OCR or enter the card manually.',current.raw_fields.scanReadToken]);}}}catch(e){console.error('Scan queue failed:',e?.code||e?.name||'Error');}finally{if(current)activeReads.delete(String(current.id));}}
 // Which lanes read here, and from which batches. Without lanes or engines
 // this is the single shared queue of before (batchIds null = any batch).
 async function lanesWithWork(){
  if(role==='app'&&!scanLanes&&!enginesExternal)return [singleLane];
  let grouped=groupBatchesByLane(await queuedScanBatches(pool));
  if(role==='engine'){const self={site_lane:engineLane??'*',excluded_lanes:engineExcluded};grouped=new Map([...grouped].filter(([lane])=>engineCovers(self,lane)));}
  else if(enginesExternal){
   // Sites whose engine is running are left to it; Pulse-II reads the rest,
   // so a stopped or missing engine never leaves a site's cards waiting.
   const engines=await liveScanEngines(pool);liveEngineCount=engines.length;
   grouped=new Map([...grouped].filter(([lane])=>!engines.some(engine=>engineCovers(engine,lane))));
  }
  if(role==='app'&&!scanLanes){singleLane.batchIds=[...grouped.values()].flat();return singleLane.batchIds.length?[singleLane]:[];}
  return [...grouped].map(([name,batchIds])=>{let lane=lanes.get(name);if(!lane){lane={name,ocr:ocrForLane(name),concurrency:lanePerSite,workers:0,batchIds};lanes.set(name,lane);}lane.batchIds=batchIds;return lane;});
 }
 async function pump(){if(stopped)return;let ready;try{ready=await lanesWithWork();}catch(error){console.error('Scan lanes unavailable:',error?.code||error?.message||'Error');return;}const tasks=[];for(const lane of ready){
  // A held lane waits, then tries one card; full speed returns when Google answers.
  if(lane.outage&&Date.now()<lane.outage.retryAt)continue;
  const limit=lane.outage?1:lane.concurrency;
  while(!stopped&&lane.workers<limit){lane.workers++;workers++;tasks.push(trackJob('Scan card reading',()=>readQueuedCards(lane)).finally(()=>{lane.workers--;workers--;}));}
 }await Promise.all(tasks);}
 // Every 30 s: keep the hold on cards being read here, return cards whose
 // reader stopped, and (engines) report that this engine is alive.
 async function keepLeases(){try{await renewReadLeases(pool,undefined,[...activeReads]);await requeueExpiredReads(pool);if(role==='engine')await beatScanEngine(pool,{siteLane:engineLane??'*',excludedLanes:engineExcluded,version:engineVersion,keySource:geminiKeySource(process.env,engineLane||''),reading:workers,readTotal});}catch(error){console.error('Scan lease upkeep failed:',error?.code||error?.message||'Error');}if(role==='app')await watchOutages();}
 async function waitForSchema(){for(;;){const r=await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='mis_scan_cards' AND column_name IN('read_lease_owner','read_lease_until')");if(r.rows[0].n===2&&(await pool.query("SELECT to_regclass('mis_scan_engines') AS t")).rows[0].t)return;console.log('Scan engine waiting for Pulse-II to add the scan lease columns.');await new Promise(r=>setTimeout(r,10000));if(stopped)return;}}
 return {async start(){
  if(role==='engine'){await waitForSchema();if(stopped)return;await pruneScanEngines(pool);}
  else{await pool.query(SCAN_SCHEMA);if(geminiEnabled(process.env)&&!localDrafts)await recoverMissingEquipmentNumbers(pool);}
  // Only cards whose reader stopped go back to the queue; a card another
  // process (an engine, or the other deployment slot) is reading stays with it.
  await requeueExpiredReads(pool);
  if(role==='engine')await keepLeases();
  timer=setInterval(()=>void pump(),2000);timer.unref?.();leaseTimer=setInterval(()=>void keepLeases(),30000);leaseTimer.unref?.();void pump();
  if(role==='app'&&fingerprintBackfill)void backfillScanFingerprints(pool,{imageStorage}).catch(error=>console.error('Scan fingerprint backfill stopped:',error?.message||String(error)));
 },pump,
 // drainMs: let cards already being read finish (no new ones start), then
 // hand any unfinished card straight back to the queue (releaseLeases).
 async stop({drainMs=0,releaseLeases=false}={}){stopped=true;clearInterval(timer);clearInterval(leaseTimer);
  const until=Date.now()+drainMs;while(workers>0&&Date.now()<until)await new Promise(r=>setTimeout(r,250));
  if(releaseLeases)await releaseReadLeases(pool).catch(error=>console.error('Scan lease release failed:',error?.code||error?.message||'Error'));
  if(role==='engine')await removeScanEngine(pool).catch(()=>{});
  await fleetChecks.stop();await ocr.close?.();for(const lane of lanes.values())await lane.ocr.close?.();},
 // For /api/health and diagnostics: how reading is arranged on this server.
 status:()=>({mode:role==='engine'?'engine':enginesExternal?'external':scanLanes?'lanes':'single',reading:workers,readTotal,lanes:[...lanes.values()].map(lane=>({site:lane.name||'other',workers:lane.workers,key:geminiKeySource(process.env,lane.name||'')})),liveEngines:liveEngineCount,
  // Entry reads: how often a card's fill and checks were reused (hits) or worked out (misses).
  entryReadReuse:{fill:fillMemo.stats(),check:checkMemo.stats()},
  // Whole and partial entry reads running now, waiting for a slot, and served since start.
  entryReadLane:readLane.stats(),
  // The scan screen's progress polls: running, waiting, served, and how many shared another tab's read.
  progressReadLane:progressLane.stats(),
  // Reading held because the account failed: Pulse-II reports every reader's hold (from the database), an engine its own.
  outages:role==='app'?knownOutages.map(({detail,...outage})=>outage):[singleLane,...lanes.values()].filter(lane=>lane.outage).map(lane=>({lane:outageLaneKey(lane.name),reason:lane.outage.reason,httpStatus:lane.outage.status,since:lane.outage.since}))}),
 activeReads:()=>workers};
}



