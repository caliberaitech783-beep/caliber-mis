// Normalize explicit hour/minute notation only. Never infer a missing part or AM/PM.
export function normalizeScannedTime(value){
 if(typeof value!=='string')return value;
 if(!value.trim())return '';
 const match=value.trim().match(/^(\d{1,2})\s*[:.]\s*(\d{1,2})$/);
 if(!match||Number(match[1])>23||Number(match[2])>59)return value;
 return match[1].padStart(2,'0')+':'+match[2].padStart(2,'0');
}
export const validScannedTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalizeScannedTime(value));
