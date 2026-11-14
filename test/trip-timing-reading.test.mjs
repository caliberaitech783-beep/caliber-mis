import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {transformWithOxc} from 'vite';
import {registerLogBooks,LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {encodeScanJson} from '../server/rules/scan-text-storage.mjs';
import {createReportLane} from '../server/services/report-lane.mjs';
process.env.VLB_TWO_STAGE_BATCHES='0';

// Trip Timing & Gap took 59 s on average on 14 Nov 2026 (longest 113 s): it read a month of cards plus every scanned card,
// and each person opening it read it again. It now leaves out the scanned cards it never shows, and goes through the
// report lane, so people asking for the same dates and sites at the same time share one reading.
async function server(t,lane){
 const db=new PGlite();t.after(()=>db.close());await db.exec(LOG_BOOK_SCHEMA);
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB); CREATE TABLE mis_scan_batches(id TEXT PRIMARY KEY,kind TEXT); CREATE TABLE mis_scan_cards(id TEXT,batch_id TEXT,filename TEXT,status TEXT,draft JSONB,error TEXT,logbook_id BIGINT,created_at TIMESTAMPTZ,ordinal INTEGER)');
 const data={bookDate:'2026-11-12',location:'Sasti',door:'V1',assetId:1,shiftId:3,employeeId:2,shiftHours:8,openingHmr:0,closingHmr:6,trips:[]};
 await db.query("INSERT INTO mis_log_books(book_no,book_type,book_date,site,asset_id,data,request_key,created_by) SELECT 'BOOK-'||n,'vehicle','2026-11-12','Sasti',1,$1,md5(n::text)::uuid,'fixture' FROM generate_series(1,3) AS n",[JSON.stringify(data)]);
 await db.exec("INSERT INTO mis_scan_batches VALUES('batch','vehicle')");
 await db.query("INSERT INTO mis_scan_cards VALUES('card','batch','scan.png','review',$1,NULL,NULL,'2026-11-12',1)",[JSON.stringify(encodeScanJson({bookDate:'2026-11-12',location:'Sasti'}))]);
 // Every statement the route sends, so a test can count the readings and see which tables they touch.
 const statements=[];let hold=null;
 const query=async(sql,args)=>{statements.push(sql);if(hold&&/FROM mis_log_books WHERE deleted_at IS NULL AND book_date/.test(sql))await hold;return !args&&sql.includes(';')?db.exec(sql):db.query(sql,args);};
 const app=express();
 registerLogBooks(app,{pool:{query},lane,
  requireSession:(req,res,next)=>{req.session={role:'super',permissions:{adminLevel:'Admin',separateMisCredentials:Boolean(req.headers['x-site'])},...(req.headers['x-site']?{site:req.headers['x-site']}:{})};next();},
  requireAdministrator:(req,res,next)=>next()});
 app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
 const listener=app.listen(0,'127.0.0.1');await new Promise(r=>listener.on('listening',r));t.after(()=>{listener.closeAllConnections();listener.close();});
 const url=`http://127.0.0.1:${listener.address().port}/api/reports/operations?from=2026-11-01&to=2026-11-14`;
 return {statements,url,
  holdReadings(){let release;hold=new Promise(r=>{release=r;});return ()=>{hold=null;release();};},
  get:async(extra='',headers={})=>{const response=await fetch(url+extra,{headers:{Authorization:'admin',...headers}});return {status:response.status,body:await response.json()};}};
}
const readings=statements=>statements.filter(sql=>/FROM mis_log_books WHERE deleted_at IS NULL AND book_date/.test(sql)).length;
const scanReads=statements=>statements.filter(sql=>/mis_scan_cards/.test(sql)).length;

test('Trip Timing and Loading Equipment-wise read the log books without the scanned cards',async t=>{
 const app=await server(t,createReportLane({cacheMs:0}));
 const full=await app.get();
 assert.equal(full.status,200,JSON.stringify(full.body));
 assert.equal(full.body.records.length,3);assert.equal(full.body.cards.length,1);assert.equal(full.body.scanConnected,true);
 assert.ok(scanReads(app.statements)>0,'the Scans report and the other reports still read the scanned cards');
 app.statements.length=0;
 const logbooks=await app.get('&parts=logbooks');
 assert.equal(logbooks.status,200,JSON.stringify(logbooks.body));
 assert.equal(logbooks.body.records.length,3,'the same log books');
 assert.deepEqual(logbooks.body.cards,[]);
 assert.equal(logbooks.body.scanConnected,null,'not read, which is not the same as not connected');
 assert.deepEqual([logbooks.body.batches,logbooks.body.fleet],[full.body.batches,full.body.fleet],'Loading Equipment-wise keeps its batches and machines');
 assert.equal(scanReads(app.statements),0,'no statement touches the scanned cards');
 app.statements.length=0;
 const unknown=await app.get('&parts=everything');
 assert.equal(unknown.body.cards.length,1,'any other value reads everything, as before');
});

test('people asking for the same dates and sites at the same time share one reading; other site access reads its own',async t=>{
 const app=await server(t,createReportLane({cacheMs:0}));
 const release=app.holdReadings();
 const asked=[app.get('&parts=logbooks'),app.get('&parts=logbooks'),app.get('&parts=logbooks')];
 const otherSite=app.get('&parts=logbooks',{'x-site':'Other'});
 await new Promise(r=>setTimeout(r,150));
 release();
 const [first,second,third]=await Promise.all(asked),elsewhere=await otherSite;
 for(const answer of [first,second,third])assert.equal(answer.status,200,JSON.stringify(answer.body));
 assert.deepEqual(second.body,first.body);assert.deepEqual(third.body,first.body);
 assert.equal(readings(app.statements),2,'one reading for the three people with all sites, one for the site login');
 assert.equal(elsewhere.body.records.length,0,'a site login never receives the reading of another site access');
});

test('the shared reading is kept for the lane\'s short window only',async t=>{
 let clock=1_000_000;
 const app=await server(t,createReportLane({cacheMs:15000,now:()=>clock}));
 await app.get('&parts=logbooks');await app.get('&parts=logbooks');
 assert.equal(readings(app.statements),1,'within 15 s the finished reading is reused');
 clock+=15001;await app.get('&parts=logbooks');
 assert.equal(readings(app.statements),2,'after 15 s it is read again');
 await app.get();
 assert.equal(readings(app.statements),3,'the full reading with scanned cards is a reading of its own');
});

test('the screens ask for the log books only for Trip Timing and Loading Equipment-wise, and reuse a full reading',async()=>{
 const source=fs.readFileSync(new URL('../src/operations-reports.jsx',import.meta.url),'utf8');
 assert.match(source,/const OPERATIONS_LOGBOOKS_ONLY=new Set\(\['timing','loading'\]\);/);
 assert.match(source,/const parts=OPERATIONS_LOGBOOKS_ONLY\.has\(id\)\?'logbooks':'';/);
 assert.match(source,/operationsData\(filters\.from,filters\.to,session\.token,reload>0,parts\)/);
 assert.match(source,/\},\[filters\.from,filters\.to,session\.token,reload,valid,parts\]\);/,'moving from Trip Timing to the Scans report reads the scanned cards');
 assert.match(source,/id==='scans'&&data\.scanConnected===false&&/,'a reading without scanned cards does not say the scan source is down');
 const {code}=await transformWithOxc(source.replace(/^import .*;\r?\n/gm,'').replaceAll('export default function','function'),'operations-reports.jsx',{jsx:{runtime:'classic'}});
 const urls=[];
 const fetch=url=>{urls.push(String(url));return Promise.resolve({ok:true,json:async()=>({records:[],url:String(url)})});};
 const operationsData=new Function('fetch',code+';return operationsData')(fetch);
 const timing=operationsData('2026-11-01','2026-11-14','token',false,'logbooks'),loading=operationsData('2026-11-01','2026-11-14','token',false,'logbooks');
 assert.deepEqual(urls,['/api/reports/operations?from=2026-11-01&to=2026-11-14&parts=logbooks'],'the dashboard\'s two reports still share one reading');
 assert.equal(timing.promise,loading.promise);
 const daily=operationsData('2026-11-01','2026-11-14','token',false);
 assert.equal(urls.at(-1),'/api/reports/operations?from=2026-11-01&to=2026-11-14','other reports read everything');
 assert.equal(urls.length,2,'a reading without scanned cards cannot serve them');
 await daily.promise;
 const other=operationsData('2026-11-02','2026-11-14','token',false);await other.promise;
 const reuse=operationsData('2026-11-02','2026-11-14','token',false,'logbooks');
 assert.equal(urls.length,3,'a full reading already held for the same dates serves Trip Timing too');
 assert.equal(reuse.promise,other.promise);
 const refreshed=operationsData('2026-11-02','2026-11-14','token',true,'logbooks');
 assert.equal(urls.at(-1),'/api/reports/operations?from=2026-11-02&to=2026-11-14&parts=logbooks','Refresh reads again, without the scanned cards');
 for(const reading of [timing,loading,daily,other,reuse,refreshed])reading.release();
});
