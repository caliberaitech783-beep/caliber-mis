// caliberId remains the legacy Employee ID storage key used by Oracle and log books.
// caliberCode is the separate, user-facing Caliber ID.
export function suggestedCaliberId(employeeId=''){
  const value=String(employeeId).trim().toUpperCase();
  const match=value.match(/^(?:CMPL|CMLL)?(\d+)$/);
  return match?'CMLL'+match[1]:'';
}
export function employeeIdentity(record){
  const employeeId=String(record.caliberId||record.employeeId||'').trim().toUpperCase();
  return {...record,caliberId:employeeId,employeeId,caliberCode:String(record.caliberCode||suggestedCaliberId(employeeId)).trim().toUpperCase()};
}
