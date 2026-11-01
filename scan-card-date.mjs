export const MIN_SCAN_CARD_DATE='2026-11-01';
export function validScanCardDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||value<MIN_SCAN_CARD_DATE)return false;
 const date=new Date(value+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function parseScanCardDate(text){
 const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text||'');
 const iso=match?`${match[3]}-${match[2]}-${match[1]}`:'';
 return validScanCardDate(iso)?iso:'';
}
export const displayScanCardDate=value=>validScanCardDate(value)?value.split('-').reverse().join('/'):'';
