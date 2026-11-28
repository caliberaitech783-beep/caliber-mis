// Owner, 28 Nov 2026: "find why one MIS trip-card day takes 14 seconds and fix it", then "Yes, build it" for: Pulse-II
// sends HR Pulse the chosen site only, so HR Pulse can read a site's whole week in one request.
// Measured on live that day (HR Pulse Attendance roster, Majri OC, 1 to 28 Nov): 28 requests, each three days of all seven
// sites (15.9 MB), 191 seconds, 94% of them spent in Pulse-II.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sameSite,cutHrAnswerToSite,HR_FEED_SUPPORTS} from '../shared/hr-site-cut.mjs';

const date='2026-11-16';
const line=(site,employeeId,shift='S1',extra={})=>({date,site,siteKey:site.toLowerCase(),shift,employeeId,employeeKey:employeeId,employeeName:employeeId,...extra});
// The same made-up answer as HR Pulse's own test of its copy of the rule (caliber-hr server/mis-attendance.test.mjs).
const whole=()=>({
 attendanceEquipment:[line('Majri OC','CMLL1'),line('Sasti OC','CMLL9')],
 attendanceShifts:[{siteKey:'majri oc',date,shift:'S1',state:'closed',batch:'B1'},{siteKey:'sasti oc',date,shift:'S1',state:'closed',batch:'B2'}],
 // CMLL2 has a card at both sites in the same shift: HR Pulse must still see both to mark them.
 otDuties:[line('Majri OC','CMLL1'),line('Majri OC','CMLL2','S2'),line('Sasti OC','CMLL2','S2'),line('Sasti OC','CMLL9'),line('Jayant OC','CMLL7')],
 ot:[{site:'Sasti OC',siteKey:'sasti oc',employeeId:'CMLL9',schedule:''},{site:'Majri OC',siteKey:'majri oc',employeeId:'CMLL1',schedule:''}],
 performance:[line('Majri OC','CMLL1'),line('Jayant OC','CMLL7')],details:[line('Sasti OC','CMLL9')],exceptions:[line('Jayant OC','CMLL7','S1',{reason:'x'})],
 hrChanges:[],
 days:[{siteKey:'majri oc',date,lines:2,signature:'m'},{siteKey:'sasti oc',date,lines:2,signature:'s'}],
 pendingDays:[{siteKey:'majri oc',date:'2026-11-17',shifts:[]},{siteKey:'jayant oc',date:'2026-11-17',shifts:[]}],
 supports:HR_FEED_SUPPORTS,
});

test('a site is the same site however the two programs write it',()=>{
 for(const [hr,mis] of [['Majri OC','majri ob'],['Majri OC','Majri OCP'],['Jayant','Jayant OB'],['Sasti OC','Sasti'],['Dhoptala OB 2nd','Dhoptala OC (2nd)'],['Dudhichua OB East','Dudhichua East OC']])assert.equal(sameSite(hr,mis),true,hr+' / '+mis);
 for(const [hr,mis] of [['Majri OC','Sasti OC'],['Dudhichua OC','Jayant OC'],['Majri OC',''],['','Majri OC']])assert.equal(sameSite(hr,mis),false,hr+' / '+mis);
});

test('the answer cut to one site keeps that site, the same person\'s same shift elsewhere, and the site\'s signatures',()=>{
 const full=whole(),cut=cutHrAnswerToSite(full,'Majri OC');
 assert.deepEqual(cut.otDuties.map(d=>d.site+' '+d.employeeId),['Majri OC CMLL1','Majri OC CMLL2','Sasti OC CMLL2']);
 assert.deepEqual(cut.attendanceEquipment.map(d=>d.site),['Majri OC']);
 assert.deepEqual(cut.attendanceShifts.map(d=>d.siteKey),['majri oc']);
 assert.deepEqual([cut.performance.length,cut.details.length,cut.exceptions.length],[1,0,0]);
 assert.deepEqual(cut.ot.map(e=>e.employeeId),['CMLL1']);
 assert.deepEqual(cut.days,[{siteKey:'majri oc',date,lines:2,signature:'m'}]);
 assert.deepEqual(cut.pendingDays.map(d=>d.siteKey),['majri oc']);
 // HR Pulse is told the answer is cut, and which sites had lines before the cut.
 assert.equal(cut.cut,'site');
 assert.deepEqual(cut.misSiteDays,{[date]:['Jayant OC','Majri OC','Sasti OC']});
 assert.deepEqual(cut.supports,['site-cut']);
 // The whole answer is not touched.
 assert.equal(full.otDuties.length,5);assert.equal(full.cut,undefined);
});

test('a duty is kept whole: its card, its equipment lines and its details, even under another person key',()=>{
 const full=whole();
 // The equipment line of CMLL2's Sasti duty carries another key than its card: it still belongs to the kept duty.
 full.attendanceEquipment.push(line('Sasti OC','CMLL2','S2',{employeeKey:'other-key'}));
 full.details.push(line('Sasti OC','CMLL2','S2',{batchStatus:'Saved scan'}));
 const cut=cutHrAnswerToSite(full,'Majri OC');
 assert.deepEqual(cut.attendanceEquipment.map(d=>d.site+' '+d.employeeId),['Majri OC CMLL1','Sasti OC CMLL2']);
 assert.deepEqual(cut.details.map(d=>d.site+' '+d.employeeId),['Sasti OC CMLL2']);
});

test('what HR Pulse changed stays with the site, and an absence still names the site in misSiteDays',()=>{
 const full=whole();
 full.hrChanges=[{...line('Majri OC','CMLL1'),id:'c1',mark:'absent',by:'hr',reason:'r',at:'t'},{...line('Jayant OC','CMLL7'),id:'c2',mark:'absent',by:'hr',reason:'r',at:'t'},{...line('Dudhichua OC','CMLL5'),id:'c3',mark:'absent',by:'hr',reason:'r',at:'t'}];
 const cut=cutHrAnswerToSite(full,'Majri OC');
 assert.deepEqual(cut.hrChanges.map(c=>c.id),['c1']);
 assert.deepEqual(cut.misSiteDays[date],['Dudhichua OC','Jayant OC','Majri OC','Sasti OC']);
 // A site with nothing: an empty answer that still says where the lines were.
 const none=cutHrAnswerToSite(whole(),'Gevra');
 assert.deepEqual([none.otDuties.length,none.attendanceEquipment.length,none.days.length],[0,0,0]);
 assert.deepEqual(none.misSiteDays[date],['Jayant OC','Majri OC','Sasti OC']);
});

// 28 Nov 2026: the cut judged the site of every line again (thousands of lines, a handful of names); it now judges each
// name once. The answer must be the same, line for line, as judging every line.
test('the cut that judges each site name once gives the same answer as judging every line',()=>{
 const sites=['Majri OC','Sasti OC','Jayant OC','Dudhichua OC','Dudhichua East OC','Gauri Pauni OC (2nd)','Dhoptala OC (2nd)'];
 let seed=7;const rnd=n=>{seed=(seed*1103515245+12345)%2147483648;return seed%n;};
 const line=(i,extra={})=>{const s=sites[rnd(sites.length)];return {date:'2026-11-'+String(10+rnd(3)).padStart(2,'0'),site:s,siteKey:s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),shift:'S'+(1+rnd(3)),employeeId:'CMLL'+rnd(60),employeeKey:'CMLL'+rnd(60),employeeName:'E'+i,...extra};};
 const many=(n,extra)=>Array.from({length:n},(_,i)=>line(i,extra));
 const answer={attendanceEquipment:many(300),otDuties:many(400),performance:many(400),details:many(100),exceptions:many(50,{reason:'x'}),ot:many(40,{schedule:''}),
  attendanceShifts:many(60,{state:'closed',batch:'B'}),hrChanges:many(10,{mark:'absent'}),days:many(21,{signature:'s',lines:1}),pendingDays:many(5,{shifts:[]}),supports:HR_FEED_SUPPORTS};
 // The rule as it was written before: every line judged by sameSite.
 const slow=(a,site)=>{
  const k=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),mine=e=>Boolean(e)&&(sameSite(site,e.site)||sameSite(site,e.siteKey));
  const dutyKey=e=>JSON.stringify([k(e.siteKey||e.site),e.date,e.shift,String(e.employeeId||'').trim().toUpperCase()]),slotKey=(key,e)=>JSON.stringify([key,e.date,e.shift]);
  const slots=new Set();for(const e of [...a.otDuties,...a.attendanceEquipment])if(mine(e))slots.add(slotKey(e.employeeKey,e));for(const c of a.hrChanges)if(mine(c))slots.add(slotKey(c.employeeKey||c.employeeId,c));
  const kept=new Set();for(const e of [...a.otDuties,...a.attendanceEquipment])if(mine(e)||slots.has(slotKey(e.employeeKey,e)))kept.add(dutyKey(e));
  const whole=e=>mine(e)||kept.has(dutyKey(e));
  return {otDuties:a.otDuties.filter(whole),attendanceEquipment:a.attendanceEquipment.filter(whole),performance:a.performance.filter(whole),details:a.details.filter(whole),exceptions:a.exceptions.filter(whole),
   ot:a.ot.filter(mine),attendanceShifts:a.attendanceShifts.filter(r=>sameSite(site,r.siteKey)),days:a.days.filter(d=>sameSite(site,d.siteKey)),pendingDays:a.pendingDays.filter(d=>sameSite(site,d.siteKey)),
   hrChanges:a.hrChanges.filter(c=>mine(c)||slots.has(slotKey(c.employeeKey||c.employeeId,c))||kept.has(dutyKey(c)))};
 };
 for(const site of ['Majri OC','Dudhichua OB East','Dudhichua OB West','Jayant OB','Gauri Pauni OB 2nd','Nagpur CO']){
  const cut=cutHrAnswerToSite(answer,site),want=slow(answer,site);
  for(const key of Object.keys(want))assert.deepEqual(cut[key],want[key],site+' '+key);
 }
});
