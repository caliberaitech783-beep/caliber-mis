// HR Pulse's machine punches with the day before (owner, 25 Nov 2026). A night duty that begins the evening before the
// first date ends that morning: without the evening's In, its morning Out stood alone as a day of the first date
// (Satnam Singh, Dhoptala: Out 04:47 on 01-11-2026 shown as "No trip card", his card being the night of 31-10-2026).
// So HR Pulse is asked from the day before; the reader pairs that evening's In with the morning Out and the duty lands on
// the day before, which every caller leaves out (it keeps only from … to).
//
// HR Pulse gives at most 31 dates at a time (caliber-hr server/mis-biometric-punches.mjs). When the dates asked already
// take all 31, the day before is a second small read, of which only what falls before the first date is kept.
// hrPunches: ({from,to}) => HR Pulse's answer {sites,punches,corrections}.
export const HR_PUNCH_MAX_DAYS=31;
const DAY=86_400_000;
export const dayBefore=date=>new Date(Date.parse(date+'T00:00:00Z')-DAY).toISOString().slice(0,10);
const span=(from,to)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/DAY)+1;

// Two answers as one: the second's site indexes are moved onto the first's site list.
export function joinPunchAnswers(first={},second={},{keepSecond=()=>true,keepSecondCorrection=()=>true}={}){
 const sites=[...(first.sites||[])],at=new Map(sites.map((name,i)=>[name,i]));
 const siteIndex=i=>{const name=(second.sites||[])[i]??'';if(!at.has(name)){at.set(name,sites.length);sites.push(name);}return at.get(name);};
 const punches=[...(first.punches||[]),...(second.punches||[]).filter(keepSecond).map(([code,id,stamp,site,type])=>[code,id,stamp,siteIndex(site),type])];
 const corrections=[...(first.corrections||[]),...(second.corrections||[]).filter(keepSecondCorrection).map(([site,...rest])=>[siteIndex(site),...rest])];
 return {...first,sites,punches,corrections};
}

export async function readHrPunchesWithDayBefore(hrPunches,{from,to}){
 const eve=dayBefore(from);
 if(span(eve,to)<=HR_PUNCH_MAX_DAYS)return hrPunches({from:eve,to});
 const [main,before]=await Promise.all([hrPunches({from,to}),hrPunches({from:eve,to:eve})]);
 return joinPunchAnswers(main,before,{keepSecond:row=>String(row?.[2]??'')<from,keepSecondCorrection:row=>String(row?.[1]??'')<from});
}
