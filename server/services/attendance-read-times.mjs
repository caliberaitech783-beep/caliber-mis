// Where the time of an Attendance read goes (owner, 28 Nov 2026: "plz make the MIS read faster also").
//
// Measured on live that day through HR Pulse, one day of one site: 21 s the first time, 3 to 5 s when the answer was
// already kept, 7.5 s when only the answer had to be written again. Only the total could be seen from outside; which
// step took it had to be worked out with three reads minutes apart. Each read now records its steps:
//  punches     who punched (HR Pulse's machines and the imported punches)
//  entries     the connection, the sites and the zero-trip entries
//  masters     the master lists (kept until one of them changes)
//  batches     the batches and what HR Pulse changed with an OTP
//  signatures  the card fingerprints of every saved site-day
//  keys        the keys of the weeks and of the answer
//  cards       reading the cards of the weeks that were not kept
//  build       building those weeks on a report worker
//  answer      joining the weeks and writing the answer
// The last reads of this server process are kept in memory (no site, no name, no figure of the report: only milliseconds
// and what kind of read it was) and shown under performance.attendanceReads in /api/health; the same steps go out in the
// Server-Timing header of the answer. Nothing is written to the database, and the list starts again after a restart.
import {performance} from 'node:perf_hooks';

const middle=list=>{const sorted=[...list].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor((sorted.length-1)/2)]:0;};

export function createReadTimes({kept=200,now=()=>performance.now(),clock=()=>new Date().toISOString()}={}){
 const reads=[];
 return {
  // One read: mark(step) closes the step that just ran (a step marked twice adds up); done(about) ends the read.
  start(){
   const began=now(),steps={};let last=began;
   return {
    mark(step){const time=now();steps[step]=(steps[step]||0)+(time-last);last=time;},
    done(about={}){
     const entry={at:clock(),ms:Math.round(now()-began),steps:Object.fromEntries(Object.entries(steps).map(([step,ms])=>[step,Math.round(ms)])),...about};
     reads.push(entry);if(reads.length>kept)reads.splice(0,reads.length-kept);
     return {...entry,header:Object.entries(entry.steps).map(([step,ms])=>step+';dur='+ms).join(', ')};
    },
   };
  },
  // The usual (middle) and the worst time of the kept reads, per step and per kind of read, and the newest few.
  stats(){
   const steps=[...new Set(reads.flatMap(read=>Object.keys(read.steps)))];
   const of=list=>({reads:list.length,usualMs:middle(list.map(r=>r.ms)),worstMs:list.length?Math.max(...list.map(r=>r.ms)):0,
    usualSteps:Object.fromEntries(steps.map(step=>[step,middle(list.map(r=>r.steps[step]||0))]))});
   return {...of(reads),since:reads[0]?.at||null,
    answerKept:of(reads.filter(r=>r.from==='kept answer')),built:of(reads.filter(r=>r.from!=='kept answer')),
    latest:reads.slice(-8).reverse()};
  },
 };
}
export const attendanceReadTimes=createReadTimes();
