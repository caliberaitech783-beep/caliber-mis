import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerMisTelegram} from '../server/routes/mis-telegram.mjs';

test('a tapped button reaches the release approval with the logins linked to that private chat',async t=>{
 const db=new PGlite(),pool={query:(...args)=>args[0].includes('CREATE TABLE')?db.exec(args[0]):db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 const config={botToken:'123456:synthetic_token_abcdefghijklmnopqrstuvwxyz',enabled:true,webhookReady:true,webhookSecret:'s3cret',botUsername:'CaliberMisTestBot'};
 const calls=[],taps=[];let reply={answer:'✅ Approved by anoop at 02:10 IST.',done:true};
 const app=express();app.use(express.json());
 const service=registerMisTelegram(app,{pool,store:{read:async()=>config,write:async()=>{}},requireSession:(req,res,next)=>next(),
  fetchImpl:async(url,options)=>{calls.push({method:url.split('/').at(-1),body:JSON.parse(options.body)});return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:5}})}},
  onCallback:async input=>{taps.push(input);return reply}});
 await service.initialize();
 await db.query("INSERT INTO mis_telegram_links(login_name,chat_id) VALUES('anoop','42')");
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{service.stop();await new Promise(resolve=>server.close(resolve));await db.close()});
 const hook=async(body,secret='s3cret')=>(await fetch(`http://127.0.0.1:${server.address().port}/api/mis-telegram/webhook`,{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify(body)})).status;
 const tap=(chat,from,type='private')=>({callback_query:{id:'cb1',data:'rel:0123456789abcdef:a',from:{id:from},message:{message_id:5,text:'Pulse-II urgent production release',chat:{id:chat,type}}}});

 assert.equal(await hook(tap(42,42),'wrong'),403);
 assert.equal(taps.length,0);
 assert.equal(await hook(tap(42,42,'group')),200);
 assert.equal(taps.length,0,'a group chat cannot approve');
 assert.equal(await hook(tap(42,42)),200);
 assert.deepEqual(taps,[{data:'rel:0123456789abcdef:a',logins:['anoop'],chatId:'42'}]);
 const edit=calls.find(c=>c.method==='editMessageText'),answer=calls.find(c=>c.method==='answerCallbackQuery');
 assert.match(edit.body.text,/Pulse-II urgent production release\n\n✅ Approved by anoop/);
 assert.equal(answer.body.callback_query_id,'cb1');

 // A summary of several attendance days: only the tapped day's row goes, the other days keep their buttons.
 const rows=[[{text:'✅ Approve 17-11',callback_data:'att:1111111111111111:a'},{text:'↩ Send back 17-11',callback_data:'att:1111111111111111:b'}],
  [{text:'✅ Approve 18-11',callback_data:'att:2222222222222222:a'},{text:'↩ Send back 18-11',callback_data:'att:2222222222222222:b'}]];
 reply={answer:'✅ 18-11: Approved. Sent to Office HR.',done:true,keepOtherButtons:true};
 assert.equal(await hook({callback_query:{id:'cb2',data:'att:2222222222222222:a',from:{id:42},message:{message_id:6,text:'Sasti OC · 2 days waiting',chat:{id:42,type:'private'},reply_markup:{inline_keyboard:rows}}}}),200);
 const kept=calls.filter(c=>c.method==='editMessageText').at(-1);
 assert.match(kept.body.text,/2 days waiting\n\n✅ 18-11: Approved/);
 assert.deepEqual(kept.body.reply_markup,{inline_keyboard:[rows[0]]});
 assert.equal(edit.body.reply_markup,undefined,'a release approval loses its buttons as before');

 const buttons=[[{text:'✅ Approve release',callback_data:'rel:x:a'}]];
 assert.equal(await service.sendButtons('42','Approve?',buttons),true);
 assert.deepEqual(calls.at(-1),{method:'sendMessage',body:{chat_id:'42',text:'Approve?',disable_web_page_preview:true,reply_markup:{inline_keyboard:buttons}}});
});
