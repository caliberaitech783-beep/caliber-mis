// MIS dashboard · Completed in the last 6, 12 and 24 hours.
// Log books: cards saved in the window, by the time of the save (not the date written on the card), because
// sites enter shifts days late. Shifts: a shift counts as completed for VLB when its trip cards were locked,
// for LMV when its LMV log books were locked, and for ELB when the batch was closed.
// A report only: it reads saved cards and batch lock times and changes nothing.
import {canonicalSiteName} from './site-location.mjs';
import {displaySiteName} from './region-scope.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
import {SHIFT_LABELS,displayDate} from './batch-status-report.mjs';

export const RECENT_WINDOWS=[6,12,24];
export const recentWindow=value=>RECENT_WINDOWS.includes(Number(value))?Number(value):0;
export const SHIFT_KINDS=[['vlb','VLB'],['lmv','LMV'],['elb','ELB']];

const ms=value=>value===null||value===undefined||value===''?null:new Date(value).getTime();
// When each stage of a batch was completed. A batch closed under the older one-step rule has no separate
// VLB and LMV lock times, so its closing time stands for all three.
export function batchCompletionTimes(batch){
 const closed=ms(batch.closed_at);
 return {vlb:ms(batch.vlb_locked_at)??closed,lmv:ms(batch.lmv_locked_at)??closed,elb:closed};
}

// cards: [{site, book_type: vehicle|lmv|equipment, h6, h12, h24}] counted by save time.
// batches: [{id, name, site, date, shift, vlb_locked_at, lmv_locked_at, closed_at}].
// kinds: the log book types this login may see (vehicle covers VLB and LMV, equipment covers ELB).
export function buildRecentActivity({now=Date.now(),cards=[],batches=[],kinds=['vehicle','equipment']}){
 const cardKinds=['vehicle','lmv','equipment'].filter(kind=>kinds.includes(kind==='lmv'?'vehicle':kind));
 const shiftKinds=SHIFT_KINDS.map(([key])=>key).filter(key=>kinds.includes(key==='elb'?'equipment':'vehicle'));
 const logs={},shifts={},bySite={};
 for(const hours of RECENT_WINDOWS){
  const sites=new Map();
  for(const row of cards){
   if(!cardKinds.includes(row.book_type))continue;
   const count=Number(row['h'+hours]||0);if(!count)continue;
   const key=canonicalSiteName(row.site),site=sites.get(key)||{site:displaySiteName(row.site),vehicle:0,lmv:0,equipment:0,total:0};
   site[row.book_type]+=count;site.total+=count;sites.set(key,site);
  }
  bySite[hours]=[...sites.values()].sort((a,b)=>a.site.localeCompare(b.site));
  logs[hours]=bySite[hours].reduce((sum,site)=>({total:sum.total+site.total,vehicle:sum.vehicle+site.vehicle,lmv:sum.lmv+site.lmv,equipment:sum.equipment+site.equipment}),{total:0,vehicle:0,lmv:0,equipment:0});
  shifts[hours]={vlb:0,lmv:0,elb:0};
 }
 const widest=Math.max(...RECENT_WINDOWS)*3600000,completed=[];
 for(const batch of batches){
  const times=batchCompletionTimes(batch),code=bookShiftCode(batch.shift)||batch.shift||'';
  for(const kind of shiftKinds){
   const at=times[kind];
   if(at===null||at>now+60000||now-at>widest)continue;
   const hoursAgo=Math.max(0,(now-at)/3600000);
   for(const hours of RECENT_WINDOWS)if(hoursAgo<=hours)shifts[hours][kind]++;
   completed.push({kind,batchId:batch.id||'',batchName:batch.name||'',site:displaySiteName(batch.site),date:batch.date,dateLabel:displayDate(batch.date),
    shift:code,shiftLabel:SHIFT_LABELS[code]||code,at:new Date(at).toISOString(),minutesAgo:Math.floor((now-at)/60000)});
  }
 }
 completed.sort((a,b)=>a.minutesAgo-b.minutesAgo||a.site.localeCompare(b.site));
 return {asOf:new Date(now).toISOString(),windows:RECENT_WINDOWS,cardKinds,shiftKinds,logs,shifts,bySite,completed};
}

// The shifts of one kind completed inside one window, newest first.
export const completedIn=(recent,kind,hours)=>(recent?.completed||[]).filter(row=>row.kind===kind&&row.minutesAgo<=hours*60);

// Site comparison for one window: every site already on the dashboard, with the cards saved in the window.
export function recentSiteRows(recent,hours,sites=[]){
 const found=new Map((recent?.bySite?.[hours]||[]).map(row=>[row.site,row]));
 const names=[...new Set([...sites,...found.keys()])];
 return names.map(site=>({site,vehicle:found.get(site)?.vehicle||0,equipment:found.get(site)?.equipment||0}));
}
