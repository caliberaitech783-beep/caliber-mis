import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
import os from 'node:os';import path from 'node:path';import fs from 'node:fs/promises';
import {registerBulkCardScanning} from '../server/routes/bulk-card-scanning.mjs';import {LOG_BOOK_SCHEMA} from '../server/routes/log-book.mjs';
import {createGeminiCardReader,geminiHttpError} from '../server/services/gemini-card-reader.mjs';
import {readerOutage,readerOutageFor,noteReaderOutage,claimOutageAlerts,liveReaderOutages,OUTAGE_STALE_SECONDS} from '../server/rules/scan-reader-outage.mjs';
import {readerOutageMessage,readerOutageAlert,scanErrorReasons} from '../shared/scan-reader-outage-text.mjs';
import {CARD_GROUPS} from '../shared/scan-card-groups.mjs';

const billing=()=>Object.assign(Error(geminiHttpError(402)),{provider:'gemini',status:402,upstream:'Your prepayment credits are depleted.'});
const cardText=`Book date: 19-12-2026\nLocation: Sasti OC\nDoor No: V321\nEmployee ID: EMP100\nShift: Shift A\nSHIFT [x] I\nShift hours: 8\nOpening KMR: 1000\nClosing KMR: 1040\nOpening HMR: 200\nClosing HMR: 206\nTrip Card No: CARD-1\nL01 08:20 08:40 2\nMACHINE-WISE SUMMARY\n1 LPC01 2`;

async function scanServer(t,options){
 const db=new PGlite();let scans;
 t.after(async()=>{await scans?.stop({drainMs:3000});await db.close();});
 await db.exec('CREATE TABLE master_records(id BIGINT PRIMARY KEY,master_name TEXT,record_data JSONB);'+LOG_BOOK_SCHEMA);
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):!args&&sql.includes(';')?db.exec(sql):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const auth=(req,res,next)=>{req.session={role:'super',login:'admin',permissions:{adminLevel:'Admin'}};next()};
 scans=registerBulkCardScanning(express(),{pool,requireSession:auth,requireAdministrator:auth,getSiteScope:async()=>({sites:null}),ocr:{close(){}},fingerprintBackfill:false,...options});
 await scans.start();
 const addCard=async(site,extra={})=>{const batch=randomUUID(),card=randomUUID();
  await db.query(`INSERT INTO mis_scan_batches(id,kind,name,created_by,expected_context) VALUES($1,'vehicle',$2,'admin',$3)`,[batch,site+' batch',JSON.stringify({bookDate:'2026-12-19',location:site,cardShift:'I'})]);
  await db.query(`INSERT INTO mis_scan_cards(id,batch_id,ordinal,filename,image,image_hash,status,error) VALUES($1,$2,1,'card.jpg',$3,$4,$5,$6)`,[card,batch,Buffer.from('card '+card),'h-'+card,extra.status||'queued',extra.error||'']);
  return card;};
 const statuses=async ids=>(await db.query('SELECT id,status,error FROM mis_scan_cards WHERE id=ANY($1::uuid[])',[ids])).rows;
 return {db,pool,scans,addCard,statuses};
}
const until=async(check,ms=8000)=>{const end=Date.now()+ms;while(!(await check())){if(Date.now()>end)throw Error('timed out');await new Promise(r=>setTimeout(r,25));}};

test('only a failure of the reading account is an outage',()=>{
 assert.deepEqual(readerOutage(billing()),{reason:'billing',status:402,detail:'Your prepayment credits are depleted.'});
 assert.equal(readerOutage(Object.assign(Error(geminiHttpError(429)),{provider:'gemini',status:429})).reason,'quota');
 for(const status of [401,403])assert.equal(readerOutage(Object.assign(Error(geminiHttpError(status)),{provider:'gemini',status})).reason,'key');
 assert.equal(readerOutage(Object.assign(Error(geminiHttpError(400)),{provider:'gemini',status:400,upstream:'API key not valid. Please pass a valid API key.'})).reason,'key');
 // A message alone (an older reader, or a wrapped error) still identifies the account failure.
 assert.equal(readerOutage(Object.assign(Error(geminiHttpError(402)),{provider:'gemini'})).reason,'billing');
 // The card itself, the network or another reader: not an outage.
 assert.equal(readerOutage(Object.assign(Error(geminiHttpError(400)),{provider:'gemini',status:400,upstream:'Image too large'})),null);
 assert.equal(readerOutage(Object.assign(Error(geminiHttpError(503)),{provider:'gemini',status:503})),null);
 assert.equal(readerOutage(Object.assign(Error('Gemini returned invalid JSON. The scan is retained; retry extraction.'),{provider:'gemini'})),null);
 assert.equal(readerOutage(Object.assign(Error(geminiHttpError(402)),{provider:'groq',status:402})),null);
 assert.equal(readerOutage(null),null);
});

test('the reader passes on the status and what Google said',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-outage-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const reader=createGeminiCardReader({prepareViews:async()=>[],cacheDir:dir,getKey:async()=>'test',minIntervalMs:0,sleep:async()=>{},
  fetchImpl:async()=>new Response(JSON.stringify({error:{code:402,status:'RESOURCE_EXHAUSTED',message:'Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.'}}),{status:402})});
 await assert.rejects(reader.recognize(Buffer.from('card')),error=>error.status===402&&/prepayment credits are depleted/.test(error.upstream)&&/HTTP 402/.test(error.message));
});

test('cards wait while the reading account is refused, and are read when it answers again',async t=>{
 let refused=true,calls=0,together=0,most=0;const alerts=[];
 const ocrForLane=()=>({async recognize(){calls++;together++;most=Math.max(most,together);try{await new Promise(r=>setTimeout(r,5));if(refused)throw billing();return {text:cardText,confidence:91};}finally{together--;}},close(){}});
 const {db,pool,scans,addCard,statuses}=await scanServer(t,{scanLanes:true,lanePerSite:3,ocrForLane,outageProbeMs:40,alertAdministrators:async(message,outage)=>{alerts.push({message,outage});}});
 // A card that an earlier version marked failed for the same account reason.
 const earlier=await addCard('Sasti OC',{status:'error',error:geminiHttpError(402)});
 const cards=[await addCard('Sasti OC'),await addCard('Sasti OC'),await addCard('Sasti OC')];
 await scans.pump();
 assert.deepEqual((await statuses(cards)).map(row=>row.status),['queued','queued','queued'],'no card is marked failed for an account reason');
 assert.equal((await statuses([earlier]))[0].status,'error','nothing is queued again while the account is still refused');
 const held=await readerOutageFor(pool,'Sasti OC');
 assert.equal(held.reason,'billing');assert.equal(held.httpStatus,402);assert.equal(held.lane,'sasti ob');
 assert.equal(await readerOutageFor(pool,'Majri OC'),null,'another site with its own queue is not reported as held');
 await until(()=>alerts.length===1);
 assert.match(alerts[0].message,/no credit/);assert.match(alerts[0].message,/prepayment credits are depleted/);assert.match(alerts[0].message,/sasti ob/);
 assert.deepEqual(scans.status().outages.map(outage=>[outage.lane,outage.reason,outage.httpStatus]),[['sasti ob','billing',402]]);
 // While held, one card at a time is tried; none fails.
 const before=calls;most=0;
 await until(async()=>{await scans.pump();return calls>=before+3;});
 assert.equal(most,1,'a held queue tries a single card');
 assert.ok((await statuses(cards)).every(row=>row.status!=='error'));
 assert.equal(alerts.length,1,'the administrators are told once, not at every try');
 // The account is put right: everything is read without anyone pressing Retry.
 refused=false;
 await until(async()=>{await scans.pump();return (await statuses([...cards,earlier])).every(row=>row.status==='review');});
 assert.equal(await readerOutageFor(pool,'Sasti OC'),null,'the hold is lifted');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_scan_reader_outages')).rows[0].n,0);
 await until(()=>scans.status().outages.length===0);
});

test('a failure of one card still fails only that card',async t=>{
 const ocrForLane=()=>({async recognize(){throw Object.assign(Error('Gemini returned invalid JSON. The scan is retained; retry extraction.'),{provider:'gemini'});},close(){}});
 const {pool,scans,addCard,statuses}=await scanServer(t,{scanLanes:true,lanePerSite:2,ocrForLane,outageProbeMs:40});
 const cards=[await addCard('Majri OC'),await addCard('Majri OC')];
 await scans.pump();
 assert.deepEqual((await statuses(cards)).map(row=>row.status),['error','error']);
 assert.equal(await readerOutageFor(pool,'Majri OC'),null);
});

test('an outage nobody refreshes ends, and a quota pause is reported only once it lasts',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const {READER_OUTAGE_SCHEMA}=await import('../server/rules/scan-reader-outage.mjs');await db.exec(READER_OUTAGE_SCHEMA);
 await noteReaderOutage(db,'sasti ob',{reason:'quota',status:429,detail:''},'engine-1');
 await noteReaderOutage(db,null,{reason:'billing',status:402,detail:'depleted'},'app');
 assert.deepEqual((await liveReaderOutages(db)).map(row=>row.lane).sort(),['*','sasti ob']);
 assert.equal((await readerOutageFor(db,'Majri OC')).reason,'billing','the single shared queue holds every site');
 assert.deepEqual((await claimOutageAlerts(db)).map(row=>row.reason),['billing'],'a quota pause of under ten minutes is not reported');
 assert.deepEqual(await claimOutageAlerts(db),[],'an outage is reported once');
 await db.query(`UPDATE mis_scan_reader_outages SET since=NOW()-INTERVAL '11 minutes' WHERE lane='sasti ob'`);
 assert.deepEqual((await claimOutageAlerts(db)).map(row=>row.reason),['quota']);
 await db.query(`UPDATE mis_scan_reader_outages SET checked_at=NOW()-make_interval(secs=>$1)`,[OUTAGE_STALE_SECONDS+5]);
 assert.deepEqual(await liveReaderOutages(db),[],'a reader that stopped no longer holds the screen');
 // The same queue failing again later is a new outage: it starts now and is reported again.
 await noteReaderOutage(db,null,{reason:'billing',status:402,detail:'depleted'},'app');
 const again=(await db.query(`SELECT since>NOW()-INTERVAL '1 minute' AS recent,alerted_at FROM mis_scan_reader_outages WHERE lane='*'`)).rows[0];
 assert.equal(again.recent,true);assert.equal(again.alerted_at,null);
});

test('the screen says whose problem it is',()=>{
 const banner=readerOutageMessage({reason:'billing',httpStatus:402});
 assert.match(banner,/no credit/);assert.match(banner,/not a scanning mistake/);assert.match(banner,/do not scan them again/);assert.match(banner,/AI Studio/);
 assert.match(readerOutageMessage({reason:'quota'}),/restarts by itself/);
 assert.equal(readerOutageMessage({reason:'something else'}),'');assert.equal(readerOutageMessage(null),'');
 assert.match(readerOutageAlert({lane:'*',reason:'key',httpStatus:403,detail:''}),/all sites/);
 const reasons=scanErrorReasons([
  ...Array.from({length:40},(_,i)=>({id:'b'+i,status:'error',error:geminiHttpError(402)})),
  {id:'q',status:'error',error:geminiHttpError(429)},
  {id:'w',status:'error',error:'This is a ELB card scanned on the VLB page. Open ELB Card Scanning and scan or upload it there. The original scan is retained.'},
  {id:'o',status:'error',error:'OCR could not read this scan. Retry OCR or enter the card manually.'},
  {id:'s',status:'review',context_mismatch:['Choose the card date, site and shift in Scan setup.']},
  {id:'ok',status:'review'},{id:'saved',status:'posted'},{id:'gone',status:'rejected',context_mismatch:['Date: 2026-10-01; expected 2026-11-01']},{id:'wait',status:'queued'}]);
 assert.equal(reasons[0].count,40);assert.equal(reasons[0].account,true);assert.match(reasons[0].reason,/Not a scanning mistake: the Google reading account had no credit \(HTTP 402\)/);
 assert.equal(reasons.reduce((total,row)=>total+row.count,0),44,'saved, rejected, waiting and good cards are not listed');
 assert.ok(reasons.some(row=>/Wrong page/.test(row.reason)&&!row.account));
 assert.ok(reasons.some(row=>row.reason==='OCR could not read this scan.'));
 assert.ok(reasons.some(row=>/Scan setup/.test(row.reason)));
 assert.doesNotMatch(CARD_GROUPS.find(group=>group.id==='error').description,/mismatch/,'the Error tile no longer suggests a date, site or shift mistake');
});
