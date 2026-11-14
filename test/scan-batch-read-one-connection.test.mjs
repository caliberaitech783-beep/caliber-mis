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
  const afterProgress=handler.slice(handler.indexOf("  const payload=await readLane.run("));
  // Since 14 November 2026 the read runs inside the entry read lane (a few at a time); the
  // connection is still taken only inside the lane and released before the lane slot is.
  assert.match(afterProgress,/^  const payload=await readLane\.run\(\{\},async\(\)=>\{\n  const db=await pool\.connect\(\);\n  try\{/);
  assert.match(afterProgress,/\n  \}finally\{db\.release\(\);\}\n  \}\);\n  res\.set\('Cache-Control','no-store'\)\.json\(payload\);\n \}\)\);$/);
  assert.doesNotMatch(afterProgress.replace('const db=await pool.connect()',''),/\bpool\b/,'every query in the read uses the held connection');
});
