import test from 'node:test';
import assert from 'node:assert/strict';
import {sameShift,sameSite,shiftChoiceLabel,shiftChoices,siteChoices} from '../shared/report-filter-options.mjs';
import {filterRecords,normalise} from '../src/operations-report-model.mjs';

// Owner's correction note, 18 Nov 2026: the Loading Equipment-wise Site list showed "Jayant OB" and "Jayant OC" (and a "-"),
// and its Shift list showed Shift A, B and C once for every site (29 lines).
test('each site is listed once by its OC name, and "-" is not a site',()=>{
  const listed=siteChoices(['-','Dhoptala OB (2nd)','Dhoptala OC (2nd)','Dudhichua East OB','Dudhichua East OC','Dudhichua OB','Dudhichua OC','Jayant OB','Jayant OC','jayant oc','',null,'—']);
  assert.deepEqual(listed,['Dhoptala OC (2nd)','Dudhichua East OC','Dudhichua OC','Jayant OC']);
  assert.ok(sameSite('Jayant OB','Jayant OC'));
  assert.ok(!sameSite('Dudhichua OC','Dudhichua East OC'));
});

test('Shift A, B and C are listed once for all sites, whatever way a card or master writes them',()=>{
  const perSite=['Dhoptala OC (2nd)','Jayant OC','Majri OC','Sasti OC'].flatMap(()=>['Shift A','Shift B','Shift C']);
  assert.deepEqual(shiftChoices([...perSite,'shift a','S1','I','1','B','III','Shift Day','N']),['Shift A','Shift B','Shift C','Shift Day','Shift Night']);
  for(const written of ['Shift A','SHIFT-A','S1','I','1','A'])assert.equal(shiftChoiceLabel(written),'Shift A');
  assert.equal(shiftChoiceLabel('General'),'General');
  assert.ok(sameShift('S3','Shift C'));
});

test('choosing a site or shift in the saved operational reports keeps the cards of every spelling',()=>{
  const card=(id,location,shiftName,shiftId)=>({id,book_no:'B'+id,book_type:'vehicle',data:{bookDate:'2026-11-05',location,shiftName,shiftId,trips:[]}});
  const rows=normalise([card(1,'Jayant OB','Shift A',11),card(2,'Jayant OC','Shift A',12),card(3,'Majri OC','Shift A',21),card(4,'Jayant OC','Shift B',13)]);
  assert.deepEqual(filterRecords(rows,{site:'Jayant OC',shift:'Shift A'}).map(r=>r.id),[1,2]);
  assert.deepEqual(filterRecords(rows,{site:'',shift:'Shift A'}).map(r=>r.id),[1,2,3]);
});
