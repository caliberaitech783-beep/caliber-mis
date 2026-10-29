import {formatScannedDoor} from '../scan-door-text.mjs';
// Older drafts have only a linked master ID. Recover the literal scan text
// without replacing an existing correction, including an intentionally blank one.
export function withScannedDoor(draft={},raw={},kind=draft.docType==='ELB'?'equipment':'vehicle'){
 const field=raw.gemini?.fields?.door||raw.hybrid?.priorityA?.door;
 const scanned=field?(field.status==='clear'?field.value||'':''):raw.door||'';
 const restore=value=>{const doorText=formatScannedDoor(value,kind),changedDigits=String(value).replace(/\D/g,'')!==String(doorText).replace(/\D/g,'');return {...draft,doorText,...(changedDigits?{assetId:'',manualBreakdownHours:''}:{})};};
 if(Object.hasOwn(draft,'doorText'))return draft.doorText===scanned||draft.doorText===raw.extractionDraft?.doorText?restore(draft.doorText):draft;
 return restore(scanned);
}
