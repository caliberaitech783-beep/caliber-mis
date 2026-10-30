import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import {createScanBatch,tripBatchPrefix,SCAN_BATCH_NAMING_SCHEMA} from '../scan-batch-naming.mjs';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';

const context={bookDate:'2026-10-29',location:'JAYANT',cardShift:'I'};
const prefix='CMLL/2026-10-29/JAYANT/S1/NITINKUMAR';
const batchSchema=`CREATE TABLE mis_scan_batches(id UUID PRIMARY KEY,kind TEXT,name TEXT,created_by TEXT,expected_context JSONB);`;

test('names use the selected card date, site, shift and signed-in username',()=>{
 assert.equal(tripBatchPrefix(context,' Nitin Kumar '),prefix);
 assert.equal(tripBatchPrefix({...context,cardShift:'II'},'nitinkumar'),prefix.replace('/S1/','/S2/'));
 assert.equal(tripBatchPrefix({...context,cardShift:'III'},'nitinkumar'),prefix.replace('/S1/','/S3/'));
 assert.throws(()=>tripBatchPrefix({...context,bookDate:'2026-02-30'},'nitinkumar'));
 assert.throws(()=>tripBatchPrefix(context,'  '));
 assert.equal(tripBatchPrefix({...context,location:'East/West'},'a\\b'), 'CMLL/2026-10-29/EAST-WEST/S1/A-B');
});

test('persistent counters allocate new batches and retain existing names',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(batchSchema+SCAN_BATCH_NAMING_SCHEMA);
 const create=(options={})=>createScanBatch(db,{id:randomUUID(),kind:'vehicle',user:'nitinkumar',expectedContext:context,...options});
 const first=await create({name:'uploaded.pdf'}),second=await create();
 assert.equal(first.name,prefix+'/B01');assert.equal(second.name,prefix+'/B02');
 // Reinitializing the additive schema must not reset the sequence.
 await db.exec(SCAN_BATCH_NAMING_SCHEMA);
 assert.equal((await create()).name,prefix+'/B03');
 const parallel=await Promise.all(Array.from({length:8},()=>create()));
 assert.deepEqual(parallel.map(row=>row.name).sort(),Array.from({length:8},(_,i)=>prefix+'/B'+String(i+4).padStart(2,'0')).sort());
 // A failed creation is atomic and does not consume a counter value.
 await assert.rejects(()=>create({id:first.id}));
 assert.equal((await create()).name,prefix+'/B12');
 assert.equal((await db.query('SELECT name FROM mis_scan_batches WHERE id=$1',[first.id])).rows[0].name,first.name);
 for(const options of [{user:'other'}, {expectedContext:{...context,bookDate:'2026-10-30'}}, {expectedContext:{...context,cardShift:'II'}}, {expectedContext:{...context,location:'OTHER'}}])assert.ok((await create(options)).name.endsWith('/B01'));
 const equipment=await create({kind:'equipment',name:'Original job-card name',expectedContext:undefined});
 assert.equal(equipment.name,'Original job-card name');
});

test('existing batch names are preserved and matching numbers are skipped, including B100',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(batchSchema+SCAN_BATCH_NAMING_SCHEMA);
 const existing=[prefix+'/B99',prefix+'/B-not-a-number','Earlier trip cards'];
 for(const name of existing)await db.query("INSERT INTO mis_scan_batches(id,kind,name,created_by) VALUES($1,'vehicle',$2,'legacy')",[randomUUID(),name]);
 const next=await createScanBatch(db,{id:randomUUID(),kind:'vehicle',user:'nitinkumar',expectedContext:context});
 assert.equal(next.name,prefix+'/B100');
 assert.deepEqual((await db.query("SELECT name FROM mis_scan_batches WHERE created_by='legacy' ORDER BY name")).rows.map(row=>row.name),existing.sort());
});

test('upload API returns and lists the generated name rather than the source filename',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE mis_log_books(id BIGSERIAL PRIMARY KEY,book_type TEXT,book_date DATE,asset_id BIGINT,data JSONB,deleted_at TIMESTAMPTZ);');
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query};
 const app=express();app.use(express.json());
 const requireSession=(req,res,next)=>{req.session={login:'nitinkumar'};req.logBookScope={sites:null};req.allowedSiteBatches=null;next()};
 const service=registerBulkCardScanning(app,{pool,requireSession,requireAdministrator:(req,res,next)=>next(),localDrafts:true,ocr:{close(){}}});
 await service.start();t.after(()=>service.stop());
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close()});
 const root='http://127.0.0.1:'+server.address().port;
 for(let number=1;number<=2;number++){
  const response=await fetch(root+'/api/scan-batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'vehicle',name:'paper.pdf',expectedContext:context})});
  const result=await response.json();assert.equal(response.status,201,JSON.stringify(result));assert.equal(result.name,prefix+'/B0'+number);
 }
 const list=await fetch(root+'/api/scan-batches').then(response=>response.json());
 assert.deepEqual(list.batches.map(row=>row.name).sort(),[prefix+'/B01',prefix+'/B02']);
});
