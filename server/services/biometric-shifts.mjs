export async function readBiometricShifts(pool){
 const {rows}=await pool.query("SELECT record_data FROM master_records WHERE master_name='Shift Master'");
 return rows.map(r=>r.record_data).filter(Boolean);
}
