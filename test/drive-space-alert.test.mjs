// Owner, 24 Nov 2026: tell Mohit Chadda and Anup on Telegram when 470 GB of the 500 GB drive is used, and every
// 6 hours while it stays above (Automation line A28). The figures below are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createDriveSpaceAlert,driveFigures,DRIVE_STATE_KEY,DRIVE_ALERT_USED_GB,DRIVE_REMIND_HOURS,DRIVE_CHECK_MINUTES} from '../server/services/drive-space-alert.mjs';
import {automationForEventKey} from '../server/services/automation-switches.mjs';
import {AUTOMATIONS,automationRows} from '../server/rules/automation-catalogue.mjs';
import {CHANNEL_AUTOMATION_KEYS,channelEventKey} from '../server/services/automation-channels.mjs';

const START=Date.parse('2026-11-24T05:50:00.000Z'),MINUTE=60000,HOUR=60*MINUTE;
const space=usedGb=>({totalGb:500,usedGb,freeGb:Math.round((500-usedGb)*10)/10});
async function fixture({live=true,db=new PGlite()}={}){
 const pool={query:(sql,params)=>db.query(sql,params)};
 const f={db,now:START,used:400,alerts:[]};
 f.alert=createDriveSpaceAlert({pool,live,now:()=>f.now,read:async()=>f.used===null?null:space(f.used),alert:async(message,key)=>{f.alerts.push({message,key});}});
 f.later=ms=>{f.now+=ms;};
 f.saved=async()=>(await db.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[DRIVE_STATE_KEY])).rows[0]?.setting_value||{};
 return f;
}
// Ticks every 10 minutes for this long, as the live server does.
async function run(f,ms){for(let spent=0;spent<ms;spent+=DRIVE_CHECK_MINUTES*MINUTE){f.later(DRIVE_CHECK_MINUTES*MINUTE);await f.alert.tick();}}

test('told at 470 GB, then every 6 hours while it stays above, never in between',async()=>{
 const f=await fixture();
 try{
  f.used=469.9;assert.deepEqual(await f.alert.tick(),{ok:true,above:false});
  assert.equal(f.alerts.length,0,'below the line: nothing');
  f.later(10*MINUTE);f.used=DRIVE_ALERT_USED_GB;
  assert.deepEqual(await f.alert.tick(),{ok:true,above:true,told:true},'470 GB itself is told');
  assert.equal(f.alerts.length,1);
  assert.equal(f.alerts[0].key,'drive-space:2026-11-24T06:00');
  assert.equal(f.alerts[0].message,[
   '⚠️ Server drive nearly full: 470 GB of 500 GB used, 30 GB free (alert line 470 GB).',
   'Crossed 470 GB since 24 Nov, 11:30 IST.',
   'Pulse-II, its test slot and Pulse share this drive. When it is full, releases fail at the upload (Kudu 409) and files cannot be saved.',
   'What fills it: Azure portal > App Service plan > File system storage.',
   'Told again every 6 hours while it stays above 470 GB.'].join('\n'));

  f.used=480;await run(f,DRIVE_REMIND_HOURS*HOUR-20*MINUTE);
  assert.equal(f.alerts.length,1,'quiet for six hours');
  await run(f,20*MINUTE);
  assert.equal(f.alerts.length,2,'told again after six hours');
  assert.match(f.alerts[1].message,/^⚠️ Server drive nearly full: 480 GB of 500 GB used, 20 GB free/);
  assert.match(f.alerts[1].message,/\nAbove 470 GB since 24 Nov, 11:30 IST\./,'the first crossing time is kept');
  assert.notEqual(f.alerts[1].key,f.alerts[0].key);
  const saved=await f.saved();
  assert.equal(saved.usedGb,480);assert.equal(saved.aboveSince,'2026-11-24T06:00:00.000Z');
 }finally{await f.db.close();}
});

test('a drive that sways around 470 GB is not told every ten minutes; a real fall starts afresh',async()=>{
 const f=await fixture();
 try{
  f.used=471;await f.alert.tick();
  assert.equal(f.alerts.length,1);
  f.used=465;await run(f,30*MINUTE);
  f.used=472;await run(f,30*MINUTE);
  assert.equal(f.alerts.length,1,'down to 465 and back up within six hours: not told again yet');
  f.used=450;await run(f,10*MINUTE);
  assert.equal((await f.saved()).toldAt,null,'below 460 GB the clock is cleared');
  f.used=475;await run(f,10*MINUTE);
  assert.equal(f.alerts.length,2,'a new crossing after space was freed is told at once');
  assert.match(f.alerts[1].message,/\nCrossed 470 GB since/);
 }finally{await f.db.close();}
});

test('the test slot never speaks; two live servers tell once; an unreadable drive tells nothing',async()=>{
 const db=new PGlite();
 try{
  const staging=await fixture({live:false,db});staging.used=499;
  assert.deepEqual(await staging.alert.tick(),{skipped:'not the live server'});
  assert.equal(staging.alerts.length,0);
  assert.equal(staging.alert.status().running,false);

  const one=await fixture({db}),two=await fixture({db});one.used=two.used=490;
  await Promise.all([one.alert.tick(),two.alert.tick()]);
  assert.equal(one.alerts.length+two.alerts.length,1,'one telling between both servers');

  const blind=await fixture({db:new PGlite()});blind.used=null;
  assert.deepEqual(await blind.alert.tick(),{skipped:'unreadable'});
  assert.equal(blind.alerts.length,0);
  assert.equal(blind.alert.status().last.error,'The drive size could not be read.');
  await blind.db.close();
 }finally{await db.close();}
});

test('drive figures are read as df shows them',()=>{
 const GB=1024*1024*1024,bsize=4096,blocks=500*GB/bsize;
 assert.deepEqual(driveFigures({bsize,blocks,bfree:30*GB/bsize,bavail:30*GB/bsize}),{totalGb:500,usedGb:470,freeGb:30});
 assert.equal(driveFigures({bsize:0,blocks:0,bfree:0}),null);
 assert.equal(driveFigures(null),null);
});

test('A28 sits on the Automation tab, has its own switch and goes to the release approvers',()=>{
 const line=AUTOMATIONS.at(-1);
 assert.equal(line.code,'A28');assert.equal(line.key,'drive-space');
 assert.equal(automationForEventKey('drive-space:2026-11-24T06:00:anoop'),'drive-space','the ON/OFF switch stops it');
 const base={misTelegram:{enabled:true},pulseTelegram:{configured:true},pulseTelegramPurpose:()=>true,vlbAlerts:{pulseAdminLogins:[]},mismatch:{logins:[]},whatsappSettings:{},switches:{}};
 const row=automationRows({...base,driveSpace:{running:true,last:{totalGb:500,usedGb:452.3,freeGb:47.7}}}).at(-1);
 assert.equal(row.number,28);assert.equal(row.channels.telegram,'on');
 assert.equal(row.trigger,'Checked every 10 minutes on the live server; last reading 452.3 GB of 500 GB used, 47.7 GB free');
 const off=automationRows({...base,driveSpace:{running:false,last:null}}).at(-1);
 assert.equal(off.channels.telegram,'off');assert.match(off.notSendingReason,/not the live server/);
 // Owner, 24 Nov 2026: its own Telegram channel ("Azure limit increase warning"), one post per telling.
 assert.equal(CHANNEL_AUTOMATION_KEYS.has('drive-space'),true);
 assert.equal(row.channel.allowed,true);
 assert.equal(channelEventKey('drive-space:2026-11-24T06:00:anoop','anoop'),'channel:drive-space:2026-11-24T06:00');
 assert.equal(channelEventKey('drive-space:2026-11-24T06:00:mohitchadda','mohitchadda'),'channel:drive-space:2026-11-24T06:00','both people share one channel post');
 assert.equal(automationForEventKey(channelEventKey('drive-space:2026-11-24T06:00:anoop','anoop').slice(8)),'drive-space');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/createDriveSpaceAlert\(\{pool,live:isLiveSlot\(\),\s*alert:async\(message,key\)=>\{for\(const login of await releaseApproverLogins\(pool\)\)/);
 assert.match(server,/scheduleBackgroundStart\(\(\)=>driveSpaceAlert\.start\(\),120000\)/);
});
