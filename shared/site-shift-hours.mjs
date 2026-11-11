import {canonicalSiteName} from './site-location.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
export function isJayantSite(r={}){return canonicalSiteName(r.location||r.site||r.siteName)==='jayant ob';}
export function isJayantSecondShift(r={}){return canonicalSiteName(r.location||r.site||r.siteName)==='jayant ob'&&!['day','night'].includes(r.manualShift)&&bookShiftCode(r.bookShiftCode||r.cardShift||r.shiftCode||r.shiftName||r.shift)==='S2';}
export function validShiftHours(hours,r={}){const value=Number(hours);return isJayantSite(r)?Number.isFinite(value)&&value>0&&value<=24:[8,12].includes(value);}
