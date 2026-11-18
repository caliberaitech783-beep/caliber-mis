// Owner, 17 Nov 2026: ELBs saved by the two-stage machine entry took their BD hours from Pulse with a match that put every
// "-" registration request of the site on every machine. The repair works each such card out again with the fixed match
// over the same shift window, shows old and new (dry run), and writes only the cards the owner approves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {recomputePulseElb,fleetStatusFor,pulseReasonFor,isPulseFilledElb} from '../server/rules/elb-pulse-repair.mjs';
import {registerElbPulseRepair} from '../server/routes/elb-pulse-repair.mjs';

const site='Gauri Pauni OC (2nd)';
// Shift A 07:00-15:00 IST on 14 Nov = 01:30-09:30 UTC.
const window={shiftStart:'2026-11-14T01:30:00.000Z',shiftEnd:'2026-11-14T09:30:00.000Z'};
const siteList=[{reference:'SITE-1',description:'Air compressor leakage',start:'2026-11-13T00:00:00.000Z',end:null,ongoing:true}];
const card=(door,extra={})=>({bookDate:'2026-11-14',location:site,assetId:'101',door,shiftId:'7',shiftName:'Shift A',shiftHours:8,scheduledHours:8,openingHmr:1000,closingHmr:1005,totalWorkingHmr:5,fleetTrips:40,
 breakdownHours:8,breakdownHoursSource:'pulse',elbEntryMode:'working-only',hoursSource:window,pulseBreakdowns:siteList,shiftStatus:'working',statusReason:'Air compressor leakage',idleHours:0,batchId:'55',...extra});
const asset={door:'TPC100-50251',equipmentName:'TPC100-50251',reg:'-',chassisNo:'THEJAEL0H00050251'};
const shift={startTime:'07:00:00',site};
const pulseRow=(ref,door,start,closedAt)=>({ref,site,door,reg:'-',chassis:'-',start,closedAt});
const rows=[pulseRow('SITE-1','JPC18-32182','2026-11-13 05:30:00',null),pulseRow('OWN','TPC100-50251','2026-11-14 09:00:00','2026-11-14 10:30:00')];
const now=Date.parse('2026-11-17T12:00:00Z');

test('a card filled from Pulse is worked out again with only its own breakdowns, over its saved shift window',()=>{
 assert.ok(isPulseFilledElb(card('TPC100-50251')));
 const {data,change}=recomputePulseElb(card('TPC100-50251'),{rows,asset,shift,now,at:'2026-11-17T12:00:00.000Z',by:'mohitchadda'});
 assert.equal(data.breakdownHours,1.5);
 assert.deepEqual(change.breakdownHours,[8,1.5]);
 assert.deepEqual(change.references,[['SITE-1'],['OWN']]);
 assert.equal(data.shiftStatus,'working_partial_breakdown','status follows the new BD hours when the save worked it out');
 assert.equal(data.idleHours,1.5,'8 h shift - 5 h worked - 1.5 h BD');
 assert.equal(data.statusReason,'Breakdown recorded in Pulse','the reason the save wrote follows too');
 assert.deepEqual(data.pulseRepair.previous,{breakdownHours:8,shiftStatus:'working',statusReason:'Air compressor leakage',idleHours:0,references:['SITE-1']});
 assert.equal(data.pulseRepair.by,'mohitchadda');
});

test('a status or reason a person chose stays; a card with nothing to change is left alone',()=>{
 const typed=recomputePulseElb(card('TPC100-50251',{shiftStatus:'maintenance',statusReason:'Planned service'}),{rows,asset,shift,now}).data;
 assert.equal(typed.shiftStatus,'maintenance');assert.equal(typed.statusReason,'Planned service');
 const clean=recomputePulseElb(card('TPC100-50251',{breakdownHours:1.5,pulseBreakdowns:[{reference:'OWN'}],shiftStatus:'working_partial_breakdown'}),{rows,asset,shift,now});
 assert.equal(clean.unchanged,true);
 assert.ok(recomputePulseElb({...card('X'),breakdownHoursSource:'manual'},{rows,asset,shift,now}).skip,'a typed ELB is not touched');
 assert.ok(recomputePulseElb(card('X',{hoursSource:{}}),{rows,asset,shift,now}).skip,'no saved window: skipped, not guessed');
 assert.ok(recomputePulseElb(card('X'),{rows,asset:null,shift,now}).skip);
});

test('the status rule is the one the machine entry uses',()=>{
 assert.equal(fleetStatusFor({actualHours:0,trips:0,breakdownHours:8,scheduledHours:8}),'breakdown');
 assert.equal(fleetStatusFor({actualHours:0,trips:0,breakdownHours:0,scheduledHours:8}),'not_in_use');
 assert.equal(fleetStatusFor({actualHours:5,trips:3,breakdownHours:2,scheduledHours:8}),'working_partial_breakdown');
 assert.equal(fleetStatusFor({actualHours:5,trips:3,breakdownHours:0,scheduledHours:8}),'working');
 assert.equal(pulseReasonFor([],0),'');assert.equal(pulseReasonFor([],2),'Breakdown recorded in Pulse');
});

function harness(books,pulseRows=rows){
 const routes={},writes=[];
 const app={get:(path,...h)=>{routes['GET '+path]=h;},post:(path,...h)=>{routes['POST '+path]=h;}};
 const query=async(sql,params)=>{
  if(/SELECT DISTINCT site FROM mis_log_books/.test(sql))return {rows:[...new Set(books.map(b=>b.site))].map(site=>({site}))};
  if(/GROUP BY site,book_type/.test(sql)){const m={};for(const b of books){const k=b.site+'|'+b.book_type;m[k]=(m[k]||0)+1;}return {rows:Object.entries(m).map(([k,cards])=>({site:k.split('|')[0],book_type:k.split('|')[1],cards}))};}
  if(/FROM mis_log_books/.test(sql)){const [,,names,kinds,ids]=params;return {rows:books.filter(b=>names.includes(b.site)&&kinds.includes(b.book_type)&&(!ids||ids.includes(String(b.id)))).map(b=>({...b,data:structuredClone(b.data)}))};}
  if(/FROM master_records/.test(sql))return {rows:[{id:101,master_name:'Equipment master',record_data:asset},{id:7,master_name:'Shift Master',record_data:shift}]};
  writes.push([sql.split(' ').slice(0,3).join(' '),params]);return {rows:[]};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 registerElbPulseRepair(app,{pool,protect:[],readBreakdownRows:async()=>pulseRows});
 const call=async(key,req)=>{const res={code:200,body:null,status(c){this.code=c;return this;},set(){return this;},json(b){this.body=b;return this;}};
  const chain=routes[key];let i=0;const next=async()=>{const h=chain[i++];if(h)await h(req,res,next);};await next();return res;};
 return {call,writes};
}
const book=(id,data,extra={})=>({id,book_no:'CAL/ELB/14-11-26/'+id,book_type:'equipment',site,date:'2026-11-14',revision:1,data,...extra});
const books=[book(1,card('TPC100-50251')),book(2,card('TPC100-50251',{breakdownHours:1.5,pulseBreakdowns:[{reference:'OWN'}],shiftStatus:'working_partial_breakdown'}))];
// An MIS administrator as shared/mis-admin-access.mjs knows one: a super login whose admin level is admin.
const admin={login:'sample.admin',name:'Sample Admin',role:'super',permissions:{adminLevel:'admin'}};

test('dry run lists old and new and writes nothing; only an MIS administrator may run it',async()=>{
 const {call,writes}=harness(books);
 const denied=await call('GET /api/admin/elb-pulse-repair',{session:{login:'site.user'},query:{from:'2026-11-01',to:'2026-11-17'}});
 assert.equal(denied.code,403);
 const session=admin;
 const res=await call('GET /api/admin/elb-pulse-repair',{session,query:{from:'2026-11-01',to:'2026-11-17',site}});
 assert.equal(res.code,200);
 assert.deepEqual([res.body.dryRun,res.body.cards,res.body.toChange,res.body.unchanged],[true,2,1,1]);
 assert.deepEqual(res.body.changes[0].breakdownHours,[8,1.5]);
 assert.equal(writes.length,0,'a dry run writes nothing');
 const bad=await call('GET /api/admin/elb-pulse-repair',{session,query:{from:'2026-11-17',to:'2026-11-01',site}});
 assert.equal(bad.code,400);
 const noSite=await call('GET /api/admin/elb-pulse-repair',{session,query:{from:'2026-11-01',to:'2026-11-17'}});
 assert.equal(noSite.code,400,'one site at a time (an all-sites read timed out on live)');
 const applied=await call('POST /api/admin/elb-pulse-repair',{session,body:{from:'2026-11-01',to:'2026-11-17',site,ids:['1','2']}});
 assert.deepEqual([applied.code,applied.body.applied],[200,1],'only the card that still differs is written');
 assert.deepEqual(writes.map(w=>w[0]),['BEGIN','UPDATE mis_log_books SET','UPDATE mis_vlb_batch_fleet SET','UPDATE mis_elb_batch_entries SET','UPDATE mis_vlb_batch_entries SET','INSERT INTO mis_vlb_batch_audit(batch_id,actor,action,detail)','COMMIT']);
 const saved=JSON.parse(writes[1][1][0]);
 assert.equal(saved.breakdownHours,1.5);assert.equal(saved.pulseRepair.previous.breakdownHours,8);
 assert.deepEqual(Object.keys(saved).sort(),['breakdownHours','hoursSource','idleHours','pulseBreakdowns','pulseRepair','shiftStatus','statusReason'],'only the repaired fields are merged into the card');
 const none=await call('POST /api/admin/elb-pulse-repair',{session,body:{from:'2026-11-01',to:'2026-11-17'}});
 assert.equal(none.code,400,'nothing is written without the list of cards');
});

// 17 Nov 2026: the live dry run was refused ("This MIS menu is not assigned to your login"): new routes fail closed in
// shared/mis-application-access.mjs, and PR 414 left this one off the list.
test('an MIS administrator\'s separate MIS login may run the dry run and the repair; nobody else may',async()=>{
 const {misRequestAllowed}=await import('../shared/mis-application-access.mjs');
 const misAdmin={role:'super',permissions:{separateMisCredentials:true,adminLevel:'admin',misDesktopAccess:'Users & employees | Reports'}};
 const siteUser={role:'user',permissions:{separateMisCredentials:true,misDesktopAccess:'Reports'}};
 const route='/api/admin/elb-pulse-repair';
 assert.equal(misRequestAllowed(misAdmin,{path:route,method:'GET'}),true);
 assert.equal(misRequestAllowed(misAdmin,{path:route,method:'POST'}),true);
 assert.equal(misRequestAllowed(misAdmin,{path:route,method:'DELETE'}),false);
 assert.equal(misRequestAllowed(siteUser,{path:route,method:'GET'}),false);
 assert.equal(misRequestAllowed(siteUser,{path:route,method:'POST'}),false);
 assert.equal(misRequestAllowed(misAdmin,{path:route+'/sites',method:'GET'}),true);
 assert.equal(misRequestAllowed(misAdmin,{path:route+'/sites',method:'POST'}),false);
 assert.equal(misRequestAllowed(siteUser,{path:route+'/sites',method:'GET'}),false);
});

// 18 Nov 2026 (owner: "repair everything, all sites"): the ELB form, VLB / LMV cards and scanned cards fill BD hours from
// Pulse through the same match, so they are worked out again too; what a person chose stays.
test('a form or scanned card is repaired too: BD hours and the idle hours the save worked out; the status a person chose stays',()=>{
 const form=card('TPC100-50251',{elbEntryMode:undefined,shiftStatus:'working',statusReason:'Typed by site',totalWorkingHmr:5,idleHours:-5});
 const {data,patch}=recomputePulseElb(form,{rows,asset,shift,now});
 assert.equal(data.breakdownHours,1.5);
 assert.equal(data.shiftStatus,'working');assert.equal(data.statusReason,'Typed by site');
 assert.equal(data.idleHours,1.5,'8 h shift - 5 h working - 1.5 h BD, as the save works it out');
 assert.ok(!('elbEntryMode' in patch),'nothing but the repaired fields is written');
 const typedIdle=recomputePulseElb({...form,idleHours:2},{rows,asset,shift,now}).data;
 assert.equal(typedIdle.idleHours,2,'idle hours someone typed stay');
});

test('a VLB card is repaired through the same route; a card whose old requests left Pulse\'s list is left as saved',async()=>{
 const vlb=book(7,card('TPC100-50251',{elbEntryMode:undefined,shiftStatus:undefined,statusReason:undefined}),{book_type:'vehicle',book_no:'CAL/VLB/14-11-26/7'});
 const gone=book(8,card('TPC100-50251',{pulseBreakdowns:[{reference:'DELETED-1'}]}));
 const {call,writes}=harness([vlb,gone]);
 const res=await call('GET /api/admin/elb-pulse-repair',{session:admin,query:{from:'2026-11-14',to:'2026-11-14',site}});
 assert.deepEqual([res.body.cards,res.body.toChange,res.body.skipped],[2,1,1]);
 assert.equal(res.body.changes[0].kind,'vehicle');
 assert.match(res.body.skippedCards[0].skip,/no longer holds/);
 const onlyEquipment=await call('GET /api/admin/elb-pulse-repair',{session:admin,query:{from:'2026-11-14',to:'2026-11-14',site,kind:'equipment'}});
 assert.equal(onlyEquipment.body.cards,1);
 await call('POST /api/admin/elb-pulse-repair',{session:admin,body:{from:'2026-11-14',to:'2026-11-14',site,ids:['7','8']}});
 assert.ok(!writes.some(w=>w[0]==='UPDATE mis_vlb_batch_fleet SET'),'a VLB card has no machine status line');
 assert.equal(writes.filter(w=>w[0]==='UPDATE mis_log_books SET').length,1,'the card Pulse no longer knows is not written');
 const sites=await call('GET /api/admin/elb-pulse-repair/sites',{session:admin,query:{from:'2026-11-01',to:'2026-11-17'}});
 assert.deepEqual(sites.body.sites.map(s=>[s.cards,s.byKind]),[[2,{vehicle:1,equipment:1}]]);
});
// 18 Nov 2026: the first live dry run held the server for minutes (every card checked every site's Pulse requests).
test('requests of other sites neither change the answer nor slow the dry run',async()=>{
 const others=Array.from({length:30000},(_,i)=>({ref:'X'+i,site:'Sasti OC',door:'TPC100-50251',reg:'-',chassis:'-',start:'2026-11-14 08:00:00',closedAt:'2026-11-14 09:00:00'}));
 const many=Array.from({length:150},(_,i)=>book(100+i,card('TPC100-50251')));
 const {call}=harness(many,[...others,...rows]);
 const started=Date.now();
 const res=await call('GET /api/admin/elb-pulse-repair',{session:admin,query:{from:'2026-11-14',to:'2026-11-14',site}});
 const took=Date.now()-started;
 assert.equal(res.code,200);
 assert.deepEqual([res.body.cards,res.body.toChange],[150,150]);
 assert.ok(res.body.changes.every(c=>c.breakdownHours[1]===1.5&&c.references[1].join()==='OWN'),'Sasti requests never land on a Gauri machine');
 assert.ok(took<4000,'150 cards against 30,000 other-site requests took '+took+' ms');
});
