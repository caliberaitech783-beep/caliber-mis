// This ceiling belongs to a scan entry, never to the final shift batch.
export const MAX_SCAN_ENTRY_CARDS=40;
export function scanEntryRemaining(count){return Math.max(0,MAX_SCAN_ENTRY_CARDS-Number(count||0));}
export function requireScanEntrySpace(count){
 if(!scanEntryRemaining(count))throw Object.assign(new Error('This scan entry has reached 40 cards. Start a new scan entry for the remaining cards; Create Batch combines saved entries for the same date, location and shift.'),{status:409});
}
