import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {aliasForSelection,aliasNumberMatches,aliasNumberNote} from '../shared/equipment-alias-rules.mjs';
import {createEquipmentAlias,ensureEquipmentAliases,loadEquipmentAliases,numberMismatchAliases,revokeNumberMismatchAliases,registerEquipmentAliases,NUMBER_MISMATCH_REVOKE_REASON} from '../shared/equipment-aliases.mjs';
import {misRequestAllowed} from '../shared/mis-application-access.mjs';

// Rule of 23 Nov 2026. On live, 914 of 964 saved mappings changed the machine number
// (T658 -> TPC65, T52 -> TPC57): corrected readings kept as permanent rules. A mapping is now
// saved only when the written number is the machine's own number.
const site='Jayant OB';
const demo={id:'1',door:'DEMO21-00179',kind:'equipment',site};
const tpc65={id:'2',door:'TPC65 - 05018',kind:'equipment',site};
const tpc9={id:'3',door:'TPC9 - 01084',kind:'equipment',site};
const dashDoor={id:'4',door:'VPC-123',kind:'equipment',site};
const tipper={id:'5',door:'V995',kind:'vehicle',site};

test('another name for the same number is a mapping; a different number is not',()=>{
 assert.equal(aliasNumberMatches('L21',demo),true,'card L21, Pulse DEMO21: same number');
 assert.equal(aliasNumberMatches('T658',tpc65),false,'658 is not 65');
 assert.equal(aliasNumberMatches('T52',{door:'TPC57- 05023'}),false,'one digit different');
 assert.equal(aliasNumberMatches('V09',tpc9),true,'leading zeros are the same number');
 assert.equal(aliasNumberMatches('T123',dashDoor),true,'a dash after the letters is not part of the number');
 assert.equal(aliasNumberMatches('Y/995',tipper,'vehicle'),true,'tipper door: other letter, same number');
 assert.equal(aliasNumberMatches('5/36',{door:'V503-94988'},'vehicle'),false);
 assert.equal(aliasNumberMatches('L21',null),false);
 assert.equal(aliasNumberMatches('L',demo),false,'no number written');
});

test('a machine Pulse knows only by registration has no number to contradict',()=>{
 const byRegistration={id:'9',registration:'MH34CD4480',equipmentName:'Hydra crane',category:'Equipment'};
 assert.equal(aliasNumberMatches('H7',byRegistration),true);
 assert.deepEqual(aliasForSelection('H7',byRegistration),{equipmentId:'9',kind:'equipment',writtenText:'H7',writtenKey:'H7'});
});

test('a dropdown choice with a different number teaches nothing and says why',()=>{
 assert.deepEqual(aliasForSelection('L21',demo),{equipmentId:'1',kind:'equipment',writtenText:'L21',writtenKey:'LPC21'});
 assert.equal(aliasForSelection('T658',tpc65),null);
 assert.equal(aliasNumberNote('L21',demo),'');
 assert.equal(aliasNumberNote('',tpc65),'');
 assert.equal(aliasNumberNote('T658',tpc65),'Applied here only, not saved as a permanent mapping: the card says T658 (number 658) and TPC65 - 05018 is number 65. A mapping is saved only when the number is the same.');
});

async function database(){
 const db=new PGlite();const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 await db.exec(`CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT NOT NULL,record_data JSONB NOT NULL);
  CREATE TABLE pulse_master_links(master_name TEXT NOT NULL,source_id TEXT NOT NULL,local_id BIGINT NOT NULL,PRIMARY KEY(master_name,source_id));
  CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL,updated_at TIMESTAMPTZ);
  CREATE TABLE mis_telegram_links(login_name TEXT PRIMARY KEY,chat_id TEXT NOT NULL);
  CREATE TABLE mis_scan_cards(id TEXT PRIMARY KEY,status TEXT NOT NULL,raw_fields JSONB NOT NULL DEFAULT '{}');`);
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1),('Equipment master',$2),('Equipment master',$3)",[{door:'DEMO21-00179',category:'Equipment',currentLocation:site},{door:'TPC65 - 05018',category:'Equipment',currentLocation:site},{door:'TPC57- 05023',category:'Equipment',currentLocation:site}]);
 return {db,pool};
}
// A mapping as it was saved before the rule, straight into the table.
const legacy=(db,id,equipmentId,key,written)=>db.query("INSERT INTO mis_equipment_aliases(id,equipment_id,kind,written_key,written_text,status,site,requested_by,approval_route) VALUES($1,$2,'equipment',$3,$4,'active',$5,'reviewer1','reviewer')",[id,equipmentId,key,written,site]);

test('the server never saves a pair whose number differs, with the OTP rule off or on',async t=>{
 const {db,pool}=await database();t.after(()=>db.close());
 assert.deepEqual(await createEquipmentAlias(pool,{equipmentId:'2',writtenText:'T658',site,requestedBy:'mohit',otp:false}),{alias:null,numberDiffers:true});
 assert.deepEqual(await createEquipmentAlias(pool,{equipmentId:'3',writtenText:'T52',site,requestedBy:'mohit',otp:true}),{alias:null,numberDiffers:true});
 assert.equal((await db.query('SELECT count(*)::int AS n FROM mis_equipment_aliases')).rows[0].n,0);
 const saved=await createEquipmentAlias(pool,{equipmentId:'1',writtenText:'L21',site,requestedBy:'mohit',otp:false});
 assert.equal(saved.created,true);assert.equal(saved.alias.status,'active');
 // A label that is another machine's real door is still refused out loud, whatever its number.
 await assert.rejects(createEquipmentAlias(pool,{equipmentId:'1',writtenText:'T65',site,requestedBy:'mohit',otp:false}),/already a real door/);
});

test('mappings saved earlier with a different number are listed, then removed in one action, and only those',async t=>{
 const {db,pool}=await database();t.after(()=>db.close());
 const keep=(await createEquipmentAlias(pool,{equipmentId:'1',writtenText:'L21',site,requestedBy:'mohit',otp:false})).alias;
 await legacy(db,'11111111-1111-4111-8111-111111111111',2,'TPC658','T658');
 await legacy(db,'22222222-2222-4222-8222-222222222222',2,'TPC6510','T6510');
 await legacy(db,'33333333-3333-4333-8333-333333333333',3,'TPC52','T52');
 await db.query("UPDATE mis_equipment_aliases SET status='suspended' WHERE id='33333333-3333-4333-8333-333333333333'");
 await legacy(db,'44444444-4444-4444-8444-444444444444',2,'TPC659','T659');
 await db.query("UPDATE mis_equipment_aliases SET status='revoked' WHERE id='44444444-4444-4444-8444-444444444444'");
 const listed=await numberMismatchAliases(pool);
 assert.deepEqual(listed.map(row=>[row.written_text,row.equipment_door,row.status]).sort(),[['T52','TPC57- 05023','suspended'],['T6510','TPC65 - 05018','active'],['T658','TPC65 - 05018','active']]);
 assert.equal(listed[0].equipment_site,site);
 await assert.rejects(revokeNumberMismatchAliases(pool,'mohit',{expected:2}),error=>error.status===409&&/list has changed: 3 mapping/.test(error.message));
 assert.equal((await numberMismatchAliases(pool)).length,3,'a refused removal changes nothing');
 const removed=await revokeNumberMismatchAliases(pool,'MOHIT',{expected:3});
 assert.equal(removed.length,3);assert.ok(removed.every(row=>row.status==='revoked'&&row.revoked_by==='mohit'&&row.revoke_reason===NUMBER_MISMATCH_REVOKE_REASON));
 assert.deepEqual((await loadEquipmentAliases(pool)).map(row=>row.id),[keep.id],'the same-number mapping still works');
 const history=(await db.query("SELECT alias_id,action,actor,detail FROM mis_equipment_alias_history WHERE action='revoked' ORDER BY alias_id")).rows;
 assert.equal(history.length,3);assert.equal(history[0].actor,'mohit');assert.equal(history[0].detail.reason,NUMBER_MISMATCH_REVOKE_REASON);
 assert.deepEqual(await numberMismatchAliases(pool),[]);assert.deepEqual(await revokeNumberMismatchAliases(pool,'mohit',{expected:0}),[]);
});

test('the routes: a reviewer pair with a different number answers numberDiffers; an administrator lists and removes the old ones',async t=>{
 const {db,pool}=await database();t.after(()=>db.close());
 await ensureEquipmentAliases(pool);
 await legacy(db,'11111111-1111-4111-8111-111111111111',2,'TPC658','T658');
 const audits=[];let changed=0,otp=false,administrator=true;
 const app=express();app.use(express.json());
 registerEquipmentAliases(app,{pool,protect:(req,res,next)=>{req.session={login:'mohit'};next();},requireAdministrator:(req,res,next)=>administrator?next():res.status(403).json({error:'Administrators only.'}),audit:(req,entry)=>audits.push(entry),onChange:async()=>{changed++},otpEnabled:()=>otp});
 const server=app.listen(0);t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
 const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const pair=await post('/api/equipment-aliases',{equipmentId:'3',kind:'equipment',writtenText:'T52',site,book:'vlb'});
 assert.equal(pair.status,200);assert.deepEqual(await pair.json(),{alias:null,created:false,redundant:false,numberDiffers:true,otpRequired:false});
 assert.deepEqual(audits,[],'nothing was saved, so nothing is audited');
 administrator=false;
 assert.equal((await fetch(base+'/api/equipment-aliases/number-mismatch')).status,403);
 assert.equal((await post('/api/equipment-aliases/number-mismatch/revoke',{expected:1})).status,403);
 administrator=true;
 const list=await (await fetch(base+'/api/equipment-aliases/number-mismatch')).json();
 assert.equal(list.count,1);assert.equal(list.aliases[0].writtenText,'T658');assert.equal(list.aliases[0].equipmentDoor,'TPC65 - 05018');
 otp=true;
 assert.equal((await post('/api/equipment-aliases/number-mismatch/revoke',{expected:1})).status,409,'with the OTP rule on a mapping is revoked by OTP');
 otp=false;
 assert.equal((await post('/api/equipment-aliases/number-mismatch/revoke',{expected:5})).status,409,'the count seen must be the count removed');
 const done=await post('/api/equipment-aliases/number-mismatch/revoke',{expected:1});
 assert.equal(done.status,200);assert.deepEqual(await done.json(),{revoked:1});
 assert.equal(changed,1,'held cards are rechecked once');
 assert.equal(audits.length,1);assert.equal(audits[0].action,'Equipment aliases with a different number removed');assert.equal(audits[0].details.count,1);
 assert.equal((await (await fetch(base+'/api/equipment-aliases/number-mismatch')).json()).count,0);
});

test('only an MIS administrator reaches the list and the removal',()=>{
 const user=pages=>({permissions:{separateMisCredentials:true,misDesktopAccess:pages}});
 const admin=pages=>({role:'super',permissions:{separateMisCredentials:true,misDesktopAccess:[...pages,'Users & employees']}});
 const list={path:'/api/equipment-aliases/number-mismatch',method:'GET'},remove={path:'/api/equipment-aliases/number-mismatch/revoke',method:'POST'};
 for(const pages of [['Trip Card Bulk Scan'],['Equipment master'],['Vehicle Log Book']]){
  assert.equal(misRequestAllowed(user(pages),list),false,pages[0]);
  assert.equal(misRequestAllowed(user(pages),remove),false,pages[0]);
 }
 assert.equal(misRequestAllowed(admin(['Equipment master']),list),true);
 assert.equal(misRequestAllowed(admin(['Equipment master']),remove),true);
 assert.equal(misRequestAllowed(admin(['Equipment master']),{...remove,method:'GET'}),false);
 assert.equal(misRequestAllowed(admin(['Reports']),remove),false,'an administrator without a scan, log book or Equipment master menu');
});

// Found on live after PR 484 (23 Nov 2026): on 303 of 1,804 Equipment master records Pulse repeats
// the door in the registration field. PR 484 took such a door for a registration, so the rule
// did not hold on those machines and 127 of the 914 mappings were missing from the cleanup list.
const repeated={id:'24313',door:'VPC150-86636',equipmentName:'VPC150-86636',reg:'VPC150-86636',chassisNo:'VCEC480DA00286636',kind:'equipment',site};
test('a door that Pulse repeats in the registration field is still the machine\'s door',()=>{
 assert.equal(aliasNumberMatches('S277',repeated),false,'277 is not 150');
 assert.equal(aliasNumberMatches('V105',repeated),false);
 assert.equal(aliasNumberMatches('T150',repeated),true,'another letter, the same number');
 assert.equal(aliasForSelection('S277',repeated),null);
 assert.deepEqual(aliasForSelection('T150',repeated),{equipmentId:'24313',kind:'equipment',writtenText:'T150',writtenKey:'TPC150'});
 assert.match(aliasNumberNote('S277',repeated),/the card says S277 \(number 277\) and VPC150-86636 is number 150/);
 const spaced={id:'1869',door:'TPC15 - 01046',equipmentName:'TPC15 - 01046',reg:'TPC15 - 01046'};
 assert.equal(aliasNumberMatches('T45',spaced),false);assert.equal(aliasNumberMatches('T99',spaced),false);assert.equal(aliasNumberMatches('V15',spaced),true);
 const tipper={id:'77',door:'M2-MH34BZ 5062',reg:'M2-MH34BZ 5062',kind:'vehicle'};
 assert.equal(aliasNumberMatches('M5',tipper,'vehicle'),false,'the fleet door is M2, whatever follows it');
});

test('a machine known only by a road registration has no fleet number, in any field',()=>{
 for(const record of [{id:'5',door:'MH34BZ8707',reg:'MH34BZ8707'},{id:'6',door:'UP64AT9857',registration:'UP64AT9857'},{id:'7',reg:'UP64CT4878',equipmentName:'Water tanker'}]){
  assert.equal(aliasNumberMatches('E105',record,'vehicle'),true,JSON.stringify(record));
  assert.equal(aliasNumberNote('E105',record,'vehicle'),'');
 }
});

test('the server applies the rule to a door repeated in the registration field: refused when new, listed when old',async t=>{
 const {db,pool}=await database();t.after(()=>db.close());
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1),('Equipment master',$2)",[{door:'VPC150-86636',equipmentName:'VPC150-86636',reg:'VPC150-86636',category:'Equipment',currentLocation:site},{door:'MH34BZ8707',reg:'MH34BZ8707',category:'Equipment',currentLocation:site}]);
 assert.deepEqual(await createEquipmentAlias(pool,{equipmentId:'4',writtenText:'S277',site,requestedBy:'mohit',otp:false}),{alias:null,numberDiffers:true});
 assert.equal((await createEquipmentAlias(pool,{equipmentId:'4',writtenText:'T150',site,requestedBy:'mohit',otp:false})).alias.status,'active');
 assert.equal((await createEquipmentAlias(pool,{equipmentId:'5',writtenText:'L9',site,requestedBy:'mohit',otp:false})).alias.status,'active','a road registration has no number to contradict');
 await legacy(db,'55555555-5555-4555-8555-555555555555',4,'SPC277','S277');
 await legacy(db,'66666666-6666-4666-8666-666666666666',4,'VPC105','V105');
 assert.deepEqual((await numberMismatchAliases(pool)).map(row=>[row.written_text,row.equipment_door]).sort(),[['S277','VPC150-86636'],['V105','VPC150-86636']]);
 assert.equal((await revokeNumberMismatchAliases(pool,'mohit',{expected:2})).length,2);
 assert.deepEqual((await loadEquipmentAliases(pool)).map(row=>row.written_text).sort(),['L9','T150']);
});
