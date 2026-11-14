import {validTripTime} from '../shared/vlb-trip-handover.mjs';
import {isHandoverTimeMark} from '../shared/trip-card-rules.mjs';
import {scanTimeInput} from './scan-time-input.mjs';

export function handoverTimeNote(row={},key){
 if(!['loadingTime','unloadingTime'].includes(key)||row[key])return '';
 const other=key==='loadingTime'?'unloadingTime':'loadingTime';
 if(!validTripTime(scanTimeInput(row[other])))return '';
 return key==='loadingTime'?'Loaded in the previous shift · not counted in this card’s trips or machine summary.':'Open handover · awaiting unloading on the next driver’s card.';
}

export function isBlankHandoverIssue(row,index,key,raw={},reason=''){
 if(!handoverTimeNote(row,key))return false;
 // A literal empty cell is a handover blank; null means unreadable handwriting.
 const source=(raw.gemini||raw.hybrid)?.trips?.r?.find(cell=>cell[0]===(row.rowNumber||index+1));
 const value=source?.[key==='loadingTime'?2:3];
 if(typeof value==='string'&&isHandoverTimeMark(value))return true;
 // A blank loader cell with a recorded unload is a previous-shift load, even when
 // the reader could not turn the word written in its loading cell into a time.
 if(key==='loadingTime'&&source&&source[1]===''&&!String(row.equipmentName??'').trim())return true;
 if(value===null||/unreadable|unclear|ambiguous|conflict|invalid/i.test(reason))return false;
 return value===''||value===undefined&&/blank|missing|not (?:entered|recorded|filled)|handover/i.test(reason);
}
