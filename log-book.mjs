import {registerLogBookDashboard} from './log-book-dashboard.mjs';
import {withEquipmentAliases,aliasOtpEnabled} from './equipment-aliases.mjs';
import {recordMeterCorrection} from './scan-meter-history.mjs';
import {requireOperationalDate} from './operational-start.mjs';
import {assetBookKind} from './equipment-kind.mjs';
export {assetBookKind} from './equipment-kind.mjs';
import {validateTripEquipment} from './trip-equipment-validation.mjs';
import {normalizeManualDetails} from './manual-log-book-details.mjs';
import {registerVlbBatches} from './vlb-batches.mjs';
import {registerManpowerReports} from './manpower-report-api.mjs';
import {registerProductionReports} from './production-report-api.mjs';
import {registerMeterContinuityReport} from './meter-continuity-report.mjs';
import {assetCapacityPair} from './production-report.mjs';
import {VLB_BATCH_SCHEMA,assertVlbBatchWrite,lockVlbBatchWrites,syncVlbBatchRecord} from './vlb-batch-policy.mjs';
import {assertSingleVlbCardPerShift} from './vlb-duplicate-card.mjs';
import {twoStageEnabled,FLEET_STATUSES,NON_WORKING_STATUSES} from './vlb-two-stage.mjs';
import {assertElbBatchWrite,syncElbBatchRecord} from './vlb-batch-stages.mjs';
import {VLB_CARD_COUNTER_SCHEMA,allocateVlbCardNumber} from './vlb-card-number.mjs';
import {registerLogBookDeletion} from './log-book-deletion.mjs';
import {manualBreakdownHours,applyBreakdownHours} from './breakdown-hours-source.mjs';
import {TRIP_VERIFICATION_SCHEMA,enqueueTripVerification} from './pulse-trip-verification.mjs';
import {decodeScanRow} from './scan-text-storage.mjs';
import {validTripTimes,withVlbTripHandovers} from './vlb-trip-handover.mjs';
import {savedLogBookFilters} from './saved-log-book-filters.mjs';
import {scanImageMime} from './scan-image-format.mjs';
import {employeeIdentity} from './employee-identity.mjs';
import {logBookSiteScope,logBookAccountLocation,siteAllowed,requireLogBookSite,employeeAtLocation,filterLogBookSites} from './log-book-access.mjs';
import {meterRuleIssues,CARD_SHIFTS,formatBookNumber,bookShiftCode,matchingWorkOrders,machineLabel,machineSummary,machineDiscrepancies,systemBookDate,latestWorkOrder,interTripGap} from './trip-card-rules.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {summarizePulseHours} from './log-book-hours.mjs';
import {randomUUID} from 'node:crypto';
import {canonicalSiteName} from './site-location.mjs';
import {displaySiteSelection,REGION_DATA} from './region-scope.mjs';

export const LOG_BOOK_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_log_books(
 id BIGSERIAL PRIMARY KEY,book_no TEXT UNIQUE,book_type TEXT NOT NULL CHECK(book_type IN ('vehicle','equipment')),
 book_date DATE NOT NULL,site TEXT NOT NULL,asset_id BIGINT NOT NULL,data JSONB NOT NULL,
 request_key UUID UNIQUE NOT NULL,created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),revision INTEGER NOT NULL DEFAULT 1);
 ALTER TABLE mis_log_books ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ; CREATE TABLE IF NOT EXISTS mis_log_book_counters(book_type TEXT NOT NULL,book_date DATE NOT NULL,last_number INTEGER NOT NULL,PRIMARY KEY(book_type,book_date)); CREATE TABLE IF NOT EXISTS mis_vlb_series_counters(book_date DATE PRIMARY KEY,last_number INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS mis_log_books_type_date ON mis_log_books(book_type,book_date DESC,id DESC);`+TRIP_VERIFICATION_SCHEMA+VLB_CARD_COUNTER_SCHEMA+VLB_BATCH_SCHEMA;

const text=(value,max=200)=>String(value??'').trim().slice(0,max);
const fail=message=>{throw Object.assign(new Error(message),{status:400})};
const number=(value,label,{optional=false,integer=false,signed=false}={})=>{
 if(value===''||value===undefined||value===null){if(optional)return null;fail(`${label} is required.`)}
 const n=Number(value);if(!['string','number'].includes(typeof value)||(typeof value==='string'&&!value.trim())||!Number.isFinite(n)||(!signed&&n<0)||(integer&&!Number.isSafeInteger(n)))fail(`${label} must be a valid ${integer?'whole ':''}${signed?'':'non-negative '}number.`);return n;
};
const rounded=value=>Math.round((value+Number.EPSILON)*1000)/1000;

export function employeeCode(record={}){return text(record.employeeId||record.empId||record.employeeCode||record.empCode||record.caliberId||record.code||record.idNo);}
export function timeGapMinutes(start,end){
 const parse=value=>{const m=text(value).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);if(!m||Number(m[1])>23||Number(m[2])>59||Number(m[3]||0)>59)fail('Loading and unloading times must be valid clock times.');return Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0)};
 let seconds=parse(end)-parse(start);if(seconds<0)seconds+=86400;return rounded(seconds/60);
}
export function normalizeLogBook(kind,input={}){
 if(!['vehicle','equipment'].includes(kind))fail('Invalid log book type.');
 if(String(input.bookDateSource||'').startsWith('scan')&&!input.bookDate)fail('Enter the Book Date from the scanned card.');const bookDate=text(input.bookDate||systemBookDate());requireOperationalDate(bookDate);if(!/^\d{4}-\d{2}-\d{2}$/.test(bookDate)||!Number.isFinite(Date.parse(bookDate+'T00:00:00Z'))||new Date(bookDate+'T00:00:00Z').toISOString().slice(0,10)!==bookDate)fail('Enter a valid book date.');
 const location=text(input.location);if(!location)fail('Select a location.');
 const shiftHours=number(input.shiftHours,'Shift hours');if(input.cardShift&&CARD_SHIFTS[input.cardShift]&&shiftHours!==CARD_SHIFTS[input.cardShift].hours)fail('The marked card shift requires '+CARD_SHIFTS[input.cardShift].hours+' hours.');if(![8,12].includes(shiftHours))fail('Select an 8-hour or 12-hour shift.');
 const shiftStatus=kind==='equipment'&&FLEET_STATUSES[input.shiftStatus]?input.shiftStatus:'',nonWorking=Boolean(shiftStatus)&&NON_WORKING_STATUSES.includes(shiftStatus);
 const assetId=number(input.assetId,'Door number',{integer:true}),employeeId=number(input.employeeId,kind==='vehicle'?'Driver':'Operator',{integer:true,optional:nonWorking}),shiftId=number(input.shiftId,'Shift',{integer:true});
 if(!assetId||!employeeId&&!nonWorking||!shiftId)fail('Select an asset, employee and shift from their masters.');
 const openingHmr=number(input.openingHmr,'Opening HMR',{signed:true,optional:nonWorking})??0,closingHmr=number(input.closingHmr,'Closing HMR',{signed:true,optional:nonWorking})??openingHmr;
const openingKmr=kind==='vehicle'?number(input.openingKmr,'Opening KMR',{signed:true}):null,closingKmr=kind==='vehicle'?number(input.closingKmr,'Closing KMR',{signed:true}):null;
const timeMode=input.timeMode==='without'?'without':'with';
 if(!Array.isArray(input.trips??[]))fail('Trip details must be a list.');
 if((input.trips||[]).length>300)fail('A log book can contain up to 300 trip rows.');
 const trips=kind==='vehicle'?(input.trips||[]).map((row,index)=>{
   if(!row||typeof row!=='object'||Array.isArray(row))fail('Invalid trip row.');
   const equipmentName=text(row.equipmentName);if(!equipmentName)fail(`Enter the loading equipment for trip row ${index+1}.`);
   const tripCount=number(row.tripCount,`Trips in row ${index+1}`,{integer:true});if(tripCount<1)fail('Each trip row must contain at least one trip.');
   const loadingTime=timeMode==='with'?text(row.loadingTime,8):'',unloadingTime=timeMode==='with'?text(row.unloadingTime,8):'';
   if(timeMode==='with'&&!validTripTimes({loadingTime,unloadingTime}))fail('Enter at least one valid loading or unloading time for each trip.');
   return {equipmentName,originalEquipmentName:text(row.originalEquipmentName||row.equipmentNotation?.original||row.equipmentName),...(row.equipmentId?{equipmentId:text(row.equipmentId)}:{}),...(row.equipmentSite?{equipmentSite:text(row.equipmentSite)}:{}),loadingTime,unloadingTime,tripCount,...(row.jobType?{jobType:text(row.jobType,500)}:{}),...(row.remark?{remark:text(row.remark,2000)}:{}),...(row.timeEstimates?{timeEstimates:row.timeEstimates}:{}),...(row.equipmentProvenance&&row.equipmentName===row.equipmentProvenance.value?{equipmentSource:'previous-shift',equipmentProvenance:row.equipmentProvenance}:{}),durationMinutes:timeMode==='with'&&loadingTime&&unloadingTime?timeGapMinutes(loadingTime,unloadingTime):null};
 }):[];
 trips.forEach((row,index)=>{row.gapMinutes=timeMode==='with'?interTripGap(trips,index):null});
 const workingHmr=rounded(closingHmr-openingHmr);
 return {...normalizeManualDetails(input,kind),bookDate,location,assetId,employeeId,shiftId,shiftHours,docType:kind==='vehicle'?'VLB':'QLB',
   meterRuleErrors:meterRuleIssues(input,kind),openingKmr,closingKmr,openingHmr,closingHmr,totalRunningKmr:kind==='vehicle'?rounded(closingKmr-openingKmr):null,totalWorkingHmr:workingHmr,
   cardShift:CARD_SHIFTS[input.cardShift]?input.cardShift:'',bookDateSource:text(input.bookDateSource||'manual'),machineSummary:machineSummary(trips),scanMachineSummary:Array.isArray(input.scanMachineSummary)?input.scanMachineSummary.map(r=>({...r,equipmentName:text(r.equipmentName),tripCount:number(r.tripCount,'Machine summary trips',{integer:true})})):[],
   aFormNo:kind==='vehicle'?text(input.aFormNo):'',jobCardNo:kind==='equipment'?text(input.jobCardNo):'',remark:text(input.remark,4000),timeMode,trips,shiftStatus,statusReason:kind==='equipment'?text(input.statusReason,2000):'',
   totalRecords:trips.length,openingTrips:trips.reduce((sum,row)=>sum+(row.loadingTime?row.tripCount:0),0),endingTrips:trips.reduce((sum,row)=>sum+(row.unloadingTime?row.tripCount:0),0),totalTrips:trips.reduce((sum,row)=>sum+(timeMode==='without'||row.loadingTime&&row.unloadingTime?row.tripCount:0),0),
   workOrderContract:null,manualBreakdownHours:manualBreakdownHours(input.manualBreakdownHours,shiftHours),breakdownHours:null,availabilityHours:workingHmr,runningHours:workingHmr,idleHours:rounded(shiftHours-workingHmr)};
}

const woNames=['Work Order master','Work order master','Work Order Master','WO master'];
const woNumber=r=>text(r.workOrderNo||r.workOrderNumber||r.woNo||r.contractNo||r.number||r.code||r.name);
export async function resolveLogBookData(client,kind,input,{enforceEmployeeSite=false}={}){
 requireOperationalDate(input.bookDate||systemBookDate());
 let resolved={...input};if(!resolved.workOrderId){const rows=(await client.query('SELECT id,record_data FROM master_records WHERE master_name=ANY($1::text[])',[woNames])).rows.map(r=>({...r.record_data,id:String(r.id)}));const latest=latestWorkOrder(rows,resolved.location,resolved.bookDate||systemBookDate());if(latest)resolved.workOrderId=latest.id;}input=resolved;
 if(kind==='vehicle'){
 const assets=await withEquipmentAliases(client,(await client.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master'")).rows.map(r=>({...r.record_data,id:String(r.id)})));
 const validation=validateTripEquipment(input,assets,{anySite:twoStageEnabled()});if(Object.keys(validation.issues).length)fail(Object.values(validation.issues).join(' '));input=validation.draft;
 const differences=machineDiscrepancies(input.trips,input.scanMachineSummary);if(differences.length)fail(differences.join(' '));
 }
 const data=normalizeLogBook(kind,input);
     const masters=(await client.query('SELECT id,master_name,record_data FROM master_records WHERE id=ANY($1::bigint[])',[[data.assetId,data.employeeId,data.shiftId,...(input.workOrderId?[number(input.workOrderId,'Work Order',{integer:true})]:[])]])).rows;
     const asset=masters.find(row=>String(row.id)===String(data.assetId)&&row.master_name==='Equipment master')?.record_data;
     const employee=masters.find(row=>String(row.id)===String(data.employeeId)&&['Users & employees','C-Dir Employee master','ERP Employee master','Employee master'].includes(row.master_name))?.record_data;
     const shift=masters.find(row=>String(row.id)===String(data.shiftId)&&row.master_name==='Shift Master')?.record_data;
     if(enforceEmployeeSite&&employee&&!employeeAtLocation(employee,data.location))fail('The selected employee is not assigned to this location.');
     const employeeOptional=kind==='equipment'&&NON_WORKING_STATUSES.includes(data.shiftStatus)&&!data.employeeId;
     if(!asset||!employee&&!employeeOptional||!shift)fail('An asset, employee or shift no longer exists. Refresh the masters and select again.');
     if(input.workOrderId){const wo=masters.find(row=>String(row.id)===String(input.workOrderId)&&woNames.includes(row.master_name))?.record_data;if(!wo)fail('Select a valid Work Order from its master.');const woSite=text(wo.site||wo.location);if(woSite&&canonicalSiteName(woSite)!==canonicalSiteName(data.location))fail('The Work Order belongs to a different location.');data.workOrderId=String(input.workOrderId);data.workOrderContract=woNumber(wo);}
     if(assetBookKind(asset)!==kind)fail('Select an asset from the correct log book category.');
     const assetSite=text(asset.currentLocation||asset.site||asset.location),shiftSite=text(shift.site||shift.siteName);
     const siteHolds=[];
     if(assetSite&&canonicalSiteName(assetSite)!==canonicalSiteName(data.location)){if(!twoStageEnabled())fail('The selected asset is assigned to a different location.');siteHolds.push({role:kind==='vehicle'?'vlb_door':'elb_door',assetId:String(data.assetId),assetSite,label:text(asset.door||asset.doorNo||equipmentDoorNumber(asset))});}
     if(kind==='vehicle'&&twoStageEnabled())for(const row of data.trips)if(row.equipmentSite&&canonicalSiteName(row.equipmentSite)!==canonicalSiteName(data.location))siteHolds.push({role:'vlb_loader',assetId:String(row.equipmentId),assetSite:row.equipmentSite,label:row.equipmentName,trips:row.tripCount});
     data.siteHolds=siteHolds;
     if(shiftSite&&canonicalSiteName(shiftSite)!==canonicalSiteName(data.location))fail('The selected shift is assigned to a different location.');
     Object.assign(data,{door:text(asset.door||asset.doorNo||equipmentDoorNumber(asset)),assetName:text(asset.equipmentName||asset.equipment||asset.name||asset.group),registration:text(asset.registration||asset.reg),employeeName:employee?text(employee.employee||employee.name||employee.login):'',caliberId:employee?employeeCode(employee):'',shiftName:text(shift.shiftName||shift.name||shift.shift),masterShiftStart:text(shift.startTime||shift.start)});
 if(kind==='vehicle'){data.bookShiftCode=bookShiftCode(data.cardShift)||bookShiftCode(shift.shiftCode)||bookShiftCode(data.shiftName);if(!data.bookShiftCode)fail('Select a marked Trip Card shift (I, II, III, Day or Night) for the book number.');}
 else data.bookShiftCode=bookShiftCode(input.bookShiftCode)||bookShiftCode(data.cardShift)||bookShiftCode(shift.shiftCode)||bookShiftCode(data.shiftName)||'';
 data.chassis=text(asset.chassis||asset.chassisNo);
 const capacityPair=assetCapacityPair(asset);data.assetMake=capacityPair.make;data.assetModel=capacityPair.model;
 return data;
}
export async function insertLogBook(client,kind,data,requestKey,createdBy,batchOptions){
 requireOperationalDate(data.bookDate);
       if(kind==='vehicle'){const batch=await assertVlbBatchWrite(client,data,createdBy);await assertSingleVlbCardPerShift(client,data,{batch,actor:createdBy});}else await assertElbBatchWrite(client,data);
       const id=(await client.query("SELECT nextval(pg_get_serial_sequence('mis_log_books','id')) AS id")).rows[0].id;
       const bookNo=kind==='vehicle'?await allocateVlbCardNumber(client,data):formatBookNumber(kind,data.bookDate,(await client.query('INSERT INTO mis_log_book_counters(book_type,book_date,last_number) VALUES($1,$2,1) ON CONFLICT(book_type,book_date) DO UPDATE SET last_number=mis_log_book_counters.last_number+1 RETURNING last_number',[kind,data.bookDate])).rows[0].last_number);
       const result=await client.query('INSERT INTO mis_log_books(id,book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id,book_no,book_type,data,revision,created_at,updated_at',[id,bookNo,kind,data.bookDate,data.location,data.assetId,JSON.stringify(data),requestKey,createdBy]);
 await enqueueTripVerification(client,result.rows[0]);
 await syncVlbBatchRecord(client,result.rows[0],createdBy,batchOptions);
 await syncElbBatchRecord(client,result.rows[0],createdBy);
 return result.rows[0];
}
export function registerLogBooks(app,{pool,requireSession,requireAdministrator,pulseMasterSync,sendDeletionOtp,imageStorage,approvalOtp={},getSiteScope=async session=>logBookSiteScope(session)}){
 let ready;
 const ensure=()=>ready??=(pool.query(LOG_BOOK_SCHEMA).catch(error=>{ready=null;throw error}));
 const protect=[requireSession,requireAdministrator,async(req,res,next)=>{try{req.logBookScope=await getSiteScope(req.session);next()}catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}}];
 registerLogBookDashboard(app,{pool,protect,ensureBooks:ensure});
 const batchScope=(req,res,next)=>{if(req.query?.scan!=='1')return protect[2](req,res,next);return requireAdministrator(req,res,error=>{if(error)return next(error);req.logBookScope={sites:null,label:'All sites'};next()})};
 registerManpowerReports(app,{pool,protect,ensureBooks:ensure,withHandovers:withVlbTripHandovers});
 registerProductionReports(app,{pool,protect,ensureBooks:ensure});
 registerMeterContinuityReport(app,{pool,protect,ensureBooks:ensure});
 registerVlbBatches(app,{pool,protect:[requireSession,batchScope],recoveryProtect:protect,ensureBooks:ensure,sendOtp:sendDeletionOtp,imageStorage,logBookOps:{resolve:(client,kind,input)=>resolveLogBookData(client,kind,input),insert:insertLogBook,applyHours:(data,actor)=>applyBreakdownHours(data,{readHours,actor})},approvalOtp});
 registerLogBookDeletion(app,{pool,protect,ensureBooks:ensure,sendOtp:sendDeletionOtp,imageStorage,permittedSites:req=>filterLogBookSites(pool,req.logBookScope),assertSite:(req,site)=>requireLogBookSite(req.logBookScope,site),allowsSite:(req,site)=>siteAllowed(req.logBookScope,site)});

 app.get('/api/reports/operations',...protect,async(req,res,next)=>{
   try{
     const {from,to}=req.query;requireOperationalDate(from);requireOperationalDate(to);
     const valid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
     if(!valid(from)||!valid(to)||to<from||(Date.parse(to)-Date.parse(from))/86400000>365)return res.status(400).json({error:'Choose a valid date range of at most 366 days.'});
     await ensure();
     const sourceRecords=(await pool.query('SELECT id,book_no,book_type,data FROM mis_log_books WHERE deleted_at IS NULL AND book_date>=$$2026-11-01$$ AND book_date BETWEEN $1 AND $2 ORDER BY book_date,id',[from,to])).rows;
     const visibleRecords=sourceRecords.filter(r=>siteAllowed(req.logBookScope,r.data.location));
     const permittedSites=await filterLogBookSites(pool,req.logBookScope);
     const linked=await withVlbTripHandovers(pool,visibleRecords.filter(r=>r.book_type==='vehicle'),permittedSites);
     const records=[...linked,...visibleRecords.filter(r=>r.book_type!=='vehicle')];
     const masters=(await pool.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[])",[['Equipment master','Shift Master']])).rows;
     const assets=masters.filter(r=>r.master_name==='Equipment master').map(({id,record_data:r})=>({id:String(id),door:equipmentDoorNumber(r),site:text(r.currentLocation||r.site||r.location),kind:assetBookKind(r)}));
     const shifts=masters.filter(r=>r.master_name==='Shift Master').map(({id,record_data:r})=>({id:String(id),name:text(r.shiftName||r.name||r.shift),site:text(r.site||r.siteName)}));
     const exists=(await pool.query("SELECT to_regclass('mis_scan_cards') AS cards,to_regclass('mis_scan_batches') AS batches")).rows[0];
     const scanRows=exists?.cards&&exists?.batches?(await pool.query("SELECT c.id,c.filename,c.status,c.draft,c.error,c.logbook_id,l.book_no,b.kind,to_char(c.created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS scanned_date FROM mis_scan_cards c JOIN mis_scan_batches b ON b.id=c.batch_id LEFT JOIN mis_log_books l ON l.id=c.logbook_id AND l.book_date>=$$2026-11-01$$ WHERE c.draft->>'bookDate' BETWEEN $1 AND $2 OR to_char(c.created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') BETWEEN $1 AND $2 OR c.draft ? '__caliberUtf8JsonV1' ORDER BY c.created_at,c.ordinal",[from,to])).rows:[];
     const cards=scanRows.map(decodeScanRow).filter(c=>{const date=c.draft?.bookDate||c.scanned_date;return date>=from&&date<=to&&siteAllowed(req.logBookScope,c.draft?.location);});
     res.set('Cache-Control','no-store').json({records,assets:assets.filter(r=>siteAllowed(req.logBookScope,r.site)),shifts:shifts.filter(r=>siteAllowed(req.logBookScope,r.site)),cards,scanConnected:Boolean(exists?.cards&&exists?.batches)});
   }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}
 });
 app.get('/api/log-books/options',...protect,async(req,res,next)=>{
   try{await ensure();
     if(req.query?.scan==='1')req.logBookScope={sites:null,label:'All sites'};
     const {rows}=await pool.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY id",[['Equipment master','Shift Master','Users & employees','Employee master','ERP Employee master','Region master','Site master','Site Master','C-Dir Site & Office master','C-Dir Employee master',...woNames]]);
     const assets=[],employees=[],shifts=[],workOrders=[],sites=new Set();const hasEmployees=rows.some(r=>r.master_name==='C-Dir Employee master');
     for(const row of rows){const r=row.record_data;
       if(row.master_name==='Equipment master'){const site=text(r.currentLocation||r.site||r.location);if(site)sites.add(site);assets.push({id:String(row.id),door:text(r.door||r.doorNo||equipmentDoorNumber(r)),registration:text(r.registration||r.reg),name:text(r.equipmentName||r.equipment||r.name||r.group),kind:assetBookKind(r),site});}
       if(row.master_name==='Employee master'||row.master_name==='ERP Employee master'||row.master_name==='C-Dir Employee master'||(!hasEmployees&&row.master_name==='Users & employees'))employees.push({id:String(row.id),name:text(r.employee||r.name||r.login),caliberId:employeeCode(r),caliberCode:employeeIdentity(r).caliberCode,employeeCode:text(r.employeeCode||r.erpEmployeeCode),masterName:row.master_name,site:text(r.site||r.location||r.currentLocation),designation:text(r.designation||r.userGroup)});
       if(row.master_name==='Shift Master'){const site=text(r.site||r.siteName);if(site)sites.add(site);shifts.push({id:String(row.id),name:text(r.shiftName||r.name||r.shift),site,shiftCode:text(r.shiftCode),status:text(r.status),sourceMissing:Boolean(r.sourceMissing),effectiveFrom:text(r.effectiveFrom),effectiveTo:text(r.effectiveTo),startTime:text(r.startTime||r.start),endTime:text(r.endTime||r.end)});}
       if(woNames.includes(row.master_name)&&!r.sourceMissing)workOrders.push({id:String(row.id),number:woNumber(r),site:text(r.site||r.location),workOrderDate:text(r.workOrderDate),begin:text(r.commencementDate),end:text(r.completionDate)});
       if(['Site master','Site Master','C-Dir Site & Office master'].includes(row.master_name)&&text(r.name||r.site||r.siteName))sites.add(text(r.name||r.site||r.siteName));
       if(row.master_name==='Region master')for(const site of Array.isArray(r.sites)?r.sites:String(r.sites||'').split('|'))if(text(site))sites.add(text(site));
     }
     const counterRows=(await pool.query("SELECT 'vehicle' AS kind,book_date::text AS book_day,last_number FROM mis_vlb_series_counters WHERE book_date>=$$2026-11-01$$ UNION ALL SELECT book_type AS kind,book_date::text AS book_day,last_number FROM mis_log_book_counters WHERE book_type='equipment' AND book_date>=$$2026-11-01$$")).rows;const bookNumberCounters={vehicle:{},equipment:{}};for(const r of counterRows)bookNumberCounters[r.kind][r.book_day]=Number(r.last_number);
     const vehicleCardCounters={M:{},S:{}};for(const r of (await pool.query('SELECT book_date::text AS book_day,shift,source,last_number FROM mis_vlb_card_counters WHERE book_date>=$$2026-11-01$$')).rows)vehicleCardCounters[r.source][r.book_day+'/'+r.shift]=Number(r.last_number);
     const allowed=site=>siteAllowed(req.logBookScope,site);res.set('Cache-Control','no-store');res.json({equipmentAliasOtp:aliasOtpEnabled(),canSelectSite:req.logBookScope.sites===null,accountLocation:logBookAccountLocation(req.session,req.logBookScope,rows.filter(row=>row.master_name==='Users & employees').map(row=>row.record_data)),bookNumberCounters,vehicleCardCounters,assets:(await withEquipmentAliases(pool,assets)).filter(r=>allowed(r.site)),employees:employees.filter(r=>req.logBookScope.sites===null||displaySiteSelection(r.site).some(allowed)),shifts:shifts.filter(r=>allowed(r.site)),sites:(req.query?.scan==='1'?REGION_DATA.flatMap(region=>region.sites):displaySiteSelection([...sites])).filter(allowed).sort(),workOrders:workOrders.filter(r=>allowed(r.site)),workOrderConnected:workOrders.length>0,breakdownHoursConnected:Boolean(pulseMasterSync?.status().connected)});
   }catch(error){next(error)}
 });
 const readHours=async(input)=>{requireOperationalDate(input.bookDate);if(!pulseMasterSync)throw new Error('Pulse breakdown connection unavailable.');const assetId=number(input.assetId,'Door number',{integer:true}),shiftId=number(input.shiftId,'Shift',{integer:true});const rows=(await pool.query('SELECT id,master_name,record_data FROM master_records WHERE id=ANY($1::bigint[])',[[assetId,shiftId]])).rows;const asset=rows.find(r=>String(r.id)===String(assetId)&&r.master_name==='Equipment master')?.record_data,shift=rows.find(r=>String(r.id)===String(shiftId)&&r.master_name==='Shift Master')?.record_data;if(!asset||!shift)fail('Select valid vehicle and shift masters.');if(canonicalSiteName(asset.currentLocation||asset.site||asset.location)!==canonicalSiteName(input.location)||canonicalSiteName(shift.site||shift.siteName)!==canonicalSiteName(input.location))fail('Vehicle and shift must belong to this location.');return summarizePulseHours({rows:await pulseMasterSync.readBreakdownRequests({actor:input.actor}),date:input.bookDate,site:input.location,asset,shift,shiftHours:Number(input.shiftHours),runningHours:input.runningHours==null?null:Number(input.runningHours)});};
 app.post('/api/log-books/hours',...protect,async(req,res)=>{try{requireLogBookSite(req.query?.scan==='1'?{sites:null}:req.logBookScope,req.body.location);res.set('Cache-Control','no-store').json(await readHours({...req.body,actor:req.session.login||req.session.name}));}catch(e){res.status(e.status||400).json({error:e.message});}});
 app.get('/api/log-books/:kind',...protect,async(req,res,next)=>{
   try{await ensure();if(!['vehicle','equipment'].includes(req.params.kind))return res.status(400).json({error:'Invalid log book type.'});
     const before=String(req.query.before||'');if(before&&!/^\d+$/.test(before))return res.status(400).json({error:'Invalid page cursor.'});
     const first=req.query.first==='1',last=req.query.last==='1';
     const filters=savedLogBookFilters(req.query);
     if(filters.location)requireLogBookSite(req.logBookScope,filters.location);
     const permittedSites=await filterLogBookSites(pool,filters.location?{sites:[canonicalSiteName(filters.location)]}:req.logBookScope);
     const {rows}=await pool.query(`SELECT id,book_no,book_type,CASE WHEN jsonb_typeof(data->'manualAttachments')='array' THEN jsonb_set(data,'{manualAttachments}',(SELECT COALESCE(jsonb_agg(file-'data'),'[]'::jsonb) FROM jsonb_array_elements(data->'manualAttachments') file)) ELSE data END AS data,created_at,updated_at,revision FROM mis_log_books WHERE deleted_at IS NULL AND book_date>=$$2026-11-01$$ AND book_type=$1 AND ($2::bigint IS NULL OR id<$2::bigint) AND ($3::text[] IS NULL OR site=ANY($3::text[])) AND ($4::text IS NULL OR book_no ILIKE $4 OR data->>'door' ILIKE $4 OR data->>'employeeName' ILIKE $4 OR data->>'caliberId' ILIKE $4 OR data->>'aFormNo' ILIKE $4 OR data->>'jobCardNo' ILIKE $4 OR site ILIKE $4) AND ($5::date IS NULL OR book_date>=$5::date) AND ($6::date IS NULL OR book_date<=$6::date) ORDER BY id ${first?'ASC':'DESC'} LIMIT ${first||last?'1':'101'}`,[req.params.kind,before||null,permittedSites,filters.search,filters.from,filters.to]);
     const more=rows.length>100;const records=req.params.kind==='vehicle'?await withVlbTripHandovers(pool,rows.slice(0,100),permittedSites):rows.slice(0,100);res.set('Cache-Control','no-store').json({records,nextCursor:more?String(rows[99].id):null});
   }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}
 });
 app.get('/api/log-books/:kind/:id/manual-attachments',...protect,async(req,res,next)=>{
  try{await ensure();if(!['vehicle','equipment'].includes(req.params.kind)||!/^\d+$/.test(req.params.id))return res.status(400).json({error:'Invalid log book.'});
   const record=(await pool.query('SELECT site,data FROM mis_log_books WHERE id=$1 AND book_type=$2 AND deleted_at IS NULL AND book_date>=$$2026-11-01$$',[req.params.id,req.params.kind])).rows[0];
   if(!record||!siteAllowed(req.logBookScope,record.site))return res.status(404).json({error:'Log book unavailable.'});
   res.set('Cache-Control','no-store').json({attachments:record.data.manualAttachments||[]});
  }catch(error){next(error)}
 });
 app.get('/api/log-books/:kind/:id/source-image',...protect,async(req,res,next)=>{
   try{
     await ensure();if(!['vehicle','equipment'].includes(req.params.kind)||!/^\d+$/.test(req.params.id))return res.status(400).json({error:'Invalid saved log book.'});
     const record=(await pool.query('SELECT id,site,data FROM mis_log_books WHERE id=$1 AND book_type=$2 AND deleted_at IS NULL AND book_date>=$$2026-11-01$$',[req.params.id,req.params.kind])).rows[0];
     if(!record||!siteAllowed(req.logBookScope,record.site))return res.status(404).json({error:'Saved scan is unavailable.'});
     if(!/^[a-f0-9-]{36}$/i.test(record.data.scanCardId||''))return res.status(404).json({error:'This record has no source scan.'});
     const card=(await pool.query('SELECT image FROM mis_scan_cards WHERE id=$1 AND logbook_id=$2',[record.data.scanCardId,record.id])).rows[0];
     if(!card)return res.status(404).json({error:'Source scan is unavailable.'});
     res.set('Cache-Control','no-store').type(scanImageMime(card.image)).send(card.image);
   }catch(error){next(error)}
 });
 async function save(req,res,next){
   let client;
   try{
     requireOperationalDate(req.body?.bookDate||systemBookDate());await ensure();const kind=req.params.kind,data=normalizeLogBook(kind,req.body),updating=Boolean(req.params.id);
     requireLogBookSite(req.logBookScope,data.location);
     const requestKey=text(req.body.requestKey||randomUUID());if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey))fail('Invalid save reference.');
     if(updating&&!/^\d+$/.test(req.params.id))fail('Invalid log book ID.');
     client=await pool.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(709224102)');if(kind==='vehicle')await lockVlbBatchWrites(client);
     if(updating){const prior=await client.query('SELECT site FROM mis_log_books WHERE id=$1 AND book_type=$2 AND book_date>=$$2026-11-01$$ FOR UPDATE',[req.params.id,kind]);if(prior.rows[0])requireLogBookSite(req.logBookScope,prior.rows[0].site);}
     Object.assign(data,await resolveLogBookData(client,kind,req.body,{enforceEmployeeSite:true}));
     await applyBreakdownHours(data,{readHours,actor:req.session.login||req.session.name});

     if(!updating)await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[requestKey]);
     let result;
     if(updating){
       const prior=(await client.query('SELECT data FROM mis_log_books WHERE id=$1 AND book_type=$2 AND deleted_at IS NULL AND book_date>=$$2026-11-01$$',[req.params.id,kind])).rows[0]?.data;if(prior?.scanCardId){for(const key of ['scanCardId','scanBatchId','reviewedBy','reviewedAt','meterCorrectionHistory'])data[key]=prior[key];data.scanCardNumber=String(kind==='vehicle'?data.aFormNo:data.jobCardNo).toUpperCase().replace(/[^A-Z0-9]/g,'')||null;}if(prior)data.meterCorrectionHistory=recordMeterCorrection(prior.meterCorrectionHistory,prior,data,kind,req.session.login||req.session.name);
       if(kind==='vehicle'&&!data.scanCardId)data.duplicateReason=text(req.body.duplicateReason)||text(prior?.duplicateReason);
       if(kind==='vehicle'){const batch=await assertVlbBatchWrite(client,data,req.session.login||req.session.name,req.params.id);await assertSingleVlbCardPerShift(client,data,{recordId:req.params.id,batch,actor:req.session.login||req.session.name});}
       const revision=number(req.body.revision,'Revision',{integer:true});
       result=await client.query('UPDATE mis_log_books SET book_date=$1,site=$2,asset_id=$3,data=$4::jsonb,updated_at=NOW(),revision=revision+1 WHERE id=$5 AND book_type=$6 AND revision=$7 AND deleted_at IS NULL AND book_date>=$$2026-11-01$$ RETURNING id,book_no,book_type,data,revision,created_at,updated_at',[data.bookDate,data.location,data.assetId,JSON.stringify(data),req.params.id,kind,revision]);
       if(!result.rowCount)throw Object.assign(new Error('This log book changed or is unavailable. Reload it before saving.'),{status:409});
     }else{
       const previous=(await client.query('SELECT id,book_no,book_type,data,revision,created_at,updated_at,created_by FROM mis_log_books WHERE request_key=$1 AND book_date>=$$2026-11-01$$',[requestKey])).rows[0];
       if(previous){requireLogBookSite(req.logBookScope,previous.data.location);if(previous.created_by!==(req.session.login||req.session.name)||previous.book_type!==kind)throw Object.assign(new Error('Save reference already used.'),{status:409});const response=kind==='vehicle'?(await withVlbTripHandovers(client,[previous],await filterLogBookSites(client,req.logBookScope)))[0]:previous;await client.query('COMMIT');return res.json(response);}
       if(kind==='vehicle')data.duplicateReason=text(req.body.duplicateReason);
       result={rows:[await insertLogBook(client,kind,data,requestKey,req.session.login||req.session.name)]};
     }
     if(updating){await enqueueTripVerification(client,result.rows[0]);await syncVlbBatchRecord(client,result.rows[0],req.session.login||req.session.name);await syncElbBatchRecord(client,result.rows[0],req.session.login||req.session.name);}
     const response=kind==='vehicle'?(await withVlbTripHandovers(client,result.rows,await filterLogBookSites(client,req.logBookScope)))[0]:result.rows[0];await client.query('COMMIT');res.status(updating?200:201).json(response);
   }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});if(error.status)return res.status(error.status).json({error:error.message,...(error.details||{})});next(error)}finally{client?.release();}
 }
 app.post('/api/log-books/:kind',...protect,save);
 app.put('/api/log-books/:kind/:id',...protect,save);
 app.delete('/api/log-books/:kind/:id',...protect,(_req,res)=>res.status(403).json({error:'Use Deletion to preview and approve exact records, then verify the WhatsApp OTP. Direct deletion is disabled.'}));
 return {initialize:ensure,readHours};
}




