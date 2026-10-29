import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {recoverMalformedScanCards} from '../scan-parser-recovery.mjs';

test('deployment never requeues or modifies existing cards, including format failures',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec("CREATE TABLE mis_scan_cards(id TEXT PRIMARY KEY,status TEXT,checked_by TEXT,logbook_id INTEGER,error TEXT,revision INTEGER,draft JSONB,raw_fields JSONB)");
 const insert=async(id,status='error',error='Invalid Priority A field: employeeName',checked=null,logbook=null)=>{
  await db.query('INSERT INTO mis_scan_cards VALUES($1,$2,$3,$4,$5,7,$6,$7)',[id,status,checked,logbook,error,JSON.stringify({remark:'Keep my manual note',doorText:'V/833'}),JSON.stringify({extractionDraft:{}})]);
 };
 await insert('recover');await insert('name-not-only','error','Invalid Priority A field: openingKmr');
 await insert('review','review');await insert('posted','posted','Invalid Priority A field: employeeName',null,9);
 await insert('rejected','rejected');await insert('checked','error','Invalid Priority A field: employeeName','admin');
 await insert('linked','error','Invalid Priority A field: employeeName',null,10);await insert('network','error','Gemini extraction failed (HTTP 429)');
 const before=(await db.query('SELECT * FROM mis_scan_cards ORDER BY id')).rows;const result=await recoverMalformedScanCards(db);assert.deepEqual(result.rows,[]);assert.equal(result.skipped,true);
 const rows=(await db.query('SELECT * FROM mis_scan_cards ORDER BY id')).rows;
 const recovered=rows.find(row=>row.id==='recover');
 assert.equal(recovered.status,'error');assert.equal(recovered.revision,7);assert.equal(recovered.error,'Invalid Priority A field: employeeName');assert.deepEqual(rows,before);
 assert.equal(recovered.raw_fields.reextractPrevious,undefined);
 assert.equal(recovered.draft.remark,'Keep my manual note');
 for(const id of ['review','posted','rejected','checked','linked','network'])assert.equal(rows.find(row=>row.id===id).revision,7,id);
 assert.equal((await recoverMalformedScanCards(db)).rows.length,0);
});
