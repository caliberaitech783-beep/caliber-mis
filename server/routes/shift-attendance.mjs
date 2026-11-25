import {employeeAtLocation,requireLogBookSite} from '../../shared/log-book-access.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {requireOperationalDate} from '../../shared/operational-start.mjs';
import {assetBookKind} from '../../shared/equipment-kind.mjs';
import {bookShiftCode} from '../../shared/trip-card-rules.mjs';
import {ZERO_TRIP_REASONS} from '../../shared/zero-trip-reasons.mjs';
import {VTC_TRAINING_REASON,TRAINING_SHIFT,trainingDays} from '../../shared/vtc-training.mjs';

export const SHIFT_ATTENDANCE_SCHEMA = `
 CREATE TABLE IF NOT EXISTS mis_shift_attendance (
   book_date DATE NOT NULL, site TEXT NOT NULL, shift TEXT NOT NULL,
   employee_id BIGINT NOT NULL, asset_id BIGINT, kind TEXT NOT NULL,
   reason TEXT NOT NULL, remarks TEXT NOT NULL, recorded_by TEXT NOT NULL,
   PRIMARY KEY (book_date, site, shift, employee_id)
 );`;

const employeeMasters = ['Users & employees','C-Dir Employee master','ERP Employee master','Employee master'];
const masterId = value => /^[1-9]\d{0,17}$/.test(String(value ?? ''));

// Two entries share this table: "Present — 0 trips" (a reason from ZERO_TRIP_REASONS, a shift, an optional machine)
// and "VTC Training" (shared/vtc-training.mjs: From and To date, no shift, no machine, where it was held in remarks).
// One person has one entry per date, site and shift; saving the other kind for the same shift replaces it.
export function registerShiftAttendance(app,{pool,protect,ensureBooks,today}){
 // VTC Training: every day From to To at once, each in TRAINING_SHIFT, with the same site and employee checks.
 const saveTraining=async(req,res,next)=>{
  try{
   const {kind,fromDate,toDate,location,employeeId,remarks=''}=req.body||{};
   const note=typeof remarks==='string'?remarks.trim():null;
   if(!['vehicle','equipment'].includes(kind)||typeof location!=='string'||!canonicalSiteName(location)||!masterId(employeeId)||
      req.body?.assetId||!note||note.length>2000){
    return res.status(400).json({error:'Select a valid site and employee, and write where the VTC training was held.'});
   }
   const range=trainingDays(fromDate,toDate,today?{today:today()}:{});
   if(range.error)return res.status(400).json({error:range.error});
   requireLogBookSite(req.logBookScope,location);
   const site=canonicalSiteName(location);
   await ensureBooks();
   const {rows}=await pool.query('SELECT id,master_name,record_data FROM master_records WHERE id=ANY($1::bigint[])',[[employeeId]]);
   const employee=rows.find(r=>String(r.id)===String(employeeId)&&employeeMasters.includes(r.master_name))?.record_data;
   if(!employee||!employeeAtLocation(employee,site))return res.status(400).json({error:'Select an employee assigned to this site.'});
   // One statement, so the whole range is saved or none of it.
   await pool.query(`INSERT INTO mis_shift_attendance (book_date,site,shift,employee_id,asset_id,kind,reason,remarks,recorded_by)
    SELECT d::date,$2,$3,$4,NULL,$5,$6,$7,$8 FROM unnest($1::date[]) AS d
    ON CONFLICT (book_date,site,shift,employee_id) DO UPDATE SET
    asset_id=EXCLUDED.asset_id,kind=EXCLUDED.kind,reason=EXCLUDED.reason,remarks=EXCLUDED.remarks,recorded_by=EXCLUDED.recorded_by`,
   [range.days,site,TRAINING_SHIFT,employeeId,kind,VTC_TRAINING_REASON,note,req.session.login||req.session.name||'']);
   res.json({present:true,training:true,days:range.days.length,from:range.days[0],to:range.days.at(-1)});
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
 };
 const save=training=>async(req,res,next)=>{
  try{
   const {kind,bookDate,location,shiftId,shiftCode,employeeId,remarks=''}=req.body||{};
   const assetId=training?null:req.body?.assetId,reason=training?VTC_TRAINING_REASON:req.body?.reason;
   requireOperationalDate(bookDate);
   const standaloneShift=shiftId==null&&(shiftCode==='D'||shiftCode==='N');
   const note=typeof remarks==='string'?remarks.trim():null;
   if(!['vehicle','equipment'].includes(kind)||typeof location!=='string'||!canonicalSiteName(location)||
      !(standaloneShift||(shiftCode==null&&masterId(shiftId)))||!masterId(employeeId)||(assetId&&!masterId(assetId))||
      note===null||note.length>2000||(training
       ?(!note||req.body?.assetId)
       :(!ZERO_TRIP_REASONS.includes(reason)||(reason==='Other'&&!note)))){
    return res.status(400).json({error:training
     ?'Select a valid site, employee and shift, and write where the VTC training was held.'
     :'Select a valid site, employee, shift and reason. Enter remarks for Other.'});
   }
   requireLogBookSite(req.logBookScope,location);
   const site=canonicalSiteName(location);
   await ensureBooks();
   const {rows}=await pool.query('SELECT id,master_name,record_data FROM master_records WHERE id=ANY($1::bigint[])',[[employeeId,...(shiftId?[shiftId]:[]),...(assetId?[assetId]:[])]]);
   const employee=rows.find(r=>String(r.id)===String(employeeId)&&employeeMasters.includes(r.master_name))?.record_data;
   const shift=rows.find(r=>String(r.id)===String(shiftId)&&r.master_name==='Shift Master')?.record_data;
   const asset=rows.find(r=>String(r.id)===String(assetId)&&r.master_name==='Equipment master')?.record_data;
   const code=standaloneShift?shiftCode:bookShiftCode(shift?.shiftCode)||bookShiftCode(shift?.shiftName||shift?.name||shift?.shift);
   if(!employee||!employeeAtLocation(employee,site)||!code||(!standaloneShift&&(canonicalSiteName(shift.site||shift.siteName)!==site||
      shift.sourceMissing||String(shift.status).trim().toLowerCase()==='inactive'||
      (shift.effectiveFrom&&bookDate<shift.effectiveFrom)||(shift.effectiveTo&&bookDate>shift.effectiveTo)))||
      (assetId&&(!asset||assetBookKind(asset)!==kind||canonicalSiteName(asset.currentLocation||asset.site||asset.location)!==site))){
    return res.status(400).json({error:training?'Select an employee and an effective shift of this site.':'Select an employee, effective shift and optional asset assigned to this site.'});
   }
   await pool.query(`INSERT INTO mis_shift_attendance (book_date,site,shift,employee_id,asset_id,kind,reason,remarks,recorded_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (book_date,site,shift,employee_id) DO UPDATE SET
    asset_id=EXCLUDED.asset_id,kind=EXCLUDED.kind,reason=EXCLUDED.reason,remarks=EXCLUDED.remarks,recorded_by=EXCLUDED.recorded_by`,
   [bookDate,site,code,employeeId,assetId||null,kind,reason,note,req.session.login||req.session.name||'']);
   res.json(training?{present:true,training:true}:{present:true,trips:0});
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
 };
 app.post('/api/shift-attendance',...protect,save(false));
 app.post('/api/training-attendance',...protect,saveTraining);
}
