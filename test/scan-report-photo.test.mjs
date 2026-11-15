import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerMisTelegram} from '../server/routes/mis-telegram.mjs';
import {telegramOutboxSender} from '../server/services/otp-delivery.mjs';
import {siteReportBanner} from '../server/services/site-report-banner.mjs';

// Owner, 15 Nov 2026: the site picture comes first, the report is its caption with a bold title.
test('a batch completion report goes as the site picture with the report as its bold caption',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const pool={query:(...args)=>args[0].includes('CREATE TABLE')?db.exec(args[0]):db.query(...args)};
 const calls=[];let photoFails=false;
 const service=registerMisTelegram(express(),{pool,store:{read:async()=>({enabled:true,webhookReady:true,botToken:'1:x'})},requireSession:(q,r,n)=>n(),
  fetchImpl:async(url,options)=>{const method=url.split('/').at(-1);
   calls.push({method,body:options.body instanceof FormData?Object.fromEntries([...options.body.entries()].map(([k,v])=>[k,typeof v==='string'?v:v.type])):JSON.parse(options.body)});
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
