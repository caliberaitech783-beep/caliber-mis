import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fillVlbScanOpeningMeters} from '../server/rules/vlb-scan-opening-meters.mjs';

test('VLB opening meters follow the preceding saved vehicle card in operational order',async t=>{
 const db=new PGlite();
 t.after(()=>db.close());
 await db.exec(`CREATE TABLE mis_log_books(
  id serial PRIMARY KEY, book_type text, book_date date, asset_id bigint,
  site text, data jsonb, deleted_at timestamptz
 )`);
 const save=(date,shift,closingKmr,closingHmr,{asset=1,kind='vehicle',site='Sasti',deleted=false,trips}={})=>
  db.query('INSERT INTO mis_log_books(book_type,book_date,asset_id,site,data,deleted_at) VALUES($1,$2,$3,$4,$5,$6)',
   [kind,date,asset,site,JSON.stringify({bookShiftCode:shift,closingKmr,closingHmr,trips}),deleted?new Date():null]);
 await save('2026-11-09','S3',40,70);
 await save('2026-11-10','S1',44,0);
 await save('2026-11-10','S1',100,200,{deleted:true});
 await save('2026-11-10','S1',101,201,{kind:'lmv'});
 await save('2026-11-10','S1',102,202,{site:'Other'});
 await save('2026-11-10','S2',103,203);
 await save('2026-11-11','S1',104,204);
 await save('2026-11-09','S3',5,null,{asset:2});

 const input={assetId:'1',location:'Sasti',bookDate:'2026-11-10',cardShift:'II',
  openingKmr:'999',openingHmr:'',closingKmr:'50',meterReviewFields:['openingKmr','closingKmr']};
 const fill=(draft,extraction)=>fillVlbScanOpeningMeters(db,draft,{sites:['Sasti'],extraction});
 const draft=await fill(input,{openingKmr:'999'});
 assert.equal(draft.openingKmr,44);
 assert.equal(draft.openingHmr,0);
 assert.equal(draft.closingKmr,'50');
 assert.deepEqual(draft.meterReviewFields,['closingKmr']);
 assert.deepEqual(await fill(draft),draft);
 // A saved draft comes back from jsonb with its keys reordered. Reading it again
 // must return identical JSON; otherwise each batch read rewrites the card,
 // raises its revision and automatic saving is refused as "Card changed".
 const {rows:[{stored}]}=await db.query('SELECT $1::jsonb AS stored',[JSON.stringify(draft)]);
 assert.notEqual(JSON.stringify(stored),JSON.stringify(draft));
 assert.equal(JSON.stringify(await fill(stored)),JSON.stringify(stored));
 assert.equal((await fill({...draft,openingKmr:'45'})).openingKmr,'45');
 const relinked=await fill({...draft,assetId:'2'});
 assert.equal(relinked.openingKmr,5);
 assert.equal(relinked.openingHmr,'');
 assert.equal((await fill({...input,cardShift:'I',openingKmr:''})).openingKmr,40);
 assert.deepEqual(await fill({...input,assetId:'3'}),{...input,assetId:'3'});
 await save('2026-11-10','S2',46,1,{trips:[{loadingTime:'13:15',unloadingTime:'14:00'}]});
 await save('2026-11-10','S2',55,3,{trips:[{loadingTime:'17:00',unloadingTime:'17:45'}]});
 const sameShift=await fill({...input,openingKmr:'',trips:[{loadingTime:'14:10',unloadingTime:'14:45'}]});
 assert.equal(sameShift.openingKmr,46);
 assert.equal(sameShift.openingHmr,1);
});

test('scan openings survive unrelated meter history and recover from old carryover',async()=>{
 const extraction={openingKmr:'235465',openingHmr:'18660'};
 const card={assetId:'1',location:'Sasti',bookDate:'2026-11-08',cardShift:'I',shiftHours:8,
  ...extraction,closingKmr:'235568',closingHmr:'18666'};
 const history={openingKmr:7506.9,openingHmr:596};
 let lookups=0;
 const fill=(draft,previous=history)=>fillVlbScanOpeningMeters(null,draft,{extraction,readRows:async()=>{
  lookups++;
  return [{date:'2026-11-07',bookShiftCode:'S3',...previous}];
 }});
 assert.deepEqual(await fill(card),card);
 assert.equal(lookups,0);
 const oldDraft={...card,...history,openingMeterCarryover:{identity:'1|2026-11-08|S1|Sasti',values:history}};
 const restored=await fill(oldDraft);
 assert.equal(restored.openingHmr,'18660');
 assert.equal(restored.openingKmr,'235465');
 assert.deepEqual(await fill(restored),restored);
 assert.equal((await fill({...oldDraft,openingHmr:'18661'})).openingHmr,'18661');
 const missing={...card,openingHmr:'',openingKmr:''};
 assert.deepEqual(await fill(missing),missing);
 const fallback=await fill(missing,{openingKmr:235464,openingHmr:18659});
 assert.equal(fallback.openingKmr,235464);
 assert.equal(fallback.openingHmr,18659);
});
