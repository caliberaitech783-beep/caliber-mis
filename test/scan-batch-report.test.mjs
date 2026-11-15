import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {correctedFields,cardFacts,summarize,batchClosedMessage,subBatchLabel,batchLineName,duration,createScanBatchReporter,REPORT_TITLE,scanBatchReportEnabled} from '../server/services/scan-batch-report.mjs';
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

const rows=[
 {status:'posted',created_at:'2026-11-15T02:40:00Z',raw_fields:raw({extraction:read}),draft:read},
 {status:'posted',created_at:'2026-11-15T02:41:00Z',raw_fields:raw({extraction:read,flagged:true,finished:'2026-11-15T03:10:00Z'}),draft:{...read,employeeId:'99',trips:[...read.trips,...read.trips]}},
 {status:'review',created_at:'2026-11-15T02:42:00Z',raw_fields:raw({total:20000,extraction:read}),draft:{}},
 {status:'error',created_at:'2026-11-15T02:43:00Z',raw_fields:{},draft:{}},
];

test('summary counts time, flags, trips and accuracy of saved cards',()=>{
 const s=summarize(rows.map(cardFacts));
 assert.equal(s.cards,4);assert.equal(s.read,4);assert.equal(s.errors,1);assert.equal(s.flagged,2);assert.equal(s.autoCleared,2);
 assert.equal(s.trips,4,'saved trips (1 + 2) and the read trip of the card still in review');
 assert.equal(s.wallMs,30*60000);assert.equal(s.readMedianMs,12000);
 assert.equal(s.saved,2);assert.equal(s.clean,1);assert.equal(s.accuracy,50);assert.deepEqual(s.fieldCounts,{employee:1,trips:1});
 assert.deepEqual(s.models,['gemini-3.1-flash-lite']);assert.equal(s.tokens,30000);
 assert.equal(duration(5700),'5.7 s');assert.equal(duration(3*3600000+60000),'3 h 1 min');
});

test('one message per closed batch: full batch name, sub batches with auto-cleared, error and total, cards with trips',()=>{
 const facts=rows.map(cardFacts);
 const text=batchClosedMessage({site:'Gauri Pauni OC (2nd)',name:'CMLL/GAURI PAUNI OC (2ND)/9TH -NOV-26/S1/B01',shift:'S1',creator:'TeklalMahto'},[
  {name:'CMLL/2026-11-15/DIPKA/S1/TEKLALMAHTO/B01',kind:'vehicle',context:{},facts:facts.slice(0,2)},
  {name:'CMLL/2026-11-15/DIPKA/S1/RAMU/B02',kind:'vehicle',context:{},facts:facts.slice(2)},
 ]);
 const lines=text.split('\n');
 assert.deepEqual(lines,[
  '<b>'+REPORT_TITLE+'</b>',
  '📋 VLB · 9TH -NOV-26/S1/B01 · teklalmahto',
  '🗂 Scanned 4 · Trips 4',
  '🔍 Extracted 3 · Processed 2',
  '📦 2 sub batches · ✅ auto · ❌ error',
  '• B01 TEKLALMAHTO · 2 · ✅1 · ❌1',
  '• B02 RAMU · 2 · ✅1 · ❌1',
  '▸ All · 4 · ✅2 · ❌2',
  lines[8],
  '⚡ 14.7 s/card · Accuracy 50%',
  '🤖 gemini-3.1-flash-lite',
 ],'the site name and the full batch name are on the picture; every text line fits one phone line');
 assert.match(lines[8],/^⏱ \d\d:\d\d → \d\d:\d\d · 30 min 0 s$/);
 assert.ok(lines.every(line=>line.replace(/<\/?b>/g,'').length<=42),'short enough for one line on a phone');
 assert.equal(subBatchLabel('VLB entry 1'),'VLB entry 1');
 assert.equal(batchLineName('CMLL/DIPKA/15TH -NOV-26/S1/B02','ramu'),'15TH -NOV-26/S1/B02 · ramu','the user who made the batch');
 assert.equal(batchLineName('CMLL/DIPKA/15TH -NOV-26/S1/B02',null),'15TH -NOV-26/S1/B02');
 assert.equal(batchLineName('Other name'),'Other name');
 assert.match(batchClosedMessage({site:'Dipka',name:'A<B',shift:'S1'},[{name:'y',kind:'vehicle',context:{},facts}]),/\n📋 VLB · A&lt;B\n/);
 const many=Array.from({length:20},(_,i)=>({name:'S'+i,kind:'vehicle',context:{},facts}));
 const long=batchClosedMessage({site:'Dipka',name:'CMLL/DIPKA/15 -NOV-26/S1',shift:'S1'},many);
 assert.match(long,/• \+8 more\n/);assert.ok(long.length<=1024,'fits a photo caption');
});

test('one message per closed batch, sent once, only after the feature started',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE mis_log_books(id BIGINT PRIMARY KEY,book_date DATE);
  CREATE TABLE mis_scan_batches(id UUID PRIMARY KEY,kind TEXT,name TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),expected_context JSONB);
  CREATE TABLE mis_scan_cards(id UUID PRIMARY KEY,batch_id UUID,ordinal INT,status TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),raw_fields JSONB DEFAULT '{}',draft JSONB DEFAULT '{}',
   logbook_id BIGINT,duplicate_of UUID,review_note TEXT NOT NULL DEFAULT '');
  CREATE TABLE mis_vlb_batches(id UUID PRIMARY KEY,name TEXT,site TEXT,book_date DATE,shift TEXT,closed_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,archived_at TIMESTAMPTZ,created_by TEXT,creator_login TEXT);`);
 const sent=[];const telegram={async send(login,message,key,options){sent.push({login,message,key,options});return true;}};
 const reporter=createScanBatchReporter({pool:pgPool(db),telegram,recipients:async()=>['owner'],log:{error(){}}});
 await reporter.tick();// starts the feature clock
 // A batch closed before the start is never reported.
 await db.query(`INSERT INTO mis_vlb_batches VALUES('00000000-0000-4000-8000-000000000500','old','DIPKA','2026-11-15','S1',NOW()-interval '1 hour',NULL,NULL)`);
 const ctx=JSON.stringify({location:'Dipka',bookDate:'2026-11-15',bookShiftCode:'A'});
 await db.query(`INSERT INTO mis_scan_batches VALUES('00000000-0000-4000-8000-000000000001','vehicle','VLB entry 1',NOW()+interval '1 second',$1)`,[ctx]);
 const card=(n,status)=>db.query(`INSERT INTO mis_scan_cards(id,batch_id,ordinal,status,created_at,raw_fields,draft) VALUES($1,'00000000-0000-4000-8000-000000000001',$2,$3,NOW()-interval '5 minutes',$4,$5)`,
  ['00000000-0000-4000-8000-00000000010'+n,n,status,JSON.stringify(raw({extraction:read})),JSON.stringify(read)]);
 await card(1,'review');await card(2,'review');await card(3,'review');
 await reporter.tick();
 assert.equal(sent.length,0,'no message while the batch is open, not even when a sub batch has been read');
 await db.query(`UPDATE mis_scan_cards SET status='posted'`);
 await db.query(`INSERT INTO mis_vlb_batches VALUES('00000000-0000-4000-8000-000000000501','CMLL/DIPKA/15 -NOV-26/S1','DIPKA','2026-11-15','S1',NOW()+interval '2 second',NULL,NULL,NULL,'teklalmahto')`);
 await reporter.tick();await reporter.tick();
 assert.equal(sent.length,1,'one message for the closed batch');
 assert.equal(sent[0].login,'owner');assert.match(sent[0].key,/^scan-batch-report:closed:/);
 assert.match(sent[0].message,/^<b>SITE-WISE BATCH COMPLETION REPORT<\/b>\n📋 VLB · 15 -NOV-26\/S1 · teklalmahto\n/);
 assert.match(sent[0].message,/🗂 Scanned 3 · Trips 3\n🔍 Extracted 3 · Processed 3\n/);
 assert.match(sent[0].message,/📦 1 sub batch · ✅ auto · ❌ error\n• VLB entry 1 · 3 · ✅3 · ❌0\n/);
 assert.match(sent[0].message,/Accuracy 100%/);
 assert.deepEqual(sent[0].options,{html:true,photo:{site:'DIPKA',kind:'VLB',batch:'CMLL/DIPKA/15 -NOV-26/S1'}},'the site picture with the full batch name goes first');
 // A sample is the same report of the latest closed batch, sent again under its own key each time.
 assert.deepEqual(await reporter.sendSample(),{batch:'CMLL/DIPKA/15 -NOV-26/S1',people:1,sent:1});
 assert.equal(sent.length,2);assert.match(sent[1].key,/^scan-batch-report:sample:00000000-0000-4000-8000-000000000501:\d+:owner$/);
 assert.equal(sent[1].message,sent[0].message);assert.deepEqual(sent[1].options,sent[0].options);
 await reporter.sendSample();assert.notEqual(sent[2].key,sent[1].key,'every sample is a new message');
 await reporter.tick();assert.equal(sent.length,3,'a sample never repeats the real report');
});

test('the report can be switched off and is listed in the Automation Centre',()=>{
 assert.equal(scanBatchReportEnabled({}),true);assert.equal(scanBatchReportEnabled({MIS_SCAN_BATCH_REPORT:'off'}),false);
 const row=AUTOMATIONS.find(a=>a.key==='scan-batch-report');
 assert.equal(row.code,'A24');assert.deepEqual(row.count.outbox,['scan-batch-report']);
});
