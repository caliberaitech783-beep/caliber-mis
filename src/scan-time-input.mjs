import {normalizeScannedTime} from '../shared/scan-clock.mjs';
// Format equivalent clock notation for HTML time inputs; never infer AM/PM.
export function scanTimeInput(value){return normalizeScannedTime(value)??'';}
export function scanTripTimeInputs(rows){return (rows||[]).map(row=>({...row,loadingTime:scanTimeInput(row.loadingTime),unloadingTime:scanTimeInput(row.unloadingTime)}));}
export function manualScanTimeInput(value){
 const raw=String(value??'').replace(/[^\d:]/g,'');
 if(raw.includes(':')){const [hours='',minutes='']=raw.split(':');return hours.slice(0,2)+(raw.endsWith(':')||minutes?':'+minutes.slice(0,2):'');}
 const digits=raw.slice(0,4);return digits.length>2?digits.slice(0,2)+':'+digits.slice(2):digits;
}
