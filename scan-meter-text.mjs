// Meter cells use a handwritten colon as the decimal separator.
// Apply only to meter values; clock times retain their colons.
export function normalizeScannedMeter(value){
 if(typeof value!=='string')return value;
 const match=value.match(/^\s*(\d+)\s*[:：]\s*(\d+)\s*$/);
 return match?match[1]+'.'+match[2]:value;
}
