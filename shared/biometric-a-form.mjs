// A biometric device can know a person by his A Form no. instead of his CMLL id (owner, 23 Nov 2026).
// The same A Form no. is used again at other sites, and at one site it can equal another person's CMLL
// number (179 such pairs in HR's file), so a code is never guessed line by line. For each site of the file:
//  - "auto": count how many codes are CMLL numbers of people at that site and how many are A Form numbers of
//    that site (A Form Master). The larger count says what the device sends;
//  - "aform" / "caliber": the person uploading says so.
// A code read as an A Form no. becomes the CMLL number of its one owner at that site, and the A Form no. is kept
// beside it. A code with no owner, or with two, is left out and listed: saving it as it stands could put the
// punch under another person's CMLL number.
import {canonicalSiteName} from './site-location.mjs';
import {hrSiteName} from './hr-employee-master.mjs';
import {aFormKeys} from './a-form-master.mjs';
import {aFormOwners} from './a-form-people.mjs';

export const BIOMETRIC_CODE_KINDS=['auto','caliber','aform'];
const siteKeyOf=site=>canonicalSiteName(hrSiteName(site)||site);
const earlier=(a,b)=>!a?b:!b?a:a<b?a:b,later=(a,b)=>!a?b:!b?a:a>b?a:b;

// lines: [{caliberCode,date,inTime,outTime,site,employeeName}] as the upload has checked them.
// index: buildAFormPeople (shared/a-form-people.mjs: the employee lists and A Form Master together).
export function resolveBiometricCodes(lines=[],index,codeKind='auto'){
 const bySite=new Map();
 for(const line of lines){const key=siteKeyOf(line.site);(bySite.get(key)||bySite.set(key,[]).get(key)).push(line);}
 const kept=new Map(),sites=[],leftOut=[];
 const keep=line=>{
  const key=line.caliberCode+'|'+line.date,held=kept.get(key);
  // One person can hold two A Form numbers: his punches under both are one day's attendance.
  if(held)kept.set(key,{...held,inTime:earlier(held.inTime,line.inTime),outTime:later(held.outTime,line.outTime),aFormNo:held.aFormNo||line.aFormNo,employeeName:held.employeeName||line.employeeName});
  else kept.set(key,line);
 };
 for(const [siteKey,list] of bySite){
  const label=String(list[0].site||'').trim()||'Site not given';
  const judged=list.map(line=>{
   const code=String(line.caliberCode),number=/^\d+$/.test(code)?code:'';
   return {line,asCaliber:Boolean(number&&siteKey&&(index.byNumber.get(number)||[]).some(person=>person.listed&&person.siteKeys.includes(siteKey))),owners:siteKey?aFormOwners(index,siteKey,aFormKeys(code)):[]};
  });
  const matchCaliber=judged.filter(row=>row.asCaliber).length,matchAForm=judged.filter(row=>row.owners.length).length;
  const useAForm=Boolean(siteKey)&&(codeKind==='aform'||(codeKind==='auto'&&matchAForm>matchCaliber));
  let converted=0;
  for(const row of judged){
   if(!useAForm){keep({...row.line,aFormNo:''});continue;}
   if(row.owners.length===1){keep({...row.line,caliberCode:row.owners[0].number,aFormNo:String(row.line.caliberCode)});converted++;}
   else leftOut.push({site:label,code:String(row.line.caliberCode),date:row.line.date,reason:row.owners.length?'this A Form no. is on two people of the site in A Form Master':'this A Form no. is not in A Form Master for the site'});
  }
  sites.push({site:label,lines:list.length,kind:useAForm?'aform':'caliber',converted,matchCaliber,matchAForm});
 }
 return {lines:[...kept.values()],sites,leftOut};
}
