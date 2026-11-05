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
export function employeeReferenceVariants(value=''){
 const literal=String(value??'').trim().toUpperCase().replace(/[\s/-]/g,'');
 if(!literal)return [];
 return /^\d+$/.test(literal)?[literal,'CMPL'+literal,'CMLL'+literal]:[literal];
}
export function matchesEmployeeReference(record,value){
 const variants=employeeReferenceVariants(value),identity=employeeIdentity(record);
 const primary=[record.caliberId,record.employeeId,record.empId,record.idNo,identity.caliberCode].filter(Boolean);
 // Old records may have only an employee code. Do not confuse an ERP internal
 // code with the numeric suffix of another person's explicit Employee ID.
 const fields=primary.length?primary:[record.employeeCode,record.erpEmployeeCode,record.empCode,record.code];
 return fields.some(field=>variants.includes(String(field||'').trim().toUpperCase().replace(/[\s/-]/g,'')));
}
