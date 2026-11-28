// "Present — 0 trips" entries (owner, 24 Nov 2026: "0 trip report needs to be shown in VLB report"). A driver marked
// present with 0 trips from VLB Manual is kept in mis_shift_attendance, not as a log book card, so the batch report
// read only cards and left them out. A VLB batch now lists the vehicle entries of its own site, date and shift.
import {canonicalSiteName} from './site-location.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {isAwayEntry} from './vtc-training.mjs';

const text=value=>String(value??'').trim();
const employeeCodeOf=r=>text(r.employeeId||r.empId||r.employeeCode||r.empCode||r.caliberId||r.code||r.idNo);

export const ZERO_TRIP_ENTRY_SQL=`SELECT a.book_date::text AS date,a.site,a.shift,a.employee_id::text AS employee_id,a.asset_id::text AS asset_id,
 a.reason,a.remarks,a.recorded_by,e.record_data AS employee,v.record_data AS asset
 FROM mis_shift_attendance a
 LEFT JOIN master_records e ON e.id=a.employee_id
 LEFT JOIN master_records v ON v.id=a.asset_id
 WHERE a.kind='vehicle' AND a.book_date=$1::date AND a.reason NOT IN ('VTC Training','On Duty (OD)')
 ORDER BY a.site,a.shift,a.employee_id`;

// The rows of one batch: same site (by its canonical name), date and shift code.
// A VTC Training or OD entry (shared/vtc-training.mjs) is not a zero-trip entry and is never listed here.
export function vlbZeroTripEntries(rows=[],batch={}){
 const site=canonicalSiteName(batch.site),shift=bookShiftCode(batch.shift);
 return rows.filter(r=>!isAwayEntry(r)&&r.date===batch.report_date&&canonicalSiteName(r.site)===site&&bookShiftCode(r.shift)===shift).map(r=>{
  const e=r.employee||{},a=r.asset||{};
  return {id:`zero-trip:${r.date}:${shift}:${r.employee_id}`,employeeName:text(e.employee||e.name||e.login),caliberId:employeeCodeOf(e),
   door:r.asset_id?text(a.door||a.doorNo||equipmentDoorNumber(a)):'',vehicle:r.asset_id?text(a.equipmentName||a.equipment||a.name||a.group):'',
   reason:text(r.reason),remarks:text(r.remarks),recordedBy:text(r.recorded_by),trips:0};
 });
}

// The entries of a batch, or none when the attendance table was never made on this database.
export async function readVlbZeroTripEntries(client,batch){
 const table=(await client.query("SELECT to_regclass('mis_shift_attendance') AS name"))?.rows?.[0]?.name;
 if(!table)return [];
 return vlbZeroTripEntries((await client.query(ZERO_TRIP_ENTRY_SQL,[batch.report_date])).rows||[],batch);
}
