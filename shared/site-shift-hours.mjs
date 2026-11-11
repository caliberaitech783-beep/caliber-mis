import {canonicalSiteName} from './site-location.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
export function isJayantSecondShift(r={}){return canonicalSiteName(r.location||r.site||r.siteName)==='jayant ob'&&!['day','night'].includes(r.manualShift)&&bookShiftCode(r.bookShiftCode||r.cardShift||r.shiftCode||r.shiftName||r.shift)==='S2';}
export function validShiftHours(hours,r={}){return isJayantSecondShift(r)?Number(hours)===9:[8,12].includes(Number(hours));}
