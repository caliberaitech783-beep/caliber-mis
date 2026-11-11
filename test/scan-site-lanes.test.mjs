import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
import {registerBulkCardScanning} from '../server/routes/bulk-card-scanning.mjs';import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {createGeminiCardReader} from '../server/services/gemini-card-reader.mjs';
import {engineChildren} from '../server/scan-engine.mjs';
import os from 'node:os';import path from 'node:path';import fs from 'node:fs/promises';

async function scanServer(t,options){
 const db=new PGlite();let scans;
 // Stop the readers (letting any card in hand finish) before closing the database.
 t.after(async()=>{await scans?.stop({drainMs:3000});await db.close();});
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const auth=(req,res,next)=>{req.session={role:'super',login:'admin',permissions:{adminLevel:'Admin'}};next()};
 scans=registerBulkCardScanning(express(),{pool,requireSession:auth,requireAdministrator:auth,getSiteScope:async()=>({sites:null}),ocr:{close(){}},fingerprintBackfill:false,...options});
 await scans.start();
 const addCard=async(site)=>{const batch=randomUUID(),card=randomUUID();
  await db.query(`INSERT INTO mis_scan_batches(id,kind,name,created_by,expected_context) VALUES($1,'vehicle',$2,'admin',$3)`,[batch,site+' batch',JSON.stringify({bookDate:'2026-12-19',location:site,cardShift:'I'})]);
  await db.query(`INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,status) VALUES($1,$2,1,'card.jpg',$3,$4,'queued')`,[card,batch,Buffer.from('card '+site),'h-'+card]);
  return card;};
 return {db,scans,addCard};
}
const until=async(check,ms=5000)=>{const end=Date.now()+ms;while(!(await check())){if(Date.now()>end)throw Error('timed out');await new Promise(r=>setTimeout(r,20));}};

test('one site waiting on Gemini does not hold up another site',async t=>{
 const started=[];let releaseSasti;const sastiGate=new Promise(r=>releaseSasti=r);
 const ocrForLane=lane=>({async recognize(){started.push(lane);if(lane==='sasti ob')await sastiGate;throw Object.assign(Error('test reader'),{provider:'gemini'});},close(){}});
 const {db,scans,addCard}=await scanServer(t,{scanLanes:true,lanePerSite:1,ocrForLane});
 const sasti=[await addCard('Sasti OC'),await addCard('Sasti OC')];const majri=await addCard('Majri OC');
 void scans.pump();
 await until(()=>started.includes('majri ob'));
 await until(async()=>(await db.query('SELECT status FROM mis_scan_cards WHERE id=$1',[majri])).rows[0].status==='error');
 assert.deepEqual((await db.query('SELECT status FROM mis_scan_cards WHERE id=ANY($1::uuid[]) ORDER BY status',[sasti])).rows.map(r=>r.status),['queued','reading'],'Sasti is still waiting on Gemini while Majri is already done');
 assert.deepEqual(scans.status().lanes.map(l=>l.site).sort(),['majri ob','sasti ob']);
 releaseSasti();
});

test('Pulse-II leaves a site to its live engine and reads the others itself',async t=>{
 const started=[];
 const ocrForLane=lane=>({async recognize(){started.push(lane);throw Object.assign(Error('test reader'),{provider:'gemini'});},close(){}});
 const {db,scans,addCard}=await scanServer(t,{enginesExternal:true,scanLanes:true,lanePerSite:1,ocrForLane});
 await db.query(`INSERT INTO mis_scan_engines(owner,site_lane) VALUES('sasti-engine','sasti ob')`);
 const sasti=await addCard('Sasti OC');const majri=await addCard('Majri OC');
 await scans.pump();
 await until(async()=>(await db.query('SELECT status FROM mis_scan_cards WHERE id=$1',[majri])).rows[0].status==='error');
 assert.equal((await db.query('SELECT status FROM mis_scan_cards WHERE id=$1',[sasti])).rows[0].status,'queued','Sasti waits for its own engine');
 assert.ok(started.length&&started.every(lane=>lane==='majri ob'));
});

test('a clean stop lets the card being read finish and hands nothing back twice',async t=>{
 let finish;const reading=new Promise(r=>finish=r);let calls=0;
 const ocrForLane=()=>({async recognize(){calls++;await reading;throw Object.assign(Error('test reader'),{provider:'gemini'});},close(){}});
 const {db,scans,addCard}=await scanServer(t,{scanLanes:true,lanePerSite:1,ocrForLane});
 const card=await addCard('Jayant OC');void scans.pump();
 await until(()=>calls===1);
 const stopping=scans.stop({drainMs:5000,releaseLeases:true});
 setTimeout(finish,100);await stopping;
 assert.equal((await db.query('SELECT status FROM mis_scan_cards WHERE id=$1',[card])).rows[0].status,'error','the card finished during the drain instead of going back for a second read');
 assert.equal((await db.query('SELECT read_lease_owner FROM mis_scan_cards WHERE id=$1',[card])).rows[0].read_lease_owner!==undefined,true);
});

test('readers on the same shared key share one start gate; a site key has its own',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gate-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let time=100000;
 const waits=[];const sleep=async ms=>{waits.push(ms);time+=ms;};
 const fetchImpl=async()=>({ok:false,status:400,headers:{get:()=>null},body:{cancel(){}}});
 const reader=key=>createGeminiCardReader({cacheDir:dir,getKey:async()=>key,prepareViews:async()=>[],minIntervalMs:60000,now:()=>time,sleep,fetchImpl,shareGateByKey:true});
 const a=reader('shared-key'),b=reader('shared-key'),c=reader('site-key');
 await a.recognize(Buffer.from('a')).catch(()=>{});await b.recognize(Buffer.from('b')).catch(()=>{});await c.recognize(Buffer.from('c')).catch(()=>{});
 assert.ok(waits.filter(ms=>ms>0).length===1,'only the second reader on the shared key waited for the gate: '+waits);
});

test('the engine app runs one engine per listed site plus one for every other site',()=>{
 const children=engineChildren({MIS_SCAN_ENGINE_SITES:'Sasti OC; Majri OC;Sasti'});
 assert.deepEqual(children,[{lane:'sasti ob',excluded:[]},{lane:'majri ob',excluded:[]},{lane:'*',excluded:['sasti ob','majri ob']}]);
});
