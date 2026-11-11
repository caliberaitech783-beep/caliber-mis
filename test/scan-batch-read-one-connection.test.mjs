import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The full scan-entry read runs several queries per card. Under load each pool.query waited in the
// pool queue separately (p95 98.7 s on 11 Nov 2026), so the whole read must use one connection.
test('the full scan batch read takes one connection for all its queries and always returns it',()=>{
  const source=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
  const handler=source.split('\n').find(line=>line.startsWith(" app.get('/api/scan-batches/:id',"));
  assert.ok(handler,'handler found');
  const afterProgress=handler.slice(handler.indexOf("return sendScanProgress(req,res,batch);"));
  assert.match(afterProgress,/^return sendScanProgress\(req,res,batch\);const db=await pool\.connect\(\);try\{/);
  assert.match(afterProgress,/\}finally\{db\.release\(\);\}\}\)\);\r?$/);
  assert.doesNotMatch(afterProgress.replace('const db=await pool.connect()',''),/\bpool\b/,'every query in the read uses the held connection');
});
