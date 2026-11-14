import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerMisTelegram} from '../server/routes/mis-telegram.mjs';
import {telegramFetch} from '../server/services/telegram-fetch.mjs';

const admin={role:'super',login:'admin',permissions:{separateMisCredentials:true,misDesktopAccess:['Users & employees']}};
const token='123456:synthetic_token_abcdefghijklmnopqrstuvwxyz';

async function setup(t,fetchImpl){
 const db=new PGlite(),pool={query:(...args)=>args[0].includes('CREATE TABLE')?db.exec(args[0]):db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 let config;const store={read:async()=>config,write:async(key,value)=>{config=structuredClone(value)}};
 const app=express();app.use(express.json());
 const service=registerMisTelegram(app,{pool,store,requireSession:(req,res,next)=>{req.session=admin;next()},fetchImpl});
 await service.initialize();const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{service.stop();await new Promise(resolve=>server.close(resolve));await db.close()});
 const save=async()=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/mis-telegram/settings`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({botToken:token,enabled:true})});return {status:response.status,body:await response.json(),config}};
 return save;
}

test('saving the bot says the server could not reach Telegram, without the token',async t=>{
 const save=await setup(t,async()=>{throw Object.assign(new Error('fetch failed'),{code:'ETIMEDOUT'})});
 const result=await save();
 assert.equal(result.status,503);assert.match(result.body.error,/could not reach Telegram \(ETIMEDOUT\)/);
 assert.ok(!JSON.stringify(result.body).includes('synthetic_token'));assert.equal(result.config,undefined);
});

test('saving the bot says Telegram refused a wrong token',async t=>{
 const save=await setup(t,async()=>({ok:false,status:401,json:async()=>({ok:false,error_code:401,description:'Unauthorized'})}));
 const result=await save();
 assert.equal(result.status,400);assert.match(result.body.error,/Telegram refused the bot token \(Unauthorized\)/);assert.equal(result.config,undefined);
});

test('telegramFetch calls only api.telegram.org',async()=>{
 await assert.rejects(telegramFetch('https://example.com/x'),/only calls api\.telegram\.org/);
 await assert.rejects(telegramFetch('http://api.telegram.org/x'),/only calls api\.telegram\.org/);
});
