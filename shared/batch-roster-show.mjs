// The batch page's Machine roster (T / BD / ID / NA for every VLB, ELB and LMV machine) is shown from 27 Nov 2026
// 00:00 in India, not on the day it was released (owner, 26 Nov 2026: "ye aaj se nahi hona chahiye ... 27 tarik se").
// Before then the batch page has no roster panel. The stop of shared/batch-coverage-stop.mjs is not changed by this.
// The Azure setting BATCH_ROSTER_SHOW_FROM=YYYY-MM-DD moves the first day; =now shows it at once.
export const ROSTER_SHOW_FROM='2026-11-27';
const IST_OFFSET_MS=330*60*1000;

export function rosterShowFrom(env=process.env){
 const value=String(env?.BATCH_ROSTER_SHOW_FROM||'').trim();
 if(value.toLowerCase()==='now')return null;
 return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:ROSTER_SHOW_FROM;
}

// Whether the batch page shows the Machine roster now.
export function machineRosterShown(env=process.env,now=new Date()){
 const from=rosterShowFrom(env);
 if(!from)return true;
 return now.getTime()>=Date.parse(from+'T00:00:00Z')-IST_OFFSET_MS;
}
