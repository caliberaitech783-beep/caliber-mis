import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {letterRuleForAlias,deriveLetterRules,attachLetterRules,attachEquipmentAliases} from '../shared/equipment-alias-rules.mjs';
import {createEquipmentAlias,revokeEquipmentAlias,setAliasAllSites,loadLetterRules,withEquipmentAliases,registerEquipmentAliases} from '../shared/equipment-aliases.mjs';
import {matchCardMachine,scannedTripEquipmentRow,aliasMachineHint,resolvedByLetterRule} from '../shared/scan-machine-rules.mjs';

const sasti='Sasti OB',majri='Majri OB';
const aliasRow=(id,writtenKey,writtenText,record,extra={})=>({id,kind:'equipment',written_key:writtenKey,written_text:writtenText,equipment_id:record.id,record_data:record,...extra});

test('an alias teaches a letter rule only when the number stays and the letter changes',()=>{
 assert.deepEqual(letterRuleForAlias({written_key:'LPC21',door:'DEMO21-00179'}),{kind:'equipment',writtenCode:'LPC',targetPrefix:'DEMO'});
 assert.deepEqual(letterRuleForAlias({written_key:'LPC21',door:'DEMO021'}),{kind:'equipment',writtenCode:'LPC',targetPrefix:'DEMO'},'leading zeros do not matter');
 assert.equal(letterRuleForAlias({written_key:'LPC21',door:'DEMO35-00190'}),null,'a different number is a one-machine alias only');
 assert.equal(letterRuleForAlias({written_key:'LPC21',door:'LPC21'}),null);
 assert.equal(letterRuleForAlias({written_key:'LPC21',door:''}),null);
});

test('a rule learnt at Sasti resolves the same letter at Majri, and a real door always wins',()=>{
 const demo21={id:'1',door:'DEMO21-00179',category:'Equipment',currentLocation:sasti};
 const rules=deriveLetterRules([aliasRow('a1','LPC21','L21',demo21)]);
 assert.equal(rules.length,1);
 assert.equal(rules[0].id,'equipment:LPC:DEMO');
 assert.deepEqual(rules[0].sources[0],{aliasId:'a1',writtenText:'L21',equipmentId:'1',door:'DEMO21-00179',site:sasti});
 const fleet=[
  {...demo21,cardAliases:['L21']},
  {id:'2',door:'DEMO35-00190',category:'Equipment',currentLocation:majri},
  {id:'3',door:'DEMO40-00200',category:'Equipment',currentLocation:majri},
  {id:'4',door:'LPC40',category:'Equipment',currentLocation:majri},
  {id:'5',door:'DEMO35-00300',category:'Equipment',currentLocation:'Jayant OB',sourceMissing:true},
 ];
 const assets=attachLetterRules(fleet,rules);
 assert.deepEqual(assets[0].cardAliases,['L21'],'the source machine keeps only its own alias');
 assert.deepEqual(assets[1].cardAliases,['LPC35']);assert.deepEqual(assets[1].cardRuleAliases,['LPC35']);
 assert.equal(assets[2].cardAliases,undefined,'Majri already has a real LPC40, so DEMO40 is not given that label');
 assert.equal(assets[4].cardAliases,undefined,'records missing from Pulse are ignored');
 assert.equal(matchCardMachine(assets,'L35',majri,'equipment').match.id,'2');
 assert.equal(matchCardMachine(assets,'LPC 035',majri,'equipment').match.id,'2');
 assert.equal(matchCardMachine(assets,'L40',majri,'equipment').match.id,'4');
 assert.equal(matchCardMachine(assets,'L35',sasti,'equipment').status,'not-found','the rule only finds machines at the card site');
 const row=scannedTripEquipmentRow({equipmentName:'L35'},assets,majri,2);
 assert.equal(row.equipmentName,'DEMO35-00190');
 assert.deepEqual(row.equipmentNotation,{original:'L35',resolved:'DEMO35-00190',alias:true,letterRule:true});
 assert.match(aliasMachineHint(row),/Written: L35 · Identified: LPC · No. 35 · mapped by all-site letter rule/);
 const own=scannedTripEquipmentRow({equipmentName:'L21'},assets,sasti,2);
 assert.deepEqual(own.equipmentNotation,{original:'L21',resolved:'DEMO21-00179',alias:true});
 assert.match(aliasMachineHint(own),/mapped by saved alias/);
 assert.equal(resolvedByLetterRule(assets[1],'L35'),true);assert.equal(resolvedByLetterRule(assets[0],'L21'),false);
});

test('two rules for one written letter never guess between machines',()=>{
 const rules=deriveLetterRules([
  aliasRow('a1','LPC21','L21',{id:'1',door:'DEMO21',category:'Equipment',currentLocation:sasti}),
  aliasRow('a2','LPC7','L7',{id:'2',door:'U7',category:'Equipment',currentLocation:majri}),
 ]);
 assert.deepEqual(rules.map(r=>[r.writtenCode,r.targetPrefix,r.conflicts]),[['LPC','DEMO',['U']],['LPC','U',['DEMO']]]);
 const assets=attachLetterRules([{id:'8',door:'DEMO50',category:'Equipment',currentLocation:majri},{id:'9',door:'U50',category:'Equipment',currentLocation:majri}],rules);
 const result=matchCardMachine(assets,'L50',majri,'equipment');
 assert.equal(result.status,'ambiguous');assert.equal(result.match,null);
});

test('an explicit alias at the site beats a letter rule and vehicle rules stay with vehicles',()=>{
 const rules=deriveLetterRules([aliasRow('a1','LPC21','L21',{id:'1',door:'DEMO21',category:'Equipment',currentLocation:sasti})]);
 const fleet=attachEquipmentAliases([{id:'2',door:'DEMO35',category:'Equipment',currentLocation:majri},{id:'3',door:'VPC9',category:'Equipment',currentLocation:majri}],[{equipment_id:'3',written_text:'L35',status:'active'}]);
 const assets=attachLetterRules(fleet,rules);
 assert.equal(assets[0].cardAliases,undefined,'L35 is already the saved alias of VPC9 at Majri');
 assert.equal(matchCardMachine(assets,'L35',majri,'equipment').match.id,'3');
 const vehicles=attachLetterRules([{id:'7',door:'DEMO35',kind:'vehicle',currentLocation:majri}],rules);
 assert.equal(vehicles[0].cardAliases,undefined);
});

async function database(){
 const db=new PGlite();const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args);const pool={query};
 await db.query("CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT NOT NULL,record_data JSONB NOT NULL)");
 await db.query("CREATE TABLE mis_scan_cards(id TEXT PRIMARY KEY,status TEXT NOT NULL,raw_fields JSONB NOT NULL DEFAULT '{}')");
 await db.query("CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value JSONB NOT NULL,updated_at TIMESTAMPTZ)");
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1),('Equipment master',$2),('Equipment master',$3)",[
  {door:'DEMO21-00179',category:'Equipment',currentLocation:sasti},{door:'DEMO35-00190',category:'Equipment',currentLocation:majri},{door:'DEMO8-00111',category:'Equipment',currentLocation:'Jayant OB'}]);
 return {pool,db};
}
const fleetOf=async db=>(await db.query("SELECT id,record_data FROM master_records WHERE master_name='Equipment master' ORDER BY id")).rows.map(r=>({...r.record_data,id:String(r.id)}));

test('one approved mapping at Sasti is read by every site, follows a transfer, and stops with the alias',async()=>{
 const {pool,db}=await database();
 const pending=await createEquipmentAlias(pool,{equipmentId:'1',writtenText:'L21',site:sasti,book:'vlb',requestedBy:'reviewer',otp:true});
 assert.equal(pending.alias.status,'pending');
 assert.deepEqual(await loadLetterRules(pool),[],'a pending mapping teaches nothing yet');
 await revokeEquipmentAlias(pool,pending.alias.id,'admin');
 const {alias}=await createEquipmentAlias(pool,{equipmentId:'1',writtenText:'L21',site:sasti,book:'vlb',requestedBy:'reviewer',otp:false});
 const rules=await loadLetterRules(pool);
 assert.deepEqual(rules.map(r=>r.id),['equipment:LPC:DEMO']);
 let assets=await withEquipmentAliases(pool,await fleetOf(db));
 assert.equal(matchCardMachine(assets,'L35',majri,'equipment').match.id,'2','Majri reads the Sasti rule');
 assert.equal(matchCardMachine(assets,'L8','Jayant OB','equipment').match.id,'3','so does Jayant');
 assert.equal(matchCardMachine(assets,'L21',sasti,'equipment').match.id,'1');
 // The machine moves to Majri on the same record: its own alias goes with it.
 await db.query("UPDATE master_records SET record_data=record_data||'{\"currentLocation\":\"Majri OB\"}'::jsonb WHERE id=1");
 assets=await withEquipmentAliases(pool,await fleetOf(db));
 assert.equal(matchCardMachine(assets,'L21',majri,'equipment').match.id,'1');
 assert.equal(matchCardMachine(assets,'L21',sasti,'equipment').status,'not-found');
 // This machine only: the alias stays, the other sites stop using the letter rule.
 const limited=await setAliasAllSites(pool,alias.id,false,'admin','Only this DEMO is called L');
 assert.equal(limited.all_sites,false);assert.equal(limited.status,'active');
 assert.deepEqual(await loadLetterRules(pool),[]);
 assets=await withEquipmentAliases(pool,await fleetOf(db));
 assert.equal(matchCardMachine(assets,'L21',majri,'equipment').match.id,'1');
 assert.equal(matchCardMachine(assets,'L35',majri,'equipment').status,'not-found');
 await setAliasAllSites(pool,alias.id,true,'admin');
 assert.equal((await loadLetterRules(pool)).length,1);
 const history=(await db.query('SELECT action FROM mis_equipment_alias_history WHERE alias_id=$1 ORDER BY id',[alias.id])).rows.map(r=>r.action);
 assert.deepEqual(history,['created_active','all_sites_off','all_sites_on']);
 await revokeEquipmentAlias(pool,alias.id,'admin');
 assert.deepEqual(await loadLetterRules(pool),[],'revoking the mapping removes the rule at every site');
});

test('the alias API lists letter rules and only administrators limit them',async()=>{
 const {pool}=await database();
 const {alias}=await createEquipmentAlias(pool,{equipmentId:'1',writtenText:'L21',site:sasti,requestedBy:'reviewer',otp:false});
 const app=express();app.use(express.json());const audits=[];
 let admin=false;
 registerEquipmentAliases(app,{pool,protect:(req,res,next)=>{req.session={login:'mohit'};next();},requireAdministrator:(req,res,next)=>admin?next():res.status(403).json({error:'Administrators only.'}),audit:(req,entry)=>audits.push(entry.action),otpEnabled:()=>false,onChange:async()=>{}});
 const server=app.listen(0);const base='http://127.0.0.1:'+server.address().port;
 try{
  const listed=await (await fetch(base+'/api/equipment-aliases?all=1')).json();
  assert.deepEqual(listed.letterRules.map(r=>[r.writtenCode,r.targetPrefix]),[['LPC','DEMO']]);
  assert.equal(listed.aliases[0].allSites,true);
  assert.equal((await (await fetch(base+'/api/equipment-aliases/letter-rules')).json()).letterRules.length,1);
  const put=body=>fetch(base+'/api/equipment-aliases/'+alias.id+'/all-sites',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await put({allSites:false})).status,403);
  admin=true;
  const limited=await (await put({allSites:false})).json();
  assert.equal(limited.alias.allSites,false);assert.deepEqual(limited.letterRules,[]);
  assert.deepEqual(audits,['Equipment alias limited to its own machine']);
 }finally{server.close();}
});
