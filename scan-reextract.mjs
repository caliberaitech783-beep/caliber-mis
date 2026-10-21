export function mergeReextractedDraft(previous={},baseline={},fresh={}){
 const result={...fresh};
 for(const [key,value]of Object.entries(previous)){
  if(['meterReviewFields','meterReviewMessages','bookDateSource','extractionReviewFields'].includes(key))continue;
  const empty=value==null||value===''||Array.isArray(value)&&!value.length;
  const unchanged=Object.hasOwn(baseline,key)&&JSON.stringify(value)===JSON.stringify(baseline[key]);
  if(!empty&&!unchanged&&!(key==='bookDate'&&previous.bookDateSource==='system-fallback'))result[key]=value;
 }
 result.bookDateSource=previous.bookDateSource==='manual'?'manual':fresh.bookDateSource;
 result.extractionReviewFields=(fresh.extractionReviewFields||[]).filter(k=>result[k]===fresh[k]);
 result.meterReviewFields=(fresh.meterReviewFields||[]).filter(k=>result[k]===fresh[k]);
 return result;
}
