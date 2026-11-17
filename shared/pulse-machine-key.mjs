// The key a Pulse breakdown request and an equipment master record are matched on (door number, registration, chassis,
// equipment name). Upper case, letters and digits only.
//
// Found on live data, 17 Nov 2026: 74 machines at Gauri Pauni carry "-" as their registration. "-" turned into an empty
// key, and an empty key matched every Pulse request whose registration was also "-", so every such breakdown at the site
// was put on every such machine (ELB BD hours of about 8 h on nearly every machine, every shift). A key that is empty, a
// placeholder (NA, NIL, NONE …) or has no digit at all does not name one machine, so it never matches.
const PLACEHOLDERS=new Set(['NA','NIL','NONE','NULL','NOTAPPLICABLE','NOTAVAILABLE','TBA','TBD','UNKNOWN','NO','NOREG','NOREGISTRATION']);
export function pulseMachineKey(value){
 const key=String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 if(key.length<2||PLACEHOLDERS.has(key)||!/\d/.test(key)||/^0+$/.test(key))return '';
 return key;
}
// The keys of a list of values that can name one machine, without blanks or placeholders.
export const pulseMachineKeys=(values=[])=>[...new Set(values.map(pulseMachineKey).filter(Boolean))];
