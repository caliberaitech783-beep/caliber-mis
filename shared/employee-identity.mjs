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
// The written forms a saved Employee ID is compared with for this master record. A saved ID matches the record
// when one of its variants (employeeReferenceVariants) is one of these, so a report can index them once.
export function employeeReferenceKeys(record){
 const identity=employeeIdentity(record);
 const primary=[record.caliberId,record.employeeId,record.empId,record.idNo,identity.caliberCode].filter(Boolean);
 // Old records may have only an employee code. Do not confuse an ERP internal
 // code with the numeric suffix of another person's explicit Employee ID.
 const fields=primary.length?primary:[record.employeeCode,record.erpEmployeeCode,record.empCode,record.code];
 return fields.map(field=>String(field||'').trim().toUpperCase().replace(/[\s/-]/g,'')).filter(Boolean);
}
// The same person written with the other prefix (owner, 24 Nov 2026): CMPL9040 and CMLL9040 are one Employee ID. HR
// Pulse writes CMPL, an ERP or login line may hold CMLL or the bare number, and the attendance build reads them all, so
// the attendance match (server/rules/manpower-report.mjs) and Caliber ID Re-check take both prefixes as one person.
// Only the prefix is swapped: a bare number stays as employeeReferenceVariants gives it.
export function samePersonVariants(value=''){
 const variants=employeeReferenceVariants(value),match=variants[0]?.match(/^(?:CMPL|CMLL)(\d+)$/);
 return match?[...new Set([...variants,'CMPL'+match[1],'CMLL'+match[1]])]:variants;
}
export function matchesSamePerson(record,value){
 const variants=samePersonVariants(value);
 return employeeReferenceKeys(record).some(field=>variants.includes(field));
}
// One key per person for CMPL / CMLL forms of the same number ('' when the value is not such an ID).
export const personKey=value=>suggestedCaliberId(String(value??'').trim().toUpperCase().replace(/[\s/-]/g,''));
export function matchesEmployeeReference(record,value){
 const variants=employeeReferenceVariants(value);
 return employeeReferenceKeys(record).some(field=>variants.includes(field));
}
