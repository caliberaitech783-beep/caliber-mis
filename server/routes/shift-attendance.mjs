import {employeeAtLocation,requireLogBookSite} from '../../shared/log-book-access.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {requireOperationalDate} from '../../shared/operational-start.mjs';
import {assetBookKind} from '../../shared/equipment-kind.mjs';
import {bookShiftCode} from '../../shared/trip-card-rules.mjs';
import {ZERO_TRIP_REASONS} from '../../shared/zero-trip-reasons.mjs';

export const SHIFT_ATTENDANCE_SCHEMA = `
 CREATE TABLE IF NOT EXISTS mis_shift_attendance (
   book_date DATE NOT NULL, site TEXT NOT NULL, shift TEXT NOT NULL,
   employee_id BIGINT NOT NULL, asset_id BIGINT, kind TEXT NOT NULL,
   reason TEXT NOT NULL, remarks TEXT NOT NULL, recorded_by TEXT NOT NULL,
   PRIMARY KEY (book_date, site, shift, employee_id)
 );`;

const employeeMasters = ['Users & employees','C-Dir Employee master','ERP Employee master','Employee master'];
const masterId = value => /^[1-9]\d{0,17}$/.test(String(value ?? ''));

export function registerShiftAttendance(app,{pool,protect,ensureBooks}){
 app.post('/api/shift-attendance',...protect,async(req,res,next)=>{
  try{
   const {kind,bookDate,location,shiftId,shiftCode,employeeId,assetId,reason,remarks=''}=req.body||{};
   requireOperationalDate(bookDate);
   const standaloneShift=shiftId==null&&(shiftCode==='D'||shiftCode==='N');
   const note=typeof remarks==='string'?remarks.trim():null;
   if(!['vehicle','equipment'].includes(kind)||typeof location!=='string'||!canonicalSiteName(location)||
      !(standaloneShift||(shiftCode==null&&masterId(shiftId)))||!masterId(employeeId)||(assetId&&!masterId(assetId))||
      !ZERO_TRIP_REASONS.includes(reason)||note===null||note.length>2000||(reason==='Other'&&!note)){
    return res.status(400).json({error:'Select a valid site, employee, shift and reason. Enter remarks for Other.'});
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
    return res.status(400).json({error:'Select an employee, effective shift and optional asset assigned to this site.'});
   }
   await pool.query(`INSERT INTO mis_shift_attendance (book_date,site,shift,employee_id,asset_id,kind,reason,remarks,recorded_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (book_date,site,shift,employee_id) DO UPDATE SET
    asset_id=EXCLUDED.asset_id,kind=EXCLUDED.kind,reason=EXCLUDED.reason,remarks=EXCLUDED.remarks,recorded_by=EXCLUDED.recorded_by`,
   [bookDate,site,code,employeeId,assetId||null,kind,reason,note,req.session.login||req.session.name||'']);
   res.json({present:true,trips:0});
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
 });
}
