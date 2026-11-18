// One spelling for every Site and Shift list (owner's correction note, 18 Nov 2026).
// Sites: the old "OB" spelling and the "OC" spelling of a site are one site, shown once by its OC name; a value without a
// letter ("-" left on old cards or masters) is not a site and is not offered. Shifts: every site has its own Shift A, B and
// C in the Shift Master, so an all-sites list would repeat them; one Shift A, Shift B and Shift C are shown instead
// (S1, I, 1 and A all mean Shift A). Dudhichua East's Day and Night shifts stay as their own entries.
import {canonicalSiteName} from './site-location.mjs';
import {displaySiteName} from './region-scope.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
import {shiftDisplayName} from './shift-master.mjs';

const SHIFT_LABELS={S1:'Shift A',S2:'Shift B',S3:'Shift C',D:'Shift Day',N:'Shift Night'};
const SHIFT_ORDER=Object.values(SHIFT_LABELS);

export function isSiteName(value){return /[a-z]/i.test(String(value??''));}

export function sameSite(a,b){return canonicalSiteName(a)===canonicalSiteName(b);}

// Each site once, by its display (OC) name, sorted.
export function siteChoices(values){
  const sites=new Map();
  for(const value of values||[]){
    if(!isSiteName(value))continue;
    const key=canonicalSiteName(value);
    if(!sites.has(key))sites.set(key,displaySiteName(value));
  }
  return [...sites.values()].sort((a,b)=>a.localeCompare(b));
}

export function shiftChoiceLabel(value){
  const text=String(value??'').trim();
  if(!text)return '';
  return SHIFT_LABELS[bookShiftCode(text)]||shiftDisplayName(text);
}

export function sameShift(a,b){return shiftChoiceLabel(a)===shiftChoiceLabel(b);}

// Shift A, B, C, then Day and Night, then any other name.
export function compareShiftLabels(a,b){
  const rank=label=>{const at=SHIFT_ORDER.indexOf(label);return at<0?SHIFT_ORDER.length:at;};
  return rank(a)-rank(b)||String(a).localeCompare(String(b));
}

// Each shift once, in shift order.
export function shiftChoices(values){
  const labels=new Set();
  for(const value of values||[]){const label=shiftChoiceLabel(value);if(label)labels.add(label);}
  return [...labels].sort(compareShiftLabels);
}
