import test from 'node:test';
import assert from 'node:assert/strict';
import {blankJob,blankBreakdown,padManualRows,normalizeManualDetails,jobDurationHours} from '../manual-log-book-details.mjs';
import {continueManualRemark,isEmptyTripPlaceholder} from '../src/log-book-enter-navigation.mjs';
import {blankTrip} from '../trip-entry.mjs';
test('manual forms start with five trip, two job and two breakdown placeholders without sharing row state',()=>{
 const trips=padManualRows([],5,blankTrip),jobs=padManualRows([],2,blankJob),bd=padManualRows([],2,blankBreakdown);
 assert.equal(trips.length,5);assert.equal(jobs.length,2);assert.equal(bd.length,2);jobs[0].jobType='Loading';assert.equal(jobs[1].jobType,'');assert.ok(trips.every(isEmptyTripPlaceholder));assert.equal(isEmptyTripPlaceholder({...trips[0],remark:'Keep me'}),false);
});
test('job and breakdown rows persist entered values and drop only blank placeholders',()=>{
 const input={jobDetails:[{...blankJob(),jobType:'Loading coal',tripCount:'18',uom:'Trips',startDate:'2026-10-30',startTime:'23:30',endDate:'2026-10-31',endTime:'00:30',remark:'Checked'},blankJob()],breakdownDetails:[{...blankBreakdown(),detail:'Hose leak',startTime:'23:50',endTime:'00:10',actionTaken:'Replaced hose',mechanic:'Test mechanic',tmExecution:'Done',remark:'Resolved'},blankBreakdown()],manualAttributes:[{name:'Material',value:'Coal'},{name:'',value:''}]};
 const result=normalizeManualDetails(input,'equipment');assert.equal(result.jobDetails.length,1);assert.equal(result.jobDetails[0].durationHours,1);assert.equal(result.jobDetails[0].tripCount,18);assert.equal(result.breakdownDetails.length,1);assert.equal(result.breakdownDetails[0].remark,'Resolved');assert.equal(result.manualAttributes.length,1);
 assert.deepEqual(normalizeManualDetails({} ),{});assert.deepEqual(normalizeManualDetails({jobDetails:[blankJob()],breakdownDetails:[blankBreakdown()]},'equipment'),{jobDetails:[],breakdownDetails:[]});
});
test('invalid dates, reversed jobs, incomplete breakdown clocks and row overflow reject without data loss',()=>{
 const job={...blankJob(),jobType:'Loading',startDate:'2026-10-31',startTime:'09:00',endDate:'2026-10-31',endTime:'08:00'};
 assert.equal(jobDurationHours(job),null);assert.throws(()=>normalizeManualDetails({jobDetails:[job]},'equipment'),/valid start\/end/);
 assert.throws(()=>normalizeManualDetails({jobDetails:[{...job,startDate:'2026-02-30'}]},'equipment'),/valid start\/end/);
 assert.throws(()=>normalizeManualDetails({breakdownDetails:[{detail:'Leak',startTime:'25:00',endTime:'09:00'}]}),/valid breakdown times/);
 assert.throws(()=>normalizeManualDetails({breakdownDetails:Array.from({length:301},blankBreakdown)}),/300 rows/);
 assert.throws(()=>normalizeManualDetails({openingEngineHmr:'',closingEngineHmr:1}),/R engine/);
});
test('attachment content, size and MIME are checked; active HTML content is never accepted',()=>{
 const pdf='data:application/pdf;base64,'+Buffer.from('%PDF-1.4\nexample').toString('base64');
 const input={manualAttachments:[{name:'test.pdf',data:pdf}]};assert.equal(normalizeManualDetails(input).manualAttachments[0].type,'application/pdf');
 for(const data of ['data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,'+Buffer.from('<html>').toString('base64')])assert.throws(()=>normalizeManualDetails({manualAttachments:[{name:'bad',data}]}));
 assert.throws(()=>normalizeManualDetails({manualAttachments:Array.from({length:4},()=>({name:'test.pdf',data:pdf}))}),/up to 3/);
 assert.throws(()=>normalizeManualDetails({manualAttachments:[{data:'data:application/pdf;base64,'+Buffer.from('%PDF-'+ 'a'.repeat(1048576)).toString('base64')}]}),/1 MB/);
});
test('Enter at Remark advances to the next row or appends exactly one row, with a row limit and modifier guards',()=>{
 const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=fn=>fn();
 try{for(const [blank,count,selector] of [[blankTrip,5,'data-trip-equipment'],[blankJob,2,'data-job-first'],[blankBreakdown,2,'data-breakdown-first']]){
  let rows=Array.from({length:count},blank),focused='',prevented=0;const section={querySelector:s=>({focus(){focused=s},scrollIntoView(){}})};
  const event={key:'Enter',preventDefault(){prevented++},stopPropagation(){},currentTarget:{closest:()=>section}};
  continueManualRemark(event,rows,count-1,blank,next=>rows=next,selector);assert.equal(rows.length,count+1);assert.equal(focused,`[${selector}="${count}"]`);
  continueManualRemark(event,rows,0,blank,next=>rows=next,selector);assert.equal(rows.length,count+1);assert.equal(focused,`[${selector}="1"]`);
  continueManualRemark({...event,repeat:true},rows,rows.length-1,blank,next=>rows=next,selector);assert.equal(rows.length,count+1);
  continueManualRemark({...event,shiftKey:true},rows,rows.length-1,blank,next=>rows=next,selector);assert.equal(rows.length,count+1);
  const max=Array.from({length:300},blank);continueManualRemark(event,max,299,blank,()=>assert.fail('must not append'),selector);assert.equal(max.length,300);
  assert.ok(prevented);
 }}finally{globalThis.requestAnimationFrame=previous}
});
