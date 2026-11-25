// Part 3 of machine coverage (owner, 25 Nov 2026: "close pe rok"). From STOP_FROM (India time) a batch whose report
// date is that day or later is stopped until every machine of its site has an answer (shared/batch-fleet-coverage.mjs):
// - Lock VLB: every VLB machine (card, whole-shift breakdown in Pulse-1, or an idle reason);
// - Lock LMV: every LMV machine, the same way;
// - Close batch: every VLB, ELB and LMV machine (an ELB machine is answered on the ELB fleet list).
// Batches of earlier dates close as before, so nobody has to fill in old shifts. Before that day the batch page only warns.
// It starts after the lock pause (29 Nov) and multi-day batches (1 Dec) end. The Azure setting
// BATCH_COVERAGE_STOP_FROM=YYYY-MM-DD moves the first day; BATCH_COVERAGE_STOP_FROM=off keeps it a warning.
export const STOP_FROM='2026-12-02';
const IST_OFFSET_MS=330*60*1000;
const OFF=['0','off','false','no'];

export function coverageStopFrom(env=process.env){
 const value=String(env?.BATCH_COVERAGE_STOP_FROM||'').trim();
 if(OFF.includes(value.toLowerCase()))return null;
 return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:STOP_FROM;
}

// The moment the stop starts: midnight in India at the start of the first day.
export const coverageStopStartsAt=from=>from?new Date(Date.parse(from+'T00:00:00Z')-IST_OFFSET_MS):null;

// Whether this batch is stopped until its machines are answered.
export function coverageStop(batch,env=process.env,now=new Date()){
 const from=coverageStopFrom(env),startsAt=coverageStopStartsAt(from);
 const reportDate=String(batch?.report_date||batch?.book_date||'').slice(0,10);
 const started=Boolean(startsAt)&&now.getTime()>=startsAt.getTime();
 const active=started&&/^\d{4}-\d{2}-\d{2}$/.test(reportDate)&&reportDate>=from;
 return {active,from};
}

const displayDate=date=>{const [y,m,d]=String(date||'').split('-');return d&&m&&y?d+'-'+m+'-'+y:'';};
export function coverageStopNote(stop){
 if(stop?.active)return 'Every machine needs an answer: Lock VLB, Lock LMV and Close batch are stopped until each machine of the site has a card, a whole-shift breakdown in Pulse-1, or an idle reason.';
 if(stop?.from)return 'Warning only, nothing is stopped yet. From '+displayDate(stop.from)+' a batch of that date or later cannot lock or close until every machine has an answer.';
 return 'Warning only, nothing is stopped.';
}

// The blocker sentence for each book still missing answers; [] when nothing stops.
export function coverageBlockers(coverage,books,stop){
 if(!stop?.active||!coverage?.books)return [];
 const out=[];
 for(const key of books){
  const book=coverage.books[key];
  if(!book||book.complete)continue;
  const shown=book.missing.slice(0,25).map(row=>row.door||row.assetId),more=book.missing.length-shown.length;
  const how=key==='elb'?'Save its ELB on the Equipment ELB list (working, breakdown, maintenance, no operator or not in use).':'Add the card, fetch Pulse-1 or give an idle reason under Machine coverage.';
  out.push(`Every ${book.label} machine needs an answer: ${book.answered}/${book.total} answered; no answer yet: ${shown.join(', ')}${more>0?` and ${more} more`:''}. ${how}`);
 }
 // Machines in breakdown or idle in Pulse-1 are answered from it; when it could not be read they may be among those listed.
 if(out.length&&coverage.pulseRead&&!coverage.pulseRead.ok&&books.some(key=>key!=='elb'))out.push('Pulse-1 could not be read just now ('+coverage.pulseRead.error+'), so machines in breakdown or idle there are not counted: try again in a minute.');
 return out;
}
