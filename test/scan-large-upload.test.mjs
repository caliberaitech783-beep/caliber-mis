import {createCanvas} from '@napi-rs/canvas';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';

test('scanner upload accepts multi-megabyte scans and rejects malformed base64 without crashing',async t=>{
 const batchId=randomUUID(),stored=[];
 const query=async(sql,args)=>{
  if(sql.startsWith('SELECT * FROM mis_scan_batches'))return {rows:[{id:batchId,kind:'vehicle',expected_context:{bookDate:'2026-10-30',location:'Sasti OC',cardShift:'I'}}]};
  if(sql.startsWith('SELECT id FROM mis_scan_cards WHERE id=$1 AND batch_id=$2'))return {rows:stored.filter(row=>row[0]===args[0]).map(row=>({id:row[0]}))};
  if((sql.includes('count(*) AS n')||sql.includes('MAX(ordinal)')))return {rows:[{n:stored.length}]};
  if(sql.startsWith('INSERT INTO mis_scan_cards'))stored.push(args);
  return {rows:[]};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json({limit:'20mb'}));
 const authorize=(req,res,next)=>{req.session={login:'test-admin'};next()};
 const service=registerBulkCardScanning(app,{pool,requireSession:authorize,requireAdministrator:authorize,ocr:{recognize(){throw Error('Not used')},close(){}}});
 t.after(()=>service.stop());
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close()});
 const upload=async base64=>fetch('http://127.0.0.1:'+server.address().port+'/api/scan-batches/'+batchId+'/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadKey:randomUUID(),filename:'scanner-page.png',base64})});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBEkAAAAASUVORK5CYII=','base64');
 // Large retained scans used to overflow the repeated-group regexp before insertion.
 for(const size of [4_541_825,12_000_000]){
  const image=Buffer.concat([png,Buffer.alloc(size-png.length,42)]);
  const response=await upload(image.toString('base64'));
  assert.equal(response.status,201,await response.text());
  assert.deepEqual(stored.at(-1)[4],image);
 }
 for(const invalid of ['A','AAA','AA=A','AAAA=','AA==AAAA','AAAA\n','!!!!']){
  const response=await upload(invalid);assert.equal(response.status,400,await response.text());
 }
 assert.equal(stored.length,2);
 const image=Buffer.concat([png,Buffer.alloc(4_000_000,42)]);
 const metadata={uploadKey:randomUUID(),filename:'कार्ड.png',captureTiming:{mode:'scanner',pages:19,durationMs:1000}};
 const binary=await fetch('http://127.0.0.1:'+server.address().port+'/api/scan-batches/'+batchId+'/cards',{method:'POST',headers:{'Content-Type':'image/png','X-Scan-Metadata':encodeURIComponent(JSON.stringify(metadata))},body:image});
 assert.equal(binary.status,201,await binary.text());assert.deepEqual(stored.at(-1)[4],image);assert.equal(stored.at(-1)[3],metadata.filename);assert.deepEqual(JSON.parse(stored.at(-1)[8]).captureTiming,metadata.captureTiming);
 for(const header of ['%',encodeURIComponent('null'),encodeURIComponent('[]')]){
  const invalid=await fetch('http://127.0.0.1:'+server.address().port+'/api/scan-batches/'+batchId+'/cards',{method:'POST',headers:{'Content-Type':'image/png','X-Scan-Metadata':header},body:png});assert.equal(invalid.status,400,await invalid.text());
 }
 const canvas=createCanvas(300,400);canvas.getContext('2d').fillRect(0,0,300,400);const jpeg=canvas.toBuffer('image/jpeg');
 const jpegMetadata={uploadKey:randomUUID(),filename:'compressed-card.jpg'};
 const jpgResponse=await fetch('http://127.0.0.1:'+server.address().port+'/api/scan-batches/'+batchId+'/cards',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Scan-Metadata':encodeURIComponent(JSON.stringify(jpegMetadata))},body:jpeg});
 assert.equal(jpgResponse.status,201,await jpgResponse.text());assert.deepEqual(stored.at(-1)[4],jpeg);
 const malformed=await fetch('http://127.0.0.1:'+server.address().port+'/api/scan-batches/'+batchId+'/cards',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Scan-Metadata':encodeURIComponent(JSON.stringify({...jpegMetadata,uploadKey:randomUUID()}))},body:Buffer.from([255,216,255,217])});assert.equal(malformed.status,400,await malformed.text());
 assert.equal(stored.length,4);
 for(let i=4;i<40;i++){const response=await upload(png.toString('base64'));assert.equal(response.status,201,await response.text());}
 const full=await upload(png.toString('base64'));assert.equal(full.status,409);assert.match((await full.json()).error,/40 cards/);assert.equal(stored.length,40);
 const retry=await fetch('http://127.0.0.1:'+server.address().port+'/api/scan-batches/'+batchId+'/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadKey:stored[0][0],base64:png.toString('base64')})});
 assert.equal(retry.status,200,'Retrying an existing card is safe even at the 40-card ceiling');assert.equal(stored.length,40);

});
