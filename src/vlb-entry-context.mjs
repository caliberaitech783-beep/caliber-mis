import {canonicalSiteName} from '../shared/site-location.mjs';
import {bookShiftCode,normalizeCardShift,CARD_SHIFTS} from '../shared/trip-card-rules.mjs';
export function vlbEntryContext(batch){return {bookDate:batch.report_date,location:batch.site,cardShift:normalizeCardShift(batch.shift)};}
export function vlbEntryFields(batch,options){
 const context=vlbEntryContext(batch);
 const shift=(options?.shifts||[]).find(s=>canonicalSiteName(s.site)===canonicalSiteName(batch.site)&&!s.sourceMissing&&String(s.status).toLowerCase()!=='inactive'&&(!s.effectiveFrom||s.effectiveFrom<=batch.report_date)&&(!s.effectiveTo||s.effectiveTo>=batch.report_date)&&[s.shiftCode,s.shiftName,s.name].some(v=>bookShiftCode(v)===batch.shift));
 return {...context,...(batch.work_order_id?{workOrderId:String(batch.work_order_id)}:{}),bookDateSource:'manual',bookShiftCode:batch.shift,shiftId:shift?String(shift.id):'',shiftHours:CARD_SHIFTS[context.cardShift]?.hours||8};
}
export function sameVlbEntryContext(batch,context){return Boolean(context&&context.bookDate===batch.report_date&&canonicalSiteName(context.location)===canonicalSiteName(batch.site)&&bookShiftCode(context.cardShift||context.bookShiftCode)===batch.shift);}

export async function withLmvEntrySite(options,session,read,storage){
 const sites=options.sites||[];
 const siteOption=site=>sites.find(option=>canonicalSiteName(option)===canonicalSiteName(site));
 if(options.accountLocation){
  const site=siteOption(options.accountLocation);
  return site?{...options,lmvEntrySite:site}:{...options,sites:[...sites,options.accountLocation],lmvEntrySite:options.accountLocation};
 }
 if(sites.length===1)return {...options,lmvEntrySite:sites[0]};
 if(!sites.length)return options;
 try{
  const batchId=(storage??sessionStorage).getItem('vlb-entry-batch:'+String(session.login||session.name||''));
  if(batchId){
   const {batches}=await read('/api/vlb-batches');
   const batch=batches.find(row=>row.id===batchId);
   const site=batch&&siteOption(batch.site);
   if(site)return {...options,lmvEntrySite:site};
  }
 }catch{
  // A previous batch is optional. Leave the site available for normal entry.
 }
 return options;
}
