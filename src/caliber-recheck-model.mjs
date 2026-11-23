// What the Caliber ID Re-check screen works out from the server's answers (src/caliber-recheck.jsx).
// The server judges one day (or a few) at a time; the screen asks day by day and adds the answers up here.
import {OPERATIONAL_START} from '../shared/operational-start.mjs';
import {RECHECK_REASONS,RECHECK_REASON_ORDER} from '../shared/caliber-recheck.mjs';

export const EVERY='*';
export const dmy=value=>{const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:String(value||'')};
export const when=value=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
export const todayInIndia=(now=Date.now())=>new Date(now+5.5*3600000).toISOString().slice(0,10);
// Every date of the period, oldest first; never before the first operating day.
export function recheckDates(from,to){
 const start=from>=OPERATIONAL_START?from:OPERATIONAL_START,dates=[];
 for(let day=Date.parse(start+'T00:00:00Z');day<=Date.parse(to+'T00:00:00Z')&&dates.length<400;day+=86400000)dates.push(new Date(day).toISOString().slice(0,10));
 return dates;
}
// What is held is the server's answer for each date asked, so a date asked again (after a driver is chosen) simply
// replaces its earlier answer.
// corrected: the cards that carry a correction (owner, 23 Nov 2026: Submit corrects the card at once, so its line
// leaves the list; the count is what shows the work done).
// waitingHr: the cards a site sent to HR ("Number is right, send to HR"): off the site's list, shown on their own.
export const emptyRecheck=()=>({cards:0,confirmed:0,corrected:0,listed:[],waitingHr:[],sites:new Map(),days:0,canApply:false,answers:new Map()});
export function addRecheckAnswer(held,answer){
 const answers=new Map(held.answers);
 answers.set(answer.from,answer);
 const sites=new Map(),listed=[],waitingHr=[];let cards=0,confirmed=0,corrected=0;
 for(const one of [...answers.values()].sort((a,b)=>a.from<b.from?-1:1)){
  cards+=one.cards||0;confirmed+=one.confirmed||0;corrected+=one.corrected||0;listed.push(...(one.listed||[]));waitingHr.push(...(one.waitingHr||[]));
  for(const site of one.sites||[]){const now=sites.get(site.key)||{key:site.key,site:site.site,cards:0,confirmed:0,corrected:0,waitingHr:0};sites.set(site.key,{...now,cards:now.cards+site.cards,confirmed:now.confirmed+(site.confirmed||0),corrected:now.corrected+(site.corrected||0),waitingHr:now.waitingHr+(site.waitingHr||0)});}
 }
 return {cards,confirmed,corrected,listed,waitingHr,sites,days:answers.size,canApply:Boolean(answer.canApply),answers};
}
const countOf=rows=>({listed:rows.length,picked:rows.filter(row=>row.pick).length});
// Step 1: one line per site, the most cards to check on top, and the line of all sites.
export function recheckSiteRows(held){
 const bySite=new Map();
 for(const row of held.listed){if(!bySite.has(row.siteKey))bySite.set(row.siteKey,[]);bySite.get(row.siteKey).push(row);}
 const rows=[...held.sites.values()].map(site=>{const counts=countOf(bySite.get(site.key)||[]);return {id:site.key,key:site.key,site:site.site,cards:site.cards,confirmed:site.confirmed||0,corrected:site.corrected||0,waitingHr:site.waitingHr||0,...counts,open:counts.listed-counts.picked};})
  .sort((a,b)=>b.listed-a.listed||a.site.localeCompare(b.site));
 const all=countOf(held.listed);
 return {rows,total:{id:EVERY,key:EVERY,total:true,site:'All sites',cards:held.cards,confirmed:held.confirmed||0,corrected:held.corrected||0,waitingHr:(held.waitingHr||[]).length,...all,open:all.listed-all.picked}};
}
export const cardsOfSite=(held,siteKey)=>siteKey===EVERY?held.listed:held.listed.filter(row=>row.siteKey===siteKey);
// Step 2: one row per date and shift (and site, when all sites are open) with its cards to check.
export function recheckSlotRows(cards,{manySites=false}={}){
 const slots=new Map();
 for(const row of cards){
  const key=row.date+'|'+(row.shift||'—')+(manySites?'|'+row.siteKey:'');
  if(!slots.has(key))slots.set(key,{key,date:row.date,shift:row.shift||'—',site:row.site,siteKey:row.siteKey,count:0,picked:0,open:0});
  const slot=slots.get(key);slot.count++;if(row.pick)slot.picked++;else slot.open++;
 }
 return [...slots.values()];
}
export const cardsOfSlot=(cards,slot)=>!slot||slot.key===EVERY?cards:cards.filter(row=>row.date===slot.date&&(row.shift||'—')===slot.shift&&(!slot.siteKey||row.siteKey===slot.siteKey));
export const lookAlikeText=row=>(row.lookAlikes||[]).map(person=>person.id+(person.name?' ('+person.name+')':'')).join(', ')+(row.more?' and '+row.more+' more':'');
export const reasonCounts=listed=>RECHECK_REASON_ORDER.map(reason=>({reason,label:RECHECK_REASONS[reason],count:listed.filter(row=>row.reason===reason).length})).filter(row=>row.count);

// The Excel of the list, for a site to fill from its paper cards, and of the corrections done.
const LIST_HEADINGS=['Site','Date','Shift','Book','Book NO','Vehicle / machine','Card NO','Entered by','Saved under','Saved name','Why','What Employee Master says','Look-alike IDs at the site','Right driver chosen','Chosen by'];
export const recheckListSheets=listed=>[{name:'Cards to check',title:'Caliber ID re-check: cards to check',columns:LIST_HEADINGS.map(label=>({label})),
 rows:listed.map(row=>[row.site,dmy(row.date),row.shift,row.book,row.bookNo,row.door,row.cardNo,row.scanned?'Scan':'Manual',row.savedId,row.savedName,row.reasonLabel,row.line,lookAlikeText(row),row.pick?row.pick.employeeId+' '+row.pick.name:'',row.pick?row.pick.by:''])}];
const RECORD_HEADINGS=['Site','Date','Book','Book NO','Why','Was under','Was name','Now under','Now name','Chosen by','Corrected by','Corrected on'];
export const recheckRecordSheets=corrections=>[{name:'Corrections done',title:'Caliber ID re-check: corrections done',columns:RECORD_HEADINGS.map(label=>({label})),
 rows:corrections.map(row=>[row.site,dmy(row.date),row.book,row.bookNo,row.reason,row.from,row.fromName,row.to,row.toName,row.pickedBy,row.appliedBy,when(row.appliedAt)])}];
// The cards a person confirmed as right from the paper card ("This card is right"), for HR.
const CONFIRMED_HEADINGS=['Site','Date','Book','Book NO','Driver kept on the card','Driver name','FORM A box','FORM A box names','Named person','Confirmed by','Confirmed on'];
export const recheckConfirmedSheets=confirmed=>[{name:'Confirmed right',title:'Caliber ID re-check: cards confirmed right',columns:CONFIRMED_HEADINGS.map(label=>({label})),
 rows:confirmed.map(row=>[row.site,dmy(row.date),row.book,row.bookNo,row.driver,row.driverName,row.formA,row.namedId,row.namedName,row.by,when(row.at)])}];
// Waiting for HR, person by person: HR answers for a person, not for each of his cards. One line per person and site,
// the site's people together, the person with the most cards first.
export function recheckHrPeople(waitingHr=[]){
 const people=new Map();
 for(const row of waitingHr){
  const key=row.siteKey+'|'+row.savedId;
  if(!people.has(key))people.set(key,{key,site:row.site,siteKey:row.siteKey,employeeId:row.savedId,name:row.savedName,why:row.reasonLabel,cards:0,first:row.date,last:row.date,senders:new Set()});
  const one=people.get(key);one.cards++;if(row.date<one.first)one.first=row.date;if(row.date>one.last)one.last=row.date;if(row.by)one.senders.add(row.by);
 }
 return [...people.values()].map(({senders,...one})=>({...one,by:[...senders].join(', ')})).sort((a,b)=>a.site.localeCompare(b.site)||b.cards-a.cards||String(a.employeeId).localeCompare(String(b.employeeId)));
}
// The Excel for HR: the people first, with two columns for HR's answer, then their cards.
const HR_PEOPLE_HEADINGS=['Site','Employee ID','Name in Employee Master','Why','Cards waiting','First card','Last card','Sent by','HR to answer: works at this site? (Yes / No)','HR remark'];
const HR_CARD_HEADINGS=['Site','Date','Shift','Book','Book NO','Vehicle / machine','Card NO','Entered by','Saved under','Saved name','Why','What Employee Master says','Sent by','Sent on'];
export const recheckWaitingHrSheets=(waitingHr=[])=>[
 {name:'People for HR',title:'Caliber ID re-check: people waiting for HR',columns:HR_PEOPLE_HEADINGS.map(label=>({label})),
  rows:recheckHrPeople(waitingHr).map(one=>[one.site,one.employeeId,one.name,one.why,one.cards,dmy(one.first),dmy(one.last),one.by,'',''])},
 {name:'Cards waiting for HR',title:'Caliber ID re-check: cards waiting for HR',columns:HR_CARD_HEADINGS.map(label=>({label})),
  rows:waitingHr.map(row=>[row.site,dmy(row.date),row.shift,row.book,row.bookNo,row.door,row.cardNo,row.scanned?'Scan':'Manual',row.savedId,row.savedName,row.reasonLabel,row.line,row.by,when(row.at)])}];
