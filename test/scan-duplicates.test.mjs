import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID,createHash} from 'node:crypto';
import {registerLogBooks,LOG_BOOK_SCHEMA} from '../log-book.mjs';
import {registerBulkCardScanning,SCAN_SCHEMA} from '../bulk-card-scanning.mjs';
import {drawCard} from './scan-card-fixture.mjs';
import {fingerprintScanImage} from '../scan-fingerprint.mjs';
import {applyContentDuplicate,findContentDuplicate,contentIdentityCertain,contentDuplicateMessage,backfillScanFingerprints,listDuplicateCards} from '../scan-duplicates.mjs';

process.env.VLB_TWO_STAGE_BATCHES='0';

async function harness(t,env={}){
 process.env.SCAN_DUPLICATE_FINGERPRINT='true';process.env.SCAN_DUPLICATE_SKIP_PERCENT=env.skip||'15';process.env.SCAN_DUPLICATE_SUSPECT_PERCENT=env.suspect||'30';
 t.after(()=>{delete process.env.SCAN_DUPLICATE_FINGERPRINT;delete process.env.SCAN_DUPLICATE_SKIP_PERCENT;delete process.env.SCAN_DUPLICATE_SUSPECT_PERCENT;});
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)');
 await db.exec(LOG_BOOK_SCHEMA);await db.exec(SCAN_SCHEMA);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json({limit:'20mb'}));
 const session=(req,res,next)=>{req.session={login:'alice',name:'Alice',role:'super',permissions:{adminLevel:'Admin'}};next()};
 const authorized=(req,res,next)=>next();
 registerLogBooks(app,{pool,requireSession:session,requireAdministrator:authorized,pulseMasterSync:{status:()=>({connected:true}),readBreakdownRequests:async()=>[]}});
 // The reader is never reached for duplicates; other cards fail to read here, which keeps them live (status error) without a model.
 const scanning=registerBulkCardScanning(app,{pool,requireSession:session,requireAdministrator:authorized,ocr:{recognize:async()=>{throw Error('Not used')}},fingerprintBackfill:false});
 app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(route,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}`+route,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const entry=async(context,name)=>{const r=await call('/api/scan-batches','POST',{kind:'vehicle',expectedContext:context,name});assert.equal(r.status,201,JSON.stringify(r));return r.data;};
 const upload=async(batchId,image,ordinal)=>call('/api/scan-batches/'+batchId+'/cards','POST',{uploadKey:randomUUID(),filename:'card.png',base64:image.toString('base64'),...(ordinal?{ordinal}:{})});
 return {db,pool,call,entry,upload,scanning};
}
const shift1={bookDate:'2026-11-01',location:'Majri OB',cardShift:'I'},shift2={bookDate:'2026-11-01',location:'Majri OB',cardShift:'II'};

test('rescanned cards are skipped at upload across entries for the same date, site and shift; new cards are read',async t=>{
 const {call,entry,upload,db}=await harness(t);
 const b01=await entry(shift1,'B01'),b02=await entry(shift1,'B02'),other=await entry(shift2,'shift II');
 const originals=[];
 for(const seed of [1,2,3]){const r=await upload(b01.id,drawCard({seed,writing:'S'+seed}),seed);assert.equal(r.status,201,JSON.stringify(r));originals.push(r.data.id);}
 // Same file again: exact bytes.
 const exact=await upload(b02.id,drawCard({seed:1,writing:'S1'}),1);
 assert.equal(exact.status,200);assert.equal(exact.data.duplicateSkipped,true);assert.equal(exact.data.reason,'exact');assert.equal(exact.data.original.cardId,originals[0]);assert.equal(exact.data.original.entryName,b01.name);assert.equal(exact.data.original.ordinal,1);
 // Same paper fed again: shifted, brighter, noisy.
 const rescan=await upload(b02.id,drawCard({seed:2,writing:'S2',shiftX:9,shiftY:-5,brightness:.05,noise:12}),2);
 assert.equal(rescan.status,200,JSON.stringify(rescan));assert.equal(rescan.data.duplicateSkipped,true);assert.equal(rescan.data.reason,'fingerprint');assert.equal(rescan.data.original.cardId,originals[1]);
 // Fed upside down.
 const flipped=await upload(b02.id,drawCard({seed:3,writing:'S3',rotate:true,shiftX:4,noise:6}),3);
 assert.equal(flipped.status,200,JSON.stringify(flipped));assert.equal(flipped.data.duplicateSkipped,true);assert.equal(flipped.data.original.cardId,originals[2]);
 // A genuinely new card is accepted and queued.
 const fresh=await upload(b02.id,drawCard({seed:4,writing:'NEW'}),4);
 assert.equal(fresh.status,201,JSON.stringify(fresh));assert.equal(fresh.data.duplicateSuspect,undefined);
 // Another shift is another context: the same paper is not a duplicate there.
 const otherShift=await upload(other.id,drawCard({seed:1,writing:'S1',shiftX:3,noise:5}),1);
 assert.equal(otherShift.status,201,JSON.stringify(otherShift));
 const view=await call('/api/scan-batches/'+b02.id);assert.equal(view.status,200,JSON.stringify(view));
 assert.deepEqual(view.data.cards.map(c=>c.ordinal),[4],'only the new card is in the entry');
 assert.deepEqual(view.data.duplicates.map(d=>[d.ordinal,d.reason,d.original.ordinal,d.original.entryName]),[[1,'exact',1,b01.name],[2,'fingerprint',2,b01.name],[3,'fingerprint',3,b01.name]]);
 assert.equal(view.data.duplicates[1].distance.max<=15,true);
 const listed=await call('/api/scan-batches');const row=listed.data.batches.find(b=>b.id===b02.id);assert.equal(row.cards,1);assert.equal(row.duplicates,3);
 assert.equal((await db.query("SELECT count(*)::int n FROM mis_scan_cards WHERE batch_id=$1 AND status='rejected' AND duplicate_of IS NOT NULL AND review_note LIKE 'Duplicate of card % in entry %'",[b02.id])).rows[0].n,3);
 // Duplicates never reach the reader queue.
 assert.equal((await db.query("SELECT count(*)::int n FROM mis_scan_cards WHERE batch_id=$1 AND duplicate_of IS NOT NULL AND status<>'rejected'",[b02.id])).rows[0].n,0);
 // Duplicates do not use entry space: 40 real cards plus duplicates still fit.
 assert.equal((await db.query("SELECT count(*) FILTER(WHERE duplicate_of IS NULL)::int n FROM mis_scan_cards WHERE batch_id=$1",[b02.id])).rows[0].n,1);
 // Restore: the operator overrules the system and the card is read like any other.
 const dup=view.data.duplicates[1];
 const restored=await call('/api/scan-cards/'+dup.id+'/restore-duplicate','POST',{});assert.equal(restored.status,200,JSON.stringify(restored));
 const after=(await db.query('SELECT status,duplicate_of,review_note,raw_fields FROM mis_scan_cards WHERE id=$1',[dup.id])).rows[0];
 assert.notEqual(after.status,'rejected');assert.equal(after.duplicate_of,null);assert.equal(after.review_note,'');assert.equal(after.raw_fields.duplicateRestored.by,'alice');assert.equal(after.raw_fields.duplicateRestored.original.cardId,originals[1]);
 const again=await call('/api/scan-batches/'+b02.id);assert.deepEqual(again.data.cards.map(c=>c.ordinal).sort(),[2,4]);assert.equal(again.data.duplicates.length,2);
 assert.equal((await call('/api/scan-cards/'+dup.id+'/restore-duplicate','POST',{})).status,409,'restore is one-way');
});

test('a rescan of a card already saved to the log book is skipped and names the book number',async t=>{
 const {entry,upload,db}=await harness(t);
 const b01=await entry(shift1,'B01'),b02=await entry(shift1,'B02');
 const first=await upload(b01.id,drawCard({seed:7,writing:'SAVED'}),1);assert.equal(first.status,201);
 const book=(await db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) VALUES('MAJ/0007','vehicle','2026-11-01','Majri OB',1,$1,$2,'alice') RETURNING id",[JSON.stringify({bookDate:'2026-11-01',location:'Majri OB',cardShift:'I',scanCardId:first.data.id,scanCardNumber:'A7'}),randomUUID()])).rows[0];
 await db.query("UPDATE mis_scan_cards SET status='posted',logbook_id=$2,draft=$3::jsonb WHERE id=$1",[first.data.id,book.id,JSON.stringify({bookDate:'2026-11-01',assetId:'1',aFormNo:'A7'})]);
 const again=await upload(b02.id,drawCard({seed:7,writing:'SAVED',shiftX:5,noise:8}),1);
 assert.equal(again.status,200,JSON.stringify(again));assert.equal(again.data.duplicateSkipped,true);assert.equal(again.data.original.bookNo,'MAJ/0007');
 // Once the saved record is deleted the paper may be scanned again.
 await db.query('UPDATE mis_log_books SET deleted_at=NOW() WHERE id=$1',[book.id]);
 const afterDelete=await upload(b02.id,drawCard({seed:7,writing:'SAVED',shiftX:5,noise:8}),2);
 assert.equal(afterDelete.status,201,JSON.stringify(afterDelete));
});

test('a borderline scan is read and tagged as a suspect; a certain content match is then rejected, an uncertain one is held for review',async t=>{
 const {entry,upload,db,pool}=await harness(t,{skip:'2',suspect:'60'});
 const b01=await entry(shift1,'B01'),b02=await entry(shift1,'B02');
 const first=await upload(b01.id,drawCard({seed:11,writing:'ELEVEN'}),1);assert.equal(first.status,201);
 const suspect=await upload(b02.id,drawCard({seed:11,writing:'ELEVEN',shiftX:12,shiftY:8,noise:14}),1);
 assert.equal(suspect.status,201,JSON.stringify(suspect));assert.equal(suspect.data.duplicateSuspect.cardId,first.data.id);assert.equal(suspect.data.duplicateSuspect.entryName,b01.name);
 const context={id:b01.id,kind:'vehicle',expected_context:{...shift1,confirmed:true}};
 const draft={bookDate:'2026-11-01',bookDateSource:'scan',location:'Majri OB',assetId:'5',aFormNo:'A-11',extractionReviewFields:[]};
 await db.query("UPDATE mis_scan_cards SET status='review',draft=$2::jsonb WHERE id=$1",[first.data.id,JSON.stringify(draft)]);
 // Certain identity (door and card number read cleanly) on the entry date: rejected as a duplicate of the original.
 await db.query("UPDATE mis_scan_cards SET status='review',draft=$2::jsonb WHERE id=$1",[suspect.data.id,JSON.stringify(draft)]);
 const card=(await db.query('SELECT * FROM mis_scan_cards WHERE id=$1',[suspect.data.id])).rows[0];
 assert.equal(contentIdentityCertain(card,'vehicle',context.expected_context),true);
 const original=await applyContentDuplicate(pool,'vehicle',card,{...context,id:b02.id});
 assert.equal(original.cardId,first.data.id);assert.equal(original.entryName,b01.name);
 const rejected=(await db.query('SELECT status,duplicate_of,review_note FROM mis_scan_cards WHERE id=$1',[suspect.data.id])).rows[0];
 assert.equal(rejected.status,'rejected');assert.equal(rejected.duplicate_of,first.data.id);assert.equal(rejected.review_note,'Duplicate of card 1 in entry '+b01.name);
 assert.equal((await listDuplicateCards(pool,b02.id)).map(d=>d.reason).join(),'content');
 // Uncertain identity (door flagged for review): never auto-rejected; the possible duplicate is named for the operator.
 const unsure=await upload(b02.id,drawCard({seed:12,writing:'TWELVE'}),2);assert.equal(unsure.status,201);
 await db.query("UPDATE mis_scan_cards SET status='review',draft=$2::jsonb WHERE id=$1",[unsure.data.id,JSON.stringify({...draft,extractionReviewFields:['assetId']})]);
 const unsureCard=(await db.query('SELECT * FROM mis_scan_cards WHERE id=$1',[unsure.data.id])).rows[0];
 assert.equal(contentIdentityCertain(unsureCard,'vehicle',context.expected_context),false);
 assert.equal(await applyContentDuplicate(pool,'vehicle',unsureCard,{...context,id:b02.id}),null);
 assert.equal((await db.query('SELECT status FROM mis_scan_cards WHERE id=$1',[unsure.data.id])).rows[0].status,'review');
 const found=await findContentDuplicate(pool,'vehicle',unsureCard,{...context,id:b02.id},{bookDate:'2026-11-01',assetId:'5',number:'A11'});
 assert.equal(found.cardId,first.data.id);
 assert.equal(contentDuplicateMessage(found,false),'Possible duplicate of card 1 in entry '+b01.name+'. Confirm the card number and door before saving.');
 assert.equal(contentDuplicateMessage(found,true),'Same card number, door and date already appear on card 1 in entry '+b01.name+'. Reject this card or correct the values.');
 // A card dated differently from its entry is never certain: the mismatch gate handles it.
 assert.equal(contentIdentityCertain({...card,draft:{...draft,bookDate:'2026-01-11'}},'vehicle',context.expected_context),false);
 assert.equal(contentIdentityCertain({...card,draft:{...draft,bookDateSource:'system-fallback'}},'vehicle',context.expected_context),false);
});

test('fingerprints are computed for older cards so earlier entries can be matched; unavailable images are marked, not retried forever',async t=>{
 const {entry,db,pool}=await harness(t);
 const b01=await entry(shift1,'B01');
 const image=drawCard({seed:21,writing:'OLD'}),hash=createHash('sha256').update(image).digest('hex');
 const withImage=randomUUID(),withoutImage=randomUUID();
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,status) VALUES($1,$2,1,'old.png',$3,$4,'review')",[withImage,b01.id,image,hash]);
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,status,image_blob_key) VALUES($1,$2,2,'blob.png',NULL,'x','review','missing/blob')",[withoutImage,b01.id]);
 const done=await backfillScanFingerprints(pool,{imageStorage:{hydrate:async()=>{throw Error('blob missing')}},log:{log(){},error(){}}});
 assert.equal(done,1);
 const expected=await fingerprintScanImage(image);
 const rows=Object.fromEntries((await db.query('SELECT id,fingerprint FROM mis_scan_cards WHERE batch_id=$1',[b01.id])).rows.map(r=>[r.id,r.fingerprint]));
 assert.equal(rows[withImage].version,expected.version);assert.equal(rows[withImage].up,expected.up);
 assert.equal(rows[withoutImage].version,0);assert.match(rows[withoutImage].error,/blob missing/);
 assert.equal(await backfillScanFingerprints(pool,{log:{log(){},error(){}}}),0,'nothing left to do');
});
