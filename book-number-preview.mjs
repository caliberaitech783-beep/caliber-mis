import {bookShiftCode,formatBookNumber} from './trip-card-rules.mjs';
import {formatVlbCardNumber} from './vlb-card-number.mjs';
export function previewBookNumber(kind,draft={},sequence=1,shiftName='',source='S'){
 const day=/^\d{4}-\d{2}-\d{2}$/.test(draft.bookDate||'')?draft.bookDate:'';
 const number=String(Math.max(1,Number(sequence)||1)).padStart(3,'0');
 if(kind!=='vehicle')return day?formatBookNumber(kind,day,Number(number)): 'CAL/ELB/DD-MM-YY/'+number;
 const shift=bookShiftCode(draft.bookShiftCode)||bookShiftCode(draft.cardShift)||bookShiftCode(shiftName);
 if(day&&shift)return formatVlbCardNumber(day,shift,Number(number),source);
 return `VLB_${source}/DDTH-MMMYY/${shift||'{S1|S2|S3|D|N}'}/${number}`;
}
export function scanBookPreviewSequence(kind,options,cards,card,draft){
 const shiftName=options?.shifts?.find(s=>String(s.id)===String(draft.shiftId))?.name;
 const shift=bookShiftCode(draft.bookShiftCode)||bookShiftCode(draft.cardShift)||bookShiftCode(shiftName);
 const previous=kind==='vehicle'?options?.vehicleCardCounters?.S?.[draft.bookDate+'/'+shift]:options?.bookNumberCounters?.[kind]?.[draft.bookDate];
 const pending=cards.filter(c=>!['posted','rejected'].includes(c.status)&&c.draft.bookDate===draft.bookDate&&c.ordinal<=(card?.ordinal||1)&&(kind!=='vehicle'||(bookShiftCode(c.draft.bookShiftCode)||bookShiftCode(c.draft.cardShift)||bookShiftCode(options?.shifts?.find(s=>String(s.id)===String(c.draft.shiftId))?.name))===shift)).length;
 return Number(previous||0)+Math.max(1,pending);
}
