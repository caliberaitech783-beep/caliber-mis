import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileFleet} from '../server/rules/fleet-reconciliation.mjs';

// On 11 Nov 2026 one Fleet Reconciliation report blocked the live server for 11-14 s: every
// machine at the site was matched against the whole Pulse breakdown history, with site names
// and identity keys worked out again for each pair. At this size that took about 4 s on a
// developer PC; it now takes tens of milliseconds.
test('a full fleet against the whole Pulse breakdown history reconciles quickly',()=>{
 const sites=['Majri OC','Sasti OC','Jayant OC','Dudhichua OC','Dudhichua East OC','Dhoptala OC'];
 const date='2026-11-10',shift='S1',start=Date.parse(date+'T06:00:00+05:30'),window={start,end:start+8*3600000};
 const assets=Array.from({length:1800},(_,i)=>({id:String(i+1),door:'V/'+(1000+i),chassis:'CH'+i,category:'vehicle',equipmentName:'Dumper',currentLocation:sites[i%sites.length]}));
 const breakdowns=Array.from({length:22000},(_,i)=>{const a=assets[(i*7)%assets.length];return {ref:'BD-'+i,site:a.currentLocation,door:a.door,chassis:i%2?a.chassis:'',start:'2026-11-09 08:00',closedAt:'2026-11-09 10:00'};});
 const books=Array.from({length:900},(_,i)=>{const a=assets[(i*11)%assets.length];return {id:String(i+1),book_no:'VLB-'+i,book_type:'vehicle',asset_id:a.id,site:a.currentLocation,data:{cardShift:'I',totalTrips:2}};});
 const began=performance.now();
 const result=reconcileFleet({assets,books,breakdowns,date,site:'Majri OC',shift,window,now:start+86400000});
 const elapsed=performance.now()-began;
 assert.equal(result.rows.length,300);
 assert.ok(result.rows.some(row=>row.operated));
 assert.ok(elapsed<1500,`reconcileFleet took ${Math.round(elapsed)} ms`);
});

test('a breakdown is still matched by door when Pulse has no chassis, and archived or other-site requests are ignored',()=>{
 const site='Sasti OC',date='2026-11-02',start=Date.parse(date+'T05:00:00+05:30'),window={start,end:start+8*3600000};
 const assets=[{id:'1',door:'V/77',chassis:'CH77',category:'vehicle',equipmentName:'Dumper',currentLocation:site}];
 const breakdowns=[
  {ref:'BD-door',site,door:'v-77',start:date+' 06:00',closedAt:date+' 07:00'},
  {ref:'BD-archived',site,door:'V/77',start:date+' 06:00',closedAt:date+' 07:00',archivedAt:'2026-11-02'},
  {ref:'BD-other-site',site:'Majri OC',door:'V/77',start:date+' 06:00',closedAt:date+' 07:00'},
  {ref:'BD-other-chassis',site,door:'V/77',chassis:'CH99',start:date+' 06:00',closedAt:date+' 07:00'},
 ];
 const [row]=reconcileFleet({assets,books:[],breakdowns,date,site,shift:'S1',window,now:start+86400000}).rows;
 assert.deepEqual(row.breakdowns.map(b=>b.reference),['BD-door']);
});
