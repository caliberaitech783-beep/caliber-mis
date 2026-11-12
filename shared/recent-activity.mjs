// MIS dashboard · Completed in the last 6, 12 and 24 hours.
// Log books: cards saved in the window, by the time of the save (not the date written on the card), because
// sites enter shifts days late. Shifts: a shift counts as completed for VLB when its trip cards were locked,
// for LMV when its LMV log books were locked, and for ELB when the batch was closed.
// Beside each completed shift: the cards inside it (trip cards, LMV log books, ELB cards).
// A report only: it reads saved cards and batch lock times and changes nothing.
import {canonicalSiteName} from './site-location.mjs';
import {displaySiteName} from './region-scope.mjs';
import {bookShiftCode} from './trip-card-rules.mjs';
import {SHIFT_LABELS,displayDate} from './batch-status-report.mjs';

export const RECENT_WINDOWS=[6,12,24];
export const recentWindow=value=>RECENT_WINDOWS.includes(Number(value))?Number(value):0;
export const SHIFT_KINDS=[['vlb','VLB'],['lmv','LMV'],['elb','ELB']];
// What is counted inside a completed shift of each kind.
export const SHIFT_CARD_NOUNS={vlb:'trip cards',lmv:'LMV log books',elb:'ELB cards'};
const CARD_KINDS=['vehicle','lmv','equipment'];
const SHIFT_ORDER=['S1','S2','S3','D','N',''];

const ms=value=>value===null||value===undefined||value===''?null:new Date(value).getTime();
const scopeKey=(site,date,shift)=>canonicalSiteName(site)+'|'+date+'|'+(bookShiftCode(shift)||shift||'');
const emptyCount=()=>({total:0,vehicle:0,lmv:0,equipment:0});
const sameSite=(a,b)=>canonicalSiteName(a)===canonicalSiteName(b);
// When each stage of a batch was completed. A batch closed under the older one-step rule has no separate
// VLB and LMV lock times, so its closing time stands for all three.
export function batchCompletionTimes(batch){
 const closed=ms(batch.closed_at);
 return {vlb:ms(batch.vlb_locked_at)??closed,lmv:ms(batch.lmv_locked_at)??closed,elb:closed};
}

// cards: [{site, book_type: vehicle|lmv|equipment, date, shift, h6, h12, h24}] counted by save time.
// batches: [{id, name, site, date, shift, vlb_locked_at, lmv_locked_at, closed_at, cards, machines_saved}];
//  cards = trip cards saved in the batch, machines_saved = ELB cards saved in the batch.
// lmvBooks: [{site, date, shift, count}] LMV log books, which are kept by site, date and shift, not by batch.
// kinds: the log book types this login may see (vehicle covers VLB and LMV, equipment covers ELB).
export function buildRecentActivity({now=Date.now(),cards=[],batches=[],lmvBooks=[],kinds=['vehicle','equipment']}){
 const cardKinds=CARD_KINDS.filter(kind=>kinds.includes(kind==='lmv'?'vehicle':kind));
 const shiftKinds=SHIFT_KINDS.map(([key])=>key).filter(key=>kinds.includes(key==='elb'?'equipment':'vehicle'));
 const logs={},shifts={},shiftCards={},bySite={},logGroups=new Map();
 for(const hours of RECENT_WINDOWS){
  const sites=new Map();
  for(const row of cards){
   if(!cardKinds.includes(row.book_type))continue;
   const count=Number(row['h'+hours]||0);if(!count)continue;
   const key=canonicalSiteName(row.site),site=sites.get(key)||{site:displaySiteName(row.site),vehicle:0,lmv:0,equipment:0,total:0};
   site[row.book_type]+=count;site.total+=count;sites.set(key,site);
   // The same cards by card date and shift, for the list that opens from a site.
   const shift=bookShiftCode(row.shift)||'',date=row.date||'',groupKey=key+'|'+date+'|'+shift;
   const group=logGroups.get(groupKey)||{site:site.site,date,dateLabel:displayDate(date),shift,shiftLabel:SHIFT_LABELS[shift]||shift,counts:Object.fromEntries(RECENT_WINDOWS.map(h=>[h,emptyCount()]))};
   group.counts[hours][row.book_type]+=count;group.counts[hours].total+=count;logGroups.set(groupKey,group);
  }
  // Highest first, so the busiest site is on top.
  bySite[hours]=[...sites.values()].sort((a,b)=>b.total-a.total||a.site.localeCompare(b.site));
  logs[hours]=bySite[hours].reduce((sum,site)=>({total:sum.total+site.total,vehicle:sum.vehicle+site.vehicle,lmv:sum.lmv+site.lmv,equipment:sum.equipment+site.equipment}),emptyCount());
  shifts[hours]={vlb:0,lmv:0,elb:0};
 }
 const lmvByScope=new Map();
 for(const book of lmvBooks){const key=scopeKey(book.site,book.date,book.shift);lmvByScope.set(key,(lmvByScope.get(key)||0)+Number(book.count||0));}
 const widest=Math.max(...RECENT_WINDOWS)*3600000,completed=[];
 for(const batch of batches){
  const times=batchCompletionTimes(batch),code=bookShiftCode(batch.shift)||batch.shift||'';
  const inside={vlb:Number(batch.cards||0),lmv:lmvByScope.get(scopeKey(batch.site,batch.date,batch.shift))||0,elb:Number(batch.machines_saved||0)};
  for(const kind of shiftKinds){
   const at=times[kind];
   if(at===null||at>now+60000||now-at>widest)continue;
   const hoursAgo=Math.max(0,(now-at)/3600000);
   for(const hours of RECENT_WINDOWS)if(hoursAgo<=hours)shifts[hours][kind]++;
   completed.push({kind,batchId:batch.id||'',batchName:batch.name||'',site:displaySiteName(batch.site),date:batch.date,dateLabel:displayDate(batch.date),
    shift:code,shiftLabel:SHIFT_LABELS[code]||code,cards:inside[kind],at:new Date(at).toISOString(),minutesAgo:Math.floor((now-at)/60000)});
  }
 }
 completed.sort((a,b)=>a.minutesAgo-b.minutesAgo||a.site.localeCompare(b.site));
 const recent={asOf:new Date(now).toISOString(),windows:RECENT_WINDOWS,cardKinds,shiftKinds,logs,shifts,shiftCards,bySite,completed,
  logShifts:[...logGroups.values()].sort((a,b)=>b.date.localeCompare(a.date)||SHIFT_ORDER.indexOf(a.shift)-SHIFT_ORDER.indexOf(b.shift)||a.site.localeCompare(b.site))};
 for(const hours of RECENT_WINDOWS)shiftCards[hours]=Object.fromEntries(SHIFT_KINDS.map(([kind])=>[kind,cardsInside(completedIn(recent,kind,hours))]));
 return recent;
}

// The shifts of one kind completed inside one window, newest first; with a site, that site's only.
export const completedIn=(recent,kind,hours,site='')=>(recent?.completed||[]).filter(row=>row.kind===kind&&row.minutesAgo<=hours*60&&(!site||sameSite(row.site,site)));

// Cards inside a list of completed shifts. LMV log books belong to a site, date and shift, so two batches
// of the same shift never add the same log books twice.
export function cardsInside(rows){
 const seen=new Set();let total=0;
 for(const row of rows){
  if(row.kind==='lmv'){const key=canonicalSiteName(row.site)+'|'+row.date+'|'+row.shift;if(seen.has(key))continue;seen.add(key);}
  total+=Number(row.cards||0);
 }
 return total;
}

// One window's completed shifts of one kind, site by site: the site with the most shifts on top.
export function completedBySite(recent,kind,hours){
 const sites=new Map();
 for(const row of completedIn(recent,kind,hours)){const key=canonicalSiteName(row.site),entry=sites.get(key)||{site:row.site,rows:[]};entry.rows.push(row);sites.set(key,entry);}
 return [...sites.values()].map(({site,rows})=>({site,shifts:rows.length,cards:cardsInside(rows)})).sort((a,b)=>b.shifts-a.shifts||b.cards-a.cards||a.site.localeCompare(b.site));
}

// One site's saved cards in one window by card date and shift: newest card date first, then shift 1, 2, 3.
export const logShiftsFor=(recent,site,hours)=>(recent?.logShifts||[]).filter(row=>sameSite(row.site,site)&&row.counts[hours]?.total>0);

// Site comparison for one window: every site already on the dashboard, with the cards saved in the window.
export function recentSiteRows(recent,hours,sites=[]){
 const found=new Map((recent?.bySite?.[hours]||[]).map(row=>[row.site,row]));
 const names=[...new Set([...sites,...found.keys()])];
 return names.map(site=>({site,vehicle:found.get(site)?.vehicle||0,equipment:found.get(site)?.equipment||0}));
}
