import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {aliasForSelection,attachEquipmentAliases,aliasWrittenKey} from '../equipment-alias-rules.mjs';
import {createEquipmentAlias,revokeEquipmentAlias,loadEquipmentAliases,registerEquipmentAliases,withEquipmentAliases} from '../equipment-aliases.mjs';
import {matchCardMachine,scannedTripEquipmentRow,scanEquipmentMatchIssues,selectTripEquipment,tripEquipmentSelectionValue,resolvedByAlias,aliasMachineHint} from '../scan-machine-rules.mjs';
import {resolveTripEquipment,validateTripEquipment} from '../trip-equipment-validation.mjs';
import {scanFleetIssues} from '../scan-fleet-assignment.mjs';

const site='Dudhichua East OB';
const demo={id:'179',door:'DEMO21-00179',name:'DEMO21-00179',kind:'equipment',site};
const vpc={id:'131',door:'VPC131-00123',name:'VPC131',kind:'equipment',site};
const aliasRows=[{equipment_id:179,source_id:'p-179',kind:'equipment',written_text:'L21',written_key:'LPC21',status:'active'}];

test('a dropdown choice for an unmatched written machine becomes an alias; matching labels do not',()=>{
 const chosen=selectTripEquipment({equipmentName:'LPC21',equipmentNotation:{original:'L21',resolved:'LPC21'}},'179',[demo,vpc],site);
 assert.deepEqual(aliasForSelection(chosen.originalEquipmentName,demo),{equipmentId:'179',kind:'equipment',writtenText:'L21',writtenKey:'LPC21'});
 assert.equal(aliasForSelection('V131',vpc),null,'a real door needs no alias');
 assert.equal(aliasForSelection('L',demo),null,'no number, no alias');
 assert.equal(aliasForSelection('21',demo),null,'no prefix, no alias');
 assert.equal(aliasForSelection('L21',{...demo,cardAliases:['L21']}),null,'already known');
 assert.equal(aliasWrittenKey('l / 021'),'LPC21');
});

test('an alias on the asset resolves written text everywhere a real door would',()=>{
 const assets=attachEquipmentAliases([demo,vpc],aliasRows);
 assert.deepEqual(assets[0].cardAliases,['L21']);assert.equal(assets[1].cardAliases,undefined);
 assert.equal(matchCardMachine(assets,'L21',site,'equipment').match.id,'179');
 assert.equal(matchCardMachine(assets,'LPC 21',site,'equipment').match.id,'179');
 assert.equal(matchCardMachine(assets,'Haulpak 21',site,'equipment').match.id,'179');
 assert.equal(matchCardMachine(assets,'L21','Jayant OC','equipment').status,'not-found','the alias follows the asset to its current site only');
 assert.equal(resolvedByAlias(assets[0],'L21'),true);
 assert.equal(resolvedByAlias(assets[0],'DEMO21-00179'),false);
 const row=scannedTripEquipmentRow({equipmentName:'L21'},assets,site,2);
 assert.equal(row.equipmentName,'DEMO21-00179');
 assert.deepEqual(row.equipmentNotation,{original:'L21',resolved:'DEMO21-00179',alias:true});
 assert.match(aliasMachineHint(row),/Written: L21 · Identified: LPC · No. 21 · mapped by saved alias/);
 assert.equal(aliasMachineHint(scannedTripEquipmentRow({equipmentName:'V131'},assets,site,2)),'');
 const draft={location:site,machineNotationRuleVersion:1,tripBodyRuleVersion:2,trips:[{equipmentName:'L21',tripCount:2}],scanMachineSummary:[{equipmentName:'L21',tripCount:2}]};
 assert.deepEqual(scanEquipmentMatchIssues(draft,assets),{});
 assert.equal(Object.keys(scanEquipmentMatchIssues(draft,[demo,vpc])).length,2,'without the alias both rows are review issues');
 assert.equal(resolveTripEquipment({equipmentName:'L21'},assets,site).equipmentId,'179');
 assert.equal(resolveTripEquipment({equipmentName:'L21'},assets,site).equipmentName,'DEMO21-00179','display stays the real master label');
 assert.deepEqual(validateTripEquipment(draft,assets).issues,{});
 assert.deepEqual(draft.trips.map(r=>tripEquipmentSelectionValue(r,assets,site,2)),['179']);
});

test('the Pulse fleet hold accepts an alias on the Pulse record in both notations',()=>{
 const fleet=attachEquipmentAliases([{id:'p-179',door:'DEMO21-00179',currentLocation:site},{id:'p-131',door:'VPC131-00123',currentLocation:site},{id:'p-v131',door:'V131',currentLocation:site}],aliasRows,{by:'source'});
 assert.deepEqual(scanFleetIssues(fleet,{doorText:'V 131',location:site,trips:[{equipmentName:'L21'},{equipmentName:'LPC21'}]}),[]);
 const held=scanFleetIssues([{id:'p-179',door:'DEMO21-00179',currentLocation:site},{id:'p-131',door:'VPC131-00123',currentLocation:site},{id:'p-v131',door:'V131',currentLocation:site}],{doorText:'V 131',location:site,trips:[{equipmentName:'LPC21'}]});
 assert.equal(held.length,1);assert.equal(held[0].pulseSite,'Not registered');
});

async function database(){
 const db=new PGlite();const query=(sql,args)=>!args&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args);const pool={query};
 await db.query("CREATE TABLE master_records(id BIGSERIAL PRIMARY KEY,master_name TEXT NOT NULL,record_data JSONB NOT NULL)");
 await db.query("CREATE TABLE pulse_master_links(master_name TEXT NOT NULL,source_id TEXT NOT NULL,local_id BIGINT NOT NULL,PRIMARY KEY(master_name,source_id))");
 await db.query("CREATE TABLE mis_scan_cards(id TEXT PRIMARY KEY,status TEXT NOT NULL,raw_fields JSONB NOT NULL DEFAULT '{}')");
 await db.query("INSERT INTO master_records(master_name,record_data) VALUES('Equipment master',$1),('Equipment master',$2),('Equipment master',$3)",[{door:'DEMO21-00179',category:'Equipment',currentLocation:site},{door:'VPC131-00123',category:'Equipment',currentLocation:site},{door:'LPC 21',category:'Equipment',currentLocation:'Jayant OC'}]);
 await db.query("INSERT INTO pulse_master_links VALUES('Equipment master','p-179',1),('Equipment master','p-131',2)");
 await db.query("INSERT INTO mis_scan_cards VALUES('held','review',$1),('clean','review',$2)",[{fleetReview:{issues:[{door:'LPC21'}],signature:'s'}},{fleetReview:{issues:[],signature:'s'}}]);
 return pool;
}

test('aliases persist, attach to local and Pulse ids, refuse to shadow a real door, and can be revoked',async()=>{
 const db=await database();
 const first=await createEquipmentAlias(db,{equipmentId:'1',writtenText:' l 21 ',site,book:'vlb',requestedBy:'mohit'});
 assert.equal(first.created,true);assert.equal(first.alias.written_key,'LPC21');assert.equal(first.alias.written_text,'l 21');
 const again=await createEquipmentAlias(db,{equipmentId:'1',writtenText:'L21',requestedBy:'mohit'});
 assert.equal(again.created,false);assert.equal(again.alias.id,first.alias.id);
 assert.deepEqual(await createEquipmentAlias(db,{equipmentId:'2',writtenText:'V131',requestedBy:'mohit'}),{alias:null,redundant:true});
 await assert.rejects(createEquipmentAlias(db,{equipmentId:'1',writtenText:'V131',requestedBy:'mohit'}),/already a real door/);
 await assert.rejects(createEquipmentAlias(db,{equipmentId:'1',writtenText:'L',requestedBy:'mohit'}),/machine number/);
 await assert.rejects(createEquipmentAlias(db,{equipmentId:'99',writtenText:'L21',requestedBy:'mohit'}),/no longer in the Equipment master/);
 const local=await withEquipmentAliases(db,[{id:'1',door:'DEMO21-00179'},{id:'2',door:'VPC131-00123'}]);
 assert.deepEqual(local.map(r=>r.cardAliases),[['l 21'],undefined]);
 const fleet=await withEquipmentAliases(db,[{id:'p-179',door:'DEMO21-00179'},{id:'1',door:'other'}],{by:'source'});
 assert.deepEqual(fleet.map(r=>r.cardAliases),[['l 21'],undefined]);
 await revokeEquipmentAlias(db,first.alias.id,'admin');
 assert.deepEqual(await loadEquipmentAliases(db),[]);
 await assert.rejects(revokeEquipmentAlias(db,first.alias.id,'admin'),/already revoked/);
});

test('the alias API saves on a reviewer session, requeues held cards and lists active aliases',async()=>{
 const db=await database();
 const app=express();app.use(express.json());
 const audits=[];
 registerEquipmentAliases(app,{pool:db,protect:(req,res,next)=>{req.session={login:'mohit'};next();},audit:(req,entry)=>audits.push(entry.action)});
 const server=app.listen(0);const base='http://127.0.0.1:'+server.address().port;
 try{
  const created=await fetch(base+'/api/equipment-aliases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipmentId:'1',kind:'equipment',writtenText:'L21',site,book:'vlb',batchId:'b1'})});
  assert.equal(created.status,201);const body=await created.json();assert.equal(body.alias.writtenKey,'LPC21');assert.equal(body.alias.requestedBy,'mohit');
  assert.deepEqual(audits,['Equipment alias created']);
  const cards=(await db.query("SELECT id,raw_fields FROM mis_scan_cards ORDER BY id")).rows;
  assert.equal(cards.find(c=>c.id==='held').raw_fields.fleetReview,undefined,'held card re-runs its fleet check');
  assert.ok(cards.find(c=>c.id==='clean').raw_fields.fleetReview,'cards without issues keep their verified check');
  const listed=await (await fetch(base+'/api/equipment-aliases')).json();
  assert.equal(listed.aliases.length,1);assert.equal(listed.aliases[0].equipmentId,'1');
  const shadow=await fetch(base+'/api/equipment-aliases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipmentId:'1',writtenText:'V131'})});
  assert.equal(shadow.status,409);
  const removed=await fetch(base+'/api/equipment-aliases/'+body.alias.id,{method:'DELETE'});
  assert.equal(removed.status,200);assert.equal((await (await fetch(base+'/api/equipment-aliases')).json()).aliases.length,0);
 }finally{server.close();}
});
