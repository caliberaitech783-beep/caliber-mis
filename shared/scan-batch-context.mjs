import {requireOperationalDate} from './operational-start.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {tripCardLocation} from './scan-site-match.mjs';
import {CARD_SHIFTS} from './trip-card-rules.mjs';
export function parseScanContext(value){
 const {bookDate,location,cardShift}=value||{};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(bookDate||'')||!Number.isFinite(Date.parse(bookDate+'T00:00:00Z'))||new Date(bookDate+'T00:00:00Z').toISOString().slice(0,10)!==bookDate||typeof location!=='string'||!location.trim()||location.length>200||!Object.hasOwn(CARD_SHIFTS,cardShift))throw new Error('Choose a valid card date, site and shift before scanning or uploading.');
 requireOperationalDate(bookDate);
 return {bookDate,location:location.trim(),cardShift,confirmed:false,cancelled:false};
}
export function scanContextReady(value){try{parseScanContext(value);return true}catch{return false}}
export function scanContextIssues(context,draft={}){
 if(!context)return [];
 const issues=[];
 if(draft.bookDate!==context.bookDate||draft.bookDateSource==='system-fallback')issues.push('Date: '+(draft.bookDate||'unreadable')+'; expected '+context.bookDate);
 if(canonicalSiteName(tripCardLocation(draft.location))!==canonicalSiteName(tripCardLocation(context.location)))issues.push('Site: '+(draft.location||'unreadable')+'; expected '+context.location);
 if(draft.cardShift!==context.cardShift)issues.push('Shift: '+(draft.cardShift||'unreadable')+'; expected '+context.cardShift);
 return issues;
}
export function scanContextSelectionChanged(batch,selection){
 return Boolean(batch?.id&&batch.kind==='vehicle'&&(!batch.expected_context?scanContextReady(selection):scanContextIssues(batch.expected_context,selection||{}).length));
}
// Differences between the original extraction (or the edited entry) and the
// batch selection. Since 2 November 2026 these are notes for the reviewer, not
// blocks: the date, site and shift chosen for the batch are the final values on
// every card in it, whatever the driver wrote or the reader extracted.
export function scanCardContextIssues(context,card,input=card.draft){
 const evidence=card.raw_fields,source=evidence?.extractionDraft||{};
 const original=source&&Array.isArray(evidence.locationReadings)&&!evidence.locationReadings.some(value=>String(value||'').trim())?{...source,location:''}:source;
 return [...new Set([...(original?scanContextIssues(context,original):[]),...scanContextIssues(context,input)])];
}
export const CONTEXT_NOTE_PREFIX='Batch values applied. Card shows ';
export function scanContextNotes(context,card,input=card.draft){
 return scanCardContextIssues(context,card,input).map(issue=>CONTEXT_NOTE_PREFIX+issue.replace('; expected ','; batch ')+'.');
}
// The batch selection is the final header of every card in it: the operator
// fixed the date, site and shift before scanning, so a wrong or unreadable
// handwritten header takes the batch values instead of blocking the card.
export function applyScanContext(context,draft){
 if(!context||!draft||typeof draft!=='object')return draft;
 const next={...draft};
 if(next.bookDate!==context.bookDate||['system-fallback','scan-unreadable'].includes(next.bookDateSource)){next.bookDate=context.bookDate;next.bookDateSource='batch';}
 if(canonicalSiteName(tripCardLocation(next.location))!==canonicalSiteName(tripCardLocation(context.location)))next.location=context.location;
 if(next.cardShift!==context.cardShift){next.cardShift=context.cardShift;next.shiftHours=CARD_SHIFTS[context.cardShift]?.hours||next.shiftHours||'';next.shiftId='';}
 return next;
}
export function scanContextGate(context,cards=[]){
 if(!context)return null;
 const active=cards.filter(c=>c.status!=='rejected');
 const waiting=active.some(c=>['queued','reading'].includes(c.status));
 return {context,waiting,mismatches:[],blocked:Boolean(context.cancelled||!context.confirmed||waiting)};
}
export function requireScanUploadContext(kind,value){
 if(kind==='vehicle'||value!==undefined)return parseScanContext(value);
 return null;
}
export function scanContextError(gate){
 if(!gate)return 'Enter the card date, site and marked shift before scanning or uploading.';
 if(gate.mismatches.length)return 'Upload blocked: cards must have the same date, site and marked shift. '+gate.mismatches.map(card=>'Card '+card.ordinal+' ('+(card.filename||card.id)+'): '+card.issues.join('; ')).join(' | ');
 return gate.waiting?'Wait until every page has been read and its date and shift checked.':'Confirm the batch date, site and shift before proceeding.';
}
