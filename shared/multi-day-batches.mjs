// Batches for several days open together for seven days (owner, 25 Nov 2026: "I need to open multiple
// batch for multiple days....fix it for 7 days"). While the window runs:
// - An open batch of an earlier report date no longer stops a batch of a later date ("Fully close … first").
// - The shift-order rule (shared/vlb-batch-order.mjs: the shift before must exist with VLB locked) is off.
// - No batch waits for an older batch of the site to lock LMV or close (server/rules/vlb-batch-queue.mjs).
// - Several shifts of the same date open together (owner, 25 Nov 2026: "allow multiple shifts of same date
//   open too"): no Lock VLB first, and the index mis_vlb_one_open_vlb_per_site_date is dropped at start.
//   Unlock VLB and reopen are not stopped by another open batch either.
// Still kept: one batch per site, date and shift. After the window the index returns at the next start,
// only when no site and date still holds two VLB-open batches (server/rules/vlb-batch-policy.mjs).
// The window ends by itself at the end of MULTI_DAY_UNTIL (India time). The Azure setting
// VLB_MULTI_DAY_BATCHES_UNTIL=YYYY-MM-DD moves the last day; VLB_MULTI_DAY_BATCHES_UNTIL=off ends it at once.
// Ended early by the owner on 27 Nov 2026 ("ek site par at a time 1 hi batch open hona chahiye"): the window
// closed with the end of 26 Nov 2026, so the old rules are back. Batches already open stay open and are closed
// as usual; no new batch opens at a site while an earlier one is open there.
export const MULTI_DAY_UNTIL='2026-11-26';
const IST_OFFSET_MS=330*60*1000;
const OFF=['0','off','false','no'];

export function multiDayBatchesUntil(env=process.env){
 const value=String(env?.VLB_MULTI_DAY_BATCHES_UNTIL||'').trim();
 if(OFF.includes(value.toLowerCase()))return null;
 return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:MULTI_DAY_UNTIL;
}

export const multiDayBatchesEndAt=until=>until?new Date(Date.parse(until+'T00:00:00Z')+86400000-IST_OFFSET_MS):null;

export function multiDayBatches(env=process.env,now=new Date()){
 const until=multiDayBatchesUntil(env),endsAt=multiDayBatchesEndAt(until);
 return Boolean(endsAt)&&now.getTime()<endsAt.getTime();
}
