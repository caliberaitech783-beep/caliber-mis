import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

test('scanner can find a selected batch entry behind newer dates and a full same-date page',async()=>{
 const route=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 const sql=route.match(/Invalid batch history date[^\n]+pool\.query\(`([^`]+)`/)[1]
  .replace("${operationalScanSql('c')}",'TRUE');
 const ui=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 const load=new Function('api','vlbBatch','lmv','kind','sameVlbEntryContext','scanEntryHeading','setBatches',
  'return '+ui.slice(ui.indexOf('const list=async()=>')+11,ui.indexOf(';setBatches(rows);return rows}')+';setBatches(rows);return rows}'.length));
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE mis_scan_batches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,kind text,expected_context jsonb,created_at timestamptz);
   CREATE TABLE mis_scan_cards(id uuid,batch_id uuid,review_note text,duplicate_of uuid,status text);
   INSERT INTO mis_scan_batches(name,kind,expected_context,created_at)
   SELECT 'newer','vehicle','{"bookDate":"2026-11-19"}'::jsonb,'2026-11-19'::timestamptz FROM generate_series(1,101)
   UNION ALL SELECT 'other shift','vehicle','{"bookDate":"2026-11-03"}'::jsonb,'2026-11-12' FROM generate_series(1,100)
   UNION ALL SELECT 'B10','vehicle','{"bookDate":"2026-11-03","cardShift":"S3"}'::jsonb,'2026-11-11'`);
  const calls=[];
  const api=async path=>{
   const params=new URL(path,'https://example.test').searchParams;
   calls.push(Object.fromEntries(params));
   const {rows}=await db.query(sql,[['vehicle'],null,Number(params.get('offset')),false,params.get('bookDate')]);
   return {batches:rows.map(row=>({...row,trip_total:0})),nextOffset:rows.length===100?100:null};
  };
  const entries=await load(api,{report_date:'2026-11-03'},false,'vehicle',(_,context)=>context.cardShift==='S3',
   entry=>({text:entry.name}),()=>{})();
  assert.deepEqual(entries.map(entry=>entry.name),['B10']);
  assert.deepEqual(calls,[{bookDate:'2026-11-03',offset:'0'},{bookDate:'2026-11-03',offset:'100'}]);
 }finally{await db.close();}
});
