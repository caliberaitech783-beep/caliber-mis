// The "NO. OF TRIP CARDS" box on a VLB trip card. A driver who runs more than
// 24 trips in a shift fills a second sheet of the same card: the same Form A
// number, door, driver and meters, written "1 / 2" on the first sheet and
// "2 / 2" on the second. Both sheets are one shift record.
const MAX_SHEETS=9;

// "2/2", "2 / 2", "2 of 2" or "2-2" → {sheetNo:2,sheetTotal:2}; anything else → null.
export function parseTripCardSheet(value){
 if(value&&typeof value==='object'){const sheetNo=Number(value.sheetNo),sheetTotal=Number(value.sheetTotal);return validSheet(sheetNo,sheetTotal)?{sheetNo,sheetTotal}:null;}
 const match=String(value??'').trim().match(/^(\d{1,2})\s*(?:\/|\\|-|of|OF|Of)\s*(\d{1,2})$/);
 if(!match)return null;
 const sheetNo=Number(match[1]),sheetTotal=Number(match[2]);
 return validSheet(sheetNo,sheetTotal)?{sheetNo,sheetTotal}:null;
}
const validSheet=(sheetNo,sheetTotal)=>Number.isInteger(sheetNo)&&Number.isInteger(sheetTotal)&&sheetNo>=1&&sheetTotal>=1&&sheetNo<=sheetTotal&&sheetTotal<=MAX_SHEETS;

export const formatTripCardSheet=sheet=>sheet?sheet.sheetNo+'/'+sheet.sheetTotal:'';

// A sheet of a card written on more than one sheet.
export const isMultiSheet=value=>(parseTripCardSheet(value)?.sheetTotal||0)>1;

// Every sheet already held by a saved card: its own box and the sheets joined to it.
export function savedCardSheets(data={}){
 return [data.tripCardSheet,...(Array.isArray(data.joinedSheets)?data.joinedSheets.map(row=>row?.sheet):[])].map(parseTripCardSheet).filter(Boolean);
}
