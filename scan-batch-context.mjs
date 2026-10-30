import {canonicalSiteName} from './site-location.mjs';
import {tripCardLocation} from './scan-site-match.mjs';
import {CARD_SHIFTS} from './trip-card-rules.mjs';
export function parseScanContext(value){
 const {bookDate,location,cardShift}=value||{};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(bookDate||'')||!Number.isFinite(Date.parse(bookDate+'T00:00:00Z'))||new Date(bookDate+'T00:00:00Z').toISOString().slice(0,10)!==bookDate||typeof location!=='string'||!location.trim()||location.length>200||!Object.hasOwn(CARD_SHIFTS,cardShift))throw new Error('Choose a valid card date, site and shift before scanning or uploading.');
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
export function scanContextGate(context,cards=[]){
 if(!context)return null;
 const active=cards.filter(c=>c.status!=='rejected');
 const waiting=active.some(c=>['queued','reading'].includes(c.status));
 const mismatches=active.filter(c=>!['queued','reading','posted'].includes(c.status)).map(c=>({id:c.id,revision:c.revision,ordinal:c.ordinal,filename:c.filename,issues:scanContextIssues(context,c.draft)})).filter(c=>c.issues.length);
 return {context,waiting,mismatches,blocked:Boolean(context.cancelled||!context.confirmed||waiting||mismatches.length)};
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
