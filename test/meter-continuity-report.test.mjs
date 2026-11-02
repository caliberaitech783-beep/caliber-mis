import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMeterContinuityReport,normalizeTolerance} from '../meter-continuity-report.mjs';

const card=(id,date,shift,door,o,c,oh,ch,extra={})=>({id,book_no:'VLB_M/'+id,asset_id:door==='V07'?1:2,data:{bookDate:date,cardShift:shift,location:'Sasti OC',door,employeeName:extra.driver||'Ram',caliberId:extra.driverId||'E1',openingKmr:o,closingKmr:c,openingHmr:oh,closingHmr:ch,...(extra.scan?{scanCardId:'s'}:{})}});

test('previous card follows date and shift order, gaps are classed against the tolerance',()=>{
 const records=[
  card(3,'2026-12-02','I','V07',1200,1260,500,507),           // saved before the night card below, but ordered after it
  card(1,'2026-12-01','II','V07',1100,1150,490,496),
  card(2,'2026-12-01','III','V07',1151,1199,496,500),         // 1 km within tolerance, hours match
  card(4,'2026-12-02','II','V07',1250,1300,507,515,{driver:'Shyam',driverId:'E2'}), // 10 km below previous closing
  card(5,'2026-12-03','I','V07',1400,1450,515.5,520),         // jump of 100 km, hours within tolerance
  card(6,'2026-12-01','I','V08',10,20,1,2,{scan:true}),
  card(7,'2026-12-01','II','V08',20,'',2,3),                   // closing missing
  card(8,'2026-12-01','III','V08',25,30,3,4),                  // no previous reading for km
 ];
 const report=buildMeterContinuityReport({records,from:'2026-12-01',to:'2026-12-03'});
 const byId=Object.fromEntries(report.rows.map(r=>[r.id,r]));
 assert.equal(byId['1'].status,'no-previous');
 assert.equal(byId['2'].kmGap,1);assert.equal(byId['2'].kmClass,'tolerance');assert.equal(byId['2'].hourClass,'match');assert.equal(byId['2'].status,'tolerance');
 assert.equal(byId['3'].previousBookNo,'VLB_M/2');assert.equal(byId['3'].kmGap,1);assert.equal(byId['3'].hourGap,0);
 assert.equal(byId['4'].kmGap,-10);assert.equal(byId['4'].status,'negative');assert.equal(byId['4'].previousBookNo,'VLB_M/3');
 assert.equal(byId['5'].kmGap,100);assert.equal(byId['5'].kmClass,'jump');assert.equal(byId['5'].hourGap,0.5);assert.equal(byId['5'].hourClass,'tolerance');assert.equal(byId['5'].status,'jump');
 assert.equal(byId['7'].kmGap,0);assert.equal(byId['7'].status,'match');
 assert.equal(byId['8'].kmGap,null);assert.equal(byId['8'].kmClass,'no-reading');assert.equal(byId['8'].hourGap,0);assert.equal(byId['8'].status,'match','a missing reading does not outrank a real comparison');
 assert.equal(byId['6'].source,'Scan');
 const ram=report.drivers.find(d=>d.key==='E1'),shyam=report.drivers.find(d=>d.key==='E2');
 assert.equal(shyam.negatives,1);assert.equal(shyam.compared,1);assert.equal(shyam.issueRate,100);
 assert.equal(ram.cards,7);assert.equal(ram.jumps,1);assert.equal(ram.negatives,0);
 assert.equal(report.drivers[0].key,'E1','drivers with the most issues sort first; ties by cards compared');
 const v07=report.tippers.find(t=>t.key==='V07');assert.equal(v07.negatives,1);assert.equal(v07.jumps,1);
 assert.equal(report.totals.cards,8);assert.equal(report.totals.negatives,1);assert.equal(report.totals.jumps,1);
});

test('the range filters output rows but previous cards outside the range still count, and tolerances normalize',()=>{
 const records=[card(1,'2026-12-01','I','V07',100,150,10,12),card(2,'2026-12-05','I','V07',150,200,12,14)];
 const report=buildMeterContinuityReport({records,from:'2026-12-05',to:'2026-12-05'});
 assert.equal(report.rows.length,1);assert.equal(report.rows[0].previousBookNo,'VLB_M/1');assert.equal(report.rows[0].status,'match');
 assert.deepEqual(normalizeTolerance({kmTolerance:'5',hourTolerance:'x'}),{kmTolerance:5,hourTolerance:0.5});
 const strict=buildMeterContinuityReport({records:[card(1,'2026-12-01','I','V07',100,150,10,12),card(2,'2026-12-01','II','V07',151,200,12,14)],kmTolerance:0});
 assert.equal(strict.rows[1].status,'jump');
});
