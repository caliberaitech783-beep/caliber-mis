import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {allowedScanBatches,requireLogBookSite,logBookSiteScope} from '../log-book-access.mjs';
const previousRule=async(client,_scope,login)=>(await client.query("SELECT b.id FROM mis_scan_batches b LEFT JOIN mis_scan_cards c ON c.batch_id=b.id GROUP BY b.id HAVING b.created_by=$1 AND bool_and(COALESCE(c.status,'queued')<>'posted')",[login])).rows.map(row=>row.id);

test('owner access survives partial posting without weakening site restrictions',async t=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE TABLE mis_scan_batches(id TEXT PRIMARY KEY,created_by TEXT NOT NULL);CREATE TABLE mis_scan_cards(id SERIAL PRIMARY KEY,batch_id TEXT,status TEXT,draft JSONB)');
  const scope=logBookSiteScope({role:'normal',site:'Majri OC'});
  const add=async(id,owner,cards)=>{await db.query('INSERT INTO mis_scan_batches VALUES($1,$2)',[id,owner]);for(const card of cards)await db.query('INSERT INTO mis_scan_cards(batch_id,status,draft) VALUES($1,$2,$3)',[id,card.status,JSON.stringify(card.draft||{})])};
  await add('affected','owner',[...Array.from({length:21},()=>({status:'posted',draft:{location:'Dudhichua East OC'}})),...Array.from({length:48},()=>({status:'queued'}))]);
  await add('empty','owner',[]);
  await add('in-scope','other',[{status:'posted',draft:{location:'Majri OB'}}]);
  await add('completed-outside','owner',[{status:'posted',draft:{location:'Dudhichua East OC'}}]);
  await add('mixed-other','other',[{status:'posted',draft:{location:'Majri OC'}},{status:'reading'}]);
  await add('all-in-scope','owner',[{status:'posted',draft:{location:'Majri OC'}}]);
  await t.test('reproduces the exact 21 posted / 48 unfinished failure in the old rule',async()=>{assert.equal((await previousRule(db,scope,'owner')).includes('affected'),false);assert.equal((await allowedScanBatches(db,scope,'owner')).includes('affected'),true)});
  await t.test('owner retains access through every intermediate card-save transition',async()=>{
   for(let posted=22;posted<69;posted++){await db.query("UPDATE mis_scan_cards SET status='posted',draft=$1 WHERE batch_id='affected' AND id=(SELECT min(id) FROM mis_scan_cards WHERE batch_id='affected' AND status<>'posted')",[JSON.stringify({location:'Dudhichua East OC'})]);assert.equal((await allowedScanBatches(db,scope,'owner')).includes('affected'),true,'lost access after '+posted+' saved cards')}
  });
  await t.test('completed out-of-scope batches no longer use the unfinished-owner exception',async()=>{await db.query("UPDATE mis_scan_cards SET status='posted',draft=$1 WHERE batch_id='affected'",[JSON.stringify({location:'Dudhichua East OC'})]);assert.equal((await allowedScanBatches(db,scope,'owner')).includes('affected'),false);assert.equal((await allowedScanBatches(db,scope,'owner')).includes('completed-outside'),false)});
  await t.test('empty batches and fully in-scope completed batches remain accessible',async()=>{const ids=await allowedScanBatches(db,scope,'owner');for(const id of ['empty','in-scope','all-in-scope'])assert.equal(ids.includes(id),true,id)});
  await t.test('a different user cannot inherit owner access to incomplete mixed-site cards',async()=>{assert.equal((await allowedScanBatches(db,scope,'viewer')).includes('mixed-other'),false);assert.equal((await allowedScanBatches(db,scope,'viewer')).includes('empty'),false)});
  await t.test('card saving still rejects locations outside the assigned sites',()=>{assert.throws(()=>requireLogBookSite(scope,'Dudhichua East OC'),{status:403});assert.doesNotThrow(()=>requireLogBookSite(scope,'Majri OB'))});
  await t.test('unassigned users remain blocked and all-sites users keep their normal scope',async()=>{assert.deepEqual(await allowedScanBatches(db,{sites:[]},'owner'),[]);assert.equal(await allowedScanBatches(db,{sites:null},'owner'),null)});
 }finally{await db.close()}
});
