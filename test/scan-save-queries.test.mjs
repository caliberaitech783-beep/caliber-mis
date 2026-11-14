import {prepareVlbFixture} from './operational-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../server/routes/bulk-card-scanning.mjs';import {LOG_BOOK_SCHEMA,registerLogBooks} from '../server/routes/log-book.mjs';

// Saving one card's corrections used to read the whole Equipment master twice from the database
// (once for the machine notation check, once for the log book data check) and the card row twice
// with its scan image. Each save now takes the equipment lists from the copy kept in memory per
// master-data revision, read before its transaction starts, and never selects the image column.
const masters=[{id:1,master_name:'Equipment master',record_data:{category:'Vehicle',door:'V321',currentLocation:'Sasti OC'}},{id:2,master_name:'C-Dir Employee master',record_data:{name:'TEST DRIVER',empId:'EMP100',site:'Sasti OC'}},{id:3,master_name:'Shift Master',record_data:{site:'Sasti OC',shiftName:'Shift A',shiftCode:'I',startTime:'06:00',endTime:'14:00'}},{id:4,master_name:'Equipment master',record_data:{category:'Equipment',door:'L01',equipmentName:'L01',currentLocation:'Sasti OC'}}];
for(let i=2;i<=60;i++)masters.push({id:100+i,master_name:'Equipment master',record_data:{category:'Vehicle',door:'V'+(321+i),currentLocation:'Sasti OC'}});

test('saving one card reads the equipment lists from the shared master copy and never the scan image',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE data_revisions(revision_key TEXT PRIMARY KEY,revision BIGINT NOT NULL DEFAULT 1);INSERT INTO data_revisions(revision_key) VALUES(\'master-data\');'+LOG_BOOK_SCHEMA);
 for(const m of masters)await db.query('INSERT INTO master_records VALUES($1,$2,$3)',[m.id,m.master_name,JSON.stringify(m.record_data)]);
 const log=[];let tail=Promise.resolve();
 const query=(q,a)=>{log.push({sql:q,args:a});return q.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!a&&q.includes(';')?db.exec(q):db.query(q,a);};
 const pool={query,connect:async()=>{const previous=tail;let done;tail=new Promise(r=>done=r);await previous;return {query,release(){done()}}}};
 const app=express();app.use(express.json({limit:'20mb'}));
 const requireSession=(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.session={login:'test-admin'};next()};const requireAdministrator=(req,res,next)=>next();
 registerLogBooks(app,{pool,requireSession,requireAdministrator,getSiteScope:async()=>({sites:null})});
 const service=registerBulkCardScanning(app,{pool,requireSession,requireAdministrator,ocr:{recognize:async()=>({text:'',confidence:0}),close(){}},localDrafts:true,readHours:async()=>({breakdownHours:1,availabilityHours:6,idleHours:2})});
 await service.start();t.after(()=>service.stop());app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close()});const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{Authorization:'admin','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const context={bookDate:'2026-12-19',location:'Sasti OC',cardShift:'I'};await prepareVlbFixture(db,context);
 const batch=(await call('/api/scan-batches','POST',{kind:'vehicle',name:'one card',expectedContext:context})).data.id;
 const image=Buffer.alloc(200000,7),id=randomUUID();
 const draft={bookDate:'2026-12-19',location:'Sasti OC',doorText:'V321',assetId:'1',employeeId:'2',shiftId:'3',cardShift:'I',shiftHours:'8',openingKmr:'1000',closingKmr:'1040',openingHmr:'200',closingHmr:'206',aFormNo:'CARD-1',machineNotationRuleVersion:1,trips:[{tripNo:1,equipmentName:'L01',loadingTime:'08:20',unloadingTime:'08:40',tripCount:2}],scanMachineSummary:[{equipmentName:'L01',tripCount:2}]};
 await db.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,status,draft,raw_fields) VALUES($1,$2,1,'card.png',$3,$4,'review',$5,$6)",[id,batch,image,id,JSON.stringify(draft),JSON.stringify({extractionDraft:draft,machineNotation:{version:1}})]);
 const card=(await call('/api/scan-batches/'+batch)).data.cards[0];assert.equal(card.status,'review');
 const equipmentReads=entries=>entries.filter(({sql,args})=>/master_records/i.test(sql)&&/Equipment master/.test(sql+JSON.stringify(args||[])));
 const cardReads=entries=>entries.filter(({sql})=>/SELECT[^;]*FROM mis_scan_cards/i.test(sql)&&/SELECT\s+\*|\bimage\b/i.test(sql));

 log.length=0;
 const first=await call('/api/scan-cards/'+id,'PUT',{draft:{...card.draft,remark:'first'},revision:card.revision,action:'save'});
 assert.equal(first.status,200,JSON.stringify(first.data));assert.deepEqual(first.data.checks.errors,[]);
 const firstSave=log.splice(0);
 assert.equal(equipmentReads(firstSave).length,1,'the first save loads the Equipment master once into the shared copy');
 assert.deepEqual(cardReads(firstSave).map(e=>e.sql),[],'no card read selects the scan image');

 const second=await call('/api/scan-cards/'+id,'PUT',{draft:{...card.draft,remark:'second'},revision:first.data.revision,action:'save'});
 assert.equal(second.status,200,JSON.stringify(second.data));
 const secondSave=log.splice(0);
 assert.equal(equipmentReads(secondSave).length,0,'a later save reuses the shared copy of the Equipment master');
 assert.deepEqual(cardReads(secondSave).map(e=>e.sql),[]);
 assert.ok(secondSave.length<=40,'a card save ran '+secondSave.length+' queries');
 assert.equal((await db.query('SELECT draft->>\'remark\' AS remark,revision FROM mis_scan_cards WHERE id=$1',[id])).rows[0].remark,'second');
});
