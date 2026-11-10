import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AUTO_SAVE_BUSY_DELAYS_MS,autoSaveWithBusyRetry,isBusyAutoSaveError,busyAutoSaveStoppedMessage} from '../shared/scan-auto-save-retry.mjs';
import {readScannerResponse} from '../src/local-scanner-response.mjs';

const busy=()=>Object.assign(new Error('The server is reconnecting to the database. Please retry in a moment.'),{status:503,transient:true});
const refused=()=>Object.assign(new Error('Card changed. Reload before automatic saving.'),{status:409});
const response=(status,body)=>({status,ok:status>=200&&status<300,text:async()=>body});

test('a busy server is told apart from a refused card',()=>{
 assert.equal(isBusyAutoSaveError(busy()),true);
 assert.equal(isBusyAutoSaveError(Object.assign(new Error('timed out'),{name:'TimeoutError'})),true);
 assert.equal(isBusyAutoSaveError(new TypeError('Failed to fetch')),true);
 assert.equal(isBusyAutoSaveError(refused()),false);
 assert.equal(isBusyAutoSaveError(new TypeError("Cannot read properties of undefined (reading 'record')")),false,'a code fault is not replayed');
 assert.equal(isBusyAutoSaveError(Object.assign(new Error('stopped'),{name:'AbortError'})),false);
 assert.equal(isBusyAutoSaveError(null),false);
});

test('the card is tried again after each wait and saved once the server answers',async()=>{
 const waits=[],slept=[];let calls=0;
 const result=await autoSaveWithBusyRetry(async()=>{calls+=1;if(calls<3)throw busy();return {status:'posted'}},{sleep:async ms=>{slept.push(ms)},onWait:wait=>waits.push(wait)});
 assert.deepEqual(result,{status:'posted'});
 assert.equal(calls,3);
 assert.deepEqual(slept,AUTO_SAVE_BUSY_DELAYS_MS.slice(0,2));
 assert.deepEqual(waits.map(w=>[w.nextAttempt,w.totalAttempts]),[[2,7],[3,7]]);
});

test('a refused card is not replayed',async()=>{
 let calls=0;
 await assert.rejects(autoSaveWithBusyRetry(async()=>{calls+=1;throw refused()},{sleep:async()=>{}}),/Card changed/);
 assert.equal(calls,1);
});

test('after every wait is used the pause is reported with the number of tries',async()=>{
 let calls=0;
 const error=await autoSaveWithBusyRetry(async()=>{calls+=1;throw busy()},{sleep:async()=>{}}).catch(e=>e);
 assert.equal(calls,AUTO_SAVE_BUSY_DELAYS_MS.length+1);
 assert.equal(error.busyExhausted,true);
 assert.equal(error.attempts,calls);
 assert.match(busyAutoSaveStoppedMessage(error.attempts),/7 tries.*retry in one minute.*No card was lost/);
});

test('retrying stops when the reviewer leaves the batch',async()=>{
 let calls=0,open=true;
 await assert.rejects(autoSaveWithBusyRetry(async()=>{calls+=1;throw busy()},{sleep:async()=>{open=false},shouldContinue:()=>open}));
 assert.equal(calls,1);
});

test('the response reader marks temporary failures and leaves refusals unmarked',async()=>{
 const temporary=await readScannerResponse(response(503,JSON.stringify({error:'The server is reconnecting to the database. Please retry in a moment.',transient:true}))).catch(e=>e);
 assert.equal(temporary.transient,true);assert.equal(temporary.status,503);
 const gateway=await readScannerResponse(response(502,'<html>Bad Gateway</html>')).catch(e=>e);
 assert.equal(gateway.transient,true);
 const mis=await readScannerResponse(response(200,'<html>Proxy response</html>'),{mis:true}).catch(e=>e);
 assert.equal(mis.transient,true);
 assert.match(mis.message,/MIS server.*HTTP 200/);
 const denied=await readScannerResponse(response(403,'<html>Denied</html>'),{mis:true}).catch(e=>e);
 assert.equal(denied.transient,undefined);
 const refusal=await readScannerResponse(response(409,JSON.stringify({error:'Card changed. Reload before automatic saving.'}))).catch(e=>e);
 assert.equal(refusal.transient,undefined);assert.equal(refusal.message,'Card changed. Reload before automatic saving.');
 const expired=await readScannerResponse(response(401,'')).catch(e=>e);
 assert.equal(expired.transient,undefined);assert.match(expired.message,/session expired/);
 assert.deepEqual(await readScannerResponse(response(200,'{"ok":true}')),{ok:true});
});

test('the scanning screen waits out a busy server instead of listing the card as refused',()=>{
 const source=readFileSync(new URL('../src/bulk-card-scanning.jsx',import.meta.url),'utf8');
 assert.match(source,/autoSaveWithBusyRetry\(\(\)=>api\('\/api\/scan-cards\/'\+next\.id\+'\/auto-save'/);
 assert.match(source,/if\(isBusyAutoSaveError\(e\)\)\{[\s\S]{0,200}autoSaveAttempts\.current\.delete\(key\);[\s\S]{0,200}autoSavePaused\.current=next\.batch_id;/);
 assert.ok(source.indexOf('if(isBusyAutoSaveError(e)){')<source.indexOf('autoSaveFailures.current.set(key,e.message)'),'a busy failure returns before the refusal list is touched');
 assert.match(source,/The server is busy\. Card \{autoSaveWait\.ordinal\} will be saved automatically/);
 assert.match(source,/onClick=\{\(\)=>\{autoSavePaused\.current=false;autoSaveAttempts\.current\.clear\(\)/);
});

test('the server answers a replayed automatic save with the existing book',()=>{
 const route=readFileSync(new URL('../server/routes/bulk-card-scanning.mjs',import.meta.url),'utf8');
 assert.match(route,/if\(card\.status==='posted'\)\{record=\(await c\.query\('SELECT id,book_no,data FROM mis_log_books WHERE id=\$1 AND deleted_at IS NULL'/);
});
