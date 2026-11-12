// Meter cells use a handwritten colon as the decimal separator.
// Apply only to meter values; clock times retain their colons.
export function normalizeScannedMeter(value){
 if(typeof value!=='string')return value;
 const match=value.match(/^\s*(\d+)\s*[:：]\s*(\d+)\s*$/);
 return match?match[1]+'.'+match[2]:value;
}

const text=value=>String(value??'').trim();
const validDifference=(opening,closing,limit)=>Number.isFinite(opening)&&Number.isFinite(closing)&&opening>=0&&closing>=opening&&closing-opening<=limit;
function recoverPair(openingValue,closingValue,limit){
 const openingText=text(openingValue),closingText=text(closingValue);
 if(!/[.:：]/.test(openingText+closingText))return null;
 const opening=Number(normalizeScannedMeter(openingText)),closing=Number(normalizeScannedMeter(closingText));
 if(closing>=opening&&validDifference(opening,closing,limit))return null;
 if(!(closing>=opening))return null;
 const openingDigits=openingText.replace(/[^0-9]/g,''),closingDigits=closingText.replace(/[^0-9]/g,'');
 if(!openingDigits||!closingDigits)return null;
 const width=Math.max(openingDigits.length,closingDigits.length),recoveredOpening=Number(openingDigits.padEnd(width,'0')),recoveredClosing=Number(closingDigits.padEnd(width,'0'));
 if(!validDifference(recoveredOpening,recoveredClosing,limit))return null;
 return {opening:String(recoveredOpening),closing:String(recoveredClosing)};
}
export function recoverScannedMeterDecimals(draft={},kind='vehicle'){
 const hours=Number(draft.shiftHours);if(![8,9,12].includes(hours))return draft;
 let next=draft,changed=false;const corrections=[];
 for(const meter of (kind==='vehicle'?['Hmr','Kmr']:kind==='equipment'?['Hmr']:[])){
  const openingKey='opening'+meter,closingKey='closing'+meter,limit=meter==='Hmr'?hours:250,recovered=recoverPair(draft[openingKey],draft[closingKey],limit);
  if(!recovered)continue;
  if(!changed){next={...draft};changed=true;}
  corrections.push({meter:meter.toUpperCase(),openingFrom:text(draft[openingKey]),closingFrom:text(draft[closingKey]),openingTo:recovered.opening,closingTo:recovered.closing});
  next[openingKey]=recovered.opening;next[closingKey]=recovered.closing;
 }
 return changed?{...next,meterDecimalRecoveries:[...(draft.meterDecimalRecoveries||[]),...corrections]}:draft;
}
