import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {contentRejectEnabled,scanDuplicateFlags} from '../scan-duplicates.mjs';

test('automatic content-duplicate rejection and fingerprint skipping are off unless switched on, and both show on the health endpoint',()=>{
 assert.equal(contentRejectEnabled({}),false);
 assert.equal(contentRejectEnabled({SCAN_DUPLICATE_CONTENT_REJECT:'1'}),false);
 assert.equal(contentRejectEnabled({SCAN_DUPLICATE_CONTENT_REJECT:'true'}),true);
 assert.deepEqual(scanDuplicateFlags({}),{fingerprint:false,contentReject:false});
 assert.deepEqual(scanDuplicateFlags({SCAN_DUPLICATE_FINGERPRINT:'true',SCAN_DUPLICATE_CONTENT_REJECT:'true'}),{fingerprint:true,contentReject:true});
 const extraction=fs.readFileSync(new URL('../bulk-card-scanning.mjs',import.meta.url),'utf8');
 assert.match(extraction,/if\(contentRejectEnabled\(\)&&await applyContentDuplicate\(pool,batch\.kind,readCard,batch\)\)continue;/,'a read card is only auto-rejected when the flag is on');
 const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/scanDuplicates:scanDuplicateFlags\(\),/);
 const example=fs.readFileSync(new URL('../.env.example',import.meta.url),'utf8');
 assert.match(example,/^SCAN_DUPLICATE_CONTENT_REJECT=false$/m);
});
