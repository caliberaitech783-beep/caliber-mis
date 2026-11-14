import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {correctedFields,cardFacts,summarize,entryReadMessage,duration,createScanBatchReporter,REPORT_HEADER,scanBatchReportEnabled} from '../server/services/scan-batch-report.mjs';
import {AUTOMATIONS} from '../server/rules/automation-catalogue.mjs';

const pgPool=db=>({query:(sql,params)=>params?db.query(sql,params):db.exec(sql).then(r=>r.at(-1)??{rows:[]})});
const raw=({queued=30000,total=12000,gemini=6000,finished='2026-11-15T03:00:00Z',flagged=false,extraction={}}={})=>({
 scanTiming:{queuedMs:queued,totalMs:total,finishedAt:finished},
 gemini:{model:'gemini-3.1-flash-lite',totalElapsedMs:gemini,usage:{totalTokenCount:10000}},
 firstScanFieldRecovery:flagged?{attempted:true,remaining:['door']}:{attempted:false,remaining:[]},
 extractionDraft:extraction,
});
const read={assetId:'7',employeeId:'12',aFormNo:'4411',cardShift:'S1',closingKmr:'1200',closingHmr:'340',trips:[{equipmentName:'VPC43',loadingTime:'07:05',unloadingTime:'07:40'}]};

test('a correction is a changed reading, not formatting or a system-filled value',()=>{
 assert.deepEqual(correctedFields(read,{...read,location:'Dipka',bookDate:'2026-11-15',openingKmr:'1100'}),[]);
 assert.deepEqual(correctedFields(read,{...read,closingKmr:'01200',trips:[{equipmentName:'vpc-43',loadingTime:'7:05',unloadingTime:'7.40'}]}),[]);
 assert.deepEqual(correctedFields(read,{...read,assetId:'8',closingHmr:'341'}),['door/machine','HMR']);
 assert.deepEqual(correctedFields(read,{...read,trips:[...read.trips,{equipmentName:'VPC43'}]}),['trips']);
 assert.deepEqual(correctedFields(read,{...read,trips:[{...read.trips[0],unloadingTime:'07:47'}]}),['trips']);
 assert.equal(correctedFields(undefined,read),null);
});

test('entry summary counts time, queue, flags and accuracy of saved cards',()=>{
 const rows=[
  {status:'posted',created_at:'2026-11-15T02:40:00Z',raw_fields:raw({extraction:read}),draft:read},
  {status:'posted',created_at:'2026-11-15T02:41:00Z',raw_fields:raw({extraction:read,flagged:true,finished:'2026-11-15T03:10:00Z'}),draft:{...read,employeeId:'99'}},
  {status:'review',created_at:'2026-11-15T02:42:00Z',raw_fields:raw({total:20000}),draft:{}},
  {status:'error',created_at:'2026-11-15T02:43:00Z',raw_fields:{},draft:{}},
 ];
 const s=summarize(rows.map(cardFacts));
 assert.equal(s.cards,4);assert.equal(s.read,4);assert.equal(s.errors,1);assert.equal(s.flagged,2);
 assert.equal(s.wallMs,30*60000);assert.equal(s.readMedianMs,12000);
 assert.equal(s.saved,2);assert.equal(s.clean,1);assert.equal(s.accuracy,50);assert.deepEqual(s.fieldCounts,{employee:1});
 assert.deepEqual(s.models,['gemini-3.1-flash-lite']);assert.equal(s.tokens,30000);
 const text=entryReadMessage({name:'VLB entry 1',kind:'vehicle',context:{location:'Dipka',bookDate:'2026-11-15',bookShiftCode:'A'}},s);
 assert.match(text,new RegExp('^'+REPORT_HEADER));
 assert.match(text,/Scan entry read - Dipka/);assert.match(text,/VLB \| 2026-11-15 \| Shift S1 \| VLB entry 1/);
 assert.match(text,/Total time: 30 min 0 s/);assert.match(text,/2 clean \(50%\), 2 flagged/);
 assert.equal(duration(5700),'5.7 s');assert.equal(duration(3*3600000+60000),'3 h 1 min');
});

test('reports each read entry and each closed batch once, only after the feature started',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE mis_log_books(id BIGINT PRIMARY KEY,book_date DATE);
  CREATE TABLE mis_scan_batches(id UUID PRIMARY KEY,kind TEXT,name TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),expected_context JSONB);
  CREATE TABLE mis_scan_cards(id UUID PRIMARY KEY,batch_id UUID,ordinal INT,status TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),raw_fields JSONB DEFAULT '{}',draft JSONB DEFAULT '{}',
   logbook_id BIGINT,duplicate_of UUID,review_note TEXT NOT NULL DEFAULT '');
  CREATE TABLE mis_vlb_batches(id UUID PRIMARY KEY,name TEXT,site TEXT,book_date DATE,shift TEXT,closed_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ);`);
 const sent=[];const telegram={async send(login,message,key){sent.push({login,message,key});return true;}};
 const reporter=createScanBatchReporter({pool:pgPool(db),telegram,recipients:async()=>['owner'],log:{error(){}}});
 await reporter.tick();// starts the feature clock
 // An old entry from before the start is never reported.
 await db.query(`INSERT INTO mis_scan_batches VALUES('00000000-0000-4000-8000-000000000009','vehicle','old',NOW()-interval '1 hour','{"location":"Dipka","bookDate":"2026-11-14","bookShiftCode":"A"}')`);
 await db.query(`INSERT INTO mis_scan_cards(id,batch_id,ordinal,status,created_at) VALUES('00000000-0000-4000-8000-000000000019','00000000-0000-4000-8000-000000000009',1,'posted',NOW()-interval '1 hour')`);
 const ctx=JSON.stringify({location:'Dipka',bookDate:'2026-11-15',bookShiftCode:'A'});
 await db.query(`INSERT INTO mis_scan_batches VALUES('00000000-0000-4000-8000-000000000001','vehicle','VLB entry 1',NOW()+interval '1 second',$1)`,[ctx]);
 const card=(n,status,minutesAgo)=>db.query(`INSERT INTO mis_scan_cards(id,batch_id,ordinal,status,created_at,raw_fields,draft) VALUES($1,'00000000-0000-4000-8000-000000000001',$2,$3,NOW()-make_interval(mins=>$4),$5,$6)`,
  ['00000000-0000-4000-8000-00000000010'+n,n,status,minutesAgo,JSON.stringify(raw({extraction:read})),JSON.stringify(read)]);
 await card(1,'review',5);await card(2,'reading',5);
 await reporter.tick();
 assert.equal(sent.length,0,'a card is still being read');
 await db.query(`UPDATE mis_scan_cards SET status='review' WHERE ordinal=2 AND batch_id='00000000-0000-4000-8000-000000000001'`);
 await card(3,'review',0);
 await reporter.tick();
 assert.equal(sent.length,0,'cards are still arriving');
 await db.query(`UPDATE mis_scan_cards SET created_at=NOW()-interval '5 minutes'`);
 await reporter.tick();await reporter.tick();
 assert.equal(sent.length,1);assert.equal(sent[0].login,'owner');assert.match(sent[0].key,/^scan-batch-report:read:/);
 assert.match(sent[0].message,/Scan entry read - Dipka/);assert.match(sent[0].message,/Cards: 3 read/);
 await db.query(`UPDATE mis_scan_cards SET status='posted'`);
 await db.query(`INSERT INTO mis_vlb_batches VALUES('00000000-0000-4000-8000-000000000501','CMLL/DIPKA/15 -NOV-26/S1','DIPKA','2026-11-15','S1',NOW()+interval '2 second',NULL,NULL)`);
 await reporter.tick();await reporter.tick();
 assert.equal(sent.length,2);assert.match(sent[1].key,/^scan-batch-report:closed:/);
 assert.match(sent[1].message,/Batch complete - DIPKA/);assert.match(sent[1].message,/Cards: 3 scanned, 3 saved/);
 assert.match(sent[1].message,/Accuracy: 3 of 3 saved cards needed no correction \(100%\)/);
 assert.doesNotMatch(sent.map(s=>s.message).join('\n'),/old/);
});

test('the report can be switched off and is listed in the Automation Centre',()=>{
 assert.equal(scanBatchReportEnabled({}),true);assert.equal(scanBatchReportEnabled({MIS_SCAN_BATCH_REPORT:'off'}),false);
 const row=AUTOMATIONS.find(a=>a.key==='scan-batch-report');
 assert.equal(row.code,'A24');assert.deepEqual(row.count.outbox,['scan-batch-report']);
});
