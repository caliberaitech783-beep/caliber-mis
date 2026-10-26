import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../bulk-card-scanning.mjs';

test('scanner upload accepts multi-megabyte scans and rejects malformed base64 without crashing',async t=>{
 const batchId=randomUUID(),stored=[];
 const query=async(sql,args)=>{
  if(sql.startsWith('SELECT * FROM mis_scan_batches'))return {rows:[{id:batchId,kind:'vehicle'}]};
  if(sql.includes('count(*) AS n'))return {rows:[{n:stored.length}]};
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
});
