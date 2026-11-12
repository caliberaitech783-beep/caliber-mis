import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Under load each pool.query of the full scan-entry read waited in the pool queue separately
// (p95 98.7 s on 11 Nov 2026), so the whole read must use one connection.
test('the full scan batch read takes one connection for all its queries and always returns it',()=>{
  const source=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
  const lines=source.split(/\r?\n/),start=lines.findIndex(line=>line.startsWith(" app.get('/api/scan-batches/:id',"));
  assert.ok(start>=0,'handler found');
  const handler=lines.slice(start,lines.indexOf(' }));',start)+1).join('\n');
  const afterProgress=handler.slice(handler.indexOf("return sendScanProgress(req,res,batch);"));
  assert.match(afterProgress,/^return sendScanProgress\(req,res,batch\);\n  const db=await pool\.connect\(\);\n  try\{/);
  assert.match(afterProgress,/\n  \}finally\{db\.release\(\);\}\n \}\)\);$/);
  assert.doesNotMatch(afterProgress.replace('const db=await pool.connect()',''),/\bpool\b/,'every query in the read uses the held connection');
});
