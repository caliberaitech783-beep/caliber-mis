// Transfer terms captured with every employee transfer request (owner, 19 Nov 2026).
// The browser form and the server both use these lists and this check.
export const ET_TRANSFER_TYPES=['Permanent','Temporary','Deputation'];
export const ET_REASONS=['Business need','Employee request','Promotion','Project close','Disciplinary','Other'];
export const ET_ASSETS=['Laptop','SIM','PPE','Vehicle','ID card'];
export const etTypeNeedsEndDate=type=>type==='Temporary'||type==='Deputation';

const clean=value=>String(value??'').trim();
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

// Returns {terms} when the input is complete, otherwise {error}.
export function employeeTransferTerms(input={},effectiveDate=''){
  const source=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const transferType=clean(source.transferType),reason=clean(source.reason),relievingDate=clean(source.relievingDate),endDate=clean(source.endDate),handoverTo=clean(source.handoverTo);
  if(!ET_TRANSFER_TYPES.includes(transferType))return {error:'Select the transfer type.'};
  if(!ET_REASONS.includes(reason))return {error:'Select the reason for the transfer.'};
  if(!validDate(relievingDate))return {error:'Enter a valid relieving date.'};
  if(validDate(effectiveDate)&&effectiveDate<relievingDate)return {error:'Joining date cannot be before the relieving date.'};
  if(etTypeNeedsEndDate(transferType)){
    if(!validDate(endDate))return {error:`Enter the end date of the ${transferType.toLowerCase()} transfer.`};
    if(validDate(effectiveDate)&&endDate<=effectiveDate)return {error:'End date must be after the joining date.'};
  }else if(endDate)return {error:'A permanent transfer has no end date.'};
  if(handoverTo.length>200)return {error:'Charge handed to must be at most 200 characters.'};
  const assets=Array.isArray(source.assets)?source.assets.map(clean):[];
  if(assets.some(asset=>!ET_ASSETS.includes(asset)))return {error:'Select returned assets from the list.'};
  return {terms:{transferType,reason,relievingDate,endDate:etTypeNeedsEndDate(transferType)?endDate:'',handoverTo,assets:ET_ASSETS.filter(asset=>assets.includes(asset))}};
}

// A draft may be incomplete: keep only known answers, each short text, and list values from the lists.
export const ET_DRAFT_KEYS=['destination','effectiveDate','transferType','reason','relievingDate','endDate','handoverTo','remarks'];
export function employeeTransferDraftTerms(input={}){
  const source=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const terms={};
  for(const key of ET_DRAFT_KEYS){const value=source[key]??'';if(typeof value!=='string'||value.length>2000)return {error:'Draft answers must be text of at most 2000 characters.'};terms[key]=value.trim();}
  if(terms.transferType&&!ET_TRANSFER_TYPES.includes(terms.transferType))return {error:'Select the transfer type.'};
  if(terms.reason&&!ET_REASONS.includes(terms.reason))return {error:'Select the reason for the transfer.'};
  terms.assets=Array.isArray(source.assets)?ET_ASSETS.filter(asset=>source.assets.includes(asset)):[];
  return {terms};
}
