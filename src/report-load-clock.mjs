// The clock shown while a report reads its data, and the time it took once read (owner's note, 16 Nov 2026:
// "report loading time to be shown"). The Loading Equipment-wise and Trip Timing reports read every log book with its
// trip rows for the dates chosen: for a fortnight that is tens of MB and can take close to a minute, and a bare
// "Loading complete report data…" looked as if the screen had stopped.
// The words keep starting with "Loading": the dashboard waits for a line that starts so before it opens the next Sr No.

export function formatDuration(ms){
 const seconds=Math.max(0,Math.round(Number(ms||0)/1000));
 if(seconds<60)return seconds+' s';
 return Math.floor(seconds/60)+' min '+String(seconds%60).padStart(2,'0')+' s';
}

export function formatBytes(bytes){
 const n=Math.max(0,Number(bytes||0));
 if(n<1048576)return Math.max(1,Math.round(n/1024))+' KB';
 return (n/1048576).toFixed(1)+' MB';
}

export function rangeDays(from,to){
 const days=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
 return Number.isFinite(days)&&days>0?days:0;
}

// The last time this kind of reading took, per kind of reading and number of days, on this computer only.
const STORE='caliber.reportLoadTimes';
export const loadTimeKey=(parts,days)=>(parts||'full')+'|'+days;
function readStore(storage){try{return JSON.parse(storage?.getItem(STORE)||'{}')||{};}catch{return {};}}
export function rememberLoadTime(key,ms,storage=globalThis.localStorage){
 try{const all=readStore(storage);all[key]=Math.round(ms);storage?.setItem(STORE,JSON.stringify(all));}catch{/* a private window keeps nothing */}
}
export function usualLoadTime(key,storage=globalThis.localStorage){
 const ms=Number(readStore(storage)[key]);
 return Number.isFinite(ms)&&ms>0?ms:null;
}

/**
 * The line under the filters while the reading runs.
 * phase: 'waiting' (the server is still reading the database), 'receiving' (the data is arriving), 'building'
 * (all arrived; this screen is drawing the report).
 */
export function loadClockText({phase='waiting',elapsedMs=0,received=0,days=0,usualMs=null}={}){
 const step=phase==='building'?'all data received, drawing the report on this screen'
  :phase==='receiving'?'received '+formatBytes(received)+' so far'
  :'the server is reading '+(days?days+' day'+(days===1?'':'s')+' of ':'the ')+'log books';
 const usual=usualMs&&phase!=='building'?' · last time it took '+formatDuration(usualMs):'';
 return 'Loading complete report data… '+formatDuration(elapsedMs)+' · '+step+usual;
}

/** The note beside the dates once the data is on screen. */
export function loadedText(stats){
 if(!stats?.ms)return '';
 return 'loaded in '+formatDuration(stats.ms)+(stats.bytes?' ('+formatBytes(stats.bytes)+')':'');
}
