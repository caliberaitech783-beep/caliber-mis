import {normalizeScannedTime} from '../scan-clock.mjs';
// Format equivalent clock notation for HTML time inputs; never infer AM/PM.
export function scanTimeInput(value){return normalizeScannedTime(value)??'';}
export function scanTripTimeInputs(rows){return (rows||[]).map(row=>({...row,loadingTime:scanTimeInput(row.loadingTime),unloadingTime:scanTimeInput(row.unloadingTime)}));}
