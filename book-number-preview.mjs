import {bookShiftCode,formatBookNumber} from './trip-card-rules.mjs';
export function previewBookNumber(kind,draft={},sequence=1,shiftName=''){
 const day=/^\d{4}-\d{2}-\d{2}$/.test(draft.bookDate||'')?draft.bookDate:'';
 const number=String(Math.max(1,Number(sequence)||1)).padStart(kind==='vehicle'?4:3,'0');
 if(kind!=='vehicle')return day?formatBookNumber(kind,day,Number(number)): 'CAL/ELB/DD-MM-YY/'+number;
 const shift=bookShiftCode(draft.cardShift)||bookShiftCode(shiftName);
 if(day&&shift)return formatBookNumber(kind,day,Number(number),shift);
 const date=day?day.slice(8,10)+day.slice(5,7)+day.slice(2,4):'DDMMYY';
 return `CAL/VLB/${date}/${shift||'{S1|S2|S3|D|N}'}/${number}`;
}
