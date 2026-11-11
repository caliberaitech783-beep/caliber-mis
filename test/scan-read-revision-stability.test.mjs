import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');

// Reading a scan batch may write a card back only when its completed draft
// really differs from the stored one. An unloading-only trip receives a
// loading-time estimate that completion removes again; writing that back
// raised the card revision on every read, so corrections and automatic saves
// were refused as "Card changed".
test('a scan batch read does not rewrite a card whose completed draft is unchanged',()=>{
 assert.ok(source.includes('draft=completeScanTripDetails(draft,row.raw_fields);if(stableJson(draft)!==stableJson(row.draft)){const updated=await db.query("UPDATE mis_scan_cards SET draft=$1::jsonb,revision=revision+1'));
});

// PostgreSQL jsonb returns keys in its own order, so drafts are compared
// without regard to key order.
test('a scan batch read compares drafts without regard to key order',()=>{
 assert.ok(!source.includes('JSON.stringify(draft)!==JSON.stringify(row.draft)'));
});
