// Trip cards view of Caliber Punch Re-check (owner, 24 Nov 2026: "make this for trip card punch (VLB, ELB & LMV) ...
// create the mechanism for trip cards", and "dono rakho": the bio-punch view stays beside it). It starts from every saved
// VLB, ELB and LMV card of the dates, not from the punches, so a site whose machine sends nothing still shows its cards.
//
// Each card is one of:
//   counted  its driver or operator stands, so it marks attendance; then it has a bio-punch that day or it has none;
//   error    it marks no attendance because of a Caliber ID Re-check reason (fixed on the line: Submit, Save shift, ...);
//   idle     nobody is saved on it and the vehicle or machine did not work, so there is no one to mark.
// The server (GET /api/caliber-recheck/cards, server/routes/caliber-recheck.mjs) judges the cards and reads the punches;
// this file only matches them, so it runs in a test without a database.
import {employeeNumber} from './hr-employee-master.mjs';

const text=value=>String(value??'').trim();
export const CARD_FIGURES=['vlb','elb','lmv','cards','counted','error','idle','punch','noPunch'];
const blankSite=(key,site)=>({key,site,...Object.fromEntries(CARD_FIGURES.map(name=>[name,0]))});
export const bookFigure=book=>book==='ELB'?'elb':book==='LMV'?'lmv':'vlb';

// cards:     every judged card: {id, book ('VLB'|'ELB'|'LMV'), bookNo, door, date, shift, siteKey, site, number, savedId,
//            savedName, status ('counted'|'error'|'idle'), error (the listed row, for an error card)}
// days:      the punch days (shared/trip-biometric-check.mjs mergeBiometricDays)
// cardSites: [{key, site}] every site of the login, so each has a line in Step 1, cards or not
// Returns {lines, sites}: one line per card with its punch ({inTime, outTime, site, source} or null), and per site the
// figures of CARD_FIGURES.
export function cardRecheck({cards=[],days=[],cardSites=[]}){
 const punches=new Map(),sites=new Map(),lines=[];
 for(const day of days){const number=employeeNumber(day.caliberCode);if(number&&day.date&&!punches.has(number+'|'+day.date))punches.set(number+'|'+day.date,day);}
 for(const one of cardSites)if(one?.key&&!sites.has(one.key))sites.set(one.key,blankSite(one.key,one.site));
 for(const card of cards){
  if(!sites.has(card.siteKey))sites.set(card.siteKey,blankSite(card.siteKey,card.site));
  const site=sites.get(card.siteKey);
  site.cards++;site[bookFigure(card.book)]++;site[card.status]++;
  const number=employeeNumber(card.number||card.savedId);
  const day=number?punches.get(number+'|'+card.date):null;
  const punch=day?{inTime:text(day.inTime),outTime:text(day.outTime),site:text(day.site),source:text(day.source)}:null;
  if(card.status==='counted'){if(punch)site.punch++;else site.noPunch++;}
  lines.push({...card,site:site.site,number,punch});
 }
 lines.sort((a,b)=>a.date.localeCompare(b.date)||a.site.localeCompare(b.site)||a.book.localeCompare(b.book)||String(a.bookNo).localeCompare(String(b.bookNo)));
 return {lines,sites:[...sites.values()].sort((a,b)=>b.error-a.error||b.cards-a.cards||a.site.localeCompare(b.site))};
}
// The lists a Step 1 figure opens.
export const CARD_VIEWS=[
 {key:'cards',label:'Trip cards (all)',short:'All cards'},
 {key:'vlb',label:'VLB',short:'VLB'},{key:'elb',label:'ELB',short:'ELB'},{key:'lmv',label:'LMV',short:'LMV'},
 {key:'counted',label:'Attendance marked',short:'Attendance marked'},
 {key:'error',label:'Card error (fix here)',short:'Card error'},
 {key:'punch',label:'Attendance with bio-punch',short:'With bio-punch'},
 {key:'noPunch',label:'Attendance, no bio-punch',short:'No bio-punch'},
 {key:'idle',label:'No driver, did not work',short:'Idle, no driver'},
];
export function cardsOfView(lines,view){
 switch(view){
  case 'vlb':case 'elb':case 'lmv':return lines.filter(line=>bookFigure(line.book)===view);
  case 'counted':case 'error':case 'idle':return lines.filter(line=>line.status===view);
  case 'punch':return lines.filter(line=>line.status==='counted'&&line.punch);
  case 'noPunch':return lines.filter(line=>line.status==='counted'&&!line.punch);
  default:return lines;
 }
}
