// Caliber Punch Re-check (owner, 24 Nov 2026: "caliber punch recheck mis me hi, caliber id recheck ke niche"): the
// people who punched on the biometric machine but get no attendance from a trip card, because a VLB, ELB or LMV card
// of their site and date carries an error (the Caliber ID Re-check reasons: a wrong or unknown ID, no driver, Employee
// ID and Caliber ID that differ, no shift or two). Each such person is set beside the cards with an error at that site
// on that date, their own card first, and the card is put right from the same line (Submit puts the person on the
// card, Save shift writes the shift), through the Caliber ID Re-check routes.
//
// The server (GET /api/caliber-recheck/punches, server/routes/caliber-recheck.mjs) reads the punches and the cards;
// this file only matches them, so it runs in a test without a database.
import {canonicalSiteName} from './site-location.mjs';
import {employeeNumber} from './hr-employee-master.mjs';
import {drivesOrOperates,employeeDesignation,EMPLOYEE_LISTS} from './caliber-id-check.mjs';

const text=value=>String(value??'').replace(/\s+/g,' ').trim();
const siteOfRecord=record=>canonicalSiteName(text(record?.currentLocation||record?.site||record?.location));
const leftRecord=record=>record?.hrLeft===true||/^(left|resigned|inactive)$/i.test(text(record?.status));
export const recordNumberOf=record=>employeeNumber(record?.caliberId)||employeeNumber(record?.caliberCode)||employeeNumber(record?.employeeId)||employeeNumber(record?.empId);

// number -> the master lines of that number (Employee Master and the old lists).
export function peopleByNumber(masters){
 const byNumber=new Map();
 for(const row of masters||[]){
  if(!EMPLOYEE_LISTS.includes(row.master_name))continue;
  const number=recordNumberOf(row.record_data);
  if(number)(byNumber.get(number)||byNumber.set(number,[]).get(number)).push(row);
 }
 return byNumber;
}
// The line of a number to show and to put on a card: the working line at the site first, then any working line.
export function personAt(byNumber,number,siteKey){
 const rows=byNumber.get(number)||[];
 const working=rows.filter(row=>!leftRecord(row.record_data));
 const row=working.find(one=>siteOfRecord(one.record_data)===siteKey)||working[0]||rows[0];
 if(!row)return null;
 const record=row.record_data||{};
 return {rowId:String(row.id),number,caliberId:text(record.caliberCode||record.caliberId)||'CMLL'+number,name:text(record.name||record.employee),designation:employeeDesignation(record),left:leftRecord(record)};
}

// days:     the punch days (shared/trip-biometric-check.mjs mergeBiometricDays): {caliberCode, date, site, inTime, outTime, source}
// standing: Set of 'number|date' for every person a card of that date counts (its driver stands, or it was confirmed right)
// listed:   the cards with an error (the rows GET /api/caliber-recheck lists): {id, date, siteKey, site, shift, savedId, ...}
// masters:  the master lines (Employee Master, ERP and C-Dir lists)
// allowed:  site -> true when the login holds that site
// Returns {lines, sites}: one line per person and date that punched, has no counted card and has a card with an error
// at the site of the punch on that date; and per site the punched drivers and operators, those a card counts, those to
// fix here and those with no card at all.
export function punchRecheck({days=[],standing=new Set(),listed=[],masters=[],allowed=()=>true,siteLabel=site=>site}){
 const byNumber=peopleByNumber(masters),bySiteDate=new Map(),sites=new Map(),lines=[];
 for(const card of listed){const key=card.siteKey+'|'+card.date;(bySiteDate.get(key)||bySiteDate.set(key,[]).get(key)).push(card);}
 for(const day of days){
  const number=employeeNumber(day.caliberCode);
  if(!number||!day.date)continue;
  const home=(byNumber.get(number)||[]).map(row=>siteOfRecord(row.record_data)).find(Boolean)||'';
  const siteKey=canonicalSiteName(text(day.site))||home;
  if(!siteKey)continue;
  const person=personAt(byNumber,number,siteKey);
  // Drivers and operators only: helpers, mechanics and staff keep no trip card.
  if(!person||!drivesOrOperates({designation:person.designation}))continue;
  const cardsHere=bySiteDate.get(siteKey+'|'+day.date)||[];
  const label=cardsHere[0]?.site||siteLabel(text(day.site))||text(day.site)||siteKey;
  if(!allowed(label))continue;
  if(!sites.has(siteKey))sites.set(siteKey,{key:siteKey,site:label,punched:0,counted:0,toFix:0,noCard:0});
  const site=sites.get(siteKey);site.punched++;
  if(standing.has(number+'|'+day.date)){site.counted++;continue;}
  if(!cardsHere.length){site.noCard++;continue;}
  site.toFix++;
  const own=cardsHere.filter(card=>employeeNumber(card.savedId)===number);
  const cards=[...own,...cardsHere.filter(card=>!own.includes(card))].map(card=>({...card,own:own.includes(card)}));
  const shifts=[...new Set((own.length?own:cardsHere).map(card=>card.shift||'—'))];
  lines.push({id:number+'|'+day.date+'|'+siteKey,number,rowId:person.rowId,caliberId:person.caliberId,name:person.name,designation:person.designation,
   date:day.date,siteKey,site:label,inTime:text(day.inTime),outTime:text(day.outTime),source:text(day.source),shift:shifts.length===1?shifts[0]:'—',ownCard:own.length>0,cards});
 }
 lines.sort((a,b)=>a.date.localeCompare(b.date)||a.site.localeCompare(b.site)||Number(b.ownCard)-Number(a.ownCard)||a.name.localeCompare(b.name));
 return {lines,sites:[...sites.values()].sort((a,b)=>b.toFix-a.toFix||a.site.localeCompare(b.site))};
}
