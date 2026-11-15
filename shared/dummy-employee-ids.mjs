// Shared dummy IDs, one per site, used on cards of temporary drivers and operators
// (owner, 15 November 2026). Many different people work under one of these IDs, in
// several shifts of one day, so no per-person check applies to them: no driver HMR
// limit across vehicles, no "same driver" duplicate card, no relief-operator refusal,
// and no OT / multiple-duty flags. Checks on the machine itself (asset HMR, KMR) stay.
export const DUMMY_EMPLOYEE_IDS=Object.freeze([
 {id:'CMLL18152',name:'DCH EAST',site:'DCH EAST OC'},
 {id:'CMLL12893',name:'DCH OB',site:'DCH WEST OC'},
 {id:'CMLL8856',name:'ABC',site:'JAYANT OC'},
 {id:'CMLL12238',name:'ABC',site:'SASTI OC'},
 {id:'CMLL17805',name:'ABC',site:'DHOPTALA OC'},
 {id:'CMLL15602',name:'TEASTING',site:'GAURI POUNI OC'},
 {id:'CMLL12227',name:'ABC',site:'MAJRI OC'},
]);

const DUMMY=new Set(DUMMY_EMPLOYEE_IDS.map(row=>row.id));

// An Employee ID (CMPL…) and its Caliber ID (CMLL…) share the number, so either spelling,
// with or without spaces ("CMLL 12238"), names the dummy ID.
export function isDummyEmployeeId(value){
 const match=String(value??'').toUpperCase().replace(/[\s/-]/g,'').match(/^(?:CMLL|CMPL)(\d+)$/);
 return Boolean(match&&DUMMY.has('CMLL'+match[1]));
}

// The card's main driver / operator is one of the dummy IDs.
export function cardHasDummyEmployee(data={}){
 return [data.caliberId,data.caliberCode,data.employeeCode].some(isDummyEmployeeId);
}
