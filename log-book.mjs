import {CARD_SHIFTS,formatBookNumber,bookShiftCode,matchingWorkOrders,machineLabel,machineSummary,systemBookDate,latestWorkOrder,interTripGap} from './trip-card-rules.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {summarizePulseHours} from './log-book-hours.mjs';
import {randomUUID} from 'node:crypto';
import {canonicalSiteName} from './site-location.mjs';

export const LOG_BOOK_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_log_books(
 id BIGSERIAL PRIMARY KEY,book_no TEXT UNIQUE,book_type TEXT NOT NULL CHECK(book_type IN ('vehicle','equipment')),
 book_date DATE NOT NULL,site TEXT NOT NULL,asset_id BIGINT NOT NULL,data JSONB NOT NULL,
 request_key UUID UNIQUE NOT NULL,created_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),revision INTEGER NOT NULL DEFAULT 1);
 ALTER TABLE mis_log_books ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ; CREATE TABLE IF NOT EXISTS mis_log_book_counters(book_type TEXT NOT NULL,book_date DATE NOT NULL,last_number INTEGER NOT NULL,PRIMARY KEY(book_type,book_date)); CREATE TABLE IF NOT EXISTS mis_vlb_series_counters(book_date DATE PRIMARY KEY,last_number INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS mis_log_books_type_date ON mis_log_books(book_type,book_date DESC,id DESC);`;

const text=(value,max=200)=>String(value??'').trim().slice(0,max);
const fail=message=>{throw Object.assign(new Error(message),{status:400})};
const number=(value,label,{optional=false,integer=false}={})=>{
 if(value===''||value===undefined||value===null){if(optional)return null;fail(`${label} is required.`)}
 const n=Number(value);if(!['string','number'].includes(typeof value)||(typeof value==='string'&&!value.trim())||!Number.isFinite(n)||n<0||(integer&&!Number.isSafeInteger(n)))fail(`${label} must be a valid ${integer?'whole ':''}non-negative number.`);return n;
};
const rounded=value=>Math.round((value+Number.EPSILON)*1000)/1000;
export function assetBookKind(asset={}){
 const category=text(asset.category||asset.equipmentCategory).toLowerCase();
 if(category==='equipment')return 'equipment';if(['vehicle','vehicles'].includes(category))return 'vehicle';
 return /excavator|dozer|grader|loader|drill|shovel|crane|equipment/i.test(text(asset.group||asset.equipmentGroup||asset.equipmentName))?'equipment':'vehicle';
}
export function employeeCode(record={}){return text(record.employeeId||record.empId||record.employeeCode||record.empCode||record.caliberId||record.code||record.idNo);}
export function timeGapMinutes(start,end){
 const parse=value=>{const m=text(value).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);if(!m||Number(m[1])>23||Number(m[2])>59||Number(m[3]||0)>59)fail('Loading and unloading times must be valid clock times.');return Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0)};
 let seconds=parse(end)-parse(start);if(seconds<0)seconds+=86400;return rounded(seconds/60);
}
export function normalizeLogBook(kind,input={}){
 if(!['vehicle','equipment'].includes(kind))fail('Invalid log book type.');
 if(String(input.bookDateSource||'').startsWith('scan')&&!input.bookDate)fail('Enter the Book Date from the scanned card.');const bookDate=text(input.bookDate||systemBookDate());if(!/^\d{4}-\d{2}-\d{2}$/.test(bookDate)||!Number.isFinite(Date.parse(bookDate+'T00:00:00Z'))||new Date(bookDate+'T00:00:00Z').toISOString().slice(0,10)!==bookDate)fail('Enter a valid book date.');
 const location=text(input.location);if(!location)fail('Select a location.');
 const shiftHours=number(input.shiftHours,'Shift hours');if(input.cardShift&&CARD_SHIFTS[input.cardShift]&&shiftHours!==CARD_SHIFTS[input.cardShift].hours)fail('The marked card shift requires '+CARD_SHIFTS[input.cardShift].hours+' hours.');if(![8,12].includes(shiftHours))fail('Select an 8-hour or 12-hour shift.');
 const assetId=number(input.assetId,'Door number',{integer:true}),employeeId=number(input.employeeId,kind==='vehicle'?'Driver':'Operator',{integer:true}),shiftId=number(input.shiftId,'Shift',{integer:true});
 if(!assetId||!employeeId||!shiftId)fail('Select an asset, employee and shift from their masters.');
 const openingHmr=number(input.openingHmr,'Opening HMR'),closingHmr=number(input.closingHmr,'Closing HMR');
 if(closingHmr<openingHmr)fail('Closing HMR cannot be less than opening HMR.');
 const openingKmr=kind==='vehicle'?number(input.openingKmr,'Opening KMR'):null,closingKmr=kind==='vehicle'?number(input.closingKmr,'Closing KMR'):null;
 if(kind==='vehicle'&&closingKmr<openingKmr)fail('Closing KMR cannot be less than opening KMR.');
 const timeMode=input.timeMode==='without'?'without':'with';
 if(!Array.isArray(input.trips??[]))fail('Trip details must be a list.');
 if((input.trips||[]).length>300)fail('A log book can contain up to 300 trip rows.');
 const trips=kind==='vehicle'?(input.trips||[]).map((row,index)=>{
   if(!row||typeof row!=='object'||Array.isArray(row))fail('Invalid trip row.');
   const equipmentName=kind==='vehicle'?machineLabel(text(row.equipmentName)):text(row.equipmentName);if(!equipmentName)fail(`Enter the loading equipment for trip row ${index+1}.`);
   const tripCount=number(row.tripCount,`Trips in row ${index+1}`,{integer:true});if(tripCount<1)fail('Each trip row must contain at least one trip.');
   const loadingTime=timeMode==='with'?text(row.loadingTime,8):'',unloadingTime=timeMode==='with'?text(row.unloadingTime,8):'';
   return {equipmentName,loadingTime,unloadingTime,tripCount,durationMinutes:timeMode==='with'?timeGapMinutes(loadingTime,unloadingTime):null};
 }):[];
 trips.forEach((row,index)=>{row.gapMinutes=timeMode==='with'?interTripGap(trips,index):null});
 const workingHmr=rounded(closingHmr-openingHmr);
 return {bookDate,location,assetId,employeeId,shiftId,shiftHours,docType:kind==='vehicle'?'VLB':'QLB',
   openingKmr,closingKmr,openingHmr,closingHmr,totalRunningKmr:kind==='vehicle'?rounded(closingKmr-openingKmr):null,totalWorkingHmr:workingHmr,
   cardShift:CARD_SHIFTS[input.cardShift]?input.cardShift:'',bookDateSource:text(input.bookDateSource||'manual'),machineSummary:machineSummary(trips),scanMachineSummary:Array.isArray(input.scanMachineSummary)?input.scanMachineSummary.map(r=>({equipmentName:machineLabel(r.equipmentName),tripCount:number(r.tripCount,'Machine summary trips',{integer:true})})):[],
   aFormNo:kind==='vehicle'?text(input.aFormNo):'',jobCardNo:kind==='equipment'?text(input.jobCardNo):'',remark:text(input.remark,4000),timeMode,trips,
   totalRecords:trips.length,totalTrips:trips.reduce((sum,row)=>sum+row.tripCount,0),
   workOrderContract:null,breakdownHours:null,availabilityHours:workingHmr,runningHours:workingHmr,idleHours:rounded(shiftHours-workingHmr)};
}

const woNames=['Work Order master','Work order master','Work Order Master','WO master'];
const woNumber=r=>text(r.workOrderNo||r.workOrderNumber||r.woNo||r.contractNo||r.number||r.code||r.name);
export async function resolveLogBookData(client,kind,input){
 let resolved={...input};if(!resolved.workOrderId){const rows=(await client.query('SELECT id,record_data FROM master_records WHERE master_name=ANY($1::text[])',[woNames])).rows.map(r=>({...r.record_data,id:String(r.id)}));const latest=latestWorkOrder(rows,resolved.location,resolved.bookDate||systemBookDate());if(latest)resolved.workOrderId=latest.id;}input=resolved;
 const data=normalizeLogBook(kind,input);
     const masters=(await client.query('SELECT id,master_name,record_data FROM master_records WHERE id=ANY($1::bigint[])',[[data.assetId,data.employeeId,data.shiftId,...(input.workOrderId?[number(input.workOrderId,'Work Order',{integer:true})]:[])]])).rows;
     const asset=masters.find(row=>String(row.id)===String(data.assetId)&&row.master_name==='Equipment master')?.record_data;
     const employee=masters.find(row=>String(row.id)===String(data.employeeId)&&['Users & employees','C-Dir Employee master','ERP Employee master','Employee master'].includes(row.master_name))?.record_data;
     const shift=masters.find(row=>String(row.id)===String(data.shiftId)&&row.master_name==='Shift Master')?.record_data;
     if(!asset||!employee||!shift)fail('An asset, employee or shift no longer exists. Refresh the masters and select again.');
     if(input.workOrderId){const wo=masters.find(row=>String(row.id)===String(input.workOrderId)&&woNames.includes(row.master_name))?.record_data;if(!wo)fail('Select a valid Work Order from its master.');const woSite=text(wo.site||wo.location);if(woSite&&canonicalSiteName(woSite)!==canonicalSiteName(data.location))fail('The Work Order belongs to a different location.');data.workOrderId=String(input.workOrderId);data.workOrderContract=woNumber(wo);}
     if(assetBookKind(asset)!==kind)fail('Select an asset from the correct log book category.');
     const assetSite=text(asset.currentLocation||asset.site||asset.location),shiftSite=text(shift.site||shift.siteName);
     if(assetSite&&canonicalSiteName(assetSite)!==canonicalSiteName(data.location))fail('The selected asset is assigned to a different location.');
     if(shiftSite&&canonicalSiteName(shiftSite)!==canonicalSiteName(data.location))fail('The selected shift is assigned to a different location.');
     Object.assign(data,{door:text(asset.door||asset.doorNo||equipmentDoorNumber(asset)),assetName:text(asset.equipmentName||asset.equipment||asset.name||asset.group),registration:text(asset.registration||asset.reg),employeeName:text(employee.employee||employee.name||employee.login),caliberId:employeeCode(employee),shiftName:text(shift.shiftName||shift.name||shift.shift),masterShiftStart:text(shift.startTime||shift.start)});
 if(kind==='vehicle'){data.bookShiftCode=bookShiftCode(data.cardShift)||bookShiftCode(shift.shiftCode)||bookShiftCode(data.shiftName);if(!data.bookShiftCode)fail('Select a marked Trip Card shift (I, II, III, Day or Night) for the book number.');}
 return data;
}
export async function insertLogBook(client,kind,data,requestKey,createdBy){
       const id=(await client.query("SELECT nextval(pg_get_serial_sequence('mis_log_books','id')) AS id")).rows[0].id;
       const counter=kind==='vehicle'?(await client.query('INSERT INTO mis_vlb_series_counters(book_date,last_number) VALUES($1,1) ON CONFLICT(book_date) DO UPDATE SET last_number=mis_vlb_series_counters.last_number+1 RETURNING last_number',[data.bookDate])).rows[0].last_number:(await client.query('INSERT INTO mis_log_book_counters(book_type,book_date,last_number) VALUES($1,$2,1) ON CONFLICT(book_type,book_date) DO UPDATE SET last_number=mis_log_book_counters.last_number+1 RETURNING last_number',[kind,data.bookDate])).rows[0].last_number;
       const [year,month,day]=data.bookDate.split('-');
       const bookNo=formatBookNumber(kind,data.bookDate,counter,data.bookShiftCode||data.cardShift||data.shiftName);
       const result=await client.query('INSERT INTO mis_log_books(id,book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id,book_no,book_type,data,revision,created_at,updated_at',[id,bookNo,kind,data.bookDate,data.location,data.assetId,JSON.stringify(data),requestKey,createdBy]);
 return result.rows[0];
}
export function registerLogBooks(app,{pool,requireSession,requireAdministrator,pulseMasterSync}){
 let ready;
 const ensure=()=>ready??=(pool.query(LOG_BOOK_SCHEMA).catch(error=>{ready=null;throw error}));
 const protect=[requireSession,requireAdministrator];
 
 app.get('/api/log-books/options',...protect,async(req,res,next)=>{
   try{await ensure();
     const {rows}=await pool.query("SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY id",[['Equipment master','Shift Master','Users & employees','Employee master','ERP Employee master','Region master','Site master','Site Master','C-Dir Site & Office master','C-Dir Employee master',...woNames]]);
     const assets=[],employees=[],shifts=[],workOrders=[],sites=new Set();const hasEmployees=rows.some(r=>r.master_name==='C-Dir Employee master');
     for(const row of rows){const r=row.record_data;
       if(row.master_name==='Equipment master'){const site=text(r.currentLocation||r.site||r.location);if(site)sites.add(site);assets.push({id:String(row.id),door:text(r.door||r.doorNo||equipmentDoorNumber(r)),registration:text(r.registration||r.reg),name:text(r.equipmentName||r.equipment||r.name||r.group),kind:assetBookKind(r),site});}
       if(row.master_name==='Employee master'||row.master_name==='ERP Employee master'||row.master_name==='C-Dir Employee master'||(!hasEmployees&&row.master_name==='Users & employees'))employees.push({id:String(row.id),name:text(r.employee||r.name||r.login),caliberId:employeeCode(r),employeeCode:text(r.employeeCode||r.erpEmployeeCode),masterName:row.master_name,site:text(r.site||r.location),designation:text(r.designation||r.userGroup)});
       if(row.master_name==='Shift Master'){const site=text(r.site||r.siteName);if(site)sites.add(site);shifts.push({id:String(row.id),name:text(r.shiftName||r.name||r.shift),site,startTime:text(r.startTime||r.start),endTime:text(r.endTime||r.end)});}
       if(woNames.includes(row.master_name)&&!r.sourceMissing)workOrders.push({id:String(row.id),number:woNumber(r),site:text(r.site||r.location),workOrderDate:text(r.workOrderDate),begin:text(r.commencementDate),end:text(r.completionDate)});
       if(['Site master','Site Master','C-Dir Site & Office master'].includes(row.master_name)&&text(r.name||r.site||r.siteName))sites.add(text(r.name||r.site||r.siteName));
       if(row.master_name==='Region master')for(const site of Array.isArray(r.sites)?r.sites:String(r.sites||'').split('|'))if(text(site))sites.add(text(site));
     }
     const counterRows=(await pool.query("SELECT 'vehicle' AS kind,book_date::text AS book_day,last_number FROM mis_vlb_series_counters UNION ALL SELECT book_type AS kind,book_date::text AS book_day,last_number FROM mis_log_book_counters WHERE book_type='equipment'")).rows;const bookNumberCounters={vehicle:{},equipment:{}};for(const r of counterRows)bookNumberCounters[r.kind][r.book_day]=Number(r.last_number);
     res.set('Cache-Control','no-store');res.json({bookNumberCounters,assets,employees,shifts,sites:[...sites].sort(),workOrders,workOrderConnected:workOrders.length>0,breakdownHoursConnected:Boolean(pulseMasterSync?.status().connected)});
   }catch(error){next(error)}
 });
 const readHours=async(input)=>{if(!pulseMasterSync)throw new Error('Pulse breakdown connection unavailable.');const assetId=number(input.assetId,'Door number',{integer:true}),shiftId=number(input.shiftId,'Shift',{integer:true});const rows=(await pool.query('SELECT id,master_name,record_data FROM master_records WHERE id=ANY($1::bigint[])',[[assetId,shiftId]])).rows;const asset=rows.find(r=>String(r.id)===String(assetId)&&r.master_name==='Equipment master')?.record_data,shift=rows.find(r=>String(r.id)===String(shiftId)&&r.master_name==='Shift Master')?.record_data;if(!asset||!shift)fail('Select valid vehicle and shift masters.');if(canonicalSiteName(asset.currentLocation||asset.site||asset.location)!==canonicalSiteName(input.location)||canonicalSiteName(shift.site||shift.siteName)!==canonicalSiteName(input.location))fail('Vehicle and shift must belong to this location.');return summarizePulseHours({rows:await pulseMasterSync.readBreakdownRequests(),date:input.bookDate,site:input.location,asset,shift,shiftHours:Number(input.shiftHours),runningHours:input.runningHours==null?null:Number(input.runningHours)});};
 app.post('/api/log-books/hours',...protect,async(req,res)=>{try{res.set('Cache-Control','no-store').json(await readHours(req.body));}catch(e){res.status(400).json({error:e.message});}});
 app.get('/api/log-books/:kind',...protect,async(req,res,next)=>{
   try{await ensure();if(!['vehicle','equipment'].includes(req.params.kind))return res.status(400).json({error:'Invalid log book type.'});
     const before=String(req.query.before||'');if(before&&!/^\d+$/.test(before))return res.status(400).json({error:'Invalid page cursor.'});
     const first=req.query.first==='1',last=req.query.last==='1';
     const {rows}=await pool.query(`SELECT id,book_no,book_type,data,created_at,updated_at,revision FROM mis_log_books WHERE deleted_at IS NULL AND book_type=$1 AND ($2::bigint IS NULL OR id<$2::bigint) ORDER BY id ${first?'ASC':'DESC'} LIMIT ${first||last?'1':'101'}`,[req.params.kind,before||null]);
     const more=rows.length>100;res.json({records:rows.slice(0,100),nextCursor:more?String(rows[99].id):null});
   }catch(error){next(error)}
 });
 async function save(req,res,next){
   let client;
   try{
     await ensure();const kind=req.params.kind,data=normalizeLogBook(kind,req.body),updating=Boolean(req.params.id);
     const requestKey=text(req.body.requestKey||randomUUID());if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey))fail('Invalid save reference.');
     if(updating&&!/^\d+$/.test(req.params.id))fail('Invalid log book ID.');
     client=await pool.connect();await client.query('BEGIN');
     Object.assign(data,await resolveLogBookData(client,kind,req.body));
     if(kind==='vehicle'&&pulseMasterSync){try{const hours=await readHours({...data,runningHours:data.totalWorkingHmr});Object.assign(data,{breakdownHours:hours.breakdownHours,availabilityHours:hours.availabilityHours,idleHours:hours.idleHours,hoursSource:hours});}catch(e){data.hoursWarning=e.message;}}

     if(!updating)await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[requestKey]);
     let result;
     if(updating){
       const prior=(await client.query('SELECT data FROM mis_log_books WHERE id=$1 AND book_type=$2 AND deleted_at IS NULL',[req.params.id,kind])).rows[0]?.data;if(prior?.scanCardId){for(const key of ['scanCardId','scanBatchId','reviewedBy','reviewedAt'])data[key]=prior[key];data.scanCardNumber=String(kind==='vehicle'?data.aFormNo:data.jobCardNo).toUpperCase().replace(/[^A-Z0-9]/g,'');if(!data.scanCardNumber)fail('A scanned log book must retain its card number.');}
       const revision=number(req.body.revision,'Revision',{integer:true});
       result=await client.query('UPDATE mis_log_books SET book_date=$1,site=$2,asset_id=$3,data=$4::jsonb,updated_at=NOW(),revision=revision+1 WHERE id=$5 AND book_type=$6 AND revision=$7 AND deleted_at IS NULL RETURNING id,book_no,book_type,data,revision,created_at,updated_at',[data.bookDate,data.location,data.assetId,JSON.stringify(data),req.params.id,kind,revision]);
       if(!result.rowCount)throw Object.assign(new Error('This log book changed or is unavailable. Reload it before saving.'),{status:409});
     }else{
       const previous=(await client.query('SELECT id,book_no,book_type,data,revision,created_at,updated_at,created_by FROM mis_log_books WHERE request_key=$1',[requestKey])).rows[0];
       if(previous){if(previous.created_by!==(req.session.login||req.session.name)||previous.book_type!==kind)throw Object.assign(new Error('Save reference already used.'),{status:409});await client.query('COMMIT');return res.json(previous);}
       result={rows:[await insertLogBook(client,kind,data,requestKey,req.session.login||req.session.name)]};
     }
     await client.query('COMMIT');res.status(updating?200:201).json(result.rows[0]);
   }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});if(error.status)return res.status(error.status).json({error:error.message});next(error)}finally{client?.release();}
 }
 app.post('/api/log-books/:kind',...protect,save);
 app.put('/api/log-books/:kind/:id',...protect,save);
 app.delete('/api/log-books/:kind/:id',...protect,async(req,res,next)=>{try{await ensure();if(!['vehicle','equipment'].includes(req.params.kind)||!/^\d+$/.test(req.params.id))fail('Invalid log book.');const revision=number(req.body.revision,'Revision',{integer:true});const result=await pool.query('UPDATE mis_log_books SET deleted_at=NOW(),updated_at=NOW(),revision=revision+1 WHERE id=$1 AND book_type=$2 AND revision=$3 AND deleted_at IS NULL RETURNING id',[req.params.id,req.params.kind,revision]);if(!result.rowCount)return res.status(409).json({error:'Record changed or was already deleted. Refresh before deleting.'});res.json({deleted:true});}catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}});
 return {initialize:ensure,readHours};
}
