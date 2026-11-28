// The HR feed cut down to one site (owner, 28 Nov 2026: "find why one MIS trip-card day takes 14 seconds and fix it").
//
// HR Pulse's Attendance roster shows one site. Measured on live on 28 Nov 2026: for one day of Majri OC it was sent three
// days of all seven sites (15.9 MB), 28 times for a month, and 94% of the 191 seconds were spent here building and sending
// what HR Pulse then threw away. With cut=site&site=<HR's name of the site> the answer holds that site only, so HR Pulse
// can ask for a whole week of it in one request.
//
// What is kept is what HR Pulse's reading of the feed uses to make the lines of the site (caliber-hr
// server/mis-trim.mjs, the same rule, kept the same in both programs):
//  - every line of the site;
//  - a duty of ANOTHER site by the same person in the same date and shift: HR Pulse marks both "Same shift recorded at
//    multiple sites", so that duty has to stay or the mark would silently disappear;
//  - the signatures of the site's days.
// misSiteDays names, per date, the sites that had lines before the cut: HR Pulse shows them when it finds none for the
// chosen site (a site written differently in the two programs).
//
// HR Pulse cuts the answer again with its own copy of this rule, so the two can only differ in the safe direction: a line
// too many here is dropped there; nothing HR Pulse would keep may be dropped here.

// HR Pulse's site names and Pulse-II's are written differently ("Jayant" / "Jayant OB"): letters and digits only.
const siteWords=site=>String(site||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
// Words that only say what kind of site it is: "Sasti OC", "Sasti OCP" and "Sasti" are the same site.
const SITE_KIND=new Set(['ob','oc','ocp','ocm','opencast','coal','mine','mines','project','site','colliery']);
const placeWords=site=>{const words=siteWords(site).split(' ').filter(Boolean),place=words.filter(w=>!SITE_KIND.has(w));return place.length?place:words;};
// caliber-hr server/site-match.mjs, word for word.
export function sameSite(hrSite,misSite){
 const a=siteWords(hrSite),b=siteWords(misSite);
 if(!a||!b)return false;
 if(a===b||(' '+b+' ').includes(' '+a+' ')||(' '+a+' ').includes(' '+b+' '))return true;
 const pa=placeWords(hrSite),pb=placeWords(misSite);
 return pa.every(w=>pb.includes(w))||pb.every(w=>pa.includes(w));
}

// What this feed can do, sent with every answer so HR Pulse asks for a cut only once Pulse-II gives it.
export const HR_FEED_SUPPORTS=['site-cut'];

const list=value=>Array.isArray(value)?value:[];
const siteKeyOf=site=>String(site||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
// HR Pulse's two keys: a duty, and a person's shift whatever the site.
const dutyKey=entry=>JSON.stringify([siteKeyOf(entry.siteKey||entry.site),entry.date,entry.shift,String(entry.employeeId||'').trim().toUpperCase()]);
const slotKey=(employeeKey,entry)=>JSON.stringify([employeeKey,entry.date,entry.shift]);

export function cutHrAnswerToSite(answer,site){
 const mine=entry=>Boolean(entry)&&(sameSite(site,entry.site)||sameSite(site,entry.siteKey));
 const duties=list(answer.otDuties),lines=list(answer.attendanceEquipment),changes=list(answer.hrChanges);
 const misSiteDays={};
 for(const entry of [...duties,...lines,...changes.filter(c=>c?.mark==='absent')])if(entry?.site&&entry.date)(misSiteDays[entry.date]??=new Set()).add(entry.site);
 // A person's shifts at this site, by every key HR Pulse may give the line (the card's, a line's, a change's).
 const slots=new Set();
 for(const entry of [...duties,...lines])if(mine(entry))slots.add(slotKey(entry.employeeKey,entry));
 for(const change of changes)if(mine(change))slots.add(slotKey(change.employeeKey||change.employeeId,change));
 // The duties to keep: the site's own, and another site's in one of those shifts by the same person.
 const kept=new Set();
 for(const entry of [...duties,...lines])if(entry&&(mine(entry)||slots.has(slotKey(entry.employeeKey,entry))))kept.add(dutyKey(entry));
 const keepChange=change=>Boolean(change)&&(mine(change)||slots.has(slotKey(change.employeeKey||change.employeeId,change))||kept.has(dutyKey(change)));
 // A duty is one line built from its card and all its equipment lines: every part of a kept duty stays.
 const whole=entry=>Boolean(entry)&&(mine(entry)||kept.has(dutyKey(entry)));
 return {
  ...answer,
  attendanceEquipment:lines.filter(whole),
  otDuties:duties.filter(whole),
  performance:list(answer.performance).filter(whole),
  details:list(answer.details).filter(whole),
  exceptions:list(answer.exceptions).filter(whole),
  attendanceShifts:list(answer.attendanceShifts).filter(row=>row&&sameSite(site,row.siteKey)),
  ot:list(answer.ot).filter(mine),
  ...(Array.isArray(answer.hrChanges)?{hrChanges:changes.filter(keepChange)}:{}),
  ...(Array.isArray(answer.days)?{days:answer.days.filter(day=>day&&sameSite(site,day.siteKey))}:{}),
  ...(Array.isArray(answer.pendingDays)?{pendingDays:answer.pendingDays.filter(day=>day&&sameSite(site,day.siteKey))}:{}),
  cut:'site',
  misSiteDays:Object.fromEntries(Object.entries(misSiteDays).sort(([a],[b])=>a.localeCompare(b)).map(([date,sites])=>[date,[...sites].sort()])),
 };
}
