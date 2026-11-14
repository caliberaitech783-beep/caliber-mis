import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {registerMisTelegram} from '../server/routes/mis-telegram.mjs';

const admin={role:'super',login:'admin',permissions:{separateMisCredentials:true,misDesktopAccess:['Users & employees']}};
const user={role:'super',login:'person',permissions:{separateMisCredentials:true,adminLevel:'Admin',misDesktopAccess:[]}};

test('administrators see who has connected Telegram, with names and times but no chat IDs',async t=>{
 const db=new PGlite(),pool={query:(...args)=>args[0].includes('CREATE TABLE')?db.exec(args[0]):db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
 const app=express();app.use(express.json());
 const service=registerMisTelegram(app,{pool,store:{read:async()=>({}),write:async()=>{}},requireSession:(req,res,next)=>{req.session=req.get('Authorization')==='Bearer admin'?admin:user;next()},fetchImpl:async()=>{throw Error('no Telegram in this test')}});
 await service.initialize();
 await db.exec("CREATE TABLE master_records(id SERIAL PRIMARY KEY,master_name TEXT,record_data JSONB)");
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Users & employees',$1)",[{login:'Anoop',employee:'Anoop Kumar'}]);
 await db.query("INSERT INTO mis_telegram_links(login_name,chat_id,linked_at) VALUES('anoop','5551','2026-11-15T02:00:00Z'),('mohitchadda','5552','2026-11-15T01:27:00Z')");
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{service.stop();await new Promise(resolve=>server.close(resolve));await db.close()});
 const get=async actor=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/mis-telegram/links`,{headers:{Authorization:'Bearer '+actor}});return {status:response.status,body:await response.json()}};
 assert.equal((await get('user')).status,403);
 const result=await get('admin');
 assert.equal(result.status,200);
 assert.deepEqual(result.body.people.map(person=>[person.login,person.name]),[['anoop','Anoop Kumar'],['mohitchadda','']]);
 assert.ok(!JSON.stringify(result.body).includes('555'),'chat IDs are not shown');
});
