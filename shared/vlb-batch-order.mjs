// Batches of one site open in shift order (owner, 18 Nov 2026): Shift 1, Shift 2, Shift 3, then the
// next day's Shift 1 (Day, Night, then the next day's Day for day / night sites). A batch can be
// created only when the batch of the shift before it exists for that site and its VLB is locked
// (closed, when two-stage batches are off). A missing earlier shift always blocks.
// The rule starts with the batches of VLB_BATCH_ORDER_FROM, so the first of that date's shifts
// needs only the last shift of the day before; earlier dates are not chased further back.
// VLB_BATCH_ORDER_FROM=off switches the rule off.
export const VLB_BATCH_ORDER_FROM='2026-11-19';
const SHIFT_LABELS={S1:'Shift A',S2:'Shift B',S3:'Shift C',D:'Shift Day',N:'Shift Night'};
const PREVIOUS={S2:['same','S1'],S3:['same','S2'],S1:['day','S3'],N:['same','D'],D:['day','N']};
const dayBefore=date=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const displayDate=date=>{const [y,m,d]=date.split('-');return d+'-'+m+'-'+y;};

export function batchOrderFrom(env=process.env){
 const value=String(env.VLB_BATCH_ORDER_FROM||'').trim();
 if(['0','off','false','no'].includes(value.toLowerCase()))return null;
 return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:VLB_BATCH_ORDER_FROM;
}

// The shift that must be locked before {date, shift}, or null when the rule does not cover it.
export function previousBatchScope({date,shift},from=batchOrderFrom()){
 if(!from||!date||date<from||!PREVIOUS[shift])return null;
 const [when,code]=PREVIOUS[shift];
 return {date:when==='day'?dayBefore(date):date,shift:code};
}

export const shiftLabel=code=>SHIFT_LABELS[code]||code;

// Why {date, shift} cannot be created, or '' when it can. `previous` is the earlier shift's batch
// (null when none exists); `locked` says whether its VLB is locked.
export function batchOrderBlock(scope,previous,locked){
 if(!scope||(previous&&locked))return '';
 const what=shiftLabel(scope.shift)+' of '+displayDate(scope.date);
 return previous
  ?'Lock VLB in '+previous.name+' ('+what+') before creating this batch. Batches open in shift order.'
  :'Create and lock VLB for the '+what+' batch of this site first. Batches open in shift order.';
}
