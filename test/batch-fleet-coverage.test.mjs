// Owner, 25 Nov 2026: when a batch closes, every VLB, ELB and LMV machine of the site needs an answer for
// the shift. First part: the batch page counts and lists the machines with no card yet. It only warns.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {batchFleetCoverage,siteRoster,assetCoverageKind} from '../shared/batch-fleet-coverage.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const asset=(id,door,category,site='Sasti OC',extra={})=>({id,door,category,currentLocation:site,equipmentName:door+' machine',...extra});
const assets=[
 asset(1,'DT-01','Vehicle'),asset(2,'DT-02','Vehicle'),asset(3,'DT-03','Vehicle'),
 asset(4,'EX-01','Equipment'),asset(5,'EX-02','Equipment'),
 asset(6,'LMV-01','LMV'),asset(7,'LMV-02','LMV'),
 asset(8,'DT-09','Vehicle','Durgapur'),
 asset(9,'DT-OLD','Vehicle','Sasti OC',{status:'Inactive'}),
 asset(10,'DT-GONE','Vehicle','Sasti OC',{sourceMissing:true}),
];

test('the site roster takes each active machine of the site into its book by the Equipment Master category',()=>{
 const roster=siteRoster(assets,'Sasti OC');
 assert.deepEqual(roster.vehicle.map(r=>r.door),['DT-01','DT-02','DT-03'],'inactive, missing and other-site machines are left out');
 assert.deepEqual(roster.equipment.map(r=>r.door),['EX-01','EX-02']);
 assert.deepEqual(roster.lmv.map(r=>r.door),['LMV-01','LMV-02']);
 assert.equal(assetCoverageKind({group:'Excavator'}),'equipment','no category: judged by its group');
 assert.equal(assetCoverageKind({lmv:true,category:'Vehicle'}),'lmv');
});

test('a machine with a saved card of the batch is answered; the rest are listed as no card yet',()=>{
 const coverage=batchFleetCoverage({assets,site:'Sasti OC',
  vlbRecords:[{asset_id:'1',book_no:'V-11',data:{}},{asset_id:'1',book_no:'V-12',data:{}},{asset_id:'8',book_no:'V-90',data:{}}],
  lmvRecords:[{book_no:'L-1',data:{assetId:'6'}}],
  elbFleet:[{assetId:'4',door:'EX-01',saved_at:'2026-11-25',shift_status:'breakdown',book_no:'E-4'},{assetId:'5',door:'EX-02',saved_at:null,shift_status:null}],
 });
 assert.equal(coverage.mode,'warning');
 const {vlb,elb,lmv}=coverage.books;
 assert.deepEqual([vlb.total,vlb.answered,vlb.remaining,vlb.otherSite],[3,1,2,1]);
 assert.deepEqual(vlb.missing.map(r=>r.door),['DT-02','DT-03']);
 assert.deepEqual(vlb.rows.find(r=>r.door==='DT-01').cards,['V-11','V-12']);
 assert.equal(vlb.rows.find(r=>r.door==='DT-09').atSite,false,'a card for a machine of another site counts, shown apart');
 assert.deepEqual([elb.total,elb.answered,elb.remaining],[2,1,1],'an ELB saved with a status (breakdown too) is an answer');
 assert.deepEqual([lmv.total,lmv.answered,lmv.remaining],[2,1,1]);
 assert.equal(coverage.complete,false);
 assert.match(coverage.warnings[0],/^VLB 1\/3 machines answered; no card yet: DT-02, DT-03\.$/);
});

test('before the ELB list is made the site Equipment is the ELB roster; an ELB card answers it',()=>{
 const coverage=batchFleetCoverage({assets,site:'Sasti OC',elbRecords:[{asset_id:'5',book_no:'E-5',data:{}}]});
 assert.deepEqual(coverage.books.elb.missing.map(r=>r.door),['EX-01']);
});

test('all answered: complete with no warning',()=>{
 const coverage=batchFleetCoverage({assets,site:'Sasti OC',
  vlbRecords:[1,2,3].map(id=>({asset_id:String(id),data:{}})),lmvRecords:[6,7].map(id=>({data:{assetId:String(id)}})),
  elbRecords:[4,5].map(id=>({asset_id:String(id),data:{}}))});
 assert.equal(coverage.complete,true);
 assert.deepEqual(coverage.warnings,[]);
});

test('the batch page gets the coverage and shows it; it stops no lock or close yet',()=>{
 const route=read('server/routes/vlb-batches.mjs');
 assert.match(route,/batchFleetCoverage\(\{assets,site:batch\.site,vlbRecords:records,lmvRecords/);
 assert.match(route,/zeroTripEntries,fleetCoverage,/);
 for(const file of ['server/rules/vlb-two-stage.mjs','server/rules/vlb-batch-stages.mjs'])assert.doesNotMatch(read(file),/fleetCoverage|batch-fleet-coverage/,'warning mode: no blocker reads it');
 const page=read('src/vlb-create-batch.jsx');
 assert.match(page,/<BatchFleetCoverage key=\{viewed\.id\} coverage=\{viewed\.fleetCoverage\}/);
 const panel=read('src/batch-fleet-coverage.jsx');
 assert.match(panel,/'Step 1 · Machine coverage · '/);
 assert.match(panel,/book&&<ReportSection[^>]*'Step 2 · '/,'Step 2 opens under Step 1');
});
