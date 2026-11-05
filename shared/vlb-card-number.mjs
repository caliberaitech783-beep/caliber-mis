import {bookShiftCode} from './trip-card-rules.mjs';

export const VLB_CARD_COUNTER_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_vlb_card_counters(
 book_date DATE NOT NULL,shift TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('M','S')),
 last_number INTEGER NOT NULL CHECK(last_number>0),PRIMARY KEY(book_date,shift,source));`;
export const vlbCardSource=data=>data?.scanCardId?'S':'M';
export function formatVlbCardNumber(date,shift,sequence,source='M'){
 const code=bookShiftCode(shift),[year,month,day]=String(date).split('-');
 if(!code)throw new Error('Select a valid shift before generating a VLB card number.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Select a valid card date.');
 if(!['M','S'].includes(source)||!Number.isSafeInteger(Number(sequence))||Number(sequence)<1)throw new Error('Invalid card numbering reference.');
 const n=Number(day),suffix=n%100>=11&&n%100<=13?'TH':({1:'ST',2:'ND',3:'RD'}[n%10]||'TH');
 return `VLB_${source}/${n}${suffix}-${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(month)-1]}${year.slice(-2)}/${code}/${String(sequence).padStart(3,'0')}`;
}
export async function allocateVlbCardNumber(client,data){
 const shift=bookShiftCode(data.bookShiftCode)||bookShiftCode(data.cardShift)||bookShiftCode(data.shiftName),source=vlbCardSource(data);
 // Validate before allocation. The counter row serializes concurrent saves for
 // this date, shift and source; the caller's transaction rolls it back on error.
 formatVlbCardNumber(data.bookDate,shift,1,source);
 const {rows}=await client.query(`INSERT INTO mis_vlb_card_counters(book_date,shift,source,last_number) VALUES($1,$2,$3,1)
 ON CONFLICT(book_date,shift,source) DO UPDATE SET last_number=mis_vlb_card_counters.last_number+1 RETURNING last_number`,[data.bookDate,shift,source]);
 return formatVlbCardNumber(data.bookDate,shift,Number(rows[0].last_number),source);
}
