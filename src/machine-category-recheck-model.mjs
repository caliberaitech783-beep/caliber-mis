// What the Machine Category Re-check screen works out from the server's answers (src/machine-category-recheck.jsx).
// The server answers one day at a time (GET /api/caliber-recheck/machines); the screen adds the days up here.
export const EVERY='*';
export const emptyMachineRecheck=()=>({answers:new Map(),listed:[],sites:new Map(),cards:0});
// A date asked again replaces its earlier answer.
export function addMachineAnswer(held,answer){
 const answers=new Map(held.answers);answers.set(answer.from,answer);
 const listed=[],sites=new Map();let cards=0;
 for(const one of [...answers.values()].sort((a,b)=>a.from<b.from?-1:1)){
  listed.push(...(one.listed||[]));cards+=one.cards||0;
  for(const site of one.sites||[]){
   const now=sites.get(site.key)||{key:site.key,site:site.site,cards:0,listed:0,machine:0,trip:0};
   sites.set(site.key,{...now,cards:now.cards+site.cards,listed:now.listed+site.listed,machine:now.machine+site.machine,trip:now.trip+site.trip});
  }
 }
 return {answers,listed,sites,cards};
}
// Step 1: one line per site, the most cards to fix on top, and the line of all sites.
export function machineSiteRows(held){
 const rows=[...held.sites.values()].map(site=>({id:site.key,...site})).sort((a,b)=>b.listed-a.listed||a.site.localeCompare(b.site));
 const sum=key=>rows.reduce((total,row)=>total+row[key],0);
 return {rows,total:{id:EVERY,key:EVERY,total:true,site:'All sites',cards:sum('cards'),listed:sum('listed'),machine:sum('machine'),trip:sum('trip')}};
}
export const cardsOfSite=(held,siteKey)=>siteKey===EVERY?held.listed:held.listed.filter(row=>row.siteKey===siteKey);
// Step 2: one row per date and shift (and site, when all sites are open) with its cards to fix.
export function machineSlotRows(cards,{manySites=false}={}){
 const slots=new Map();
 for(const card of cards){
  const key=card.date+'|'+(card.shift||'—')+(manySites?'|'+card.siteKey:'');
  if(!slots.has(key))slots.set(key,{key,date:card.date,shift:card.shift||'—',site:card.site,siteKey:card.siteKey,count:0,machine:0,trip:0});
  const slot=slots.get(key);slot.count++;
  if(card.issues.some(one=>one.where==='machine'))slot.machine++;
  if(card.issues.some(one=>one.where==='trip'))slot.trip++;
 }
 return [...slots.values()];
}
export const cardsOfSlot=(cards,slot)=>!slot||slot.key===EVERY?cards:cards.filter(card=>card.date===slot.date&&(card.shift||'—')===slot.shift&&(!slot.siteKey||card.siteKey===slot.siteKey));
