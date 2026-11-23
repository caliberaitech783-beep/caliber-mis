// Owner, 23 Nov 2026: "Pulse HR is now the final authority for employee master. All the creation, edit, and delete
// will only happen from Pulse HR, not from Pulse 2", and of Pulse-II's own doors: "Stop it and switch it off till the
// time I don't allow from my Telegram. No approval, no addition or deletion will be done in Pulse 2."
//   - every Pulse-II route that adds or edits an employee is refused while the door is closed, and it is closed
//     unless the owner has tapped Allow on Telegram;
//   - Allow opens it for 30 minutes, then it closes by itself; only the owner's login can allow;
//   - the general master routes never write an employee, open door or not;
//   - what happens while a batch is made (the site move with OTP on a card) is not behind this door.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {doorOpen,doorStatus,askWaiting,askTooSoon,DOOR_OPEN_MINUTES,DOOR_ASK_TTL_MINUTES,DOOR_ASK_RESEND_SECONDS,EMPLOYEE_MASTER_LOCKED,EMPLOYEE_MASTER_DOOR_KEY} from '../shared/employee-master-door.mjs';
import {createEmployeeMasterDoor,registerEmployeeMasterDoor,doorAskMessage,EMPLOYEE_DOOR_OWNER_LOGINS} from '../server/routes/employee-master-door.mjs';
import {registerEmployeeMaster} from '../server/routes/employee-master.mjs';
import {registerHrMasterImport} from '../server/routes/hr-master-import.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';

const START=Date.parse('2026-11-23T07:00:00.000Z'),MINUTE=60000;
const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const person=(number,name,site)=>({caliberId:'CMPL'+number,caliberCode:'CMLL'+number,name,site,currentLocation:site,hrListed:true,hrLeft:false,status:'Active',employeeMasterRevision:3});

const fixture=async({owners=['owner.one'],links=[['owner.one','900'],['site.admin','901']]}={})=>{
 const db=new PGlite();
 await db.exec('CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT,record_data JSONB);CREATE TABLE mis_telegram_links(login_name TEXT,chat_id TEXT)');
 for(const record of [person(9101,'FIRST MAN','Majri OC'),person(9102,'NO SITE MAN','')])await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Employee master',$1)",[JSON.stringify(record)]);
 for(const [login,chat] of links)await db.query('INSERT INTO mis_telegram_links(login_name,chat_id) VALUES($1,$2)',[login,chat]);
 const query=(sql,params)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,params);
 const pool={query,connect:async()=>({query,release(){}})};
 const state={now:START,login:'site.admin',name:'Site Admin',deliver:true},sent=[],audits=[];
 const door=createEmployeeMasterDoor({pool,ownerLogins:owners,now:()=>state.now,sendButtons:async(chatId,text,buttons,options)=>{if(!state.deliver)return false;sent.push({chatId,text,buttons,options});return true;}});
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{res.on('finish',()=>{if(req.audit)audits.push(req.audit)});next()});
 const requireSession=(req,res,next)=>{req.session={login:state.login,name:state.name};next()},allow=(req,res,next)=>next();
 registerEmployeeMasterDoor(app,{door,requireSession,requireAdministrator:allow});
 registerEmployeeMaster(app,{pool,requireSession,requireAdministrator:allow,door});
 registerHrMasterImport(app,{pool,requireSession,requireAdministrator:allow,door});
 // The general master routes sit behind the Employee Master guard, as in server.mjs.
 const written=(req,res)=>res.json({written:true});
 app.post('/api/masters/:master',written);app.put('/api/masters/:master/:id',written);app.delete('/api/masters/:master/:id',written);
 const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
 const call=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>({}))};};
 const record=async id=>(await db.query('SELECT record_data FROM master_records WHERE id=$1',[id])).rows[0].record_data;
 const count=async()=>Number((await db.query("SELECT count(*) n FROM master_records WHERE master_name='Employee master'")).rows[0].n);
 const button=which=>sent.at(-1).buttons[0][which==='allow'?0:1].callback_data;
 return {db,pool,door,state,sent,audits,call,record,count,button,close:()=>new Promise(resolve=>server.close(resolve))};
};
// Every Pulse-II route that adds or edits an employee, with a body that would be accepted.
const WRITES=[
 ['New employee','/api/employee-master',{caliberId:'CMPL9200',name:'NEW MAN'},'POST'],
 ['Edit employee','/api/employee-master/1',{caliberId:'CMPL9101',name:'RENAMED MAN',currentLocation:'Majri OC',employeeMasterRevision:3},'PUT'],
 ['Import CSV / JSON','/api/employee-master/import',{records:[{caliberId:'CMPL9300',name:'IMPORTED MAN'}]},'POST'],
 ['Employee Current Location','/api/employee-master/location/2',{currentLocation:'Majri OC',revision:3},'PUT'],
 ["HR's master Excel: Apply",'/api/employee-master/hr-import/apply',{rows:[['EMPLOYEE ID','NAME','SITE / OFFICE'],['CMLL9101','FIRST MAN','Majri OB']],planKey:'x'},'POST'],
];

test('the door is closed unless the owner has opened it, and it closes by itself',()=>{
 assert.equal(doorOpen(null,START),false,'nothing saved yet: closed');
 assert.equal(doorOpen({},START),false);
 assert.equal(doorOpen({openUntil:new Date(START+1).toISOString()},START),true);
 assert.equal(doorOpen({openUntil:new Date(START).toISOString()},START),false,'the minute it ends');
 assert.equal(doorOpen({openUntil:null,allowedBy:'owner.one'},START),false,'closed by hand');
 assert.equal(DOOR_OPEN_MINUTES,30);assert.equal(DOOR_ASK_TTL_MINUTES,20);
 const asked={ask:{id:'0123456789abcdef',by:'site.admin',name:'Site Admin',reason:'New driver joined',at:new Date(START).toISOString(),expiresAt:new Date(START+DOOR_ASK_TTL_MINUTES*MINUTE).toISOString(),status:'awaiting'}};
 assert.equal(askWaiting(asked,START+19*MINUTE),true);assert.equal(askWaiting(asked,START+20*MINUTE),false);
 assert.equal(askTooSoon(asked,START+59000),true);assert.equal(askTooSoon(asked,START+DOOR_ASK_RESEND_SECONDS*1000),false);
 const shown=doorStatus(asked,START);
 assert.deepEqual([shown.open,shown.openUntil,shown.asked.status,shown.asked.by,shown.message],[false,null,'awaiting','Site Admin',EMPLOYEE_MASTER_LOCKED]);
 assert.equal(JSON.stringify(shown).includes('0123456789abcdef'),false,'the button id never reaches a screen');
 assert.equal(doorStatus(asked,START+21*MINUTE).asked.status,'expired');
 assert.match(EMPLOYEE_MASTER_LOCKED,/only in HR Pulse/);assert.match(EMPLOYEE_MASTER_LOCKED,/owner allows it on Telegram/);
});

test('closed: every Pulse-II route that adds or edits an employee is refused, and nothing is written',async()=>{
 const f=await fixture();
 try{
  for(const [name,path,body,method] of WRITES){
   const answer=await f.call(path,body,method);
   assert.deepEqual([answer.status,answer.body.error,answer.body.locked],[423,EMPLOYEE_MASTER_LOCKED,true],name);
  }
  assert.equal(await f.count(),2,'nobody was added');
  assert.deepEqual([(await f.record(1)).name,(await f.record(2)).site],['FIRST MAN',''],'nobody was changed');
  // Reading stays: the list, a worker's location, and what HR's Excel would change.
  assert.equal((await f.call('/api/employee-master')).status,200);
  assert.equal((await f.call('/api/employee-master/location?employeeId=CMPL9102')).status,200);
  assert.equal((await f.call('/api/employee-master/hr-import')).status,200);
  assert.deepEqual((await f.call('/api/employee-master/door')).body.open,false);
 }finally{await f.close();}
});

test('the general master routes never write an employee, open door or not',async()=>{
 const f=await fixture();
 try{
  const tryAll=async()=>{
   for(const master of ['Employee master','ERP Employee master'])for(const [path,method] of [['',"POST"],['/1','PUT'],['/1','DELETE'],['/all','DELETE'],['/selected','DELETE']]){
    const answer=await f.call('/api/masters/'+encodeURIComponent(master)+path,{name:'X'},method);
    assert.deepEqual([answer.status,answer.body.error],[409,'Employees are created, edited and deleted only in HR Pulse.'],master+' '+method+' '+path);
   }
  };
  await tryAll();
  await f.call('/api/employee-master/door/ask',{reason:'A new driver joined at Majri'});
  await f.door.handleTelegramCallback({data:f.button('allow'),logins:['owner.one']});
  assert.equal((await f.call('/api/employee-master/door')).body.open,true);
  await tryAll();
  assert.equal((await f.call('/api/masters/Equipment%20master',{name:'X'})).body.written,true,'other masters are not touched by this');
 }finally{await f.close();}
});

test('asking: a reason is needed, the buttons go only to the owner, and not twice in a minute',async()=>{
 const f=await fixture();
 try{
  assert.deepEqual([(await f.call('/api/employee-master/door/ask',{reason:' no '})).status,f.sent.length],[400,0]);
  const asked=await f.call('/api/employee-master/door/ask',{reason:'A new driver <joined> at Majri'});
  assert.deepEqual([asked.status,asked.body.open,asked.body.asked.status,asked.body.asked.reason],[200,false,'awaiting','A new driver <joined> at Majri']);
  assert.equal((await f.call('/api/employee-master/door')).body.asked.status,'awaiting');
  assert.deepEqual(f.sent.map(message=>message.chatId),['900'],'only the owner, not the administrator who asked');
  const message=f.sent[0];
  assert.equal(message.options.parse_mode,'HTML');
  assert.match(message.text,/EMPLOYEE MASTER/);assert.match(message.text,/<b>Site Admin<\/b> \(site\.admin\)/);
  assert.match(message.text,/A new driver &lt;joined&gt; at Majri/,'what the administrator typed is escaped');
  assert.match(message.text,/opens Employee Master in Pulse-II for 30 minutes/);
  assert.deepEqual(message.buttons[0].map(b=>b.text),['✅ Allow 30 minutes','❌ Refuse']);
  assert.match(message.buttons[0][0].callback_data,/^emd:[0-9a-f]{16}:a$/);assert.match(message.buttons[0][1].callback_data,/^emd:[0-9a-f]{16}:r$/);
  assert.equal(f.audits.at(-1).action,'Ask the owner to open Employee Master');
  const again=await f.call('/api/employee-master/door/ask',{reason:'Asking once more'});
  assert.equal(again.status,429);assert.equal(f.sent.length,1);
  // Asking does not open anything.
  assert.equal((await f.call('/api/employee-master',{caliberId:'CMPL9200',name:'NEW MAN'})).status,423);
  assert.equal(doorAskMessage({name:'',login:'',reason:'x'}).includes('An administrator'),true);
 }finally{await f.close();}
});

test('the owner without Telegram: the request is not sent and the door stays closed',async()=>{
 const f=await fixture({links:[['site.admin','901']]});
 try{
  const asked=await f.call('/api/employee-master/door/ask',{reason:'A new driver joined at Majri'});
  assert.equal(asked.status,503);assert.match(asked.body.error,/owner has not connected Telegram/);
  assert.equal((await f.call('/api/employee-master/door')).body.asked,null);
  assert.equal((await f.call('/api/employee-master',{caliberId:'CMPL9200',name:'NEW MAN'})).status,423);
 }finally{await f.close();}
});

test('only the owner can allow; Allow opens the doors for 30 minutes, then they close by themselves',async()=>{
 const f=await fixture();
 try{
  await f.call('/api/employee-master/door/ask',{reason:'A new driver joined at Majri'});
  // A button of another kind is not ours: the release approval keeps its own.
  assert.equal(await f.door.handleTelegramCallback({data:'rel:0123456789abcdef:a',logins:['owner.one']}),null);
  // Someone else's Telegram, even an administrator's, cannot allow.
  assert.deepEqual(await f.door.handleTelegramCallback({data:f.button('allow'),logins:['site.admin']}),{answer:'Only the owner can allow this.'});
  assert.equal((await f.call('/api/employee-master/door')).body.open,false);
  // A button of an older request does nothing.
  assert.equal((await f.door.handleTelegramCallback({data:'emd:ffffffffffffffff:a',logins:['owner.one']})).answer,'This request is no longer active.');

  f.state.now=START+2*MINUTE;
  const allowed=await f.door.handleTelegramCallback({data:f.button('allow'),logins:['OWNER.ONE']});
  assert.equal(allowed.done,true);
  assert.equal(allowed.answer,'✅ Allowed by owner.one at 12:32 IST. Employee Master is open in Pulse-II until 13:02 IST, then it closes by itself.');
  const status=(await f.call('/api/employee-master/door')).body;
  assert.deepEqual([status.open,status.allowedBy,status.openUntil,status.asked.status],[true,'owner.one',new Date(START+32*MINUTE).toISOString(),'allowed']);
  assert.equal((await f.door.handleTelegramCallback({data:f.button('allow'),logins:['owner.one']})).answer,'Already allowed by owner.one.','a second tap changes nothing');
  assert.equal((await f.call('/api/employee-master/door/ask',{reason:'Asking while it is open'})).status,409);

  // Open: the routes answer as before.
  const added=await f.call('/api/employee-master',{caliberId:'CMPL9200',name:'NEW MAN'});
  assert.equal(added.status,200);assert.equal(await f.count(),3);
  assert.equal((await f.call('/api/employee-master/1',{caliberId:'CMPL9101',name:'RENAMED MAN',currentLocation:'Majri OC',employeeMasterRevision:3},'PUT')).status,200);
  assert.equal((await f.record(1)).name,'RENAMED MAN');
  assert.equal((await f.call('/api/employee-master/location/2',{currentLocation:'Majri OC',revision:3},'PUT')).status,200);

  // One second before the end it is open; at the end it is closed again, with nobody doing anything.
  f.state.now=START+32*MINUTE-1000;
  assert.equal((await f.call('/api/employee-master/door')).body.open,true);
  f.state.now=START+32*MINUTE;
  assert.equal((await f.call('/api/employee-master/door')).body.open,false);
  for(const [name,path,body,method] of WRITES)assert.equal((await f.call(path,body,method)).status,423,name+' after the time');
 }finally{await f.close();}
});

test('Refuse keeps it closed, an unanswered request lapses, and an open door can be closed at once',async()=>{
 const f=await fixture();
 try{
  await f.call('/api/employee-master/door/ask',{reason:'A new driver joined at Majri'});
  const refused=await f.door.handleTelegramCallback({data:f.button('refuse'),logins:['owner.one']});
  assert.equal(refused.answer,'❌ Refused by owner.one at 12:30 IST. Employee Master stays closed in Pulse-II.');
  assert.deepEqual([(await f.call('/api/employee-master/door')).body.open,(await f.call('/api/employee-master/door')).body.asked.status],[false,'refused']);
  assert.equal((await f.door.handleTelegramCallback({data:f.button('allow'),logins:['owner.one']})).answer,'Already refused by owner.one.','Allow after Refuse opens nothing');
  assert.equal((await f.call('/api/employee-master',{caliberId:'CMPL9200',name:'NEW MAN'})).status,423);

  // A request nobody answers in 20 minutes.
  f.state.now=START+5*MINUTE;
  await f.call('/api/employee-master/door/ask',{reason:'Asking a second time'});
  f.state.now=START+26*MINUTE;
  assert.equal((await f.call('/api/employee-master/door')).body.asked.status,'expired');
  assert.equal((await f.door.handleTelegramCallback({data:f.button('allow'),logins:['owner.one']})).answer,'This request has expired. Employee Master stays closed.');
  assert.equal((await f.call('/api/employee-master/door')).body.open,false);

  // Allowed, then closed by an administrator before the time.
  await f.call('/api/employee-master/door/ask',{reason:'Asking a third time'});
  await f.door.handleTelegramCallback({data:f.button('allow'),logins:['owner.one']});
  assert.equal((await f.call('/api/employee-master/door')).body.open,true);
  const closed=await f.call('/api/employee-master/door/close',{});
  assert.deepEqual([closed.status,closed.body.closed,closed.body.open],[200,true,false]);
  assert.equal(f.audits.at(-1).action,'Close Employee Master');
  assert.equal((await f.call('/api/employee-master',{caliberId:'CMPL9200',name:'NEW MAN'})).status,423);
  assert.equal((await f.call('/api/employee-master/door/close',{})).body.closed,false,'closing a closed door is nothing');
  const saved=(await f.db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[EMPLOYEE_MASTER_DOOR_KEY])).rows[0].setting_value;
  assert.deepEqual([saved.openUntil,saved.closedBy],[null,'site.admin']);
 }finally{await f.close();}
});

test('a door that cannot be read is closed',async()=>{
 const broken={query:async()=>{throw new Error('database away');},connect:async()=>{throw new Error('database away');}};
 const door=createEmployeeMasterDoor({pool:broken,now:()=>START});
 let passed=false,failed=null;
 await door.requireOpen({},{status:()=>({json:()=>{}})},error=>{if(error)failed=error;else passed=true;});
 assert.equal(passed,false);assert.match(failed.message,/database away/);
});

test('"my Telegram" is the owner\'s login, and a site MIS login reaches the new routes only with the Employee master right',()=>{
 assert.deepEqual([...EMPLOYEE_DOOR_OWNER_LOGINS],['mohitchadda']);
 const login=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages,misMobileAccess:[]}});
 for(const [path,method] of [['/api/employee-master/door','GET'],['/api/employee-master/door/ask','POST'],['/api/employee-master/door/close','POST']]){
  assert.equal(misRequestAllowed(login(['Employee master']),{path,method}),true,path);
  assert.equal(misRequestAllowed(login(['Reports']),{path,method}),false,path);
 }
});

test('the server puts the door in front of the employee routes, and the batch-time doors stay as they are',()=>{
 const server=source('server.mjs');
 assert.ok(server.includes('const employeeMasterDoor=createEmployeeMasterDoor({pool,sendButtons:(chatId,text,buttons,options)=>misTelegram.sendButtons(chatId,text,buttons,options)});'));
 assert.ok(server.includes('registerEmployeeMasterDoor(app,{door:employeeMasterDoor,requireSession,requireAdministrator});'));
 assert.ok(server.includes('registerEmployeeMaster(app,{pool,requireSession,requireAdministrator,door:employeeMasterDoor});'));
 assert.ok(server.includes('registerHrMasterImport(app,{pool,requireSession,requireAdministrator,door:employeeMasterDoor});'));
 assert.ok(server.includes('telegramCallbacks.handle=async input=>(await releaseOtp.handleTelegramCallback(input))??employeeMasterDoor.handleTelegramCallback(input);'),'a release button is still answered first');
 const routes=source('server/routes/employee-master.mjs');
 for(const line of ["app.put('/api/employee-master/location/:id',requireSession,open,","app.post('/api/employee-master',...protect,open,wrap(save));","app.put('/api/employee-master/:id',...protect,open,","app.post('/api/employee-master/import',...protect,open,"])assert.ok(routes.includes(line),line);
 assert.ok(source('server/routes/hr-master-import.mjs').includes("app.post('/api/employee-master/hr-import/apply',...protect,open,"));
 assert.ok(source('server/routes/hr-master-import.mjs').includes("app.post('/api/employee-master/hr-import/preview',...protect,wrap("),'looking at the changes writes nothing and stays');
 // The site move with OTP on a card, the "drives this vehicle" mark and HR's approved transfers are not behind the door.
 for(const file of ['server/routes/employee-site-move.mjs','server/routes/erp-employee-source.mjs','server/services/hr-employee-sync.mjs'])assert.equal(source(file).includes('requireOpen'),false,file);
});

test('the Employee Master page shows the lock and greys out the buttons that add or edit',()=>{
 const page=source('src/employee-master.jsx');
 assert.ok(page.includes('<EmployeeMasterDoor session={session} onChange={setDoorOpen}/>'));
 assert.ok(page.includes('const [doorOpen,setDoorOpen]=useState(false);'),'closed until the server says it is open');
 assert.ok(page.includes('disabled={busy||!doorOpen} title={closedTitle}>New employee</button>'));
 assert.ok(page.includes('disabled={busy||!doorOpen} title={closedTitle}>Import CSV / JSON</button>'));
 assert.ok(page.includes('disabled={!doorOpen} title={closedTitle}>Edit employee</button>'));
 assert.ok(page.includes('<HrMasterImport session={session} onApplied={load} locked={!doorOpen}/>'));
 assert.ok(page.includes('It is switched off: employees are changed only in HR Pulse'));
 assert.ok(source('src/hr-master-import.jsx').includes("disabled={Boolean(busy)||locked}"));
 const panel=source('src/employee-master-door.jsx');
 assert.ok(panel.includes('Ask the owner on Telegram'));assert.ok(panel.includes('Close now'));
 assert.ok(panel.includes("fetch('/api/employee-master/door'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${session.token}`"),'the page never calls the server without its Bearer token');
 assert.match(source('src/employee-master.css'),/\.employee-door\{[^}]*color:#4a3200/,'the panel names its own text colour for the night theme');
});
