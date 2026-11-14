import {formatTripCardSheet,parseTripCardSheet} from '../../shared/trip-card-sheet.mjs';

// Read beside the named fields, never as one of them: a card whose box is blank
// or unreadable must read exactly as before, with no new review flag.
export const TRIP_CARD_SHEET_RULE='Also return fields.tripCardSheet as {"value":string|null,"status":"clear"|"missing"|"unclear"} from the printed "NO. OF TRIP CARDS" box at the top right of the card, where the driver writes which sheet this is out of how many, for example "1 / 2" on the first of two sheets and "2 / 2" on the second. Return the two numbers as "sheet/total", for example "2/2". It is not FORM A, not the S.N and not the number of trips. Blank box: value null, status missing. Unreadable: value null, status unclear.';

// The sheet box from the model's raw answer, as "2/2", or '' when blank, unclear or not a valid sheet.
export function readTripCardSheet(raw){
 let field;
 try{const parsed=typeof raw==='string'?JSON.parse(raw):raw;field=parsed?.fields?.tripCardSheet;}catch{return '';}
 if(!field||field.status!=='clear')return '';
 return formatTripCardSheet(parseTripCardSheet(field.value));
}
