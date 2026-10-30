import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {manualBackupWindow} from '../scan-backup.mjs';
test('scan backup has no global reminder, status error toast or Open Backup card',()=>{
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 const page=readFileSync(new URL('../src/scan-card-backup.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(main,/ScanBackupReminder/);
 assert.doesNotMatch(page,/Open Backup|SSD backup status unavailable|setInterval|backup due/);
 assert.match(page,/Manual SSD backup/);
});
test('manual backup is available immediately and includes the latest images',()=>{
 const now=new Date('2026-10-30T06:00:00Z');
 assert.deepEqual(manualBackupWindow(now,now),{from:now.toISOString(),to:'2026-10-30T06:00:00.001Z'});
 assert.equal(manualBackupWindow(null,now),null);
});