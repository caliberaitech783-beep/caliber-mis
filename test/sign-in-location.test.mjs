import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSignInLocation,SIGN_IN_LOCATION_UPDATE_SQL} from '../server/rules/sign-in-location.mjs';
import {registerSignInLocationRoute,initializeLoginHistory} from '../server/routes/user-login-history.mjs';
import {recordSignInLocation,readPosition,nearestPlaceLabel,formatAccuracy,signInLocationCell,sessionMark} from '../src/sign-in-location.mjs';
import {auditShouldRecord} from '../server/rules/audit-trail.mjs';

test('server accepts only a known status and real coordinates',()=>{
  assert.deepEqual(parseSignInLocation({status:'shared',latitude:19.781234567,longitude:79.33,accuracy:31.6}),{status:'shared',latitude:19.781235,longitude:79.33,accuracy:32});
  assert.deepEqual(parseSignInLocation({status:'Refused',latitude:1,longitude:2}),{status:'refused',latitude:null,longitude:null,accuracy:null},'refusal keeps no coordinates');
  assert.deepEqual(parseSignInLocation({status:'unavailable'}),{status:'unavailable',latitude:null,longitude:null,accuracy:null});
  for(const body of [{},{status:'maybe'},{status:'shared'},{status:'shared',latitude:'19',longitude:'79'},{status:'shared',latitude:91,longitude:79},{status:'shared',latitude:19,longitude:-181},{status:'shared',latitude:null,longitude:null}])
    assert.ok(parseSignInLocation(body).error,JSON.stringify(body));
  assert.equal(parseSignInLocation({status:'shared',latitude:19,longitude:79,accuracy:-5}).accuracy,null);
});

test('the first shared position is kept; a refusal never overwrites it but a later share replaces a refusal',()=>{
  assert.match(SIGN_IN_LOCATION_UPDATE_SQL,/location_status<>'shared'/);
  assert.match(SIGN_IN_LOCATION_UPDATE_SQL,/\$2::text='shared' OR location_status=''/);
  assert.match(SIGN_IN_LOCATION_UPDATE_SQL,/WHERE session_id=\$1/);
});

test('location route saves against the signed-in session and rejects bad input before querying',async()=>{
  let path,guard,handler;const queries=[];
  const requireSession=()=>{};
  registerSignInLocationRoute({post(p,g,h){path=p;guard=g;handler=h;}},{pool:{async query(sql,params){queries.push({sql,params});return {rowCount:1};}},requireSession});
  assert.equal(path,'/api/session-location');assert.equal(guard,requireSession);
  const reply=()=>{const res={code:200,body:null,status(c){this.code=c;return this;},json(b){this.body=b;return this;}};return res;};
  let res=reply();
  await handler({body:{status:'shared',latitude:24.17,longitude:82.66,accuracy:12},session:{sessionId:'abc'}},res,error=>{throw error;});
  assert.deepEqual(res.body,{recorded:true});
  assert.deepEqual(queries[0].params,['abc','shared',24.17,82.66,12]);
  res=reply();
  await handler({body:{status:'shared'},session:{sessionId:'abc'}},res,error=>{throw error;});
  assert.equal(res.code,400);assert.equal(queries.length,1);
  res=reply();
  await handler({body:{status:'refused'},session:{}},res,error=>{throw error;});
  assert.deepEqual(res.body,{recorded:false},'a session without a public ID is ignored');assert.equal(queries.length,1);
});

test('schema adds the location columns to the login history',()=>{
  const source=initializeLoginHistory.toString();
  for(const column of ['location_status','location_latitude','location_longitude','location_accuracy_m','location_at'])
    assert.match(source,new RegExp(`ADD COLUMN IF NOT EXISTS ${column} `));
  const route=readFileSync(new URL('../server/routes/user-login-history.mjs',import.meta.url),'utf8');
  assert.match(route,/h\.location_status AS "locationStatus"/);
});

test('server wires the route for every signed-in user, MIS logins included, and keeps it out of the audit trail',async()=>{
  const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  assert.match(server,/registerSignInLocationRoute\(app,\{pool,requireSession\}\)/);
  const access=readFileSync(new URL('../shared/mis-application-access.mjs',import.meta.url),'utf8');
  assert.match(access,/route==='\/api\/session-location'\)return req\.method==='POST'/);
  assert.equal(auditShouldRecord('POST','/api/session-location',{statusCode:200}),false);
});

const memoryStorage=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value))};};
const position=(latitude,longitude,accuracy)=>({getCurrentPosition:(ok)=>ok({coords:{latitude,longitude,accuracy}})});
const noTimer={setTimer:()=>0,clearTimer:()=>{}};

test('browser posts the position once per sign-in and asks again after a new sign-in',async()=>{
  const storage=memoryStorage();const posts=[];
  const fetchImpl=async(url,options)=>{posts.push({url,options});return {ok:true,status:200};};
  const result=await recordSignInLocation('token-1',{fetchImpl,storage,geolocation:position(19.78,79.33,25),...noTimer});
  assert.equal(result.status,'shared');
  assert.equal(posts[0].url,'/api/session-location');
  assert.equal(posts[0].options.headers.Authorization,'Bearer token-1');
  assert.deepEqual(JSON.parse(posts[0].options.body),{status:'shared',latitude:19.78,longitude:79.33,accuracy:25});
  assert.equal(await recordSignInLocation('token-1',{fetchImpl,storage,geolocation:position(1,1,1),...noTimer}),null,'same sign-in: no second prompt');
  assert.equal(posts.length,1);
  await recordSignInLocation('token-2',{fetchImpl,storage,geolocation:position(1,1,1),...noTimer});
  assert.equal(posts.length,2);
  assert.notEqual(sessionMark('token-1'),sessionMark('token-2'));
  assert.ok(!JSON.stringify([...Object.values(storage)]).includes('token-1'));
});

test('a refusal or a missing location API is reported, never blocks, and an ended sign-in asks again',async()=>{
  assert.deepEqual(await readPosition({geolocation:{getCurrentPosition:(_ok,fail)=>fail({code:1})}}),{status:'refused'});
  assert.deepEqual(await readPosition({geolocation:{getCurrentPosition:(_ok,fail)=>fail({code:3})}}),{status:'unavailable'});
  assert.deepEqual(await readPosition({geolocation:undefined}),{status:'unavailable'});
  assert.deepEqual(await readPosition({geolocation:{getCurrentPosition(){throw new Error('insecure');}}}),{status:'unavailable'});
  const storage=memoryStorage();let calls=0;
  await recordSignInLocation('t',{fetchImpl:async()=>{calls++;return {ok:false,status:401};},storage,geolocation:undefined,...noTimer});
  await recordSignInLocation('t',{fetchImpl:async()=>{calls++;throw new Error('offline');},storage,geolocation:undefined,...noTimer});
  await recordSignInLocation('t',{fetchImpl:async()=>{calls++;return {ok:true,status:200};},storage,geolocation:undefined,...noTimer});
  await recordSignInLocation('t',{fetchImpl:async()=>{calls++;return {ok:true,status:200};},storage,geolocation:undefined,...noTimer});
  assert.equal(calls,3,'401 and network errors retry next load; a saved answer does not');
});

test('an unanswered prompt is saved as unavailable, and a later Allow still sends the position',async()=>{
  const posts=[];let fire,allow;
  const pending=recordSignInLocation('t',{
    fetchImpl:async(_url,options)=>{posts.push(JSON.parse(options.body).status);return {ok:true,status:200};},
    storage:memoryStorage(),geolocation:{getCurrentPosition:(ok)=>{allow=ok;}},
    setTimer:callback=>{fire=callback;return 1;},clearTimer:()=>{},
  });
  fire();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(posts,['unavailable']);
  allow({coords:{latitude:20,longitude:79,accuracy:40}});await pending;
  assert.deepEqual(posts,['unavailable','shared']);
});

test('history cell names the nearest site, the accuracy and a map link',()=>{
  assert.equal(nearestPlaceLabel(19.785,79.335),'Near Sasti site (0.8 km)');
  assert.equal(nearestPlaceLabel(21.15,79.09),'Near Nagpur office (0.0 km)');
  assert.match(nearestPlaceLabel(28.61,77.2),/^\d+ km from .+ (site|office)$/);
  assert.equal(formatAccuracy(31.4),'±31 m');assert.equal(formatAccuracy(1500),'±1.5 km');assert.equal(formatAccuracy(25000),'±25 km');assert.equal(formatAccuracy(undefined),'');
  assert.deepEqual(signInLocationCell({locationStatus:'shared',latitude:24.17,longitude:82.66,accuracy:12}),{tone:'shared',text:'Near Dudhichua site (0.0 km) · ±12 m',href:'https://www.google.com/maps?q=24.17,82.66'});
  assert.equal(signInLocationCell({locationStatus:'refused'}).text,'Refused by user');
  assert.equal(signInLocationCell({locationStatus:'unavailable'}).text,'Not available on this device');
  assert.equal(signInLocationCell({}).text,'Not recorded');
});

test('every sign-in screen and both app shells use the location capture',()=>{
  const read=file=>readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8');
  assert.match(read('main.jsx'),/void heartbeat\(true\);\s*void recordSignInLocation\(session\.token\);/);
  assert.match(read('main.jsx'),/\{SIGN_IN_LOCATION_NOTICE\}/);
  assert.match(read('mis-entry.jsx'),/void recordSignInLocation\(session\.token\)/);
  assert.match(read('mis-shared-signin.jsx'),/\{SIGN_IN_LOCATION_NOTICE\}/);
  assert.match(read('user-login-history.jsx'),/<th>Location at sign-in<\/th>/);
});

const connectionString=process.env.AUTH_SESSION_TEST_DATABASE_URL;
test('PostgreSQL: location sticks to its sign-in row and survives session touches and re-migration',{skip:!connectionString},async()=>{
  const {default:pg}=await import('pg');const {randomUUID}=await import('node:crypto');
  const pool=new pg.Pool({connectionString,ssl:process.env.AUTH_SESSION_TEST_DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:1});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const schema=`location_test_${randomUUID().replaceAll('-','')}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await client.query(`CREATE TABLE auth_sessions (session_public_id TEXT PRIMARY KEY,login_name TEXT,employee_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),last_seen_at TIMESTAMPTZ DEFAULT NOW(),device_id TEXT DEFAULT '',ip_address TEXT DEFAULT '',user_agent TEXT DEFAULT '');
      CREATE TABLE user_session_activity (session_id TEXT,actor_login TEXT,actor_name TEXT,started_at TIMESTAMPTZ,last_seen_at TIMESTAMPTZ,device_id TEXT,ip_address TEXT,user_agent TEXT);
      CREATE TABLE app_metadata (key TEXT PRIMARY KEY,value TEXT);`);
    await initializeLoginHistory(client);
    await client.query(`INSERT INTO auth_sessions(session_public_id,login_name,employee_name) VALUES ('one','alice','Alice'),('two','bob','Bob')`);
    const save=(id,body)=>client.query(SIGN_IN_LOCATION_UPDATE_SQL,(({status,latitude,longitude,accuracy})=>[id,status,latitude,longitude,accuracy])(parseSignInLocation(body)));
    const row=async id=>(await client.query(`SELECT location_status AS s,location_latitude AS lat,location_longitude AS lng,location_accuracy_m AS acc,location_at IS NOT NULL AS stamped FROM user_login_history WHERE session_id=$1`,[id])).rows[0];
    assert.equal((await save('one',{status:'refused'})).rowCount,1);
    assert.deepEqual(await row('one'),{s:'refused',lat:null,lng:null,acc:null,stamped:true});
    assert.equal((await save('one',{status:'unavailable'})).rowCount,0,'a second non-answer does not replace the first');
    assert.equal((await save('one',{status:'shared',latitude:19.78,longitude:79.33,accuracy:20})).rowCount,1,'a later Allow replaces the refusal');
    assert.equal((await save('one',{status:'shared',latitude:1,longitude:1,accuracy:1})).rowCount,0,'the first position is kept');
    assert.equal((await save('one',{status:'refused'})).rowCount,0);
    await client.query(`UPDATE auth_sessions SET device_id='phone',last_seen_at=NOW() WHERE session_public_id='one'`);
    await initializeLoginHistory(client);
    assert.deepEqual(await row('one'),{s:'shared',lat:19.78,lng:79.33,acc:20,stamped:true});
    assert.equal((await row('two')).s,'','an untouched sign-in shows Not recorded');
    assert.equal((await save('missing',{status:'refused'})).rowCount,0);
  }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});
