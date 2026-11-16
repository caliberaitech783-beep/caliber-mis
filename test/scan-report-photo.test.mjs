import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerMisTelegram} from '../server/routes/mis-telegram.mjs';
import {telegramOutboxSender} from '../server/services/otp-delivery.mjs';
import {siteReportBanner} from '../server/services/site-report-banner.mjs';

// The live fetch (telegramFetch) can send only bytes, so a photo must arrive as an encoded multipart
// body, never as a FormData object (16 Nov 2026: every photo reached Telegram as "[object FormData]").
const readBody=async options=>{
 if(options.body instanceof FormData)throw Error('A photo must be sent as encoded bytes, not a FormData object.');
 if(!Buffer.isBuffer(options.body))return JSON.parse(options.body);
 assert.match(options.headers['Content-Type'],/^multipart\/form-data; boundary=/);
 const form=await new Response(options.body,{headers:{'Content-Type':options.headers['Content-Type']}}).formData();
 // A multipart text field carries its line breaks as \r\n (form encoding); Telegram shows them as new lines.
 return Object.fromEntries([...form.entries()].map(([k,v])=>[k,typeof v==='string'?v.replace(/\r\n/g,'\n'):v.type]));
};

// Owner, 15 Nov 2026: the site picture comes first, the report is its caption with a bold title.
test('a batch completion report goes as the site picture with the report as its bold caption',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const pool={query:(...args)=>args[0].includes('CREATE TABLE')?db.exec(args[0]):db.query(...args)};
 const calls=[];let photoFails=false;
 const service=registerMisTelegram(express(),{pool,store:{read:async()=>({enabled:true,webhookReady:true,botToken:'1:x'})},requireSession:(q,r,n)=>n(),
  fetchImpl:async(url,options)=>{const method=url.split('/').at(-1);
   calls.push({method,body:await readBody(options)});
   const ok=!(method==='sendPhoto'&&photoFails);return {ok,status:ok?200:400,json:async()=>({ok,result:true})};}});
 await service.initialize();t.after(()=>service.stop());
 await db.query("INSERT INTO mis_telegram_links(login_name,chat_id) VALUES('owner','42')");
 const sender=telegramOutboxSender(pool);
 const report='📍 DIPKA\n<b>SITE-WISE BATCH COMPLETION REPORT</b>\n📋 VLB';
 assert.equal(await sender.send('owner',report,'scan-batch-report:read:1:owner',{html:true,photo:{site:'Dipka',kind:'VLB'}}),true);
 await service.drain();
 assert.deepEqual(calls.map(c=>c.method),['sendPhoto']);
 assert.deepEqual(calls[0].body,{chat_id:'42',caption:report,parse_mode:'HTML',photo:'image/png'});
 // If the picture cannot be sent, the report still arrives as text.
 photoFails=true;calls.length=0;
 await sender.send('owner',report,'scan-batch-report:read:2:owner',{html:true,photo:{site:'Dipka',kind:'VLB'}});
 await service.drain();
 assert.deepEqual(calls.map(c=>c.method),['sendPhoto','sendMessage']);
 assert.equal(calls[1].body.parse_mode,'HTML');assert.equal(calls[1].body.text,report);
 // Other messages are unchanged: plain text, no picture.
 calls.length=0;await sender.send('owner','Plain <text>','release-report:9:owner');await service.drain();
 assert.deepEqual(calls[0],{method:'sendMessage',body:{chat_id:'42',text:'Plain <text>',disable_web_page_preview:true}});
});

test('the site picture is a PNG',async()=>{
 const png=await siteReportBanner({site:'A very long site name that has to shrink to fit',kind:'VLB',batch:'CMLL/A VERY LONG SITE NAME THAT HAS TO SHRINK TO FIT/9TH -NOV-26/S1/B01'});
 assert.deepEqual([...png.subarray(1,4)].map(c=>String.fromCharCode(c)).join(''),'PNG');
});

// Owner, 16 Nov 2026: the whole report as one picture with the sub batches in a table, and a short caption.
test('a report card goes as one picture with a short caption, and the full text only if the picture fails',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const pool={query:(...args)=>args[0].includes('CREATE TABLE')?db.exec(args[0]):db.query(...args)};
 const calls=[];let photoFails=false;
 const service=registerMisTelegram(express(),{pool,store:{read:async()=>({enabled:true,webhookReady:true,botToken:'1:x'})},requireSession:(q,r,n)=>n(),
  fetchImpl:async(url,options)=>{const method=url.split('/').at(-1);
   calls.push({method,body:await readBody(options)});
   const ok=!(method==='sendPhoto'&&photoFails);return {ok,status:ok?200:400,json:async()=>({ok,result:true})};}});
 await service.initialize();t.after(()=>service.stop());
 await db.query("INSERT INTO mis_telegram_links(login_name,chat_id) VALUES('owner','42')");
 const sender=telegramOutboxSender(pool);
 const card={site:'DIPKA',kind:'VLB',batchName:'CMLL/DIPKA/15TH -NOV-26/S1/B01',batchLine:'VLB · 15TH -NOV-26/S1/B01 · ramu',scanned:3,trips:9,extracted:3,processed:3,
  subs:[{code:'B01',operator:'RAMU',total:3,auto:2,error:1}],more:0,all:{total:3,auto:2,error:1},time:'10:00 → 10:05 · 5 min 0 s',perCard:'12 s',accuracy:'100%',model:'gemini'};
 const caption='<b>SITE-WISE BATCH COMPLETION REPORT</b>\n📋 VLB · 15TH -NOV-26/S1/B01 · ramu',full='<b>SITE-WISE BATCH COMPLETION REPORT</b>\nfull text';
 await sender.send('owner',full,'scan-batch-report:closed:1:owner',{html:true,photo:{card,caption}});await service.drain();
 assert.deepEqual(calls,[{method:'sendPhoto',body:{chat_id:'42',caption,parse_mode:'HTML',photo:'image/png'}}]);
 photoFails=true;calls.length=0;
 await sender.send('owner',full,'scan-batch-report:closed:2:owner',{html:true,photo:{card,caption}});await service.drain();
 assert.deepEqual(calls.map(c=>c.method),['sendPhoto','sendMessage']);assert.equal(calls[1].body.text,full);
});

test('the report card is a PNG that grows with the sub batches',async()=>{
 const {batchReportCard}=await import('../server/services/batch-report-card.mjs');
 const {createRequire}=await import('node:module');const {loadImage}=createRequire(import.meta.url)('@napi-rs/canvas');
 const base={site:'A very long site name that has to shrink to fit the header',kind:'VLB',batchName:'CMLL/X/1ST -NOV-26/S1/B01',batchLine:'VLB · 1ST -NOV-26/S1/B01',
  scanned:1,trips:1,extracted:1,processed:1,all:{total:1,auto:1,error:0},time:'-',perCard:'-',accuracy:'-',model:'-'};
 const one=await loadImage(await batchReportCard({...base,subs:[{code:'B01',operator:'A',total:1,auto:1,error:0}],more:0}));
 const many=await loadImage(await batchReportCard({...base,subs:Array.from({length:12},(_,i)=>({code:'B'+i,operator:'A',total:1,auto:1,error:0})),more:3}));
 assert.equal(one.width,1080);assert.ok(many.height>one.height+12*60,'one table row per sub batch, plus the "+3 more" row');
});
