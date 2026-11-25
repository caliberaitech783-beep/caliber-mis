// VLB, LMV and ELB locking paused for five days (owner, 24 Nov 2026: "locking of VLB, LMB and ELB ka lock
// Extended to the end of 1 Dec 2026 (owner, 25 Nov 2026), with the multi-day batch window (shared/multi-day-batches.mjs).
// hata sakta hu kya 5 din ke liye"). While the pause runs, a batch's stages never stop anyone:
// - VLB, LMV and ELB cards can be added and changed in every open stage (VLB open, LMV open, ELB open);
//   a VLB change after Lock VLB updates the machine trips of the batch at once.
// - A batch never waits for an older batch of the site to lock its LMV or close. Until 1 Dec 2026 several shifts
//   of one date may also be VLB-open together (shared/multi-day-batches.mjs).
// - Close batch does Lock VLB and Lock LMV by itself. What a close checks (ELB for every loading machine,
//   transfers, waiting scans, duplicates) is unchanged, and a closed batch is still reopened as before.
// The pause ends by itself at the end of PAUSE_UNTIL (India time). The Azure setting
// VLB_BATCH_LOCK_PAUSE_UNTIL=YYYY-MM-DD moves the last day; VLB_BATCH_LOCK_PAUSE_UNTIL=off ends it at once.
export const PAUSE_UNTIL='2026-12-01';
const IST_OFFSET_MS=330*60*1000;
const OFF=['0','off','false','no'];

export function batchLockPauseUntil(env=process.env){
 const value=String(env?.VLB_BATCH_LOCK_PAUSE_UNTIL||'').trim();
 if(OFF.includes(value.toLowerCase()))return null;
 return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:PAUSE_UNTIL;
}

// The moment the pause ends: midnight in India after the last day.
export const batchLockPauseEndsAt=until=>until?new Date(Date.parse(until+'T00:00:00Z')+86400000-IST_OFFSET_MS):null;

export function batchLockPause(env=process.env,now=new Date()){
 const until=batchLockPauseUntil(env),endsAt=batchLockPauseEndsAt(until);
 const active=Boolean(endsAt)&&now.getTime()<endsAt.getTime();
 return {active,until:active?until:null,endsAt:active?endsAt.toISOString():null};
}

export const batchLocksPaused=(env=process.env,now=new Date())=>batchLockPause(env,now).active;

const displayDate=date=>{const [y,m,d]=String(date||'').split('-');return d&&m&&y?d+'-'+m+'-'+y:'';};
export const batchLockPauseNote=pause=>pause?.active?'Locking is off until '+displayDate(pause.until)+' (end of day): VLB, LMV and ELB cards can be added and changed in every open stage, and Close batch locks VLB and LMV by itself.':'';
