import {formatScannedDoor} from '../scan-door-text.mjs';
// Older drafts have only a linked master ID. Recover the literal scan text
// without replacing an existing correction, including an intentionally blank one.
export function withScannedDoor(draft={},raw={}){
 const field=raw.gemini?.fields?.door||raw.hybrid?.priorityA?.door;
 const scanned=field?(field.status==='clear'?field.value||'':''):raw.door||'';
 if(Object.hasOwn(draft,'doorText'))return draft.doorText===scanned||draft.doorText===raw.extractionDraft?.doorText?{...draft,doorText:formatScannedDoor(draft.doorText)}:draft;
 return {...draft,doorText:formatScannedDoor(scanned)};
}
