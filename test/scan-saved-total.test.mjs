import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applySavedScanCard,scanBatchReport} from '../scan-batch-report.mjs';
const batch={id:'batch',kind:'vehicle'};
test('confirmed saves update the combined total immediately for corrected and already-valid cards',()=>{
 const cards=['okay','corrected'].map((id,i)=>({id,batch_id:batch.id,ordinal:i+1,status:'review',draft:{totalTrips:999}}));
 const records=cards.map((card,i)=>({id:i+1,book_no:'BOOK-'+i,data:{scanCardId:card.id,scanBatchId:batch.id,totalTrips:i+1,totalWorkingHmr:2,totalRunningKmr:10}}));
 let rows=cards.map((card,i)=>i===0?applySavedScanCard(card,records[i]):card);
 assert.equal(scanBatchReport(batch,rows).counts.saved,1);
 rows=rows.map((card,i)=>applySavedScanCard(card,records[i]));
 const report=scanBatchReport(batch,rows);assert.equal(report.counts.saved,2);assert.equal(report.counts.pending,0);assert.equal(report.totals.trips,3);
 assert.equal(cards[0].status,'review');
 assert.equal(applySavedScanCard(cards[0],{...records[0],data:{...records[0].data,scanCardId:'wrong'}}),cards[0]);
 assert.equal(applySavedScanCard(cards[0],{...records[0],data:{...records[0].data,scanBatchId:'other'}}),cards[0]);
});

test('one card with unavailable breakdown hours does not block a different valid card from saving',async()=>{
 const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const start=source.indexOf(" useEffect(()=>{\n  if(!options||dirty||busy||connectionError||savingRef.current");
 const end=source.indexOf("\n },[cards,kind,options",start);
 assert.ok(start>=0&&end>start);
 const body=source.slice(start+" useEffect(()=>{".length,end);
 let rows=[{id:'blocked',batch_id:'batch',status:'review',revision:1},{id:'okay',batch_id:'batch',status:'review',revision:1}],calls=[];
 const record={id:2,book_no:'BOOK-2',data:{scanCardId:'okay',scanBatchId:'batch',totalTrips:1}};
 const scope={contextBlocked:false,contextGate:null,options:{},dirty:false,busy:false,connectionError:'',savingRef:{current:false},uploadingRef:{current:false},bdFetchUnavailable:{current:true},cards:rows,card:rows[0],bdFallbackMissing:true,kind:'vehicle',canAutoSaveScanCard:()=>true,autoSaveAttempts:{current:new Set()},setBusy:()=>{},setProgress:()=>{},api:async path=>{calls.push(path);return {record};},setCards:fn=>{rows=fn(rows);},applySavedScanCard,setResults:()=>{},setArchiveResult:()=>{},setNotice:()=>{},load:async()=>{},list:async()=>{},selectedCardRef:{current:'blocked'},setPulseHours:()=>{},setPulseHoursError:()=>{},setAutoSaveError:()=>{}};
 new Function(...Object.keys(scope),body)(...Object.values(scope));
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['/api/scan-cards/okay/auto-save']);
 assert.equal(rows[0].status,'review');assert.equal(rows[1].status,'posted');
 assert.equal(scanBatchReport(batch,rows).counts.saved,1);
});
