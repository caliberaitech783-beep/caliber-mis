import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import pg from 'pg';
import {LOG_BOOK_SCHEMA} from '../log-book.mjs';
import {SCAN_SCHEMA} from '../bulk-card-scanning.mjs';
import {SCAN_BACKUP_SCHEMA,registerScanBackup} from '../scan-backup.mjs';

const connectionString=process.env.DELETION_TEST_DATABASE_URL;
test('a concurrent backup cannot recreate a recovery snapshot during permanent cleanup',{skip:!connectionString},async t=>{
 const target=new URL(connectionString);assert.ok(['127.0.0.1','localhost'].includes(target.hostname)&&target.pathname==='/caliber_mis','Use only the isolated local test database.');
 const schema='deletion_concurrency_'+randomUUID().replaceAll('-',''),bootstrap=new pg.Client({connectionString});await bootstrap.connect();await bootstrap.query('CREATE SCHEMA '+schema);await bootstrap.end();
 const pool=new pg.Pool({connectionString,max:6,options:'-c search_path='+schema});await pool.query(LOG_BOOK_SCHEMA+SCAN_SCHEMA+SCAN_BACKUP_SCHEMA);
 const batch=randomUUID(),card=randomUUID();await pool.query("INSERT INTO mis_scan_batches(id,kind,name,created_by) VALUES($1,'vehicle','fixture','fixture')",[batch]);
 await pool.query("INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,image_blob_key,image_bytes,blob_uploaded_at) VALUES($1,$2,1,'fixture.png',NULL,'hash',$3,4,NOW())",[card,batch,'vehicle/'+batch+'/'+card+'.png']);
 const app=express();app.use(express.json());const auth=(req,res,next)=>{req.session={login:'fixture'};next();};registerScanBackup(app,{pool,requireSession:auth,requireAdministrator:auth,imageStorage:{},getSiteScope:async()=>({sites:null})});app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
 const cleanup=await pool.connect();let released=false;t.after(async()=>{if(!released){await cleanup.query('ROLLBACK');cleanup.release();}await pool.end();});await cleanup.query('BEGIN');await cleanup.query('SELECT pg_advisory_xact_lock(709224102)');await cleanup.query('DELETE FROM mis_scan_cards WHERE id=$1',[card]);
 let finished=false;const backup=fetch('http://127.0.0.1:'+server.address().port+'/api/scan-backups',{method:'POST'}).then(async r=>{finished=true;return {status:r.status,data:await r.json()};});
 let waiting=false;for(let attempt=0;attempt<100;attempt++){
  waiting=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ShareLock' AND NOT granted AND classid=0 AND objid=709224102) AS waiting")).rows[0].waiting;
  if(waiting)break;await new Promise(r=>setTimeout(r,20));
 }
 assert.equal(waiting,true,'the actual backup route waits for the deletion transaction');assert.equal(finished,false);assert.equal((await pool.query('SELECT count(*)::int AS n FROM mis_scan_backups')).rows[0].n,0);
 await cleanup.query('COMMIT');cleanup.release();released=true;const result=await backup;assert.equal(result.status,200,JSON.stringify(result.data));assert.equal((await pool.query('SELECT count(*)::int AS n FROM mis_scan_backup_items')).rows[0].n,0,'the deleted source cannot be copied into a new backup');
});
