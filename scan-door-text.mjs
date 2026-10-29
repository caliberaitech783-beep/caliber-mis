// User-confirmed fleet notation: the separator in S/14 and S/01 was being
// transcribed as the first '1' in S114 / S101. Apply only this exact shape.
export function formatScannedDoor(value,kind='vehicle'){
 if(kind!=='vehicle')return value??'';
 if(typeof value!=='string')return value??'';
 const match=value.match(/^\s*S\s*(?:1|\/)\s*(\d{2})\s*$/i);
 return match?'S/'+match[1]:value;
}
