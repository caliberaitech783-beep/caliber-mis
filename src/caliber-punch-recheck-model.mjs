// What the Caliber Punch Re-check screen works out from the server's answers (src/caliber-punch-recheck.jsx).
// The server answers one day at a time (GET /api/caliber-recheck/punches); the screen adds the days up here.
import {OPERATIONAL_START} from '../shared/operational-start.mjs';

export const EVERY='*';
export const PUNCH_DEFAULT_DAYS=7;
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
// The dates first offered: the last 7 days up to today, never before the first operating day.
export function punchDefaultRange(today){
 const from=addDays(today,-(PUNCH_DEFAULT_DAYS-1));
 return {from:from<OPERATIONAL_START?OPERATIONAL_START:from,to:today};
}
export const emptyPunchRecheck=()=>({answers:new Map(),lines:[],sites:new Map(),punches:0,machineErrors:[]});
// A date asked again (after a card is put right) replaces its earlier answer.
export function addPunchAnswer(held,answer){
 const answers=new Map(held.answers);answers.set(answer.from,answer);
 const lines=[],sites=new Map(),errors=new Set();let punches=0;
 for(const one of [...answers.values()].sort((a,b)=>a.from<b.from?-1:1)){
  lines.push(...(one.lines||[]));punches+=one.punches||0;
  if(one.machine?.error)errors.add(one.machine.error);
  for(const site of one.sites||[]){
   const now=sites.get(site.key)||{key:site.key,site:site.site,punched:0,counted:0,toFix:0,noCard:0};
   sites.set(site.key,{...now,punched:now.punched+site.punched,counted:now.counted+site.counted,toFix:now.toFix+site.toFix,noCard:now.noCard+site.noCard});
  }
 }
 return {answers,lines,sites,punches,machineErrors:[...errors]};
}
// Step 1: one line per site, the most people to fix on top, and the line of all sites.
export function punchSiteRows(held){
 const rows=[...held.sites.values()].map(site=>({id:site.key,...site})).sort((a,b)=>b.toFix-a.toFix||a.site.localeCompare(b.site));
 const sum=key=>rows.reduce((total,row)=>total+row[key],0);
 return {rows,total:{id:EVERY,key:EVERY,total:true,site:'All sites',punched:sum('punched'),counted:sum('counted'),toFix:sum('toFix'),noCard:sum('noCard')}};
}
// The lists a Step 1 figure opens (owner, 24 Nov 2026: "make it drill down for all"). 'punched' is every line.
export const PUNCH_VIEWS=[
 {key:'punched',label:'Drivers / operators punched',short:'All punched'},
 {key:'counted',label:'Attendance from a card',short:'Attendance from a card'},
 {key:'toFix',label:'To fix here (a card has an error)',short:'To fix here'},
 {key:'noCard',label:'Punched, no card at all',short:'Punched, no card'},
];
export const STATUS_LABEL={counted:'Attendance from a card',toFix:'Card has an error',noCard:'No card'};
export const ofView=(lines,view)=>view==='punched'?lines:lines.filter(line=>line.status===view);
export const linesOfSite=(held,siteKey,view='toFix')=>ofView(siteKey===EVERY?held.lines:held.lines.filter(line=>line.siteKey===siteKey),view);
// Step 2: one row per date and shift (and site, when all sites are open) with its people to fix.
export function punchSlotRows(lines,{manySites=false}={}){
 const slots=new Map();
 for(const line of lines){
  const key=line.date+'|'+(line.shift||'—')+(manySites?'|'+line.siteKey:'');
  if(!slots.has(key))slots.set(key,{key,date:line.date,shift:line.shift||'—',site:line.site,siteKey:line.siteKey,count:0,own:0});
  const slot=slots.get(key);slot.count++;if(line.ownCard)slot.own++;
 }
 return [...slots.values()];
}
export const linesOfSlot=(lines,slot)=>!slot||slot.key===EVERY?lines:lines.filter(line=>line.date===slot.date&&(line.shift||'—')===slot.shift&&(!slot.siteKey||line.siteKey===slot.siteKey));
// The card a line opens with: the person's own card when there is one, else the first card with an error there.
export const firstCard=line=>line.cards?.[0]?.id||'';
// What the line can do with the chosen card:
//  'shift'   the person's own card names no shift (or two): choose the shift and Save shift;
//  'refresh' the person's own card waits for HR (ID not found, or left): Refresh asks HR Pulse;
//  'other'   another person's card that names no shift: its driver stands, so it is not this person's card;
//  'submit'  put this person on the card (Submit).
export function cardAction(line,card){
 if(!card)return '';
 if(card.pickShift)return card.own?'shift':'other';
 if(card.own&&card.canRefresh)return 'refresh';
 return 'submit';
}
export const cardOption=card=>[card.book,card.bookNo,card.door,card.savedId?'saved under '+card.savedId+(card.savedName?' '+card.savedName:''):'no driver saved',card.reasonLabel].filter(Boolean).join(' · ')+(card.own?' (own card)':'');
