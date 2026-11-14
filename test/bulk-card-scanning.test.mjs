import {prepareVlbFixture} from './operational-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../server/routes/bulk-card-scanning.mjs';import {LOG_BOOK_SCHEMA,registerLogBooks} from '../server/routes/log-book.mjs';import {extractCard,matchScanDraft} from '../server/rules/scan-extraction.mjs';
import {cardReviewGroup} from '../shared/scan-card-groups.mjs';
process.env.VLB_TWO_STAGE_BATCHES='0'; // legacy single-step batch expectations
const masters=[{id:1,master_name:'Equipment master',record_data:{category:'Vehicle',door:'V321',currentLocation:'Sasti OC'}},{id:2,master_name:'C-Dir Employee master',record_data:{name:'TEST DRIVER',empId:'EMP100',site:'Sasti OC'}},{id:3,master_name:'Shift Master',record_data:{site:'Sasti OC',shiftName:'Shift A'}},{id:4,master_name:'Equipment master',record_data:{category:'Equipment',door:'EQ1',currentLocation:'Sasti OC'}},{id:5,master_name:'Equipment master',record_data:{category:'Equipment',door:'LPC01',currentLocation:'Sasti OC'}}];
masters.push({id:6,master_name:'C-Dir Employee master',record_data:{name:'RELIEF DRIVER',empId:'EMP200',site:'Sasti OC'}});
for(let i=2;i<=40;i++)masters.push({id:100+i,master_name:'Equipment master',record_data:{category:'Vehicle',door:'V'+(321+i),currentLocation:'Sasti OC'}});
for(let i=3;i<=40;i++)masters.push({id:200+i,master_name:'C-Dir Employee master',record_data:{name:'Driver '+i,empId:'EMP'+(200+i),site:'Sasti OC'}});
const text=(i=1,kind='vehicle')=>`Book date: 19-12-2026\nLocation: Sasti OC\nDoor No: ${kind==='vehicle'?'V321':'EQ1'}\nEmployee ID: ${kind==='vehicle'&&i>=3&&i<=40?'EMP'+(200+i):'EMP100'}\nShift: Shift A\nSHIFT [x] I\nShift hours: 8\nOpening KMR: 1000\nClosing KMR: 1040\nOpening HMR: 200\nClosing HMR: 206\n${kind==='vehicle'?'Trip Card':'Job Card'} No: CARD-${i}\nL01 08:20 08:40 2${kind==='vehicle'?'\nMACHINE-WISE SUMMARY\n1 LPC01 2':''}`;
test('card extraction keeps exact master matches, zero readings and trip rows; ambiguous IDs are not guessed',()=>{const d=extractCard(text(),'vehicle',masters);assert.equal(d.draft.assetId,'1');assert.equal(d.draft.employeeId,'2');assert.equal(d.draft.shiftId,'3');assert.equal(d.draft.bookDate,'2026-12-19');assert.equal(d.draft.openingKmr,'1000');assert.equal(d.draft.trips[0].tripCount,2);assert.equal(extractCard(text().replace('V321','V32I'),'vehicle',masters).draft.assetId,'');assert.equal(extractCard(text(),'vehicle',[...masters,masters[0]]).draft.assetId,'');assert.equal(extractCard(text().replace('1000\nClosing KMR','0\nClosing KMR'),'vehicle',masters).draft.openingKmr,'0');});
test('batch review gates posting, saves 40 log books atomically, deduplicates retries, retains scans and supports job cards',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);for(const m of masters)await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[m.id,m.master_name,JSON.stringify(m.record_data)]);
 // Serialize transaction-owning clients to emulate PostgreSQL connection checkout.
 let tail=Promise.resolve();const query=(q,a)=>q.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!a&&q.includes(';')?db.exec(q):db.query(q,a);const pool={query,connect:async()=>{const previous=tail;let done;tail=new Promise(r=>done=r);await previous;return {query,release(){done()}}}};
 const app=express();app.use(express.json({limit:'20mb'}));let i=0,retryReads=0,firstReadImage;const ocr={recognize:async(image,context={})=>{if(context.forceRead){retryReads++;assert.deepEqual(Buffer.from(image),firstReadImage);return {text:text(1),confidence:91}}i++;if(i===1){firstReadImage=Buffer.from(image);return {text:text(i).replace('V321','V32I'),confidence:91}}const card=text(i,context.kind);return {text:i===2?card.replace('EMP100','EMP200'):i<=40?card.replace('V321','V'+(321+i)):card,confidence:91}},close(){}};const requireSession=(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.session={login:'test-admin'};next()};const requireAdministrator=(req,res,next)=>req.headers.authorization==='admin'?next():res.sendStatus(403);registerLogBooks(app,{pool,requireSession,requireAdministrator,getSiteScope:async()=>({sites:null})});let archiveAttempts=0;const service=registerBulkCardScanning(app,{pool,requireSession,requireAdministrator,ocr,localDrafts:true,readHours:async()=>({breakdownHours:1,availabilityHours:6,idleHours:2}),archiveSavedBatch:async(batch,rows)=>{assert.ok(rows.every(r=>r.status==='posted'&&r.checked_by));if(++archiveAttempts===1)throw Error('test disk interruption');return {status:'saved',target:'local',folders:['Trip Card/test'],azureUploadEnabled:false};}});await service.start();t.after(()=>service.stop());app.use((e,req,res,next)=>res.status(500).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close()});const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,method='GET',body,auth='admin')=>{if(body?.kind==='vehicle'&&body.expectedContext)await prepareVlbFixture(db,body.expectedContext);const r=await fetch(base+path,{method,headers:{Authorization:auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:r.headers.get('content-type')?.includes('application/json')?await r.json():await r.text()}};
 assert.equal((await call('/api/scan-batches','GET',null,'normal')).status,403);assert.equal((await call('/api/scan-batches','GET',null,'')).status,401);
 const batch=(await call('/api/scan-batches','POST',{kind:'vehicle',name:'40 cards',expectedContext:{bookDate:'2026-12-19',location:'Sasti OC',cardShift:'I'}})).data.id;
 const batchName=(await db.query('SELECT name FROM mis_scan_batches WHERE id=$1',[batch])).rows[0].name;assert.equal(batchName,'CMLL/2026-12-19/SASTI OC/S1/TEST-ADMIN/B01');
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBEkAAAAASUVORK5CYII=','base64');let firstImage;
 for(let n=0;n<40;n++){const bytes=Buffer.concat([image,Buffer.from('card'+n)]);if(n===0)firstImage=bytes.toString('base64');const id=randomUUID();assert.equal((await call('/api/scan-batches/'+batch+'/cards','POST',{base64:bytes.toString('base64'),uploadKey:id,filename:'scan'+n+'.png',captureTiming:{mode:'scanner',pages:40,durationMs:95000}})).status,201);if(!n)assert.equal((await call('/api/scan-batches/'+batch+'/cards','POST',{base64:bytes.toString('base64'),uploadKey:id})).status,200);}
 let cards;for(let tries=0;tries<200;tries++){cards=(await call('/api/scan-batches/'+batch)).data.cards;if(cards.every(c=>c.status==='review'))break;await new Promise(r=>setTimeout(r,20))}assert.equal(retryReads,40,'every VLB door receives one independent image re-read');assert.equal(cards[0].draft.assetId,'1',JSON.stringify({recovery:cards[0].raw_fields.firstScanDoorRecovery,door:cards[0].draft.doorText,site:cards[0].draft.location}));assert.equal(cards[0].raw_fields.firstScanDoorRecovery.recovered,true);assert.equal(cards.length,40);assert.ok(cards.every(c=>c.status==='review'));assert.ok(cards.every(c=>!c.image));assert.deepEqual(cards[0].raw_fields.captureTiming,{mode:'scanner',pages:40,durationMs:95000});
 const prior=cards[0];const draftSave=await call('/api/scan-cards/'+prior.id,'PUT',{draft:{...prior.draft,location:'Sasti oc',openingKmr:'',remark:'Persist all scan information'},revision:prior.revision,action:'save'});assert.equal(draftSave.status,200);assert.equal(draftSave.data.revision,prior.revision+1);let reload=(await call('/api/scan-batches/'+batch)).data.cards[0];assert.equal(reload.draft.location,'Sasti OB');assert.equal(reload.draft.openingKmr,'');assert.equal(reload.draft.remark,'Persist all scan information');assert.equal(reload.status,'review');assert.equal(Number((await db.query('SELECT count(*) n FROM mis_log_books')).rows[0].n),0);await call('/api/scan-cards/'+prior.id,'PUT',{draft:prior.draft,revision:reload.revision,action:'save'});cards=(await call('/api/scan-batches/'+batch)).data.cards;
 await db.query("UPDATE mis_scan_cards SET confidence=NULL,review_note='shiftHours: missing',raw_fields=raw_fields||$1::jsonb,draft=draft||$2::jsonb WHERE id=$3",[JSON.stringify({extractionWarning:'Gemini: shiftHours: missing printedTotalTrips: missing'}),JSON.stringify({extractionReviewFields:['shiftHours'],meterReviewFields:['openingHmr']}),cards[0].id]);cards=(await call('/api/scan-batches/'+batch)).data.cards;assert.ok(!cards[0].checks.warnings.some(s=>/shiftHours: missing|printedTotalTrips|OCR engine|interpreted using/.test(s)));assert.deepEqual(cards[0].checks.errors,[]);
 const first=cards[0];assert.equal((await call('/api/scan-batches/'+batch+'/post','POST',{cards:[{id:first.id,revision:first.revision}]})).status,409);assert.equal((await call('/api/scan-cards/'+first.id,'PUT',{draft:first.draft,revision:first.revision,action:'approve',checked:false})).status,400);
 const unknownMachine=await call('/api/scan-cards/'+first.id,'PUT',{draft:{...first.draft,machineNotationRuleVersion:undefined,trips:[{...first.draft.trips[0],equipmentName:'V999'}],scanMachineSummary:[{equipmentName:'V999',tripCount:2}]},revision:first.revision,action:'approve',checked:true});assert.equal(unknownMachine.status,400);assert.match(unknownMachine.data.error,/no equipment master record matches/);
 const mismatch=await call('/api/scan-cards/'+first.id,'PUT',{draft:{...first.draft,scanMachineSummary:[{equipmentName:'L01',tripCount:99}]},revision:first.revision,action:'approve',checked:true});assert.equal(mismatch.status,400);assert.match(mismatch.data.error,/summary mismatch/);
 assert.equal((await call('/api/scan-batches/'+batch+'/validate-context','POST',{action:'proceed'})).status,200);
 for(const c of cards){const r=await call('/api/scan-cards/'+c.id,'PUT',{draft:c.draft,revision:c.revision,action:'approve',checked:true});assert.equal(r.status,200,JSON.stringify(r.data));}
 cards=(await call('/api/scan-batches/'+batch)).data.cards;assert.deepEqual(cards[0].draft.meterReviewFields,[]);assert.deepEqual(cards[0].draft.extractionReviewFields,[]);const request={cards:cards.map(c=>({id:c.id,revision:c.revision}))};assert.equal((await call('/api/scan-batches/'+batch+'/post','POST',{cards:request.cards.slice(0,-1)})).status,409);assert.equal(Number((await db.query('SELECT count(*) n FROM mis_log_books')).rows[0].n),0);
 await db.query("UPDATE master_records SET record_data=record_data||'{\"site\":\"Other site\"}'::jsonb WHERE id=3");assert.equal((await call('/api/scan-batches/'+batch+'/post','POST',request)).status,409);assert.equal(Number((await db.query('SELECT count(*) n FROM mis_log_books')).rows[0].n),0);await db.query("UPDATE master_records SET record_data=record_data||'{\"site\":\"Sasti OC\"}'::jsonb WHERE id=3");
 const over=await call('/api/scan-batches/'+batch+'/post','POST',request);assert.equal(over.status,409);assert.match(over.data.error,/Combined working HMR.*limit is 8 hours/i);
 assert.equal(Number((await db.query('SELECT count(*) n FROM mis_log_books')).rows[0].n),0);
 const relief=cards[1];assert.equal(relief.draft.employeeId,'6');
 const corrected=await call('/api/scan-cards/'+relief.id,'PUT',{draft:{...relief.draft,openingHmr:'206',closingHmr:'208'},revision:relief.revision,action:'approve',checked:true});assert.equal(corrected.status,200,JSON.stringify(corrected.data));
 request.cards[1].revision=corrected.data.revision;
 const posted=await call('/api/scan-batches/'+batch+'/post','POST',request);assert.equal(posted.status,200,JSON.stringify(posted.data));assert.equal(posted.data.count,40);assert.equal(posted.data.archive.status,'pending');const archived=await call('/api/scan-batches/'+batch+'/archive','POST',{});assert.equal(archived.data.status,'saved');assert.equal(archived.data.azureUploadEnabled,false);assert.equal(new Set(posted.data.records.map(r=>r.book_no)).size,40);assert.match(posted.data.records[0].book_no,/^VLB_S\/19TH-DEC26\/S1\/001$/);assert.equal((await call('/api/scan-batches/'+batch+'/post','POST',request)).data.count,40);assert.equal(Number((await db.query('SELECT count(*) n FROM mis_log_books')).rows[0].n),40);
 assert.equal((await db.query('SELECT name FROM mis_scan_batches WHERE id=$1',[batch])).rows[0].name,batchName,'posting and retrying a saved batch retain its original batch name');const shared=(await db.query('SELECT data FROM mis_log_books WHERE asset_id=1 ORDER BY id')).rows.map(r=>r.data);assert.deepEqual(shared.map(r=>r.totalWorkingHmr),[6,2]);assert.deepEqual(shared.map(r=>String(r.employeeId)),['2','6']);
 const stored=(await db.query('SELECT data FROM mis_log_books ORDER BY id LIMIT 1')).rows[0].data;assert.equal(stored.location,'Sasti OB');assert.equal(first.raw_fields.locationReadings[0],'Sasti OC');assert.equal(stored.scanCardId,first.id);assert.equal(stored.caliberId,'EMP100');assert.equal(stored.totalTrips,2);const edited=await call('/api/log-books/vehicle/'+posted.data.records[0].id,'PUT',{...stored,revision:1,closingHmr:206});assert.equal(edited.status,200);assert.equal(edited.data.data.scanCardId,first.id);assert.equal(edited.data.data.totalWorkingHmr,6);
 const duplicateBatch=(await call('/api/scan-batches','POST',{kind:'vehicle',expectedContext:{bookDate:'2026-12-19',location:'Sasti OC',cardShift:'I'}})).data.id;const duplicateId=randomUUID();const skipped=await call('/api/scan-batches/'+duplicateBatch+'/cards','POST',{base64:firstImage,uploadKey:duplicateId});assert.equal(skipped.status,200);assert.equal(skipped.data.duplicateSkipped,true);assert.equal(skipped.data.original.bookNo,posted.data.records[0].book_no);assert.equal((await call('/api/scan-batches/'+duplicateBatch)).data.cards.length,0,'an exact duplicate never enters review');const legacyDuplicate=randomUUID(),originalHash=(await db.query('SELECT image_hash FROM mis_scan_cards WHERE id=$1',[first.id])).rows[0].image_hash;await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,status) VALUES($1,$2,5,'legacy-duplicate.png',$3,$4,'review')",[legacyDuplicate,duplicateBatch,Buffer.from(firstImage,'base64'),originalHash]);assert.equal((await call('/api/scan-batches/'+duplicateBatch)).data.cards.length,0,'an already-uploaded exact duplicate is removed from active review');const legacyState=(await db.query('SELECT status,review_note,duplicate_of FROM mis_scan_cards WHERE id=$1',[legacyDuplicate])).rows[0];assert.equal(legacyState.status,'rejected');assert.equal(legacyState.review_note,'Exact duplicate upload skipped automatically');assert.equal(legacyState.duplicate_of,first.id,'a legacy duplicate points at its original');assert.equal((await call('/api/scan-batches/'+duplicateBatch)).data.duplicates.length,2,'skipped duplicates are listed beside the entry with their originals');
 const nextBatch=(await call('/api/scan-batches','POST',{kind:'vehicle',expectedContext:{bookDate:'2026-12-20',location:'Sasti OC',cardShift:'I'}})).data.id;
 const nextId=randomUUID(),nextDraft={...first.draft,assetId:'',bookDate:'2026-12-20',aFormNo:'NEXT-CARD',
  openingKmr:'',openingHmr:'',closingKmr:'1080',closingHmr:'214'};
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,status,draft,raw_fields) VALUES($1,$2,1,'next.png',$3,$6,'review',$4,$5)",
  [nextId,nextBatch,image,JSON.stringify(nextDraft),JSON.stringify({extractionDraft:nextDraft}),nextId]);
 const nextCard=(await call('/api/scan-batches/'+nextBatch)).data.cards[0];
 assert.equal(String(nextCard.draft.assetId),'1');
 assert.equal(Number(nextCard.draft.openingKmr),1040,'carry the previous shift closing KMR into the missing opening');
 assert.equal(Number(nextCard.draft.openingHmr),208);
 const changed=(await call('/api/scan-cards/'+nextId,'PUT',{draft:{...nextCard.draft,openingKmr:'1000',openingHmr:'209'},revision:nextCard.revision,action:'save'})).data;
 assert.equal(changed.draft.openingHmr,'209');assert.equal(changed.draft.openingKmr,'1000','retain the valid opening KMR from the scan');
 const reread=(await call('/api/scan-batches/'+nextBatch)).data.cards[0];assert.equal(reread.draft.openingHmr,'209');assert.equal(Number(reread.draft.openingKmr),1000,'a valid opening KMR is not replaced by the previous shift on a later read');
 await db.query('UPDATE mis_log_books SET deleted_at=NOW() WHERE id=$1',[posted.data.records[0].id]);const accepted=await call('/api/scan-batches/'+duplicateBatch+'/cards','POST',{base64:firstImage,uploadKey:randomUUID()});assert.equal(accepted.status,201,JSON.stringify(accepted));let rescanned;for(let tries=0;tries<100;tries++){rescanned=(await call('/api/scan-batches/'+duplicateBatch)).data.cards[0];if(rescanned?.status==='review')break;await new Promise(r=>setTimeout(r,20))}assert.ok(!rescanned.checks.errors.some(e=>e==='Duplicate card.'||e.includes('already exists')));assert.equal(cardReviewGroup(rescanned,'vehicle'),'orange');
 const jobBatch=(await call('/api/scan-batches','POST',{kind:'equipment'})).data.id,jobId=randomUUID();await call('/api/scan-batches/'+jobBatch+'/cards','POST',{base64:Buffer.concat([image,Buffer.from('job')]).toString('base64'),uploadKey:jobId});let job;for(let tries=0;tries<100;tries++){job=(await call('/api/scan-batches/'+jobBatch)).data.cards[0];if(job.status==='review')break;await new Promise(r=>setTimeout(r,20))}const manual={...job.draft,assetId:4,jobCardNo:'JOB-1'};assert.equal((await call('/api/scan-cards/'+job.id,'PUT',{draft:manual,revision:job.revision,action:'approve',checked:true})).status,200);job=(await call('/api/scan-batches/'+jobBatch)).data.cards[0];const postedJob=await call('/api/scan-batches/'+jobBatch+'/post','POST',{cards:[{id:job.id,revision:job.revision}]});assert.equal(postedJob.status,200);assert.match(postedJob.data.records[0].book_no,/^CAL\/ELB/);const savedEquipment=(await db.query("SELECT data FROM mis_log_books WHERE book_type='equipment'")).rows[0].data;assert.equal(savedEquipment.breakdownHours,1);assert.equal(savedEquipment.hoursSource.availabilityHours,6);
});

test('matching after applying the batch site fills only unambiguous door and driver references',()=>{
 const raw={employeeCode:'EMP100'};
 const draft={doorText:'V321',location:'Sasti OC',assetId:'',employeeId:''};
 assert.deepEqual(matchScanDraft(draft,raw,'vehicle',masters),{...draft,assetId:'1',employeeId:'2'});
 const wrong={...draft,doorText:'V32I'};assert.equal(matchScanDraft(wrong,{employeeCode:'INVALID'},'vehicle',masters),wrong);
 const duplicate={...masters[1],id:90};assert.equal(matchScanDraft(draft,raw,'vehicle',[...masters,duplicate]).employeeId,'');
 const corrected={...draft,assetId:'33',employeeId:'44'};assert.equal(matchScanDraft(corrected,raw,'vehicle',masters),corrected);
});

test('LMV uses VLB-style manual and scan entry without adding cards to a VLB batch',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const legacyBookTable=LOG_BOOK_SCHEMA.slice(0,LOG_BOOK_SCHEMA.indexOf(' DO $lmv_book_type$')).replace(",'lmv'","");
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+legacyBookTable+LOG_BOOK_SCHEMA);
 for(const master of [...masters.slice(0,3),{id:7,master_name:'Equipment master',record_data:{category:'LMV',door:'LMV7',currentLocation:'Sasti OC'}}]){
  await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[master.id,master.master_name,JSON.stringify(master.record_data)]);
 }
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());
 const auth=(req,res,next)=>{req.session={role:'super',login:'admin',permissions:{adminLevel:'Admin'}};next()};
 registerLogBooks(app,{pool,requireSession:auth,requireAdministrator:auth,getSiteScope:async()=>({sites:null})});
 const scans=registerBulkCardScanning(app,{pool,requireSession:auth,requireAdministrator:auth,getSiteScope:async()=>({sites:null}),readPulseFleet:async()=>{throw Error('LMVs use their separate synced master')},ocr:{close(){}}});
 await scans.start();await scans.stop();
 app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(route,method='GET',body)=>{
  const response=await fetch('http://127.0.0.1:'+server.address().port+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json()};
 };
 const draft={bookDate:'2026-12-22',location:'Sasti OC',cardShift:'I',assetId:7,employeeId:2,shiftId:3,shiftHours:8,openingKmr:10,closingKmr:20,openingHmr:0,closingHmr:2,trips:[]};
 assert.equal((await call('/api/log-books/lmv','POST',{...draft,assetId:1})).status,400);
 const manual=await call('/api/log-books/lmv','POST',draft);
 assert.equal(manual.status,201,JSON.stringify(manual.data));
 assert.match(manual.data.book_no,/^CAL\/LMV/);
 const batch=await call('/api/scan-batches','POST',{kind:'vehicle',expectedContext:{...draft,logBookKind:'lmv'}});
 assert.equal(batch.status,201);
 assert.match(batch.data.name,/^CMLL\/LMV/);
 assert.equal((await call('/api/scan-batches')).data.batches.length,0);
 assert.equal((await call('/api/scan-batches?logBookKind=lmv')).data.batches[0].id,batch.data.id);
 const card=randomUUID(),scanDraft={...draft,openingHmr:2,closingHmr:4,doorText:'LMV7',aFormNo:'LMV-1'};
 await db.query("UPDATE mis_scan_batches SET expected_context=expected_context||'{\"confirmed\":true}'::jsonb WHERE id=$1",[batch.data.id]);
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image_hash,draft,status,checked_by) VALUES($1,$2,1,'lmv.png',$3,$4,'approved','admin')",[card,batch.data.id,randomUUID(),JSON.stringify(scanDraft)]);
 const posted=await call('/api/scan-batches/'+batch.data.id+'/post','POST',{cards:[{id:card,revision:1}]});
 assert.equal(posted.status,200,JSON.stringify(posted.data));
 assert.match(posted.data.records[0].book_no,/^CAL\/LMV/);
 assert.equal((await call('/api/log-books/lmv')).data.records.length,2);
 assert.deepEqual((await call('/api/log-books/vehicle')).data.records,[]);
 assert.equal((await db.query('SELECT * FROM mis_vlb_batch_entries')).rows.length,0);
 const scanPath='/api/scan-batches/'+batch.data.id;
 const detail=await call(scanPath);
 assert.equal(detail.status,200,JSON.stringify(detail.data));
 // A partial read (?cards=) returns only the selected card; its save gate still counts every card of the entry.
 const waiting=randomUUID();
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image_hash,draft,status) VALUES($1,$2,2,'next.png',$3,'{}','reading')",[waiting,batch.data.id,randomUUID()]);
 const partial=await call(scanPath+'?cards='+card);
 assert.equal(partial.status,200,JSON.stringify(partial.data));
 assert.equal(partial.data.partial,true);
 assert.deepEqual(partial.data.cards.map(row=>row.id),[card]);
 assert.deepEqual(partial.data.cards[0],detail.data.cards[0],'a selected card is returned exactly as the whole read returns it');
 assert.equal(partial.data.contextGate.waiting,true,'the card still being read holds the gate although it was not selected');
 const whole=await call(scanPath);
 assert.deepEqual(whole.data.cards.map(row=>row.id),[card,waiting]);assert.equal(whole.data.partial,undefined);
 assert.equal((await call(scanPath+'?cards=not-a-card')).status,400);
 await db.query('DELETE FROM mis_scan_cards WHERE id=$1',[waiting]);
 const savedCard=detail.data.cards[0];
 const recordPath='/api/log-books/lmv/'+savedCard.logbook_id;
 const updated=await call(recordPath,'PUT',{...savedCard.saved_data,remark:'Corrected saved scan',revision:savedCard.saved_revision});
 assert.equal(updated.status,200,JSON.stringify(updated.data));
 const corrected=(await call(scanPath)).data.cards[0];
 assert.equal(corrected.saved_data.remark,'Corrected saved scan');
 assert.equal(corrected.saved_revision,updated.data.revision);
 assert.equal((await call(recordPath,'DELETE',{revision:savedCard.saved_revision})).status,409);
 assert.equal((await call(recordPath,'DELETE',{revision:corrected.saved_revision})).status,200);
 assert.deepEqual((await call(scanPath)).data.cards,[]);
 assert.deepEqual((await call(scanPath+'?progress=1')).data.cards,[]);
 assert.equal((await call('/api/log-books/lmv')).data.records.length,1);
});
