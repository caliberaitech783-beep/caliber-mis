import {canonicalSiteName} from '../site-location.mjs';
import {bookShiftCode,normalizeCardShift,CARD_SHIFTS} from '../trip-card-rules.mjs';
export function vlbEntryContext(batch){return {bookDate:batch.report_date,location:batch.site,cardShift:normalizeCardShift(batch.shift)};}
export function vlbEntryFields(batch,options){
 const context=vlbEntryContext(batch);
 const shift=(options?.shifts||[]).find(s=>canonicalSiteName(s.site)===canonicalSiteName(batch.site)&&!s.sourceMissing&&String(s.status).toLowerCase()!=='inactive'&&(!s.effectiveFrom||s.effectiveFrom<=batch.report_date)&&(!s.effectiveTo||s.effectiveTo>=batch.report_date)&&[s.shiftCode,s.shiftName,s.name].some(v=>bookShiftCode(v)===batch.shift));
 return {...context,bookDateSource:'manual',bookShiftCode:batch.shift,shiftId:shift?String(shift.id):'',shiftHours:CARD_SHIFTS[context.cardShift]?.hours||8};
}
export function sameVlbEntryContext(batch,context){return Boolean(context&&context.bookDate===batch.report_date&&canonicalSiteName(context.location)===canonicalSiteName(batch.site)&&bookShiftCode(context.cardShift||context.bookShiftCode)===batch.shift);}
