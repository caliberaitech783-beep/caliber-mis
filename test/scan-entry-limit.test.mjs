import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import express from 'express';
import PDFDocument from 'pdfkit';
import {PGlite} from '@electric-sql/pglite';
import {MAX_SCAN_ENTRY_CARDS,scanEntryRemaining,requireScanEntrySpace} from '../public/scan-entry-limit.mjs';
import {registerLocalDocumentScanning} from '../local-document-scanning.mjs';
import {SCAN_SCHEMA} from '../bulk-card-scanning.mjs';
import {LOG_BOOK_SCHEMA} from '../log-book.mjs';

test('entry limit allows partial entries and rejects a 41st card',()=>{
 assert.equal(MAX_SCAN_ENTRY_CARDS,40);
 assert.equal(scanEntryRemaining(10),30);
 assert.doesNotThrow(()=>requireScanEntrySpace(39));
 assert.throws(()=>requireScanEntrySpace(40),{status:409});
 assert.throws(()=>requireScanEntrySpace(130),{status:409});
});

test('local PDFs retain all pages across 40-card entries and folder retries do not duplicate them',async t=>{
 // Keep generated fixtures for inspection; no files are deleted by this test.
 const root=path.resolve('.local','scan-entry-limit-'+randomUUID()),inbox=path.join(root,'inbox');
 await fs.mkdir(inbox,{recursive:true});
 const pdf=new PDFDocument({autoFirstPage:false}),parts=[];
 const finished=new Promise(resolve=>{pdf.on('data',p=>parts.push(p));pdf.on('end',resolve)});
 for(let i=0;i<81;i++)pdf.addPage({size:[30,40],margin:0}).fontSize(6).text(String(i+1),2,2);
 pdf.end();await finished;const original=Buffer.concat(parts),source=path.join(inbox,'81-cards.pdf');await fs.writeFile(source,original);
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA+SCAN_SCHEMA);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})},app=express();app.use(express.json({limit:'20mb'}));
 const auth=(req,res,next)=>{req.session={login:'test-admin'};next()};
 const service=registerLocalDocumentScanning(app,{pool,requireSession:auth,requireAdministrator:auth,inbox,outputRoot:path.join(root,'jobs'),enabled:true,bulkScanning:{pump(){}}});
 await service.start();app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close()});
 const call=async(route,body)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/local-scanner/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify({kind:'vehicle',expectedContext:{bookDate:'2026-10-31',location:'Sasti OC',cardShift:'I'},...body})}:{})});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;};
 const wait=async id=>{for(let i=0;i<1000;i++){const job=await call('jobs/'+id);if(job.status!=='running'){assert.equal(job.status,'complete',job.error);return job;}await new Promise(resolve=>setTimeout(resolve,20));}throw Error('PDF import timed out');};
 const first=await wait((await call('folder',{})).id);
 assert.equal(first.pages,81);assert.equal(first.entry_batch_ids.length,3);
 const counts=async ids=>Promise.all(ids.map(async id=>Number((await db.query('SELECT count(*) n FROM mis_scan_cards WHERE batch_id=$1',[id])).rows[0].n)));
 assert.deepEqual(await counts(first.entry_batch_ids),[40,40,1]);assert.equal(first.batch_id,first.entry_batch_ids[2]);
 const retry=await wait((await call('folder',{})).id);assert.equal(retry.pages,0);
 assert.equal(Number((await db.query('SELECT count(*) n FROM mis_scan_cards')).rows[0].n),81);
 const uploaded=await wait((await call('files',{files:[{filename:'81-cards.pdf',base64:original.toString('base64')}]})).id);
 assert.equal(uploaded.pages,81);assert.deepEqual(await counts(uploaded.entry_batch_ids),[40,40,1]);
 assert.deepEqual(await fs.readFile(source),original);
 assert.equal(Number((await db.query('SELECT count(*) n FROM mis_log_books')).rows[0].n),0,'Import keeps review drafts until existing validation completes');
 const script=await fs.readFile(new URL('../scripts/windows-document-scanner.ps1',import.meta.url),'utf8');
 assert.match(script,/\$limit=\$\(if\(\$hasFeeder\)\{40\}else\{1\}\)/);
});
