import {canonicalSiteName} from '../../shared/site-location.mjs';

// Finish one scan before exposing an unresolved door to the review screen.
// The retry must read the retained image afresh, not return its OCR cache entry.
export async function recoverFirstScanDoor({kind,extracted,readAgain,extract,onProgress}){
 if(kind!=='vehicle'||extracted.draft.assetId||!extracted.draft.location)return extracted;
 const originalDoor=extracted.draft.doorText||'';
 const recovery={attempted:true,originalDoor,recovered:false};
 extracted.raw.firstScanDoorRecovery=recovery;
 try{
  await onProgress?.('retrying',{reason:'Checking door number against the card image',attempt:2,maxAttempts:2});
  const result=await readAgain({forceRead:true});
  const candidate=await extract(result);
  const site=canonicalSiteName(extracted.draft.location),retrySite=canonicalSiteName(candidate.draft.location);
  if(!candidate.draft.assetId||!site||retrySite!==site)return extracted;
  extracted.draft={...extracted.draft,doorText:candidate.draft.doorText,assetId:candidate.draft.assetId};
  extracted.raw.door=candidate.raw.door;
  extracted.raw.machineNotation=candidate.raw.machineNotation;
  extracted.raw.handwritingCandidates={...extracted.raw.handwritingCandidates,...(candidate.raw.handwritingCandidates?.door?{door:candidate.raw.handwritingCandidates.door}:{})};
  extracted.raw.firstScanDoorRecovery={...recovery,recovered:true,door:candidate.draft.doorText,assetId:candidate.draft.assetId};
 }catch{recovery.unavailable=true;}
 return extracted;
}
