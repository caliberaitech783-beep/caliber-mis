import test from 'node:test';import assert from 'node:assert/strict';
import {CARD_GROUPS,cardReviewGroup,reviewGroupSummary,cardIssueGroups,cardDisplayGroup,matchesCardGroup} from '../scan-card-groups.mjs';
const draft={doorText:'S/14',bookDate:'2026-10-19',location:'Test site',assetId:'1',employeeId:'2',shiftId:'3',shiftHours:8,openingHmr:0,closingHmr:6,openingKmr:0,closingKmr:50,aFormNo:'75',timeMode:'with',trips:[{equipmentName:'V12',loadingTime:'01:03',unloadingTime:'01:12',tripCount:1}],scanMachineSummary:[{equipmentName:'V12',tripCount:1}]};
const card=(id,overrides={})=>({id,status:'review',draft:structuredClone(draft),raw_fields:{},checks:{errors:[]},...overrides});
test('colour groups count cards, distinguish partial from blank, and exclude pending from red',()=>{
 const rows=[card('okay'),card('manual',{draft:{...draft,employeeId:''}}),card('blank',{draft:{bookDateSource:'system-fallback',bookDate:'2026-10-24',shiftHours:8}}),card('failed',{status:'error'}),card('mismatch',{context_mismatch:['Site: Other OC; expected Test site']}),card('queued',{status:'queued',draft:{}}),card('reading',{status:'reading',draft:{}})];
 assert.deepEqual(rows.map(c=>cardReviewGroup(c,'vehicle')),['orange','brown','red','error','error','pending','pending']);const s=reviewGroupSummary(rows,'vehicle');assert.equal(s.orange,1);assert.equal(s.brown,0);assert.equal(s['wrong-caliber'],1);assert.equal(s.red,1);assert.equal(s.error,2);assert.equal(s.pending,2);assert.equal(s.total,7);assert.equal(s.canSaveAll,false);
 assert.equal(cardReviewGroup(card('zero',{draft:{...draft,openingKmr:0}}),'vehicle'),'orange');
 assert.equal(cardReviewGroup(card('conflict',{checks:{errors:['Duplicate card.']}}),'vehicle'),'brown');
 assert.equal(cardReviewGroup(card('confirm',{checks:{errors:['Confirm or correct the highlighted meter readings.']}}),'vehicle'),'brown');
});
test('Save all unlocks only after every card is complete and explicitly human-approved',()=>{
 const rows=[card('1'),card('2')];assert.equal(reviewGroupSummary(rows,'vehicle').ready,true);assert.equal(reviewGroupSummary(rows,'vehicle').canSaveAll,false);
 rows[0].status='approved';rows[0].checked_by='reviewer';assert.equal(reviewGroupSummary(rows,'vehicle').canSaveAll,false);
 rows[1].status='approved';assert.equal(reviewGroupSummary(rows,'vehicle').canSaveAll,false);rows[1].checked_by='reviewer';assert.equal(reviewGroupSummary(rows,'vehicle').canSaveAll,true);
 rows[1].draft.employeeId='';assert.equal(reviewGroupSummary(rows,'vehicle').canSaveAll,false);rows[1].draft.employeeId='2';rows.forEach(r=>r.status='posted');assert.equal(reviewGroupSummary(rows,'vehicle').canSaveAll,false);
 assert.equal(reviewGroupSummary([],'vehicle').canSaveAll,false);
});
test('ELB does not require KMR or vehicle trips',()=>{
 const equipment={...draft,openingKmr:'',closingKmr:'',trips:[],scanMachineSummary:[],jobCardNo:'ELB-1'};assert.equal(cardReviewGroup(card('elb',{draft:equipment}),'equipment'),'orange');
});
test('report-only blanks do not remove an otherwise complete card from All okay',()=>{
 const complete={...draft,bookNo:'',workOrderId:'',openingTrips:'',endingTrips:'',remark:''};
 assert.equal(cardReviewGroup(card('optional-report-fields',{draft:complete}),'vehicle'),'orange');
});

test('Needs attention contains only cards not already covered by a specific issue filter',()=>{
 const categorized=card('categorized',{draft:{...draft,doorText:'',assetId:'',employeeId:'',closingHmr:-1,closingKmr:-1,scanMachineSummary:[{equipmentName:'V12',tripCount:3}]}});
 const remaining=card('remaining',{draft:{...draft,shiftId:''}});
 const groups=['wrong-door','wrong-caliber','wrong-hmr','wrong-kmr','mws-ted'];
 assert.deepEqual(cardIssueGroups(categorized,'vehicle'),groups);
 const counts=reviewGroupSummary([categorized,remaining,card('good')],'vehicle');
 assert.equal(counts.brown,1);
 assert.equal(counts['wrong-door'],1);
 for(const group of groups.slice(1))assert.equal(counts[group],0);
 assert.equal(matchesCardGroup(categorized,'brown','vehicle'),false);
 assert.equal(matchesCardGroup(remaining,'brown','vehicle'),true);
 assert.equal(matchesCardGroup(categorized,'wrong-door','vehicle'),true);
 for(const group of groups.slice(1))assert.equal(matchesCardGroup(categorized,group,'vehicle'),false);
});

test('mixed 50-page batch separates five wrong-site cards without changing the other 45',()=>{
 const context={bookDate:'2026-10-28',location:'Jayant OC',cardShift:'III'};
 const rows=Array.from({length:50},(_,i)=>{const d={...draft,...context,location:i<45?'Jayant OC':'Majri OC'};return card(String(i),{draft:d,raw_fields:{extractionDraft:d}})});
 const summary=reviewGroupSummary(rows,'vehicle',null,context);
 assert.equal(summary.total,50);assert.equal(summary.error,5);
 assert.equal(rows.filter(c=>cardReviewGroup(c,'vehicle',null,context)!=='error').length,45);
 assert.equal(cardReviewGroup({...rows[49],status:'reading'},'vehicle',null,context),'pending');
 assert.equal(cardReviewGroup({...rows[49],status:'rejected'},'vehicle',null,context),'red');
 const changed={...rows[49],draft:{...rows[49].draft,location:'Jayant OC'}};
 assert.equal(cardReviewGroup(changed,'vehicle',null,context),'error');
});

test('a card with overlapping problems is counted in exactly one stable issue group',()=>{
 const bad=card('bad',{draft:{...draft,doorText:'',assetId:'',employeeId:'',closingHmr:-1,closingKmr:-1,scanMachineSummary:[{equipmentName:'V12',tripCount:3}]}});
 const groups=['wrong-door','wrong-caliber','wrong-hmr','wrong-kmr','mws-ted'];
 assert.deepEqual(cardIssueGroups(bad,'vehicle'),groups);
 assert.equal(cardDisplayGroup(bad,'vehicle'),'wrong-door');
 const counts=reviewGroupSummary([bad,card('good')],'vehicle');assert.equal(counts['wrong-door'],1);for(const group of groups.slice(1))assert.equal(counts[group],0);
 assert.equal(counts.total,2);
 for(const status of ['queued','reading','posted','rejected'])assert.deepEqual(cardIssueGroups({...bad,status},'vehicle'),[]);
 assert.deepEqual(cardIssueGroups(card('empty',{draft:{},raw_fields:{}}),'vehicle'),[]);
});

test('all status counts equal the uploaded-card total for small and large batches',()=>{
 for(const size of [1,20,120]){
  const rows=Array.from({length:size},(_,index)=>index%4===0?card(String(index),{draft:{...draft,doorText:'',assetId:'',closingHmr:-1,scanMachineSummary:[{equipmentName:'V12',tripCount:3}]}}):index%4===1?card(String(index),{draft:{...draft,shiftId:''}}):index%4===2?card(String(index),{status:'error'}):card(String(index)));
  const counts=reviewGroupSummary(rows,'vehicle');
  assert.equal(CARD_GROUPS.reduce((sum,group)=>sum+counts[group.id],0)+counts.pending,size);
 }
});
