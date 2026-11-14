import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createNotificationFeed} from '../server/rules/notification-feed.mjs';

const fakeClient=()=>{const client=new EventEmitter();client.queries=[];client.released=0;client.query=async sql=>{client.queries.push(sql);return {rows:[]};};client.release=()=>{client.released++;};return client;};
const fakeResponse=()=>{const response=new EventEmitter();response.destroyed=false;return response;};

test('the listener uses the given connect() and never takes a pool connection',async()=>{
 const pool={connects:0,async connect(){pool.connects++;return fakeClient();}};
 const own=fakeClient();let opened=0;
 const subscribe=createNotificationFeed(pool,{timeoutMs:50,connect:async()=>{opened++;return own;}});
 const first=await subscribe('alice',fakeResponse()),second=await subscribe('bob',fakeResponse());
 assert.equal(opened,1,'one dedicated connection for every subscriber');
 assert.equal(pool.connects,0,'the pool is left to requests');
 assert.deepEqual(own.queries,['LISTEN bdms_notifications']);
 own.emit('notification',{channel:'bdms_notifications',payload:'alice'});
 await first.promise;first.close();
 await second.promise;second.close();
});

test('without connect() the listener still comes from the pool',async()=>{
 const client=fakeClient();const pool={connects:0,async connect(){pool.connects++;return client;}};
 const subscribe=createNotificationFeed(pool,{timeoutMs:20});
 const subscription=await subscribe('alice',fakeResponse());await subscription.promise;subscription.close();
 assert.equal(pool.connects,1);
});
